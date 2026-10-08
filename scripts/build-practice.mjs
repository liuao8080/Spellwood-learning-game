import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.resolve(process.argv[2] || path.join(root, "practice-dist"));
if ([path.join(root, "dist"), path.join(root, "client-dist")].includes(destination)) throw Error("Practice output must be separate from existing versions");
const resolve = name => path.join(root, name);
const result = await build({
  entryPoints: [resolve("src/network/app.mjs")], bundle: true, write: false, format: "esm", target: ["es2020"], minify: true, legalComments: "inline", metafile: true,
  alias: { "node:crypto": resolve("src/practice/browser-crypto.mjs"), "node:fs": resolve("src/practice/no-filesystem.mjs") },
  plugins: [{ name: "isolated-practice", setup(b) { b.onResolve({ filter: /^\.\/runtime\.mjs$/ }, args => args.importer === resolve("src/network/app.mjs") ? { path: resolve("src/practice/runtime.mjs") } : undefined); } }],
});
if (Object.keys(result.metafile.inputs).some(p => /(?:server\/index|node_modules\/ws\/)/.test(p))) throw Error("Network server entered isolated practice");
let html = fs.readFileSync(resolve("src/network/template.html"), "utf8");
html = html.replace("/* NETWORK_STYLE */", fs.readFileSync(resolve("src/network/style.css"), "utf8") + "\n" + fs.readFileSync(resolve("src/network/collection.css"), "utf8") + "\n" + fs.readFileSync(resolve("src/network/immersive.css"), "utf8") + "\n" + fs.readFileSync(resolve("src/network/safe-area.css"), "utf8") + "\n" + fs.readFileSync(resolve("src/network/identity.css"), "utf8"))
  .replace('<script>/* NETWORK_SCRIPT */</script>', '<script type="module" src="/app.js"></script>')
  .replace(/<title>.*?<\/title>/, "<title>词灵对决 · 三维森林试玩</title>")
  .replace("</head>", '<meta name="description" content="电脑角色自主决策的三维英语卡牌试玩，学习记录仅保存在本机。"></head>')
  .replace(/<meta name="description"[^>]*>/, '<meta name="description" content="立体森林棋盘上的英语卡牌对战。电脑角色自主决策，学习记录仅保存在当前浏览器。">');
fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(path.join(destination, "index.html"), html);
fs.writeFileSync(path.join(destination, "app.js"), result.outputFiles[0].text);
fs.cpSync(resolve("dist/assets"), path.join(destination, "assets"), { recursive: true });
fs.copyFileSync(resolve("src/network/responsive-review.html"), path.join(destination, "responsive-review.html"));
fs.copyFileSync(resolve("node_modules/three/LICENSE"), path.join(destination, "THREE-LICENSE.txt"));
fs.copyFileSync(resolve("node_modules/@noble/hashes/LICENSE"), path.join(destination, "NOBLE-HASHES-LICENSE.txt"));
console.log(JSON.stringify({ output: destination, javascriptBytes: result.outputFiles[0].contents.length, computerOnly: true, networkTransport: false }));
