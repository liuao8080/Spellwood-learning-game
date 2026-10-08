import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import { RULES, CONTENT_VERSION } from '../src/cards.mjs';

// Browser host timers validate their receiver. Node's timers and many socket
// mocks do not, which previously hid a real Chromium reconnect exception.
test('default reconnect and cancellation call browser timers with their global receiver',async()=>{
 const source=await fs.readFile(new URL('../src/network/client.mjs',import.meta.url),'utf8');
 const context=vm.createContext({RULES,CONTENT_VERSION});
 vm.runInContext(`
 globalThis.timerCalls=[];
 globalThis.setTimeout=function(fn,delay){if(this!==globalThis)throw new TypeError('Illegal invocation');timerCalls.push({kind:'set',delay});return 42;};
 globalThis.clearTimeout=function(id){if(this!==globalThis)throw new TypeError('Illegal invocation');timerCalls.push({kind:'clear',id});};
 ${source.replace('import { RULES, CONTENT_VERSION } from \"../cards.mjs\";', '').replace('export class DuelConnection','class DuelConnection')}
 globalThis.connection=new DuelConnection({url:'ws://example.invalid/ws',storage:null});
 connection.retry();connection.disconnect();
 `,context);
 assert.deepEqual(JSON.parse(JSON.stringify(context.timerCalls)),[{kind:'set',delay:700},{kind:'clear',id:42}]);
 assert.equal(context.connection.state,'closed');
});
