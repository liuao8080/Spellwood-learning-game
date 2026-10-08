import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createGameServer} from '../server/index.mjs';
import {createIdentityStore} from '../server/identity-store.mjs';
import {createPlayerProgress} from '../server/player-progress.mjs';
import {createProgressBridge} from '../server/progress-bridge.mjs';
import {createPasswordService} from '../server/passwords.mjs';
import {createQuestionService} from '../server/questions.mjs';
import {IdentityClient} from '../src/network/identity-client.mjs';
import {RemoteProgressStore} from '../src/network/remote-progress.mjs';
import {ProgressStore,createProgressModel,PROGRESS_KEY,PROGRESS_LOCK} from '../src/network/progress.mjs';
import {freshSave} from '../src/learning.mjs';
import {CARDS,DECKS} from '../src/cards.mjs';
import {rewardBalance} from '../src/collection.mjs';
import {dailySummary,freshJourney} from '../src/reward-journey.mjs';
import {HERO_SKINS,DEFAULT_HERO_SKIN} from '../src/hero-skins.mjs';

// Synthetic identities. The real HTTP, cookie identity client, remote store,
// reducers and SQLite commits remain in the path; only server time is controlled.
const questions=createQuestionService().metadata().questions;
const sources=JSON.parse(readFileSync(new URL('../src/questions.json',import.meta.url),'utf8'));
const model=createProgressModel({questions});
const initial=Date.UTC(2026,9,8,4);
const passwords=createPasswordService({scryptParameters:{N:1024,r:1,p:1}});
function database(t){const dir=mkdtempSync(path.join(tmpdir(),'spellwood-reward-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return path.join(dir,'progress.sqlite');}
function localStorage(values=new Map()){
 let serial=Promise.resolve();
 return {values,storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},locks:{request(name,options,run){assert.equal(name,PROGRESS_LOCK);assert.equal(options.mode,'exclusive');const task=serial.then(run);serial=task.catch(()=>{});return task;}}};
}
async function live(t,{file,at=initial}={}){
 const clock={now:at};t.mock.method(Date,'now',()=>clock.now);
 const server=createGameServer({port:0,databasePath:file,identityOptions:{passwords},config:{queueMs:500,aiDelayMs:5}});
 await server.listen();t.after(()=>server.close());
 return {server,clock};
}
function browser(server,jar=new Map()){
 const calls=[];let transportHook=null;
 const cookie=()=>[...jar].map(([key,value])=>`${key}=${value}`).join('; ');
 const fetcher=async(url,init={})=>{
  const response=await fetch(server.origin+url,{...init,headers:{...init.headers,Origin:server.origin,Cookie:cookie()}});
  for(const item of response.headers.getSetCookie()){const pair=item.split(';')[0],at=pair.indexOf('='),name=pair.slice(0,at),value=pair.slice(at+1);if(/Max-Age=0(?:;|$)/i.test(item))jar.delete(name);else jar.set(name,value);}
  calls.push({url,init,body:init.body?JSON.parse(init.body):undefined});
  if(transportHook)await transportHook(url,init,response);
  return response;
 };
 const identity=new IdentityClient({fetch:fetcher});
 return {identity,fetcher,calls,cookie,jar,setHook(value){transportHook=value;},
  async progress(){const store=new RemoteProgressStore({questions,playerId:identity.player.playerId,fetcher});assert.equal((await store.load()).ok,true);return store;},
  async post(route,body,playerId=identity.player.playerId){return fetcher(route,{method:'POST',headers:{'Content-Type':'application/json','X-Spellwood-Player':playerId},body:JSON.stringify(body)});}};
}
async function issue(browser,qid){const response=await browser.fetcher(`/api/study/${qid}`,{headers:{'X-Spellwood-Player':browser.identity.player.playerId}});assert.equal(response.status,200);return {...await response.json(),fixtureQid:qid};}
async function answer(browser,challenge,{wrong=true}={}){
 const qid=challenge.fixtureQid;
 // Public study responses intentionally carry no source answer. This test
 // chooses a known wrong public label from the synthetic bundled fixture.
 const source=sources.find(q=>q.id===qid);
 assert(source,'Question fixture must exist');
 const text=source.options[wrong?(source.answer+1)%source.options.length:source.answer];
 const option=challenge.question.options.find(value=>value.text===text);assert(option);
 const response=await browser.post(`/api/study/${qid}/answer`,{challengeId:challenge.challengeId,optionId:option.id});
 assert.equal(response.status,200);const feedback=await response.json();assert.equal(feedback.learning.correct,!wrong);return feedback;
}
async function learn(browser,store,clock,qid,{delay=0}={}){
 const challenge=await issue(browser,qid);clock.now+=delay;
 const feedback=await answer(browser,challenge);assert.equal(feedback.progressSaved,true);
 assert.equal((await store.applyLearning(feedback)).ok,true);
 clock.now+=Math.max(1200,3200-delay);
 const result=await store.qualifyLearning(challenge.challengeId);assert.equal(result.ok,true,JSON.stringify(result));
 return {challenge,feedback,result};
}
const studySix=questions.filter(q=>q.unitId===questions[0].unitId).slice(0,6);
const oldPack={kind:'open-pack',id:'old-card-pack-001',mode:'test',createdAt:initial,cards:Array.from({length:10},()=>({cardId:CARDS[0].id,finish:'leaf'}))};
function oldV3(owner='old-owner-001'){
 let data=model.fresh(owner,'America/Los_Angeles');
 data=model.applyLearning(data,{challengeId:'old-learning-001',learning:{qid:questions[0].id,correct:false,answeredAt:initial}}).data;
 data=model.collection(data,oldPack).data;
 data=model.addResult(data,{...result("old-result-0001"),assisted:false,computer:{level:"easy"}}).data;
 const deck=[...DECKS[0].ids];
 data=model.preferences(data,{deckId:'custom',customDeck:deck}).data;
 data.recoveryKey='spellwood.save.v3.recovery.original-001';
 data.schema=3;delete data.journey;return data;
}

test('v4 migration keeps every legacy field, owner and unfinished pack; old tabs cannot overwrite the new wallet',async()=>{
 assert.equal(PROGRESS_KEY,'spellwood.save.v4');assert.equal(PROGRESS_LOCK,'spellwood.save.v4.transaction');
 const old=oldV3(),raw=JSON.stringify(old),env=localStorage(new Map([['spellwood.save.v3',raw]]));
 const store=new ProgressStore({...env,questions});assert.equal((await store.load()).ok,true);
 const migrated=store.data;assert.equal(migrated.schema,4);assert.equal(migrated.profileId,old.profileId);assert.equal(migrated.journey.ownerId,old.profileId);
 for(const key of Object.keys(old).filter(key=>!['schema','revision'].includes(key)))assert.deepEqual(migrated[key],old[key],key);
 assert.equal(env.values.get('spellwood.save.v3'),raw);assert.equal(migrated.revision,old.revision+1);
 env.values.set('spellwood.save.v3',JSON.stringify({...old,revision:999}));
 assert.equal((await store.retry()).ok,true);assert.equal(store.data.revision,migrated.revision);
 const restored=store.prepareImport(store.export());assert.equal((await store.restore(restored,restored.revision)).ok,true);
 assert.notEqual(store.data.profileId,old.profileId);assert.equal(store.data.journey.ownerId,store.data.profileId);assert.match(store.data.recoveryKey,/^spellwood\.save\.v4\.recovery\./);
 for(const key of ['spellwood.save.v2','spellwood.save.v1']){
  const legacy=freshSave(),source=localStorage(new Map([[key,JSON.stringify(legacy)]])),target=new ProgressStore({...source,questions});
  assert.equal((await target.load()).ok,true);assert.equal(target.data.schema,4);assert.equal(target.data.journey.ownerId,target.data.profileId);assert(source.values.has(key));
 }
});

test('unknown/corrupt journey and schema data fail closed without writing or regenerating rewards',async()=>{
 const base=model.fresh('reward-owner-001');
 for(const mutate of [d=>{delete d.journey;},d=>{d.journey=null;},d=>{d.journey.version=2;},d=>{d.journey.ownerId='foreign-owner-001';},d=>{d.schema=5;},d=>{d.schema=2;}]){
  const data=structuredClone(base);mutate(data);assert.throws(()=>model.validate(data));
  const raw=JSON.stringify(data),env=localStorage(new Map([[PROGRESS_KEY,raw]])),store=new ProgressStore({...env,questions});
  assert.equal((await store.load()).code,'CORRUPT_SAVE');assert.equal(env.values.get(PROGRESS_KEY),raw);assert.equal(store.recoveryRaw,raw);
 }
 const env=localStorage(),store=new ProgressStore({...env,questions});assert.equal((await store.load()).ok,true);assert.equal(store.data.journey.ownerId,store.data.profileId);
});

test('SQLite schema3 migration is a single durable CAS commit, rolls back on failure, and survives guest registration',async t=>{
 const file=database(t),identity=createIdentityStore({databasePath:file,passwords});t.after(()=>identity.close());
 const guest=identity.createGuest(),id=guest.player.playerId,old=oldV3(id);
 old.revision=guest.player.revision+1;identity.updatePlayerData(id,{expectedRevision:guest.player.revision,progress:old});
 const sql=new DatabaseSync(file);t.after(()=>sql.close());
 sql.exec("CREATE TRIGGER reject_migration BEFORE UPDATE ON progress BEGIN SELECT RAISE(ABORT,'TEST_MIGRATION_FAILURE'); END");
 const service=createPlayerProgress({identityStore:identity,questions});assert.throws(()=>service.ensure(id));
 assert.equal(identity.getPublicPlayer(id).progress.schema,3);assert.equal(identity.getPublicPlayer(id).revision,old.revision);
 sql.exec('DROP TRIGGER reject_migration');
 const contender=createPlayerProgress({identityStore:identity,questions}),update=identity.updatePlayerData.bind(identity);let race=true;
 identity.updatePlayerData=(playerId,mutation)=>{if(race){race=false;contender.ensure(playerId);}return update(playerId,mutation);};
 const migrated=service.ensure(id);identity.updatePlayerData=update;assert.equal(migrated.progress.schema,4);assert.equal(migrated.revision,old.revision+1);
 assert.deepEqual(service.ensure(id),migrated);
 for(const key of Object.keys(old).filter(key=>!['schema','revision'].includes(key)))assert.deepEqual(migrated.progress[key],old[key]);
 const registered=await identity.registerGuest({guestToken:guest.session.token,username:'RewardMigration',password:'123456'});
 assert.equal(registered.player.playerId,id);assert.deepEqual(registered.player.progress,migrated.progress);
});

test('actual HTTP wrong answers qualify 3/6 tasks once, fast answers can continue reading, and registration retains the journey',async t=>{
 const {server,clock}=await live(t),a=browser(server);await a.identity.bootstrap();const store=await a.progress(),id=store.playerId;
 const challenge=await issue(a,studySix[0].id),feedback=await answer(a,challenge);await store.applyLearning(feedback);
 clock.now+=3199;const early=await store.qualifyLearning(challenge.challengeId);assert.equal(early.ok,true);assert.equal(store.dirty,false);assert.equal(early.changed,false);
 assert.equal(store.data.journey.skinTickets,0);assert.equal(Object.keys(store.data.journey.days).length,0);
 clock.now++;await store.refresh();assert.equal((await store.qualifyLearning(challenge.challengeId)).ok,true);
 await learn(a,store,clock,studySix[1].id);assert.equal(store.data.journey.skinTickets,1);
 await learn(a,store,clock,studySix[2].id);assert.equal(store.data.collection.earned.dust,5);assert.equal(store.data.journey.skinTickets,2);assert.equal(store.data.journey.newcomerGranted,true);
 for(const question of studySix.slice(3))await learn(a,store,clock,question.id);
 assert.equal(store.data.journey.skinTickets,3);assert.equal(store.data.collection.totalDays,1);assert.equal(store.data.collection.earned.dust,5);
 assert.equal(dailySummary(store.data.journey,clock.now).allComplete,true);
 const before=store.data.journey;await store.qualifyLearning(challenge.challengeId);await learn(a,store,clock,studySix[0].id);
 assert.equal(store.data.journey.skinTickets,3);assert.equal(store.data.collection.earned.dust,5);assert.equal(store.data.collection.totalDays,1);
 assert.equal(Object.values(store.data.legacy.mastery).reduce((n,item)=>n+item.correct,0),0);
 const registered=await a.identity.register({username:'RewardReader',password:'123456'});assert.equal(registered.player.playerId,id);
 const reload=await a.progress();assert.equal(reload.data.journey.ownerId,id);assert.equal(reload.data.journey.newcomerGranted,true);assert.deepEqual(reload.data.journey,store.data.journey);
 assert(before.days['2026-10-08']);
 const intent=a.calls.find(call=>call.url==='/api/progress/participation').body;assert.deepEqual(Object.keys(intent).sort(),['challengeId','requestId']);
});

test('Shanghai midnight pins old card days and daily tasks to the same challenge-issued day',async t=>{
 const at=Date.UTC(2026,9,8,15,59,59),{server,clock}=await live(t,{at}),a=browser(server);await a.identity.bootstrap();const store=await a.progress();
 const pending=[];for(const question of studySix.slice(0,3))pending.push(await issue(a,question.id));
 clock.now+=100;for(const challenge of pending){const feedback=await answer(a,challenge);await store.applyLearning(feedback);}
 clock.now=at+3200;for(const challenge of pending)assert.equal((await store.qualifyLearning(challenge.challengeId)).ok,true);
 assert.equal(store.data.journey.days['2026-10-08'].qids.length,3);assert.equal(store.data.collection.days['2026-10-08'].qids.length,3);
 assert.equal(store.data.journey.days['2026-10-09'],undefined);assert.equal(store.data.collection.days['2026-10-09'],undefined);
 assert.equal(dailySummary(store.data.journey,clock.now).tasks[0].progress,0);
 for(const question of studySix.slice(0,3))await learn(a,store,clock,question.id);
 assert.equal(store.data.collection.earned.dust,10);assert.equal(store.data.journey.newcomerGranted,true);assert.equal(store.data.journey.skinTickets,3);
});

test('five original earned card days survive the new daily reward and an atomic official ten-skin opening',async t=>{
 const {server,clock}=await live(t),a=browser(server);await a.identity.bootstrap();const store=await a.progress();
 for(let day=0;day<5;day++){clock.now=initial+day*86400000;for(const question of studySix)await learn(a,store,clock,question.id);}
 assert.equal(store.data.collection.totalDays,5);assert.equal(rewardBalance(store.data.collection),1);assert.equal(store.data.journey.skinTickets,11);assert.equal(store.data.collection.earned.dust,25);
 const [first,second]=await Promise.all([store.openSkinPack('official',10),store.openSkinPack('official',10)]);assert.equal(first.ok,true);assert.equal(second.ok,true);
 const pack=first.data.journey.openings.official;assert.equal(pack.results.length,10);assert.deepEqual(pack,second.data.journey.openings.official);
 assert.equal(store.data.journey.skinTickets,1);assert.equal(rewardBalance(store.data.collection),1);assert.equal(store.data.collection.earned.dust,25+pack.results.reduce((n,result)=>n+result.dust,0));
 const reloaded=await a.progress();assert.deepEqual(reloaded.data.journey.openings.official,pack);
 assert.equal((await reloaded.closeSkinPack('official',pack.id)).ok,true);assert.deepEqual(reloaded.data.journey.openings.official,pack);
 assert.equal((await reloaded.revealSkinPack('official',pack.id,0)).ok,true);assert.equal(reloaded.data.journey.openings.official.revealed,1);
 await reloaded.revealSkinPack('official',pack.id,'all');await reloaded.closeSkinPack('official',pack.id);assert.equal(reloaded.data.journey.openings.official,null);
 const cardGift=await reloaded.openPack('earned');assert.equal(cardGift.ok,true);assert.equal(cardGift.data.collection.opening.cards.length,10);assert.equal(cardGift.data.collection.earnedPacksSpent,1);
});

test('skin HTTP whitelist, owner header and Origin reject forged balances/results; test redeem and skins stay isolated',async t=>{
 const {server}=await live(t),a=browser(server);await a.identity.bootstrap();const store=await a.progress(),before=store.data;
 for(const extra of [{count:2},{randomValues:[0]},{issuedAt:initial},{skinTickets:99},{owned:[HERO_SKINS[0].id]},{results:[]}]){
  const response=await a.post('/api/progress/skins',{requestId:'forged-skin-request',action:{kind:'open',mode:'test',count:1,...extra}});assert.equal(response.status,400);
 }
 assert.equal((await a.post('/api/progress/skins',{requestId:'wrong-player-request',action:{kind:'open',mode:'test',count:1}},'wrong-player-001')).status,409);
 const origin=await fetch(server.origin+'/api/progress/skins',{method:'POST',headers:{Cookie:a.cookie(),Origin:'https://foreign.invalid','Content-Type':'application/json','X-Spellwood-Player':store.playerId},body:JSON.stringify({requestId:'foreign-origin-request',action:{kind:'open',mode:'test',count:1}})});assert.equal(origin.status,403);
 assert.equal((await a.post('/api/progress/participation',{requestId:'forged-clock-request',challengeId:'missing-challenge',questionMs:9999,feedbackMs:9999})).status,400);
 assert.deepEqual(server.playerProgress.ensure(store.playerId).progress,before);
 assert.equal((await store.redeemSkin('test',HERO_SKINS[0].id)).ok,true);assert.equal((await store.equipSkin('test',HERO_SKINS[0].id)).ok,true);
 assert.equal(store.data.journey.equipped.mode,'test');assert.equal(store.data.journey.test.dust,0);assert.equal(store.data.journey.skinTickets,0);assert.deepEqual(store.data.journey.official,before.journey.official);assert.deepEqual(store.data.collection.earned,before.collection.earned);
 assert.equal((await store.equipSkin('base',DEFAULT_HERO_SKIN)).ok,true);
 const [x,y]=await Promise.all([store.openSkinPack('test',10),store.openSkinPack('test',10)]);assert.equal(x.ok,true);assert.equal(y.ok,true);assert.equal(a.calls.filter(c=>c.url==='/api/progress/skins'&&c.body.action.kind==='open'&&!c.body.action.randomValues).filter(c=>c.body.requestId!=='forged-skin-request'&&c.body.requestId!=='wrong-player-request').length,1);
 assert.equal(store.data.journey.skinTickets,0);assert.equal(store.data.collection.earned.dust,0);
});

test('unknown skin commit response keeps the same request ID/results through retry and export; stale account completion cannot write',async t=>{
 const {server}=await live(t),a=browser(server);await a.identity.bootstrap();const store=await a.progress();let lose=true;
 a.setHook((url,init)=>{if(url==='/api/progress/skins'&&lose){lose=false;throw Error('synthetic response loss after commit');}});
 const failed=await store.openSkinPack('test',10);assert.equal(failed.ok,false);assert.equal(failed.uncertain,true);assert.equal(store.dirty,true);assert.equal(store.data.journey.openings.test,null);
 const committed=server.playerProgress.ensure(store.playerId).progress.journey.openings.test;assert(committed);
 const [retried,clicked]=await Promise.all([store.retry(),store.openSkinPack('test',10)]);assert.equal(retried.ok,true);assert.equal(clicked.ok,true);assert.deepEqual(store.data.journey.openings.test,committed);
 const posts=a.calls.filter(c=>c.url==='/api/progress/skins');assert.equal(posts.length,2);assert.equal(posts[0].body.requestId,posts[1].body.requestId);
 const exported=await store.exportLatest();assert.equal(exported.ok,true);assert.deepEqual(JSON.parse(exported.json).journey,store.data.journey);
 let release,started;const barrier=new Promise(resolve=>started=resolve),hold=new Promise(resolve=>release=resolve);
 a.setHook(async(url)=>{if(url==='/api/progress/skins'){started();await hold;}});
 const pending=store.redeemSkin('test',HERO_SKINS[19].id);await barrier;
 const epoch=store.epoch;store.setPlayerId('new-owner-account');release();assert.equal((await pending).code,'STALE_REQUEST');assert.equal(store.epoch,epoch+1);assert.equal(store.data,null);assert.throws(()=>store.export(),{code:'NO_PROGRESS_TO_EXPORT'});
});

test('SQLite event insert faults roll back journey, shared dust, card day and receipt together; retry commits once',async t=>{
 const file=database(t),{server,clock}=await live(t,{file}),a=browser(server);await a.identity.bootstrap();const store=await a.progress();
 for(const question of studySix.slice(0,2))await learn(a,store,clock,question.id);
 const challenge=await issue(a,studySix[2].id),feedback=await answer(a,challenge);await store.applyLearning(feedback);clock.now+=3200;
 const sql=new DatabaseSync(file);t.after(()=>sql.close());const before=server.playerProgress.ensure(store.playerId);
 sql.exec("CREATE TRIGGER reject_reward BEFORE INSERT ON player_events WHEN NEW.type='participation' OR NEW.type='skin' BEGIN SELECT RAISE(ABORT,'TEST_REWARD_FAILURE'); END");
 assert.equal((await store.qualifyLearning(challenge.challengeId)).ok,false);assert.deepEqual(server.playerProgress.ensure(store.playerId),before);assert.equal(server.identityStore.hasPlayerEvent(store.playerId,`participation:${challenge.challengeId}`),false);
 sql.exec('DROP TRIGGER reject_reward');assert.equal((await store.retry()).ok,true);assert.equal(store.data.collection.earned.dust,5);assert.equal(store.data.journey.skinTickets,2);
 const prior=store.data;sql.exec("CREATE TRIGGER reject_skin BEFORE INSERT ON player_events WHEN NEW.type='skin' BEGIN SELECT RAISE(ABORT,'TEST_SKIN_FAILURE'); END");
 assert.equal((await store.openSkinPack('official',1)).ok,false);assert.deepEqual(server.playerProgress.ensure(store.playerId).progress,prior);
 sql.exec('DROP TRIGGER reject_skin');assert.equal((await store.retry()).ok,true);assert.equal(store.data.journey.skinTickets,1);assert.equal(store.data.journey.openings.official.results.length,1);
});

test('inactive-account import preserves old skins only in display/test ownership and resets all formal rights',async t=>{
 const {server}=await live(t),a=browser(server);await a.identity.bootstrap();const store=await a.progress(),source=model.fresh('unverified-source');
 source.journey.skinTickets=500;source.journey.newcomerGranted=true;source.journey.official.owned=[HERO_SKINS[0].id];source.journey.official.repeatStreak=4;source.journey.test.owned=[HERO_SKINS[1].id];source.journey.test.dust=900;
 source.journey.equipped={mode:'official',skinId:HERO_SKINS[0].id};source.collection.earned.dust=900;
 const prepared=store.prepareImport(source),result=await store.restore(prepared,prepared.revision);assert.equal(result.ok,true);
 assert.equal(store.data.journey.ownerId,store.playerId);assert.equal(store.data.journey.skinTickets,0);assert.equal(store.data.journey.newcomerGranted,false);assert.deepEqual(store.data.journey.official,{owned:[],repeatStreak:0});assert.equal(store.data.journey.test.repeatStreak,0);assert.equal(store.data.journey.test.dust,0);
 assert.deepEqual(new Set(store.data.journey.test.owned),new Set([HERO_SKINS[0].id,HERO_SKINS[1].id]));assert.deepEqual(store.data.journey.equipped,{mode:'test',skinId:HERO_SKINS[0].id});assert.equal(store.data.collection.earned.dust,0);
});

function result(id,participation,reason='health'){
 return {roomId:id,phase:'finished',youSeat:0,grade:1,course:'s1-u1',ruleset:'net-1.1',combatRules:'2.1',contentVersion:'pep1-2026.1',mode:'pve',assisted:true,self:{deckId:'grove'},serverTime:initial+60000,
  result:{winnerSeat:reason==='draw'?null:0,reason,ownScore:700,ownLearning:{attempts:0,correct:0},rounds:4,finishedAt:initial+60000},...(participation?{participation}:{})};
}
test('only trusted normal matches with enough own turns/actions qualify; result, rating and daily task commit exactly once',t=>{
 const identity=createIdentityStore();t.after(()=>identity.close());const id=identity.createGuest().player.playerId,service=createPlayerProgress({identityStore:identity,questions,now:()=>initial+60000}),bridge=createProgressBridge({progress:service,identityStore:identity});
 const minimum={startedAt:initial,ownTurns:2,ownActions:3};
 for(const [index,info,reason] of [[1,undefined,'health'],[2,{...minimum,ownTurns:1},'health'],[3,{...minimum,ownActions:2},'health'],[4,minimum,'surrender'],[5,minimum,'expired'],[6,minimum,'quit']]){
  bridge.result(id,result(`match-ineligible-${index}`,info,reason));assert.equal(service.ensure(id).progress.journey.skinTickets,0);
 }
 const valid=result('match-qualified-001',minimum,'draw');assert.equal(bridge.result(id,valid),true);const saved=service.ensure(id).progress;
 assert.equal(saved.journey.skinTickets,1);assert.equal(saved.journey.days['2026-10-08'].qualifiedMatch,true);assert.equal(saved.combatRating.games,0);assert.equal(saved.onlineRecords.length,7);
 assert.equal(bridge.result(id,valid),true);assert.deepEqual(service.ensure(id).progress,saved);
});

test('permanent skin/participation receipts survive bounded journey history and cleared challenge timing',t=>{
 const identity=createIdentityStore();t.after(()=>identity.close());let current=initial;const id=identity.createGuest().player.playerId,service=createPlayerProgress({identityStore:identity,questions,now:()=>current++,random:()=>0});
 const open=service.skins(id,{kind:'open',mode:'test',count:1},'permanent-open-001');
 service.skins(id,{kind:'reveal',mode:'test',batchId:'permanent-open-001',index:'all'},'permanent-reveal');service.skins(id,{kind:'close',mode:'test',batchId:'permanent-open-001'},'permanent-close');
 for(let i=0;i<70;i++)service.skins(id,{kind:'equip',mode:'base',skinId:DEFAULT_HERO_SKIN},`permanent-equip-${i}`);
 const before=service.ensure(id).progress;assert.equal(before.journey.operations.some(op=>op.id==='permanent-open-001'),false);
 const replay=service.skins(id,{kind:'open',mode:'test',count:1},'permanent-open-001');assert.equal(replay.duplicate,true);assert.deepEqual(replay.receipt,open.receipt);assert.deepEqual(replay.player.progress,before);
 assert.throws(()=>service.skins(id,{kind:'open',mode:'test',count:10},'permanent-open-001'),{code:'PLAYER_EVENT_CONFLICT'});
 const cid='permanent-learning';service.applyLearning(id,{challengeId:cid,learning:{qid:questions[0].id,correct:false,answeredAt:initial+100}});
 const first=service.participation(id,cid,{issuedAt:initial,answeredAt:initial+100,qualifiedAt:initial+3200,source:'study'});
 const freshBridge=createProgressBridge({progress:service,identityStore:identity});assert.deepEqual(freshBridge.participation(id,cid).receipt,first.receipt);
});


test('an actual SQLite/server restart restores pending ten-skin results, reveal mask and permanent HTTP retry',async t=>{
 const file=database(t),{server,clock}=await live(t,{file}),a=browser(server);await a.identity.bootstrap();const store=await a.progress();
 const opened=await store.openSkinPack('test',10);assert.equal(opened.ok,true);const batch=opened.data.journey.openings.test;
 assert.equal((await store.revealSkinPack('test',batch.id,3)).ok,true);const saved=store.data;
 const request=a.calls.find(call=>call.url==='/api/progress/skins'&&call.body.action.kind==='open').body;
 await server.close();clock.now+=86400000;
 const resumed=createGameServer({port:0,databasePath:file,identityOptions:{passwords}});await resumed.listen();t.after(()=>resumed.close());
 const b=browser(resumed,new Map(a.jar));assert.equal((await b.identity.bootstrap()).player.playerId,store.playerId);const restored=await b.progress();
 assert.deepEqual(restored.data,saved);assert.equal(restored.data.journey.openings.test.revealed,8);
 const replay=await b.post('/api/progress/skins',request);assert.equal(replay.status,200);const value=await replay.json();assert.deepEqual(value.data,saved);assert.deepEqual(value.receipt.reward.batch,batch);
});

test('different study books/grades do not share units, and match questions never fabricate study-unit progress',t=>{
 const metadata=[{id:'scoped-question-1',grade:1,semester:1,unitId:'shared-unit'},
  {id:'scoped-question-2',grade:2,semester:1,unitId:'shared-unit'},
  {id:'scoped-question-3',grade:1,semester:2,unitId:'shared-unit'},
  {id:'scoped-question-4',grade:1,semester:1,unitId:'shared-unit'}];
 const identity=createIdentityStore();t.after(()=>identity.close());const id=identity.createGuest().player.playerId,service=createPlayerProgress({identityStore:identity,questions:metadata});
 for(let index=0;index<metadata.length;index++){
  const challengeId=`scope-challenge-${index}`;service.applyLearning(id,{challengeId,learning:{qid:metadata[index].id,correct:false,answeredAt:initial+100}});
  service.participation(id,challengeId,{issuedAt:initial,answeredAt:initial+100,qualifiedAt:initial+3200,source:index===3?'match':'study'});
 }
 const state=service.ensure(id).progress;assert.equal(state.journey.skinTickets,1);assert.equal(state.collection.earned.dust,5);
 const day=state.journey.days['2026-10-08'];assert.equal(Object.keys(day.units).length,3);assert.equal(day.claimed.includes('daily_apply'),false);assert.equal(day.qids.length,4);
});

test('official targeted redemption and duplicate compensation share the old dust wallet atomically',t=>{
 const identity=createIdentityStore();t.after(()=>identity.close());const id=identity.createGuest().player.playerId;
 let current=initial;const service=createPlayerProgress({identityStore:identity,questions,now:()=>current++,random:()=>0});
 const player=service.ensure(id),seed=player.progress;seed.collection.earned.dust=120;seed.journey.skinTickets=2;seed.revision=player.revision+1;
 identity.updatePlayerData(id,{expectedRevision:player.revision,progress:seed});
 const first=service.skins(id,{kind:'redeem',mode:'official',skinId:HERO_SKINS[0].id},'official-redeem-001');assert.equal(first.player.progress.collection.earned.dust,20);assert.equal(first.player.progress.journey.skinTickets,2);
 const replay=service.skins(id,{kind:'redeem',mode:'official',skinId:HERO_SKINS[0].id},'official-redeem-001');assert.equal(replay.duplicate,true);assert.equal(replay.player.progress.collection.earned.dust,20);
 const opening=service.skins(id,{kind:'open',mode:'official',count:1},'official-duplicate-1');assert.equal(opening.player.progress.collection.earned.dust,40);assert.equal(opening.player.progress.journey.skinTickets,1);assert.equal(opening.receipt.reward.batch.results[0].duplicate,true);
 assert.throws(()=>service.skins(id,{kind:'redeem',mode:'official',skinId:HERO_SKINS[1].id},'official-too-poor'),{code:'INSUFFICIENT_OFFICIAL_DUST'});assert.deepEqual(service.ensure(id).progress,opening.player.progress);
});
