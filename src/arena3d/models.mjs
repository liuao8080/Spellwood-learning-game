/**
 * Spellwood original procedural model library.
 * Coordinates: Y up, +Z forward, creatures grounded at Y=0.
 * No renderer, DOM, RAF, networking or game-state ownership.
 */
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import {
  ModelBuilder,
  clamp,
  extrudeShape,
  geometryBudget,
  leafSolid,
  localBounds,
  polygonSolid,
  roundedRectShape,
  roundedSlab,
  seededRandom,
  taperedTube,
} from "./model-utils.mjs";
import { EXPANSION_BUILDERS } from "./creature-expansion.mjs";

export const MODEL_VERSION = "3.1.0-models.1";
export const SUPPORTED_SPECIES = Object.freeze([
  "fox",
  "turtle",
  "owl",
  "rabbit",
  "stag",
  "dragon",
  "sprout",
  "sprite",
  "golem",
  ...Object.keys(EXPANSION_BUILDERS),
]);
const HALF_PI = Math.PI / 2;
const PALETTE = Object.freeze({
  stone: "#355b55",
  stoneDark: "#203e3a",
  stoneLight: "#507b6d",
  bronze: "#b98c48",
  bronzeDark: "#826037",
  bark: "#674831",
  barkLight: "#89613e",
  moss: "#749352",
  leaf: "#88ac50",
  darkLeaf: "#416544",
  cream: "#fae8c3",
  eye: "#162724",
  pupil: "#101a19",
  glint: "#fff5dd",
  amber: "#dca44c",
});

function anchor(parent, name, position) {
  const object = new Object3D();
  object.name = `anchor:${name}`;
  object.position.set(...position);
  parent.add(object);
  return object;
}

function pearBody(builder, part, color, position, scale = [1, 1, 1]) {
  const profile = [
    [0.02, 0],
    [0.28, 0.05],
    [0.42, 0.23],
    [0.44, 0.48],
    [0.35, 0.77],
    [0.22, 0.97],
    [0.03, 1.02],
  ].map((p) => new Vector2(...p));
  builder.add(
    part,
    new LatheGeometry(profile, builder.quality === "low" ? 12 : 18),
    color,
    { position, scale, style: "fur" },
  );
}

function eye(
  builder,
  part,
  position,
  size = 0.1,
  irisColor = "amber",
  rotationY = 0,
) {
  const [x, y, z] = position;
  builder.oval(
    part,
    "cream",
    [x, y, z],
    [size * 1.17, size * 1.27, size * 0.48],
    { style: "fur", rotation: [0, rotationY, 0] },
  );
  builder.oval(
    part,
    irisColor,
    [x, y, z + size * 0.36],
    [size * 0.82, size * 0.98, size * 0.41],
    { style: "eye", rotation: [0, rotationY, 0] },
  );
  builder.oval(
    part,
    "pupil",
    [x, y, z + size * 0.67],
    [size * 0.43, size * 0.7, size * 0.23],
    { style: "eye", rotation: [0, rotationY, 0] },
  );
  builder.oval(
    part,
    "glint",
    [x - size * 0.22, y + size * 0.35, z + size * 0.83],
    [size * 0.2, size * 0.24, size * 0.09],
    { style: "eye" },
  );
}

function buildFox(builder, body, rig) {
  const fur = "#d88844",
    dark = "#985022",
    light = "#f2b668";
  pearBody(builder, body, fur, [0, 0.08, -0.04], [0.92, 1.0, 0.85]);
  for (const s of [-1, 1]) {
    builder.oval(body, dark, [s * 0.31, 0.3, 0.01], [0.22, 0.27, 0.25], {
      style: "fur",
    });
    builder.oval(body, "cream", [s * 0.24, 0.13, 0.33], [0.14, 0.12, 0.25], {
      style: "fur",
    });
    builder.oval(body, fur, [s * 0.26, 0.53, 0.27], [0.095, 0.3, 0.11], {
      style: "fur",
      rotation: [0.13, 0, s * 0.12],
    });
  }
  builder.oval(body, "cream", [0, 0.58, 0.3], [0.26, 0.39, 0.1], {
    style: "fur",
  });
  // A short, genuinely thick cape with a pointed split hem.
  builder.add(
    body,
    polygonSolid(
      [
        [-0.39, 0.88],
        [-0.52, 0.4],
        [-0.2, 0.44],
        [0, 0.3],
        [0.22, 0.44],
        [0.51, 0.4],
        [0.37, 0.88],
      ],
      0.095,
      0.025,
    ),
    "darkLeaf",
    { position: [0, 0, -0.32], rotation: [-0.1, 0, 0], style: "leaf" },
  );
  builder.add(body, new TorusGeometry(0.235, 0.055, 6, 18), "darkLeaf", {
    position: [0, 0.94, -0.01],
    rotation: [HALF_PI, 0, 0],
    scale: [1.3, 1, 1],
    style: "leaf",
  });
  builder.oval(body, "bronze", [0, 0.9, 0.32], [0.08, 0.1, 0.04], {
    style: "metal",
  });
  rig.tail = builder.part("fox-tail", body, [-0.19, 0.34, -0.22]);
  builder.add(
    rig.tail,
    taperedTube(
      [
        [0, 0, 0],
        [-0.41, 0.06, -0.06],
        [-0.62, 0.24, 0.27],
        [-0.53, 0.46, 0.58],
        [-0.25, 0.5, 0.69],
      ],
      [0.18, 0.24, 0.24, 0.15, 0.02],
      18,
      9,
    ),
    fur,
    { style: "fur" },
  );
  builder.add(
    rig.tail,
    taperedTube(
      [
        [-0.53, 0.46, 0.58],
        [-0.41, 0.51, 0.65],
        [-0.24, 0.51, 0.7],
      ],
      [0.16, 0.13, 0.015],
      9,
      8,
    ),
    "cream",
    { style: "fur" },
  );
  rig.head = builder.part("fox-head", body, [0, 1.18, 0.1]);
  builder.oval(rig.head, fur, [0, 0.09, 0], [0.48, 0.41, 0.37], {
    style: "fur",
  });
  for (const s of [-1, 1]) {
    builder.add(
      rig.head,
      polygonSolid(
        [
          [-0.18, 0],
          [0.16, 0.01],
          [0.02, 0.46],
        ],
        0.16,
        0.027,
      ),
      fur,
      {
        position: [s * 0.31, 0.34, -0.025],
        rotation: [-0.1, 0, -s * 0.2],
        style: "fur",
      },
    );
    builder.add(
      rig.head,
      polygonSolid(
        [
          [-0.105, 0.03],
          [0.095, 0.035],
          [0.012, 0.33],
        ],
        0.027,
        0.012,
      ),
      "#b96955",
      {
        position: [s * 0.31, 0.36, 0.078],
        rotation: [-0.1, 0, -s * 0.2],
        style: "fur",
      },
    );
    builder.oval(
      rig.head,
      "cream",
      [s * 0.23, -0.03, 0.28],
      [0.255, 0.19, 0.19],
      { style: "fur", rotation: [0, -s * 0.28, -s * 0.16] },
    );
    eye(builder, rig.head, [s * 0.205, 0.15, 0.32], 0.105, "amber");
    builder.oval(
      rig.head,
      light,
      [s * 0.22, 0.295, 0.29],
      [0.11, 0.037, 0.025],
      { style: "fur", rotation: [0, 0, -s * 0.16] },
    );
  }
  builder.oval(rig.head, "cream", [0, -0.08, 0.4], [0.23, 0.12, 0.19], {
    style: "fur",
  });
  builder.oval(rig.head, "eye", [0, 0.005, 0.555], [0.105, 0.065, 0.065], {
    style: "eye",
  });
  builder.add(
    rig.head,
    taperedTube(
      [
        [-0.09, -0.12, 0.52],
        [0, -0.145, 0.54],
        [0.09, -0.12, 0.52],
      ],
      [0.011, 0.012, 0.011],
      8,
      5,
    ),
    dark,
    { style: "fur" },
  );
  return { height: 2.0, label: [0, 2.18, 0], impact: [0, 0.95, 0.3] };
}

function buildTurtle(builder, body, rig) {
  const skin = "#a1aa62",
    shell = "#59754a",
    tile = "#899454";
  builder.oval(body, "#d1c486", [0, 0.36, -0.04], [0.59, 0.22, 0.7], {
    style: "fur",
  });
  builder.oval(body, shell, [0, 0.53, -0.12], [0.7, 0.54, 0.76], {
    style: "matte",
  });
  for (const x of [-0.47, 0.47])
    for (const z of [-0.48, 0.44]) {
      builder.oval(body, skin, [x, 0.19, z], [0.2, 0.18, 0.27], {
        style: "fur",
      });
      for (const dx of [-0.07, 0.045])
        builder.oval(
          body,
          "#e1d6a1",
          [x + dx, 0.09, z + 0.2],
          [0.035, 0.035, 0.05],
          { style: "matte" },
        );
    }
  const hex = Array.from({ length: 6 }, (_, i) => [
    Math.cos((i * Math.PI) / 3) * 0.24,
    Math.sin((i * Math.PI) / 3) * 0.24,
  ]);
  builder.add(body, polygonSolid(hex, 0.085, 0.026), tile, {
    position: [0, 1.035, -0.17],
    rotation: [-HALF_PI, 0, 0],
    style: "matte",
  });
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    builder.add(
      body,
      polygonSolid(hex, 0.085, 0.025),
      i % 2 ? "#75834b" : "#a1a363",
      {
        position: [Math.cos(a) * 0.37, 0.91, -0.16 + Math.sin(a) * 0.39],
        rotation: [-HALF_PI + Math.sin(a) * 0.47, Math.cos(a) * 0.43, a * 0.1],
        style: "matte",
      },
    );
  }
  builder.add(body, new TorusGeometry(0.65, 0.065, 6, 24), "#8d965a", {
    position: [0, 0.48, -0.12],
    rotation: [HALF_PI, 0, 0],
    scale: [1, 1.15, 1],
    style: "matte",
  });
  for (const [x, y, z, r] of [
    [-0.42, 0.89, -0.26, 0.13],
    [0.21, 1.05, -0.42, 0.13],
    [0.34, 0.95, 0.07, 0.1],
  ]) {
    builder.oval(body, "moss", [x, y, z], [r, r * 0.6, r * 1.1], {
      style: "leaf",
    });
    builder.add(body, leafSolid(0.18, 0.1, 0.027), "leaf", {
      position: [x, y, z],
      rotation: [-0.2, 0.6, -0.45],
      style: "leaf",
    });
  }
  rig.head = builder.part("turtle-head", body, [0, 0.51, 0.72]);
  builder.oval(rig.head, skin, [0, 0.09, 0.035], [0.33, 0.31, 0.36], {
    style: "fur",
  });
  builder.oval(rig.head, "#c6bd7d", [0, -0.055, 0.26], [0.26, 0.14, 0.2], {
    style: "fur",
  });
  for (const s of [-1, 1]) {
    eye(builder, rig.head, [s * 0.185, 0.17, 0.28], 0.088, "#ad8139");
    builder.oval(
      rig.head,
      "#6b7642",
      [s * 0.105, 0.04, 0.424],
      [0.022, 0.015, 0.012],
      { style: "fur" },
    );
  }
  builder.add(
    rig.head,
    taperedTube(
      [
        [-0.16, -0.07, 0.382],
        [0, -0.095, 0.447],
        [0.16, -0.07, 0.382],
      ],
      [0.011, 0.012, 0.011],
      8,
      5,
    ),
    "#69764a",
    { style: "fur" },
  );
  rig.head.scale.setScalar(1.16);
  rig.tail = builder.part("turtle-tail", body, [0, 0.3, -0.78]);
  builder.add(
    rig.tail,
    taperedTube(
      [
        [0, 0, 0],
        [0.08, -0.08, -0.15],
        [0.14, -0.12, -0.28],
      ],
      [0.085, 0.06, 0.012],
      8,
      6,
    ),
    skin,
    { style: "fur" },
  );
  return { height: 1.27, label: [0, 1.55, 0], impact: [0, 0.7, 0.25] };
}

function buildOwl(builder, body, rig) {
  const violet = "#8772ad",
    pale = "#c1add5",
    wing = "#68548e";
  pearBody(builder, body, violet, [0, 0.13, -0.04], [1.2, 1.09, 0.96]);
  builder.oval(body, pale, [0, 0.63, 0.31], [0.34, 0.45, 0.13], {
    style: "fur",
  });
  for (const s of [-1, 1]) {
    builder.oval(body, "#c9984e", [s * 0.2, 0.08, 0.18], [0.15, 0.07, 0.2], {
      style: "matte",
    });
    for (const dx of [-0.05, 0.05])
      builder.oval(
        body,
        "#e2c589",
        [s * 0.2 + dx, 0.045, 0.36],
        [0.025, 0.025, 0.075],
        { style: "matte" },
      );
    const w = builder.part(s < 0 ? "owl-wing-left" : "owl-wing-right", body, [
      s * 0.4,
      0.87,
      -0.015,
    ]);
    rig[s < 0 ? "leftWing" : "rightWing"] = w;
    builder.add(w, leafSolid(0.63, 0.32, 0.11), wing, {
      rotation: [0.1, s * 0.32, Math.PI + s * 0.27],
      style: "fur",
    });
    for (let i = 0; i < 3; i++)
      builder.add(
        w,
        leafSolid(0.4 - i * 0.065, 0.13, 0.04),
        i % 2 ? pale : violet,
        {
          position: [s * (0.015 + i * 0.044), -0.06 - i * 0.1, 0.09],
          rotation: [0.2, 0, Math.PI + s * 0.25],
          style: "fur",
        },
      );
  }
  rig.head = builder.part("owl-head", body, [0, 1.24, 0.07]);
  builder.oval(rig.head, violet, [0, 0.03, 0], [0.55, 0.43, 0.4], {
    style: "fur",
  });
  for (const s of [-1, 1]) {
    builder.oval(
      rig.head,
      "#eadaca",
      [s * 0.225, -0.006, 0.299],
      [0.25, 0.28, 0.11],
      { style: "fur" },
    );
    builder.oval(
      rig.head,
      pale,
      [s * 0.224, 0.047, 0.382],
      [0.181, 0.195, 0.03],
      { style: "fur" },
    );
    eye(builder, rig.head, [s * 0.225, 0.015, 0.398], 0.133, "#c69246");
    builder.add(rig.head, leafSolid(0.33, 0.19, 0.055), wing, {
      position: [s * 0.4, 0.29, -0.02],
      rotation: [0, 0, -s * 0.38],
      style: "fur",
    });
    builder.add(rig.head, leafSolid(0.27, 0.12, 0.04), pale, {
      position: [s * 0.34, 0.3, 0.1],
      rotation: [0, 0, -s * 0.3],
      style: "fur",
    });
  }
  builder.add(
    rig.head,
    polygonSolid(
      [
        [-0.085, 0.075],
        [0.085, 0.075],
        [0, -0.12],
      ],
      0.11,
      0.025,
    ),
    "#dcaa59",
    { position: [0, -0.055, 0.425], style: "matte" },
  );
  // A moon crescent made from a thick polygon, rather than a transparent decal.
  builder.add(
    rig.head,
    polygonSolid(
      [
        [0.04, 0.14],
        [-0.09, 0.12],
        [-0.16, 0.02],
        [-0.15, -0.09],
        [-0.045, -0.155],
        [0.055, -0.12],
        [-0.025, -0.08],
        [-0.057, 0.01],
        [-0.025, 0.09],
      ],
      0.055,
      0.012,
    ),
    "bronze",
    { position: [0, 0.335, 0.27], scale: [0.62, 0.62, 0.62], style: "metal" },
  );
  builder.add(body, new TorusGeometry(0.25, 0.027, 5, 20), "bronze", {
    position: [0, 1.025, 0],
    rotation: [HALF_PI, 0, 0],
    scale: [1.35, 1, 1],
    style: "metal",
  });
  builder.oval(body, "#8d69b9", [0, 0.91, 0.39], [0.085, 0.11, 0.045], {
    style: "eye",
  });
  return { height: 1.99, label: [0, 2.15, 0], impact: [0, 1.05, 0.3] };
}

function buildRabbit(builder, body, rig) {
  pearBody(builder, body, "#e8e2d2", [0, 0.12, -0.1], [0.85, 0.88, 0.78]);
  for (const s of [-1, 1]) {
    builder.oval(body, "#d4d0c6", [s * 0.27, 0.31, -0.08], [0.23, 0.29, 0.27], {
      style: "fur",
    });
    builder.oval(body, "cream", [s * 0.22, 0.11, 0.3], [0.17, 0.1, 0.33], {
      style: "fur",
    });
    builder.oval(body, "cream", [s * 0.21, 0.61, 0.22], [0.085, 0.24, 0.095], {
      rotation: [0.11, 0, s * 0.16],
      style: "fur",
    });
  }
  rig.tail = builder.part("rabbit-tail", body, [0, 0.35, -0.44]);
  builder.oval(rig.tail, "cream", [0, 0, 0], [0.19, 0.18, 0.18], {
    style: "fur",
  });
  builder.add(
    body,
    polygonSolid(
      [
        [-0.32, 0.88],
        [-0.45, 0.38],
        [0, 0.23],
        [0.44, 0.38],
        [0.31, 0.88],
      ],
      0.075,
      0.025,
    ),
    "#475d81",
    { position: [0, 0, -0.3], rotation: [-0.13, 0, 0], style: "fur" },
  );
  builder.add(body, new TorusGeometry(0.23, 0.052, 6, 18), "#526b94", {
    position: [0, 0.93, 0],
    rotation: [HALF_PI, 0, 0],
    scale: [1.1, 1, 1],
    style: "fur",
  });
  builder.oval(body, "bronze", [0, 0.89, 0.29], [0.069, 0.074, 0.035], {
    style: "metal",
  });
  rig.head = builder.part("rabbit-head", body, [0, 1.14, 0.08]);
  builder.oval(rig.head, "cream", [0, 0.01, 0], [0.39, 0.36, 0.32], {
    style: "fur",
  });
  for (const s of [-1, 1]) {
    builder.oval(
      rig.head,
      "#eee8da",
      [s * 0.18, 0.6, -0.06],
      [0.12, 0.48, 0.075],
      { rotation: [s < 0 ? -0.13 : 0.08, 0, -s * 0.15], style: "fur" },
    );
    builder.oval(
      rig.head,
      "#c79391",
      [s * 0.18, 0.61, 0.015],
      [0.065, 0.37, 0.026],
      { rotation: [s < 0 ? -0.13 : 0.08, 0, -s * 0.15], style: "fur" },
    );
    eye(builder, rig.head, [s * 0.175, 0.06, 0.273], 0.095, "#6382a1");
    builder.oval(
      rig.head,
      "#f8eee0",
      [s * 0.095, -0.1, 0.3],
      [0.14, 0.11, 0.12],
      { style: "fur" },
    );
  }
  builder.oval(rig.head, "#cb9391", [0, -0.055, 0.41], [0.064, 0.042, 0.037], {
    style: "fur",
  });
  builder.add(
    rig.head,
    taperedTube(
      [
        [0, -0.1, 0.403],
        [0, -0.155, 0.392],
        [-0.06, -0.17, 0.363],
      ],
      [0.009, 0.01, 0.008],
      7,
      5,
    ),
    "#9d817b",
    { style: "fur" },
  );
  builder.add(
    rig.head,
    taperedTube(
      [
        [0, -0.155, 0.392],
        [0.035, -0.171, 0.382],
        [0.065, -0.158, 0.36],
      ],
      [0.01, 0.009, 0.008],
      6,
      5,
    ),
    "#9d817b",
    { style: "fur" },
  );
  return { height: 2.26, label: [0, 2.46, 0], impact: [0, 0.94, 0.25] };
}

function buildStag(builder, body, rig) {
  const coat = "#bb8657",
    muzzle = "#e5c59b";
  builder.oval(body, coat, [0, 0.65, -0.16], [0.37, 0.35, 0.59], {
    style: "fur",
  });
  builder.oval(body, "#e1bc8a", [0, 0.52, 0.21], [0.24, 0.24, 0.22], {
    style: "fur",
  });
  for (const x of [-0.235, 0.235])
    for (const z of [-0.46, 0.3]) {
      builder.add(
        body,
        taperedTube(
          [
            [x, 0.64, z],
            [x * 1.04, 0.32, z + 0.02],
            [x * 1.12, 0.11, z + 0.07],
          ],
          [0.095, 0.06, 0.055],
          9,
          7,
        ),
        coat,
        { style: "fur" },
      );
      builder.oval(
        body,
        "#684d35",
        [x * 1.12, 0.075, z + 0.085],
        [0.073, 0.07, 0.11],
      );
    }
  builder.add(
    body,
    taperedTube(
      [
        [0, 0.67, 0.23],
        [0, 0.92, 0.32],
        [0, 1.2, 0.39],
      ],
      [0.21, 0.17, 0.19],
      10,
      10,
    ),
    coat,
    { style: "fur" },
  );
  for (const s of [-1, 1])
    for (let i = 0; i < 3; i++)
      builder.oval(
        body,
        "#f5dfb8",
        [s * 0.32, 0.78 + (i % 2) * 0.035, -0.45 + i * 0.23],
        [0.016, 0.035, 0.042],
        { style: "fur" },
      );
  rig.tail = builder.part("stag-tail", body, [0, 0.75, -0.69]);
  builder.add(rig.tail, leafSolid(0.23, 0.15, 0.065), muzzle, {
    rotation: [-1.1, 0, 0],
    style: "fur",
  });
  rig.head = builder.part("stag-head", body, [0, 1.18, 0.38]);
  builder.oval(rig.head, coat, [0, 0.08, 0], [0.32, 0.34, 0.3], {
    style: "fur",
  });
  builder.oval(rig.head, muzzle, [0, -0.065, 0.26], [0.22, 0.17, 0.23], {
    style: "fur",
  });
  builder.oval(rig.head, "#584439", [0, 0.008, 0.463], [0.088, 0.061, 0.041], {
    style: "eye",
  });
  for (const s of [-1, 1]) {
    eye(builder, rig.head, [s * 0.16, 0.12, 0.261], 0.081, "#917644");
    builder.add(rig.head, leafSolid(0.38, 0.2, 0.07), coat, {
      position: [s * 0.235, 0.23, -0.005],
      rotation: [0.08, 0, -s * 0.9],
      style: "fur",
    });
    builder.add(rig.head, leafSolid(0.25, 0.12, 0.025), muzzle, {
      position: [s * 0.26, 0.25, 0.07],
      rotation: [0.08, 0, -s * 0.9],
      style: "fur",
    });
    const points = [
      [s * 0.16, 0.32, -0.07],
      [s * 0.24, 0.57, -0.1],
      [s * 0.38, 0.81, -0.14],
      [s * 0.35, 0.98, -0.13],
    ];
    builder.add(
      rig.head,
      taperedTube(points, [0.056, 0.05, 0.035, 0.013], 13, 6),
      "#816043",
    );
    builder.add(
      rig.head,
      taperedTube(
        [
          [s * 0.26, 0.6, -0.11],
          [s * 0.49, 0.68, -0.03],
          [s * 0.56, 0.86, 0.015],
        ],
        [0.04, 0.032, 0.01],
        9,
        6,
      ),
      "#96734b",
    );
    builder.add(
      rig.head,
      taperedTube(
        [
          [s * 0.35, 0.79, -0.13],
          [s * 0.15, 0.88, -0.18],
          [s * 0.11, 0.99, -0.19],
        ],
        [0.029, 0.021, 0.009],
        8,
        6,
      ),
      "#96734b",
    );
    builder.add(rig.head, leafSolid(0.24, 0.12, 0.04), "leaf", {
      position: [s * 0.2, 0.37, 0.04],
      rotation: [0.2, 0, s * 0.75],
      style: "leaf",
    });
    const flower = [s * 0.3, 0.48, 0.08];
    for (let i = 0; i < 5; i++)
      builder.oval(
        rig.head,
        "#f9e5af",
        [
          flower[0] + Math.cos(i * 1.256) * 0.048,
          flower[1] + Math.sin(i * 1.256) * 0.048,
          flower[2],
        ],
        [0.035, 0.05, 0.023],
        { rotation: [0, 0, i * 1.256], style: "fur" },
      );
    builder.oval(rig.head, "#ebc867", flower, [0.032, 0.032, 0.029], {
      style: "glow",
    });
  }
  return { height: 2.22, label: [0, 2.43, 0], impact: [0, 0.88, 0.26] };
}

function buildDragon(builder, body, rig) {
  const orange = "#ce7440",
    warm = "#efbb6d",
    dark = "#9d5234";
  pearBody(builder, body, orange, [0, 0.12, -0.07], [1.0, 1.07, 0.95]);
  builder.oval(body, warm, [0, 0.62, 0.34], [0.29, 0.43, 0.1], {
    style: "fur",
  });
  for (const s of [-1, 1]) {
    builder.oval(body, orange, [s * 0.34, 0.3, -0.01], [0.22, 0.25, 0.27], {
      style: "fur",
    });
    builder.oval(body, dark, [s * 0.28, 0.12, 0.35], [0.18, 0.11, 0.26], {
      style: "fur",
    });
    for (const dx of [-0.07, 0.07])
      builder.oval(
        body,
        "cream",
        [s * 0.28 + dx, 0.083, 0.56],
        [0.033, 0.038, 0.06],
      );
    builder.add(
      body,
      taperedTube(
        [
          [s * 0.31, 0.91, 0.03],
          [s * 0.43, 0.65, 0.18],
          [s * 0.32, 0.57, 0.32],
        ],
        [0.1, 0.085, 0.069],
        9,
        7,
      ),
      orange,
      { style: "fur" },
    );
    const wing = builder.part(
      s < 0 ? "dragon-wing-left" : "dragon-wing-right",
      body,
      [s * 0.31, 0.91, -0.2],
    );
    rig[s < 0 ? "leftWing" : "rightWing"] = wing;
    builder.add(
      wing,
      polygonSolid(
        [
          [0, 0],
          [s * 0.16, 0.42],
          [s * 0.63, 0.66],
          [s * 0.64, 0.27],
          [s * 0.76, -0.13],
          [s * 0.4, 0.045],
          [s * 0.25, -0.22],
        ],
        0.045,
        0.017,
      ),
      "#d69a56",
      { rotation: [0.16, s * 0.35, 0], style: "fur" },
    );
    for (const end of [
      [s * 0.63, 0.66, 0],
      [s * 0.64, 0.27, 0],
      [s * 0.76, -0.13, 0],
    ])
      builder.add(
        wing,
        taperedTube(
          [[0, 0, 0.035], [s * 0.19, 0.38, 0.065], end],
          [0.055, 0.037, 0.016],
          10,
          6,
        ),
        dark,
        { rotation: [0.16, s * 0.35, 0], style: "fur" },
      );
  }
  rig.tail = builder.part("dragon-tail", body, [0.12, 0.32, -0.36]);
  builder.add(
    rig.tail,
    taperedTube(
      [
        [0, 0, 0],
        [0.46, -0.02, -0.36],
        [0.7, 0.15, -0.15],
        [0.75, 0.34, 0.09],
      ],
      [0.17, 0.13, 0.075, 0.015],
      17,
      8,
    ),
    orange,
    { style: "fur" },
  );
  builder.add(rig.tail, leafSolid(0.2, 0.17, 0.06), warm, {
    position: [0.75, 0.3, 0.09],
    rotation: [0.5, 0, -0.15],
    style: "glow",
  });
  rig.head = builder.part("dragon-head", body, [0, 1.24, 0.1]);
  builder.oval(rig.head, orange, [0, 0.04, 0], [0.43, 0.35, 0.33], {
    style: "fur",
  });
  builder.oval(rig.head, warm, [0, -0.08, 0.31], [0.31, 0.17, 0.27], {
    style: "fur",
  });
  for (const s of [-1, 1]) {
    eye(builder, rig.head, [s * 0.2, 0.11, 0.28], 0.103, "#6e9465");
    builder.oval(
      rig.head,
      dark,
      [s * 0.125, 0.015, 0.525],
      [0.026, 0.018, 0.016],
      { style: "fur" },
    );
    builder.add(
      rig.head,
      taperedTube(
        [
          [s * 0.28, 0.27, -0.06],
          [s * 0.34, 0.45, -0.12],
          [s * 0.28, 0.56, -0.1],
        ],
        [0.085, 0.051, 0.012],
        9,
        7,
      ),
      "cream",
    );
    builder.add(rig.head, leafSolid(0.24, 0.2, 0.065), orange, {
      position: [s * 0.33, 0.12, -0.02],
      rotation: [0, 0, -s * 1.25],
      style: "fur",
    });
  }
  builder.add(
    rig.head,
    taperedTube(
      [
        [-0.14, -0.13, 0.506],
        [0, -0.17, 0.554],
        [0.14, -0.13, 0.506],
      ],
      [0.01, 0.012, 0.01],
      8,
      5,
    ),
    dark,
    { style: "fur" },
  );
  return { height: 1.96, label: [0, 2.2, 0], impact: [0, 1.0, 0.32] };
}

function buildSprout(builder, body, rig) {
  const seed = "#ba9865";
  for (const s of [-1, 1]) {
    builder.oval(body, "#816847", [s * 0.2, 0.11, 0.16], [0.13, 0.1, 0.21]);
    builder.add(
      body,
      taperedTube(
        [
          [s * 0.31, 0.64, 0],
          [s * 0.47, 0.5, 0.09],
          [s * 0.51, 0.69, 0.15],
        ],
        [0.061, 0.049, 0.035],
        9,
        6,
      ),
      seed,
    );
    builder.add(body, leafSolid(0.24, 0.16, 0.035), "leaf", {
      position: [s * 0.5, 0.66, 0.15],
      rotation: [0, 0, -s * 0.55],
      style: "leaf",
    });
  }
  rig.head = builder.part("sprout-seed", body, [0, 0.18, 0]);
  pearBody(builder, rig.head, seed, [0, 0, 0], [0.94, 0.93, 0.8]);
  builder.oval(rig.head, "#e2cb91", [0, 0.52, 0.281], [0.29, 0.34, 0.081], {
    style: "fur",
  });
  for (const s of [-1, 1])
    eye(builder, rig.head, [s * 0.128, 0.61, 0.35], 0.067, "#7b8050");
  builder.add(
    rig.head,
    taperedTube(
      [
        [-0.07, 0.39, 0.352],
        [0, 0.365, 0.376],
        [0.07, 0.39, 0.352],
      ],
      [0.01, 0.01, 0.009],
      7,
      5,
    ),
    "#826944",
  );
  builder.add(
    rig.head,
    taperedTube(
      [
        [0, 0.9, 0],
        [0.02, 1.13, 0],
        [0, 1.27, -0.03],
      ],
      [0.05, 0.037, 0.024],
      9,
      7,
    ),
    "darkLeaf",
    { style: "leaf" },
  );
  builder.add(rig.head, leafSolid(0.61, 0.38, 0.09), "#9ab658", {
    position: [0.01, 1.11, 0],
    rotation: [-0.2, -0.1, -0.95],
    style: "leaf",
  });
  builder.add(rig.head, leafSolid(0.48, 0.29, 0.07), "#628e48", {
    position: [0.0, 1.05, 0.015],
    rotation: [0.18, 0.12, 0.89],
    style: "leaf",
  });
  builder.add(
    rig.head,
    taperedTube(
      [
        [-0.24, 0.17, 0.26],
        [-0.31, 0.48, 0.24],
        [-0.2, 0.8, 0.16],
      ],
      [0.01, 0.011, 0.008],
      12,
      5,
    ),
    "#927846",
  );
  return { height: 1.8, label: [0, 2.02, 0], impact: [0, 0.76, 0.29] };
}

function buildSprite(builder, body, rig) {
  const bark = "#7b6950";
  for (const s of [-1, 1]) {
    builder.add(
      body,
      taperedTube(
        [
          [s * 0.2, 0.37, 0],
          [s * 0.22, 0.16, 0.14],
          [s * 0.33, 0.09, 0.25],
        ],
        [0.1, 0.072, 0.055],
        9,
        7,
      ),
      bark,
    );
    builder.add(
      body,
      taperedTube(
        [
          [s * 0.3, 0.79, 0],
          [s * 0.52, 0.7, 0.05],
          [s * 0.56, 0.92, 0.09],
        ],
        [0.075, 0.05, 0.02],
        11,
        7,
      ),
      bark,
    );
    builder.add(body, leafSolid(0.22, 0.13, 0.035), "leaf", {
      position: [s * 0.55, 0.84, 0.1],
      rotation: [0, 0, -s * 0.75],
      style: "leaf",
    });
  }
  pearBody(builder, body, "#79924e", [0, 0.23, -0.02], [1.0, 0.94, 0.9]);
  for (const [x, y, z, r] of [
    [-0.27, 0.64, 0.2, 0.13],
    [0.27, 0.44, 0.09, 0.15],
    [0, 0.42, -0.32, 0.16],
    [-0.2, 0.9, -0.19, 0.13],
    [0.28, 0.86, -0.09, 0.14],
  ])
    builder.oval(body, "moss", [x, y, z], [r, r * 0.87, r], { style: "leaf" });
  rig.head = builder.part("sprite-cap-and-face", body, [0, 0.83, 0.03]);
  builder.oval(rig.head, "#bad28a", [0, 0.06, 0.16], [0.31, 0.3, 0.22], {
    style: "fur",
  });
  const capProfile = [
    [0, 0.28],
    [0.18, 0.285],
    [0.43, 0.205],
    [0.57, 0.065],
    [0.58, 0],
    [0.38, -0.04],
    [0, -0.04],
  ].map((p) => new Vector2(...p));
  builder.add(rig.head, new LatheGeometry(capProfile, 20), "#987b55", {
    position: [0, 0.3, -0.14],
    scale: [0.9, 1, 0.82],
    style: "matte",
  });
  for (const s of [-1, 1])
    eye(builder, rig.head, [s * 0.135, 0.08, 0.343], 0.07, "#668b67");
  builder.add(
    rig.head,
    taperedTube(
      [
        [-0.065, -0.075, 0.35],
        [0, -0.1, 0.37],
        [0.065, -0.075, 0.35],
      ],
      [0.009, 0.01, 0.009],
      7,
      5,
    ),
    "#647f49",
  );
  for (const [x, y, z, r] of [
    [-0.19, 0.565, -0.1, 0.063],
    [0.1, 0.595, -0.19, 0.07],
    [0.31, 0.53, -0.08, 0.05],
    [-0.12, 0.57, -0.3, 0.05],
  ])
    builder.oval(rig.head, "#ddcc95", [x, y, z], [r, 0.025, r * 0.8]);
  builder.add(rig.head, leafSolid(0.34, 0.2, 0.04), "leaf", {
    position: [-0.12, 0.58, -0.2],
    rotation: [-0.13, 0.15, 0.48],
    style: "leaf",
  });
  return { height: 1.78, label: [0, 1.99, 0], impact: [0, 0.93, 0.26] };
}

function buildGolem(builder, body, rig) {
  const rock = "#647b7d",
    pale = "#8c9b99",
    shadow = "#405b61";
  builder.add(body, roundedSlab(0.9, 0.83, 0.61, 0.19, 0.095), rock, {
    position: [0, 0.89, 0],
  });
  builder.add(body, roundedSlab(0.55, 0.25, 0.49, 0.11, 0.055), shadow, {
    position: [0, 0.38, -0.01],
  });
  for (const s of [-1, 1]) {
    builder.add(body, roundedSlab(0.29, 0.36, 0.31, 0.08, 0.048), rock, {
      position: [s * 0.25, 0.28, 0],
    });
    builder.add(body, roundedSlab(0.39, 0.16, 0.56, 0.07, 0.04), pale, {
      position: [s * 0.25, 0.09, 0.12],
    });
    builder.add(body, roundedSlab(0.36, 0.4, 0.4, 0.1, 0.067), pale, {
      position: [s * 0.59, 1.12, -0.01],
      rotation: [0, 0, s * 0.2],
    });
    builder.add(body, roundedSlab(0.31, 0.4, 0.33, 0.09, 0.055), rock, {
      position: [s * 0.72, 0.74, 0.02],
      rotation: [0.08, 0, -s * 0.08],
    });
    builder.add(body, roundedSlab(0.31, 0.25, 0.36, 0.08, 0.045), pale, {
      position: [s * 0.7, 0.48, 0.11],
    });
  }
  builder.add(
    body,
    polygonSolid(
      [
        [0, 0.24],
        [0.14, 0],
        [0, -0.22],
        [-0.14, 0],
      ],
      0.08,
      0.016,
    ),
    "#a8d9c1",
    { position: [0, 0.95, 0.43], style: "glow" },
  );
  builder.add(body, new CylinderGeometry(0.18, 0.2, 0.16, 8), shadow, {
    position: [0, 1.39, 0],
  });
  rig.head = builder.part("golem-head", body, [0, 1.6, 0.03]);
  builder.add(rig.head, roundedSlab(0.62, 0.44, 0.47, 0.15, 0.072), rock, {
    position: [0, 0, 0],
  });
  builder.add(rig.head, roundedSlab(0.47, 0.18, 0.03, 0.06, 0.013), shadow, {
    position: [0, 0.026, 0.281],
  });
  for (const s of [-1, 1]) {
    builder.add(
      rig.head,
      roundedSlab(0.11, 0.085, 0.025, 0.03, 0.008),
      "#b5e2d2",
      { position: [s * 0.133, 0.028, 0.306], style: "glow" },
    );
    builder.add(rig.head, roundedSlab(0.15, 0.05, 0.08, 0.02, 0.012), pale, {
      position: [s * 0.14, 0.15, 0.265],
      rotation: [0, 0, -s * 0.1],
    });
  }
  builder.add(rig.head, roundedSlab(0.16, 0.023, 0.022, 0.01, 0.005), shadow, {
    position: [0, -0.12, 0.291],
  });
  builder.oval(rig.head, "moss", [-0.18, 0.28, -0.015], [0.2, 0.055, 0.16], {
    style: "leaf",
  });
  builder.add(rig.head, leafSolid(0.32, 0.18, 0.047), "leaf", {
    position: [-0.23, 0.3, 0],
    rotation: [-0.1, 0.2, 0.4],
    style: "leaf",
  });
  builder.oval(body, "moss", [0.55, 1.36, -0.04], [0.18, 0.052, 0.13], {
    style: "leaf",
  });
  return { height: 2.22, label: [0, 2.41, 0], impact: [0, 1.02, 0.35] };
}

const BUILDERS = {
  ...EXPANSION_BUILDERS,
  fox: buildFox,
  turtle: buildTurtle,
  owl: buildOwl,
  rabbit: buildRabbit,
  stag: buildStag,
  dragon: buildDragon,
  sprout: buildSprout,
  sprite: buildSprite,
  golem: buildGolem,
};

function makeHandle({
  root,
  builder,
  body,
  rig = {},
  anchorPositions = {},
  onDispose,
  kind,
}) {
  builder.compile();
  if (kind === "creature" && body) body.position.y -= localBounds(root).min.y;
  const bounds = localBounds(root);
  const baseY = body?.position.y ?? 0;
  const metrics = geometryBudget(root);
  const anchors = {};
  for (const [name, value] of Object.entries(anchorPositions)) {
    const p = [...value];
    if (name === "feet") p[1] -= baseY;
    anchors[name] = anchor(body ?? root, name, p);
  }
  const size = bounds.getSize(new Vector3()),
    midpoint = bounds.getCenter(new Vector3());
  const pickMaterial = new MeshBasicMaterial({ visible: false });
  const pickProxy = new Mesh(
    new BoxGeometry(size.x, size.y, size.z),
    pickMaterial,
  );
  pickProxy.name = `${kind}-pick-proxy`;
  pickProxy.position.copy(midpoint);
  pickProxy.userData.pickProxy = true;
  root.add(pickProxy);
  let disposed = false;
  let visual = {
    selected: false,
    exhausted: false,
    guarded: false,
    damaged: false,
  };
  const pose = {
    idlePhase: 0,
    lift: 0,
    lean: 0,
    attackProgress: 0,
    hitProgress: 0,
  };
  const api = {
    root,
    bounds,
    anchors,
    pickProxy,
    metrics,
    get disposed() {
      return disposed;
    },
    setVisualState(next = {}) {
      if (disposed) return;
      visual = { ...visual, ...next };
      for (const material of builder.materials.values()) {
        material.color.copy(material.userData.baseColor);
        material.emissive.copy(material.userData.baseEmissive);
        material.emissiveIntensity = material.userData.baseEmissiveIntensity;
        if (visual.exhausted) material.color.multiplyScalar(0.7);
        if (visual.damaged) {
          material.emissive.set("#a43824");
          material.emissiveIntensity = 0.24;
        } else if (visual.selected) {
          material.emissive.set("#75a249");
          material.emissiveIntensity = 0.1;
        } else if (visual.guarded) {
          material.emissive.set("#4f8d9f");
          material.emissiveIntensity = 0.05;
        }
      }
      root.userData.visualState = { ...visual };
    },
    applyPose(next = {}) {
      if (disposed) return;
      Object.assign(pose, next);
      const t = Number.isFinite(pose.idlePhase) ? pose.idlePhase : 0;
      const attack = Math.sin(clamp(pose.attackProgress, 0, 1) * Math.PI);
      const hit = Math.sin(clamp(pose.hitProgress, 0, 1) * Math.PI);
      if (body) {
        body.position.y = baseY + clamp(pose.lift, -0.05, 4);
        body.rotation.x =
          clamp(pose.lean, -0.7, 0.7) + attack * 0.14 - hit * 0.12;
        body.scale.y = 1 - hit * 0.075;
        body.scale.x = 1 + hit * 0.025;
      }
      if (rig.head) {
        rig.head.rotation.y = Math.sin(t * 0.62) * 0.045;
        rig.head.rotation.x = Math.sin(t * 0.83) * 0.022 - attack * 0.09;
      }
      if (rig.tail) rig.tail.rotation.y = Math.sin(t * 0.78) * 0.07;
      if (rig.leftWing)
        rig.leftWing.rotation.z = -Math.sin(t * 0.77) * 0.035 - attack * 0.11;
      if (rig.rightWing)
        rig.rightWing.rotation.z = Math.sin(t * 0.77) * 0.035 + attack * 0.11;
      // Pick proxy follows the animated model, while root is reserved for scene placement.
      pickProxy.position.copy(midpoint);
      pickProxy.position.y += (body?.position.y ?? 0) - baseY;
      root.updateMatrixWorld(true);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      pickProxy.geometry.dispose();
      pickMaterial.dispose();
      builder.dispose();
      root.clear();
      onDispose?.(api);
    },
  };
  root.userData.modelKind = kind;
  root.userData.modelVersion = MODEL_VERSION;
  return api;
}

/** All detail stays in the perimeter. Central stone remains a quiet playing surface. */
function forestEdgeDetail(builder, body, random) {
  // Layered bevelled wood end-grain, not a background image or decal.
  for (const [y, color, depth] of [
    [-0.46, "#8b6747", 0.046],
    [-0.72, "#493c2e", 0.045],
  ]) {
    const ring = roundedRectShape(18.06, 12.06, 1.1);
    ring.holes.push(roundedRectShape(17.72, 11.72, 0.94));
    builder.add(body, extrudeShape(ring, depth, 0.012, 3), color, {
      position: [0, y, 0],
      rotation: [-HALF_PI, 0, 0],
    });
  }
  for (const side of [-1, 1]) {
    // The top rails rise and dip like carved roots along the long sides.
    builder.add(
      body,
      taperedTube(
        [
          [side * 8.52, 0.21, -4.5],
          [side * 8.68, 0.33, -2.6],
          [side * 8.56, 0.24, 0],
          [side * 8.72, 0.39, 2.8],
          [side * 8.54, 0.24, 4.4],
        ],
        [0.17, 0.13, 0.11, 0.16, 0.12],
        16,
        6,
      ),
      "bark",
    );
    // Low-relief wood-grain ridges on the visible front and rear sidewall.
    for (const level of [-0.29, -0.58])
      builder.add(
        body,
        taperedTube(
          [
            [-7.3, level, side * 6.06],
            [-4.2, level + 0.045, side * 6.065],
            [-1.3, level - 0.026, side * 6.065],
            [2.8, level + 0.032, side * 6.06],
            [7.3, level - 0.012, side * 6.06],
          ],
          [0.01, 0.012, 0.008, 0.012, 0.009],
          15,
          4,
        ),
        "#a17a50",
      );
    for (const z of [-3.5, -1.2, 1.2, 3.5]) {
      builder.add(body, leafSolid(0.55, 0.25, 0.039), "bronze", {
        position: [side * 8.18, 0.228, z],
        rotation: [-HALF_PI, 0, side * 0.9],
        style: "metal",
      });
    }
  }
  // Two diagonally opposed little root gardens: high enough to give a diorama silhouette.
  for (const s of [-1, 1]) {
    const x = s * 8.35,
      z = s * 5.25;
    builder.add(
      body,
      taperedTube(
        [
          [x * 1.015, 0.1, z * 0.89],
          [x * 0.985, 0.87, z * 0.9],
          [x * 0.94, 1.65, z * 0.91],
          [x * 0.87, 2.07, z * 0.87],
          [x * 0.8, 1.86, z * 0.87],
        ],
        [0.26, 0.22, 0.17, 0.11, 0.04],
        17,
        7,
      ),
      "bark",
    );
    builder.add(
      body,
      taperedTube(
        [
          [x * 0.986, 0.72, z * 0.9],
          [x * 0.92, 1.07, z * 1.02],
          [x * 0.88, 1.47, z * 1.07],
        ],
        [0.12, 0.09, 0.02],
        11,
        6,
      ),
      "barkLight",
    );
    builder.add(
      body,
      taperedTube(
        [
          [x * 1.004, 0.18, z * 0.88],
          [x * 0.977, 0.87, z * 0.88],
          [x * 0.938, 1.58, z * 0.89],
        ],
        [0.018, 0.023, 0.012],
        12,
        4,
      ),
      "#b08858",
    );
    // Hanging loop joins the raised lantern to its root bracket.
    builder.add(body, new TorusGeometry(0.13, 0.022, 5, 12), "bronzeDark", {
      position: [x * 0.9, 1.79, z * 0.86],
      style: "metal",
    });
    for (let branch = 0; branch < 2; branch++) {
      const fx = x * (branch ? 1.0 : 0.91),
        fz = z * (branch ? 0.67 : 1.04);
      const direction = branch ? -0.3 : 0.26;
      builder.add(
        body,
        taperedTube(
          [
            [fx, 0.18, fz],
            [fx + s * 0.1, 0.68, fz + direction * 0.4],
            [fx + s * 0.28, 1.12, fz + direction],
          ],
          [0.028, 0.025, 0.01],
          10,
          5,
        ),
        "darkLeaf",
        { style: "leaf" },
      );
      for (let i = 0; i < 5; i++)
        for (const hand of [-1, 1]) {
          const t = (i + 1) / 6,
            length = 0.34 * (1 - t * 0.46);
          builder.add(
            body,
            leafSolid(length, 0.12, 0.026),
            i % 2 ? "#72984f" : "#91ac61",
            {
              position: [
                fx + s * 0.28 * t,
                0.18 + 0.94 * t,
                fz + direction * t,
              ],
              rotation: [-0.3, hand * 0.6, hand * (1.05 - t * 0.25)],
              style: "leaf",
            },
          );
        }
    }
    // Broad leaves at the crown, all thick closed meshes.
    for (let i = 0; i < 4; i++)
      builder.add(
        body,
        leafSolid(0.64 - i * 0.055, 0.28, 0.055),
        i % 2 ? "leaf" : "moss",
        {
          position: [x * 0.86, 1.95, z * 0.88],
          rotation: [-0.55 + i * 0.18, s * 0.6, i * 0.55 - 0.8],
          style: "leaf",
        },
      );
  }
  // Sparse, low-contrast edge chips on the stone, deliberately away from the two unit lanes.
  const chips = [
    [-6.8, -4.45],
    [-4.9, -4.58],
    [-1.5, -4.5],
    [2.1, -4.42],
    [5.8, -4.52],
    [-6.7, 4.42],
    [-4.2, 4.48],
    [1.8, 4.41],
    [4.3, 4.49],
    [6.5, 4.46],
    [-7.3, 0.45],
    [7.2, -0.5],
  ];
  for (const [x, z] of chips) {
    const a = 0.2 + random() * 0.22,
      b = 0.1 + random() * 0.12;
    builder.add(
      body,
      polygonSolid(
        [
          [-a, -b],
          [-a * 0.3, -b * 1.08],
          [a * 0.8, -b * 0.45],
          [a, b * 0.5],
          [a * 0.12, b],
          [-a * 0.8, b * 0.5],
        ],
        0.009,
        0,
      ),
      random() > 0.5 ? "#3c625a" : "#315650",
      { position: [x, 0.008, z], rotation: [-HALF_PI, 0, random() * 1.7] },
    );
  }
  for (const s of [-1, 1]) {
    builder.add(
      body,
      taperedTube(
        [
          [s * 7.65, 0.004, -0.7],
          [s * 7.22, 0.004, -0.48],
          [s * 7.04, 0.004, -0.04],
          [s * 6.69, 0.004, 0.08],
        ],
        [0.014, 0.012, 0.01, 0.005],
        12,
        4,
      ),
      "#254a45",
    );
  }
}

function arenaGeometry(builder, body, { seed = 7, slotsPerSide = 4 } = {}) {
  builder.add(body, roundedSlab(18, 12, 0.66, 1.05, 0.07), "bark", {
    position: [0, -0.47, 0],
    rotation: [-HALF_PI, 0, 0],
  });
  builder.add(body, roundedSlab(17.8, 11.8, 0.19, 1.0, 0.035), "bronzeDark", {
    position: [0, -0.19, 0],
    rotation: [-HALF_PI, 0, 0],
    style: "metal",
  });
  const outer = roundedRectShape(17.8, 11.8, 1.0);
  outer.holes.push(roundedRectShape(16.35, 10.35, 0.8));
  builder.add(body, extrudeShape(outer, 0.2, 0.025), "stoneDark", {
    position: [0, 0.08, 0],
    rotation: [-HALF_PI, 0, 0],
  });
  // Large solid inset is lower than the outer lip; sidewall remains readable.
  builder.add(body, roundedSlab(16.35, 10.35, 0.3, 0.8, 0.02), "stone", {
    position: [0, -0.17, 0],
    rotation: [-HALF_PI, 0, 0],
  });
  const trim = roundedRectShape(17.5, 11.5, 0.95);
  trim.holes.push(roundedRectShape(17.33, 11.33, 0.89));
  builder.add(body, extrudeShape(trim, 0.035, 0.008), "bronze", {
    position: [0, 0.205, 0],
    rotation: [-HALF_PI, 0, 0],
    style: "metal",
  });
  const slotCount = Math.max(1, Math.min(4, Math.trunc(slotsPerSide)));
  const slotPositions = [[], []];
  for (let side = 0; side < 2; side++)
    for (let i = 0; i < slotCount; i++) {
      const x = (i - (slotCount - 1) / 2) * 3.15,
        z = side === 0 ? 2.12 : -2.12;
      slotPositions[side].push([x, 0.026, z]);
      builder.add(
        body,
        new CylinderGeometry(0.92, 0.92, 0.018, 28),
        "stoneDark",
        { position: [x, 0.006, z] },
      );
      builder.add(body, new TorusGeometry(0.94, 0.038, 5, 28), "bronzeDark", {
        position: [x, 0.022, z],
        rotation: [HALF_PI, 0, 0],
        style: "metal",
      });
    }
  for (const s of [-1, 1]) {
    for (let i = -3; i <= 3; i++) {
      builder.add(body, leafSolid(0.28, 0.13, 0.025), "bronze", {
        position: [i * 1.1, -0.36, s * 6.04],
        rotation: [0, s < 0 ? Math.PI : 0, (i % 2) * 0.13],
        style: "metal",
      });
    }
  }
  const random = seededRandom(seed);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * 8.35,
        z = sz * 5.25;
      builder.add(
        body,
        taperedTube(
          [
            [x * 0.86, -0.4, z * 1.1],
            [x * 0.98, 0.1, z],
            [x * 1.02, 0.31, z * 0.87],
            [x * 1.02, -0.14, z * 0.63],
          ],
          [0.4, 0.32, 0.25, 0.12],
          20,
          8,
        ),
        "bark",
      );
      builder.add(
        body,
        taperedTube(
          [
            [x * 0.89, 0.05, z * 1.04],
            [x * 0.91, 0.3, z * 0.94],
            [x * 0.8, 0.25, z * 0.92],
          ],
          [0.18, 0.12, 0.02],
          12,
          6,
        ),
        "barkLight",
      );
      for (let i = 0; i < 4; i++)
        builder.add(
          body,
          leafSolid(0.5 + random() * 0.22, 0.26, 0.07),
          i % 2 ? "leaf" : "moss",
          {
            position: [
              x * 0.92 + (random() - 0.5) * 0.8,
              0.24,
              z * 0.96 + (random() - 0.5) * 0.55,
            ],
            rotation: [-0.8, random() * 6.28, (random() - 0.5) * 1.4],
            style: "leaf",
          },
        );
      if (sx === sz) {
        builder.add(
          body,
          new CylinderGeometry(0.31, 0.36, 0.12, 8),
          "bronzeDark",
          { position: [x * 0.9, 0.88, z * 0.86], style: "metal" },
        );
        builder.add(
          body,
          new CylinderGeometry(0.23, 0.26, 0.52, 6),
          "#ffc762",
          { position: [x * 0.9, 1.2, z * 0.86], style: "glow" },
        );
        builder.add(
          body,
          new CylinderGeometry(0.08, 0.36, 0.2, 6),
          "bronzeDark",
          { position: [x * 0.9, 1.55, z * 0.86], style: "metal" },
        );
        for (let a = 0; a < 6; a++)
          builder.add(
            body,
            new CylinderGeometry(0.023, 0.023, 0.59, 5),
            "bronzeDark",
            {
              position: [
                x * 0.9 + Math.cos((a * Math.PI) / 3) * 0.255,
                1.19,
                z * 0.86 + Math.sin((a * Math.PI) / 3) * 0.255,
              ],
              style: "metal",
            },
          );
      }
    }
  forestEdgeDetail(builder, body, random);
  return slotPositions;
}

export function createModelLibrary({
  quality = "medium",
  palette = {},
  textures = {},
} = {}) {
  if (!["low", "medium", "high"].includes(quality))
    throw new RangeError("Unsupported model quality");
  const active = new Set();
  let disposed = false;
  const makeBuilder = () => {
    if (disposed) throw new Error("Model library disposed");
    return new ModelBuilder({ quality, palette: { ...PALETTE, ...palette } });
  };
  const retain = (handle) => {
    active.add(handle);
    return handle;
  };
  const onDispose = (handle) => active.delete(handle);
  return {
    version: MODEL_VERSION,
    supportedSpecies: SUPPORTED_SPECIES,
    createArena(options = {}) {
      const builder = makeBuilder(),
        root = new Group();
      root.name = "spellwood-arena";
      const body = builder.part("forest-table", root);
      const slots = arenaGeometry(builder, body, options);
      const handle = makeHandle({
        root,
        builder,
        body,
        kind: "arena",
        onDispose,
        anchorPositions: {
          center: [0, 0, 0],
          playerHero: [0, 0.1, 5],
          opponentHero: [0, 0.1, -5],
          hand: [0, 0.8, 6.4],
        },
      });
      handle.slots = slots.map((row, side) =>
        row.map((p, i) => anchor(root, `slot-${side}-${i}`, p)),
      );
      root.userData.tabletopY = 0;
      return retain(handle);
    },
    createCreature({ species = "fox", side = "player", variantSeed = 1 } = {}) {
      if (!BUILDERS[species])
        throw new RangeError(`Unsupported species: ${species}`);
      const builder = makeBuilder(),
        root = new Group();
      root.name = `creature-${species}`;
      root.userData.species = species;
      root.userData.side = side;
      root.userData.variantSeed = variantSeed;
      const body = builder.part(`${species}-body`, root),
        rig = {};
      const info = BUILDERS[species](builder, body, rig);
      const handle = makeHandle({
        root,
        builder,
        body,
        rig,
        kind: "creature",
        onDispose,
        anchorPositions: {
          feet: [0, 0, 0],
          head: [0, info.height * 0.83, 0.12],
          label: info.label,
          impact: info.impact,
          projectile: [0, info.height * 0.65, 0.6],
        },
      });
      handle.species = species;
      // Deterministic resting phase only; never changes game logic or global random state.
      handle.applyPose({
        idlePhase: seededRandom(variantSeed)() * Math.PI * 2,
      });
      return retain(handle);
    },
    createCard({
      frontTexture = textures.cardFront,
      backTexture = textures.cardBack,
      width = 1.25,
      height = 1.8,
      thickness = 0.08,
    } = {}) {
      const builder = makeBuilder(),
        root = new Group();
      root.name = "spellwood-thick-card";
      const body = builder.part("card-body", root);
      builder.add(
        body,
        roundedSlab(width, height, thickness, 0.12, 0.018),
        "bronzeDark",
        { style: "metal" },
      );
      builder.add(
        body,
        roundedSlab(width - 0.07, height - 0.07, thickness + 0.008, 0.1, 0.009),
        "#ebe0bd",
      );
      const rim = roundedRectShape(width - 0.04, height - 0.04, 0.105);
      rim.holes.push(roundedRectShape(width - 0.15, height - 0.15, 0.085));
      builder.add(body, extrudeShape(rim, 0.018, 0.005), "bronze", {
        position: [0, 0, thickness / 2 + 0.015],
        style: "metal",
      });
      // Caller owns supplied textures; this library must never dispose them.
      const cardMaterials = [];
      for (const [face, texture] of [
        [1, frontTexture],
        [-1, backTexture],
      ]) {
        const mat = new MeshStandardMaterial({
          map: texture ?? null,
          color: texture ? 0xffffff : face > 0 ? 0xdadfc1 : 0x315c4e,
          roughness: 0.68,
          metalness: 0,
        });
        cardMaterials.push(mat);
        const mesh = new Mesh(
          new PlaneGeometry(width - 0.16, height - 0.16),
          mat,
        );
        mesh.name = face > 0 ? "card-front-art" : "card-back-art";
        // Clear the solid bevel (.018); keep the art inside the raised rim.
        mesh.position.z = face * (thickness / 2 + 0.024);
        mesh.rotation.y = face < 0 ? Math.PI : 0;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        body.add(builder.ownMesh(mesh));
      }
      const handle = makeHandle({
        root,
        builder,
        body,
        kind: "card",
        onDispose,
        anchorPositions: {
          center: [0, 0, 0],
          top: [0, height / 2, 0],
          label: [0, height * 0.1, thickness / 2 + 0.035],
        },
      });
      const disposeHandle = handle.dispose;
      handle.dispose = () => {
        if (handle.disposed) return;
        cardMaterials.forEach((m) => m.dispose());
        disposeHandle();
      };
      handle.dimensions = { width, height, thickness };
      return retain(handle);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      [...active].forEach((handle) => handle.dispose());
      active.clear();
    },
    get disposed() {
      return disposed;
    },
    get activeCount() {
      return active.size;
    },
  };
}
