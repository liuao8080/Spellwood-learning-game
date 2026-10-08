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

/** Local learning records plus private server-issued study challenges.
 * No personal progress is posted to the server. */
export class StudyDesk {
  constructor({ onChange = () => {}, onPreferences = () => {}, onNotice = () => {}, onRestore = () => {}, getPreferences = () => ({}), fetcher = (...args) => fetch(...args), storage, locks, visualCue = () => "", listen = () => {}, cancelVoice = () => {} } = {}) {
    Object.assign(this, { onChange, onPreferences, onNotice, onRestore, getPreferences, fetcher, storage, locks, visualCue, listen, cancelVoice });
    this.status = "loading"; this.catalogue = null; this.store = null; this.data = null; this.issue = null;
    this.view = null; this.filter = "due"; this.page = 0; this.question = null; this.answer = null; this.studyId = null;
    this.round = null; this.initializeEpoch = 0;
    this.busy = false; this.requestEpoch = 0; this.profileEpoch = 0; this.networkEpoch = 0; this.pending = new Map(); this.results = new Map(); this.flushing = false;
    this.prepared = null; this.importName = ""; this.message = "";
    this.ruleset = "net-1.1"; this.recordRules = null;
    this.attention = new LearningAttention({visible:!globalThis.document?.hidden});
  }
  get canStart() { return this.status === "ready" && !!this.data && !this.issue && !this.store?.dirty && !this.pendingCount && !this.flushing && !this.restoring && !this.busy; }
  get pendingCount() { return this.pending.size + this.results.size; }
  notify() { this.onChange(); }
  async initialize() {
    const initializeEpoch = ++this.initializeEpoch;
    this.status = "loading"; this.notify();
    try {
      const response = await this.fetcher("/api/curriculum", { cache: "no-store" });
      if (!response.ok) throw Error("metadata");
      const metadata = await response.json();
      if (initializeEpoch !== this.initializeEpoch) return;
      if (!Array.isArray(metadata.questions) || metadata.questions.length !== 432 || new Set(metadata.questions.map((q) => q.id)).size !== 432) throw Error("metadata");
      this.catalogue = metadata;
      this.store = new ProgressStore({ questions: metadata.questions, ...(this.storage !== undefined ? { storage: this.storage } : {}), ...(this.locks !== undefined ? { locks: this.locks } : {}),
        onChange: (data, meta) => {
          if (initializeEpoch !== this.initializeEpoch) return;
          const switched = this.data && data && this.data.profileId !== data.profileId;
          this.data = data; this.issue = meta.issue || null;
          if (switched) {
            this.profileEpoch++; this.requestEpoch++; this.abort?.abort(); this.cancelVoice(); this.attention.clear();
            this.pending.clear(); this.results.clear(); this.question = this.answer = null; this.round = null; if (!this.restoring) this.busy = false;
            this.onRestore(); this.onPreferences(storedPreferences(data));
            if (!this.restoring) this.onNotice("另一页面恢复了档案，已结束旧连接并读取新记录");
          }
          this.notify();
        },
      });
      const result = await this.store.load();
      if (initializeEpoch !== this.initializeEpoch) return;
      this.status = "ready"; this.data = result.data; this.issue = result.issue || this.store.issue;
      if (result.data) this.onPreferences(storedPreferences(result.data));
      if (result.ok) await this.flush();
    } catch (error) { if (initializeEpoch !== this.initializeEpoch) return; this.status = "error"; this.message = "学习目录或本机记录尚未载入，请重试。"; }
    this.notify();
  }
  sessionReady(info) { this.networkEpoch = this.profileEpoch; if (/^net-[0-9.]+$/.test(info?.ruleset)) this.ruleset = info.ruleset; }
  receiveFeedback(value, source = "network") {
    if (source === "network" && this.networkEpoch !== this.profileEpoch) return;
    if (!value?.learning || !value.challengeId) return;
    this.attention.feedback(value.challengeId);
    this.pending.set(value.challengeId, value); void this.flush();
  }
  beginAttention(id) { this.attention.begin(id); }
  visibility(value) { this.attention.visibility(value); }
  async finishAttention(id) {
    const timing=this.attention.finish(id),epoch=this.profileEpoch;
    if (!timing || !this.store) return;
    await this.flush(); if (epoch!==this.profileEpoch) return;
    const before=this.data?.collection?.totalDays||0;
    const result=await this.store.qualifyLearning(id,timing);
    const after=result.data?.collection?.totalDays||0;
    if (result.ok && after>before) this.onNotice(after%5===0 ? "今天的学习完成了！已获得一份免费十连礼盒" : `今日学习完成，已经累计${after}个学习日`);
  }
  receiveResult(value) {
    if (value?.phase !== "finished" || this.networkEpoch !== this.profileEpoch) return;
    this.results.set(`${value.roomId}:${value.youSeat}`, value); void this.flush();
  }
  async flush() {
    if (this.flushing) return this.flushDone;
    if (this.restoring || !this.store || this.status !== "ready") return;
    this.flushing = true;
    let finishFlush;
    this.flushDone = new Promise((resolve) => { finishFlush = resolve; });
    let failed = false;
    try {
      do {
        for (const [id, feedback] of this.pending) {
          if (this.restoring) break;
          const result = await this.store.applyLearning(feedback);
          if (!result.ok) { failed = true; break; }
          this.pending.delete(id);
          if (result.ignored) this.onNotice("一条过早的回执未补记；现有学习次数保持不变");
        }
        if (!failed && !this.restoring) for (const [id, snapshot] of this.results) {
          if (this.restoring) break;
          const result = await this.store.addResult(snapshot);
          if (!result.ok) { failed = true; break; }
          this.results.delete(id);
        }
        // A terminal snapshot may begin an asynchronous result write before
        // its final private learning receipt arrives. Drain that later receipt
        // before announcing a saved profile or allowing complete export.
      } while (!failed && !this.restoring && this.pendingCount);
    } finally { this.flushing = false; finishFlush(); this.notify(); }
  }
  async preferences(patch) {
    if (!this.store || this.status !== "ready") return;
    const result = await this.store.updatePreferences(patch);
    if (!result.ok) this.onNotice("设置只在本页生效，保存状态见“记录与备份”");
    return result;
  }
  async refresh() {
    if (!this.store) return this.initialize();
    const result = await this.store.retry();
    if (result.ok) await this.flush();
    this.message = result.ok ? "记录已同步到本机" : issueText[result.code] || "尚未保存，请保留本页并下载副本";
    this.notify();
  }
  open(view) { this.close(); this.view = view; this.message = ""; if (this.store && !this.flushing) void this.store.retry(); this.notify(); }
  close() { if(this.answer&&this.question?.challengeId) void this.finishAttention(this.question.challengeId); this.requestEpoch++; this.abort?.abort(); this.abort = null; this.cancelVoice(); this.view = null; this.question = this.answer = null; this.round = null; if (!this.restoring) this.busy = false; this.studyId = null; this.prepared = null; }
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
    if (this.status !== "ready") return this.status === "loading" ? "正在读取本机学习记录…" : this.message;
    if (this.issue) return issueText[this.issue.code] || this.issue.message || "本机记录尚未保存";
    if (this.pendingCount || this.store?.dirty) return "学习记录正在保存，请保留本页";
    if (this.store?.singlePage) return "此浏览器不支持多页存档锁，请只用一个页面学习";
    return "学习记录仅保存在这台浏览器";
  }
  html() {
    const inner = this.view === "study" ? this.studyHtml() : this.view === "records" ? this.recordsHtml() : this.dataHtml();
    return `<section class="dialog study-desk" role="dialog" aria-modal="true"><header><h2>${this.view === "study" ? "词灵手册" : this.view === "records" ? "本机排行榜" : "记录与备份"}</h2><button data-action="close-panel" aria-label="关闭">×</button></header>${inner}</section>`;
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
    return `<p>${p.grade}年级 · 当前学习范围 · 对战规则 ${esc(rule)}</p><label>查看规则版本<select id="record-rules">${availableRules.map(r=>`<option value="${esc(r)}" ${r===rule?"selected":""}>${esc(r)}</option>`).join("")}</select></label><p class="subtle">只显示这个浏览器自然结束的真实对局，提前退出不入榜。玩家对局与电脑挑战按类型标注；不同抽牌顺序不作为统一种子竞赛。</p><ol class="record-list">${records.map((r) => `<li><b>${r.score}分</b><span>${r.result === "win" ? "胜利" : r.result === "draw" ? "平局" : "完成"} · ${r.mode === "pvp" ? "玩家对局" : `电脑挑战${r.computer?.name ? " · "+esc(r.computer.name) : ""}`} · ${r.turns}回合</span><small>英语 ${r.correct}/${r.attempts} · ${new Date(r.date).toLocaleDateString()}</small></li>`).join("") || "<p>完成一局后，这里就会留下你的成绩。</p>"}</ol><p class="subtle">另保留 ${all.filter((r) => r.assisted || !["health", "draw"].includes(r.reason)).length}局退出或协助记录、${legacy.length}局旧版成绩，均包含在完整备份里。旧版独立规则与本榜分开。</p>`;
  }
  dataHtml() {
    const d = this.data, preview = this.prepared?.preview;
    return `<p role="status">${esc(this.warning())}</p>${d ? `<p class="subtle">当前记录：${Object.keys(d.legacy.mastery).length}项学习、${d.onlineRecords.length}局新成绩、${d.legacy.records.length}局旧成绩；累计${d.collection?.totalDays||0}个学习日、参考战力${d.combatRating?.rating??700}。${d.legacy.match ? "已保留旧版未完对局，可导出旧版备份回到2.7.5继续。" : ""}</p>` : ""}<div class="data-actions"><button data-action="desk-export" ${!d || this.busy ? "disabled" : ""}>下载完整备份</button><button data-action="desk-rescue" ${!d || this.busy ? "disabled" : ""}>下载本页抢救副本</button><button data-action="desk-legacy" ${!d || this.busy ? "disabled" : ""}>下载旧版兼容备份</button><button data-action="desk-retry" ${this.busy ? "disabled" : ""}>重试读取与保存</button>${this.store?.recoveryRaw ? '<button data-action="desk-recovery">下载恢复前副本</button>' : ""}</div><label class="import-label">选择备份恢复<input type="file" id="desk-import" accept=".json,application/json" ${!this.store || this.busy ? "disabled" : ""}></label>${preview ? `<div class="feedback"><b>确认恢复 ${esc(this.importName)}</b><p>${preview.grade}年级 · ${preview.onlineRecords}局新成绩 · ${preview.legacyRecords}局旧成绩 · ${preview.learningDays||0}学习日 · ${preview.collectionCopies||0}次外观收藏 · 战力${preview.combatRating??700}${preview.hasOfflineMatch ? " · 含旧版未完对局" : ""}</p><p>会保留当前档案的恢复副本，并结束本页临时对战连接。旧备份中未包含的新评级和收藏将从初始值开始；请先核对上方摘要。其他页面请先关闭。</p><button class="primary" data-action="desk-restore" ${this.busy ? "disabled" : ""}>确认恢复这份备份</button><button data-action="desk-cancel-import">取消</button></div>` : ""}${this.message ? `<p role="status">${esc(this.message)}</p>` : ""}<p class="subtle">备份保留在你选定的下载位置，不会上传到服务器。不同网站地址的浏览器记录不会自动共享，请用备份迁移。</p>`;
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
      const response = await this.fetcher(`/api/study/${encodeURIComponent(qid)}`, { signal: this.abort.signal, cache: "no-store" });
      if (!response.ok) throw Error("study");
      const value = await response.json();
      if (epoch !== this.requestEpoch || this.view !== "study") return;
      this.studyId = qid; this.question = value; this.beginAttention(value.challengeId); this.answer = null;
      this.round.index = this.round.ids.indexOf(qid);
    } catch (e) { if (epoch === this.requestEpoch) this.message = "题目暂未载入，请再试一次。"; }
    finally { if (epoch === this.requestEpoch) { this.busy = false; this.notify(); } }
  }
  async answerStudy(optionId) {
    if (this.busy || !this.question || this.answer || !this.question.question.options.some((o) => o.id === optionId)) return;
    const epoch = this.requestEpoch, profileEpoch = this.profileEpoch, qid = this.studyId, challengeId = this.question.challengeId;
    this.busy = true; this.message = ""; this.cancelVoice(); this.notify();
    try {
      const response = await this.fetcher(`/api/study/${encodeURIComponent(qid)}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId, optionId }) });
      if (!response.ok) throw Error(response.status === 410 ? "expired" : "answer");
      const value = await response.json();
      // A successfully received answer is a learning event even if its panel was closed.
      if (profileEpoch === this.profileEpoch) this.receiveFeedback(value, "study");
      if (epoch === this.requestEpoch && this.view === "study") { this.answer = value; if (this.round && value.learning?.qid === qid) this.round.results[qid] = value.learning.correct; }
    } catch (e) { if (epoch === this.requestEpoch) this.message = e.message === "expired" ? "这道题已过期，请返回目录重新打开。没有记为答错。" : "答案尚未确认，可重试原选项。"; }
    finally { if (epoch === this.requestEpoch) { this.busy = false; this.notify(); } }
  }
  download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async click(action, value, option) {
    if (!action.startsWith("desk-")) return false;
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
      this.busy = true; this.notify();
      try {
        let text;
        if (action === "desk-rescue") text = this.store.export();
        else if (action === "desk-recovery") text = this.store.recoveryRaw;
        else { await this.flush(); if (this.pendingCount) throw Object.assign(Error(), { code: this.issue?.code || "WRITE_FAILED" }); const result = await (action === "desk-legacy" ? this.store.exportLegacyLatest() : this.store.exportLatest()); if (!result.ok) throw Object.assign(Error(), { code: result.code }); text = result.json; }
        if (!text) throw Error("empty");
        this.download(text, `spellwood-${action.slice(5)}-${new Date().toISOString().slice(0, 10)}.json`);
        this.message = action === "desk-rescue" ? "已生成本页副本；它可能不含另一页刚保存的记录。" : "已生成备份下载，请保留文件。";
      } catch (e) { this.message = issueText[e.code] || "备份未生成，请重试或下载本页抢救副本。"; }
      finally { this.busy = false; }
    }
    if (action === "desk-restore" && this.prepared && !this.busy) {
      const prepared = this.prepared, previousProfileEpoch = this.profileEpoch;
      this.busy = true; this.restoring = true; this.notify();
      try {
        await this.flushDone;
        const result = await this.store.restore(prepared, prepared.revision);
        if (result.ok) { this.attention.clear(); if (this.profileEpoch === previousProfileEpoch) { this.profileEpoch++; this.onRestore(); } this.pending.clear(); this.results.clear(); this.prepared = null; this.requestEpoch++; this.onPreferences(storedPreferences(result.data)); this.message = "备份已恢复。恢复前副本仍可下载。"; }
        else this.message = issueText[result.code] || "恢复未完成，原记录保留。";
      } finally { this.busy = false; this.restoring = false; void this.flush(); }
    }
    this.notify(); return true;
  }
  async importFile(file) {
    if (!file || this.busy || this.restoring || !this.store) return;
    if (file.size > 8 * 1024 * 1024) { this.message = "备份过大，请选择8MB以内的JSON备份。"; this.notify(); return; }
    this.busy = true; this.notify();
    const epoch = this.requestEpoch;
    try { const text = await file.text(); if (epoch !== this.requestEpoch || this.view !== "data") return; this.prepared = this.store.prepareImport(text); this.importName = file.name; this.message = ""; }
    catch { if (epoch === this.requestEpoch) { this.prepared = null; this.message = "这份文件未通过存档校验，尚未修改当前记录。"; } }
    finally { if (epoch === this.requestEpoch) { this.busy = false; this.notify(); } }
  }
}
