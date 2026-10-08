import { rng, shuffle, scoreMatch } from "./engine.mjs";
import { SCHOOL_BANK, bankFor, validBank, validTeacherCourse } from "./question-banks.mjs";
import {
  RULES,
  CARD,
  DECKS,
  OPPONENTS,
  CONTENT_VERSION,
  LEGACY_CONTENT,
  validCourse,
  LEGACY_RULES,
  LEGACY_FINITE_RULES,
  LEGACY_OPENING_RULES,
  LEGACY_EXPANDED_RULES,
  isCardAvailable,
  hasOpening,
  hasFiniteRituals,
  RITUAL_LIMIT,
} from "./cards.mjs";
export const STORAGE_KEY = "spellwood.save.v2";
export const LEGACY_STORAGE_KEY = "spellwood.save.v1";
/** @returns {import("./types.js").SaveData} */
export function freshSave() {
  return {
    schema: 1,
    nickname: "Leaf",
    bank: SCHOOL_BANK,
    teacherCourse: "all",
    grade: 1,
    course: "s1",
    deckId: "grove",
    opponentId: "moss",
    sound: true,
    music: true,
    musicVolume: 35,
    soundVolume: 65,
    speech: true,
    reduced: false,
    mastery: {},
    archivedMastery: {},
    records: [],
    match: null,
  };
}
/** @param {import("./types.js").Match} match @param {import("./types.js").Question[]} questions */
export function questionFor(match, questions) {
  const list = shuffle(
    questions.filter(
      (q) => q.grade === match.grade && inCourse(q, match.course || "all"),
    ),
    rng(`${match.seed}:questions:${CONTENT_VERSION}:${match.course || "all"}`),
  );
  return list[match.questionIndex % list.length];
}
/** @param {import("./types.js").Question} q @param {string} course */
export function inCourse(q, course = "all") {
  return (
    course === "all" ||
    (course.length === 2
      ? q.semester === Number(course[1])
      : q.unitId === `g${q.grade}-${course}`)
  );
}
/** @param {import("./types.js").SaveData} save @param {import("./types.js").Question} q @param {boolean} correct @param {number} now */
export function recordLearning(save, q, correct, now = Date.now()) {
  const old = save.mastery[q.id] || {
    seen: 0,
    correct: 0,
    streak: 0,
    due: 0,
    last: 0,
  };
  const advance =
    old.seen === 0 ||
    new Date(old.last).toDateString() !== new Date(now).toDateString();
  const streak = correct ? old.streak + (advance ? 1 : 0) : 0;
  // A same-day correction does not earn another mastery stage, but should
  // leave the urgent review queue instead of alternating forever.
  const days = correct ? Math.max(1, [0, 1, 3, 7, 14][Math.min(streak, 4)]) : 0;
  save.mastery[q.id] = {
    seen: old.seen + 1,
    correct: old.correct + (correct ? 1 : 0),
    streak,
    due: now + days * 86400000,
    last: now,
  };
}
/** @param {import("./types.js").SaveData} save @param {import("./types.js").Match} s */
export function addRecord(save, s) {
  if (s.phase !== "finished" || save.records.some((r) => r.id === s.id))
    return false;
  save.records.push({
    id: s.id,
    nickname: save.nickname,
    grade: s.grade,
    seed: s.seed,
    deckId: s.deckId,
    opponentId: s.opponentId,
    rules: s.rules,
    contentVersion: s.contentVersion || LEGACY_CONTENT,
    course: s.course || "all",
    score: scoreMatch(s),
    correct: s.correct,
    attempts: s.attempts,
    turns: Math.ceil(s.turn / 2),
    result: s.winner === 0 ? "win" : s.winner === "draw" ? "draw" : "loss",
    date: Date.now(),
  });
  save.records = save.records.slice(-200);
  s.recorded = true;
  return true;
}
const plain = (x) => x && typeof x === "object" && !Array.isArray(x);
const int = (x, min, max) => Number.isInteger(x) && x >= min && x <= max;
export function validateMatch(s) {
  if (
    !plain(s) ||
    s.schema !== 1 ||
    ![RULES, LEGACY_EXPANDED_RULES, LEGACY_OPENING_RULES, LEGACY_FINITE_RULES, LEGACY_RULES].includes(
      s.rules,
    ) ||
    (s.contentVersion !== undefined &&
      ![CONTENT_VERSION, LEGACY_CONTENT, "legacy-mixed"].includes(
        s.contentVersion,
      )) ||
    (s.course !== undefined && !validCourse(s.course)) ||
    !int(s.grade, 1, 6) ||
    typeof s.id !== "string" ||
    s.id.length > 80 ||
    typeof s.seed !== "string" ||
    s.seed.length > 24 ||
    !DECKS.some((d) => d.id === s.deckId) ||
    !OPPONENTS.some((o) => o.id === s.opponentId) ||
    !["playing", "finished"].includes(s.phase) ||
    !int(s.active, 0, 1) ||
    !int(s.turn, 1, 2000) ||
    !int(s.seq, 0, 20000) ||
    !Array.isArray(s.players) ||
    s.players.length !== 2
  )
    return false;
  const currentRules = s.rules === RULES;
  if (currentRules ? !Number.isSafeInteger(s.handSeq) || s.handSeq < 0 : s.handSeq !== undefined)
    return false;
  const handIds = new Set();
  for (const [side, p] of s.players.entries()) {
    if (
      !plain(p) ||
      !int(p.hp, -1000, 18) ||
      !int(p.armor, 0, 2000) ||
      !int(p.mana, 0, 6) ||
      !int(p.maxMana, 0, 6) ||
      p.mana > p.maxMana ||
      !int(p.fatigue, 0, 1000) ||
      typeof p.ritualUsed !== "boolean" ||
      (hasFiniteRituals(s.rules) && !int(p.ritualsLeft, 0, RITUAL_LIMIT)) ||
      !Array.isArray(p.hand) ||
      p.hand.length > 7 ||
      !Array.isArray(p.deck) ||
      p.deck.length > 20 ||
      ![...p.hand, ...p.deck].every(
        (id) => typeof id === "string" && isCardAvailable(id, s.rules),
      ) ||
      !Array.isArray(p.board) ||
      p.board.length > 4
    )
      return false;
    if (currentRules) {
      if (!Array.isArray(p.handIds) || p.handIds.length !== p.hand.length ||
          p.handIds.some((id) => typeof id !== "string" || !/^h[1-9][0-9]*$/.test(id) ||
            !Number.isSafeInteger(Number(id.slice(1))) || Number(id.slice(1)) > s.handSeq ||
            handIds.has(id))) return false;
      for (const id of p.handIds) {
        if (handIds.has(id)) return false;
        handIds.add(id);
      }
      if (p.handBoosts !== undefined && (!plain(p.handBoosts) ||
          Object.entries(p.handBoosts).some(([id, boost]) =>
            !p.handIds.includes(id) || !plain(boost) || boost.amount !== 1 ||
            boost.turn !== s.turn || side !== s.active ||
            Object.keys(boost).some((key) => !["amount", "turn"].includes(key))))) return false;
    } else if (p.handIds !== undefined || p.handBoosts !== undefined) return false;
    for (const u of p.board) {
      if (
        !plain(u) ||
        typeof u.cardId !== "string" ||
        !isCardAvailable(u.cardId, s.rules) ||
        CARD[u.cardId].type === "spell" ||
        typeof u.uid !== "string" ||
        !/^u[1-9][0-9]{0,5}$/.test(u.uid) ||
        Number(u.uid.slice(1)) > s.seq ||
        !int(u.atk, 0, 2000) ||
        !int(u.hp, 1, 100) ||
        !int(u.maxHp, 1, 100) ||
        u.hp > u.maxHp ||
        typeof u.ready !== "boolean" ||
        (u.shield !== undefined && typeof u.shield !== "boolean") ||
        (u.kingfisherDrawTurn !== undefined && (!currentRules || u.cardId !== "storm_kingfisher" ||
          !int(u.kingfisherDrawTurn, 1, s.turn)))
      )
        return false;
    }
  }
  if (
    new Set(s.players.flatMap((p) => p.board.map((u) => u.uid))).size !==
    s.players.reduce((n, p) => n + p.board.length, 0)
  )
    return false;
  if ((s.phase === "playing") !== (s.winner === null)) return false;
  const expectedWinner =
    s.players[0].hp <= 0
      ? s.players[1].hp <= 0
        ? "draw"
        : 1
      : s.players[1].hp <= 0
        ? 0
        : null;
  if (s.winner !== expectedWinner) return false;
  if (hasOpening(s.rules)) {
    const choice = (x) =>
      Array.isArray(x) &&
      x.length <= 2 &&
      new Set(x).size === x.length &&
      x.every((i) => int(i, 0, 3));
    if (
      !plain(s.opening) ||
      !choice(s.opening.opponent) ||
      (s.opening.player !== null && !choice(s.opening.player))
    )
      return false;
    if (
      s.opening.player === null &&
      (s.phase !== "playing" ||
        s.turn !== 1 ||
        s.active !== 0 ||
        s.seq !== 0 ||
        s.attempts !== 0 ||
        s.questionIndex !== 0 ||
        s.review?.length !== 0 ||
        s.players.some(
          (p, side) =>
            p.hand.length !== 4 ||
            p.deck.length !== 16 ||
            p.board.length !== 0 ||
            p.hp !== 18 ||
            p.armor !== 0 ||
            p.fatigue !== 0 ||
            p.mana !== (side ? 0 : 1) ||
            p.maxMana !== p.mana ||
            p.ritualUsed ||
            p.ritualsLeft !== 4,
        ))
    )
      return false;
  }
  if (
    ![null, 0, 1, "draw"].includes(s.winner) ||
    !int(s.correct, 0, 2000) ||
    !int(s.attempts, 0, 2000) ||
    s.correct > s.attempts ||
    !int(s.questionIndex, 0, 2000) ||
    !Array.isArray(s.review) ||
    s.review.some((x) => typeof x !== "string") ||
    (s.archivedReview !== undefined &&
      (!Array.isArray(s.archivedReview) ||
        s.archivedReview.length > 432 ||
        s.archivedReview.some((id) => !/^g[1-6]-[vsc][0-9]{2}$/.test(id)))) ||
    !Array.isArray(s.log) ||
    s.log.some((x) => typeof x !== "string" || x.length > 200)
  )
    return false;
  return true;
}
/** @param {any} input @param {import("./types.js").Question[]} questions @returns {import("./types.js").SaveData} */
export function validateSave(input, questions = []) {
  if (!plain(input) || input.schema !== 1)
    throw Error("这不是词灵对决支持的存档版本");
  const clean = freshSave();
  if (typeof input.nickname !== "string" || input.nickname.length > 16)
    throw Error("昵称不符合存档格式");
  clean.nickname = input.nickname.trim() || "Leaf";
  const bank = bankFor(input.bank);
  if (!validBank(bank) || (input.teacherCourse !== undefined && !validTeacherCourse(input.teacherCourse)))
    throw Error("题库或教师分类格式有误");
  clean.bank = bank;
  clean.teacherCourse = input.teacherCourse ?? "all";
  if (
    !int(input.grade, 1, 6) ||
    !DECKS.some((d) => d.id === input.deckId) ||
    !OPPONENTS.some((o) => o.id === input.opponentId)
  )
    throw Error("年级或套牌数据不完整");
  for (const k of ["grade", "deckId", "opponentId"]) clean[k] = input[k];
  clean.course = validCourse(input.course) ? input.course : "all";
  for (const k of ["sound", "speech", "reduced"]) clean[k] = !!input[k];
  clean.music = typeof input.music === "boolean" ? input.music : true;
  if (typeof input.music !== "boolean") clean.sound = true;
  clean.musicVolume = int(input.musicVolume, 0, 100) ? input.musicVolume : 35;
  clean.soundVolume = int(input.soundVolume, 0, 100) ? input.soundVolume : 65;
  if (!plain(input.mastery) || Object.keys(input.mastery).length > 1000)
    throw Error("学习记录格式有误");
  const ids = new Set(questions.map((q) => q.id));
  if (
    input.archivedMastery !== undefined &&
    (!plain(input.archivedMastery) ||
      Object.keys(input.archivedMastery).length > 432)
  )
    throw Error("旧题学习档案格式有误");
  for (const [id, m] of Object.entries({
    ...input.archivedMastery,
    ...input.mastery,
  })) {
    if (
      ["__proto__", "prototype", "constructor"].includes(id) ||
      id.length > 80
    )
      continue;
    const active = !questions.length || ids.has(id);
    const legacy = /^g[1-6]-[vsc](0[1-9]|[12][0-9]|3[0-6])$/.test(id);
    if (!active && !legacy) continue;
    if (
      !plain(m) ||
      !int(m.seen, 0, 100000) ||
      !int(m.correct, 0, m.seen) ||
      !int(m.streak, 0, m.correct) ||
      !Number.isFinite(m.due) ||
      !Number.isFinite(m.last)
    )
      throw Error("学习记录格式有误");
    (active ? clean.mastery : clean.archivedMastery)[id] = {
      seen: m.seen,
      correct: m.correct,
      streak: m.streak,
      due: m.due,
      last: m.last,
    };
  }
  if (!Array.isArray(input.records) || input.records.length > 200)
    throw Error("挑战记录格式有误");
  const seenIds = new Set();
  for (const r of input.records) {
    if (
      !plain(r) ||
      typeof r.id !== "string" ||
      r.id.length > 80 ||
      seenIds.has(r.id) ||
      typeof r.nickname !== "string" ||
      r.nickname.length > 16 ||
      !int(r.grade, 1, 6) ||
      typeof r.rules !== "string" ||
      (r.contentVersion !== undefined &&
        ![CONTENT_VERSION, LEGACY_CONTENT, "legacy-mixed"].includes(
          r.contentVersion,
        )) ||
      (r.course !== undefined && !validCourse(r.course)) ||
      typeof r.seed !== "string" ||
      r.seed.length > 24 ||
      !DECKS.some((d) => d.id === r.deckId) ||
      !OPPONENTS.some((o) => o.id === r.opponentId) ||
      !int(r.score, 0, 200000) ||
      !int(r.attempts, 0, 2000) ||
      !int(r.correct, 0, r.attempts) ||
      !int(r.turns, 1, 2000) ||
      !["win", "loss", "draw"].includes(r.result) ||
      !Number.isFinite(r.date)
    )
      throw Error("挑战记录格式有误");
    seenIds.add(r.id);
    clean.records.push({
      id: r.id,
      nickname: r.nickname,
      grade: r.grade,
      seed: r.seed,
      deckId: r.deckId,
      opponentId: r.opponentId,
      rules: r.rules,
      contentVersion: r.contentVersion || LEGACY_CONTENT,
      course: r.course || "all",
      score: r.score,
      correct: r.correct,
      attempts: r.attempts,
      turns: r.turns,
      result: r.result,
      date: r.date,
    });
  }
  if (input.match !== null && input.match !== undefined) {
    if (
      !validateMatch(input.match) ||
      input.match.review.some(
        (id) =>
          questions.length &&
          !ids.has(id) &&
          !/^g[1-6]-[vsc][0-9]{2}$/.test(id),
      )
    )
      throw Error("进行中的对局已损坏");
    clean.match = structuredClone(input.match);
    if (!clean.match.contentVersion)
      clean.match.contentVersion =
        clean.match.phase === "playing" ? "legacy-mixed" : LEGACY_CONTENT;
    clean.match.course ||= "all";
    clean.match.archivedReview = [
      ...new Set([
        ...(clean.match.archivedReview || []),
        ...clean.match.review.filter((id) => questions.length && !ids.has(id)),
      ]),
    ];
    clean.match.review = clean.match.review.filter(
      (id) => !questions.length || ids.has(id),
    );
    clean.match.pending = null;
  }
  return clean;
}
/** @param {import("./types.js").SaveData} save @param {import("./types.js").Question[]} questions @param {number} grade @param {string} course */
export function masterySummary(save, questions, grade, course = "all") {
  const list = questions.filter(
      (q) => q.grade === grade && inCourse(q, course),
    ),
    seen = list.filter((q) => save.mastery[q.id]?.seen),
    learned = seen.filter((q) => save.mastery[q.id]?.streak >= 3),
    due = seen.filter((q) => save.mastery[q.id].due <= Date.now());
  return {
    total: list.length,
    seen: seen.length,
    learned: learned.length,
    due: due.length,
  };
}
