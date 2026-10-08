import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import WebSocket from 'ws';
import { DuelConnection } from '../src/network/client.mjs';
import { PictureReadiness } from '../src/av/pictures.mjs';
import { StudyDesk } from '../src/network/study-desk.mjs';
import { playSceneSound } from '../src/network/scene-audio.mjs';
import { targetPreview } from '../src/arena3d/targeting.mjs';
import { createGameServer } from '../server/index.mjs';
import { CARD, CARDS, DECKS, GRADES, validateCustomDeck } from '../src/cards.mjs';
import { lobbyView } from '../src/network/lobby-view.mjs';
import { CardLibrary, artThumb } from '../src/network/card-library.mjs';
import { CollectionView } from '../src/network/collection-view.mjs';
import { cardGuide } from '../src/card-guide.mjs';
import { selectDifficulty } from '../src/combat-rating.mjs';
import { equippedFinishes, rewardBalance, COLLECTION_TEST_MODE } from '../src/collection.mjs';
import { ServerClock, durationText } from '../src/network/deadlines.mjs';
import { IdentityClient } from '../src/network/identity-client.mjs';
import { IdentityPanel } from '../src/network/identity-view.mjs';
import { RemoteProgressStore } from '../src/network/remote-progress.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message = 'condition', timeout = 2500) {
  const end = Date.now() + timeout;
  while (!fn()) { if (Date.now() > end) throw Error('Timed out: ' + message); await sleep(5); }
  return fn();
}
const options = { grade: 1, course: 's1-u1', deckId: 'grove' };
const serverCleanups = new WeakMap();
function memoryStorage(initial) {
  const data = new Map(initial || []);
  return { data, getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: k => data.delete(k) };
}
// Node's fetch and ws do not provide the browser's shared HttpOnly cookie jar.
// Each fixture is a separate browser unless a test explicitly shares its jar.
function browserSession(server) {
  const cookies = new Map();
  const browser = {
    get cookie() { return [...cookies].map(([name, value]) => `${name}=${value}`).join('; '); },
    receive(values = []) {
      for (const value of values) {
        const pair = value.split(';')[0], index = pair.indexOf('=');
        const name = pair.slice(0, index), content = pair.slice(index + 1);
        if (/Max-Age=0(?:;|$)/i.test(value)) cookies.delete(name);
        else cookies.set(name, content);
      }
    },
    async fetch(path, init = {}) {
      const url = new URL(path, server.origin);
      assert.equal(url.origin, server.origin, 'Fixture credentials stay on the game origin');
      const headers = new Headers(init.headers);
      headers.set('Origin', server.origin);
      if (init.credentials !== 'omit' && browser.cookie) headers.set('Cookie', browser.cookie);
      const response = await fetch(url, { ...init, headers });
      if (init.credentials !== 'omit') browser.receive(response.headers.getSetCookie());
      return response;
    },
  };
  return browser;
}
async function serverFor(t, config = {}) {
  const server = createGameServer({ port: 0, config: { queueMs: 20000, openingMs: 10000, turnMs: 20000, questionMs: 10000, commandRate: 1000, ...config }, messageRate: 1000 });
  const cleanups=[];serverCleanups.set(server,cleanups);
  await server.listen(); t.after(async () => {for(const cleanup of cleanups)cleanup();await server.close();}); return server;
}
function networkOptions(server, storage, capture, faults = {}, browser = browserSession(server)) {
  return { url: server.origin.replace(/^http/,'ws') + '/ws', storage,
    schedule: (fn, ms) => setTimeout(fn, Math.min(ms, 15)),
    socketFactory(url) {
      const socket = new WebSocket(url, { origin: server.origin,
        ...(browser.cookie ? { headers: { Cookie: browser.cookie } } : {}),
      }); capture.sockets.push(socket);
      socket.on('upgrade', response => browser.receive(response.headers['set-cookie']));
      const originalSend = socket.send.bind(socket), originalAdd = socket.addEventListener.bind(socket);
      socket.send = text => { capture.sent.push(JSON.parse(text)); return originalSend(text); };
      socket.addEventListener = (type, fn) => originalAdd(type, event => {
        if (type === 'message') {
          const message = JSON.parse(event.data);
          if (faults.dropFeedback && message.type === 'private.feedback') { faults.dropFeedback = false; capture.dropped.push(message); return; }
          if (faults.dropAck && message.type === 'command.ack') { faults.dropAck = false; capture.dropped.push(message); socket.terminate(); return; }
        }
        fn(event);
      });
      return socket;
    },
  };
}
async function clientFor(t, server, { storage = memoryStorage(), faults = {}, browser = browserSession(server) } = {}) {
  const capture = { sockets: [], sent: [], dropped: [], messages: [], statuses: [] };
  const client = new DuelConnection({ ...networkOptions(server, storage, capture, faults, browser), onConnection: m => capture.statuses.push(m), onMessage: m => { capture.messages.push(m); if (m.type === 'room.snapshot') capture.room = m; } });
  client.connect(); serverCleanups.get(server).push(() => client.disconnect()); await until(() => client.state === 'ready', 'session ready');
  return { client, capture, storage, faults, browser };
}
async function paired(t, server) {
  const a = await clientFor(t,server), b = await clientFor(t,server);
  assert.notEqual(a.client.session.playerId, b.client.session.playerId, 'Paired humans have independent browser identities');
  await a.client.command('queue.join', options); await b.client.command('queue.join', options);
  await until(() => a.capture.room && b.capture.room, 'paired snapshots'); return [a,b];
}
function roomCommand(c,type,payload={}) { return c.client.command(type,payload,{ roomId:c.capture.room.roomId,expectedRevision:c.capture.room.revision }); }

test('independent real-network transport: dropped opening ACK retries the same intent exactly once', async t => {
  const server = await serverFor(t), [a,b] = await paired(t,server);
  a.faults.dropAck = true;
  const ack = await roomCommand(a,'opening.choose',{indices:[0]});
  assert.equal(ack.ok,true);
  const attempts = a.capture.sent.filter(m=>m.type==='opening.choose');
  assert.equal(attempts.length,2); assert.deepEqual(attempts[0],attempts[1]);
  const authoritative = server.service.rooms.get(a.capture.room.roomId);
  assert.equal(authoritative.revision,1); assert.equal(authoritative.confirmed[a.capture.room.youSeat],true);
  assert.equal(authoritative.state.players[a.capture.room.youSeat].hand.length,4);
  assert.equal(a.client.nextSeq,3); assert.equal(a.client.pending,null);
  await roomCommand(b,'opening.choose',{indices:[]});
  await until(()=>a.capture.room.phase==='playing','play begins');
});

test('independent real-network transport: 4001 replacement does not reclaim the seat', async t => {
  const server=await serverFor(t), a=await clientFor(t,server);
  const replacement=await clientFor(t,server,{storage:memoryStorage(a.storage.data),browser:a.browser});
  await until(()=>a.client.state==='replaced','replaced'); await sleep(90);
  assert.equal(a.capture.sockets.length,1); assert.equal(a.client.reconnectTimer,null);
  assert.equal(replacement.client.state,'ready'); assert.equal(server.service.sessions.size,1);
});

test('independent real-network transport: 4003 expiry stops retry and removes credentials', async t => {
  const server=await serverFor(t,{sessionTtlMs:120}), a=await clientFor(t,server);
  await until(()=>a.client.state==='expired','expired'); await sleep(70);
  assert.equal(a.capture.sockets.length,1); assert.equal(a.client.reconnectTimer,null);
  assert.equal(a.storage.getItem(a.client.storageKey),null);
});

test('independent real-network transport: lost answer and ACK replay feedback without a second attempt',async t=>{
  const server=await serverFor(t), clients=await paired(t,server);
  await Promise.all(clients.map(c=>roomCommand(c,'opening.choose',{indices:[]})));
  await until(()=>clients.every(c=>c.capture.room.phase==='playing'),'opening done');
  const a=clients.find(c=>c.capture.room.canAct);
  await roomCommand(a,'ritual.begin',{kind:'insight'});
  const challenge=await until(()=>a.capture.messages.find(m=>m.type==='private.challenge'),'issued question');
  a.faults.dropFeedback=true;a.faults.dropAck=true;
  await roomCommand(a,'ritual.answer',{challengeId:challenge.challengeId,optionId:challenge.question.options[0].id});
  const recovered=await until(()=>a.capture.messages.find(m=>m.type==='private.feedback'),'recovered answer');
  const original=a.capture.dropped.find(m=>m.type==='private.feedback');
  assert.equal(recovered.replayed,true);assert.equal(recovered.challengeId,original.challengeId);assert.deepEqual(recovered.learning,original.learning);
  const attempts=a.capture.sent.filter(m=>m.type==='ritual.answer');assert.equal(attempts.length,2);assert.deepEqual(attempts[0],attempts[1]);
  const r=server.service.rooms.get(a.capture.room.roomId);assert.equal(r.seats[a.capture.room.youSeat].learning.attempts,1);
  assert.equal(a.client.pending,null);await roomCommand(a,'battle.action',{action:{type:'end'}});
});

// This is an event/DOM model. It executes the application source and real transport,
// but it does not establish browser rendering, accessibility or WebGL behavior.
function appModel(t,server) {
  const browser=browserSession(server);
  const roots=new Map(), handlers=new Map(), pageHandlers=new Map(), timers=new Set(), capture={sockets:[],sent:[],dropped:[]};
  let doc, sceneInstance, handInstance;
  class Element {
    constructor(id='',dataset={}) { this.id=id; this.dataset=dataset; this.style={}; this.scrollTop=0; this.html=''; this.children=[]; this.classList={toggle(){},add(){},remove(){}}; }
    set innerHTML(value){this.html=String(value);this.dialog=null;}
    get innerHTML(){return this.html;}
    querySelector(selector){
      if(selector==='.dialog'&&/class="dialog/.test(this.html))return this.dialog ||= new Element('dialog');
      if(selector==='.feedback'&&this.html.includes('class="feedback"'))return new Element('feedback');
      return this.querySelectorAll(selector)[0]||null;
    }
    querySelectorAll(selector){
      if(!selector.includes('data-action')&&!selector.includes('data-uid'))return [];
      const elements=[];
      for(const m of this.html.matchAll(/<(button|a)\b([^>]*)>/g)){
        const ds={}; for(const a of m[2].matchAll(/data-([\w-]+)="([^"]*)"/g))ds[a[1].replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=a[2];
        if(!ds.action)continue;const el=new Element('',ds);el.disabled=/\sdisabled(?:\s|$)/.test(m[2]);el.owner=this;elements.push(el);
      }return elements;
    }
    contains(el){return el===this||el?.owner===this;}
    focus(){doc.activeElement=this;}
    closest(){return this;}
    scrollIntoView(){}
    appendChild(child){this.children.push(child);child.parentElement=this;return child;}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}
    setAttribute(name,value){this[name]=value;}
    addEventListener(){}
    replaceChildren(){this.innerHTML="";}
  }
  for(const id of ['interface','unit-labels','modal-root','notice','renderer-warning','arena','collection-root','lobby-scene','hand-stage','hand-canvas','hand-prev','hand-next','hand-hint','hand-semantics'])roots.set('#'+id,new Element(id));
  doc={hidden:false,activeElement:null,body:new Element('body'),createElement:()=>new Element(),querySelector:s=>roots.get(s)||null,querySelectorAll:s=>[...roots.values()].flatMap(x=>x.querySelectorAll(s)),addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:(name,fn)=>{if(handlers.get(name)===fn)handlers.delete(name);}};
  class Scene {
    constructor(){sceneInstance=this;this.history=[];this.attackResolvers=[];}
    cancel(){for(const r of this.attackResolvers.splice(0))r();}
    setBattle(state){this.history.push(structuredClone(state));this.state=state;}
    attack(){return new Promise(resolve=>this.attackResolvers.push(resolve));}
    select(){} showGallery(){this.state={phase:'gallery'};} setReduced(){} setHidden(hidden){this.hidden=hidden;} setFinishes(){} dispose(){this.disposed=true;}
  }
  // Renderers are intentionally modeled; the hand's public intent boundary is real.
  class Decoration { setHidden(){} setReduced(){} dispose(){} }
  class Hand extends Decoration {
    constructor(config){super();this.config=config;handInstance=this;}
    setInteractive(){} setHand(ids,{revision}){this.ids=ids;this.revision=revision;}
    select(index,source){this.config.onSelect({kind:'card',index,cardId:this.ids[index],revision:this.revision,source});}
    focus(){} scrollBy(){} animateDraw(){}
  }
  let transport;
  class Connection extends DuelConnection {constructor(config){super({...config,...networkOptions(server,memoryStorage(),capture,{},browser)});transport=this;}}
  class Identity extends IdentityClient {constructor(config){super({...config,fetch:browser.fetch});}}
  class IdentityView extends IdentityPanel {constructor(config){super({...config,document:doc});}}
  class Desk extends StudyDesk { constructor(config) { super({ ...config, storage: memoryStorage(), locks: null }); } }
  const sandbox={HandScene:Hand,LobbyScene:Decoration,lobbyView,isPractice:false,studyFetch:browser.fetch,IdentityClient:Identity,IdentityPanel:IdentityView,RemoteProgressStore,ServerClock,durationText,targetPreview,playSceneSound,StudyDesk:Desk,document:doc,ArenaScene:Scene,DuelConnection:Connection,PictureReadiness,CARD,CARDS,DECKS,GRADES,validateCustomDeck,CardLibrary,artThumb,CollectionView,cardGuide,selectDifficulty,equippedFinishes,rewardBalance,COLLECTION_TEST_MODE,crypto:webcrypto,console,queueMicrotask,
    addEventListener(name,handler){pageHandlers.set(name,handler);},
    SOUND:{unlock(){},sync(){},duckSpeech(){},visibility(){},play(){}},
    setTimeout(fn,ms){const id=setTimeout(fn,ms);id.unref?.();timers.add(id);return id;},clearTimeout(id){clearTimeout(id);timers.delete(id);},
    Audio:class {addEventListener(){} play(){return Promise.resolve();} pause(){} remove(){}},
  };
  vm.createContext(sandbox);
  const filename=new URL('../src/network/app.mjs',import.meta.url);
  const source=fs.readFileSync(filename,'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(source+'\nglobalThis.review={state:()=>({room,displayRoom,visualBusy,challenge,feedback,connectionState,commandBusy,waiting,sceneRevision,identityVerified,pendingLearning:[...pendingLearning],progress:desk.data,profileReady:desk.canStart}),message:m=>link.onMessage(m),snapshot:acceptSnapshot,link};',sandbox,{filename:filename.pathname});
  serverCleanups.get(server).push(()=>{pageHandlers.get('pagehide')?.({persisted:false});for(const socket of capture.sockets)socket.terminate();for(const timer of timers)clearTimeout(timer);});
  const model={sandbox,capture,transport,roots,browser,scene:()=>sceneInstance,state:()=>sandbox.review.state(),
    pageEvent(name,event={}){pageHandlers.get(name)?.(event);},
    html:()=>roots.get('#interface').innerHTML+roots.get('#modal-root').innerHTML,
    startMatch(){if(!roots.get('#modal-root').innerHTML.includes('class="dialog match-setup"'))this.click('match-setup');this.click('match');},
    selectCard(index){handInstance.select(index,'accessible-button');},
    inspectCard(index){handInstance.config.onInspect({kind:'card',index,cardId:handInstance.ids[index],revision:handInstance.revision,source:'longpress'});},
    click(action,extra={}){
      const scope=roots.get('#modal-root').querySelector('.dialog')?roots.get('#modal-root'):roots.get('#interface');
      const el=scope.querySelectorAll('[data-action]').find(x=>x.dataset.action===action&&Object.entries(extra).every(([k,v])=>x.dataset[k]===String(v))&&!x.disabled);
      assert(el,'Rendered enabled action missing: '+action);handlers.get('click')({target:el,preventDefault(){}});
    },
  };return model;
}
async function pairedApps(t,server) {
  const a=appModel(t,server),b=appModel(t,server);
  await until(()=>a.transport.state==='ready'&&b.transport.state==='ready'&&a.state().profileReady&&b.state().profileReady,'app sessions and server profiles');
  assert.notEqual(a.transport.session.playerId,b.transport.session.playerId,'App instances represent different humans');
  for(const app of [a,b])assert.equal(app.state().progress.profileId,app.transport.session.playerId,'Server progress belongs to the authenticated game identity');
  a.startMatch();b.startMatch();
  await until(()=>a.state().room&&b.state().room&&!a.state().commandBusy&&!b.state().commandBusy,'app pair');
  a.click('opening-confirm');b.click('opening-confirm');
  await until(()=>a.state().room.phase==='playing'&&b.state().room.phase==='playing'&&!a.state().commandBusy&&!b.state().commandBusy,'app playing');
  return [a,b];
}

test('app DOM model and real network: expired session offers recovery while a battle is open',async t=>{
  const server=await serverFor(t,{sessionTtlMs:500}),[a]=await pairedApps(t,server);
  const oldSessionId=a.transport.session.sessionId;
  await until(()=>a.state().connectionState==='expired','app expiry');
  await until(()=>a.state().identityVerified,'expired connection identity reverified');
  assert.match(a.html(),/data-action="reconnect"/,'An expired in-battle session needs a reachable fresh-session action');
  a.click('reconnect');await until(()=>a.transport.state==='ready','explicit fresh connection');
  assert.notEqual(a.transport.session.sessionId,oldSessionId);assert.equal(a.state().room,null);
  a.startMatch();await until(()=>a.state().waiting&&!a.state().commandBusy,'queue after expiry');
});

test('cached page hide/show preserves the room and scene without duplicate commands',async t=>{
  const server=await serverFor(t),apps=await pairedApps(t,server),a=apps.find(x=>x.state().room.canAct);
  const roomId=a.state().room.roomId,scene=a.scene(),before=a.capture.sent.length;
  a.pageEvent('pagehide',{persisted:true});assert.notEqual(scene.disposed,true);assert.equal(scene.hidden,true);
  a.pageEvent('pageshow',{persisted:true});await until(()=>a.state().identityVerified,'cached identity reverified');
  assert.equal(a.scene(),scene);assert.equal(scene.hidden,false);assert.equal(a.state().room.roomId,roomId);assert.equal(a.capture.sent.length,before);
  a.click('end');await until(()=>!a.state().room.canAct&&!a.state().commandBusy,'same room remains playable');
  a.pageEvent('pagehide',{persisted:false});assert.equal(scene.disposed,true);
});
test('cached replaced sessions do not automatically take a seat back from another client',async t=>{
  const server=await serverFor(t),[a]=await pairedApps(t,server);a.pageEvent('pagehide',{persisted:true});
  const replacement=await clientFor(t,server,{storage:memoryStorage(a.transport.storage.data),browser:a.browser});
  await until(()=>a.state().connectionState==='replaced','cached seat replaced');const sockets=a.capture.sockets.length;
  a.pageEvent('pageshow',{persisted:true});await sleep(60);
  assert.equal(a.capture.sockets.length,sockets);assert.equal(replacement.client.state,'ready');assert.match(a.html(),/data-action="resume-connection"/);
});
test('app DOM model and real network: opponent resignation during a question reaches the result',async t=>{
  const server=await serverFor(t),apps=await pairedApps(t,server);
  const a=apps.find(x=>x.state().room.canAct),b=apps.find(x=>x!==a);
  a.click('ritual',{value:'insight'});await until(()=>a.state().challenge&&!a.state().commandBusy,'question opened');
  b.click('leave');b.click('confirm-leave');
  await until(()=>a.state().room.phase==='finished','finished by resignation');
  assert.match(a.html(),/data-action="new-match"/,'The finished room must be reachable while a challenge was open');
  assert.equal(a.state().challenge,null);
});

test('app DOM model and real network: dropped-room resume discards the obsolete board',async t=>{
  const server=await serverFor(t,{finishedMs:40}),apps=await pairedApps(t,server),[a,b]=apps;
  const roomId=a.state().room.roomId;
  a.transport.disconnect();b.click('leave');b.click('confirm-leave');
  await until(()=>!server.service.rooms.has(roomId),'server reclaims completed room');
  a.transport.connect();await until(()=>a.transport.state==='ready','resume without old room');await sleep(20);
  assert.equal(a.state().room,null,'A ready session with no surviving room must not retain the old playing board');
  assert.match(a.html(),/data-action="match-setup"/);
  a.startMatch();await until(()=>a.state().waiting&&!a.state().commandBusy,'queue after old-room expiry');
});

test('app DOM model and real network: old feedback replay belongs to its challenge, not a new question',async t=>{
  const server=await serverFor(t),apps=await pairedApps(t,server),a=apps.find(x=>x.state().room.canAct),b=apps.find(x=>x!==a);
  a.click('ritual',{value:'insight'});await until(()=>a.state().challenge&&!a.state().commandBusy,'question one');
  const q1=a.state().challenge;a.click('answer',{option:q1.question.options[0].id});await until(()=>a.state().feedback&&!a.state().commandBusy,'feedback one');
  a.click('quiz-close');a.click('end');await until(()=>b.state().room.canAct&&!b.state().commandBusy,'opponent turn');
  b.click('end');await until(()=>a.state().room.canAct&&!a.state().commandBusy,'own next turn');
  a.click('ritual',{value:'insight'});await until(()=>a.state().challenge&&!a.state().commandBusy,'question two');
  const q2=a.state().challenge;assert.notEqual(q1.challengeId,q2.challengeId);
  const socketCount=a.capture.sockets.length;a.transport.socket.terminate();
  await until(()=>a.capture.sockets.length>socketCount&&a.transport.state==='ready','real resumed socket');await sleep(20);
  assert.equal(a.state().challenge.challengeId,q2.challengeId);assert.equal(a.state().feedback,null);
  assert.equal(a.state().pendingLearning.length,0);assert(a.state().progress.learningReceipts[q1.challengeId], 'feedback survives in the server receipt ledger exactly once');
  assert.doesNotMatch(a.roots.get('#modal-root').innerHTML,/class="feedback"/);
});

test('app DOM model: a resync cancels queued older animation writes as well as the current attack',async t=>{
  const server=await serverFor(t),[a]=await pairedApps(t,server);await sleep(0);
  const base=a.state().room;
  function snapshot(delta,resync=false){
    const s=structuredClone(base);s.revision+=delta;s.state.seq=s.revision;s.resync=resync;
    s.event=resync?null:{eventId:s.roomId+':review:'+delta,kind:'attack',actorSeat:0,sourceUid:'review-unit',target:'hero'};
    s.events=s.event?[s.event]:[];return s;
  }
  a.sandbox.review.snapshot(snapshot(1));await sleep(0);assert.equal(a.scene().attackResolvers.length,1);
  a.sandbox.review.snapshot(snapshot(2));
  const latest=snapshot(3,true);a.sandbox.review.snapshot(latest);await sleep(0);
  // A renderer cancellation resolves its current animation promise; any queue
  // callback created before that resync must remain invalid even if it runs later.
  for(const resolve of a.scene().attackResolvers.splice(0))resolve();await sleep(0);
  assert.equal(a.scene().state.seq,latest.revision,'An old animation continuation overwrote the resynced scene');
});

test('app DOM model and real network: a lethal final answer reaches result and keeps its learning receipt',async t=>{
  const server=await serverFor(t),apps=await pairedApps(t,server),a=apps.find(x=>x.state().room.canAct);
  const authority=server.service.rooms.get(a.state().room.roomId),seat=a.state().room.youSeat;
  // Controlled legal-state fixture: the opposing hero has two health. The
  // command, question, answer adjudication and result all use the real server.
  authority.state.players[1-seat].hp=2;authority.state.players[1-seat].armor=0;
  a.click('ritual',{value:'spark'});a.click('enemy-hero');
  await until(()=>a.state().challenge&&!a.state().commandBusy,'last question');
  const challengeId=a.state().challenge.challengeId,correctOptionId=authority.seats[seat].pending.correctOptionId;
  let releaseFinish;
  a.scene().present = (next) => next.phase === 'finished' ? new Promise(resolve => { releaseFinish = resolve; }) : Promise.resolve();
  a.click('answer',{option:correctOptionId});
  await until(()=>a.state().room.phase==='finished'&&!a.state().commandBusy&&releaseFinish,'lethal answer acknowledged');
  assert.equal(a.state().challenge,null);
  assert.doesNotMatch(a.html(),/data-action="new-match"/, 'the result waits for the accepted final animation');
  releaseFinish();
  await until(()=>/data-action="new-match"/.test(a.html()),'result after final animation');
  assert.match(a.html(),/记住这次词灵回响/);
  await until(()=>!!a.state().progress.learningReceipts[challengeId]&&!a.state().pendingLearning.length,"final receipt durably saved");
  assert.equal(a.state().progress.learningReceipts[challengeId].correct,true);
  assert.equal(authority.seats[seat].learning.attempts,1);
  a.click('new-match');assert.equal(a.state().room,null);assert.equal(a.state().pendingLearning.length,0);assert(a.state().progress.learningReceipts[challengeId]);
});

test('app replacement during a question offers explicit takeover without automatic connection fighting',async t=>{
  const server=await serverFor(t),apps=await pairedApps(t,server),a=apps.find(x=>x.state().room.canAct);
  a.click('ritual',{value:'insight'});await until(()=>a.state().challenge&&!a.state().commandBusy,'pending question');
  const id=a.state().challenge.challengeId,roomId=a.state().room.roomId;
  const replacement=await clientFor(t,server,{storage:memoryStorage(a.transport.storage.data),browser:a.browser});
  await until(()=>a.state().connectionState==='replaced','app replaced');
  assert.match(a.html(),/data-action="resume-connection"/);assert.equal(a.state().challenge,null);
  const oldCount=a.capture.sockets.length;await sleep(70);assert.equal(a.capture.sockets.length,oldCount);
  a.click('resume-connection');await until(()=>a.state().connectionState==='ready'&&a.state().challenge?.challengeId===id,'explicit same-room takeover');
  assert.equal(a.state().room.roomId,roomId);assert.equal(replacement.client.state,'replaced');
  assert.equal(a.capture.sockets.length,oldCount+1);assert.equal(server.service.rooms.get(roomId).seats[a.state().room.youSeat].learning.attempts,0);
});

test('a disconnected matching queue resets after resume instead of waiting for a cancelled search',async t=>{
  const server=await serverFor(t),a=appModel(t,server);
  await until(()=>a.transport.state==='ready'&&a.state().profileReady,'profile ready');
  a.startMatch();await until(()=>a.state().waiting&&!a.state().commandBusy,'queued');
  a.transport.socket.terminate();
  await until(()=>a.capture.sockets.length===2&&a.transport.state==='ready','resumed socket');
  assert.equal(a.state().waiting,false);assert.equal(a.state().room,null);
  assert.match(a.html(),/data-action="match-setup"/);a.startMatch();
  await until(()=>a.state().waiting&&!a.state().commandBusy,'can queue again');
});

test('accepted damage remains authoritative immediately while displayed health waits for impact',async t=>{
  const server=await serverFor(t),apps=await pairedApps(t,server),a=apps.find(x=>x.state().room.canAct);
  const authority=server.service.rooms.get(a.state().room.roomId),seat=a.state().room.youSeat;
  const oldHealth=a.state().room.opponent.hp;
  let impact,release;
  a.scene().present=(next,event,onImpact)=>event.kind === "ritual" ? new Promise(resolve=>{impact=onImpact;release=resolve;}) : Promise.resolve();
  a.click('ritual',{value:'spark'});a.click('enemy-hero');
  await until(()=>a.state().challenge&&!a.state().commandBusy,'question');
  a.click('answer',{option:authority.seats[seat].pending.correctOptionId});
  await until(()=>impact&&!a.state().commandBusy,'accepted scene event');
  assert.equal(a.state().room.opponent.hp,oldHealth-2);
  assert.equal(a.state().displayRoom.opponent.hp,oldHealth,'the visible life counter does not precede the impact');
  impact();assert.equal(a.state().displayRoom.opponent.hp,oldHealth-2);
  const synchronized=structuredClone(a.state().room);synchronized.resync=true;synchronized.revision++;
  synchronized.opponent.hp=oldHealth-3;synchronized.state.players[1-seat].hp=oldHealth-3;
  a.sandbox.review.snapshot(synchronized);impact();release();await sleep(0);
  assert.equal(a.state().displayRoom.opponent.hp,oldHealth-3,'a cancelled impact cannot overwrite a newer resync');
});

test('a rejected scene effect settles server-approved health and leaves the game usable', async t => {
  const server = await serverFor(t), apps = await pairedApps(t, server), a = apps.find(x => x.state().room.canAct);
  const authority = server.service.rooms.get(a.state().room.roomId), seat = a.state().room.youSeat;
  const before = a.state().room.opponent.hp;
  a.scene().present = async () => { throw new Error('injected graphics failure'); };
  a.click('ritual', { value: 'spark' }); a.click('enemy-hero');
  await until(() => a.state().challenge && !a.state().commandBusy, 'question issued');
  a.click('answer', { option: authority.seats[seat].pending.correctOptionId });
  await until(() => a.state().feedback && !a.state().commandBusy && !a.state().visualBusy, 'accepted effect settled');
  assert.equal(a.state().room.opponent.hp, before - 2);
  assert.equal(a.state().displayRoom.opponent.hp, before - 2);
  a.click('quiz-close'); a.click('end');
  await until(() => !a.state().room.canAct && !a.state().commandBusy, 'normal play continues');
});

test('failed 3D selection preserves card controls and the clear-selection action', async t => {
  const server = await serverFor(t), apps = await pairedApps(t, server), a = apps.find(x => x.state().room.canAct);
  a.scene().select = () => { throw new Error('injected highlight failure'); };
  assert.doesNotThrow(() => a.selectCard(0));
  assert.match(a.html(), /fallback-board/);
  assert.match(a.html(), /command-bar/);
  assert.doesNotThrow(() => a.click('clear'));
  assert.match(a.html(), /fallback-board/);
});

test('unchanged server notifications keep question focus on the chosen option and preserve feedback focus', async t => {
  const server = await serverFor(t), apps = await pairedApps(t, server), a = apps.find(x => x.state().room.canAct);
  a.click('ritual', { value: 'insight' });
  await until(() => a.state().challenge && !a.state().commandBusy, 'question ready');
  const second = a.roots.get('#modal-root').querySelectorAll('[data-action]').filter(x => x.dataset.action === 'answer')[1];
  assert(second); second.focus();
  a.sandbox.review.message({ type: 'review.keepalive' });
  assert.equal(a.sandbox.document.activeElement.dataset.option, second.dataset.option);
  assert.equal(a.sandbox.document.activeElement, second, 'identical dialog markup is not replaced');
  a.click('answer', { option: second.dataset.option });
  await until(() => a.state().feedback && !a.state().commandBusy, 'recap ready');
  const recap = a.roots.get('#modal-root').querySelector('.dialog'); recap.focus();
  a.sandbox.review.message({ type: 'review.keepalive' });
  assert.equal(a.sandbox.document.activeElement, recap);
  assert.match(a.roots.get('#modal-root').innerHTML, /battle-recap-layer/);
});


test('card inspection shows live resources and returns without spending a card or sending a command', async t => {
  const server=await serverFor(t),apps=await pairedApps(t,server),a=apps.find(x=>x.state().room.canAct);
  const before=structuredClone(a.state().room.self),card=CARD[before.hand[0]],sent=a.capture.sent.length;
  a.inspectCard(0);assert.match(a.html(),/card-info-dialog/);assert.ok(a.html().includes(`${card.cost} 能量`));
  if(card.type!=='spell'){assert.ok(a.html().includes(`${card.atk} 攻击`));assert.ok(a.html().includes(`${card.hp} 生命`));}
  a.click('card-info-close');assert.doesNotMatch(a.html(),/card-info-dialog/);
  assert.deepEqual(a.state().room.self,before);assert.equal(a.capture.sent.length,sent);
});
