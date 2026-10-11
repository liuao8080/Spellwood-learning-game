import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS } from '../src/cards.mjs';
import { selectedCardReason, cardTargetAllowed } from '../src/network/battle-options.mjs';
function state(card, targets = [], untargeted = false) {
  return {canAct:true,youSeat:0,opponent:{board:[]},self:{hand:[card],handIds:['instance'],handCosts:[2],mana:8,board:[],hp:15,
    legalCardTargets:[{index:0,handId:'instance',targets,untargeted}]}};
}
const friend=[{target:'friend',seat:0}],enemy=[{target:'enemy',seat:1}];
test('target instructions name the side and immediate card effect from current legal options',()=>{
  for(const [id,targets,text] of [
    ['reed_frog',enemy,'点敌方伙伴削弱'],
    ['ember_salamander',enemy,'点敌方伙伴造成伤害'],
    ['sunseed_blessing',friend,'点友方伙伴施祝福'],
    ['tidal_recall',friend,'点友方伙伴收回手牌'],
    ['mushroom_medic',friend,'点受伤友方伙伴治疗'],
    ['glass_snail',friend,'点无盾友方伙伴加盾'],
  ]) { const room=state(id,targets),before=structuredClone(room);assert.equal(selectedCardReason(room,0),text);assert.deepEqual(room,before);assert.equal(cardTargetAllowed(room,0,targets[0].target,targets[0].seat),true);assert.equal(cardTargetAllowed(room,0,targets[0].target,1-targets[0].seat),false); }
});
test('turn, settling, energy, board space and healing reasons precede target prompts',()=>{
 const room=state('reed_frog',enemy);room.canAct=false;assert.equal(selectedCardReason(room,0,{commandBusy:true}),'等你的回合再出牌');
 const full=state('bloom',[],true);full.self.hp=18;assert.equal(selectedCardReason(full,0),'生命已满，暂时不用治疗');
 room.canAct=true;room.self.mana=0;assert.equal(selectedCardReason(room,0,{visualBusy:true}),'正在结算，请稍候');
 assert.equal(selectedCardReason(room,0),'还差2点能量');room.self.mana=8;room.self.board=Array(4).fill({});assert.equal(selectedCardReason(room,0),'伙伴位置已满，需要先腾出空位');
});
test('no target distinguishes legal plain summon from blocked spells without granting actions',()=>{
 for(const [id,text] of [['mushroom_medic','无受伤友方可直接召唤'],['glass_snail','无可加盾友方可召唤'],['reed_frog','无敌方伙伴可直接召唤']])assert.equal(selectedCardReason(state(id,[],true),0),text);
 for(const [id,text] of [['sunseed_blessing','没有可指定的友方伙伴'],['tidal_recall','没有可指定的友方伙伴'],['mending_rain','没有受伤的友方伙伴'],['thorn_sweep','没有可指定的敌方伙伴']]){const room=state(id);room.self.legalCardTargets=[];assert.equal(selectedCardReason(room,0),text);assert.equal(cardTargetAllowed(room,0,'friend',0),false);}
});
test('stale identity and unexpected target side do not describe a ready friendly action',()=>{
 const room=state('sunseed_blessing',friend);room.self.handIds[0]='new-instance';room.self.board=[{uid:'friend',hp:2,maxHp:2}];assert.equal(selectedCardReason(room,0),'当前没有可用的出牌方式');assert.equal(cardTargetAllowed(room,0,'friend',0),false);
 assert.equal(selectedCardReason(state('sunseed_blessing',enemy),0),'点亮起目标立即出牌');assert.equal(selectedCardReason(room,5),'');
});

test('all thirty-six catalog combinations keep summon copy on unit cards only',()=>{
 assert.equal(CARDS.length,36);
 for(const card of CARDS){
  const targets=card.target?.startsWith('friendly')?friend:enemy;
  const room=state(card.id,targets);room.self.handCosts=[card.cost];room.self.mana=20;
  const text=selectedCardReason(room,0);
  if(card.type==='spell')assert.doesNotMatch(text,/召唤/,card.id);
  if(card.target==='friendly-wounded-unit')assert.match(text,/受伤/,card.id);
  if(card.target==='friendly-unshielded-unit')assert.match(text,/无盾/,card.id);
 }
});
