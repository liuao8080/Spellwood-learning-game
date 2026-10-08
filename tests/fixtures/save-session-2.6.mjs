/** One active writer per origin. No profile or learning data crosses this channel.
 * Lock lifetime follows https://www.w3.org/TR/web-locks/#the-request-method
 */
export class SaveSession {
  constructor({
    locks = globalThis.navigator?.locks,
    createChannel = (name) =>
      typeof BroadcastChannel === "function"
        ? new BroadcastChannel(name)
        : null,
    beforeYield = () => true,
    onChange = () => {},
    later = (fn, ms) => setTimeout(fn, ms),
    cancel = (id) => clearTimeout(id),
    controller = () => new AbortController(),
    now = () => Date.now(),
  } = {}) {
    this.locks = locks;
    this.createChannel = createChannel;
    this.beforeYield = beforeYield;
    this.onChange = onChange;
    this.later = later;
    this.cancel = cancel;
    this.controller = controller;
    this.now = now;
    this.status = locks?.request ? "pending" : "unsupported";
    this.reason = "";
    this.id = Math.random().toString(36).slice(2);
    this.epoch = 0;
    this.waiting = false;
    this.release = null;
    this.abort = null;
    this.timer = null;
    this.channel = null;
  }
  get canWrite() {
    return this.status === "active" || this.status === "unsupported";
  }
  change(status, reason = "") {
    this.status = status;
    this.reason = reason;
    this.onChange(status);
  }
  openChannel() {
    if (this.channel) return;
    try {
      this.channel = this.createChannel("spellwood-save-session");
      if (this.channel)
        this.channel.onmessage = ({ data }) => {
          if (!data || data.sender === this.id) return;
          if (data.type === "request" && this.status === "active") {
            if (
              !Number.isFinite(data.expiresAt) ||
              data.expiresAt <= this.now()
            )
              return;
            if (!this.beforeYield()) {
              this.channel.postMessage({
                type: "busy",
                sender: this.id,
                target: data.sender,
              });
              return;
            }
            // Disable actions synchronously before releasing the browser lock.
            this.change("readonly", "handed-off");
            this.lease.handedOff = true;
            const release = this.release;
            this.release = null;
            release?.();
          } else if (
            data.type === "busy" &&
            data.target === this.id &&
            this.waiting
          ) {
            this.abort?.abort();
            this.change("readonly", "unsaved");
          }
        };
    } catch {
      this.channel = null;
    }
  }
  start(takeOver = false) {
    if (this.status === "active" || this.waiting) return;
    if (!this.locks?.request || this.status === "unsupported") {
      this.change("unsupported");
      return;
    }
    this.openChannel();
    const epoch = ++this.epoch;
    const lease = (this.lease = { handedOff: false });
    this.waiting = true;
    this.change("pending", takeOver ? "takeover" : "starting");
    this.abort = takeOver ? this.controller() : null;
    if (takeOver)
      this.timer = this.later(() => {
        if (epoch !== this.epoch || !this.waiting) return;
        this.abort.abort();
        this.change("readonly", "no-response");
      }, 8000);
    const options = takeOver
      ? { signal: this.abort.signal }
      : { ifAvailable: true };
    try {
      const request = this.locks.request(
        "spellwood.save.v1.writer",
        options,
        (lock) => {
          if (epoch !== this.epoch) return;
          this.waiting = false;
          this.cancel(this.timer);
          if (!lock) {
            this.change("readonly");
            return;
          }
          return new Promise((resolve) => {
            this.release = resolve;
            this.change("active", takeOver ? "takeover" : "initial");
          });
        },
      );
      Promise.resolve(request)
        .then(() => {
          // If the requester withdrew before release, reclaim instead of leaving
          // every page read-only. A queued successor is granted before this probe.
          if (
            epoch === this.epoch &&
            lease.handedOff &&
            this.status === "readonly"
          )
            this.start();
        })
        .catch((error) => {
          if (epoch !== this.epoch) return;
          this.waiting = false;
          this.cancel(this.timer);
          if (error?.name === "AbortError" && this.status === "readonly")
            return;
          this.release = null;
          this.change("blocked", "unavailable");
        });
      if (takeOver)
        this.channel?.postMessage({
          type: "request",
          sender: this.id,
          expiresAt: this.now() + 8000,
        });
    } catch {
      this.waiting = false;
      this.cancel(this.timer);
      this.change("blocked", "unavailable");
    }
  }
  suspend() {
    this.epoch++;
    this.waiting = false;
    this.abort?.abort();
    this.cancel(this.timer);
    const release = this.release;
    this.release = null;
    if (this.status !== "unsupported") this.change("readonly");
    release?.();
    this.channel?.close();
    this.channel = null;
  }
  singleWindowFallback() {
    this.suspend();
    this.change("unsupported");
  }
}
