import { createHash } from "node:crypto";
import { bankFor, validBank, TEACHER_BANK, validTeacherCourse } from "../src/question-banks.mjs";
import {
  DECKS,
  RULES,
  CONTENT_VERSION,
  validCourse,
  validateCustomDeck,
} from "../src/cards.mjs";
export const PROTOCOL = 1,
  RULESET = "net-1.1";
export const versions = {
  protocol: PROTOCOL,
  ruleset: RULESET,
  combatRules: RULES,
  contentVersion: CONTENT_VERSION,
};
export function fail(code) {
  const e = new Error(code);
  e.code = code;
  throw e;
}
export const plain = (x) =>
  x !== null && typeof x === "object" && !Array.isArray(x);
function exact(x, allowed, required = []) {
  if (
    !plain(x) ||
    Object.keys(x).some((k) => !allowed.includes(k)) ||
    required.some((k) => !Object.hasOwn(x, k))
  )
    fail("BAD_PAYLOAD");
}
export function fingerprint(x) {
  const canon = (v) =>
    Array.isArray(v)
      ? v.map(canon)
      : plain(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canon(v[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canon(x)))
    .digest("hex");
}
export function parseEnvelope(x) {
  exact(
    x,
    ["type", "commandId", "clientSeq", "roomId", "expectedRevision", "payload"],
    ["type", "commandId", "clientSeq", "payload"],
  );
  if (
    typeof x.type !== "string" ||
    typeof x.commandId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(x.commandId) ||
    !Number.isSafeInteger(x.clientSeq) ||
    x.clientSeq < 1
  )
    fail("BAD_ENVELOPE");
  if (
    x.roomId !== undefined &&
    (typeof x.roomId !== "string" || x.roomId.length > 80)
  )
    fail("BAD_ENVELOPE");
  if (
    x.expectedRevision !== undefined &&
    (!Number.isSafeInteger(x.expectedRevision) || x.expectedRevision < 0)
  )
    fail("BAD_ENVELOPE");
  if (!plain(x.payload)) fail("BAD_PAYLOAD");
  return x;
}
export function payload(command) {
  const p = command.payload;
  switch (command.type) {
    case "queue.join": {
      exact(
        p,
        [
          "bank",
          "grade",
          "course",
          "deckId",
          "customDeck",
          "ruleset",
          "combatRules",
          "contentVersion",
        ],
        ["grade", "course", "deckId"],
      );
      const bank = bankFor(p.bank);
      if (
        !validBank(bank) ||
        (bank === TEACHER_BANK
          ? p.grade !== null || !validTeacherCourse(p.course)
          : !Number.isInteger(p.grade) || p.grade < 1 || p.grade > 6 || !validCourse(p.course)) ||
        (p.deckId === "custom"
          ? !validateCustomDeck(p.customDeck)
          : !DECKS.some((d) => d.id === p.deckId)) ||
        (p.deckId !== "custom" && p.customDeck !== undefined)
      )
        fail("INVALID_MATCH_OPTIONS");
      for (const key of ["ruleset", "combatRules", "contentVersion"])
        if (p[key] !== undefined && p[key] !== versions[key])
          fail("VERSION_MISMATCH");
      return {
        bank,
        grade: p.grade,
        course: p.course,
        deckId: p.deckId,
        ...(p.deckId === "custom" ? { customDeck: [...p.customDeck] } : {}),
        ...versions,
      };
    }
    case "queue.cancel":
    case "room.resync":
    case "room.resign":
    case "room.reclaim":
      exact(p, []);
      return {};
    case "opening.choose":
      exact(p, ["indices"], ["indices"]);
      if (
        !Array.isArray(p.indices) ||
        p.indices.length > 2 ||
        new Set(p.indices).size !== p.indices.length ||
        p.indices.some((i) => !Number.isInteger(i) || i < 0 || i > 3)
      )
        fail("INVALID_OPENING");
      return { indices: [...p.indices].sort((a, b) => a - b) };
    case "battle.action": {
      exact(p, ["action"], ["action"]);
      const a = p.action;
      if (!plain(a)) fail("BAD_ACTION");
      if (a.type === "play") {
        exact(a, ["type", "index", "target"], ["type", "index"]);
        if (!Number.isInteger(a.index) || a.index < 0 || a.index > 6)
          fail("BAD_ACTION");
        const out = { type: "play", index: a.index };
        if (a.target !== undefined) out.target = target(a.target);
        return { action: out };
      }
      if (a.type === "attack") {
        exact(a, ["type", "uid", "target"], ["type", "uid", "target"]);
        if (typeof a.uid !== "string" || !/^u[1-9][0-9]{0,5}$/.test(a.uid))
          fail("BAD_ACTION");
        return {
          action: { type: "attack", uid: a.uid, target: target(a.target) },
        };
      }
      if (a.type === "end") {
        exact(a, ["type"], ["type"]);
        return { action: { type: "end" } };
      }
      fail("FORBIDDEN_ACTION");
    }
    case "ritual.begin":
      exact(p, ["kind", "target"], ["kind"]);
      if (!["spark", "bloom", "insight"].includes(p.kind))
        fail("INVALID_RITUAL");
      if (p.kind !== "spark" && p.target !== undefined && p.target !== "hero")
        fail("INVALID_RITUAL");
      return {
        kind: p.kind,
        target: p.target === undefined ? "hero" : target(p.target),
      };
    case "ritual.answer":
      exact(p, ["challengeId", "optionId"], ["challengeId", "optionId"]);
      if (
        typeof p.challengeId !== "string" ||
        p.challengeId.length > 100 ||
        typeof p.optionId !== "string" ||
        p.optionId.length > 100
      )
        fail("BAD_ANSWER");
      return p;
    default:
      fail("UNKNOWN_COMMAND");
  }
}
function target(t) {
  if (typeof t !== "string" || !(t === "hero" || /^u[1-9][0-9]{0,5}$/.test(t)))
    fail("INVALID_TARGET");
  return t;
}
