/** Original dictionary illustrations; crop coordinates preserve every complete object. */
export const PICTURE_SHEETS = [
  {
    width: 1448,
    height: 1086,
    columns: 4,
    rows: [0, 350, 698, 1086],
    file: "first-words.webp",
    words: [
      "book",
      "ruler",
      "pencil",
      "schoolbag",
      "face",
      "ear",
      "eye",
      "nose",
      "dog",
      "bird",
      "tiger",
      "monkey",
    ],
  },
  {
    width: 1448,
    height: 1086,
    columns: 4,
    rows: [0, 350, 698, 1086],
    file: "home-words.webp",
    words: [
      "apple",
      "pear",
      "banana",
      "orange",
      "chair",
      "desk",
      "blackboard",
      "under",
      "light",
      "bed",
      "door",
      "box",
    ],
  },
  {
    width: 1448,
    height: 1086,
    columns: 4,
    rows: [0, 355, 690, 1086],
    file: "daily-words.webp",
    words: [
      "plane",
      "ball",
      "doll",
      "train",
      "rice",
      "noodles",
      "fish",
      "chicken",
      "juice",
      "tea",
      "milk",
      "water",
    ],
  },
  {
    width: 1254,
    height: 1254,
    columns: 2,
    rows: [0, 595, 1254],
    file: "clothes-words.webp",
    words: ["shirt", "T-shirt", "skirt", "dress"],
  },
];
export function questionVisual(q) {
  if (q.grade !== 1 || q.type !== "word") return "";
  for (const [sheetIndex, sheet] of PICTURE_SHEETS.entries()) {
    const index = sheet.words.indexOf(q.target);
    if (index < 0) continue;
    const row = Math.floor(index / sheet.columns),
      top = sheet.rows[row],
      height = sheet.rows[row + 1] - top,
      width = sheet.width / sheet.columns;
    return `<div class="question-visual-group"><div class="question-visual" aria-hidden="true"><div class="learning-atlas sheet-${sheetIndex}" data-picture-state="loading" style="aspect-ratio:${width}/${height};background-size:${sheet.columns * 100}% ${(sheet.height / height) * 100}%;background-position:${((index % sheet.columns) / (sheet.columns - 1)) * 100}% ${(top / (sheet.height - height)) * 100}%"></div><span class="picture-status">图示载入中…</span></div>${q.target === "under" ? '<small class="picture-caption">看看红球的位置</small>' : ""}</div>`;
  }
  const count = { one: 1, three: 3, five: 5, eight: 8 }[q.target];
  if (count)
    return `<div class="question-visual number-cue" aria-hidden="true">${Array.from({ length: count }, () => "<i></i>").join("")}</div>`;
  const color = {
    black: "#161616",
    yellow: "#ffd846",
    blue: "#326dcc",
    red: "#df3c46",
  }[q.target];
  if (color)
    return `<div class="question-visual" aria-hidden="true"><span class="color-cue" style="background:${color}"></span></div>`;
  return "";
}
