/** Original game audio: synthesized effects plus the project's original score. */
export class AudioDirector {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.music = null;
    this.settings = {
      sound: true,
      music: true,
      musicVolume: 35,
      soundVolume: 65,
    };
    this.unlocked = false;
    this.hidden = false;
    this.ducked = false;
  }
  sync(settings) {
    for (const key of ["sound", "music", "musicVolume", "soundVolume"])
      if (key in settings) this.settings[key] = settings[key];
    if (this.master)
      this.master.gain.value =
        (this.settings.sound ? this.settings.soundVolume / 100 : 0) * 0.65;
    if (this.music) {
      this.music.volume =
        (this.settings.musicVolume / 100) * 0.5 * (this.ducked ? 0.25 : 1);
      if (!this.settings.music || this.hidden) this.music.pause();
      else if (this.unlocked && this.music.paused)
        this.music.play().catch(() => {});
    }
  }
  unlock() {
    if (this.hidden) return;
    if (this.unlocked) {
      if (this.ctx?.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.master.gain.value =
          (this.settings.sound ? this.settings.soundVolume / 100 : 0) * 0.65;
        this.ctx.resume().catch(() => {});
      }
      this.music = new Audio();
      this.music.id = "spellwood-score";
      this.music.hidden = true;
      this.music.setAttribute("aria-hidden", "true");
      document.body.appendChild(this.music);
      this.music.addEventListener("playing", () => this.reflect());
      this.music.addEventListener("pause", () => this.reflect());
      this.music.src = this.music.canPlayType("audio/ogg")
        ? "assets/forest-score.ogg"
        : "assets/forest-score.m4a";
      this.music.loop = true;
      this.music.preload = "auto";
      this.music.volume =
        (this.settings.musicVolume / 100) * 0.5 * (this.ducked ? 0.25 : 1);
      this.unlocked = true;
      if (this.settings.music && !this.hidden)
        this.music.play().catch(() => {});
    } catch (e) {
      this.unlocked = false;
    }
  }
  reflect() {
    const button = document.querySelector('[data-action="music-toggle"]');
    if (button) {
      button.dataset.playing = String(!!this.music && !this.music.paused);
      button.title =
        this.music && !this.music.paused ? "原创配乐正在播放" : "背景音乐暂停";
    }
  }
  tone(freq, start, dur, gain = 0.2, type = "sine", endFreq) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + start,
      o = this.ctx.createOscillator(),
      g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
  noise(start, dur, gain = 0.2, cutoff = 1200) {
    if (!this.ctx) return;
    const n = Math.ceil(this.ctx.sampleRate * dur),
      b = this.ctx.createBuffer(1, n, this.ctx.sampleRate),
      d = b.getChannelData(0);
    for (let i = 0; i < n; i++)
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const s = this.ctx.createBufferSource(),
      f = this.ctx.createBiquadFilter(),
      g = this.ctx.createGain();
    s.buffer = b;
    f.type = "lowpass";
    f.frequency.value = cutoff;
    g.gain.value = gain;
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start(this.ctx.currentTime + start);
  }
  play(kind = "click") {
    if (!this.settings.sound || !this.unlocked || this.hidden) return;
    switch (kind) {
      case "attack":
        this.noise(0, 0.19, 0.25, 2400);
        this.tone(280, 0, 0.2, 0.18, "triangle", 95);
        break;
      case "hit":
        this.tone(95, 0, 0.25, 0.42, "triangle", 38);
        this.noise(0, 0.25, 0.24, 1300);
        this.tone(800, 0.025, 0.12, 0.06);
        break;
      case "spark":
        this.tone(330, 0, 0.32, 0.18, "sawtooth", 950);
        this.noise(0.12, 0.35, 0.15, 3800);
        break;
      case "heal":
        [523, 659, 784, 1047].forEach((f, i) =>
          this.tone(f, i * 0.1, 0.6, 0.1),
        );
        break;
      case "growth":
        [440, 554, 659].forEach((f, i) =>
          this.tone(f, i * 0.065, 0.35, 0.085, "triangle"),
        );
        break;
      case "shield":
        this.tone(220, 0, 0.6, 0.18, "triangle");
        this.tone(440, 0.03, 0.8, 0.12);
        this.tone(880, 0.08, 0.6, 0.07);
        break;
      case "break":
        this.noise(0, 0.3, 0.25, 6500);
        [780, 960, 1320].forEach((f, i) =>
          this.tone(f, i * 0.025, 0.16, 0.1, "triangle", f * 0.5),
        );
        break;
      case "summon":
        [196, 294, 392, 587].forEach((f, i) =>
          this.tone(f, i * 0.065, 0.42, 0.13, "triangle"),
        );
        this.noise(0.15, 0.24, 0.035, 1900);
        break;
      case "death":
        this.tone(180, 0, 0.5, 0.14, "triangle", 50);
        this.noise(0.05, 0.4, 0.1, 900);
        break;
      case "win":
        [392, 494, 587, 784, 988, 1175].forEach((f, i) =>
          this.tone(f, i * 0.13, 0.8, 0.15),
        );
        break;
      case "wrong":
        this.tone(392, 0, 0.3, 0.09);
        this.tone(330, 0.15, 0.4, 0.08);
        break;
      case "turn":
        this.tone(392, 0, 0.3, 0.12, "triangle");
        this.tone(587, 0.1, 0.4, 0.13);
        break;
      case "correct":
        this.tone(587, 0, 0.45, 0.11);
        this.tone(784, 0.1, 0.5, 0.1);
        break;
      default:
        this.tone(510, 0, 0.1, 0.07, "triangle");
    }
  }
  duckSpeech(active) {
    this.ducked = active;
    this.sync(this.settings);
  }
  visibility(hidden) {
    this.hidden = hidden;
    if (hidden) {
      this.music?.pause();
      this.ctx?.suspend().catch(() => {});
    } else if (this.unlocked) {
      this.ctx?.resume().catch(() => {});
      if (this.settings.music) this.music?.play().catch(() => {});
    }
  }
}
export const SOUND = new AudioDirector();
