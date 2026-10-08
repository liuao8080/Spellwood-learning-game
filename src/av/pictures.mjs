/** Reflect real image readiness without putting an English answer in the cue. */
export class PictureReadiness {
  constructor({
    createImage = () => new Image(),
    background = (node) => getComputedStyle(node).backgroundImage,
    later = (fn) => setTimeout(fn, 10000),
    cancel = (id) => clearTimeout(id),
  } = {}) {
    this.createImage = createImage;
    this.background = background;
    this.later = later;
    this.cancel = cancel;
    this.cache = new Map();
  }
  connect(root = document) {
    for (const node of root.querySelectorAll(".learning-atlas")) {
      const source = this.background(node).match(
        /^url\(["']?(.*?)["']?\)$/,
      )?.[1];
      if (!source) continue;
      let entry = this.cache.get(source);
      // A later visit can recover after an interrupted or failed download.
      if (entry?.state === "failed") this.cache.delete(source);
      entry = this.cache.get(source);
      if (!entry) {
        entry = {
          state: "loading",
          nodes: new Set(),
          image: null,
          timer: null,
        };
        this.cache.set(source, entry);
        const image = (entry.image = this.createImage());
        const settle = (state) => {
          entry.state = state;
          this.cancel(entry.timer);
          for (const el of entry.nodes) this.reflect(el, state);
          if (state === "ready") entry.nodes.clear();
        };
        image.onload = () => settle("ready");
        image.onerror = () => settle("failed");
        entry.timer = this.later(() => settle("failed"));
        image.src = source;
        if (image.complete && image.naturalWidth > 0) settle("ready");
      }
      this.reflect(node, entry.state);
      if (entry.state !== "ready") entry.nodes.add(node);
    }
  }
  reflect(node, state) {
    if (node.isConnected === false) return;
    node.dataset.pictureState = state;
    const caption = node.parentElement.querySelector(".picture-status");
    if (caption)
      caption.textContent =
        state === "failed" ? "图暂未载入 · 可以先读题" : "图示载入中…";
  }
}
