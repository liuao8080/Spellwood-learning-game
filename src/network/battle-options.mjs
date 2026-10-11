import { CARD } from '../cards.mjs';
/** Render authoritative affordances. No client-side substitute for legal actions. */
export function selectedCardOption(room, index) {
  const id=room?.self?.hand?.[index],card=CARD[id],handId=room?.self?.handIds?.[index];
  if(!card)return null;
  const legal=room.self.legalCardTargets?.find(item=>item.index===index&&item.handId===handId);
  return {card,handId,cost:room.self.handCosts?.[index]??card.cost,legal:legal||null};
}
export function cardTargetAllowed(room,index,target,seat){return !!selectedCardOption(room,index)?.legal?.targets.some(item=>item.target===target&&item.seat===seat);}
export function selectedTargetIds(room,index){return (selectedCardOption(room,index)?.legal?.targets||[]).map(item=>item.target==='hero'?`hero:${item.seat}`:item.target);}
export function answerCommand(challenge){return challenge?.purpose==='draw'?'draw.answer':'ritual.answer';}
export function drawFeedbackText(outcome){return outcome==='correct'?'答对了：这张牌本回合费用减1（最低0）':outcome==='unanswered'?'未作答：保留原牌，本次机会已使用':'再读一遍讲解：原牌保留，费用不变';}

/** Copy follows authoritative options; it never grants a target or a play. */
export function selectedCardReason(room, index, { commandBusy = false, visualBusy = false } = {}) {
  const option = selectedCardOption(room, index);
  if (!option) return '';
  const { card, cost, legal } = option, self = room.self, unit = card.type !== 'spell';
  if (!room.canAct) return '等你的回合再出牌';
  if (commandBusy || visualBusy) return '正在结算，请稍候';
  if (self.mana < cost) return `还差${cost - self.mana}点能量`;
  if (card.type !== 'spell' && self.board.length >= 4) return '伙伴位置已满，需要先腾出空位';
  if (card.keyword === 'restore' && self.hp >= 18) return '生命已满，暂时不用治疗';
  const targets = legal?.targets || [];
  if (targets.length) {
    const friendly = targets.every(item => item.seat === room.youSeat);
    const enemy = targets.every(item => item.seat === 1 - room.youSeat);
    if (unit && friendly && card.target === 'friendly-wounded-unit') return '点受伤友方伙伴治疗';
    if (unit && friendly && card.target === 'friendly-unshielded-unit') return '点无盾友方伙伴加盾';
    if (friendly && card.keyword === 'blessing') return '点友方伙伴施祝福';
    if (friendly && card.keyword === 'recall') return '点友方伙伴收回手牌';
    if (unit && enemy && card.keyword === 'weaken') return '点敌方伙伴削弱';
    if (unit && enemy && card.keyword === 'arrivalDamage') return '点敌方伙伴造成伤害';
    if (enemy && card.keyword === 'damage') return targets.some(item => item.target === 'hero')
      ? '点敌方英雄或伙伴施法' : '点敌方伙伴施法';
    return '点亮起目标立即出牌';
  }
  if (legal?.untargeted) {
    if (unit && card.target === 'friendly-wounded-unit') return '无受伤友方可直接召唤';
    if (unit && card.target === 'friendly-unshielded-unit') return '无可加盾友方可召唤';
    if (unit && card.target === 'enemy-unit') return '无敌方伙伴可直接召唤';
    return '';
  }
  if (card.target === 'friendly-unit' && self.board.length === 0) return '没有可指定的友方伙伴';
  if (card.target === 'all-friendly-wounded-units' && !self.board.some(u => u.hp < u.maxHp)) return '没有受伤的友方伙伴';
  if ((card.target === 'all-enemy-units' || card.target === 'enemy-unit') && room.opponent?.board?.length === 0) return '没有可指定的敌方伙伴';
  return '当前没有可用的出牌方式';
}
