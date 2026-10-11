import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { prepareSharedShadowSuite } from './tests/diagnostics/shared-shadow/prepare.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
if(process.cwd()!==root)throw new Error('Run shared-shadow diagnostics from the repository root.');
const listing=process.argv.includes('--list');
const github=process.env.GITHUB_ACTIONS==='true';
let actualGithub=null;
if(github){
  const expectedRepository='liuao8080/Spellwood-learning-game';
  if(process.env.GITHUB_REPOSITORY!==expectedRepository||process.env.SPELLWOOD_BROWSER_CI!=='1'||process.env.SPELLWOOD_SHADOW_LAB_CI!=='1'||!process.env.GITHUB_EVENT_PATH)
    throw new Error('Shared-shadow CI execution requires the actual dedicated GitHub workflow job.');
  const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  const manual=process.env.GITHUB_EVENT_NAME==='workflow_dispatch'&&event.inputs?.diagnostic_scope==='shared-shadow';
  const pullRequest=process.env.GITHUB_EVENT_NAME==='pull_request'&&event.number===7&&
    event.pull_request?.head?.ref==='codex/local-gpu-refinement'&&event.pull_request?.head?.repo?.full_name===expectedRepository&&
    event.pull_request?.base?.ref==='codex/teacher-expansion-integrated'&&event.pull_request?.base?.repo?.full_name===expectedRepository;
  if(!manual&&!pullRequest)throw new Error('Only the authorized real shared-shadow manual scope or same-repository PR7 event can execute this CI diagnostic.');
  const sourceHead=pullRequest?event.pull_request.head.sha:process.env.GITHUB_SHA;
  if(!/^[0-9a-f]{40}$/.test(sourceHead||'')||!/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA||''))
    throw new Error('Missing actual GitHub source/checkout identity.');
  actualGithub={eventName:process.env.GITHUB_EVENT_NAME,sourceHead,expectedCheckoutHead:process.env.GITHUB_SHA};
}
if(!github && (process.env.GITHUB_ACTIONS||process.env.SPELLWOOD_BROWSER_CI||process.env.SPELLWOOD_SHADOW_LAB_CI))
  throw new Error('Do not impersonate CI to run the diagnostic locally.');
if(!github&&!listing&&process.env.SPELLWOOD_SHARED_SHADOW_LOCAL!=='1')throw new Error('Select the explicit authorized local diagnostic mode.');
const mode=github?'official-ci-default':process.env.SPELLWOOD_SHARED_SHADOW_MODE||'hardware-headed';
if(!github&&!['hardware-headed','swiftshader-headless'].includes(mode))throw new Error('Unknown local diagnostic mode.');
const launch=github?{browserName:'chromium',headless:true,originalPlaywrightDefaults:true}:
  {browserName:'chromium',channel:'chrome',headless:mode==='swiftshader-headless',launchOptions:{chromiumSandbox:true,
    args:mode==='swiftshader-headless'?['--use-gl=angle','--use-angle=swiftshader']:[],
    ignoreDefaultArgs:['--enable-unsafe-swiftshader','--unsafely-disable-devtools-self-xss-warnings']}};
const runId=process.env.SPELLWOOD_SHARED_SHADOW_RUN_ID||`${mode}-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
// Decoder prefixes add40 characters and have an unchanged100-character cap.
if(!/^[a-zA-Z0-9_-]{1,60}$/.test(runId))throw new Error('Use a diagnostic run ID of at most60 safe characters.');
process.env.SPELLWOOD_SHARED_SHADOW_RUN_ID=runId;
const prepared=prepareSharedShadowSuite(root,runId,launch,github?`actual-github-actions-${process.env.GITHUB_EVENT_NAME}`:listing?'local-list-only':'explicit-local-diagnostic',actualGithub);
process.env.SPELLWOOD_SHARED_SHADOW_SELECTED='1';
process.env.SPELLWOOD_SHARED_SHADOW_MANIFEST=prepared.manifestFile;
process.env.SPELLWOOD_LOCAL_RUN_ID=runId;process.env.SPELLWOOD_LOCAL_PORT='4191';
process.env.SPELLWOOD_LOCAL_EVIDENCE=prepared.evidenceDirectory;process.env.SPELLWOOD_LOCAL_CLIENT_DIST=prepared.clientDirectory;
export default defineConfig({testDir:prepared.directory,testMatch:'**/shared-shadow.spec.mjs',workers:1,fullyParallel:false,retries:0,forbidOnly:true,
  timeout:300000,globalTimeout:8*60000,expect:{timeout:12000},outputDir:path.join(root,'test-results',`shared-shadow-internal-${runId}`),
  reporter:[['list'],[path.join(root,'tests/diagnostics/shared-shadow/reporter.mjs')]],
  use:{browserName:'chromium',headless:launch.headless,...(launch.channel?{channel:launch.channel,launchOptions:launch.launchOptions}:{}),
    viewport:{width:1280,height:800},locale:'zh-CN',actionTimeout:12000,navigationTimeout:20000,trace:'off',video:'off',screenshot:'off'}});
