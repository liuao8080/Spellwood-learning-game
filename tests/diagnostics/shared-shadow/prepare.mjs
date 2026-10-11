import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { adaptLocalActorCleanup } from '../../local/cleanup.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const once = (text, before, after) => { if (text.split(before).length !== 2) throw new Error('Original helper adaptation changed; inspect this transport seam.'); return text.replace(before, after); };

export function prepareSharedShadowSuite(root, runId, launch, executionEnvironment, actualGithub=null) {
  const sourceDirectory = path.join(root, 'tests/diagnostics/shared-shadow');
  const evidenceDirectory = path.join(root, 'test-results/shared-shadow-evidence');
  const directory = path.join(root, 'test-results', `shared-shadow-suite-${runId}`);
  const clientDirectory = path.join(root, 'test-results', `shared-shadow-work-${runId}`, 'client');
  const manifestFile = path.join(evidenceDirectory, `shared-shadow-${runId}-manifest.json`);
  const fixedFile = path.join(root, 'test-results/shared-shadow-fixed/build-manifest.json');
  if (!existsSync(fixedFile)) throw new Error('Build the fixed diagnostic bundles before listing or running this configuration.');
  const fixed = JSON.parse(readFileSync(fixedFile, 'utf8'));
  if(sha(readFileSync(path.join(root,'client-dist/app.js')))!==fixed.formalSha||
    sha(readFileSync(path.join(root,fixed.helperFile)))!==fixed.helperSha||
    sha(readFileSync(path.join(sourceDirectory,'observer.mjs')))!==fixed.observerSha||
    !fixed.builderFile||sha(readFileSync(path.join(root,fixed.builderFile)))!==fixed.builderSha)
    throw new Error('Fixed bundle preparation differs from current formal/helper/observer/builder version; preserve preview and rebuild explicitly.');
  for(const variant of fixed.variants)for(const source of variant.copiedSources)
    if(source.originalFile&&sha(readFileSync(path.join(root,source.originalFile)))!==source.originalSha256)
      throw new Error('Formal source changed after the fixed lab build; do not compare stale copies.');
  const originals = ['helpers.mjs','combat-motion-tools.mjs'].map(name => {
    const file = `tests/e2e/${name}`, source = readFileSync(path.join(root,file),'utf8');
    let generated = source.replaceAll('test-results/browser-evidence',path.relative(root,evidenceDirectory))
      .replaceAll('http://127.0.0.1:4173','http://127.0.0.1:4191')
      .replaceAll('127\\.0\\.0\\.1:4173','127\\.0\\.0\\.1:4191');
    if (name === 'helpers.mjs') {
      generated = once(generated,"from '@playwright/test'","from '../../tests/diagnostics/shared-shadow/fixture.mjs'");
      generated = once(generated,"from '../../scripts/e2e-server.mjs'","from '../../tests/diagnostics/shared-shadow/server.mjs'");
      generated = adaptLocalActorCleanup(generated);
      generated = once(generated,"await page.goto(server.origin + (diagnosticEntry ? '/' + diagnosticEntry : ''));","await page.goto(server.origin + (diagnosticEntry ? '/' + diagnosticEntry : label === 'shared-shadow-B' ? '/lab-baseline.html' : ''));");
      generated = once(generated,'const file = `${slug(testInfo.title)}-${slug(name)}.png`;','const file = `shared-shadow-${process.env.SPELLWOOD_SHARED_SHADOW_RUN_ID}-${slug(testInfo.title)}-${slug(name)}.png`;');
      generated = once(generated,'filename: `${slug(testInfo.title)}-observations.json`','filename: `shared-shadow-${process.env.SPELLWOOD_SHARED_SHADOW_RUN_ID}-observations.json`');
      generated = once(generated,'export async function diagnostics(actor) {','async function originalDiagnostics(actor) {');
      generated += '\nexport async function diagnostics(actor) { const original = await originalDiagnostics(actor); const lab = await actor.page.evaluate(() => globalThis.__shadowLab || null).catch(() => null); return { ...original, sharedShadowLab: lab }; }\n';
    }
    return {file,name,sourceSha256:sha(source),generatedSha256:sha(generated),generated};
  });
  const driverFile='tests/diagnostics/shared-shadow/shared-shadow.spec.mjs';
  const driver=readFileSync(path.join(root,driverFile),'utf8');
  const sources=[...originals,{file:driverFile,name:'shared-shadow.spec.mjs',sourceSha256:sha(driver),generatedSha256:sha(driver),generated:driver}];
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trimEnd();
  const checkoutHead=git(['rev-parse','HEAD']),sourceTree=git(['rev-parse','HEAD^{tree}']);
  const sourceHead=actualGithub?.sourceHead||checkoutHead;
  let checkoutParents=[];
  if(actualGithub){
    if(checkoutHead!==actualGithub.expectedCheckoutHead)throw new Error('Actual GitHub checkout differs from GITHUB_SHA.');
    // Raw headers retain parents even in the workflow's shallow checkout.
    checkoutParents=git(['cat-file','-p','HEAD']).split('\n\n',1)[0].split('\n').filter(line=>line.startsWith('parent ')).map(line=>line.slice(7));
    if(sourceHead!==checkoutHead&&!checkoutParents.includes(sourceHead))throw new Error('PR head is not this actual checkout or its direct merge parent.');
  }
  const productFiles=git(['ls-files','--cached','--others','--exclude-standard','src','server']).split('\n').filter(Boolean);
  const tracked=(file)=>({file,sha256:sha(readFileSync(path.join(root,file)))});
  const attribution={
    productSources:productFiles.map(tracked), formalApp:tracked('client-dist/app.js'),formalHtml:tracked('client-dist/index.html'),
    originals:['tests/e2e/helpers.mjs','tests/e2e/combat-motion-tools.mjs','tests/e2e/combat-motion.spec.mjs','playwright.config.mjs','scripts/e2e-server.mjs'].map(tracked),
    diagnosticCode:['scripts/build-shared-shadow-diagnostics.mjs','playwright.shared-shadow.config.mjs',...readdirSync(sourceDirectory).filter(name=>name.endsWith('.mjs')).map(name=>'tests/diagnostics/shared-shadow/'+name)].map(tracked),
    sharedOwnership:['tests/local/cleanup.mjs','tests/local/server.mjs'].map(tracked),
    fixedSources:fixed.variants.flatMap(variant=>variant.copiedSources.map(({file,sha256})=>({file,sha256}))),
    fixedBuild:[tracked(path.relative(root,fixedFile)),...fixed.staticFiles.map(({file,sha256})=>({file,sha256}))],
    generatedSuite:sources.map(item=>({file:path.relative(root,path.join(directory,item.name)),sha256:item.generatedSha256})),
    servedSnapshot:fixed.staticFiles.map(item=>({file:path.relative(root,path.join(clientDirectory,path.basename(item.file))),sha256:item.sha256})),
  };
  if (existsSync(manifestFile)) { const old=JSON.parse(readFileSync(manifestFile,'utf8')); if(JSON.stringify(old.attribution)!==JSON.stringify(attribution))throw new Error('Sources changed during lab run; preserve it and use a new ID.');return {directory,evidenceDirectory,clientDirectory,manifestFile}; }
  mkdirSync(directory,{recursive:true});mkdirSync(evidenceDirectory,{recursive:true});
  cpSync(path.join(root,'test-results/shared-shadow-fixed/fixed-client'),clientDirectory,{recursive:true});
  for (const item of sources) writeFileSync(path.join(directory,item.name),item.generated);
  writeFileSync(manifestFile,JSON.stringify({schema:1,runId,preparedAt:new Date().toISOString(),commit:checkoutHead,tree:sourceTree,
    sourceHead,checkoutHead,sourceTree,sourceTreeScope:'Actual checked-out content tree; may be the merge tree',checkoutParents,actualGithub,
    dirtyFiles:git(['status','--porcelain']).split('\n').filter(Boolean).map(line=>line.slice(3)),
    executionEnvironment,launch,attribution,staticFiles:fixed.staticFiles,build:fixed,formalAcceptance:false,
    originalMaximumFrameGapMs:250,originalInitialGuestLimitMs:25000,retries:0,
    originalHelpersUnchanged:true,originalCombatBodyUnchanged:true,driver:'Explicit independent shared-shadow diagnostic; ABBA real UI/reload, never replaces original acceptance',
    transportAdaptations:['Dedicated loopback4191/owned DB/server','Fixed public static B entry and real reload/reconnect','Shared bounded cleanup; any failure remains red','Unique redacted evidence names and final primitive lab observations'],
  },null,2));
  return {directory,evidenceDirectory,clientDirectory,manifestFile};
}
