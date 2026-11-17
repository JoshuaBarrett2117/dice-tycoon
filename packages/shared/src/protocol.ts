/**
 * 客户端 ⇄ 对战服消息协议（JSON）。
 * 服务端权威：客户端只发「意图」，服务端校验后广播新快照 + 事件流。
 */
import type { CharId } from './characters';
import type { Action, GameEvent, GameState } from './types';
import type { GameRecord } from './replay';

export const ROOM_NAME = 'match';

/** accountId 为预留字段：对战服只携带、不校验（本期无登录体系） */
export interface JoinOptions { name: string; charId: CharId; accountId?: string }

export interface LobbySeat { sessionId: string | null; name: string; charId: CharId; isBot: boolean; ready: boolean; connected: boolean }

/** 服务端 → 客户端 */
export interface ServerMessages {
  /** 房间等待阶段的座位信息 */
  lobby: { seats: LobbySeat[]; hostSessionId: string | null; roomId: string };
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
  /** 请求导出本局回放 JSON（对局开始后可用） */
  exportReplay: Record<string, never>;
}

/** 回合操作时限（毫秒），超时由服务端托管 */
export const TURN_TIMEOUT_MS = { roll: 15000, choose: 10000 } as const;
