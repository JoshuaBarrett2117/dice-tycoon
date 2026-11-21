/**
 * 回放：引擎是确定性的，「seed + 座位配置 + 操作序列」即可还原整局。
 * 对战服与单机模式都用 ReplayRecorder 记录操作，并提供「导出回放 JSON」入口。
 */
import { applyAction, createGame, openingEvents, totalAssets } from './engine';
import type { BoardId } from './config';
import type { Action, GameConfig, GameEvent, GameState, SeatConfig } from './types';

export const REPLAY_FORMAT = 'dice-tycoon-replay';

export interface GameRecord {
  format: typeof REPLAY_FORMAT;
  /** 引擎快照版本（GameState.version） */
  engineVersion: number;
  seed: number;
  maxRounds?: number;
  /** v0.7：本局启用特殊格（缺省 = 旧回放，按无特殊格重放） */
  specials?: boolean;
  /** v0.8 新道具池；缺省 false（旧回放兼容） */
  itemsV8?: boolean;
  /** v1.9 收购扩展 / 商店 / 强制收购卡；缺省 false（旧回放兼容） */
  v19?: boolean;
  /** v1.1 棋盘 id；缺省 = 经典棋盘（旧回放按经典重放） */
  board?: BoardId;
  /** 座位配置（含可选的 accountId 透传字段，引擎不校验） */
  seats: SeatConfig[];
  /** 按发生顺序的全部合法操作（含机器人与托管） */
  actions: { seat: number; action: Action }[];
  /** 导出时的最终状态摘要，便于快速比对 */
  result?: RecordResult;
}

/** 单个座位的终局战绩（v0.3 起写入回放摘要；排位分本期只记胜负，不做排行榜） */
export interface RankEntry { seat: number; name: string; accountId?: string; assets: number; bankrupt: boolean; won: boolean; rank: number }
export interface RecordResult {
  seq: number; round: number; phase: string; winner: number | null; winReason: string | null;
  /** 对局已结束时给出：胜者排第一，其余按总资产降序（v0.3 新增，旧文件可能没有） */
  ranking?: RankEntry[];
}

/** 终局战绩：胜者第一，其余未破产者按总资产降序，破产者垫底 */
export function rankSeats(state: GameState): RankEntry[] {
  const rows = state.seats.map((p, seat) => ({
    seat, name: p.name, ...(p.accountId ? { accountId: p.accountId } : {}),
    assets: totalAssets(state, seat), bankrupt: p.bankrupt, won: state.winner === seat,
  }));
  rows.sort((a, b) => Number(b.won) - Number(a.won) || Number(a.bankrupt) - Number(b.bankrupt) || b.assets - a.assets || a.seat - b.seat);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
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
      ...(this.cfg.specials ? { specials: true } : {}),
      ...(this.cfg.itemsV8 ? { itemsV8: true } : {}),
      ...(this.cfg.v19 ? { v19: true } : {}),
      ...(this.cfg.board && this.cfg.board !== 'classic' ? { board: this.cfg.board } : {}),
      seats: structuredClone(this.cfg.seats), actions: structuredClone(this.actions),
    };
    if (state) {
      rec.result = { seq: state.seq, round: state.round, phase: state.phase, winner: state.winner, winReason: state.winReason };
      if (state.phase === 'ended') rec.result.ranking = rankSeats(state);
    }
    return rec;
  }
}

/** 重放一份记录，返回最终状态与完整事件流；遇到非法操作抛错（说明记录被篡改或引擎不兼容） */
export function replayGame(rec: GameRecord): { state: GameState; events: GameEvent[] } {
  if (rec.format !== REPLAY_FORMAT) throw new Error('不是有效的回放文件');
  let state = createGame({ seed: rec.seed, seats: rec.seats, maxRounds: rec.maxRounds, specials: rec.specials, itemsV8: rec.itemsV8, v19: rec.v19, board: rec.board });
  const events: GameEvent[] = [...openingEvents(state)];
  rec.actions.forEach((a, i) => {
    const r = applyAction(state, a.seat, a.action);
    if (!r.ok) throw new Error(`回放第 ${i + 1} 步非法：${r.error}`);
    state = r.state;
    events.push(...r.events);
  });
  return { state, events };
}

/** 一帧：第 index 步操作之后的权威状态，以及这一步产生的事件（第 0 帧是开局，index = state.seq） */
export interface ReplayFrame { index: number; state: GameState; events: GameEvent[]; seat: number | null; action: Action | null }

/**
 * 回放播放器（纯逻辑，客户端与测试共用）：一次性把记录展开成逐步帧，
 * 支持单步前进 / 后退、跳转到任意 seq。帧的状态与 replayGame 逐步重放完全一致。
 */
export class ReplayPlayer {
  readonly frames: ReplayFrame[];
  private pos = 0;

  constructor(readonly record: GameRecord) {
    if (record?.format !== REPLAY_FORMAT) throw new Error('不是有效的回放文件');
    if (!Array.isArray(record.seats) || !Array.isArray(record.actions)) throw new Error('回放文件已损坏');
    let state = createGame({ seed: record.seed, seats: record.seats, maxRounds: record.maxRounds, specials: record.specials, itemsV8: record.itemsV8, v19: record.v19, board: record.board });
    this.frames = [{ index: 0, state, events: [...openingEvents(state)], seat: null, action: null }];
    record.actions.forEach((a, i) => {
      const r = applyAction(state, a.seat, a.action);
      if (!r.ok) throw new Error(`回放第 ${i + 1} 步非法：${r.error}`);
      state = r.state;
      this.frames.push({ index: i + 1, state, events: r.events, seat: a.seat, action: a.action });
    });
  }

  /** 总步数（操作数）；帧下标范围 0..total */
  get total() { return this.frames.length - 1; }
  get index() { return this.pos; }
  get frame() { return this.frames[this.pos]; }
  get atEnd() { return this.pos >= this.total; }
  get atStart() { return this.pos <= 0; }

  /** 单步前进，返回新帧；已到末尾返回 null */
  next(): ReplayFrame | null { return this.atEnd ? null : this.frames[++this.pos]; }
  /** 单步后退，返回新帧；已在开头返回 null */
  prev(): ReplayFrame | null { return this.atStart ? null : this.frames[--this.pos]; }
  /** 跳转到指定 seq（越界时夹到 0..total），返回该帧 */
  seek(seq: number): ReplayFrame {
    this.pos = Math.max(0, Math.min(this.total, Math.floor(Number.isFinite(seq) ? seq : 0)));
    return this.frames[this.pos];
  }
}
