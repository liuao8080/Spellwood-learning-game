import { CARD, CARDS } from "./cards.mjs";
export const ELEMENT_LABELS = Object.freeze({
  fire: "火焰",
  water: "流水",
  nature: "森林",
  arcane: "星光",
});
// Numbers and primary rules come from the same card records as combat.
const NEW_GUIDES = {
  deathArmor: (c) => ({
    name: "退场护甲",
    tip: "只有生命降至0而退场才触发一次；回手不触发，护甲也不能让已倒下的英雄复活。",
    example: `让${c.name}与2攻击伙伴交换而退场，你的英雄获得${c.amount}护甲。`,
  }),
  mend: (c) => ({
    name: "伙伴治疗",
    tip: "只能选另一个仍在场且受伤的友方伙伴；治疗不会增加最大生命，也不能复活。",
    example: `友方古树熊剩2/6生命，召唤${c.name}并选中它，恢复后是${2 + c.amount}/6生命。`,
  }),
  weaken: (c) => ({
    name: "削弱",
    tip: "只降低所选敌方伙伴的攻击，最低0；不改变费用或生命，效果直到它离场。",
    example: `将敌方烛火幼龙的5攻击减为${5 - c.amount}；它回手后重新召唤会恢复基础5攻击。`,
  }),
  grantShield: (c) => ({
    name: "授予护盾",
    tip: "只能选另一个没有护盾的友方伙伴，不能叠盾；0伤害不会消耗护盾。",
    example: `召唤${c.name}保护青苔幼灵，下次它受到5点伤害时护盾挡住全部5点，随后消失。`,
  }),
  heroHitDraw: (c) => ({
    name: "命中抽牌",
    tip: "只消耗英雄护甲不抽牌；每本人回合至多一次。手满会爆牌，空牌库会受疲劳伤害，甚至输掉对局。",
    example: `${c.atk}攻击打向1护甲的敌方英雄，先扣1护甲、再扣${c.atk - 1}生命，然后抽${c.amount}张；打向${c.atk}护甲则不抽。`,
  }),
  companyArmor: (c) => ({
    name: "伙伴护甲",
    tip: "只数召唤时已经在场的其他友方伙伴，不数自己；没有其他伙伴也能召唤。",
    example: `你已有3位伙伴时召唤${c.name}，英雄获得${Math.min(3, c.limit) * c.amount}护甲，场上刚好4位。`,
  }),
  unitCharge: (c) => ({
    name: "冲角",
    tip: "加成并入同一次伤害，护盾可以全部挡住；对英雄和作为防守方还击时没有加成。",
    example: `主动攻击5生命的伙伴造成${c.atk + c.amount}伤害，并承受正常还击；攻击英雄或还击仍造成${c.atk}伤害。`,
  }),
  arrivalDamage: (c) => ({
    name: "登场伤害",
    tip: "只选敌方伙伴，可以越过守卫；登场伤害不会被反击，有护盾时整次伤害被挡住。",
    example: `召唤${c.name}并选择没有护盾的芦苇蛙，${c.amount}伤害使它退场；不能选择敌方英雄。`,
  }),
  sweep: (c) => ({
    name: "范围伤害",
    tip: "敌方所有伙伴同时受伤或破盾，再统一处理死亡与退场效果；不伤害任一英雄和友方伙伴。",
    example: `对面有1生命的月光兔和带盾海獭：各受${c.amount}伤害，兔子退场、海獭仅失去护盾。`,
  }),
  rain: (c) => ({
    name: "群体治疗",
    tip: "只治疗仍活着的友方伙伴，不增加最大生命、不治疗英雄、不复活；至少有一位受伤伙伴才能使用。",
    example: `友方伙伴分别剩1/3和4/5生命，使用后变为${Math.min(3, 1 + c.amount)}/3和${Math.min(5, 4 + c.amount)}/5。`,
  }),
  recall: (c) => ({
    name: "回手",
    tip: "先消耗法术再把伙伴送回手牌，因此7张满手也能用。不会触发退场；清除伤害、增减攻、最大生命提升、护盾、准备与临时强化，重召仍要付费。",
    example: `将已被强化且受伤的蘑菇医师送回手牌，重新支付${CARD.mushroom_medic.cost}能量召唤时恢复${CARD.mushroom_medic.atk}/${CARD.mushroom_medic.hp}基础数值，并可再次治疗。`,
  }),
  blessing: (c) => ({
    name: "生命祝福",
    tip: "可以选择满生命的友方伙伴；先提高最大生命，再治疗。不改变攻击、护盾或准备状态，离场后提升消失。",
    example: `友方风羽翠鸟剩1/2生命，最大生命+${c.amount}并恢复${c.amount}生命后变成${1 + c.amount}/${2 + c.amount}。`,
  }),
};
export const KEYWORDS = Object.freeze({
  rush: {
    name: "迅捷",
    rule: "这位伙伴登场的当回合就可以攻击一次。",
    tip: "用来立即处理危险伙伴，或抓住获胜机会。",
  },
  guard: {
    name: "守卫",
    rule: "只要守卫还在，对手的普通攻击必须先选择守卫；伤害法术仍可选择其他敌人。",
    tip: "让它挡在前面，保护生命或需要成长的伙伴。",
  },
  grow: {
    name: "成长",
    rule: "每次轮到你的回合，这位伙伴的攻击增加1。",
    tip: "越早登场并被保护，后面就越有力量。",
  },
  draw: {
    name: "登场抽牌",
    rule: "召唤时立即抽1张牌，抽到的牌仍需要能量才能使用。",
    tip: "手牌上限7张，超出的新牌会消失。空牌库继续抽牌，英雄会依次受到1、2、3……点疲劳伤害。",
  },
  armor: {
    name: "护甲",
    rule: "召唤时立即给你的英雄2点护甲。之后伤害先消耗护甲，再扣生命。",
    tip: "即使生命已满，也能提前做好防护。",
  },
  heal: {
    name: "登场治疗",
    rule: "召唤时立即为你的英雄恢复3生命，最多恢复到18。",
    tip: "生命已满也可以召唤这位伙伴，只是不会恢复更多生命。",
  },
  barrier: {
    name: "护盾",
    rule: "登场时自带护盾，挡住下一次正伤害的全部伤害，随后护盾消失；0伤害不会消耗护盾。",
    tip: "护盾只保护这位伙伴，不会替英雄或其他伙伴挡攻击。",
  },
  rally: {
    name: "鼓舞",
    rule: "召唤时立即让其他已经在场的友方伙伴攻击各增加1；不会强化自己。",
    tip: "不会强化之后召唤的伙伴，也不会让已经攻击过的伙伴再次攻击。",
  },
  damage: {
    name: "伤害法术",
    rule: "选中卡牌后，点击亮起的敌方伙伴或英雄。法术可以越过守卫。",
    tip: "法术不会被反击；目标有护盾时，护盾会挡住这一次伤害。",
  },
  restore: {
    name: "治疗法术",
    rule: "恢复你的英雄生命，最多到18；生命已满时不能使用。",
    tip: "受伤后使用。先看看场面，别把全部能量都用于恢复。",
  },
  insight: {
    name: "抽牌法术",
    rule: "先用掉这张法术，再从牌库抽牌。手牌上限7张，超出的新牌会消失。",
    tip: "空牌库继续抽牌，英雄会依次受到1、2、3……点疲劳伤害；抽2张会连续触发2次。",
  },
  ...Object.fromEntries(
    CARDS.filter((c) => NEW_GUIDES[c.keyword]).map((c) => [
      c.keyword,
      { ...NEW_GUIDES[c.keyword](c), rule: c.text },
    ]),
  ),
});
const cases = {
  sprout: "第1回合召唤它，下一回合就能攻击。生命比攻击高，适合站稳场面。",
  rabbit: "对面有1生命的危险伙伴时，登场后立刻攻击它；也要留意对方的反击。",
  fox: "手中只有狐狸时，召唤后抽1张新牌，手里还有1张。",
  sprite: "让守卫挡在前面，等它成长后再出击。",
  turtle: "你的英雄快受伤时，先召唤守卫挡住普通攻击。",
  owl: "英雄满血也能获得护甲，抵挡之后的伤害。",
  stag: "英雄15生命时召唤，恢复到18并留下伙伴。",
  dragon: "有5点能量时，它能登场后马上攻击一个目标。",
  golem: "用较高生命守住阵地，再安排后排伙伴。",
  spark: "对面有3生命且没有护盾的伙伴时，3点伤害可以将它击退。",
  bloom: "英雄12生命时使用，恢复到17。",
  moon: "手里有这张法术和另外1张牌时，使用后再抽2张，手里共有3张。",
  hedgehog: "第1回合就能挡住对手的普通攻击，为下一张牌争取时间。",
  otter: "用护盾抵挡一次伤害，护盾破后仍要留意剩余生命。",
  firefly: "花1点能量获得小伙伴，同时抽1张新牌。",
  wolf: "对方有4生命、没有护盾且能选中的伙伴时，登场就能击退它；自己也可能被反击退场。",
  crane: "英雄受伤时召唤水鸟，同时获得治疗与场面。",
  boar: "你已经有两位伙伴时召唤，让它们的攻击各增加1。",
  bear: "用它保护正在成长的幼灵或独角兽。",
  unicorn: "先让它登场成长，再用守卫保护它。",
  phoenix: "留到能量充足时登场，立即发动强力攻击。",
  frost: "用较高伤害击退大伙伴，避免下一回合承受太多攻击。",
  dew: "英雄15生命时使用，恢复到18。",
  lantern: "想多一个选择又希望保留能量时，用它抽1张牌。",
};
export function cardGuide(id) {
  const c = CARD[id];
  if (!c) return null;
  const k = KEYWORDS[c.keyword];
  const spell = c.type === "spell";
  const target = {
    "friendly-wounded-unit": "选择另一个受伤且仍活着的友方伙伴。",
    "friendly-unshielded-unit": "选择另一个没有护盾且仍活着的友方伙伴。",
    "enemy-unit": "选择一个仍活着的敌方伙伴，不能指定英雄；可以越过守卫。",
    "friendly-unit": "选择一个仍活着的友方伙伴，不能指定敌方伙伴或任一英雄。",
    "all-enemy-units": "影响所有敌方伙伴，不需逐个选择；无敌方伙伴不可使用。",
    "all-friendly-wounded-units":
      "影响所有友方伙伴，不需逐个选择；没有受伤伙伴不可使用。",
  }[c.target];
  return {
    name: c.name,
    en: c.en,
    cost: c.cost,
    atk: spell ? null : c.atk,
    hp: spell ? null : c.hp,
    type: spell ? "法术" : "伙伴",
    element: ELEMENT_LABELS[c.element] || "森林",
    keyword: k?.name || "普通伙伴",
    effect: c.text,
    timing: spell
      ? "在你的回合使用，支付能量后这张牌离开手牌。"
      : c.keyword === "rush"
        ? "登场当回合可以攻击；每回合只能攻击一次。"
        : "登场后等到你的下一个回合，每回合可攻击一次。",
    target: target
      ? target +
        (!spell
          ? "有合法目标时必须明确选择；无合法目标仍可召唤。需要一个空位，最多4位伙伴。"
          : "")
      : spell
        ? c.keyword === "damage"
          ? "选择一个敌方伙伴或英雄，可以越过守卫。"
          : c.keyword === "restore"
            ? "恢复自己的英雄，不需要另选目标；满生命时不可使用。"
            : "从自己的牌库抽牌，不需要另选目标。"
        : "选牌后点召唤，需要一个空位；最多放4位伙伴。",
    exchange: spell
      ? null
      : "伙伴之间同时造成伤害，生命降到0便离场。" +
        (c.keyword === "unitCharge"
          ? `主动攻击伙伴时，造成攻击值+${c.amount}的伤害，同时承受对方攻击值的还击；还击与攻击英雄不加成。`
          : "双方各造成自己的攻击值伤害。") +
        "攻击英雄不会被反击；有守卫时须先攻击守卫。",
    rule: k?.rule || "用简单可靠的伙伴建立场面，再与其他卡牌配合。",
    tip:
      c.keyword === "insight" && (c.amount || 2) === 1
        ? "空牌库继续抽牌，英雄会依次受到1、2、3……点疲劳伤害。"
        : k?.tip || "先观察双方攻击与生命，再决定要交换伙伴还是攻击英雄。",
    example:
      k?.example || cases[id] || "先观察能量、伙伴位置和双方生命，再决定出牌。",
  };
}
