import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Independent audit: no author test fixtures/helpers are imported.
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
import {ProgressStore,PROGRESS_KEY} from '../src/network/progress.mjs';
import {CARDS,validateCustomDeck} from '../src/cards.mjs';
import {freshSave} from '../src/learning.mjs';
import {createMatch} from '../src/engine.mjs';
import {freshCollection,validateCollection,applyCollectionOperation,qualifyDay,rewardBalance,generatePack,equippedFinishes} from '../src/collection.mjs';
import {LearningAttention} from '../src/network/learning-attention.mjs';
import {StudyDesk} from '../src/network/study-desk.mjs';
const questions=Array.from({length:432},(_,i)=>({id:`audit-q-${i}`,grade:1,semester:1,unitId:'g1-s1-u1'}));
const qids=new Set(questions.map(x=>x.id));
const custom=CARDS.slice(0,20).map(x=>x.id);
const clone=x=>structuredClone(x);
const receipt=(id='receipt-0001',q=0,at=Date.now(),correct=false)=>({challengeId:id,learning:{qid:questions[q].id,answeredAt:at,correct}});
const pack=(id='opening-0001',mode='test',card=0,finish='leaf')=>({kind:'open-pack',id,mode,createdAt:Date.now(),cards:Array.from({length:10},()=>({cardId:CARDS[card].id,finish}))});
const snapshot=(id='battle-0001',changes={})=>({phase:'finished',roomId:id,youSeat:0,grade:1,course:'s1',ruleset:'net-1.0',combatRules:'3.1',contentVersion:'pep1-2026.1',mode:'pve',assisted:false,computer:{level:'easy'},self:{deckId:'grove'},serverTime:Date.now(),result:{winnerSeat:0,reason:'health',ownScore:50,ownLearning:{attempts:0,correct:0},rounds:12,finishedAt:Date.now()},...changes});
function io(){
 const values=new Map();let failures=0,serial=Promise.resolve();const writes=[];
 return {values,writes,fail(n=1){failures=n;},storage:{getItem:k=>values.get(k)??null,setItem(k,v){if(failures>0){failures--;throw Error('quota');}values.set(k,v);writes.push({key:k,value:v});}},locks:{request(name,options,fn){assert.equal(name,'spellwood.save.v3.transaction');assert.equal(options.mode,'exclusive');const run=serial.then(fn);serial=run.catch(()=>{});return run;}}};
}
async function stores(n=1,seed){const env=io();if(seed)env.values.set(PROGRESS_KEY,JSON.stringify(seed));const all=Array.from({length:n},()=>new ProgressStore({storage:env.storage,locks:env.locks,questions}));for(const s of all)assert.equal((await s.load()).ok,true);return {env,all,a:all[0],b:all[1]};}
function addDays(c,days=5){for(let d=0;d<days;d++){const at=Date.UTC(2026,0,1+d*2,12);for(let q=0;q<6;q++)assert.equal(qualifyDay(c,{qid:questions[q].id,answeredAt:at},{questionMs:2000,feedbackMs:1200,now:at+1200,timeZone:'UTC'}),true);}}
async function durableSeed(mutate){const {a}=await stores();const data=a.data;mutate(data);return data;}
async function finish(s){const id=s.data.collection.opening.id;assert.equal((await s.collectionAction({kind:'reveal-pack',id,index:'all'})).ok,true);assert.equal((await s.collectionAction({kind:'close-pack',id})).ok,true);}

test('24 basic cards build a valid deck without collection ownership',()=>{assert.equal(CARDS.length,24);assert.equal(validateCustomDeck(custom),true);assert.equal(validateCustomDeck(Array(20).fill(CARDS[0].id)),false);assert.equal(validateCustomDeck([...custom.slice(0,19),'__proto__']),false);});

test('pack generates exactly 10 cards; deterministic RNG boundaries and duplicate dust',()=>{
 const c=freshCollection(),cards=generatePack(()=>0);assert.equal(cards.length,10);assert.deepEqual(new Set(cards.map(x=>x.finish)),new Set(['leaf']));assert.equal(applyCollectionOperation(c,{...pack(),cards}),true);assert.equal(c.test.dust,9);assert.equal(c.test.cards[`${CARDS[0].id}:leaf`],10);assert.deepEqual(c.opening.cards.map(x=>x.duplicate),[false,...Array(9).fill(true)]);assert.deepEqual(c.earned,{cards:{},dust:0});assert.throws(()=>generatePack(()=>1));assert.deepEqual(validateCollection(c,qids),c);
});

test('six distinct questions qualify one day even if wrong; gaps never reset five-day reward',()=>{
 const c=freshCollection();addDays(c);assert.equal(c.totalDays,5);assert.equal(rewardBalance(c),1);assert.equal(Object.keys(c.days).length,5);const at=Date.UTC(2026,0,1,12);assert.equal(qualifyDay(c,{qid:questions[6].id,answeredAt:at},{questionMs:2000,feedbackMs:1200,now:at+1200}),false);assert.deepEqual(validateCollection(c,qids),c);
});

test('same question, short attention, expired receipt and wall-clock rollback earn nothing',()=>{
 const at=Date.UTC(2026,0,1,12),c=freshCollection(),r={qid:questions[0].id,answeredAt:at};
 for(const timing of [{questionMs:1999,feedbackMs:1200,now:at+2000},{questionMs:2000,feedbackMs:1199,now:at+2000},{questionMs:2000,feedbackMs:1200,now:at-1},{questionMs:2000,feedbackMs:1200,now:at+7200001}])assert.equal(qualifyDay(c,r,timing),false);
 assert.equal(qualifyDay(c,r,{questionMs:2000,feedbackMs:1200,now:at+2000}),true);assert.equal(qualifyDay(c,r,{questionMs:2000,feedbackMs:1200,now:at+3000}),false);assert.equal(c.totalDays,0);assert.equal(c.days['2026-01-01'].qids.length,1);
});

test('midnight participation belongs to answer day in profile timezone',()=>{
 const c=freshCollection(),at=Date.parse('2026-01-01T15:59:59Z');qualifyDay(c,{qid:questions[0].id,answeredAt:at},{questionMs:2000,feedbackMs:1200,now:at+3000,timeZone:'Asia/Shanghai'});assert.deepEqual(Object.keys(c.days),['2026-01-01']);
});

test('foreground attention excludes hidden time and needs a feedback phase',()=>{
 let now=0;const a=new LearningAttention({now:()=>now});a.begin('a');now=2000;a.visibility(false);now=52000;a.visibility(true);a.feedback('a');now=53200;assert.deepEqual(a.finish('a'),{questionMs:2000,feedbackMs:1200});assert.equal(a.finish('a'),null);a.begin('b');now+=10000;assert.equal(a.finish('b'),null);
});

test('store learning qualification requires saved receipt and does not change mastery',async()=>{
 const {a}=await stores();assert.equal((await a.qualifyLearning('unknown-id',{questionMs:2000,feedbackMs:1200})).ok,true);assert.deepEqual(a.data.collection.days,{});
 const event=receipt();assert.equal((await a.applyLearning(event)).ok,true);const before=clone(a.data.legacy.mastery);assert.equal((await a.qualifyLearning(event.challengeId,{questionMs:2000,feedbackMs:1200})).ok,true);assert.deepEqual(a.data.legacy.mastery,before);assert.equal(Object.values(a.data.collection.days)[0].qids.length,1);
});

test('earned pack and test pack use strictly separate wallets and balances',async()=>{
 const seed=await durableSeed(d=>addDays(d.collection));const {a}=await stores(1,seed);await a.collectionAction(pack('test-wallet-0001'));await finish(a);assert.equal(rewardBalance(a.data.collection),1);assert.deepEqual(a.data.collection.earned,{cards:{},dust:0});await a.collectionAction(pack('earn-wallet-0001','earned'));assert.equal(rewardBalance(a.data.collection),0);assert.equal(a.data.collection.earned.dust,9);assert.equal(a.data.collection.test.dust,9);await finish(a);await a.collectionAction(pack('earn-wallet-0002','earned'));assert.equal(a.data.collection.opening,null);assert.equal(a.data.collection.earnedPacksSpent,1);
});

test('two stores opening one earned pack cannot double-spend or grant both packs',async()=>{
 const seed=await durableSeed(d=>addDays(d.collection));const {a,b,env}=await stores(2,seed);const results=await Promise.all([a.collectionAction(pack('concur-pack-0001','earned',0)),b.collectionAction(pack('concur-pack-0002','earned',1))]);assert.equal(results.every(x=>x.ok),true);const saved=JSON.parse(env.values.get(PROGRESS_KEY));assert.equal(saved.collection.earnedPacksSpent,1);assert.equal(saved.collection.openingIds.length,1);assert.equal(Object.values(saved.collection.earned.cards).reduce((a,b)=>a+b,0),10);assert.equal(saved.collection.opening.id,'concur-pack-0001');
});

test('two stores redeeming distinct finishes cannot spend the same five dust twice',async()=>{
 const seed=await durableSeed(d=>{d.collection.earned.dust=5;});const {a,b,env}=await stores(2,seed);await Promise.all([a.collectionAction({kind:'redeem-finish',mode:'earned',cardId:CARDS[0].id,finish:'leaf'}),b.collectionAction({kind:'redeem-finish',mode:'earned',cardId:CARDS[1].id,finish:'leaf'})]);const c=JSON.parse(env.values.get(PROGRESS_KEY)).collection;assert.equal(c.earned.dust,0);assert.equal(Object.keys(c.earned.cards).length,1);
});

test('repeated redemption and old opening id never grant or charge twice',async()=>{
 const {a}=await stores();const op=pack();await a.collectionAction(op);await finish(a);const before=a.data.collection;await a.collectionAction(op);assert.deepEqual(a.data.collection,before);const action={kind:'redeem-finish',mode:'test',cardId:CARDS[1].id,finish:'leaf'};await a.collectionAction(action);const once=a.data.collection;assert.equal(once.test.dust,4);await a.collectionAction(action);assert.deepEqual(a.data.collection,once);
});

test('opening result is durable before success; refresh preserves reveal mask; premature close does nothing',async()=>{
 const {a,env}=await stores();const r=await a.collectionAction(pack());assert.equal(r.ok,true);assert.deepEqual(r.data.collection,JSON.parse(env.values.get(PROGRESS_KEY)).collection);const before=env.values.get(PROGRESS_KEY);const rejected=await a.collectionAction({kind:'close-pack',id:pack().id});assert.equal(rejected.ok,false);assert.equal(env.values.get(PROGRESS_KEY),before);await a.collectionAction({kind:'reveal-pack',id:pack().id,index:3});const b=new ProgressStore({storage:env.storage,locks:env.locks,questions});await b.load();assert.equal(b.data.collection.opening.revealed,8);assert.deepEqual(b.data.collection.opening.cards,a.data.collection.opening.cards);await finish(b);await a.retry();assert.equal(a.data.collection.recent.length,1);assert.equal(a.data.collection.opening,null);
});

test('write failure preserves identical generated result for retry and charges only once',async()=>{
 const {a,env}=await stores();const original=env.values.get(PROGRESS_KEY);env.fail();const failed=await a.openPack('test');assert.equal(failed.ok,false);assert.equal(failed.code,'WRITE_FAILED');assert.equal(env.values.get(PROGRESS_KEY),original);const projected=a.data.collection.opening;assert.equal(a.dirty,true);const saved=await a.retry();assert.equal(saved.ok,true);assert.deepEqual(saved.data.collection.opening,projected);assert.equal(saved.data.collection.openingIds.length,1);assert.equal(Object.values(saved.data.collection.test.cards).reduce((a,b)=>a+b,0),10);
});

test('failed local pack loses safely to another durable pack without reroll or duplicate grant',async()=>{
 const {a,b,env}=await stores(2);env.fail();assert.equal((await a.collectionAction(pack('race-failed-0001'))).ok,false);await b.collectionAction(pack('race-winner-0002','test',1));const retry=await a.retry();assert.equal(retry.ok,true);assert.equal(a.data.collection.opening.id,'race-winner-0002');assert.deepEqual(a.data.collection.openingIds,['race-winner-0002']);assert.equal(Object.values(a.data.collection.test.cards).reduce((a,b)=>a+b,0),10);
});

test('two stores deduplicate the same natural result and learning receipt',async()=>{
 const {a,b,env}=await stores(2);const s=snapshot(),r=receipt();await Promise.all([a.addResult(s),b.addResult(s),a.applyLearning(r),b.applyLearning(r)]);const d=JSON.parse(env.values.get(PROGRESS_KEY));assert.equal(d.combatRating.games,1);assert.equal(d.onlineRecords.length,1);assert.equal(d.resultIds.length,1);assert.equal(d.legacy.mastery[r.learning.qid].seen,1);
});

test('rating ignores English accuracy and skips pvp, proxy, quit and inconsistent draws',async()=>{
 const {a}=await stores(),{a:b}=await stores();const low=snapshot('rating-low-0001'),high=snapshot('rating-high-0001');high.result.ownLearning={attempts:100,correct:100};await a.addResult(low);await b.addResult(high);assert.equal(a.data.combatRating.rating,b.data.combatRating.rating);assert.equal(a.data.combatRating.games,1);const cases=[{mode:'pvp',computer:undefined},{assisted:true},{result:{...low.result,reason:'resign'}},{result:{...low.result,reason:'draw',winnerSeat:0}}];for(let i=0;i<cases.length;i++)await a.addResult(snapshot(`excluded-${i}-0001`,cases[i]));assert.equal(a.data.combatRating.games,1);
});

test('result id remains deduplicated after visible 200-row history is pruned',async()=>{
 const {a}=await stores();const first=snapshot('historic-result-0000');await a.addResult(first);for(let i=1;i<=201;i++)await a.addResult(snapshot(`historic-result-${String(i).padStart(4,'0')}`));const before=a.data.combatRating;assert.equal(a.data.onlineRecords.length,200);assert.equal(a.data.onlineRecords.some(x=>x.id===first.roomId),false);await a.addResult(first);assert.deepEqual(a.data.combatRating,before);assert.equal(a.data.resultIds.length,202);
});

test('custom deck survives reload/export and never writes custom into legacy deck id',async()=>{
 const {a,env}=await stores();await a.updatePreferences({deckId:'custom',customDeck:custom,combatMode:'standard'});assert.equal(a.data.legacy.deckId,'grove');assert.equal(a.data.chosenDeckId,'custom');const b=new ProgressStore({storage:env.storage,locks:env.locks,questions});await b.load();assert.deepEqual(b.data.customDeck,custom);const exp=await b.exportLatest();assert.deepEqual(JSON.parse(exp.json).customDeck,custom);assert.equal(JSON.parse(b.exportLegacy()).deckId,'grove');
});

test('old v3 missing new fields migrates without losing learning, records or offline shield',async()=>{
 const seed=await durableSeed(()=>{}),legacy=freshSave(),at=Date.now()-86400000;
 legacy.mastery[questions[0].id]={seen:7,correct:4,streak:1,due:at+86400000,last:at};legacy.records=[{id:'legacy-result-01',nickname:'Leaf',grade:1,seed:'AUDIT',deckId:'grove',opponentId:'moss',rules:'2.2',contentVersion:'pep1-2026.1',course:'s1',score:55,attempts:4,correct:3,turns:9,result:'win',date:at}];legacy.match=createMatch();legacy.match.seq=1;legacy.match.players[0].board=[{uid:'u1',cardId:CARDS.find(x=>x.type!=='spell').id,atk:1,hp:1,maxHp:1,ready:false,shield:true}];seed.legacy=legacy;for(const k of ['combatRating','combatMode','chosenDeckId','customDeck','collection'])delete seed[k];const {a}=await stores(1,seed);assert.deepEqual(a.data.legacy,legacy);assert.equal(a.data.collection.totalDays,0);assert.equal(a.data.combatRating.games,0);assert.equal(a.data.legacy.match.players[0].board[0].shield,true);
});

test('complete backup and restore retain collection/rating/deck/receipts and prior recovery copy',async()=>{
 const {a}=await stores();await a.applyLearning(receipt());await a.qualifyLearning('receipt-0001',{questionMs:2000,feedbackMs:1200});await a.updatePreferences({deckId:'custom',customDeck:custom});await a.addResult(snapshot());await a.collectionAction(pack());await a.collectionAction({kind:'reveal-pack',id:pack().id,index:5});await a.collectionAction({kind:'equip-finish',mode:'test',cardId:CARDS[0].id,finish:'leaf'});const exported=await a.exportLatest();assert.equal(exported.ok,true);const {a:b}=await stores();const before=b.export(),p=b.prepareImport(exported.json);assert.equal((await b.restore(p,p.revision)).ok,true);const x=a.data,y=b.data;for(const k of ['collection','combatRating','customDeck','chosenDeckId','learningReceipts','learningBase','resultIds','onlineRecords','legacy'])assert.deepEqual(y[k],x[k],k);assert.deepEqual(JSON.parse(b.recoveryRaw),JSON.parse(before));
});

test('collection rejects malformed money, cards, dates, reveal masks and prototype keys',async()=>{
 const base=freshCollection();const invalid=[c=>c.test.dust=-1,c=>c.test.cards.constructor=1,c=>c.test.cards[`${CARDS[0].id}:__proto__`]=1,c=>c.days['2026-02-31']={qids:[],complete:false},c=>c.days['2026-01-01']={qids:['unknown'],complete:false},c=>c.equipped.__proto__={mode:'test',finish:'leaf'},c=>{applyCollectionOperation(c,pack());c.opening.revealed=1024;},c=>{applyCollectionOperation(c,pack());c.opening.cards.pop();}];
 // A JSON own-property probe is required: object-literal __proto__ is not an own key.
 for(const mutate of invalid.filter((_,i)=>i!==5)){const c=clone(base);mutate(c);assert.throws(()=>validateCollection(c,qids));}const proto=JSON.parse(JSON.stringify(base));Object.defineProperty(proto.test.cards,'__proto__',{value:1,enumerable:true});assert.throws(()=>validateCollection(proto,qids));assert.equal({}.polluted,undefined);
});

test('test-mode switch-off keeps earned wallet and hides test cosmetics without conversion',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'spellwood-audit-'));try{const raw=await readFile(`${root}/src/collection.mjs`,'utf8');const rewritten=raw.replace("from './cards.mjs'",`from '${pathToFileURL(`${root}/src/cards.mjs`).href}'`).replace('COLLECTION_TEST_MODE = true','COLLECTION_TEST_MODE = false');assert.notEqual(raw,rewritten);await writeFile(join(dir,'collection.mjs'),rewritten);const live=await import(pathToFileURL(join(dir,'collection.mjs')).href);const c=freshCollection();applyCollectionOperation(c,pack());applyCollectionOperation(c,{kind:'equip-finish',mode:'test',cardId:CARDS[0].id,finish:'leaf'});const normalized=live.validateCollection(c,qids);assert.deepEqual(normalized.earned,{cards:{},dust:0});assert.equal(live.rewardBalance(normalized),0);assert.deepEqual(live.equippedFinishes(normalized),{});assert.throws(()=>live.applyCollectionOperation(freshCollection(),pack('disabled-0001')));assert.deepEqual(normalized.test,c.test);}finally{await rm(dir,{recursive:true,force:true});}
});

test('REGRESSION: stale custom-deck business conflict must not poison later saves',async()=>{
 const {a,b,env}=await stores(2);assert.equal((await a.updatePreferences({deckId:'custom',customDeck:custom})).ok,true);const stale=await b.updatePreferences({customDeck:null});assert.equal(stale.ok,false);const later=await b.updatePreferences({sound:false});assert.equal(later.ok,true,'A rejected stale deck operation remains queued and blocks unrelated preferences');assert.equal((await b.retry()).ok,true);const saved=JSON.parse(env.values.get(PROGRESS_KEY));assert.equal(saved.legacy.sound,false);assert.equal(saved.chosenDeckId,'custom');assert.deepEqual(saved.customDeck,custom);
});

test('REGRESSION: explicitly corrupt rating must fail archive validation instead of silently reset',async()=>{
 const {a,env}=await stores();const data=a.data;data.combatRating={version:1,rating:'bad',games:9,wins:9,losses:0,draws:0,lossStreak:0,lastResultId:'room-0009'};assert.throws(()=>a.prepareImport(data),'Invalid present rating is silently reset while import is reported valid');env.values.set(PROGRESS_KEY,JSON.stringify(data));const b=new ProgressStore({storage:env.storage,locks:env.locks,questions});const result=await b.load();assert.equal(result.ok,false);assert.equal(result.code,'CORRUPT_SAVE');
});

test('REGRESSION: active opening cannot also occur in recent history',()=>{
 const c=freshCollection();applyCollectionOperation(c,pack());applyCollectionOperation(c,{kind:'reveal-pack',id:pack().id,index:'all'});c.recent.push(clone(c.opening));assert.throws(()=>validateCollection(c,qids),'Accepted archive becomes corrupt after one ordinary close-pack');
});

test('business conflict plus write failure preserves valid learning and discards rejected preferences atomically',async()=>{
 const {a,b,env}=await stores(2);env.fail();assert.equal((await b.updatePreferences({customDeck:null,sound:false})).code,'WRITE_FAILED');await a.updatePreferences({deckId:'custom',customDeck:custom});env.fail();const r=receipt('mixed-write-0001');assert.equal((await b.applyLearning(r)).code,'WRITE_FAILED');assert.equal((await b.retry()).ok,true);const d=JSON.parse(env.values.get(PROGRESS_KEY));assert.equal(d.chosenDeckId,'custom');assert.deepEqual(d.customDeck,custom);assert.equal(d.legacy.sound,true,'Rejected preferences must not partially set sound');assert.equal(d.legacy.mastery[r.learning.qid].seen,1);assert.equal(b.dirty,false);
});

test('two pages contributing six distinct wrong answers create exactly one completed reward day',async()=>{
 const {a,b,env}=await stores(2),at=Date.now();const rows=Array.from({length:6},(_,i)=>receipt(`parallel-learn-${i}`,i,at,false));await Promise.all(rows.map((r,i)=>(i%2?a:b).applyLearning(r)));await Promise.all(rows.map((r,i)=>(i%2?a:b).qualifyLearning(r.challengeId,{questionMs:2000,feedbackMs:1200})));await Promise.all(rows.map((r,i)=>(i%2?b:a).qualifyLearning(r.challengeId,{questionMs:2000,feedbackMs:1200})));const d=JSON.parse(env.values.get(PROGRESS_KEY));assert.equal(d.collection.totalDays,1);assert.equal(Object.values(d.collection.days)[0].qids.length,6);assert.equal(Object.values(d.legacy.mastery).reduce((sum,m)=>sum+m.correct,0),0);assert.equal(Object.values(d.legacy.mastery).reduce((sum,m)=>sum+m.seen,0),6);
});

test('concurrent reveal bits merge rather than overwriting another tab',async()=>{
 const {a,b,env}=await stores(2);await a.collectionAction(pack());await b.retry();await Promise.all([a.collectionAction({kind:'reveal-pack',id:pack().id,index:2}),b.collectionAction({kind:'reveal-pack',id:pack().id,index:7})]);assert.equal(JSON.parse(env.values.get(PROGRESS_KEY)).collection.opening.revealed,(1<<2)|(1<<7));
});

test('backup prepared before another write cannot overwrite newer archive',async()=>{
 const {a,b,env}=await stores(2);const prepared=a.prepareImport(a.export());await b.collectionAction(pack());const saved=env.values.get(PROGRESS_KEY);const r=await a.restore(prepared,prepared.revision);assert.equal(r.ok,false);assert.equal(r.code,'STALE_REVISION');assert.equal(env.values.get(PROGRESS_KEY),saved);
});

test('restore write failure leaves original primary archive and can retry same prepared backup',async()=>{
 const {a,env}=await stores();await a.collectionAction(pack());const source=a.export();await finish(a);const original=env.values.get(PROGRESS_KEY),p=a.prepareImport(source);env.fail();const failure=await a.restore(p,p.revision);assert.equal(failure.code,'RESTORE_WRITE_FAILED');assert.equal(env.values.get(PROGRESS_KEY),original);assert.equal((await a.restore(p,p.revision)).ok,true);assert.equal(a.data.collection.opening.id,pack().id);
});

test('pending operation from old profile cannot be mixed into a restored profile',async()=>{
 const {a,b,env}=await stores(2);const p=a.prepareImport(a.export());env.fail();const failed=await b.collectionAction(pack());assert.equal(failed.code,'WRITE_FAILED');assert.equal((await a.restore(p,p.revision)).ok,true);const clean=env.values.get(PROGRESS_KEY);const r=await b.retry();assert.equal(r.ok,false);assert.equal(r.code,'PROFILE_CHANGED');assert.equal(env.values.get(PROGRESS_KEY),clean);assert.equal(b.data.collection.opening.id,pack().id,'Unsaved old result remains available in emergency export');
});

test('StudyDesk flow credits a wrong answer only after both foreground thresholds',async()=>{
 const env=io();let now=0;const cid='study-desk-0001';const desk=new StudyDesk({storage:env.storage,locks:env.locks,getPreferences:()=>({grade:1,course:'s1'}),fetcher:async(url,options)=>({ok:true,json:async()=>url==='/api/curriculum'?{questions}:options?.method==='POST'?receipt(cid,0,Date.now(),false):{challengeId:cid,question:{options:[{id:'choice-a',text:'A'}]}}})});await desk.initialize();desk.attention=new LearningAttention({now:()=>now});desk.open('study');await desk.store.retry();await desk.study(questions[0].id);now=2000;await desk.answerStudy('choice-a');await desk.flush();now=3200;await desk.finishAttention(cid);assert.equal(Object.values(desk.data.collection.days)[0].qids.length,1);assert.equal(desk.data.legacy.mastery[questions[0].id].seen,1);assert.equal(desk.data.legacy.mastery[questions[0].id].correct,0);
});

test('StudyDesk hidden feedback time does not qualify a reward',async()=>{
 const {a}=await stores();let now=0;const desk=new StudyDesk();desk.store=a;desk.data=a.data;desk.status='ready';desk.attention=new LearningAttention({now:()=>now});const r=receipt('study-hidden-0001');desk.beginAttention(r.challengeId);now=2000;desk.receiveFeedback(r,'study');await desk.flush();desk.visibility(false);now=52000;desk.visibility(true);now=52999;await desk.finishAttention(r.challengeId);assert.deepEqual(a.data.collection.days,{});assert.equal(a.data.legacy.mastery[r.learning.qid].seen,1);
});

test('REGRESSION: retained opening results cannot claim more cards than their own wallet contains',()=>{
 const c=freshCollection();applyCollectionOperation(c,pack());c.test.cards={};assert.throws(()=>validateCollection(c,qids),'Visible received cards would disappear from collection and fail equip');
 const combined=freshCollection();applyCollectionOperation(combined,pack('history-card-0001'));applyCollectionOperation(combined,{kind:'reveal-pack',id:'history-card-0001',index:'all'});applyCollectionOperation(combined,{kind:'close-pack',id:'history-card-0001'});applyCollectionOperation(combined,pack('history-card-0002'));combined.test.cards[`${CARDS[0].id}:leaf`]=10;assert.throws(()=>validateCollection(combined,qids),'Per-pack checks alone miss contradictory combined retained results');
});

test('earned opening count cannot exceed the saved earned packs spent',()=>{
 const c=freshCollection();addDays(c);applyCollectionOperation(c,pack('earned-spent-0001','earned'));c.earnedPacksSpent=0;assert.throws(()=>validateCollection(c,qids));
});

test('restore primary-write failure after recovery backup is safe and retryable',async()=>{
 const {a,env}=await stores();const original=env.values.get(PROGRESS_KEY);const imported=a.data;applyCollectionOperation(imported.collection,pack());const p=a.prepareImport(imported);const baseSet=env.storage.setItem;let once=true;env.storage.setItem=(key,value)=>{if(key===PROGRESS_KEY&&once){once=false;throw Error('primary-full');}return baseSet(key,value);};assert.equal((await a.restore(p,p.revision)).code,'RESTORE_WRITE_FAILED');assert.equal(env.values.get(PROGRESS_KEY),original);assert.equal([...env.values.keys()].filter(k=>k.includes('.recovery.')).length,1);assert.equal((await a.restore(p,p.revision)).ok,true);assert.equal(a.data.collection.opening.id,pack().id);assert.deepEqual(JSON.parse(a.recoveryRaw),JSON.parse(original));
});

test('multi-page repeated opening/reveal/close with intermittent quota failures preserves totals',async()=>{
 const {all,env}=await stores(4);for(let round=0;round<24;round++){
  await Promise.all(all.map(s=>s.retry()));if(round%3===0)env.fail();await Promise.all(all.map((s,i)=>s.collectionAction(pack(`stress-${round}-${i}-0001`))));await Promise.all(all.map(s=>s.retry()));const current=JSON.parse(env.values.get(PROGRESS_KEY)).collection.opening;assert.ok(current);
  await Promise.all(Array.from({length:10},(_,i)=>all[i%4].collectionAction({kind:'reveal-pack',id:current.id,index:i})));await Promise.all(all.map(s=>s.retry()));if(round%4===0)env.fail();await Promise.all(all.map(s=>s.collectionAction({kind:'close-pack',id:current.id})));await Promise.all(all.map(s=>s.retry()));
  const c=JSON.parse(env.values.get(PROGRESS_KEY)).collection;assert.equal(c.opening,null);assert.equal(c.openingIds.length,round+1);assert.equal(c.test.cards[`${CARDS[0].id}:leaf`],(round+1)*10);assert.equal(c.test.dust,(round+1)*10-1);assert.deepEqual(validateCollection(c,qids),c);assert.deepEqual(c.earned,{cards:{},dust:0});
 }
});
