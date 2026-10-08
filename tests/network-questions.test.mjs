import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createQuestionService } from "../server/questions.mjs";
import { PICTURE_SHEETS } from "../src/learning-visuals.mjs";

const BANK = JSON.parse(
  readFileSync(new URL("../src/questions.json", import.meta.url)),
);
const SPEECH = JSON.parse(
  readFileSync(new URL("../src/speech-assets.json", import.meta.url)),
);
const service = createQuestionService();
const EXPIRES = 2_000_000_000_000;
const ANSWERED = EXPIRES - 60_000;

function fixture(overrides = {}) {
  return {
    id: "private-test-question",
    grade: 1,
    semester: 1,
    unitId: "g1-s1-u1",
    topic: "School",
    type: "word",
    prompt: "Choose the matching word",
    text: "",
    options: ["book", "ruler", "pencil"],
    answer: 0,
    target: "private-target-marker",
    explanation: "private-explanation-marker",
    speak: "private-answer-audio-marker",
    listen: "private-source-listen-marker",
    ...overrides,
  };
}

function issue(svc = service, overrides = {}) {
  return svc.issue({
    deck: svc.createDeck({ grade: 1, course: "s1-u1" }),
    cursor: 0,
    kind: "insight",
    target: "hero",
    expiresAt: EXPIRES,
    ...overrides,
  });
}

function assertCode(fn, code) {
  assert.throws(fn, (error) => error instanceof Error && error.code === code);
}

function assertNoAnswers(value, path = "") {
  const forbidden = new Set([
    "answer",
    "correct",
    "correctOptionId",
    "questionId",
    "qid",
    "explanation",
    "speak",
    "audioUrl",
    "source",
    "sourcePages",
    "listen",
    "speechAssets",
    "contentVersion",
    "unitId",
    "seed",
    "answerIndex",
    "correctIndex",
  ]);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!forbidden.has(key), `Private key leaked at ${path}.${key}`);
    if (key === "target")
      assert.equal(path, "", "Only the top-level combat target is public");
    assertNoAnswers(child, `${path}.${key}`);
  }
}

test("private question decks strictly filter every grade, semester, and six-question unit", () => {
  for (let grade = 1; grade <= 6; grade++) {
    const full = service.createDeck({ grade, course: "all" });
    assert.equal(full.length, 72);
    assert.ok(full.every((q) => q.grade === grade));
    for (const semester of [1, 2]) {
      const half = service.createDeck({ grade, course: `s${semester}` });
      assert.equal(half.length, 36);
      assert.ok(
        half.every((q) => q.grade === grade && q.semester === semester),
      );
      for (let unit = 1; unit <= 6; unit++) {
        const deck = service.createDeck({
          grade,
          course: `s${semester}-u${unit}`,
        });
        assert.equal(deck.length, 6);
        assert.ok(
          deck.every((q) => q.unitId === `g${grade}-s${semester}-u${unit}`),
        );
        assert.equal(new Set(deck.map((q) => q.id)).size, 6);
      }
    }
  }
});

test("invalid grades/courses and empty valid scopes never widen into another course", () => {
  for (const grade of [
    undefined,
    null,
    0,
    7,
    -1,
    1.5,
    "1",
    true,
    NaN,
    Infinity,
    {},
    [],
  ])
    assertCode(
      () => service.createDeck({ grade, course: "all" }),
      "INVALID_GRADE",
    );
  for (const course of [
    null,
    "",
    "ALL",
    "s0",
    "s3",
    "s1-u0",
    "s1-u7",
    "s1-u01",
    "g1-s1-u1",
    "s1-u1 ",
    true,
    1,
    {},
    [],
  ])
    assertCode(
      () => service.createDeck({ grade: 1, course }),
      "INVALID_COURSE",
    );
  const small = createQuestionService({ questions: [fixture()] });
  assertCode(
    () => small.createDeck({ grade: 1, course: "s1-u2" }),
    "NO_QUESTIONS",
  );
  assertCode(
    () => small.createDeck({ grade: 1, course: "s2" }),
    "NO_QUESTIONS",
  );
  assertCode(
    () => small.createDeck({ grade: 2, course: "all" }),
    "NO_QUESTIONS",
  );
  assert.equal(small.createDeck({ grade: 1, course: "s1-u1" }).length, 1);
});

test("independent seat cursors cycle unit decks without mutating or consuming them", () => {
  const deck = service.createDeck({ grade: 1, course: "s1-u1" });
  const original = deck.map((q) => q.id);
  const seatA = issue(service, { deck, cursor: 0 });
  const nextA = issue(service, { deck, cursor: 1 });
  const seatB = issue(service, { deck, cursor: 0 });
  const cycleA = issue(service, { deck, cursor: 6 });
  assert.equal(seatA.questionId, seatB.questionId);
  assert.equal(seatA.questionId, cycleA.questionId);
  assert.notEqual(nextA.questionId, seatA.questionId);
  assert.notEqual(seatA.challengeId, seatB.challengeId);
  assert.notEqual(seatA.correctOptionId, cycleA.correctOptionId);
  assert.deepEqual(
    deck.map((q) => q.id),
    original,
  );
  assert.ok(Object.isFrozen(deck));
  for (const cursor of [
    -1,
    0.5,
    "0",
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assertCode(() => issue(service, { deck, cursor }), "INVALID_CURSOR");
  assertCode(() => issue(service, { deck: [...deck] }), "INVALID_DECK");
});

test("public challenges contain only whitelisted public material, recursively", () => {
  const source = fixture({
    privateExtra: { answer: "never expose arbitrary source keys" },
  });
  const svc = createQuestionService({ questions: [source], speechAssets: {} });
  const challenge = issue(svc);
  const visible = svc.toPublic(challenge);
  assertNoAnswers(visible);
  assert.deepEqual(Object.keys(visible).sort(), [
    "challengeId",
    "expiresAt",
    "kind",
    "question",
    "target",
  ]);
  assert.deepEqual(Object.keys(visible.question).sort(), [
    "bank",
    "grade",
    "listenAudioUrl",
    "listenText",
    "options",
    "prompt",
    "text",
    "type",
    "unitLabel",
    "visual",
  ]);
  assert.equal(visible.target, "hero");
  const serialized = JSON.stringify(visible);
  for (const secret of [
    source.id,
    source.target,
    source.explanation,
    source.speak,
    source.listen,
    "privateExtra",
  ])
    assert.ok(!serialized.includes(secret), `Leaked ${secret}`);
  assert.equal(visible.question.visual, null);
  for (const option of visible.question.options)
    assert.deepEqual(Object.keys(option).sort(), ["id", "text"]);
  // Modifying a public payload must not modify retained grading authority.
  visible.question.options[0].id = "fake";
  visible.question.prompt = "changed";
  assert.notEqual(svc.toPublic(challenge).question.options[0].id, "fake");
  assert.equal(svc.toPublic(challenge).question.prompt, source.prompt);
  assert.equal(
    svc.answer(challenge, challenge.correctOptionId, ANSWERED).outcome,
    "correct",
  );
});

test("challenge and option identifiers are independently opaque and options are independently shuffled", () => {
  const svc = createQuestionService({
    questions: [fixture()],
    speechAssets: {},
  });
  const deck = svc.createDeck({ grade: 1, course: "s1-u1" });
  const ids = new Set();
  const orders = new Set();
  for (let i = 0; i < 64; i++) {
    const challenge = issue(svc, { deck, cursor: i });
    for (const id of [
      challenge.challengeId,
      ...challenge.question.options.map((option) => option.id),
    ]) {
      assert.match(id, /^[A-Za-z0-9_-]{32}$/);
      assert.ok(
        !ids.has(id),
        "Opaque IDs must not repeat across challenges/options",
      );
      ids.add(id);
    }
    assert.equal(
      challenge.question.options.find(
        (option) => option.id === challenge.correctOptionId,
      ).text,
      "book",
    );
    orders.add(
      challenge.question.options.map((option) => option.text).join("|"),
    );
  }
  assert.ok(orders.size > 1, "Options must not retain a fixed source order");
});

test("grading accepts only this challenge's listed opaque IDs and does not consume state", () => {
  const svc = createQuestionService({
    questions: [fixture()],
    speechAssets: {},
  });
  const challenge = issue(svc);
  const another = issue(svc);
  for (const optionId of [
    undefined,
    null,
    0,
    1,
    {},
    [],
    true,
    "book",
    "0",
    "",
    another.correctOptionId,
  ])
    assertCode(
      () => svc.answer(challenge, optionId, ANSWERED),
      "INVALID_OPTION",
    );
  const wrongId = challenge.question.options.find(
    (option) => option.id !== challenge.correctOptionId,
  ).id;
  const wrong = svc.answer(challenge, wrongId, ANSWERED);
  assert.deepEqual(wrong, {
    outcome: "wrong",
    selectedOptionId: wrongId,
    correctOptionId: challenge.correctOptionId,
    questionId: "private-test-question",
    explanation: "private-explanation-marker",
    speak: "private-answer-audio-marker",
    audioUrl: null,
    learning: {
      qid: "private-test-question",
      correct: false,
      answeredAt: ANSWERED,
    },
  });
  const correct = svc.answer(
    challenge,
    challenge.correctOptionId,
    ANSWERED + 1,
  );
  assert.equal(correct.outcome, "correct");
  assert.deepEqual(correct.learning, {
    qid: "private-test-question",
    correct: true,
    answeredAt: ANSWERED + 1,
  });
  assert.deepEqual(svc.answer(challenge, wrongId, ANSWERED), wrong);
  assertCode(
    () => svc.answer(challenge, wrongId, "now"),
    "INVALID_ANSWER_TIME",
  );
  assertCode(() => svc.toPublic({ ...challenge }), "INVALID_CHALLENGE");
  assertCode(
    () => service.answer(challenge, wrongId, ANSWERED),
    "INVALID_CHALLENGE",
  );
});

test("listening preserves blanks and ignores answer-only source listening and answer audio", () => {
  const source = fixture({
    type: "cloze",
    text: "I have a ___.",
    speak: "I have a book.",
    listen: "I have a book.",
  });
  const speechAssets = {
    "I have a  … .": "assets/speech/1111111111111111.mp3",
    "I have a book.": "assets/speech/2222222222222222.mp3",
    "private-index-only-marker": "assets/speech/3333333333333333.mp3",
  };
  const svc = createQuestionService({ questions: [source], speechAssets });
  const challenge = issue(svc);
  const visible = svc.toPublic(challenge);
  assert.equal(visible.question.text, "I have a ___.");
  assert.equal(visible.question.listenText, "I have a  … .");
  assert.equal(
    visible.question.listenAudioUrl,
    "/assets/speech/1111111111111111.mp3",
  );
  assert.ok(!JSON.stringify(visible).includes("2222222222222222"));
  assert.ok(!JSON.stringify(visible).includes("private-index-only-marker"));
  assert.equal(
    svc.answer(challenge, challenge.correctOptionId, ANSWERED).audioUrl,
    "/assets/speech/2222222222222222.mp3",
  );
});

test("whole option audio must match shuffled display order and complete segmented audio keeps that order", () => {
  const speechAssets = {
    "book. ruler. pencil.": "assets/speech/1111111111111111.mp3",
    book: "assets/speech/2222222222222222.mp3",
    ruler: "assets/speech/3333333333333333.mp3",
    pencil: "assets/speech/4444444444444444.mp3",
    "private-answer-audio-marker": "assets/speech/5555555555555555.mp3",
  };
  const svc = createQuestionService({ questions: [fixture()], speechAssets });
  for (let i = 0; i < 32; i++) {
    const { question } = svc.toPublic(issue(svc));
    const expectedText = question.options
      .map((option) => `${option.text}.`)
      .join(" ");
    assert.equal(question.listenText, expectedText);
    assert.equal(
      question.listenAudioUrl,
      speechAssets[expectedText] ? `/${speechAssets[expectedText]}` : null,
    );
    if (!question.listenAudioUrl)
      assert.deepEqual(
        question.listenAudioUrls,
        question.options.map((option) => `/${speechAssets[option.text]}`),
      );
    assert.ok(!JSON.stringify(question).includes("5555555555555555"));
  }
  // Exposing only the correct option's available clip would be a side channel.
  const partial = createQuestionService({
    questions: [fixture()],
    speechAssets: { book: speechAssets.book },
  });
  assert.ok(
    !Object.hasOwn(
      partial.toPublic(issue(partial)).question,
      "listenAudioUrls",
    ),
  );
});

test("unsafe, source-root, and answer-descriptive audio URLs are never exposed", () => {
  for (const url of [
    "https://example.com/book.mp3",
    "/src/speech-assets.json",
    "assets/speech/book.mp3",
    "assets/speech/../questions.json",
    "//other.test/assets/speech/1111111111111111.mp3",
  ]) {
    const svc = createQuestionService({
      questions: [fixture({ text: "Visible question", speak: "Answer" })],
      speechAssets: { "Visible question": url, Answer: url },
    });
    const challenge = issue(svc);
    assert.equal(svc.toPublic(challenge).question.listenAudioUrl, null);
    assert.equal(
      svc.answer(challenge, challenge.correctOptionId, ANSWERED).audioUrl,
      null,
    );
  }
});

test("missing randomized audio preserves the safe original whole clip and fresh opaque IDs", () => {
  const source = fixture({
    type: "sentence",
    options: ["This is my ear.", "This is my nose.", "This is my mouth."],
    answer: 2,
    listen: "This is my mouth.",
    speak: "This is my mouth.",
  });
  const originalText = source.options.join(" ");
  const speechAssets = {
    [originalText]: "assets/speech/1111111111111111.mp3",
    [source.speak]: "assets/speech/2222222222222222.mp3",
  };
  const svc = createQuestionService({ questions: [source], speechAssets });
  const ids = new Set();
  for (let i = 0; i < 48; i++) {
    const challenge = issue(svc);
    const visible = svc.toPublic(challenge);
    const question = visible.question;
    assert.deepEqual(
      question.options.map(({ text }) => text),
      source.options,
    );
    assert.equal(question.listenText, originalText);
    assert.equal(
      question.listenAudioUrl,
      "/assets/speech/1111111111111111.mp3",
    );
    assert.ok(!Object.hasOwn(question, "listenAudioUrls"));
    assert.ok(!JSON.stringify(visible).includes("2222222222222222"));
    assert.equal(
      question.options.find(({ id }) => id === challenge.correctOptionId).text,
      source.options[2],
    );
    assert.equal(
      svc.answer(challenge, challenge.correctOptionId, ANSWERED).outcome,
      "correct",
    );
    for (const id of [
      challenge.challengeId,
      ...question.options.map(({ id }) => id),
    ]) {
      assert.match(id, /^[A-Za-z0-9_-]{32}$/);
      assert.ok(!ids.has(id));
      ids.add(id);
    }
  }
});

test("all 432 production questions retain a safe prerecorded listening route across repeated issuance", () => {
  for (const source of BANK) {
    const originalText = source.text.trim()
      ? source.text.replace(/_{2,}/g, " … ")
      : source.options
          .map((text) => `${text.trim().replace(/[.!?。！？]+$/, "")}.`)
          .join(" ");
    assert.ok(
      SPEECH[originalText],
      `${source.id} should have its original safe pre-answer clip`,
    );
    for (let i = 0; i < 12; i++) {
      const { question } = service.toPublic(
        service.issueStudy({ qid: source.id, expiresAt: EXPIRES }),
      );
      assert.ok(
        question.listenAudioUrl ||
          question.listenAudioUrls?.length === question.options.length,
        `${source.id} lost its prerecorded listening route`,
      );
      if (question.listenAudioUrl)
        assert.equal(
          question.listenAudioUrl,
          `/${SPEECH[question.listenText]}`,
        );
      else
        assert.deepEqual(
          question.listenAudioUrls,
          question.options.map(({ text }) => `/${SPEECH[text]}`),
        );
      if (!source.text.trim()) {
        const displayedText = question.options
          .map(({ text }) => `${text.trim().replace(/[.!?。！？]+$/, "")}.`)
          .join(" ");
        assert.equal(question.listenText, displayedText);
      }
    }
  }
});

test("all production public questions have safe matching listening and no private metadata", () => {
  for (const source of BANK) {
    const challenge = service.issueStudy({
      qid: source.id,
      expiresAt: EXPIRES,
    });
    const visible = service.toPublic(challenge);
    assertNoAnswers(visible);
    assert.ok(!JSON.stringify(visible).includes(source.id));
    const question = visible.question;
    assert.equal(
      question.listenAudioUrl,
      SPEECH[question.listenText] ? `/${SPEECH[question.listenText]}` : null,
    );
    if (question.listenAudioUrls)
      assert.deepEqual(
        question.listenAudioUrls,
        question.options.map((option) => `/${SPEECH[option.text]}`),
      );
    if (source.text.includes("___")) {
      assert.ok(question.listenText.includes("…"));
      assert.notEqual(question.listenText, source.speak);
    }
    assert.equal(
      service.answer(challenge, challenge.correctOptionId, ANSWERED).outcome,
      "correct",
    );
  }
});

test("safe visual descriptors preserve existing grade-one atlas, number, and color mappings", () => {
  let atlases = 0,
    numbers = 0,
    colors = 0;
  for (const source of BANK) {
    const challenge = service.issueStudy({
      qid: source.id,
      expiresAt: EXPIRES,
    });
    const visible = service.toPublic(challenge);
    const visual = visible.question.visual;
    if (source.grade !== 1 || source.type !== "word") {
      assert.equal(visual, null);
      continue;
    }
    assert.ok(visual);
    assert.ok(!Object.hasOwn(visual, "target"));
    if (visual.kind === "atlas") {
      atlases++;
      const sheet = PICTURE_SHEETS.find((item) =>
        item.words.includes(source.target),
      );
      const index = sheet.words.indexOf(source.target);
      const row = Math.floor(index / sheet.columns);
      assert.deepEqual(visual, {
        kind: "atlas",
        assetUrl: `/assets/learning/${sheet.file}`,
        crop: {
          x: ((index % sheet.columns) * sheet.width) / sheet.columns,
          y: sheet.rows[row],
          width: sheet.width / sheet.columns,
          height: sheet.rows[row + 1] - sheet.rows[row],
        },
        sheetWidth: sheet.width,
        sheetHeight: sheet.height,
      });
      visual.crop.x = -1;
      assert.ok(service.toPublic(challenge).question.visual.crop.x >= 0);
    } else if (visual.kind === "number") {
      numbers++;
      assert.equal(
        visual.count,
        { one: 1, three: 3, five: 5, eight: 8 }[source.target],
      );
    } else {
      colors++;
      assert.equal(visual.kind, "color");
      assert.equal(
        visual.color,
        {
          black: "#161616",
          yellow: "#ffd846",
          blue: "#326dcc",
          red: "#df3c46",
        }[source.target],
      );
    }
  }
  assert.deepEqual([atlases, numbers, colors], [40, 4, 4]);
});

test("study metadata exposes only catalogue identifiers and curriculum labels", () => {
  const data = service.metadata();
  assert.equal(data.contentVersion, "pep1-2026.1");
  assert.equal(data.books.length, 12);
  assert.equal(data.units.length, 72);
  assert.equal(data.questions.length, 480);
  const school = data.questions.filter((question) => question.bank === "school");
  assert.equal(school.length, 432);
  for (const question of school) {
    assert.deepEqual(Object.keys(question).sort(), [
      "bank",
      "displayLabel",
      "grade",
      "id",
      "semester",
      "topic",
      "type",
      "unitId",
    ]);
    assert.match(question.displayLabel, /Unit [1-6]/);
  }
  const source = fixture({ target: "private-topic-independent-target" });
  const svc = createQuestionService({ questions: [source], speechAssets: {} });
  const catalogue = JSON.stringify(svc.metadata());
  for (const privateText of [
    source.target,
    source.speak,
    source.explanation,
    source.listen,
  ])
    assert.ok(!catalogue.includes(privateText));
  for (const privateKey of [
    "answer",
    "target",
    "speak",
    "explanation",
    "options",
    "speechAssets",
  ])
    assert.ok(!catalogue.includes(`"${privateKey}":`));
  data.units[0].unit_title = "Mutated by caller";
  data.books[0].title = "Mutated by caller";
  assert.notEqual(service.metadata().units[0].unit_title, "Mutated by caller");
  assert.notEqual(service.metadata().books[0].title, "Mutated by caller");
});

test("study challenges resolve one valid question with private answers and no room state", () => {
  const qid = BANK.at(-1).id;
  const challenge = service.issueStudy({ qid, expiresAt: EXPIRES });
  assert.equal(challenge.questionId, qid);
  const visible = service.toPublic(challenge);
  assert.equal(visible.kind, "study");
  assert.equal(visible.target, null);
  assert.ok(!Object.hasOwn(visible, "roomId"));
  assertNoAnswers(visible);
  assert.equal(
    service.answer(challenge, challenge.correctOptionId, ANSWERED).learning.qid,
    qid,
  );
  for (const missing of [
    undefined,
    null,
    0,
    {},
    "",
    "not-a-question",
    "../src/questions.json",
  ])
    assertCode(
      () => service.issueStudy({ qid: missing, expiresAt: EXPIRES }),
      "QUESTION_NOT_FOUND",
    );
  assertCode(
    () => service.issueStudy({ qid, expiresAt: "later" }),
    "INVALID_EXPIRY",
  );
});

test("invalid injected banks fail at construction rather than creating ambiguous answers", () => {
  for (const bad of [
    fixture({ answer: -1 }),
    fixture({ answer: 3 }),
    fixture({ options: ["book", "book"] }),
    fixture({ grade: "1" }),
    fixture({ unitId: "g2-s1-u1" }),
    fixture({ semester: 2 }),
  ])
    assertCode(
      () => createQuestionService({ questions: [bad] }),
      "INVALID_QUESTION_BANK",
    );
  assertCode(
    () => createQuestionService({ questions: [] }),
    "INVALID_QUESTION_BANK",
  );
  assertCode(
    () => createQuestionService({ questions: [fixture(), fixture()] }),
    "INVALID_QUESTION_BANK",
  );
});
