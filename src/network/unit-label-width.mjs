// Bound desktop labels by their actual projected neighbours, not card text.
// Compact layouts retain their existing fixed target sizes in CSS.
export function unitLabelWidth(anchor, anchors) {
  let distance = Infinity;
  for (const other of anchors) {
    if (other.uid === anchor.uid || other.seat !== anchor.seat || !other.visible) continue;
    if (Number.isFinite(other.x) && Number.isFinite(anchor.x)) distance = Math.min(distance, Math.abs(other.x - anchor.x));
  }
  return Math.max(44, Math.min(128, distance - 6));
}
