/** Original Spellwood heroes. No timers, external assets, GPU-only skinning or gameplay state. */
import {
  Group,
  Object3D,
  Mesh,
  BoxGeometry,
  MeshBasicMaterial,
  Box3,
  Vector3,
  Matrix4,
  Euler,
  Quaternion,
} from "three";
import { getHeroSkin, DEFAULT_HERO_SKIN } from "../hero-skins.mjs";
import { HeroGeometry } from "./hero-geometry.mjs";
import { shadeRangerGarment } from "./garment-colors.mjs";
const TAU = Math.PI * 2;
const PALETTES = {
  forest_apprentice: ["#597c58", "#e8dcbc", "#b49b61", "#604435"],
  leaf_ranger: ["#56794c", "#a8b66b", "#e9ddbb", "#755437"],
  mushroom_keeper: ["#b75e4b", "#ebd7af", "#799254", "#76523a"],
  acorn_captain: ["#355d4d", "#c4a568", "#8a653f", "#624731"],
  butterfly_scholar: ["#605578", "#aa94c3", "#edd6bf", "#8eac78"],
  rain_traveler: ["#3e8090", "#dcc175", "#bbe3dc", "#294c54"],
  coral_listener: ["#78b8af", "#ebddc8", "#c98678", "#627e8b"],
  river_boatkeeper: ["#386176", "#e5d8b9", "#c6ab72", "#916747"],
  snow_postkeeper: ["#86afbf", "#f0e5cf", "#456777", "#896548"],
  ember_apprentice: ["#504844", "#a18f75", "#b87340", "#f1c279"],
  lantern_festival: ["#b55c4a", "#e9d9b1", "#d0ae66", "#75504a"],
  sun_clockmaker: ["#3b5d65", "#ded5b6", "#b29458", "#806047"],
  phoenix_courier: ["#e8d6b1", "#d6ae69", "#b1684b", "#694e42"],
  moon_librarian: ["#344c6a", "#b6c2c5", "#696184", "#e5d7ba"],
  star_cartographer: ["#365e68", "#b5c8c8", "#d4b577", "#e5d7b8"],
  cloud_pilot: ["#7ea8be", "#e5dfcd", "#4d7380", "#8b6a4b"],
  crystal_mason: ["#4b6667", "#c8c5af", "#a39abd", "#d5d8da"],
  paper_adventurer: ["#769da0", "#dddcc9", "#c3ad7d", "#3d6267"],
  tea_alchemist: ["#5c8876", "#c3ae83", "#e4d8ba", "#7b6149"],
  copper_gardener: ["#a47f54", "#608474", "#90a260", "#765a40"],
  aurora_storyteller: ["#425b71", "#83aca8", "#a394b4", "#c6cbc7"],
};
const JOINTS = {
  body: [0, 0.64, 0],
  head: [0, 1.42, 0],
  upperArmL: [-0.3, 1.23, 0],
  upperArmR: [0.3, 1.23, 0],
  forearmL: [-0.43, 1.04, 0.04],
  forearmR: [0.43, 1.04, 0.04],
  legL: [-0.17, 0.52, 0],
  legR: [0.17, 0.52, 0],
  capeL: [-0.17, 1.29, -0.16],
  capeR: [0.17, 1.29, -0.16],
  prop: [0.48, 1.04, 0.25],
};
const PARENTS = {
  head: "body",
  upperArmL: "body",
  upperArmR: "body",
  forearmL: "upperArmL",
  forearmR: "upperArmR",
  capeL: "body",
  capeR: "body",
  prop: "forearmR",
};
const JOINT_NAMES = Object.keys(JOINTS);
const JOINT_INDEX = Object.fromEntries(
  JOINT_NAMES.map((name, index) => [name, index * 3]),
);
const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);
const progress = (v) => Math.max(0, Math.min(1, finite(v)));
const pulse = (v) => Math.sin(progress(v) * Math.PI);
function cape(
  b,
  c,
  height = 0.65,
  width = 0.5,
  j = "capeL",
  side = -1,
  z = -0.18,
) {
  b.softPanel(
    c,
    [
      [0, 0],
      [side * 0.29, -0.03],
      [side * width, -height * 0.82],
      [side * 0.18, -height],
      [0, -height * 0.84],
    ],
    [side * 0.1, 1.29, z],
    0.075,
    j,
    [0.13, side * -0.25, 0],
    "body",
    0.18,
  );
}
function book(b, c, trim, p = [-0.45, 0.92, 0.31]) {
  b.box(trim, p, [0.26, 0.32, 0.13], "forearmL", [0, 0.12, -0.1]);
  b.box(
    c,
    [p[0], p[1], p[2] + 0.079],
    [0.29, 0.35, 0.037],
    "forearmL",
    [0, 0.12, -0.1],
  );
  b.box(
    "#c5ad72",
    [p[0] + 0.09, p[1], p[2] + 0.105],
    [0.045, 0.1, 0.025],
    "forearmL",
    [0, 0.12, -0.1],
    "accent",
  );
}
function apron(b, c, long = false, asymmetric = false) {
  b.panel(
    c,
    [
      [-0.19, 0.25],
      [0.17, 0.25],
      [0.24, -0.25],
      [asymmetric ? 0.02 : 0.14, long ? -0.46 : -0.28],
      [-0.26, -0.28],
    ],
    [0, 0.99, 0.247],
    0.045,
  );
  if (b.quality !== "low") {
    b.box("#c9b893", [0, 0.93, 0.282], [0.23, 0.018, 0.018]);
    b.panel(
      c,
      [
        [-0.1, 0.07],
        [0.1, 0.07],
        [0.08, -0.06],
        [-0.08, -0.06],
      ],
      [0.015, 0.93, 0.286],
      0.018,
    );
  }
}
function bag(b, c, trim, p = [-0.35, 0.72, 0.08], large = false) {
  const s = large ? 0.31 : 0.22;
  b.oval(c, p, [s, s * 0.8, 0.12], "body", "body", "normal");
  b.panel(
    trim,
    [
      [-s * 0.82, 0.06],
      [s * 0.82, 0.06],
      [0, -s * 0.4],
    ],
    [p[0], p[1] + s * 0.25, p[2] + 0.12],
    0.027,
  );
}
function goggles(b, trim, glass) {
  for (const s of [-1, 1]) {
    b.oval(
      trim,
      [s * 0.135, 2.015, 0.252],
      [0.113, 0.086, 0.055],
      "head",
      "accent",
      "tiny",
    );
    b.oval(
      glass,
      [s * 0.135, 2.02, 0.292],
      [0.071, 0.049, 0.024],
      "head",
      "accent",
      "tiny",
    );
  }
  b.box(trim, [0, 2.017, 0.3], [0.08, 0.025, 0.025], "head", [], "accent");
}
function headCap(b, c, width = 0.4, height = 0.18) {
  b.profile(
    c,
    [
      [0, 0],
      [width * 0.93, 0],
      [width, 0.035],
      [width * 0.95, height * 0.55],
      [width * 0.65, height],
      [0, height * 1.1],
    ],
    [0, 1.96, -0.035],
    [1, 1, 0.86],
    "head",
  );
}
function staff(b, c, kind = "twig", accent = "#d8ba77") {
  b.tube(
    c,
    [
      [0.48, 0.56, 0.24],
      [0.5, 0.98, 0.28],
      [0.53, 1.3, 0.3],
      [0.5, 1.52, 0.32],
    ],
    0.033,
    "prop",
  );
  if (kind === "twig") {
    b.leaf(accent, [0.51, 1.42, 0.33], 0.25, 0.17, "prop", [0, 0, -0.5]);
    b.leaf(accent, [0.53, 1.44, 0.31], 0.18, 0.11, "prop", [0, 0, 0.65]);
  }
}

function radialPoints(count, outer, inner = outer, phase = 0) {
  const pts = [];
  for (let i = 0; i < count * (outer === inner ? 1 : 2); i++) {
    const angle =
        phase + (i * Math.PI * 2) / (count * (outer === inner ? 1 : 2)),
      r = i % 2 ? inner : outer;
    pts.push([Math.cos(angle) * r, Math.sin(angle) * r]);
  }
  return pts;
}
function brim(b, c, radius = 0.5, y = 1.98, sides = b.sides) {
  b.profile(
    c,
    [
      [0, -0.012],
      [radius, -0.012],
      [radius, 0.025],
      [0, 0.028],
    ],
    [0, y, -0.025],
    [1, 1, 0.8],
    "head",
    "body",
    sides,
  );
}
function scroll(b, c, trim, p = [-0.44, 0.92, 0.27], joint = "forearmL") {
  b.rod(c, [p[0], p[1] - 0.17, p[2]], [p[0], p[1] + 0.17, p[2]], 0.086, joint);
  for (const y of [-0.18, 0.18])
    b.oval(
      trim,
      [p[0], p[1] + y, p[2]],
      [0.105, 0.032, 0.105],
      joint,
      "body",
      "tiny",
    );
}
function shell(b, c, trim, p = [0.51, 1.47, 0.33], j = "prop") {
  b.panel(
    c,
    [
      [0, -0.09],
      [-0.18, 0.02],
      [-0.2, 0.15],
      [-0.12, 0.24],
      [0, 0.27],
      [0.12, 0.24],
      [0.2, 0.15],
      [0.18, 0.02],
    ],
    p,
    0.1,
    j,
  );
  for (const x of [-0.12, 0, 0.12])
    b.rod(
      trim,
      [p[0], p[1] - 0.055, p[2] + 0.059],
      [p[0] + x, p[1] + 0.19, p[2] + 0.059],
      0.012,
      j,
      "accent",
      4,
    );
}

function base(b, id, p, garmentDetail) {
  const shade = (geometry, region) => id === 'leaf_ranger' && garmentDetail ? shadeRangerGarment(geometry, region) : geometry;
  const [cloth, lining, accent, leather] = p,
    robot = id === "copper_gardener";
  const skin = robot ? "#c6a06f" : "#e8b996",
    hair =
      id === "moon_librarian"
        ? "#4b3b4b"
        : id === "aurora_storyteller"
          ? "#657284"
          : "#6b4938";
  const long = [
    "butterfly_scholar",
    "moon_librarian",
    "aurora_storyteller",
  ].includes(id);
  // Closed tailored torso, gently pinched at the waist; separate pants and rounded toe caps.
  if (!robot)
    shade(b.profile(
      cloth,
      [
        [0, long ? 0.27 : 0.48],
        [long ? 0.29 : 0.35, long ? 0.27 : 0.48],
        [long ? 0.3 : 0.34, long ? 0.44 : 0.59],
        [0.25, 0.92],
        [0.27, 1.16],
        [0.23, 1.31],
        [0, 1.34],
      ],
      [0, 0, 0],
      [1, 1, 0.73],
    ), 'tunic');
  for (const s of [-1, 1]) {
    const j = s < 0 ? "legL" : "legR",
      arm = s < 0 ? "upperArmL" : "upperArmR",
      fore = s < 0 ? "forearmL" : "forearmR";
    b.oval(lining, [s * 0.17, 0.39, 0], [0.128, 0.25, 0.135], j);
    shade(b.boot(leather, [s * 0.17, 0, 0], j), 'boot');
    if (b.quality !== "low") {
      b.profile(
        lining,
        [
          [0.11, 0],
          [0.136, 0],
          [0.136, 0.055],
          [0.11, 0.055],
          [0.11, 0],
        ],
        [s * 0.17, 0.285, 0],
        [1, 1, 1],
        j,
      );
    }
    shade(b.oval(
      cloth,
      [s * 0.32, 1.18, 0.015],
      [0.17, 0.21, 0.165],
      arm,
      "body",
      "normal",
      [0, 0, s * 0.28],
    ), 'sleeve');
    shade(b.oval(
      cloth,
      [s * 0.435, 1.015, 0.09],
      [0.125, 0.185, 0.14],
      fore,
      "body",
      "normal",
      [0, 0, s * 0.23],
    ), 'sleeve');
    b.oval(
      lining,
      [s * 0.45, 0.94, 0.13],
      [0.139, 0.067, 0.145],
      fore,
      "body",
      "tiny",
    );
    b.oval(
      skin,
      [s * 0.468, 0.865, 0.17],
      [0.1, 0.118, 0.087],
      fore,
      "body",
      "tiny",
    );
    b.oval(
      skin,
      [s * 0.396, 0.885, 0.224],
      [0.044, 0.066, 0.046],
      fore,
      "body",
      "tiny",
      [0, 0, s * -0.42],
    );
    if (b.quality === "high")
      for (let k = 0; k < 3; k++)
        b.oval(
          skin,
          [s * (0.431 + k * 0.025), 0.797, 0.18],
          [0.021, 0.047, 0.04],
          fore,
          "body",
          "tiny",
        );
  }
  shade(b.profile(
    leather,
    [
      [0, 0.88],
      [0.269, 0.88],
      [0.272, 0.955],
      [0, 0.955],
    ],
    [0, 0, 0],
    [1, 1, 0.76],
  ), 'belt');
  b.box(accent, [0, 0.914, 0.221], [0.095, 0.077, 0.033], "body", [], "accent");
  shade(b.oval(lining, [0, 1.29, 0.1], [0.225, 0.075, 0.2]), 'collar');
  // A rounded face with cheeks, a protruding nose, inset eyes and a sculpted smile.
  b.oval(
    skin,
    [0, 1.716, 0.035],
    [0.365, 0.388, 0.307],
    "head",
    "body",
    "face",
  );
  for (const s of [-1, 1]) {
    b.oval(
      skin,
      [s * 0.357, 1.723, 0.018],
      [0.073, 0.115, 0.061],
      "head",
      "body",
      "tiny",
    );
    b.oval(
      "#c88376",
      [s * 0.215, 1.63, 0.279],
      [0.074, 0.038, 0.025],
      "head",
      "body",
      "tiny",
    );
    b.oval(
      "#fff0d6",
      [s * 0.137, 1.756, 0.302],
      [0.088, 0.096, 0.025],
      "head",
      "accent",
      "tiny",
    );
    b.oval(
      "#303737",
      [s * 0.127, 1.758, 0.326],
      [0.049, 0.07, 0.016],
      "head",
      "accent",
      "tiny",
    );
    b.oval(
      "#fcf0ce",
      [s * 0.118 - 0.012, 1.785, 0.34],
      [0.017, 0.02, 0.008],
      "head",
      "accent",
      "tiny",
    );
    if (b.quality !== "low")
      b.tube(
        hair,
        [
          [s * 0.212, 1.804, 0.302],
          [s * 0.157, 1.848, 0.319],
          [s * 0.107, 1.843, 0.326],
        ],
        0.009,
        "head",
        "body",
        4,
      );
    b.tube(
      hair,
      [
        [s * 0.205, 1.886, 0.277],
        [s * 0.139, 1.902, 0.296],
        [s * 0.084, 1.883, 0.29],
      ],
      0.012,
      "head",
      "body",
      b.quality === "low" ? 2 : 4,
    );
  }
  b.oval(skin, [0, 1.66, 0.325], [0.063, 0.07, 0.076], "head", "body", "tiny");
  b.tube(
    "#9a5f4e",
    [
      [-0.08, 1.587, 0.321],
      [0, 1.568, 0.333],
      [0.08, 1.587, 0.321],
    ],
    0.01,
    "head",
    "body",
    b.quality === "low" ? 3 : 6,
  );
  if (!robot) {
    b.oval(
      hair,
      [0, 1.84, -0.09],
      [0.365, 0.267, 0.284],
      "head",
      "body",
      "normal",
    );
    if (
      ![
        "mushroom_keeper",
        "acorn_captain",
        "rain_traveler",
        "river_boatkeeper",
        "snow_postkeeper",
        "ember_apprentice",
        "moon_librarian",
        "star_cartographer",
        "cloud_pilot",
        "paper_adventurer",
        "tea_alchemist",
      ].includes(id)
    )
      b.profile(
        hair,
        [
          [0, 0],
          [0.325, 0],
          [0.357, 0.025],
          [0.31, 0.1],
          [0.16, 0.15],
          [0, 0.16],
        ],
        [0, 1.96, 0.006],
        [1, 1, 0.83],
        "head",
      );
    b.oval(
      hair,
      [-0.205, 1.978, 0.243],
      [0.145, 0.074, 0.068],
      "head",
      "body",
      "tiny",
      [0, 0, -0.24],
    );
    b.oval(
      hair,
      [-0.035, 2.009, 0.266],
      [0.145, 0.06, 0.062],
      "head",
      "body",
      "tiny",
      [0, 0, 0.15],
    );
    b.oval(
      hair,
      [0.191, 1.995, 0.231],
      [0.104, 0.063, 0.067],
      "head",
      "body",
      "tiny",
      [0, 0, 0.5],
    );
  }
  if (b.quality !== "low")
    for (const s of [-1, 1])
      b.tube(
        lining,
        [
          [s * 0.2, 0.58, 0.225],
          [s * 0.18, 0.77, 0.228],
          [s * 0.145, 1.13, 0.2],
        ],
        0.008,
      );
}
function decorate(b, id, p) {
  const [c, l, a, d] = p;
  switch (id) {
    case "forest_apprentice":
      cape(b, c, 0.64, 0.43);
      cape(b, c, 0.64, 0.43, "capeR", 1);
      b.panel(
        l,
        [
          [-0.25, 0.02],
          [0, -0.19],
          [0.03, 0.02],
        ],
        [0, 1.32, 0.245],
        0.04,
      );
      b.panel(
        l,
        [
          [0.25, 0.02],
          [0, -0.19],
          [-0.03, 0.02],
        ],
        [0, 1.32, 0.245],
        0.04,
      );
      book(b, c, l);
      staff(b, d, "twig", a);
      break;
    case "leaf_ranger":
      for (const s of [-1, 0, 1])
        b.leaf(
          s === 0 ? a : c,
          [s * 0.21, 1.95, -0.055],
          s === 0 ? 0.46 : 0.34,
          0.35,
          "head",
          [0.32, s * 0.4, s * -0.6],
        );
      cape(b, c, 0.67, 0.5);
      cape(b, a, 0.67, 0.5, "capeR", 1);
      bag(b, d, l, [-0.37, 0.75, 0.17]);
      staff(b, d, "twig", a);
      break;
    case "mushroom_keeper":
      b.profile(
        c,
        [
          [0, 0],
          [0.58, 0],
          [0.66, 0.055],
          [0.61, 0.15],
          [0.44, 0.32],
          [0.23, 0.37],
          [0, 0.38],
        ],
        [0, 1.975, -0.02],
        [1, 1, 0.83],
        "head",
        "body",
        b.quality === "low" ? 12 : b.sides,
      );
      b.profile(
        l,
        [
          [0, -0.025],
          [0.57, -0.025],
          [0.59, 0],
          [0, 0.005],
        ],
        [0, 1.975, -0.02],
        [1, 1, 0.83],
        "head",
        "body",
        b.quality === "low" ? 12 : b.sides,
      );
      for (const [x, y, z, s] of [
        [-0.25, 2.175, 0.435, 0.105],
        [0.18, 2.275, 0.317, 0.11],
        [0.45, 2.1, 0.357, 0.073],
      ])
        b.oval(l, [x, y, z], [s, s * 0.7, 0.026], "head", "body", "tiny");
      apron(b, l);
      b.oval(d, [0.52, 1.11, 0.29], [0.18, 0.18, 0.15], "prop");
      b.tube(
        d,
        [
          [0.63, 1.12, 0.31],
          [0.78, 1.24, 0.32],
          [0.78, 1.34, 0.32],
        ],
        0.042,
        "prop",
      );
      b.arc(d, [0.36, 1.18, 0.3], 0.12, 0.4, TAU - 0.4, "prop", "body", 0.028);
      b.profile(
        d,
        [
          [0, 0],
          [0.13, 0],
          [0.16, 0.18],
          [0, 0.18],
        ],
        [-0.39, 0.73, 0.16],
      );
      b.leaf(a, [-0.39, 0.9, 0.16], 0.28, 0.17);
      b.leaf(a, [-0.39, 0.91, 0.16], 0.2, 0.12, "body", [0, 0, -0.7]);
      break;
    case "butterfly_scholar":
      for (const s of [-1, 1]) {
        const j = s < 0 ? "capeL" : "capeR";
        b.softPanel(
          c,
          [
            [0, 0],
            [s * 0.14, 0.49],
            [s * 0.53, 0.81],
            [s * 0.79, 0.69],
            [s * 0.75, 0.38],
            [s * 0.48, 0.03],
            [s * 0.66, -0.4],
            [s * 0.35, -0.55],
            [s * 0.08, -0.3],
          ],
          [s * 0.08, 1.3, -0.24],
          0.08,
          j,
          [0, s * 0.1, 0],
        );
        b.softPanel(
          l,
          [
            [0, 0],
            [s * 0.11, 0.22],
            [s * 0.43, 0.54],
            [s * 0.58, 0.48],
            [s * 0.53, 0.27],
            [s * 0.17, 0.01],
          ],
          [s * 0.13, 1.39, -0.17],
          0.03,
          j,
        );
        b.leaf(a, [s * 0.18, 0.85, -0.18], 0.45, 0.23, j, [0, 0, s * -0.4]);
      }
      book(b, c, l);
      staff(b, d, "twig", a);
      b.leaf(l, [-0.08, 2.05, 0.01], 0.25, 0.16, "head", [0.3, 0, 0.7]);
      b.leaf(l, [0.08, 2.05, 0.01], 0.25, 0.16, "head", [0.3, 0, -0.7]);
      break;

    case "acorn_captain":
      headCap(b, a, 0.42, 0.21);
      brim(b, d, 0.433, 1.995);
      b.taper(
        d,
        [
          [0, 2.18, -0.04],
          [0.02, 2.33, -0.05],
          [0.08, 2.37, -0.045],
        ],
        [0.07, 0.055, 0.025],
        "head",
      );
      for (const side of [-1, 1])
        b.oval(
          a,
          [side * 0.32, 1.29, 0.005],
          [0.26, 0.13, 0.23],
          side < 0 ? "upperArmL" : "upperArmR",
        );
      cape(b, c, 0.49, 0.4);
      cape(b, c, 0.49, 0.4, "capeR", 1);
      b.leaf(a, [0, 0.56, -0.35], 0.88, 0.57, "body", [0, Math.PI, 0.0]);
      staff(b, d, "twig", l);
      break;
    case "rain_traveler":
      b.profile(
        c,
        [
          [0, 0],
          [0.47, 0],
          [0.49, 0.055],
          [0.36, 0.11],
          [0.32, 0.33],
          [0.18, 0.39],
          [0, 0.39],
        ],
        [0, 1.96, -0.02],
        [1, 1, 0.87],
        "head",
      );
      b.profile(
        c,
        [
          [0, 0.55],
          [0.49, 0.55],
          [0.47, 0.65],
          [0.28, 1.31],
          [0, 1.35],
        ],
        [0, 0, 0],
        [1, 1, 0.75],
      );
      b.panel(
        l,
        [
          [-0.055, 0.3],
          [0.055, 0.3],
          [0.11, -0.34],
          [-0.11, -0.34],
        ],
        [0, 0.98, 0.28],
        0.05,
      );
      for (const side of [-1, 1])
        b.profile(
          d,
          [
            [0, 0],
            [0.145, 0],
            [0.15, 0.28],
            [0, 0.29],
          ],
          [side * 0.17, 0.14, 0.07],
          [1, 1, 0.95],
          side < 0 ? "legL" : "legR",
        );
      staff(b, d, "none");
      b.taper(
        c,
        [
          [0.5, 1.2, 0.31],
          [0.52, 1.44, 0.32],
          [0.51, 1.75, 0.31],
        ],
        [0.035, 0.13, 0.008],
        "prop",
      );
      b.leaf(a, [-0.37, 0.75, 0.26], 0.22, 0.17, "body", [0, 0, Math.PI]);
      break;
    case "coral_listener":
      for (const side of [-1, 0, 1]) {
        const x = side * 0.22;
        b.tube(
          a,
          [
            [x, 1.98, 0.035],
            [x + side * 0.015, 2.18, 0.035],
            [x + side * 0.06, 2.34 + (!side ? 0.08 : 0), 0.025],
          ],
          0.045,
          "head",
        );
        b.tube(
          a,
          [
            [x, 2.12, 0.035],
            [x - 0.09, 2.2, 0.04],
            [x - 0.1, 2.26, 0.04],
          ],
          0.026,
          "head",
        );
      }
      {
        const g = b.profile(
            c,
            [
              [0, 0.43],
              [0.42, 0.43],
              [0.43, 0.54],
              [0.29, 0.91],
              [0, 0.94],
            ],
            [0, 0, 0],
            [1, 1, 0.74],
            "body",
            "body",
            b.quality === "low" ? 10 : 30,
          ),
          pos = g.attributes.position;
        for (let n = 0; n < pos.count; n++) {
          const x = pos.getX(n),
            z = pos.getZ(n),
            y = pos.getY(n);
          if (y < 0.6 && Math.abs(x) + Math.abs(z) > 0.1)
            pos.setY(n, y + 0.058 * Math.cos(Math.atan2(z / 0.74, x) * 5));
        }
        g.computeVertexNormals();
        const normals = g.attributes.normal;
        for (let n = 0; n < normals.count; n++)
          if (
            normals.getX(n) ** 2 + normals.getY(n) ** 2 + normals.getZ(n) ** 2 <
            0.1
          )
            normals.setXYZ(n, 0, pos.getY(n) < 0.65 ? -1 : 1, 0);
      }
      b.softPanel(
        l,
        [
          [-0.18, 0.19],
          [0.18, 0.19],
          [0.21, -0.12],
          [0, -0.24],
          [-0.21, -0.12],
        ],
        [0, 0.85, 0.259],
        0.032,
      );
      for (const side of [-1, 1])
        b.oval(
          l,
          [side * 0.37, 1.69, 0.085],
          [0.08, 0.1, 0.07],
          "head",
          "accent",
          "tiny",
        );
      staff(b, d, "none");
      shell(b, l, a);
      b.panel(
        a,
        [
          [0, 0.12],
          [0.1, 0],
          [0.04, -0.12],
          [-0.09, -0.06],
        ],
        [-0.34, 0.84, 0.24],
        0.09,
      );
      break;
    case "river_boatkeeper":
      brim(b, a, 0.65, 1.99);
      headCap(b, a, 0.34, 0.16);
      b.profile(
        d,
        [
          [0, 0],
          [0.35, 0],
          [0.35, 0.045],
          [0, 0.045],
        ],
        [0, 2.01, -0.035],
        [1, 1, 0.85],
        "head",
      );
      b.profile(
        l,
        [
          [0.16, 0],
          [0.33, -0.035],
          [0.37, 0.05],
          [0.29, 0.14],
          [0.16, 0.09],
          [0.16, 0],
        ],
        [0, 1.21, 0.02],
        [1, 1, 0.81],
      );
      b.tube(
        l,
        [
          [-0.24, 1.21, -0.23],
          [0.01, 1.02, -0.24],
          [0.23, 0.82, -0.22],
        ],
        0.024,
      );
      b.tube(
        l,
        [
          [0.24, 1.21, -0.23],
          [0, 1.01, -0.25],
          [-0.23, 0.82, -0.23],
        ],
        0.024,
      );
      b.panel(
        d,
        [
          [-0.19, 0.05],
          [0.18, 0.05],
          [0.11, -0.1],
          [-0.12, -0.1],
        ],
        [-0.37, 0.76, 0.18],
        0.14,
      );
      staff(b, d, "none");
      b.panel(
        a,
        [
          [-0.075, -0.09],
          [0.075, -0.09],
          [0.125, 0.22],
          [0.06, 0.3],
          [-0.06, 0.3],
          [-0.125, 0.22],
        ],
        [0.51, 1.39, 0.32],
        0.09,
        "prop",
      );
      break;
    case "snow_postkeeper":
      headCap(b, c, 0.37, 0.15);
      for (const side of [-1, 1])
        b.oval(l, [side * 0.385, 1.82, 0.035], [0.13, 0.145, 0.13], "head");
      cape(b, c, 0.62, 0.5);
      cape(b, c, 0.62, 0.5, "capeR", 1);
      for (const side of [-1, 1])
        b.tube(
          l,
          [
            [side * 0.2, 1.31, -0.14],
            [side * 0.45, 1.03, -0.16],
            [side * 0.54, 0.79, -0.14],
            [side * 0.29, 0.68, -0.15],
          ],
          0.05,
          side < 0 ? "capeL" : "capeR",
        );
      bag(b, d, l, [-0.37, 0.77, 0.25], true);
      b.rod(d, [0.22, 1.29, 0.23], [-0.3, 0.88, 0.31], 0.035);
      staff(b, d, "none");
      b.panel(
        l,
        radialPoints(6, 0.17, 0.08, Math.PI / 2),
        [0.51, 1.58, 0.32],
        0.07,
        "prop",
      );
      break;
    case "ember_apprentice":
      brim(b, c, 0.42, 1.985);
      b.taper(
        c,
        [
          [0, 2.01, -0.04],
          [0, 2.23, -0.08],
          [0.06, 2.4, -0.24],
          [0.13, 2.42, -0.4],
        ],
        [0.35, 0.25, 0.12, 0.012],
        "head",
      );
      for (const side of [-1, 1]) {
        b.oval(
          a,
          [side * 0.32, 1.29, 0.02],
          [0.245, 0.09, 0.2],
          side < 0 ? "upperArmL" : "upperArmR",
        );
        b.oval(
          c,
          [side * 0.33, 1.35, 0.02],
          [0.2, 0.055, 0.18],
          side < 0 ? "upperArmL" : "upperArmR",
        );
      }
      for (let k = 0; k < 3; k++)
        b.panel(
          k % 2 ? a : l,
          [
            [-0.12, 0.12],
            [0.12, 0.04],
            [0.06, -0.12],
            [-0.1, -0.06],
          ],
          [-0.36, 0.77, 0.17 + k * 0.055],
          0.05,
        );
      staff(b, a, "none");
      b.profile(
        c,
        [
          [0, 0],
          [0.12, 0],
          [0.15, 0.15],
          [0, 0.14],
        ],
        [0.51, 1.42, 0.32],
        [1, 1, 1],
        "prop",
      );
      b.leaf(d, [0.5, 1.52, 0.32], 0.22, 0.15, "prop", [0, 0, -0.18], "accent");
      break;
    case "lantern_festival":
      for (let k = 0; k < 4; k++) {
        const angle = (k * Math.PI) / 2;
        b.leaf(
          k % 2 ? a : c,
          [Math.sin(angle) * 0.12, 1.995, Math.cos(angle) * 0.12],
          0.33,
          0.3,
          "head",
          [Math.cos(angle) * 0.5, angle, Math.sin(angle) * -0.5],
        );
      }
      for (const side of [-1, 1])
        b.oval(
          c,
          [side * 0.4, 1.12, 0.02],
          [0.23, 0.24, 0.19],
          side < 0 ? "upperArmL" : "upperArmR",
        );
      b.panel(
        a,
        [
          [-0.025, 0],
          [0.055, 0],
          [0.12, -0.31],
          [0.035, -0.25],
        ],
        [0.16, 0.91, 0.24],
        0.045,
      );
      b.panel(
        l,
        [
          [-0.025, 0],
          [0.055, 0],
          [0.03, -0.28],
          [-0.05, -0.33],
        ],
        [-0.15, 0.91, 0.24],
        0.045,
      );
      b.rod(d, [0.48, 0.88, 0.22], [0.56, 1.37, 0.33], 0.026, "prop");
      b.arc(a, [0.57, 1.37, 0.33], 0.115, 0, Math.PI, "prop", "body", 0.023);
      for (const side of [-1, 1])
        b.oval(
          l,
          [0.56 + side * 0.07, 1.15, 0.34],
          [0.13, 0.2, 0.15],
          "prop",
          "accent",
          "normal",
        );
      b.profile(
        a,
        [
          [0, 0],
          [0.14, 0],
          [0.14, 0.04],
          [0, 0.04],
        ],
        [0.56, 0.96, 0.34],
        [1, 1, 1],
        "prop",
      );
      break;
    case "sun_clockmaker":
      goggles(b, a, "#607f79");
      b.panel(
        a,
        radialPoints(8, 0.265, 0.215),
        [-0.35, 1.24, 0.04],
        0.16,
        "upperArmL",
        [0.05, 0.2, -0.15],
      );
      b.oval(
        d,
        [-0.35, 1.24, 0.135],
        [0.13, 0.13, 0.035],
        "upperArmL",
        "accent",
        "tiny",
      );
      apron(b, l, true, true);
      b.rod(a, [-0.31, 0.6, 0.24], [-0.34, 0.83, 0.24], 0.038);
      b.arc(
        a,
        [-0.34, 0.85, 0.24],
        0.068,
        Math.PI * 0.05,
        Math.PI * 0.95,
        "body",
        "accent",
        0.028,
      );
      staff(b, d, "none");
      b.oval(
        a,
        [0.51, 1.56, 0.33],
        [0.205, 0.205, 0.057],
        "prop",
        "accent",
        "normal",
      );
      b.oval(
        l,
        [0.51, 1.56, 0.389],
        [0.164, 0.164, 0.014],
        "prop",
        "accent",
        "tiny",
      );
      b.panel(
        a,
        [
          [0, 0],
          [0.095, 0.11],
          [0.01, 0.15],
        ],
        [0.51, 1.52, 0.425],
        0.08,
        "prop",
      );
      break;
    case "phoenix_courier":
      for (const side of [-1, 0, 1])
        b.leaf(a, [side * 0.13, 1.96, -0.05], 0.52, 0.2, "head", [
          0.72,
          side * 0.28,
          side * -0.22,
        ]);
      for (const side of [-1, 1])
        for (let k = 0; k < 3; k++)
          b.leaf(
            k % 2 ? l : a,
            [side * (0.16 + k * 0.07), 1.32, -0.2 - k * 0.055],
            0.75 - k * 0.075,
            0.23,
            side < 0 ? "capeL" : "capeR",
            [0.1, side * 0.15, Math.PI + side * 0.16],
          );
      b.rod(d, [-0.24, 1.23, 0.24], [0.25, 0.68, 0.27], 0.033);
      b.rod(a, [0.16, 0.79, 0.27], [0.38, 1.07, 0.27], 0.095);
      staff(b, d, "none");
      b.leaf(a, [0.5, 1.37, 0.33], 0.39, 0.19, "prop", [0, 0, -0.25]);
      break;
    case "moon_librarian":
      brim(b, c, 0.4, 1.98);
      b.taper(
        c,
        [
          [0, 2.02, -0.025],
          [0.015, 2.26, -0.06],
          [0.16, 2.45, -0.07],
          [0.28, 2.42, -0.06],
        ],
        [0.3, 0.19, 0.095, 0.01],
        "head",
      );
      for (const side of [-1, 1])
        b.panel(
          l,
          [
            [0, 0.34],
            [0.05, 0.34],
            [0.1, -0.64],
            [0.025, -0.64],
          ],
          [side * 0.065, 0.95, 0.258],
          0.031,
          "body",
          [0, 0, side * -0.1],
        );
      book(b, c, d);
      staff(b, l, "none");
      b.arc(
        l,
        [0.52, 1.56, 0.33],
        0.18,
        Math.PI * 0.3,
        Math.PI * 1.86,
        "prop",
        "accent",
        0.041,
      );
      b.tube(
        a,
        [
          [-0.17, 0.94, 0.255],
          [-0.14, 0.73, 0.29],
          [-0.21, 0.64, 0.27],
        ],
        0.025,
      );
      break;
    case "star_cartographer":
      b.panel(
        a,
        radialPoints(6, 0.51, 0.41, Math.PI / 6),
        [0, 2.01, -0.02],
        0.055,
        "head",
        [Math.PI / 2, 0, 0],
      );
      headCap(b, c, 0.3, 0.14);
      for (const side of [-1, 1])
        b.softPanel(
          c,
          [
            [-0.19, 0.09],
            [0.17, 0.13],
            [0.2, -0.11],
            [-0.16, -0.13],
          ],
          [side * 0.42, 1.17, 0.0],
          0.28,
          side < 0 ? "upperArmL" : "upperArmR",
          [0, 0, side * 0.12],
          "body",
          0.13,
        );
      b.panel(
        l,
        [
          [-0.33, 0.27],
          [0.34, 0.27],
          [0.44, -0.24],
          [0.23, -0.19],
          [0.11, -0.34],
          [-0.3, -0.29],
        ],
        [0, 1.0, -0.28],
        0.06,
      );
      for (const side of [-1, 1])
        b.panel(
          a,
          [
            [0, 0.1],
            [side * 0.13, -0.045],
            [0, -0.08],
          ],
          [side * 0.25, 0.78, -0.323],
          0.04,
          "body",
          [0, side * 0.24, 0],
        );
      scroll(b, d, a, [-0.37, 0.76, 0.18], "body");
      b.rod(a, [0.51, 0.87, 0.28], [0.53, 1.57, 0.32], 0.03, "prop");
      for (const side of [-1, 1])
        b.rod(
          l,
          [0.53, 1.64, 0.32],
          [0.53 + side * 0.15, 1.36, 0.32],
          0.036,
          "prop",
          "accent",
        );
      b.oval(
        a,
        [0.53, 1.64, 0.32],
        [0.065, 0.065, 0.045],
        "prop",
        "accent",
        "tiny",
      );
      break;
    case "cloud_pilot":
      headCap(b, d, 0.365, 0.15);
      for (const side of [-1, 1])
        b.oval(d, [side * 0.345, 1.87, -0.015], [0.095, 0.17, 0.17], "head");
      goggles(b, a, l);
      for (const side of [-1, 0, 1])
        b.oval(
          l,
          [side * 0.22, 1.29, 0.1 - Math.abs(side) * 0.06],
          [0.19, 0.12, 0.18],
        );
      b.box(d, [0, 1.06, -0.29], [0.43, 0.43, 0.15]);
      for (const side of [-1, 1]) {
        b.panel(
          l,
          [
            [0, 0.22],
            [side * 0.22, 0.3],
            [side * 0.28, -0.3],
            [side * 0.18, -0.25],
            [side * 0.1, -0.35],
            [0, -0.29],
          ],
          [side * 0.11, 1.12, -0.4],
          0.08,
          side < 0 ? "capeL" : "capeR",
        );
      }
      staff(b, d, "none");
      b.rod(l, [0.33, 1.54, 0.33], [0.73, 1.54, 0.33], 0.025, "prop");
      b.panel(
        a,
        [
          [0, 0.1],
          [0.13, 0],
          [0, -0.1],
        ],
        [0.66, 1.54, 0.33],
        0.06,
        "prop",
      );
      break;
    case "crystal_mason":
      b.profile(
        a,
        [
          [0.33, 0],
          [0.359, 0],
          [0.359, 0.043],
          [0.33, 0.043],
          [0.33, 0],
        ],
        [0, 1.987, 0.005],
        [1, 1, 0.81],
        "head",
        "accent",
      );
      for (const side of [-1, 0, 1])
        b.panel(
          side === 0 ? d : a,
          [
            [0, 0.13],
            [0.075, 0.02],
            [0.045, -0.07],
            [-0.05, -0.07],
            [-0.075, 0.02],
          ],
          [side * 0.21, 2.04, 0.24],
          0.1,
          "head",
          [0, 0, 0],
          "accent",
        );
      for (const side of [-1, 1])
        b.panel(
          a,
          [
            [-0.17, 0.1],
            [0.08, 0.12],
            [0.18, 0],
            [0.1, -0.14],
            [-0.15, -0.09],
          ],
          [side * 0.32, 1.28, 0.01],
          0.27,
          side < 0 ? "upperArmL" : "upperArmR",
          [0, 0, 0],
          "accent",
        );
      apron(b, l);
      b.box(a, [-0.36, 0.73, 0.14], [0.25, 0.22, 0.2]);
      staff(b, d, "none");
      b.panel(
        a,
        [
          [-0.21, 0.13],
          [0.17, 0.13],
          [0.23, 0.06],
          [0.23, -0.07],
          [0.16, -0.14],
          [-0.16, -0.14],
          [-0.23, -0.06],
          [-0.23, 0.05],
        ],
        [0.51, 1.57, 0.33],
        0.21,
        "prop",
        [0, 0, 0],
        "accent",
      );
      b.panel(
        d,
        [
          [-0.15, 0.06],
          [0.14, 0.06],
          [0.18, 0],
          [-0.17, -0.07],
        ],
        [0.51, 1.62, 0.442],
        0.02,
        "prop",
        [0, 0, 0],
        "accent",
      );
      break;
    case "paper_adventurer":
      for (const side of [-1, 1])
        b.panel(
          l,
          [
            [-0.49, -0.045],
            [0.02, 0.34],
            [0.48, -0.045],
          ],
          [0, 2.01, side * 0.12],
          0.045,
          "head",
          [side * -0.4, 0, 0],
        );
      b.panel(
        c,
        [
          [-0.49, 0],
          [0.08, 0.12],
          [0.48, 0],
          [0.42, -0.045],
          [-0.43, -0.045],
        ],
        [0, 1.995, 0.18],
        0.045,
        "head",
      );
      b.panel(
        l,
        [
          [-0.36, 0.18],
          [0.28, 0.17],
          [0.48, -0.23],
          [0.1, -0.38],
          [-0.48, -0.16],
        ],
        [0, 1.11, -0.18],
        0.085,
      );
      b.panel(
        c,
        [
          [-0.35, 0.12],
          [0.02, 0.08],
          [0.12, -0.29],
          [-0.42, -0.12],
        ],
        [0, 1.1, -0.125],
        0.035,
      );
      b.panel(
        l,
        [
          [-0.15, 0],
          [-0.045, 0.19],
          [0.045, 0.02],
          [0.16, 0.13],
          [0.13, -0.05],
          [0, -0.12],
        ],
        [-0.4, 1.44, 0.055],
        0.09,
        "upperArmL",
      );
      b.rod(l, [-0.35, 1.47, 0.06], [-0.3, 1.63, 0.06], 0.022, "upperArmL");
      b.panel(
        a,
        [
          [0, 0.04],
          [0.08, 0],
          [0, -0.035],
        ],
        [-0.29, 1.635, 0.06],
        0.05,
        "upperArmL",
      );
      staff(b, d, "none");
      b.panel(
        l,
        [
          [0, 0.2],
          [0.18, 0.04],
          [0, -0.17],
          [-0.17, 0.015],
        ],
        [0.51, 1.52, 0.33],
        0.085,
        "prop",
      );
      break;
    case "tea_alchemist":
      headCap(b, c, 0.35, 0.23);
      b.oval(a, [0, 2.25, -0.03], [0.17, 0.042, 0.14], "head", "body", "tiny");
      b.oval(
        c,
        [0, 2.31, -0.03],
        [0.057, 0.065, 0.057],
        "head",
        "body",
        "tiny",
      );
      b.taper(
        c,
        [
          [0.26, 2.12, -0.02],
          [0.43, 2.17, -0.02],
          [0.48, 2.27, -0.02],
        ],
        [0.087, 0.068, 0.043],
        "head",
      );
      b.arc(
        c,
        [-0.34, 2.13, -0.02],
        0.15,
        0.7,
        TAU - 0.7,
        "head",
        "body",
        0.039,
      );
      apron(b, l);
      scroll(b, c, a, [-0.35, 0.73, 0.13], "body");
      b.profile(
        a,
        [
          [0, 0],
          [0.11, 0],
          [0.16, 0.2],
          [0.115, 0.2],
          [0.06, 0.055],
          [0, 0.055],
        ],
        [0.5, 0.95, 0.3],
        [1, 1, 0.85],
        "prop",
        "accent",
      );
      b.arc(
        a,
        [0.64, 1.08, 0.3],
        0.08,
        -Math.PI / 2,
        Math.PI / 2,
        "prop",
        "accent",
        0.025,
      );
      b.leaf(c, [0.49, 1.16, 0.3], 0.16, 0.09, "prop", [0, 0, -0.6]);
      break;
    case "copper_gardener":
      b.oval(c, [0, 1.01, 0], [0.33, 0.38, 0.26]);
      b.oval(
        l,
        [0, 1.04, 0.253],
        [0.102, 0.12, 0.023],
        "body",
        "accent",
        "tiny",
      );
      b.leaf(
        a,
        [0, 0.994, 0.285],
        0.09,
        0.058,
        "body",
        [0, 0, -0.24],
        "accent",
      );
      for (const side of [-1, 1])
        b.oval(
          a,
          [side * 0.34, 1.23, 0.15],
          [0.044, 0.044, 0.025],
          side < 0 ? "upperArmL" : "upperArmR",
          "accent",
          "tiny",
        );
      b.profile(
        d,
        [
          [0, 0],
          [0.23, 0],
          [0.29, 0.27],
          [0.23, 0.27],
          [0.19, 0.2],
          [0, 0.2],
        ],
        [0, 1.985, -0.03],
        [1, 1, 0.86],
        "head",
      );
      b.rod(a, [0, 2.21, -0.03], [0, 2.4, -0.03], 0.022, "head");
      for (const side of [-1, 0, 1])
        b.leaf(a, [0, 2.33, -0.03], side === 0 ? 0.25 : 0.24, 0.145, "head", [
          0.12,
          side * 0.4,
          side * -0.75,
        ]);
      for (const side of [-1, 1])
        b.box(d, [side * 0.23, 1.03, -0.33], [0.06, 0.72, 0.075]);
      b.box(d, [0, 1.22, -0.36], [0.54, 0.06, 0.075]);
      b.box(d, [0, 0.87, -0.36], [0.54, 0.055, 0.07]);
      staff(b, d, "none");
      b.panel(
        l,
        [
          [-0.125, 0.15],
          [0.125, 0.15],
          [0.1, -0.08],
          [0, -0.17],
          [-0.1, -0.08],
        ],
        [0.51, 1.53, 0.32],
        0.09,
        "prop",
      );
      break;
    case "aurora_storyteller":
      for (let k = 0; k < 3; k++) {
        const outer = 0.36 + k * 0.047,
          g = b.profile(
            [l, a, d][k],
            [
              [0.17, 0.065],
              [0.24, 0.08],
              [outer, -0.025],
              [outer + 0.014, -0.065],
              [outer - 0.025, -0.084],
              [0.17, 0.027],
              [0.17, 0.065],
            ].reverse(),
            [0, 1.3 - k * 0.077, 0.015],
            [1, 1, 0.73],
          );
        const pos = g.attributes.position;
        for (let n = 0; n < pos.count; n++) {
          const x = pos.getX(n),
            z = pos.getZ(n) - 0.015;
          pos.setY(n, pos.getY(n) + 0.012 * Math.cos(Math.atan2(z, x) * 4));
        }
        g.computeVertexNormals();
      }
      for (const s of [-1, 1])
        b.panel(
          s < 0 ? l : a,
          [
            [0, 0],
            [0.13, 0],
            [0.17, -0.23],
            [0.1, -0.44],
            [0.15, -0.67],
            [0.02, -0.77],
            [-0.015, -0.49],
            [0.045, -0.22],
          ],
          [s * 0.34, 1.01, -0.12],
          0.055,
          s < 0 ? "capeL" : "capeR",
        );
      b.arc(d, [0, 2.035, 0.265], 0.13, Math.PI, TAU, "head", "accent", 0.028);
      scroll(b, l, d);
      staff(b, d, "none");
      b.tube(
        a,
        [
          [0.44, 1.39, 0.32],
          [0.62, 1.48, 0.32],
          [0.45, 1.61, 0.32],
          [0.58, 1.68, 0.32],
        ],
        0.058,
        "prop",
      );
      break;
    default:
      staff(b, d, "twig", a);
      cape(b, c);
      cape(b, c, 0.65, 0.5, "capeR", 1);
  }
}
export function createHeroModel(
  skinId = DEFAULT_HERO_SKIN,
  { quality = "medium", seat = 0, garmentDetail = true } = {},
) {
  const skin = getHeroSkin(skinId);
  quality = ["low", "medium", "high"].includes(quality) ? quality : "medium";
  const root = new Group();
  root.name = `hero:${skin.id}`;
  root.userData.skinId = skin.id;
  const b = new HeroGeometry(quality);
  base(b, skin.id, PALETTES[skin.id], garmentDetail);
  decorate(b, skin.id, PALETTES[skin.id]);
  b.profile(
    "#304c47",
    [
      [0, -0.07],
      [0.53, -0.07],
      [0.58, -0.025],
      [0.54, 0.003],
      [0, 0.003],
    ],
    [0, 0, 0],
    [1, 1, 0.79],
    "plinth",
    "plinth",
  );
  b.profile(
    seat === 1 ? "#b77568" : "#c8ae73",
    [
      [0.5, -0.035],
      [0.555, -0.025],
      [0.548, -0.003],
      [0.5, -0.016],
      [0.5, -0.035],
    ],
    [0, 0, 0],
    [1, 1, 0.79],
    "plinth",
    "plinth",
  );
  const compiled = b.compile(root),
    pickProxy = new Mesh(
      new BoxGeometry(1.25, 2.1, 1),
      new MeshBasicMaterial({ visible: false }),
    );
  pickProxy.name = "hero-fixed-pick-proxy";
  pickProxy.position.set(0, 1.05, 0);
  pickProxy.userData.pickProxy = true;
  root.add(pickProxy);
  const anchors = {};
  for (const [name, p] of Object.entries({
    feet: [0, 0, 0],
    impact: [0, 1.1, 0.16],
    label: [0, 2.88, 0],
    head: [0, 1.78, 0.05],
    projectile: [0.5, 1.5, 0.36],
  })) {
    const anchor = new Object3D();
    anchor.name = `hero-${name}-anchor`;
    anchor.position.set(...p);
    root.add(anchor);
    anchors[name] = anchor;
  }
  const matrices = {},
    previous = {},
    identity = new Matrix4(),
    q = new Quaternion(),
    e = new Euler(),
    v = new Vector3(),
    sc = new Vector3(1, 1, 1),
    translate = new Matrix4();
  for (const name of JOINT_NAMES) {
    matrices[name] = new Matrix4();
    previous[name] = new Float32Array(16).fill(NaN);
  }
  const poseValues = new Float64Array(JOINT_NAMES.length * 3),
    position = new Vector3(),
    normal = new Vector3();
  let disposed = false,
    lastIdle = -Infinity,
    atBind = false;
  const changed = Object.fromEntries(JOINT_NAMES.map((name) => [name, false]));
  const set = (name, x = 0, y = 0, z = 0) => {
    const i = JOINT_INDEX[name];
    poseValues[i] = x;
    poseValues[i + 1] = y;
    poseValues[i + 2] = z;
  };
  const bounds = new Box3();
  for (const item of compiled) bounds.union(item.mesh.geometry.boundingBox);
  const metrics = {
    skinId: skin.id,
    quality,
    meshes: 3,
    materialPasses: 3,
    triangles: compiled.reduce(
      (n, c) => n + c.mesh.geometry.index.count / 3,
      0,
    ),
    vertices: compiled.reduce(
      (n, c) => n + c.mesh.geometry.attributes.position.count,
      0,
    ),
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    poseBakes: 0,
  };
  function applyPose(pose = {}) {
    if (disposed) return;
    const reduced = !!pose.reducedMotion;
    if (reduced) {
      reset();
      return;
    }
    poseValues.fill(0);
    let idle = reduced ? 0 : finite(pose.idlePhase, finite(pose.time) * 1.6);
    const action = pose.action;
    const cast = pulse(
        pose.castProgress ??
          pose.attackProgress ??
          (action === "cast" ? pose.progress : 0),
      ),
      charge = pulse(
        pose.chargeProgress ?? (action === "charge" ? pose.progress : 0),
      ),
      hit = pulse(pose.hitProgress ?? (action === "hit" ? pose.progress : 0)),
      heal = pulse(
        pose.healProgress ?? (action === "heal" ? pose.progress : 0),
      ),
      armor = pulse(
        pose.armorProgress ?? (action === "armor" ? pose.progress : 0),
      ),
      win = pulse(pose.winProgress ?? (action === "win" ? pose.progress : 0)),
      lose = pulse(
        pose.loseProgress ?? (action === "lose" ? pose.progress : 0),
      );
    const active = cast + charge + hit + heal + armor + win + lose;
    if (
      !active &&
      !reduced &&
      pose.time !== undefined &&
      Math.floor(pose.time * 12) === lastIdle
    )
      return;
    lastIdle = active ? -Infinity : Math.floor(finite(pose.time, -100) * 12);
    if (!reduced) {
      set(
        "body",
        hit * -0.065 + lose * 0.06,
        Math.sin(idle) * 0.016,
        Math.sin(idle * 0.7) * 0.012,
      );
      set(
        "head",
        Math.sin(idle * 0.83) * 0.025 + lose * 0.075 - hit * 0.03,
        Math.sin(idle * 0.43) * 0.025,
        win * 0.04,
      );
      set(
        "upperArmR",
        -cast * 0.2 - charge * 0.14 - heal * 0.1,
        0,
        cast * -0.08 - win * 0.18,
      );
      set("forearmR", -cast * 0.28 - charge * 0.12, 0, cast * -0.07);
      set("upperArmL", heal * -0.1, 0, win * 0.15 - armor * 0.08);
      set("forearmL", armor * -0.12);
      set(
        "capeL",
        Math.sin(idle) * 0.025 + cast * 0.035,
        0,
        0.025 * Math.sin(idle * 0.7),
      );
      set(
        "capeR",
        Math.sin(idle + 0.7) * 0.025 + cast * 0.035,
        0,
        -0.025 * Math.sin(idle * 0.7),
      );
    }
    for (let index = 0; index < JOINT_NAMES.length; index++) {
      const name = JOINT_NAMES[index],
        pivot = JOINTS[name],
        m = matrices[name];
      e.set(
        poseValues[index * 3],
        poseValues[index * 3 + 1],
        poseValues[index * 3 + 2],
      );
      q.setFromEuler(e);
      v.set(...pivot);
      m.compose(v, q, sc);
      translate.makeTranslation(-pivot[0], -pivot[1], -pivot[2]);
      m.multiply(translate);
      if (PARENTS[name]) m.premultiply(matrices[PARENTS[name]]);
    }
    for (const name of JOINT_NAMES) {
      const values = matrices[name].elements,
        old = previous[name];
      let change = false;
      for (let k = 0; k < 16; k++)
        if (Math.abs(values[k] - old[k]) > 1e-7 || !Number.isFinite(old[k])) {
          change = true;
          break;
        }
      changed[name] = change;
      if (change) old.set(values);
    }
    let baked = false;
    for (const item of compiled) {
      const attr = item.mesh.geometry.attributes;
      let dirty = false;
      for (const range of item.ranges) {
        if (!changed[range.joint]) continue;
        const m = matrices[range.joint] ?? identity;
        for (let i = range.start; i < range.start + range.count; i++) {
          const offset = i * 3;
          position
            .fromArray(item.bindPosition, offset)
            .applyMatrix4(m)
            .toArray(attr.position.array, offset);
          normal
            .fromArray(item.bindNormal, offset)
            .transformDirection(m)
            .toArray(attr.normal.array, offset);
        }
        dirty = true;
      }
      if (dirty) {
        baked = true;
        attr.position.needsUpdate = true;
        attr.normal.needsUpdate = true;
        item.mesh.geometry.computeBoundingBox();
        item.mesh.geometry.computeBoundingSphere();
      }
    }
    anchors.projectile.position.set(0.5, 1.5, 0.36).applyMatrix4(matrices.prop);
    anchors.projectile.position.x = Math.max(
      0.35,
      Math.min(0.62, anchors.projectile.position.x),
    );
    anchors.projectile.position.y = Math.max(
      1.2,
      Math.min(1.65, anchors.projectile.position.y),
    );
    anchors.projectile.position.z = Math.max(
      0.32,
      Math.min(0.68, anchors.projectile.position.z),
    );
    if (baked) {
      metrics.poseBakes++;
      atBind = false;
    }
  }
  function reset() {
    if (disposed) return;
    lastIdle = -Infinity;
    if (atBind) return;
    for (const name of JOINT_NAMES) {
      matrices[name].identity();
      previous[name].set(matrices[name].elements);
    }
    for (const item of compiled) {
      const g = item.mesh.geometry;
      g.attributes.position.array.set(item.bindPosition);
      g.attributes.normal.array.set(item.bindNormal);
      g.attributes.position.needsUpdate = true;
      g.attributes.normal.needsUpdate = true;
      g.computeBoundingBox();
      g.computeBoundingSphere();
    }
    anchors.projectile.position.set(0.5, 1.5, 0.36);
    metrics.poseBakes++;
    atBind = true;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const c of compiled) {
      c.mesh.geometry.dispose();
      c.mesh.material.dispose();
      c.bindPosition = null;
      c.bindNormal = null;
    }
    compiled.length = 0;
    pickProxy.geometry.dispose();
    pickProxy.material.dispose();
    root.clear();
  }
  reset();
  return {
    root,
    anchors,
    pickProxy,
    metrics,
    bounds,
    skinId: skin.id,
    quality,
    applyPose,
    reset,
    cancel: reset,
    dispose,
    get disposed() {
      return disposed;
    },
    setVisualState(state = {}) {
      if (disposed) return;
      for (const item of compiled) {
        const m = item.mesh.material;
        m.emissive.set(
          state.healing ? "#38614a" : state.damaged ? "#704139" : "#000000",
        );
        m.emissiveIntensity = state.healing || state.damaged ? 0.14 : 0;
      }
    },
  };
}
export function createHero(options = {}) {
  return createHeroModel(options.skinId, options);
}
