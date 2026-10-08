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
