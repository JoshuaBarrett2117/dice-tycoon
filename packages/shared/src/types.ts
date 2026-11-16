import type { CharId } from './characters';

export type Phase = 'roll' | 'choose' | 'ended';
export type WinReason = 'triple' | 'line' | 'tour' | 'bankrupt' | 'assets';

export interface PlayerState {
  seat: number;
  id: string;
  name: string;
  charId: CharId;
  isBot: boolean;
  cash: number;
  pos: number;
  /** >0 表示在无人岛上，剩余停留回合 */
  islandTurns: number;
  /** 本回合已连续掷出双数次数 */
  doubles: number;
  bankrupt: boolean;
  /** 下回合可从环球航班起飞 */
  flyNext: boolean;
  /** 免过路费护盾（机会卡） */
  shield: boolean;
}

export interface TileState {
  owner: number | null;
  /** 0 空地 / 1 别墅 / 2 公寓 / 3 酒店 / 4 地标（观光地恒为 0） */
  lv: number;
}

export type PendingKind = 'buy' | 'upgrade' | 'takeover' | 'festival' | 'fly';

export interface PendingOption {
  /** buy/upgrade：目标等级；takeover：1；festival/fly：目标格子 */
  value: number;
  cost: number;
  label: string;
}

export interface Pending {
  kind: PendingKind;
  seat: number;
  tile: number | null;
  options: PendingOption[];
  /** 选择后是否还要继续掷骰（双数） */
  again: boolean;
}

export interface GameState {
  version: 1;
  seed: number;
  rng: number;
  /** 每次合法操作 +1，客户端据此丢弃过期快照 */
  seq: number;
  seats: PlayerState[];
  tiles: TileState[];
  turn: number;
  round: number;
  maxRounds: number;
  phase: Phase;
  pending: Pending | null;
  festivalTile: number | null;
  winner: number | null;
  winReason: WinReason | null;
}

export type Action =
  | { type: 'roll'; zone: number }
  /** option = pending.options 下标；-1 表示放弃 */
  | { type: 'choose'; option: number };

export type CardId = 'bonus' | 'fine' | 'toStart' | 'island' | 'freeUpgrade' | 'shield';

/** 引擎输出的事件流：客户端按顺序播放动画，服务端原样广播 */
export type GameEvent =
  | { t: 'turn'; seat: number; round: number }
  | { t: 'roll'; seat: number; zone: number; dice: [number, number]; hit: boolean }
  | { t: 'move'; seat: number; path: number[]; via: 'walk' | 'fly' | 'warp' }
  | { t: 'salary'; seat: number; amount: number }
  | { t: 'doubles'; seat: number; count: number }
  | { t: 'island'; seat: number; turns: number }
  | { t: 'islandStay'; seat: number; left: number }
  | { t: 'islandEscape'; seat: number }
  | { t: 'pay'; from: number; to: number | null; amount: number; tile: number | null; reason: 'toll' | 'tax' | 'fine' | 'takeover' }
  | { t: 'shieldUsed'; seat: number; tile: number }
  | { t: 'buy'; seat: number; tile: number; lv: number; cost: number }
  | { t: 'upgrade'; seat: number; tile: number; from: number; lv: number; cost: number }
  | { t: 'takeover'; seat: number; from: number; tile: number; cost: number }
  | { t: 'sell'; seat: number; tile: number; amount: number }
  | { t: 'bankrupt'; seat: number }
  | { t: 'card'; seat: number; card: CardId; text: string }
  | { t: 'bonus'; seat: number; amount: number }
  | { t: 'festival'; seat: number; tile: number }
  | { t: 'airport'; seat: number }
  | { t: 'prompt'; pending: Pending }
  | { t: 'decline'; seat: number; kind: string }
  | { t: 'end'; winner: number; reason: WinReason };

export interface ApplyOk { ok: true; state: GameState; events: GameEvent[] }
export interface ApplyErr { ok: false; error: string }
export type ApplyResult = ApplyOk | ApplyErr;

export interface SeatConfig { id: string; name: string; charId: CharId; isBot?: boolean }
export interface GameConfig { seed: number; seats: SeatConfig[]; maxRounds?: number }
