import fs from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const html = fs.readFileSync(
  new URL("../dist/index.html", import.meta.url),
  "utf8",
);
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(js);
for (const p of [
  "arena.webp",
  "creatures.webp",
  ...["first", "home", "daily", "clothes"].map(
    (x) => `learning/${x}-words.webp`,
  ),
  ...["sprout", "sprite", "golem", "spark", "bloom", "moon"].map(
    (x) => "cards/" + x + ".webp",
  ),
])
  assert.ok(
    fs.statSync(new URL("../dist/assets/" + p, import.meta.url)).size > 0,
  );
// Inspect the actual offline dependency graph. The separate online entry is
// explicitly networked and must not weaken this old standalone guarantee.
const root = fileURLToPath(new URL("../", import.meta.url));
const offlineGraph = await build({
  absWorkingDir: root, entryPoints: ["src/app.mjs"], bundle: true,
  write: false, metafile: true, loader: { ".json": "json" },
});
const applicationModules = Object.keys(offlineGraph.metafile.inputs)
  .filter((p) => p.startsWith("src/") && p.endsWith(".mjs"));
assert.ok(!applicationModules.some((p) => p.startsWith("src/network/")), "Offline app cannot import the network client");
assert.ok(
  !/\b(fetch\s*\(|XMLHttpRequest|sendBeacon\s*\(|new WebSocket)/.test(
    applicationModules
      .map((p) => fs.readFileSync(path.join(root, p), "utf8"))
      .join("\n"),
  ),
  "No application network transmission",
);
assert.ok(
  !/art_v2_|api[_-]?key\s*[:=]|Bearer [A-Za-z0-9_-]{10}/i.test(html),
  "No credentials in deliverable",
);
console.log(
  "Built HTML syntax, assets and no application data-upload code: PASS",
);

const questions = JSON.parse(
  fs.readFileSync(new URL("../src/questions.json", import.meta.url)),
);
const speech = JSON.parse(
  fs.readFileSync(new URL("../src/speech-assets.json", import.meta.url)),
);
for (const q of questions)
  for (const text of [q.listen, q.speak]) {
    const asset = speech[text];
    assert.match(
      asset || "",
      /^assets\/speech\/[a-f0-9]{16}\.mp3$/,
      `Missing pronunciation for ${q.id}`,
    );
    assert.ok(
      fs.statSync(new URL("../dist/" + asset, import.meta.url)).size > 1000,
    );
  }
console.log("All before/after-answer English clips present: PASS");
