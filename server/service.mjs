import { createHash, randomInt } from "node:crypto";
import { OPPONENTS } from "../src/cards.mjs";
import { effectiveCardCost, legalActions } from "../src/engine.mjs";
import { DEFAULT_HERO_SKIN, HERO_SKINS } from "../src/hero-skins.mjs";
import { normalizeJourney } from "../src/reward-journey.mjs";
import { normalizeDifficulty } from "../src/combat-rating.mjs";
import { chooseMulligan } from "../src/opening.mjs";
import {
  id,
  createDuel,
  changeOpening,
  ritualChoices,
  applyRitual,
  applyCombat,
  chooseComputer,
  applyComputer,
  publicEvent,
} from "./duel-adapter.mjs";
import {
  versions,
  parseEnvelope,
  payload,
  fingerprint,
  fail,
  plain,
} from "./protocol.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex");
export const DRAW_ENGLISH_LIMIT = 2;
export const DRAW_ENGLISH_MS = 120000;
export function validatedCosmetic(journey, ownerId) {
  const base = { skinId: DEFAULT_HERO_SKIN, skinMode: "base" };
  if (journey === undefined) return base;
  try {
    const clean = normalizeJourney(journey, ownerId ? { ownerId } : {});
    return { skinId: clean.equipped.skinId, skinMode: clean.equipped.mode };
  } catch { return base; }
}
function computerCosmetic(botId) {
  const index = parseInt(hash(String(botId)).slice(0, 8), 16) % HERO_SKINS.length;
  return { skinId: HERO_SKINS[index].id, skinMode: "computer" };
}
export const DEFAULTS = Object.freeze({
  queueMs: 10000,
  openingMs: 60000,
  turnMs: 150000,
  questionMs: 120000,
  reconnectMs: 20000,
  abandonMs: 300000,
  finishedMs: 300000,
  sessionTtlMs: 7200000,
  roomTtlMs: 7200000,
  aiDelayMs: 420,
  maxSessions: 256,
  maxRooms: 128,
  commandRate: 30,
  receiptLimit: 128,
});
export class GameService {
  constructor({ questions, send, config = {}, now = () => Date.now(), beforeCommand=()=>{}, onChallenge=()=>{}, onLearning=()=>true, onResult=()=>true, computerFor=null, cosmeticFor=null } = {}) {
    this.questions = questions;
    this.send = send;
    this.config = { ...DEFAULTS, ...config };
    this.now = now;
    this.beforeCommand=beforeCommand;this.onChallenge=onChallenge;this.onLearning=onLearning;this.onResult=onResult;this.computerFor=computerFor;
    this.cosmeticFor=cosmeticFor;
    this.sessions = new Map();
    this.tokenIndex = new Map();
    this.rooms = new Map();
    this.queues = new Map();
    this.closed = false;
    this.sweepTimer = setInterval(
      () => this.sweep(),
      Math.min(1000, this.config.sessionTtlMs / 2),
    );
    this.sweepTimer.unref?.();
  }
  makeSession(ws) {
    const playerId = ws.player?.playerId ?? null;
    if (playerId) {
      for (const prior of [...this.sessions.values()])
        if (prior.playerId === playerId && this.now() - prior.createdAt >= this.config.sessionTtlMs) this.expireSession(prior);
      const existing = [...this.sessions.values()].find(s => s.playerId === playerId && this.now() - s.createdAt < this.config.sessionTtlMs);
      if (existing) {
        if(existing.roomId && this.rooms.get(existing.roomId)?.phase==='finished')existing.roomId=null;
        const token = id(32);
        this.tokenIndex.delete(existing.tokenHash);
        existing.tokenHash = hash(token); this.tokenIndex.set(existing.tokenHash, existing.id);
        return this.resume(token, ws, token);
      }
    }
    if (this.sessions.size >= this.config.maxSessions) fail("SERVER_BUSY");
    const token = id(32),
      sessionId = id(),
      name = ws.player?.name?.slice(0, 48) ||
        ["Willow", "Maple", "Clover", "Nova", "River", "Aspen"][randomInt(6)] +
        " " +
        randomInt(4096).toString(16).toUpperCase().padStart(3, "0");
    const s = {
      id: sessionId,
      name,
      playerId,
      avatar: randomInt(6),
      tokenHash: hash(token),
      createdAt: this.now(),
      lastSeen: this.now(),
      ws: null,
      epoch: 0,
      nextSeq: 1,
      receipts: new Map(),
      seqIds: new Map(),
      roomId: null,
      queue: null,
      rate: [],
    };
    this.sessions.set(sessionId, s);
    this.tokenIndex.set(s.tokenHash, sessionId);
    this.attach(s, ws);
    this.send(ws, {
      type: "session.ready",
      sessionId,
      roomId: null,
      name,
      ...(playerId ? {playerId, identityKind: ws.player.kind} : {}),
      resumeToken: token,
      nextClientSeq: s.nextSeq,
      connectionEpoch: s.epoch,
      ...versions,
    });
    return s;
  }
  resume(token, ws, rotatedToken) {
    if (typeof token !== "string" || token.length < 32 || token.length > 100)
      fail("INVALID_SESSION");
    const sid = this.tokenIndex.get(hash(token)),
      s = this.sessions.get(sid);
    if (!s || this.now() - s.createdAt >= this.config.sessionTtlMs)
      fail("SESSION_EXPIRED");
    if ((s.playerId || ws.player?.playerId) && s.playerId !== ws.player?.playerId) fail('INVALID_SESSION');
    if (ws.player?.name) s.name = ws.player.name.slice(0, 48);
    if (s.roomId && !this.rooms.has(s.roomId)) s.roomId = null;
    this.attach(s, ws);
    this.send(ws, {
      type: "session.ready",
      sessionId: s.id,
      roomId: s.roomId,
      name: s.name,
      ...(s.playerId ? {playerId: s.playerId, identityKind: ws.player.kind} : {}),
      ...(rotatedToken ? {resumeToken: rotatedToken} : {}),
      resumed: true,
      nextClientSeq: s.nextSeq,
      connectionEpoch: s.epoch,
      ...versions,
    });
    if (s.queue)
      this.send(ws, {
        type: "queue.status",
        status: "waiting",
        matchBy: s.queue.deadline,
        bank: s.queue.options.bank ?? "school",
        grade: s.queue.options.grade,
        course: s.queue.options.course,
      });
    const r = this.rooms.get(s.roomId);
    if (r) {
      const seat = this.seat(r, s),
        member = r.seats[seat];
      this.clearTimer(r, "grace" + seat);
      this.clearTimer(r, "abandon");
      if (member.controller === "proxy") this.requestHumanControl(r, seat);
      this.snapshot(r, s, true);
      if (r.phase === "playing" && member.pending) this.sendChallenge(r, seat);
      this.replayFeedback(r, seat);
      this.broadcast(r, null, { exclude: s.id });
      this.maybeAI(r);
    }
    return s;
  }
  attach(s, ws) {
    const old = s.ws;
    s.epoch++;
    s.ws = ws;
    s.lastSeen = this.now();
    ws.sessionId = s.id;
    ws.sessionEpoch = s.epoch;
    if (old && old !== ws) {
      this.send(old, { type: "session.replaced" });
      old.close(4001, "Session resumed elsewhere");
    }
  }
  detach(ws) {
    const s = this.sessions.get(ws.sessionId);
    if (!s || s.ws !== ws || s.epoch !== ws.sessionEpoch) return;
    s.ws = null;
    s.lastSeen = this.now();
    if (s.queue) this.cancelQueue(s, "disconnected");
    const r = this.rooms.get(s.roomId);
    if (!r || r.phase === "finished") return;
    const side = this.seat(r, s);
    this.broadcast(r, null);
    if (!this.anyHumanConnected(r)) {
      this.clearTimer(r, "ai");
      this.timer(r, "abandon", this.config.abandonMs, () => {
        if (!this.anyHumanConnected(r)) this.finish(r, null, "abandoned");
      });
    }
    this.timer(r, "grace" + side, this.config.reconnectMs, () => {
      if (!this.connected(r.seats[side]) && r.phase !== "finished") {
        this.takeOver(r, side, "disconnected");
        this.maybeAI(r);
      }
    });
  }
  seat(r, s) {
    const seat = r.seats.findIndex((m) => m.sessionId === s.id);
    if (seat < 0) fail("NOT_YOUR_ROOM");
    return seat;
  }
  connected(member) {
    if (member.controller === "bot") return true;
    const s = this.sessions.get(member.sessionId);
    return Boolean(s?.ws && s.ws.readyState === 1);
  }
  anyHumanConnected(r) {
    return r.seats.some((m) => m.sessionId && this.connected(m));
  }
  timer(r, key, ms, fn) {
    this.clearTimer(r, key);
    const timer = setTimeout(
      () => {
        if (r.timers.get(key) !== timer || !this.rooms.has(r.id) || this.closed)
          return;
        r.timers.delete(key);
        try {
          fn();
        } catch {
          this.finish(r, null, "server_error");
        }
      },
      Math.max(0, ms),
    );
    timer.unref?.();
    r.timers.set(key, timer);
  }
  clearTimer(r, key) {
    const t = r.timers.get(key);
    if (t) clearTimeout(t);
    r.timers.delete(key);
    if (key === "ai") r.aiPlan = null;
  }
  ack(s, c, ok, code, extra = {}) {
    const m = {
      type: "command.ack",
      commandId: c?.commandId,
      clientSeq: c?.clientSeq,
      ok,
      ...(code ? { code } : {}),
      nextClientSeq: s.nextSeq,
      ...extra,
    };
    this.send(s.ws, m);
    return m;
  }
  command(ws, raw) {
    const s = this.sessions.get(ws.sessionId);
    if (!s || s.ws !== ws || s.epoch !== ws.sessionEpoch) {
      this.send(ws, { type: "session.error", code: "STALE_CONNECTION" });
      return;
    }
    if (this.now() - s.createdAt >= this.config.sessionTtlMs) {
      this.send(ws, { type: "session.error", code: "SESSION_EXPIRED" });
      this.expireSession(s);
      return;
    }
    s.lastSeen = this.now();
    let c;
    try {
      c = parseEnvelope(raw);
    } catch (e) {
      this.ack(s, raw, false, e.code || "BAD_ENVELOPE");
      return;
    }
    const digest = fingerprint(c),
      prior = s.receipts.get(c.commandId);
    if (prior) {
      if (prior.digest !== digest) {
        this.ack(s, c, false, "SEQ_REUSE");
        return;
      }
      this.send(s.ws, { ...prior.ack, nextClientSeq: s.nextSeq });
      const r = this.rooms.get(s.roomId);
      if (r) this.snapshot(r, s, true);
      if (prior.feedback)
        this.send(s.ws, { ...prior.feedback, replayed: true });
      return;
    }
    if (c.clientSeq !== s.nextSeq) {
      this.ack(
        s,
        c,
        false,
        c.clientSeq < s.nextSeq ? "ALREADY_PROCESSED_RESYNC" : "SEQ_GAP",
      );
      return;
    }
    const now = this.now();
    s.rate = s.rate.filter((t) => now - t < 1000);
    if (s.rate.length >= this.config.commandRate) {
      this.ack(s, c, false, "RATE_LIMIT", { retryAfterMs: 1000 });
      return;
    }
    s.rate.push(now);
    s.nextSeq++;
    let response;
    try {
      const p = payload(c);
      this.beforeCommand(s,c,p);
      const r = this.dispatch(s, c, p);
      response = this.ack(s, c, true, null, r ? { revision: r.revision } : {});
    } catch (e) {
      response = this.ack(
        s,
        c,
        false,
        e.code || e.message || "COMMAND_REJECTED",
      );
      if (
        [
          "STALE_STATE",
          "ALREADY_MATCHED",
          "OPENING_COMPLETE",
          "NOT_YOUR_TURN",
          "CHALLENGE_PENDING",
        ].includes(response.code)
      ) {
        const r = this.rooms.get(s.roomId);
        if (r) this.snapshot(r, s, true);
      }
    }
    const resolvedRoom = this.rooms.get(c.roomId),
      ownerSide = resolvedRoom?.seats.findIndex((m) => m.sessionId === s.id);
    const privateFeedback =
      ["ritual.answer", "draw.answer", "draw.cancel"].includes(c.type) && response.ok && ownerSide >= 0
        ? resolvedRoom.seats[ownerSide].feedbacks.get(c.payload.challengeId)
        : null;
    s.receipts.set(c.commandId, {
      digest,
      ack: response,
      roomId: c.roomId,
      ...(privateFeedback ? { feedback: privateFeedback } : {}),
    });
    s.seqIds.set(c.clientSeq, c.commandId);
    while (s.receipts.size > this.config.receiptLimit) {
      const first = s.receipts.keys().next().value,
        entry = s.receipts.get(first);
      s.seqIds.delete(entry.ack.clientSeq);
      s.receipts.delete(first);
    }
  }
  requireRoom(s, c, { opening = false, resync = false } = {}) {
    const r = this.rooms.get(c.roomId);
    if (!r || s.roomId !== r.id) fail("NOT_YOUR_ROOM");
    const side = this.seat(r, s);
    if (!resync) {
      if (!Number.isSafeInteger(c.expectedRevision))
        fail("EXPECTED_REVISION_REQUIRED");
      // The other side's opening confirmation cannot change this side's hand.
      // Both clients may safely confirm the same opening revision concurrently.
      const stale =
        c.expectedRevision !== r.revision &&
        !(
          opening &&
          r.phase === "opening" &&
          !r.confirmed[side] &&
          c.expectedRevision >= 0 &&
          c.expectedRevision <= r.revision
        );
      if (stale) fail("STALE_STATE");
    }
    return { r, side };
  }
  dispatch(s, c, p) {
    if (c.type === "queue.join") {
      this.join(s, p);
      return;
    }
    if (c.type === "queue.cancel") {
      if (s.roomId && this.rooms.get(s.roomId)?.phase !== "finished")
        fail("ALREADY_MATCHED");
      this.cancelQueue(s, "cancelled");
      return;
    }
    const { r, side } = this.requireRoom(s, c, {
        opening: c.type === "opening.choose",
        resync: c.type === "room.resync",
      }),
      m = r.seats[side];
    if (c.type === "room.resync") {
      this.snapshot(r, s, true);
      if (r.phase === "playing" && m.pending) this.sendChallenge(r, side);
      return r;
    }
    if (r.phase === "finished") fail("ROOM_FINISHED");
    if (c.type === "room.resign") {
      this.finish(r, 1 - side, "resigned", side);
      return r;
    }
    if (c.type === "room.reclaim") {
      this.reclaim(r, side);
      return r;
    }
    if (c.type === "opening.choose") {
      if (r.phase !== "opening" || r.confirmed[side]) fail("OPENING_COMPLETE");
      r.state = changeOpening(r.state, side, p.indices);
      r.confirmed[side] = true;
      const ready = r.confirmed.every(Boolean);
      if (ready) {
        r.phase = "playing";
        this.clearTimer(r, "opening");
        this.startDeadline(r);
      }
      this.commit(r, r.state, {
        kind: ready ? "match_start" : "opening",
        actorSeat: side,
        confirmed: true,
      });
      this.maybeAI(r);
      return r;
    }
    if (r.phase !== "playing") fail("OPENING_PENDING");
    if (["ritual.answer", "draw.answer", "draw.cancel"].includes(c.type)) {
      if (r.state.active !== side) fail("NOT_YOUR_TURN");
      if (!m.pending || m.pending.challengeId !== p.challengeId)
        fail("INVALID_CHALLENGE");
      if (m.controller !== "human") fail("AI_CONTROLLED");
      if ((c.type.startsWith("draw.") ? "draw" : "ritual") !== m.pendingContext?.purpose)
        fail("INVALID_CHALLENGE");
      if (this.now() >= m.pending.expiresAt) {
        this.resolveQuestion(r, side, null, true);
        fail("CHALLENGE_EXPIRED");
      }
      if (c.type === "draw.cancel") {
        this.resolveQuestion(r, side, null, false, true);
        return r;
      }
      const feedback = this.questions.answer(m.pending, p.optionId, this.now());
      this.noteHumanTurn(r, side);
      this.resolveQuestion(r, side, feedback, false);
      return r;
    }
    if (r.state.active !== side) fail("NOT_YOUR_TURN");
    if (m.controller !== "human") fail("AI_CONTROLLED");
    if (m.pending) fail("CHALLENGE_PENDING");
    if (this.now() >= r.turnDeadline) {
      this.onTurnTimeout(r);
      fail("TURN_EXPIRED");
    }
    if (c.type === "ritual.begin") {
      if (m.englishTurn === r.state.turn) fail("ENGLISH_ALREADY_USED");
      if (
        !ritualChoices(r.state, side).some(
          (x) => x.kind === p.kind && x.target === p.target,
        )
      )
        fail("ILLEGAL_RITUAL");
      const expiresAt = Math.max(
        r.turnDeadline,
        this.now() + this.config.questionMs,
      );
      const question = this.questions.issue({
        deck: m.questionDeck,
        cursor: m.learning.cursor,
        kind: p.kind,
        target: p.target,
        expiresAt,
      });
      this.beginQuestion(r, side, question, { purpose: "ritual" });
      this.noteHumanTurn(r, side);
      m.englishTurn = r.state.turn;
      m.combatTurn = r.state.turn;
      r.turnDeadline = expiresAt;
      this.scheduleTurn(r);
      this.commit(r, r.state, { kind: "ritual_begin", actorSeat: side });
      this.sendChallenge(r, side);
      return r;
    }
    if (c.type === "draw.begin") {
      if (!this.canBeginDraw(r, side)) fail("DRAW_ENGLISH_UNAVAILABLE");
      if (this.wireHandId(r, side, m.naturalHandId) !== p.handId)
        fail("INVALID_HAND_INSTANCE");
      const question = this.questions.issue({
        deck: m.questionDeck, cursor: m.learning.cursor,
        kind: "insight", target: null, expiresAt: this.now() + DRAW_ENGLISH_MS,
      });
      this.beginQuestion(r, side, question, { purpose: "draw", handId: m.naturalHandId, turn: r.state.turn });
      this.noteHumanTurn(r, side);
      m.drawChargesLeft--;
      m.englishTurn = r.state.turn;
      const next = structuredClone(r.state);
      next.players[side].ritualUsed = true;
      next.seq++;
      this.timer(r, "challenge" + side, question.expiresAt - this.now(), () => {
        if (m.pending?.challengeId === question.challengeId) this.resolveQuestion(r, side, null, true);
      });
      this.commit(r, next, { kind: "draw_begin", actorSeat: side });
      this.sendChallenge(r, side);
      return r;
    }
    if (c.type === "battle.action") {
      const before = r.state,
        next = applyCombat(before, p.action);
      if (next === before) fail("ILLEGAL_ACTION");
      this.noteHumanTurn(r, side);
      if (["play", "attack"].includes(p.action.type)) {
        m.ownActions++;
        m.combatTurn = r.state.turn;
      }
      this.commit(r, next, publicEvent(before, next, p.action, side));
      this.maybeAI(r);
      return r;
    }
    fail("UNKNOWN_COMMAND");
  }
  noteHumanTurn(r, side) {
    const m = r.seats[side];
    if (m.controller === "human" && r.phase === "playing" && r.state.active === side)
      m.humanTurns.add(r.state.turn);
  }
  wireHandId(r, side, handId) {
    return handId ? "c" + hash(`${r.id}:${r.seats[side].handSalt}:${handId}`).slice(0, 32) : null;
  }
  canBeginDraw(r, side) {
    const m = r.seats[side], p = r.state.players[side];
    return r.phase === "playing" && r.state.active === side && m.controller === "human" &&
      !m.pending && m.drawChargesLeft > 0 && r.state.turn >= side + 3 &&
      m.englishTurn !== r.state.turn && !p.ritualUsed && m.combatTurn !== r.state.turn &&
      this.now() + DRAW_ENGLISH_MS <= r.turnDeadline &&
      Boolean(m.naturalHandId && p.handIds.includes(m.naturalHandId));
  }
  beginQuestion(r, side, question, context) {
    const m = r.seats[side], issuedAt = this.now();
    // Register the trusted source before changing room state, so a failed
    // persistence precondition cannot leave an unacknowledged pending command.
    if (m.playerId) this.onChallenge(m.playerId, question.challengeId, issuedAt, { source: "match" });
    m.pending = question;
    m.pendingContext = { ...context, issuedAt };
    m.learning.cursor++;
  }
  queueKey(p) {
    return [p.ruleset, p.combatRules, p.contentVersion, p.bank ?? "school", p.grade, p.course].join(
      "|",
    );
  }
  join(s, options) {
    if (this.now() - s.createdAt >= this.config.sessionTtlMs) {
      this.expireSession(s); fail('SESSION_EXPIRED');
    }
    if (s.playerId) for (const other of [...this.sessions.values()]) {
      if (other.id === s.id || other.playerId !== s.playerId) continue;
      if (this.now() - other.createdAt >= this.config.sessionTtlMs) { this.expireSession(other); continue; }
      if (other.queue || other.roomId && this.rooms.get(other.roomId)?.phase !== 'finished') fail('PLAYER_ALREADY_ACTIVE');
    }
    this.questions.createDeck({ bank: options.bank, grade: options.grade, course: options.course });
    if (s.roomId) {
      const r = this.rooms.get(s.roomId);
      if (r && r.phase !== "finished") fail("ALREADY_MATCHED");
      s.roomId = null;
    }
    if (s.queue) fail("ALREADY_QUEUED");
    const key = this.queueKey(options),
      list = this.queues.get(key) || [];
    let other;
    while (list.length) {
      const sid = list.shift(),
        candidate = this.sessions.get(sid);
      if (candidate && this.now() - candidate.createdAt >= this.config.sessionTtlMs) { this.expireSession(candidate); continue; }
      if (
        candidate &&
        candidate.id !== s.id &&
        !(s.playerId && candidate.playerId === s.playerId) &&
        candidate.queue?.key === key &&
        candidate.ws?.readyState === 1
      ) {
        other = candidate;
        break;
      }
    }
    this.queues.set(key, list);
    if (other) {
      const otherOptions = other.queue.options;
      this.removeQueue(other);
      this.makeRoom([
        { session: other, options: otherOptions },
        { session: s, options },
      ]);
      return;
    }
    const ticket = id(8),
      deadline = this.now() + this.config.queueMs;
    s.queue = {
      key,
      ticket,
      deadline,
      options,
      timer: setTimeout(() => {
        if (s.queue?.ticket !== ticket || !s.ws || this.closed) return;
        this.removeQueue(s);
        const op = OPPONENTS[randomInt(OPPONENTS.length)];
        this.makeRoom([
          { session: s, options },
          { bot: op, options: { ...options, deckId: op.deck } },
        ]);
      }, this.config.queueMs),
    };
    s.queue.timer.unref?.();
    list.push(s.id);
    this.queues.set(key, list);
    this.send(s.ws, {
      type: "queue.status",
      status: "waiting",
      matchBy: deadline,
      bank: options.bank ?? "school",
      grade: options.grade,
      course: options.course,
    });
  }
  removeQueue(s) {
    if (!s.queue) return;
    const q = s.queue;
    clearTimeout(q.timer);
    const list = this.queues.get(q.key) || [];
    this.queues.set(
      q.key,
      list.filter((id) => id !== s.id),
    );
    if (!this.queues.get(q.key).length) this.queues.delete(q.key);
    s.queue = null;
  }
  cancelQueue(s, status) {
    this.removeQueue(s);
    this.send(s.ws, {
      type: "queue.status",
      status: status === "cancelled" ? "cancelled" : "cancelled",
      reason: status,
    });
  }
  makeRoom(entries) {
    const humans = entries.filter(e => e.session).map(e => e.session);
    const expired = humans.filter(s => this.sessions.get(s.id) !== s || this.now() - s.createdAt >= this.config.sessionTtlMs);
    const players = humans.map(s => s.playerId).filter(Boolean);
    const duplicate = new Set(humans.map(s => s.id)).size !== humans.length || new Set(players).size !== players.length;
    if (expired.length || duplicate) {
      for (const s of expired) this.expireSession(s);
      for (const s of humans) if (this.sessions.has(s.id)) {
        this.removeQueue(s);
        this.send(s.ws, {type:'queue.status',status:'cancelled',reason:duplicate?'IDENTITY_CONFLICT':'SESSION_EXPIRED'});
      }
      return;
    }
    if (this.rooms.size >= this.config.maxRooms) {
      for (const e of entries)
        if (e.session) {
          this.removeQueue(e.session);
          this.send(e.session.ws, {
            type: "queue.status",
            status: "cancelled",
            reason: "SERVER_BUSY",
          });
        }
      return;
    }
    if (randomInt(2)) entries.reverse();
    const computerSeat = entries.findIndex((e) => e.bot);
    let computer=null;
    const cosmetics = new Map();
    try {
      if(computerSeat>=0)computer=normalizeDifficulty(this.computerFor ? this.computerFor(humans[0]) : this.config.computerDifficulty);
      for (const session of humans)
        cosmetics.set(session.id, validatedCosmetic(this.cosmeticFor?.(session), session.playerId));
    } catch {
      for(const s of humans){this.removeQueue(s);this.send(s.ws,{type:'queue.status',status:'cancelled',reason:'PROGRESS_UNAVAILABLE'});}
      return;
    }
    const opts = entries[0].options,
      roomId = id();
    const r = {
      id: roomId,
      revision: 0,
      mode: entries.some((e) => e.bot) ? "pve" : "pvp",
      assisted: false,
      phase: "opening",
      state: createDuel(
        entries.map((e) => e.options.deckId),
        {
          computerSeat,
          computer,
          customDecks: entries.map((e) => e.options.customDeck),
        },
      ),
      computer,
      bank: opts.bank ?? "school",
      grade: opts.grade,
      course: opts.course,
      createdAt: this.now(),
      startedAt: null,
      finishedAt: null,
      confirmed: [false, false],
      openingDeadline: this.now() + this.config.openingMs,
      turnDeadline: null,
      event: null,
      timers: new Map(),
      aiPlan: null,
      result: null,
    };
    r.seats = entries.map((e) => ({
      sessionId: e.session?.id || null,
      name: e.bot?.name || e.session.name,
      avatar: e.bot?.art ?? e.session.avatar,
      ...(e.bot ? computerCosmetic(e.bot.id) : cosmetics.get(e.session.id)),
      controller: e.bot ? "bot" : "human",
      style: e.bot?.style || "control",
      botId: e.bot?.id || null,
      deckId: e.options.deckId,
      controlEpoch: 0,
      proxyActed: false,
      wantsHuman: false,
      pending: null,
      pendingContext: null,
      handSalt: id(24),
      naturalHandId: null,
      drawChargesLeft: DRAW_ENGLISH_LIMIT,
      englishTurn: null,
      combatTurn: null,
      humanTurns: new Set(),
      ownActions: 0,
      finalParticipation: null,
      feedbacks: new Map(),
      playerId: e.session?.playerId ?? null,
      questionDeck: this.questions.createDeck({
        bank: r.bank,
        grade: r.grade,
        course: r.course,
      }),
      learning: { cursor: 0, attempts: 0, correct: 0 },
    }));
    this.rooms.set(r.id, r);
    entries.forEach((e) => {
      if (e.session) {
        this.removeQueue(e.session);
        e.session.roomId = r.id;
      }
    });
    for (let side = 0; side < 2; side++)
      if (r.seats[side].controller === "bot") {
        r.state = changeOpening(
          r.state,
          side,
          chooseMulligan(r.state.players[side].hand, r.seats[side].style),
        );
        r.confirmed[side] = true;
      }
    this.timer(r, "opening", this.config.openingMs, () => {
      if (r.phase !== "opening") return;
      for (let side = 0; side < 2; side++)
        if (!r.confirmed[side]) {
          r.state = changeOpening(r.state, side, []);
          r.confirmed[side] = true;
        }
      r.phase = "playing";
      this.startDeadline(r);
      this.commit(r, r.state, { kind: "match_start", automatic: true });
      this.maybeAI(r);
    });
    this.broadcast(r, null);
  }
  startDeadline(r) {
    if (r.startedAt === null) r.startedAt = this.now();
    r.turnDeadline = this.now() + this.config.turnMs;
    this.scheduleTurn(r);
  }
  scheduleTurn(r) {
    this.timer(r, "turn", r.turnDeadline - this.now(), () =>
      this.onTurnTimeout(r),
    );
  }
  onTurnTimeout(r) {
    if (r.phase !== "playing") return;
    const side = r.state.active;
    if (r.seats[side].pending) this.resolveQuestion(r, side, null, true);
    if (r.phase === "playing" && r.state.active === side) {
      this.takeOver(r, side, "turn_timeout");
      this.maybeAI(r);
    }
  }
  sendChallenge(r, side) {
    const m = r.seats[side],
      s = this.sessions.get(m.sessionId);
    if (s?.ws && m.pending)
      this.send(s.ws, {
        type: "private.challenge",
        roomId: r.id,
        revision: r.revision,
        ...this.questions.toPublic(m.pending),
        purpose: m.pendingContext.purpose,
        issuedAt: m.pendingContext.issuedAt,
        ...(m.pendingContext.purpose === "draw" ? {
          kind: "draw", handId: this.wireHandId(r, side, m.pendingContext.handId),
        } : {}),
      });
  }
  resolveQuestion(r, side, feedback, timedOut, cancelled = false) {
    const m = r.seats[side],
      q = m.pending;
    if (!q) return;
    if (m.pendingContext?.purpose === "draw") {
      this.resolveDrawQuestion(r, side, feedback, timedOut, cancelled);
      return;
    }
    const before = r.state;
    const correct = !timedOut && feedback.outcome === "correct",
      next = applyRitual(before, side, q.kind, correct, q.target || "hero");
    if (next === before) {
      m.pending = null;
      fail("RITUAL_STATE_CHANGED");
    }
    m.pending = null;
    m.pendingContext = null;
    if (!timedOut) {
      m.learning.attempts++;
      if (correct) m.learning.correct++;
    }
    const event = publicEvent(
      before,
      next,
      { type: "ritual", kind: q.kind, target: q.target },
      side,
    );
    if (!correct) {
      delete event.targetUid;
      event.targetSeat = side;
      event.effect = "armor";
    } else event.effect = q.kind;
    this.commit(r, next, {
      ...event,
      outcome: timedOut ? "unanswered" : correct ? "correct" : "wrong",
    });
    const privateFeedback = {
      type: "private.feedback",
      roomId: r.id,
      revision: r.revision,
      challengeId: q.challengeId,
      ...(timedOut ? { outcome: "unanswered" } : feedback),
    };
    if (!timedOut && m.playerId) privateFeedback.progressSaved = this.onLearning(m.playerId,privateFeedback) !== false;
    m.feedbacks.set(q.challengeId, privateFeedback);
    while (m.feedbacks.size > 4)
      m.feedbacks.delete(m.feedbacks.keys().next().value);
    const s = this.sessions.get(m.sessionId);
    if (s?.ws) this.send(s.ws, privateFeedback);
    this.maybeAI(r);
  }
  resolveDrawQuestion(r, side, feedback, timedOut, cancelled) {
    const m = r.seats[side], q = m.pending, context = m.pendingContext;
    const validInstance = r.phase === "playing" && r.state.active === side &&
      r.state.turn === context.turn && r.state.players[side].handIds.includes(context.handId);
    const correct = validInstance && !timedOut && !cancelled && feedback?.outcome === "correct";
    const next = structuredClone(r.state);
    if (correct) {
      const p = next.players[side];
      p.handBoosts ??= {};
      p.handBoosts[context.handId] = { turn: next.turn, amount: 1 };
    }
    next.seq++;
    m.pending = null;
    m.pendingContext = null;
    this.clearTimer(r, "challenge" + side);
    if (!timedOut && !cancelled) {
      m.learning.attempts++;
      if (correct) m.learning.correct++;
    }
    const outcome = cancelled ? "cancelled" : timedOut ? "unanswered" : correct ? "correct" : "wrong";
    // Public events never reveal which card was drawn or its private instance.
    this.commit(r, next, { kind: "draw_english", actorSeat: side, outcome, changes: [] });
    const privateFeedback = {
      type: "private.feedback", roomId: r.id, revision: r.revision,
      challengeId: q.challengeId, purpose: "draw",
      handId: this.wireHandId(r, side, context.handId),
      ...(timedOut || cancelled ? { outcome } : feedback),
      discountGranted: correct,
    };
    if (!timedOut && !cancelled && m.playerId)
      privateFeedback.progressSaved = this.onLearning(m.playerId, privateFeedback) !== false;
    m.feedbacks.set(q.challengeId, privateFeedback);
    while (m.feedbacks.size > 4) m.feedbacks.delete(m.feedbacks.keys().next().value);
    const s = this.sessions.get(m.sessionId);
    if (s?.ws) this.send(s.ws, privateFeedback);
    this.maybeAI(r);
  }
  replayFeedback(r, side) {
    const m = r.seats[side],
      s = this.sessions.get(m.sessionId);
    if (s?.ws)
      for (const feedback of m.feedbacks.values())
        this.send(s.ws, { ...feedback, replayed: true });
  }
  takeOver(r, side, reason) {
    const m = r.seats[side];
    if (m.controller === "bot") return;
    m.controller = "proxy";
    m.controlEpoch++;
    m.wantsHuman = false;
    m.proxyActed = false;
    r.assisted = true;
    this.broadcast(r, null, {
      notice: { kind: "controller", seat: side, controller: "proxy", reason },
    });
  }
  requestHumanControl(r, side) {
    const m = r.seats[side];
    if (m.controller !== "proxy") return;
    const expiredActiveTurn =
      r.phase === "playing" &&
      r.state.active === side &&
      this.now() >= r.turnDeadline;
    // A timed-out turn is completed by its proxy. Reclaiming it cannot create
    // an untimed human turn, nor repeatedly refund time before the proxy acts.
    if (!m.proxyActed && !expiredActiveTurn) {
      m.controller = "human";
      m.controlEpoch++;
      m.wantsHuman = false;
      if (r.state.active === side) this.clearTimer(r, "ai");
    } else m.wantsHuman = true;
  }
  reclaim(r, side) {
    this.requestHumanControl(r, side);
    this.broadcast(r, null);
    this.maybeAI(r);
  }
  maybeAI(r) {
    if (r.phase !== "playing" || !this.anyHumanConnected(r)) return;
    const side = r.state.active,
      m = r.seats[side];
    if (!["bot", "proxy"].includes(m.controller) || m.pending) return;
    const revision = r.revision,
      epoch = m.controlEpoch;
    if (
      r.timers.has("ai") &&
      r.aiPlan?.revision === revision &&
      r.aiPlan?.epoch === epoch &&
      r.aiPlan?.side === side
    )
      return;
    this.timer(r, "ai", this.config.aiDelayMs, () => {
      if (
        r.phase !== "playing" ||
        r.state.active !== side ||
        r.revision !== revision ||
        m.controlEpoch !== epoch ||
        !["bot", "proxy"].includes(m.controller) ||
        m.pending ||
        !this.anyHumanConnected(r)
      )
        return;
      const before = r.state,
        a = chooseComputer(
          before,
          side,
          m.style,
          m.controller === "bot" && m.englishTurn !== r.state.turn,
          m.controller === "bot" ? r.computer : "tactical",
        ),
        next = applyComputer(before, side, a);
      if (next === before) {
        this.finish(r, null, "server_error");
        return;
      }
      if (m.controller === "proxy") m.proxyActed = true;
      if (a.type === "power") m.englishTurn = r.state.turn;
      if (["play", "attack", "power"].includes(a.type)) m.combatTurn = r.state.turn;
      this.commit(
        r,
        next,
        publicEvent(
          before,
          next,
          a.type === "power" ? { ...a, type: "ritual" } : a,
          side,
        ),
      );
      this.maybeAI(r);
    });
    r.aiPlan = { revision, epoch, side };
  }
  commit(r, next, event) {
    const oldActive = r.state.active;
    const priorState = r.state;
    r.state = next;
    // A completed battle cannot keep an answerable private challenge alive.
    // Cancelling it grants no armor, no effect and no learning mistake.
    if (next.phase === "finished" || r.phase === "finished")
      for (const member of r.seats) { member.pending = null; member.pendingContext = null; }
    r.revision++;
    r.event = {
      ...event,
      eventId: `${r.id}:${r.revision}`,
      revision: r.revision,
    };
    if (next.phase === "finished" && r.phase !== "finished") {
      r.phase = "finished";
      r.finishedAt = this.now();
      r.result = {
        winnerSeat: typeof next.winner === "number" ? next.winner : null,
        reason: next.winner === "draw" ? "draw" : "health",
        rounds: Math.ceil(next.turn / 2),
        mode: r.mode,
        assisted: r.assisted,
      };
      this.stopRoomTimers(r);
      this.timer(r, "expiry", this.config.finishedMs, () => this.expire(r));
    } else if (r.phase === "playing" && oldActive !== next.active) {
      const m = r.seats[next.active];
      // Only the engine's turn transition is a natural draw. Insight,
      // kingfisher and recall occur without changing the active seat.
      const previous = new Set(priorState.players[next.active].handIds);
      m.naturalHandId = next.players[next.active].handIds.find(handId => !previous.has(handId)) ?? null;
      if (m.wantsHuman && this.connected(m)) {
        m.controller = "human";
        m.controlEpoch++;
        m.proxyActed = false;
        m.wantsHuman = false;
      }
      this.startDeadline(r);
    }
    if (r.phase === 'finished') for (let side=0;side<r.seats.length;side++) {
      const m = r.seats[side];
      m.finalParticipation ??= Object.freeze({ startedAt: r.startedAt ?? r.createdAt,
        ownTurns: m.humanTurns.size, ownActions: m.ownActions });
      const playerId=r.seats[side].playerId;
      if(playerId)this.onResult(playerId,this.view(r,side));
    }
    this.broadcast(r, r.event);
    if (r.phase === "finished")
      for (let side = 0; side < 2; side++) {
        const s = this.sessions.get(r.seats[side].sessionId);
        if (s?.roomId === r.id)
          this.send(s.ws, {
            type: "room.finished",
            roomId: r.id,
            revision: r.revision,
            result: this.resultFor(r, side),
          });
      }
  }
  finish(r, winner, reason, actorSeat) {
    if (r.phase === "finished") return;
    const s = structuredClone(r.state);
    s.phase = "finished";
    s.winner = winner;
    r.result = {
      winnerSeat: winner,
      reason,
      rounds: Math.ceil(s.turn / 2),
      mode: r.mode,
      assisted: r.assisted,
    };
    r.phase = "finished";
    r.finishedAt = this.now();
    this.stopRoomTimers(r);
    this.commit(r, s, {
      kind: "finished",
      ...(actorSeat !== undefined ? { actorSeat } : {}),
      reason,
    });
    this.timer(r, "expiry", this.config.finishedMs, () => this.expire(r));
  }
  resultFor(r, side) {
    if (!r.result) return null;
    const p = r.state.players[side],
      l = r.seats[side].learning,
      win = r.result.winnerSeat === side,
      draw = r.result.reason === "draw";
    return {
      ...r.result,
      bank: r.bank,
      finishedAt: r.finishedAt,
      ...(r.computer ? { computer: { ...r.computer } } : {}),
      ownLearning: { attempts: l.attempts, correct: l.correct },
      ownScore: ["expired", "abandoned", "server_error", "resigned"].includes(
        r.result.reason,
      )
        ? 0
        : (win ? 600 : draw ? 300 : 100) +
          Math.max(0, p.hp) * 5 +
          Math.max(0, 140 - Math.ceil(r.state.turn / 2) * 8),
    };
  }
  view(r, side, { event = null, resync = false, notice } = {}) {
    const m = r.seats[side],
      canAct = r.phase === "playing" && r.state.active === side &&
        m.controller === "human" && !m.pending && this.now() < r.turnDeadline;
    const cardTargets = new Map();
    if (canAct) for (const action of legalActions(r.state)) {
      if (action.type !== "play") continue;
      let entry = cardTargets.get(action.index);
      if (!entry) {
        entry = { handId: this.wireHandId(r, side, r.state.players[side].handIds[action.index]),
          index: action.index, targets: [], untargeted: false };
        cardTargets.set(action.index, entry);
      }
      if (action.target === undefined) entry.untargeted = true;
      else entry.targets.push({ target: action.target,
        seat: action.target === "hero" ? 1 - side : r.state.players.findIndex(p => p.board.some(u => u.uid === action.target)) });
    }
    const players = r.state.players.map((p, i) => {
      const m = r.seats[i];
      return {
        seat: i,
        name: m.name,
        avatar: m.avatar,
        skinId: m.skinId,
        skinMode: m.skinMode,
        controller: m.controller,
        connected: this.connected(m),
        botId: m.botId,
        hp: p.hp,
        armor: p.armor,
        mana: p.mana,
        maxMana: p.maxMana,
        handCount: p.hand.length,
        deckCount: p.deck.length,
        board: p.board.map((u) => ({ ...u })),
        fatigue: p.fatigue,
        ritualUsed: p.ritualUsed || m.englishTurn === r.state.turn || Boolean(m.pending),
        ritualsLeft: Math.max(0, p.ritualsLeft - (m.pendingContext?.purpose === "ritual" ? 1 : 0)),
        ritualReserved: m.pendingContext?.purpose === "ritual",
        ...(i === side
          ? {
            deckId: m.deckId,
            hand: [...p.hand],
            handIds: p.handIds.map(handId => this.wireHandId(r, side, handId)),
            handCosts: p.hand.map((_, index) => effectiveCardCost(r.state, side, index)),
            handBoosts: Object.fromEntries(Object.entries(p.handBoosts ?? {})
              .filter(([handId, boost]) => p.handIds.includes(handId) && boost.turn === r.state.turn && r.state.active === side)
              .map(([handId, boost]) => [this.wireHandId(r, side, handId), { ...boost }])),
            legalCardTargets: [...cardTargets.values()],
            drawEnglish: {
              chargesLeft: m.drawChargesLeft, maxCharges: DRAW_ENGLISH_LIMIT,
              eligibleHandId: r.state.active === side && r.state.turn >= side + 3 && p.handIds.includes(m.naturalHandId)
                ? this.wireHandId(r, side, m.naturalHandId) : null,
              canBegin: this.canBeginDraw(r, side), usedThisTurn: m.englishTurn === r.state.turn || p.ritualUsed,
              pending: m.pendingContext?.purpose === "draw",
            },
            controlRequestPending: m.wantsHuman,
          }
          : {}),
      };
    });
    return {
      type: "room.snapshot",
      roomId: r.id,
      revision: r.revision,
      ...versions,
      rules: versions.ruleset,
      bank: r.bank,
      grade: r.grade,
      course: r.course,
      mode: r.mode,
      ...(r.computer ? { computer: { ...r.computer } } : {}),
      assisted: r.assisted,
      phase: r.phase,
      youSeat: side,
      activeSeat: r.state.active,
      turn: r.state.turn,
      serverTime: this.now(),
      turnDeadline: r.turnDeadline,
      openingDeadline: r.openingDeadline,
      canAct,
      canAnswer:
        r.phase === "playing" &&
        Boolean(m.pending) &&
        this.now() < m.pending.expiresAt,
      opening: {
        selfConfirmed: r.confirmed[side],
        opponentConfirmed: r.confirmed[1 - side],
        maxChanges: 2,
      },
      self: players[side],
      opponent: players[1 - side],
      state: {
        rules: versions.ruleset,
        phase: r.phase,
        active: r.state.active,
        turn: r.state.turn,
        seq: r.revision,
        winner: r.phase === "finished" ? (r.result?.winnerSeat ?? null) : null,
        players,
      },
      event: resync ? null : event,
      events: resync || !event ? [] : [event],
      resync,
      ...(notice ? { notice } : {}),
      ...(r.result ? { result: this.resultFor(r, side) } : {}),
      ...(m.finalParticipation ? { participation: { ...m.finalParticipation } } : {}),
    };
  }
  snapshot(r, s, resync = false) {
    this.send(s.ws, this.view(r, this.seat(r, s), { resync }));
  }
  broadcast(r, event, { exclude, notice } = {}) {
    for (let side = 0; side < 2; side++) {
      const s = this.sessions.get(r.seats[side].sessionId);
      if (s?.roomId === r.id && s.id !== exclude)
        this.send(s.ws, this.view(r, side, { event, notice }));
    }
  }
  stopRoomTimers(r) {
    for (const t of r.timers.values()) clearTimeout(t);
    r.timers.clear();
    r.aiPlan = null;
  }
  expire(r) {
    this.stopRoomTimers(r);
    for (const m of r.seats) {
      const s = this.sessions.get(m.sessionId);
      if (s) {
        for (const [key, receipt] of s.receipts)
          if (receipt.roomId === r.id) {
            s.seqIds.delete(receipt.ack.clientSeq);
            s.receipts.delete(key);
          }
        if (s.roomId === r.id) {
          s.roomId = null;
          this.send(s.ws, { type: "room.expired", roomId: r.id });
        }
      }
      m.pending = null;
      m.feedbacks.clear();
      m.questionDeck = [];
    }
    this.rooms.delete(r.id);
  }
  sweep() {
    const now = this.now();
    for (const r of this.rooms.values())
      if (now - r.createdAt >= this.config.roomTtlMs && r.phase !== "finished")
        this.finish(r, null, "expired");
    for (const s of this.sessions.values())
      if (now - s.createdAt >= this.config.sessionTtlMs) this.expireSession(s);
  }
  expireSession(s) {
    if (!this.sessions.has(s.id)) return;
    const socket = s.ws;
    if (socket) {
      socket.close(4003, "Session expired");
      this.detach(socket);
    }
    this.removeQueue(s);
    const r = this.rooms.get(s.roomId);
    if (r && r.phase !== "finished") {
      const side = this.seat(r, s);
      this.clearTimer(r, "grace" + side);
      this.takeOver(r, side, "session_expired");
      if (!this.anyHumanConnected(r))
        this.timer(r, "abandon", this.config.abandonMs, () => {
          if (!this.anyHumanConnected(r)) this.finish(r, null, "abandoned");
        });
      this.maybeAI(r);
    }
    this.tokenIndex.delete(s.tokenHash);
    this.sessions.delete(s.id);
  }
  close() {
    this.closed = true;
    clearInterval(this.sweepTimer);
    for (const r of this.rooms.values()) this.stopRoomTimers(r);
    for (const s of this.sessions.values()) this.removeQueue(s);
    this.rooms.clear();
    this.sessions.clear();
    this.tokenIndex.clear();
    this.queues.clear();
  }
}
