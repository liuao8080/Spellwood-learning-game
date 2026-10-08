import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { StudyDesk } from '../src/network/study-desk.mjs';
import { lobbyView } from '../src/network/lobby-view.mjs';

const school = JSON.parse(readFileSync(new URL('../src/questions.json',import.meta.url),'utf8'));
const categories=['vocabulary','grammar','syntax','reading'];
const teacher=categories.flatMap(category=>Array.from({length:12},(_,i)=>({id:`ta-${category}-${i+1}`,bank:'teacher-academic',category,grade:null,semester:null,unitId:`ta-${category}`,displayLabel:category})));
function fixture(){
 const preferences={bank:'school',grade:6,course:'s2-u6',teacherCourse:'all'};
 const desk=new StudyDesk({getPreferences:()=>preferences});
 desk.catalogue={questions:[...school,...teacher]};desk.status='ready';desk.data={legacy:{mastery:{},records:[]},onlineRecords:[]};
 return {preferences,desk};
}

test('teacher catalogue and summary cannot count school mastery and switching preserves school selection',()=>{
 const {desk,preferences}=fixture();
 const schoolId=desk.scope()[0].id;
 desk.data.legacy.mastery[schoolId]={seen:1,streak:1,due:Date.now()+50000};
 assert.equal(desk.summary().total,6);assert.equal(desk.summary().learned,1);
 preferences.bank='teacher-academic';assert.equal(desk.scope().length,48);assert.equal(desk.summary().learned,0);
 preferences.teacherCourse='reading';assert.equal(desk.scope().length,12);assert(desk.scope().every(q=>q.category==='reading'));
 desk.data.legacy.mastery['ta-reading-1']={seen:1,streak:0,due:0};assert.equal(desk.summary().learned,1);
 preferences.bank='school';assert.equal(preferences.grade,6);assert.equal(preferences.course,'s2-u6');assert.equal(desk.summary().learned,1);assert.equal(desk.scope().length,6);
 desk.dispose();
});

test('teacher personal scores remain separate from missing-bank legacy school rows',()=>{
 const {desk,preferences}=fixture();preferences.course='all';
 const base={course:'all',ruleset:'net-1.1',reason:'health',assisted:false,turns:6,date:1,result:'win',attempts:2,correct:1,mode:'pve'};
 desk.data.onlineRecords=[{...base,id:'school',grade:6,score:777},{...base,id:'teacher',bank:'teacher-academic',grade:null,score:888}];
 let html=desk.recordsHtml();assert.match(html,/777分/);assert.doesNotMatch(html,/888分/);
 preferences.bank='teacher-academic';html=desk.recordsHtml();assert.match(html,/教师内测/);assert.match(html,/888分/);assert.doesNotMatch(html,/777分/);desk.dispose();
});

test('academic passage is escaped and unavailable audio is honestly disabled',()=>{
 const {desk}=fixture();desk.question={question:{bank:'teacher-academic',unitLabel:'学术阅读',prompt:'What follows?',passage:'A < B & the evidence is limited.',text:'Choose the supported inference.',options:[{id:'one',text:'Only a limited conclusion.'},{id:'two',text:'Any conclusion.'}],listenAudioUrl:null}};
 const html=desk.studyHtml();assert.match(html,/academic-passage/);assert.match(html,/A &lt; B &amp; the evidence/);assert.match(html,/data-action="desk-listen" disabled/);assert.match(html,/暂不提供录制朗读/);assert.doesNotMatch(html,/< B/);desk.dispose();
});

test('camp communicates teacher scope without representing it as another school grade',()=>{
 const {preferences,desk}=fixture();preferences.bank='teacher-academic';
 const html=lobbyView({preferences,practice:true,difficulty:'轻松练习',connected:true});
 assert.match(html,/教师内测 · 学术英语/);assert.doesNotMatch(html,/null年级|7年级/);assert.match(html,/森林电脑试玩/);desk.dispose();
});
