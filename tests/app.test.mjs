import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { domHarness } from "./dom-harness.mjs";
const dir = fileURLToPath(new URL("../src", import.meta.url));
test("double answer clicks award exactly one attempt and one effect", () => {
  const h = domHarness(dir);
  h.run("startReady('DOUBLE');openQuestion('spark','hero')");
  h.run("handleAnswer(QUESTIONS.find(q=>q.id===prompt.qid).answer)");
  const before = h.run("JSON.stringify(save)");
  h.run("handleAnswer(0)");
  assert.equal(h.run("JSON.stringify(save)"), before);
  assert.equal(h.run("save.match.attempts"), 1);
  assert.equal(h.run("save.match.players[1].hp"), 16);
});
test("finished battle does not accept questions or alter score", () => {
  const h = domHarness(dir);
  h.run(
    "startReady('END');save.match.players[1].hp=0;save.match.winner=0;save.match.phase='finished';showResult();modal=null",
  );
  const before = h.run("JSON.stringify(save)");
  h.click("ritual", { value: "spark" });
  assert.equal(h.run("selected"), null);
  h.run(
    "prompt={kind:'spark',target:'hero',qid:'g1-v01',answer:null};handleAnswer(0)",
  );
  assert.equal(h.run("JSON.stringify(save)"), before);
});
test("cross-tab storage event refreshes records and cancels stale selections", () => {
  const h = domHarness(dir);
  h.run("startReady('LOCAL');selected={type:'card',index:0}");
  const newer = JSON.parse(h.run("JSON.stringify(save)"));
  newer.nickname = "NewLeaf";
  newer.grade = 6;
  const raw = JSON.stringify(newer);
  h.storage.set("spellwood.save.v2", raw);
  h.windowEvents.storage({ key: "spellwood.save.v2", newValue: raw });
  assert.equal(h.run("save.nickname"), "NewLeaf");
  assert.equal(h.run("save.grade"), 6);
  assert.equal(h.run("selected"), null);
  assert.equal(h.run("lastStoredRaw"), raw);
});
test("write-time conflict preserves newer save instead of overwriting", () => {
  const h = domHarness(dir);
  h.run("startReady('LOCAL')");
  const newer = JSON.parse(h.run("JSON.stringify(save)"));
  newer.nickname = "Newest";
  const raw = JSON.stringify(newer);
  h.storage.set("spellwood.save.v2", raw);
  h.run("save.nickname='Stale';persist()");
  assert.equal(h.storage.get("spellwood.save.v2"), raw);
  assert.equal(h.run("save.nickname"), "Newest");
});
test("unload has no stale automatic storage write", () => {
  const h = domHarness(dir);
  assert.equal(h.windowEvents.beforeunload, undefined);
});
test("bad save is preserved for recovery and quota failure blocks overwrite", () => {
  const h = domHarness(dir, { raw: "{BROKEN" });
  assert.equal(h.storage.get("spellwood.save.v2.recovery"), "{BROKEN");
  h.click("settings");
  assert.ok(h.app.innerHTML.includes("export-recovery"));
  const q = domHarness(dir, { raw: "{BROKEN", failWrites: true });
  q.run("persist()");
  assert.equal(q.storage.get("spellwood.save.v2"), "{BROKEN");
});
test("hero accessible name escapes nickname and clamps overkill HP", () => {
  const h = domHarness(dir);
  h.run(
    "startReady('X');save.nickname='x\" data-bad=\"';save.match.players[1].hp=-2;render()",
  );
  assert.ok(!h.app.innerHTML.includes('aria-label="x" data-bad="'));
  assert.ok(h.app.innerHTML.includes("生命0，护甲"));
});
test("mobile icon navigation retains meaningful labels", () => {
  const h = domHarness(dir);
  assert.ok(
    h.app.innerHTML.includes('data-action="book" aria-label="词灵手册"'),
  );
  assert.ok(
    h.app.innerHTML.includes('data-action="ranks" aria-label="挑战榜"'),
  );
});
test("ranking keeps only best run per nickname and identical scenario", () => {
  const h = domHarness(dir);
  h.run(
    "for(let i=0;i<3;i++){const s=createMatch({seed:'same'});s.phase='finished';s.winner=0;s.correct=i;addRecord(save,s)};modal='ranks';render()",
  );
  assert.equal((h.app.innerHTML.match(/class="rank-row"/g) || []).length, 1);
  assert.equal(h.run("save.records.length"), 3);
});
test("unanswered speech does not reveal a completed blank", () => {
  const h = domHarness(dir);
  h.click("speak", { value: "pep1-g6-s1-u1-q4" });
  assert.ok(h.window.spoken.includes("…"));
  assert.ok(!h.window.spoken.includes("famous for"));
  h.click("speak", { value: "pep1-g1-s1-u1-q1" });
  for (const option of h.Q[0].options)
    assert.ok(h.window.spoken.includes(option));
});
test("review prioritizes overdue errors over unseen items", () => {
  const h = domHarness(dir);
  h.run(
    "save.mastery['pep1-g1-s1-u1-q1']={seen:1,correct:0,streak:0,last:1,due:1};nextReview()",
  );
  assert.equal(h.run("reviewQ.id"), "pep1-g1-s1-u1-q1");
});
test("second target click during an attack cannot open opponent details", () => {
  const h = domHarness(dir);
  h.run(
    "startReady('DOUBLE-TARGET');save.match.players[0].board=[{uid:'u9',cardId:'sprout',atk:1,hp:3,maxHp:3,ready:true}];selected={type:'unit',uid:'u9'}",
  );
  h.click("target", { target: "hero" });
  assert.equal(h.run("locked"), true);
  h.click("target", { target: "hero" });
  assert.equal(h.run("modal"), null);
  assert.equal(h.run("save.match.players[1].hp"), 17);
});
test("opening settings during an effect ends visuals without reverting the action", () => {
  const h = domHarness(dir);
  h.run(
    "startReady('INTERRUPT');save.match.players[0].board=[{uid:'u9',cardId:'sprout',atk:1,hp:3,maxHp:3,ready:true}];selected={type:'unit',uid:'u9'}",
  );
  h.click("target", { target: "hero" });
  h.click("settings");
  assert.equal(h.run("locked"), false);
  assert.equal(h.run("visualMatch"), null);
  assert.equal(h.run("modal"), "settings");
  assert.equal(h.run("save.match.players[1].hp"), 17);
});
test("empty-text sentence tasks read all options before, completed phrase only after", () => {
  const h = domHarness(dir);
  const q = h.Q.find((q) => q.type === "sentence" && !q.text);
  h.click("speak", { value: q.id });
  for (const option of q.options) assert.ok(h.window.spoken.includes(option));
  h.run(`reviewQ=QUESTIONS.find(q=>q.id==='${q.id}');reviewAnswer=${q.answer}`);
  h.click("speak", { value: q.id });
  assert.equal(h.window.spoken, q.speak);
});
test("learning range is fixed in a match and review respects selected unit", () => {
  const h = domHarness(dir);
  h.run("save.course='s2-u3';startReady('RANGE')");
  assert.equal(h.run("save.match.course"), "s2-u3");
  assert.equal(h.run("questionFor(save.match,QUESTIONS).unitId"), "g1-s2-u3");
  h.run("bookGrade=3;bookCourse='s1-u2';nextReview()");
  assert.equal(h.run("reviewQ.unitId"), "g3-s1-u2");
});
test("course and content versions are separate ranking scenarios", () => {
  const h = domHarness(dir);
  h.run(
    "for (const course of ['s1','s2']) {const s=createMatch({seed:'same',course});s.phase='finished';s.winner=0;addRecord(save,s)}; const old=createMatch({seed:'old'});old.phase='finished';old.winner=0;old.contentVersion='general-1.0';addRecord(save,old);modal='ranks';render()",
  );
  assert.equal((h.app.innerHTML.match(/class="rank-row"/g) || []).length, 2);
  h.click("rank-content", { value: "archive" });
  assert.equal((h.app.innerHTML.match(/class="rank-row"/g) || []).length, 1);
});
test("legacy mastery and in-progress battle migrate without inventing new mastery", () => {
  const h = domHarness(dir);
  const old = JSON.parse(h.run("JSON.stringify(freshSave())"));
  old.mastery = {
    "g1-v01": { seen: 2, correct: 1, streak: 1, last: 123, due: 456 },
  };
  delete old.archivedMastery;
  delete old.course;
  old.match = JSON.parse(
    h.run("JSON.stringify(createMatch({seed:'OLD-SAVE'}))"),
  );
  delete old.match.contentVersion;
  delete old.match.course;
  old.match.review = ["g1-v01"];
  old.match.players[0].hp = 13;
  const next = domHarness(dir, { raw: JSON.stringify(old) });
  assert.equal(next.run("save.archivedMastery['g1-v01'].seen"), 2);
  assert.equal(next.run("Object.keys(save.mastery).length"), 0);
  assert.equal(next.run("save.match.players[0].hp"), 13);
  assert.equal(next.run("save.match.contentVersion"), "legacy-mixed");
  assert.equal(next.run("save.match.archivedReview[0]"), "g1-v01");
  next.run("persist()");
  const again = domHarness(dir, { raw: next.storage.get("spellwood.save.v2") });
  assert.equal(again.run("save.archivedMastery['g1-v01'].seen"), 2);
});
for (const correct of [true, false])
  test(`ritual ${correct ? "correct" : "wrong"} path settles, shows feedback and unlocks once`, async () => {
    const h = domHarness(dir);
    h.run("startReady('ASYNC-ANSWER');openQuestion('spark','hero')");
    const p = h.run(
      `handleAnswer((QUESTIONS.find(q=>q.id===prompt.qid).answer+${correct ? 0 : 1})%3)`,
    );
    await h.settle(p);
    assert.equal(h.run("locked"), false);
    assert.equal(h.run("save.match.attempts"), 1);
    assert.equal(h.run("save.match.players[1].hp"), correct ? 16 : 18);
    assert.equal(h.run("save.match.players[0].armor"), correct ? 0 : 1);
    assert.ok(h.app.innerHTML.includes("继续对战"));
    assert.ok(h.app.innerHTML.includes("知识范围：本单元课本第"));
    h.click("continue");
    assert.equal(h.run("prompt"), null);
  });
test("hand browsing preserves scroll through selection but resets for a new match", () => {
  const h = domHarness(dir);
  h.run("startReady('BROWSE');save.match.players[0].mana=6");
  h.click("hand-next");
  assert.equal(h.handNode.scrollLeft, 166);
  h.click("card", { index: "0" });
  assert.equal(h.handNode.scrollLeft, 166);
  h.run("render()");
  assert.equal(h.handNode.scrollLeft, 166);
  h.click("hand-prev");
  assert.equal(h.handNode.scrollLeft, 0);
  h.click("hand-next");
  h.run("startReady('NEW-HAND')");
  assert.equal(h.handNode.scrollLeft, 0);
});
test("unaffordable hand cards can be inspected but not played", () => {
  const h = domHarness(dir);
  h.run(
    "startReady('INSPECT');save.match.players[0].hand=['dragon'];save.match.players[0].mana=1;render()",
  );
  h.click("card", { index: "0" });
  assert.equal(h.run("selected.index"), 0);
  assert.ok(h.app.innerHTML.includes("需要5点能量"));
  assert.equal(h.run("save.match.players[0].hand.length"), 1);
});
test("new rituals cannot open when full health or charges are exhausted", () => {
  const h = domHarness(dir);
  h.run("startReady('LIMITED');openQuestion('bloom')");
  assert.equal(h.run("prompt"), null);
  h.run("save.match.players[0].ritualsLeft=0;openQuestion('spark')");
  assert.equal(h.run("prompt"), null);
});
test("legacy rule scores remain accessible in the archive after the rules update", () => {
  const h = domHarness(dir);
  h.run(
    "const old=createMatch({seed:'LEGACY-RANK'});old.rules='1.0';old.phase='finished';old.winner=0;addRecord(save,old);modal='ranks';rankContent='archive';render()",
  );
  assert.ok(h.app.innerHTML.includes("LEGACY-RANK"));
  assert.ok(h.app.innerHTML.includes("规则1.0"));
});
test("empty deck and hand explain the next fatigue cost rather than promise a new card", () => {
  const h = domHarness(dir);
  h.run(
    "startReady('EMPTY');save.match.players[0].hand=[];save.match.players[0].deck=[];save.match.players[0].fatigue=2;render()",
  );
  assert.ok(h.app.innerHTML.includes("下次抽牌将受3点疲劳伤害"));
  assert.ok(!h.app.innerHTML.includes("会迎来新的伙伴"));
});
test("early-word pictures are restricted to matching grade-one meanings without English labels", () => {
  const h = domHarness(dir);
  const picture = h.run("questionVisual(QUESTIONS[0])");
  assert.ok(picture.includes("learning-atlas"));
  assert.ok(!picture.includes("book"));
  assert.equal(h.run("questionVisual(QUESTIONS.find(q=>q.grade===2))"), "");
  assert.equal(
    (
      h
        .run(
          "questionVisual(QUESTIONS.find(q=>q.grade===1&&q.target==='eight'))",
        )
        .match(/<i>/g) || []
    ).length,
    8,
  );
});
test("closing a modal restores its recreated opener, not a detached node", () => {
  const h = domHarness(dir);
  h.run(
    `let oldFocused=false,newFocused=false;document.activeElement={dataset:{action:'settings'},focus(){oldFocused=true}};openModal('settings');document.querySelectorAll=()=>[{dataset:{action:'settings'},focus(){newFocused=true}}];closeModal()`,
  );
  assert.equal(h.run("oldFocused"), false);
  assert.equal(h.run("newFocused"), true);
});
test("ordinary rerender preserves a still-present grade control focus", () => {
  const h = domHarness(dir);
  h.run(
    `let gradeFocused=false;document.activeElement={dataset:{action:'book-grade',value:'2'}};document.querySelectorAll=()=>[{dataset:{action:'book-grade',value:'2'},focus(){gradeFocused=true}}];render()`,
  );
  assert.equal(h.run("gradeFocused"), true);
});
test("returning to a visible tab schedules a paused computer turn", () => {
  const h = domHarness(dir);
  h.run(
    "startReady('VIS');save.match=act(save.match,{type:'end'});document.hidden=true;scheduleAI()",
  );
  const before = h.pendingTimers();
  h.run("document.hidden=false");
  h.documentEvents.visibilitychange();
  assert.equal(h.pendingTimers(), before + 1);
});
test("longer cloze tasks use a compact header without removing the English passage or options", () => {
  const h = domHarness(dir);
  const q = h.Q.find((q) => q.grade === 6 && q.type === "cloze");
  h.run(
    `startReady('LONG-TEXT');prompt={qid:${JSON.stringify(q.id)},kind:'spark',target:'hero',answer:null};render()`,
  );
  assert.ok(h.app.innerHTML.includes("spell-sheet context-task"));
  for (const option of q.options) assert.ok(h.app.innerHTML.includes(option));
  assert.ok(h.app.innerHTML.includes(q.text.split("___")[0]));
});
test("ritual targeting explains that spells bypass guard while attacks do not", () => {
  const h = domHarness(dir);
  h.run("startReady('TARGET-HINT');selected={type:'ritual'};render()");
  assert.ok(h.app.innerHTML.includes("不受守卫阻挡"));
  h.run("selected={type:'unit',uid:'u1'};render()");
  assert.ok(h.app.innerHTML.includes("先突破守卫，再直击英雄"));
});
test("two corrected errors yield to new material and the empty due state is explicit", () => {
  const h = domHarness(dir);
  h.run(`openModal('book');bookGrade=1;bookCourse='s1-u1';
    for(const q of QUESTIONS.filter(q=>q.unitId==='g1-s1-u1').slice(0,2)) recordLearning(save,q,false);
    nextReview();`);
  const served = [];
  for (let i = 0; i < 2; i++) {
    served.push(h.run("reviewQ.id"));
    h.click("review-answer", { index: String(h.run("reviewQ.answer")) });
    h.click("review-next");
  }
  assert.equal(new Set(served).size, 2);
  assert.ok(!served.includes(h.run("reviewQ.id")));
  assert.equal(h.run("masterySummary(save,QUESTIONS,1,'s1-u1').due"), 0);
  h.click("review-back");
  assert.match(h.app.innerHTML, /到期内容已复习完/);
  h.click("ranks");
  assert.match(h.app.innerHTML, /近200局内个人最佳/);
  assert.match(h.app.innerHTML, /所有年级合计只保留最近200局/);
});
for (const oldRules of ["1.0", "2.0"])
  test(`the ${oldRules} result replay clearly upgrades and keeps the scenario`, () => {
    const h = domHarness(dir);
    h.run(`startReady('HISTORIC-REPLAY',{grade:6,course:'s2-u3',deckId:'moon',opponentId:'ember'});
    save.match.rules='${oldRules}';
    save.match.players[1].hp=0;save.match.winner=0;save.match.phase='finished';showResult();render();
    var notices=[];toast=t=>notices.push(t);`);
    assert.match(h.app.innerHTML, /用新版再玩/);
    assert.match(h.app.innerHTML, /原成绩保留，新分数另记/);
    h.click("replay");
    assert.equal(h.run("save.match.rules"), h.run("RULES"));
    assert.equal(h.run("save.match.grade"), 6);
    assert.equal(h.run("save.match.course"), "s2-u3");
    assert.equal(h.run("save.match.seed"), "HISTORIC-REPLAY");
    assert.equal(h.run("save.match.deckId"), "moon");
    assert.equal(h.run("save.match.opponentId"), "ember");
    assert.equal(h.run("save.match.opening.player"), null);
    assert.equal(h.run("save.records.length"), 1);
    assert.equal(h.run("save.records[0].rules"), oldRules);
    assert.match(h.run("notices[0]"), /新版规则和题库/);
  });
test("a review round ends at six unique items even when every item is already scheduled", () => {
  const h = domHarness(dir);
  h.run(`openModal('book');bookGrade=1;bookCourse='s1-u1';
    for(const q of QUESTIONS.filter(q=>q.unitId==='g1-s1-u1')) recordLearning(save,q,true);
    for(const q of QUESTIONS.filter(q=>q.unitId==='g1-s1-u1').slice(0,2)) recordLearning(save,q,false);`);
  h.click("review-start");
  const ids = [];
  for (let i = 0; i < 6; i++) {
    ids.push(h.run("reviewQ.id"));
    h.click("review-answer", { index: String(h.run("reviewQ.answer")) });
    h.click("review-next");
  }
  assert.equal(new Set(ids).size, 6);
  assert.equal(h.run("reviewQ"), null);
  assert.equal(h.run("reviewComplete"), true);
  assert.match(h.app.innerHTML, /这一轮结束啦/);
  assert.equal(h.run("reviewRoundAttempts"), 6);
  assert.equal(h.run("reviewRoundCorrect"), 6);
  assert.equal(h.run("masterySummary(save,QUESTIONS,1,'s1-u1').due"), 0);
  h.click("review-start");
  assert.equal(h.run("reviewSeen.size"), 1);
  assert.equal(h.run("reviewRoundAttempts"), 0);
});
test("skipping a short review round is not a learning attempt, and reopening starts fresh", () => {
  const h = domHarness(dir);
  h.click("book");
  h.click("review-start");
  for (let i = 0; i < 6; i++) h.click("review-next");
  assert.equal(h.run("reviewComplete"), true);
  assert.equal(h.run("Object.keys(save.mastery).length"), 0);
  assert.equal(h.run("reviewRoundAttempts"), 0);
  h.click("close");
  h.click("book");
  assert.equal(h.run("reviewComplete"), false);
  h.click("review-item", { value: "pep1-g1-s1-u1-q2" });
  assert.equal(h.run("reviewSeen.size"), 1);
  assert.equal(h.run("reviewQ.id"), "pep1-g1-s1-u1-q2");
});
test("returning to camp does not abandon a match and record replay explains the requirement accurately", () => {
  const h = domHarness(dir);
  h.run("startReady('STILL-OPEN');var notices=[];toast=t=>notices.push(t)");
  const id = h.run("save.match.id");
  h.click("home");
  h.click("replay-record", { value: "missing" });
  assert.match(h.run("notices.at(-1)"), /当前还有未完成对局，请先完成/);
  assert.doesNotMatch(h.run("notices.at(-1)"), /离开/);
  assert.equal(h.run("save.match.id"), id);
});
test("battle learning and ranking navigation follows the actual match rather than changed camp preferences", () => {
  const h = domHarness(dir);
  h.run("save.grade=6;save.course='s2-u4';startReady('NAV-CONTEXT')");
  h.click("home");
  h.click("grade", { value: "1" });
  assert.match(h.app.innerHTML, /继续6年级/);
  assert.match(h.app.innerHTML, /下册 U4/);
  h.click("resume");
  h.click("book");
  assert.equal(h.run("bookGrade"), 6);
  assert.equal(h.run("bookCourse"), "s2-u4");
  h.click("close");
  h.click("ranks");
  assert.equal(h.run("rankGrade"), 6);
  assert.equal(h.run("rankContent"), "current");
  h.click("close");
  h.click("home");
  h.click("book");
  assert.equal(h.run("bookGrade"), 1);
  assert.equal(h.run("bookCourse"), h.run("save.course"));
});
test("legacy result review and ranking use its true grade and historical rule", () => {
  const h = domHarness(dir);
  h.run(
    "save.grade=6;save.course='s2-u4';startReady('OLD-NAV');save.match.rules='2.0';save.grade=1;save.match.players[1].hp=0;save.match.winner=0;save.match.phase='finished';showResult();render()",
  );
  h.click("book");
  assert.equal(h.run("bookGrade"), 6);
  assert.equal(h.run("bookCourse"), "s2-u4");
  h.click("close");
  h.click("ranks");
  assert.equal(h.run("rankGrade"), 6);
  assert.equal(h.run("rankContent"), "archive");
  assert.equal(h.run("rankHistoryRule"), "2.0");
});
test("returning from curriculum information preserves the manually selected review scope", () => {
  const h = domHarness(dir);
  h.click("book");
  h.click("book-grade", { value: "6" });
  h.run("bookCourse='s2-u4'");
  h.click("curriculum");
  assert.match(h.app.innerHTML, /data-action="return-book"/);
  h.click("return-book");
  assert.equal(h.run("bookGrade"), 6);
  assert.equal(h.run("bookCourse"), "s2-u4");
  assert.equal(h.run("modal"), "book");
});
