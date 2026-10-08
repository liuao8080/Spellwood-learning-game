import fs from "node:fs";
import { build } from "esbuild";
const root = new URL("../", import.meta.url),
  read = (p) => fs.readFileSync(new URL(p, root), "utf8");
const bundle = await build({
  entryPoints: [new URL("../src/app.mjs", import.meta.url).pathname],
  bundle: true,
  write: false,
  format: "iife",
  target: ["es2020"],
  minify: false,
  legalComments: "inline",
  loader: { ".json": "json" },
});
const js = bundle.outputFiles[0].text;
const html = read("src/template.html")
  .replace("APP_VERSION", JSON.parse(read("package.json")).version)
  .replace(
    "/* APP_STYLE */",
    read("src/style.css") + "\n" + read("src/battle-v2.css"),
  )
  .replace("/* APP_SCRIPT */", js.replace(/<\/script/gi, "<\\/script"));
fs.writeFileSync(new URL("dist/index.html", root), html);
console.log(
  `Built v2 standalone HTML: ${Buffer.byteLength(html)} bytes, bundled Three.js and 432 questions`,
);
