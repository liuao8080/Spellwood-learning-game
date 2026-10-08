import QUESTIONS from "./questions.json" with { type: "json" };
import CURRICULUM from "./curriculum.json" with { type: "json" };
import { FX } from "./av/effects.mjs";
import { SOUND } from "./av/audio.mjs";
import SPEECH_ASSETS from "./speech-assets.json" with { type: "json" };
import { SpeechDirector } from "./av/speech.mjs";
import { questionVisual } from "./learning-visuals.mjs";
import { PictureReadiness } from "./av/pictures.mjs";
import { SaveSession } from "./save-session.mjs";
import { openingPending } from "./opening.mjs";
import {
  CARDS,
  CARD,
  DECKS,
  OPPONENTS,
  GRADES,
  RULES,
  hasFiniteRituals,
  CONTENT_VERSION,
  LEGACY_CONTENT,
  RITUAL_LIMIT,
} from "./cards.mjs";
import {
  createMatch,
  finishOpening,
  legalActions,
  act,
  ritual,
  chooseAI,
  scoreMatch,
} from "./engine.mjs";
import {
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  freshSave,
  validateSave,
  questionFor,
  recordLearning,
  addRecord,
  masterySummary,
  inCourse,
} from "./learning.mjs";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let save = freshSave(),
  storageError = false,
  storageBlocked = false,
  recoveryRaw = "",
  existingRaw = "",
  legacyMigrationNeeded = false,
  storageReadPending = true;
try {
  existingRaw = localStorage.getItem(STORAGE_KEY) || "";
  recoveryRaw = localStorage.getItem(STORAGE_KEY + ".recovery") || "";
  storageReadPending = !existingRaw;
  if (existingRaw) save = validateSave(JSON.parse(existingRaw), QUESTIONS);
  else legacyMigrationNeeded = true;
} catch (e) {
  storageError = true;
  recoveryRaw = existingRaw;
  storageBlocked = true;
  try {
    if (existingRaw)
      localStorage.setItem(STORAGE_KEY + ".recovery", existingRaw);
  } catch (err) {
    storageBlocked = true;
  }
}
let lastStoredRaw = existingRaw;
let view = "lobby",
  modal = null,
  selected = null,
  prompt = null,
  feedback = null,
  locked = false,
  aiTimer = null,
  reviewQ = null,
  reviewAnswer = null,
  reviewSeen = new Set(),
  reviewRoundAttempts = 0,
  reviewRoundCorrect = 0,
  reviewComplete = false,
  rankGrade = save.grade,
  rankContent = "current",
  rankHistoryRule = "2.0",
  bookCourse = "all",
  bookGrade = save.grade,
  bookFilter = "due",
  bookListScroll = new Map(),
  renderedBookListKey = null,
  renderedReviewId = null,
  renderedReviewAnswered = false,
  importCandidate = null,
  importEpoch = 0,
  toastTimer = null,
  focusBefore = null,
  handScrollMatch = null,
  openingScrollMatch = null,
  openingSelection = [],
  openingAnimation = false;
const app = $("#app");
const PICTURES = new PictureReadiness();
const SESSION = new SaveSession({
  lockName: STORAGE_KEY + ".writer",
  channelName: STORAGE_KEY + ".session",
  beforeYield: () => {
    if (storageError || storageBlocked || storageReadPending) {
      toast("请先导出此页进度，关闭此页后，在另一页恢复备份");
      return false;
    }
    return true;
  },
  onChange: sessionChanged,
});
const icons = {
  leaf: "❧",
  spark: "✦",
  moon: "☾",
  shield: "⬡",
  sound: "♫",
  book: "▤",
  star: "◇",
};
const art = (n, cls = "") =>
  `<span class="portrait art${n} ${cls}" aria-hidden="true"></span>`;
const gradeButtons = (current, action) =>
  `<div class="grades" role="group" aria-label="选择年级">${GRADES.map((g) => `<button class="${current === g.n ? "chosen" : ""}" data-action="${action}" data-value="${g.n}" aria-pressed="${current === g.n}">${g.n}<small>年级</small></button>`).join("")}</div>`;
function navigationContext() {
  return view === "battle" && save.match ? save.match : save;
}
function courseLabel(course = "all", grade = save.grade) {
  if (course === "all") return "全年级 · 72项";
  const semester = course[1] === "1" ? "上册" : "下册";
  if (course.length === 2) return semester + " · 36项";
  const u = CURRICULUM.units.find((u) => u.id === `g${grade}-${course}`);
  return u ? `${semester} U${u.unit} ${u.unit_title_zh}` : semester;
}
function coursePicker(grade, value, action) {
  return `<label class="field-label" for="${action}-select">学习范围</label><select id="${action}-select" data-change="${action}"><option value="all" ${value === "all" ? "selected" : ""}>全年级 · 72项</option>${[
    1, 2,
  ]
    .map(
      (semester) =>
        `<optgroup label="${semester === 1 ? "上册" : "下册"}"><option value="s${semester}" ${value === `s${semester}` ? "selected" : ""}>${semester === 1 ? "上册" : "下册"}全部 · 36项</option>${CURRICULUM.units
          .filter((u) => u.grade === grade && u.semester === semester)
          .map(
            (u) =>
              `<option value="s${semester}-u${u.unit}" ${value === `s${semester}-u${u.unit}` ? "selected" : ""}>Unit ${u.unit} · ${esc(u.unit_title_zh)} ${esc(u.unit_title)} · 6项</option>`,
          )
          .join("")}</optgroup>`,
    )
    .join("")}</select>`;
}
function persist() {
  if (storageBlocked || !SESSION.canWrite) return false;
  try {
    const disk = localStorage.getItem(STORAGE_KEY) || "";
    if (disk !== lastStoredRaw) {
      if (acceptExternal(disk))
        toast("另一个窗口刚更新了进度，已同步，请重试刚才的操作");
      return false;
    }
    const nextRaw = JSON.stringify(save);
    localStorage.setItem(STORAGE_KEY, nextRaw);
    lastStoredRaw = nextRaw;
    storageError = false;
    return true;
  } catch (e) {
    if (!storageError) {
      storageError = true;
      toast("浏览器未能保存进度，请先导出备份或重试保存");
    }
    pauseForSaveIssue();
    render();
    return false;
  }
}
function acceptExternal(raw) {
  stopSpeech();
  actionEpoch++;
  FX.cancel();
  visualMatch = null;
  try {
    const next = raw ? validateSave(JSON.parse(raw), QUESTIONS) : freshSave();
    save = next;
    lastStoredRaw = raw;
    storageBlocked = false;
    storageError = false;
    storageReadPending = false;
    clearTimeout(aiTimer);
    locked = false;
    selected = null;
    prompt = null;
    openingSelection = [];
    openingAnimation = false;
    resetReviewRound();
    if (view === "battle" && !save.match) view = "lobby";
    if (modal === "result" && save.match?.phase !== "finished") modal = null;
    render();
    scheduleAI();
    return true;
  } catch (e) {
    storageBlocked = true;
    clearTimeout(aiTimer);
    if (raw) {
      recoveryRaw = raw;
      try {
        localStorage.setItem(STORAGE_KEY + ".recovery", raw);
      } catch {}
    }
    toast("另一窗口的存档无法读取，已暂停写入以保护当前进度");
    pauseForSaveIssue();
    render();
    return false;
  }
}
function hasSaveProblem() {
  return storageBlocked || storageError || storageReadPending;
}
function pauseForSaveIssue() {
  actionEpoch++;
  clearTimeout(aiTimer);
  FX.cancel();
  stopSpeech();
  visualMatch = null;
  locked = false;
  openingAnimation = false;
  selected = null;
}
function recoveryVisible() {
  return (
    SESSION.canWrite &&
    hasSaveProblem() &&
    !["replace-import", "new-progress"].includes(modal)
  );
}
function storageRecoveryHTML() {
  if (!recoveryVisible()) return "";
  return `<div class="modal-backdrop storage-shield"><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="storage-title"><div class="eyebrow">KEEP YOUR PROGRESS SAFE</div><h2 id="storage-title">${storageBlocked ? "这份进度需要恢复" : "进度还没有存好"}</h2><p>${storageBlocked ? "保存的内容暂时无法读取。对战与练习已暂停，原始内容不会被悄悄清空。" : "浏览器暂时无法写入。这一页仍保留刚才的进度，已暂停继续操作。请不要刷新或关闭，先导出备份，再重试保存。"}</p><div class="recovery-actions"><button class="primary" data-action="export">导出本页当前进度 ↓</button>${recoveryRaw ? '<button class="secondary" data-action="export-recovery">导出无法读取的原始备份 ↓</button>' : ""}<button class="secondary" data-action="storage-retry">${storageBlocked ? "重试读取已保存的进度" : "重试保存"}</button><button class="text-btn" data-action="import">选择有效备份恢复</button>${storageBlocked && !storageReadPending ? '<button class="text-btn" data-action="storage-new">保留原始备份，建立新进度</button>' : ""}</div><p class="small-copy">导出的文件只保存在你的设备，不会上传。恢复或建立新进度需要再次确认。无法保存时，可换浏览器恢复有效备份。</p></section></div>`;
}
function retryStorage() {
  if (!SESSION.canWrite) return;
  if (!storageBlocked && !storageReadPending) {
    if (persist()) toast("进度已保存，可以继续了");
  } else {
    let readCompleted = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || "";
      if (raw) {
        readCompleted = true;
        storageReadPending = false;
        if (!acceptExternal(raw)) return;
        toast("已重新读取保存的进度");
      } else {
        const oldRaw = localStorage.getItem(LEGACY_STORAGE_KEY) || "";
        readCompleted = true;
        storageReadPending = false;
        if (oldRaw) {
          let candidate;
          try {
            candidate = validateSave(JSON.parse(oldRaw), QUESTIONS);
          } catch (error) {
            recoveryRaw = oldRaw;
            throw error;
          }
          const nextRaw = JSON.stringify(candidate);
          localStorage.setItem(STORAGE_KEY, nextRaw);
          save = candidate;
          lastStoredRaw = nextRaw;
          toast("旧进度已复制到新版，原始内容仍保留");
        } else {
          save = freshSave();
          lastStoredRaw = "";
          toast("当前浏览器没有存档，可以开始新的冒险");
        }
        storageBlocked = false;
        storageError = false;
        legacyMigrationNeeded = false;
      }
    } catch {
      if (!readCompleted) {
        storageReadPending = true;
        storageBlocked = true;
        storageError = true;
      }
      toast("仍未能读取并保存进度，请导出原始备份或选择有效备份恢复");
    }
  }
  render();
  scheduleAI();
}
function commitRestoredSave(candidate, fresh = false) {
  if (storageReadPending) {
    toast("请先重试读取原进度，确认原档后再恢复；也可换浏览器恢复备份");
    return false;
  }
  const restoredRaw = JSON.stringify(candidate);
  try {
    // Preserve any unreadable original durably before replacing its main slot.
    if (recoveryRaw)
      localStorage.setItem(STORAGE_KEY + ".recovery", recoveryRaw);
    localStorage.setItem(STORAGE_KEY, restoredRaw);
  } catch {
    toast("浏览器未能写入备份，尚未恢复；当前进度未替换");
    return false;
  }
  actionEpoch++;
  importEpoch++;
  FX.cancel();
  visualMatch = null;
  clearTimeout(aiTimer);
  save = candidate;
  bookListScroll.clear();
  renderedBookListKey = null;
  renderedReviewId = null;
  lastStoredRaw = restoredRaw;
  importCandidate = null;
  storageBlocked = false;
  storageError = false;
  view = "lobby";
  locked = false;
  selected = null;
  prompt = null;
  closeModal();
  toast(fresh ? "新进度已建立，原始备份仍保留" : "存档已恢复");
  return true;
}
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}
let visualMatch = null,
  actionEpoch = 0;
const shownMatch = () => visualMatch || save.match;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function sound(kind = "click") {
  SOUND.play(kind);
}

const SPEECH = new SpeechDirector(SPEECH_ASSETS, {
  duck: (value) => SOUND.duckSpeech(value),
  notify: toast,
});
function stopSpeech() {
  SPEECH.stop();
}
function speak(text) {
  SPEECH.play(text, save.speech);
}
function header() {
  return `<header class="topbar"><button class="brand" data-action="home" aria-label="返回营地"><span class="brand-gem">✧</span><span>SPELLWOOD<small>词 灵 对 决</small></span></button><nav aria-label="游戏导航"><button data-action="book" aria-label="词灵手册">${icons.book}<span>词灵手册</span></button><button data-action="ranks" aria-label="挑战榜">♜<span>挑战榜</span></button><button class="music-control" data-action="music-toggle" aria-label="背景音乐${save.music ? "已开启" : "已关闭"}" aria-pressed="${save.music}">${save.music ? "♫" : "♪"}</button><button data-action="help" aria-label="玩法说明">?</button><button data-action="settings" aria-label="设置与存档">⚙</button></nav></header>`;
}
function cardHTML(c, opts = {}) {
  const {
    index,
    preview = false,
    selected: chosen = false,
    disabled = false,
    opening = false,
  } = opts;
  return `<button class="game-card ${c.theme} ${c.type === "spell" ? "spell" : ""} ${preview ? "preview" : ""} ${chosen ? "selected" : ""} ${disabled ? "unplayable" : ""} ${opening ? "opening-card" : ""}" ${preview ? 'tabindex="-1"' : `data-action="${opening ? "opening-card" : "card"}" data-index="${index}" ${opening ? `aria-pressed="${chosen}"` : ""}`} aria-label="${c.name}，${c.cost}能量，${c.type === "spell" ? c.text : `攻击${c.atk}生命${c.hp}，${c.text}`}" ${disabled ? 'data-unplayable="true"' : ""}><span class="cost">${c.cost}</span><span class="card-art">${art(c.art)}</span><span class="card-name">${c.name}</span><span class="card-en">${c.en}</span><span class="card-text">${c.text}</span>${c.type !== "spell" ? `<span class="stat attack">${c.atk}</span><span class="stat health">${c.hp}</span>` : `<span class="spell-type">法 术</span>`}</button>`;
}
function lobby() {
  const summary = masterySummary(save, QUESTIONS, save.grade),
    op = OPPONENTS.find((o) => o.id === save.opponentId),
    g = GRADES[save.grade - 1];
  return `<main class="lobby"><section class="lobby-stage" aria-label="魔法森林"><div class="chapter">CHAPTER 0${save.grade} <i></i> ${g.name}</div><h1>词灵对决</h1><p class="lobby-whisper">让每一个单词，成为你的力量</p><div class="card-fan" aria-hidden="true">${cardHTML(CARD.turtle, { preview: true })}${cardHTML(CARD.fox, { preview: true })}${cardHTML(CARD.dragon, { preview: true })}</div><div class="stage-caption"><span>策略出牌</span><b>✧</b><span>唤醒词灵</span><b>✧</b><span>守护森林</span></div></section><section class="setup-panel"><div class="eyebrow">YOUR NEXT ADVENTURE</div><h2>准备好出发了吗？</h2><label class="field-label">选择你的年级</label>${gradeButtons(save.grade, "grade")}<p class="grade-sub">${g.sub}</p><div class="course-picker">${coursePicker(save.grade, save.course, "course")}</div><label class="field-label" for="deck-select">带上你的套牌</label><select id="deck-select" data-change="deck">${DECKS.map((d) => `<option value="${d.id}" ${save.deckId === d.id ? "selected" : ""}>${d.name} · ${d.sub.split(" · ")[0]}</option>`).join("")}</select><div class="opponent-heading"><span class="field-label">这次与谁交手？</span><button class="text-btn" data-action="opponent-info">了解对手 ↗</button></div><div class="opponent-picker">${OPPONENTS.map((o) => `<button data-action="opponent" data-value="${o.id}" class="${o.id === op.id ? "chosen" : ""}" aria-pressed="${o.id === op.id}">${art(o.art)}<span>${o.name}</span></button>`).join("")}</div><div class="opponent-note">${op.title} <span>·</span> ${op.desc}</div><button class="primary start" data-action="start">开始对战 <span>✦</span></button>${save.match?.phase === "playing" ? `<button class="resume" data-action="resume">继续${save.match.grade}年级 · ${esc(courseLabel(save.match.course, save.match.grade))} →</button>` : ""}<div class="journey-progress"><div><span>你的森林足迹</span><strong>${summary.seen} <small>/ ${summary.total} 项</small></strong></div><div class="progress-track"><span style="width:${(summary.seen / summary.total) * 100}%"></span></div><small>${summary.learned} 项熟练 · ${summary.due} 项待复习</small></div></section><div class="lobby-foot"><span>原创卡牌 · 一年级起点课程练习</span><button data-action="help">第一次来？看看怎么玩 →</button></div></main>`;
}
function energy(p) {
  return `<span class="energy-dots" aria-label="${p.mana} / ${p.maxMana} 能量">${Array.from({ length: 6 }, (_, i) => `<i class="${i < p.mana ? "full" : i < p.maxMana ? "used" : ""}"></i>`).join("")}<b>${p.mana}/${p.maxMana}</b></span>`;
}
function canTarget(target) {
  if (!save.match || !selected) return false;
  if (selected.type === "ritual")
    return (
      target === "hero" ||
      save.match.players[1].board.some((u) => u.uid === target)
    );
  return legalActions(save.match).some(
    (a) =>
      a.target === target &&
      (selected.type === "card"
        ? a.type === "play" && a.index === selected.index
        : a.type === "attack" && a.uid === selected.uid),
  );
}
function hero(side) {
  const s = shownMatch(),
    p = s.players[side],
    op = OPPONENTS.find((o) => o.id === s.opponentId),
    name = side ? op.name : save.nickname;
  return `<div class="hero-row ${side ? "opponent" : "self"}"><button class="hero ${side && canTarget("hero") ? "targetable" : ""} ${p.armor ? "armored" : ""}" data-action="${side ? "target" : "self-info"}" data-target="hero" aria-label="${esc(name)}，生命${Math.max(0, p.hp)}，护甲${p.armor}"><span class="hero-frame">${art(side ? op.art : 0)}<span class="hero-health">${Math.max(0, p.hp)}</span>${p.armor ? `<span class="armor">⬡ ${p.armor}</span>` : ""}</span><span class="hero-name">${esc(name)}<small>${side ? op.title : "森林行者"}</small></span><span class="life-track"><i style="width:${(Math.max(0, p.hp) / 18) * 100}%"></i></span></button><div class="hero-resource">${energy(p)}${hasFiniteRituals(s.rules) ? `<span class="ritual-count">✧ 仪式 ${p.ritualsLeft}/${RITUAL_LIMIT}</span>` : ""}${side ? `<span class="opponent-hand">${Array.from({ length: p.hand.length }, () => "<i></i>").join("")}<small>${p.hand.length}张手牌</small></span>` : ""}</div></div>`;
}

function units(side) {
  const s = shownMatch(),
    p = s.players[side];
  return `<div class="unit-row ${side ? "enemy-row" : "friend-row"}" aria-label="${side ? "对手" : "你的"}随从">${p.board
    .map((u) => {
      const c = CARD[u.cardId],
        sel = selected?.uid === u.uid;
      return `<button class="unit ${c.theme} ${c.keyword === "guard" ? "guard" : ""} ${!side && u.ready && s.active === 0 ? "ready" : ""} ${sel ? "selected" : ""} ${side && canTarget(u.uid) ? "targetable" : ""}" data-action="${side ? "target" : "unit"}" data-target="${esc(u.uid)}" aria-label="${c.name}，攻击${u.atk}，生命${u.hp}${c.keyword === "guard" ? "，守卫" : ""}${!side ? (u.ready ? "，可以攻击" : "，休息中") : ""}">${art(c.art)}<span class="unit-name">${c.name}</span>${c.keyword === "guard" ? '<span class="unit-keyword">守卫</span>' : !side && !u.ready ? '<span class="unit-keyword sleeping">休息</span>' : ""}<span class="stat attack">${u.atk}</span><span class="stat health ${u.hp < u.maxHp ? "wounded" : ""}">${u.hp}</span></button>`;
    })
    .join(
      "",
    )}${Array.from({ length: 4 - p.board.length }, () => '<span class="empty-slot" aria-hidden="true">✧</span>').join("")}</div>`;
}
function ritualPanel() {
  const s = shownMatch(),
    p = s.players[0],
    disabled =
      s.phase !== "playing" ||
      s.active !== 0 ||
      p.ritualUsed ||
      (hasFiniteRituals(s.rules) && p.ritualsLeft <= 0) ||
      !!prompt ||
      locked;
  return `<div class="ritual-bar"><div class="ritual-label"><strong>词灵仪式</strong><small>${hasFiniteRituals(s.rules) ? (p.ritualsLeft <= 0 ? "本局仪式已用完" : `${p.ritualUsed ? "本回合已用 · " : ""}本局剩${p.ritualsLeft}次`) : p.ritualUsed ? "本回合已使用" : "每回合任选一次"}</small></div>${[
    ["insight", "☾", "灵光", "抽1张牌"],
    ["spark", "✦", "火花", "造成2伤害"],
    ["bloom", "❧", "守护", "恢复3生命"],
  ]
    .map(
      ([id, icon, name, effect]) =>
        `<button data-action="ritual" data-value="${id}" ${disabled || (hasFiniteRituals(s.rules) && ((id === "bloom" && p.hp >= 18) || (id === "insight" && (p.hand.length >= 7 || !p.deck.length)))) ? "disabled" : ""}><span>${icon}</span><b>${name}</b><small>${effect}</small></button>`,
    )
    .join("")}</div>`;
}

function battle() {
  const s = shownMatch(),
    p = s.players[0];
  return `<main class="duel-stage"><section class="battle-field ${selected ? "has-selection" : ""}"><div class="arena-head"><div class="battle-meta"><button class="text-btn" data-action="home">‹ 营地</button><span>${s.grade}年级 · ${esc(courseLabel(s.course, s.grade))}</span><button class="text-btn" data-action="match-info">${esc(s.seed)} ⓘ</button></div>${hero(1)}<div class="opponent-deck"><span class="mini-back">✧</span><b>${s.players[1].deck.length}</b><small>对手牌库</small></div></div><div class="arena-core"><div class="arena-ornament" aria-hidden="true"></div>${units(1)}<div class="battle-divider"><span class="round-mark">${Math.ceil(s.turn / 2)}<small>回合</small></span><span class="turn-label ${s.active === 0 ? "your-turn" : ""}">${s.phase === "finished" ? "对战结束" : locked ? "魔法正在回应…" : s.active === 0 ? "你的回合" : "对手的回合"}</span><span class="learning-score">✦ ${s.correct}/${s.attempts}<small>首答正确</small></span></div>${units(0)}</div><div class="battle-echo" aria-live="polite">${esc(s.log[0] || "森林正在聆听")}</div><div class="command-strip">${commandBar()}<button class="end-turn" data-action="end" ${s.active !== 0 || prompt || locked || openingPending(s) || s.phase !== "playing" ? "disabled" : ""}>结束回合 <span>➜</span></button></div><div class="player-dock">${hero(0)}<div class="hand-shelf"><div class="hand-caption"><span>你的手牌 <b>${p.hand.length}/7</b></span><span class="hand-browse"><small>牌库 ${p.deck.length}</small><button data-action="hand-prev" aria-label="向左浏览手牌">‹</button><button data-action="hand-next" aria-label="向右浏览手牌">›</button></span></div><div class="hand-row" aria-label="你的手牌">${p.hand.map((id, index) => cardHTML(CARD[id], { index, selected: selected?.type === "card" && selected.index === index, disabled: locked || s.active !== 0 || CARD[id].cost > p.mana || (CARD[id].type !== "spell" && p.board.length >= 4) })).join("")}${p.hand.length ? "" : `<p class="empty-hand ${p.deck.length ? "" : "fatigue-warning"}">${p.deck.length ? "下回合会抽到1张新牌" : `牌库已空，下次抽牌将受${p.fatigue + 1}点疲劳伤害`}</p>`}</div></div>${ritualPanel()}</div></section>${selected?.type === "card" && CARD[p.hand[selected.index]] ? `<aside class="card-focus-preview" aria-hidden="true">${cardHTML(CARD[p.hand[selected.index]], { preview: true })}</aside>` : ""}${spellSheet()}${openingSheet(s)}</main>`;
}
function openingSheet(s) {
  if (!openingPending(s)) return "";
  const op = OPPONENTS.find((o) => o.id === s.opponentId);
  return `<div class="opening-scrim"><section class="opening-sheet" role="dialog" aria-modal="true" aria-labelledby="opening-title"><div class="eyebrow">PLAN YOUR FIRST TURN</div><h2 id="opening-title">挑好起手，再出发</h2><p class="opening-tip">点击想换掉的牌，最多2张。<strong>建议留下1费、2费伙伴。</strong></p><div class="opening-hand">${s.players[0].hand.map((id, index) => `<div class="opening-pick">${cardHTML(CARD[id], { index, opening: true, selected: openingSelection.includes(index) })}<span class="opening-label ${openingSelection.includes(index) ? "swap" : ""}">${openingSelection.includes(index) ? "↻ 换这张" : "保留"}</span></div>`).join("")}</div><p class="opening-opponent">${op.name}已自主调整${s.opening.opponent.length}张起手 · 双方最多可换2张</p><div class="opening-controls"><button class="primary" data-action="opening-confirm">${openingSelection.length ? `换${openingSelection.length}张，开始对战` : "保留起手，开始对战"}</button><button class="text-btn" data-action="home">先回营地</button></div><small>只在开局换一次，不消耗能量或仪式。可能抽到同名副本。</small></section></div>`;
}
async function confirmOpening() {
  if (
    !SESSION.canWrite ||
    hasSaveProblem() ||
    locked ||
    !openingPending(save.match)
  )
    return;
  const next = finishOpening(save.match, openingSelection);
  if (next === save.match) return;
  const epoch = ++actionEpoch;
  save.match = next;
  openingSelection = [];
  openingAnimation = true;
  locked = true;
  persist();
  if (epoch !== actionEpoch || save.match?.id !== next.id) return;
  render();
  sound("summon");
  await pause(FX.reduced ? 40 : 500);
  if (epoch !== actionEpoch) return;
  openingAnimation = false;
  locked = false;
  render();
  $(".hand-row [data-action=card]")?.focus();
}
function playBlock(s, c) {
  const p = s.players[0];
  if (c.cost > p.mana) return `需要${c.cost}点能量`;
  if (c.type !== "spell" && p.board.length >= 4) return "伙伴位置已满";
  if (hasFiniteRituals(s.rules) && c.keyword === "restore" && p.hp >= 18)
    return "生命已满，留待以后";
  return "";
}
function commandBar() {
  const s = shownMatch();
  if (selected?.type === "card") {
    const c = CARD[s.players[0].hand[selected.index]];
    if (c) {
      const blocked = playBlock(s, c);
      return `<div class="card-command"><strong>${c.name}</strong><span>${c.text}</span>${blocked ? `<button class="primary" disabled>${blocked}</button>` : c.keyword === "damage" ? '<b class="target-instruction">选择发光的敌人</b>' : `<button class="primary" data-action="play" ${locked ? "disabled" : ""}>${c.type === "spell" ? "施放法术" : "召唤伙伴"}</button>`}<button class="cancel-command" data-action="cancel" aria-label="取消选择">×</button></div>`;
    }
  }
  if (selected)
    return `<div class="aim-command"><span>➶</span><strong>${selected.type === "ritual" ? "为火花选择目标" : "选择攻击目标"}</strong><small>${selected.type === "ritual" ? "可直击英雄，不受守卫阻挡" : "先突破守卫，再直击英雄"}</small><button class="text-btn" data-action="cancel">取消</button></div>`;
  return `<div class="action-hint"><strong>${locked ? "稍等，动作正在结算" : s.active === 0 ? "召唤伙伴 · 安排进攻 · 唤醒词灵" : "观察对手，准备下一步"}</strong><small>${s.turn < 4 ? "点一张手牌，再点“召唤伙伴”；准备好的随从可以点选敌人攻击。" : "保留资源，还是把握这一击？由你决定。"}</small></div>`;
}
function spellSheet() {
  if (!prompt) return "";
  const q = QUESTIONS.find((q) => q.id === prompt.qid);
  const unit = CURRICULUM.units.find((u) => u.id === q.unitId);
  if (prompt.answer !== null)
    return `<aside class="spell-feedback ${prompt.answer === q.answer ? "success" : "try-again"}" role="status"><div><strong>${prompt.answer === q.answer ? "✦ 词灵回应了你" : "⬡ 获得1点护甲"}</strong><p>${esc(q.explanation)}</p>${unit ? `<small>知识范围：本单元课本第${unit.printed_pages.join("、")}页 · 原创练习</small>` : ""}</div><button class="text-btn replay-speech" data-action="speak" data-value="${q.id}">♫ 听英语</button><button class="primary" data-action="continue" ${locked ? "disabled" : ""}>${locked ? "施法中…" : "继续对战"}</button></aside>`;
  return `<div class="spell-scrim"><section class="spell-sheet ${q.type === "cloze" ? "context-task" : ""}" id="question-panel" role="dialog" aria-modal="true" aria-labelledby="spell-title"><div class="spell-emblem">${{ insight: "☾", spark: "✦", bloom: "❧" }[prompt.kind]}</div><button class="close-btn" data-action="cancel-prompt" aria-label="暂不施法">×</button><div class="eyebrow">AWAKEN YOUR MAGIC</div><h2 id="spell-title">${{ insight: "唤醒灵光", spark: "点亮火花", bloom: "唤醒守护" }[prompt.kind]}</h2><p class="ritual-reward">${{ insight: "答对抽1张牌", spark: "答对向目标造成2伤害", bloom: "答对恢复3生命" }[prompt.kind]} · 答错也有1护甲${hasFiniteRituals(save.match.rules) ? ` · 本局剩${save.match.players[0].ritualsLeft}次` : ""}</p>${questionHTML(q, null)}<small class="spell-reassure">慢慢想，没有倒计时</small></section></div>`;
}

function questionHTML(q, answered, answerAction = "answer") {
  const unit = CURRICULUM.units.find((u) => u.id === q.unitId);
  const visual = questionVisual(q);
  const promptText = `<p class="question-prompt">${esc(q.prompt)}</p>`;
  return `<div class="question-heading"><span>${q.type === "word" ? "词汇唤醒" : q.type === "sentence" ? (q.grade < 3 ? "生活短句" : "句子魔法") : "语境探索"}</span><button class="speak" data-action="speak" data-value="${q.id}" aria-label="朗读英语">♫ 听英语</button></div>${unit ? `<div class="question-source">${q.grade}年级${q.semester === 1 ? "上" : "下"}册 · Unit ${unit.unit} ${esc(unit.unit_title)}</div>` : ""}${visual ? `<div class="question-visual-line">${visual}${promptText}</div>` : promptText}${q.text ? `<p class="question-english">${esc(q.text).replace(/___+/g, '<span class="blank">&nbsp;&nbsp;&nbsp;</span>')}</p>` : ""}<div class="answers">${q.options.map((o, i) => `<button data-action="${answerAction}" data-index="${i}" class="${answered !== null ? (i === q.answer ? "correct" : i === answered ? "incorrect" : "muted") : ""}" ${answered !== null ? "disabled" : ""}><span>${String.fromCharCode(65 + i)}</span>${esc(o)}${answered !== null && i === q.answer ? "<b>✓</b>" : ""}</button>`).join("")}</div>${answered !== null ? `<div class="explanation"><strong>${answered === q.answer ? "记住这一点 ✦" : "一起记住这个答案"}</strong><p>${esc(q.explanation)}</p>${unit ? `<small>知识范围：本单元课本第${unit.printed_pages.join("、")}页 · 原创练习</small>` : ""}</div>` : ""}`;
}

function focusIdentity(node) {
  if (!node) return null;
  if (node.id) return { id: node.id };
  const keys = ["action", "value", "target", "index", "change", "field"];
  const data = Object.fromEntries(
    keys
      .filter((k) => node.dataset?.[k] !== undefined)
      .map((k) => [k, node.dataset[k]]),
  );
  return Object.keys(data).length ? { data } : null;
}
function restoreFocus(identity) {
  if (!identity) return;
  const nodes = [...document.querySelectorAll("button,input,select,a[href]")];
  const node = nodes.find(
    (n) =>
      !n.disabled &&
      (identity.id
        ? n.id === identity.id
        : Object.entries(identity.data).every(
            ([key, value]) => n.dataset?.[key] === value,
          )),
  );
  node?.focus?.({ preventScroll: true });
}
function focusSelection(choice) {
  if (!choice) return;
  const data =
    choice.type === "card"
      ? { action: "card", index: String(choice.index) }
      : choice.type === "unit"
        ? { action: "unit", target: choice.uid }
        : { action: "ritual", value: "spark" };
  restoreFocus({ data });
}
function cancelQuestion() {
  const kind = prompt?.kind;
  stopSpeech();
  prompt = null;
  render();
  if (kind) restoreFocus({ data: { action: "ritual", value: kind } });
}
function openModal(name) {
  importEpoch++;
  clearTimeout(aiTimer);
  stopSpeech();
  if (locked) {
    actionEpoch++;
    visualMatch = null;
    locked = false;
    openingAnimation = false;
    FX.cancel();
  }
  if (!modal) focusBefore = focusIdentity(document.activeElement);
  modal = name;
  render();
  setTimeout(
    () =>
      $(".modal-card button, .modal-card input, .modal-card select")?.focus(),
    0,
  );
}
function closeModal() {
  importEpoch++;
  stopSpeech();
  modal = null;
  resetReviewRound();
  render();
  restoreFocus(focusBefore);
  scheduleAI();
}
function modalHTML() {
  if (!modal) return "";
  let title = "",
    body = "",
    wide = false;
  if (modal === "help") {
    title = "森林行者指南";
    body = `<div class="guide-grid"><section><b>01 · 召唤伙伴</b><p>新开局可免费换0–2张起手，建议留下低费伙伴。卡牌左上角是能量，底部是攻击和生命。点选手牌，再点“召唤伙伴”。每回合能量补满并增加1，上限6。</p></section><section><b>02 · 做出战术选择</b><p>点己方场上的伙伴，再点敌人。新伙伴通常要等下回合；“迅捷”可立即攻击。“守卫”必须优先突破。</p></section><section><b>03 · 英语唤醒仪式</b><p>新规则每局4次，每回合最多选一次灵光、火花或守护。电脑对手也有4次技能，会根据场面选择。答对有完整效果，答错仍获得1护甲，并能看到解释。没有倒计时，也可以留下次数以后再用。火花可以越过守卫选择英雄。</p></section><section><b>04 · 完成一次冒险</b><p>把对方生命降到0就获胜。最多4个伙伴、7张手牌。牌库用完后会受到逐渐增加的疲劳伤害。对局会自动保存。</p></section></div><p class="notice">每个年级有72项原创练习，按一年级起点教材的12个单元组织。可选上下册或当前单元，具体知识范围见词灵手册。玩完一局，记得让眼睛休息一下。</p><button class="primary" data-action="close">知道了，出发</button>`;
    wide = true;
  }
  if (modal === "opponent-info") {
    const op = OPPONENTS.find(
      (x) =>
        x.id === (view === "battle" ? save.match.opponentId : save.opponentId),
    );
    title = `认识 ${op.name}`;
    body = `<div class="profile-art">${art(op.art)}</div><p class="big-copy">${op.title}</p><p>${op.desc}</p><div class="notice">${op.name} 是游戏中的电脑角色，会根据自己的手牌、场上随从与可用能量自主选择行动。它不读取你的隐藏手牌，也不预知牌库顺序；会寻找本回合可完成的胜利，并防范公开场面的下一轮攻击。新规则下双方每局各有4次仪式。没有真人匹配或在线人数。</div>`;
  }
  if (modal === "match-info") {
    const s = save.match;
    title = "这场挑战";
    body = `<p>挑战种子：<strong>${esc(s.seed)}</strong></p><p>${s.grade}年级 · ${DECKS.find((x) => x.id === s.deckId).name} · ${OPPONENTS.find((x) => x.id === s.opponentId).name}</p><p>相同规则、种子、年级、学习范围、题库版本、套牌和对手使用相同初始发牌与题目顺序。新规则下，同样的换牌选择得到相同结果；后续抽牌会随你的换牌选择改变。可以在结算后重赛，比较不同策略。</p>${s.archivedReview?.length ? `<p>已保留${s.archivedReview.length}项旧版对局错题索引，导出存档时一并带走；新版练习使用修订后的题目。</p>` : ""}<p class="notice">规则 ${esc(s.rules)} · 题库 ${s.contentVersion === CONTENT_VERSION ? CONTENT_VERSION : "旧版衔接局"} · ${esc(courseLabel(s.course, s.grade))} · 挑战榜是当前浏览器的本机记录，不是全服竞技排名。</p><h3>最近的交战</h3><ol class="combat-log">${s.log
      .slice(0, 8)
      .map((line) => `<li>${esc(line)}</li>`)
      .join("")}</ol>`;
  }
  if (modal === "settings") {
    title = "营地设置";
    body = `<label class="field-label" for="nickname">冒险昵称</label><input id="nickname" maxlength="16" value="${esc(save.nickname)}" placeholder="例如 Leaf"><p class="small-copy">取一个喜欢的昵称就好，请不要填写真实姓名。改昵称不会新建学习档案；共用设备请各自保存备份</p><div class="setting-row"><span>背景音乐</span><button class="toggle ${save.music ? "on" : ""}" data-action="toggle" data-value="music" aria-pressed="${save.music}">${save.music ? "已开启" : "已关闭"}</button></div><label class="volume-row">音乐音量 <input type="range" min="0" max="100" value="${save.musicVolume}" data-change="volume" data-field="musicVolume"><strong>${save.musicVolume}%</strong></label><div class="setting-row"><span>游戏音效</span><button class="toggle ${save.sound ? "on" : ""}" data-action="toggle" data-value="sound" aria-pressed="${save.sound}">${save.sound ? "已开启" : "已关闭"}</button></div><div class="setting-row"><span>英语朗读</span><button class="toggle ${save.speech ? "on" : ""}" data-action="toggle" data-value="speech" aria-pressed="${save.speech}">${save.speech ? "已开启" : "已关闭"}</button></div><label class="volume-row">音效音量 <input type="range" min="0" max="100" value="${save.soundVolume}" data-change="volume" data-field="soundVolume"><strong>${save.soundVolume}%</strong></label><div class="setting-row"><span>减少动态效果</span><button class="toggle ${save.reduced ? "on" : ""}" data-action="toggle" data-value="reduced" aria-pressed="${save.reduced}">${save.reduced ? "已开启" : "已关闭"}</button></div><h3>保管你的冒险</h3>${SESSION.status === "unsupported" ? '<p class="notice">当前浏览器没有启用多窗口保护，请只打开一个词灵对决页面，避免同时写入覆盖进度。</p>' : '<p class="small-copy">新版页面之间已启用单活动窗口保护。旧版页面不参与交接，请关闭；旧进度只在首次打开新版时复制，之后不自动合并。</p>'}${recoveryRaw ? '<p class="notice">有一份无法读取的旧存档，原始内容已保留。<button class="text-btn" data-action="export-recovery">导出原始备份 ↓</button></p>' : ""}<p class="small-copy">进度只保存在这个浏览器。对战成绩合计保留最近200局，学习记录不受这个局数限制。换设备或长期留存前导出备份。无需账号，没有广告和付费抽卡。英语使用随游戏保存的合成音频；不可用时才尝试系统朗读。</p><div class="button-row"><button class="secondary" data-action="export">导出存档 ↓</button><button class="secondary" data-action="import">恢复存档 ↑</button></div><button class="primary" data-action="save-settings">保存设置</button>`;
  }
  if (modal === "replace-import") {
    title = "恢复这份存档？";
    body = `<p>将用“${esc(importCandidate?.nickname)}”的进度替换这个浏览器的当前进度，包含学习记录、挑战榜与未完成对局。</p><p>建议先导出当前进度。恢复后不能自动撤销。</p><div class="button-row"><button class="secondary" data-action="export">先导出当前进度</button><button class="primary" data-action="confirm-import">确认恢复</button></div>`;
  }
  if (modal === "new-progress") {
    title = "保留原档，建立新进度？";
    body =
      '<p>会建立空的新档案。当前页的学习记录和未完对局不会合并进新档，请先导出本页进度。无法读取的原始内容会先另存为恢复副本，不会删除。</p><div class="recovery-actions"><button class="secondary" data-action="export">先导出本页进度</button><button class="primary" data-action="confirm-new-progress">确认建立新进度</button><button class="text-btn" data-action="close">暂不建立</button></div>';
  }
  if (modal === "new-confirm") {
    title = "开启新的冒险？";
    body =
      '<p>当前未完成的对局会被替换，已经积累的学习记录和完成的挑战仍会保留。</p><div class="button-row"><button class="secondary" data-action="resume">继续原对局</button><button class="primary" data-action="new-confirmed">开启新对局</button></div>';
  }
  if (modal === "curriculum") {
    title = "课程与题目";
    wide = true;
    body = `<p>参照人教版英语（一年级起点，吴欣主编）1–6年级上下册已核对单元的知识范围，自编题目与情境。不是人教社官方题库；不包含原书课文或扫描图。</p><p>每年级72项，12个单元各6项。一年级以词语与生活短句为主；后续逐步加入表达、语法和短文理解。可在营地选择上册、下册或当前单元。</p><p class="notice">题库 ${CONTENT_VERSION} · 题目保留单元与纸质页码来源。这里只覆盖所列练习目标，不宣称覆盖课本全部词语。六年级依据综合语境提高难度，不加入未核对的完成时等考点。</p><div class="curriculum-list">${CURRICULUM.books.map((b) => `<p><strong>${esc(b.title.replace("义务教育教科书·英语（一年级起点）", ""))}</strong> · <a href="${esc(b.source_url)}" target="_blank" rel="noopener noreferrer">查看用户指定教材来源 ↗</a></p>`).join("")}</div><button class="secondary" data-action="return-book">返回词灵手册</button>`;
  }
  if (modal === "ranks") {
    title = "森林挑战榜";
    wide = true;
    const archived = save.records.filter(
      (r) =>
        r.grade === rankGrade &&
        (r.rules !== RULES || r.contentVersion !== CONTENT_VERSION),
    );
    const historyRules = [...new Set(archived.map((r) => r.rules))].sort(
      (a, b) => b.localeCompare(a, undefined, { numeric: true }),
    );
    const historyRule = historyRules.includes(rankHistoryRule)
      ? rankHistoryRule
      : historyRules[0];
    const ranked = save.records
      .filter(
        (r) =>
          r.grade === rankGrade &&
          (rankContent === "current"
            ? r.rules === RULES && r.contentVersion === CONTENT_VERSION
            : (r.rules !== RULES || r.contentVersion !== CONTENT_VERSION) &&
              r.rules === historyRule),
      )
      .sort((a, b) => b.score - a.score || a.turns - b.turns);
    const best = new Map();
    for (const r of ranked) {
      const key = JSON.stringify([
        r.nickname,
        r.grade,
        r.rules,
        r.contentVersion,
        r.course,
        r.seed,
        r.deckId,
        r.opponentId,
      ]);
      if (!best.has(key)) best.set(key, r);
    }
    const rows = [...best.values()];
    body = `${gradeButtons(rankGrade, "rank-grade")}<div class="book-tabs"><button data-action="rank-content" data-value="current" class="${rankContent === "current" ? "chosen" : ""}">当前规则</button><button data-action="rank-content" data-value="archive" class="${rankContent === "archive" ? "chosen" : ""}">历史记录（${archived.length}）</button></div>${rankContent === "archive" && historyRules.length ? `<label class="field-label" for="history-rule-select">查看历史规则</label><select id="history-rule-select" data-change="history-rule">${historyRules.map((rule) => `<option value="${esc(rule)}" ${rule === historyRule ? "selected" : ""}>规则 ${esc(rule)}</option>`).join("")}</select>` : ""}<p class="notice subtle">本机近200局内个人最佳 · 同昵称同场挑战只取最高分 · 规则 ${rankContent === "current" ? RULES : esc(historyRule || "—")} · ${rankContent === "current" ? "课程题库 " + CONTENT_VERSION : "旧规则、旧题库与衔接局存档"} · 不同学习范围、挑战种子、套牌和对手的分数仅供回顾，重赛同场挑战才适合直接比较</p>${
      rows.length
        ? `<div class="rank-list">${rows
            .slice(0, 30)
            .map(
              (r, i) =>
                `<div class="rank-row"><b class="rank-place">${i + 1}</b><div><strong>${esc(r.nickname)} <small>${r.result === "win" ? "胜利" : r.result === "draw" ? "平局" : "完成"}</small></strong><p>${esc(r.seed)} · ${OPPONENTS.find((o) => o.id === r.opponentId).name} · 规则${esc(r.rules)} · ${DECKS.find((d) => d.id === r.deckId).name} · ${esc(courseLabel(r.course, r.grade))}</p></div><div class="rank-score"><strong>${r.score}</strong><small>${r.correct}/${r.attempts} 首答正确 · ${r.turns}回合</small></div><button class="text-btn" data-action="replay-record" data-value="${esc(r.id)}">重赛 ↻</button></div>`,
            )
            .join("")}</div>`
        : '<div class="empty-state"><span>♜</span><h3>第一段传奇，等你写下</h3><p>完成一场对战后，你的真实成绩会出现在这里。榜单从本机最近200局中选取。</p></div>'
    }<p class="small-copy">${rankContent === "current" ? "对战分 = 获胜600（平局300／完成100）+ 剩余生命×5 + 回合奖励。正确率另行记录，不靠拖回合刷题加对战分。" : "旧版成绩保留原计分，不与新规则直接比较。重赛会采用当前规则另记成绩。"}没有答题速度奖励。所有年级合计只保留最近200局；此页最多显示30条，较早的成绩可能移出榜单。想长期留存，请定期导出备份。</p>`;
  }
  if (modal === "book") {
    title = "词灵手册";
    wide = true;
    if (reviewComplete) {
      body = `<div class="empty-state review-complete"><span>❧</span><h3>这一轮结束啦</h3><p>本轮看过${reviewSeen.size}项，答对${reviewRoundCorrect}/${reviewRoundAttempts}项；跳过不计作答。每轮最多6项，不重复出题。</p><p>${reviewRoundAttempts > reviewRoundCorrect ? "错题仍在待复习里，下轮可以再试。" : "可以先休息一下，再来探索下一片知识。"}</p></div><div class="button-row"><button class="secondary" data-action="review-back">返回手册</button><button class="primary" data-action="review-start">再练一轮 →</button></div>`;
    } else if (reviewQ) {
      body = `<div class="review-question"><p class="review-round-label">本轮 ${reviewSeen.size}/6 · 每项只出现一次</p>${questionHTML(reviewQ, reviewAnswer, "review-answer")}<button class="primary" data-action="review-next">${reviewAnswer === null ? "跳过这一项" : "继续复习"} →</button><button class="text-btn" data-action="review-back">返回手册</button></div>`;
    } else {
      const sum = masterySummary(save, QUESTIONS, bookGrade, bookCourse);
      let list = QUESTIONS.filter(
        (q) => q.grade === bookGrade && inCourse(q, bookCourse),
      );
      if (bookFilter === "due")
        list = list.filter(
          (q) => save.mastery[q.id] && save.mastery[q.id].due <= Date.now(),
        );
      if (bookFilter === "seen") list = list.filter((q) => save.mastery[q.id]);
      body = `${gradeButtons(bookGrade, "book-grade")}<div class="book-course">${coursePicker(bookGrade, bookCourse, "book-course")}</div><div class="book-summary"><span><b>${sum.seen}<small>/${sum.total}</small></b> 本范围已探索</span><span><b>${sum.learned}</b> 熟练</span><span><b>${sum.due}</b> 待复习</span><button class="primary" data-action="review-start">练习${bookGrade}年级 →</button></div><div class="book-tabs"><button class="${bookFilter === "due" ? "chosen" : ""}" data-action="book-filter" data-value="due">到期复习</button><button class="${bookFilter === "seen" ? "chosen" : ""}" data-action="book-filter" data-value="seen">已探索</button><button class="${bookFilter === "all" ? "chosen" : ""}" data-action="book-filter" data-value="all">全部${QUESTIONS.filter((q) => q.grade === bookGrade && inCourse(q, bookCourse)).length}项</button><button data-action="curriculum">课程说明 ↗</button><button data-action="cards-gallery">卡牌图鉴 ↗</button></div>${
        list.length
          ? `<div class="word-list">${list
              .map((q) => {
                const m = save.mastery[q.id];
                return `<button class="word-entry" data-action="review-item" data-value="${q.id}"><span>${esc(q.target)}</span><small>${q.topic} · ${m ? (m.streak >= 3 ? "熟练" : `${m.correct}/${m.seen} 正确`) : "未探索"}</small><b>→</b></button>`;
              })
              .join("")}</div>`
          : bookFilter === "due" && sum.seen > 0
            ? '<div class="empty-state"><span>❧</span><h3>到期内容已复习完</h3><p>可以休息一下，也可以去“全部”看看新知识。到期时会再提醒你。</p></div>'
            : '<div class="empty-state"><span>❧</span><h3>这里还是一片新叶</h3><p>开启练习，或在对战中唤醒词灵。错过的知识会在这里等你。</p></div>'
      }${Object.keys(save.archivedMastery).length ? `<p class="notice subtle">已保留${Object.keys(save.archivedMastery).length}项旧题学习足迹，可随存档一起导出。新版题目重新记录熟练度。</p>` : ""}<p class="small-copy">一轮最多6项，优先到期和未学内容，本轮不重复；可以随时返回。熟练表示在3个不同日期连续答对；同一天重练不增加熟练阶段；错后改对，会退出待复习队列，至少1天后再提醒。这是练习记录。建议复习间隔为1、3、7、14天；仍答错的项目会尽快再出现。</p>`;
    }
  }
  if (modal === "cards") {
    title = "森林卡牌图鉴";
    wide = true;
    body = `<p class="notice subtle">12张原创卡牌 · 所有套牌免费开放 · 每套20张</p><div class="gallery">${CARDS.map((c) => `<div>${cardHTML(c, { preview: true })}</div>`).join("")}</div>`;
  }
  if (modal === "result") {
    const s = save.match,
      win = s.winner === 0;
    title = win ? "森林为你欢呼" : "又收获了一段旅程";
    body = `<div class="result-symbol">${win ? "✦" : "❧"}</div><p class="result-sub">${win ? "对战胜利" : s.winner === "draw" ? "势均力敌，平局" : "本次对战完成"} · ${OPPONENTS.find((o) => o.id === s.opponentId).name}</p><div class="result-stats"><div><strong>${scoreMatch(s)}</strong><span>本局分数</span></div><div><strong>${s.correct}<small>/${s.attempts}</small></strong><span>首答正确</span></div><div><strong>${Math.ceil(s.turn / 2)}</strong><span>对战回合</span></div></div>${
      s.review.length
        ? `<div class="result-review"><strong>把这几片知识带回营地</strong>${s.review
            .slice(0, 3)
            .map((id) => {
              const q = QUESTIONS.find((q) => q.id === id);
              return `<p>${esc(q.target)} <span>${esc(q.explanation)}</span></p>`;
            })
            .join("")}</div>`
        : '<p class="notice">每一次思考都让策略更清晰。下次试试不同的出牌顺序。</p>'
    }<div class="button-row"><button class="primary" data-action="replay">${s.rules === RULES && s.contentVersion === CONTENT_VERSION ? "再战同一挑战" : "用新版再玩"} ↻</button><button class="secondary" data-action="result-home">返回营地</button></div>${s.rules !== RULES || s.contentVersion !== CONTENT_VERSION ? '<p class="small-copy">再次游玩会使用当前规则和题库，原成绩保留，新分数另记，不直接比较。</p>' : ""}<button class="text-btn" data-action="book">去词灵手册复习 →</button><p class="small-copy">${storageError || storageBlocked ? "当前浏览器未能保存，请到设置导出备份" : `成绩已保存在本机${s.rules === RULES && s.contentVersion === CONTENT_VERSION ? "新版挑战榜" : "旧版记录"}`}。玩完一局，看看远处，让眼睛休息一下。</p>`;
  }
  return `<div class="modal-backdrop ${hasSaveProblem() && ["new-progress", "replace-import"].includes(modal) ? "recovery-confirm" : ""}" data-action="backdrop"><section class="modal-card ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="close-btn" data-action="close" aria-label="关闭">×</button><div class="eyebrow">SPELLWOOD JOURNAL</div><h2 id="dialog-title">${title}</h2>${body}</section></div>`;
}
function updateAim(pointer = null) {
  if (!document.createElementNS) return;
  document.querySelector("#aim-layer")?.remove();
  if (
    view !== "battle" ||
    locked ||
    prompt ||
    modal ||
    hasSaveProblem() ||
    !selected
  )
    return;
  const targeted =
    selected.type === "unit" ||
    selected.type === "ritual" ||
    (selected.type === "card" &&
      CARD[save.match.players[0].hand[selected.index]]?.keyword === "damage");
  if (!targeted) return;
  const source =
    selected.type === "unit"
      ? document.querySelector(`[data-target="${selected.uid}"]`)
      : selected.type === "card"
        ? document.querySelector(
            `[data-action="card"][data-index="${selected.index}"]`,
          )
        : document.querySelector(".self .hero");
  const target = document.querySelector(".targetable");
  if (!source || (!target && !pointer)) return;
  const a = (
      source.querySelector(".hero-frame") || source
    ).getBoundingClientRect(),
    b = (
      target?.querySelector(".hero-frame") || target
    )?.getBoundingClientRect(),
    x1 = a.x + a.width / 2,
    y1 = a.y + a.height / 2,
    x2 = pointer?.x ?? b.x + b.width / 2,
    y2 = pointer?.y ?? b.y + b.height / 2;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "aim-layer";
  svg.setAttribute("viewBox", `0 0 ${innerWidth} ${innerHeight}`);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<defs><filter id="aim-glow"><feGaussianBlur stdDeviation="3"/></filter><marker id="aim-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#ffe19d"/></marker></defs><path d="M${x1},${y1} Q${(x1 + x2) / 2 + 35},${(y1 + y2) / 2 - 35} ${x2},${y2}" fill="none" stroke="#ffc567" stroke-width="12" opacity=".45" filter="url(#aim-glow)"/><path class="aim-stroke" d="M${x1},${y1} Q${(x1 + x2) / 2 + 35},${(y1 + y2) / 2 - 35} ${x2},${y2}" fill="none" stroke="#ffe4a6" stroke-width="4" stroke-linecap="round" stroke-dasharray="10 8" marker-end="url(#aim-arrow)"/>`;
  document.body.appendChild(svg);
}
function sessionChanged() {
  SOUND.visibility(document.hidden || !SESSION.canWrite || hasSaveProblem());
  SPEECH.visibility(document.hidden || !SESSION.canWrite || hasSaveProblem());
  if (!SESSION.canWrite) {
    actionEpoch++;
    importEpoch++;
    clearTimeout(aiTimer);
    stopSpeech();
    FX.cancel();
    visualMatch = null;
    locked = false;
    selected = null;
    prompt = null;
    openingSelection = [];
    openingAnimation = false;
    render();
    $(".session-shield button")?.focus();
    return;
  }
  try {
    const disk = localStorage.getItem(STORAGE_KEY) || "";
    if (disk !== lastStoredRaw) {
      acceptExternal(disk);
      legacyMigrationNeeded = false;
    }
    if (legacyMigrationNeeded) {
      legacyMigrationNeeded = false;
      if (!disk) {
        const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY) || "";
        storageReadPending = false;
        if (legacyRaw) {
          try {
            save = validateSave(JSON.parse(legacyRaw), QUESTIONS);
            if (persist())
              toast("旧进度已复制到新版。请关闭旧版页面，后续只在新版继续");
          } catch {
            recoveryRaw = legacyRaw;
            storageBlocked = true;
            toast("旧进度暂时无法读取，请在设置导出原始备份或恢复有效存档");
          }
        }
      }
    }
  } catch {
    storageError = true;
    storageBlocked = true;
    storageReadPending = true;
  }
  if (SESSION.reason === "takeover" && save.match?.phase === "playing") {
    view = "battle";
    modal = null;
    resetReviewRound();
  }
  if (save.match?.phase === "finished" && !save.match.recorded) {
    addRecord(save, save.match);
    persist();
  }
  render();
  scheduleAI();
}
function sessionHTML() {
  if (SESSION.canWrite) return "";
  const pending = SESSION.status === "pending",
    blocked = SESSION.status === "blocked";
  return `<div class="modal-backdrop session-shield"><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="session-title"><div class="eyebrow">ONE ACTIVE WINDOW</div><h2 id="session-title">${pending ? "正在连接本机进度" : blocked ? "多窗口保护暂不可用" : "这段冒险在另一个窗口"}</h2><p>${pending ? (SESSION.reason === "takeover" ? "正在等待另一页交接，请稍等。" : "正在检查本机进度，请稍等。") : blocked ? "请先关闭其他词灵对决页面，再重试。" : SESSION.reason === "unsaved" ? "另一页还有未保存的进度。请先在那里导出备份并关闭那一页，再到此页恢复备份。" : SESSION.reason === "no-response" ? "另一页暂未回应。请关闭它后再试，避免两页同时改写进度。" : "为了保护进度，同一浏览器的新版页面同时只由一个窗口操作。你可以把冒险切换到这里。"}</p>${pending ? "" : `<button class="primary" data-action="session-continue">${blocked ? "重试多窗口保护" : "在这里继续"}</button>${blocked ? '<button class="secondary" data-action="session-fallback">我已关闭其他页面，仅在此页继续</button>' : ""}<button class="text-btn" data-action="session-export">导出当前进度备份 ↓</button>`}<p class="small-copy">交接只发生在这个浏览器内，不上传昵称或学习记录。旧版存档已原样保留。请关闭旧版页面，迁移后的新旧记录不会自动合并。</p></section></div>`;
}
function render() {
  const suspended = document.hidden || !SESSION.canWrite || hasSaveProblem();
  if (SOUND.hidden !== suspended) SOUND.visibility(suspended);
  if (SPEECH.hidden !== suspended) SPEECH.visibility(suspended);
  const focus = focusIdentity(document.activeElement);
  const previousList = $(".word-list");
  if (previousList && renderedBookListKey)
    bookListScroll.set(renderedBookListKey, previousList.scrollTop);
  const sameReview = modal === "book" && reviewQ?.id === renderedReviewId;
  const reviewScrollTop = sameReview ? $(".modal-card")?.scrollTop || 0 : 0;
  const revealReviewFeedback =
    sameReview &&
    !renderedReviewAnswered &&
    reviewAnswer !== null &&
    !hasSaveProblem() &&
    SESSION.canWrite;
  const openingScroll =
    openingScrollMatch === save.match?.id
      ? $(".opening-sheet")?.scrollTop || 0
      : 0;
  const hadRecovery = !!document.querySelector(".storage-shield");
  const handScroll =
    handScrollMatch === save.match?.id ? $(".hand-row")?.scrollLeft || 0 : 0;
  SOUND.sync(save);
  FX.reduced =
    save.reduced ||
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  document.body.classList.toggle("reduce-motion", FX.reduced);
  document.body.classList.toggle("in-battle", view === "battle");
  document.body.classList.toggle("opening-arrival", openingAnimation);
  app.innerHTML =
    header() +
    (view === "battle" && save.match ? battle() : lobby()) +
    modalHTML() +
    storageRecoveryHTML() +
    sessionHTML();
  if (
    prompt?.answer === null ||
    (view === "battle" && openingPending(save.match))
  ) {
    document.querySelector(".topbar")?.setAttribute("inert", "");
    document.querySelector(".battle-field")?.setAttribute("inert", "");
  }
  if (modal || !SESSION.canWrite || recoveryVisible()) {
    document.querySelector(".topbar")?.setAttribute("inert", "");
    document.querySelector("main")?.setAttribute("inert", "");
  }
  if (recoveryVisible()) {
    document
      .querySelectorAll(".modal-backdrop:not(.storage-shield)")
      .forEach((el) => el.setAttribute("inert", ""));
  }
  const hand = $(".hand-row");
  if (hand && view === "battle") hand.scrollLeft = handScroll;
  handScrollMatch = view === "battle" ? save.match?.id : null;
  const opening = $(".opening-sheet");
  if (opening && view === "battle" && openingPending(save.match))
    opening.scrollTop = openingScroll;
  openingScrollMatch =
    view === "battle" && openingPending(save.match) ? save.match.id : null;
  const currentList = $(".word-list");
  renderedBookListKey =
    modal === "book" && !reviewQ && !reviewComplete
      ? `${bookGrade}:${bookCourse}:${bookFilter}`
      : null;
  if (currentList && renderedBookListKey)
    currentList.scrollTop = bookListScroll.get(renderedBookListKey) || 0;
  if (modal === "book" && reviewQ) {
    const panel = $(".modal-card");
    if (panel) panel.scrollTop = reviewScrollTop;
    if (revealReviewFeedback)
      $(".review-question .explanation")?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "auto",
      });
  }
  renderedReviewId = modal === "book" ? reviewQ?.id || null : null;
  renderedReviewAnswered = modal === "book" && reviewQ && reviewAnswer !== null;
  updateAim();
  SOUND.reflect();
  SPEECH.reflect();
  PICTURES.connect();
  if (recoveryVisible() && !hadRecovery) $(".storage-shield button")?.focus();
  else restoreFocus(focus);
}
function start(seed, config) {
  if (!SESSION.canWrite || hasSaveProblem()) return;
  actionEpoch++;
  FX.cancel();
  visualMatch = null;
  clearTimeout(aiTimer);
  locked = false;
  modal = null;
  selected = null;
  prompt = null;
  feedback = null;
  openingSelection = [];
  openingAnimation = false;
  save.match = createMatch({
    offerOpening: true,
    grade: config?.grade || save.grade,
    course: config?.course || save.course,
    deckId: config?.deckId || save.deckId,
    opponentId: config?.opponentId || save.opponentId,
    seed:
      seed || `GROVE-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
  });
  view = "battle";
  persist();
  render();
  sound("correct");
  window.scrollTo({ top: 0 });
  setTimeout(() => {
    if (openingPending(save.match)) $(".opening-sheet .game-card")?.focus();
  }, 0);
}
function replayChallenge(config) {
  if (!config) return;
  const upgrading =
    config.contentVersion !== CONTENT_VERSION || config.rules !== RULES;
  start(config.seed, config);
  if (upgrading) toast("旧挑战已用新版规则和题库重开，分数会另记");
}
function showResult() {
  if (save.match?.phase !== "finished") return;
  const result = save.match;
  addRecord(save, result);
  persist();
  if (save.match !== result) return;
  if (!prompt) {
    modal = "result";
    sound(save.match.winner === 0 ? "win" : "correct");
    if (save.match.winner === 0 && !save.reduced) FX.victory();
  }
}

async function step(a, keyboard = false) {
  const s = save.match;
  if (
    !SESSION.canWrite ||
    hasSaveProblem() ||
    !s ||
    locked ||
    s.phase !== "playing" ||
    (s.active === 0 && prompt)
  )
    return;
  const next = act(s, a);
  if (next === s) {
    toast("现在还不能这样行动");
    return;
  }
  const epoch = ++actionEpoch,
    card = a.type === "play" ? CARD[s.players[s.active].hand[a.index]] : null;
  locked = true;
  selected = null;
  visualMatch = s;
  save.match = next;
  if (next.phase === "finished") addRecord(save, next);
  persist();
  if (
    epoch !== actionEpoch ||
    save.match?.id !== next.id ||
    save.match?.seq !== next.seq
  ) {
    visualMatch = null;
    locked = false;
    render();
    return;
  }
  render();
  try {
    if (a.type === "end") {
      sound("turn");
      await pause(save.reduced ? 30 : 230);
    } else await FX.before(s, a, card, sound);
  } catch (e) {}
  if (epoch !== actionEpoch || save.match?.id !== next.id) return;
  visualMatch = null;
  render();
  try {
    FX.after(s, next, a, sound);
  } catch (e) {}
  const deaths = s.players.some((p, i) =>
    p.board.some((u) => !next.players[i].board.some((v) => v.uid === u.uid)),
  );
  await pause(
    save.reduced
      ? 60
      : a.type === "end"
        ? 140
        : deaths
          ? 720
          : a.type === "play"
            ? 650
            : 450,
  );
  if (epoch !== actionEpoch) return;
  locked = false;
  showResult();
  render();
  if (keyboard) {
    const nextFocus = modal
      ? $(".modal-card button")
      : save.match.active === 0
        ? $(".hand-row [data-action=card]") || $(".end-turn")
        : $(".battle-meta [data-action=match-info]");
    nextFocus?.focus?.({ preventScroll: true });
  }
  scheduleAI();
}

function canRunAI() {
  return (
    SESSION.canWrite &&
    view === "battle" &&
    !document.hidden &&
    !modal &&
    !locked &&
    !prompt &&
    !openingPending(save.match) &&
    !hasSaveProblem() &&
    save.match?.phase === "playing" &&
    save.match.active === 1
  );
}
function scheduleAI() {
  clearTimeout(aiTimer);
  if (!canRunAI()) return;
  const epoch = actionEpoch,
    matchId = save.match.id,
    seq = save.match.seq;
  aiTimer = setTimeout(
    () => {
      if (
        !canRunAI() ||
        epoch !== actionEpoch ||
        save.match.id !== matchId ||
        save.match.seq !== seq
      )
        return;
      const op = OPPONENTS.find((o) => o.id === save.match.opponentId);
      const action = chooseAI(save.match, op.style);
      step(action);
    },
    save.reduced ? 120 : 650,
  );
}
function openQuestion(kind, target = "hero") {
  if (!SESSION.canWrite || hasSaveProblem() || openingPending(save.match))
    return;
  if (save.match.phase !== "playing") return;
  if (
    save.match.players[0].ritualUsed ||
    (hasFiniteRituals(save.match.rules) &&
      save.match.players[0].ritualsLeft <= 0) ||
    prompt ||
    locked
  )
    return;
  const player = save.match.players[0];
  if (
    hasFiniteRituals(save.match.rules) &&
    ((kind === "bloom" && player.hp >= 18) ||
      (kind === "insight" && (player.hand.length >= 7 || !player.deck.length)))
  )
    return;
  const q = questionFor(save.match, QUESTIONS);
  prompt = { kind, target, qid: q.id, answer: null };
  selected = null;
  render();
  setTimeout(() => $(".spell-sheet .answers button")?.focus(), 0);
}
async function handleAnswer(index, keyboard = false) {
  if (!SESSION.canWrite || hasSaveProblem()) return;
  if (
    !prompt ||
    prompt.answer !== null ||
    locked ||
    save.match?.phase !== "playing"
  )
    return;
  const q = QUESTIONS.find((x) => x.id === prompt.qid);
  if (!Number.isInteger(index) || !q.options[index]) return;
  stopSpeech();
  const s = save.match,
    kind = prompt.kind,
    target = prompt.target,
    correct = index === q.answer,
    epoch = ++actionEpoch;
  prompt.answer = index;
  locked = true;
  visualMatch = s;
  save.match = ritual(s, kind, correct, target);
  if (save.match === s) {
    locked = false;
    prompt = null;
    visualMatch = null;
    render();
    toast("场面已变化，请重新选择仪式");
    return;
  }
  save.match.attempts++;
  save.match.correct += correct ? 1 : 0;
  save.match.questionIndex++;
  if (!correct && !save.match.review.includes(q.id))
    save.match.review.push(q.id);
  recordLearning(save, q, correct);
  const next = save.match;
  if (next.phase === "finished") addRecord(save, next);
  persist();
  if (
    epoch !== actionEpoch ||
    save.match?.id !== next.id ||
    save.match?.seq !== next.seq
  )
    return;
  render();
  sound(correct ? "correct" : "wrong");
  try {
    FX.capture(s, { type: "ritual" });
    if (correct && kind === "spark") {
      const from = document.querySelector(".self .hero-frame"),
        to =
          target === "hero"
            ? document.querySelector(".opponent .hero-frame")
            : document.querySelector(`[data-target="${target}"]`),
        a = from?.getBoundingClientRect(),
        b = to?.getBoundingClientRect();
      if (a && b) {
        sound("spark");
        await FX.projectile(
          { x: a.x + a.width / 2, y: a.y + a.height / 2 },
          { x: b.x + b.width / 2, y: b.y + b.height / 2 },
          0xffb347,
          450,
        );
        if (epoch !== actionEpoch || save.match?.id !== next.id) return;
        sound("hit");
      }
    } else await pause(save.reduced ? 40 : 240);
  } catch (e) {}
  if (epoch !== actionEpoch || save.match?.id !== next.id) return;
  visualMatch = null;
  render();
  try {
    FX.after(s, next, { type: "ritual", kind, target, correct }, sound);
  } catch (e) {}
  await pause(save.reduced ? 40 : 650);
  if (epoch !== actionEpoch) return;
  locked = false;
  showResult();
  render();
  if (keyboard) $(".spell-feedback [data-action=continue]")?.focus();
}

function resetReviewRound() {
  reviewQ = null;
  reviewAnswer = null;
  reviewSeen = new Set();
  reviewRoundAttempts = 0;
  reviewRoundCorrect = 0;
  reviewComplete = false;
}
function nextReview() {
  if (hasSaveProblem()) return;
  stopSpeech();
  const list = QUESTIONS.filter(
    (q) =>
      q.grade === bookGrade && inCourse(q, bookCourse) && !reviewSeen.has(q.id),
  );
  const now = Date.now();
  const sorted = list.sort((a, b) => {
    const ma = save.mastery[a.id],
      mb = save.mastery[b.id];
    const ca = ma ? (ma.due <= now ? 0 : 2) : 1;
    const cb = mb ? (mb.due <= now ? 0 : 2) : 1;
    return ca - cb || (ma?.due || 0) - (mb?.due || 0);
  });
  reviewQ = reviewSeen.size < 6 ? sorted[0] || null : null;
  reviewAnswer = null;
  reviewComplete = !reviewQ;
  if (reviewQ) reviewSeen.add(reviewQ.id);
  render();
}
function downloadSave() {
  const blob = new Blob([JSON.stringify(save, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `Spellwood-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("存档已导出，请妥善保管");
}
app.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (!b || b.disabled) return;
  const a = b.dataset.action,
    v = b.dataset.value,
    index = Number(b.dataset.index);
  if (a === "session-continue") {
    SESSION.start(SESSION.status !== "blocked");
    return;
  }
  if (a === "session-fallback") {
    SESSION.singleWindowFallback();
    return;
  }
  if (a === "session-export") {
    downloadSave();
    return;
  }
  if (!SESSION.canWrite) return;
  if (
    hasSaveProblem() &&
    ![
      "export",
      "export-recovery",
      "import",
      "confirm-import",
      "storage-retry",
      "storage-new",
      "confirm-new-progress",
      "close",
      "backdrop",
    ].includes(a)
  )
    return;
  if (
    view === "battle" &&
    openingPending(save.match) &&
    !hasSaveProblem() &&
    !["opening-card", "opening-confirm", "home"].includes(a)
  )
    return;
  SOUND.unlock();
  if (a === "backdrop" && e.target !== b) return;
  switch (a) {
    case "storage-retry":
      retryStorage();
      break;
    case "storage-new":
      if (storageReadPending) return;
      openModal("new-progress");
      break;
    case "confirm-new-progress":
      if (modal === "new-progress" && storageBlocked && !storageReadPending)
        commitRestoredSave(freshSave(), true);
      break;
    case "opening-card":
      if (
        !openingPending(save.match) ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= 4
      )
        return;
      if (openingSelection.includes(index))
        openingSelection = openingSelection.filter((i) => i !== index);
      else if (openingSelection.length < 2)
        openingSelection = [...openingSelection, index];
      else {
        toast("最多换2张，先取消一张再选");
        return;
      }
      render();
      break;
    case "opening-confirm":
      confirmOpening();
      break;
    case "home":
      stopSpeech();
      actionEpoch++;
      visualMatch = null;
      locked = false;
      openingAnimation = false;
      FX.cancel();
      modal = null;
      prompt = null;
      selected = null;
      view = "lobby";
      clearTimeout(aiTimer);
      render();
      break;
    case "grade":
      save.grade = Number(v);
      persist();
      render();
      break;
    case "opponent":
      save.opponentId = v;
      persist();
      render();
      break;
    case "opponent-info":
      openModal("opponent-info");
      break;
    case "help":
      openModal("help");
      break;
    case "music-toggle":
      save.music = !save.music;
      persist();
      render();
      break;
    case "settings":
      openModal("settings");
      break;
    case "match-info":
      openModal("match-info");
      break;
    case "start":
      if (save.match?.phase === "playing") openModal("new-confirm");
      else start();
      break;
    case "new-confirmed":
      start();
      break;
    case "resume":
      modal = null;
      view = "battle";
      render();
      scheduleAI();
      break;
    case "close":
    case "backdrop":
      closeModal();
      break;
    case "hand-prev":
    case "hand-next":
      $(".hand-row")?.scrollBy?.({
        left: a === "hand-next" ? 166 : -166,
        behavior: FX.reduced ? "instant" : "smooth",
      });
      break;
    case "card":
      if (
        save.match.phase !== "playing" ||
        save.match.active ||
        locked ||
        prompt
      )
        return;
      const c = CARD[save.match.players[0].hand[index]];
      selected =
        selected?.type === "card" && selected.index === index
          ? null
          : { type: "card", index };
      render();
      if (selected && e.detail === 0)
        $(
          ".card-command [data-action=play]:not([disabled]), .targetable, .cancel-command",
        )?.focus();
      if (selected && innerWidth <= 760)
        $(".command-strip")?.scrollIntoView({
          behavior: FX.reduced ? "instant" : "smooth",
          block: "center",
        });
      break;
    case "play":
      if (selected?.type === "card")
        step({ type: "play", index: selected.index }, e.detail === 0);
      break;
    case "unit":
      if (
        save.match.phase !== "playing" ||
        save.match.active ||
        locked ||
        prompt
      )
        return;
      const u = save.match.players[0].board.find(
        (u) => u.uid === b.dataset.target,
      );
      if (!u.ready) return toast("这位伙伴正在休息，下回合就能攻击");
      selected = selected?.uid === u.uid ? null : { type: "unit", uid: u.uid };
      render();
      if (selected && e.detail === 0) $(".targetable")?.focus();
      break;
    case "target":
      if (locked) return;
      if (!selected) {
        openModal("opponent-info");
        break;
      }
      if (!canTarget(b.dataset.target))
        return toast("需要先突破守卫，或选择一个发光的目标");
      if (selected.type === "ritual") openQuestion("spark", b.dataset.target);
      else if (selected.type === "card")
        step(
          { type: "play", index: selected.index, target: b.dataset.target },
          e.detail === 0,
        );
      else
        step(
          { type: "attack", uid: selected.uid, target: b.dataset.target },
          e.detail === 0,
        );
      break;
    case "cancel": {
      const previous = selected;
      selected = null;
      render();
      focusSelection(previous);
      break;
    }
    case "ritual":
      if (
        save.match.phase !== "playing" ||
        save.match.active ||
        save.match.players[0].ritualUsed ||
        locked ||
        prompt
      )
        return;
      if (v === "spark") {
        selected = { type: "ritual" };
        render();
        if (e.detail === 0) $(".targetable")?.focus();
      } else if (v === "insight" && save.match.players[0].hand.length >= 7)
        toast("手牌已满，先打出一张牌再唤醒灵光");
      else if (v === "bloom" && save.match.players[0].hp >= 18)
        toast("生命已经充满，可以选择其他仪式");
      else openQuestion(v);
      break;
    case "answer":
      handleAnswer(index, e.detail === 0);
      break;
    case "cancel-prompt":
      cancelQuestion();
      break;
    case "continue":
      stopSpeech();
      if (locked) return;
      prompt = null;
      showResult();
      render();
      if (e.detail === 0)
        (modal ? $(".modal-card button") : $(".end-turn"))?.focus();
      break;
    case "end":
      selected = null;
      step({ type: "end" }, e.detail === 0);
      break;
    case "speak":
      const q = QUESTIONS.find((q) => q.id === v);
      if (q) {
        const answered =
          (prompt?.qid === q.id && prompt.answer !== null) ||
          (reviewQ?.id === q.id && reviewAnswer !== null);
        speak(
          answered
            ? q.speak
            : q.listen ||
                (q.text
                  ? q.text.replace(/___+/g, " … ")
                  : q.options.join(". ")),
        );
      }
      break;
    case "toggle":
      if ($("#nickname"))
        save.nickname = $("#nickname").value.trim().slice(0, 16) || "Leaf";
      save[v] = !save[v];
      if (v === "speech" && !save.speech) stopSpeech();
      persist();
      render();
      if (v === "sound") sound("correct");
      break;
    case "save-settings":
      save.nickname = $("#nickname").value.trim().slice(0, 16) || "Leaf";
      if (!persist()) {
        render();
        break;
      }
      closeModal();
      toast("营地设置已保存");
      break;
    case "export-recovery": {
      const blob = new Blob([recoveryRaw], { type: "application/json" }),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "Spellwood-recovery.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      break;
    }
    case "export":
      downloadSave();
      break;
    case "import":
      $("#import-file").click();
      break;
    case "confirm-import":
      if (importCandidate) commitRestoredSave(importCandidate);
      break;
    case "ranks": {
      const context = navigationContext();
      rankGrade = context.grade;
      rankContent =
        view === "battle" &&
        (context.rules !== RULES || context.contentVersion !== CONTENT_VERSION)
          ? "archive"
          : "current";
      if (rankContent === "archive") rankHistoryRule = context.rules;
      openModal("ranks");
      break;
    }
    case "return-book":
      resetReviewRound();
      openModal("book");
      break;
    case "rank-content":
      rankContent = v;
      render();
      break;
    case "curriculum":
      modal = "curriculum";
      render();
      break;
    case "rank-grade":
      rankGrade = Number(v);
      render();
      break;
    case "book": {
      const context = navigationContext();
      bookGrade = context.grade;
      bookCourse = context.course || "all";
      resetReviewRound();
      openModal("book");
      break;
    }
    case "book-grade":
      stopSpeech();
      bookGrade = Number(v);
      render();
      break;
    case "book-filter":
      bookFilter = v;
      render();
      break;
    case "review-start":
      resetReviewRound();
      nextReview();
      if (e.detail === 0) $(".review-question .answers button")?.focus();
      break;
    case "review-next":
      nextReview();
      if (e.detail === 0)
        $(
          reviewComplete
            ? '[data-action="review-back"]'
            : ".review-question .answers button",
        )?.focus();
      break;
    case "review-item":
      stopSpeech();
      resetReviewRound();
      reviewQ = QUESTIONS.find((q) => q.id === v);
      if (reviewQ) reviewSeen.add(reviewQ.id);
      render();
      if (e.detail === 0) $(".review-question .answers button")?.focus();
      break;
    case "review-back": {
      const previousId = reviewQ?.id || [...reviewSeen].at(-1);
      stopSpeech();
      resetReviewRound();
      render();
      if (previousId)
        restoreFocus({ data: { action: "review-item", value: previousId } });
      break;
    }
    case "review-answer": {
      if (reviewAnswer !== null || !reviewQ) return;
      const question = reviewQ;
      if (!Number.isInteger(index) || !question.options[index]) return;
      // Apply this real attempt to the latest aggregate rather than a stale copy.
      try {
        const disk = localStorage.getItem(STORAGE_KEY) || "";
        if (disk !== lastStoredRaw && !acceptExternal(disk)) return;
      } catch {
        toast("暂时无法读取进度，请稍后重试或导出备份");
        return;
      }
      if (hasSaveProblem()) return;
      reviewQ = question;
      reviewAnswer = index;
      reviewSeen.add(question.id);
      reviewRoundAttempts++;
      reviewRoundCorrect += index === question.answer ? 1 : 0;
      recordLearning(save, question, index === question.answer);
      if (!persist()) {
        render();
        return;
      }
      sound(index === question.answer ? "correct" : "wrong");
      stopSpeech();
      render();
      if (e.detail === 0) $('[data-action="review-next"]')?.focus();
      break;
    }
    case "cards-gallery":
      openModal("cards");
      break;
    case "replay":
      replayChallenge(save.match);
      break;
    case "replay-record":
      const r = save.records.find((r) => r.id === v);
      if (save.match?.phase === "playing") {
        toast("当前还有未完成对局，请先完成后再从记录重赛");
        return;
      }
      replayChallenge(r);
      break;
    case "result-home":
      modal = null;
      view = "lobby";
      prompt = null;
      render();
      break;
  }
});
app.addEventListener("change", (e) => {
  if (!SESSION.canWrite || hasSaveProblem()) return;
  if (e.target.dataset.change === "history-rule") {
    rankHistoryRule = e.target.value;
    render();
    return;
  }
  if (["course", "book-course"].includes(e.target.dataset.change)) {
    if (e.target.dataset.change === "course") save.course = e.target.value;
    else bookCourse = e.target.value;
    persist();
    render();
    return;
  }
  if (e.target.dataset.change === "volume") {
    save[e.target.dataset.field] = Number(e.target.value);
    persist();
    render();
    return;
  }
  if (e.target.dataset.change === "deck") {
    save.deckId = e.target.value;
    persist();
    render();
  }
});
$("#import-file").addEventListener("change", async (e) => {
  if (!SESSION.canWrite) return;
  const epoch = ++importEpoch,
    action = actionEpoch;
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 2 * 1024 * 1024)
    return toast("文件超过2MB，请选择词灵对决导出的JSON存档");
  try {
    const raw = await file.text();
    if (epoch !== importEpoch || action !== actionEpoch) return;
    importCandidate = validateSave(JSON.parse(raw), QUESTIONS);
    openModal("replace-import");
  } catch (err) {
    if (epoch !== importEpoch || action !== actionEpoch) return;
    toast(`无法恢复：${err.message}。现有进度未改变`);
  }
});
document.addEventListener("keydown", (e) => {
  if (!SESSION.canWrite && e.key !== "Tab") return;
  if (e.key === "Escape") {
    if (recoveryVisible()) {
      e.preventDefault();
      return;
    }
    if (modal) closeModal();
    else if (prompt && prompt.answer === null) {
      cancelQuestion();
    } else if (selected) {
      const previous = selected;
      selected = null;
      render();
      focusSelection(previous);
    }
  }
  if (
    e.key === "Tab" &&
    (!SESSION.canWrite ||
      recoveryVisible() ||
      modal ||
      openingPending(save.match) ||
      prompt?.answer === null)
  ) {
    const els = [
      ...document.querySelectorAll(
        !SESSION.canWrite
          ? ".session-shield button:not([disabled])"
          : recoveryVisible()
            ? ".storage-shield button:not([disabled])"
            : modal
              ? ".modal-card button:not([disabled]),.modal-card input,.modal-card select"
              : openingPending(save.match)
                ? ".opening-sheet button:not([disabled])"
                : ".spell-sheet button:not([disabled])",
      ),
    ];
    const first = els[0],
      last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last?.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first?.focus();
      e.preventDefault();
    }
  }
});
document.addEventListener("pointermove", (e) => {
  if (selected && !locked && !prompt && !modal)
    updateAim({ x: e.clientX, y: e.clientY });
});
document.addEventListener("visibilitychange", () => {
  SOUND.visibility(document.hidden || !SESSION.canWrite || hasSaveProblem());
  SPEECH.visibility(document.hidden || !SESSION.canWrite || hasSaveProblem());
  if (document.hidden) clearTimeout(aiTimer);
  else scheduleAI();
});
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY) acceptExternal(e.newValue || "");
});
window.addEventListener("pagehide", () => SESSION.suspend());
window.addEventListener("pageshow", () => SESSION.start());
render();
if (
  SESSION.canWrite &&
  save.match?.phase === "finished" &&
  !save.match.recorded
) {
  addRecord(save, save.match);
  persist();
  render();
}
SESSION.start();
if (storageError) toast("上次进度无法读取，原始备份已保留，可在设置中导出");
if (document.modelContext?.registerTool) {
  for (const tool of [
    {
      name: "get_spellwood_state",
      title: "查看词灵对决状态",
      description:
        "读取当前可见年级、对局回合、生命与本机学习摘要，不读取隐藏手牌。",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        if (input && Object.keys(input).length)
          throw Error("No arguments expected");
        const s = save.match;
        return {
          view,
          grade: save.grade,
          summary: masterySummary(save, QUESTIONS, save.grade),
          match: s
            ? {
                seed: s.seed,
                turn: s.turn,
                active: s.active,
                phase: s.phase,
                health: s.players.map((p) => p.hp),
              }
            : null,
        };
      },
    },
    {
      name: "open_spellwood_review",
      title: "打开词灵复习手册",
      description: "打开所选年级的复习手册，不开始对局，也不提交答案。",
      inputSchema: {
        type: "object",
        properties: { grade: { type: "integer", minimum: 1, maximum: 6 } },
        required: ["grade"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input) => {
        if (
          !input ||
          Object.keys(input).some((k) => k !== "grade") ||
          !Number.isInteger(input.grade) ||
          input.grade < 1 ||
          input.grade > 6
        )
          throw Error("grade must be 1–6");
        bookGrade = input.grade;
        resetReviewRound();
        openModal("book");
        return { opened: true, grade: bookGrade };
      },
    },
  ]) {
    try {
      Promise.resolve(document.modelContext.registerTool(tool)).catch(() => {});
    } catch (e) {}
  }
}

// Warm original card art after the first render; these are same-origin assets only.
if (typeof Image === "function")
  setTimeout(() => {
    for (const url of [
      "assets/cards/sprout.webp",
      "assets/cards/sprite.webp",
      "assets/cards/golem.webp",
      "assets/cards/spark.webp",
      "assets/cards/bloom.webp",
      "assets/cards/moon.webp",
    ]) {
      const picture = new Image();
      picture.decoding = "async";
      picture.fetchPriority = "low";
      picture.src = url;
    }
  }, 250);
