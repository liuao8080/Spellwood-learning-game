import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const codeDirectory = path.dirname(fileURLToPath(import.meta.url));
const base = path.join(root, 'test-results/shared-shadow-fixed');
const helper = path.resolve(process.env.SPELLWOOD_SHADOW_CANDIDATE_HELPER || path.join(root, 'tests/diagnostics/shared-shadow/shadow-cache.mjs'));
if (!fs.existsSync(helper)) throw new Error('Candidate helper not ready. Wait for its owner READY and provide SPELLWOOD_SHADOW_CANDIDATE_HELPER; do not run a placeholder.');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const formalSha = sha(fs.readFileSync(path.join(root, 'client-dist/app.js')));
if (formalSha !== 'b059f5bf1100fdaee258efac63508f466c035cdd6f9abdfde98f74f68d4678be') throw new Error('Formal bundle differs from agreed b059; stop and inspect.');
const fixed = path.join(base, 'fixed-client');
if (fs.existsSync(fixed)) throw new Error('Fixed lab already built; retain it and use a new explicit diagnostic directory for another helper version.');
const helperSha = sha(fs.readFileSync(helper)), observerSha = sha(fs.readFileSync(path.join(codeDirectory, 'observer.mjs')));
const builderFile=path.relative(root,fileURLToPath(import.meta.url)),builderSha=sha(fs.readFileSync(fileURLToPath(import.meta.url)));
const once = (text, before, after) => { if (text.split(before).length !== 2) throw new Error('Copied Scene insertion mismatch.'); return text.replace(before, after); };
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
const originalFiles = git(['ls-files', '--cached', '--others', '--exclude-standard', 'src']).split('\n').filter(Boolean);
const variants = [];
for (const variant of ['baseline', 'candidate']) {
  const copy = path.join(base, `source-${variant}`); if (fs.existsSync(copy)) throw new Error('Preserve existing lab source copy.');
  fs.cpSync(path.join(root, 'src'), path.join(copy, 'src'), { recursive: true });
  const sceneFile = path.join(copy, 'src/arena3d/scene.mjs');
  const original = fs.readFileSync(sceneFile, 'utf8');
  let scene = 'import { ReducedShadowCache } from "./reduced-shadow-cache.mjs";\nimport { installShadowLabObserver } from "./shadow-lab-observer.mjs";\n' + original;
  scene = once(scene, '    this.makeHeroes(); this.makeDecks(); this.makeFireflies();\n    this.bind(); this.resize(); this.showGallery(); this.start();',
    `    this.makeHeroes(); this.makeDecks(); this.makeFireflies();\n    this.shadowLabCache = new ReducedShadowCache({ enabled: ${variant === 'candidate'} });\n    this.shadowLabProbe = installShadowLabObserver(this, ${JSON.stringify({ variant, formalSha, helperSha, observerSha })});\n    this.bind(); this.resize(); this.showGallery(); this.start();`);
  scene = once(scene, '      this.renderer.render(this.scene, this.camera);', `      const shadowHelperBefore = performance.now();\n      const shadowTicket = this.shadowLabCache.beforeRender({ renderer: this.renderer, scene: this.scene, camera: this.camera, reduced: this.reduced, contextEpoch: this.shadowLabProbe.contextEpoch, resizeEpoch: this.shadowLabResizeEpoch || 0 });\n      this.shadowLabProbe.beginTicket(shadowTicket, performance.now() - shadowHelperBefore);\n      let shadowRenderSucceeded = false;\n      try { this.renderer.render(this.scene, this.camera); shadowRenderSucceeded = true; }\n      finally { const shadowHelperAfter = performance.now(); const shadowOutcome = this.shadowLabCache.afterRender(shadowTicket, shadowRenderSucceeded); this.shadowLabProbe.endTicket(shadowOutcome, performance.now() - shadowHelperAfter); }`);
  scene = once(scene, '  resize() {\n', '  resize() {\n    this.shadowLabResizeEpoch = (this.shadowLabResizeEpoch || 0) + 1; this.shadowLabCache?.invalidate("resize");\n');
  scene = once(scene, '  cancel() {\n', '  cancel() {\n    this.shadowLabCache?.invalidate("cancel-generation");\n');
  scene = once(scene, '  setHidden(value) {', '  setHidden(value) { if (this.hidden !== !!value) this.shadowLabCache?.invalidate("visibility");');
  scene = once(scene, '  setReduced(value) {', '  setReduced(value) { if (this.reduced !== !!value) this.shadowLabCache?.invalidate("reduced-mode");');
  fs.writeFileSync(sceneFile, scene);
  fs.copyFileSync(helper, path.join(copy, 'src/arena3d/reduced-shadow-cache.mjs'));
  fs.copyFileSync(path.join(codeDirectory, 'observer.mjs'), path.join(copy, 'src/arena3d/shadow-lab-observer.mjs'));
  const result = await build({ entryPoints: [path.join(copy, 'src/network/app.mjs')], bundle: true, write: false,
    format: 'iife', target: ['es2020'], minify: false, legalComments: 'inline', loader: { '.json': 'json' }, metafile: true });
  if (Object.keys(result.metafile.inputs).some(file => /(?:questions\.json|speech-assets\.json|server\/)/.test(file))) throw new Error('Private network materials in lab bundle');
  fs.mkdirSync(fixed, { recursive: true });
  const script = `lab-${variant}.js`, html = `lab-${variant}.html`;
  fs.writeFileSync(path.join(fixed, script), result.outputFiles[0].contents);
  const htmlSource = fs.readFileSync(path.join(root, 'client-dist/index.html'), 'utf8');
  fs.writeFileSync(path.join(fixed, html), once(htmlSource, 'src="/app.js"', `src="/${script}"`));
  if (variant === 'baseline') { fs.copyFileSync(path.join(fixed, script), path.join(fixed, 'app.js')); fs.writeFileSync(path.join(fixed, 'index.html'), htmlSource); }
  const copiedSources = originalFiles.map(file => ({ originalFile: file, originalSha256: sha(fs.readFileSync(path.join(root, file))),
    file: path.relative(root, path.join(copy, file)), sha256: sha(fs.readFileSync(path.join(copy, file))), modifiedForLab: file === 'src/arena3d/scene.mjs' }));
  if (copiedSources.some(item => !item.modifiedForLab && item.sha256 !== item.originalSha256)) throw new Error('Unexpected original-source modification');
  for (const name of ['reduced-shadow-cache.mjs', 'shadow-lab-observer.mjs']) copiedSources.push({file:path.relative(root,path.join(copy,'src/arena3d',name)),sha256:sha(fs.readFileSync(path.join(copy,'src/arena3d',name))),addedForLab:true});
  variants.push({ variant, copiedSources, script, html, appSha256: sha(result.outputFiles[0].contents), htmlSha256: sha(fs.readFileSync(path.join(fixed, html))), appBytes: result.outputFiles[0].contents.length });
}
const staticFiles = fs.readdirSync(fixed).sort().map(name => ({ route: name === 'index.html' ? '/' : '/'+name, file: path.relative(root,path.join(fixed,name)), sha256: sha(fs.readFileSync(path.join(fixed,name))) }));
fs.writeFileSync(path.join(base,'build-manifest.json'),JSON.stringify({schema:1,builtAt:new Date().toISOString(),commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}']),formalSha,helperFile:path.relative(root,helper),helperSha,observerSha,builderFile,builderSha,variants,staticFiles,
  policy:'Isolated diagnostic: A always baseline, B selected static candidate or baseline; formal source/b059 and original body/gate untouched',
  qualityChanges:0,clockChanges:0,gameStateChanges:0,normalMotionCache:false,perMeshCallbackInstrumentation:false},null,2));
console.log(JSON.stringify({formalSha,helperSha,variants:variants.map(({variant,appSha256,appBytes})=>({variant,appSha256,appBytes}))}));
