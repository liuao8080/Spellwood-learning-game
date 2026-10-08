/** Cosmetic catalogue only. Learning rewards and ownership live on the server. */
export const DEFAULT_HERO_SKIN = "forest_apprentice";
export const HERO_SKIN_VERSION = "hero-2026-10-08-v1";
const entries = [
  [
    "forest_apprentice",
    "林间学徒",
    "nature",
    "基础",
    "短斗篷、闭合小书与弯枝法杖",
    [8000, 4000, 1600],
  ],
  [
    "leaf_ranger",
    "叶冠巡林者",
    "nature",
    "自然",
    "叶尖兜帽、V形开衩披肩与橡果袋",
    [8000, 4000, 1600],
  ],
  [
    "mushroom_keeper",
    "蘑菇园丁",
    "nature",
    "自然",
    "宽圆菌帽、圆口围裙与木水壶",
    [9000, 4400, 1700],
  ],
  [
    "acorn_captain",
    "橡果队长",
    "nature",
    "自然",
    "橡帽头盔、宽壳肩与背部叶盾",
    [9000, 4500, 1800],
  ],
  [
    "butterfly_scholar",
    "蝶翼学者",
    "nature",
    "自然",
    "竖长双翼、窄腰长衣与蝶形书夹",
    [10000, 5000, 2000],
  ],
  [
    "rain_traveler",
    "雨衣旅人",
    "water",
    "水流",
    "钟形雨帽、A字雨披与合拢叶伞",
    [8500, 4200, 1700],
  ],
  [
    "coral_listener",
    "珊瑚聆听者",
    "water",
    "水流",
    "三枝珊瑚冠、波纹裙摆与贝壳杖",
    [10000, 5000, 2000],
  ],
  [
    "river_boatkeeper",
    "溪舟守望者",
    "water",
    "水流",
    "平宽草帽、环肩领与桨形杖",
    [9000, 4400, 1800],
  ],
  [
    "snow_postkeeper",
    "雪地邮差",
    "water",
    "水流",
    "双耳罩、绒边斗篷与大邮包",
    [9000, 4400, 1800],
  ],
  [
    "ember_apprentice",
    "炉火学徒",
    "fire",
    "暖火",
    "后弯尖帽、双肩垫与风箱腰具",
    [8500, 4200, 1700],
  ],
  [
    "lantern_festival",
    "花灯旅客",
    "fire",
    "暖火",
    "花瓣折帽、灯笼袖与四瓣纸灯",
    [10000, 4800, 1900],
  ],
  [
    "sun_clockmaker",
    "日晷匠人",
    "fire",
    "暖火",
    "圆齿单肩、不对称围裙与日晷杖",
    [10000, 4800, 1900],
  ],
  [
    "phoenix_courier",
    "晨凰信使",
    "fire",
    "暖火",
    "后掠羽冠、分叉羽尾与斜挂信筒",
    [10500, 5200, 2100],
  ],
  [
    "moon_librarian",
    "月馆书守",
    "arcane",
    "星月",
    "弯月高帽、直线长袍与开口月环杖",
    [9000, 4400, 1800],
  ],
  [
    "star_cartographer",
    "星图绘师",
    "arcane",
    "星月",
    "六角帽檐、横宽袖与圆规杖",
    [9000, 4400, 1800],
  ],
  [
    "cloud_pilot",
    "云间领航员",
    "arcane",
    "星月",
    "飞行耳帽、三瓣云领与收拢背翼",
    [10000, 4800, 1900],
  ],
  [
    "crystal_mason",
    "晶石塑匠",
    "arcane",
    "星月",
    "低棱头环、块面肩领与方头晶锤",
    [9500, 4600, 1800],
  ],
  [
    "paper_adventurer",
    "折纸探险家",
    "arcane",
    "奇想",
    "三角纸帽、折面短披风与肩头纸鹤",
    [8000, 3800, 1500],
  ],
  [
    "tea_alchemist",
    "茶香炼金师",
    "nature",
    "奇想",
    "圆茶壶帽、宽腰围裙与杯形法器",
    [9000, 4300, 1700],
  ],
  [
    "copper_gardener",
    "铜偶花匠",
    "nature",
    "奇想",
    "圆铜身、花盆帽与背部花架",
    [10500, 5000, 2000],
  ],
  [
    "aurora_storyteller",
    "极光说书人",
    "arcane",
    "奇想",
    "三层波纹肩、半月额饰与双飘带",
    [10500, 5200, 2100],
  ],
];
export const ALL_HERO_SKINS = Object.freeze(
  entries.map(
    ([id, name, element, themeGroup, description, [high, medium, low]]) =>
      Object.freeze({
        id,
        skinId: id,
        name,
        element,
        visualElement: element,
        themeGroup,
        description,
        modelKey: id,
        assetVersion: HERO_SKIN_VERSION,
        thumb: `/assets/heroes/${id}/thumb.webp`,
        portrait: `/assets/heroes/${id}/portrait.webp`,
        budgets: Object.freeze({ high, medium, low }),
      }),
  ),
);
export const HERO_SKINS = Object.freeze(
  ALL_HERO_SKINS.filter((s) => s.id !== DEFAULT_HERO_SKIN),
);
export const HERO_SKIN = Object.freeze(
  Object.fromEntries(ALL_HERO_SKINS.map((s) => [s.id, s])),
);
export const HERO_SKIN_IDS = Object.freeze(ALL_HERO_SKINS.map((s) => s.id));
export const REWARD_HERO_SKIN_IDS = Object.freeze(HERO_SKINS.map((s) => s.id));
export function getHeroSkin(id) {
  return typeof id === "string" && Object.hasOwn(HERO_SKIN, id)
    ? HERO_SKIN[id]
    : HERO_SKIN[DEFAULT_HERO_SKIN];
}
export const HERO_SKIN_BY_ID = HERO_SKIN;
