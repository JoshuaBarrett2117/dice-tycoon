/** 轻量补间：基于 requestAnimationFrame，返回 Promise，便于用 async/await 串联演出 */
export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number) => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
};

export function tween(dur: number, step: (k: number) => void, e: Ease = ease.outCubic): Promise<void> {
  return new Promise((res) => {
    if (dur <= 0) { step(1); res(); return; }
    const t0 = performance.now();
    const f = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      step(e(k));
      if (k < 1) requestAnimationFrame(f); else res();
    };
    requestAnimationFrame(f);
  });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** 十六进制颜色调亮（f>0）或调暗（f<0），返回数字颜色 */
export function shade(hex: string, f: number): number {
  const n = parseInt(hex.slice(1), 16);
  const m = (x: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? x * (1 + f) : x + (255 - x) * f)));
  return (m(n >> 16) << 16) | (m((n >> 8) & 255) << 8) | m(n & 255);
}
export const hexNum = (hex: string) => parseInt(hex.slice(1), 16);
