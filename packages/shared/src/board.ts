/** 棋盘定义：32 格，顺时针。0 起点 / 8 无人岛 / 16 环球节庆 / 24 环球航班 */
export type TileKind = 'corner' | 'city' | 'tour' | 'card' | 'tax';
export type CornerId = 'start' | 'island' | 'festival' | 'airport';
export type GroupId = 'g1' | 'g2' | 'g3' | 'g4' | 'g5' | 'g6' | 'g7' | 'g8';

export interface TileDef {
  index: number;
  name: string;
  kind: TileKind;
  corner?: CornerId;
  group?: GroupId;
  /** 地价（万）；城市与观光地有效 */
  price: number;
  /** 所在边 1–4，角格为 0 */
  side: number;
}

export const GROUP_PRICE: Record<GroupId, number> = {
  g1: 10, g2: 14, g3: 18, g4: 22, g5: 26, g6: 30, g7: 34, g8: 40,
};
export const TOUR_PRICE = 20;

export const GROUP_COLOR: Record<GroupId | 'tour' | 'card' | 'tax', string> = {
  g1: '#ff9a2e', g2: '#ff5fa2', g3: '#34c759', g4: '#14b8c9',
  g5: '#3b82f6', g6: '#8b5cf6', g7: '#ef4444', g8: '#e5a800',
  tour: '#0ea5e9', card: '#a855f7', tax: '#64748b',
};

type Raw = [string, TileKind | GroupId, CornerId?];
const RAW: Raw[] = [
  ['起点', 'corner', 'start'], ['曼谷', 'g1'], ['机会', 'card'], ['吉隆坡', 'g1'], ['新加坡', 'g1'], ['桂林', 'tour'], ['西安', 'g2'], ['成都', 'g2'],
  ['无人岛', 'corner', 'island'], ['东京', 'g3'], ['大阪', 'g3'], ['机会', 'card'], ['富士山', 'tour'], ['悉尼', 'g4'], ['墨尔本', 'g4'], ['奥克兰', 'g4'],
  ['环球节庆', 'corner', 'festival'], ['开罗', 'g5'], ['机会', 'card'], ['伊斯坦布尔', 'g5'], ['圣托里尼', 'tour'], ['罗马', 'g6'], ['巴黎', 'g6'], ['伦敦', 'g6'],
  ['环球航班', 'corner', 'airport'], ['纽约', 'g7'], ['大峡谷', 'tour'], ['旧金山', 'g7'], ['机会', 'card'], ['税务局', 'tax'], ['上海', 'g8'], ['香港', 'g8'],
];

export const BOARD: readonly TileDef[] = RAW.map(([name, k, corner], index) => {
  const side = index % 8 === 0 ? 0 : Math.floor(index / 8) + 1;
  if (k === 'corner') return { index, name, kind: 'corner', corner, price: 0, side };
  if (k === 'card' || k === 'tax') return { index, name, kind: k, price: 0, side };
  if (k === 'tour') return { index, name, kind: 'tour', price: TOUR_PRICE, side };
  return { index, name, kind: 'city', group: k as GroupId, price: GROUP_PRICE[k as GroupId], side };
});

export const BOARD_SIZE = BOARD.length;
export const ISLAND_INDEX = 8;
export const START_INDEX = 0;

export const GROUPS: Record<GroupId, number[]> = Object.fromEntries(
  (Object.keys(GROUP_PRICE) as GroupId[]).map((g) => [g, BOARD.filter((t) => t.group === g).map((t) => t.index)]),
) as Record<GroupId, number[]>;

export const TOURS = BOARD.filter((t) => t.kind === 'tour').map((t) => t.index);

/** 每条边上可购买的格子（城市 + 观光地），用于「整排独占」 */
export const SIDES: number[][] = [1, 2, 3, 4].map((s) =>
  BOARD.filter((t) => t.side === s && (t.kind === 'city' || t.kind === 'tour')).map((t) => t.index),
);

export const isOwnable = (i: number) => BOARD[i].kind === 'city' || BOARD[i].kind === 'tour';
