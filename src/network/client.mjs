/** Browser transport for the authoritative server. No combat calculation lives here. */
export class DuelConnection {
  constructor({ url, onMessage = () => {}, onConnection = () => {}, socketFactory = (u) => new WebSocket(u), storage = globalThis.sessionStorage, schedule = setTimeout, unschedule = clearTimeout } = {}) {
    this.url = url || `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
    this.onMessage = onMessage; this.onConnection = onConnection; this.socketFactory = socketFactory;
    this.storage = storage; this.schedule = schedule; this.unschedule = unschedule;
    this.storageKey = "spellwood.net.session.v1";
    this.state = "closed"; this.socket = null; this.nextSeq = 1; this.session = null;
    this.pending = null; this.reconnectAttempt = 0; this.intentionalClose = false; this.transportEpoch = 0;
    try { this.saved = JSON.parse(storage?.getItem(this.storageKey) || "null"); } catch { this.saved = null; }
    if (!this.saved || typeof this.saved.resumeToken !== "string") this.saved = null;
  }

  status(value, detail = {}) { this.state = value; this.onConnection({ state: value, ...detail }); }

  connect() {
    if (this.socket && [0, 1].includes(this.socket.readyState)) return;
    this.intentionalClose = false;
    if (this.reconnectTimer) this.unschedule(this.reconnectTimer);
    this.reconnectTimer = null;
    const epoch = ++this.transportEpoch;
    this.status("connecting", { retry: this.reconnectAttempt });
    let socket;
    try { socket = this.socketFactory(this.url); } catch { this.retry(); return; }
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (epoch !== this.transportEpoch) return;
      this.status("authenticating");
      socket.send(JSON.stringify(this.saved ? { type: "session.resume", protocol: 1, resumeToken: this.saved.resumeToken } : { type: "session.open", protocol: 1 }));
    });
    socket.addEventListener("message", (event) => {
      if (epoch !== this.transportEpoch || typeof event.data !== "string") return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message.type !== "string") return;
      this.receive(message);
    });
    socket.addEventListener("close", (event) => {
      if (epoch !== this.transportEpoch) return;
      this.socket = null;
      if (event.code === 4001) { this.endSession("replaced", false); return; }
      if (event.code === 4003) { this.endSession("expired", true); return; }
      if (!this.intentionalClose) this.retry();
      else if (!["expired", "replaced"].includes(this.state)) this.status("closed");
    });
    socket.addEventListener("error", () => {
      if (epoch === this.transportEpoch) this.status("reconnecting", { retry: this.reconnectAttempt });
    });
  }

  receive(message) {
    if (message.type === "session.replaced") { this.endSession("replaced", false); this.onMessage(message); return; }
    if (message.type === "session.ready") {
      this.session = message; this.nextSeq = message.nextClientSeq; this.reconnectAttempt = 0;
      if (message.resumeToken) {
        this.saved = { sessionId: message.sessionId, resumeToken: message.resumeToken };
        try { this.storage?.setItem(this.storageKey, JSON.stringify(this.saved)); } catch { /* Memory reconnect still works. */ }
      }
      this.status("ready", { name: message.name });
      this.onMessage(message);
      if (this.pending) this.socket.send(JSON.stringify(this.pending.wire));
      return;
    }
    if (message.type === "session.error") {
      this.endSession("expired", true, message.code); this.onMessage(message); return;
    }
    if (message.type === "command.ack") {
      if (Number.isInteger(message.nextClientSeq)) this.nextSeq = message.nextClientSeq;
      const pending = this.pending;
      if (pending && message.commandId === pending.wire.commandId) {
        this.pending = null;
        message.ok ? pending.resolve(message) : pending.reject(Object.assign(new Error(message.code || "Command rejected"), { code: message.code, reply: message }));
      }
    }
    this.onMessage(message);
  }

  command(type, payload = {}, { roomId, expectedRevision } = {}) {
    if (this.state !== "ready" || this.socket?.readyState !== 1) return Promise.reject(Object.assign(new Error("Connection unavailable"), { code: "not-connected" }));
    if (this.pending) return Promise.reject(Object.assign(new Error("Previous command awaiting confirmation"), { code: "pending-command" }));
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    const commandId = Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
    const wire = { type, commandId, clientSeq: this.nextSeq, payload };
    if (roomId !== undefined) wire.roomId = roomId;
    if (expectedRevision !== undefined) wire.expectedRevision = expectedRevision;
    return new Promise((resolve, reject) => {
      this.pending = { wire, resolve, reject };
      try { this.socket.send(JSON.stringify(wire)); }
      catch { this.status("reconnecting"); this.socket?.close(); }
    });
  }

  retry() {
    if (this.intentionalClose) return;
    const delay = Math.min(15_000, 700 * 2 ** Math.min(5, this.reconnectAttempt++));
    this.status("reconnecting", { retry: this.reconnectAttempt, delay });
    this.reconnectTimer = this.schedule(() => this.connect(), delay);
  }

  failPending(code) {
    if (!this.pending) return;
    const pending = this.pending; this.pending = null;
    pending.reject(Object.assign(new Error(code), { code }));
  }

  endSession(state, clearStored, code = state) {
    this.intentionalClose = true; this.transportEpoch++;
    if (this.reconnectTimer) this.unschedule(this.reconnectTimer);
    this.reconnectTimer = null; this.failPending(code);
    this.socket?.close(); this.socket = null;
    if (clearStored) {
      this.saved = null; this.session = null;
      try { this.storage?.removeItem(this.storageKey); } catch { /* Memory state is already cleared. */ }
    }
    this.status(state, { code });
  }

  freshSession() {
    this.disconnect(); this.saved = null; this.session = null;
    try { this.storage?.removeItem(this.storageKey); } catch { /* Unavailable session storage. */ }
    this.connect();
  }

  disconnect() {
    this.intentionalClose = true; this.transportEpoch++;
    if (this.reconnectTimer) this.unschedule(this.reconnectTimer);
    this.reconnectTimer = null; this.failPending("connection-closed");
    this.socket?.close(1000); this.socket = null; this.status("closed");
  }
}
