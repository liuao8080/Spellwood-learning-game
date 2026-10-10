/** A target reminder belongs to one live selection and authority revision. */
export function targetNoticeIdentity(room, selected) {
  if (!room?.canAct || room.phase !== 'playing' || !selected) return null;
  if (selected.kind === 'card') {
    const index=selected.index, id=room.self.hand[index], handId=room.self.handIds?.[index];
    if (!id || !handId) return null;
    return JSON.stringify([room.roomId,room.revision,'card',index,handId,id]);
  }
  if (selected.kind === 'ritual') return JSON.stringify([room.roomId,room.revision,'ritual',selected.ritual]);
  if (selected.kind === 'unit') return JSON.stringify([room.roomId,room.revision,'unit',selected.uid]);
  return null;
}
export function targetNoticeExpired(kind, boundIdentity, room, selected) {
  return kind === 'target' && (!boundIdentity || boundIdentity !== targetNoticeIdentity(room,selected));
}
