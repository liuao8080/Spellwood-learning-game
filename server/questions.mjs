/** Private question authority. Never import this module into a client bundle. */
import { readFileSync } from "node:fs";
import { randomBytes, randomInt } from "node:crypto";
import { PICTURE_SHEETS } from "../src/learning-visuals.mjs";

const GRADES = new Set([1, 2, 3, 4, 5, 6]);
const KINDS = new Set(["insight", "spark", "bloom"]);
const TYPES = new Set(["word", "sentence", "cloze"]);
const NUMBER_CUES = Object.freeze({ one: 1, three: 3, five: 5, eight: 8 });
const COLOR_CUES = Object.freeze({
  black: "#161616",
  yellow: "#ffd846",
  blue: "#326dcc",
  red: "#df3c46",
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function readJSON(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function opaqueId() {
  // No room seed, bank ID, source option index, or answer is encoded in an ID.
  return randomBytes(24).toString("base64url");
}

function safeAudioUrl(path) {
  // Only opaque, bundled same-origin clips. Never serialize the speech index.
  return typeof path === "string" &&
    /^\/?assets\/speech\/[a-f0-9]{16}\.mp3$/.test(path)
    ? `/${path.replace(/^\//, "")}`
    : null;
}

function visualFor(question) {
  if (question.grade !== 1 || question.type !== "word") return null;
  for (const sheet of PICTURE_SHEETS) {
    const index = sheet.words.indexOf(question.target);
    if (index < 0) continue;
    const row = Math.floor(index / sheet.columns);
    const width = sheet.width / sheet.columns;
    return {
      kind: "atlas",
      assetUrl: `/assets/learning/${sheet.file}`,
      crop: {
        x: (index % sheet.columns) * width,
        y: sheet.rows[row],
        width,
        height: sheet.rows[row + 1] - sheet.rows[row],
      },
      sheetWidth: sheet.width,
      sheetHeight: sheet.height,
    };
  }
  if (Object.hasOwn(NUMBER_CUES, question.target))
    return { kind: "number", count: NUMBER_CUES[question.target] };
  if (Object.hasOwn(COLOR_CUES, question.target))
    return { kind: "color", color: COLOR_CUES[question.target] };
  return null;
}

function normalizeQuestion(question, units) {
  if (
    !question ||
    typeof question.id !== "string" ||
    !question.id ||
    !GRADES.has(question.grade) ||
    ![1, 2].includes(question.semester) ||
    !TYPES.has(question.type) ||
    typeof question.prompt !== "string" ||
    typeof question.text !== "string" ||
    !Array.isArray(question.options) ||
    question.options.length < 2 ||
    question.options.length > 12 ||
    !question.options.every(
      (option) => typeof option === "string" && option.trim(),
    ) ||
    new Set(question.options).size !== question.options.length ||
    !Number.isInteger(question.answer) ||
    question.answer < 0 ||
    question.answer >= question.options.length ||
    typeof question.explanation !== "string" ||
    typeof question.speak !== "string"
  )
    fail("INVALID_QUESTION_BANK", "Question bank contains an invalid question");
  const unit = units.get(question.unitId);
  if (
    !unit ||
    unit.grade !== question.grade ||
    unit.semester !== question.semester
  )
    fail(
      "INVALID_QUESTION_BANK",
      "Question grade, semester, and unit must agree",
    );
  // Copy only supported source fields so injected objects cannot extend the wire shape.
  return Object.freeze({
    id: question.id,
    grade: question.grade,
    semester: question.semester,
    unitId: question.unitId,
    topic:
      typeof question.topic === "string" ? question.topic : unit.unit_title,
    type: question.type,
    prompt: question.prompt,
    text: question.text,
    options: Object.freeze([...question.options]),
    answer: question.answer,
    explanation: question.explanation,
    speak: question.speak,
    target: typeof question.target === "string" ? question.target : "",
  });
}

/**
 * All methods are synchronous. Decks and challenges stay in room memory only.
 * Each seat owns its numeric cursor; issuance and grading never advance it or
 * consume a ritual. The room owner enforces deadlines and exactly-once answers.
 * Test fixtures may inject questions, speechAssets, and curriculum in-process.
 */
export function createQuestionService(options = {}) {
  const curriculum = options.curriculum ?? readJSON("../src/curriculum.json");
  if (!Array.isArray(curriculum.units))
    fail("INVALID_QUESTION_BANK", "Curriculum must contain units");
  const units = new Map(curriculum.units.map((unit) => [unit.id, { ...unit }]));
  const input = options.questions ?? readJSON("../src/questions.json");
  if (!Array.isArray(input) || !input.length)
    fail("INVALID_QUESTION_BANK", "Question bank must be a nonempty array");
  const questions = input.map((question) => normalizeQuestion(question, units));
  if (
    new Set(questions.map((question) => question.id)).size !== questions.length
  )
    fail("INVALID_QUESTION_BANK", "Question IDs must be unique");
  const questionsById = new Map(
    questions.map((question) => [question.id, question]),
  );
  const speechAssets = Object.assign(
    Object.create(null),
    options.speechAssets ?? readJSON("../src/speech-assets.json"),
  );
  const decks = new WeakSet();
  const challenges = new WeakSet();

  function createDeck({ grade, course = "all" } = {}) {
    if (!GRADES.has(grade))
      fail("INVALID_GRADE", "Grade must be an integer from 1 to 6");
    const unit =
      typeof course === "string" && /^s[12]-u[1-9]\d*$/.test(course)
        ? units.get(`g${grade}-${course}`)
        : null;
    if (course !== "all" && course !== "s1" && course !== "s2" && !unit)
      fail(
        "INVALID_COURSE",
        "Course must select a valid semester or unit for this grade",
      );
    const allowed = questions.filter(
      (question) =>
        question.grade === grade &&
        (course === "all" ||
          (course === "s1" || course === "s2"
            ? question.semester === Number(course[1])
            : question.unitId === unit.id)),
    );
    // Empty course scopes must never silently broaden to a different unit/grade.
    if (!allowed.length)
      fail("NO_QUESTIONS", "No questions are available for this exact course");
    const deck = Object.freeze(shuffle(allowed));
    decks.add(deck);
    return deck;
  }

  function issue({ deck, cursor = 0, kind, target = null, expiresAt } = {}) {
    if (!decks.has(deck))
      fail("INVALID_DECK", "Deck must belong to this question service");
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      fail(
        "INVALID_CURSOR",
        "Question cursor must be a nonnegative safe integer",
      );
    if (!KINDS.has(kind)) fail("INVALID_KIND", "Unknown ritual kind");
    if (
      target !== null &&
      (typeof target !== "string" || !target || target.length > 128)
    )
      fail("INVALID_TARGET", "Ritual target must be a short string or null");
    if (!Number.isFinite(expiresAt))
      fail("INVALID_EXPIRY", "Challenge expiry must be a timestamp");

    return makeChallenge(deck[cursor % deck.length], {
      kind,
      target,
      expiresAt,
    });
  }

  function makeChallenge(source, { kind, target, expiresAt }) {
    const originalOptions = source.options.map((text, index) => ({
      id: opaqueId(),
      text,
      correct: index === source.answer,
    }));
    let options = shuffle(originalOptions);
    const readOptions = (items) =>
      items
        // The bundled option readings use a period between choices, including
        // choices written with ? or !. Derive this from display text only.
        .map(({ text }) => `${text.trim().replace(/[.!?。！？]+$/, "")}.`)
        .join(" ");
    // Rebuild listening from visible material, never from answer-only speak,
    // target, explanation, or a potentially stale source listen value.
    let listenText = source.text.trim()
      ? source.text.replace(/_{2,}/g, " … ")
      : readOptions(options);
    let listenAudioUrl = safeAudioUrl(speechAssets[listenText]);
    let listenAudioUrls;
    if (!source.text.trim() && !listenAudioUrl) {
      const urls = options.map(({ text }) => safeAudioUrl(speechAssets[text]));
      // Never expose a partial set of clips: availability could identify an
      // answer. Preserve a safe original whole clip before falling back to TTS.
      if (urls.every(Boolean)) listenAudioUrls = urls;
      else {
        const originalText = readOptions(originalOptions);
        const originalUrl = safeAudioUrl(speechAssets[originalText]);
        if (originalUrl) {
          options = originalOptions;
          listenText = originalText;
          listenAudioUrl = originalUrl;
        }
      }
    }
    const unit = units.get(source.unitId);
    const question = {
      type: source.type,
      prompt: source.prompt,
      text: source.text,
      grade: source.grade,
      unitLabel: `${source.semester === 1 ? "上册" : "下册"} · Unit ${unit.unit} ${unit.unit_title_zh || unit.unit_title}`,
      options: options.map(({ id, text }) => Object.freeze({ id, text })),
      listenText,
      listenAudioUrl,
      visual: visualFor(source),
    };
    if (listenAudioUrls) question.listenAudioUrls = listenAudioUrls;
    const challenge = {
      challengeId: opaqueId(),
      kind,
      target,
      expiresAt,
      question,
      correctOptionId: options.find((option) => option.correct).id,
      questionId: source.id,
      explanation: source.explanation,
      speak: source.speak,
      audioUrl: safeAudioUrl(speechAssets[source.speak]),
    };
    // Public responses are detached copies. Freeze retained authority state to
    // prevent a room handler accidentally changing the answer while rendering.
    if (question.visual?.crop) Object.freeze(question.visual.crop);
    if (question.visual) Object.freeze(question.visual);
    if (question.listenAudioUrls) Object.freeze(question.listenAudioUrls);
    Object.freeze(question.options);
    Object.freeze(question);
    Object.freeze(challenge);
    challenges.add(challenge);
    return challenge;
  }

  function issueStudy({ qid, expiresAt } = {}) {
    const source = typeof qid === "string" ? questionsById.get(qid) : null;
    if (!source) fail("QUESTION_NOT_FOUND", "Study question was not found");
    if (!Number.isFinite(expiresAt))
      fail("INVALID_EXPIRY", "Challenge expiry must be a timestamp");
    return makeChallenge(source, { kind: "study", target: null, expiresAt });
  }

  function metadata() {
    // Source IDs belong only in the explicit study catalogue, never a battle
    // challenge. Catalogue labels describe curriculum scope, not solutions.
    return {
      contentVersion: curriculum.version,
      books: (curriculum.books ?? []).map((book) => ({
        id: book.id,
        grade: book.grade,
        semester: book.semester,
        title: book.title,
      })),
      units: [...units.values()].map((unit) => ({
        id: unit.id,
        book_id: unit.book_id,
        grade: unit.grade,
        semester: unit.semester,
        unit: unit.unit,
        unit_title: unit.unit_title,
        unit_title_zh: unit.unit_title_zh,
      })),
      questions: questions.map((question) => {
        const unit = units.get(question.unitId);
        const typeLabel = {
          word: "词语",
          sentence: "句子",
          cloze: "阅读与填空",
        }[question.type];
        return {
          id: question.id,
          grade: question.grade,
          type: question.type,
          semester: question.semester,
          unitId: question.unitId,
          topic: question.topic,
          displayLabel: `${question.semester === 1 ? "上册" : "下册"} · Unit ${unit.unit} ${unit.unit_title_zh || unit.unit_title} · ${typeLabel}`,
        };
      }),
    };
  }

  function assertChallenge(challenge) {
    if (!challenges.has(challenge))
      fail(
        "INVALID_CHALLENGE",
        "Challenge must belong to this question service",
      );
  }

  function toPublic(challenge) {
    assertChallenge(challenge);
    const question = challenge.question;
    const visible = {
      challengeId: challenge.challengeId,
      kind: challenge.kind,
      target: challenge.target,
      expiresAt: challenge.expiresAt,
      question: {
        type: question.type,
        prompt: question.prompt,
        text: question.text,
        grade: question.grade,
        unitLabel: question.unitLabel,
        options: question.options.map(({ id, text }) => ({ id, text })),
        listenText: question.listenText,
        listenAudioUrl: question.listenAudioUrl,
        visual: question.visual ? structuredClone(question.visual) : null,
      },
    };
    if (question.listenAudioUrls)
      visible.question.listenAudioUrls = [...question.listenAudioUrls];
    return visible;
  }

  function answer(challenge, optionId, answeredAt) {
    assertChallenge(challenge);
    if (
      typeof optionId !== "string" ||
      !challenge.question.options.some((option) => option.id === optionId)
    )
      fail(
        "INVALID_OPTION",
        "Answer must identify one of this challenge's options",
      );
    if (!Number.isFinite(answeredAt))
      fail("INVALID_ANSWER_TIME", "Answer time must be a timestamp");
    const correct = optionId === challenge.correctOptionId;
    return {
      outcome: correct ? "correct" : "wrong",
      selectedOptionId: optionId,
      correctOptionId: challenge.correctOptionId,
      questionId: challenge.questionId,
      explanation: challenge.explanation,
      speak: challenge.speak,
      audioUrl: challenge.audioUrl,
      learning: { qid: challenge.questionId, correct, answeredAt },
    };
  }

  return Object.freeze({
    createDeck,
    issue,
    toPublic,
    answer,
    metadata,
    issueStudy,
  });
}
