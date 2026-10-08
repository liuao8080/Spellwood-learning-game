import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, DECKS, RULES, CONTENT_VERSION, validateCustomDeck } from '../src/cards.mjs';
import { freshJourney, applyQualifiedLearning, openSkinPack } from '../src/reward-journey.mjs';
import { HERO_SKINS, DEFAULT_HERO_SKIN } from '../src/hero-skins.mjs';
import { rewardView, savedDailySummary } from '../src/network/reward-view.mjs';
import { WardrobeView, skinStatus, skinRulesHTML, revealedCount } from '../src/network/wardrobe-view.mjs';
import { CardLibrary, artThumb, replaceDeckCard } from '../src/network/card-library.mjs';
import { cardTargetAllowed, selectedCardOption, selectedTargetIds, answerCommand, drawFeedbackText } from '../src/network/battle-options.mjs';
import { ProgressStore, PROGRESS_KEY } from '../src/network/progress.mjs';
import { StudyDesk } from '../src/network/study-desk.mjs';
import { DuelConnection } from '../src/network/client.mjs';
const now=Date.parse('2026-10-08T05:00:00Z');
function data(){return {journey:freshJourney({ownerId:'p-ui'}),collection:{earned:{dust:0}}};}

test('daily view shows saved three tasks, both apply routes, and no client claims',()=>{
 const d=data(),before=structuredClone(d);const html=rewardView({data:d,ready:true,now});
 assert.equal((html.match(/class="daily-task /g)||[]).length,3);assert.match(html,/data-action="daily-unit"/);assert.match(html,/data-action="match-setup"/);assert.match(html,/3\.2秒/);assert.match(html,/1\.2秒/);assert.match(html,/答错/);assert.deepEqual(d,before);
 assert.match(rewardView({data:d,ready:false,now}),/先确认/);assert.equal(savedDailySummary(d,null),null);
});
test('saved wrong-answer participation updates task and newcomer status without extra claim action',()=>{
 const d=data();for(let i=0;i<3;i++)d.journey=applyQualifiedLearning(d.journey,{ownerId:'p-ui',eventId:`e${i}`,qid:`q${i}`,unitId:'u1',source:'study',issuedAt:now,answeredAt:now+10,qualifiedAt:now+3300}).state;
 const s=savedDailySummary(d,now+3400);assert.equal(s.tasks[0].complete,true);assert.equal(s.tasks[2].complete,true);assert.equal(s.skinTickets,2);assert.equal(s.newcomerGranted,true);assert.match(rewardView({data:d,ready:true,now}),/已收好/);
});
test('new day display resets only the summary, never the saved wallet',()=>{
 const d=data();d.journey.skinTickets=4;const before=structuredClone(d);assert.equal(savedDailySummary(d,Date.parse('2026-10-08T16:00:00Z')).rewardDay,'2026-10-09');assert.deepEqual(d,before);
});
test('all expanded cards use actual art metadata and base count',()=>{
 assert.equal(CARDS.length,36);assert.match(artThumb('mushroom_medic'),/assets\/cards-v4\/mushroom_medic.webp/);
 const lib=new CardLibrary({preferences:()=>({deckId:'grove'})});lib.open();assert.match(lib.html(),/36张基础战斗卡全部免费/);assert.match(lib.html(),/一键使用/);
});
test('two-click swap always preserves 20 cards, rejects a fourth copy, and save waits for persistence',async()=>{
 let release,closed=0;const saved=[];const lib=new CardLibrary({preferences:()=>({deckId:'grove'}),onSave:ids=>{saved.push(ids);return new Promise(r=>release=r);},onClose:()=>closed++});lib.open();
 await lib.click('library-slot','0');await lib.click('library-card','mushroom_medic');assert.equal(lib.draft[0],'mushroom_medic');assert.ok(validateCustomDeck(lib.draft));
 const original=[...lib.draft];const save=lib.click('library-save');await lib.click('library-slot','1');assert.equal(lib.replaceIndex,null);assert.deepEqual(saved[0],original);assert.equal(closed,0);release(true);await save;assert.equal(closed,1);
 const deck=[...DECKS[0].ids];const id=deck[0];while(deck.filter(x=>x===id).length<3)deck[deck.findIndex(x=>x!==id)]=id;assert.equal(replaceDeckCard(deck,deck.findIndex(x=>x!==id),id),null);
});
test('wardrobe ownership and source stay separate and catalog rules are exact',()=>{
 const j=data().journey;j.test.owned.push(HERO_SKINS[0].id);assert.equal(skinStatus(j,HERO_SKINS[0].id,'official').owned,false);assert.equal(skinStatus(j,HERO_SKINS[0].id,'test').owned,true);assert.equal(skinStatus(j,DEFAULT_HERO_SKIN).equipped,true);
 const rules=skinRulesHTML();for(const text of ['20款','5%','20叶屑','100正式叶屑','连续4次重复','没有折扣','兑换不清除'])assert.ok(rules.includes(text),text);
});
function wardrobeHarness(){const d=data(),store={loaded:true,data:d,skinAction:null};const calls=[];const v=Object.create(WardrobeView.prototype);Object.assign(v,{store:()=>store,opened:true,epoch:0,busy:false,mode:'test',view:'wardrobe',index:0,onNotice:t=>calls.push(['notice',t]),onSound:t=>calls.push(['sound',t]),render:options=>calls.push(['render',options]),muted:false});return {v,store,calls};}
test('skin reveal cannot animate before durable success and repeated clicks coalesce',async()=>{
 const {v,store,calls}=wardrobeHarness();let resolve,count=0;store.skinAction=()=>{count++;return new Promise(r=>resolve=r);};const task=v.mutate({kind:'reveal',mode:'test',batchId:'b1',index:0},{reveal:true});await v.mutate({kind:'reveal'});assert.equal(count,1);assert.equal(calls.some(c=>c[0]==='sound'||c[1]?.reveal),false);resolve({ok:true});await task;assert.equal(calls.filter(c=>c[0]==='sound').length,1);assert.equal(v.busy,false);
});
test('failed or old-account skin saves never reveal a result',async()=>{
 for(const stale of [false,true]){const {v,store,calls}=wardrobeHarness();let resolve;store.skinAction=()=>new Promise(r=>resolve=r);const task=v.mutate({kind:'open',mode:'test',count:10},{reveal:true,nextView:'opening'});if(stale)v.epoch++;resolve({ok:stale});await task;assert.equal(v.view,'wardrobe');assert.equal(calls.some(c=>c[0]==='sound'||c[1]?.reveal),false);}
});
test('resume uses persisted opening and skip only sends reveal-all for same batch',async()=>{
 const {v,store}=wardrobeHarness();store.data.journey=openSkinPack(store.data.journey,{ownerId:'p-ui',operationId:'same-batch',issuedAt:now,mode:'test',count:10},{randomValues:Array(10).fill(.01)}).state;
 const batch=store.data.journey.openings.test,actions=[];store.skinAction=async a=>{actions.push(a);return {ok:true};};await v.click('resume');assert.equal(v.view,'opening');assert.equal(revealedCount(batch),0);await v.click('all');assert.deepEqual(actions,[{kind:'reveal',mode:'test',batchId:'same-batch',index:'all'}]);await v.click('later');assert.equal(store.data.journey.openings.test.id,'same-batch');assert.equal(actions.length,1);
});
test('new targets and discounts depend on authoritative instance entries',()=>{
 const room={youSeat:0,self:{hand:['mushroom_medic','mushroom_medic'],handIds:['opaque-a','opaque-b'],handCosts:[1,2],legalCardTargets:[{handId:'opaque-a',index:0,targets:[{target:'friend',seat:0}],untargeted:false}]}};
 assert.equal(selectedCardOption(room,0).cost,1);assert.equal(selectedCardOption(room,1).cost,2);assert.equal(cardTargetAllowed(room,0,'friend',0),true);assert.equal(cardTargetAllowed(room,0,'friend',1),false);assert.equal(cardTargetAllowed(room,1,'friend',0),false);assert.deepEqual(selectedTargetIds(room,0),['friend']);room.self.handIds[0]='replacement';assert.equal(selectedCardOption(room,0).legal,null);
 assert.equal(answerCommand({purpose:'draw'}),'draw.answer');assert.equal(answerCommand({purpose:'ritual'}),'ritual.answer');assert.match(drawFeedbackText('wrong'),/原牌保留，费用不变/);assert.doesNotMatch(drawFeedbackText('wrong'),/护甲/);
});
test('transport explicitly rejects advertised old protocol or wrong rules and accepts new versions',()=>{
 const statuses=[],messages=[];const c=new DuelConnection({url:'ws://example',storage:null,onConnection:x=>statuses.push(x),onMessage:x=>messages.push(x)});c.receive({type:'session.ready',protocol:1,ruleset:'net-2.2'});assert.equal(c.state,'incompatible');assert.equal(messages.at(-1).code,'VERSION_MISMATCH');c.receive({type:'session.ready',protocol:2,ruleset:'net-2.3',combatRules:RULES,contentVersion:CONTENT_VERSION,nextClientSeq:1});assert.equal(c.state,'ready');
});


test('foreground feedback qualifies once after cumulative time, including an immediate wrong answer',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let time=0,calls=0;const desk=new StudyDesk();desk.attention.now=()=>time;desk.status='ready';desk.data=data();desk.store={qualifyLearning:async(_id,timing)=>{calls++;assert.equal(timing.questionMs,0);assert.ok(timing.feedbackMs>=3200);return {ok:true,data:desk.data};}};desk.flush=async()=>{};desk.view='study';desk.question={challengeId:'wrong'};desk.answer={outcome:'wrong'};
 desk.beginAttention('wrong');desk.attention.feedback('wrong');desk.watchAttention('wrong');time=3200;t.mock.timers.tick(200);assert.equal(calls,0);time=3300;t.mock.timers.tick(200);await Promise.resolve();await Promise.resolve();assert.equal(calls,1);assert.match(desk.attentionHint('wrong'),/参与已保存/);await desk.finishAttention('wrong');assert.equal(calls,1);desk.dispose();
});
test('hidden time and leaving feedback early never create background participation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let time=0,calls=0;const desk=new StudyDesk();desk.attention.now=()=>time;desk.status='ready';desk.store={qualifyLearning:async()=>{calls++;return {ok:true};}};desk.flush=async()=>{};desk.view='study';desk.question={challengeId:'early'};desk.answer={outcome:'wrong'};desk.beginAttention('early');desk.attention.feedback('early');desk.watchAttention('early');time=100;desk.visibility(false);time=8000;t.mock.timers.tick(1000);assert.equal(calls,0);desk.visibility(true);time=8100;desk.close();await Promise.resolve();t.mock.timers.tick(20000);assert.equal(calls,0);assert.equal(desk.attentionTimers.size,0);desk.dispose();
});

test('wardrobe render owns one preview, lists every portrait, and conceals unopened models',t=>{
 const previous=globalThis.document;globalThis.document={activeElement:null,querySelector:()=>null};t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
 const nodes=new Map();let shelled=false,previews=0;const shown=[];
 const node=()=>({innerHTML:'',textContent:'',hidden:false,disabled:false,classList:{toggle(){},remove(){}},setAttribute(){},focus(){},querySelectorAll:()=>[]});
 const root={hidden:true,classList:{toggle(){},remove(){}},addEventListener(){},contains:()=>false,querySelectorAll:()=>[],replaceChildren(){shelled=false;nodes.clear();},querySelector(key){if(key==='.wardrobe-panel'&&!shelled)return null;if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);},set innerHTML(value){this.shellHTML=value;shelled=true;}};
 const d=data(),store={loaded:true,data:d};const view=new WardrobeView({root,store:()=>store,preferences:()=>({reduced:true}),onClose(){},onDaily(){},onNotice(){},previewFactory:()=>{previews++;return {setReduced(){},setHidden(){},setSkin:id=>shown.push(id),dispose(){}};}});
 view.open();assert.equal(previews,1);const catalogue=nodes.get('.wardrobe-content').innerHTML;assert.equal((catalogue.match(/data-skin-action="select"/g)||[]).length,21);for(const skin of HERO_SKINS)assert.ok(catalogue.includes(skin.thumb));view.render();assert.equal(previews,1);
 d.journey=openSkinPack(d.journey,{ownerId:'p-ui',operationId:'saved-batch',issuedAt:now,mode:'test',count:1},{randomValues:[.3]}).state;view.mode='test';view.view='opening';const before=shown.length;view.render();assert.equal(shown.length,before,'unrevealed result never reaches the model preview');assert.match(nodes.get('.wardrobe-content').innerHTML,/整批礼物已保存/);d.journey.openings.test.revealed=1;view.render({reveal:true});assert.equal(shown.at(-1),d.journey.openings.test.results[0].skinId);assert.equal(previews,1);view.reset();
});


test('wardrobe commands interoperate with the real local schema-4 store and resume the saved batch',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const store=new ProgressStore({storage,locks:null,questions:[{id:'ui-question',grade:1,semester:1,unitId:'s1-u1'}]});assert.equal((await store.load()).ok,true);
 const {v,calls}=wardrobeHarness();v.store=()=>store;assert.equal((await v.mutate({kind:'open',mode:'test',count:10},{nextView:'opening'})).ok,true);
 const original=structuredClone(store.data.journey.openings.test);assert.equal(v.view,'opening');assert.deepEqual(JSON.parse(values.get(PROGRESS_KEY)).journey.openings.test,original);assert.equal(calls.some(c=>c[0]==='sound'),false);
 const reloaded=new ProgressStore({storage,locks:null,questions:[{id:'ui-question',grade:1,semester:1,unitId:'s1-u1'}]});await reloaded.load();v.store=()=>reloaded;await v.click('resume');assert.equal(reloaded.data.journey.openings.test.id,original.id);await v.click('all');assert.equal(reloaded.data.journey.openings.test.revealed,1023);assert.deepEqual(reloaded.data.journey.openings.test.results,original.results);await v.click('finish');assert.equal(reloaded.data.journey.openings.test,null);assert.equal(v.view,'wardrobe');assert.equal(reloaded.data.journey.official.owned.length,0);store.dispose?.();reloaded.dispose?.();
});


test('daily unit route keeps real unit IDs together even when remaining questions are interleaved',async()=>{
 const desk=new StudyDesk();desk.status='ready';desk.data=data();desk.store={};desk.scope=()=>[{id:'a',bank:'school',grade:1,semester:1,unitId:'g1-s1-u1'},{id:'b',bank:'school',grade:1,semester:1,unitId:'g1-s1-u2'},{id:'c',bank:'school',grade:1,semester:1,unitId:'g1-s1-u1'}];let started;desk.study=async id=>{started=id;};await desk.startUnitPractice();assert.equal(started,'a');assert.deepEqual(desk.round.ids,['a','c']);desk.dispose();
});


test('an uncommitted store state suppresses reveal animation even if an earlier action reports success',async()=>{
 const {v,store,calls}=wardrobeHarness();store.skinAction=async()=>{store.dirty=true;return {ok:true};};await v.mutate({kind:'reveal',mode:'test',batchId:'b1',index:0},{reveal:true});assert.equal(calls.some(c=>c[0]==='sound'||c[1]?.reveal),false);
});
