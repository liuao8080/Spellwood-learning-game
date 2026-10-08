import { cardGuide } from '../card-guide.mjs';

/** Read an exact public board instance, never a same-name replacement. */
export function boardCardInspection(room, reference) {
  if (!room || reference?.kind !== 'unit' || ![0, 1].includes(reference.seat) || typeof reference.uid !== 'string') return null;
  const mine = reference.seat === room.youSeat;
  const player = mine ? room.self : room.opponent;
  const unit = player?.board?.find(item => item.uid === reference.uid);
  const guide = unit && cardGuide(unit.cardId);
  if (!guide || guide.type !== '伙伴' || !Number.isFinite(unit.atk) || !Number.isFinite(unit.hp) || !Number.isFinite(unit.maxHp)) return null;
  return {
    kind: 'unit', uid: unit.uid, seat: reference.seat, cardId: unit.cardId, mine,
    guide, attack: unit.atk, health: unit.hp, maximumHealth: unit.maxHp,
    shield: unit.shield === true, ready: unit.ready === true,
    ownerLabel: mine ? '我方伙伴' : '对方伙伴',
    actionLabel: unit.ready ? (mine && room.canAct ? '现在可攻击' : '已就绪') : '等待可行动',
    changedAttack: unit.atk !== guide.atk, changedMaximumHealth: unit.maxHp !== guide.hp,
  };
}

/** Keyboard intent belongs to the application even when a renderer is missing. */
export function isInspectionKey(event) {
  return !event.altKey && !event.ctrlKey && !event.metaKey &&
    (event.key?.toLowerCase() === 'i' || event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey === true);
}
