import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Separate lab files only: never modify the production bundle or source modules.
const html=await fs.readFile(path.join(root,'client-dist/index.html'),'utf8');
if(html.split('src="/app.js"').length!==2)throw Error('Expected exactly one production script entry');
for(const variant of ['baseline','arena-skipped','hand-skipped']){
 const result=await build({entryPoints:[path.join(root,'src/network/app.mjs')],bundle:true,write:false,format:'iife',target:['es2020'],minify:false,legalComments:'inline',loader:{'.json':'json'},metafile:true,
  plugins:[{name:'fixed-draw-diagnostic',setup(builder){builder.onLoad({filter:/\/arena3d\/(scene|hand-scene)\.mjs$/},async args=>{
   const source=await fs.readFile(args.path,'utf8'),kind=path.basename(args.path)==='scene.mjs'?'arena':'hand';
   const needle='this.renderer.render(this.scene, this.camera);';
   if(source.split(needle).length!==2)throw Error('Diagnostic draw anchor changed');
   const skipped=variant===`${kind}-skipped`;
   const draw=skipped?'this.scene.updateMatrixWorld(); this.camera.updateMatrixWorld();':needle;
   const counters=`\n this.canvas.dataset.diagnosticVariant=${JSON.stringify(variant)};\n this.canvas.dataset.diagnosticUpdates=String(Number(this.canvas.dataset.diagnosticUpdates||0)+1);\n this.canvas.dataset.diagnosticDraws=String(Number(this.canvas.dataset.diagnosticDraws||0)+${skipped?0:1});\n this.canvas.dataset.diagnosticCalls=String(this.renderer.info?.render?.calls??-1);\n this.canvas.dataset.diagnosticTriangles=String(this.renderer.info?.render?.triangles??-1);\n`;
   return {contents:source.replace(needle,draw+counters),loader:'js'};
  });}}]});
 if(Object.keys(result.metafile.inputs).some(p=>/(?:questions\.json|speech-assets\.json|server\/)/.test(p)))throw Error('Private material in lab bundle');
 const name=`draw-diagnostic-${variant}`;
 await fs.writeFile(path.join(root,`client-dist/${name}.js`),result.outputFiles[0].text);
 await fs.writeFile(path.join(root,`client-dist/${name}.html`),html.replace('src="/app.js"',`src="/${name}.js"`));
}
console.log('Built three fixed diagnostic bundles; production app.js unchanged');
