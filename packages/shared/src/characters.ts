/** 角色：基础控骰 + 被动技能修正（提案数值） */
export type CharId = 'jin' | 'li' | 'wang' | 'xing' | 'panda';

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
  skill: string;
}

export const CHARACTERS: Record<CharId, CharacterDef> = {
  jin: { id: 'jin', name: '金多多', color: '#e8352a', control: 0.45, buildDiscount: 0.08, takeoverDiscount: 0, tollBonus: 0, skill: '财大气粗：建设费 -8%' },
  li: { id: 'li', name: '小狸', color: '#2a7fe8', control: 0.4, buildDiscount: 0, takeoverDiscount: 0.1, tollBonus: 0, skill: '精明砍价：收购价 -10%' },
  wang: { id: 'wang', name: '铁算盘老王', color: '#16a34a', control: 0.35, buildDiscount: 0, takeoverDiscount: 0, tollBonus: 0.1, skill: '精打细算：收取过路费 +10%' },
  xing: { id: 'xing', name: '赛博阿星', color: '#9333ea', control: 0.65, buildDiscount: 0, takeoverDiscount: 0, tollBonus: 0, skill: '数据预判：控骰命中率高' },
  panda: { id: 'panda', name: '熊猫工头', color: '#f59e0b', control: 0.4, buildDiscount: 0.15, takeoverDiscount: 0, tollBonus: 0, skill: '包工头：建设费 -15%' },
};

export const CHAR_IDS = Object.keys(CHARACTERS) as CharId[];
