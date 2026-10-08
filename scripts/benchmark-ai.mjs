// Repeatable CPU benchmark with synthetic full boards, not a browser FPS test.
import { createMatch, chooseAI, rng } from "../src/engine.mjs";
import { CARDS, RULES } from "../src/cards.mjs";
const random = rng("PERF"),
  count = Math.max(1, Math.min(1000, Number(process.argv[2]) || 30));
const units = CARDS.filter((c) => c.type !== "spell"),
  rows = [];
for (let k = 0; k < count; k++) {
  const s = createMatch({ seed: "PERF-" + k });
  s.active = 1;
  s.seq = 100;
  s.turn = 12;
  for (let side = 0; side < 2; side++) {
    const p = s.players[side];
    p.hp = 4 + Math.floor(random() * 15);
    p.armor = 0;
    p.mana = p.maxMana = 6;
    p.hand = Array.from(
      { length: 6 },
      () => CARDS[Math.floor(random() * 12)].id,
    );
    p.board = Array.from({ length: 4 }, (_, i) => {
      const c = units[Math.floor(random() * units.length)];
      return {
        uid: "u" + (1 + side * 4 + i),
        cardId: c.id,
        atk: c.atk,
        hp: c.hp,
        maxHp: c.hp,
        ready: true,
      };
    });
  }
  const start = performance.now(),
    action = chooseAI(s, ["aggro", "control", "value"][k % 3]);
  rows.push({ case: k, ms: performance.now() - start, action });
}
const times = rows.map((r) => r.ms).sort((a, b) => a - b),
  at = (q) => times[Math.min(count - 1, Math.floor(count * q))];
console.log(
  JSON.stringify(
    {
      rules: RULES,
      cases: count,
      environment: "Node on the current machine; not browser or device FPS",
      p50: at(0.5),
      p90: at(0.9),
      p99: at(0.99),
      max: times.at(-1),
      rows,
    },
    null,
    2,
  ),
);
