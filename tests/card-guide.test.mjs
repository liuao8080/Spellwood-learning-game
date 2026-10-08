import test from 'node:test';
import assert from 'node:assert/strict';
import {CARDS, CARD} from '../src/cards.mjs';
import {cardGuide} from '../src/card-guide.mjs';
import {createMatch, act} from '../src/engine.mjs';
import {CardLibrary} from '../src/network/card-library.mjs';

test('every guide shows current card resources, the action target and its timing',()=>{
 const library=new CardLibrary({preferences:()=>({deckId:'grove'})});library.open();
 for(const card of CARDS){
  const guide=cardGuide(card.id);assert.equal(guide.cost,card.cost);
  for(const field of['target','timing','rule','tip','example'])assert.ok(guide[field]?.length,`${card.id}:${field}`);
  library.selected=card.id;const html=library.html();assert.ok(html.includes(`${card.cost} 能量`));
  if(card.type==='spell'){assert.equal(guide.atk,null);assert.equal(guide.hp,null);assert.equal(guide.exchange,null);}
  else{assert.equal(guide.atk,card.atk);assert.equal(guide.hp,card.hp);assert.match(guide.exchange,/同时/);assert.match(guide.timing,card.keyword==='rush'?/登场当回合/:/下一个回合/);}
 }
});

test('the Moonlight example counts the spent spell and warns about empty-deck double draws',()=>{
 const before=createMatch({seed:'guide-moon'});before.players[0].hand=['moon','sprout'];before.players[0].mana=6;before.players[0].deck=['fox','turtle'];
 const after=act(before,{type:'play',index:0});assert.equal(after.players[0].hand.length,3);assert.match(cardGuide('moon').example,/共有3张/);
 before.players[0].deck=[];before.players[0].fatigue=0;before.players[0].hp=18;before.players[0].armor=0;
 const empty=act(before,{type:'play',index:0});assert.equal(empty.players[0].hp,15);assert.equal(empty.players[0].fatigue,2);
 assert.match(cardGuide('moon').tip,/连续触发2次/);assert.doesNotMatch(cardGuide('lantern').tip,/连续触发2次/);
});

test('the Spark example excludes shields and explains why no damage is taken',()=>{
 const s=createMatch({seed:'guide-spark'});s.players[0].hand=['spark'];s.players[0].mana=6;
 s.players[1].board=[{uid:'shielded',cardId:'otter',atk:CARD.otter.atk,hp:3,maxHp:3,ready:true,shield:true}];
 const after=act(s,{type:'play',index:0,target:'shielded'});assert.equal(after.players[1].board[0].hp,3);assert.equal(after.players[1].board[0].shield,false);
 assert.match(cardGuide('spark').example,/没有护盾/);assert.match(cardGuide('spark').tip,/挡住这一次伤害/);
});
