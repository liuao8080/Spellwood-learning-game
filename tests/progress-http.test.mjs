import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameServer} from '../server/index.mjs';
import {createPasswordService} from '../server/passwords.mjs';
import {IdentityClient} from '../src/network/identity-client.mjs';
import {RemoteProgressStore} from '../src/network/remote-progress.mjs';
import {Client,openBoth} from './network-helpers.mjs';

const passwords=createPasswordService({scryptParameters:{N:1024,r:1,p:1}});
async function setup(t){const server=createGameServer({port:0,identityOptions:{passwords},config:{queueMs:500,aiDelayMs:5}});await server.listen();t.after(()=>server.close());return server;}
function browser(server){
  const jar=new Map(),requests=[];
  const cookie=()=>[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
  const fetcher=async(url,init={})=>{
    // Only the cookie/origin transport supplied by a browser is simulated.
    // JSON headers/body come from the actual production client modules.
    const response=await fetch(server.origin+url,{...init,headers:{...init.headers,Origin:server.origin,Cookie:cookie()}});
    for(const item of response.headers.getSetCookie()){
      const pair=item.split(';')[0],at=pair.indexOf('='),name=pair.slice(0,at),value=pair.slice(at+1);
      if(/Max-Age=0(?:;|$)/i.test(item))jar.delete(name);else jar.set(name,value);
    }
    requests.push({url,method:init.method||'GET',body:init.body});return response;
  };
  const identity=new IdentityClient({fetch:fetcher});
  return {identity,fetcher,cookie,requests,async progress(){const player=identity.state.player;const metadata=await(await fetcher('/api/curriculum')).json();const store=new RemoteProgressStore({playerId:player.playerId,questions:metadata.questions,fetcher});assert.equal((await store.load()).ok,true);return store;}};
}

test('production identity and remote-progress clients keep one guest collection through registration and another login',async t=>{
  const s=await setup(t),a=browser(s);const guest=await a.identity.bootstrap(),store=await a.progress();
  assert.equal((await store.updatePreferences({grade:2,course:'all'})).ok,true);
  const opening=await store.openPack('test');assert.equal(opening.ok,true);assert.equal(opening.data.collection.opening.cards.length,10);
  const packId=opening.data.collection.opening.id;
  assert.equal((await store.collectionAction({kind:'reveal-pack',id:packId,index:'all'})).ok,true);
  assert.equal((await store.collectionAction({kind:'close-pack',id:packId})).ok,true);
  const registered=await a.identity.register({username:'ForestReader',password:'123456'});assert.equal(registered.player.playerId,guest.player.playerId);
  const b=browser(s),otherGuest=await b.identity.bootstrap();await b.identity.login({username:'forestreader',password:'123456'});
  const remoteB=await b.progress();assert.deepEqual(remoteB.data.collection,store.data.collection);assert.equal(remoteB.data.legacy.grade,2);
  await b.identity.logout();const mismatch=await remoteB.refresh();assert.equal(mismatch.ok,false);assert.equal(mismatch.code,'PROFILE_CHANGED');
  const other=await b.progress();assert.equal(other.playerId,otherGuest.player.playerId);assert.equal(other.data.collection.openingIds.length,0);
  const exported=await store.exportLatest();assert.equal(exported.ok,true);assert.equal(JSON.parse(exported.json).profileId,guest.player.playerId);
  const posts=a.requests.filter(r=>r.url==='/api/progress/collection');assert(posts.length>=3);
  assert(!Object.hasOwn(JSON.parse(posts[0].body).action,'cards'));
});

test('real study learning is persisted by the server and the production client only reads its receipt',async t=>{
  const s=await setup(t),a=browser(s);await a.identity.bootstrap();const store=await a.progress();
  const meta=await(await a.fetcher('/api/curriculum')).json(),qid=meta.questions[0].id;
  const challenge=await(await a.fetcher('/api/study/'+qid)).json();
  const answer=await a.fetcher('/api/study/'+qid+'/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challengeId:challenge.challengeId,optionId:challenge.question.options[0].id})});
  const feedback=await answer.json();assert.equal(feedback.progressSaved,true);
  const applied=await store.applyLearning(feedback);assert.equal(applied.ok,true);assert.equal(applied.data.legacy.mastery[qid].seen,1);
  assert.equal((await store.applyLearning(feedback)).data.legacy.mastery[qid].seen,1);
  const reads=a.requests.filter(r=>r.url.includes('receipt=learn'));assert(reads.length);assert(reads.every(r=>r.method==='GET'&&r.body===undefined));
});

test('a failed durable write stays pending and a later client retry commits the same learning once',async t=>{
  const s=await setup(t),a=browser(s);await a.identity.bootstrap();const store=await a.progress();
  const meta=await(await a.fetcher('/api/curriculum')).json(),qid=meta.questions[0].id;
  const challenge=await(await a.fetcher('/api/study/'+qid)).json();
  const original=s.identityStore.commitPlayerEvent.bind(s.identityStore);
  s.identityStore.commitPlayerEvent=()=>{throw Object.assign(Error('test storage unavailable'),{code:'SQLITE_TEST_FAILURE'});};
  const feedback=await(await a.fetcher('/api/study/'+qid+'/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challengeId:challenge.challengeId,optionId:challenge.question.options[0].id})})).json();
  assert.equal(feedback.progressSaved,false);assert.equal(s.progressBridge.pendingCount,1);
  const pending=await store.applyLearning(feedback);assert.equal(pending.ok,false);assert.equal(pending.code,'PROGRESS_PENDING');assert(!store.data.legacy.mastery[qid]);
  s.identityStore.commitPlayerEvent=original;
  const recovered=await store.retry();assert.equal(recovered.ok,true);assert.equal(recovered.data.legacy.mastery[qid].seen,1);assert.equal(s.progressBridge.pendingCount,0);
});

test('offline human seats still receive their own authoritative terminal result',async t=>{
  const s=await setup(t),a=browser(s),b=browser(s);await a.identity.bootstrap();await b.identity.bootstrap();
  const store=await a.progress(),ca=await new Client(s,undefined,a.cookie()).open(),cb=await new Client(s,undefined,b.cookie()).open();
  const opts={grade:1,course:'all',deckId:'grove'};await ca.command('queue.join',opts);await cb.command('queue.join',opts);
  await Promise.all([ca.wait(m=>m.type==='room.snapshot'),cb.wait(m=>m.type==='room.snapshot')]);await openBoth([ca,cb]);
  const roomId=ca.view.roomId,seat=ca.view.youSeat;ca.close();
  assert.equal((await cb.command('room.resign')).ok,true);
  const result=await store.addResult({phase:'finished',roomId,youSeat:seat});assert.equal(result.ok,true);assert.equal(result.data.onlineRecords.length,1);assert.equal(result.data.onlineRecords[0].youSeat,seat);
  assert.equal((await store.addResult({phase:'finished',roomId,youSeat:seat})).data.onlineRecords.length,1);
});

test('a repeated collection request keeps its original ten results and rejects client-supplied outcomes',async t=>{
  const s=await setup(t),a=browser(s);await a.identity.bootstrap();await a.progress();
  const intent={requestId:'same-opening-request',action:{kind:'open-pack',mode:'test'}};
  const post=body=>a.fetcher('/api/progress/collection',{method:'POST',headers:{'Content-Type':'application/json','X-Spellwood-Player':a.identity.player.playerId},body:JSON.stringify(body)});
  const first=await(await post(intent)).json(),second=await(await post(intent)).json();assert.deepEqual(second.data,first.data);assert.equal(second.data.collection.openingIds.length,1);
  const forged=await post({requestId:'forged-opening-request',action:{kind:'open-pack',mode:'test',cards:[{cardId:'golem',finish:'gold'}]}});assert.equal(forged.status,400);
});
