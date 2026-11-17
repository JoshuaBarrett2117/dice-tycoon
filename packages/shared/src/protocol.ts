/**
 * 客户端 ⇄ 对战服消息协议（JSON）。
 * 服务端权威：客户端只发「意图」，服务端校验后广播新快照 + 事件流。
 */
import type { CharId } from './characters';
import type { BoardId } from './config';
import type { Action, GameEvent, GameState } from './types';
import type { GameRecord } from './replay';

export const ROOM_NAME = 'match';

/** accountId 为预留字段：对战服只携带、不校验（本期无登录体系） */
export interface JoinOptions {
  name: string; charId: CharId; accountId?: string;
  /** 以观战者身份加入进行中的房间：不占座位、不参与行动，只收 sync / replay */
  spectate?: boolean;
  /** 快速匹配：用 joinOrCreate 进入匹配房，凑满 4 人或超时由机器人补位后自动开局 */
  quick?: boolean;
  /** v1.1：创建房间时房主选定的棋盘；缺省经典 */
  board?: BoardId;
}

export interface LobbySeat { sessionId: string | null; name: string; charId: CharId; isBot: boolean; ready: boolean; connected: boolean }

/** 快速匹配房的排队状态：remainingMs 为距离「超时补位开局」的剩余毫秒（用相对值，避免客户端时钟偏差） */
export interface QuickStatus { waiting: number; size: number; remainingMs: number }

/** GET /api/rooms 返回的房间概览（观战列表用） */
export interface RoomBrief {
  roomId: string;
  started: boolean;
  /** 已开局且观战席未满 */
  spectatable: boolean;
  players: string[];
  bots: number;
  round: number | null;
  board?: BoardId;
  spectators: number;
  maxSpectators: number;
}

/** 服务端 → 客户端 */
export interface ServerMessages {
  /** 房间等待阶段的座位信息 */
  lobby: { seats: LobbySeat[]; hostSessionId: string | null; roomId: string; started: boolean; quick?: QuickStatus; /** v1.1 当前棋盘 */ board?: BoardId };
  /** 观战人数变化（房间内所有人都会收到） */
  spectators: { count: number; max: number };
  /** 你在对局中的座位号 */
  seat: { seat: number };
  /** 权威快照 + 自上一快照以来的事件 */
  sync: { state: GameState; events: GameEvent[]; deadline: number | null };
  error: { message: string };
  /** 回放导出结果（响应 exportReplay） */
  replay: GameRecord;
}

/** 客户端 → 服务端 */
export interface ClientMessages {
  start: Record<string, never>;
  action: Action;
  /** v1.1：房主在开局前切换棋盘 */
  setBoard: { board: BoardId };
  /** 请求导出本局回放 JSON（对局开始后可用） */
  exportReplay: Record<string, never>;
}

/** 回合操作时限（毫秒），超时由服务端托管 */
export const TURN_TIMEOUT_MS = { roll: 15000, choose: 10000 } as const;
