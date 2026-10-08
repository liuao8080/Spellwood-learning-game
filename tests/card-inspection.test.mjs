import test from 'node:test';
import assert from 'node:assert/strict';
import { boardCardInspection, isInspectionKey } from '../src/network/card-inspection.mjs';

const room = () => ({youSeat: 1, canAct: true,
  self: {board: [{uid:'mine-1',cardId:'fox',atk:4,hp:1,maxHp:3,ready:true,shield:true}]},
  opponent: {board: [{uid:'enemy-1',cardId:'turtle',atk:0,hp:2,maxHp:5,ready:false}]},
});

test('friendly inspection keeps damaged and enhanced instance facts separate from its base card', () => {
  const state=room(), before=structuredClone(state);
  const detail=boardCardInspection(state,{kind:'unit',seat:1,uid:'mine-1'});
  assert.equal(detail.attack,4);assert.equal(detail.health,1);assert.equal(detail.maximumHealth,3);
  assert.equal(detail.guide.atk,2);assert.equal(detail.guide.hp,2);
  assert.equal(detail.shield,true);assert.equal(detail.actionLabel,'现在可攻击');
  assert.equal(detail.changedAttack,true);assert.equal(detail.changedMaximumHealth,true);
  assert.ok(detail.guide.en);assert.deepEqual(state,before);
});

test('enemy inspection uses the public opposing seat and reports zero attack and readiness honestly', () => {
  const detail=boardCardInspection(room(),{kind:'unit',seat:0,uid:'enemy-1'});
  assert.equal(detail.mine,false);assert.equal(detail.attack,0);assert.equal(detail.shield,false);
  assert.equal(detail.guide.hp,5);assert.equal(detail.changedMaximumHealth,false);
  assert.equal(detail.ownerLabel,'对方伙伴');assert.equal(detail.actionLabel,'等待可行动');
});

test('inspection re-reads current state and never follows a recalled or replaced same-name unit', () => {
  const state=room(), ref={kind:'unit',seat:1,uid:'mine-1'};
  state.self.board[0].hp=2;assert.equal(boardCardInspection(state,ref).health,2);
  state.self.board[0].uid='mine-2';assert.equal(boardCardInspection(state,ref),null);
  assert.equal(boardCardInspection(state,{...ref,seat:0,uid:'mine-2'}),null);
  state.self.board=[];assert.equal(boardCardInspection(state,ref),null);
});

test('invalid seats, missing max health and non-unit references do not invent a detail view', () => {
  const state=room();
  for(const ref of [null,{kind:'hero',seat:1,uid:'mine-1'},{kind:'unit',seat:2,uid:'mine-1'}])assert.equal(boardCardInspection(state,ref),null);
  delete state.self.board[0].maxHp;
  assert.equal(boardCardInspection(state,{kind:'unit',seat:1,uid:'mine-1'}),null);
});

test('inspection shortcuts remain independent of graphics and exclude command modifiers', () => {
  for(const event of [{key:'i'},{key:'I'},{key:'ContextMenu'},{key:'F10',shiftKey:true}])assert.equal(isInspectionKey(event),true);
  for(const event of [{key:'F10'},{key:'i',ctrlKey:true},{key:'I',metaKey:true},{key:'i',altKey:true},{key:'Escape'}])assert.equal(isInspectionKey(event),false);
});
