import { CanvasTexture, Group, Sprite, SpriteMaterial, SRGBColorSpace, Vector2, Vector3, Vector4 } from "three";
import { createElementalBurst, createElementalCast } from "./elemental-effects.mjs";

/** Retained, invisible representatives of the actual combat-effect materials.
 * The caller can compileAsync(handle.root, camera, scene) after configuring the
 * scene's lights/fog, and optionally initTexture() each handle.textures entry.
 * This function never renders, attaches to a scene, allocates a render target,
 * starts an animation, or calls a game callback. Keep the handle until scene
 * disposal: disposing these materials immediately would release shader-cache
 * references. A representative upload does not upload future damage textures.
 */
export function createEffectWarmup({ createCanvas = () => globalThis.document?.createElement("canvas") } = {}) {
  // Match floatText's canvas, color space and SpriteMaterial program signature.
  // Canvas injection lets the resource/lifetime tests run without a browser.
  const canvas = createCanvas();
  if (!canvas) throw new Error("Effect warmup requires a canvas");
  canvas.width = 384; canvas.height = 160;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Effect warmup requires a 2D canvas context");
  context.textAlign = "center";
  context.font = "bold 78px 'Noto Sans CJK SC',Georgia,serif";
  context.lineWidth = 10; context.strokeStyle = "#142922"; context.lineJoin = "round";
  context.strokeText("-2", 192, 105); context.fillStyle = "#ffe2b6"; context.fillText("-2", 192, 105);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new Sprite(material); sprite.name = "effect-warmup-floating-text";
  sprite.scale.set(2.45, 1.02, 1); sprite.renderOrder = 20;
  const root = new Group(); root.name = "retained-effect-warmup"; root.visible = false;
  root.add(sprite);
  const effects = [], textures = Object.freeze([texture]);
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const effect of effects) effect.dispose();
    effects.length = 0;
    material.dispose(); texture.dispose(); root.clear();
    // Sprite.geometry is shared by all Three sprites and is not ours to dispose.
  }
  try {
    const from = new Vector3(-1, 1, 0), to = new Vector3(1, 1, 0);
    for (const [element, kind] of [["fire", "damage"], ["water", "heal"], ["nature", "grow"], ["arcane", "shield"]]) {
      const cast = createElementalCast({ element, from, to });
      effects.push(cast); root.add(cast.root);
      const burst = createElementalBurst({ element, kind, at: to });
      effects.push(burst); root.add(burst.root);
    }
  } catch (error) {
    dispose();
    throw error;
  }
  // compileAsync uses traverse(), so hidden charge/flight/impact branches are
  // included even though this detached root can never appear in a render.
  return { root, textures, dispose, get disposed() { return disposed; } };
}


/** First-draw preparation on the same default framebuffer/color/MSAA path.
 * Only a genuinely hidden gameplay canvas is eligible. This is initialization,
 * never a gameplay/evidence frame, and all scene/renderer state is restored.
 */
export function primeHiddenEffectCanvas({ renderer, scene, camera, canvas, handle } = {}) {
  if (canvas?.hidden !== true) return { status: "skipped", reason: "visible-canvas" };
  if (!renderer || renderer.isSoftwareRenderer) return { status: "skipped", reason: "renderer" };
  const methods = ["getRenderTarget", "getSize", "setSize", "getViewport", "setViewport",
    "getScissor", "setScissor", "getScissorTest", "setScissorTest", "render"];
  if (methods.some(name => typeof renderer[name] !== "function")) return { status: "skipped", reason: "unsupported" };
  if (renderer.getRenderTarget() !== null) return { status: "skipped", reason: "owned-target" };
  if (renderer.getContext?.()?.isContextLost?.()) return { status: "skipped", reason: "context-lost" };
  if (!scene || !camera || !handle?.root || handle.disposed || handle.root.parent)
    return { status: "skipped", reason: "unavailable-resources" };
  const size = renderer.getSize(new Vector2()), viewport = renderer.getViewport(new Vector4());
  const scissor = renderer.getScissor(new Vector4()), scissorTest = renderer.getScissorTest();
  const visibility = []; handle.root.traverse(object => visibility.push([object, object.visible]));
  try {
    renderer.setSize(8, 8, false); renderer.setScissorTest(false);
    for (const [object] of visibility) object.visible = true;
    scene.add(handle.root);
    renderer.render(scene, camera);
    renderer.getContext?.()?.flush?.();
    return { status: "performed", width: 8, height: 8 };
  } finally {
    handle.root.removeFromParent();
    for (const [object, visible] of visibility) object.visible = visible;
    renderer.setSize(size.x, size.y, false);
    renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
  }
}
