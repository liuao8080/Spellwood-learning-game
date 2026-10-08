/** Bundled, original-text English audio with system speech as a fallback. */
export class SpeechDirector {
  constructor(assets, { duck = () => {}, notify = () => {} } = {}) {
    this.assets = assets;
    this.duck = duck;
    this.notify = notify;
    this.epoch = 0;
    this.audio = null;
    this.hidden = false;
    this.status = "idle";
    this.currentText = null;
  }
  reflect(state = this.status) {
    this.status = state;
    for (const b of document.querySelectorAll('[data-action="speak"]')) {
      b.dataset.speaking = String(state === "playing");
      b.textContent =
        state === "playing"
          ? "■ 停止朗读"
          : state === "loading"
            ? "载入语音…"
            : "♫ 听英语";
      b.setAttribute?.(
        "aria-label",
        state === "idle" ? "朗读英语" : "停止朗读",
      );
    }
    if (this.audio) this.audio.dataset.state = state;
  }
  stop() {
    this.epoch++;
    this.currentText = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.remove();
      this.audio = null;
    }
    window.speechSynthesis?.cancel?.();
    this.duck(false);
    this.reflect("idle");
  }
  visibility(hidden) {
    this.hidden = hidden;
    if (hidden) this.stop();
  }
  play(text, enabled = true) {
    if (enabled && this.status !== "idle" && this.currentText === text) {
      this.stop();
      return;
    }
    this.stop();
    if (!enabled) return this.notify("可在设置中开启英语朗读");
    if (this.hidden || !text) return;
    this.currentText = text;
    const epoch = this.epoch;
    let fellBack = false;
    const done = () => {
      if (epoch !== this.epoch) return;
      this.duck(false);
      this.reflect("idle");
    };
    const started = () => {
      if (epoch !== this.epoch) return;
      this.duck(true);
      this.reflect("playing");
    };
    const fallback = () => {
      if (epoch !== this.epoch || fellBack) return;
      fellBack = true;
      if (this.audio) {
        this.audio.pause();
        this.audio.remove();
        this.audio = null;
      }
      done();
      if (
        !window.speechSynthesis ||
        typeof SpeechSynthesisUtterance !== "function"
      ) {
        done();
        return this.notify("英语音频暂不可用，请直接阅读");
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = 0.85;
      const voice = window.speechSynthesis
        .getVoices()
        .find((v) => /^en[-_]/i.test(v.lang));
      if (voice) u.voice = voice;
      u.onstart = started;
      u.onend = done;
      u.onerror = () => {
        if (epoch !== this.epoch) return;
        done();
        this.notify("英语音频暂不可用，请直接阅读");
      };
      try {
        window.speechSynthesis.speak(u);
      } catch {
        u.onerror();
      }
    };
    const source = this.assets[text];
    if (!source) return fallback();
    try {
      const a = new Audio(source);
      this.audio = a;
      a.id = "spellwood-speech";
      a.hidden = true;
      a.preload = "auto";
      a.dataset.text = text;
      a.dataset.state = "loading";
      a.setAttribute("aria-hidden", "true");
      a.addEventListener("playing", started);
      a.addEventListener("ended", done);
      a.addEventListener("error", fallback);
      document.body.appendChild(a);
      this.reflect("loading");
      a.play()?.catch(fallback);
    } catch {
      fallback();
    }
  }
}
