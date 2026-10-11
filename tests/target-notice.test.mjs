import test from 'node:test';
import assert from 'node:assert/strict';
import { targetNoticeIdentity, targetNoticeExpired } from '../src/network/target-notice.mjs';
const room=()=>({roomId:'room',revision:7,phase:'playing',canAct:true,self:{hand:['reed_frog','sunseed_blessing'],handIds:['one','two']}});
const selected={kind:'card',index:0};
test('target reminder stays attached to its same legal selection and version',()=>{
 const r=room(),key=targetNoticeIdentity(r,selected);assert.ok(key);assert.equal(targetNoticeExpired('target',key,r,selected),false);
 for(const next of [{...r,revision:8},{...r,roomId:'next'},{...r,canAct:false},{...r,phase:'finished'},{...r,self:{...r.self,handIds:['new','two']}}])assert.equal(targetNoticeExpired('target',key,next,selected),true);
 assert.equal(targetNoticeExpired('target',key,r,null),true);assert.equal(targetNoticeExpired('target',key,r,{kind:'card',index:1}),true);
});
test('general failure and audio notices are not cleared by selection lifecycle',()=>{
 for(const kind of ['general','hand-tip',undefined])assert.equal(targetNoticeExpired(kind,'old',room(),null),false);
 assert.equal(targetNoticeIdentity(room(),{kind:'card',index:99}),null);
 assert.equal(targetNoticeExpired('target',null,room(),selected),true);
});
test('ritual and unit notices have independent selection identities',()=>{
 const r=room(),key=targetNoticeIdentity(r,{kind:'ritual',ritual:'spark'});
 assert.equal(targetNoticeExpired('target',key,r,{kind:'ritual',ritual:'spark'}),false);
 assert.equal(targetNoticeExpired('target',key,r,{kind:'unit',uid:'u1'}),true);
 assert.notEqual(targetNoticeIdentity(r,{kind:'unit',uid:'u1'}),targetNoticeIdentity(r,{kind:'unit',uid:'u2'}));
});
