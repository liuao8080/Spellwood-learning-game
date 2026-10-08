import test from "node:test";
import assert from "node:assert/strict";
import { targetPreview } from "../src/arena3d/targeting.mjs";
import { playSceneSound } from "../src/network/scene-audio.mjs";

function board(seat = 0) {
  const own = { mana: 6, hand: ["spark", "fox"], ritualsLeft: 4, ritualUsed: false, controller: "human", board: [{ uid: "own", cardId: "fox", ready: true, atk: 2 }] };
  const enemy = { board: [{ uid: "guard", cardId: "turtle", ready: true }, { uid: "other", cardId: "fox", ready: true }] };
  return { active: seat, phase: "playing", players: seat ? [enemy, own] : [own, enemy] };
}

test("target preview respects guards for attacks and both canonical viewer seats", () => {
  for (const seat of [0, 1]) {
    const state = board(seat), selection = { kind: "unit", uid: "own" };
    assert.deepEqual(targetPreview(state, seat, selection), { source: "own", targets: ["guard"] });
    state.players[1 - seat].board.shift();
    assert.deepEqual(targetPreview(state, seat, selection).targets, ["other", `hero:${1 - seat}`]);
  }
});

test("spell and ritual targeting can bypass a guard without exposing hidden cards", () => {
  const state = board();
  for (const selection of [{ kind: "card", index: 0 }, { kind: "ritual", ritual: "spark" }])
    assert.deepEqual(targetPreview(state, 0, selection), { source: "hero:0", targets: ["guard", "other", "hero:1"] });
  assert.deepEqual(targetPreview(state, 0, { kind: "card", index: 1 }).targets, []);
});

test("no targeting promise is shown for exhausted, poor, reserved, proxy or inactive actions", () => {
  let s = board(); s.players[0].board[0].ready = false; assert.equal(targetPreview(s, 0, { kind: "unit", uid: "own" }).targets.length, 0);
  s = board(); s.players[0].mana = 0; assert.equal(targetPreview(s, 0, { kind: "card", index: 0 }).targets.length, 0);
  for (const patch of [{ ritualUsed: true }, { ritualReserved: true }, { ritualsLeft: 0 }, { controller: "proxy" }]) {
    s = board(); Object.assign(s.players[0], patch); assert.equal(targetPreview(s, 0, { kind: "ritual", ritual: "spark" }).targets.length, 0);
  }
  s = board(); s.active = 1; assert.equal(targetPreview(s, 0, { kind: "unit", uid: "own" }).targets.length, 0);
  s.phase = "finished"; assert.equal(targetPreview(s, 1, { kind: "card", index: 0 }).targets.length, 0);
});

test("the new draw sound respects unlock, hidden state and the existing sound setting", () => {
  const tones = [], other = [], director = { settings: { sound: true }, unlocked: false, hidden: false, tone: (...args) => tones.push(args), play: (kind) => other.push(kind) };
  playSceneSound("draw", director); assert.equal(tones.length, 0);
  director.unlocked = true; director.hidden = true; playSceneSound("draw", director); assert.equal(tones.length, 0);
  director.hidden = false; director.settings.sound = false; playSceneSound("draw", director); assert.equal(tones.length, 0);
  director.settings.sound = true; playSceneSound("draw", director); assert.equal(tones.length, 3);
  playSceneSound("hit", director); assert.deepEqual(other, ["hit"]);
});


test("zero-attack ready partners retain legal target hints including crystal ram bonus attacks",()=>{
 for(const cardId of ["fox","crystal_ram"]){
  const state=board();Object.assign(state.players[0].board[0],{cardId,atk:0});
  assert.deepEqual(targetPreview(state,0,{kind:"unit",uid:"own"}),{source:"own",targets:["guard"]});
  state.players[1].board.shift();
  assert.deepEqual(targetPreview(state,0,{kind:"unit",uid:"own"}).targets,["other","hero:1"]);
 }
});
