/**
 * 回放：引擎是确定性的，「seed + 座位配置 + 操作序列」即可还原整局。
 * 对战服与单机模式都用 ReplayRecorder 记录操作，并提供「导出回放 JSON」入口。
 */
import { applyAction, createGame, openingEvents } from './engine';
import type { Action, GameConfig, GameEvent, GameState, SeatConfig } from './types';

export const REPLAY_FORMAT = 'dice-tycoon-replay';

export interface GameRecord {
  format: typeof REPLAY_FORMAT;
  /** 引擎快照版本（GameState.version） */
  engineVersion: number;
  seed: number;
  maxRounds?: number;
  /** 座位配置（含可选的 accountId 透传字段，引擎不校验） */
  seats: SeatConfig[];
  /** 按发生顺序的全部合法操作（含机器人与托管） */
  actions: { seat: number; action: Action }[];
  /** 导出时的最终状态摘要，便于快速比对 */
  result?: { seq: number; round: number; phase: string; winner: number | null; winReason: string | null };
}

/** 记录器：对局开始时用同一份 GameConfig 构造，之后每个被引擎接受的操作调用 push */
export class ReplayRecorder {
  private actions: GameRecord['actions'] = [];
  constructor(private cfg: GameConfig) {}
  push(seat: number, action: Action) { this.actions.push({ seat, action: structuredClone(action) }); }
  /** 导出（传入当前状态则附带结果摘要） */
  toRecord(state?: GameState): GameRecord {
    const rec: GameRecord = {
      format: REPLAY_FORMAT, engineVersion: 2, seed: this.cfg.seed >>> 0, maxRounds: this.cfg.maxRounds,
      seats: structuredClone(this.cfg.seats), actions: structuredClone(this.actions),
    };
    if (state) rec.result = { seq: state.seq, round: state.round, phase: state.phase, winner: state.winner, winReason: state.winReason };
    return rec;
  }
}

/** 重放一份记录，返回最终状态与完整事件流；遇到非法操作抛错（说明记录被篡改或引擎不兼容） */
export function replayGame(rec: GameRecord): { state: GameState; events: GameEvent[] } {
  if (rec.format !== REPLAY_FORMAT) throw new Error('不是有效的回放文件');
  let state = createGame({ seed: rec.seed, seats: rec.seats, maxRounds: rec.maxRounds });
  const events: GameEvent[] = [...openingEvents(state)];
  rec.actions.forEach((a, i) => {
    const r = applyAction(state, a.seat, a.action);
    if (!r.ok) throw new Error(`回放第 ${i + 1} 步非法：${r.error}`);
    state = r.state;
    events.push(...r.events);
  });
  return { state, events };
}
