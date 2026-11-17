/**
 * 数值配置（全部为提案值，上线前由数值策划在表格中维护后导出覆盖）。
 * 金额单位：万。
 */
export const RULES = {
  startCash: 250,
  salary: 30,
  maxRounds: 20,
  /** 建筑等级 0=空地 1=别墅 2=公寓 3=酒店 4=地标；每级建设费 = 地价 × 系数 */
  buildCostMult: [0, 0.5, 1.0, 1.5, 2.0],
  /** 过路费 = 地价 × 系数（按当前等级） */
  tollMult: [0.4, 1.2, 2.6, 4.5, 7.0],
  /** 观光地过路费 = 基数 × 2^(持有数-1) */
  tourTollBase: 10,
  /** 收购价 = 已投入总价 × 倍数 */
  takeoverMult: 2,
  /** 破产清算时变卖地产的回收比例 */
  sellRatio: 0.5,
  /** 节庆城市过路费倍数 */
  festivalMult: 2,
  /** 税务局：现金比例 */
  taxRate: 0.1,
  /** 无人岛最多停留回合 */
  islandTurns: 3,
  /** 控骰命中率上限 */
  controlCap: 0.75,
  /** 连续双数次数达到此值进无人岛 */
  doublesToIsland: 3,
  /** 三区独占需要的完整色组数 */
  tripleGroups: 3,
  /** 手牌上限 */
  itemMax: 3,
  /** 开局发牌数 */
  itemStart: 1,
  /** 路障可放置的距离（自己前方 1..N 格） */
  roadblockRange: 8,
  /** 双倍收租卡倍率 */
  doubleTollMult: 2,
  /** 主动技能冷却（自己的回合数） */
  skillCooldown: 5,
  /** 金多多「点石成金」：总资产比例与上限（万） */
  jinSkillRate: 0.05,
  jinSkillCap: 30,
  /** 小狸「闪电收购」收购价倍率 */
  liSkillTakeover: 0.5,
  /** 老王「金算盘」过路费倍率（与双倍收租相乘） */
  wangSkillToll: 1.5,
  /** 熊猫「突击施工」无可升城市时的现金补偿（万） */
  pandaSkillCash: 10,

  // ── v0.2 阶段 2：全局事件 / 色组加成 / 机会卡（均为提案值）──
  /** 每隔几回合在回合开始时抽一次全局事件（第 N、2N… 回合第一位玩家的回合开始） */
  globalEventEvery: 3,
  /** 集齐同一色组全部城市后，该组城市过路费倍率 */
  groupSetTollMult: 1.5,
  /** 生日派对：其他每名未破产玩家各付你（万） */
  birthdayGift: 5,
  /** 前进 / 后退卡的步数 */
  cardMoveSteps: 3,
  /** 道具补给卡在手牌已满时改发的现金（万） */
  itemSupplyCash: 10,
  /** 税务返还：现金比例与上限（万） */
  refundRate: 0.1,
  refundCap: 20,
  /** 双倍月薪卡：下一次经过起点的月薪倍率 */
  doubleSalaryMult: 2,

  // ── v0.2 阶段 4：竞拍与抵押（提案值）──
  /** 竞拍起拍价 = 地价 × 此比例（四舍五入） */
  auctionStartRatio: 0.5,
  /** 最小加价（万） */
  auctionMinRaise: 5,
  /** 竞拍出价选项：在「最低报价」之上额外加价的档位（万），0 即最低报价 */
  auctionBidSteps: [0, 10, 30],
  /** 抵押得款 = 已投入总价 × 此比例（与 sellRatio 同口径） */
  mortgageRatio: 0.5,
  /** 赎回价 = 抵押得款 × 此倍数 */
  redeemMult: 1.1,
} as const;

/**
 * 全局经济事件（每 RULES.globalEventEvery 回合抽一次，持续 1 回合，全员生效）。
 * 倍率统一在 engine.globalMods 中读取，禁止在别处散落判断。
 * 叠加顺序：先单格/色组/持有者倍率，后全局倍率，最后一次性取整。
 */
export const GLOBAL_EVENT_IDS = ['none', 'tourBoom', 'propertyBoom', 'subsidy', 'recession'] as const;
export type GlobalEventId = (typeof GLOBAL_EVENT_IDS)[number];
export interface GlobalEventDef {
  name: string; desc: string; weight: number;
  /** 观光地过路费倍率 */ tourToll: number;
  /** 所有过路费倍率 */ toll: number;
  /** 建设费倍率 */ build: number;
  /** 月薪倍率 */ salary: number;
}
export const GLOBAL_EVENTS: Record<GlobalEventId, GlobalEventDef> = {
  none: { name: '风平浪静', desc: '本回合没有全局事件', weight: 4, tourToll: 1, toll: 1, build: 1, salary: 1 },
  tourBoom: { name: '旅游旺季', desc: '观光地过路费 ×2', weight: 1, tourToll: 2, toll: 1, build: 1, salary: 1 },
  propertyBoom: { name: '地产热潮', desc: '所有过路费 +30%', weight: 1, tourToll: 1, toll: 1.3, build: 1, salary: 1 },
  subsidy: { name: '建设补贴', desc: '建设费 -30%', weight: 1, tourToll: 1, toll: 1, build: 0.7, salary: 1 },
  recession: { name: '经济萧条', desc: '月薪与过路费 -30%', weight: 1, tourToll: 1, toll: 0.7, build: 1, salary: 0.7 },
};

/** 蓄力区间：力度条上的四档，宽度用于客户端绘制（总和 100） */
export interface DiceZone { lo: number; hi: number; width: number; color: string }
export const ZONES: readonly DiceZone[] = [
  { lo: 2, hi: 4, width: 22, color: '#45d0ff' },
  { lo: 5, hi: 7, width: 30, color: '#7cff6b' },
  { lo: 8, hi: 10, width: 30, color: '#ffd23f' },
  { lo: 11, hi: 12, width: 18, color: '#ff8a4c' },
];

/** 由力度（0–100）得到区间序号 */
export function zoneOfPower(power: number): number {
  let acc = 0;
  for (let i = 0; i < ZONES.length; i++) {
    acc += ZONES[i].width;
    if (power <= acc) return i;
  }
  return ZONES.length - 1;
}

export function zoneOfSum(sum: number): number {
  return ZONES.findIndex((z) => sum >= z.lo && sum <= z.hi);
}

export const ITEM_IDS = ['dice', 'roadblock', 'shield', 'doubleToll', 'demolish', 'freeBuild', 'teleport'] as const;
export const ITEMS: Record<(typeof ITEM_IDS)[number], { name: string; desc: string }> = {
  dice: { name: '遥控骰子', desc: '本次掷骰指定总点数 2–12' },
  roadblock: { name: '路障卡', desc: '在前方 8 格内放置路障，其他玩家经过时被拦停' },
  shield: { name: '护盾卡', desc: '下次过路费全免' },
  doubleToll: { name: '双倍收租卡', desc: '至你下回合开始前，收取的过路费 ×2' },
  demolish: { name: '强拆卡', desc: '指定对手一处城市建筑降 1 级（地标/观光地除外）' },
  freeBuild: { name: '免费建造卡', desc: '自己一处城市免费升 1 级（lv<3）' },
  teleport: { name: '传送卡', desc: '立即飞往任意一格并结算落地' },
};

// ── v0.3：观战 / 快速匹配 / 回放播放器（均为提案值）──
/** 观战：每个房间最多同时容纳的观战者数（不占座位、不计入 actorOf） */
export const SPECTATE = {
  maxSpectators: 8,
} as const;

/** 快速匹配：凑满 matchSize 人立即开局；等候超过 timeoutMs 后用机器人补位开局 */
export const MATCH = {
  matchSize: 4,
  /** 从队首玩家入队起算的等候上限（毫秒） */
  timeoutMs: 20000,
  /** 超时补位开局所需的最少真人数 */
  minHumans: 1,
} as const;

/** 回放播放器：可选倍速与基础步间停顿 */
export const REPLAY_PLAYER = {
  speeds: [0.5, 1, 2, 4],
  /** 一步演出结束后到下一步开始前的停顿（毫秒，1 倍速下） */
  gapMs: 300,
} as const;

/** 本地档案与对局历史（v0.4，提案值） */
export const PROFILE = {
  /** 历史最多保留条数，超出时丢弃最旧的 */
  historyLimit: 50,
  nameMax: 12,
  keys: { profile: 'dt:profile:v1', history: 'dt:history:v1', replayPrefix: 'dt:replay:v1:' },
} as const;

/** 机器人难度分级（v0.5，数值均为提案值）。normal 与 v0.4 之前的唯一策略完全一致 */
export const BOT_LEVELS = {
  easy:   { noise: 0.3, itemUse: 0.25, group: 0, toll: 0.4, reserveFrac: 0.08, reserveMin: 20, auctionBase: 0.7, auctionGroup: 0, mortgageAt: 0.5, redeemMin: 400, skillUse: 0.4 },
  normal: { noise: 0,   itemUse: 1,    group: 1, toll: 1,   reserveFrac: 0.25, reserveMin: 40, auctionBase: 0.9, auctionGroup: 0.35, mortgageAt: 1, redeemMin: 150, skillUse: 1 },
  hard:   { noise: 0,   itemUse: 1,    group: 2, toll: 1.6, reserveFrac: 0.15, reserveMin: 60, auctionBase: 1.0, auctionGroup: 0.6, mortgageAt: 1.4, redeemMin: 100, skillUse: 1 },
} as const;
export const BOT_DEFAULT_DIFFICULTY = 'normal' as const;
