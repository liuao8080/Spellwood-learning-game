/** Keeps authoritative learning/results attached to their owner, even if the
 * socket closes while a command finishes. Failed commits stay pending and are
 * never reported as saved. Rooms themselves remain transient in this phase. */
export function createProgressBridge({progress,identityStore,now=()=>Date.now(),onSaved=()=>{}}) {
  const pending=new Map(), timing=new Map();
  const key=(playerId,eventId)=>`${playerId}|${eventId}`;
  const fail=code=>{throw Object.assign(Error(code),{code});};
  function write(item) {
    return item.kind==='learning' ? progress.applyLearning(item.playerId,item.data) : progress.addResult(item.playerId,item.data);
  }
  function record(item) {
    const id=key(item.playerId,item.eventId);
    try {write(item);pending.delete(id);return true;}
    catch {
      if(!pending.has(id)&&pending.size>=2048)fail('PROGRESS_QUEUE_FULL');
      pending.set(id,item);return false;
    }
  }
  function ensureSynced(playerId) {
    let changed=false;
    for(const [id,item] of pending)if(item.playerId===playerId){
      try{write(item);pending.delete(id);changed=true;}catch{fail('PROGRESS_PENDING');}
    }
    const player=progress.ensure(playerId);
    if(changed)onSaved(playerId);
    return player;
  }
  function pruneTiming() { for(const [id,value] of timing)if(now()-value.issuedAt>7200000)timing.delete(id); }
  return {
    ensureSynced,
    assertCanIssue(playerId) { ensureSynced(playerId);pruneTiming();if(timing.size>=65536)fail('STUDY_BUSY'); },
    noteChallenge(playerId,challengeId,issuedAt=now()) {
      if(!playerId)return;
      const id=key(playerId,challengeId);
      if(timing.has(id))return;
      pruneTiming();
      if(timing.size>=65536)fail('STUDY_BUSY');
      timing.set(id,{issuedAt,answeredAt:null});
    },
    learning(playerId,feedback) {
      if(!playerId||!feedback?.learning)return true;
      const entry=timing.get(key(playerId,feedback.challengeId));
      if(entry&&entry.answeredAt===null)entry.answeredAt=feedback.learning.answeredAt;
      return record({kind:'learning',playerId,eventId:`learning:${feedback.challengeId}`,
        data:{challengeId:feedback.challengeId,learning:structuredClone(feedback.learning)}});
    },
    result(playerId,snapshot) {
      if(!playerId)return true;
      const data={phase:snapshot.phase,roomId:snapshot.roomId,youSeat:snapshot.youSeat,
        bank:snapshot.bank ?? 'school',
        grade:snapshot.grade,course:snapshot.course,ruleset:snapshot.ruleset,combatRules:snapshot.combatRules,
        contentVersion:snapshot.contentVersion,mode:snapshot.mode,assisted:snapshot.assisted,
        result:structuredClone(snapshot.result),self:{deckId:snapshot.self?.deckId},serverTime:snapshot.serverTime,
        ...(snapshot.computer?{computer:structuredClone(snapshot.computer)}:{})};
      return record({kind:'result',playerId,eventId:`result:${data.roomId}:${data.youSeat}`,data});
    },
    participation(playerId,challengeId) {
      const eventId=`participation:${challengeId}`;
      if(identityStore.hasPlayerEvent(playerId,eventId))return {player:ensureSynced(playerId),duplicate:true,receipt:{changed:false}};
      const player=ensureSynced(playerId);
      const entry=timing.get(key(playerId,challengeId));
      if(!entry||!Number.isFinite(entry.answeredAt))fail('INVALID_PARTICIPATION');
      const at=now(),questionMs=entry.answeredAt-entry.issuedAt,feedbackMs=at-entry.answeredAt;
      // Leaving a valid answered question early is normal navigation, not a
      // failed account write. Keep its mastery receipt, grant no reward, and
      // leave qualification uncommitted so a later valid read can qualify once.
      if(Number.isSafeInteger(questionMs)&&questionMs>=0&&questionMs<=7200000&&
          Number.isSafeInteger(feedbackMs)&&feedbackMs>=0&&feedbackMs<=7200000&&
          (questionMs<2000||feedbackMs<1200))
        return {player,duplicate:false,receipt:{changed:false,qualified:false}};
      return progress.participation(playerId,challengeId,{questionMs,feedbackMs,now:at});
    },
    retryPending() {
      for(const playerId of new Set([...pending.values()].map(x=>x.playerId)))try{ensureSynced(playerId);}catch{}
    },
    close(){pending.clear();timing.clear();},
    get pendingCount(){return pending.size;}
  };
}
