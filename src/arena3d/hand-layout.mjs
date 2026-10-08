/** CSS-pixel hand layout, independent of the battlefield camera and game rules. */
export const HAND_MODEL = Object.freeze({ width: 1.274, height: 1.824, faceWidth: 1.15, faceHeight: 1.7 });
export const HAND_FONT = Object.freeze({ name: 78, description: 70, cost: 100, stats: 88, textureHeight: 720 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** The canvas is the visible window; scrolling moves physical cards inside it. */
export function handLayout({ width, height, count, scroll = 0, selectedIndex = null,
  hoveredIndex = null, focusedIndex = null, mode = "auto" }) {
  width = Math.max(1, Number(width) || 1); height = Math.max(1, Number(height) || 1);
  count = clamp(Math.trunc(count) || 0, 0, 7);
  const fan = mode === "fan" || (mode === "auto" && width >= 760 && height >= 218);
  const narrow = width < 600;
  // A seven-card fan must expose the whole six-character effect line. A wide
  // overlapping card is not readable just because its unobscured font is large.
  const nominalWidth = fan ? Math.min(148, (width - 28) / (1 + .91 * Math.max(0, count - 1))) : narrow ? 124 : 112;
  const padding = 3, ratio = HAND_MODEL.width / HAND_MODEL.height;
  const cardWidth = Math.min(nominalWidth, Math.max(1, height - (fan ? 32 : 4)) * ratio);
  const cardHeight = cardWidth / ratio;
  const gap = narrow ? 10 : count > 1 && width >= cardWidth * count + padding * 2
    ? Math.min(7, (width - cardWidth * count - padding * 2) / (count - 1)) : 7;
  const step = fan ? cardWidth * .91 : cardWidth + gap;
  const contentWidth = count ? cardWidth + step * (count - 1) + padding * 2 : 0;
  const maxScroll = fan || contentWidth - width < .01 ? 0 : contentWidth - width;
  scroll = clamp(Number(scroll) || 0, 0, maxScroll);
  const startX = maxScroll ? padding + cardWidth / 2 : (width - step * (count - 1)) / 2;
  const cards = Array.from({ length: count }, (_, index) => {
    const middle = index - (count - 1) / 2;
    const selected = selectedIndex === index, focused = focusedIndex === index;
    const hovering = hoveredIndex === index;
    const emphasized = selected || focused || hovering;
    const zoom = fan && emphasized ? selected || focused ? 1.065 : 1.05 : 1;
    const lift = emphasized ? fan ? 10 : 2 : 0;
    const centerX = startX + step * index - scroll;
    const centerY = fan ? height / 2 + 6 + Math.abs(middle) * 1.6 - lift : height / 2 + 1 - lift;
    return { index, centerX, centerY, x: centerX - width / 2, y: height / 2 - centerY,
      z: emphasized ? 110 + index : index * 12,
      rotationX: emphasized ? -.015 : fan ? -.055 : -.018,
      rotationY: fan && !emphasized ? middle * -.008 : 0,
      rotationZ: fan && !emphasized ? -middle * .026 : 0,
      scale: cardWidth / HAND_MODEL.width * zoom, width: cardWidth * zoom,
      height: cardHeight * zoom, selected, focused, hovering };
  });
  return { width, height, count, mode: fan ? "fan" : maxScroll ? "scroll" : "row", cards,
    cardWidth, cardHeight, step, scroll, maxScroll, contentWidth,
    canScrollLeft: scroll > .5, canScrollRight: scroll < maxScroll - .5,
    typography: Object.fromEntries(Object.entries(HAND_FONT).filter(([name]) => name !== "textureHeight")
      .map(([name, size]) => [name, size / HAND_FONT.textureHeight * HAND_MODEL.faceHeight / HAND_MODEL.height * cardHeight])) };
}

export function scrollForHandIndex(layout, index) {
  const card = layout.cards[index];
  if (!card || !layout.maxScroll) return layout.scroll;
  const padding = 3, left = card.centerX - card.width / 2, right = card.centerX + card.width / 2;
  const delta = left < padding ? left - padding : right > layout.width - padding ? right - layout.width + padding : 0;
  return clamp(layout.scroll + delta, 0, layout.maxScroll);
}
