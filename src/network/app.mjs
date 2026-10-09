import { unitLabelWidth } from "./unit-label-width.mjs";
import { restoreModalOpener } from "./focus-return.mjs";
import { TEACHER_CATEGORIES } from "../question-banks.mjs";
import { HandScene } from "../arena3d/hand-scene.mjs";
import { LobbyScene } from "../arena3d/lobby-scene.mjs";
import { lobbyView } from "./lobby-view.mjs";
import { ArenaScene } from "../arena3d/scene.mjs";
import { DuelConnection, isPractice, studyFetch } from "./runtime.mjs";
import { CARD, CARDS, DECKS, GRADES, validateCustomDeck } from "../cards.mjs";
import { selectDifficulty } from "../combat-rating.mjs";
import { SOUND } from "./audio.mjs";
import { PictureReadiness } from "../av/pictures.mjs";
import { StudyDesk } from "./study-desk.mjs";
import { playSceneSound } from "./scene-audio.mjs";
import { targetPreview } from "../arena3d/targeting.mjs";
import { ServerClock, durationText } from "./deadlines.mjs";
import { cardGuide } from "../card-guide.mjs";
import { boardCardInspection, isInspectionKey } from "./card-inspection.mjs";
import { BoardInput } from "../arena3d/board-input.mjs";
import { CardLibrary, artThumb, cardArtUrl } from "./card-library.mjs";
import { CollectionView } from "./collection-view.mjs";
import { rewardView, savedDailySummary } from "./reward-view.mjs";
import { WardrobeView } from "./wardrobe-view.mjs";
import { getHeroSkin } from "../hero-skins.mjs";
import { selectedCardOption, selectedCardReason, cardTargetAllowed, selectedTargetIds, answerCommand, drawFeedbackText } from "./battle-options.mjs";
import { equippedFinishes, rewardBalance, COLLECTION_TEST_MODE } from "../collection.mjs";
import { IdentityClient } from './identity-client.mjs';
import { IdentityPanel } from './identity-view.mjs';
import { RemoteProgressStore } from './remote-progress.mjs';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ui = $("#interface"), layer = $("#unit-labels"), modalRoot = $("#modal-root");
let connectionRetries = 0;
let connectionState = "connecting", session = null, room = null, displayRoom = null, waiting = false;
let preferences = { bank: "school", teacherCourse: "all", combatMode: "adaptive", customDeck: null, grade: 1, course: "s1", deckId: "grove", sound: true, music: true, musicVolume: 35, soundVolume: 65, speech: true, reduced: false };
let selected = null, openingSelection = [], commandBusy = false, challenge = null, feedback = null, panel = null;
let rendererStatus = { available: null }, timer = null, voice = null, voiceTimer = null, voiceEpoch = 0, scene;
const pendingLearning = new Map();
const pictures = new PictureReadiness();
let sceneRevision = null, latestRoom = null, sceneTransition = Promise.resolve(), visibleEvents = new Set(), sceneEpoch = 0;
let lastBattleFeedback = null, recapExpanded = false;
let visualBusy = false;
let labelSignature = "", renderedModalKey = null, renderedFeedback = false, renderedModalHTML = null;
let renderedSelection = "", sceneFault = false;
let desk, rewardDayTimer = null, deadlineTimer = null, collectionView, wardrobeView, handScene, lobbyScene;
let identityClient=null, identityPanel=null, activeIdentity=null, identityEpoch=0, identityChannel=null, identityRefreshPending=false;
let identityVerified = isPractice, identityCheckError = "", identityCheckTask = null;
let handIntroductionShown = false;
let pageSuspended = false;
let inspectCardId = null, inspectHandId = null, inspectUnitRef = null, modalOpener = null, handStatus = {available:null}, lobbyStatus = {available:null}, handSemanticKey = null;
const library=new CardLibrary({preferences:()=>preferences,onChange:()=>render(),onNotice:notice,onClose:()=>{panel=null;render();},onSave:async customDeck=>{const result=await desk?.preferences({deckId:"custom",customDeck});if(result?.ok){preferences.deckId="custom";preferences.customDeck=customDeck;return true;}return false;}});
const serverClock = new ServerClock();
const finishSaves = new Set();
function savePreferences(patch) { void desk?.preferences(patch); }
function openDesk(view) {
  if (waiting || room && room.phase !== "finished") { notice("对局结束后再打开学习手册与备份"); return; }
  panel = view; desk.open(view); cancelVoice();
}

function deadlineText(deadline, kind) {
  const remaining = serverClock.remaining(deadline);
  if (remaining === null) return "正在同步时间";
  if (remaining === 0) return kind === "opening" ? "正在确认起手" : "正在同步回合";
  return `${kind === "opening" ? "起手" : kind === "question" ? "答题" : "回合"}还有 ${durationText(remaining)}`;
}
function deadlineTag(deadline, kind = "turn") {
  if (!Number.isFinite(deadline)) return "";
  return `<span class="deadline" data-deadline="${deadline}" data-clock-kind="${kind}" aria-live="off">${deadlineText(deadline, kind)}</span>`;
}
function refreshDeadlines() {
  clearTimeout(deadlineTimer); deadlineTimer = null;
  for (const element of document.querySelectorAll("[data-deadline]")) element.textContent = deadlineText(Number(element.dataset.deadline), element.dataset.clockKind);
  if (room && ["opening", "playing"].includes(room.phase) && !document.hidden && !pageSuspended) deadlineTimer = setTimeout(refreshDeadlines, 1000);
}

function notice(text, kind = "general") {
  $("#notice").dataset.kind = kind;
  $("#notice").textContent = text;
  clearTimeout(timer); timer = setTimeout(() => { $("#notice").textContent = ""; }, 4200);
}
function cancelVoice() { voiceEpoch++; clearTimeout(voiceTimer); voiceTimer = null; if (voice) { voice.pause(); voice.remove(); voice = null; } SOUND.duckSpeech(false); }
function listen(urls) {
  if (voice || voiceTimer) { cancelVoice(); return; }
  cancelVoice(); if (!preferences.speech || !urls || document.hidden) return;
  const list = (Array.isArray(urls) ? urls : [urls]).filter((u) => /^\/assets\/speech\/[a-f0-9]{16}\.mp3$/.test(u));
  const epoch = voiceEpoch;
  function play(index) {
    voiceTimer = null; if (epoch !== voiceEpoch) return;
    if (index >= list.length) { cancelVoice(); render(); return; }
    const a = new Audio(list[index]); voice = a; a.id = "network-english-audio"; a.hidden = true; document.body.appendChild(a);
    a.addEventListener("playing", () => { if (epoch === voiceEpoch) SOUND.duckSpeech(true); });
    a.addEventListener("ended", () => { if (epoch !== voiceEpoch) return; a.remove(); voice = null; voiceTimer = setTimeout(() => play(index + 1), 400); });
    a.addEventListener("error", () => { if (epoch === voiceEpoch) { cancelVoice(); notice("英语音频暂未加载，请先阅读题目"); render(); } });
    a.play().catch(() => { if (epoch === voiceEpoch) { cancelVoice(); notice("请再点一次朗读"); render(); } });
  }
  play(0);
}

const link = new DuelConnection({
  getJourney: () => desk?.data?.journey,
  onConnection(info) {
    connectionState = info.state; if(info.state === "incompatible") notice("版本已更新，请刷新页面后继续"); connectionRetries = info.retry || 0;
    if (info.state === "replaced") { selected = null; if (room) { challenge = feedback = null; panel = null; cancelVoice(); } }
    if (info.state === "expired") clearRoom(isPractice ? "临时连接已结束，请重新匹配。本机学习记录仍保留。" : "对局连接已结束，请重新匹配。已保存的账号记录仍保留。");
    if (!isPractice && info.state === 'expired' && identityClient && !identityClient.state.busy) void verifyIdentity();
    render();
  },
  onMessage(message) {
    if (message.type === "session.ready") {
      if (!isPractice && activeIdentity && message.playerId !== activeIdentity.playerId) {
        link.disconnect();void verifyIdentity();return;
      }
      session = message; waiting = false; desk?.sessionReady(message);
      if (message.roomId === null && room) clearRoom("上次临时房间已结束，可以重新匹配");
    }
    if (message.type === "queue.status") {
      waiting = message.status === "waiting";
      if(message.reason==='PROGRESS_UNAVAILABLE')notice('账号记录暂时不可用，请稍后再匹配');
    }
    if (message.type === 'progress.updated') void desk?.refresh();
    if (message.type === "session.error") { waiting = false; notice("临时连接已结束，请重新连接。未完成房间不能从本机备份恢复。"); }
    if (message.type === "room.snapshot") acceptSnapshot(message);
    if (message.type === "room.expired" && room?.roomId === message.roomId) clearRoom("临时房间已结束，可以重新匹配");
    if (message.type === "private.challenge" && room?.roomId === message.roomId && room.phase !== "finished") { cancelVoice(); challenge = message; desk?.beginAttention(message.challengeId,"match",message.issuedAt); feedback = null; recapExpanded = false; selected = null; }
    if (message.type === "private.feedback") {
      if (message.learning) { pendingLearning.set(message.challengeId, message); desk?.receiveFeedback(message); }
      if (message.roomId === room?.roomId) lastBattleFeedback = message;
      if (challenge?.challengeId === message.challengeId) { cancelVoice(); feedback = message; recapExpanded = false; }
    }
    render();
  },
});

function stateForScene(s) {
  return s.state || { phase: s.phase, active: s.activeSeat, turn: s.turn, players: s.youSeat === 0 ? [s.self, s.opponent] : [s.opponent, s.self] };
}
function clearRoom(message) {
  sceneEpoch++; scene?.cancel(); sceneTransition = Promise.resolve();
  visualBusy = false; serverClock.reset();
  if(challenge?.challengeId)void desk?.finishAttention(challenge.challengeId);
  room = latestRoom = displayRoom = null; challenge = feedback = lastBattleFeedback = null;
  selected = null; recapExpanded = false; openingSelection = []; panel = null; waiting = false; sceneRevision = null;
  visibleEvents.clear(); cancelVoice();
  try { scene?.showGallery(); sceneFault = false; } catch { sceneFault = true; }
  if (message) notice(message);
}
function applySceneState(next) {
  displayRoom = next;
  scene?.setHeroSkins?.({self:next.self.skinId,opponent:next.opponent.skinId});
  try { scene?.setBattle(stateForScene(next), next.youSeat); sceneFault = false; }
  catch (error) { sceneFault = true; notice("场景暂时未能完整显示，已保留简化操作"); console.warn("Scene synchronization failed", error.message); }
}
function acceptSnapshot(next) {
  const previous = room;
  if (previous?.roomId === next.roomId && next.revision < previous.revision) return;
  serverClock.sync(next.serverTime);
  room = latestRoom = next; waiting = false;
  if (selected?.kind === "card" && previous?.roomId === next.roomId && (previous.self.handIds?.[selected.index] !== next.self.handIds?.[selected.index] || previous.self.hand[selected.index] !== next.self.hand[selected.index])) selected = null;
  const event = next.event || next.events?.at(-1);
  const eventId = event?.eventId || event?.id;
  const animate = eventId && !visibleEvents.has(eventId) && !next.resync && previous?.roomId === next.roomId;
  const terminalMotion = next.phase === "finished" && previous?.phase === "playing" && animate && ["attack", "play", "ritual"].includes(event.kind);
  const replaceScene = next.resync || previous?.roomId !== next.roomId || (next.phase === "finished" && previous?.phase !== "finished" && !terminalMotion);
  if (previous?.roomId !== next.roomId) { openingSelection = []; selected = null; panel = null; inspectCardId = null; inspectHandId = null; inspectUnitRef = null; challenge = null; feedback = null; lastBattleFeedback = null; visibleEvents.clear(); sceneRevision = null; }
  if (replaceScene) { sceneEpoch++; scene?.cancel(); sceneTransition = Promise.resolve(); visualBusy = false; }
  if (eventId) { visibleEvents.add(eventId); if (visibleEvents.size > 128) visibleEvents.delete(visibleEvents.values().next().value); }
  if (replaceScene) {
    sceneRevision = next.revision;
    applySceneState(next);
  } else if (next.revision !== sceneRevision) {
    sceneRevision = next.revision;
    const epoch = sceneEpoch;
    visualBusy = true;
    sceneTransition = sceneTransition.catch(() => {}).then(async () => {
      if (epoch !== sceneEpoch) return;
      try {
      if (animate && scene?.present) {
        await scene.present(stateForScene(next), event, () => { if (epoch === sceneEpoch) { displayRoom = next; labelSignature = ""; render(); } });
      } else if (animate && (event.kind === "attack" || event.type === "attack")) {
        const actor = event.actorSeat ?? event.seat;
        const source = event.sourceUid || event.uid;
        const target = event.targetUid || (Number.isInteger(event.targetSeat) ? `hero:${event.targetSeat}` : event.target === "hero" ? `hero:${1 - actor}` : event.target);
        if (source && target) await scene?.attack(source, target);
      }
      } catch (error) {
        if (epoch !== sceneEpoch) return;
        scene?.cancel(); notice("这段动画未能播放，战场数值已按最新结果同步");
        console.warn("Scene presentation failed", error.message);
      }
      if (epoch !== sceneEpoch) return;
      applySceneState(next);
      if (terminalMotion && !sceneFault) await scene?.celebrate?.([0,1].includes(next.result?.winnerSeat) ? next.result.winnerSeat === next.youSeat : null);
    }).catch((error) => {
      if (epoch !== sceneEpoch) return;
      displayRoom = next; sceneFault = true;
      try { scene?.cancel(); } catch {}
      notice("场景暂时未能完整显示，已保留简化操作");
      console.warn("Scene queue recovered", error.message);
    }).finally(() => {
      if (epoch === sceneEpoch && room?.revision === next.revision) { visualBusy = false; render(); }
    });
  }
  if (next.phase === "playing" && previous?.phase === "opening" && !handIntroductionShown) { handIntroductionShown=true; notice("点选手牌，长按看说明；左右滑动查看更多", "hand-tip"); }
  if (!displayRoom || !visualBusy && next.revision === displayRoom.revision) displayRoom = next;
  if (next.phase !== "opening") openingSelection = [];
  if (!next.canAct && selected?.kind !== "card") selected = null;
  if (next.phase === "finished") {
    const saveKey = `${next.roomId}:${next.youSeat}`;
    if (!finishSaves.has(saveKey)) { finishSaves.add(saveKey); desk?.receiveResult(next); }
    if(challenge?.challengeId)void desk?.finishAttention(challenge.challengeId);
    selected = null; challenge = null; feedback = null; panel = null; cancelVoice(); }
}

async function send(type, payload = {}, roomCommand = true) {
  if (commandBusy) return;
  commandBusy = true; render();
  try {
    await link.command(type, payload, roomCommand && room ? { roomId: room.roomId, expectedRevision: room.revision } : {});
    return true;
  } catch (e) {
    const messages = { NOT_YOUR_TURN: "现在是对手的回合", STALE_REVISION: "场面已更新，请按新场面操作", ILLEGAL_ACTION: "这个动作当前不可用", "not-connected": "连接恢复后才能行动", "pending-command": "上一动作正在确认" };
    notice(messages[e.code] || "这次操作没有提交，请按当前场面重试");return false;
  } finally { commandBusy = false; render(); }
}

function pick(item) {
  if (!room || room.phase !== "playing" || challenge || panel || commandBusy || visualBusy) return;
  if (item.kind === "card") {
    selected = selected?.kind === "card" && selected.index === item.index ? null : item;
  } else if (item.kind === "unit") {
    if (selected?.kind === "card") { target(item.uid,item.seat); }
    else if (item.seat === room.youSeat) selected = selected?.uid === item.uid ? null : { kind: "unit", uid: item.uid };
    else target(item.uid,item.seat);
  } else if (item.kind === "hero" && item.relativeSeat === 1) target("hero",1-room.youSeat);
  render();
}
function inspectUnit(item) {
  if (!room || room.phase !== "playing" || challenge || panel || commandBusy || visualBusy ||
      item.revision != null && item.revision !== room.revision || !boardCardInspection(room, item)) return;
  inspectUnitRef = {kind:"unit",uid:item.uid,seat:item.seat};
  inspectCardId = null; inspectHandId = null; panel = "card-info"; cancelVoice(); render();
}
function inspectHand(index) {
  if (!room || room.phase !== "playing" || challenge || panel || commandBusy || visualBusy || !CARD[room.self.hand[index]]) return;
  inspectUnitRef = null; inspectCardId = room.self.hand[index]; inspectHandId = room.self.handIds?.[index];
  panel = "card-info"; cancelVoice(); render();
}
function target(value, seat = 1-room.youSeat) {
  if (!selected || !room?.canAct || commandBusy || visualBusy || challenge || panel) return;
  if (selected.kind === "unit") send("battle.action", { action: { type: "attack", uid: selected.uid, target: value } });
  else if (selected.kind === "card") { if(!cardTargetAllowed(room,selected.index,value,seat)){notice("请选择亮起的合法目标");return;} send("battle.action", { action: { type: "play", index: selected.index, target: value } }); }
  else if (selected.kind === "ritual") send("ritual.begin", { kind: "spark", target: value });
  selected = null;
}

function header() {
  const label = connectionState === "ready" ? (rendererStatus.renderer?.startsWith("CPU") ? "兼容三维" : isPractice ? "三维试玩" : "已连接") : connectionState === "expired" ? "连接已结束" : connectionState === "replaced" ? "另一页已接管" : connectionRetries >= 3 ? "连接暂未恢复" : "连接中…";
  return `<header class="top"><a href="#" data-action="camp" class="wordmark"><span>✧</span><div>SPELLWOOD<small>词 灵 对 决</small></div></a><nav><span class="connection ${connectionState === "ready" ? "online" : ""}">${label}</span><button data-action="sound" aria-label="音乐${preferences.music ? "关闭" : "开启"}" title="背景音乐">${preferences.music ? "♫" : "♪"}</button><button data-action="help">玩法</button><button data-action="settings" aria-label="设置">⚙</button></nav></header>`;
}
const teacherLabels = { all: "全部学术英语 · 48项", ...Object.fromEntries(TEACHER_CATEGORIES.map(c => [c.id, `${c.label} · 12项`])) };
const teacherSelected = () => preferences.bank === "teacher-academic";
function bankControl() {
  return `<div class="question-bank-switch" role="group" aria-label="题库"><button data-action="question-bank" data-value="school" ${waiting || !desk?.canStart ? "disabled" : ""} aria-pressed="${!teacherSelected()}" class="${!teacherSelected() ? "chosen" : ""}">小学英语</button><button data-action="question-bank" data-value="teacher-academic" ${waiting || !desk?.canStart ? "disabled" : ""} aria-pressed="${teacherSelected()}" class="${teacherSelected() ? "chosen" : ""}">教师内测</button></div>${teacherSelected() ? '<p class="teacher-bank-note">研究生学术英语 · 原创48题。只切换题库，卡牌、对战与奖励规则相同。新增题暂不提供录制朗读。</p>' : ""}`;
}
function courseSelect() {
  if (teacherSelected()) return `<label>学术英语范围<select id="teacher-course">${Object.entries(teacherLabels).map(([id,label])=>`<option value="${id}" ${preferences.teacherCourse === id ? "selected" : ""}>${label}</option>`).join("")}</select></label>`;
  return `<label>学习范围<select id="course"><option value="all" ${preferences.course === "all" ? "selected" : ""}>全年级 · 72项</option>${[1, 2].map((s) => `<optgroup label="${s === 1 ? "上册" : "下册"}"><option value="s${s}" ${preferences.course === `s${s}` ? "selected" : ""}>${s === 1 ? "上册" : "下册"} · 36项</option>${[1, 2, 3, 4, 5, 6].map((u) => `<option value="s${s}-u${u}" ${preferences.course === `s${s}-u${u}` ? "selected" : ""}>${s === 1 ? "上册" : "下册"} Unit ${u} · 6项</option>`).join("")}</optgroup>`).join("")}</select></label>`;
}
function difficultyControl() {
  const plan=selectDifficulty(desk?.data?.combatRating,preferences.combatMode),profile=desk?.data?.combatRating;
  return `<label>${isPractice ? "电脑挑战" : "无人匹配时的电脑挑战"}<select id="combat-mode"><option value="adaptive" ${preferences.combatMode === "adaptive" ? "selected" : ""}>跟着我的进步调整</option><option value="easy" ${preferences.combatMode === "easy" ? "selected" : ""}>轻松练习</option><option value="standard" ${preferences.combatMode === "standard" ? "selected" : ""}>标准挑战</option></select></label><p class="difficulty-note">下一局：${esc(plan.name)}${plan.provisional ? ` · 定位中 ${Math.min(5,profile?.games||0)}/5` : ""} <button class="quiet" data-action="difficulty-info">怎么看强度</button></p>${plan.tutorial ? `<p class="first-game-guide">第一次来？先召唤低费伙伴，下回合选伙伴再点敌人。长按手牌可以看完整说明，轻松电脑会给你更多练习空间。</p>` : ""}`;
}
function rewardNow() { return desk?.store?.remote ? desk.store.rewardNow?.() ?? null : desk?.store?.now?.() ?? Date.now(); }
function scheduleRewardDay() {
  clearTimeout(rewardDayTimer);rewardDayTimer=null;
  if(document.hidden||pageSuspended||room)return;
  const summary=daily();const now=rewardNow();if(!summary||now===null)return;
  rewardDayTimer=setTimeout(()=>{render();},Math.max(100,Math.min(86400000,summary.endAt-now+50)));
}
function daily() { const now=rewardNow(); return now!==null && desk?.canStart ? savedDailySummary(desk.data,now) : null; }
function lobby() {
  const plan = selectDifficulty(desk?.data?.combatRating, preferences.combatMode);
  return lobbyView({preferences, waiting, connected:connectionState === "ready", name:session?.name, identity:activeIdentity, warning:desk?.issue || desk?.store?.dirty ? desk.warning() : null, testMode:COLLECTION_TEST_MODE, practice:isPractice, difficulty:plan.name, connectionState, connectionRetries, daily:daily(), equippedSkin:getHeroSkin(desk?.data?.journey?.equipped.skinId)});
}
function matchSetup() {
  return `<section class="dialog match-setup" role="dialog" aria-modal="true" aria-labelledby="match-title"><header><div><p class="eyebrow">YOUR NEXT ADVENTURE</p><h2 id="match-title">准备这次冒险</h2></div><button data-action="close-panel" aria-label="关闭准备面板">×</button></header><p class="intro">选好学习范围，带上熟悉的伙伴。</p>${bankControl()}${teacherSelected() ? "" : `<div class="grades" aria-label="年级">${GRADES.map((g) => `<button data-action="grade" data-value="${g.n}" class="${g.n === preferences.grade ? "chosen" : ""}" aria-pressed="${g.n === preferences.grade}">${g.n}<small>年级</small></button>`).join("")}</div>`}${courseSelect()}<label>我的套牌<select id="deck">${DECKS.map((d) => `<option value="${d.id}" ${d.id === preferences.deckId ? "selected" : ""}>${d.name} · ${d.sub}</option>`).join("")}${validateCustomDeck(preferences.customDeck) ? `<option value="custom" ${preferences.deckId === "custom" ? "selected" : ""}>我的自选套牌 · 20张</option>` : ""}</select></label>${difficultyControl()}<button class="primary match-button" data-action="match" ${connectionState !== "ready" || commandBusy || waiting || !desk?.canStart ? "disabled" : ""}>${waiting ? (isPractice ? "伙伴正在准备…" : "正在寻找对手…") : (isPractice ? "开始对战" : "开始匹配")}<span>✦</span></button>${waiting ? `<p role="status">${isPractice ? "森林电脑角色正在准备" : teacherSelected() ? "正在寻找相同教师题库与范围的对手" : "正在寻找相同年级与范围的对手"}</p><button class="quiet" data-action="cancel-match" ${commandBusy ? "disabled" : ""}>取消匹配</button>` : `<p class="subtle">${session ? `本局身份：${esc(session.name)} · 无需真实姓名` : "正在连接森林…"}</p>`}${["expired", "replaced"].includes(connectionState) ? '<button data-action="reconnect">重新连接</button>' : ""}<p class="save-state" role="status">${esc(desk?.warning() || (isPractice ? "正在读取本机记录…" : "正在读取账号记录…"))}</p>${connectionRetries >= 3 ? `<button data-action="retry-connection">重试连接</button><p class="subtle">请确认本地游戏服务器仍在运行。已有记录不会因重连被清除。</p>` : ""}<p class="camp-note">${isPractice ? "三维试玩 · 对手为电脑角色 · 记录仅存本机" : "全部卡牌已解锁 · 没有付费抽卡"}</p></section>`;
}
function hero(player, mine) {
  const shown = displayRoom?.roomId === room?.roomId ? (mine ? displayRoom.self : displayRoom.opponent) : player;
  return `<button class="hero-panel ${mine ? "mine" : "theirs"}" data-action="${mine ? "my-info" : "enemy-hero"}" aria-label="${esc(player.name)}，生命${Math.max(0, shown.hp)}，护甲${shown.armor}"><span class="hero-gem">${Math.max(0, shown.hp)}</span><div><strong>${esc(player.name)}</strong><small>${player.controller === "proxy" ? player.controlRequestPending ? "下个自己的回合接回" : "伙伴正在托管" : mine ? "你的伙伴" : player.connected || player.controller === "bot" ? "正在对战" : "连接暂时中断"}</small><span class="mana">${"◆".repeat(player.mana)}${"◇".repeat(Math.max(0, player.maxMana - player.mana))} <b>${player.mana}/${player.maxMana}</b></span><small>手牌 ${player.hand?.length ?? player.handCount ?? 0} · 牌库 ${player.deckCount ?? 0}</small></div>${shown.armor ? `<i class="armor">⬡ ${shown.armor}</i>` : ""}</button>`;
}
function fallbackBoard() {
  if (rendererStatus.available !== false && !sceneFault) return "";
  return `<div class="fallback-board" aria-label="简化战场"><p>3D画面暂不可用 · 简化战场</p>${[room.opponent, room.self].map((player, row) => `<div>${player.board.map((u) => `<button data-action="unit" data-seat="${row ? room.youSeat : 1 - room.youSeat}" data-uid="${esc(u.uid)}"><strong>${esc(CARD[u.cardId].name)}</strong><span>攻击 ${u.atk} · 生命 ${u.hp}/${u.maxHp}</span><small>${u.ready ? "可行动" : "等待下回合"}${u.shield ? " · 有护盾" : ""} · 长按或I键看说明</small></button>`).join("") || "<span>空位</span>"}</div>`).join("")}</div>`;
}
function connectionBanner() {
  if (!room || connectionState === "ready" || connectionState === "replaced") return "";
  const replaced = connectionState === "replaced";
  return `<aside class="connection-banner" role="status"><b>${replaced ? "另一页面正在继续这局" : "正在恢复连接"}</b><p>${replaced ? "本页已暂停操作。可以关闭本页，也可以在这里接回连接。" : "请保留此页。临时断开后，伙伴会按房间规则接手；连接恢复可申请接回。"}</p><button class="primary" data-action="resume-connection">${replaced ? "在这一页继续" : "立即重试"}</button></aside>`;
}
function battle() {
  const s = room, myTurn = s.canAct && connectionState === "ready" && !commandBusy && !visualBusy;
  const card = selected?.kind === "card" ? CARD[s.self.hand[selected.index]] : null;
  const option=card?selectedCardOption(s,selected.index):null;
  const cost=option?.cost??card?.cost;
  const canPlay=!!option?.legal?.untargeted&&myTurn;
  const hasTargets=!!option?.legal?.targets.length;
  const cardReason = card ? selectedCardReason(s, selected.index, { commandBusy, visualBusy }) : "";
  const ritualButtons = [["insight", "☾", "灵光", "抽1张牌"], ["spark", "✦", "火花", "造成2伤害"], ["bloom", "❧", "守护", "恢复3生命"]].map(([id, icon, name, sub]) => {
    const reason = id === "bloom" && s.self.hp >= 18 ? "生命已满" : id === "insight" && s.self.hand.length >= 7 ? "手牌已满" : id === "insight" && s.self.deckCount === 0 ? "牌库已空" : "";
    const disabled = !myTurn || s.self.ritualUsed || s.self.ritualReserved || s.self.drawEnglish?.usedThisTurn || s.self.drawEnglish?.pending || s.self.ritualsLeft < 1 || reason;
    return `<button data-action="ritual" data-value="${id}" ${disabled ? "disabled" : ""} title="${reason || sub}" aria-label="${name}，${reason || sub}"><span>${icon}</span><div>${name}<small class="${reason ? "ritual-reason" : ""}">${reason || sub}</small></div></button>`;
  }).join("");
  const draw=s.self.drawEnglish;
  const drawCard=draw?.eligibleHandId?s.self.hand[s.self.handIds?.indexOf(draw.eligibleHandId)]:null;
  const drawButton=draw?.canBegin&&drawCard?`<button class="draw-english" data-action="draw-begin" ${!myTurn?"disabled":""} aria-label="为新抽到的${esc(CARD[drawCard].name)}选择英语助力，答对后该牌本回合减1费，剩${draw.chargesLeft}次"><div>英语助力<small>答对减1费</small></div></button>`:"";
  const selectHint = !s.canAct ? "等待你的回合，可以先看看卡牌" : selected?.kind === "unit" && !s.self.board.find((u) => u.uid === selected.uid)?.ready ? "这位伙伴要等到下一回合" : selected?.kind === "unit" ? "选择亮起的目标 · 守卫会阻挡普通攻击" : selected?.kind === "ritual" || hasTargets ? "选择法术目标 · 法术可以越过守卫" : "";
  return `<div class="battle-ui">${connectionBanner()}${fallbackBoard()}<div class="battle-context"><b>${s.bank === "teacher-academic" ? `教师内测 · ${teacherLabels[s.course]?.split(" · ")[0] || "学术英语"}` : `${s.grade}年级 · ${s.course === "all" ? "全年" : s.course.startsWith("s1") ? "上册" : "下册"}`}</b><span>第${Math.ceil(s.turn / 2) || 1}回合</span>${s.phase === "playing" ? deadlineTag(s.turnDeadline) : ""}<span class="compact-turn">${s.phase === "opening" ? "准备起手" : s.phase === "finished" ? "对战结束" : s.self.controller === "proxy" ? "伙伴托管中" : s.canAct ? "你的回合" : "对手的回合"}</span></div>${hero(s.opponent, false)}${hero(s.self, true)}<div class="turn-banner">${s.phase === "opening" ? "准备你的起手" : s.phase === "finished" ? "对战结束" : s.self.controller === "proxy" ? s.self.controlRequestPending ? "已申请 · 下个自己的回合接回" : "伙伴托管中 · 可接回操作" : s.canAct ? "你的回合" : s.opponent.controller === "proxy" ? "对手暂由伙伴托管" : "对手的回合"}</div>${s.self.controller === "proxy" ? `<button class="reclaim primary" data-action="reclaim" ${commandBusy || s.self.controlRequestPending ? "disabled" : ""}>${s.self.controlRequestPending ? "已申请接回" : "接回操作"}</button>` : ""}<aside class="rituals"><h2>仪式 <span>${s.self.ritualsLeft}/4</span>${draw?` · 助力 ${draw.chargesLeft}/2`:""}<span class="compact-hand-hint" title="左右滑动或滚轮查看更多手牌；键盘左右键也可移动"> · 手牌${s.self.hand.length} ↔滑动</span></h2>${ritualButtons}${drawButton}<button class="end-turn" data-action="end" ${!myTurn ? "disabled" : ""}>结束回合</button></aside>${selected ? `<div class="command-bar ${card ? "card-command" : "target-command"}"><div>${card ? `<b>${esc(card.name)}</b>${cardReason ? `<small class="card-reason" role="status">${esc(cardReason)}</small>` : ""}<span class="card-resources">费用 ${cost}${cost<card.cost?"（本回合减1）":""} · 当前能量 ${s.self.mana}/${s.self.maxMana}${card.type !== "spell" ? ` · 攻击 ${card.atk} · 生命 ${card.hp}` : ""}</span>` : `<b>${selectHint}</b>`}</div>${card ? `<button data-action="card-info">卡牌说明</button>` : selected?.kind === "unit" ? `<button data-action="unit-info" data-uid="${esc(selected.uid)}" data-seat="${s.youSeat}">伙伴说明</button>` : ""}${card && !hasTargets ? `<button class="primary" data-action="play" ${!canPlay ? "disabled" : ""}>${card.type === "spell" ? "施放" : "召唤"}</button>` : ""}<button data-action="clear">取消</button></div>` : ""}<button class="leave quiet" data-action="leave">离开对局</button>${desk?.issue || desk?.store?.dirty ? `<p class="battle-save-warning" role="status">${esc(desk.warning())}</p>` : ""}</div>`;
}

function openingArtwork(id) {
  const independent = CARD[id]?.art >= 6;
  const card = CARD[id];
  const src = cardArtUrl(id);
  return `<span class="opening-art ${independent ? "individual" : "atlas"}"><img alt="" src="${src}" style="${independent ? "" : `transform:translate(${-100 * (card.art % 3) / 3}%,${-50 * Math.floor(card.art / 3)}%)`}" draggable="false"></span>`;
}
function opening() {
  return `<section class="dialog opening" role="dialog" aria-modal="true" aria-labelledby="opening-title"><p class="eyebrow">A NEW BEGINNING</p><h2 id="opening-title">留下你想要的起手</h2><p>可换0至2张。先准备低费伙伴，再考虑后续招式。</p><p class="opening-timing">${deadlineTag(room.openingDeadline, "opening")} · 未确认时会保留原手牌</p><div class="opening-cards">${room.self.hand.map((id, i) => `<button data-action="opening-card" data-index="${i}" class="opening-card ${openingSelection.includes(i) ? "exchange" : ""}" ${room.opening.selfConfirmed || commandBusy || connectionState !== "ready" ? "disabled" : ""}><b class="cost">${CARD[id].cost}</b>${openingArtwork(id)}<strong>${esc(CARD[id].name)}</strong><span>${esc(CARD[id].text)}</span><small>${openingSelection.includes(i) ? "换掉这张" : "保留"}</small></button>`).join("")}</div><button class="primary" data-action="opening-confirm" ${room.opening.selfConfirmed || commandBusy || connectionState !== "ready" ? "disabled" : ""}>${room.opening.selfConfirmed ? "已就绪，等待对手" : `确认 · 换${openingSelection.length}张`}</button></section>`;
}
function visualCue(v) {
  if (!v) return "";
  if (v.kind === "atlas" && /^\/assets\/learning\/[a-z-]+\.webp$/.test(v.assetUrl)) {
    const c = v.crop;
    if (!c || ![c.x, c.y, c.width, c.height, v.sheetWidth, v.sheetHeight].every(Number.isFinite) || c.width <= 0 || c.height <= 0) return "";
    const scale = 220 / c.width;
    return `<figure class="picture-cue"><div class="learning-atlas" role="img" aria-label="图片提示，请结合题干选择" style="width:220px;height:${c.height * scale}px;background-image:url('${v.assetUrl}');background-size:${v.sheetWidth * scale}px ${v.sheetHeight * scale}px;background-position:${-c.x * scale}px ${-c.y * scale}px"></div><figcaption class="picture-status">图示载入中…</figcaption><button class="picture-retry" data-action="retry-picture">重新载入图片</button></figure>`;
  }
  if (v.kind === "number" && Number.isInteger(v.count) && v.count > 0 && v.count < 11) return `<div class="number-cue" role="img" aria-label="数一数图中的星星">${"<span>✦</span>".repeat(v.count)}</div>`;
  if (v.kind === "color" && /^#[a-f0-9]{6}$/i.test(v.color)) return `<div class="color-cue" role="img" aria-label="观察这一块颜色" style="background:${v.color}"></div>`;
  return "";
}
function quiz() {
  const q = challenge.question, answered = !!feedback, drawQuestion=challenge.purpose === "draw";
  if(drawQuestion && answered) {
    const correct=q.options.find(o=>o.id===feedback.correctOptionId)?.text;
    return `<section class="dialog battle-recap" role="dialog" aria-modal="true" aria-labelledby="quiz-title"><h2 id="quiz-title">${drawFeedbackText(feedback.outcome)}</h2>${correct?`<p class="recap-answer"><span>正确答案</span><strong>${esc(correct)}</strong></p>`:""}<div class="feedback"><p>${esc(feedback.explanation||"这次机会已结束，可以继续出牌。")}</p></div>${desk?.attentionHint(challenge.challengeId)||""}<button class="primary" data-action="quiz-close">回到棋盘</button></section>`;
  }
  if (answered) {
    const timedOut = feedback.outcome === "unanswered";
    if (visualBusy && !preferences.reduced && !recapExpanded) {
      return `<section class="dialog battle-recap cue-only" role="dialog" aria-modal="true" aria-labelledby="quiz-title"><header><h2 id="quiz-title">${feedback.outcome === "correct" ? "词灵回应了你" : "先守住这一回合"}</h2><button data-action="recap-expand">查看讲解</button></header><p>${feedback.outcome === "correct" ? "技能已生效，查看讲解后继续对战" : timedOut ? "这次未作答，查看说明后继续对战" : "获得1点护甲，查看讲解后继续对战"}</p></section>`;
    }
    const correct = q.options.find(option => option.id === feedback.correctOptionId)?.text;
    const chosen = q.options.find(option => option.id === feedback.selectedOptionId)?.text;
    const completed = !timedOut && feedback.speak && feedback.speak !== correct ? feedback.speak : null;
    return `<section class="dialog battle-recap" role="dialog" aria-modal="true" aria-labelledby="quiz-title" aria-describedby="recap-explanation"><p class="eyebrow">WORD MAGIC</p><header><h2 id="quiz-title">${timedOut ? "先守住这一回合" : feedback.outcome === "correct" ? "词灵回应了你" : "再记住这一点"}</h2><button data-action="listen" ${!feedback.audioUrl || !preferences.speech ? "disabled" : ""} aria-label="${preferences.speech ? "听正确英语" : "朗读已关闭"}">${voice || voiceTimer ? "■ 停止" : "♫ 朗读"}</button></header>${!timedOut && correct ? `<p class="recap-answer"><span>正确答案</span><strong>${esc(correct)}</strong></p>` : ""}${completed ? `<p class="recap-sentence">${esc(completed)}</p>` : ""}${!timedOut && feedback.outcome === "wrong" && chosen ? `<p class="recap-choice">刚才选择了：${esc(chosen)}</p>` : ""}<div class="feedback" id="recap-explanation"><p>${timedOut ? "这次未作答，不记学习错误。获得1点护甲，下一轮再试。" : esc(feedback.explanation || "把这条英语再读一遍。")}</p>${feedback.outcome === "wrong" ? "<p>这次仍获得1点护甲。</p>" : ""}</div>${desk?.attentionHint(challenge.challengeId)||""}<button class="primary" data-action="quiz-close">回到棋盘</button></section>`;
  }
  return `<section class="dialog quiz ${q.bank === "teacher-academic" ? "teacher-quiz" : ""}" role="dialog" aria-modal="true" aria-labelledby="quiz-title"><p class="eyebrow">WORD MAGIC</p><header><h2 id="quiz-title">${drawQuestion?"给新抽的牌一点助力":"唤醒词灵"}</h2><button data-action="listen" ${!preferences.speech || !(answered ? feedback.audioUrl : q.listenAudioUrl || q.listenAudioUrls?.length) ? "disabled" : ""} aria-label="${preferences.speech ? "听英语" : "朗读已关闭，可在设置开启"}">${voice || voiceTimer ? "■ 停止朗读" : preferences.speech ? "♫ 听英语" : "朗读已关闭"}</button></header><p class="subtle question-timing">${esc(q.unitLabel)} ${deadlineTag(challenge.expiresAt, "question")}</p><h3>${esc(q.prompt)}</h3>${q.bank === "teacher-academic" ? `<p class="teacher-audio-note">学术英语内测 · 文字题目</p>` : ""}${drawQuestion?'<p class="subtle">可选助力，每局最多2次；答对只让这张新抽的牌本回合减1费。答错或取消仍保留原牌。</p>':""}${visualCue(q.visual)}${q.passage ? `<section class="academic-passage" aria-label="阅读材料"><p>${esc(q.passage)}</p></section>` : ""}${q.text ? `<p class="english">${esc(q.text)}</p>` : ""}<div class="answers">${q.options.map((o, i) => `<button data-action="answer" data-option="${esc(o.id)}" ${answered || commandBusy || connectionState !== "ready" ? "disabled" : ""} class="${answered && feedback.correctOptionId === o.id ? "correct" : ""}"><span>${String.fromCharCode(65 + i)}</span>${esc(o.text)}</button>`).join("")}</div>${answered ? `<div class="feedback"><b>${feedback.outcome === "correct" ? "词灵回应了你" : feedback.outcome === "unanswered" ? "先守住这一回合" : "得到1点护甲，再记住这一点"}</b><p>${esc(feedback.explanation || "这次没有记为学习答错。下一轮再试。")}</p></div><button class="primary" data-action="quiz-close">回到棋盘</button>` : `<p class="subtle">${connectionState === "ready" ? "选择一次，安心思考" : "连接恢复后就能继续回答，这道题仍会按服务器期限保留。"}</p>${connectionState !== "ready" ? `<button data-action="resume-connection">重试连接</button>` : ""}`} ${drawQuestion&&!answered?'<button data-action="draw-cancel">不作答，保留原牌（本次机会已使用）</button>':""}</section>`;
}
function result() {
  const r = room.result || {}, won = r.winnerSeat === room.youSeat;
  const unfinished = !["health", "draw"].includes(r.reason);
  return `<section class="dialog result" role="dialog" aria-modal="true"><p class="eyebrow">THE GROVE REMEMBERS</p><h2>${unfinished ? "本局已结束" : r.winnerSeat === null ? "旗鼓相当" : won ? "赢下这次冒险" : "下一次再来"}</h2><p>${Math.ceil(room.turn / 2)}回合 · ${esc(room.self.name)} 与 ${esc(room.opponent.name)}</p>${room.assisted ? "<p>本局有伙伴托管，单独记为协助对局。</p>" : ""}${lastBattleFeedback?.explanation ? `<div class="feedback"><b>记住这次词灵回响</b><p>${esc(lastBattleFeedback.explanation)}</p></div>` : ""}${unfinished ? "<p>提前结束的对局不参加排行榜，已学英语仍会保存。</p>" : `<p class="score">${r.ownScore ?? 0} 分</p>`}<p>英语 ${r.ownLearning?.correct ?? 0}/${r.ownLearning?.attempts ?? 0} · ${esc(desk?.warning() || "正在保存记录")}</p><button class="primary" data-action="new-match">返回营地</button></section>`;
}
function cardInfo() {
  const instance = inspectUnitRef ? boardCardInspection(room, inspectUnitRef) : null;
  const id = instance?.cardId || inspectCardId || (selected?.kind === "card" ? room?.self.hand[selected.index] : null);
  const guide = inspectUnitRef ? instance?.guide : cardGuide(id);
  const inspectIndex = room?.self.handIds?.indexOf(inspectHandId) ?? -1;
  const inspectedCost = inspectIndex >= 0 ? room.self.handCosts?.[inspectIndex] ?? guide?.cost : guide?.cost;
  if (!guide) return `<section class="dialog" role="dialog" aria-modal="true"><h2>伙伴已离开原来的位置</h2><p>场面已更新。这份说明不会切换成另一位同名伙伴。</p><button data-action="card-info-close">返回棋盘</button></section>`;
  const facts = instance
    ? `<span>当前攻击 ${instance.attack}</span><span>生命 ${instance.health}/${instance.maximumHealth}</span>`
    : `<span>${inspectedCost} 能量${inspectedCost < guide.cost ? `（本回合减1，基础${guide.cost}）` : ""}</span>${guide.type === "伙伴" ? `<span>${guide.atk} 攻击</span><span>${guide.hp} 生命</span>` : "<span>法术</span>"}`;
  const state = instance ? `<section class="unit-inspection-state" aria-label="当前伙伴状态"><p><b>${instance.ownerLabel}</b> · ${instance.actionLabel}${instance.shield ? " · 护盾：抵挡下一次伤害" : " · 当前没有护盾"}</p><p class="subtle">基础卡牌：${guide.cost}能量 · ${guide.atk}攻击 · ${guide.hp}生命${instance.changedAttack || instance.changedMaximumHealth ? "。当前数值已受效果改变" : ""}</p></section>` : "";
  return `<section class="dialog card-info-dialog ${instance ? "board-card-info" : ""}" role="dialog" aria-modal="true" aria-labelledby="card-info-title"><div class="card-info-body" tabindex="0" role="region" aria-label="卡牌详细说明"><header class="card-info-heading"><div class="card-info-portrait">${artThumb(id)}</div><div><p class="eyebrow">${esc(guide.element)} · ${esc(guide.keyword)}</p><h2 id="card-info-title">${esc(guide.name)}</h2><p class="card-info-english" lang="en">${esc(guide.en)}</p><p class="card-facts">${facts}</p></div></header>${state}<p class="card-effect">${esc(guide.effect)}</p><div class="card-info-columns"><section><h3>${esc(guide.keyword)}</h3><p>${esc(guide.rule)}</p><h3>怎么使用</h3><p>${esc(guide.target)}</p><p>${esc(guide.timing)}</p></section><section><h3>试试看</h3><p>${esc(guide.example)}</p><details class="card-info-tip"><summary>${guide.exchange ? "攻击前看看" : "使用小提示"}</summary>${guide.exchange ? `<p>${esc(guide.exchange)}</p>` : ""}<p>${esc(guide.tip)}</p></details></section></div></div><footer class="card-info-footer">${room?.phase === "playing" ? `<p class="card-info-time">${room.canAct ? "你的回合" : "对手回合"} · ${deadlineTag(room.turnDeadline)} · 查看说明时继续计时</p>` : ""}<button class="primary" data-action="card-info-close">返回棋盘</button></footer></section>`;
}
function settings() {
  const activeRenderer = room ? rendererStatus : lobbyStatus;
  return `<section class="dialog settings" role="dialog" aria-modal="true"><h2>声音与画面</h2><label><input id="setting-reduced" type="checkbox" ${preferences.reduced ? "checked" : ""}>减少动态</label><label><input id="setting-music" type="checkbox" ${preferences.music ? "checked" : ""}>背景音乐</label><label><input id="setting-sound" type="checkbox" ${preferences.sound ? "checked" : ""}>战斗音效</label><label><input id="setting-speech" type="checkbox" ${preferences.speech ? "checked" : ""}>英语朗读</label><label>音乐音量<input id="music-volume" type="range" min="0" max="100" value="${preferences.musicVolume}"></label><label>音效音量<input id="sound-volume" type="range" min="0" max="100" value="${preferences.soundVolume}"></label><p class="subtle">渲染：${esc(activeRenderer.renderer || "准备中")}${activeRenderer.fps ? ` · 最近画面约${activeRenderer.fps}fps` : ""}</p><button class="primary" data-action="save-settings">完成</button></section>`;
}
function render() {
  desk?.syncAttention();
  const identityBlocked = !isPractice && !identityVerified;
  document.body.classList.toggle('identity-checking', identityBlocked);
  if (identityBlocked) {
    ui.inert = false;
    ui.innerHTML = `<main class="identity-check" role="status"><h1>正在确认营地身份</h1><p>${esc(identityCheckError || '确认后继续你的学习与收藏')}</p>${identityCheckError ? '<button class="primary" data-action="identity-retry">重新确认</button>' : ''}</main>`;
    modalRoot.innerHTML = ''; renderedModalHTML = null; renderedModalKey = null;
    layer.inert = true; $('#collection-root').inert = true; $('#wardrobe-root').inert = true; wardrobeView?.visibility(true);
    if(identityPanel)identityPanel.root.inert = true;
    scene?.setHidden(true); handScene?.setHidden(true); lobbyScene?.setHidden(true);
    return;
  }
  $('#collection-root').inert = false; $('#wardrobe-root').inert = false;
  if(identityPanel)identityPanel.root.inert = false;
  const selectionKey = JSON.stringify(selected);
  if (scene && selectionKey !== renderedSelection) { renderedSelection = selectionKey; try { scene.select(selected); } catch { sceneFault = true; } }
  
  const previousDialog = modalRoot.querySelector(".dialog"), previousScroll = previousDialog?.scrollTop || 0;
  const previousCardScroll = previousDialog?.querySelector(".card-info-body")?.scrollTop || 0;
  const previousCardTipOpen = previousDialog?.querySelector('.card-info-tip')?.open === true;
  const focused = document.activeElement;
  const cardFocus = focused?.matches?.('.card-info-body') ? '.card-info-body' : focused?.matches?.('.card-info-tip summary') ? '.card-info-tip summary' : null;
  const focusAction = focused?.dataset?.action;
  const focusIndex = focused?.dataset?.index;
  const focusValue = focused?.dataset?.value;
  const focusOption = focused?.dataset?.option, focusUid = focused?.dataset?.uid, focusSeat = focused?.dataset?.seat;
  ui.innerHTML = header() + (room ? battle() : lobby());

  let contents = "";
  if (connectionState === "incompatible") contents = '<section class="dialog" role="dialog" aria-modal="true"><h2>森林版本已更新</h2><p>请刷新页面，再继续匹配。已保存的学习与收藏会保留。</p><button class="primary" data-action="reload-app">刷新到新版本</button></section>';
  else if (connectionState === "replaced" && room) contents = '<section class="dialog" role="dialog" aria-modal="true"><h2>另一页面正在继续这局</h2><p>本页已暂停操作。可以在这里恢复同一场对局，或返回营地另开连接。</p><button class="primary" data-action="resume-connection">在这一页继续</button><button data-action="leave-replaced">返回营地</button></section>';
  else if (["study", "records", "data"].includes(panel) && desk) contents = desk.html();
  else if (panel === "leave") contents = '<section class="dialog" role="dialog" aria-modal="true"><h2>离开这场对局？</h2><p>离开会结束本局，并记为退出。已保存的学习与收藏会保留。</p><button class="primary" data-action="confirm-leave">确认离开</button><button data-action="close-panel">继续对战</button></section>';
  else if (panel === "match-setup" && !room) contents = matchSetup();
  else if (panel === "library") contents = library.html();
  else if (panel === "daily") contents = rewardView({data:desk?.data,ready:desk?.canStart&&rewardNow()!==null,now:rewardNow()});
  else if (panel === "camp-more") contents = '<section class="dialog camp-more" role="dialog" aria-modal="true"><header><h2>营地里的小事</h2><button data-action="close-panel">返回</button></header><button data-action="collection">五日卡牌礼盒 · 独立外观收藏</button><button data-action="records">学习与对局成绩</button><button data-action="data">记录与备份</button></section>';
  else if (panel === "difficulty-info") { const plan=selectDifficulty(desk?.data?.combatRating,preferences.combatMode),profile=desk?.data?.combatRating; contents=`<section class="dialog" role="dialog" aria-modal="true"><h2>跟着战斗经验慢慢进步</h2><p>这是你的电脑挑战强度，与英语掌握分开。前3场自适应对局从轻松开始；只有自然结束且没有托管的电脑局更新表现，退出不会加减。</p><p>下一局${esc(plan.name)}：${esc(plan.description)}</p><p>当前参考值${profile?.rating ?? 700}，已完成${profile?.games ?? 0}场。连续失利会降低下一局档位；强度在开局确定，途中不改血量或伤害。</p><button class="primary" data-action="close-panel">知道了</button></section>`; }
  else if (panel === "card-info") contents = cardInfo();
  else if (panel === "settings") contents = settings();
  else if (panel === "help") contents = '<section class="dialog" role="dialog" aria-modal="true"><h2>把伙伴放上棋盘</h2><p>直接点选实体手牌，再点召唤。长按约半秒或右键看手牌、场上伙伴的详情；横向滑动查看更多手牌；键盘左右选牌，回车点选，I键看说明。选可以行动的伙伴，再选对面目标；守卫会挡住普通攻击。</p><p>卡牌左上的蓝色数字是能量费用，左下金色是攻击，右下红色是生命。先选一位准备好的伙伴，亮起的目标可以承受普通攻击；守卫会保护其他伙伴。</p><p>词灵仪式每局最多4次。自己的第2回合起，新自然抽到的牌有时可选英语助力，每局最多2次，答对让该牌本回合减1费。助力与仪式共享每回合一次英语行动；答错或取消保留原牌。</p><p>'+(isPractice ? '本试玩页由森林电脑角色迎战，全部战斗与学习计算在当前浏览器进行。真人匹配属于独立的服务器版本。' : '开始匹配会寻找相同学习范围的对手；稍候无人时会由森林电脑角色迎战。对手资料会如实说明身份。')+'</p><button class="primary" data-action="close-panel">回到森林</button></section>';
  else if (panel === "opponent") contents = `<section class="dialog" role="dialog" aria-modal="true"><h2>${esc(room?.opponent.name)}</h2>${room?.computer ? `<p>${esc(room.computer.name)} · ${esc(room.computer.description)}</p>` : ""}<p>${room?.opponent.controller === "bot" ? "森林电脑角色 · 根据公开场面与自己的手牌自主决策" : "本局匿名玩家 · 无需提供真实姓名"}</p><button class="primary" data-action="close-panel">返回</button></section>`;
  else if (challenge) contents = quiz();
  else if (room?.phase === "opening") contents = opening();
  else if (room?.phase === "finished" && !visualBusy) contents = result();
  const compactFeedback = challenge && feedback && !panel && connectionState !== "replaced";
  const ownEffectRecap = compactFeedback && (challenge.kind !== "spark" || feedback.outcome !== "correct");
  const modalHTML = contents ? `<div class="modal-shade${compactFeedback ? ` battle-recap-layer${ownEffectRecap ? " own-effect-recap" : ""}` : ""}">${contents}</div>` : "";
  if (modalHTML !== renderedModalHTML) { modalRoot.innerHTML = modalHTML; renderedModalHTML = modalHTML; }
  pictures.connect(modalRoot);
  const cardInspectionKey = inspectUnitRef ? `unit:${inspectUnitRef.seat}:${inspectUnitRef.uid}`
    : inspectHandId != null ? `hand:${inspectHandId}`
    : inspectCardId != null ? `card:${inspectCardId}`
    : selected?.kind === "card" ? `slot:${selected.index ?? "missing"}` : "missing";
  const modalKey = (connectionState === "replaced" && room ? "connection-replaced" : null) || (panel === "card-info" ? `card-info:${cardInspectionKey}` : panel === "study" ? `study:${desk?.question?.challengeId || "catalogue"}` : panel) || (challenge ? `question:${challenge.challengeId}${feedback ? ":feedback" : ""}` : room?.phase === "opening" ? `opening:${room.roomId}` : room?.phase === "finished" && !visualBusy ? `result:${room.roomId}` : null);
  const dialog = modalRoot.querySelector(".dialog");
  if(dialog && $("#notice").dataset.kind === "hand-tip"){$("#notice").textContent="";clearTimeout(timer);}
  if (dialog && !previousDialog) modalOpener = {element:focused,action:focusAction,index:focusIndex,value:focusValue,option:focusOption,uid:focusUid,seat:focusSeat};
  const closingOpener = !dialog && previousDialog ? modalOpener : null;
  if (closingOpener) modalOpener = null;
  if (dialog) {
    dialog.tabIndex = -1;
    if (modalKey === renderedModalKey) {
      dialog.scrollTop = previousScroll;
      const cardBody = dialog.querySelector(".card-info-body");
      const cardTip = dialog.querySelector('.card-info-tip');
      if (cardTip) cardTip.open = previousCardTipOpen;
      if (cardBody) cardBody.scrollTop = previousCardScroll;
    }
    if (dialog !== previousDialog) dialog.focus({ preventScroll: true });
    if (modalKey === renderedModalKey && cardFocus) dialog.querySelector(cardFocus)?.focus({ preventScroll: true });
    if ((feedback || desk?.answer) && !renderedFeedback && modalKey === renderedModalKey) dialog.querySelector(".feedback")?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }
  if (focusAction && (!dialog || modalKey === renderedModalKey)) {
    const candidates = [...document.querySelectorAll("[data-action]")];
    const target = candidates.find((el) => el.dataset.action === focusAction && el.dataset.index === focusIndex && el.dataset.value === focusValue && el.dataset.option === focusOption && el.dataset.uid === focusUid && el.dataset.seat === focusSeat && !el.disabled);
    if (target && (!dialog || dialog.contains(target))) target.focus({ preventScroll: true });
  }
  renderedModalKey = modalKey; renderedFeedback = !!(feedback || desk?.answer);
  ui.inert = !!dialog || ["collection","wardrobe"].includes(panel) || !!identityPanel?.isOpen; layer.inert = !!dialog || ["collection","wardrobe"].includes(panel) || !!identityPanel?.isOpen;
  document.body.classList.toggle("collection-open",panel === "collection");
  document.body.classList.toggle("has-room", !!room);
  $("#lobby-scene").hidden = !!room;
  $("#arena").hidden = !room;
  scene?.setHidden(document.hidden || pageSuspended || !!panel || !room);
  lobbyScene?.setHidden(document.hidden || pageSuspended || !!room || !!panel);
  syncHandView(!!dialog || ["collection","wardrobe"].includes(panel));
  const warning = $("#renderer-warning");
  warning.hidden = room ? rendererStatus.available !== false && !sceneFault : lobbyStatus.available !== false;
  warning.textContent = !room ? (lobbyStatus.available === false ? "营地画面暂不可用，四周入口仍然可以使用" : "") : sceneFault ? "场景暂时无法完整显示，已切换到简化操作。对局数值已按最新结果同步。" : rendererStatus.available === false ? "当前浏览器未能开启3D画面，已提供简化战场。可在支持WebGL2的浏览器中体验立体棋盘。" : "";
  if (room && rendererStatus.available !== false && !sceneFault) updateLabels(); else { layer.innerHTML = ""; labelSignature = ""; }
  // Background controls and the hand were inert while the dialog was open.
  // Restore only after their final DOM and interactive state have been synced.
  if (closingOpener) restoreModalOpener(closingOpener,[...ui.querySelectorAll('[data-action]'),...layer.querySelectorAll('[data-action]')],$('#hand-canvas'));
  refreshDeadlines(); scheduleRewardDay();
}
let anchorPositions = [];
function updateLabels() {
  if (!room || sceneFault || rendererStatus.available === false) return;
  const visual = displayRoom?.roomId === room.roomId ? displayRoom : room;
  const targets = selected?.kind==="card" ? selectedTargetIds(room,selected.index) : targetPreview(stateForScene(room), room.youSeat, selected).targets;
  const signature = JSON.stringify([room.youSeat, room.canAct, room.activeSeat, connectionState, commandBusy, visualBusy, targets, visual.self.board, visual.opponent.board, anchorPositions.map((a) => [a.uid, a.visible])]);
  if (signature !== labelSignature) {
    labelSignature = signature;
    const focusedUid = layer.contains(document.activeElement) ? document.activeElement.dataset.uid : null;
    layer.innerHTML = anchorPositions.map((a) => {
    const p = a.seat === room.youSeat ? visual.self : visual.opponent, u = p.board.find((u) => u.uid === a.uid);
    if (!u || !a.visible) return "";
    const readiness = a.seat !== room.youSeat || room.phase !== "playing" ? "" : !u.ready ? "下回合" : room.canAct && connectionState === "ready" && !commandBusy && !visualBusy ? "可攻击" : room.activeSeat !== room.youSeat ? "待回合" : "已就绪";
    return `<button class="unit-label ${targets.includes(u.uid) ? "targetable" : ""} ${u.ready && a.seat === room.youSeat && room.canAct ? "ready" : ""}" style="--anchor-x:${a.x}px;--anchor-y:${a.y}px;left:${a.x}px;top:${a.y}px" data-action="unit" data-side="${a.seat === room.youSeat ? "self" : "opponent"}" data-slot="${p.board.findIndex(item => item.uid === u.uid)}" data-uid="${esc(u.uid)}" data-seat="${a.seat}" aria-label="${esc(CARD[u.cardId].name)}，攻击${u.atk}，生命${u.hp}${u.shield ? "，有护盾" : ""}${readiness ? `，${readiness}` : ""}。长按、右键或I键看说明"><b class="${String(u.atk).length > 1 ? "wide" : ""}">${u.atk}</b><span class="unit-name"><em>${esc(CARD[u.cardId].name)}</em>${u.shield ? '<i class="unit-shield" aria-hidden="true">◇</i>' : ""}</span><b class="${String(u.hp).length > 1 ? "wide" : ""}">${u.hp}</b>${readiness ? `<small class="unit-state">${readiness}</small>` : ""}</button>`;
    }).join("");
    if (focusedUid) [...layer.querySelectorAll("[data-uid]")].find((el) => el.dataset.uid === focusedUid)?.focus({ preventScroll: true });
  }
  for (const el of layer.querySelectorAll("[data-uid]")) {
    const a = anchorPositions.find((a) => a.uid === el.dataset.uid);
    if (a) { el.style.setProperty("--unit-label-max-width", `${unitLabelWidth(a, anchorPositions)}px`); el.style.left = `${a.x}px`; el.style.top = `${a.y}px`; el.style.setProperty("--anchor-x", `${a.x}px`); el.style.setProperty("--anchor-y", `${a.y}px`); }
  }
}

document.addEventListener("click", (event) => {
  SOUND.unlock();
  const button = event.target.closest("[data-action]"); if (!button || button.disabled) return;
  const a = button.dataset.action;
  if(!isPractice && !identityVerified) { if(a==='identity-retry')void verifyIdentity();return; }
  if(a==='identity' && !isPractice) {
    if(waiting || room && room.phase!=='finished'){notice('对局结束后再切换身份');return;}
    if(desk?.pendingCount || desk?.store?.dirty){notice('先确认当前记录已保存，再切换身份');return;}
    desk?.close();panel='identity';cancelVoice();identityPanel?.open();render();return;
  }
  if(a.startsWith("collection-") || button.dataset.skinAction) return;
  if(a.startsWith("library-")){void library.click(a,button.dataset.value);return;}
  if (a.startsWith("desk-")) { void desk?.click(a, button.dataset.value, button.dataset.option).then(()=>{
    if(!isPractice && activeIdentity && desk?.canStart && link.state==='closed')link.freshSession();
  }); return; }
  if (["camp", "clear", "close-panel"].includes(a)) { event.preventDefault(); desk?.close(); panel = null; selected = null; }
  else if (a === "card-info") { if (selected?.kind === "card") inspectHand(selected.index); }
  else if (a === "unit-info") inspectUnit({kind:"unit",uid:button.dataset.uid,seat:Number(button.dataset.seat)});
  else if (a === "match-setup" && !room) { panel = "match-setup"; cancelVoice(); }
  else if (a === "card-info-close") panel = null;
  else if (a === "question-bank" && !waiting && !room && desk?.canStart && ["school","teacher-academic"].includes(button.dataset.value)) { preferences.bank = button.dataset.value; savePreferences({ bank: preferences.bank }); }
  else if (a === "grade" && !waiting && !room) { preferences.grade = Number(button.dataset.value); savePreferences({ grade: preferences.grade }); }
  else if (a === "match" && desk?.canStart) {
    if (isPractice && link.practiceService) link.practiceService.config.computerDifficulty = selectDifficulty(desk.data?.combatRating,preferences.combatMode);
    if (preferences.deckId === "custom" && !validateCustomDeck(preferences.customDeck)) { notice("请先把自选套牌整理为20张，每种最多3张"); return; }
    send("queue.join", { bank: preferences.bank || "school", grade: teacherSelected() ? null : preferences.grade, course: teacherSelected() ? preferences.teacherCourse || "all" : preferences.course, deckId: preferences.deckId, ...(preferences.deckId === "custom" ? { customDeck: [...preferences.customDeck] } : {}) }, false);
  }
  else if (a === "daily-study" && !waiting && !room) { openDesk("study"); void desk?.startDailyPractice(); }
  else if (a === "daily-unit" && !waiting && !room) { openDesk("study"); void desk?.startUnitPractice(); }
  else if (["daily","camp-more"].includes(a) && !waiting && !room) {desk?.close();panel=a;cancelVoice();}
  else if (a === "wardrobe" && !waiting && !room) {desk?.close();panel="wardrobe";cancelVoice();wardrobeView?.open();}
  else if (a === "collection" && !waiting && !room) {panel="collection";cancelVoice();collectionView?.open();}
  else if (a === "library" && !waiting && !room) {library.open();panel="library";cancelVoice();}
  else if (["study", "records", "data"].includes(a)) openDesk(a);
  else if (a === "reclaim") send("room.reclaim", {});
  else if (a === "cancel-match") send("queue.cancel", {}, false);
  else if (a === "reload-app") location.reload();
  else if (a === "reconnect") link.freshSession();
  else if (a === "leave-replaced") { clearRoom(); link.freshSession(); }
  else if (a === "resume-connection" || a === "retry-connection") { selected = null; link.connect(); }
  else if (a === "opening-card") { const i = Number(button.dataset.index); if (openingSelection.includes(i)) openingSelection = openingSelection.filter((n) => n !== i); else if (openingSelection.length < 2) openingSelection.push(i); else notice("这次最多换两张"); }
  else if (a === "opening-confirm") send("opening.choose", { indices: openingSelection });
  else if (a === "select-card") pick({ kind: "card", index: Number(button.dataset.index) });
  else if (a === "unit") pick({ kind: "unit", uid: button.dataset.uid, seat: Number(button.dataset.seat) });
  else if (a === "enemy-hero") { if (selected) target("hero"); else panel = "opponent"; }
  else if (a === "my-info") notice("守护生命，也要争取场面的主动权");
  else if (a === "play" && selected?.kind === "card") { send("battle.action", { action: { type: "play", index: selected.index } }); selected = null; }
  else if (a === "end") { selected = null; send("battle.action", { action: { type: "end" } }); }
  else if (a === "ritual") { const kind = button.dataset.value; if (kind === "spark") { selected = { kind: "ritual", ritual: kind }; notice("请选择火花目标"); } else send("ritual.begin", { kind }); }
  else if (a === "draw-begin" && room?.self.drawEnglish?.canBegin) send("draw.begin",{handId:room.self.drawEnglish.eligibleHandId});
  else if (a === "draw-cancel" && challenge?.purpose === "draw" && !feedback) {const id=challenge.challengeId;void send("draw.cancel",{challengeId:id}).then(ok=>{if(ok&&challenge?.challengeId===id){challenge=null;feedback=null;cancelVoice();render();}});}
  else if (a === "answer" && challenge && !feedback) send(answerCommand(challenge), { challengeId: challenge.challengeId, optionId: button.dataset.option });
  else if (a === "listen") listen(feedback ? feedback.audioUrl : challenge?.question.listenAudioUrls || challenge?.question.listenAudioUrl);
  else if (a === "recap-expand" && feedback) recapExpanded = true;
  else if (a === "quiz-close" && feedback) { void desk?.finishAttention(challenge?.challengeId); challenge = null; feedback = null; cancelVoice(); }
  else if (a === "sound") { preferences.music = !preferences.music; SOUND.sync(preferences); savePreferences({ music: preferences.music }); }
  else if (["settings", "help", "difficulty-info"].includes(a)) { panel = a; cancelVoice(); }
  else if (a === "save-settings") { for (const k of ["reduced", "sound", "music", "speech"]) preferences[k] = $(`#setting-${k}`).checked; preferences.musicVolume = Number($("#music-volume").value); preferences.soundVolume = Number($("#sound-volume").value); SOUND.sync(preferences); scene?.setReduced(preferences.reduced); handScene?.setReduced(preferences.reduced); lobbyScene?.setReduced(preferences.reduced); savePreferences(preferences); panel = null; }
  else if (a === "leave") panel = "leave";
  else if (a === "confirm-leave") { panel = null; send("room.resign", {}); }
  else if (a === "new-match") clearRoom();
  render();
});
function previewControl(event) {
  const button = event.target.closest?.("[data-action]");
  if (button?.dataset.action === "unit") scene?.hoverTarget?.({ kind: "unit", uid: button.dataset.uid, seat: Number(button.dataset.seat) });
  else if (button?.dataset.action === "enemy-hero") scene?.hoverTarget?.({ kind: "hero", relativeSeat: 1 });
  else if (button) scene?.hoverTarget?.(null);
}
document.addEventListener("pointerover", previewControl);
document.addEventListener("focusin", previewControl);
document.addEventListener("pointerout", (event) => {
  const button = event.target.closest?.("[data-action]");
  if (button && ["unit", "enemy-hero"].includes(button.dataset.action) && !button.contains(event.relatedTarget)) scene?.hoverTarget?.(null);
});
document.addEventListener("change", (event) => {
  if(!isPractice && !identityVerified)return;
  if(event.target.id === "record-rules" && desk){desk.recordRules=event.target.value;desk.notify();}
  if (event.target.id === "combat-mode" && !waiting && !room) { preferences.combatMode=event.target.value; savePreferences({combatMode:preferences.combatMode}); render(); }
  if (event.target.id === "teacher-course" && !waiting && !room && Object.hasOwn(teacherLabels,event.target.value)) { preferences.teacherCourse = event.target.value; savePreferences({ teacherCourse: preferences.teacherCourse }); }
  if (event.target.id === "course" && !waiting && !room) { preferences.course = event.target.value; savePreferences({ course: preferences.course }); }
  if (event.target.id === "deck" && !waiting && !room) { preferences.deckId = event.target.value; savePreferences({ deckId: preferences.deckId }); }
  if (event.target.id === "desk-import" && panel === "data" && !waiting && (!room || room.phase === "finished")) void desk.importFile(event.target.files?.[0]);
});
document.addEventListener("keydown", (event) => {
  if(!isPractice && !identityVerified)return;
  if (panel === "collection") { collectionView?.keyHandler(event); return; }
  if (panel === "wardrobe") { wardrobeView?.keyHandler(event); return; }
  // Application selection is authoritative even if the renderer cannot run.
  if (!panel && !challenge && event.key === "Escape" && selected) {
    event.preventDefault(); selected = null; handScene?.focus(null); render(); return;
  }
  if (!panel && !challenge && isInspectionKey(event)) {
    const handButton = document.activeElement?.closest?.("[data-hand-index]");
    const unitButton = document.activeElement?.closest?.('[data-action="unit"]');
    if (handButton || unitButton) {
      event.preventDefault();
      if (!event.repeat) handButton ? inspectHand(Number(handButton.dataset.handIndex)) : inspectUnit({kind:"unit",uid:unitButton.dataset.uid,seat:Number(unitButton.dataset.seat)});
      return;
    }
  }
  if (!panel && !challenge && ($("#hand-semantics").contains(document.activeElement) || document.activeElement === $("#hand-canvas")) && handScene?.handleKey(event)) return;
  const dialog = modalRoot.querySelector(".dialog");
  if (event.key === "Tab" && dialog) {
    const focusable = [...dialog.querySelectorAll('button:not(:disabled),input,select,a[href],[tabindex="0"]')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
  }
  if (event.key === "Escape" && (panel || (!challenge && room?.phase !== "opening"))) { const preserveCard = panel === "card-info"; panel = null; desk?.close(); if (!preserveCard) selected = null; render(); }
});
document.addEventListener("visibilitychange", () => { const hidden=document.hidden || pageSuspended; if(!hidden&&!isPractice){void verifyIdentity();return;} desk?.visibility(!hidden); collectionView?.visibility(hidden); wardrobeView?.visibility(hidden); SOUND.visibility?.(hidden); if (hidden) cancelVoice(); render(); });

function createDesk() {
  const ownerId = activeIdentity?.playerId;
  const ownedFetch = isPractice ? studyFetch : (url,options={}) => studyFetch(url,{
    ...options,headers:{...options.headers,'X-Spellwood-Player':ownerId || ''}
  });
  let created;
  created = new StudyDesk({
  ...(!isPractice?{storeFactory:options=>new RemoteProgressStore({...options,playerId:ownerId,fetcher:ownedFetch})}:{}),
  onChange() {
    if(desk!==created)return;
    if(!isPractice && ['PROFILE_CHANGED','IDENTITY_REQUIRED','SESSION_REQUIRED'].includes(created.issue?.code))queueMicrotask(()=>{if(desk===created)void verifyIdentity();});
    if (desk) for (const id of pendingLearning.keys()) if (!desk.pending.has(id)) pendingLearning.delete(id);
    if (desk?.data?.collection) scene?.setFinishes(equippedFinishes(desk.data.collection));
    collectionView?.render(); wardrobeView?.render();
    render();
  },
  onPreferences(value) { if(desk!==created)return;preferences = { ...preferences, ...value }; SOUND.sync(preferences); scene?.setReduced(preferences.reduced); handScene?.setReduced(preferences.reduced); lobbyScene?.setReduced(preferences.reduced); },
  onNotice:text=>{if(desk===created)notice(text);}, onRestore(context) { if(desk!==created)return;collectionView?.reset(); wardrobeView?.reset(); clearRoom(); panel = "data"; finishSaves.clear(); pendingLearning.clear(); link.freshSession(); notice(context?.remote?'旧档学习和外观已导入，正式奖励记录保持独立':'本机备份已恢复'); },
  getPreferences: () => preferences, visualCue, listen, cancelVoice, fetcher: ownedFetch,
  canReadBattleFeedback: id => (isPractice || identityVerified) && challenge?.challengeId === id && !!feedback && !panel && (!visualBusy || preferences.reduced || recapExpanded),
});
  return created;
}
desk=createDesk();

function resumeIdentityView() {
  const hidden=document.hidden || pageSuspended;
  desk?.visibility(!hidden);collectionView?.visibility(hidden); wardrobeView?.visibility(hidden);SOUND.visibility?.(hidden);
}
function beginIdentityCheck() {
  if(isPractice)return;
  identityEpoch++;identityVerified=false;identityCheckError='';cancelVoice();
  render();
}
async function verifyIdentity() {
  if(isPractice || !identityClient)return;
  if(identityCheckTask){identityRefreshPending=true;return identityCheckTask;}
  beginIdentityCheck();
  if(identityClient.state.busy){identityRefreshPending=true;return;}
  identityPanel?.close();
  identityCheckTask=(async()=>{
    try {
      const response=await identityClient.me();
      if(!response.player && !identityClient.state.busy)await identityClient.bootstrap();
    } catch(error){identityCheckError=error.message;render();}
    finally {identityCheckTask=null;if(identityRefreshPending){beginIdentityCheck();identityRefreshPending=false;setTimeout(()=>void verifyIdentity(),200);}}
  })();
  return identityCheckTask;
}
function revealIdentity(current,player,epoch) {
  if(epoch!==identityEpoch || current!==desk || identityRefreshPending)return false;
  const identityIssue=['PROFILE_CHANGED','IDENTITY_REQUIRED','SESSION_REQUIRED'].includes(current.issue?.code);
  if(!player || identityIssue || current.store && current.store.playerId!==player.playerId){
    identityVerified=false;identityCheckError=identityIssue?'身份已变化，正在重新确认':'暂时无法确认记录归属';
    render();if(identityIssue)queueMicrotask(()=>void verifyIdentity());return false;
  }
  identityVerified=true;identityCheckError='';resumeIdentityView();return true;
}
async function activateIdentity(player) {
  const epoch=++identityEpoch;
  const operation=identityClient?.state.operation;
  const replacing=activeIdentity?.playerId!==player?.playerId || activeIdentity?.kind!==player?.kind || ['register','login','logout','recover'].includes(operation);
  activeIdentity=player;
  if(!replacing){
    const current=desk;
    if(!identityVerified && player)await current.refresh();
    if(epoch!==identityEpoch || current!==desk)return;
    if(!revealIdentity(current,player,epoch))return;render();
    if(identityVerified && !['expired','replaced'].includes(connectionState))link.connect();
    return;
  }
  identityVerified=false;identityCheckError="";
  link.disconnect();desk?.dispose?.();collectionView?.reset(); wardrobeView?.reset();clearRoom();finishSaves.clear();pendingLearning.clear();
  panel=identityPanel?.isOpen?'identity':null;
  desk=createDesk();connectionState='closed';render();
  if(['guest','register','login','logout','recover'].includes(operation))identityChannel?.postMessage({type:'identity.changed'});
  if(!player){
    setTimeout(()=>{if(!activeIdentity&&!identityClient.state.busy&&!identityClient.state.uncertain)void identityClient.bootstrap().catch(e=>notice(e.message));},0);
    return;
  }
  const current=desk;
  await current.initialize();
  if(epoch!==identityEpoch||desk!==current)return;
  if(!revealIdentity(current,player,epoch))return;
  if(current.canStart)link.freshSession();
  render();
}
render();
scene = new ArenaScene({ canvas: $("#arena"), onPick: pick, onInspect: inspectUnit, getInputRevision:()=>room?.revision, reduced: preferences.reduced, externalHand:true,
  onHandDraw({ids,count}) { if (!room || !handScene) return; handScene.setHand(ids,{revision:room.revision,selectedIndex:null,costs:room.self.handCosts,finishes:equippedFinishes(desk?.data?.collection)}); handScene.animateDraw(count); },
  onAnchors(anchors) { anchorPositions = anchors; if (room) updateLabels(); },
  onStatus(status) { const changed = rendererStatus.available !== status.available; rendererStatus = { ...rendererStatus, ...status }; $("#arena").dataset.renderer = status.renderer; if (Number.isFinite(status.renderMs)) $("#arena").dataset.renderMs = String(status.renderMs); if (Number.isFinite(status.fps)) $("#arena").dataset.frameRate = String(status.fps); if (Number.isFinite(status.frameIntervalMs)) $("#arena").dataset.frameIntervalMs = String(status.frameIntervalMs); if (changed) render(); },
  onSound(kind) { playSceneSound(kind); },
});
handScene = new HandScene({canvas:$("#hand-canvas"), reduced:preferences.reduced,
  onSelect: handIntent,
  onInspect(intent) { if (validHandIntent(intent)) inspectHand(intent.index); },
  onFocus(intent) { updateHandFocus(intent?.index ?? 0); },
  onLayout(layout) { document.body.classList.toggle("hand-overflow",!!layout.maxScroll); const prev=$("#hand-prev"),next=$("#hand-next"); prev.hidden=!layout.maxScroll; next.hidden=!layout.maxScroll; prev.disabled=!layout.canScrollLeft; next.disabled=!layout.canScrollRight; $("#hand-hint").textContent=layout.maxScroll ? "滑动看更多 · 长按看详情" : "点选出牌 · 长按或右键看详情"; },
  onStatus(status) { const changed=handStatus.available!==status.available;handStatus=status;if(changed) syncHandView(!!modalRoot.querySelector(".dialog")); },
});
lobbyScene = new LobbyScene({canvas:$("#lobby-scene"),reduced:preferences.reduced,
  onPick(action) { if (room || panel || waiting) return; SOUND.unlock(); if(action === "match-setup") panel=action; else if(action === "study") openDesk(action); else if(action === "library") { library.open(); panel=action; } else if(action === "collection") { panel=action; collectionView?.open(); } render(); },
  onStatus(status) { const changed=lobbyStatus.available!==status.available;lobbyStatus=status;const canvas=$("#lobby-scene");canvas.dataset.renderer=status.renderer;if(Number.isFinite(status.fps))canvas.dataset.frameRate=String(status.fps);if(Number.isFinite(status.renderMs))canvas.dataset.renderMs=String(status.renderMs);if(changed)render(); },
});
$("#hand-prev").addEventListener("click",()=>handScene?.scrollBy(-180));
$("#hand-next").addEventListener("click",()=>handScene?.scrollBy(180));
$("#hand-semantics").addEventListener("focusin",event=>{const b=event.target.closest("[data-hand-index]");if(b)handScene?.focus(Number(b.dataset.handIndex));});
$("#hand-semantics").addEventListener("focusout",event=>{if(!$("#hand-semantics").contains(event.relatedTarget))handScene?.focus(null);});
$("#hand-semantics").addEventListener("click",event=>{const b=event.target.closest("[data-hand-index]");if(b){const index=Number(b.dataset.handIndex);if(handStatus.available===false)handIntent({kind:"card",index,cardId:room?.self.hand[index],revision:room?.revision,source:"fallback-button"});else handScene?.select(index,"accessible-button");}});
// The same intent rules apply to projected labels and the renderer-free board.
const boardLabelInput = new BoardInput({element:document, delegated:true, documentTarget:document, windowTarget:globalThis,
  pick(event) {
    const atPoint = Number.isFinite(event.clientX) && Number.isFinite(event.clientY) && (event.clientX || event.clientY)
      ? document.elementFromPoint(event.clientX,event.clientY) : event.target;
    const button = atPoint?.closest?.('[data-action="unit"]');
    return button ? {kind:"unit",uid:button.dataset.uid,seat:Number(button.dataset.seat)} : null;
  },
  getRevision:()=>room?.revision,
  isEnabled:()=> (isPractice || identityVerified) && room?.phase === "playing" && !challenge && !panel && !commandBusy && !visualBusy && !pageSuspended,
  onActivate(intent) { SOUND.unlock(); pick(intent); }, onInspect:inspectUnit,
});
const arenaResizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => { boardLabelInput.cancel(); scene?.resize(); }) : null;
arenaResizeObserver?.observe($("#arena"));
render();
collectionView = new CollectionView({root:$("#collection-root"),store:()=>desk?.store,preferences:()=>preferences,onNotice:notice,onSound:playSceneSound,onMuteChange:muted=>{if(muted)cancelVoice();SOUND.setTemporaryMute?.(muted);},onClose:()=>{panel=null;render();},onStudy:()=>{panel=null;openDesk("study");render();}});
wardrobeView = new WardrobeView({root:$("#wardrobe-root"),store:()=>desk?.store,preferences:()=>preferences,onNotice:notice,onSound:playSceneSound,onMuteChange:muted=>{if(muted)cancelVoice();SOUND.setTemporaryMute?.(muted);},onClose:()=>{panel=null;render();},onDaily:()=>{panel="daily";render();}});
SOUND.sync(preferences);
if(isPractice){link.connect();void desk.initialize();}
else {
  identityClient=new IdentityClient();
  identityPanel=new IdentityPanel({client:identityClient,onChanged:player=>{void activateIdentity(player);},
    onClose(){if(panel==='identity')panel=null;if(identityClient.state.busy||identityClient.state.uncertain){identityVerified=false;}render();},onNotice:notice});
  if(typeof BroadcastChannel==='function'){
    identityChannel=new BroadcastChannel('spellwood.identity.v1');
    identityChannel.addEventListener('message',event=>{
      if(event.data?.type!=='identity.changed')return;
      beginIdentityCheck();
      if(identityClient.state.busy){identityRefreshPending=true;return;}
      void verifyIdentity();
    });
  }
  identityClient.subscribe(state=>{if(!identityVerified&&!state.busy&&state.status==='error')identityCheckError=state.error?.message||'身份暂未确认，请重试';render();if(!state.busy&&identityRefreshPending&&!identityCheckTask){identityRefreshPending=false;void verifyIdentity();}});
  void identityClient.bootstrap().catch(e=>{connectionState='closed';identityCheckError=e.message;render();});
}

globalThis.addEventListener?.("pagehide", event => {
  pageSuspended = true;
  boardLabelInput.cancel();
  if(!isPractice){identityPanel?.close();beginIdentityCheck();}
  SOUND.visibility?.(true); cancelVoice(); desk?.visibility(false); collectionView?.visibility(true); wardrobeView?.visibility(true);
  handScene?.setHidden(true); lobbyScene?.setHidden(true); scene?.setHidden(true);
  clearTimeout(deadlineTimer); deadlineTimer = null; clearTimeout(rewardDayTimer); rewardDayTimer=null;
  // History-cache restoration reuses these same objects and practice authority.
  if (event.persisted) return;
  identityEpoch++;identityPanel?.destroy();identityChannel?.close();desk?.dispose?.();
  collectionView?.reset(); wardrobeView?.reset(); handScene?.dispose(); lobbyScene?.dispose(); scene?.dispose(); boardLabelInput.dispose(); arenaResizeObserver?.disconnect();
  if (link.destroy) link.destroy(); else link.disconnect();
});
globalThis.addEventListener?.("pageshow", event => {
  if (!event.persisted || !pageSuspended) return;
  pageSuspended = false;
  if(!isPractice){void verifyIdentity();return;}
  desk?.visibility(!document.hidden); collectionView?.visibility(document.hidden); wardrobeView?.visibility(document.hidden); SOUND.visibility?.(document.hidden);
  render();
  if (!["expired", "replaced"].includes(connectionState)) link.connect();
});

function validHandIntent(intent) {
  return (isPractice || identityVerified) && !!room && room.phase === "playing" && !challenge && !panel && !commandBusy && !visualBusy && intent.revision === room.revision && room.self.hand[intent.index] === intent.cardId;
}
function handIntent(intent) { if (validHandIntent(intent)) { SOUND.unlock();pick(intent); } }
function updateHandFocus(index) {
  const buttons=[...$("#hand-semantics").querySelectorAll("[data-hand-index]")];
  for(const b of buttons)b.tabIndex=Number(b.dataset.handIndex)===index?0:-1;
  if($("#hand-semantics").contains(document.activeElement)) buttons[index]?.focus({preventScroll:true});
}
function syncHandView(blocked=false) {
  const stage=$("#hand-stage"),active=!!room && room.phase === "playing";
  stage.hidden=!active;stage.inert=blocked;
  handScene?.setHidden(document.hidden || pageSuspended || !active || blocked);
  handScene?.setInteractive(active && !blocked && !commandBusy && !visualBusy);
  stage.classList.toggle("hand-fallback",handStatus.available===false);
  if(!active)return;
  const visible=displayRoom?.roomId===room.roomId?displayRoom:room;
  const ids=visible.self.hand,key=ids.join("|")+":"+(handStatus.available===false)+":"+visible.self.handCosts?.join("|");
  if(key!==handSemanticKey){handSemanticKey=key;$("#hand-semantics").innerHTML=ids.map((id,index)=>`<button data-hand-index="${index}" tabindex="${handStatus.available===false||index===0?0:-1}" aria-label="${esc(CARD[id].name)}，${visible.self.handCosts?.[index]??CARD[id].cost}能量，${esc(CARD[id].text)}。按I看完整说明">${esc(CARD[id].name)}</button>`).join("");}
  handScene?.setHand(ids,{revision:room.revision,selectedIndex:selected?.kind==="card"?selected.index:null,costs:visible.self.handCosts,finishes:equippedFinishes(desk?.data?.collection)});
}
