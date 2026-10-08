import { SOUND } from "./audio.mjs";

/** New scene cues keep the legacy offline audio implementation unchanged. */
export function playSceneSound(kind, director = SOUND) {
  if (kind.startsWith?.("pack-")) {
    if (!director.settings.sound || !director.unlocked || director.hidden) return;
    if (kind === "pack-charge") { [196,247,294,392].forEach((f,i)=>director.tone(f,i*.12,.7,.035,"sine",f*1.35)); return; }
    if (kind === "pack-open") { director.noise(0,.22,.085,2400); [392,494,587,784].forEach((f,i)=>director.tone(f,i*.075,.55,.065,"triangle")); return; }
    const chords={leaf:[523,659],silver:[587,740,880],star:[659,830,988],gold:[523,659,784,1046]};
    (chords[kind.slice(12)]||chords.leaf).forEach((f,i)=>director.tone(f,i*.06,.38,.05,"triangle")); return;
  }
  if (kind !== "draw") { director.play(kind); return; }
  if (!director.settings.sound || !director.unlocked || director.hidden) return;
  [523, 659, 784].forEach((frequency, index) => director.tone(frequency, index * .07, .28, .07, "triangle"));
}
