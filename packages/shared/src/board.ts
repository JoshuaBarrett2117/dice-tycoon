import { BOARD_CFGS, BOARD_DEFAULT, type BoardId } from './config';
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

export const GROUP_PRICE = BOARD_CFGS.classic.groupPrice;
export const TOUR_PRICE = BOARD_CFGS.classic.tourPrice;

export const GROUP_COLOR: Record<GroupId | 'tour' | 'card' | 'tax', string> = {
  g1: '#ff9a2e', g2: '#ff5fa2', g3: '#34c759', g4: '#14b8c9',
  g5: '#3b82f6', g6: '#8b5cf6', g7: '#ef4444', g8: '#e5a800',
  tour: '#0ea5e9', card: '#a855f7', tax: '#64748b',
};

export interface BoardDef {
  id: BoardId; name: string; desc: string;
  tiles: readonly TileDef[];
  groups: Record<GroupId, number[]>;
  tours: number[];
  /** 每条边上可购买的格子（城市 + 观光地），用于「整排独占」 */
  sides: number[][];
  specials: Record<number, { kind: 'teleport' | 'bonus'; name: string; to?: number; amount?: number; desc: string }>;
}

function build(id: BoardId): BoardDef {
  const cfg = BOARD_CFGS[id];
  const tiles: TileDef[] = cfg.raw.map(([name, k, corner], index) => {
    const side = index % 8 === 0 ? 0 : Math.floor(index / 8) + 1;
    if (k === 'corner') return { index, name, kind: 'corner', corner: corner as CornerId, price: 0, side };
    if (k === 'card' || k === 'tax') return { index, name, kind: k, price: 0, side };
    if (k === 'tour') return { index, name, kind: 'tour', price: cfg.tourPrice, side };
    return { index, name, kind: 'city', group: k as GroupId, price: cfg.groupPrice[k as GroupId], side };
  });
  if (tiles.length !== 32) throw new Error(`棋盘 ${id} 必须 32 格`);
  const groups = Object.fromEntries(
    (Object.keys(cfg.groupPrice) as GroupId[]).map((g) => [g, tiles.filter((t) => t.group === g).map((t) => t.index)]),
  ) as Record<GroupId, number[]>;
  return {
    id, name: cfg.name, desc: cfg.desc, tiles, groups,
    tours: tiles.filter((t) => t.kind === 'tour').map((t) => t.index),
    sides: [1, 2, 3, 4].map((s) => tiles.filter((t) => t.side === s && (t.kind === 'city' || t.kind === 'tour')).map((t) => t.index)),
    specials: cfg.specials,
  };
}

export const BOARDS = Object.fromEntries((Object.keys(BOARD_CFGS) as BoardId[]).map((id) => [id, build(id)])) as Record<BoardId, BoardDef>;

/** 当前对局所用棋盘（state.board 缺省 = 经典棋盘，旧快照 / 旧回放兼容） */
export const boardOf = (s: { board?: BoardId } | undefined | null): BoardDef => BOARDS[(s && s.board && BOARDS[s.board] ? s.board : BOARD_DEFAULT)];

/** 经典棋盘的便捷导出（向后兼容） */
export const BOARD: readonly TileDef[] = BOARDS.classic.tiles;
export const BOARD_SIZE = BOARD.length;
export const ISLAND_INDEX = 8;
export const START_INDEX = 0;
export const GROUPS = BOARDS.classic.groups;
export const TOURS = BOARDS.classic.tours;
export const SIDES = BOARDS.classic.sides;
export const isOwnable = (i: number, d: readonly TileDef[] = BOARD) => d[i].kind === 'city' || d[i].kind === 'tour';
