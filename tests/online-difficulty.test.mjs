import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer,Client} from './network-helpers.mjs';

test('new server guest receives gentle adaptive computer and preference is resolved before next room',async t=>{
 const server=await startServer({queueMs:30});t.after(()=>server.close());
 const a=await new Client(server).open();t.after(()=>a.close());
 const playerId=a.messages.find(m=>m.type==='session.ready').playerId;
 await a.command('queue.join',{grade:1,course:'all',deckId:'grove'});
 await a.wait(m=>m.type==='room.snapshot');
 assert.equal(a.view.computer.level,'easy');assert.equal(a.view.computer.mode,'adaptive');assert.equal(a.view.computer.tutorial,true);
 await a.command('room.resign');
 const update=await fetch(server.origin+'/api/progress/preferences',{method:'POST',headers:{Cookie:a.cookie,Origin:server.origin,'Content-Type':'application/json','X-Spellwood-Player':playerId},body:JSON.stringify({requestId:'standard-next-room',patch:{combatMode:'standard'}})});
 assert.equal(update.status,200);
 const previous=a.view.roomId;
 await a.command('queue.join',{grade:1,course:'all',deckId:'grove'});
 await a.wait(m=>m.type==='room.snapshot'&&m.roomId!==previous);
 assert.equal(a.view.computer.level,'standard');assert.equal(a.view.computer.mode,'standard');
 assert.equal((await a.command('room.resign')).ok,true);
 const forged=await a.command('queue.join',{grade:1,course:'all',deckId:'grove',rating:1500});assert.equal(forged.ok,false);
});

test('a storage failure at AI fallback cancels queue without crashing or starting an unverified difficulty',async t=>{
 const server=await startServer({queueMs:40});t.after(()=>server.close());const a=await new Client(server).open();t.after(()=>a.close());
 await a.command('queue.join',{grade:1,course:'all',deckId:'grove'});
 const original=server.progressBridge.ensureSynced;server.progressBridge.ensureSynced=()=>{throw Error('test unavailable');};
 const cancelled=await a.wait(m=>m.type==='queue.status'&&m.reason==='PROGRESS_UNAVAILABLE');assert.equal(cancelled.status,'cancelled');assert.equal(server.service.rooms.size,0);
 server.progressBridge.ensureSynced=original;assert.equal((await fetch(server.origin+'/health')).status,200);
});
