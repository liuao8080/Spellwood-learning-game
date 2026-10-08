import { AudioDirector } from "../av/audio.mjs";

/** Network scene audio owns its short-lived sources, keeping legacy builds intact. */
export class NetworkAudioDirector extends AudioDirector {
  constructor() { super(); this.sources = new Set(); this.preferredSettings = {...this.settings}; this.temporaryMuted = false; }

  own(source, nodes) {
    const record = { source, nodes };
    const release = () => {
      if (!this.sources.delete(record)) return;
      for (const node of nodes) { try { node.disconnect(); } catch {} }
    };
    record.release = release;
    this.sources.add(record);
    source.addEventListener("ended", release, { once: true });
    return record;
  }

  stopEffects() {
    for (const record of [...this.sources]) {
      try { record.source.stop(); } catch {}
      record.release();
    }
  }

  sync(settings) {
    this.preferredSettings = {...this.preferredSettings, ...settings};
    const applied = this.temporaryMuted ? {...this.preferredSettings, sound:false, music:false} : this.preferredSettings;
    if (applied.sound === false) this.stopEffects();
    super.sync(applied);
  }

  setTemporaryMute(value) { this.temporaryMuted = !!value; this.sync({}); }
  duckSpeech(active) { this.ducked = active; this.sync({}); }

  visibility(hidden) {
    if (hidden) this.stopEffects();
    super.visibility(hidden);
  }

  tone(freq, start, duration, gain = .2, type = "sine", endFreq) {
    if (!this.ctx || !this.master || this.hidden || !this.settings.sound) return;
    const time = this.ctx.currentTime + start;
    const source = this.ctx.createOscillator(), level = this.ctx.createGain();
    source.type = type;
    source.frequency.setValueAtTime(freq, time);
    if (endFreq) source.frequency.exponentialRampToValueAtTime(endFreq, time + duration);
    level.gain.setValueAtTime(.0001, time);
    level.gain.exponentialRampToValueAtTime(gain, time + .012);
    level.gain.exponentialRampToValueAtTime(.0001, time + duration);
    source.connect(level); level.connect(this.master);
    const record = this.own(source, [source, level]);
    try { source.start(time); source.stop(time + duration + .03); }
    catch { try { source.stop(); } catch {} record.release(); }
  }

  noise(start, duration, gain = .2, cutoff = 1200) {
    if (!this.ctx || !this.master || this.hidden || !this.settings.sound) return;
    const length = Math.ceil(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
    const source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), level = this.ctx.createGain();
    source.buffer = buffer; filter.type = "lowpass"; filter.frequency.value = cutoff; level.gain.value = gain;
    source.connect(filter); filter.connect(level); level.connect(this.master);
    const record = this.own(source, [source, filter, level]);
    try { source.start(this.ctx.currentTime + start); }
    catch { try { source.stop(); } catch {} record.release(); }
  }
}

export const SOUND = new NetworkAudioDirector();
