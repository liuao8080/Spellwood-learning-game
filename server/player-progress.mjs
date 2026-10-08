import { createHash, randomInt } from "node:crypto";
import { createProgressModel, PROGRESS_LIMITS, skinIntent } from "../src/network/progress.mjs";
import { freshCollection } from "../src/collection.mjs";
import { freshJourney, applyQualifiedLearning, applyQualifiedMatch, openSkinPack, revealSkinPack, closeSkinPack, redeemSkin, equipSkin } from "../src/reward-journey.mjs";
import { freshCombatRating } from "../src/combat-rating.mjs";
import { SCHOOL_BANK, TEACHER_BANK, bankFor, validTeacherCourse } from "../src/question-banks.mjs";

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

/** Server-owned account progress, using the same validated v4 data as StudyDesk.
 * Call learning/result/participation/collection only with server-generated
 * inputs. An HTTP handler may accept preferences and explicit legacy imports;
 * never expose these authority-bearing methods as a generic client mutation.
 * All methods are synchronous, so a failed database commit cannot appear as a
 * successful feedback/reward response. No credentials are accepted or logged.
 */
export function createPlayerProgress({
  identityStore, questions, timeZone = "Asia/Shanghai", now = () => Date.now(),
  random = () => randomInt(0x100000000) / 0x100000000,
} = {}) {
  if (!identityStore?.commitPlayerEvent || !identityStore?.getPlayerEvent)
    fail("IDENTITY_STORE_REQUIRED");
  const model = createProgressModel({ questions });
  const questionById = new Map(questions.map(question => [question.id, question]));
  // Validate configuration before an account can be modified.
  model.fresh("configuration-check", timeZone);

  function ensure(playerId) {
    for (let attempt = 0; attempt < 32; attempt++) {
      const player = identityStore.getPublicPlayer(playerId);
      if (!player) fail("PLAYER_NOT_FOUND");
      if (!plain(player.progress)) fail("INVALID_STORED_PROGRESS");
      if (Object.keys(player.progress).length) {
        const storedSchema = player.progress.schema;
        try { player.progress = model.validate(player.progress); }
        catch (error) { fail("INVALID_STORED_PROGRESS", { cause: error }); }
        if (player.progress.profileId !== playerId) fail("PROGRESS_IDENTITY_MISMATCH");
        if (storedSchema === 4) return player;
        // Migration owns one durable CAS revision; repeated reads and competing
        // requests cannot issue a second default journey or lose prior data.
        player.progress.revision = player.revision + 1;
        try {
          return identityStore.updatePlayerData(playerId, {
            expectedRevision: player.revision, progress: player.progress,
            profile: { ...player.profile, progressAuthority: authority(player.profile, now()) },
          });
        } catch (error) {
          if (error.code !== "REVISION_CONFLICT") throw error;
          continue;
        }
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
    if (replay) return { ...replay, player: ensure(playerId) };
    for (let attempt = 0; attempt < 32; attempt++) {
      const player = ensure(playerId);
      // A competing request may have committed while the candidate was read.
      const duplicate = identityStore.getPlayerEvent(playerId, event);
      if (duplicate) return { ...duplicate, player: ensure(playerId) };
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

  function withReward(candidate, reward) {
    const balance = candidate.data.collection.earned.dust + reward.officialDustDelta;
    if (!Number.isSafeInteger(balance) || balance < 0 || balance > 100000000) fail("REWARD_BALANCE_LIMIT");
    candidate.data.journey = reward.state;
    candidate.data.collection.earned.dust = balance;
    return { ...candidate, changed: candidate.changed || reward.changed,
      receipt: { ...candidate.receipt, reward: reward.receipt } };
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
      const participation = serverOwnSnapshot.participation;
      let qualifiedMatch;
      if (participation !== undefined) {
        if (!plain(participation) || !Number.isSafeInteger(participation.startedAt) || participation.startedAt < 0 ||
            participation.startedAt > record.date || !Number.isSafeInteger(participation.ownTurns) || participation.ownTurns < 0 ||
            !Number.isSafeInteger(participation.ownActions) || participation.ownActions < 0)
          fail("INVALID_QUALIFIED_MATCH");
        const termination = ["health", "draw"].includes(record.reason) ? "normal" :
          record.reason === "surrender" ? "surrender" : record.reason === "expired" ? "expired" : "quit";
        qualifiedMatch = { ownerId: playerId,
          eventId: `match:${createHash("sha256").update(`${record.id}:${record.youSeat}`).digest("hex")}`,
          matchId: record.id, mode: record.mode, termination, issuedAt: participation.startedAt,
          finishedAt: record.date, ownTurns: participation.ownTurns, ownActions: participation.ownActions };
      }
      // School receipts predate explicit bank tags. Keep their original
      // fingerprint; teacher scope and new participation remain explicit.
      const payload = { ...record, ...(qualifiedMatch ? { participation: qualifiedMatch } : {}) };
      if (payload.bank === SCHOOL_BANK) delete payload.bank;
      return commit(playerId, {
        eventId: `result:${record.id}:${record.youSeat}`, type: "result", payload,
      }, (player) => {
        const candidate = model.addResult(player.progress, serverOwnSnapshot);
        return qualifiedMatch ? withReward(candidate, applyQualifiedMatch(candidate.data.journey, qualifiedMatch)) : candidate;
      });
    },
    preferences(playerId, patch, requestId) {
      const clean = model.preferencePatch(patch);
      return commit(playerId, {
        eventId: `preferences:${requestKey(requestId)}`, type: "preferences", payload: clean,
      }, (player) => model.preferences(player.progress, clean));
    },
    participation(playerId, challengeId, serverTiming) {
      requestKey(challengeId);
      // The permanent ledger is consulted before ephemeral timing or bounded
      // journey history, including after restart and historical compaction.
      return commit(playerId, {
        eventId: `participation:${challengeId}`, type: "participation", payload: { challengeId },
      }, (player) => {
        const receipt = player.progress.learningReceipts[challengeId];
        if (!receipt) fail("INVALID_PARTICIPATION");
        const answeredAt = serverTiming?.answeredAt ?? receipt.answeredAt;
        const issuedAt = serverTiming?.issuedAt ?? answeredAt - serverTiming?.questionMs;
        const qualifiedAt = serverTiming?.qualifiedAt ?? serverTiming?.now;
        const source = serverTiming?.source ?? "study";
        if (![issuedAt, answeredAt, qualifiedAt].every(value => Number.isSafeInteger(value) && value >= 0) ||
            answeredAt !== receipt.answeredAt || answeredAt < issuedAt || qualifiedAt < answeredAt + 1200 ||
            qualifiedAt < issuedAt + 3200 || qualifiedAt - issuedAt > 7200000 || !["study", "match"].includes(source))
          fail("INVALID_PARTICIPATION");
        const question = questionById.get(receipt.qid);
        if (!question || typeof question.unitId !== "string" ||
            !/^[A-Za-z0-9_.-]{1,80}$/.test(question.unitId)) fail("INVALID_PARTICIPATION");
        const bank = bankFor(question.bank), book = question.bookId ?? question.semester;
        let unitId;
        if (bank === TEACHER_BANK) {
          if (question.grade !== null || question.semester !== null ||
              question.category === "all" || !validTeacherCourse(question.category)) fail("INVALID_PARTICIPATION");
          unitId = `${TEACHER_BANK}:${question.category}:${question.unitId}`;
        } else {
          if (bank !== SCHOOL_BANK || ![1, 2, 3, 4, 5, 6].includes(question.grade) ||
              !["string", "number"].includes(typeof book) || !/^[A-Za-z0-9_.-]{1,24}$/.test(String(book)))
            fail("INVALID_PARTICIPATION");
          // Preserve the existing school namespace and all original qids.
          unitId = `g${question.grade}:b${book}:${question.unitId}`;
        }
        // A fast answer can finish the remaining reading time on the feedback
        // screen. The old card-day reducer receives the same issuedAt day and
        // a server-verified 2s+1.2s budget, without editing the actual answer.
        const candidate = model.participation(player.progress, challengeId,
          { issuedAt, questionMs: 2000, feedbackMs: qualifiedAt - answeredAt, now: qualifiedAt });
        return withReward(candidate, applyQualifiedLearning(candidate.data.journey, {
          ownerId: playerId, eventId: challengeId, qid: receipt.qid, unitId, source, issuedAt, answeredAt, qualifiedAt,
        }));
      });
    },
    skins(playerId, action, requestId) {
      const intent = skinIntent(action), operationId = requestKey(requestId);
      const reducers = { open: openSkinPack, reveal: revealSkinPack, close: closeSkinPack, redeem: redeemSkin, equip: equipSkin };
      return commit(playerId, { eventId: `skin:${operationId}`, type: "skin", payload: intent }, (player) => {
        const data = model.validate(player.progress);
        const request = { ...intent, ownerId: playerId, operationId, issuedAt: now() };
        const options = { officialDustBalance: data.collection.earned.dust,
          ...(intent.kind === "open" ? { randomValues: Array.from({ length: intent.count }, () => random()) } : {}) };
        return withReward({ data, changed: false }, reducers[intent.kind](data.journey, request, options));
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
          current.learningDays || current.collectionCopies || player.progress.legacy.match ||
          player.progress.journey.revision || player.progress.journey.newcomerGranted || player.progress.journey.skinTickets ||
          player.progress.journey.official.owned.length || player.progress.journey.test.owned.length;
        if (active) fail("LEGACY_IMPORT_CONFLICT", {
          summary: { current, incoming, currentRevision: player.progress.revision, canReplace: false },
        });
        const data = clone(source);
        data.profileId = playerId;
        data.timeZone = timeZone;
        data.journey = freshJourney({ ownerId: playerId });
        data.journey.test.owned = [...new Set([...source.journey.test.owned, ...source.journey.official.owned])];
        if (source.journey.equipped.mode !== "base")
          data.journey.equipped = { mode: "test", skinId: source.journey.equipped.skinId };
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
          journey: clone(source.journey),
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
