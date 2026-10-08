import {randomUUID} from 'node:crypto';
import {generatePack} from '../src/collection.mjs';
import {plain} from './protocol.mjs';
import {skinIntent} from '../src/network/progress.mjs';

const requestId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(value);
const fail=code=>{throw Object.assign(Error(code),{code});};
const fields=(value,allowed)=>plain(value)&&Object.keys(value).every(k=>allowed.includes(k));
export function createProgressHttp({identityStore,progress,bridge,identityHttp,readJson,json,validOrigin,now=()=>Date.now()}) {
  let importing=false;
  function envelope(player,extra={}) {
    const serverNow=now();
    if(!Number.isSafeInteger(serverNow)||serverNow<0||serverNow>4102444800000)fail('PROGRESS_UNAVAILABLE');
    return {data:player.progress,playerId:player.playerId,revision:player.progress.revision,...extra,serverNow};
  }
  function reply(res,result) {
    json(res,200,envelope(result.player,{receipt:result.receipt,changed:result.receipt?.changed??false}));
  }
  function error(res,e) {
    const code=typeof e.code==='string'&&(/^(INVALID_|STALE_|LEGACY_|PLAYER_EVENT_|PLAYER_DATA_|IMPORT_|PAYLOAD_|NOT_ENOUGH_|FINISH_|PACK_|NO_REWARD_|TEST_PACKS_|COLLECTION_|REWARD_|SKIN_|INSUFFICIENT_)/.test(e.code))?e.code:
      e.code==='PROGRESS_PENDING'?'PROGRESS_PENDING':'PROGRESS_UNAVAILABLE';
    const status=['PROGRESS_UNAVAILABLE','PROGRESS_PENDING'].includes(code)?503:
      ['STALE_REVISION','LEGACY_IMPORT_CONFLICT','PLAYER_EVENT_CONFLICT'].includes(code)?409:
      /TOO_LARGE|FULL/.test(code)?413:400;
    json(res,status,{code,...(e.summary?{summary:e.summary}:{})});
  }
  return {
    envelope,
    async handle(req,res,pathname,url) {
      if(pathname!=='/api/progress'&&!pathname.startsWith('/api/progress/'))return false;
      const {identity}=identityHttp.current(req,true);
      if(!identity){json(res,401,{code:'IDENTITY_REQUIRED'});return true;}
      const playerId=identity.player.playerId;
      const expectedPlayer=req.headers['x-spellwood-player'];
      if((req.method==='POST'||expectedPlayer!==undefined)&&expectedPlayer!==playerId){
        json(res,409,{code:'PROFILE_CHANGED'});return true;
      }
      try {
        if(pathname==='/api/progress'&&req.method==='GET') {
          const player=bridge.ensureSynced(playerId),wanted=url.searchParams.get('receipt');
          let receipt;
          if(wanted!==null) {
            if(!/^(learn:[A-Za-z0-9_-]{8,128}|result:[A-Za-z0-9_-]{8,128}:[01])$/.test(wanted))fail('INVALID_RECEIPT');
            const eventId=wanted.startsWith('learn:')?'learning:'+wanted.slice(6):wanted;
            receipt={recorded:identityStore.hasPlayerEvent(playerId,eventId)};
          }
          json(res,200,envelope(player,receipt?{receipt}:{}));return true;
        }
        const route=pathname.slice('/api/progress/'.length);
        if(req.method!=='POST'||!['preferences','participation','collection','skins','legacy-import'].includes(route)){json(res,404,{code:'NOT_FOUND'});return true;}
        if(!validOrigin(req)){json(res,403,{code:'ORIGIN_REJECTED'});return true;}
        if(!req.headers['content-type']?.startsWith('application/json')){json(res,415,{code:'JSON_REQUIRED'});return true;}
        if(route==='legacy-import'&&importing){json(res,429,{code:'RATE_LIMIT'});return true;}
        if(route==='legacy-import')importing=true;
        try {
          const body=await readJson(req,route==='legacy-import'?16*1024*1024:8192);
          if(!plain(body)||!requestId(body.requestId))fail('INVALID_REQUEST_ID');
          bridge.ensureSynced(playerId);
          let result;
          if(route==='preferences') {
            if(!fields(body,['requestId','patch']))fail('INVALID_PROGRESS_ACTION');
            result=progress.preferences(playerId,body.patch,body.requestId);
          } else if(route==='participation') {
            if(!fields(body,['requestId','challengeId'])||!requestId(body.challengeId))fail('INVALID_PARTICIPATION');
            result=bridge.participation(playerId,body.challengeId);
          } else if(route==='skins') {
            if(!fields(body,['requestId','action']))fail('INVALID_SKIN_ACTION');
            result=progress.skins(playerId,skinIntent(body.action),body.requestId);
          } else if(route==='legacy-import') {
            if(!fields(body,['requestId','raw','expectedRevision'])||!Number.isSafeInteger(body.expectedRevision))fail('INVALID_IMPORT');
            result=progress.importLegacy(playerId,body.raw,body.requestId,{expectedRevision:body.expectedRevision});
          } else {
            if(!fields(body,['requestId','action'])||!plain(body.action))fail('INVALID_COLLECTION_ACTION');
            const action=body.action;
            const allowed={
              'open-pack':['kind','mode'],'reveal-pack':['kind','id','index'],'close-pack':['kind','id'],
              'redeem-finish':['kind','mode','cardId','finish'],'equip-finish':['kind','mode','cardId','finish']
            }[action.kind];
            if(!allowed||!fields(action,allowed))fail('INVALID_COLLECTION_ACTION');
            const serverAction=action.kind==='open-pack'?{...action,id:randomUUID(),createdAt:Date.now(),cards:generatePack()}:action;
            result=progress.collection(playerId,serverAction,body.requestId);
          }
          reply(res,result);
        } finally {if(route==='legacy-import')importing=false;}
      } catch(e) {error(res,e);}
      return true;
    }
  };
}
