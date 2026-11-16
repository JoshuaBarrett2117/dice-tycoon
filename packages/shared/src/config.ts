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
} as const;

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
