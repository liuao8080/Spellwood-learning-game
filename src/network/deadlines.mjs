/** Advisory countdowns follow the latest server timestamp using elapsed time.
 * Only the server decides whether an action is still legal. */
export class ServerClock {
  constructor({ now = () => globalThis.performance?.now() ?? Date.now() } = {}) {
    this.now = now; this.reference = null;
  }
  sync(serverTime) {
    if (!Number.isFinite(serverTime)) return;
    this.reference = { serverTime, receivedAt: this.now() };
  }
  remaining(deadline) {
    if (!this.reference || !Number.isFinite(deadline)) return null;
    const elapsed = Math.max(0, this.now() - this.reference.receivedAt);
    return Math.max(0, Math.ceil((deadline - this.reference.serverTime - elapsed) / 1000));
  }
  reset() { this.reference = null; }
}

export function durationText(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const safe = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
