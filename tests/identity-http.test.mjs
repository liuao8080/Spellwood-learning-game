import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGameServer} from '../server/index.mjs';
import {createPasswordService} from '../server/passwords.mjs';
import {identityCookie, readIdentityCookies} from '../server/identity-http.mjs';
import {Client, openBoth} from './network-helpers.mjs';
import {GameService} from '../server/service.mjs';
import {createQuestionService} from '../server/questions.mjs';
import {versions} from '../server/protocol.mjs';

const passwords = createPasswordService({scryptParameters: {N:1024,r:1,p:1}});
async function server(t, options={}) {
  const s=createGameServer({port:0,identityOptions:{passwords},config:{queueMs:100,aiDelayMs:5},...options});
  await s.listen();t.after(()=>s.close());return s;
}
class BrowserCookies {
  constructor(server){this.server=server;this.jar=new Map();}
  header(){return [...this.jar].map(([k,v])=>`${k}=${v}`).join('; ');}
  async call(route,body={},options={}) {
    const method=options.method || 'POST';
    const response=await fetch(this.server.origin+'/api/identity/'+route,{method,headers:{Origin:options.origin||this.server.origin,Cookie:options.cookie??this.header(),'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});
    for(const item of response.headers.getSetCookie()){
      const pair=item.split(';')[0],at=pair.indexOf('='),name=pair.slice(0,at),value=pair.slice(at+1);
      if(/Max-Age=0(?:;|$)/i.test(item))this.jar.delete(name);else this.jar.set(name,value);
    }
    return {status:response.status,body:await response.json(),cookies:response.headers.getSetCookie()};
  }
}

test('guest bootstrap uses HttpOnly cookie and keeps a persistent identity without putting a token in JSON',async t=>{
  const s=await server(t),b=new BrowserCookies(s);
  assert.deepEqual((await b.call('me',{}, {method:'GET'})).body,{player:null});
  const first=await b.call('guest');assert.equal(first.status,200);assert.equal(first.body.player.kind,'guest');
  assert.match(first.cookies[0],/HttpOnly/);assert.match(first.cookies[0],/SameSite=Lax/);assert.match(first.cookies[0],/Path=\//);
  assert.deepEqual(Object.keys(first.body),['player']);assert(!JSON.stringify(first.body).includes(b.jar.get('sw_guest')));
  const next=await b.call('guest');assert.equal(next.body.player.playerId,first.body.player.playerId);assert.equal(next.cookies.length,0);
});

test('guest registration binds its data; login/logout retains a different unbound browser guest',async t=>{
  const s=await server(t),b=new BrowserCookies(s),guest=(await b.call('guest')).body.player;
  s.identityStore.updatePlayerData(guest.playerId,{progress:{seen:['apple']},expectedRevision:0});
  const registered=await b.call('register',{username:'MapleAccount',password:'aaaaaa'});
  assert.equal(registered.status,200);assert.equal(registered.body.player.playerId,guest.playerId);assert.deepEqual(registered.body.player.progress,{seen:['apple']});
  assert.equal(registered.body.recoveryCode.length,43);assert(!b.jar.has('sw_guest'));assert(b.jar.has('sw_account'));
  const nextGuest=(await b.call('logout')).body.player;assert.notEqual(nextGuest.playerId,guest.playerId);
  const login=await b.call('login',{username:'MAPLEACCOUNT',password:'aaaaaa'});assert.equal(login.status,200);assert.equal(login.body.player.playerId,guest.playerId);assert(b.jar.has('sw_guest'));
  const returned=await b.call('logout');assert.equal(returned.body.player.playerId,nextGuest.playerId);
});

test('identity routes reject a foreign Origin, duplicate identity cookies and client supplied authority',async t=>{
  const s=await server(t),b=new BrowserCookies(s);
  assert.equal((await b.call('guest',{}, {origin:'https://unrelated.invalid'})).status,403);
  const g=await b.call('guest');
  assert.equal((await b.call('guest',{playerId:g.body.player.playerId,wallet:1000})).status,400);
  assert.equal((await b.call('me',{}, {method:'GET',cookie:b.header()+'; '+b.header()})).body.code,'INVALID_IDENTITY_COOKIE');
});

test('six simple characters work; wrong and unknown accounts have the same public failure and attempts are bounded',async t=>{
  const s=await server(t),b=new BrowserCookies(s);await b.call('guest');
  assert.equal((await b.call('register',{username:'AB',password:'12345'})).body.code,'PASSWORD_TOO_SHORT');
  assert.equal((await b.call('register',{username:'AB',password:'123456'})).status,200);
  const wrong=await b.call('login',{username:'AB',password:'wrongpassword'}),missing=await b.call('login',{username:'MissingName',password:'wrongpassword'});
  assert.equal(wrong.status,401);assert.deepEqual(wrong.body,missing.body);
  let last;for(let i=0;i<8;i++)last=await b.call('login',{username:'AB',password:'wrongpassword'});
  assert.equal(last.status,429);assert.equal(last.body.code,'RATE_LIMIT');
});

test('two concurrent registrations cannot bind the same case-insensitive username',async t=>{
  const s=await server(t),a=new BrowserCookies(s),b=new BrowserCookies(s);await Promise.all([a.call('guest'),b.call('guest')]);
  const results=await Promise.all([a.call('register',{username:'SharedName',password:'123456'}),b.call('register',{username:'sharedname',password:'123456'})]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
});

test('persistent identity survives a real server close and reopen',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'spellwood-identity-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const options={databasePath:path.join(dir,'identity.sqlite')};const a=await server(t,options),b=new BrowserCookies(a),g=(await b.call('guest')).body.player;
  a.identityStore.updatePlayerData(g.playerId,{profile:{deck:'grove'},expectedRevision:0});await a.close();
  b.server=await server(t,options);const restored=await b.call('me',{}, {method:'GET'});
  assert.equal(restored.body.player.playerId,g.playerId);assert.equal(restored.body.player.profile.deck,'grove');
});

test('separate cookie jars match as distinct players; one identity cannot create its own second seat',async t=>{
  const s=await server(t),a=new BrowserCookies(s),b=new BrowserCookies(s);await a.call('guest');await b.call('guest');
  const ca=await new Client(s,undefined,a.header()).open(),cb=await new Client(s,undefined,b.header()).open();
  assert.notEqual(ca.session.playerId,cb.session.playerId);
  const opts={grade:1,course:'all',deckId:'grove'};await ca.command('queue.join',opts);await cb.command('queue.join',opts);
  await Promise.all([ca.wait(m=>m.type==='room.snapshot'),cb.wait(m=>m.type==='room.snapshot')]);await openBoth([ca,cb]);
  assert.equal(ca.view.mode,'pvp');assert.equal(ca.view.roomId,cb.view.roomId);
  const replacement=await new Client(s,undefined,a.header()).open();await ca.wait(m=>m.type==='session.replaced');
  assert.equal(replacement.session.sessionId,ca.session.sessionId);assert.equal(s.service.sessions.size,2);
  const stolen=new Client(s,replacement.token,b.header());await assert.rejects(()=>stolen.open(),e=>e.code==='INVALID_SESSION');
  const restored=await new Client(s,replacement.token,a.header()).open();assert.equal(restored.session.roomId,ca.view.roomId);
});

test('logout immediately invalidates the existing authenticated WebSocket',async t=>{
  const s=await server(t),b=new BrowserCookies(s);await b.call('guest');await b.call('register',{username:'SocketOwner',password:'123456'});
  const c=await new Client(s,undefined,b.header()).open();const closed=once(c.ws,'close');
  const loggedOut=await b.call('logout');assert.equal(loggedOut.body.player.kind,'guest');
  assert.equal((await closed)[0],4003);
});

test('a signed-in player can replace a missed recovery code without changing its session',async t=>{
  const s=await server(t),b=new BrowserCookies(s);await b.call('guest');const registered=await b.call('register',{username:'RecoveryOwner',password:'123456'});
  const cookie=b.header();const rotated=await b.call('recovery-code',{password:'123456'});assert.equal(rotated.status,200);assert.equal(b.header(),cookie);
  const old=await b.call('recover',{username:'RecoveryOwner',password:'abcdef',recoveryCode:registered.body.recoveryCode});assert.equal(old.body.code,'INVALID_RECOVERY');
  const current=await b.call('recover',{username:'RecoveryOwner',password:'abcdef',recoveryCode:rotated.body.recoveryCode});assert.equal(current.status,200);
  assert.notEqual(b.header(),cookie);
});

test('HTTPS cookies use the Host prefix, and malformed duplicate cookie names are rejected',()=>{
  assert.match(identityCookie('guest','A'.repeat(43),Date.now()+60000,{secure:true}),/^__Host-sw_guest=.*; Secure$/);
  assert.deepEqual(readIdentityCookies('sw_guest=a; sw_guest=b'),{invalid:true});
});

test('study challenge belongs to its issuing player and cannot move across an identity switch',async t=>{
  const s=await server(t),a=new BrowserCookies(s),b=new BrowserCookies(s);await a.call('guest');await b.call('guest');
  const metadata=await (await fetch(s.origin+'/api/curriculum')).json(),qid=metadata.questions[0].id;
  assert.equal((await fetch(s.origin+'/api/study/'+qid)).status,401);
  const challenge=await (await fetch(s.origin+'/api/study/'+qid,{headers:{Cookie:a.header()}})).json();
  const answer=async(cookie)=>fetch(s.origin+'/api/study/'+qid+'/answer',{method:'POST',headers:{Cookie:cookie,Origin:s.origin,'Content-Type':'application/json'},body:JSON.stringify({challengeId:challenge.challengeId,optionId:challenge.question.options[0].id})});
  assert.equal((await answer(b.header())).status,410);
  const accepted=await answer(a.header());assert.equal(accepted.status,200);const first=await accepted.json();
  assert.deepEqual(await (await answer(a.header())).json(),first);
  assert.equal((await answer(b.header())).status,410);
});

test('an identity cannot occupy both seats at the exact session expiry before the periodic sweep',()=>{
  let now=0;const service=new GameService({questions:createQuestionService(),send:()=>{},now:()=>now,config:{sessionTtlMs:100,queueMs:10000}});
  const socket=()=>({player:{playerId:'one-account',kind:'account',name:'OneAccount'},readyState:1,close(){this.readyState=3;}});
  try {
    const options={...versions,grade:1,course:'all',deckId:'grove'},old=service.makeSession(socket());service.join(old,options);
    now=100;const replacement=service.makeSession(socket());service.join(replacement,options);
    assert.equal(service.sessions.size,1);assert.equal(service.rooms.size,0);assert.equal(service.sessions.has(old.id),false);
    assert.equal(replacement.queue.key,service.queueKey(options));
  } finally {service.close();}
});

test('the room factory independently rejects duplicate player identities and expired sessions',()=>{
  let now=0;const service=new GameService({questions:createQuestionService(),send:()=>{},now:()=>now,config:{sessionTtlMs:100}});
  const socket=id=>({player:{playerId:id,kind:'account',name:id},readyState:1,close(){this.readyState=3;}});
  try {
    const a=service.makeSession(socket('A')),b=service.makeSession(socket('B')),options={...versions,grade:1,course:'all',deckId:'grove'};
    b.playerId=a.playerId;service.makeRoom([{session:a,options},{session:b,options}]);assert.equal(service.rooms.size,0);
    b.playerId='B';now=100;service.makeRoom([{session:a,options},{session:b,options}]);assert.equal(service.rooms.size,0);assert.equal(service.sessions.size,0);
  } finally {service.close();}
});
