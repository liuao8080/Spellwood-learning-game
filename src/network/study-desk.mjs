import { ProgressStore } from "./progress.mjs";
import { inCourse } from "../learning.mjs";
import { LearningAttention } from "./learning-attention.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const preferenceKeys = ["grade", "course", "deckId", "sound", "music", "musicVolume", "soundVolume", "speech", "reduced"];
const storedPreferences = (data) => ({...Object.fromEntries(preferenceKeys.map(k => [k,data.legacy[k]])), deckId: data.chosenDeckId ?? data.legacy.deckId, customDeck: data.customDeck || null, combatMode: data.combatMode || "adaptive"});
const issueText = {
  READ_FAILED: "暂时读不到本机记录。恢复读取前不会创建空档。",
  CORRUPT_SAVE: "本机记录未能校验。请先下载原始副本，再选择备份恢复。",
  WRITE_FAILED: "本次进度还在内存里，尚未写入浏览器。请重试或下载抢救副本。",
  SAVE_REMOVED: "本机存档已在另一处移除。本页进度仍可下载。",
  PROFILE_CHANGED: "另一页恢复了不同的档案。本页未保存内容不会自动混入新档。",
  LOCK_FAILED: "未能取得本机存档的写入锁，请稍后重试。",
  PROGRESS_FULL: "待同步回执已满，本页内容仍可导出。请稍后重试保存。",
  STALE_REVISION: "确认期间记录已变化，请重新选择备份并检查摘要。",
};
const remoteIssueText = {
  READ_FAILED: "暂时读不到当前账号记录，请保留本页并重试。",
  PROGRESS_UNSYNCED: "上次账号操作尚未确认，请先重试同步；本页记录仍可导出。",
  PROGRESS_UNAVAILABLE: "当前账号记录暂时无法同步，请保留本页并重试。",
  STALE_REVISION: "确认期间账号记录已变化，请重新选择备份并核对摘要。",
  LEGACY_IMPORT_CONFLICT: "账号已有记录，无法导入覆盖。现有账号记录和原备份均未改变。",
  SESSION_REQUIRED: "登录身份已过期，请重新确认身份后读取账号记录。",
  IDENTITY_REQUIRED: "请先确认当前身份，再继续账号学习。",
  PROGRESS_PENDING: "服务器正在保存当前账号进度，请稍后重试。",
};

/** Learning records and private server-issued study challenges. The injected
 * store owns persistence; the default store keeps the original local archive. */
export class StudyDesk {
  constructor({ onChange = () => {}, onPreferences = () => {}, onNotice = () => {}, onRestore = () => {}, getPreferences = () => ({}), fetcher = (...args) => fetch(...args), storeFactory = (options) => new ProgressStore(options), storage, locks, visualCue = () => "", listen = () => {}, cancelVoice = () => {} } = {}) {
    Object.assign(this, { onChange, onPreferences, onNotice, onRestore, getPreferences, fetcher, storeFactory, storage, locks, visualCue, listen, cancelVoice });
    this.status = "loading"; this.catalogue = null; this.store = null; this.data = null; this.issue = null;
    this.view = null; this.filter = "due"; this.page = 0; this.question = null; this.answer = null; this.studyId = null;
    this.round = null; this.initializeEpoch = 0;
    this.busy = false; this.requestEpoch = 0; this.profileEpoch = 0; this.networkEpoch = 0; this.pending = new Map(); this.results = new Map(); this.flushing = false;
    this.prepared = null; this.importName = ""; this.message = "";
    this.ruleset = "net-1.1"; this.recordRules = null;
    this.disposed = false; this.controllers = new Set(); this.flushRun = null;
    this.attention = new LearningAttention({visible:!globalThis.document?.hidden});
  }
  get remote() { return !!this.store?.remote; }
  get canStart() { return !this.disposed && this.status === "ready" && !!this.data && !this.issue && !this.store?.dirty && !this.pendingCount && !this.flushing && !this.restoring && !this.busy; }
  get pendingCount() { return this.pending.size + this.results.size; }
  notify() { if (!this.disposed) this.onChange(); }
  currentGuard({ session = true, request = false } = {}) {
    const initializeEpoch = this.initializeEpoch, profileEpoch = this.profileEpoch, requestEpoch = this.requestEpoch, store = this.store;
    return () => !this.disposed && initializeEpoch === this.initializeEpoch && store === this.store && (!session || profileEpoch === this.profileEpoch) && (!request || requestEpoch === this.requestEpoch);
  }
  issueMessage(result, fallback) {
    const message = result?.message;
    return result?.issue?.message || (message && message !== result?.code && !["empty", "request", "expired"].includes(message) ? message : null) ||
      (this.remote ? remoteIssueText[result?.code] : issueText[result?.code]) || fallback;
  }
  restoreMessage() { return this.remote ? "备份已导入当前账号。恢复前副本只留在本次页面内存中，请及时下载；刷新或离开后不会保留。" : "备份已恢复。恢复前副本仍可下载。"; }
  async fetchJson(path, options = {}, controller = new AbortController()) {
    this.controllers.add(controller);
    try {
      const response = await this.fetcher(path, { ...options, signal: controller.signal });
      if (!response.ok) {
        let failure; try { failure = await response.json(); } catch {}
        throw Object.assign(Error(response.status === 410 ? "expired" : "request"), { code: failure?.code });
      }
      return await response.json();
    } finally { this.controllers.delete(controller); }
  }
  resetSession(data) {
    if (this.disposed || !data) return;
    this.profileEpoch++; this.requestEpoch++;
    for (const controller of this.controllers) controller.abort();
    this.abort = null; this.cancelVoice(); this.attention.clear();
    this.pending.clear(); this.results.clear(); this.question = this.answer = null; this.round = null; this.studyId = null; this.prepared = null;
    // Old drains still resolve their own waiters, but cannot own a new drain.
    this.flushing = false; this.flushRun = null; this.flushDone = undefined;
    if (!this.restoring) this.busy = false;
    const current = this.currentGuard();
    if (this.remote) this.onRestore({ remote: true }); else this.onRestore();
    if (current()) this.onPreferences(storedPreferences(data));
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.initializeEpoch++; this.profileEpoch++; this.requestEpoch++; this.networkEpoch = -1;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear(); this.abort = null; this.cancelVoice(); this.attention.clear();
    this.pending.clear(); this.results.clear(); this.question = this.answer = null; this.round = null; this.view = null; this.prepared = null;
    this.busy = this.restoring = this.flushing = false; this.flushRun = null;
    this.store?.dispose?.();
  }
  async initialize() {
    if (this.disposed) return;
    const initializeEpoch = ++this.initializeEpoch;
    for (const controller of this.controllers) controller.abort();
    this.store?.dispose?.();
    this.status = "loading"; this.notify();
    try {
      const metadata = await this.fetchJson("/api/curriculum", { cache: "no-store" });
      if (this.disposed || initializeEpoch !== this.initializeEpoch) return;
      if (!Array.isArray(metadata.questions) || metadata.questions.length !== 432 || new Set(metadata.questions.map((q) => q.id)).size !== 432) throw Error("metadata");
      this.catalogue = metadata;
      this.store = this.storeFactory({ questions: metadata.questions, ...(this.storage !== undefined ? { storage: this.storage } : {}), ...(this.locks !== undefined ? { locks: this.locks } : {}),
        onIssue: (issue) => { if (!this.disposed && initializeEpoch === this.initializeEpoch) { this.issue = issue; this.notify(); } },
        onChange: (data, meta = {}) => {
          if (this.disposed || initializeEpoch !== this.initializeEpoch) return;
          const switched = this.data && data && this.data.profileId !== data.profileId;
          this.data = data; this.issue = meta.issue || null;
          if (data && (switched || meta.restored || meta.requiresSessionReset)) {
            this.resetSession(data);
            if (this.disposed || initializeEpoch !== this.initializeEpoch) return;
            if (meta.restored) this.message = this.restoreMessage();
            if (!this.restoring) this.onNotice(this.remote ? "账号记录已更新，已结束旧连接并读取当前账号的设置" : "另一页面恢复了档案，已结束旧连接并读取新记录");
          }
          this.notify();
        },
      });
      const result = await this.store.load();
      if (this.disposed || initializeEpoch !== this.initializeEpoch) return;
      this.status = "ready"; this.data = result.data; this.issue = result.issue || this.store.issue;
      if (result.data) this.onPreferences(storedPreferences(result.data));
      if (result.ok) await this.flush();
    } catch (error) { if (this.disposed || initializeEpoch !== this.initializeEpoch) return; this.status = "error"; this.message = this.remote ? "学习目录或账号记录尚未载入，请重试。" : "学习目录或本机记录尚未载入，请重试。"; }
    this.notify();
  }
  sessionReady(info) { if (this.disposed) return; this.networkEpoch = this.profileEpoch; if (/^net-[0-9.]+$/.test(info?.ruleset)) this.ruleset = info.ruleset; }
  receiveFeedback(value, source = "network") {
    if (this.disposed) return;
    if (source === "network" && this.networkEpoch !== this.profileEpoch) return;
    if (!value?.learning || !value.challengeId) return;
    this.attention.feedback(value.challengeId);
    this.pending.set(value.challengeId, value); void this.flush();
  }
  beginAttention(id) { if (!this.disposed) this.attention.begin(id); }
  visibility(value) { if (!this.disposed) this.attention.visibility(value); }
  async finishAttention(id) {
    if (this.disposed) return;
    const timing=this.attention.finish(id), current=this.currentGuard(), store=this.store;
    if (!timing || !this.store) return;
    await this.flush(); if (!current()) return;
    const before=this.data?.collection?.totalDays||0;
    const result=await store.qualifyLearning(id,timing);
    if (!current()) return;
    const after=result.data?.collection?.totalDays||0;
    if (result.ok && after>before) this.onNotice(after%5===0 ? "今天的学习完成了！已获得一份免费十连礼盒" : `今日学习完成，已经累计${after}个学习日`);
  }
  receiveResult(value) {
    if (this.disposed || value?.phase !== "finished" || this.networkEpoch !== this.profileEpoch) return;
    this.results.set(`${value.roomId}:${value.youSeat}`, value); void this.flush();
  }
  async flush() {
    if (this.disposed) return;
    if (this.flushing) return this.flushDone;
    if (this.restoring || !this.store || this.status !== "ready") return;
    const current = this.currentGuard(), store = this.store, run = {};
    this.flushing = true; this.flushRun = run;
    let finishFlush;
    this.flushDone = new Promise((resolve) => { finishFlush = resolve; });
    let failed = false;
    try {
      do {
        for (const [id, feedback] of this.pending) {
          if (!current() || this.restoring) break;
          const result = await store.applyLearning(feedback);
          if (!current()) return;
          if (!result.ok) { this.issue = result.issue || store.issue || { code: result.code, message: this.issueMessage(result, "学习回执尚未保存，请重试同步。") }; failed = true; break; }
          this.pending.delete(id);
          if (result.ignored) this.onNotice("一条过早的回执未补记；现有学习次数保持不变");
        }
        if (!failed && !this.restoring) for (const [id, snapshot] of this.results) {
          if (!current() || this.restoring) break;
          const result = await store.addResult(snapshot);
          if (!current()) return;
          if (!result.ok) { this.issue = result.issue || store.issue || { code: result.code, message: this.issueMessage(result, "对局回执尚未保存，请重试同步。") }; failed = true; break; }
          this.results.delete(id);
        }
        // A terminal snapshot may begin an asynchronous result write before
        // its final private learning receipt arrives. Drain that later receipt
        // before announcing a saved profile or allowing complete export.
      } while (current() && !failed && !this.restoring && this.pendingCount);
    } finally { if (this.flushRun === run) { this.flushing = false; this.flushRun = null; } finishFlush(); if (current()) this.notify(); }
  }
  async preferences(patch) {
    if (this.disposed || !this.store || this.status !== "ready") return;
    const current = this.currentGuard();
    const result = await this.store.updatePreferences(patch);
    if (!current()) return;
    if (!result.ok) this.onNotice(this.issueMessage(result, "设置只在本页生效，保存状态见“记录与备份”"));
    return result;
  }
  async refresh() {
    if (this.disposed) return;
    if (!this.store) return this.initialize();
    const current = this.currentGuard({ session: false }), previousProfileEpoch = this.profileEpoch;
    const result = await this.store.retry();
    if (!current()) return;
    if (result.ok && (result.restored || result.requiresSessionReset) && this.profileEpoch === previousProfileEpoch) { this.data = result.data; this.resetSession(result.data); }
    if (!current()) return;
    if (result.ok) await this.flush();
    if (!current()) return;
    const synced = result.ok && !this.issue && !this.pendingCount && !this.store.dirty;
    this.message = synced ? (result.restored ? this.restoreMessage() : this.remote ? "记录已同步到服务器的当前账号" : "记录已同步到本机") : this.issueMessage(result.ok ? this.issue : result, "尚未保存，请保留本页并下载副本");
    this.notify();
  }
  open(view) { if (this.disposed) return; this.close(); this.view = view; this.message = ""; if (this.store && !this.flushing) void this.store.retry(); this.notify(); }
  close() { if (this.disposed) return; if(this.answer&&this.question?.challengeId) void this.finishAttention(this.question.challengeId); this.requestEpoch++; this.abort?.abort(); this.abort = null; this.cancelVoice(); this.view = null; this.question = this.answer = null; this.round = null; if (!this.restoring) this.busy = false; this.studyId = null; this.prepared = null; }
  scope() {
    const p = this.getPreferences();
    return (this.catalogue?.questions || []).filter((q) => q.grade === p.grade && inCourse(q, p.course));
  }
  mastery(q) { return this.data?.legacy.mastery[q.id]; }
  label(q) {
    const m = this.mastery(q);
    return !m ? "还没练过" : !m.streak ? "再认识一次" : m.due <= Date.now() ? "今天复习" : m.streak >= 3 ? "逐渐记牢" : "已练习";
  }
  filtered() {
    return this.scope().filter((q) => { const m = this.mastery(q); return this.filter === "all" || this.filter === "new" && !m || this.filter === "due" && m && (!m.streak || m.due <= Date.now()); })
      .sort((a, b) => (this.mastery(a)?.due || 0) - (this.mastery(b)?.due || 0) || a.id.localeCompare(b.id));
  }
  summary() {
    const questions = this.scope(), learned = questions.filter((q) => this.mastery(q)), due = questions.filter((q) => { const m = this.mastery(q); return m && (!m.streak || m.due <= Date.now()); });
    return { total: questions.length, learned: learned.length, due: due.length };
  }
  warning() {
    if (this.status !== "ready") return this.status === "loading" ? (this.remote ? "正在读取当前账号的学习记录…" : "正在读取本机学习记录…") : this.message;
    if (this.issue) return this.remote ? this.issueMessage(this.issue, "当前账号记录尚未同步到服务器") : issueText[this.issue.code] || this.issue.message || "本机记录尚未保存";
    if (this.pendingCount || this.store?.dirty) return this.remote ? "当前账号的学习记录正在同步到服务器，请保留本页" : "学习记录正在保存，请保留本页";
    if (this.remote) return "学习记录保存在服务器的当前账号中";
    if (this.store?.singlePage) return "此浏览器不支持多页存档锁，请只用一个页面学习";
    return "学习记录仅保存在这台浏览器";
  }
  html() {
    const inner = this.view === "study" ? this.studyHtml() : this.view === "records" ? this.recordsHtml() : this.dataHtml();
    return `<section class="dialog study-desk" role="dialog" aria-modal="true"><header><h2>${this.view === "study" ? "词灵手册" : this.view === "records" ? (this.remote ? "我的账号成绩" : "本机排行榜") : "记录与备份"}</h2><button data-action="close-panel" aria-label="关闭">×</button></header>${inner}</section>`;
  }
  studyHtml() {
    if (!this.canStart && !this.question) return `<p>${esc(this.warning())}</p><button data-action="desk-retry">重试读取</button>`;
    if (this.round?.finished) {
      const completed = Object.values(this.round.results);
      return `<div class="study-complete"><p class="eyebrow">A LITTLE EVERY DAY</p><h3>这轮练习完成了</h3><p>你认识了 ${completed.length}项，其中 ${completed.filter(Boolean).length}项答对。需要再看的项目会留在复习目录里。</p><p class="save-state">${esc(this.warning())}</p><button class="primary" data-action="desk-back">回到手册目录</button></div>`;
    }
    if (this.question) {
      const q = this.question.question, answer = this.answer;
      return `<div class="quiz"><p class="subtle">${esc(q.unitLabel)} · 本轮 ${this.round ? this.round.index + 1 : 1}/${this.round?.ids.length || 1}</p><header><h3>${esc(q.prompt)}</h3><button data-action="desk-listen">♫ 听英语</button></header>${this.visualCue(q.visual)}${q.text ? `<p class="english">${esc(q.text)}</p>` : ""}<div class="answers">${q.options.map((o, i) => `<button data-action="desk-answer" data-option="${esc(o.id)}" ${this.busy || answer ? "disabled" : ""} class="${answer?.correctOptionId === o.id ? "correct" : ""}"><span>${String.fromCharCode(65 + i)}</span>${esc(o.text)}</button>`).join("")}</div>${answer ? `<div class="feedback"><b>${answer.outcome === "correct" ? "记住这次回响" : "一起再看一遍"}</b><p>${esc(answer.explanation)}</p><p class="save-state">${esc(this.warning())}</p></div>` : ""}${this.message ? `<p role="status">${esc(this.message)}</p>` : ""}<div class="desk-actions"><button data-action="desk-back">返回目录</button>${answer ? `<button data-action="desk-next" class="primary" ${!this.canStart ? "disabled" : ""}>${this.round && this.round.index + 1 >= this.round.ids.length ? "完成这一轮" : "下一项"}</button>` : ""}</div></div>`;
    }
    const s = this.summary(), list = this.filtered(), last = Math.max(0, Math.ceil(list.length / 6) - 1); this.page = Math.min(this.page, last);
    return `<p>${this.getPreferences().grade}年级 · 当前范围 ${s.total}项，已练 ${s.learned}项，待复习 ${s.due}项</p><p class="subtle">从任意一项开始，每轮最多6项，练完就休息一下。</p><div class="desk-filters">${[["due", "今天复习"], ["new", "还没练过"], ["all", "全部"]].map(([id, text]) => `<button data-action="desk-filter" data-value="${id}" class="${this.filter === id ? "chosen" : ""}">${text}</button>`).join("")}</div><div class="study-list">${list.slice(this.page * 6, this.page * 6 + 6).map((q) => `<button data-action="desk-study" data-value="${esc(q.id)}" ${this.busy ? "disabled" : ""}><span>${esc(q.displayLabel)}</span><small>${this.label(q)}</small></button>`).join("") || `<p>这一组暂时没有待练项目。可以选择“全部”继续认识。</p>`}</div><div class="desk-actions"><button data-action="desk-page" data-value="-1" ${this.page === 0 ? "disabled" : ""}>上一页</button><span>${this.page + 1}/${last + 1}</span><button data-action="desk-page" data-value="1" ${this.page >= last ? "disabled" : ""}>下一页</button></div>${this.message ? `<p role="status">${esc(this.message)}</p>` : ""}<p class="subtle">当天多练会记录次数；掌握阶段需要隔天再次答对。</p>`;
  }
  recordsHtml() {
    const p = this.getPreferences(), all = this.data?.onlineRecords || [];
    const rule = this.recordRules || this.ruleset, availableRules = [...new Set([this.ruleset,...all.map(r=>r.ruleset)])];
    const records = all.filter((r) => r.grade === p.grade && r.course === p.course && r.ruleset === rule && !r.assisted && ["health", "draw"].includes(r.reason)).sort((a, b) => b.score - a.score || a.date - b.date).slice(0, 20);
    const legacy = this.data?.legacy.records || [];
    return `<p>${p.grade}年级 · 当前学习范围 · 对战规则 ${esc(rule)}</p><label>查看规则版本<select id="record-rules">${availableRules.map(r=>`<option value="${esc(r)}" ${r===rule?"selected":""}>${esc(r)}</option>`).join("")}</select></label><p class="subtle">${this.remote ? "这里只展示当前账号由服务器确认、自然结束的个人对局成绩，不是全服排行榜。提前退出的对局另行保留。" : "只显示这个浏览器自然结束的真实对局，提前退出不入榜。"}玩家对局与电脑挑战按类型标注；不同抽牌顺序不作为统一种子竞赛。</p><ol class="record-list">${records.map((r) => `<li><b>${r.score}分</b><span>${r.result === "win" ? "胜利" : r.result === "draw" ? "平局" : "完成"} · ${r.mode === "pvp" ? "玩家对局" : `电脑挑战${r.computer?.name ? " · "+esc(r.computer.name) : ""}`} · ${r.turns}回合</span><small>英语 ${r.correct}/${r.attempts} · ${new Date(r.date).toLocaleDateString()}</small></li>`).join("") || "<p>完成一局后，这里就会留下你的成绩。</p>"}</ol><p class="subtle">另保留 ${all.filter((r) => r.assisted || !["health", "draw"].includes(r.reason)).length}局退出或协助记录、${legacy.length}局旧版成绩，均包含在完整备份里。${this.remote ? "导入的旧分数仅供未认证历史展示，不计入正式PVP成绩。" : "旧版独立规则与本榜分开。"}</p>`;
  }
  dataHtml() {
    const d = this.data, preview = this.prepared?.preview, source = this.prepared?.sourceSummary || preview?.sourceSummary;
    const importDetails = this.remote ? `<p>${preview?.grade}年级 · ${preview?.legacyRecords||0}局旧成绩 · ${preview?.collectionCopies||0}次旧外观收藏${preview?.hasOfflineMatch ? " · 含旧版未完对局" : ""}</p>${source ? `<p>来源备份历史（未认证）：${esc(source.onlineRecords??0)}局对局成绩 · ${esc(source.learningDays??0)}个历史学习日 · 历史战力${esc(source.combatRating??700)}。这些数字不会计入正式成绩或奖励。</p>` : ""}<p>导入后的正式进度从初始值开始：${preview?.onlineRecords||0}局正式新成绩 · ${preview?.learningDays||0}个正式学习日 · 正式战力${preview?.combatRating??700}。</p><p>确认后会将备份中的学习记录、设置和旧卡外观发送到服务器的当前账号。旧分数、历史天数和旧钱包仅作未认证展示；新的正式奖励和PVP成绩不从文件恢复。${this.prepared?.importPolicy === "learning-and-display-only" ? "此备份按“学习与历史展示”规则导入。" : ""}账号已有活跃进度时，服务器会拒绝导入，不会覆盖现有记录；原本机存档和原备份文件不变。请先核对来源摘要。</p><p>成功后会结束本页旧对战连接。恢复前副本只保留在本次页面内存中，请及时下载；刷新或离开后不会保留。</p>` : `<p>${preview?.grade}年级 · ${preview?.onlineRecords}局新成绩 · ${preview?.legacyRecords}局旧成绩 · ${preview?.learningDays||0}学习日 · ${preview?.collectionCopies||0}次外观收藏 · 战力${preview?.combatRating??700}${preview?.hasOfflineMatch ? " · 含旧版未完对局" : ""}</p><p>会保留当前档案的恢复副本，并结束本页临时对战连接。旧备份中未包含的新评级和收藏将从初始值开始；请先核对上方摘要。其他页面请先关闭。</p>`;
    return `<p role="status">${esc(this.warning())}</p>${d ? `<p class="subtle">当前${this.remote ? "账号" : ""}记录：${Object.keys(d.legacy.mastery).length}项学习、${d.onlineRecords.length}局新成绩、${d.legacy.records.length}局旧成绩；累计${d.collection?.totalDays||0}个${this.remote ? "正式" : ""}学习日、参考战力${d.combatRating?.rating??700}。${d.legacy.match ? "已保留旧版未完对局，可导出旧版备份回到2.7.5继续。" : ""}</p>` : ""}<div class="data-actions"><button data-action="desk-export" ${!d || this.busy ? "disabled" : ""}>下载完整备份</button><button data-action="desk-rescue" ${!d || this.busy ? "disabled" : ""}>下载本页抢救副本</button><button data-action="desk-legacy" ${!d || this.busy ? "disabled" : ""}>下载旧版兼容备份</button><button data-action="desk-retry" ${this.busy ? "disabled" : ""}>重试读取与保存</button>${this.store?.recoveryRaw ? '<button data-action="desk-recovery">下载恢复前副本</button>' : ""}</div><label class="import-label">${this.remote ? "选择旧备份导入当前账号" : "选择备份恢复"}<input type="file" id="desk-import" accept=".json,application/json" ${!this.store || this.busy ? "disabled" : ""}></label>${preview ? `<div class="feedback"><b>确认${this.remote ? "导入" : "恢复"} ${esc(this.importName)}</b>${importDetails}<button class="primary" data-action="desk-restore" ${this.busy ? "disabled" : ""}>${this.remote ? "确认发送并导入当前账号" : "确认恢复这份备份"}</button><button data-action="desk-cancel-import">取消</button></div>` : ""}${this.message ? `<p role="status">${esc(this.message)}</p>` : ""}<p class="subtle">${this.remote ? "下载会读取服务器当前账号的记录，并将文件保存到你选定的位置。本页抢救副本只含已载入内存的记录，可能不含服务器最新内容或尚未确认的操作。原电脑版本机存档仍单独保留，可继续使用旧版兼容备份。" : "备份保留在你选定的下载位置，不会上传到服务器。不同网站地址的浏览器记录不会自动共享，请用备份迁移。"}</p>`;
  }
  async study(qid) {
    if (!this.canStart || this.busy || !this.scope().some((q) => q.id === qid)) return;
    if (!this.round || this.round.finished || !this.round.ids.includes(qid)) {
      const list = this.filtered().map((q) => q.id), start = list.indexOf(qid);
      const rotated = start >= 0 ? [...list.slice(start), ...list.slice(0, start)] : [qid];
      this.round = { ids: [...new Set(rotated)].slice(0, 6), index: 0, results: {}, finished: false };
    }
    this.cancelVoice(); const epoch = ++this.requestEpoch; this.abort?.abort(); this.abort = new AbortController();
    this.busy = true; this.message = ""; this.notify();
    try {
      const value = await this.fetchJson(`/api/study/${encodeURIComponent(qid)}`, { cache: "no-store" }, this.abort);
      if (this.disposed || epoch !== this.requestEpoch || this.view !== "study") return;
      this.studyId = qid; this.question = value; this.beginAttention(value.challengeId); this.answer = null;
      this.round.index = this.round.ids.indexOf(qid);
    } catch (e) { if (epoch === this.requestEpoch) this.message = this.issueMessage(e, "题目暂未载入，请再试一次。"); }
    finally { if (epoch === this.requestEpoch) { this.busy = false; this.notify(); } }
  }
  async answerStudy(optionId) {
    if (this.disposed || this.busy || !this.question || this.answer || !this.question.question.options.some((o) => o.id === optionId)) return;
    const epoch = this.requestEpoch, profileEpoch = this.profileEpoch, qid = this.studyId, challengeId = this.question.challengeId;
    this.busy = true; this.message = ""; this.cancelVoice(); this.notify();
    try {
      const value = await this.fetchJson(`/api/study/${encodeURIComponent(qid)}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId, optionId }) });
      if (this.disposed) return;
      // A successfully received answer is a learning event even if its panel was closed.
      if (profileEpoch === this.profileEpoch) this.receiveFeedback(value, "study");
      if (epoch === this.requestEpoch && this.view === "study") { this.answer = value; if (this.round && value.learning?.qid === qid) this.round.results[qid] = value.learning.correct; }
    } catch (e) { if (epoch === this.requestEpoch) this.message = e.message === "expired" ? "这道题已过期，请返回目录重新打开。没有记为答错。" : this.issueMessage(e, "答案尚未确认，可重试原选项。"); }
    finally { if (epoch === this.requestEpoch) { this.busy = false; this.notify(); } }
  }
  download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async click(action, value, option) {
    if (this.disposed) return false;
    if (!action.startsWith("desk-")) return false;
    const current = this.currentGuard();
    if (action === "desk-filter") { this.filter = value; this.page = 0; }
    if (action === "desk-page") this.page = Math.max(0, this.page + Number(value));
    if (action === "desk-study") await this.study(value);
    if (action === "desk-answer") await this.answerStudy(option);
    if (action === "desk-back") { if(this.answer&&this.question?.challengeId) void this.finishAttention(this.question.challengeId); this.requestEpoch++; this.abort?.abort(); this.cancelVoice(); this.question = this.answer = null; this.round = null; this.busy = false; this.message = ""; }
    if (action === "desk-next" && this.answer && this.canStart) {
      if(this.question?.challengeId) void this.finishAttention(this.question.challengeId);
      const next = this.round?.ids[this.round.index + 1];
      if (next) await this.study(next);
      else { this.cancelVoice(); this.question = this.answer = null; if (this.round) this.round.finished = true; }
    }
    if (action === "desk-listen") this.listen(this.answer?.audioUrl || this.question?.question.listenAudioUrls || this.question?.question.listenAudioUrl);
    if (action === "desk-retry") await this.refresh();
    if (action === "desk-cancel-import") this.prepared = null;
    if (["desk-export", "desk-rescue", "desk-legacy", "desk-recovery"].includes(action)) {
      if (!this.store || this.busy) return true;
      const store = this.store, current = this.currentGuard({ request: true });
      this.busy = true; this.notify();
      try {
        let text;
        if (action === "desk-rescue") text = await store.export();
        else if (action === "desk-recovery") text = store.recoveryRaw;
        else {
          await this.flush(); if (!current()) return true;
          if (this.pendingCount) throw Object.assign(Error(), { code: this.issue?.code || "WRITE_FAILED", issue: this.issue });
          const result = await (action === "desk-legacy" ? store.exportLegacyLatest() : store.exportLatest());
          if (!current()) return true;
          if (!result.ok) throw Object.assign(Error(), { code: result.code, issue: result.issue, message: result.message || "" });
          text = result.json;
        }
        if (!current()) return true;
        if (!text) throw Error("empty");
        this.download(text, `spellwood-${action.slice(5)}-${new Date().toISOString().slice(0, 10)}.json`);
        this.message = action === "desk-rescue" ? (this.remote ? "已生成本页内存副本；它可能不含服务器最新记录或尚未确认的操作。" : "已生成本页副本；它可能不含另一页刚保存的记录。") : "已生成备份下载，请保留文件。";
      } catch (e) { if (current()) this.message = this.issueMessage(e, "备份未生成，请重试或下载本页抢救副本。"); }
      finally { if (current()) this.busy = false; }
    }
    if (action === "desk-restore" && this.prepared && !this.busy) {
      const prepared = this.prepared, previousProfileEpoch = this.profileEpoch;
      const restoreCurrent = this.currentGuard({ session: false }), store = this.store;
      this.busy = true; this.restoring = true; this.notify();
      try {
        await this.flushDone;
        if (!restoreCurrent()) return true;
        const result = await store.restore(prepared, prepared.revision);
        if (!restoreCurrent()) return true;
        if (result.ok) {
          if (this.profileEpoch === previousProfileEpoch) { this.data = result.data; this.resetSession(result.data); }
          if (!restoreCurrent()) return true;
          this.prepared = null; this.message = this.restoreMessage();
        } else this.message = this.issueMessage(result, "恢复未完成，原记录保留。");
      } catch (error) { if (restoreCurrent()) this.message = this.issueMessage(error, "恢复尚未确认，请保留本页并重试同步。"); }
      finally { if (restoreCurrent()) { this.busy = false; this.restoring = false; void this.flush(); this.notify(); } }
    }
    if (current()) this.notify(); return true;
  }
  async importFile(file) {
    if (this.disposed || !file || this.busy || this.restoring || !this.store) return;
    if (file.size > 8 * 1024 * 1024) { this.message = "备份过大，请选择8MB以内的JSON备份。"; this.notify(); return; }
    this.busy = true; this.notify();
    const epoch = this.requestEpoch, current = this.currentGuard(), store = this.store;
    try {
      const text = await file.text(); if (!current() || epoch !== this.requestEpoch || this.view !== "data") return;
      const prepared = await store.prepareImport(text); if (!current() || epoch !== this.requestEpoch || this.view !== "data") return;
      if (prepared?.ok === false) throw Object.assign(Error(), prepared);
      this.prepared = prepared; this.importName = file.name; this.message = "";
    }
    catch (error) { if (current() && epoch === this.requestEpoch) { this.prepared = null; this.message = this.issueMessage(error, "这份文件未通过存档校验，尚未修改当前记录。"); } }
    finally { if (current() && epoch === this.requestEpoch) { this.busy = false; this.notify(); } }
  }
}
