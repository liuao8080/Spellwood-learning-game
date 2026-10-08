import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createIdentityStore} from '../server/identity-store.mjs';
import {createPlayerProgress} from '../server/player-progress.mjs';
import {createProgressBridge} from '../server/progress-bridge.mjs';
import {createProgressHttp} from '../server/progress-http.mjs';
import {RemoteProgressStore} from '../src/network/remote-progress.mjs';

// Exercise the real HTTP boundary without a socket, browser or account fixture.
const questions=[{id:'pep1-g1-s1-u1-q1',grade:1,semester:1,unitId:'g1-s1-u1'}];
function harness(t) {
  const identityStore=createIdentityStore();t.after(()=>identityStore.close());
  const progress=createPlayerProgress({identityStore,questions,timeZone:'UTC'});
  const first=identityStore.createGuest().player.playerId;
  const second=identityStore.createGuest().player.playerId;
  progress.ensure(first);progress.ensure(second);
  let authenticatedPlayer=first,bodyReads=0;
  const bridge=createProgressBridge({progress,identityStore});
  const boundary=createProgressHttp({identityStore,progress,bridge,
    identityHttp:{current:()=>({identity:{player:{playerId:authenticatedPlayer}}})},
    readJson:async req=>{bodyReads++;return JSON.parse(req.body);},
    validOrigin:()=>true,json:(res,status,payload)=>Object.assign(res,{status,payload})});
  const fetcher=async(path,options={})=>{
    const url=new URL(path,'https://synthetic.example');
    const req={method:options.method||'GET',headers:Object.fromEntries(
      Object.entries(options.headers||{}).map(([key,value])=>[key.toLowerCase(),value])),body:options.body};
    const res={};assert.equal(await boundary.handle(req,res,url.pathname,url),true);
    return {ok:res.status>=200&&res.status<300,status:res.status,json:async()=>structuredClone(res.payload)};
  };
  return {first,second,progress,fetcher,switchToSecond:()=>{authenticatedPlayer=second;},
    bodyReads:()=>bodyReads,store:()=>new RemoteProgressStore({questions,playerId:first,fetcher})};
}

test('a stale account view cannot write preferences to the replacement cookie owner',async t=>{
  const h=harness(t),store=h.store();assert.equal((await store.load()).ok,true);
  const originalSecond=h.progress.ensure(h.second).progress;
  h.switchToSecond();
  const result=await store.updatePreferences({grade:2});
  assert.equal(result.ok,false);assert.equal(result.code,'PROFILE_CHANGED');
  assert.equal(store.dirty,false,'a rejected owner mismatch must not leave a retryable write');
  assert.equal(h.progress.ensure(h.second).progress.legacy.grade,originalSecond.legacy.grade,
    'the new cookie owner must be unchanged before the client sees a mismatch');
  assert.equal(h.bodyReads(),0,'mismatched writes must be rejected before parsing or applying an intent');
  assert.equal(store.data.profileId,h.first);
});

test('owner binding rejects a stale collection request and progress read without exposing the new profile',async t=>{
  const h=harness(t),store=h.store();await store.load();h.switchToSecond();
  assert.equal((await store.openPack('test')).code,'PROFILE_CHANGED');
  assert.equal(h.progress.ensure(h.second).progress.collection.opening,null);
  const response=await h.fetcher('/api/progress',{headers:{'X-Spellwood-Player':h.first}});
  assert.equal(response.status,409);assert.deepEqual(await response.json(),{code:'PROFILE_CHANGED'});
  assert.equal(h.bodyReads(),0);
});

test('progress writes require an explicit owner while an initial read can discover its cookie owner',async t=>{
  const h=harness(t);
  const initial=await h.fetcher('/api/progress');assert.equal(initial.status,200);
  const response=await h.fetcher('/api/progress/preferences',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'unbound-request',patch:{grade:2}})});
  assert.equal(response.status,409);assert.deepEqual(await response.json(),{code:'PROFILE_CHANGED'});
  assert.equal(h.bodyReads(),0);assert.equal(h.progress.ensure(h.first).progress.legacy.grade,1);
});

test('starting a new identity check keeps an older pending progress refresh behind the gate',async()=>{
  const source=readFileSync(new URL('../src/network/app.mjs',import.meta.url),'utf8');
  const lifecycle=source.slice(source.indexOf('function resumeIdentityView()'),source.indexOf('\nrender();\nscene ='));
  assert.ok(lifecycle.includes('async function activateIdentity'));
  let finishRefresh;const refresh=new Promise(resolve=>{finishRefresh=resolve;});
  const owner={playerId:'synthetic-owner',kind:'account'};
  const context={isPractice:false,identityVerified:false,identityEpoch:0,identityCheckError:'',
    identityCheckTask:null,identityRefreshPending:false,activeIdentity:owner,
    identityClient:{state:{operation:'me',busy:false}},identityPanel:null,
    desk:{refresh:()=>refresh,store:{playerId:owner.playerId},issue:null,visibility(){}},
    document:{hidden:false},pageSuspended:false,collectionView:null,SOUND:{visibility(){}},
    connectionState:'ready',link:{connect(){}},cancelVoice(){},render(){},
    queueMicrotask(){},setTimeout};
  vm.createContext(context);vm.runInContext(lifecycle,context);
  const previous=context.activateIdentity(owner);
  context.beginIdentityCheck();
  finishRefresh();await previous;
  assert.equal(context.identityVerified,false,'a reply begun before the latest check must not reveal old account content');

  let finishQueuedRefresh,olderActivation;
  const queuedRefresh=new Promise(resolve=>{finishQueuedRefresh=resolve;});
  const scheduled=[];context.setTimeout=callback=>scheduled.push(callback);
  context.desk.refresh=()=>queuedRefresh;
  context.identityClient.me=async()=>{
    // A cookie-change notification arrived after this me request began.
    context.identityRefreshPending=true;
    olderActivation=context.activateIdentity(owner);
    return {player:owner};
  };
  await context.verifyIdentity();
  assert.equal(scheduled.length,1);
  finishQueuedRefresh();await olderActivation;
  assert.equal(context.identityVerified,false,'waiting to start a queued recheck must not reopen the old account gate');
});
