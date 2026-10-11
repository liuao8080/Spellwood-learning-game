const smooth = value => 1 - (1 - value) ** 3;
const easeInOut = value => value < .5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;

// Nominal phase budget remains 740ms. Each phase completes on a scene update
// before the next is scheduled. Only browser evidence establishes presentation.
// A late frame extends the sequence;
// it cannot jump from anticipation straight into a completed return.
export const MELEE_PHASES = Object.freeze([
  Object.freeze({ name: 'anticipation', duration: 118 }),
  Object.freeze({ name: 'travel', duration: 230 }),
  Object.freeze({ name: 'contact', duration: 82 }),
  Object.freeze({ name: 'return', duration: 310 }),
]);

export async function playMeleeSequence({ runPhase, isCurrent, setPose, impact }) {
  let hit = false, elapsed = 0;
  for (const phase of MELEE_PHASES) {
    if (!isCurrent()) return { cancelled: true, hit };
    const offset = elapsed;
    await runPhase(phase.duration, value => {
      if (!isCurrent()) return;
      const t = Math.max(0, Math.min(1, value));
      const travel = phase.name === 'anticipation' ? -.08 * smooth(t)
        : phase.name === 'travel' ? -.08 + 1.08 * smooth(t) : phase.name === 'contact' ? 1 : 1 - easeInOut(t);
      setPose({ phase: phase.name, travel, progress: (offset + t * phase.duration) / 740 });
      if (phase.name === 'travel' && t === 1 && !hit) { hit = true; impact(); }
    });
    elapsed += phase.duration;
  }
  return { cancelled: !isCurrent(), hit };
}
