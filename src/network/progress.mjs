import { freshSave, validateSave, recordLearning } from "../learning.mjs";
import { TEACHER_BANK, bankFor, validBank, validTeacherCourse } from "../question-banks.mjs";
import { DECKS, OPPONENTS, validCourse, validateCustomDeck } from "../cards.mjs";
import { freshCollection, validateCollection, qualifyDay, applyCollectionOperation, generatePack } from "../collection.mjs";
import { HERO_SKINS, DEFAULT_HERO_SKIN } from "../hero-skins.mjs";
import { freshJourney, normalizeJourney, applyQualifiedLearning, applyQualifiedMatch, openSkinPack as reduceOpenSkinPack, revealSkinPack as reduceRevealSkinPack, closeSkinPack as reduceCloseSkinPack, redeemSkin as reduceRedeemSkin, equipSkin as reduceEquipSkin } from "../reward-journey.mjs";
import { freshCombatRating, normalizeCombatRating, normalizeDifficulty, recordCombatResult, COMBAT_MODES, DIFFICULTIES } from "../combat-rating.mjs";

export const PROGRESS_KEY = "spellwood.save.v4";
export const PROGRESS_LOCK = "spellwood.save.v4.transaction";
export const PROGRESS_LIMITS = Object.freeze({
  learningEvents: 8192,
  resultIds: 65536,
  replayMs: 2 * 60 * 60 * 1000,
  importCharacters: 8 * 1024 * 1024,
});
const OLD_KEYS = ["spellwood.save.v3", "spellwood.save.v2", "spellwood.save.v1"];
const plain = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const integer = (x, min, max) =>
  Number.isSafeInteger(x) && x >= min && x <= max;
const token = (x) =>
  typeof x === "string" &&
  /^[A-Za-z0-9_-]{8,128}$/.test(x) &&
  !Object.hasOwn(Object.prototype, x) &&
  x !== "prototype";
const resultKey = (r) =>
  r.youSeat === undefined ? r.id : `${r.id}:${r.youSeat}`;
const validResultKey = (value) =>
  token(value) ||
  (typeof value === "string" &&
    /^[01]$/.test(value.slice(-1)) &&
    value.at(-2) === ":" &&
    token(value.slice(0, -2)));
const sameOldResult = (a, b) =>
  bankFor(a.bank) === bankFor(b.bank) &&
  [
    "grade",
    "course",
    "ruleset",
    "combatRules",
    "contentVersion",
    "mode",
    "assisted",
    "result",
    "reason",
    "score",
    "attempts",
    "correct",
    "turns",
  ].every((key) => a[key] === b[key]);
const date = (x) => integer(x, 0, 8_000_000_000_000_000);
const clone = (x) => structuredClone(x);
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const newId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const calendarFormats = new Map();
function calendar(timeZone) {
  if (typeof timeZone !== "string" || timeZone.length > 80)
    fail("INVALID_TIME_ZONE");
  if (!calendarFormats.has(timeZone)) {
    try {
      calendarFormats.set(
        timeZone,
        new Intl.DateTimeFormat("en", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }),
      );
    } catch {
      fail("INVALID_TIME_ZONE");
    }
  }
  return calendarFormats.get(timeZone);
}
function calendarStamp(timestamp, timeZone) {
  if (!Number.isFinite(new Date(timestamp).getTime())) return timestamp;
  const parts = Object.fromEntries(
    calendar(timeZone)
      .formatToParts(timestamp)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  return new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    12,
  ).getTime();
}
function recordInCalendar(save, qid, correct, answeredAt, timeZone) {
  const previous = save.mastery[qid];
  if (previous) previous.last = calendarStamp(previous.last, timeZone);
  const day = calendarStamp(answeredAt, timeZone);
  recordLearning(save, { id: qid }, correct, day);
  const item = save.mastery[qid],
    interval = item.due - day;
  item.last = answeredAt;
  item.due = answeredAt + interval;
}
// A migration origin is a local coordination label, not an authentication key.
const originId = (raw) => {
  let a = 2166136261,
    b = 2246822519;
  for (let i = 0; i < raw.length; i++) {
    a = Math.imul(a ^ raw.charCodeAt(i), 16777619);
    b = Math.imul(b ^ raw.charCodeAt(i), 3266489917);
  }
  return `legacy-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}-${raw.length}`;
};
const select = (x, fields) =>
  Object.fromEntries(
    fields.filter((k) => Object.hasOwn(x, k)).map((k) => [k, clone(x[k])]),
  );
const MASTERY_FIELDS = ["seen", "correct", "streak", "due", "last"];
const PREF_FIELDS = [
  "bank",
  "teacherCourse",
  "nickname",
  "grade",
  "course",
  "deckId",
  "opponentId",
  "sound",
  "music",
  "musicVolume",
  "soundVolume",
  "speech",
  "reduced",
  "combatMode",
  "customDeck",
];
const MATCH_FIELDS = [
  "schema",
  "rules",
  "contentVersion",
  "course",
  "id",
  "grade",
  "seed",
  "deckId",
  "opponentId",
  "players",
  "active",
  "turn",
  "seq",
  "handSeq",
  "phase",
  "winner",
  "log",
  "questions",
  "questionIndex",
  "correct",
  "attempts",
  "review",
  "archivedReview",
  "pending",
  "recorded",
  "opening",
];
const PLAYER_FIELDS = [
  "hp",
  "armor",
  "mana",
  "maxMana",
  "board",
  "hand",
  "handIds",
  "handBoosts",
  "deck",
  "fatigue",
  "ritualUsed",
  "ritualsLeft",
];
const UNIT_FIELDS = ["uid", "cardId", "atk", "hp", "maxHp", "ready", "shield", "kingfisherDrawTurn"];

function localRewardUnit(question) {
  if (!question || typeof question.unitId !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(question.unitId))
    fail("INVALID_PARTICIPATION");
  if (question.bank === TEACHER_BANK) {
    if (question.grade !== null || question.semester !== null || question.category === "all" || !validTeacherCourse(question.category))
      fail("INVALID_PARTICIPATION");
    return `${TEACHER_BANK}:${question.category}:${question.unitId}`;
  }
  const book = question.bookId ?? question.semester;
  if (question.bank !== "school" || !integer(question.grade, 1, 6) ||
      !["string", "number"].includes(typeof book) || !/^[A-Za-z0-9_.-]{1,24}$/.test(String(book))) fail("INVALID_PARTICIPATION");
  return `g${question.grade}:b${book}:${question.unitId}`;
}
function applyLocalReward(data, reward) {
  const balance = data.collection.earned.dust + reward.officialDustDelta;
  if (!integer(balance, 0, 100000000)) fail("REWARD_BALANCE_LIMIT");
  data.journey = reward.state;
  data.collection.earned.dust = balance;
  return reward.changed;
}
function localMatch(record, participation) {
  if (participation === undefined) return undefined;
  if (!plain(participation) || !date(participation.startedAt) || participation.startedAt > record.date ||
      !integer(participation.ownTurns, 0, 100000) || !integer(participation.ownActions, 0, 100000)) fail("INVALID_QUALIFIED_MATCH");
  return { eventId: `local-match:${originId(resultKey(record))}`, matchId: record.id, mode: record.mode,
    termination: ["health", "draw"].includes(record.reason) ? "normal" :
      record.reason === "surrender" ? "surrender" : record.reason === "expired" ? "expired" : "quit",
    issuedAt: participation.startedAt, finishedAt: record.date, ownTurns: participation.ownTurns, ownActions: participation.ownActions };
}

function mastery(value) {
  if (
    !plain(value) ||
    !integer(value.seen, 0, 100000) ||
    !integer(value.correct, 0, value.seen) ||
    !integer(value.streak, 0, value.correct) ||
    !Number.isFinite(value.due) ||
    !Number.isFinite(value.last)
  )
    fail("INVALID_MASTERY");
  return select(value, MASTERY_FIELDS);
}

/** The old offline match is the sole allowed place for saved offline hands. */
function legacySave(input, questions) {
  const clean = validateSave(input, questions);
  if (clean.match) {
    clean.match = select(clean.match, MATCH_FIELDS);
    clean.match.players = clean.match.players.map((p) => ({
      ...select(p, PLAYER_FIELDS),
      board: p.board.map((u) => select(u, UNIT_FIELDS)),
    }));
    clean.match.questions = Array.isArray(clean.match.questions)
      ? clean.match.questions
          .filter((x) => typeof x === "string")
          .slice(0, 2000)
      : [];
    clean.match.pending = null;
    if (clean.match.opening)
      clean.match.opening = select(clean.match.opening, ["player", "opponent"]);
  }
  return clean;
}

function preferencePatch(patch) {
  if (!plain(patch) || Object.keys(patch).some((k) => !PREF_FIELDS.includes(k)))
    fail("INVALID_PREFERENCES");
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "nickname" && (typeof value !== "string" || value.length > 16))
      fail("INVALID_PREFERENCES");
    if (key === "grade" && !integer(value, 1, 6)) fail("INVALID_PREFERENCES");
    if (key === "bank" && !validBank(value)) fail("INVALID_PREFERENCES");
    if (key === "teacherCourse" && !validTeacherCourse(value)) fail("INVALID_PREFERENCES");
    if (key === "course" && !validCourse(value)) fail("INVALID_PREFERENCES");
    if (key === "deckId" && value !== "custom" && !DECKS.some((d) => d.id === value))
      fail("INVALID_PREFERENCES");
    if (key === "opponentId" && !OPPONENTS.some((d) => d.id === value))
      fail("INVALID_PREFERENCES");
    if (
      ["sound", "music", "speech", "reduced"].includes(key) &&
      typeof value !== "boolean"
    )
      fail("INVALID_PREFERENCES");
    if (["musicVolume", "soundVolume"].includes(key) && !integer(value, 0, 100))
      fail("INVALID_PREFERENCES");
    if (key === "combatMode" && !COMBAT_MODES.includes(value)) fail("INVALID_PREFERENCES");
    if (key === "customDeck" && value !== null && !validateCustomDeck(value)) fail("INVALID_PREFERENCES");
    result[key] = key === "nickname" ? value.trim() || "Leaf" : clone(value);
  }
  return result;
}

function learningEvent(feedback, questionIds) {
  const item = feedback?.learning;
  if (
    !plain(item) ||
    !token(feedback.challengeId) ||
    !questionIds.has(item.qid) ||
    typeof item.correct !== "boolean" ||
    !date(item.answeredAt)
  )
    fail("INVALID_LEARNING");
  return {
    id: feedback.challengeId,
    qid: item.qid,
    correct: item.correct,
    answeredAt: item.answeredAt,
  };
}

function onlineRecord(input) {
  const bank = bankFor(input?.bank);
  if (
    !plain(input) ||
    !token(input.id) ||
    !validBank(bank) ||
    (bank === TEACHER_BANK
      ? input.grade !== null || !validTeacherCourse(input.course)
      : !integer(input.grade, 1, 6) || !validCourse(input.course)) ||
    !["pvp", "pve"].includes(input.mode) ||
    typeof input.assisted !== "boolean" ||
    !["win", "loss", "draw"].includes(input.result) ||
    !integer(input.score, 0, 200000) ||
    !integer(input.attempts, 0, 2000) ||
    !integer(input.correct, 0, input.attempts) ||
    !integer(input.turns, 1, 2000) ||
    !date(input.date)
  )
    fail("INVALID_RESULT");
  for (const key of ["ruleset", "combatRules", "contentVersion", "reason"])
    if (
      typeof input[key] !== "string" ||
      !/^[A-Za-z0-9_.-]{1,40}$/.test(input[key])
    )
      fail("INVALID_RESULT");
  const clean = select(input, [
    "id",
    "grade",
    "course",
    "ruleset",
    "combatRules",
    "contentVersion",
    "mode",
    "assisted",
    "result",
    "reason",
    "score",
    "attempts",
    "correct",
    "turns",
    "date",
  ]);
  clean.bank = bank;
  if (input.youSeat !== undefined) {
    if (![0, 1].includes(input.youSeat)) fail("INVALID_RESULT");
    clean.youSeat = input.youSeat;
  }
  if (input.deckId !== undefined) {
    if (input.deckId !== "custom" && !DECKS.some((d) => d.id === input.deckId)) fail("INVALID_RESULT");
    clean.deckId = input.deckId;
  }
  if (input.computer !== undefined) {
    if (input.mode !== "pve" || !plain(input.computer) || !Object.hasOwn(DIFFICULTIES,input.computer.level)) fail("INVALID_RESULT");
    clean.computer = normalizeDifficulty(input.computer);
  }
  return clean;
}

function resultFromSnapshot(s) {
  if (
    !plain(s) ||
    s.phase !== "finished" ||
    ![0, 1].includes(s.youSeat) ||
    !plain(s.result) ||
    ![null, 0, 1].includes(s.result.winnerSeat)
  )
    fail("INVALID_RESULT");
  const r = s.result;
  return onlineRecord({
    id: s.roomId,
    youSeat: s.youSeat,
    bank: bankFor(s.bank),
    grade: s.grade,
    course: s.course,
    ruleset: s.ruleset,
    combatRules: s.combatRules,
    contentVersion: s.contentVersion,
    mode: s.mode,
    assisted: s.assisted,
    result:
      r.winnerSeat === null
        ? "draw"
        : r.winnerSeat === s.youSeat
          ? "win"
          : "loss",
    reason: r.reason,
    score: r.ownScore,
    attempts: r.ownLearning?.attempts,
    correct: r.ownLearning?.correct,
    turns: r.rounds,
    date: r.finishedAt ?? s.serverTime,
    ...(s.self?.deckId ? { deckId: s.self.deckId } : {}),
    ...(s.mode === "pve" && (r.computer || s.computer) ? { computer: r.computer || s.computer } : {}),
  });
}

function blank(legacy, profileId = newId()) {
  return {
    schema: 4,
    revision: 0,
    profileId,
    journey: freshJourney({ ownerId: profileId }),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    legacy,
    combatRating: freshCombatRating(),
    combatMode: "adaptive",
    chosenDeckId: legacy.deckId,
    customDeck: null,
    collection: freshCollection(),
    onlineRecords: [],
    resultIds: [],
    learningReceipts: {},
    learningBase: {},
    learningCutoff: null,
  };
}

function rebuildQuestion(data, qid) {
  const base = data.learningBase[qid],
    temporary = { mastery: {} };
  if (base) temporary.mastery[qid] = clone(base);
  const events = Object.values(data.learningReceipts)
    .filter((e) => e.qid === qid)
    .sort((a, b) => a.answeredAt - b.answeredAt || a.id.localeCompare(b.id));
  for (const event of events) {
    // An imported aggregate cannot reveal its older event history. Count a
    // delayed older receipt without moving that later aggregate back in time.
    if (base && event.answeredAt < base.last) {
      temporary.mastery[qid].seen++;
      temporary.mastery[qid].correct += Number(event.correct);
    } else
      recordInCalendar(
        temporary,
        qid,
        event.correct,
        event.answeredAt,
        data.timeZone,
      );
  }
  data.legacy.mastery[qid] = mastery(temporary.mastery[qid]);
}

function validateProgress(input, questions, questionIds) {
  if (
    !plain(input) ||
    ![3, 4].includes(input.schema) ||
    !integer(input.revision, 0, Number.MAX_SAFE_INTEGER - 1) ||
    !token(input.profileId)
  )
    fail("INVALID_PROGRESS");
  const data = blank(legacySave(input.legacy, questions), input.profileId);
  data.revision = input.revision;
  data.profileId = input.profileId;
  // Only a genuine old schema may initialize missing rewards. A truncated v4
  // snapshot must fail, never recreate newcomer rights.
  if (input.schema === 4 && input.journey === undefined) fail("INVALID_REWARD_STATE");
  data.journey = normalizeJourney(input.journey, { ownerId: data.profileId });
  data.timeZone = input.timeZone ?? data.timeZone;
  calendar(data.timeZone);
  data.combatRating = normalizeCombatRating(input.combatRating);
  if (Object.hasOwn(input, "combatRating") && (!plain(input.combatRating) ||
      Object.keys(freshCombatRating()).some(key => input.combatRating[key] !== data.combatRating[key])))
    fail("INVALID_COMBAT_RATING");
  data.combatMode = COMBAT_MODES.includes(input.combatMode) ? input.combatMode : "adaptive";
  if (input.customDeck != null && !validateCustomDeck(input.customDeck)) fail("INVALID_CUSTOM_DECK");
  data.customDeck = input.customDeck ? [...input.customDeck] : null;
  const chosen = input.chosenDeckId ?? data.legacy.deckId;
  if (!(chosen === "custom" ? !!data.customDeck : DECKS.some(d => d.id === chosen))) fail("INVALID_CUSTOM_DECK");
  data.chosenDeckId = chosen;
  data.collection = validateCollection(input.collection,questionIds);
  if (input.recoveryKey !== undefined) {
    if (
      typeof input.recoveryKey !== "string" ||
      !/^spellwood\.save\.v[34]\.recovery\.[A-Za-z0-9_.-]{8,160}$/.test(
        input.recoveryKey,
      )
    )
      fail("INVALID_PROGRESS");
    data.recoveryKey = input.recoveryKey;
  }
  // Wall-clock rollback cannot invalidate a previously committed archive.
  // Only creation of a new cutoff is constrained by the replay window.
  if (input.learningCutoff != null && !date(input.learningCutoff))
    fail("INVALID_LEARNING_HISTORY");
  data.learningCutoff = input.learningCutoff ?? null;
  if (
    !Array.isArray(input.onlineRecords) ||
    input.onlineRecords.length > 200 ||
    !Array.isArray(input.resultIds) ||
    input.resultIds.some((x) => !validResultKey(x)) ||
    new Set(input.resultIds).size !== input.resultIds.length
  )
    fail("INVALID_RESULT_HISTORY");
  data.resultIds = [...input.resultIds];
  data.onlineRecords = input.onlineRecords.map(onlineRecord);
  if (data.resultIds.length > PROGRESS_LIMITS.resultIds + 1)
    fail("PROGRESS_FULL");
  if (
    new Set(data.onlineRecords.map(resultKey)).size !==
      data.onlineRecords.length ||
    data.onlineRecords.some((r) => !data.resultIds.includes(resultKey(r)))
  )
    fail("INVALID_RESULT_HISTORY");
  if (!plain(input.learningReceipts) || !plain(input.learningBase))
    fail("INVALID_LEARNING_HISTORY");
  if (
    Object.keys(input.learningReceipts).length >
    PROGRESS_LIMITS.learningEvents + 1
  )
    fail("PROGRESS_FULL");
  for (const [id, event] of Object.entries(input.learningReceipts)) {
    const clean = learningEvent(
      { challengeId: id, learning: event },
      questionIds,
    );
    if (event.id !== id) fail("INVALID_LEARNING_HISTORY");
    data.learningReceipts[id] = clean;
  }
  const qids = new Set(Object.values(data.learningReceipts).map((e) => e.qid));
  if (Object.keys(input.learningBase).some((id) => !qids.has(id)))
    fail("INVALID_LEARNING_HISTORY");
  for (const qid of qids) {
    if (!Object.hasOwn(input.learningBase, qid))
      fail("INVALID_LEARNING_HISTORY");
    data.learningBase[qid] =
      input.learningBase[qid] === null
        ? null
        : mastery(input.learningBase[qid]);
    const expected = data.legacy.mastery[qid];
    rebuildQuestion(data, qid);
    if (JSON.stringify(expected) !== JSON.stringify(data.legacy.mastery[qid]))
      fail("INCONSISTENT_LEARNING_HISTORY");
  }
  return data;
}

function compact(data) {
  if (data.resultIds.length > PROGRESS_LIMITS.resultIds) fail("PROGRESS_FULL");
  const events = Object.values(data.learningReceipts).sort(
    (a, b) => a.answeredAt - b.answeredAt || a.id.localeCompare(b.id),
  );
  const count = events.length - PROGRESS_LIMITS.learningEvents;
  if (count <= 0) return false;
  const old = events.slice(0, count);
  if (old.some((e) => e.answeredAt > Date.now() - PROGRESS_LIMITS.replayMs))
    fail("PROGRESS_FULL");
  const affected = new Set();
  for (const event of old) {
    const base = data.learningBase[event.qid],
      temp = { mastery: {} };
    if (base) temp.mastery[event.qid] = clone(base);
    if (base && event.answeredAt < base.last) {
      temp.mastery[event.qid].seen++;
      temp.mastery[event.qid].correct += Number(event.correct);
    } else
      recordInCalendar(
        temp,
        event.qid,
        event.correct,
        event.answeredAt,
        data.timeZone,
      );
    data.learningBase[event.qid] = mastery(temp.mastery[event.qid]);
    delete data.learningReceipts[event.id];
    affected.add(event.qid);
    data.learningCutoff = Math.max(data.learningCutoff, event.answeredAt);
  }
  for (const qid of affected)
    if (!Object.values(data.learningReceipts).some((e) => e.qid === qid))
      delete data.learningBase[qid];
  return true;
}

const ISSUE_TEXT = {
  READ_FAILED: "还不能读取已保存的进度，请重试读取；不会写入空档。",
  CORRUPT_SAVE: "保存内容需要恢复，原始文字已保留。",
  SAVE_REMOVED:
    "已保存的进度在另一处被移除，本页仍保留原记录，请先导出或明确恢复。",
  WRITE_FAILED: "本页保留了尚未保存的进度，请先导出，再重试保存。",
  LOCK_FAILED: "多页面保存保护暂不可用，已暂停写入。",
  PROFILE_CHANGED: "另一页恢复了不同档案，本页未保存进度已保留，请先导出。",
  STALE_REVISION: "已保存进度在确认前发生变化，请重新核对恢复内容。",
  RESTORE_WRITE_FAILED: "恢复未完成，原进度仍保留，请检查保存空间后重新确认。",
  PROGRESS_FULL:
    "本地去重记录已达到容量上限，本页新进度仍可导出；旧学习次数不会被清空。",
};

/**
 * Short Web Locks transactions protect independent online sessions. No network
 * data is stored here other than validated local learning/result summaries.
 * Supply ALL current answer-free question metadata before load(), across every
 * grade/course. A filtered curriculum list cannot validate the full archive.
 * No-lock browsers are single-page only; independent tabs are not atomic there.
 *
 * Normal backup UI must await exportLatest()/exportLegacyLatest() and use json
 * only when ok. The synchronous exports are explicitly emergency memory copies,
 * which may omit another tab's newer writes. Online record identity is id plus
 * youSeat; older v3 rows may omit youSeat and must be shown as an unknown seat.
 *
 * prepareImport and successful restore signal requiresSessionReset. The caller
 * must pause feedback application during confirmation/restore, then end the old
 * transient network session and clear its queued feedback after success. Schema
 * 1 additionally sets dropsOnlineReceipts: its aggregate counts cannot tell if a
 * later replay was already counted. Do not resume that old session into it.
 */
export class ProgressStore {
  constructor({
    storage,
    locks,
    questions = [],
    onChange = () => {},
    onIssue = () => {},
    now = () => Date.now(),
    random = () => Math.random(),
  } = {}) {
    if (storage === undefined) {
      try {
        storage = globalThis.localStorage;
      } catch {
        storage = null;
      }
    }
    if (typeof now !== "function" || typeof random !== "function") throw new TypeError("Invalid local clock or random source");
    this.now = now; this.random = random;
    this._challengeContext = new Map(); this._skinInflight = new Map();
    this.storage = storage;
    this.locks = locks === undefined ? globalThis.navigator?.locks : locks;
    this.singlePage = typeof this.locks?.request !== "function";
    this.onChange = onChange;
    this.onIssue = onIssue;
    this.questions = questions.map((q) => ({
      id: q.id,
      bank: bankFor(q.bank),
      grade: q.grade,
      ...(q.bank === TEACHER_BANK ? { category: q.category, semester: q.semester } : {}),
      ...(q.semester ? { semester: q.semester } : {}),
      ...(q.unitId ? { unitId: q.unitId } : {}),
      ...(q.bookId !== undefined ? { bookId: q.bookId } : {}),
    }));
    if (
      !this.questions.length ||
      this.questions.some(
        (q) =>
          typeof q.id !== "string" ||
          q.id.length > 80 ||
          Object.hasOwn(Object.prototype, q.id) ||
          q.id === "prototype" ||
          !validBank(q.bank) ||
          (q.bank === TEACHER_BANK
            ? q.grade !== null || q.semester !== null || q.category === "all" || !validTeacherCourse(q.category)
            : !integer(q.grade, 1, 6)),
      ) ||
      new Set(this.questions.map((q) => q.id)).size !== this.questions.length
    )
      fail("QUESTION_METADATA_REQUIRED");
    this.questionIds = new Set(this.questions.map((q) => q.id));
    this._data = null;
    this._pending = [];
    this._serial = Promise.resolve();
    this._prepared = new WeakMap();
    this.dirty = false;
    this.issue = null;
    this.recoveryRaw = "";
    this.recoveryKey = null;
    this.readPending = true;
    this.loaded = false;
    this._observed = null;
    this._bootstrap = null;
    this._hadPrimary = false;
  }
  get data() {
    return this._data ? clone(this._data) : null;
  }
  get revision() {
    return this._data?.revision ?? 0;
  }
  _result(ok, extra = {}) {
    return {
      ok,
      data: this.data,
      revision: this.revision,
      dirty: this.dirty,
      singlePage: this.singlePage,
      ...extra,
    };
  }
  _notify() {
    try {
      this.onChange(
        this.data,
        this._result(!this.issue, { issue: this.issue }),
      );
    } catch {
      /* A view error cannot change a committed transaction. */
    }
  }
  _problem(code, extra = {}) {
    this.issue = { code, message: ISSUE_TEXT[code] || code, ...extra };
    try {
      this.onIssue(clone(this.issue));
    } catch {}
    this._notify();
    return this._result(false, { code, issue: clone(this.issue) });
  }
  _enqueue(fn) {
    const task = this._serial.then(fn);
    this._serial = task.catch(() => {});
    return task;
  }
  async _locked(fn) {
    if (this.singlePage) return fn();
    let entered = false;
    try {
      const result = await this.locks.request(
        PROGRESS_LOCK,
        { mode: "exclusive" },
        async () => {
          entered = true;
          return fn();
        },
      );
      return entered ? result : this._problem("LOCK_FAILED");
    } catch (error) {
      if (entered) throw error;
      return this._problem("LOCK_FAILED");
    }
  }
  _decode(input) {
    return validateProgress(input, this.questions, this.questionIds);
  }
  _read() {
    let key = PROGRESS_KEY,
      raw;
    try {
      raw = this.storage.getItem(key);
      if (raw === null && this._hadPrimary) {
        this.recoveryRaw = this._observed?.raw || this.recoveryRaw;
        this._observed = { key: PROGRESS_KEY, raw: null };
        this.readPending = false;
        fail("SAVE_REMOVED");
      }
      if (raw !== null) this._hadPrimary = true;
      if (raw === null)
        for (const oldKey of OLD_KEYS) {
          key = oldKey;
          raw = this.storage.getItem(key);
          if (raw !== null) break;
        }
    } catch (error) {
      if (error.code === "SAVE_REMOVED") throw error;
      this.readPending = true;
      fail("READ_FAILED");
    }
    this.readPending = false;
    this._observed = { key, raw };
    if (raw === null) {
      this._observed = { key: PROGRESS_KEY, raw: null };
      const data = this._bootstrap
        ? clone(this._bootstrap)
        : blank(freshSave());
      data.profileId = "initial-v4-progress";
      data.journey.ownerId = data.profileId;
      return { key: PROGRESS_KEY, raw: null, data, initial: true };
    }
    try {
      const input = JSON.parse(raw);
      const modern = key === PROGRESS_KEY || key === "spellwood.save.v3";
      const data = modern ? this._decode(input) : blank(legacySave(input, this.questions), originId(raw));
      return { key, raw, data, initial: key !== PROGRESS_KEY || input.schema === 3 };
    } catch {
      this.recoveryRaw = raw;
      fail("CORRUPT_SAVE");
    }
  }
  _apply(data, op) {
    if (op.kind === "participation") {
      const receipt=data.learningReceipts[op.challengeId];
      // Local replay is bounded by journey history/cutoff. A repeated or old
      // receipt must never be reassigned to another reward day after reload.
      if (op.localReward && (data.journey.events.some(event => event.id === op.challengeId) ||
          receipt && receipt.answeredAt <= data.journey.eventCutoff)) return false;
      // Trusted adapters may pin the original challenge's Shanghai day. Keep
      // mastery/answer timestamps untouched; only the legacy reward reducer
      // sees this calendar anchor.
      if (op.localReward?.context && !op.localReward.event) return false;
      const rewardReceipt = receipt && op.issuedAt !== undefined ? { ...receipt, answeredAt: op.issuedAt } : receipt;
      // Foreground-only local observations follow the same cumulative budget
      // as server study: a quick answer may finish reading on feedback. Adapt
      // that validated budget to the unchanged original card-day reducer.
      const questionMs = integer(op.questionMs, 0, 7200000) && integer(op.feedbackMs, 1200, 7200000) &&
        op.questionMs + op.feedbackMs >= 3200 ? Math.max(2000, op.questionMs) : op.questionMs;
      const changed = qualifyDay(data.collection,rewardReceipt,{...op,questionMs,timeZone:op.issuedAt !== undefined ? "Asia/Shanghai" : data.timeZone});
      if (!op.localReward?.event) return changed;
      const event = op.localReward.event;
      if (!receipt || event.answeredAt !== receipt.answeredAt || event.qid !== receipt.qid) fail("INVALID_PARTICIPATION");
      return applyLocalReward(data, applyQualifiedLearning(data.journey, { ...event, ownerId: data.profileId })) || changed;
    }
    if (op.kind === "collection") return applyCollectionOperation(data.collection,op.action);
    if (op.kind === "skin") {
      const reducers = { open: reduceOpenSkinPack, reveal: reduceRevealSkinPack, close: reduceCloseSkinPack,
        redeem: reduceRedeemSkin, equip: reduceEquipSkin };
      const intent = op.intent;
      const opening = intent.kind === "open" ? data.journey.openings[intent.mode] : null;
      // Another page may have completed the same opening while this page was
      // saving. Keep its durable results and never debit a second time.
      if (opening && opening.id !== op.operationId && opening.count === intent.count) return false;
      return applyLocalReward(data, reducers[intent.kind](data.journey,
        { ...intent, ownerId: data.profileId, operationId: op.operationId, issuedAt: op.issuedAt },
        { officialDustBalance: data.collection.earned.dust, ...(op.randomValues ? { randomValues: op.randomValues } : {}) }));
    }
    if (op.kind === "preferences") {
      const { combatMode, customDeck, deckId, ...legacyPatch } = op.patch;
      const nextDeck = deckId === undefined ? data.chosenDeckId : deckId;
      const nextCustom = customDeck === undefined ? data.customDeck : customDeck;
      if (nextDeck === "custom" && !validateCustomDeck(nextCustom)) fail("INVALID_CUSTOM_DECK");
      Object.assign(data.legacy, legacyPatch);
      if (combatMode !== undefined) data.combatMode = combatMode;
      if (customDeck !== undefined) data.customDeck = clone(customDeck);
      if (deckId !== undefined) { data.chosenDeckId = deckId; if (deckId !== "custom") data.legacy.deckId = deckId; }
      return true;
    }
    if (op.kind === "learning") {
      const event = op.event,
        prior = data.learningReceipts[event.id];
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(event))
          fail("LEARNING_ID_CONFLICT");
        return false;
      }
      if (
        data.learningCutoff !== null &&
        event.answeredAt <= data.learningCutoff
      )
        return false;
      if (!Object.hasOwn(data.learningBase, event.qid))
        data.learningBase[event.qid] = data.legacy.mastery[event.qid]
          ? clone(data.legacy.mastery[event.qid])
          : null;
      data.learningReceipts[event.id] = clone(event);
      rebuildQuestion(data, event.qid);
      return true;
    }
    if (op.kind === "result") {
      const key = resultKey(op.record);
      if (data.resultIds.includes(key)) return false;
      // Early v3 stored a whole-room receipt. Once its visible row has been
      // pruned, there is no evidence from which to recover a personal seat.
      // Keep that archived receipt instead of promoting a replay into the
      // recent leaderboard under a newly expanded seat key.
      if (
        data.resultIds.includes(op.record.id) &&
        !data.onlineRecords.some(
          (r) => r.id === op.record.id && r.youSeat === undefined,
        )
      )
        return false;
      const legacyIndex = data.onlineRecords.findIndex(
        (r) =>
          r.id === op.record.id &&
          r.youSeat === undefined &&
          sameOldResult(r, op.record),
      );
      if (legacyIndex >= 0) {
        // Old v3 summaries lack a seat. A matching personal receipt can enrich
        // that row; a different seat's result must never be swallowed by it.
        const original = data.onlineRecords[legacyIndex];
        data.onlineRecords[legacyIndex] = {
          ...clone(op.record),
          date: original.date,
        };
        data.resultIds = data.resultIds.filter((id) => id !== op.record.id);
      } else {
        data.onlineRecords.push(clone(op.record));
        data.combatRating = recordCombatResult(data.combatRating, op.record);
        if (op.localMatch) applyLocalReward(data, applyQualifiedMatch(data.journey, { ...op.localMatch, ownerId: data.profileId }));
      }
      data.resultIds.push(key);
      data.onlineRecords.sort(
        (a, b) => a.date - b.date || resultKey(a).localeCompare(resultKey(b)),
      );
      data.onlineRecords = data.onlineRecords.slice(-200);
      return true;
    }
    fail("INVALID_OPERATION");
  }
  async _flush(exportKind = null) {
    return this._locked(async () => {
      let base;
      try {
        base = this._read();
      } catch (error) {
        return this._problem(error.code || "READ_FAILED");
      }
      if (
        this._pending.length &&
        this._data &&
        (base.data.profileId !== this._data.profileId ||
          base.data.revision < this._data.revision)
      )
        return this._problem("PROFILE_CHANGED");
      const candidate = clone(base.data);
      let changed = base.initial;
      let ignoredCount = 0;
      const rejected = new Map();
      try {
        for (const op of this._pending) {
          if (
            op.kind === "learning" &&
            candidate.learningCutoff !== null &&
            op.event.answeredAt <= candidate.learningCutoff &&
            !Object.hasOwn(candidate.learningReceipts, op.event.id)
          )
            ignoredCount++;
          try {
            changed = this._apply(candidate, op) || changed;
          } catch (error) {
            // A legal local intent can become unavailable after another page
            // commits. Drop only that failed intent, without poisoning future
            // saves or discarding unrelated learning and result operations.
            const businessConflict = ["INVALID_CUSTOM_DECK", "OPENING_PENDING", "NO_REWARD_PACK",
              "NOT_ENOUGH_DUST", "FINISH_NOT_COLLECTED", "PACK_NOT_REVEALED", "SKIN_PACK_PENDING", "SKIN_PACK_NOT_FOUND",
              "SKIN_NOT_OWNED", "INSUFFICIENT_SKIN_TICKETS", "INSUFFICIENT_OFFICIAL_DUST", "REWARD_HISTORY_EXPIRED"];
            if (["preferences", "collection", "skin"].includes(op.kind) && businessConflict.includes(error.code))
              rejected.set(op, error.code);
            else throw error;
          }
        }
        if (rejected.size) this._pending = this._pending.filter(op => !rejected.has(op));
        changed = compact(candidate) || changed;
      } catch (error) {
        return this._problem(error.code || "INVALID_PROGRESS");
      }
      if (changed) {
        candidate.revision = base.data.revision + 1;
        try {
          this.storage.setItem(PROGRESS_KEY, JSON.stringify(candidate));
        } catch {
          candidate.revision = base.data.revision;
          this._data = candidate;
          this.loaded = true;
          this.dirty = true;
          if (base.initial) this._bootstrap = clone(base.data);
          return this._problem("WRITE_FAILED");
        }
      }
      this._data = candidate;
      this._pending = [];
      this._bootstrap = null;
      this.loaded = true;
      this._hadPrimary = true;
      this.dirty = false;
      this.issue = null;
      if (candidate.recoveryKey) {
        this.recoveryKey = candidate.recoveryKey;
        try {
          this.recoveryRaw = this.storage.getItem(this.recoveryKey) || "";
        } catch {
          this.recoveryRaw = "";
        }
      }
      this._observed = {
        key: PROGRESS_KEY,
        raw: changed ? JSON.stringify(candidate) : base.raw,
      };
      this._notify();
      return this._result(rejected.size === 0, {
        changed,
        ...(rejected.size ? { code: rejected.values().next().value, discarded: true } : {}),
        ...(exportKind
          ? {
              json: JSON.stringify(
                exportKind === "legacy" ? candidate.legacy : candidate,
                null,
                2,
              ),
              scope: "latest-durable",
            }
          : {}),
        ...(ignoredCount
          ? { ignored: "outside-replay-window", ignoredCount }
          : {}),
      });
    });
  }
  load() {
    return this._enqueue(() => this._flush());
  }
  retry() {
    return this._enqueue(() => this._flush());
  }
  _mutation(op) {
    return this._enqueue(async () => {
      if (op.ownerId !== undefined && op.ownerId !== this._data?.profileId)
        return this._result(false, { code: "PROFILE_CHANGED" });
      if (
        !this.loaded ||
        !this._data ||
        this.readPending ||
        [
          "CORRUPT_SAVE",
          "SAVE_REMOVED",
          "PROGRESS_FULL",
          "PROFILE_CHANGED",
          "LOCK_FAILED",
        ].includes(this.issue?.code)
      )
        return this._result(false, { code: "PROGRESS_UNAVAILABLE" });
      const projected = clone(this._data);
      try {
        this._apply(projected, op);
      } catch (error) {
        return this._result(false, { code: error.code });
      }
      this._pending.push(op);
      this._data = projected;
      this.dirty = true;
      return this._flush();
    });
  }
  applyLearning(feedback) {
    try {
      return this._mutation({
        kind: "learning",
        event: learningEvent(feedback, this.questionIds),
      });
    } catch (error) {
      return Promise.resolve(this._result(false, { code: error.code }));
    }
  }
  addResult(snapshot) {
    try {
      const record = resultFromSnapshot(snapshot);
      return this._mutation({ kind: "result", record, ownerId: this._data?.profileId, localMatch: localMatch(record, snapshot.participation) });
    } catch (error) {
      return Promise.resolve(this._result(false, { code: error.code }));
    }
  }
  updatePreferences(patch) {
    try {
      return this._mutation({
        kind: "preferences",
        patch: preferencePatch(patch),
      });
    } catch (error) {
      return Promise.resolve(this._result(false, { code: error.code }));
    }
  }
  noteChallenge(challengeId, { source, issuedAt = this.now() } = {}) {
    if (!token(challengeId) || !["study", "match"].includes(source) || !date(issuedAt)) fail("INVALID_PARTICIPATION");
    if (!this.loaded || !this._data) return false;
    if (this._challengeContext.has(challengeId)) return true;
    for (const [id, entry] of this._challengeContext)
      if (entry.ownerId !== this._data.profileId || entry.qualifiedAt === null && this.now() - entry.issuedAt > 7200000)
        this._challengeContext.delete(id);
    if (this._challengeContext.size >= 512) fail("STUDY_BUSY");
    this._challengeContext.set(challengeId, { source, issuedAt, ownerId: this._data.profileId, qualifiedAt: null });
    return true;
  }
  qualifyLearning(challengeId, timing) {
    if (!token(challengeId)) return Promise.resolve(this._result(false,{code:"INVALID_LEARNING"}));
    const now = this.now(), receipt = this._data?.learningReceipts[challengeId], context = this._challengeContext.get(challengeId);
    const op = { kind: "participation", challengeId, ownerId: this._data?.profileId, questionMs: timing?.questionMs, feedbackMs: timing?.feedbackMs, now,
      localReward: { context: !!context && context.ownerId === this._data?.profileId } };
    try {
      if (receipt && context?.ownerId === this._data.profileId &&
          integer(timing?.questionMs, 0, 7200000) && integer(timing?.feedbackMs, 1200, 7200000) &&
          timing.questionMs + timing.feedbackMs >= 3200 && date(now) && receipt.answeredAt >= context.issuedAt &&
          now >= receipt.answeredAt + 1200 && now >= context.issuedAt + 3200 &&
          (context.qualifiedAt !== null || now - context.issuedAt <= 7200000)) {
        context.qualifiedAt ??= now;
        op.issuedAt = context.issuedAt; op.now = context.qualifiedAt;
        op.localReward.event = { eventId: challengeId, qid: receipt.qid,
          unitId: localRewardUnit(this.questions.find(question => question.id === receipt.qid)), source: context.source,
          issuedAt: context.issuedAt, answeredAt: receipt.answeredAt, qualifiedAt: context.qualifiedAt };
      }
      return this._mutation(op).then(result => {
        if (result.ok && op.localReward.event) this._challengeContext.delete(challengeId);
        return result;
      });
    } catch (error) { return Promise.resolve(this._result(false, { code: error.code || "INVALID_PARTICIPATION" })); }
  }
  skinAction(action) {
    let intent;
    try { intent = skinIntent(action); }
    catch (error) { return Promise.resolve(this._result(false, { code: error.code || "INVALID_SKIN_ACTION" })); }
    const key = JSON.stringify(intent);
    if (this._skinInflight.has(key)) return this._skinInflight.get(key);
    const pending = this._pending.find(op => op.kind === "skin" && JSON.stringify(op.intent) === key);
    if (this.dirty && !pending) return Promise.resolve(this._result(false, { code: "PROGRESS_UNSYNCED" }));
    let promise;
    try {
      const op = pending ?? { kind: "skin", intent, ownerId: this._data?.profileId, operationId: newId(), issuedAt: this.now(),
        ...(intent.kind === "open" ? { randomValues: Array.from({ length: intent.count }, () => this.random()) } : {}) };
      promise = pending ? this.retry() : this._mutation(op);
    } catch (error) { return Promise.resolve(this._result(false, { code: error.code || "INVALID_SKIN_ACTION" })); }
    this._skinInflight.set(key, promise);
    const release = () => { if (this._skinInflight.get(key) === promise) this._skinInflight.delete(key); };
    promise.then(release, release);
    return promise;
  }
  openSkinPack(mode = "test", count = 1) { return this.skinAction({ kind: "open", mode, count }); }
  revealSkinPack(mode, batchId, index = "all") { return this.skinAction({ kind: "reveal", mode, batchId, index }); }
  closeSkinPack(mode, batchId) { return this.skinAction({ kind: "close", mode, batchId }); }
  redeemSkin(mode, skinId) { return this.skinAction({ kind: "redeem", mode, skinId }); }
  equipSkin(mode, skinId) { return this.skinAction({ kind: "equip", mode, skinId }); }

  openPack(mode="test") {
    try { return this._mutation({kind:"collection",action:{kind:"open-pack",id:newId(),mode,createdAt:Date.now(),cards:generatePack()}}); }
    catch(error){return Promise.resolve(this._result(false,{code:error.code||"PACK_UNAVAILABLE"}));}
  }
  collectionAction(action) { return this._mutation({kind:"collection",action:clone(action)}); }
  prepareImport(input) {
    if (this.readPending || !this._observed) fail("READ_FAILED");
    if (
      typeof input === "string" &&
      input.length > PROGRESS_LIMITS.importCharacters
    )
      fail("IMPORT_TOO_LARGE");
    let parsed;
    try {
      parsed = typeof input === "string" ? JSON.parse(input) : clone(input);
    } catch {
      fail("INVALID_IMPORT");
    }
    const data =
      [3, 4].includes(parsed?.schema)
        ? this._decode(parsed)
        : blank(legacySave(parsed, this.questions));
    const prepared = Object.freeze({
      sourceSchema: parsed.schema,
      requiresSessionReset: true,
      dropsOnlineReceipts: parsed.schema === 1,
      revision: this.revision,
      preview: {
        nickname: data.legacy.nickname,
        grade: data.legacy.grade,
        legacyRecords: data.legacy.records.length,
        onlineRecords: data.onlineRecords.length,
        hasOfflineMatch: !!data.legacy.match,
        learningDays: data.collection.totalDays,
        collectionCopies: Object.values(data.collection.test.cards).reduce((a,b)=>a+b,0)+Object.values(data.collection.earned.cards).reduce((a,b)=>a+b,0),
        combatRating: data.combatRating.rating,
      },
    });
    this._prepared.set(prepared, {
      data,
      sourceSchema: parsed.schema,
      observed: clone(this._observed),
      revision: this.revision,
    });
    return prepared;
  }
  restore(prepared, expectedRevision) {
    return this._enqueue(() =>
      this._locked(async () => {
        const entry = this._prepared.get(prepared);
        if (
          !entry ||
          this.readPending ||
          !Number.isSafeInteger(expectedRevision) ||
          expectedRevision !== entry.revision
        )
          return this._result(false, { code: "INVALID_RESTORE_CONFIRMATION" });
        let base, currentRaw, currentKey;
        try {
          base = this._read();
          currentRaw = base.raw;
          currentKey = base.key;
        } catch (error) {
          if (!["CORRUPT_SAVE", "SAVE_REMOVED"].includes(error.code))
            return this._problem(error.code || "READ_FAILED");
          currentRaw = this._observed.raw;
          currentKey = this._observed.key;
        }
        const expected = entry.observed;
        if (
          currentRaw !== expected.raw ||
          currentKey !== expected.key ||
          (base && !base.initial && base.data.revision !== expectedRevision)
        )
          return this._problem("STALE_REVISION");
        const candidate = clone(entry.data);
        candidate.profileId = newId();
        candidate.journey.ownerId = candidate.profileId;
        candidate.revision = (base?.data.revision ?? this.revision) + 1;
        try {
          compact(candidate);
        } catch (error) {
          return this._problem(error.code);
        }
        const backupKey = `${PROGRESS_KEY}.recovery.${newId()}`;
        const unsavedRaw =
          this.dirty && this._data ? JSON.stringify(this._data) : null;
        const backupRaw = currentRaw ?? (this.recoveryRaw || unsavedRaw);
        if (backupRaw !== null) candidate.recoveryKey = backupKey;
        else delete candidate.recoveryKey;
        try {
          if (backupRaw !== null) this.storage.setItem(backupKey, backupRaw);
          if (unsavedRaw && unsavedRaw !== backupRaw)
            this.storage.setItem(backupKey + ".unsaved", unsavedRaw);
          this.storage.setItem(PROGRESS_KEY, JSON.stringify(candidate));
        } catch {
          return this._problem("RESTORE_WRITE_FAILED");
        }
        this._data = candidate;
        this._pending = [];
        this._challengeContext.clear();
        this._bootstrap = null;
        this.loaded = true;
        this._hadPrimary = true;
        this.dirty = false;
        this.issue = null;
        this.recoveryRaw = backupRaw || "";
        this.recoveryKey = backupRaw !== null ? backupKey : null;
        this._observed = { key: PROGRESS_KEY, raw: JSON.stringify(candidate) };
        this._prepared.delete(prepared);
        this._notify();
        return this._result(true, {
          changed: true,
          requiresSessionReset: true,
          dropsOnlineReceipts: entry.sourceSchema === 1,
        });
      }),
    );
  }
  /** Refresh/merge under the transaction lock; JSON is returned only on success. */
  exportLatest() {
    return this._enqueue(() => this._flush("complete"));
  }
  exportLegacyLatest() {
    return this._enqueue(() => this._flush("legacy"));
  }
  /** Emergency memory copy only: another page may have newer durable records. */
  export() {
    if (!this._data) fail("NO_PROGRESS_TO_EXPORT");
    return JSON.stringify(this._data, null, 2);
  }
  /** Old offline compatibility copy; online receipt IDs cannot fit schema 1. */
  exportLegacy() {
    if (!this._data) fail("NO_PROGRESS_TO_EXPORT");
    return JSON.stringify(this._data.legacy, null, 2);
  }
}

/** Safe public skin intents, shared by the HTTP boundary and its client.
 * Authority-bearing balances, result arrays, clocks and random draws are never
 * accepted in this shape. */
export function skinIntent(action) {
  const fields = {
    open: ["kind", "mode", "count"], reveal: ["kind", "mode", "batchId", "index"],
    close: ["kind", "mode", "batchId"], redeem: ["kind", "mode", "skinId"],
    equip: ["kind", "mode", "skinId"],
  };
  if (!plain(action) || !Object.hasOwn(fields, action.kind) ||
      Object.keys(action).some(key => !fields[action.kind].includes(key)) ||
      fields[action.kind].some(key => !Object.hasOwn(action, key))) fail("INVALID_SKIN_ACTION");
  const base = action.kind === "equip" && action.skinId === DEFAULT_HERO_SKIN;
  if (!(base ? action.mode === "base" : ["official", "test"].includes(action.mode))) fail("INVALID_SKIN_MODE");
  if (action.kind === "open" && ![1, 10].includes(action.count)) fail("INVALID_SKIN_PACK");
  if (["reveal", "close"].includes(action.kind) && !token(action.batchId)) fail("INVALID_SKIN_ACTION");
  if (action.kind === "reveal" && action.index !== "all" && !integer(action.index, 0, 9)) fail("INVALID_SKIN_REVEAL");
  if (["redeem", "equip"].includes(action.kind) && !base && !HERO_SKINS.some(skin => skin.id === action.skinId)) fail("INVALID_SKIN_ID");
  return select(action, fields[action.kind]);
}

/** Pure v4 model for the server adapter. No storage, network, locks, or pending
 * browser mutations are used. Each entry point validates the same intent as
 * ProgressStore; no generic trusted-operation entry point is exposed. */
export function createProgressModel({ questions = [] } = {}) {
  const metadata = new ProgressStore({ questions, storage: null, locks: null });
  const validate = (input) => validateProgress(input, metadata.questions, metadata.questionIds);
  const learning = (feedback) => learningEvent(feedback, metadata.questionIds);
  const result = (snapshot) => resultFromSnapshot(snapshot);
  const apply = (input, op) => {
    const data = validate(input);
    const changed = metadata._apply(data, op);
    const compacted = compact(data);
    if (changed || compacted) data.revision = input.revision + 1;
    return { data, changed: changed || compacted };
  };
  return Object.freeze({
    fresh(playerId, timeZone = "UTC") {
      if (!token(playerId)) fail("INVALID_PROGRESS");
      calendar(timeZone);
      const data = blank(freshSave(), playerId);
      data.timeZone = timeZone;
      return data;
    },
    validate,
    // Storage keys v1/v2 both hold schema:1. Unknown schema:2 is deliberately
    // rejected by the existing legacy validator rather than guessed at.
    importLegacy(input) {
      if (typeof input === "string" && input.length > PROGRESS_LIMITS.importCharacters)
        fail("IMPORT_TOO_LARGE");
      let parsed;
      try { parsed = typeof input === "string" ? JSON.parse(input) : clone(input); }
      catch { fail("INVALID_IMPORT"); }
      if (![1, 3, 4].includes(parsed?.schema)) fail("INVALID_IMPORT");
      return [3, 4].includes(parsed.schema) ? validate(parsed) : blank(legacySave(parsed, metadata.questions));
    },
    learning,
    result,
    preferencePatch,
    applyLearning(input, feedback) {
      return apply(input, { kind: "learning", event: learning(feedback) });
    },
    addResult(input, snapshot) {
      return apply(input, { kind: "result", record: result(snapshot) });
    },
    preferences(input, patch) {
      return apply(input, { kind: "preferences", patch: preferencePatch(patch) });
    },
    participation(input, challengeId, timing) {
      if (!token(challengeId)) fail("INVALID_LEARNING");
      return apply(input, { kind: "participation", challengeId,
        questionMs: timing?.questionMs, feedbackMs: timing?.feedbackMs, now: timing?.now,
        ...(timing?.issuedAt !== undefined ? { issuedAt: timing.issuedAt } : {}) });
    },
    collection(input, action) {
      return apply(input, { kind: "collection", action: clone(action) });
    },
  });
}
