import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import vm from "node:vm";
import { freshJourney } from "../src/reward-journey.mjs";
import { HERO_SKINS } from "../src/hero-skins.mjs";
import { chooseComputer } from "../server/duel-adapter.mjs";
const root = path.resolve(import.meta.dirname, "..");
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "spellwood-practice-check-"));
const output = path.join(scratch, "runtime.mjs");
await build({ entryPoints: [path.join(root, "src/practice/runtime.mjs")], outfile: output, bundle: true, format: "esm", platform: "browser", alias: {
  "node:crypto": path.join(root, "src/practice/browser-crypto.mjs"), "node:fs": path.join(root, "src/practice/no-filesystem.mjs"),
} });
const runtime = await import(pathToFileURL(output));
const until = async predicate => { const start = Date.now(); while (!predicate()) { if (Date.now() - start > 10000) throw Error("Practice did not advance"); await new Promise(r => setTimeout(r, 5)); } };
test("isolated browser practice plays a whole computer battle and starts a clean second session", async () => {
  let room, feedback;
  const connection = new runtime.DuelConnection({ onMessage(m) { if (m.type === "room.snapshot") room = m; if (m.type === "private.feedback") feedback = m; } });
  connection.practiceService.config.queueMs = 1;
  connection.practiceService.config.aiDelayMs = 2;
  connection.practiceService.config.commandRate = 1000; // Accelerated complete-game test, not production settings.
  try {
    connection.connect(); await until(() => connection.state === "ready");
    await connection.command("queue.join", { grade: 1, course: "s1", deckId: "grove" });
    await until(() => room?.phase === "opening");
    assert.equal(room.opponent.controller, "bot");
    const command = (type, payload) => connection.command(type, payload, { roomId: room.roomId, expectedRevision: room.revision });
    await command("opening.choose", { indices: [] });
    await until(() => room.phase === "playing" && room.canAct);
    await command("ritual.begin", { kind: "spark", target: "hero" });
    const authority = connection.practiceService.rooms.get(room.roomId);
    const pending = authority.seats[room.youSeat].pending;
    await command("ritual.answer", { challengeId: pending.challengeId, optionId: pending.correctOptionId });
    await until(() => feedback);
    assert.equal(feedback.outcome, "correct"); assert.ok(feedback.learning.qid);
    let commands = 0;
    while (room.phase !== "finished") {
      await until(() => room.phase === "finished" || room.canAct);
      if (room.phase === "finished") break;
      const state = connection.practiceService.rooms.get(room.roomId).state;
      const action = chooseComputer(state, room.youSeat, "balanced", false);
      await command("battle.action", { action });
      if (++commands > 100) throw Error("Practice battle failed to finish");
    }
    assert.equal(room.result.mode, "pve");
    const oldId = room.roomId;
    connection.freshSession(); await until(() => connection.state === "ready");
    assert.equal(connection.practiceService.sessions.size, 1);
    assert.equal(connection.session.roomId, null);
    assert.notEqual(connection.session.sessionId, oldId);
  } finally { connection.destroy(); }
});
test("practice study has the same catalogue, single question and idempotent answer flow", async () => {
  const catalogue = await (await runtime.studyFetch("/api/curriculum")).json();
  assert.equal(catalogue.questions.length, 480);
  assert.equal(catalogue.questions.filter(q => q.bank === "teacher-academic").length, 48);
  for (let grade = 1; grade <= 6; grade++) {
    const q = catalogue.questions.find(x => x.grade === grade);
    const challenge = await (await runtime.studyFetch(`/api/study/${q.id}`)).json();
    const options = { method: "POST", body: JSON.stringify({ challengeId: challenge.challengeId, optionId: challenge.question.options[0].id }) };
    const result = await (await runtime.studyFetch(`/api/study/${q.id}/answer`, options)).json();
    assert.equal(result.learning.qid, q.id);
    assert.deepEqual(await (await runtime.studyFetch(`/api/study/${q.id}/answer`, options)).json(), result);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runtime.studyFetch("/api/curriculum", { signal: controller.signal }), { name: "AbortError" });
});
test("cached navigation preserves the actual practice authority and current room",async()=>{
  let room;const connection=new runtime.DuelConnection({onMessage(m){if(m.type==='room.snapshot')room=m;}});connection.practiceService.config.queueMs=1;
  const source=await fs.readFile(path.join(root,'src/network/app.mjs'),'utf8');
  const lifecycleSource=source.slice(source.indexOf('globalThis.addEventListener?.("pagehide",'),source.indexOf('\nfunction validHandIntent('));
  const handlers=new Map(),views=Array.from({length:3},()=>({hidden:false,disposed:false,setHidden(v){this.hidden=v;},dispose(){this.disposed=true;}}));
  const collection={hidden:false,resetCount:0,visibility(v){this.hidden=v;},reset(){this.resetCount++;}};
  const sandbox={isPractice:true,identityEpoch:0,identityPanel:null,identityChannel:null,pageSuspended:false,document:{hidden:false},deadlineTimer:null,rewardDayTimer:null,wardrobeView:null,clearTimeout,SOUND:{visibility(){}},cancelVoice(){},desk:{visibility(){}},collectionView:collection,
    boardLabelInput:{cancelCount:0,disposed:false,cancel(){this.cancelCount++;},dispose(){this.disposed=true;}},
    handScene:views[0],lobbyScene:views[1],scene:views[2],arenaResizeObserver:null,link:connection,connectionState:'ready',addEventListener(n,h){handlers.set(n,h);},render(){for(const view of views)view.setHidden(false);}};
  vm.createContext(sandbox);vm.runInContext(lifecycleSource,sandbox);
  try{
    connection.connect();await until(()=>connection.state==='ready');await connection.command('queue.join',{grade:1,course:'s1',deckId:'grove'});await until(()=>room?.phase==='opening');
    const authority=connection.practiceService.rooms.get(room.roomId),roomId=room.roomId;
    handlers.get('pagehide')({persisted:true});assert.equal(collection.resetCount,0);assert.equal(sandbox.boardLabelInput.cancelCount,1);assert.equal(sandbox.boardLabelInput.disposed,false);assert.ok(views.every(v=>v.hidden&&!v.disposed));assert.equal(connection.practiceService.rooms.get(roomId),authority);
    handlers.get('pageshow')({persisted:true});assert.equal(collection.hidden,false);assert.ok(views.every(v=>!v.hidden&&!v.disposed));
    await connection.command('opening.choose',{indices:[]},{roomId,expectedRevision:room.revision});await until(()=>room.phase==='playing');
    assert.equal(room.roomId,roomId);assert.equal(connection.practiceService.rooms.get(roomId),authority);
    handlers.get('pagehide')({persisted:false});assert.equal(collection.resetCount,1);assert.ok(views.every(v=>v.disposed));assert.equal(connection.practiceService.rooms.size,0);
  }finally{connection.destroy();}
});
test("practice cosmetic choice is frozen per room and refreshed only for the next match",async()=>{
  let room;const journey=freshJourney({ownerId:'local-cosmetic'});journey.test.owned=[HERO_SKINS[0].id];journey.equipped={mode:'test',skinId:HERO_SKINS[0].id};
  const connection=new runtime.DuelConnection({getJourney:()=>journey,onMessage(message){if(message.type==='room.snapshot')room=message;}});connection.practiceService.config.queueMs=1;
  try {connection.connect();await until(()=>connection.state==='ready');await connection.command('queue.join',{grade:1,course:'s1',deckId:'grove'});await until(()=>room?.phase==='opening');assert.equal(room.self.skinId,HERO_SKINS[0].id);assert.equal(room.self.skinMode,'test');const first=room.roomId;journey.equipped={mode:'base',skinId:'forest_apprentice'};await connection.command('opening.choose',{indices:[]},{roomId:room.roomId,expectedRevision:room.revision});await until(()=>room.phase==='playing');assert.equal(room.self.skinId,HERO_SKINS[0].id);await connection.command('room.resign',{},{roomId:room.roomId,expectedRevision:room.revision});await until(()=>room.phase==='finished');await connection.command('queue.join',{grade:1,course:'s1',deckId:'grove'});await until(()=>room.roomId!==first);assert.equal(room.self.skinId,'forest_apprentice');assert.equal(room.self.skinMode,'base');}
  finally{connection.destroy();}
});
test.after(() => fs.rm(scratch, { recursive: true, force: true }));
