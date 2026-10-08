import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createQuestionService } from "../server/questions.mjs";
import { payload, versions } from "../server/protocol.mjs";
import { GameService } from "../server/service.mjs";
import { createProgressBridge } from "../server/progress-bridge.mjs";
import { createIdentityStore } from "../server/identity-store.mjs";
import { createPlayerProgress } from "../server/player-progress.mjs";
import { ProgressStore, PROGRESS_KEY, createProgressModel } from "../src/network/progress.mjs";
import { freshSave, validateSave } from "../src/learning.mjs";
import { TEACHER_BANK, SCHOOL_BANK, TEACHER_CATEGORIES } from "../src/question-banks.mjs";
import { RITUAL_LIMIT } from "../src/cards.mjs";

const schoolQuestions = JSON.parse(readFileSync(new URL("../src/questions.json", import.meta.url)));
const teacherQuestions = TEACHER_CATEGORIES.map(({ id }, index) => ({
  id: `teacher-test-${id}`, bank: TEACHER_BANK, grade: null, semester: null,
  category: id, unitId: `teacher-${id}`, topic: id, type: index === 3 ? "cloze" : "sentence",
  prompt: "Select the supported answer", text: "The visible question concerns research design.",
  ...(index === 3 ? { passage: "The study reports an association but does not establish causation." } : {}),
  options: ["A cautious interpretation", "An unsupported interpretation"], answer: 0,
  explanation: `private-explanation-${id}`, speak: `private-speech-${id}`, target: `private-target-${id}`,
}));
const questionService = () => createQuestionService({ questions: schoolQuestions, teacherQuestions, speechAssets: {} });
const options = (bank = TEACHER_BANK, course = "reading") => ({ bank, grade: bank === TEACHER_BANK ? null : 1, course, deckId: "grove" });
const queue = (data) => payload({ type: "queue.join", payload: data });
const code = (callback, expected) => assert.throws(callback, (error) => error.code === expected);
const when = Date.UTC(2026, 9, 8, 6);
const result = (id = "teacher-result-0001", extra = {}) => ({
  roomId: id, phase: "finished", youSeat: 0, ...options(), ...versions,
  mode: "pve", assisted: false, serverTime: when, self: { deckId: "grove" },
  computer: { level: "standard", mode: "standard" },
  result: { winnerSeat: 0, reason: "health", ownScore: 750, ownLearning: { attempts: 1, correct: 1 }, rounds: 4, finishedAt: when },
  ...extra,
});
const feedback = (id, qid = teacherQuestions[0].id) => ({ challengeId: id, learning: { qid, correct: true, answeredAt: when } });
function memoryStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return { getItem: (id) => entries.get(id) ?? null, setItem: (id, value) => entries.set(id, value) };
}
function game(t, config = {}) {
  const service = new GameService({ questions: questionService(), send: (ws, message) => ws?.messages.push(message), config });
  t.after(() => service.close());
  const session = () => {
    const ws = { readyState: 1, messages: [], close() {} };
    return service.makeSession(ws);
  };
  return { service, session };
}

test("production catalogue adds 48 teacher questions without changing any school scope", () => {
  const service = createQuestionService();
  const metadata = service.metadata();
  assert.equal(metadata.questions.length, 480);
  assert.equal(metadata.questions.filter((q) => q.bank === SCHOOL_BANK).length, 432);
  const teacher = metadata.questions.filter((q) => q.bank === TEACHER_BANK);
  assert.equal(new Set(teacher.map((q) => q.displayLabel)).size, 48);
  assert(teacher.every((q) => q.displayLabel.includes(q.topic) && / (0[1-9]|1[0-2]) · /.test(q.displayLabel)));
  assert.equal(new Set(metadata.questions.map((q) => q.id)).size, 480);
  for (let grade = 1; grade <= 6; grade++) {
    assert.equal(service.createDeck({ grade }).length, 72);
    for (const semester of [1, 2]) {
      assert.equal(service.createDeck({ grade, course: `s${semester}` }).length, 36);
      for (let unit = 1; unit <= 6; unit++) {
        const deck = service.createDeck({ grade, course: `s${semester}-u${unit}` });
        assert.equal(deck.length, 6);
        assert(deck.every((q) => q.bank === SCHOOL_BANK && q.grade === grade && q.unitId === `g${grade}-s${semester}-u${unit}`));
      }
    }
  }
  assert.equal(service.createDeck({ bank: TEACHER_BANK, grade: null }).length, 48);
  for (const { id } of TEACHER_CATEGORIES) {
    const deck = service.createDeck({ bank: TEACHER_BANK, grade: null, course: id });
    assert.equal(deck.length, 12);
    assert(deck.every((q) => q.grade === null && q.semester === null && q.category === id));
  }
});

test("queue and private authority reject unknown banks and wrong grade/course scope", () => {
  assert.equal(queue({ grade: 1, course: "s1", deckId: "grove" }).bank, SCHOOL_BANK);
  const service = questionService();
  for (const candidate of [
    options("unknown", "all"), { ...options(), bank: null }, { ...options(), grade: 7 },
    { ...options(), grade: 1 }, { ...options(), grade: undefined }, { ...options(), course: "s1" },
    { ...options(), course: "unknown" }, options(SCHOOL_BANK, "reading"),
    { ...options(SCHOOL_BANK, "all"), grade: null },
  ]) {
    code(() => queue(candidate), "INVALID_MATCH_OPTIONS");
    assert.throws(() => service.createDeck(candidate));
  }
  for (const { id } of TEACHER_CATEGORIES) assert.equal(queue(options(TEACHER_BANK, id)).grade, null);
  const empty = createQuestionService({ questions: [schoolQuestions[0]], teacherQuestions: [] });
  code(() => empty.createDeck({ bank: TEACHER_BANK, grade: null, course: "all" }), "NO_QUESTIONS");
  assert.equal(empty.metadata().questions.length, 1);
  code(() => createQuestionService({ questions: [schoolQuestions[0]], teacherQuestions: [{ ...teacherQuestions[0], id: schoolQuestions[0].id }] }), "INVALID_QUESTION_BANK");
});

test("teacher challenges expose passage/category and only reveal feedback after grading", () => {
  const service = questionService();
  const challenge = service.issue({ deck: service.createDeck(options()), cursor: 0, kind: "insight", target: "hero", expiresAt: when + 10000 });
  const visible = service.toPublic(challenge);
  assert.equal(visible.question.bank, TEACHER_BANK);
  assert.equal(visible.question.grade, null);
  assert.equal(visible.question.category, "reading");
  assert.equal(visible.question.passage, teacherQuestions[3].passage);
  assert(visible.question.listenText.includes(teacherQuestions[3].passage));
  assert.equal(visible.question.listenAudioUrl, null);
  assert.equal(visible.question.visual, null);
  for (const hidden of ["answer", "correctOptionId", "questionId", "explanation", "speak", "target", "source"])
    assert.equal(Object.hasOwn(visible.question, hidden), false, hidden);
  const wire = JSON.stringify(visible);
  for (const hidden of [teacherQuestions[3].id, teacherQuestions[3].explanation, teacherQuestions[3].speak, teacherQuestions[3].target]) assert(!wire.includes(hidden));
  const graded = service.answer(challenge, challenge.correctOptionId, when);
  assert.equal(graded.learning.qid, teacherQuestions[3].id);
  assert.equal(graded.outcome, "correct");
  assert.equal(graded.audioUrl, null);
  const study = service.issueStudy({ qid: teacherQuestions[3].id, expiresAt: when + 1000 });
  assert.equal(service.toPublic(study).question.category, "reading");
  for (const q of service.metadata().questions) for (const key of ["answer", "options", "explanation", "speak", "passage"]) assert(!Object.hasOwn(q, key));
});

test("teacher rooms match only their own bank/category and preserve battle limits", (t) => {
  const { service, session } = game(t, { queueMs: 10000 });
  const school = session(), otherCategory = session(), a = session(), b = session();
  service.join(school, queue(options(SCHOOL_BANK, "all")));
  service.join(otherCategory, queue(options(TEACHER_BANK, "grammar")));
  service.join(a, queue(options()));
  service.join(b, queue(options()));
  assert.equal(a.roomId, b.roomId);
  assert.equal(school.roomId, null);
  assert.equal(otherCategory.roomId, null);
  const room = service.rooms.get(a.roomId);
  const view = service.view(room, 0);
  assert.equal(view.bank, TEACHER_BANK);
  assert.equal(view.grade, null);
  assert.equal(view.course, "reading");
  assert.equal(view.mode, "pvp");
  assert.equal(view.self.hand.length, 4);
  assert.equal(view.self.deckCount, 16);
  assert.equal(view.self.ritualsLeft, RITUAL_LIMIT);
  for (const seat of room.seats) assert(seat.questionDeck.every((q) => q.bank === TEACHER_BANK && q.category === "reading"));
  service.finish(room, 0, "health");
  assert.equal(service.resultFor(room, 0).bank, TEACHER_BANK);
  assert.equal(service.view(room, 0).grade, null);
});

test("teacher queue AI fallback stays in its teacher scope", async (t) => {
  const { service, session } = game(t, { queueMs: 10, openingMs: 10000 });
  const player = session();
  service.join(player, queue(options(TEACHER_BANK, "syntax")));
  assert.equal(player.ws.messages.at(-1).bank, TEACHER_BANK);
  await new Promise((resolve) => setTimeout(resolve, 35));
  const room = service.rooms.get(player.roomId);
  assert(room);
  assert.equal(room.mode, "pve");
  assert.equal(room.grade, null);
  assert.equal(room.bank, TEACHER_BANK);
  assert.equal(room.course, "syntax");
  assert(room.seats.some((seat) => seat.controller === "bot"));
  assert(room.seats.every((seat) => seat.questionDeck.every((q) => q.category === "syntax")));
});

test("teacher preferences, question mastery, receipts, and result survive save reload and import", async () => {
  const questions = questionService().metadata().questions;
  const storage = memoryStorage();
  const store = new ProgressStore({ questions, storage, locks: null });
  assert((await store.load()).ok);
  assert((await store.updatePreferences({ grade: 6, course: "s2-u5", bank: TEACHER_BANK, teacherCourse: "reading" })).ok);
  const event = feedback("teacher-learning-0001");
  assert((await store.applyLearning(event)).ok);
  assert((await store.applyLearning(event)).ok);
  assert((await store.addResult(result())).ok);
  assert((await store.addResult(result())).ok);
  const exported = await store.exportLatest();
  assert(exported.ok);
  const next = new ProgressStore({ questions, storage, locks: null });
  assert((await next.load()).ok);
  assert.equal(next.data.legacy.mastery[event.learning.qid].seen, 1);
  assert.equal(Object.keys(next.data.learningReceipts).length, 1);
  assert.equal(next.data.onlineRecords.length, 1);
  assert.equal(next.data.onlineRecords[0].bank, TEACHER_BANK);
  assert.equal(next.data.onlineRecords[0].grade, null);
  assert.equal(next.data.legacy.grade, 6);
  assert.equal(next.data.legacy.course, "s2-u5");
  assert.equal(next.data.legacy.teacherCourse, "reading");
  assert.equal(next.data.legacy.bank, TEACHER_BANK);
  assert.deepEqual(createProgressModel({ questions }).importLegacy(exported.json), next.data);
  const destination = new ProgressStore({ questions, storage: memoryStorage(), locks: null });
  assert((await destination.load()).ok);
  const prepared = destination.prepareImport(exported.json);
  assert.equal(prepared.sourceSchema, 4);
  assert((await destination.restore(prepared, destination.revision)).ok);
  assert.deepEqual(destination.data.legacy.mastery, next.data.legacy.mastery);
  assert.equal(destination.data.onlineRecords[0].bank, TEACHER_BANK);
  assert((await destination.updatePreferences({ bank: SCHOOL_BANK })).ok);
  assert.equal(destination.data.legacy.grade, 6);
  assert.equal(destination.data.legacy.course, "s2-u5");
});

test("old v3 without bank migrates as school and rejects invented bank/result scopes", async () => {
  const questions = questionService().metadata().questions, model = createProgressModel({ questions });
  let data = model.fresh("old-school-player", "UTC");
  data = model.addResult(data, result("old-school-result", options(SCHOOL_BANK, "s1"))).data;
  delete data.legacy.bank;
  delete data.legacy.teacherCourse;
  delete data.onlineRecords[0].bank;
  data.schema = 3;
  delete data.journey;
  const old = new ProgressStore({ questions, storage: memoryStorage({ "spellwood.save.v3": JSON.stringify(data) }), locks: null });
  assert((await old.load()).ok);
  assert.equal(old.data.legacy.bank, SCHOOL_BANK);
  assert.equal(old.data.legacy.teacherCourse, "all");
  assert.equal(old.data.onlineRecords[0].bank, SCHOOL_BANK);
  assert.equal(model.addResult(old.data, result("old-school-result", options(SCHOOL_BANK, "s1"))).changed, false);
  for (const bank of ["unknown", null, 7]) code(() => model.preferencePatch({ bank }), "INVALID_PREFERENCES");
  code(() => model.preferencePatch({ teacherCourse: "s1" }), "INVALID_PREFERENCES");
  assert.throws(() => validateSave({ ...freshSave(), bank: "unknown" }, questions));
  for (const extra of [{ bank: "unknown" }, { grade: 7 }, { grade: 1 }, { course: "s1" }])
    code(() => model.result(result("invalid-result-01", extra)), "INVALID_RESULT");
  code(() => new ProgressStore({ questions: [...questions, questions[0]] }), "QUESTION_METADATA_REQUIRED");
});

test("old committed school result receipt replays, while changing its bank conflicts", (t) => {
  const questions = questionService().metadata().questions, model = createProgressModel({ questions });
  const identityStore = createIdentityStore();
  t.after(() => identityStore.close());
  const progress = createPlayerProgress({ identityStore, questions, now: () => when });
  const playerId = identityStore.createGuest().player.playerId;
  const initial = progress.ensure(playerId);
  const school = result("old-school-receipt", options(SCHOOL_BANK, "all"));
  const record = model.result(school);
  delete record.bank;
  const oldData = model.addResult(initial.progress, school).data;
  delete oldData.onlineRecords[0].bank;
  delete oldData.legacy.bank;
  delete oldData.legacy.teacherCourse;
  identityStore.commitPlayerEvent(playerId, { eventId: `result:${record.id}:0`, type: "result", payload: record,
    expectedRevision: initial.revision, progress: oldData, receipt: { changed: true } });
  const replay = progress.addResult(playerId, school);
  assert.equal(replay.duplicate, true);
  assert.equal(progress.ensure(playerId).progress.onlineRecords.length, 1);
  code(() => progress.addResult(playerId, result("old-school-receipt", { course: "all" })), "PLAYER_EVENT_CONFLICT");
  const teacher = result("teacher-ledger-result");
  assert.equal(progress.addResult(playerId, teacher).duplicate, false);
  assert.equal(progress.addResult(playerId, teacher).duplicate, true);
  code(() => progress.addResult(playerId, result("teacher-ledger-result", options(SCHOOL_BANK, "all"))), "PLAYER_EVENT_CONFLICT");
  const event = feedback("teacher-ledger-learning");
  progress.applyLearning(playerId, event);
  assert.equal(progress.applyLearning(playerId, event).duplicate, true);
  assert.equal(progress.ensure(playerId).progress.legacy.mastery[event.learning.qid].seen, 1);
});

test("progress bridge retains teacher bank through a deferred result retry", () => {
  let available = false, received;
  const bridge = createProgressBridge({ identityStore: {}, progress: {
    ensure: () => ({}), addResult: (_playerId, snapshot) => { if (!available) throw Error("unavailable"); received = snapshot; },
  } });
  assert.equal(bridge.result("teacher-player", result()), false);
  assert.equal(bridge.pendingCount, 1);
  available = true;
  bridge.ensureSynced("teacher-player");
  assert.equal(received.bank, TEACHER_BANK);
  assert.equal(received.grade, null);
  assert.equal(received.result.ownScore, 750);
  assert.equal(bridge.pendingCount, 0);
});

test("teacher and school learning share one reward day and one combat rating", () => {
  const questions = questionService().metadata().questions;
  const model = createProgressModel({ questions });
  let data = model.fresh("shared-reward-player", "UTC");
  const qids = [...teacherQuestions.map((q) => q.id), ...schoolQuestions.slice(0, 2).map((q) => q.id)];
  qids.forEach((qid, index) => {
    const event = feedback(`shared-learning-${index}`, qid);
    data = model.applyLearning(data, event).data;
    data = model.participation(data, event.challengeId, { questionMs: 2000, feedbackMs: 1200, now: when + 1200 }).data;
  });
  assert.equal(data.collection.totalDays, 1);
  assert.equal(Object.keys(data.collection.days).length, 1);
  assert.equal(Object.values(data.collection.days)[0].qids.length, 6);
  const collection = structuredClone(data.collection);
  data = model.preferences(data, { bank: TEACHER_BANK, teacherCourse: "grammar" }).data;
  data = model.preferences(data, { bank: SCHOOL_BANK }).data;
  assert.deepEqual(data.collection, collection);
  data = model.addResult(data, result("shared-teacher-result")).data;
  data = model.addResult(data, result("shared-school-result", options(SCHOOL_BANK, "all"))).data;
  assert.equal(data.combatRating.games, 2);
  assert.deepEqual(data.collection, collection);
  assert.equal(Object.keys(data.legacy.mastery).length, 6);
});

test('short feedback is nonqualifying navigation; later eligible participation still commits once',t=>{
 const identityStore=createIdentityStore();t.after(()=>identityStore.close());
 let clock=when;
 const progress=createPlayerProgress({identityStore,questions:questionService().metadata().questions,now:()=>clock});
 const playerId=identityStore.createGuest().player.playerId;
 const bridge=createProgressBridge({identityStore,progress,now:()=>clock});
 const challengeId='brief-feedback-question';
 bridge.noteChallenge(playerId,challengeId,clock);
 clock+=2100;
 bridge.learning(playerId,{challengeId,learning:{qid:teacherQuestions[0].id,correct:false,answeredAt:clock}});
 clock+=10;
 const early=bridge.participation(playerId,challengeId);
 assert.deepEqual(early.receipt,{changed:false,qualified:false});
 assert.equal(identityStore.hasPlayerEvent(playerId,'participation:'+challengeId),false);
 assert.equal(early.player.progress.legacy.mastery[teacherQuestions[0].id].seen,1);
 assert.equal(early.player.progress.collection.totalDays,0);
 clock+=1190;
 assert.equal(bridge.participation(playerId,challengeId).duplicate,false);
 assert.equal(identityStore.hasPlayerEvent(playerId,'participation:'+challengeId),true);
 assert.equal(bridge.participation(playerId,challengeId).duplicate,true);
 assert.equal(progress.ensure(playerId).progress.legacy.mastery[teacherQuestions[0].id].seen,1);
 code(()=>bridge.participation(playerId,'unknown-challenge-id'),'INVALID_PARTICIPATION');
});
