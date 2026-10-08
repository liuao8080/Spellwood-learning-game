import { createHash } from "node:crypto";
import { createProgressModel, PROGRESS_LIMITS } from "../src/network/progress.mjs";
import { freshCollection } from "../src/collection.mjs";
import { freshCombatRating } from "../src/combat-rating.mjs";

const clone = (value) => structuredClone(value);
const plain = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const fail = (code, extra = {}) => { throw Object.assign(new Error(code), { code, ...extra }); };
const requestKey = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value))
    fail("INVALID_REQUEST_ID");
  return value;
};
const authority = (profile, now) => profile.progressAuthority ?? {
  version: 1, source: "server", initializedAt: now, mutations: 0,
  learningEvents: 0, resultEvents: 0,
};

function summary(data) {
  const mastery = [...Object.values(data.legacy.mastery), ...Object.values(data.legacy.archivedMastery)];
  return {
    learnedQuestions: mastery.filter((item) => item.seen > 0).length,
    learningAttempts: mastery.reduce((total, item) => total + item.seen, 0),
    correctAnswers: mastery.reduce((total, item) => total + item.correct, 0),
    legacyRecords: data.legacy.records.length,
    onlineRecords: data.onlineRecords.length,
    learningDays: data.collection.totalDays,
    collectionCopies: [data.collection.test, data.collection.earned].reduce(
      (total, wallet) => total + Object.values(wallet.cards).reduce((sum, count) => sum + count, 0), 0,
    ),
  };
}

/** Server-owned account progress, using the same validated v3 data as StudyDesk.
 * Call learning/result/participation/collection only with server-generated
 * inputs. An HTTP handler may accept preferences and explicit legacy imports;
 * never expose these authority-bearing methods as a generic client mutation.
 * All methods are synchronous, so a failed database commit cannot appear as a
 * successful feedback/reward response. No credentials are accepted or logged.
 */
export function createPlayerProgress({
  identityStore, questions, timeZone = "Asia/Shanghai", now = () => Date.now(),
} = {}) {
  if (!identityStore?.commitPlayerEvent || !identityStore?.getPlayerEvent)
    fail("IDENTITY_STORE_REQUIRED");
  const model = createProgressModel({ questions });
  // Validate configuration before an account can be modified.
  model.fresh("configuration-check", timeZone);

  function ensure(playerId) {
    for (let attempt = 0; attempt < 32; attempt++) {
      const player = identityStore.getPublicPlayer(playerId);
      if (!player) fail("PLAYER_NOT_FOUND");
      if (!plain(player.progress)) fail("INVALID_STORED_PROGRESS");
      if (Object.keys(player.progress).length) {
        try { player.progress = model.validate(player.progress); }
        catch (error) { fail("INVALID_STORED_PROGRESS", { cause: error }); }
        if (player.progress.profileId !== playerId) fail("PROGRESS_IDENTITY_MISMATCH");
        return player;
      }
      const progress = model.fresh(playerId, timeZone);
      progress.revision = player.revision + 1;
      try {
        return identityStore.updatePlayerData(playerId, {
          expectedRevision: player.revision, progress,
          profile: { ...player.profile, progressAuthority: authority(player.profile, now()) },
        });
      } catch (error) {
        if (error.code !== "REVISION_CONFLICT") throw error;
      }
    }
    fail("PROGRESS_BUSY");
  }

  function commit(playerId, event, apply) {
    const replay = identityStore.getPlayerEvent(playerId, event);
    if (replay) return replay;
    for (let attempt = 0; attempt < 32; attempt++) {
      const player = ensure(playerId);
      // A competing request may have committed while the candidate was read.
      const duplicate = identityStore.getPlayerEvent(playerId, event);
      if (duplicate) return duplicate;
      const candidate = apply(player);
      candidate.data.revision = player.revision + 1;
      const profile = candidate.profile ?? clone(player.profile);
      const metadata = clone(authority(profile, now()));
      metadata.mutations++;
      if (candidate.changed && event.type === "learning") metadata.learningEvents++;
      if (candidate.changed && event.type === "result") metadata.resultEvents++;
      profile.progressAuthority = metadata;
      try {
        return identityStore.commitPlayerEvent(playerId, {
          ...event, expectedRevision: player.revision,
          profile, progress: candidate.data,
          receipt: { changed: candidate.changed, ...(candidate.receipt ?? {}) },
        });
      } catch (error) {
        if (error.code !== "REVISION_CONFLICT") throw error;
      }
    }
    fail("PROGRESS_BUSY");
  }

  return Object.freeze({
    ensure,
    applyLearning(playerId, serverFeedback) {
      const learning = model.learning(serverFeedback);
      // Keep answer choices, explanations, hands, and session tokens out of
      // both the fingerprint and persisted event; only the v3 receipt matters.
      const feedback = { challengeId: learning.id, learning };
      return commit(playerId, {
        eventId: `learning:${learning.id}`, type: "learning", payload: learning,
      }, (player) => model.applyLearning(player.progress, feedback));
    },
    addResult(playerId, serverOwnSnapshot) {
      const record = model.result(serverOwnSnapshot);
      // Preserve the pre-bank fingerprint of school receipts already committed
      // to the account ledger. Teacher receipts retain their explicit scope.
      const payload = clone(record);
      if (payload.bank === "school") delete payload.bank;
      return commit(playerId, {
        eventId: `result:${record.id}:${record.youSeat}`, type: "result", payload,
      }, (player) => model.addResult(player.progress, serverOwnSnapshot));
    },
    preferences(playerId, patch, requestId) {
      const clean = model.preferencePatch(patch);
      return commit(playerId, {
        eventId: `preferences:${requestKey(requestId)}`, type: "preferences", payload: clean,
      }, (player) => model.preferences(player.progress, clean));
    },
    participation(playerId, challengeId, serverTiming) {
      requestKey(challengeId);
      // These durations must come from server-observed participation, never
      // client-reported focus timers. Preserve the existing v3 qualification.
      const timing = {
        questionMs: serverTiming?.questionMs,
        feedbackMs: serverTiming?.feedbackMs,
        now: serverTiming?.now,
      };
      if (!Number.isSafeInteger(timing.questionMs) || timing.questionMs < 2000 || timing.questionMs > 7200000 ||
          !Number.isSafeInteger(timing.feedbackMs) || timing.feedbackMs < 1200 || timing.feedbackMs > 7200000 ||
          !Number.isSafeInteger(timing.now) || timing.now < 0)
        fail("INVALID_PARTICIPATION");
      return commit(playerId, {
        eventId: `participation:${challengeId}`, type: "participation", payload: { challengeId },
      }, (player) => {
        const receipt = player.progress.learningReceipts[challengeId];
        if (!receipt || timing.now < receipt.answeredAt || timing.now - receipt.answeredAt > 7200000)
          fail("INVALID_PARTICIPATION");
        return model.participation(player.progress, challengeId, timing);
      });
    },
    collection(playerId, serverAction, requestId) {
      // open-pack cards/randomness must be generated by the server. Other
      // allowed actions still pass applyCollectionOperation's actual checks.
      // Fingerprint an opening's stable intent, not fresh random cards/time
      // that the server may regenerate while retrying the same HTTP request.
      const payload = serverAction?.kind === "open-pack"
        ? { kind: "open-pack", mode: serverAction.mode } : serverAction;
      return commit(playerId, {
        eventId: `collection:${requestKey(requestId)}`, type: "collection", payload,
      }, (player) => model.collection(player.progress, serverAction));
    },
    importLegacy(playerId, raw, requestId, { expectedRevision } = {}) {
      requestKey(requestId);
      let text;
      try { text = typeof raw === "string" ? raw : JSON.stringify(raw); }
      catch { fail("INVALID_IMPORT"); }
      if (typeof text !== "string") fail("INVALID_IMPORT");
      if (text.length > PROGRESS_LIMITS.importCharacters) fail("IMPORT_TOO_LARGE");
      const source = model.importLegacy(text);
      const sourceSchema = JSON.parse(text).schema;
      const sourceHash = createHash("sha256").update(text).digest("hex");
      const incoming = summary(source);
      return commit(playerId, {
        eventId: `legacy-import:${requestId}`, type: "legacy-import", payload: { sourceHash, sourceSchema },
      }, (player) => {
        // The replay lookup above intentionally precedes this comparison. A
        // successfully imported request remains successful after later writes.
        if (expectedRevision !== undefined) {
          if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
            fail("INVALID_REVISION");
          if (expectedRevision !== player.progress.revision)
            fail("STALE_REVISION", { summary: { currentRevision: player.progress.revision, incoming } });
        }
        const current = summary(player.progress);
        const active = player.profile.legacyImport || player.profile.progressAuthority?.mutations > 0 ||
          current.learningAttempts || current.onlineRecords || current.legacyRecords ||
          current.learningDays || current.collectionCopies || player.progress.legacy.match;
        if (active) fail("LEGACY_IMPORT_CONFLICT", {
          summary: { current, incoming, currentRevision: player.progress.revision, canReplace: false },
        });
        const data = clone(source);
        data.profileId = playerId;
        data.timeZone = timeZone;
        delete data.recoveryKey;
        // Imported mastery is preserved as its aggregate. Old receipt counts
        // and cutoff remain a summary, not authority over new server events.
        data.learningReceipts = {};
        data.learningBase = {};
        data.learningCutoff = null;
        data.onlineRecords = [];
        data.resultIds = [];
        data.combatRating = freshCombatRating();
        data.collection = freshCollection();
        // Old looks remain usable in the test/display collection. Exact old
        // wallet counts and unfinished packs remain in the provenance summary.
        for (const wallet of [source.collection.test, source.collection.earned]) {
          data.collection.test.dust = Math.min(100000000, data.collection.test.dust + wallet.dust);
          for (const [key, count] of Object.entries(wallet.cards))
            data.collection.test.cards[key] = Math.min(10000000, (data.collection.test.cards[key] ?? 0) + count);
        }
        for (const [card, equipped] of Object.entries(source.collection.equipped))
          data.collection.equipped[card] = { mode: "test", finish: equipped.finish };
        const profile = clone(player.profile);
        profile.legacyImport = {
          version: 1, provenance: "unverified-local", sourceHash, sourceSchema,
          importedAt: now(), summary: incoming,
          collection: {
            totalDays: source.collection.totalDays,
            daysRecorded: Object.keys(source.collection.days).length,
            earnedPacksSpent: source.collection.earnedPacksSpent,
            openingCount: source.collection.openingIds.length,
            test: clone(source.collection.test), earned: clone(source.collection.earned),
            equipped: clone(source.collection.equipped), opening: clone(source.collection.opening),
            recent: clone(source.collection.recent),
          },
          combatRating: clone(source.combatRating),
          onlineRecords: clone(source.onlineRecords),
          resultCount: source.resultIds.length,
          learningHistory: {
            receiptCount: Object.keys(source.learningReceipts).length,
            questionCount: Object.keys(source.learningBase).length,
            cutoff: source.learningCutoff, timeZone: source.timeZone,
          },
        };
        return { data: model.validate(data), changed: true, profile,
          receipt: { sourceHash, sourceSchema, summary: incoming, provenance: "unverified-local" } };
      });
    },
  });
}
