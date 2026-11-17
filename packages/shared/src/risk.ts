/**
 * v1.0 风控与埋点的纯逻辑（服务端与测试共用，不依赖 Node API）。
 * - ActionGuard：按会话限速 / 拦重复，输出拒绝原因（引擎仍是合法性的最终裁判）。
 * - classifyReject：把引擎的拒绝归类为 out_of_turn / illegal / ended。
 * - checkReplayConsistency：对局结束后用 replayGame 还原并与原局状态逐字比对。
 * - buildMatchSummary：终局埋点摘要（不含 accountId，座位只用序号与昵称）。
 */
import { actorOf } from './engine';
import { rankSeats, replayGame, type GameRecord } from './replay';
import type { Action, GameState } from './types';

export const RISK = {
  /** 同一会话两次操作的最小间隔（毫秒）；真人点击远慢于此 */
  minIntervalMs: 60,
  /** 滑动窗口内最多操作数（超速） */
  windowMs: 2000,
  maxPerWindow: 12,
  /** 与上一条完全相同的操作在该时间内再次出现视为重复 */
  duplicateMs: 400,
} as const;

export type RiskReason = 'spectator' | 'not_seated' | 'out_of_turn' | 'illegal' | 'ended' | 'too_fast' | 'rate_limited' | 'duplicate';

export class ActionGuard {
  /** speed>1 仅用于加速冒烟/压测：把时间阈值同比缩短 */
  constructor(private speed = 1) {}
  private last = new Map<string, { at: number; key: string }>();
  private window = new Map<string, number[]>();

  /** 返回 null 表示放行，否则为拒绝原因。放行时记录本次操作。 */
  check(sessionId: string, action: Action, now: number): RiskReason | null {
    const key = JSON.stringify(action);
    const prev = this.last.get(sessionId);
    if (prev) {
      // 重复判定不随加速缩放：客户端响应延迟不会因服务端加速而变短；加速模式（仅测试用）下关闭该项
      if (this.speed <= 1 && key === prev.key && now - prev.at < RISK.duplicateMs) return 'duplicate';
      if (now - prev.at < RISK.minIntervalMs / this.speed) return 'too_fast';
    }
    const w = (this.window.get(sessionId) ?? []).filter((t) => now - t < RISK.windowMs / this.speed);
    if (w.length >= RISK.maxPerWindow) { this.window.set(sessionId, w); return 'rate_limited'; }
    w.push(now);
    this.window.set(sessionId, w);
    this.last.set(sessionId, { at: now, key });
    return null;
  }

  forget(sessionId: string) { this.last.delete(sessionId); this.window.delete(sessionId); }
}

/** 引擎拒绝后归类（调用时传入拒绝前的状态） */
export function classifyReject(state: GameState, seat: number): RiskReason {
  if (state.phase === 'ended') return 'ended';
  if (seat !== actorOf(state)) return 'out_of_turn';
  return 'illegal';
}

export interface ConsistencyResult { ok: boolean; reason?: string }

/** 回放一致性抽查：重放记录并与原局状态比对；重放抛错也算不一致 */
export function checkReplayConsistency(rec: GameRecord, finalState: GameState): ConsistencyResult {
  try {
    const { state } = replayGame(rec);
    if (JSON.stringify(state) !== JSON.stringify(finalState)) return { ok: false, reason: `状态不一致（replay seq=${state.seq}，原局 seq=${finalState.seq}）` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `重放失败：${(e as Error).message}` };
  }
}

/** 操作序列摘要：各类操作的计数 */
export function summarizeActions(rec: GameRecord): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of rec.actions) out[a.action.type] = (out[a.action.type] ?? 0) + 1;
  return out;
}

/** 终局摘要：胜负、名次、操作计数；不含 accountId */
export function buildMatchSummary(rec: GameRecord, state: GameState) {
  return {
    seed: rec.seed, engineVersion: rec.engineVersion, rounds: state.round, steps: rec.actions.length,
    winner: state.winner, winReason: state.winReason,
    ranking: rankSeats(state).map((r) => ({ seat: r.seat, name: r.name, rank: r.rank, assets: r.assets, bankrupt: r.bankrupt, won: r.won })),
    bots: rec.seats.filter((s) => s.isBot).length,
    actionCounts: summarizeActions(rec),
  };
}
