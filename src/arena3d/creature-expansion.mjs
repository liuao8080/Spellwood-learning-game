/** Original elemental companions. Solid, bounded geometry for GPU and CPU rendering. */
import { ConeGeometry, LatheGeometry, TorusGeometry, Vector2 } from "three";
import { leafSolid, polygonSolid, taperedTube } from "./model-utils.mjs";

const HALF_PI = Math.PI / 2;
const FUR = { style: "fur" };
const GLOW = { style: "glow" };
const EYE = { style: "eye" };

// A closed, round, tapered volume. Useful for soft quills, feathers and flames;
// eight radial sides keep repeated silhouette detail inexpensive on the CPU.
function plume(
  builder,
  part,
  color,
  position,
  scale,
  rotation = [0, 0, 0],
  style = "fur",
) {
  const profile = [
    [0, 0],
    [0.34, 0.07],
    [0.48, 0.3],
    [0.39, 0.62],
    [0.2, 0.86],
    [0, 1],
  ];
  builder.add(
    part,
    new LatheGeometry(
      profile.map((p) => new Vector2(...p)),
      8,
    ),
    color,
    { position, scale, rotation, style },
  );
}

function tube(
  builder,
  part,
  color,
  points,
  radii,
  segments = 7,
  sides = 6,
  style = "fur",
) {
  builder.add(part, taperedTube(points, radii, segments, sides), color, {
    style,
  });
}

function eyes(builder, part, x, y, z, size, iris) {
  for (const s of [-1, 1]) {
    builder.oval(
      part,
      "#fff0d4",
      [s * x, y, z],
      [size * 1.18, size * 1.26, size * 0.48],
      FUR,
    );
    builder.oval(
      part,
      iris,
      [s * x, y, z + size * 0.35],
      [size * 0.82, size * 0.96, size * 0.42],
      EYE,
    );
    builder.oval(
      part,
      "#13212b",
      [s * x, y, z + size * 0.65],
      [size * 0.43, size * 0.69, size * 0.23],
      EYE,
    );
    builder.oval(
      part,
      "#fff8e7",
      [s * x - size * 0.22, y + size * 0.34, z + size * 0.83],
      [size * 0.19, size * 0.22, size * 0.1],
      EYE,
    );
  }
}

function smile(builder, part, y, z, width = 0.12, color = "#665048") {
  tube(
    builder,
    part,
    color,
    [
      [-width, y, z],
      [0, y - 0.04, z + 0.02],
      [width, y, z],
    ],
    [0.008, 0.011, 0.008],
    6,
    5,
  );
}

function leaf(
  builder,
  part,
  color,
  position,
  length,
  width,
  rotation = [0, 0, 0],
) {
  builder.add(part, leafSolid(length, width, 0.06), color, {
    position,
    rotation,
    style: "leaf",
  });
}

function roundedEars(builder, part, coat, inner, x, y, radius = 0.16) {
  for (const s of [-1, 1]) {
    builder.oval(
      part,
      coat,
      [s * x, y, -0.01],
      [radius, radius * 1.05, radius * 0.58],
      FUR,
    );
    builder.oval(
      part,
      inner,
      [s * x, y, radius * 0.45],
      [radius * 0.6, radius * 0.62, radius * 0.18],
      FUR,
    );
  }
}

function pointedEars(builder, part, coat, inner, x, y, height = 0.32) {
  for (const s of [-1, 1]) {
    plume(
      builder,
      part,
      coat,
      [s * x, y, -0.05],
      [0.32, height, 0.24],
      [0, 0, -s * 0.2],
    );
    plume(
      builder,
      part,
      inner,
      [s * x, y + 0.035, 0.045],
      [0.18, height * 0.68, 0.065],
      [0, 0, -s * 0.2],
    );
  }
}

function feet4(
  builder,
  body,
  coat,
  paw,
  width,
  front,
  back,
  height = 0.45,
  radius = 0.11,
) {
  for (const x of [-width, width])
    for (const z of [front, back]) {
      tube(
        builder,
        body,
        coat,
        [
          [x, height + 0.13, z - 0.035],
          [x, height * 0.55, z],
          [x * 1.05, 0.12, z + 0.035],
        ],
        [radius * 1.12, radius * 0.78, radius * 0.78],
        6,
        7,
      );
      builder.oval(
        body,
        paw,
        [x * 1.05, 0.1, z + 0.095],
        [radius * 1.18, 0.095, radius * 1.55],
        FUR,
      );
    }
}

function charm(builder, part, color, position, size = 0.1) {
  builder.add(
    part,
    polygonSolid(
      [
        [0, size],
        [size * 0.72, 0],
        [0, -size],
        [-size * 0.72, 0],
      ],
      0.07,
      0.018,
    ),
    color,
    { position, style: "glow" },
  );
}

function buildHedgehog(builder, body, rig, { faceDetail = true } = {}) {
  const coat = "#af7946",
    quill = "#865331",
    cream = "#f5d5a3";
  builder.oval(body, coat, [0, 0.52, -0.13], [0.55, 0.46, 0.58], FUR);
  builder.oval(body, "#664633", [0, 0.62, -0.25], [0.57, 0.42, 0.52], FUR);
  // Staggered soft quills define a prickly silhouette even at card-board scale.
  for (const [z, width, y, count] of [
    [-0.48, 0.4, 0.72, 5],
    [-0.2, 0.49, 0.88, 5],
    [0.08, 0.42, 0.91, 4],
  ]) {
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1) - 0.5) * width * 2;
      plume(
        builder,
        body,
        i % 2 ? quill : "#bd9458",
        [x, y - Math.abs(x) * 0.3, z],
        [0.2, 0.29, 0.22],
        [-0.3, 0, -x * 0.7],
      );
    }
  }
  for (const s of [-1, 1]) {
    builder.oval(body, coat, [s * 0.29, 0.13, 0.26], [0.15, 0.12, 0.23], FUR);
    builder.oval(body, coat, [s * 0.41, 0.33, 0.24], [0.12, 0.22, 0.13], FUR);
  }
  // Extra rear clearance also contains the raised face when the body leans
  // forward at the existing attack peak; rest bounds alone are insufficient.
  rig.head = builder.part("hedgehog-face", body, [0, faceDetail ? 0.80 : 0.64, faceDetail ? 0.30 : 0.36]);
  // The static face pitch sits below the animated head joint. No extra mesh,
  // material or geometry is needed, and idle/attack motion still owns the joint.
  const face = faceDetail ? builder.part("hedgehog-raised-face", rig.head) : rig.head;
  if (faceDetail) face.rotation.x = -0.18;
  builder.oval(face, cream, [0, 0, 0], [0.37, 0.31, 0.34], FUR);
  roundedEars(builder, face, coat, "#d7a17f", 0.28, 0.21, 0.115);
  builder.oval(face, "#ffe4b6", [0, -0.07, 0.28], [0.21, 0.15, 0.24], FUR);
  eyes(builder, face, 0.16, 0.065, faceDetail ? 0.31 : 0.28, 0.073, "#527c44");
  builder.oval(
    face,
    "#4c3327",
    [0, -0.018, 0.488],
    [0.074, 0.052, 0.05],
    EYE,
  );
  smile(builder, face, -0.135, 0.428, 0.07);
  // Broad leaf shoulders and a copper leaf clasp repeat the illustrated cloak.
  for (const side of [-1, 1]) {
    leaf(builder, body, "#426540", [side * .26, .54, .32], .59, .39, [.15, side * .15, -side * 1.0]);
    leaf(builder, body, "#708749", [side * .42, .42, .14], .46, .29, [.5, side * .25, -side * .9]);
  }
  builder.add(body, leafSolid(.34,.27,.052), "#bd813c", {position:faceDetail?[.32,.56,.43]:[0,.39,.66],rotation:[0,0,faceDetail?-1.0:Math.PI],style:"metal"});
  // A small leaf buckler and three berry jewels identify the guard companion.
  leaf(
    builder,
    body,
    "#497849",
    [-0.47, 0.2, 0.46],
    0.53,
    0.38,
    [0, -0.18, -0.16],
  );
  tube(
    builder,
    body,
    "#b5c875",
    [
      [-0.46, 0.22, 0.51],
      [-0.46, 0.47, 0.56],
      [-0.4, 0.69, 0.5],
    ],
    [0.015, 0.019, 0.008],
    6,
    5,
    "leaf",
  );
  for (const [x, y, z] of [
    [0.15, 1.06, -0.1],
    [0.27, 1.01, -0.12],
    [0.2, 1.08, -0.23],
  ])
    builder.oval(body, "#bc536c", [x, y, z], [0.083, 0.081, 0.079], FUR);
  leaf(
    builder,
    body,
    "#88a64f",
    [0.23, 1.1, -0.17],
    0.21,
    0.14,
    [0.1, 0, -0.9],
  );
  return { height: 1.32, label: [0, 1.53, 0], impact: [0, 0.65, 0.35] };
}

function buildOtter(builder, body, rig) {
  const coat = "#976242",
    dark = "#62412c",
    cream = "#f2dec0";
  builder.oval(body, coat, [0, 0.64, -0.09], [0.37, 0.57, 0.31], FUR);
  builder.oval(body, cream, [0, 0.59, 0.177], [0.27, 0.41, 0.115], FUR);
  for (const s of [-1, 1]) {
    builder.oval(body, dark, [s * 0.25, 0.15, 0.15], [0.17, 0.13, 0.3], FUR);
    tube(
      builder,
      body,
      coat,
      [
        [s * 0.29, 0.81, 0.1],
        [s * 0.37, 0.58, 0.28],
        [s * 0.17, 0.61, 0.44],
      ],
      [0.1, 0.095, 0.075],
      7,
      7,
    );
  }
  rig.tail = builder.part("otter-paddle-tail", body, [0.1, 0.25, -0.29]);
  tube(
    builder,
    rig.tail,
    dark,
    [
      [0, 0, 0],
      [0.3, -0.07, -0.23],
      [0.59, 0.01, -0.27],
      [0.7, 0.11, -0.13],
    ],
    [0.17, 0.16, 0.1, 0.015],
    10,
    8,
  );
  rig.head = builder.part("otter-head", body, [0, 1.2, 0.06]);
  builder.oval(rig.head, coat, [0, 0, 0], [0.4, 0.34, 0.33], FUR);
  roundedEars(builder, rig.head, dark, cream, 0.3, 0.21, 0.105);
  for (const s of [-1, 1])
    builder.oval(
      rig.head,
      cream,
      [s * 0.13, -0.07, 0.279],
      [0.2, 0.135, 0.14],
      FUR,
    );
  eyes(builder, rig.head, 0.172, 0.084, 0.285, 0.085, "#76502d");
  builder.oval(
    rig.head,
    "#332a24",
    [0, -0.025, 0.408],
    [0.075, 0.047, 0.047],
    EYE,
  );
  smile(builder, rig.head, -0.15, 0.345, 0.086, "#694331");
  // Small solid whisker arcs, readable without fragile screen-space strokes.
  for (const s of [-1, 1])
    for (const y of [-0.06, -0.13])
      tube(
        builder,
        rig.head,
        cream,
        [
          [s * 0.22, y, 0.325],
          [s * 0.35, y + 0.02, 0.31],
          [s * 0.44, y + 0.04, 0.25],
        ],
        [0.009, 0.012, 0.005],
        4,
        5,
      );
  builder.add(body, new TorusGeometry(0.237, 0.047, 5, 16), "#68c8ca", {
    position: [0, 1.005, 0.01],
    rotation: [HALF_PI, 0, 0],
    scale: [1.2, 1, 1],
    style: "fur",
  });
  // A held turquoise water shield matches the card's river guardian identity.
  builder.add(body, new TorusGeometry(0.30, 0.043, 5, 18), "#6ce3ec", {
    position: [0, 0.68, 0.60], style: "glow",
  });
  builder.add(body, new TorusGeometry(0.245, 0.018, 4, 16), "#c6faff", {
    position: [0, 0.68, 0.61], rotation: [0.12, 0.2, 0], style: "fur",
  });
  // The pearl shell is a physical prop held between both paws.
  builder.oval(body, "#829cc4", [0, 0.59, 0.39], [0.22, 0.15, 0.16], FUR);
  for (const x of [-0.12, 0, 0.12])
    plume(
      builder,
      body,
      "#b6d4e2",
      [x, 0.54, 0.52],
      [0.075, 0.2, 0.07],
      [0, 0, -x * 2],
    );
  builder.oval(body, "#e4ffff", [0, 0.74, 0.43], [0.093, 0.091, 0.09], GLOW);
  return { height: 1.55, label: [0, 1.83, 0], impact: [0, 0.8, 0.32] };
}

function buildFirefly(builder, body, rig) {
  const shell = "#506d37",
    pale = "#8ad2c7",
    gold = "#ffd277";
  builder.oval(body, shell, [0, 0.85, -0.035], [0.29, 0.47, 0.29], FUR);
  // A large luminous abdomen serves as the lantern, with a bronze collar.
  builder.oval(body, gold, [0, 0.5, 0.01], [0.32, 0.37, 0.3], GLOW);
  builder.add(body, new TorusGeometry(0.265, 0.035, 5, 14), "#aa7f50", {
    position: [0, 0.66, 0],
    rotation: [HALF_PI, 0, 0],
    style: "metal",
  });
  for (const s of [-1, 1]) {
    const wing = builder.part(
      s < 0 ? "firefly-wing-left" : "firefly-wing-right",
      body,
      [s * 0.2, 1.04, -0.12],
    );
    rig[s < 0 ? "leftWing" : "rightWing"] = wing;
    builder.oval(
      wing,
      "#90ded9",
      [s * 0.36, 0.16, -0.04],
      [0.26, 0.49, 0.063],
      { rotation: [0.13, -0.12 * s, -0.74 * s], style: "fur" },
    );
    builder.oval(wing, pale, [s * 0.29, -0.28, -0.02], [0.2, 0.34, 0.062], {
      rotation: [-0.13, 0.16 * s, -1.07 * s],
      style: "fur",
    });
    tube(
      builder,
      wing,
      "#cfad5e",
      [
        [0, 0, 0.035],
        [s * 0.37, 0.19, 0.03],
        [s * 0.67, 0.48, -0.025],
      ],
      [0.022, 0.014, 0.005],
      6,
      5,
    );
    for (const [y, spread] of [
      [0.94, 0.49],
      [0.75, 0.44],
    ])
      tube(
        builder,
        body,
        shell,
        [
          [s * 0.22, y, 0.14],
          [s * spread, y - 0.04, 0.26],
          [s * (spread + 0.05), y + 0.1, 0.31],
        ],
        [0.042, 0.029, 0.015],
        6,
        6,
      );
    tube(
      builder,
      body,
      shell,
      [
        [s * 0.12, 0.31, 0.02],
        [s * 0.21, 0.12, 0.13],
        [s * 0.29, 0.07, 0.29],
      ],
      [0.037, 0.026, 0.018],
      6,
      6,
    );
  }
  rig.head = builder.part("firefly-head", body, [0, 1.25, 0.12]);
  builder.oval(rig.head, shell, [0, 0.04, 0], [0.34, 0.3, 0.28], FUR);
  builder.oval(rig.head, "#f7d994", [0, 0.015, 0.205], [0.285, 0.25, 0.10], FUR);
  builder.add(rig.head, new TorusGeometry(0.31, 0.047, 5, 18), "#74833e", {
    position: [0, 0.045, 0.115], scale: [1.06, 1, 1], style: "leaf",
  });
  leaf(builder, rig.head, "#607935", [-0.11, 0.27, -0.06], 0.30, 0.28, [-0.4, 0, -.35]);
  for (const side of [-1, 1]) leaf(builder, body, "#58713b", [side * .21, 1.08, .1], .34, .23, [.2, 0, side * 1.15]);
  eyes(builder, rig.head, 0.143, 0.066, 0.267, 0.092, "#ba8a4b");
  smile(builder, rig.head, -0.13, 0.309, 0.082, "#6c502d");
  for (const s of [-1, 1]) {
    tube(
      builder,
      rig.head,
      shell,
      [
        [s * 0.15, 0.28, -0.02],
        [s * 0.25, 0.54, -0.015],
        [s * 0.36, 0.56, 0.05],
      ],
      [0.026, 0.022, 0.013],
      8,
      6,
    );
    builder.oval(
      rig.head,
      gold,
      [s * 0.36, 0.56, 0.05],
      [0.064, 0.069, 0.064],
      GLOW,
    );
  }
  charm(builder, rig.head, gold, [0, 0.245, 0.2], 0.064);
  return { height: 1.91, label: [0, 2.08, 0], impact: [0, 0.8, 0.3] };
}

function buildWolf(builder, body, rig) {
  const coat = "#bd5a31",
    light = "#342e2b",
    ember = "#df7148",
    cream = "#f5d5b1";
  builder.oval(body, coat, [0, 0.68, -0.17], [0.36, 0.37, 0.6], FUR);
  builder.oval(body, light, [0, 0.76, 0.22], [0.32, 0.4, 0.29], FUR);
  feet4(builder, body, coat, "#d6b28b", 0.235, 0.29, -0.49, 0.49, 0.108);
  for (const z of [-.42, -.15, .12]) plume(builder, body, "#302b28", [0, .88, z], [.34, .27, .32], [-.4, 0, 0]);
  rig.tail = builder.part("wolf-flame-tail", body, [0, 0.72, -0.63]);
  tube(
    builder,
    rig.tail,
    coat,
    [
      [0, 0, 0],
      [-0.29, 0.08, -0.27],
      [-0.46, 0.37, -0.29],
      [-0.47, 0.58, -0.17],
    ],
    [0.16, 0.2, 0.13, 0.018],
    11,
    8,
  );
  plume(
    builder,
    rig.tail,
    ember,
    [-0.49, 0.3, -0.29],
    [0.25, 0.46, 0.27],
    [-0.2, 0, -0.08],
  );
  rig.head = builder.part("wolf-head", body, [0, 1.13, 0.42]);
  builder.oval(rig.head, coat, [0, 0.07, 0], [0.37, 0.34, 0.34], FUR);
  pointedEars(builder, rig.head, coat, cream, 0.255, 0.26, 0.4);
  for (const s of [-1, 1]) {
    plume(
      builder,
      rig.head,
      "#342e2b",
      [s * 0.24, -0.1, -0.01],
      [0.28, 0.48, 0.28],
      [0.08, 0, -s * 1.6],
    );
    plume(
      builder,
      rig.head,
      cream,
      [s * 0.24, -0.13, 0.16],
      [0.2, 0.31, 0.2],
      [0, 0, -s * 1.35],
    );
  }
  builder.oval(rig.head, cream, [0, -0.075, 0.29], [0.21, 0.16, 0.28], FUR);
  eyes(builder, rig.head, 0.17, 0.13, 0.285, 0.083, "#d5a34c");
  builder.oval(
    rig.head,
    "#302622",
    [0, -0.015, 0.533],
    [0.089, 0.057, 0.052],
    EYE,
  );
  smile(builder, rig.head, -0.17, 0.45, 0.095, "#725950");
  // A broad ember ruff and central firestone distinguish the wolf from the fox.
  for (const x of [-0.17, 0, 0.17])
    plume(
      builder,
      body,
      x === 0 ? cream : ember,
      [x, 0.52, 0.405],
      [0.22, 0.49, 0.15],
      [0, 0, -x * 0.55],
    );
  charm(builder, body, "#ffb65a", [0, 0.89, 0.475], 0.096);
  return { height: 1.85, label: [0, 2.08, 0], impact: [0, 0.8, 0.46] };
}

function buildCrane(builder, body, rig) {
  const white = "#f1ecdb",
    blue = "#8bbfcb",
    dark = "#42637c";
  builder.oval(body, white, [0, 0.86, -0.11], [0.36, 0.35, 0.43], FUR);
  for (const s of [-1, 1]) {
    tube(
      builder,
      body,
      dark,
      [
        [s * 0.16, 0.79, -0.08],
        [s * 0.19, 0.39, -0.025],
        [s * 0.2, 0.1, 0.035],
      ],
      [0.053, 0.042, 0.038],
      7,
      7,
    );
    for (const dx of [-0.065, 0.065])
      tube(
        builder,
        body,
        dark,
        [
          [s * 0.2, 0.09, 0.035],
          [s * 0.2 + dx, 0.05, 0.16],
          [s * 0.2 + dx * 1.5, 0.045, 0.29],
        ],
        [0.03, 0.023, 0.012],
        4,
        6,
      );
    const wing = builder.part(
      s < 0 ? "crane-wing-left" : "crane-wing-right",
      body,
      [s * 0.25, 0.97, -0.12],
    );
    rig[s < 0 ? "leftWing" : "rightWing"] = wing;
    builder.oval(wing, blue, [s * 0.09, -0.045, 0], [0.18, 0.3, 0.35], {
      rotation: [0.35, 0, -s * 0.25],
      style: "fur",
    });
    for (let i = 0; i < 3; i++)
      plume(
        builder,
        wing,
        i === 0 ? white : "#afd8dc",
        [s * (0.06 + i * 0.06), 0.055, -0.03 - i * 0.045],
        [0.13, 0.44, 0.14],
        [-1.9, 0, -s * 0.22],
      );
  }
  // The forward-curved S neck is solid, not a painted outline.
  tube(
    builder,
    body,
    white,
    [
      [0, 0.95, 0.15],
      [0, 1.17, 0.29],
      [0, 1.44, 0.18],
      [0, 1.58, 0.25],
    ],
    [0.17, 0.13, 0.115, 0.14],
    14,
    9,
  );
  rig.tail = builder.part("crane-tail", body, [0, 0.98, -0.45]);
  for (const x of [-0.12, 0, 0.12])
    plume(
      builder,
      rig.tail,
      dark,
      [x, 0, 0],
      [0.2, 0.5, 0.15],
      [-1.8, 0, -x * 0.5],
    );
  rig.head = builder.part("crane-head", body, [0, 1.65, 0.29]);
  builder.oval(rig.head, white, [0, 0, 0], [0.25, 0.24, 0.245], FUR);
  builder.oval(
    rig.head,
    "#d78b8a",
    [0, 0.195, -0.025],
    [0.145, 0.077, 0.13],
    FUR,
  );
  eyes(builder, rig.head, 0.12, 0.035, 0.203, 0.065, "#427981");
  builder.add(rig.head, new ConeGeometry(0.088, 0.43, 8), "#d8a35b", {
    position: [0, -0.063, 0.382],
    rotation: [HALF_PI, 0, 0],
    scale: [1, 1, 0.76],
    style: "fur",
  });
  // A cloud collar: three pearl-like water beads at the chest.
  for (const [x, y] of [
    [-0.12, 1.14],
    [0, 1.09],
    [0.12, 1.14],
  ])
    builder.oval(body, "#bcecf0", [x, y, 0.37], [0.058, 0.061, 0.045], GLOW);
  return { height: 1.97, label: [0, 2.18, 0], impact: [0, 0.96, 0.3] };
}

function buildBoar(builder, body, rig) {
  const coat = "#71575a",
    flint = "#474555",
    warm = "#bd7970",
    tusk = "#f7d9a2";
  builder.oval(body, coat, [0, 0.59, -0.17], [0.5, 0.43, 0.66], FUR);
  feet4(builder, body, coat, flint, 0.32, 0.27, -0.52, 0.39, 0.14);
  // Rounded flint plates have warm seams and an irregular bristled ridge.
  for (const [z, y, length] of [
    [-0.55, 0.87, 0.33],
    [-0.3, 0.99, 0.36],
    [-0.04, 1.01, 0.34],
  ]) {
    plume(
      builder,
      body,
      "#d47741",
      [0, y - 0.02, z],
      [0.3, length + 0.055, 0.23],
      [-0.26, 0, 0],
    );
    plume(
      builder,
      body,
      flint,
      [0, y + 0.025, z + 0.03],
      [0.23, length, 0.17],
      [-0.25, 0, 0],
    );
  }
  rig.tail = builder.part("boar-curled-tail", body, [0.12, 0.67, -0.75]);
  tube(
    builder,
    rig.tail,
    warm,
    [
      [0, 0, 0],
      [0.22, 0.05, -0.08],
      [0.3, 0.23, -0.1],
      [0.16, 0.28, -0.08],
      [0.1, 0.18, -0.06],
    ],
    [0.038, 0.033, 0.027, 0.021, 0.01],
    11,
    6,
  );
  rig.head = builder.part("boar-head", body, [0, 0.72, 0.46]);
  builder.oval(rig.head, coat, [0, 0.06, 0], [0.43, 0.37, 0.37], FUR);
  pointedEars(builder, rig.head, coat, warm, 0.32, 0.25, 0.32);
  builder.oval(rig.head, warm, [0, -0.09, 0.33], [0.29, 0.19, 0.225], FUR);
  builder.oval(
    rig.head,
    "#d39884",
    [0, -0.065, 0.51],
    [0.24, 0.143, 0.073],
    FUR,
  );
  for (const s of [-1, 1]) {
    builder.oval(
      rig.head,
      "#6c4144",
      [s * 0.098, -0.056, 0.577],
      [0.039, 0.051, 0.015],
      EYE,
    );
    tube(
      builder,
      rig.head,
      tusk,
      [
        [s * 0.29, -0.14, 0.29],
        [s * 0.41, -0.02, 0.39],
        [s * 0.405, 0.15, 0.4],
      ],
      [0.065, 0.052, 0.008],
      9,
      7,
    );
    builder.oval(
      rig.head,
      flint,
      [s * 0.22, 0.254, 0.244],
      [0.15, 0.047, 0.065],
      { rotation: [0, 0, -s * 0.13], style: "fur" },
    );
  }
  eyes(builder, rig.head, 0.195, 0.145, 0.31, 0.079, "#dca45a");
  // The tiny bronze rally medallion is visible below the boar's long muzzle.
  builder.add(body, new TorusGeometry(0.32, 0.035, 5, 16), "#aa7747", {
    position: [0, 0.74, 0.27],
    rotation: [HALF_PI, 0, 0],
    scale: [1.1, 1, 1],
    style: "metal",
  });
  charm(builder, body, "#ffb75e", [0.39, 0.64, 0.24], 0.12);
  return { height: 1.4, label: [0, 1.67, 0], impact: [0, 0.73, 0.5] };
}

function buildBear(builder, body, rig) {
  const coat = "#8e6342",
    pale = "#c69865",
    bark = "#5f4435",
    green = "#6f9649";
  builder.oval(body, coat, [0, 0.82, -0.07], [0.57, 0.67, 0.43], FUR);
  builder.oval(body, pale, [0, 0.78, 0.31], [0.36, 0.45, 0.12], FUR);
  for (const s of [-1, 1]) {
    builder.oval(body, coat, [s * 0.36, 0.22, 0], [0.25, 0.24, 0.29], FUR);
    builder.oval(body, bark, [s * 0.36, 0.12, 0.24], [0.23, 0.115, 0.3], FUR);
    tube(
      builder,
      body,
      coat,
      [
        [s * 0.43, 1.2, -0.02],
        [s * 0.64, 0.91, 0.04],
        [s * 0.61, 0.58, 0.17],
      ],
      [0.225, 0.19, 0.18],
      8,
      8,
    );
    builder.oval(body, bark, [s * 0.61, 0.55, 0.23], [0.18, 0.14, 0.2], FUR);
    for (const x of [-0.072, 0.072])
      builder.oval(
        body,
        "#e5c592",
        [s * 0.36 + x, 0.103, 0.501],
        [0.025, 0.035, 0.055],
        FUR,
      );
    leaf(builder, body, green, [s * 0.43, 1.15, 0.15], 0.36, 0.24, [
      0,
      0,
      -s * 1.04,
    ]);
  }
  rig.head = builder.part("bear-head", body, [0, 1.48, 0.12]);
  builder.oval(rig.head, coat, [0, 0.05, 0], [0.45, 0.39, 0.35], FUR);
  roundedEars(builder, rig.head, coat, pale, 0.335, 0.31, 0.16);
  builder.oval(rig.head, pale, [0, -0.105, 0.294], [0.26, 0.19, 0.18], FUR);
  eyes(builder, rig.head, 0.2, 0.13, 0.291, 0.086, "#72904d");
  builder.oval(rig.head, bark, [0, -0.036, 0.453], [0.109, 0.072, 0.06], EYE);
  smile(builder, rig.head, -0.218, 0.38, 0.1, bark);
  // Broad foliage shoulders and an acorn pendant echo an old forest guardian.
  for (const x of [-0.24, 0, 0.24])
    leaf(
      builder,
      body,
      x === 0 ? "#99b45d" : green,
      [x, 1.025, 0.32],
      0.39,
      0.3,
      [0, 0, -x * 0.7],
    );
  builder.oval(body, "#bc874a", [0, 1.17, 0.446], [0.105, 0.14, 0.07], FUR);
  builder.oval(body, bark, [0, 1.29, 0.44], [0.125, 0.058, 0.085], FUR);
  tube(
    builder,
    body,
    bark,
    [
      [0, 1.3, 0.44],
      [0.02, 1.37, 0.435],
      [0.055, 1.4, 0.43],
    ],
    [0.019, 0.015, 0.008],
    4,
    5,
  );
  leaf(builder, rig.head, green, [-0.23, 0.4, -0.02], 0.22, 0.15, [0, 0, 0.7]);
  return { height: 2.06, label: [0, 2.28, 0], impact: [0, 1.0, 0.35] };
}

function buildUnicorn(builder, body, rig) {
  const coat = "#d3e4e4",
    shadow = "#9ebfd0",
    mane = "#8571b7",
    pale = "#eee8df";
  builder.oval(body, coat, [0, 0.7, -0.17], [0.36, 0.35, 0.57], FUR);
  feet4(builder, body, coat, "#8b91bd", 0.23, 0.25, -0.47, 0.54, 0.091);
  tube(
    builder,
    body,
    coat,
    [
      [0, 0.7, 0.24],
      [0, 1.05, 0.31],
      [0, 1.31, 0.31],
    ],
    [0.23, 0.2, 0.21],
    11,
    9,
  );
  // Layered lavender locks cascade down the neck with genuine thickness.
  for (const [x, y, z, h] of [
    [-0.14, 0.89, 0.05, 0.4],
    [-0.12, 1.05, 0.08, 0.4],
    [-0.1, 1.24, 0.09, 0.33],
  ])
    plume(builder, body, mane, [x, y, z], [0.25, h, 0.3], [0.16, 0, 0.55]);
  rig.tail = builder.part("unicorn-tail", body, [0.02, 0.78, -0.65]);
  tube(
    builder,
    rig.tail,
    mane,
    [
      [0, 0, 0],
      [0.3, -0.04, -0.21],
      [0.38, -0.31, -0.29],
      [0.23, -0.52, -0.23],
    ],
    [0.12, 0.16, 0.14, 0.008],
    12,
    8,
  );
  tube(
    builder,
    rig.tail,
    "#b4a1d4",
    [
      [0.04, 0.045, -0.04],
      [0.25, -0.02, -0.16],
      [0.33, -0.28, -0.24],
      [0.22, -0.46, -0.23],
    ],
    [0.044, 0.04, 0.03, 0.005],
    9,
    6,
  );
  rig.head = builder.part("unicorn-head", body, [0, 1.37, 0.39]);
  builder.oval(rig.head, coat, [0, 0.015, 0.015], [0.29, 0.32, 0.31], FUR);
  builder.oval(rig.head, pale, [0, -0.14, 0.27], [0.22, 0.18, 0.23], FUR);
  pointedEars(builder, rig.head, coat, "#c5a8c5", 0.2, 0.245, 0.29);
  eyes(builder, rig.head, 0.15, 0.087, 0.27, 0.079, "#8271b0");
  for (const s of [-1, 1])
    builder.oval(
      rig.head,
      shadow,
      [s * 0.088, -0.088, 0.475],
      [0.025, 0.027, 0.012],
      FUR,
    );
  smile(builder, rig.head, -0.256, 0.368, 0.085, "#8094ae");
  builder.add(rig.head, new ConeGeometry(0.087, 0.45, 9), "#f2d796", {
    position: [0, 0.496, 0.116],
    rotation: [0.18, 0, 0],
    style: "glow",
  });
  for (const [y, r] of [
    [0.33, 0.074],
    [0.43, 0.055],
    [0.53, 0.037],
  ])
    builder.add(rig.head, new TorusGeometry(r, 0.011, 4, 10), "#b28d70", {
      position: [0, y, 0.116 + (y - 0.49) * 0.18],
      rotation: [HALF_PI + 0.18, 0, 0],
      style: "metal",
    });
  plume(
    builder,
    rig.head,
    mane,
    [-0.13, 0.26, 0.1],
    [0.23, 0.32, 0.21],
    [0.42, 0, 0.9],
  );
  plume(
    builder,
    rig.head,
    "#b3a1d4",
    [0.09, 0.29, 0.085],
    [0.19, 0.26, 0.19],
    [0.42, 0, -0.72],
  );
  charm(builder, body, "#c1e6f8", [0, 1.04, 0.531], 0.12);
  return { height: 2.12, label: [0, 2.35, 0], impact: [0, 0.95, 0.4] };
}

function buildPhoenix(builder, body, rig) {
  const flame = "#d85d38",
    gold = "#ffc56b",
    dark = "#9c3d4b",
    light = "#ffe1a0";
  builder.oval(body, flame, [0, 0.85, -0.04], [0.34, 0.47, 0.32], FUR);
  builder.oval(body, gold, [0, 0.81, 0.23], [0.235, 0.34, 0.12], FUR);
  for (const s of [-1, 1]) {
    tube(
      builder,
      body,
      "#9c6848",
      [
        [s * 0.15, 0.5, 0],
        [s * 0.19, 0.22, 0.05],
        [s * 0.21, 0.08, 0.18],
      ],
      [0.062, 0.043, 0.033],
      6,
      7,
    );
    for (const dx of [-0.065, 0.065])
      tube(
        builder,
        body,
        "#d49b58",
        [
          [s * 0.21, 0.08, 0.18],
          [s * 0.21 + dx, 0.065, 0.28],
          [s * 0.21 + dx * 1.6, 0.056, 0.33],
        ],
        [0.027, 0.023, 0.009],
        4,
        5,
      );
    const wing = builder.part(
      s < 0 ? "phoenix-wing-left" : "phoenix-wing-right",
      body,
      [s * 0.25, 1.03, -0.04],
    );
    rig[s < 0 ? "leftWing" : "rightWing"] = wing;
    builder.oval(wing, flame, [s * 0.26, 0.12, -0.055], [0.38, 0.23, 0.12], {
      rotation: [0, 0, s * 0.48],
      style: "fur",
    });
    // Splayed primary feathers rise outward in a broad crown, unlike the drake.
    for (let i = 0; i < 5; i++) {
      const x = s * (0.15 + i * 0.12),
        y = -0.035 + i * 0.055;
      plume(
        builder,
        wing,
        i % 2 ? gold : flame,
        [x, y, -0.045 - i * 0.022],
        [0.235, 0.66 - i * 0.035, 0.2],
        [-0.13, 0, -s * (0.88 - i * 0.13)],
      );
      plume(
        builder,
        wing,
        light,
        [x + s * 0.27, y + 0.28, 0.025 - i * 0.022],
        [0.085, 0.19, 0.075],
        [-0.13, 0, -s * (0.88 - i * 0.13)],
      );
    }
  }
  rig.tail = builder.part("phoenix-tail", body, [0, 0.66, -0.28]);
  for (const [x, color, length] of [
    [-0.2, dark, 0.88],
    [0, gold, 1.03],
    [0.2, flame, 0.88],
  ]) {
    tube(
      builder,
      rig.tail,
      color,
      [
        [x * 0.4, 0, 0],
        [x, -0.32, -0.26],
        [x * 1.5, -0.48, -0.6],
        [x * 1.8, -0.27, -length],
      ],
      [0.09, 0.13, 0.12, 0.008],
      10,
      7,
    );
  }
  rig.head = builder.part("phoenix-head", body, [0, 1.35, 0.14]);
  builder.oval(rig.head, flame, [0, 0.02, 0], [0.3, 0.29, 0.28], FUR);
  for (const s of [-1, 1]) {
    builder.oval(
      rig.head,
      gold,
      [s * 0.14, 0.04, 0.204],
      [0.14, 0.185, 0.068],
      { rotation: [0, 0, -s * 0.23], style: "fur" },
    );
    plume(
      builder,
      rig.head,
      dark,
      [s * 0.225, 0.04, -0.03],
      [0.19, 0.36, 0.2],
      [0, 0, -s * 1.42],
    );
  }
  eyes(builder, rig.head, 0.131, 0.062, 0.268, 0.076, "#a16236");
  builder.add(rig.head, new ConeGeometry(0.09, 0.24, 8), "#ffe0a0", {
    position: [0, -0.06, 0.326],
    rotation: [1.32, 0, 0],
    scale: [1, 1, 0.76],
    style: "fur",
  });
  for (const [x, height] of [
    [-0.12, 0.34],
    [0, 0.46],
    [0.12, 0.34],
  ])
    plume(
      builder,
      rig.head,
      x === 0 ? gold : flame,
      [x, 0.23, -0.035],
      [0.16, height, 0.17],
      [-0.26, 0, -x * 1.1],
    );
  charm(builder, body, light, [0, 1.03, 0.334], 0.095);
  return { height: 2.1, label: [0, 2.32, 0], impact: [0, 0.95, 0.32] };
}

export const EXPANSION_BUILDERS = Object.freeze({
  hedgehog: buildHedgehog,
  otter: buildOtter,
  firefly: buildFirefly,
  wolf: buildWolf,
  crane: buildCrane,
  boar: buildBoar,
  bear: buildBear,
  unicorn: buildUnicorn,
  phoenix: buildPhoenix,
});
