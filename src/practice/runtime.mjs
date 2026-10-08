// Public computer-only practice. Each tab owns one isolated game authority.
// No WebSocket, network matchmaking, accounts, or remote progress storage.
import { DuelConnection as Transport } from "../network/client.mjs";
import { GameService } from "../../server/service.mjs";
import { createQuestionService } from "../../server/questions.mjs";
import questions from "../questions.json";
import curriculum from "../curriculum.json";
import speechAssets from "../speech-assets.json";

export const isPractice = true;
const bank = createQuestionService({ questions, curriculum, speechAssets });
const study = new Map();
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(data) });
export async function studyFetch(url, options = {}) {
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (url === "/api/curriculum") return response(200, bank.metadata());
  const route = String(url).match(/^\/api\/study\/([a-zA-Z0-9_-]{1,80})(\/answer)?$/);
  if (!route) return response(404, { code: "NOT_FOUND" });
  try {
    for (const [id, item] of study) if (item.challenge.expiresAt <= Date.now()) study.delete(id);
    if (!route[2]) {
      if (study.size >= 512) return response(429, { code: "STUDY_BUSY" });
      const challenge = bank.issueStudy({ qid: route[1], expiresAt: Date.now() + 300000 });
      study.set(challenge.challengeId, { qid: route[1], challenge });
      return response(200, bank.toPublic(challenge));
    }
    const payload = JSON.parse(options.body);
    const item = study.get(payload.challengeId);
    if (!item || item.qid !== route[1]) return response(410, { code: "STUDY_EXPIRED" });
    if (item.feedback) return item.optionId === payload.optionId ? response(200, item.feedback) : response(409, { code: "ALREADY_ANSWERED" });
    item.feedback = { challengeId: payload.challengeId, ...bank.answer(item.challenge, payload.optionId, Date.now()) };
    item.optionId = payload.optionId;
    return response(200, item.feedback);
  } catch (error) { return response(400, { code: error.code || "BAD_REQUEST" }); }
}

class PracticeSocket {
  constructor(service) {
    this.service = service; this.readyState = 0; this.listeners = new Map();
    queueMicrotask(() => { if (this.readyState !== 0) return; this.readyState = 1; this.emit("open", {}); });
  }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  emit(type, event) { for (const listener of this.listeners.get(type) || []) listener(event); }
  send(serialized) {
    if (this.readyState !== 1) throw Error("Practice session closed");
    const value = JSON.parse(serialized);
    queueMicrotask(() => {
      if (this.readyState !== 1) return;
      try {
        if (value.type === "session.open") this.service.makeSession(this);
        else if (value.type === "session.resume") this.service.resume(value.resumeToken, this);
        else this.service.command(this, value);
      } catch (error) { this.deliver({ type: "session.error", code: error.code || "PRACTICE_ERROR" }); }
    });
  }
  deliver(value) { const data = JSON.stringify(value); queueMicrotask(() => { if (this.readyState === 1) this.emit("message", { data }); }); }
  close(code = 1000) { if (this.readyState === 3) return; this.readyState = 3; this.service.detach(this); queueMicrotask(() => this.emit("close", { code })); }
}
export class DuelConnection extends Transport {
  constructor(options = {}) {
    const service = new GameService({ questions: bank, send: (socket, value) => socket?.deliver(value), config: { queueMs: 250, aiDelayMs: 850, maxSessions: 1 } });
    super({ ...options, url: "practice:local", storage: null, socketFactory: () => new PracticeSocket(service) });
    this.practiceService = service;
  }
  freshSession() {
    this.disconnect();
    for (const session of [...this.practiceService.sessions.values()]) this.practiceService.expireSession(session);
    this.saved = null; this.session = null; this.connect();
  }
  destroy() { this.disconnect(); this.practiceService.close(); study.clear(); }
}
