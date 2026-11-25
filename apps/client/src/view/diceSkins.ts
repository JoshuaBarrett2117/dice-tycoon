/**
 * v1.11 骰子皮肤：程序生成的 PBR 贴图集（零图片请求）。
 *
 * 风格对齐《天天富翁 / 모두의마블》系骰子皮肤：胖圆骰体、每面一圈凸起的彩色包边、釉面强高光、
 * 点数下沉成“坑里嵌东西”（珐琅 / 宝石 / 珍珠 / 发光核）。全部为原创程序化设计。
 *
 * 每款皮肤生成同一布局的 5 张 3×2 贴图集（每格一面，与 Dice3D 的 FACES 顺序一致）：
 *   color     基础色（sRGB）
 *   normal    切线空间法线（由高度场求导：凹点、凸边、宝石切面、浮雕花纹）
 *   orm       R=环境光遮蔽  G=粗糙度  B=金属度（glTF 约定，一张同时喂 occlusion 与 metallicRoughness）
 *   emissive  自发光（霓虹点数 / 宝石内火）
 *   fx        R=影棚灯箱反射强度  G=菲涅尔亮边强度  B=反射染色（金属按本色染色）
 */

export const CELL = 256;
export const PAD = 6;

export type PipKind = 'enamel' | 'gem' | 'pearl' | 'glow';
export type Pattern = 'beads' | 'filigree' | 'waves' | 'facets';
export interface DieLook {
  /** 面主色、面边缘渐变色 */
  body: string; bodyEdge: string;
  bodyRough: number; bodyMetal: number; bodyGloss: number;
  /** 包边（圆角棱）主色、高光色 */
  trim: string; trimHi: string;
  trimRough: number; trimMetal: number; trimGloss: number;
  /** 点数 */
  pipKind: PipKind; pip: string; pipHi: string; red?: string; redHi?: string;
  /** 大点（1 点）是否配金托 */
  bezel?: string;
  pattern: Pattern;
  /** 包边凸脊是否自发光（霓虹） */
  trimGlow?: string;
  /** 3D 材质参数 */
  clearcoat: number; iridescence?: number; emissive: number;
  rim: [number, number, number]; rimPower: number;
  /** 通透感（视线正对处的内发光强度） */
  sss: number;
  outline: number;
  /** 2D 特效配色 */
  fx: { trail: number[]; burst: number[]; ring: number; bubbles?: boolean };
}

const classic: DieLook = {
  body: '#f4f8ea', bodyEdge: '#c9dfbf', bodyRough: 0.22, bodyMetal: 0, bodyGloss: 0.8,
  trim: '#e7b33c', trimHi: '#fff0b0', trimRough: 0.26, trimMetal: 1, trimGloss: 1,
  pipKind: 'enamel', pip: '#1d2f7a', pipHi: '#4f6fd8', red: '#d81c34', redHi: '#ff6a6a', bezel: '#f2c14e',
  pattern: 'beads', clearcoat: 0.9, emissive: 0, rim: [1.0, 0.86, 0.55], rimPower: 3, sss: 0.16,
  outline: 0x7a5418,
  fx: { trail: [0xffe08a, 0xffffff, 0xffc94a], burst: [0xffd75e, 0xffffff, 0xff8a4a], ring: 0xffe08a },
};
const gold: DieLook = {
  body: '#ffd34f', bodyEdge: '#e8a21e', bodyRough: 0.22, bodyMetal: 1, bodyGloss: 1,
  trim: '#f3b632', trimHi: '#fff3a8', trimRough: 0.22, trimMetal: 1, trimGloss: 1,
  pipKind: 'gem', pip: '#d40f3c', pipHi: '#ff7d9a', bezel: '#ffe58a',
  pattern: 'filigree', clearcoat: 0.6, emissive: 0.55, rim: [1.0, 0.8, 0.4], rimPower: 2.5, sss: 0,
  outline: 0x8a4a06,
  fx: { trail: [0xffe27a, 0xff4d6d, 0xffffff], burst: [0xffd84a, 0xff3d63, 0xffffff], ring: 0xffcf4a },
};
const island: DieLook = {
  body: '#33d6e6', bodyEdge: '#119fc4', bodyRough: 0.14, bodyMetal: 0, bodyGloss: 0.95,
  trim: '#e6f7ff', trimHi: '#ffffff', trimRough: 0.2, trimMetal: 0, trimGloss: 0.8,
  pipKind: 'pearl', pip: '#ff7f9e', pipHi: '#fff1f5',
  pattern: 'waves', clearcoat: 1, iridescence: 0.5, emissive: 0.18, rim: [0.75, 1.0, 1.0], rimPower: 2.4, sss: 0.42,
  outline: 0x0b5a78,
  fx: { trail: [0xbff6ff, 0xffffff, 0x6fe3ff], burst: [0x9ff3ff, 0xffffff, 0xffa3c0], ring: 0x8ff0ff, bubbles: true },
};
const neonBase = {
  bodyRough: 0.08, bodyMetal: 0, bodyGloss: 1, trimRough: 0.15, trimMetal: 0, trimGloss: 0.9,
  pipKind: 'glow' as PipKind, pattern: 'facets' as Pattern, clearcoat: 1, iridescence: 0.85, emissive: 1.6, rimPower: 2.2, sss: 0.5,
};
const neonC: DieLook = {
  ...neonBase, body: '#2fd8ff', bodyEdge: '#1460d8', trim: '#1838c8', trimHi: '#7fe6ff', trimGlow: '#3ff0ff',
  pip: '#ffffff', pipHi: '#c8fbff', rim: [0.5, 0.95, 1.4], outline: 0x0b2a78,
  fx: { trail: [0x5ff2ff, 0xffffff, 0x3aa8ff], burst: [0x6ff4ff, 0xffffff, 0xff5ee0], ring: 0x5ff2ff },
};
const neonM: DieLook = {
  ...neonBase, body: '#ff4fd8', bodyEdge: '#9a1fd0', trim: '#6a16c8', trimHi: '#ff9cf2', trimGlow: '#ff5ef0',
  pip: '#ffffff', pipHi: '#ffe0fa', rim: [1.4, 0.55, 1.3], outline: 0x5a0b6e,
  fx: { trail: [0xff7ef0, 0xffffff, 0xb36bff], burst: [0xff6ef0, 0xffffff, 0x6ff4ff], ring: 0xff7ef0 },
};

export interface SkinDef { name: string; dice: [DieLook, DieLook] }
export const DICE_SKINS: Record<string, SkinDef> = {
  classic: { name: '白玉金边', dice: [classic, classic] },
  gold: { name: '宝石金', dice: [gold, gold] },
  island: { name: '海蓝糖果', dice: [island, island] },
  neon: { name: '幻彩水晶', dice: [neonC, neonM] },
};

// ───────────────────────── 点数布局（面内 0..1，平面区约 0.2..0.8） ─────────────────────────
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.33, 0.33], [0.67, 0.67]],
  3: [[0.32, 0.32], [0.5, 0.5], [0.68, 0.68]],
  4: [[0.34, 0.34], [0.66, 0.34], [0.34, 0.66], [0.66, 0.66]],
  5: [[0.32, 0.32], [0.68, 0.32], [0.5, 0.5], [0.32, 0.68], [0.68, 0.68]],
  6: [[0.34, 0.3], [0.66, 0.3], [0.34, 0.5], [0.66, 0.5], [0.34, 0.7], [0.66, 0.7]],
};
/** 面序 → 点数，与 Dice3D.FACES 一致 */
export const FACE_VALUES = [1, 6, 2, 5, 3, 4];

// ───────────────────────── 小工具 ─────────────────────────
type RGB = [number, number, number];
const hex = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a: number, b: number, x: number) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const bump = (x: number, c: number, w: number) => { const d = (x - c) / w; return d * d >= 1 ? 0 : (1 - d * d) * (1 - d * d); };

/** 圆角方框 SDF：<0 在内 */
function sdRoundRect(px: number, py: number, b: number, r: number) {
  const qx = Math.abs(px) - (b - r), qy = Math.abs(py) - (b - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const FRAME_B = 0.392, FRAME_R = 0.15; // 内框（面平区边界附近）

/** 花纹（金丝卷草）：画进灰度画布，再按像素读回当浮雕高度 */
function filigreeMask(): Uint8ClampedArray {
  const S = CELL;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = S * 0.012;
  const P = (u: number) => PAD + u * (S - 2 * PAD);
  // 四角卷草：一段弧 + 内卷螺旋 + 小叶
  for (let k = 0; k < 4; k++) {
    g.save();
    g.translate(S / 2, S / 2); g.rotate((k * Math.PI) / 2); g.translate(-S / 2, -S / 2);
    const cx = P(0.255), cy = P(0.255);
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI * 0.15 + i * 0.13, rr = S * (0.06 - i * 0.0012);
      const x = cx + S * 0.02 + Math.cos(a) * rr, y = cy + S * 0.02 + Math.sin(a) * rr;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    // 沿边的藤蔓
    g.beginPath(); g.moveTo(P(0.3), P(0.245)); g.quadraticCurveTo(P(0.4), P(0.225), P(0.44), P(0.262)); g.stroke();
    g.beginPath(); g.moveTo(P(0.245), P(0.3)); g.quadraticCurveTo(P(0.225), P(0.4), P(0.262), P(0.44)); g.stroke();
    g.beginPath(); g.arc(P(0.45), P(0.27), S * 0.009, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(P(0.27), P(0.45), S * 0.009, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  g.filter = 'blur(1px)';
  g.drawImage(cv, 0, 0);
  const d = g.getImageData(0, 0, S, S).data;
  const out = new Uint8ClampedArray(S * S);
  for (let i = 0; i < S * S; i++) out[i] = d[i * 4 + 3];
  return out;
}

// ───────────────────────── 每像素着色 ─────────────────────────
interface Px { h: number; c: RGB; ao: number; rough: number; metal: number; gloss: number; rim: number; tint: number; em: RGB }

function shadeFace(L: DieLook, v: number, u: number, w: number, fil: number, out: Px) {
  const px = u - 0.5, py = w - 0.5;
  const d = sdRoundRect(px, py, FRAME_B, FRAME_R);
  const body = hex(L.body), bodyEdge = hex(L.bodyEdge), trim = hex(L.trim), trimHi = hex(L.trimHi);
  const r2 = px * px + py * py;

  // —— 包边 / 凸脊 / 槽 / 面 ——
  const ridge = bump(d, 0.022, 0.03); // 凸脊
  const groove = bump(d, -0.012, 0.012);
  const inTrim = sstep(-0.006, 0.006, d); // 1 = 包边区
  let h = 0.55 * inTrim + 0.35 * (1 - inTrim) + 0.55 * ridge - 0.2 * groove;
  // 面略鼓（枕头感）
  h += (1 - inTrim) * 1.1 * sat(1 - r2 / 0.13);
  let c: RGB = mix(mix(body, bodyEdge, sstep(0.0, 0.11, r2 + (px + py) * 0.12)), mix(trim, trimHi, ridge * 0.85), inTrim);
  let rough = L.bodyRough + (L.trimRough - L.bodyRough) * inTrim;
  let metal = L.bodyMetal + (L.trimMetal - L.bodyMetal) * inTrim;
  let gloss = L.bodyGloss + (L.trimGloss - L.bodyGloss) * inTrim;
  let tint = metal;
  let ao = 1 - 0.45 * groove;
  let em: RGB = [0, 0, 0];
  let rim = 1;
  if (inTrim > 0.5) c = mix(c, mul(trim, 0.82), sstep(0.06, 0.2, d)); // 外缘略深，金属更有层次
  if (L.trimGlow) { // 霓虹：凸脊发光
    const gl = hex(L.trimGlow);
    em = mix(em, gl, sat(ridge * 1.2));
    c = mix(c, gl, ridge * 0.8);
  }

  // —— 面内花纹 ——
  const inBody = 1 - inTrim;
  if (L.pattern === 'beads' && inBody > 0) { // 珠串内框（金色小珠）
    const dd = sdRoundRect(px, py, FRAME_B - 0.04, FRAME_R - 0.03);
    const along = Math.atan2(py, px) * 18;
    const bead = bump(dd, 0, 0.011) * (0.5 + 0.5 * Math.cos(along * 2.2));
    const beadRing = bump(dd, 0, 0.014);
    h += beadRing * 0.12 + bead * 0.12;
    c = mix(c, mix(hex('#e9b443'), hex('#fff1b8'), bead), sat(beadRing * 1.4));
    metal = Math.max(metal, beadRing); tint = Math.max(tint, beadRing); rough = Math.min(rough, 0.3 + 0.5 * (1 - beadRing));
    // 白玉：极淡青绿云纹 + 斜向釉光带（左上亮、右下沁色），避免顶面一片死白
    const vein = 0.5 + 0.5 * Math.sin(u * 13 + Math.sin(w * 9 + u * 4) * 1.8);
    c = mix(c, hex('#d6e8cc'), vein * vein * 0.35 * inBody);
    const diag = (u + w) * 0.5;
    c = mix(c, hex('#fffdf4'), bump(diag, 0.36, 0.14) * 0.55 * inBody);
    c = mix(c, hex('#b9d6b0'), sstep(0.55, 0.85, diag) * 0.28 * inBody);
    h += bump(diag, 0.36, 0.14) * 0.05 * inBody;
  } else if (L.pattern === 'filigree' && inBody > 0) {
    h += fil * 0.35 * inBody;
    c = mix(c, hex('#fff2b0'), fil * 0.55 * inBody);
    ao *= 1 - 0.15 * sat(fil * 3) * (1 - fil);
    // 拉丝同心细纹（金属质感）
    const brush = 0.5 + 0.5 * Math.sin(Math.sqrt(r2) * 260);
    c = mix(c, mul(c, 0.92), brush * 0.35 * inBody);
  } else if (L.pattern === 'waves' && inBody > 0) { // 海浪：下部浅色波纹 + 上部高光泡
    const wy = 0.64 + 0.03 * Math.sin(u * 22);
    const band = bump(w, wy, 0.035) + 0.7 * bump(w, wy + 0.08 + 0.02 * Math.sin(u * 22 + 1.5), 0.025);
    c = mix(c, hex('#c9fbff'), sat(band) * 0.7 * inBody);
    h += sat(band) * 0.08;
    c = mix(c, mix(body, hex('#7cf0ff'), 0.6), sstep(0.1, -0.05, d) * sstep(0.02, 0.09, r2) * 0.0);
  } else if (L.pattern === 'facets' && inBody > 0) { // 水晶切面：中心八角台面 + 放射刻面
    const a = Math.atan2(py, px), q = Math.sqrt(r2);
    const k = Math.round(a / (Math.PI / 4));
    const proj = q * Math.cos(a - (k * Math.PI) / 4);
    h += -0.6 * Math.max(0, proj - 0.1) * inBody;
    const shade = k % 2 === 0 ? 1.08 : 0.86;
    c = mix(c, mul(c, shade), 0.6 * sstep(0.08, 0.12, proj));
    c = mix(c, [255, 255, 255], 0.18 * sat(1 - q / 0.12)); // 台面亮
  }

  // —— 点数 ——
  const big = v === 1;
  for (const [cx, cy] of PIPS[v]) {
    const r = big ? 0.15 : 0.084;
    const dx = u - cx, dy = w - cy, q = Math.hypot(dx, dy) / r;
    if (q > 1.45) continue;
    const red = !!L.red && (v === 1 || v === 4);
    const pc = hex(red ? L.red! : L.pip), ph = hex(red ? L.redHi! : L.pipHi);
    // 金托（大点或宝石）
    if ((big && L.bezel) || L.pipKind === 'gem') {
      const bz = hex(L.bezel || L.trim);
      const ring = bump(q, 1.13, big ? 0.16 : 0.2);
      h += ring * 0.45;
      if (ring > 0.02) {
        c = mix(c, mix(bz, [255, 250, 220], ring * 0.6), sat(ring * 2));
        metal = Math.max(metal, sat(ring * 2)); tint = Math.max(tint, sat(ring * 2)); rough = Math.min(rough, 0.25); gloss = Math.max(gloss, ring);
      }
      if (big && L.pipKind === 'gem') { // 爪镶：四个小爪
        const ang = Math.atan2(dy, dx);
        const prong = bump(q, 1.0, 0.16) * Math.pow(Math.max(0, Math.cos(2 * (ang - Math.PI / 4))), 18);
        h += prong * 0.6;
        c = mix(c, hex('#fff3c0'), sat(prong * 3));
        metal = Math.max(metal, sat(prong * 3));
      }
    }
    if (q >= 1.02) continue;
    // 坑：圆碗下沉，坑口圆角
    const bowl = Math.sqrt(Math.max(0, 1 - q * q));
    const lip = sstep(1.02, 0.86, q);
    h -= 1.3 * bowl * lip;
    ao *= 1 - 0.8 * sstep(0.4, 0.98, q) * lip;
    if (L.pipKind === 'enamel') { // 珐琅：深色釉，坑底有高光反射
      const g2 = sat(0.5 - (dx + dy) / (2 * r) * 0.6);
      const col = mix(mul(pc, 0.62), ph, 0.5 * g2 * (1 - q));
      c = mix(c, mul(col, 1 - 0.45 * sstep(0.62, 0.95, q)), lip);
      h += lip * 0.55 * Math.sqrt(Math.max(0, 1 - (q / 0.9) ** 2)) * 0.6; // 釉面在坑里微鼓
      rough = rough + (0.12 - rough) * lip; metal = metal * (1 - lip); tint = tint * (1 - lip); gloss = gloss + (1 - gloss) * lip;
      if (big && L.bezel) { // 1 点：中心小金花
        const fa = Math.atan2(dy, dx), petal = Math.pow(Math.abs(Math.cos(fa * 2.5)), 2) * 0.32 + 0.12;
        const fl = sstep(petal + 0.04, petal - 0.02, q);
        c = mix(c, mix(hex('#ffcf4a'), hex('#fff4c4'), 1 - q * 2), fl);
        h += fl * 0.35; metal = Math.max(metal, fl); tint = Math.max(tint, fl); rough = Math.min(rough, 0.3);
      }
    } else if (L.pipKind === 'gem') { // 宝石：八角切面冠部
      const a = Math.atan2(dy, dx), k = Math.round(a / (Math.PI / 4));
      const proj = q * Math.cos(a - (k * Math.PI) / 4);
      const gem = sstep(0.98, 0.9, q);
      const crown = 0.9 - 1.3 * Math.max(0, proj - 0.42);
      h = h * (1 - gem) + (h + 1.3 * bowl + crown * 0.9 - 0.3) * gem;
      const facet = k % 2 === 0 ? 1.0 : 0.72;
      const table = sstep(0.46, 0.4, proj);
      const col = mix(mul(pc, facet), ph, table * 0.35 + (1 - q) * 0.15);
      c = mix(c, col, gem);
      em = mix(em, mul(pc, 0.7 + 0.3 * table), gem * 0.7);
      rough = rough + (0.05 - rough) * gem; metal = metal * (1 - gem); tint = tint * (1 - gem) + 0.6 * gem; gloss = gloss + (1.2 - gloss) * gem;
      ao = ao + (1 - ao) * gem * 0.7;
    } else if (L.pipKind === 'pearl') { // 珍珠：坑里嵌一颗圆珠
      const pr = 0.82, pq = q / pr;
      const pearl = sstep(1.0, 0.92, pq);
      const dome = Math.sqrt(Math.max(0, 1 - pq * pq));
      h = h * (1 - pearl) + (h + 1.3 * bowl + 0.75 * dome - 0.25) * pearl;
      const lit = sat(0.55 - (dx + dy) / (2 * r * pr) * 0.6);
      c = mix(c, mix(pc, ph, lit * 0.7 + 0.15), pearl);
      em = mix(em, mul(pc, 0.4), pearl * 0.5);
      rough = rough + (0.18 - rough) * pearl; tint = tint * (1 - pearl); gloss = gloss + (0.9 - gloss) * pearl;
      ao = ao + (1 - ao) * pearl * 0.8;
    } else { // 发光核：白热中心 + 彩色光晕
      const core = sstep(0.95, 0.2, q);
      c = mix(c, mix(mix(hex(L.trimGlow || L.body), [255, 255, 255], 0.5), [255, 255, 255], core), lip);
      em = mix(em, mix(hex(L.trimGlow || L.body), [255, 255, 255], core * 0.85), lip);
      h += lip * 0.5 * bowl;
      rough = 0.1; ao = ao + (1 - ao) * lip * 0.9; rim = 1 - lip;
    }
  }
  out.h = h; out.c = c; out.ao = ao; out.rough = rough; out.metal = metal; out.gloss = gloss; out.rim = rim; out.tint = tint; out.em = em;
}

export interface SkinTextures { color: HTMLCanvasElement; normal: HTMLCanvasElement; orm: HTMLCanvasElement; emissive: HTMLCanvasElement; fx: HTMLCanvasElement }

let filCache: Uint8ClampedArray | null = null;
/** 生成一枚骰子外观的全部贴图（约 30–60ms；按皮肤惰性生成并缓存） */
export function buildSkinTextures(L: DieLook): SkinTextures {
  const W = CELL * 3, H2 = CELL * 2, N = W * H2;
  const height = new Float32Array(N);
  const mk = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H2; return cv; };
  const color = mk(), normal = mk(), orm = mk(), emissive = mk(), fx = mk();
  const ic = new ImageData(W, H2), io = new ImageData(W, H2), ie = new ImageData(W, H2), ifx = new ImageData(W, H2), inn = new ImageData(W, H2);
  const fil = L.pattern === 'filigree' ? (filCache ??= filigreeMask()) : null;
  const P: Px = { h: 0, c: [0, 0, 0], ao: 1, rough: 1, metal: 0, gloss: 0, rim: 1, tint: 0, em: [0, 0, 0] };
  const S = CELL - 2 * PAD;
  for (let fi = 0; fi < 6; fi++) {
    const x0 = (fi % 3) * CELL, y0 = Math.floor(fi / 3) * CELL, v = FACE_VALUES[fi];
    for (let y = 0; y < CELL; y++) {
      const w = sat((y + 0.5 - PAD) / S);
      for (let x = 0; x < CELL; x++) {
        const u = sat((x + 0.5 - PAD) / S);
        shadeFace(L, v, u, w, fil ? fil[y * CELL + x] / 255 : 0, P);
        const i = (y0 + y) * W + x0 + x, j = i * 4;
        height[i] = P.h;
        ic.data[j] = P.c[0]; ic.data[j + 1] = P.c[1]; ic.data[j + 2] = P.c[2]; ic.data[j + 3] = 255;
        io.data[j] = P.ao * 255; io.data[j + 1] = sat(P.rough) * 255; io.data[j + 2] = sat(P.metal) * 255; io.data[j + 3] = 255;
        ie.data[j] = P.em[0]; ie.data[j + 1] = P.em[1]; ie.data[j + 2] = P.em[2]; ie.data[j + 3] = 255;
        ifx.data[j] = sat(P.gloss / 1.25) * 255; ifx.data[j + 1] = sat(P.rim) * 255; ifx.data[j + 2] = sat(P.tint) * 255; ifx.data[j + 3] = 255;
      }
    }
  }
  // 高度 → 法线（glTF：+X 右、+Y 上、+Z 朝外；图像 y 向下）
  const K = 11; // 浮雕强度（高度 1 ≈ K 像素坡度）
  for (let y = 0; y < H2; y++) {
    for (let x = 0; x < W; x++) {
      const cx0 = Math.floor(x / CELL) * CELL, cy0 = Math.floor(y / CELL) * CELL;
      const xl = Math.max(cx0, x - 1), xr = Math.min(cx0 + CELL - 1, x + 1);
      const yu = Math.max(cy0, y - 1), yd = Math.min(cy0 + CELL - 1, y + 1);
      const dhx = (height[y * W + xr] - height[y * W + xl]) / (xr - xl || 1);
      const dhy = (height[yd * W + x] - height[yu * W + x]) / (yd - yu || 1);
      let nx = -dhx * K, ny = dhy * K, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const j = (y * W + x) * 4;
      inn.data[j] = (nx * 0.5 + 0.5) * 255; inn.data[j + 1] = (ny * 0.5 + 0.5) * 255; inn.data[j + 2] = (nz * 0.5 + 0.5) * 255; inn.data[j + 3] = 255;
    }
  }
  color.getContext('2d')!.putImageData(ic, 0, 0);
  orm.getContext('2d')!.putImageData(io, 0, 0);
  emissive.getContext('2d')!.putImageData(ie, 0, 0);
  fx.getContext('2d')!.putImageData(ifx, 0, 0);
  normal.getContext('2d')!.putImageData(inn, 0, 0);
  return { color, normal, orm, emissive, fx };
}
