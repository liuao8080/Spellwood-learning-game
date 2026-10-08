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
  function pruneTiming() {
    // Expire unanswered/unqualified observations, but retain a qualified event
    // whose atomic write failed until its exact receipt can be retried.
    for(const [id,value] of timing)if(value.qualifiedAt===null&&now()-value.issuedAt>7200000)timing.delete(id);
  }
  return {
    ensureSynced,
    assertCanIssue(playerId) { ensureSynced(playerId);pruneTiming();if(timing.size>=65536)fail('STUDY_BUSY'); },
    noteChallenge(playerId,challengeId,issuedAt=now(),metadata={}) {
      if(!playerId)return;
      const source=metadata.source ?? "study";
      if(!["study","match"].includes(source)||!Number.isSafeInteger(issuedAt)||issuedAt<0)fail("INVALID_PARTICIPATION");
      const id=key(playerId,challengeId);
      if(timing.has(id))return;
      pruneTiming();
      if(timing.size>=65536)fail('STUDY_BUSY');
      timing.set(id,{issuedAt,source,answeredAt:null,qualifiedAt:null});
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
        ...(snapshot.computer?{computer:structuredClone(snapshot.computer)}:{}),
        ...(snapshot.participation?{participation:structuredClone(snapshot.participation)}:{})};
      return record({kind:'result',playerId,eventId:`result:${data.roomId}:${data.youSeat}`,data});
    },
    participation(playerId,challengeId) {
      const eventId=`participation:${challengeId}`;
      if(identityStore.hasPlayerEvent(playerId,eventId)){ensureSynced(playerId);return progress.participation(playerId,challengeId);}
      const player=ensureSynced(playerId);
      const entry=timing.get(key(playerId,challengeId));
      if(!entry)fail('INVALID_PARTICIPATION');
      const at=entry.qualifiedAt ?? now();
      if(![entry.issuedAt,entry.answeredAt,at].every(value=>Number.isSafeInteger(value)&&value>=0)||
          entry.answeredAt<entry.issuedAt||at<entry.answeredAt||at-entry.issuedAt>7200000)
        fail('INVALID_PARTICIPATION');
      // Early navigation is a successful read, with no reward receipt or dirty
      // state. A quick answer can finish reading on feedback and qualify later.
      if(at<entry.answeredAt+1200||at<entry.issuedAt+3200)
        return {player,duplicate:false,receipt:{changed:false,qualified:false}};
      // Freeze only the first valid qualifying observation, including a failed
      // SQLite write. Retrying later must preserve the original event/day.
      if(entry.qualifiedAt===null)entry.qualifiedAt=at;
      const result=progress.participation(playerId,challengeId,{issuedAt:entry.issuedAt,answeredAt:entry.answeredAt,
        qualifiedAt:entry.qualifiedAt,source:entry.source});
      timing.delete(key(playerId,challengeId));
      return result;
    },
    retryPending() {
      for(const playerId of new Set([...pending.values()].map(x=>x.playerId)))try{ensureSynced(playerId);}catch{}
    },
    close(){pending.clear();timing.clear();},
    get pendingCount(){return pending.size;}
  };
}
