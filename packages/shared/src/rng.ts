/**
 * 可序列化的确定性随机数（mulberry32）。状态存放在 GameState.rng 中，
 * 因此同一 seed + 同一操作序列在服务端和回放中得到完全一致的结果。
 */
export interface RngHolder { rng: number }

export function nextFloat(h: RngHolder): number {
  let t = (h.rng = (h.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(h: RngHolder, lo: number, hi: number): number {
  return lo + Math.floor(nextFloat(h) * (hi - lo + 1));
}

export function pick<T>(h: RngHolder, arr: readonly T[]): T {
  return arr[Math.floor(nextFloat(h) * arr.length)];
}
