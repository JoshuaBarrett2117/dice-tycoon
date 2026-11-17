/**
 * 快速匹配队列（纯逻辑，不依赖 Colyseus；时间由调用方传入，便于测试）。
 * - 凑满 size 人 → 立即开局（full）。
 * - 队首等候超过 timeoutMs 且真人数 ≥ minHumans → 机器人补位开局（timeout）。
 * - 玩家可随时 cancel；队列清空后计时自然重置（以当前队首入队时间起算）。
 */
import { MATCH } from './config';

export interface MatchOptions { size: number; timeoutMs: number; minHumans: number }

export type MatchDecision =
  | { kind: 'idle' }
  | { kind: 'waiting'; waiting: number; size: number; deadline: number }
  | { kind: 'start'; members: string[]; bots: number; reason: 'full' | 'timeout' };

export class MatchQueue {
  private q: { id: string; at: number }[] = [];
  readonly opts: MatchOptions;

  constructor(opts: Partial<MatchOptions> = {}) {
    this.opts = { size: MATCH.matchSize, timeoutMs: MATCH.timeoutMs, minHumans: MATCH.minHumans, ...opts };
  }

  get size() { return this.q.length; }
  has(id: string) { return this.q.some((x) => x.id === id); }

  /** 入队；同一 id 重复入队忽略。返回当前排队人数 */
  join(id: string, now: number): number {
    if (!this.has(id)) this.q.push({ id, at: now });
    return this.q.length;
  }

  /** 取消匹配；返回是否确实在队列里 */
  cancel(id: string): boolean {
    const n = this.q.length;
    this.q = this.q.filter((x) => x.id !== id);
    return this.q.length !== n;
  }

  /** 当前应做什么：满员或超时则出队并返回开局名单，否则返回等待状态 */
  poll(now: number): MatchDecision {
    const { size, timeoutMs, minHumans } = this.opts;
    if (!this.q.length) return { kind: 'idle' };
    if (this.q.length >= size) {
      const members = this.q.splice(0, size).map((x) => x.id);
      return { kind: 'start', members, bots: 0, reason: 'full' };
    }
    const deadline = this.q[0].at + timeoutMs;
    if (now >= deadline && this.q.length >= minHumans) {
      const members = this.q.splice(0).map((x) => x.id);
      return { kind: 'start', members, bots: size - members.length, reason: 'timeout' };
    }
    return { kind: 'waiting', waiting: this.q.length, size, deadline };
  }
}
