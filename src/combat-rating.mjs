// Local computer-opponent performance only. This is not a human ladder or a
// calibrated population Elo. English mastery and answer accuracy never enter it.
export const COMBAT_MODES = Object.freeze(["easy", "standard", "adaptive"]);
export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({
    level: "easy",
    name: "轻松",
    opponentRating: 700,
    deckPolicy: "foundation",
    ritualLimit: 2,
    ritualStartRound: 3,
    ritualInterval: 2,
    description: "基础套牌 · 简单单步决策 · 第3轮起隔轮使用仪式，最多2次",
  }),
  standard: Object.freeze({
    level: "standard",
    name: "标准",
    opponentRating: 950,
    deckPolicy: "full",
    ritualLimit: 3,
    ritualStartRound: 2,
    ritualInterval: 2,
    description: "完整套牌 · 单步择优 · 第2轮起隔轮使用仪式，最多3次",
  }),
  tactical: Object.freeze({
    level: "tactical",
    name: "进阶",
    opponentRating: 1200,
    deckPolicy: "full",
    ritualLimit: 4,
    ritualStartRound: 1,
    ritualInterval: 1,
    description: "完整套牌 · 多步进攻与防守 · 最多4次仪式",
  }),
});
export function freshCombatRating() {
  return {
    version: 1,
    rating: 700,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    lossStreak: 0,
    lastResultId: null,
  };
}
const int = (x, a, b) => Number.isSafeInteger(x) && x >= a && x <= b;
export function normalizeCombatRating(value) {
  const fresh = freshCombatRating();
  if (
    !value ||
    typeof value !== "object" ||
    value.version !== 1 ||
    !int(value.rating, 400, 1600) ||
    !int(value.games, 0, 1000000) ||
    ![value.wins, value.losses, value.draws].every((n) =>
      int(n, 0, value.games),
    ) ||
    value.wins + value.losses + value.draws !== value.games ||
    !int(value.lossStreak, 0, value.losses) ||
    (value.lastResultId !== null &&
      (typeof value.lastResultId !== "string" ||
        value.lastResultId.length > 128))
  )
    return fresh;
  return Object.fromEntries(Object.keys(fresh).map((key) => [key, value[key]]));
}
// Only named presets are accepted. A caller cannot smuggle arbitrary card
// modifiers or ritual limits into a match. The returned plan is a fresh value.
/** @param {any} value */
export function normalizeDifficulty(value = "tactical") {
  const level = typeof value === "string" ? value : value?.level;
  const preset = Object.hasOwn(DIFFICULTIES, level)
    ? DIFFICULTIES[level]
    : DIFFICULTIES.tactical;
  return {
    ...preset,
    mode: [...COMBAT_MODES, "fixed"].includes(value?.mode)
      ? value.mode
      : preset.level === "tactical"
        ? "fixed"
        : preset.level,
    provisional: value?.provisional === true,
    tutorial: preset.level === "easy" && value?.tutorial === true,
  };
}
export function selectDifficulty(
  value = freshCombatRating(),
  mode = "adaptive",
) {
  const p = normalizeCombatRating(value);
  mode = COMBAT_MODES.includes(mode) ? mode : "adaptive";
  let level = mode === "easy" ? "easy" : "standard";
  if (mode === "adaptive") {
    // Initial placement needs at least three completed games. Every pair of
    // consecutive losses lowers the next game's tier by one, never mid-game.
    const tier = p.games < 3 ? 0 : p.rating < 800 ? 0 : p.rating < 1050 ? 1 : 2;
    level = ["easy", "standard", "tactical"][
      Math.max(0, tier - Math.floor(p.lossStreak / 2))
    ];
  }
  return normalizeDifficulty({
    level,
    mode,
    provisional: p.games < 5,
    tutorial: p.games === 0 && level === "easy",
  });
}
export function recordCombatResult(value, result) {
  const p = normalizeCombatRating(value);
  if (
    !result ||
    typeof result.id !== "string" ||
    !result.id ||
    result.id.length > 128 ||
    result.id === p.lastResultId ||
    result.mode !== "pve" ||
    result.assisted !== false ||
    !["health", "draw"].includes(result.reason) ||
    !["win", "loss", "draw"].includes(result.result) ||
    (result.reason === "draw") !== (result.result === "draw") ||
    !Object.hasOwn(DIFFICULTIES, result.computer?.level)
  )
    return p;
  const computer = DIFFICULTIES[result.computer.level];
  const actual =
    result.result === "win" ? 1 : result.result === "draw" ? 0.5 : 0;
  const expected = 1 / (1 + 10 ** ((computer.opponentRating - p.rating) / 400));
  const k = p.games < 5 ? 48 : 24;
  return {
    ...p,
    rating: Math.max(
      400,
      Math.min(1600, Math.round(p.rating + k * (actual - expected))),
    ),
    games: p.games + 1,
    wins: p.wins + Number(result.result === "win"),
    losses: p.losses + Number(result.result === "loss"),
    draws: p.draws + Number(result.result === "draw"),
    lossStreak: result.result === "loss" ? p.lossStreak + 1 : 0,
    lastResultId: result.id,
  };
}
