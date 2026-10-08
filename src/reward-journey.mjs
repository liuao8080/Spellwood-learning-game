import { HERO_SKINS, DEFAULT_HERO_SKIN } from './hero-skins.mjs';

/** Pure server-side reward reducer. Never wire authority-bearing inputs directly
 * to HTTP. The owner commits state + officialDustDelta + the permanent event
 * receipt together, under its existing SQLite revision/transaction boundary. */
export const REWARD_JOURNEY_VERSION = 1;
export const REWARD_TIME_ZONE = 'Asia/Shanghai';
export const REWARD_JOURNEY_LIMITS = Object.freeze({ days: 35, events: 128, operations: 64, recent: 20, units: 128, balance: 100000000 });
export const SKIN_RULES = Object.freeze({ poolSize: 20, ordinaryChance: .05, duplicateDust: 20, redeemDust: 100, repeatGuarantee: 4 });
const IDS = Object.freeze(HERO_SKINS.map(s => s.id));
if (IDS.length !== 20 || new Set(IDS).size !== 20 || IDS.includes(DEFAULT_HERO_SKIN)) throw Error('INVALID_SKIN_CATALOG');
const SKINS = new Set(IDS), DAY = 86400000, OFFSET = 8 * 3600000;
const TASKS = ['daily_warmup', 'daily_practice', 'daily_apply', 'newcomer'];
const MODES = ['official', 'test'];
const clone = value => structuredClone(value);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = code => { throw Object.assign(Error(code), { code }); };
const int = (value, low = 0, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) && !Object.hasOwn(Object.prototype, value);
const requireId = value => { if (!validId(value)) fail('INVALID_REWARD_ID'); return value; };
const timestamp = value => { if (!int(value, 0, 4102444800000)) fail('INVALID_REWARD_TIME'); return value; };
const amount = value => int(value, 0, REWARD_JOURNEY_LIMITS.balance);
const modeOf = mode => { if (!MODES.includes(mode)) fail('INVALID_SKIN_MODE'); return mode; };
const emptyDay = () => ({ qids: [], units: {}, qualifiedMatch: false, claimed: [] });
const emptyWallet = () => ({ owned: [], repeatStreak: 0 });
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const unique = values => new Set(values).size === values.length;

export function rewardDay(issuedAt) { return new Date(timestamp(issuedAt) + OFFSET).toISOString().slice(0, 10); }
export function rewardPeriod(issuedAt) {
  const day = rewardDay(issuedAt), startAt = Date.parse(day + 'T00:00:00Z') - OFFSET;
  return { periodId: `shanghai-v1:${day}`, rewardDay: day, startAt, endAt: startAt + DAY, timeZone: REWARD_TIME_ZONE, timeZoneVersion: 1 };
}
export function freshJourney({ ownerId } = {}) {
  return { version: 1, ownerId: requireId(ownerId), timeZone: REWARD_TIME_ZONE, revision: 0,
    newcomerGranted: false, skinTickets: 0, days: {}, retiredThroughDay: null,
    official: emptyWallet(), test: { ...emptyWallet(), dust: 0 },
    equipped: { mode: 'base', skinId: DEFAULT_HERO_SKIN },
    openings: { official: null, test: null }, recent: [],
    events: [], operations: [], eventCutoff: -1, operationCutoff: -1 };
}

function cleanBatch(value) {
  if (!plain(value) || !validId(value.id) || !MODES.includes(value.mode) || ![1, 10].includes(value.count) ||
      !int(value.issuedAt, 0, 4102444800000) || !int(value.revealed, 0, (1 << value.count) - 1) ||
      !Array.isArray(value.results) || value.results.length !== value.count) fail('INVALID_REWARD_STATE');
  const results = value.results.map(result => {
    if (!plain(result) || !SKINS.has(result.skinId) || typeof result.duplicate !== 'boolean' || typeof result.guaranteed !== 'boolean' ||
        result.dust !== (result.duplicate ? SKIN_RULES.duplicateDust : 0) || result.guaranteed && result.duplicate) fail('INVALID_REWARD_STATE');
    return { skinId: result.skinId, duplicate: result.duplicate, guaranteed: result.guaranteed, dust: result.dust };
  });
  return { id: value.id, mode: value.mode, count: value.count, issuedAt: value.issuedAt, revealed: value.revealed, results };
}
function cleanReceipt(value) {
  if (!plain(value) || typeof value.kind !== 'string' || !['learning', 'match', 'open', 'reveal', 'close', 'redeem', 'equip'].includes(value.kind)) fail('INVALID_REWARD_STATE');
  const out = { kind: value.kind };
  if (value.rewardDay !== undefined) { if (!validDay(value.rewardDay)) fail('INVALID_REWARD_STATE'); out.rewardDay = value.rewardDay; }
  if (value.completed !== undefined) {
    if (!Array.isArray(value.completed) || !unique(value.completed) || value.completed.some(x => !TASKS.includes(x))) fail('INVALID_REWARD_STATE');
    out.completed = [...value.completed];
  }
  for (const key of ['skinTicketsAwarded', 'officialDustAwarded']) if (value[key] !== undefined) {
    if (!int(value[key], 0, key === 'skinTicketsAwarded' ? 3 : 5)) fail('INVALID_REWARD_STATE'); out[key] = value[key];
  }
  for (const key of ['qualified', 'pending', 'alreadyOwned']) if (value[key] !== undefined) {
    if (typeof value[key] !== 'boolean') fail('INVALID_REWARD_STATE'); out[key] = value[key];
  }
  if (value.skinId !== undefined) { if (!SKINS.has(value.skinId) && value.skinId !== DEFAULT_HERO_SKIN) fail('INVALID_REWARD_STATE'); out.skinId = value.skinId; }
  if (value.mode !== undefined) { if (!['base', ...MODES].includes(value.mode)) fail('INVALID_REWARD_STATE'); out.mode = value.mode; }
  if (value.batch !== undefined) out.batch = cleanBatch(value.batch);
  return out;
}
function cleanHistory(values, limit) {
  if (!Array.isArray(values) || values.length > limit || !unique(values.map(v => v?.id))) fail('INVALID_REWARD_STATE');
  return values.map(value => {
    if (!plain(value) || !validId(value.id) || !int(value.issuedAt, 0, 4102444800000) || typeof value.signature !== 'string' || value.signature.length > 2048) fail('INVALID_REWARD_STATE');
    return { id: value.id, issuedAt: value.issuedAt, signature: value.signature, receipt: cleanReceipt(value.receipt) };
  });
}
/** Undefined is the only migration input that creates a new journey. Corrupt,
 * null, foreign-owner or unknown-version data must never regenerate gifts. */
export function normalizeJourney(input, { ownerId } = {}) {
  if (input === undefined) return freshJourney({ ownerId });
  if (!plain(input) || input.version !== 1 || input.timeZone !== REWARD_TIME_ZONE || !validId(input.ownerId) ||
      ownerId !== undefined && input.ownerId !== ownerId || !int(input.revision) || typeof input.newcomerGranted !== 'boolean' ||
      !amount(input.skinTickets) || !plain(input.days) || Object.keys(input.days).length > REWARD_JOURNEY_LIMITS.days ||
      input.retiredThroughDay !== null && !validDay(input.retiredThroughDay)) fail('INVALID_REWARD_STATE');
  const out = freshJourney({ ownerId: input.ownerId });
  for (const key of ['revision', 'newcomerGranted', 'skinTickets', 'retiredThroughDay']) out[key] = input[key];
  for (const [day, value] of Object.entries(input.days)) {
    if (!validDay(day) || out.retiredThroughDay !== null && day <= out.retiredThroughDay || !plain(value) ||
        !Array.isArray(value.qids) || value.qids.length > 6 || !unique(value.qids) || value.qids.some(q => !validId(q)) ||
        !plain(value.units) || Object.keys(value.units).length > REWARD_JOURNEY_LIMITS.units || typeof value.qualifiedMatch !== 'boolean' ||
        !Array.isArray(value.claimed) || !unique(value.claimed) || value.claimed.some(t => !TASKS.slice(0, 3).includes(t))) fail('INVALID_REWARD_STATE');
    const units = {};
    for (const [unit, qids] of Object.entries(value.units)) {
      if (!validId(unit) || !Array.isArray(qids) || qids.length < 1 || qids.length > 2 || !unique(qids) || qids.some(q => !validId(q))) fail('INVALID_REWARD_STATE');
      units[unit] = [...qids];
    }
    const completed = [value.qids.length >= 3, value.qids.length >= 6, value.qualifiedMatch || Object.values(units).some(q => q.length >= 2)];
    if (completed.some((done, i) => value.claimed.includes(TASKS[i]) !== done) || completed[0] && !out.newcomerGranted) fail('INVALID_REWARD_STATE');
    out.days[day] = { qids: [...value.qids], units, qualifiedMatch: value.qualifiedMatch, claimed: [...value.claimed] };
  }
  for (const mode of MODES) {
    const wallet = input[mode];
    if (!plain(wallet) || !Array.isArray(wallet.owned) || wallet.owned.length > 20 || !unique(wallet.owned) || wallet.owned.some(s => !SKINS.has(s)) ||
        !int(wallet.repeatStreak, 0, 4) || wallet.owned.length === 20 && wallet.repeatStreak !== 0 || wallet.owned.length === 0 && wallet.repeatStreak !== 0) fail('INVALID_REWARD_STATE');
    out[mode] = { owned: [...wallet.owned], repeatStreak: wallet.repeatStreak };
    if (mode === 'test') { if (!amount(wallet.dust)) fail('INVALID_REWARD_STATE'); out.test.dust = wallet.dust; }
  }
  const equipped = input.equipped;
  if (!plain(equipped) || !['base', ...MODES].includes(equipped.mode) ||
      (equipped.mode === 'base' ? equipped.skinId !== DEFAULT_HERO_SKIN : !out[equipped.mode].owned.includes(equipped.skinId))) fail('INVALID_REWARD_STATE');
  out.equipped = { mode: equipped.mode, skinId: equipped.skinId };
  if (!plain(input.openings) || !Array.isArray(input.recent) || input.recent.length > REWARD_JOURNEY_LIMITS.recent) fail('INVALID_REWARD_STATE');
  for (const mode of MODES) {
    const batch = input.openings[mode]; out.openings[mode] = batch === null ? null : cleanBatch(batch);
    if (out.openings[mode] && out.openings[mode].mode !== mode) fail('INVALID_REWARD_STATE');
  }
  out.recent = input.recent.map(cleanBatch);
  if (out.recent.some(b => b.revealed !== (1 << b.count) - 1)) fail('INVALID_REWARD_STATE');
  const known = [...out.recent, ...Object.values(out.openings).filter(Boolean)];
  if (!unique(known.map(b => b.id)) || known.some(b => b.results.some(r => !out[b.mode].owned.includes(r.skinId)))) fail('INVALID_REWARD_STATE');
  out.events = cleanHistory(input.events, REWARD_JOURNEY_LIMITS.events);
  out.operations = cleanHistory(input.operations, REWARD_JOURNEY_LIMITS.operations);
  for (const key of ['eventCutoff', 'operationCutoff']) {
    if (!int(input[key], -1, 4102444800000)) fail('INVALID_REWARD_STATE'); out[key] = input[key];
  }
  return out;
}

function start(input, request, kind, payload, options = {}, events = false) {
  const state = normalizeJourney(input), id = requireId(events ? request.eventId : request.operationId);
  if (requireId(request.ownerId) !== state.ownerId) fail('REWARD_OWNER_MISMATCH');
  const issuedAt = timestamp(request.issuedAt), history = events ? 'events' : 'operations';
  const signature = JSON.stringify({ kind, ...payload });
  const prior = state[history].find(item => item.id === id);
  // Open operation fingerprints exclude fresh RNG, server retry time and UI
  // revision. Stable intent must replay even after an animation or day change.
  if (prior) {
    if (prior.signature !== signature) fail('REWARD_EVENT_CONFLICT');
    return { replay: { state, changed: false, replayed: true, officialDustDelta: 0, receipt: clone(prior.receipt) } };
  }
  // A pending pack survives indefinitely, even when unrelated operations have
  // rotated its recent receipt out of memory. Never charge or roll it again.
  if (kind === 'open') {
    const batch = [...Object.values(state.openings).filter(Boolean), ...state.recent].find(value => value.id === id);
    if (batch) {
      if (batch.mode !== payload.mode || batch.count !== payload.count) fail('REWARD_EVENT_CONFLICT');
      return { replay: { state, changed: false, replayed: true, officialDustDelta: 0, receipt: { kind: 'open', batch: { ...clone(batch), revealed: 0 } } } };
    }
  }
  if (issuedAt <= state[events ? 'eventCutoff' : 'operationCutoff']) fail('REWARD_HISTORY_EXPIRED');
  if (options.expectedRevision !== undefined && options.expectedRevision !== state.revision) fail('REWARD_REVISION_CONFLICT');
  return { state, id, issuedAt, history, signature };
}
function finish(context, receipt, officialDustDelta = 0) {
  const { state, history, id, signature, issuedAt } = context;
  if (!int(officialDustDelta, -100, 200)) fail('INVALID_REWARD_DELTA');
  if (!int(state.revision + 1)) fail('REWARD_REVISION_EXHAUSTED');
  state[history].push({ id, signature, issuedAt, receipt: clone(receipt) });
  const limit = REWARD_JOURNEY_LIMITS[history], cutoff = history === 'events' ? 'eventCutoff' : 'operationCutoff';
  while (state[history].length > limit) state[cutoff] = Math.max(state[cutoff], state[history].shift().issuedAt);
  state.revision++;
  return { state, changed: true, replayed: false, officialDustDelta, receipt };
}
function dayFor(state, issuedAt) {
  const day = rewardDay(issuedAt);
  if (state.retiredThroughDay !== null && day <= state.retiredThroughDay) fail('REWARD_DAY_EXPIRED');
  if (!state.days[day]) state.days[day] = emptyDay();
  const keys = Object.keys(state.days).sort();
  while (keys.length > REWARD_JOURNEY_LIMITS.days) { const oldest = keys.shift(); delete state.days[oldest]; state.retiredThroughDay = oldest; }
  if (!state.days[day]) fail('REWARD_DAY_EXPIRED');
  return { day, entry: state.days[day] };
}
function grantDaily(state, day, entry, kind, qualified) {
  const eligible = [entry.qids.length >= 3, entry.qids.length >= 6, entry.qualifiedMatch || Object.values(entry.units).some(q => q.length >= 2)];
  const completed = [], receipt = { kind, rewardDay: day, qualified, completed, skinTicketsAwarded: 0, officialDustAwarded: 0 };
  eligible.forEach((done, index) => {
    if (!done || entry.claimed.includes(TASKS[index])) return;
    entry.claimed.push(TASKS[index]); completed.push(TASKS[index]);
    if (index === 0) receipt.officialDustAwarded += 5; else receipt.skinTicketsAwarded++;
  });
  if (eligible[0] && !state.newcomerGranted) { state.newcomerGranted = true; completed.push('newcomer'); receipt.skinTicketsAwarded++; }
  if (!amount(state.skinTickets + receipt.skinTicketsAwarded)) fail('REWARD_BALANCE_LIMIT');
  state.skinTickets += receipt.skinTicketsAwarded;
  return receipt;
}
/** Verified participation only: server has checked question/player ownership,
 * expiry and visible reading timing. Correctness is deliberately irrelevant. */
export function applyQualifiedLearning(input, event, options = {}) {
  if (!plain(event) || !['study', 'match'].includes(event.source)) fail('INVALID_QUALIFIED_LEARNING');
  const qid = requireId(event.qid), unitId = requireId(event.unitId);
  const issuedAt = timestamp(event.issuedAt), answeredAt = timestamp(event.answeredAt), qualifiedAt = timestamp(event.qualifiedAt);
  // A fast answer is allowed: server can verify the remaining reading before
  // participation, without forcing the learner to answer the question again.
  if (answeredAt < issuedAt || qualifiedAt < answeredAt + 1200 || qualifiedAt < issuedAt + 3200) fail('INVALID_QUALIFIED_LEARNING');
  const payload = { qid, unitId, source: event.source, issuedAt, answeredAt, qualifiedAt };
  const context = start(input, event, 'learning', payload, options, true); if (context.replay) return context.replay;
  const { state } = context, { day, entry } = dayFor(state, issuedAt);
  if (entry.qids.length < 6 && !entry.qids.includes(qid)) entry.qids.push(qid);
  if (event.source === 'study' && !entry.claimed.includes('daily_apply')) {
    if (!entry.units[unitId]) {
      if (Object.keys(entry.units).length >= REWARD_JOURNEY_LIMITS.units) fail('REWARD_UNIT_LIMIT');
      entry.units[unitId] = [];
    }
    if (!entry.units[unitId].includes(qid) && entry.units[unitId].length < 2) entry.units[unitId].push(qid);
  }
  const receipt = grantDaily(state, day, entry, 'learning', true);
  return finish(context, receipt, receipt.officialDustAwarded);
}
export function applyQualifiedMatch(input, event, options = {}) {
  if (!plain(event) || !['pve', 'pvp'].includes(event.mode) || !['normal', 'surrender', 'quit', 'expired'].includes(event.termination) ||
      !int(event.ownTurns, 0, 100000) || !int(event.ownActions, 0, 100000)) fail('INVALID_QUALIFIED_MATCH');
  const matchId = requireId(event.matchId), issuedAt = timestamp(event.issuedAt), finishedAt = timestamp(event.finishedAt);
  if (finishedAt < issuedAt) fail('INVALID_QUALIFIED_MATCH');
  const payload = { matchId, mode: event.mode, termination: event.termination, ownTurns: event.ownTurns, ownActions: event.ownActions, issuedAt, finishedAt };
  const context = start(input, event, 'match', payload, options, true); if (context.replay) return context.replay;
  const { state } = context, { day, entry } = dayFor(state, issuedAt);
  const qualified = event.termination === 'normal' && event.ownTurns >= 2 && event.ownActions >= 3;
  if (qualified) entry.qualifiedMatch = true;
  const receipt = grantDaily(state, day, entry, 'match', qualified);
  return finish(context, receipt, receipt.officialDustAwarded);
}

export function dailySummary(input, serverNow) {
  const state = normalizeJourney(input), period = rewardPeriod(serverNow), entry = state.days[period.rewardDay] ?? emptyDay();
  const sameUnit = Math.max(0, ...Object.values(entry.units).map(q => q.length));
  const tasks = [
    { id: 'daily_warmup', label: '学3个知识点', progress: Math.min(3, entry.qids.length), target: 3, reward: '5正式叶屑' },
    { id: 'daily_practice', label: '今天学6个知识点', progress: entry.qids.length, target: 6, reward: '1造型券' },
    { id: 'daily_apply', label: '巩固一个单元，或完成一场对局', progress: entry.qualifiedMatch ? 2 : sameUnit, target: 2, reward: '1造型券' },
  ].map(task => ({ ...task, complete: entry.claimed.includes(task.id), status: entry.claimed.includes(task.id) ? '已收好' : '进行中' }));
  return { ...period, tasks, allComplete: tasks.every(t => t.complete), message: tasks.every(t => t.complete) ? '今天的礼物已收好，随时可以休息' : '答错也能推进任务，按自己的节奏来',
    skinTickets: state.skinTickets, newcomerGranted: state.newcomerGranted,
    official: { ownedCount: state.official.owned.length, guaranteeAvailable: state.official.owned.length < 20, repeatStreak: state.official.repeatStreak },
    test: { label: '体验区：无限试抽，与正式奖励分开', unlimitedTickets: true, unlimitedRedemptions: true, ownedCount: state.test.owned.length, dust: state.test.dust } };
}

export function openSkinPack(input, request, options = {}) {
  if (!plain(request) || ![1, 10].includes(request.count)) fail('INVALID_SKIN_PACK');
  const mode = modeOf(request.mode), count = request.count;
  const context = start(input, request, 'open', { mode, count }, options); if (context.replay) return context.replay;
  const { state } = context;
  if (state.openings[mode]) fail('SKIN_PACK_PENDING');
  if (mode === 'official' && state.skinTickets < count) fail('INSUFFICIENT_SKIN_TICKETS');
  if (!Array.isArray(options.randomValues) || options.randomValues.length !== count || options.randomValues.some(v => !Number.isFinite(v) || v < 0 || v >= 1)) fail('INVALID_SKIN_RANDOM');
  const wallet = state[mode], results = []; let dust = 0;
  for (const random of options.randomValues) {
    const unowned = IDS.filter(s => !wallet.owned.includes(s));
    const guaranteed = unowned.length > 0 && wallet.repeatStreak >= SKIN_RULES.repeatGuarantee;
    const pool = guaranteed ? unowned : IDS, skinId = pool[Math.floor(random * pool.length)];
    const duplicate = wallet.owned.includes(skinId), reward = duplicate ? SKIN_RULES.duplicateDust : 0;
    if (!duplicate) wallet.owned.push(skinId);
    wallet.repeatStreak = wallet.owned.length === 20 || !duplicate ? 0 : Math.min(4, wallet.repeatStreak + 1);
    dust += reward; results.push({ skinId, duplicate, guaranteed, dust: reward });
  }
  if (mode === 'official') state.skinTickets -= count;
  else { if (!amount(state.test.dust + dust)) fail('REWARD_BALANCE_LIMIT'); state.test.dust += dust; }
  const batch = { id: context.id, mode, count, issuedAt: context.issuedAt, revealed: 0, results };
  state.openings[mode] = batch;
  return finish(context, { kind: 'open', batch: clone(batch) }, mode === 'official' ? dust : 0);
}
export function revealSkinPack(input, request, options = {}) {
  const mode = modeOf(request.mode), batchId = requireId(request.batchId), index = request.index;
  if (index !== 'all' && !int(index, 0, 9)) fail('INVALID_SKIN_REVEAL');
  const context = start(input, request, 'reveal', { mode, batchId, index }, options); if (context.replay) return context.replay;
  const batch = context.state.openings[mode];
  if (!batch || batch.id !== batchId) fail('SKIN_PACK_NOT_FOUND');
  if (index !== 'all' && index >= batch.count) fail('INVALID_SKIN_REVEAL');
  batch.revealed |= index === 'all' ? (1 << batch.count) - 1 : 1 << index;
  return finish(context, { kind: 'reveal', batch: clone(batch) });
}
/** Dismissing early leaves the already-paid results and mask pending. Closing
 * after all reveals archives the batch. Neither operation changes ownership. */
export function closeSkinPack(input, request, options = {}) {
  const mode = modeOf(request.mode), batchId = requireId(request.batchId);
  const context = start(input, request, 'close', { mode, batchId }, options); if (context.replay) return context.replay;
  const batch = context.state.openings[mode];
  if (!batch || batch.id !== batchId) fail('SKIN_PACK_NOT_FOUND');
  const pending = batch.revealed !== (1 << batch.count) - 1;
  if (!pending) { context.state.recent.push(clone(batch)); context.state.recent = context.state.recent.slice(-REWARD_JOURNEY_LIMITS.recent); context.state.openings[mode] = null; }
  return finish(context, { kind: 'close', batch: clone(batch), pending });
}
export function redeemSkin(input, request, options = {}) {
  const mode = modeOf(request.mode), skinId = request.skinId;
  if (!SKINS.has(skinId)) fail('INVALID_SKIN_ID');
  const context = start(input, request, 'redeem', { mode, skinId }, options); if (context.replay) return context.replay;
  const wallet = context.state[mode];
  if (wallet.owned.includes(skinId)) return finish(context, { kind: 'redeem', mode, skinId, alreadyOwned: true });
  if (mode === 'official' && (!amount(options.officialDustBalance) || options.officialDustBalance < SKIN_RULES.redeemDust)) fail('INSUFFICIENT_OFFICIAL_DUST');
  wallet.owned.push(skinId);
  // Redemption is not a draw and cannot erase the declared draw guarantee.
  if (wallet.owned.length === 20) wallet.repeatStreak = 0;
  return finish(context, { kind: 'redeem', mode, skinId, alreadyOwned: false }, mode === 'official' ? -SKIN_RULES.redeemDust : 0);
}
export function equipSkin(input, request, options = {}) {
  const skinId = request.skinId, mode = skinId === DEFAULT_HERO_SKIN ? 'base' : modeOf(request.mode);
  if (skinId !== DEFAULT_HERO_SKIN && !SKINS.has(skinId)) fail('INVALID_SKIN_ID');
  const context = start(input, request, 'equip', { mode, skinId }, options); if (context.replay) return context.replay;
  if (mode !== 'base' && !context.state[mode].owned.includes(skinId)) fail('SKIN_NOT_OWNED');
  context.state.equipped = { mode, skinId };
  return finish(context, { kind: 'equip', mode, skinId });
}
