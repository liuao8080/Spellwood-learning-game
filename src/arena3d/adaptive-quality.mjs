/** Rendering-only quality adaptation from this device's measured frame work.
 * No renderer/vendor sniffing, game state, animation clock, or DOM changes.
 * The caller applies a changed profile to the arena renderer only; the hand
 * renderer, card textures and HTML controls retain their existing resolution.
 */
export class AdaptiveQualityController {
  constructor({ baseShadowSize = 1024 } = {}) {
    if (!Number.isInteger(baseShadowSize) || baseShadowSize <= 0) {
      throw new RangeError("baseShadowSize must be a positive integer");
    }
    const smallerShadow = Math.min(baseShadowSize, 512);
    this.profiles = Object.freeze([
      { level: 0, shadowMapSize: baseShadowSize, pixelScale: 1 },
      { level: 1, shadowMapSize: smallerShadow, pixelScale: 1 },
      { level: 2, shadowMapSize: smallerShadow, pixelScale: .8 },
      { level: 3, shadowMapSize: smallerShadow, pixelScale: .65 },
    ].map(Object.freeze));
    this.level = 0;
    this.resetSamples();
  }

  get profile() { return this.profiles[this.level]; }

  /** Call on visibility/context changes and on-demand render-loop restarts.
   * Paused time must not be treated as either poor performance or recovery.
   * Keep the last quality choice; require fresh evidence before changing it.
   * When a deferred profile is actually applied, supply its RAF timestamp to
   * start the cooldown there and discard frames spanning the old profile.
   */
  resetSamples({ appliedAt = null } = {}) {
    this.lastSampleNow = null;
    this.appliedAt = Number.isFinite(appliedAt) ? appliedAt : null;
    this.lastChangeNow = this.appliedAt;
    this.healthyMs = 0;
    this.clearWindow();
  }

  clearWindow(start = null) {
    this.windowStart = start;
    this.samples = 0;
    this.frameTotal = 0;
    this.renderTotal = 0;
    this.slowFrames = 0;
    this.maxFrame = 0;
    this.maxRender = 0;
  }

  /** Feed one completed continuously scheduled, visible frame. `now` is a
   * monotonic RAF timestamp; renderMs measures the renderer call, not GPU time.
   * RAF intervals also catch driver/GPU backpressure outside that call. Use
   * active:false for hidden, reduced-motion/on-demand, or suspended frames.
   * Returns a new immutable profile only when the quality level changes.
   */
  sample({ now, frameIntervalMs, renderMs = 0, active = true } = {}) {
    if (!active) { this.resetSamples(); return null; }
    // The apply frame's interval belongs to the previous profile. Ignoring it
    // also avoids treating its drawing-buffer reallocation as steady load.
    if (this.appliedAt !== null && Number.isFinite(now) && now <= this.appliedAt) return null;
    if (!Number.isFinite(now) || !Number.isFinite(frameIntervalMs) || frameIntervalMs <= 0 ||
        !Number.isFinite(renderMs) || renderMs < 0) {
      this.resetSamples();
      return null;
    }
    if (this.appliedAt !== null && now - frameIntervalMs < this.appliedAt - .001) return null;
    if (this.lastSampleNow !== null && now <= this.lastSampleNow) {
      this.resetSamples();
      return null;
    }
    this.lastSampleNow = now;
    // A single shader/upload hitch must not dominate an otherwise healthy
    // window. The slow-frame fraction still records it, and it breaks recovery.
    if (this.windowStart === null) this.windowStart = now - Math.min(frameIntervalMs, 250);
    this.samples++;
    this.frameTotal += Math.min(frameIntervalMs, 250);
    this.renderTotal += Math.min(renderMs, 250);
    this.slowFrames += Number(frameIntervalMs > 40 || renderMs > 30);
    this.maxFrame = Math.max(this.maxFrame, frameIntervalMs);
    this.maxRender = Math.max(this.maxRender, renderMs);
    const elapsed = now - this.windowStart;
    // Both time and sample count matter: isolated startup or first-use stalls
    // cannot lower quality, while a genuinely slow device still adapts promptly.
    if (elapsed < 750 || this.samples < 8) return null;

    const frameMean = this.frameTotal / this.samples;
    const renderMean = this.renderTotal / this.samples;
    const overloaded = (frameMean > 40 || renderMean > 30) && this.slowFrames / this.samples >= .6;
    const healthy = frameMean <= 22 && renderMean <= 14 && this.maxFrame <= 40 && this.maxRender <= 25;
    this.healthyMs = healthy ? this.healthyMs + elapsed : 0;
    this.clearWindow(now);

    const sinceChange = this.lastChangeNow === null ? Infinity : now - this.lastChangeNow;
    let next = this.level;
    if (overloaded && sinceChange >= 1500) next = Math.min(3, next + 1);
    // Recovery needs eight uninterrupted seconds with substantial headroom.
    // Separate thresholds and one-step changes avoid oscillation at the limit.
    else if (this.healthyMs >= 8000 && sinceChange >= 8000) next = Math.max(0, next - 1);
    if (next === this.level) return null;
    this.level = next;
    this.lastChangeNow = now;
    this.healthyMs = 0;
    return this.profile;
  }
}
