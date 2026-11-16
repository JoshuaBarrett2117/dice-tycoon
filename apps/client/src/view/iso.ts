/**
 * 45° 斜视（等距）棋盘几何。棋盘在平面坐标 (u,v) 中是 S×S 的正方形，
 * 通过 P(u,v,z) 投影到 1280×720 的舞台坐标。
 */
import { BOARD, BOARD_SIZE } from '@dt/shared';

export const S = 700, CW = 100, W = (S - 2 * CW) / 7;
export const A = 0.665, B = 0.372, OX = 640, OY = 150;
export const BASEH = 16, TH = 9, ZT = BASEH + TH;

export const P = (u: number, v: number, z = 0): [number, number] => [OX + (u - v) * A, OY + (u + v) * B - z];

export interface TileGeo {
  i: number;
  /** 平面矩形 [u0,v0,u1,v1] */
  r: [number, number, number, number];
  cu: number;
  cv: number;
  /** 文字旋转：沿边方向 */
  th: number;
}

export const GEO: TileGeo[] = BOARD.map((_, i) => {
  const k = i % 8;
  let r: [number, number, number, number];
  let side = 0;
  if (i === 0) r = [S - CW, S - CW, S, S];
  else if (i === 8) r = [0, S - CW, CW, S];
  else if (i === 16) r = [0, 0, CW, CW];
  else if (i === 24) r = [S - CW, 0, S, CW];
  else if (i < 8) { side = 1; r = [S - CW - k * W, S - CW, S - CW - (k - 1) * W, S]; }
  else if (i < 16) { side = 2; r = [0, S - CW - k * W, CW, S - CW - (k - 1) * W]; }
  else if (i < 24) { side = 3; r = [CW + (k - 1) * W, 0, CW + k * W, CW]; }
  else { side = 4; r = [S - CW, CW + (k - 1) * W, S, CW + k * W]; }
  return { i, r, cu: (r[0] + r[2]) / 2, cv: (r[1] + r[3]) / 2, th: side === 2 || side === 4 ? -Math.PI / 2 : 0 };
});

/** 格子局部坐标（沿边 x、朝内 y）→ 平面坐标 */
export function loc(g: TileGeo, x: number, y: number): [number, number] {
  return g.th === 0 ? [g.cu + x, g.cv + y] : [g.cu + y, g.cv - x];
}

export function tokenAnchor(i: number): [number, number] {
  const g = GEO[i];
  if (BOARD[i].kind === 'corner') return P(g.cu + 8, g.cv + 8, ZT);
  return P(...loc(g, 0, CW * 0.14), ZT);
}

export function buildingAnchor(i: number): [number, number] {
  return P(...loc(GEO[i], 0, -CW * 0.2), ZT);
}

/** 同格多人站位偏移 */
export const CROWD: [number, number][][] = [
  [[0, 0]],
  [[-14, -3], [14, 3]],
  [[-16, -4], [16, -4], [0, 6]],
  [[-16, -6], [16, -6], [-16, 6], [16, 6]],
];

export const tileCorners = (i: number, z = ZT): [number, number][] => {
  const [u0, v0, u1, v1] = GEO[i].r;
  return [P(u0, v0, z), P(u1, v0, z), P(u1, v1, z), P(u0, v1, z)];
};

export const nextIndex = (i: number, n: number) => (i + n) % BOARD_SIZE;
