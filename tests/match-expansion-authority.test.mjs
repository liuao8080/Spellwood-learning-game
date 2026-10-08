import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { GameService, DRAW_ENGLISH_MS } from '../server/service.mjs';
import { createDuel, changeOpening, applyCombat, publicEvent, chooseComputer } from '../server/duel-adapter.mjs';
import { createQuestionService } from '../server/questions.mjs';
import { ensureHandIds, legalActions } from '../src/engine.mjs';
import { CARD, OPPONENTS } from '../src/cards.mjs';
import { freshJourney, applyQualifiedMatch, rewardDay } from '../src/reward-journey.mjs';
import { startServer, Client, pair, openBoth } from './network-helpers.mjs';

const BASE_TIME = Date.parse('2026-10-08T04:00:00Z');
function harness(t, options = {}) {
  let now = BASE_TIME, seq = 0;
  const challenges = [], results = [], learned = [];
  const service = new GameService({ questions: createQuestionService(), now: () => now,
    send: (ws, value) => ws?.messages.push(structuredClone(value)),
    onChallenge: (...args) => challenges.push(args), onLearning: (...args) => learned.push(args),
    onResult: (...args) => results.push(structuredClone(args)),
    config: { queueMs: 1000000, turnMs: 150000, aiDelayMs: 1000000, commandRate: 10000, ...options.config },
    cosmeticFor: options.cosmeticFor,
  });
  t.after(() => service.close());
  const sockets = [0, 1].map(i => ({ readyState: 1, messages: [], player: { playerId: `player-${i}`, name: `Player ${i}`, kind: 'guest' }, close() { this.readyState = 3; } }));
  const sessions = sockets.map(ws => service.makeSession(ws));
  const matchOptions = { bank: options.bank ?? 'school', grade: options.bank ? null : 1, course: options.course ?? 'all', deckId: 'grove' };
  service.makeRoom(options.pve ? [{session:sessions[0],options:matchOptions},{bot:OPPONENTS[0],options:{...matchOptions,deckId:OPPONENTS[0].deck}}] : sessions.map(session=>({session,options:matchOptions})));
  const room = [...service.rooms.values()][0];
  function command(side, type, payload = {}, overrides = {}) {
    const session = service.sessions.get(room.seats[side].sessionId), ws = session.ws;
    const wire = { type, commandId: `test-${++seq}`, clientSeq: session.nextSeq, payload,
      roomId: room.id, expectedRevision: room.revision, ...overrides };
    service.command(ws, wire);
    return { ack: ws.messages.filter(m=>m.type==='command.ack').at(-1), wire, ws };
  }
  function ok(side, type, payload, overrides) { const out=command(side,type,payload,overrides);assert.equal(out.ack.ok,true,JSON.stringify(out.ack));return out; }
  for (let side=0;side<2;side++) if(room.seats[side].controller==='human') ok(side,'opening.choose',{indices:[]});
  return { service, room, sockets, sessions, challenges, results, learned, command, ok,
    tick: ms => { now += ms; }, view: side => service.view(room, side),
    end: () => ok(room.state.active, 'battle.action', {action:{type:'end'}}),
  };
}
function secondTurn(h) { h.end(); h.end(); assert.equal(h.room.state.turn,3); }
function replaceHand(room, side, cards) { const p=room.state.players[side];p.hand=[...cards];p.handIds=[];ensureHandIds(room.state); }

test('adapter initializes internal identities after replacement and mulligan replaces only chosen instances', () => {
  const s=createDuel(['grove','grove']);assert.equal(s.handSeq,8);
  assert.equal(new Set(s.players.flatMap(p=>p.handIds)).size,8);
  s.players[0].handBoosts={[s.players[0].handIds[1]]:{turn:1,amount:1}};
  const next=changeOpening(s,0,[1,3]);
  for(const i of [0,2])assert.equal(next.players[0].handIds[i],s.players[0].handIds[i]);
  for(const i of [1,3])assert.notEqual(next.players[0].handIds[i],s.players[0].handIds[i]);
  assert.deepEqual(next.players[0].handBoosts,{});assert.equal(s.handSeq,8);
});

test('views are read-only, opaque to the owner, stable through reconnect, and hide all opponent hand metadata', t => {
  const h=harness(t), a=h.view(0), before=structuredClone(h.room.state);
  for(const forbidden of ['hand','handIds','handBoosts','handCosts','legalCardTargets','drawEnglish'])assert.equal(Object.hasOwn(a.opponent,forbidden),false);
  assert(a.self.handIds.every(id=>/^c[a-f0-9]{32}$/.test(id)));
  assert.equal(new Set([...a.self.handIds,...h.view(1).self.handIds]).size,8);
  for(let i=0;i<5;i++)assert.deepEqual(h.view(0).self.handIds,a.self.handIds);
  assert.deepEqual(h.room.state,before);
  const session=h.service.sessions.get(h.room.seats[0].sessionId), old=session.ws;
  const token=old.messages.find(m=>m.type==='session.ready').resumeToken;
  h.service.detach(old);
  const replacement={...old,messages:[],readyState:1};h.service.resume(token,replacement);
  assert.deepEqual(replacement.messages.find(m=>m.type==='room.snapshot').self.handIds,a.self.handIds);
});

test('natural draw challenge binds one instance, reserves shared English, keeps deadline, replays safely and survives reconnect', t => {
  const h=harness(t);assert.equal(h.view(0).self.drawEnglish.canBegin,false);
  replaceHand(h.room,0,['sprout','sprout']);h.room.state.players[0].deck=['sprout',...h.room.state.players[0].deck];
  secondTurn(h);const before=h.view(0), handId=before.self.drawEnglish.eligibleHandId;
  assert.equal(before.self.drawEnglish.canBegin,true);assert(handId);
  const deadline=h.room.turnDeadline, initialArmor=h.room.state.players[0].armor;
  const start=h.ok(0,'draw.begin',{handId});
  assert.equal(h.room.turnDeadline,deadline);assert.equal(h.view(0).self.drawEnglish.chargesLeft,1);
  assert.equal(h.view(0).self.ritualsLeft,4);assert.equal(h.view(0).self.ritualReserved,false);
  assert.equal(h.view(0).self.drawEnglish.pending,true);
  const q=h.room.seats[0].pending;
  assert.deepEqual(h.challenges.at(-1).slice(2),[BASE_TIME,{source:'match'}]);
  const publicQ=start.ws.messages.find(m=>m.type==='private.challenge');
  assert.equal(publicQ.kind,'draw');assert.equal(publicQ.purpose,'draw');assert.equal(publicQ.handId,handId);
  assert(!JSON.stringify(publicQ).includes(q.correctOptionId+'","correct'));
  assert.equal(Object.hasOwn(publicQ,'correctOptionId'),false);
  assert.equal(h.command(0,'ritual.answer',{challengeId:q.challengeId,optionId:q.correctOptionId}).ack.code,'INVALID_CHALLENGE');
  const old=start.ws, token=old.messages.find(m=>m.type==='session.ready').resumeToken;
  h.service.detach(old);const replacement={...old,messages:[],readyState:1};h.service.resume(token,replacement);
  assert.equal(replacement.messages.find(m=>m.type==='private.challenge').challengeId,q.challengeId);
  assert.equal(h.challenges.length,1);
  const answer=h.ok(0,'draw.answer',{challengeId:q.challengeId,optionId:q.correctOptionId});
  const granted=h.view(0), ix=granted.self.handIds.indexOf(handId);
  assert.equal(granted.self.handCosts[ix],0);assert.equal(granted.self.handCosts.filter(cost=>cost===0).length,1);
  assert.deepEqual(granted.self.handBoosts[handId],{turn:3,amount:1});
  h.service.command(answer.ws,answer.wire);assert.equal(h.view(0).revision,granted.revision);assert.equal(h.learned.length,1);
  assert.equal(h.command(0,'draw.answer',{challengeId:q.challengeId,optionId:q.correctOptionId}).ack.code,'INVALID_CHALLENGE');
  assert.equal(h.command(0,'ritual.begin',{kind:'spark'}).ack.code,'ENGLISH_ALREADY_USED');
  h.ok(0,'battle.action',{action:{type:'play',index:0}});
  const shifted=h.view(0), shiftedIndex=shifted.self.handIds.indexOf(handId);
  assert.equal(shifted.self.handCosts[shiftedIndex],0);
  h.ok(0,'battle.action',{action:{type:'play',index:shiftedIndex}});
  assert.equal(h.view(0).self.handIds.includes(handId),false);assert.deepEqual(h.view(0).self.handBoosts,{});
  assert.equal(h.room.state.players[0].armor,initialArmor);
});

test('wrong/cancel/timeout leave base cards unchanged, consume two charges, never grant armor, and reject forged IDs/outcomes', t => {
  const h=harness(t);secondTurn(h);
  const view=h.view(0), eligible=view.self.drawEnglish.eligibleHandId;
  for(const handId of ['h9','c'+'0'.repeat(32),h.view(1).self.handIds[0],view.self.handIds[0]]) {
    const before=structuredClone(h.room.state), revision=h.room.revision;
    assert.equal(h.command(0,'draw.begin',{handId}).ack.ok,false);
    assert.deepEqual(h.room.state,before);assert.equal(h.room.revision,revision);
  }
  assert.equal(h.command(0,'draw.begin',{handId:eligible,correct:true}).ack.code,'BAD_PAYLOAD');
  const base=structuredClone(h.room.state.players[0]);h.ok(0,'draw.begin',{handId:eligible});
  let q=h.room.seats[0].pending;
  h.ok(0,'draw.answer',{challengeId:q.challengeId,optionId:q.question.options.find(o=>o.id!==q.correctOptionId).id});
  assert.deepEqual(h.room.state.players[0].hand,base.hand);assert.deepEqual(h.view(0).self.handBoosts,{});assert.equal(h.room.state.players[0].armor,base.armor);
  h.end();h.end();const nextId=h.view(0).self.drawEnglish.eligibleHandId;
  h.ok(0,'draw.begin',{handId:nextId});q=h.room.seats[0].pending;
  h.ok(0,'draw.cancel',{challengeId:q.challengeId});assert.equal(h.view(0).self.drawEnglish.chargesLeft,0);
  assert.equal(h.view(0).self.ritualsLeft,4);assert.equal(h.room.state.players[0].armor,base.armor);
  h.end();h.end();assert.equal(h.view(0).self.drawEnglish.canBegin,false);
  assert.equal(h.command(0,'draw.begin',{handId:h.view(0).self.drawEnglish.eligibleHandId}).ack.code,'DRAW_ENGLISH_UNAVAILABLE');
  const timed=harness(t);secondTurn(timed);timed.ok(0,'draw.begin',{handId:timed.view(0).self.drawEnglish.eligibleHandId});
  q=timed.room.seats[0].pending;const armor=timed.room.state.players[0].armor;
  timed.tick(DRAW_ENGLISH_MS);assert.equal(timed.command(0,'draw.answer',{challengeId:q.challengeId,optionId:q.correctOptionId}).ack.code,'CHALLENGE_EXPIRED');
  assert.equal(timed.room.state.players[0].armor,armor);assert.equal(timed.view(0).self.drawEnglish.pending,false);assert.deepEqual(timed.view(0).self.handBoosts,{});
});

test('draw opportunity excludes first turn, combat, rituals, a full-hand burn and insufficient remaining time', t => {
  const h=harness(t);secondTurn(h);h.tick(30001);
  assert.equal(h.view(0).self.drawEnglish.canBegin,false);
  const exact=harness(t);secondTurn(exact);exact.tick(30000);assert.equal(exact.view(0).self.drawEnglish.canBegin,true);
  const combat=harness(t);replaceHand(combat.room,0,['sprout']);secondTurn(combat);
  combat.ok(0,'battle.action',{action:{type:'play',index:0}});assert.equal(combat.view(0).self.drawEnglish.canBegin,false);
  const ritual=harness(t);secondTurn(ritual);ritual.ok(0,'ritual.begin',{kind:'spark'});const q=ritual.room.seats[0].pending;
  ritual.ok(0,'ritual.answer',{challengeId:q.challengeId,optionId:q.correctOptionId});assert.equal(ritual.view(0).self.drawEnglish.canBegin,false);
  const full=harness(t);replaceHand(full.room,0,Array(7).fill('sprout'));secondTurn(full);assert.equal(full.view(0).self.drawEnglish.eligibleHandId,null);
});

test('authoritative card targets include friendly arrivals/recall and enemy-only arrival, with precise public effects', t => {
  const h=harness(t), p=h.room.state.players[0], e=h.room.state.players[1];
  p.mana=6;p.maxMana=6;replaceHand(h.room,0,['mushroom_medic','glass_snail','reed_frog','tidal_recall','sunseed_blessing']);
  p.board=[{uid:'u101',cardId:'sprout',hp:1,maxHp:2,atk:1,ready:false}];
  e.board=[{uid:'u102',cardId:'sprout',hp:2,maxHp:2,atk:1,ready:false}];
  let targets=h.view(0).self.legalCardTargets;
  assert.deepEqual(targets.find(x=>x.index===0).targets,[{target:'u101',seat:0}]);
  assert.deepEqual(targets.find(x=>x.index===1).targets,[{target:'u101',seat:0}]);
  assert.deepEqual(targets.find(x=>x.index===2).targets,[{target:'u102',seat:1}]);
  assert.equal(targets.find(x=>x.index===3).targets[0].seat,0);
  h.ok(0,'battle.action',{action:{type:'play',index:4,target:'u101'}});
  assert.equal(h.room.event.changes.find(c=>c.uid==='u101').maxHpDelta,2);
  h.ok(0,'battle.action',{action:{type:'play',index:1,target:'u101'}});
  assert.equal(h.room.event.changes.find(c=>c.uid==='u101').shieldGained,true);
  h.ok(0,'battle.action',{action:{type:'play',index:2,target:'u101'}});
  const recall=h.room.event.changes.find(c=>c.uid==='u101');
  assert.deepEqual(recall,{seat:0,uid:'u101',hpDelta:0,atkDelta:0,maxHpDelta:0,removed:false,returned:true});
  assert.equal(h.room.state.players[0].hand.at(-1),'sprout');
});

test('frozen cosmetic selection validates authenticated ownership, isolates practice/test, defaults safely and never changes stats', t => {
  const journey=freshJourney({ownerId:'player-0'});journey.official.owned=['leaf_ranger'];journey.equipped={mode:'official',skinId:'leaf_ranger'};
  const forged=freshJourney({ownerId:'player-1'});forged.equipped={mode:'official',skinId:'phoenix_courier'};
  const h=harness(t,{cosmeticFor:s=>s.playerId==='player-0'?journey:forged});
  const side=h.room.seats.findIndex(m=>m.playerId==='player-0');
  assert.equal(h.view(side).self.skinId,'leaf_ranger');assert.equal(h.view(side).self.skinMode,'official');
  assert.equal(h.view(side).opponent.skinId,'forest_apprentice');
  journey.equipped={mode:'base',skinId:'forest_apprentice'};assert.equal(h.view(side).self.skinId,'leaf_ranger');
  assert.equal(h.view(side).self.hp,18);assert.equal(h.view(side).opponent.hp,18);
  const pve=harness(t,{pve:true});const bot=pve.room.seats.findIndex(m=>m.controller==='bot');
  assert.equal(pve.view(1-bot).opponent.skinMode,'computer');
});

test('real protocol rejects v1 clearly before exposing a session', async t => {
  const server=await startServer();t.after(()=>server.close());
  const ws=new WebSocket(server.origin.replace(/^http/,'ws')+'/ws',{origin:server.origin});t.after(()=>ws.close());
  await once(ws,'open');const message=once(ws,'message');ws.send(JSON.stringify({type:'session.open',protocol:1}));
  assert.deepEqual(JSON.parse(String((await message)[0])),{type:'session.error',code:'VERSION_MISMATCH'});
});

test('human participation uses successful own turns/actions only, freezes terminal state, and rejects quit/proxy qualification', t => {
  const h=harness(t);replaceHand(h.room,0,['sprout','sprout','sprout']);h.room.state.players[0].mana=3;
  const rejected=h.command(0,'battle.action',{action:{type:'play',index:6}});assert.equal(rejected.ack.ok,false);
  for(let n=0;n<3;n++)h.ok(0,'battle.action',{action:{type:'play',index:0}});
  assert.equal(h.room.seats[0].ownActions,3);assert.equal(h.room.seats[0].humanTurns.size,1);
  secondTurn(h);h.ok(0,'battle.action',{action:{type:'end'}});
  h.service.finish(h.room,0,'health');const finished=h.view(0);
  assert.deepEqual(finished.participation,{startedAt:BASE_TIME,ownTurns:2,ownActions:3});
  h.tick(60000);assert.deepEqual(h.view(0).participation,finished.participation);
  const qualified=applyQualifiedMatch(freshJourney({ownerId:'p'}),{ownerId:'p',eventId:'e',matchId:h.room.id,mode:'pvp',termination:'normal',issuedAt:BASE_TIME,finishedAt:h.room.finishedAt,ownTurns:2,ownActions:3});
  assert.equal(qualified.state.days[rewardDay(BASE_TIME)].qualifiedMatch,true);
  const proxy=harness(t);proxy.service.takeOver(proxy.room,0,'test');
  const action=chooseComputer(proxy.room.state,0,'balanced',false,'beginner');
  proxy.service.commit(proxy.room,applyCombat(proxy.room.state,action),{kind:action.type,actorSeat:0});
  proxy.service.finish(proxy.room,0,'health');assert.deepEqual(proxy.view(0).participation,{startedAt:BASE_TIME,ownTurns:0,ownActions:0});
  const quit=applyQualifiedMatch(freshJourney({ownerId:'p'}),{ownerId:'p',eventId:'quit',matchId:'quit',mode:'pvp',termination:'quit',issuedAt:BASE_TIME,finishedAt:BASE_TIME,ownTurns:20,ownActions:30});
  assert.equal(quit.receipt.qualified,false);
});

for (const bank of ['school','teacher-academic']) for (const mode of ['pvp','pve']) {
  test(`real ${bank} ${mode} normal game saves qualifying human participation exactly once, including a failed terminal write`, async t => {
    const server=await startServer({queueMs:mode==='pve'?1:1000000,turnMs:150000,aiDelayMs:1,computerDifficulty:'easy',commandRate:10000});
    t.after(()=>server.close());
    const options={bank,grade:bank==='school'?1:null,course:'all',deckId:'grove'};
    const clients=mode==='pvp'?await pair(server,options):[await new Client(server).open()];
    if(mode==='pve') {await clients[0].command('queue.join',options);await clients[0].wait(m=>m.type==='room.snapshot');}
    await openBoth(clients);
    const room=server.service.rooms.get(clients[0].view.roomId);
    const realCommit=server.identityStore.commitPlayerEvent.bind(server.identityStore);
    let failed=false;
    server.identityStore.commitPlayerEvent=(playerId,event)=>{
      if(event.type==='result'&&!failed){failed=true;throw Error('injected terminal disk failure');}
      return realCommit(playerId,event);
    };
    let count=0;
    while(room.phase!=='finished') {
      const active=clients.find(c=>c.view.youSeat===room.state.active);
      if(!active) {
        const observer=clients[0], revision=room.revision;
        await observer.wait(m=>m.type==='room.snapshot'&&m.roomId===room.id&&m.revision>=revision&&(m.canAct||m.phase==='finished'));
        continue;
      }
      await active.wait(m=>m.type==='room.snapshot'&&m.roomId===room.id&&m.revision>=room.revision);
      const actions=legalActions(room.state).filter(a=>a.type!=='power');
      const action=actions.find(a=>a.type==='attack'&&a.target==='hero')??actions.find(a=>a.type==='play')??actions.find(a=>a.type==='attack')??{type:'end'};
      const ack=await active.command('battle.action',{action});assert.equal(ack.ok,true,JSON.stringify(ack));
      assert(++count<500,'normal game must reach a terminal state');
    }
    assert(['health','draw'].includes(room.result.reason));assert.equal(failed,true);
    const final=clients.map(c=>server.service.view(room,c.view.youSeat));
    assert.equal(server.progressBridge.pendingCount,1);
    for(const [index,client] of clients.entries()) {
      const snapshot=final[index];assert.equal(snapshot.bank,bank);
      assert(snapshot.participation.ownTurns>=2);assert(snapshot.participation.ownActions>=3);
      const player=server.progressBridge.ensureSynced(client.session.playerId);
      assert.equal(player.progress.journey.days[rewardDay(snapshot.participation.startedAt)].qualifiedMatch,true);
      assert.equal(player.progress.journey.skinTickets,1);
      assert.equal(player.progress.onlineRecords.at(-1).bank,bank);
      const before=structuredClone(player.progress);
      server.progressBridge.result(client.session.playerId,server.service.view(room,client.view.youSeat));
      assert.deepEqual(server.playerProgress.ensure(client.session.playerId).progress,before);
    }
    assert.equal(server.progressBridge.pendingCount,0);
  });
}

for (const bank of ['school','teacher-academic']) {
  test(`real ${bank} battle questions never advance same-unit study route, while explicit study does`, async t => {
    let now=BASE_TIME;t.mock.method(Date,'now',()=>now);
    const server=await startServer({queueMs:1000000,turnMs:150000});t.after(()=>server.close());
    const noted=[], original=server.progressBridge.noteChallenge;
    server.progressBridge.noteChallenge=(...args)=>{noted.push(args);return original(...args);};
    const options={bank,grade:bank==='school'?1:null,course:bank==='school'?'s1-u1':'reading',deckId:'grove'};
    const clients=await pair(server,options);await openBoth(clients);
    const c=clients.find(client=>client.view.youSeat===0), other=clients.find(client=>client!==c);
    let requests=0;
    async function post(path,body) {
      const res=await fetch(server.origin+path,{method:'POST',headers:{Origin:server.origin,Cookie:c.cookie,'Content-Type':'application/json','X-Spellwood-Player':c.session.playerId},body:JSON.stringify(body)});
      const value=await res.json();assert.equal(res.status,200,JSON.stringify(value));return value;
    }
    for(let n=0;n<2;n++) {
      assert((await c.command('ritual.begin',{kind:'spark'})).ok);
      const q=await c.wait(m=>m.type==='private.challenge'&&m.revision===c.view.revision);
      assert((await c.command('ritual.answer',{challengeId:q.challengeId,optionId:q.question.options[0].id})).ok);
      now+=3200;
      await post('/api/progress/participation',{requestId:`participation-${++requests}`,challengeId:q.challengeId});
      if(n===0) {
        assert((await c.command('battle.action',{action:{type:'end'}})).ok);
        await other.wait(m=>m.type==='room.snapshot'&&m.activeSeat===other.view.youSeat);
        assert((await other.command('battle.action',{action:{type:'end'}})).ok);
        await c.wait(m=>m.type==='room.snapshot'&&m.turn===3);
      }
    }
    let journey=server.playerProgress.ensure(c.session.playerId).progress.journey;
    const day=journey.days[rewardDay(now)];assert.equal(day.qids.length,2);assert.deepEqual(day.units,{});assert.equal(day.claimed.includes('daily_apply'),false);
    const metadata=server.service.questions.metadata().questions.filter(q=>q.bank===bank&&(bank==='school'?q.grade===1:q.category==='reading'));
    const study=metadata.filter(q=>q.unitId===metadata[0].unitId).slice(0,2);assert.equal(study.length,2);
    for(const item of study) {
      const response=await fetch(server.origin+`/api/study/${item.id}`,{headers:{Cookie:c.cookie,'X-Spellwood-Player':c.session.playerId}});
      const q=await response.json();assert.equal(response.status,200);
      await post(`/api/study/${item.id}/answer`,{challengeId:q.challengeId,optionId:q.question.options[0].id});now+=3200;
      await post('/api/progress/participation',{requestId:`participation-${++requests}`,challengeId:q.challengeId});
    }
    journey=server.playerProgress.ensure(c.session.playerId).progress.journey;
    assert.equal(journey.days[rewardDay(now)].claimed.includes('daily_apply'),true);
    assert.deepEqual(noted.map(args=>args[3]),[{source:'match'},{source:'match'},{source:'study'},{source:'study'}]);
  });
}

test('authenticated HTTP equipment is the frozen room cosmetic source; queue-supplied cosmetics cannot override it', async t => {
  const server=await startServer({queueMs:1});t.after(()=>server.close());const c=await new Client(server).open();
  let request=0;
  const skin=async action=>{
    const res=await fetch(server.origin+'/api/progress/skins',{method:'POST',headers:{Origin:server.origin,Cookie:c.cookie,'Content-Type':'application/json','X-Spellwood-Player':c.session.playerId},body:JSON.stringify({requestId:`cosmetic-${++request}`,action})});
    const value=await res.json();assert.equal(res.status,200,JSON.stringify(value));return value;
  };
  await skin({kind:'open',mode:'test',count:1});
  const earned=server.playerProgress.ensure(c.session.playerId).progress.journey.test.owned[0];
  await skin({kind:'equip',mode:'test',skinId:earned});
  const options={grade:1,course:'all',deckId:'grove'};
  assert.equal((await c.command('queue.join',{...options,skinId:'phoenix_courier'})).code,'BAD_PAYLOAD');
  assert((await c.command('queue.join',options)).ok);await c.wait(m=>m.type==='room.snapshot');
  assert.equal(c.view.self.skinId,earned);assert.equal(c.view.self.skinMode,'test');
  await skin({kind:'equip',mode:'base',skinId:'forest_apprentice'});
  assert((await c.command('room.resync')).ok);assert.equal(c.view.self.skinId,earned);
  const old=c.view.roomId;assert((await c.command('room.resign')).ok);
  assert((await c.command('queue.join',options)).ok);await c.wait(m=>m.type==='room.snapshot'&&m.roomId!==old);
  assert.equal(c.view.self.skinId,'forest_apprentice');assert.equal(c.view.self.skinMode,'base');
});

test('two optional draw uses coexist with exactly four original rituals; an unused discount expires with its own turn', t => {
  const h=harness(t);secondTurn(h);
  const id=h.view(0).self.drawEnglish.eligibleHandId;
  h.ok(0,'draw.begin',{handId:id});let q=h.room.seats[0].pending;
  h.ok(0,'draw.answer',{challengeId:q.challengeId,optionId:q.correctOptionId});
  assert.equal(Object.keys(h.view(0).self.handBoosts).length,1);
  h.end();assert.deepEqual(h.view(0).self.handBoosts,{});h.end();
  const ix=h.view(0).self.handIds.indexOf(id);assert.equal(h.view(0).self.handCosts[ix],CARD[h.view(0).self.hand[ix]].cost);
  h.ok(0,'draw.begin',{handId:h.view(0).self.drawEnglish.eligibleHandId});q=h.room.seats[0].pending;
  h.ok(0,'draw.cancel',{challengeId:q.challengeId});
  for(let i=0;i<4;i++) {
    h.end();h.end();h.ok(0,'ritual.begin',{kind:'spark'});q=h.room.seats[0].pending;
    h.ok(0,'ritual.answer',{challengeId:q.challengeId,optionId:q.question.options.find(o=>o.id!==q.correctOptionId).id});
    assert.equal(h.view(0).self.ritualsLeft,3-i);
  }
  h.end();h.end();assert.equal(h.command(0,'ritual.begin',{kind:'spark'}).ack.code,'ILLEGAL_RITUAL');
  assert.equal(h.view(0).self.drawEnglish.chargesLeft,0);assert.equal(h.room.seats[0].learning.attempts,5);
});
