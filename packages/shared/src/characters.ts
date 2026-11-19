/** 角色：基础控骰 + 被动技能修正（提案数值） */
export type CharId = 'jin' | 'li' | 'wang' | 'xing' | 'panda' | 'rock' | 'tang';

export interface CharacterDef {
  id: CharId;
  name: string;
  color: string;
  /** 基础控骰命中率 */
  control: number;
  /** 建设费折扣（0.08 = 8% off） */
  buildDiscount: number;
  /** 收购价折扣 */
  takeoverDiscount: number;
  /** 收取过路费加成 */
  tollBonus: number;
  /** 自己被收取过路费时的减免（0.1 = 少付 10%） */
  tollCut: number;
  /** 月薪加成（0.5 = +50%）；v1.7 新增，免费角色均为 0 */
  salaryBonus: number;
  skill: string;
  /** 主动技能（冷却见 RULES.skillCooldown） */
  active: { name: string; desc: string };
}

export const CHARACTERS: Record<CharId, CharacterDef> = {
  jin: { id: 'jin', name: '金多多', color: '#e8352a', control: 0.45, buildDiscount: 0.08, takeoverDiscount: 0, tollBonus: 0, tollCut: 0, salaryBonus: 0, skill: '财大气粗：建设费 -8%', active: { name: '点石成金', desc: '立即获得总资产 5% 的现金（上限 30 万）' } },
  li: { id: 'li', name: '小狸', color: '#2a7fe8', control: 0.4, buildDiscount: 0, takeoverDiscount: 0.1, tollBonus: 0, tollCut: 0, salaryBonus: 0, skill: '精明砍价：收购价 -10%', active: { name: '闪电收购', desc: '下一次收购价五折' } },
  wang: { id: 'wang', name: '铁算盘老王', color: '#16a34a', control: 0.35, buildDiscount: 0, takeoverDiscount: 0, tollBonus: 0.1, tollCut: 0, salaryBonus: 0, skill: '精打细算：收取过路费 +10%', active: { name: '金算盘', desc: '至你下回合开始前，过路费 ×1.5（可与双倍收租相乘）' } },
  xing: { id: 'xing', name: '赛博阿星', color: '#9333ea', control: 0.65, buildDiscount: 0, takeoverDiscount: 0, tollBonus: 0, tollCut: 0, salaryBonus: 0, skill: '数据预判：控骰命中率高', active: { name: '完美预判', desc: '本次掷骰必定命中所选蓄力区间' } },
  panda: { id: 'panda', name: '熊猫工头', color: '#f59e0b', control: 0.4, buildDiscount: 0.15, takeoverDiscount: 0, tollBonus: 0, tollCut: 0, salaryBonus: 0, skill: '包工头：建设费 -15%', active: { name: '突击施工', desc: '自己一处城市免费升 1 级；无可升城市时获得 10 万现金' } },
  rock: { id: 'rock', name: '岩盾阿岩', color: '#64748b', control: 0.4, buildDiscount: 0, takeoverDiscount: 0, tollBonus: 0, tollCut: 0.1, salaryBonus: 0, skill: '铜墙铁壁：被收过路费 -10%', active: { name: '固若金汤', desc: '获得护盾（下次过路费全免），并向现金最多的对手收取 5 万保护费' } },
  // v1.7 付费角色（提案值）：控骰 0.4，月薪 +50%（30→45 万），主动「锦鲤附体」复用 doubleSalary 标志
  tang: { id: 'tang', name: '锦鲤阿棠', color: '#ec4899', control: 0.4, buildDiscount: 0, takeoverDiscount: 0, tollBonus: 0, tollCut: 0, salaryBonus: 0.5, skill: '锦鲤体质：月薪 +50%', active: { name: '锦鲤附体', desc: '下次经过起点月薪翻倍（可与被动相乘，只生效一次）' } },
};

export const CHAR_IDS = Object.keys(CHARACTERS) as CharId[];

/** 付费角色（需在商城购买后方可选用；单机/未登录不可选） */
export const PAID_CHAR_IDS: CharId[] = ['tang'];
/** 免费角色（单机、未登录、机器人默认补位） */
export const FREE_CHAR_IDS = CHAR_IDS.filter((c) => !PAID_CHAR_IDS.includes(c));
