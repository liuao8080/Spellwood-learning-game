import { CARDS, CARD } from './cards.mjs';

// Free decorative collections. Every basic card remains available for battle.
export const COLLECTION_TEST_MODE = true;
export const DAILY_LESSONS = 6;
export const REWARD_DAYS = 5;
export const FINISHES = Object.freeze([
  Object.freeze({id:'leaf',name:'翠叶',chance:70,color:'#92c987',dust:1,cost:5}),
  Object.freeze({id:'silver',name:'银光',chance:24,color:'#bfdfed',dust:3,cost:15}),
  Object.freeze({id:'star',name:'星辉',chance:5,color:'#ba9ce8',dust:10,cost:50}),
  Object.freeze({id:'gold',name:'晨金',chance:1,color:'#f2ce75',dust:25,cost:125}),
]);
export const FINISH = Object.fromEntries(FINISHES.map(x=>[x.id,x]));
const clone=x=>structuredClone(x);
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(x)&&!Object.hasOwn(Object.prototype,x);
const fail=code=>{throw Object.assign(Error(code),{code});};
const key=(cardId,finish)=>`${cardId}:${finish}`;
const hasCard=value=>typeof value==='string'&&Object.hasOwn(CARD,value);
const hasFinish=value=>typeof value==='string'&&Object.hasOwn(FINISH,value);
const validKey=x=>typeof x==='string'&&x.split(':').length===2&&hasCard(x.split(':')[0])&&hasFinish(x.split(':')[1]);
const wallet=()=>({dust:0,cards:{}});
export function freshCollection(){return {version:1,days:{},totalDays:0,earnedPacksSpent:0,test:wallet(),earned:wallet(),opening:null,openingIds:[],recent:[],equipped:{}};}
export function rewardBalance(s){return Math.max(0,Math.floor(s.totalDays/REWARD_DAYS)-s.earnedPacksSpent);}
export function dayKey(timestamp,timeZone='UTC'){
 const parts=new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(timestamp);
 const map=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${map.year}-${map.month}-${map.day}`;
}
function validDay(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;try{return new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}catch{return false;}}
function cleanWallet(v){
 if(!plain(v)||!integer(v.dust,0,100000000)||!plain(v.cards)||Object.keys(v.cards).length>CARDS.length*FINISHES.length)fail('INVALID_COLLECTION');
 const out=wallet();out.dust=v.dust;
 for(const [k,n] of Object.entries(v.cards)){if(!validKey(k)||!integer(n,1,10000000))fail('INVALID_COLLECTION');out.cards[k]=n;}
 return out;
}
function cleanOpening(v){
 if(v===null)return null;
 if(!plain(v)||!id(v.id)||!['test','earned'].includes(v.mode)||!integer(v.createdAt,0,8000000000000000)||!integer(v.revealed,0,1023)||!Array.isArray(v.cards)||v.cards.length!==10)fail('INVALID_COLLECTION');
 return {id:v.id,mode:v.mode,createdAt:v.createdAt,revealed:v.revealed,cards:v.cards.map(c=>{
  if(!plain(c)||!hasCard(c.cardId)||!hasFinish(c.finish)||typeof c.duplicate!=='boolean'||!integer(c.dust,0,25)||(c.duplicate?c.dust!==FINISH[c.finish].dust:c.dust!==0))fail('INVALID_COLLECTION');
  return {cardId:c.cardId,finish:c.finish,duplicate:c.duplicate,dust:c.dust};
 })};
}
export function validateCollection(input,questionIds){
 if(input===undefined)return freshCollection();
 if(!plain(input)||input.version!==1||!plain(input.days)||Object.keys(input.days).length>4000||!integer(input.totalDays,0,4000)||!integer(input.earnedPacksSpent,0,Math.floor(input.totalDays/REWARD_DAYS))||!Array.isArray(input.openingIds)||input.openingIds.length>65536||input.openingIds.some(x=>!id(x))||new Set(input.openingIds).size!==input.openingIds.length||!Array.isArray(input.recent)||input.recent.length>20||!plain(input.equipped))fail('INVALID_COLLECTION');
 const s=freshCollection();s.totalDays=input.totalDays;s.earnedPacksSpent=input.earnedPacksSpent;
 for(const [day,v] of Object.entries(input.days)){
  if(!validDay(day)||!plain(v)||!Array.isArray(v.qids)||v.qids.length>DAILY_LESSONS||new Set(v.qids).size!==v.qids.length||v.qids.some(q=>!questionIds.has(q))||v.complete!==(v.qids.length===DAILY_LESSONS))fail('INVALID_COLLECTION');
  s.days[day]={qids:[...v.qids],complete:v.complete};
 }
 if(Object.values(s.days).filter(x=>x.complete).length!==s.totalDays)fail('INVALID_COLLECTION');
 s.test=cleanWallet(input.test);s.earned=cleanWallet(input.earned);s.opening=cleanOpening(input.opening);s.openingIds=[...input.openingIds];s.recent=input.recent.map(cleanOpening);
 if(s.recent.some(x=>!x||x.revealed!==1023||!s.openingIds.includes(x.id))||s.opening&&(!s.openingIds.includes(s.opening.id)||s.recent.some(x=>x.id===s.opening.id))||new Set(s.recent.map(x=>x.id)).size!==s.recent.length)fail('INVALID_COLLECTION');
 const known=[...s.recent,...(s.opening?[s.opening]:[])],minimum={test:{},earned:{}};
 if(known.filter(x=>x.mode==='earned').length>s.earnedPacksSpent)fail('INVALID_COLLECTION');
 for(const batch of known)for(const c of batch.cards){const k=key(c.cardId,c.finish);minimum[batch.mode][k]=(minimum[batch.mode][k]||0)+1;}
 for(const mode of ['test','earned'])for(const [k,n] of Object.entries(minimum[mode]))if((s[mode].cards[k]||0)<n)fail('INVALID_COLLECTION');
 if(Object.keys(input.equipped).length>CARDS.length)fail('INVALID_COLLECTION');
 for(const [card,v] of Object.entries(input.equipped)){
  if(!hasCard(card)||!plain(v)||!['test','earned'].includes(v.mode)||!hasFinish(v.finish)||!s[v.mode].cards[key(card,v.finish)])fail('INVALID_COLLECTION');
  s.equipped[card]={mode:v.mode,finish:v.finish};
 }
 return s;
}
export function generatePack(random=()=>{const a=new Uint32Array(1);globalThis.crypto.getRandomValues(a);return a[0]/4294967296;}){
 const roll=()=>{const x=random();if(!(x>=0&&x<1))fail('INVALID_RANDOM');return x;};
 return Array.from({length:10},()=>{const cardId=CARDS[Math.floor(roll()*CARDS.length)].id,p=roll()*100;let total=0;const finish=FINISHES.find(f=>(total+=f.chance)>p).id;return {cardId,finish};});
}
export function qualifyDay(s,receipt,{questionMs,feedbackMs,now,timeZone='UTC'}){
 if(!receipt||!integer(questionMs,2000,7200000)||!integer(feedbackMs,1200,7200000)||!Number.isFinite(now)||now<receipt.answeredAt||now-receipt.answeredAt>7200000)return false;
 const day=dayKey(receipt.answeredAt,timeZone),existing=s.days[day];
 if(existing?.complete||existing?.qids.includes(receipt.qid))return false;
 if(!existing&&Object.keys(s.days).length>=4000)fail('REWARD_HISTORY_FULL');
 const entry=existing||{qids:[],complete:false};entry.qids.push(receipt.qid);
 if(entry.qids.length===DAILY_LESSONS){entry.complete=true;s.totalDays++;}
 s.days[day]=entry;return true;
}
export function applyCollectionOperation(s,op){
 if(!plain(op))fail('INVALID_COLLECTION_ACTION');
 if(op.kind==='open-pack'){
  if(!id(op.id)||!['test','earned'].includes(op.mode)||!integer(op.createdAt,0,8000000000000000)||!Array.isArray(op.cards)||op.cards.length!==10||op.cards.some(c=>!plain(c)||!hasCard(c.cardId)||!hasFinish(c.finish)))fail('INVALID_COLLECTION_ACTION');
  if(s.openingIds.includes(op.id))return false;
  if(s.opening)return false;
  if(op.mode==='test'&&!COLLECTION_TEST_MODE)fail('TEST_PACKS_DISABLED');
  if(op.mode==='earned'&&rewardBalance(s)<1)return false;
  if(s.openingIds.length>=65536)fail('COLLECTION_HISTORY_FULL');
  const w=s[op.mode],cards=op.cards.map(c=>{const k=key(c.cardId,c.finish),duplicate=!!w.cards[k],dust=duplicate?FINISH[c.finish].dust:0;w.cards[k]=Math.min(10000000,(w.cards[k]||0)+1);w.dust=Math.min(100000000,w.dust+dust);return {cardId:c.cardId,finish:c.finish,duplicate,dust};});
  if(op.mode==='earned')s.earnedPacksSpent++;
  s.opening={id:op.id,mode:op.mode,createdAt:op.createdAt,revealed:0,cards};s.openingIds.push(op.id);return true;
 }
 if(op.kind==='reveal-pack'){
  if(!s.opening||s.opening.id!==op.id)return false;
  if(op.index!=='all'&&!integer(op.index,0,9))fail('INVALID_COLLECTION_ACTION');
  const before=s.opening.revealed;s.opening.revealed|=op.index==='all'?1023:(1<<op.index);return before!==s.opening.revealed;
 }
 if(op.kind==='close-pack'){
  if(!s.opening||s.opening.id!==op.id)return false;
  if(s.opening.revealed!==1023)fail('PACK_NOT_REVEALED');
  s.recent.push(clone(s.opening));s.recent=s.recent.slice(-20);s.opening=null;return true;
 }
 if(op.kind==='redeem-finish'){
  if(!['test','earned'].includes(op.mode)||op.mode==='test'&&!COLLECTION_TEST_MODE||!hasCard(op.cardId)||!hasFinish(op.finish))fail('INVALID_COLLECTION_ACTION');
  const w=s[op.mode],k=key(op.cardId,op.finish);if(w.cards[k])return false;
  if(w.dust<FINISH[op.finish].cost)return false;w.dust-=FINISH[op.finish].cost;w.cards[k]=1;return true;
 }
 if(op.kind==='equip-finish'){
  if(!hasCard(op.cardId))fail('INVALID_COLLECTION_ACTION');
  if(op.finish==='base'){if(!s.equipped[op.cardId])return false;delete s.equipped[op.cardId];return true;}
  if(!['test','earned'].includes(op.mode)||op.mode==='test'&&!COLLECTION_TEST_MODE||!hasFinish(op.finish)||!s[op.mode].cards[key(op.cardId,op.finish)])fail('FINISH_NOT_COLLECTED');
  if(s.equipped[op.cardId]?.mode===op.mode&&s.equipped[op.cardId]?.finish===op.finish)return false;
  s.equipped[op.cardId]={mode:op.mode,finish:op.finish};return true;
 }
 fail('INVALID_COLLECTION_ACTION');
}
export function equippedFinishes(s){return Object.fromEntries(Object.entries(s?.equipped||{}).filter(([,v])=>v.mode==='earned'||COLLECTION_TEST_MODE).map(([id,v])=>[id,v.finish]));}
