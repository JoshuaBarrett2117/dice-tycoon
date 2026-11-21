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
  /** 岩盾「固若金汤」：向现金最多的对手收取的保护费（万，提案值） */
  rockSkillFee: 5,

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

  // ── v1.9（提案值）──
  /** 收购他人已抵押的格子：收购价 = 常规收购价 × 此折扣（抵押状态与赎回责任一并转给买家；卖家已拿过抵押款，收购价全额归卖家） */
  mortgagedTakeoverMult: 0.7,
  /** 道具补给 / 过起点发牌时，抽到强制收购卡的概率（其余按 10 种常规道具均匀抽取）；开局发牌不会出强制收购卡 */
  forceBuyChance: 0.01,
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

/** v0.8 之前的 7 种旧抽取池（旧回放按此重放） */
export const LEGACY_ITEM_IDS = ['dice', 'roadblock', 'shield', 'doubleToll', 'demolish', 'freeBuild', 'teleport'] as const;
export const V8_ITEM_IDS = [...LEGACY_ITEM_IDS, 'swap', 'taxFree', 'freeze'] as const;
export const ITEM_IDS = [...V8_ITEM_IDS, 'forceBuy'] as const;
export const ITEMS: Record<(typeof ITEM_IDS)[number], { name: string; desc: string }> = {
  forceBuy: { name: '强制收购卡', desc: '指定一处对手的城市 / 观光地（含地标、抵押格）直接收归己有，建筑等级与抵押状态保留；卡即对价，不另付钱' },
  dice: { name: '遥控骰子', desc: '本次掷骰指定总点数 2–12' },
  roadblock: { name: '路障卡', desc: '在前方 8 格内放置路障，其他玩家经过时被拦停' },
  shield: { name: '护盾卡', desc: '下次过路费全免' },
  doubleToll: { name: '双倍收租卡', desc: '至你下回合开始前，收取的过路费 ×2' },
  demolish: { name: '强拆卡', desc: '指定对手一处城市建筑降 1 级（地标/观光地除外）' },
  freeBuild: { name: '免费建造卡', desc: '自己一处城市免费升 1 级（lv<3）' },
  teleport: { name: '传送卡', desc: '立即飞往任意一格并结算落地' },
  swap: { name: '换位卡', desc: '与指定一名玩家交换位置，你在新位置结算落地（不领月薪）' },
  taxFree: { name: '免税卡', desc: '下次停在税务局时免缴税费（仅一次）' },
  freeze: { name: '冻结卡', desc: '指定一名对手：其下回合不能掷骰，整回合跳过' },
};

/** v1.9 对局商店售价（万，全部为提案值；强制收购卡 200 万由需求指定） */
export const ITEM_PRICES: Record<(typeof ITEM_IDS)[number], number> = {
  dice: 20, roadblock: 15, shield: 25, doubleToll: 30, demolish: 40, freeBuild: 45, teleport: 35, swap: 30, taxFree: 20, freeze: 35, forceBuy: 200,
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

/** 每日任务与成就（v0.6，提案值）。只读对局结果，不影响规则与经济 */
export const QUESTS = {
  /** 每天抽取的任务数 */
  dailyCount: 3,
  key: 'dt:quests:v1',
  /** 已处理对局 id 的去重窗口 */
  seenLimit: 100,
  /** 任务池：metric 为对局摘要里的字段；target 为当天累计目标 */
  pool: [
    { id: 'win1', title: '赢下 1 局', metric: 'wins', target: 1, badge: '日胜者' },
    { id: 'play3', title: '完成 3 局', metric: 'games', target: 3, badge: '勤勉玩家' },
    { id: 'buy5', title: '买下 5 处地产', metric: 'buys', target: 5, badge: '置业新秀' },
    { id: 'event1', title: '经历 1 次全局事件', metric: 'events', target: 1, badge: '见多识广' },
    { id: 'online1', title: '完成 1 局联机', metric: 'online', target: 1, badge: '江湖行走' },
    { id: 'set1', title: '凑齐 1 次色组独占', metric: 'sets', target: 1, badge: '色组猎手' },
  ],
  /** 成就：metric 为终身累计（peak 类取最大值） */
  achievements: [
    { id: 'firstWin', title: '首胜', desc: '赢下第 1 局', metric: 'wins', target: 1, badge: '🏆 初出茅庐' },
    { id: 'win10', title: '十胜', desc: '累计赢下 10 局', metric: 'wins', target: 10, badge: '🥇 常胜将军' },
    { id: 'set1', title: '色组独占', desc: '在一局中凑齐一整个色组', metric: 'sets', target: 1, badge: '🎨 色组大亨' },
    { id: 'assets1000', title: '资产破千', desc: '单局总资产达到 1000 万', metric: 'peakAssets', target: 1000, badge: '💰 千万富翁' },
    { id: 'play20', title: '身经百战', desc: '累计完成 20 局', metric: 'games', target: 20, badge: '🎲 老玩家' },
    { id: 'online5', title: '联机达人', desc: '累计完成 5 局联机', metric: 'online', target: 5, badge: '🌐 联机达人' },
  ],
} as const;

/**
 * 特殊格（v0.7，提案值）。叠加在「机会」格之上（位置沿用原机会格，不改 32 格布局与地产）。
 * 仅 GameState.specials 为 true 的对局生效；旧回放（无此标记）按原规则重放，保持一致。
 */
export const SPECIAL_TILES: Record<number, { kind: 'teleport' | 'bonus'; name: string; to?: number; amount?: number; desc: string }> = {
  11: { kind: 'teleport', name: '传送门', to: 20, desc: '停留时传送到圣托里尼（不领月薪，并结算落地）' },
  28: { kind: 'bonus', name: '奖金格', amount: 25, desc: '停留时领取奖金 ¥25 万' },
};

/** 棋盘主题（v0.7，仅表现层，不改任何规则数值；本地存储，联机各自表现） */
export const THEMES = {
  classic: { name: '经典', bgTint: 0xffffff, base: [0xfdf6e7, 0xc9a97a, 0xb8956a, 0xe8d6b4], inner: 0xf3e6c8, innerLine: 0xe2cfa6, tileTop: 0xfffaf0, logo: 0xbe965a, label: 0x3c3c5a, subText: 0x8a90a8 },
  neon: { name: '霓虹夜市', bgTint: 0x4a3f8f, base: [0x1a1740, 0x0e0c2a, 0x0a0820, 0x3a2f7a], inner: 0x15123a, innerLine: 0xff3fa4, tileTop: 0x241f55, logo: 0x2ee6ff, label: 0xff8ad8, subText: 0xb9b4ff },
} as const;
export type ThemeId = keyof typeof THEMES;
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const THEME_DEFAULT: ThemeId = 'classic';
export const THEME_KEY = 'dt:theme:v1';

/**
 * 棋盘配置（v1.1）：布局、地价、特殊格位置与数值全部在此（标注「提案值」，可调）。
 * 均为 32 格；角格固定 0 起点 / 8 无人岛 / 16 环球节庆 / 24 环球航班。
 * 特殊格叠加在「机会」格之上，复用 resolveTile 的 case 'card' 逻辑，不另写结算。
 */
export type BoardId = 'classic' | 'island';
export const BOARD_DEFAULT: BoardId = 'classic';
export const BOARD_KEY = 'dt:board:v1';
type SpecialDef = { kind: 'teleport' | 'bonus'; name: string; to?: number; amount?: number; desc: string };
export interface BoardCfg {
  name: string;
  desc: string;
  /** 色组地价（万）与观光地地价（万）——提案值 */
  groupPrice: Record<'g1' | 'g2' | 'g3' | 'g4' | 'g5' | 'g6' | 'g7' | 'g8', number>;
  tourPrice: number;
  /** [名称, 类型或色组, 角格id?]，共 32 项 */
  raw: [string, string, string?][];
  specials: Record<number, SpecialDef>;
}
export const BOARD_CFGS: Record<BoardId, BoardCfg> = {
  classic: {
    name: '环球之旅', desc: '经典 32 格环球城市',
    groupPrice: { g1: 10, g2: 14, g3: 18, g4: 22, g5: 26, g6: 30, g7: 34, g8: 40 }, tourPrice: 20,
    raw: [
      ['起点', 'corner', 'start'], ['曼谷', 'g1'], ['机会', 'card'], ['吉隆坡', 'g1'], ['新加坡', 'g1'], ['桂林', 'tour'], ['西安', 'g2'], ['成都', 'g2'],
      ['无人岛', 'corner', 'island'], ['东京', 'g3'], ['大阪', 'g3'], ['机会', 'card'], ['富士山', 'tour'], ['悉尼', 'g4'], ['墨尔本', 'g4'], ['奥克兰', 'g4'],
      ['环球节庆', 'corner', 'festival'], ['开罗', 'g5'], ['机会', 'card'], ['伊斯坦布尔', 'g5'], ['圣托里尼', 'tour'], ['罗马', 'g6'], ['巴黎', 'g6'], ['伦敦', 'g6'],
      ['环球航班', 'corner', 'airport'], ['纽约', 'g7'], ['大峡谷', 'tour'], ['旧金山', 'g7'], ['机会', 'card'], ['税务局', 'tax'], ['上海', 'g8'], ['香港', 'g8'],
    ],
    specials: SPECIAL_TILES,
  },
  island: {
    name: '海岛度假', desc: '阳光沙滩 32 格：地价略高，传送门在 10 号、奖金格在 26 号（提案值）',
    groupPrice: { g1: 12, g2: 15, g3: 19, g4: 23, g5: 27, g6: 31, g7: 36, g8: 42 }, tourPrice: 22,
    raw: [
      ['起点', 'corner', 'start'], ['巴厘岛', 'g1'], ['龙目岛', 'g1'], ['机会', 'card'], ['普吉岛', 'g1'], ['长滩岛', 'tour'], ['马尔代夫', 'g2'], ['斐济', 'g2'],
      ['无人岛', 'corner', 'island'], ['夏威夷', 'g3'], ['机会', 'card'], ['毛伊岛', 'g3'], ['塔希提', 'tour'], ['波拉波拉', 'g4'], ['帕劳', 'g4'], ['关岛', 'g4'],
      ['环球节庆', 'corner', 'festival'], ['冲绳', 'g5'], ['济州岛', 'g5'], ['机会', 'card'], ['圣淘沙', 'tour'], ['马略卡', 'g6'], ['圣托里尼岛', 'g6'], ['巴哈马', 'g6'],
      ['环球航班', 'corner', 'airport'], ['塞舌尔', 'g7'], ['机会', 'card'], ['加勒比', 'g7'], ['苏梅岛', 'tour'], ['税务局', 'tax'], ['开曼群岛', 'g8'], ['百慕大', 'g8'],
    ],
    specials: {
      10: { kind: 'teleport', name: '传送门', to: 21, desc: '停留时传送到马略卡（不领月薪，并结算落地）' },
      26: { kind: 'bonus', name: '奖金格', amount: 30, desc: '停留时领取奖金 ¥30 万' },
    },
  },
};
export const BOARD_IDS = Object.keys(BOARD_CFGS) as BoardId[];
