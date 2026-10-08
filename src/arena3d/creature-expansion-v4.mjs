/** Eight original v4 forest companions, authored from their selected card art.
 * Y is up and +Z is forward. All surfaces are closed opaque Standard meshes;
 * pale crystal/glass colors and solid highlights also work in the CPU renderer.
 */
import { Color, ConeGeometry, LatheGeometry, SphereGeometry, TorusGeometry, Vector2 } from "three";
import { leafSolid, polygonSolid, taperedTube } from "./model-utils.mjs";

const HALF_PI = Math.PI / 2;
const FUR = { style: "fur" };
const EYE = { style: "eye" };
const GLOW = { style: "glow" };

// The low tier keeps every authored feature, with fewer samples on rounded
// surfaces. Do not change ModelBuilder's shared quality or any older species.
function oval(builder, part, color, position, scale, options = {}) {
  if (builder.quality !== "low") return builder.oval(part, color, position, scale, options);
  const radius = Math.max(...scale);
  return builder.add(part, new SphereGeometry(1, 6, radius < .24 ? 4 : 5), color,
    { ...options, position, scale });
}

function tube(builder, part, color, points, radii, segments = 7, sides = 6, style = "fur") {
  if (builder.quality === "low") {
    // Long spirals retain extra path samples; small toes and seams need fewer.
    segments = Math.max(3, Math.round(segments * (segments >= 18 ? .64 : .55)));
    sides = Math.max(4, sides - 4);
  }
  return builder.add(part, taperedTube(points, radii, segments, sides), color, { style });
}

function leaf(builder, part, color, position, length, width, rotation = [0, 0, 0], style = "leaf") {
  return builder.add(part, leafSolid(length, width, 0.035), color, { position, rotation, style });
}

function plume(builder, part, color, position, scale, rotation = [0, 0, 0], style = "fur") {
  const profile = [[0, 0], [.34, .08], [.48, .29], [.4, .56], [.22, .83], [0, 1]];
  return builder.add(part, new LatheGeometry(profile.map(p => new Vector2(...p)), builder.quality === "low" ? 5 : 8), color, {
    position, scale, rotation, style,
  });
}

// Warm, dark eyes with one tiny catchlight. A cream rim sits behind the iris.
function eye(builder, part, position, size = .08, iris = "#764d23") {
  const [x, y, z] = position;
  oval(builder, part, "#f6dfb6", [x, y, z], [size * 1.13, size * 1.18, size * .46], FUR);
  oval(builder, part, iris, [x, y, z + size * .32], [size, size * 1.06, size * .44], EYE);
  oval(builder, part, "#161d1b", [x, y + size * .025, z + size * .66], [size * .66, size * .79, size * .24], EYE);
  oval(builder, part, "#fff7dc", [x - size * .22, y + size * .34, z + size * .85], [size * .2, size * .22, size * .11], EYE);
}

function eyes(builder, part, x, y, z, size = .08, iris) {
  for (const sign of [-1, 1]) eye(builder, part, [sign * x, y, z], size, iris);
}

function smile(builder, part, y, z, width = .12, color = "#805238") {
  tube(builder, part, color, [[-width, y, z], [0, y - .035, z + .012], [width, y, z]], [.008, .011, .008], 6, 5);
}

function roundEars(builder, part, coat, inside, x, y, size = .12) {
  for (const s of [-1, 1]) {
    oval(builder, part, coat, [s * x, y, -.025], [size, size * 1.03, size * .68], FUR);
    oval(builder, part, inside, [s * x, y, size * .54], [size * .64, size * .66, size * .19], FUR);
  }
}

function quadrupedLegs(builder, body, coat, paw, { width = .28, front = .3, back = -.42, height = .43, radius = .12 } = {}) {
  for (const s of [-1, 1]) for (const z of [front, back]) {
    tube(builder, body, coat, [[s * width, height + .15, z - .04], [s * width * 1.07, height * .57, z], [s * width * 1.1, .12, z + .03]],
      [radius * 1.22, radius, radius * .86], 6, 7);
    oval(builder, body, paw, [s * width * 1.1, .1, z + .095], [radius * 1.16, .1, radius * 1.42], FUR);
  }
}

function buildAcornSquirrel(builder, body, rig) {
  const orange = "#bd602c", light = "#dc8b43", cream = "#f7ddb0", armor = "#99723d";
  oval(builder, body, orange, [0, .64, -.045], [.34, .53, .31], FUR);
  oval(builder, body, cream, [0, .55, .225], [.245, .37, .12], FUR);
  // Two haunches and two hind feet; the two arms hold the acorn at the chest.
  for (const s of [-1, 1]) {
    oval(builder, body, orange, [s * .26, .34, -.035], [.21, .27, .245], FUR);
    oval(builder, body, "#a9542a", [s * .235, .095, .2], [.15, .095, .24], FUR);
    tube(builder, body, orange, [[s * .28, .92, .04], [s * .37, .73, .3], [s * .155, .77, .46]], [.115, .11, .073], 7, 7);
    oval(builder, body, light, [s * .153, .77, .463], [.089, .093, .086], FUR);
  }
  rig.tail = builder.part("squirrel-bushy-curled-tail", body, [-.18, .3, -.25]);
  tube(builder, rig.tail, orange, [[0, 0, 0], [-.34, .12, -.15], [-.59, .59, -.15], [-.52, 1.04, -.1], [-.21, 1.2, -.075], [.005, .99, -.08]],
    [.17, .26, .3, .32, .24, .035], 16, 9);
  tube(builder, rig.tail, light, [[-.55, .38, .04], [-.7, .73, .015], [-.55, 1.07, .075], [-.25, 1.15, .09]], [.07, .11, .13, .018], 10, 7);
  // Layered acorn-scale cuirass with an olive shoulder strap and brass clasps.
  for (const [y, width] of [[.95, .21], [.68, .205]]) for (const x of [-width, 0, width]) {
    leaf(builder, body, x === 0 ? "#bf9751" : armor, [x, y, .295 + (x === 0 ? .04 : 0)], .28, .25,
      [.04, x * .9, Math.PI - x * .8], "fur");
  }
  for (const s of [-1, 1]) {
    leaf(builder, body, armor, [s * .27, 1.015, .13], .36, .32, [.18, s * .3, -s * 1.15], "fur");
    tube(builder, body, "#526b35", [[s * .19, 1.065, -.08], [s * .255, 1.035, .19], [s * .22, .87, .355]], [.029, .032, .026], 6, 6, "leaf");
    oval(builder, body, "#c69a43", [s * .21, 1.0, .302], [.045, .046, .027], { style: "metal" });
  }
  // The separate held acorn is intentionally large enough to read at unit scale.
  oval(builder, body, "#c4893b", [0, .83, .445], [.145, .19, .135], FUR);
  oval(builder, body, "#71502d", [0, .975, .436], [.162, .077, .147], FUR);
  for (const x of [-.105, 0, .105]) oval(builder, body, "#ad8246", [x, 1.017 - Math.abs(x) * .14, .514], [.043, .026, .027], FUR);
  tube(builder, body, "#69512c", [[0, 1.015, .436], [.025, 1.09, .43], [.07, 1.103, .422]], [.027, .024, .012], 4, 6);
  rig.head = builder.part("squirrel-head-and-ear-tufts", body, [0, 1.28, .1]);
  oval(builder, rig.head, orange, [0, .01, 0], [.36, .31, .3], FUR);
  for (const s of [-1, 1]) {
    plume(builder, rig.head, orange, [s * .25, .21, -.05], [.26, .41, .19], [0, 0, -s * .2]);
    plume(builder, rig.head, "#e6b381", [s * .25, .245, .012], [.15, .28, .09], [0, 0, -s * .2]);
    oval(builder, rig.head, cream, [s * .105, -.095, .24], [.196, .14, .115], FUR);
  }
  eyes(builder, rig.head, .163, .08, .25, .083, "#6e481e");
  oval(builder, rig.head, "#86502c", [0, -.035, .362], [.059, .043, .039], EYE);
  smile(builder, rig.head, -.135, .35, .086);
  return { height: 1.91, label: [0, 2.1, 0], impact: [0, .8, .42] };
}

function buildMushroomMedic(builder, body, rig) {
  const cream = "#f0d4a3", moss = "#697a36", red = "#a9492b";
  oval(builder, body, cream, [0, .64, -.04], [.32, .46, .27], FUR);
  for (const s of [-1, 1]) {
    tube(builder, body, cream, [[s * .17, .38, -.005], [s * .18, .22, .025], [s * .2, .1, .09]], [.12, .103, .1], 5, 7);
    oval(builder, body, "#b6996d", [s * .2, .095, .135], [.151, .095, .2], FUR);
    tube(builder, body, cream, [[s * .29, .9, .03], [s * .42, .7, .21], [s * .24, .69, .42]], [.099, .092, .073], 7, 7);
    oval(builder, body, cream, [s * .235, .69, .425], [.084, .099, .079], FUR);
  }
  // A thick apron panel, a low pocket, and a tied leaf-green sash.
  builder.add(body, polygonSolid([[-.235, 1.015], [.235, 1.015], [.345, .29], [-.345, .29]], .071, .02), moss,
    { position: [0, 0, .222], style: "leaf" });
  builder.add(body, polygonSolid([[-.16, .53], [.17, .53], [.15, .36], [-.14, .36]], .034, .009), "#819144",
    { position: [0, 0, .279], style: "leaf" });
  for (const s of [-1, 1]) tube(builder, body, "#425628", [[s * .21, 1.02, .21], [s * .265, 1.05, -.02], [s * .27, .78, -.2]], [.027, .03, .023], 6, 6, "leaf");
  leaf(builder, body, "#87964a", [-.31, .64, -.085], .26, .2, [0, -.5, 1.12]);
  rig.head = builder.part("medic-face-and-spotted-cap", body, [0, 1.21, .105]);
  oval(builder, rig.head, cream, [0, .0, .1], [.32, .29, .31], FUR);
  eyes(builder, rig.head, .135, .035, .367, .065, "#684623");
  oval(builder, rig.head, "#d99d6a", [0, -.051, .426], [.038, .026, .025], FUR);
  smile(builder, rig.head, -.12, .392, .106);
  for (const s of [-1, 1]) oval(builder, rig.head, "#e9b081", [s * .235, -.07, .301], [.064, .036, .026], FUR);
  const cap = [[0, -.035], [.27, -.036], [.58, .005], [.76, .08], [.78, .125], [.73, .285], [.56, .45], [.3, .535], [0, .56]];
  builder.add(rig.head, new LatheGeometry(cap.map(p => new Vector2(...p)), builder.quality === "low" ? 12 : 20), red,
    { position: [0, .285, -.12], scale: [1, .83, .88], rotation: [-.15, 0, 0], style: "fur" });
  oval(builder, rig.head, "#dabb80", [0, .286, -.1], [.736, .041, .623], { style: "fur", rotation: [-.15, 0, 0] });
  // Cream spots follow the domed cap rather than floating above it.
  for (const [x, y, z, size] of [[0, .744, -.095, .099], [-.32, .68, .05, .105], [.34, .658, .09, .118], [-.52, .553, .19, .092], [.54, .518, .27, .074], [-.11, .591, .433, .086], [.18, .54, .493, .056]]) {
    oval(builder, rig.head, "#f0d6a2", [x, y, z], [size, .026, size * .81], { style: "fur", rotation: [.47, 0, -x * .73] });
  }
  // Glazed pear-shaped pitcher, handle, pouring lip and a single green drop.
  oval(builder, body, "#eee5bc", [.025, .72, .505], [.19, .236, .145], EYE);
  tube(builder, body, "#eee5bc", [[.11, .84, .535], [.245, .933, .548], [.3, .91, .566]], [.072, .052, .021], 7, 7, "eye");
  builder.add(body, new TorusGeometry(.103, .024, builder.quality === "low" ? 4 : 5, builder.quality === "low" ? 10 : 12), "#d1c79e", { position: [-.169, .79, .485], scale: [.7, 1.15, 1], style: "eye" });
  oval(builder, body, "#a49763", [.025, .937, .507], [.104, .017, .082], FUR);
  builder.add(body, new TorusGeometry(.103, .021, builder.quality === "low" ? 4 : 5, builder.quality === "low" ? 10 : 12), "#f9edc6", { position: [.025, .936, .507], rotation: [HALF_PI, 0, 0], scale: [1, .82, 1], style: "eye" });
  leaf(builder, body, "#7c9560", [.035, .59, .645], .19, .068, [0, 0, -.2]);
  plume(builder, body, "#b9e56c", [.3, .8, .568], [.072, .107, .064], [0, 0, Math.PI], "glow");
  return { height: 1.99, label: [0, 2.22, 0], impact: [0, .75, .39] };
}

function buildReedFrog(builder, body, rig) {
  const olive = "#798b32", dark = "#5d7129", cream = "#e7cf8e";
  oval(builder, body, olive, [0, .55, -.05], [.38, .45, .34], FUR);
  oval(builder, body, cream, [0, .56, .23], [.286, .363, .13], FUR);
  for (const s of [-1, 1]) {
    // Bulky folded hind thighs and their lower folded feet remain separate.
    oval(builder, body, dark, [s * .395, .29, -.18], [.247, .26, .29], FUR);
    tube(builder, body, olive, [[s * .46, .26, -.25], [s * .48, .095, -.06], [s * .35, .065, .18]], [.088, .068, .046], 7, 7);
    tube(builder, body, olive, [[s * .265, .85, .1], [s * .32, .41, .26], [s * .32, .11, .39]], [.086, .08, .05], 8, 7);
    for (const front of [false, true]) for (const offset of [-.07, 0, .07]) {
      const x = s * (front ? .32 : .38), z = front ? .38 : .14;
      tube(builder, body, "#b7ab55", [[x, .09, z], [x + offset, .054, z + .13], [x + offset * 1.5, .052, z + .2]], [.029, .024, .015], 4, 5);
    }
  }
  // Reed leaves hang from a woven straw collar; no weapons or damage effect.
  builder.add(body, new TorusGeometry(.29, .036, builder.quality === "low" ? 4 : 5, builder.quality === "low" ? 12 : 16), "#c0ab62", { position: [0, .87, .045], rotation: [HALF_PI, 0, 0], scale: [1.26, 1, 1], style: "leaf" });
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * .106;
    leaf(builder, body, i % 2 ? "#a6ae51" : "#6c8237", [x, .91 - Math.abs(x) * .08, .27 - Math.abs(x) * .2], .31, .12,
      [.2, -x * .3, Math.PI + x * 1.2]);
  }
  tube(builder, body, "#e1ca83", [[-.35, .88, .12], [-.18, .835, .34], [0, .88, .361], [.2, .839, .326], [.34, .89, .14]], [.016, .019, .019, .017, .012], 12, 5, "leaf");
  rig.head = builder.part("frog-wide-head-and-eye-mounds", body, [0, 1.14, .145]);
  oval(builder, rig.head, olive, [0, .02, 0], [.43, .26, .34], FUR);
  oval(builder, rig.head, cream, [0, -.182, .12], [.354, .174, .269], FUR);
  for (const s of [-1, 1]) {
    oval(builder, rig.head, dark, [s * .25, .19, .035], [.176, .205, .193], FUR);
    eye(builder, rig.head, [s * .25, .213, .203], .132, "#b68a32");
    oval(builder, rig.head, "#465922", [s * .121, .052, .326], [.022, .014, .012], EYE);
  }
  oval(builder, rig.head, "#703f29", [0, -.091, .328], [.267, .091, .077], FUR);
  oval(builder, rig.head, "#c18364", [0, -.13, .39], [.151, .024, .027], FUR);
  tube(builder, rig.head, "#d8c57d", [[-.272, -.12, .334], [0, -.19, .37], [.272, -.12, .334]], [.022, .026, .022], 8, 6);
  return { height: 1.56, label: [0, 1.79, 0], impact: [0, .71, .33] };
}

function buildGlassSnail(builder, body, rig) {
  const honey = "#dec083", pale = "#f6db9d";
  // Broad muscular foot and one tapered tail; no legs or extra facial eyes.
  oval(builder, body, honey, [.1, .15, -.05], [.64, .15, .39], FUR);
  rig.tail = builder.part("snail-tapered-foot-tail", body, [.43, .12, -.16]);
  tube(builder, rig.tail, honey, [[0, 0, 0], [.22, -.015, -.065], [.4, -.04, -.1], [.53, -.065, -.07]], [.155, .12, .072, .012], 8, 7);
  rig.head = builder.part("snail-head-and-two-eye-stalks", body, [-.405, .31, .24]);
  tube(builder, rig.head, pale, [[.015, -.07, -.035], [-.025, .16, .055], [-.025, .36, .07]], [.2, .187, .18], 9, 8);
  oval(builder, rig.head, pale, [-.025, .38, .065], [.201, .185, .174], FUR);
  for (const s of [-1, 1]) {
    const topX = -.025 + s * .155;
    tube(builder, rig.head, honey, [[-.025 + s * .104, .48, .06], [topX, .68, .069], [topX + s * .025, .83, .063]], [.037, .031, .026], 8, 6);
    // Each complete eye exists only at a stalk tip: exactly two eyes total.
    oval(builder, rig.head, pale, [topX + s * .025, .85, .065], [.067, .075, .061], FUR);
    oval(builder, rig.head, "#35291a", [topX + s * .025, .855, .117], [.047, .051, .025], EYE);
    oval(builder, rig.head, "#fff6cf", [topX + s * .025 - .015, .876, .137], [.014, .016, .008], EYE);
  }
  tube(builder, rig.head, "#976532", [[-.128, .333, .209], [-.025, .304, .231], [.077, .337, .21]], [.008, .01, .008], 7, 5);
  // A sealed pearl-aqua shell: opaque color makes its spiral clear on the CPU.
  oval(builder, body, "#65bdb3", [.205, .68, -.12], [.549, .572, .306], EYE);
  oval(builder, body, "#abdad1", [.205, .68, .122], [.49, .514, .094], EYE);
  const spiral = [];
  for (let i = 0; i <= 26; i++) {
    const t = i / 26, angle = -.9 + t * Math.PI * 3.75, radius = .47 * (1 - t) + .025;
    spiral.push([.205 + Math.cos(angle) * radius, .68 + Math.sin(angle) * radius, .217 + .025 * t]);
  }
  tube(builder, body, "#388f8f", spiral, [.052, .046, .035, .016], 34, 7, "eye");
  tube(builder, body, "#e9edd2", spiral.map(([x, y, z]) => [x - .012, y + .016, z + .03]), [.016, .015, .012, .006], 34, 5, "eye");
  // Curved pearl glints are solid surface highlights, never a second eye pair.
  tube(builder, body, "#e4eee0", [[-.185, .876, .179], [-.095, 1.066, .13], [.12, 1.185, .08], [.33, 1.169, .1]], [.017, .027, .022, .006], 9, 5, "eye");
  tube(builder, body, "#c3b7d4", [[.56, .89, .159], [.666, .68, .095], [.57, .413, .158]], [.017, .024, .009], 9, 5, "eye");
  return { height: 1.29, label: [0, 1.53, 0], impact: [0, .61, .3] };
}

function buildStormKingfisher(builder, body, rig) {
  const teal = "#247f9b", cobalt = "#276991", copper = "#d68740", pale = "#e6d7ac";
  oval(builder, body, teal, [0, .77, -.05], [.285, .38, .43], FUR);
  oval(builder, body, copper, [0, .713, .166], [.25, .325, .278], FUR);
  oval(builder, body, pale, [0, .97, .269], [.168, .128, .1], FUR);
  for (const s of [-1, 1]) {
    tube(builder, body, "#a34f27", [[s * .12, .495, .035], [s * .14, .322, .04], [s * .19, .284, .116]], [.032, .026, .019], 5, 6);
    for (const d of [-.035, .035]) tube(builder, body, "#ad632e", [[s * .19, .284, .116], [s * .19 + d, .257, .189], [s * .19 + d * 1.3, .3, .208]], [.019, .014, .006], 4, 5);
    const wing = builder.part(s < 0 ? "kingfisher-left-wing" : "kingfisher-right-wing", body, [s * .23, .91, -.105]);
    rig[s < 0 ? "leftWing" : "rightWing"] = wing;
    builder.add(wing, polygonSolid([[0, -.11], [s * .28, -.07], [s * .92, .36], [s * .8, .54], [s * .19, .235]], .105, .016), teal,
      { position: [0, 0, 0], rotation: [-.28, 0, 0], style: "fur" });
    // Five slim primary feathers give each wing a clear avian silhouette.
    for (let i = 0; i < 5; i++) {
      leaf(builder, wing, i < 2 ? "#82b9ba" : "#589cae", [s * (.2 + i * .113), .0 + i * .078, .051], .56 - i * .027, .16,
        [-.42, 0, -s * (1.15 - i * .08)], "fur");
    }
    for (let i = 0; i < 3; i++) leaf(builder, wing, cobalt, [s * (.15 + i * .13), .115 + i * .07, .117], .29, .115,
      [-.35, 0, -s * .88], "fur");
    oval(builder, wing, copper, [s * .17, .037, .055], [.127, .2, .067], { style: "fur", rotation: [0, 0, -s * .65] });
  }
  rig.tail = builder.part("kingfisher-short-tail", body, [0, .56, -.38]);
  for (const x of [-.1, 0, .1]) plume(builder, rig.tail, x === 0 ? teal : cobalt, [x, 0, 0], [.155, .35, .12], [-2.08, 0, -x * .5]);
  rig.head = builder.part("kingfisher-head-and-long-beak", body, [0, 1.14, .245]);
  oval(builder, rig.head, teal, [0, .015, -.015], [.27, .246, .3], FUR);
  for (const s of [-1, 1]) {
    oval(builder, rig.head, copper, [s * .166, -.029, .193], [.103, .09, .077], FUR);
    oval(builder, rig.head, pale, [s * .142, -.134, .12], [.15, .079, .164], FUR);
    eye(builder, rig.head, [s * .163, .04, .204], .068, "#8d6431");
  }
  // Long narrow bill, with a copper lower seam and a genuinely pointed end.
  builder.add(rig.head, new ConeGeometry(.087, .59, 6), "#39463b", { position: [0, -.039, .506], rotation: [HALF_PI, 0, 0], scale: [1, 1, .64], style: "fur" });
  builder.add(rig.head, new ConeGeometry(.052, .53, 6), "#c37d35", { position: [0, -.063, .502], rotation: [HALF_PI, 0, 0], scale: [1, 1, .32], style: "fur" });
  for (const x of [-.09, .015, .12]) leaf(builder, rig.head, "#59bac4", [x, .186, -.061], .173, .088, [-.7, 0, -x], "fur");
  return { height: 1.55, label: [0, 1.81, 0], impact: [0, .8, .3] };
}

function buildSunBadger(builder, body, rig) {
  const charcoal = "#58524a", dark = "#3e3935", cream = "#e9dab8", leather = "#875331";
  oval(builder, body, charcoal, [0, .68, -.22], [.49, .47, .65], FUR);
  oval(builder, body, "#6d6253", [0, .79, .235], [.395, .448, .32], FUR);
  quadrupedLegs(builder, body, charcoal, dark, { width: .315, front: .305, back: -.53, height: .51, radius: .158 });
  for (const s of [-1, 1]) for (const z of [.4, -.435]) for (const dx of [-.07, 0, .07]) {
    tube(builder, body, "#a99e7e", [[s * .346 + dx, .099, z + .075], [s * .346 + dx, .069, z + .153]], [.018, .006], 3, 5);
  }
  oval(builder, body, cream, [0, .825, .417], [.242, .33, .076], FUR);
  rig.tail = builder.part("badger-short-tail", body, [0, .57, -.76]);
  plume(builder, rig.tail, "#796e59", [0, 0, 0], [.22, .35, .23], [-2.08, 0, .24]);
  // Chestnut harness crosses the shoulders and joins a large shoulder/back clasp.
  for (const s of [-1, 1]) {
    tube(builder, body, leather, [[s * .13, 1.08, -.21], [s * .375, 1.005, .10], [s * .37, .715, .3], [s * .21, .585, .451]], [.044, .047, .047, .045], 10, 6);
    tube(builder, body, "#b78449", [[s * .255, 1.061, -.08], [s * .415, .952, .124]], [.015, .015], 4, 5);
  }
  tube(builder, body, leather, [[-.36, .73, .321], [0, .638, .484], [.36, .73, .321]], [.054, .054, .054], 8, 6);
  oval(builder, body, "#9c7137", [-.344, 1.104, -.02], [.164, .171, .054], { style: "metal", rotation: [-.25, -.45, -.13] });
  builder.add(body, new TorusGeometry(.143, .02, builder.quality === "low" ? 4 : 5, builder.quality === "low" ? 12 : 16), "#d5b564", { position: [-.344, 1.104, .028], rotation: [-.25, -.45, -.13], style: "metal" });
  rig.head = builder.part("badger-striped-head", body, [0, 1.225, .325]);
  oval(builder, rig.head, cream, [0, 0, 0], [.359, .33, .338], FUR);
  roundEars(builder, rig.head, dark, "#a99577", .259, .25, .113);
  // Two broad dark eye stripes leave the characteristic central cream blaze.
  for (const s of [-1, 1]) {
    oval(builder, rig.head, dark, [s * .176, .09, .245], [.112, .253, .095], { style: "fur", rotation: [0, 0, s * .19] });
    oval(builder, rig.head, cream, [s * .15, -.137, .295], [.196, .135, .121], FUR);
    eye(builder, rig.head, [s * .177, .064, .323], .065, "#996c34");
  }
  oval(builder, rig.head, cream, [0, -.058, .331], [.182, .134, .17], FUR);
  oval(builder, rig.head, "#342d25", [0, -.012, .481], [.095, .071, .055], EYE);
  smile(builder, rig.head, -.151, .434, .108, "#74614b");
  return { height: 1.69, label: [0, 1.91, 0], impact: [0, .8, .48] };
}

function crystalHorn(builder, head, sign) {
  const points = [[sign * .227, .18, -.018], [sign * .34, .515, -.035], [sign * .59, .635, .025],
    [sign * .775, .45, .08], [sign * .756, .177, .164], [sign * .582, .087, .236],
    [sign * .5, .217, .26], [sign * .61, .289, .25]];
  const indexed = taperedTube(points, [.13, .17, .16, .14, .104, .074, .047, .012], builder.quality === "low" ? 13 : 22, builder.quality === "low" ? 4 : 5);
  const facets = indexed.toNonIndexed();
  indexed.dispose();
  facets.computeVertexNormals();
  const geometry = builder.add(head, facets, "#a69fca", { style: "eye" });
  const colors = geometry.getAttribute("color"), pos = geometry.getAttribute("position");
  const palette = ["#a88bc6", "#83c9c7", "#d5c6e4", "#829aba", "#c2b884"].map(c => new Color(c));
  // Each triangle keeps one color, preserving crystal facets after compilation.
  for (let i = 0; i < pos.count; i += 3) {
    const ring = Math.floor(i / 30), face = Math.floor(i / 3) % 5;
    const c = palette[(ring + face) % palette.length];
    for (let vertex = i; vertex < i + 3; vertex++) colors.setXYZ(vertex, c.r, c.g, c.b);
  }
}

function buildCrystalRam(builder, body, rig) {
  const wool = "#edd8af", cocoa = "#65513f";
  oval(builder, body, wool, [0, .715, -.19], [.474, .457, .615], FUR);
  quadrupedLegs(builder, body, "#d9c29a", cocoa, { width: .294, front: .265, back: -.485, height: .447, radius: .114 });
  // Split hoof seams are small solid lines; all four hooves remain independent.
  for (const s of [-1, 1]) for (const z of [.36, -.39]) tube(builder, body, "#40352c", [[s * .323, .17, z + .087], [s * .323, .051, z + .14]], [.009, .012], 3, 5);
  // Sparse overlapping fleece curls describe the silhouette without a fur mesh.
  for (const [x, y, z, r] of [[-.31, .88, -.48, .19], [.31, .88, -.48, .19], [-.405, .61, -.2, .18], [.405, .61, -.2, .18],
    [-.29, .99, -.045, .19], [.29, .99, -.045, .19], [0, 1.067, -.31, .205], [-.25, .72, .283, .19], [.25, .72, .283, .19],
    [-.325, .447, -.43, .14], [.325, .447, -.43, .14]]) oval(builder, body, (x > 0) ? wool : "#f1deb8", [x, y, z], [r, r, r * .9], FUR);
  rig.tail = builder.part("ram-small-wool-tail", body, [0, .745, -.755]);
  oval(builder, rig.tail, wool, [0, -.022, -.015], [.13, .168, .14], FUR);
  rig.head = builder.part("ram-head-and-paired-crystal-horns", body, [0, 1.00, .405]);
  oval(builder, rig.head, "#dfc6a0", [0, -.02, .08], [.277, .302, .28], FUR);
  for (const s of [-1, 1]) {
    oval(builder, rig.head, wool, [s * .316, .062, -.017], [.179, .079, .117], { style: "fur", rotation: [0, 0, s * .21] });
    oval(builder, rig.head, "#b48169", [s * .343, .072, .073], [.117, .043, .031], { style: "fur", rotation: [0, 0, s * .21] });
    eye(builder, rig.head, [s * .149, -.003, .299], .061, "#836337");
    crystalHorn(builder, rig.head, s);
  }
  for (const [x, y, r] of [[-.135, .205, .12], [.11, .238, .133], [0, .335, .137], [0, .133, .125]]) {
    oval(builder, rig.head, "#f7e4be", [x, y, .169], [r, r * .88, r], FUR);
  }
  oval(builder, rig.head, "#b99a75", [0, -.19, .3], [.17, .116, .134], FUR);
  oval(builder, rig.head, cocoa, [0, -.2, .42], [.09, .057, .031], EYE);
  smile(builder, rig.head, -.264, .385, .074, "#796047");
  return { height: 1.79, label: [0, 2.0, 0], impact: [0, .75, .49] };
}

function buildEmberSalamander(builder, body, rig) {
  const orange = "#c96532", light = "#df8950", cream = "#f0c991", cocoa = "#795037";
  oval(builder, body, orange, [0, .4, -.2], [.349, .288, .589], FUR);
  oval(builder, body, cream, [0, .265, .004], [.302, .177, .42], FUR);
  // Four splayed salamander legs, each ending in three short rounded toes.
  for (const s of [-1, 1]) for (const z of [.208, -.475]) {
    tube(builder, body, orange, [[s * .23, .437, z - .04], [s * .405, .24, z], [s * .443, .075, z + .098]], [.12, .102, .058], 7, 7);
    for (const dx of [-.07, 0, .07]) tube(builder, body, light, [[s * .443, .078, z + .09], [s * .443 + dx, .046, z + .192], [s * .443 + dx * 1.25, .039, z + .252]], [.029, .025, .014], 4, 5);
  }
  for (const [x, y, z, r] of [[0, .672, -.45, .105], [-.16, .625, -.3, .086], [.13, .654, -.12, .093], [-.18, .57, .055, .072], [.254, .536, -.44, .064]]) {
    oval(builder, body, cocoa, [x, y, z], [r, .022, r * 1.22], { style: "fur", rotation: [0, 0, -x * 1.8] });
  }
  rig.tail = builder.part("salamander-curved-ember-tail", body, [0, .38, -.682]);
  tube(builder, rig.tail, orange, [[0, 0, 0], [-.295, .005, -.19], [-.54, .235, -.245], [-.59, .555, -.177], [-.423, .753, -.092], [-.241, .717, -.05]],
    [.181, .175, .15, .126, .078, .012], 16, 8);
  tube(builder, rig.tail, cocoa, [[-.275, .095, -.072], [-.441, .269, -.103], [-.49, .513, -.059], [-.389, .655, -.016]], [.074, .085, .069, .021], 10, 6);
  tube(builder, rig.tail, "#f5ae42", [[-.265, .065, .007], [-.441, .204, .023], [-.389, .344, .031], [-.51, .472, .018], [-.398, .622, .043]], [.017, .024, .021, .021, .007], 14, 5, "glow");
  for (const [x, y, z] of [[-.351, .176, .045], [-.492, .377, .023], [-.493, .553, .012]]) oval(builder, rig.tail, "#ffd06f", [x, y, z], [.025, .026, .013], GLOW);
  rig.head = builder.part("salamander-wide-head", body, [0, .711, .339]);
  oval(builder, rig.head, orange, [0, .01, -.025], [.349, .246, .346], FUR);
  oval(builder, rig.head, cream, [0, -.116, .14], [.301, .152, .25], FUR);
  for (const s of [-1, 1]) {
    oval(builder, rig.head, light, [s * .22, .099, .105], [.133, .151, .157], FUR);
    eye(builder, rig.head, [s * .205, .097, .246], .092, "#754827");
    oval(builder, rig.head, cocoa, [s * .097, -.006, .329], [.018, .013, .009], EYE);
  }
  for (const [x, z, r] of [[-.083, -.12, .079], [.084, -.047, .067], [.01, .072, .053]]) oval(builder, rig.head, cocoa, [x, .236 - z * .18, z], [r, .019, r * .84], FUR);
  smile(builder, rig.head, -.096, .351, .189, "#9b5736");
  return { height: 1.23, label: [0, 1.5, 0], impact: [0, .53, .46] };
}

export const V4_BUILDERS = Object.freeze({
  acorn_squirrel: buildAcornSquirrel,
  mushroom_medic: buildMushroomMedic,
  reed_frog: buildReedFrog,
  glass_snail: buildGlassSnail,
  storm_kingfisher: buildStormKingfisher,
  sun_badger: buildSunBadger,
  crystal_ram: buildCrystalRam,
  ember_salamander: buildEmberSalamander,
});
