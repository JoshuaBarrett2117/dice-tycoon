/**
 * v1.10 真 3D 骰子（PixiJS 3D · @pixi/3d）：卡通渲染（ToonMaterial 分层光照 + OutlinePass 描边）、
 * 圆角 Q 版骰体、贴图点数（一点 / 四点为中式红点），抛出 → 多次弹跳翻滚 → 摇晃落定。
 *
 * 点数始终由规则引擎 / 对战服给出：动画只是“解”到给定的朝上面——先算出目标姿态，再把翻滚
 * 旋转按时间衰减叠加回去，最后一帧恰好等于目标姿态，因此结果与表现永远一致。
 *
 * 嵌在世界层同一块 PixiJS 画布里（View3D 是普通显示对象），不新开 WebGL 上下文。
 * 任意一步失败（无 WebGL2、着色器编译异常等）由调用方回退到原 2D 骰子。
 */
import {
  AmbientLight, DirectionalLight, FlatMaterial, Geometry3D, Mesh3D, PlaneGeometry, Quaternion, Vector3, View3D,
} from '@pixi/3d';
import { OutlinePass, ToonMaterial, solidMeshDescriptor } from '@pixi/3d/extras';
import { Container, RendererType, Texture, type Application, type Ticker } from 'pixi.js';
import type { ShaderBit } from '@pixi/3d';

/**
 * @pixi/3d 0.1.0 的 ToonMaterial 采样 baseColor 贴图时未做 sRGB→线性解码（FlatMaterial 有），
 * 画布贴图会整体发白发灰。这里在材质阶段补上解码（标准 sRGB 曲线），两套后端各写一份。
 */
const srgbDecodeBit: ShaderBit = {
  name: 'dtToonSrgbDecode',
  gpu: { fragment: { material: `
  {
    let c = clamp(albedo, vec3<f32>(0.0), vec3<f32>(1.0));
    albedo = select(pow((c + 0.055) / 1.055, vec3<f32>(2.4)), c / 12.92, c <= vec3<f32>(0.04045));
  }
` } },
  gl: { fragment: { material: `
  {
    vec3 c = clamp(albedo, 0.0, 1.0);
    albedo = mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, vec3(lessThanEqual(c, vec3(0.04045))));
  }
` } },
};

// ───────────────────────── 皮肤（与商城骰子皮肤一一对应） ─────────────────────────
interface DieLook {
  body: string; edge: string; pip: string; red?: string; ring?: string; glow?: string;
  outline: number; rim: number; deco?: 'gold' | 'island' | 'neon';
}
interface SkinDef { dice: [DieLook, DieLook] }
const classic: DieLook = { body: '#fff6e0', edge: '#f1dfb6', pip: '#1f2a5c', red: '#e0283f', outline: 0x3a2a35, rim: 0.28 };
const gold: DieLook = { body: '#ffcf3d', edge: '#e09a12', pip: '#c8143f', ring: '#a8680a', outline: 0x6b3407, rim: 0.42, deco: 'gold' };
const island: DieLook = { body: '#46cfe0', edge: '#2aa9c2', pip: '#ffffff', ring: '#0e6f86', outline: 0x0b4a5e, rim: 0.32, deco: 'island' };
const neonC: DieLook = { body: '#35dcff', edge: '#18a8e8', pip: '#ffffff', glow: '#b9f6ff', outline: 0x0a2c66, rim: 0.6, deco: 'neon' };
const neonM: DieLook = { body: '#ff42d8', edge: '#d01fb2', pip: '#ffffff', glow: '#ffd0f6', outline: 0x5a0b4c, rim: 0.6, deco: 'neon' };
export const DICE_SKINS: Record<string, SkinDef> = {
  classic: { dice: [classic, classic] },
  gold: { dice: [gold, gold] },
  island: { dice: [island, island] },
  neon: { dice: [neonC, neonM] },
};

// ───────────────────────── 几何：圆角立方体（平滑法线，描边无断口） ─────────────────────────
const H = 0.5; // 半边长（骰子边长 1）
const R = 0.17; // 圆角半径
/** 面：法线、右向量；点数按标准骰（对面和为 7） */
const FACES: { n: [number, number, number]; u: [number, number, number]; v: number }[] = [
  { n: [0, 1, 0], u: [1, 0, 0], v: 1 },
  { n: [0, -1, 0], u: [1, 0, 0], v: 6 },
  { n: [0, 0, 1], u: [1, 0, 0], v: 2 },
  { n: [0, 0, -1], u: [-1, 0, 0], v: 5 },
  { n: [1, 0, 0], u: [0, 0, -1], v: 3 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: 4 },
];
const CELL = 256, PAD = 6; // 贴图集：3×2 格，每格 256px
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function roundedBox(): Geometry3D {
  const m = 6, flat = 4;
  const coords: number[] = [];
  for (let k = 0; k <= m; k++) coords.push(-(H - R) - R * Math.tan(((m - k) / m) * (Math.PI / 4)));
  for (let k = 1; k < flat; k++) coords.push(-(H - R) + (2 * (H - R) * k) / flat);
  for (let k = m; k >= 0; k--) coords.push(H - R + R * Math.tan(((m - k) / m) * (Math.PI / 4)));
  const N = coords.length;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  FACES.forEach((f, fi) => {
    const up = cross(f.n, f.u);
    const base = pos.length / 3;
    const cx = (fi % 3) * CELL, cy = Math.floor(fi / 3) * CELL;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const s = coords[i], t = coords[j];
        const p = [0, 1, 2].map((a) => f.n[a] * H + f.u[a] * s + up[a] * t);
        const inner = p.map((x) => Math.max(-(H - R), Math.min(H - R, x)));
        const d = p.map((x, a) => x - inner[a]);
        const l = Math.hypot(d[0], d[1], d[2]) || 1;
        const nn = d.map((x) => x / l);
        pos.push(...inner.map((x, a) => x + nn[a] * R));
        nor.push(...nn);
        const fu = (s + H) / (2 * H), fv = (H - t) / (2 * H);
        uv.push((cx + PAD + fu * (CELL - 2 * PAD)) / (3 * CELL), (cy + PAD + fv * (CELL - 2 * PAD)) / (2 * CELL));
      }
    }
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = base + j * N + i, b = a + 1, c = a + N + 1, d = a + N;
        idx.push(a, b, c, a, c, d);
      }
    }
  });
  return new Geometry3D({
    positions: new Float32Array(pos), normals: new Float32Array(nor), uvs: new Float32Array(uv), indices: new Uint16Array(idx),
  });
}

// ───────────────────────── 贴图：点数面（画布生成，零图片请求） ─────────────────────────
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]], 2: [[0.28, 0.28], [0.72, 0.72]], 3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.29, 0.29], [0.71, 0.29], [0.29, 0.71], [0.71, 0.71]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.29, 0.24], [0.71, 0.24], [0.29, 0.5], [0.71, 0.5], [0.29, 0.76], [0.71, 0.76]],
};
function faceAtlas(L: DieLook): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = CELL * 3; cv.height = CELL * 2;
  const g = cv.getContext('2d')!;
  FACES.forEach((f, fi) => {
    const x0 = (fi % 3) * CELL, y0 = Math.floor(fi / 3) * CELL, S = CELL;
    // 面底色：中心亮、四周略深，配合圆角几何更有“糖果”体积
    const bg = g.createRadialGradient(x0 + S * 0.42, y0 + S * 0.38, S * 0.1, x0 + S / 2, y0 + S / 2, S * 0.75);
    bg.addColorStop(0, L.body); bg.addColorStop(0.7, L.body); bg.addColorStop(1, L.edge);
    g.fillStyle = bg; g.fillRect(x0, y0, S, S);
    if (L.deco === 'gold') { // 金色浮雕细框
      g.strokeStyle = 'rgba(150,85,5,.55)'; g.lineWidth = 5;
      roundRect(g, x0 + S * 0.1, y0 + S * 0.1, S * 0.8, S * 0.8, S * 0.12); g.stroke();
      g.strokeStyle = 'rgba(255,245,190,.6)'; g.lineWidth = 2;
      roundRect(g, x0 + S * 0.1 + 4, y0 + S * 0.1 + 4, S * 0.8 - 8, S * 0.8 - 8, S * 0.1); g.stroke();
    } else if (L.deco === 'island') { // 浅色波纹
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 6; g.lineCap = 'round';
      g.beginPath();
      for (let k = 0; k <= 8; k++) { const xx = x0 + S * (0.1 + k * 0.1), yy = y0 + S * 0.88 + Math.sin(k * 1.6) * 5; if (k) g.lineTo(xx, yy); else g.moveTo(xx, yy); }
      g.stroke();
    }
    // 糖果光泽：每面左上一道柔和高光（Toon 高光在平面上会整面泛白，故画进贴图）
    const gl = g.createLinearGradient(x0 + S * 0.08, y0 + S * 0.08, x0 + S * 0.45, y0 + S * 0.45);
    gl.addColorStop(0, `rgba(255,255,255,${L.deco === 'neon' ? 0.5 : 0.42})`); gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl; roundRect(g, x0 + S * 0.07, y0 + S * 0.07, S * 0.5, S * 0.5, S * 0.14); g.fill();
    const big = f.v === 1;
    for (const [px, py] of PIPS[f.v]) {
      const cx = x0 + px * S, cy = y0 + py * S, r = S * (big ? 0.15 : 0.092);
      const col = L.red && (f.v === 1 || f.v === 4) ? L.red : L.pip;
      g.save();
      if (L.glow) { g.shadowColor = L.glow; g.shadowBlur = 14; }
      if (L.ring) { g.fillStyle = L.ring; circle(g, cx, cy, r * 1.22); g.fill(); }
      // 凹坑：外圈深色、内部渐变（右下受光）
      const pg = g.createRadialGradient(cx + r * 0.3, cy + r * 0.35, r * 0.1, cx, cy, r);
      pg.addColorStop(0, shadeHex(col, 0.25)); pg.addColorStop(0.75, col); pg.addColorStop(1, shadeHex(col, -0.35));
      g.fillStyle = pg; circle(g, cx, cy, r); g.fill();
      g.restore();
      g.fillStyle = 'rgba(255,255,255,.55)'; // 左上高光点
      circle(g, cx - r * 0.38, cy - r * 0.4, r * 0.2); g.fill();
    }
  });
  return cv;
}
function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); }
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function shadeHex(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function blobTex(inner: string, outer: string, ring = false): Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, ring ? 40 : 0, 64, 64, 62);
  gr.addColorStop(0, ring ? 'rgba(255,255,255,0)' : inner); gr.addColorStop(ring ? 0.35 : 0.55, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return Texture.from(cv);
}

// ───────────────────────── 动画数学 ─────────────────────────
const UP = new Vector3(0, 1, 0);
/** 让点数 v 那面朝上 */
function faceUpQuat(v: number, yaw: number): Quaternion {
  const f = FACES.find((x) => x.v === v)!;
  const q = new Quaternion().setFromUnitVectors(new Vector3(...f.n), UP);
  return new Quaternion().setFromAxisAngle(UP, yaw).multiply(q);
}
const CORNERS: Vector3[] = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) CORNERS.push(new Vector3(x * (H - R), y * (H - R), z * (H - R)));
const _v = new Vector3();
/** 圆角立方体在姿态 q 下的最低点到中心的距离（精确：圆角中心最低者 + 圆角半径） */
function support(q: Quaternion): number {
  let m = -Infinity;
  for (const c of CORNERS) { rotate(q, c, _v); m = Math.max(m, -_v.y); }
  return m + R;
}
function rotate(q: Quaternion, v: Vector3, out: Vector3) {
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y, iy = w * v.y + z * v.x - x * v.z, iz = w * v.z + x * v.y - y * v.x, iw = -x * v.x - y * v.y - z * v.z;
  out.x = ix * w + iw * -x + iy * -z - iz * -y; out.y = iy * w + iw * -y + iz * -x - ix * -z; out.z = iz * w + iw * -z + ix * -y - iy * -x;
  return out;
}

/** 一枚骰子的抛掷脚本：弹道 + 弹跳 + 衰减翻滚，终点姿态 = 目标点数 */
interface Throw {
  from: Vector3; to: Vector3; qf: Quaternion; a1: Vector3; a2: Vector3; th1: number; th2: number; delay: number;
}
const G = 40; // 重力（场景单位/s²），弹跳高度 = G·d²/8，各段时长一致可信
const SEG = [0.4, 0.26, 0.16, 0.09]; // 首段下落 + 三次弹跳
const SPIN = [1, 0.62, 0.36, 0.18]; // 每次落地摩擦后角速度比例
const SETTLE = 0.24; // 落定前的摇晃
const FLY = SEG.reduce((a, b) => a + b, 0);
const SPIN_TOTAL = SEG.reduce((a, d, i) => a + d * SPIN[i], 0);
const Y0 = 1.05;
const V0 = (G * SEG[0] * SEG[0] / 2 - Y0) / SEG[0];

function sample(T: Throw, tRaw: number, q: Quaternion, p: Vector3, sc: Vector3): { air: number; impact: number } {
  const t = Math.max(0, tRaw - T.delay);
  // 角度进度（分段匀角速度，落地瞬间减速）
  let acc = 0, ht = 0, seg = SEG.length, local = 0;
  for (let i = 0, t0 = 0; i < SEG.length; t0 += SEG[i], i++) {
    if (t < t0 + SEG[i]) { seg = i; local = t - t0; acc += local * SPIN[i]; break; }
    acc += SEG[i] * SPIN[i];
  }
  const prog = Math.min(1, acc / SPIN_TOTAL);
  // 高度
  if (seg === 0) ht = Y0 + V0 * local - (G * local * local) / 2;
  else if (seg < SEG.length) ht = (G * local * (SEG[seg] - local)) / 2;
  // 落定摇晃（绕滚动轴的衰减摆动，最终归零）
  let wob = 0;
  const ts = t - FLY;
  if (ts > 0 && ts < SETTLE) { const k = ts / SETTLE; wob = 0.2 * Math.sin(k * Math.PI * 2.2) * (1 - k) * (1 - k); }
  const r1 = new Quaternion().setFromAxisAngle(T.a1, -(1 - prog) * T.th1 + wob);
  const r2 = new Quaternion().setFromAxisAngle(T.a2, -(1 - prog) * T.th2);
  q.copyFrom(r1).multiply(r2).multiply(T.qf);
  // 水平：缓出靠近终点
  const hp = 1 - Math.pow(1 - Math.min(1, t / FLY), 2.4);
  const y = Math.max(0, ht) + support(q);
  p.set(T.from.x + (T.to.x - T.from.x) * hp, y, T.from.z + (T.to.z - T.from.z) * hp);
  // 出手放大 + 落地挤压
  const s = Math.min(1, 0.45 + (t / 0.16) * 0.55);
  let impact = 1e9;
  for (let i = 0, te = 0; i < SEG.length; i++) { te += SEG[i]; const d = t - te; if (d >= 0) impact = Math.min(impact, d); }
  let sq = 0;
  if (impact < 0.09) sq = (1 - impact / 0.09) * 0.11 * (t < SEG[0] + 0.1 ? 1 : 0.6);
  sc.set(s * (1 + sq * 0.5), s * (1 - sq), s * (1 + sq * 0.5));
  return { air: Math.max(0, ht), impact };
}

// ───────────────────────── 主类 ─────────────────────────
const realClock = () => performance.now();
export class Dice3D {
  /** 时钟（毫秒）；仅供截图脚本冻结时间，游戏内恒为 performance.now */
  static clock = realClock;
  private view: View3D;
  private dice: Mesh3D[] = [];
  private shadows: Mesh3D[] = [];
  private rings: Mesh3D[] = [];
  private mats = new Map<string, ToonMaterial[]>();
  private geo = roundedBox();
  private busy = false;
  private wrap = new Container();

  /** 创建失败返回 null（调用方回退 2D）。必须在 app.init 之前已 import 本模块（注册 3D 后端）。 */
  static create(app: Application): Dice3D | null {
    try {
      const r = app.renderer as unknown as { type: number; context?: { webGLVersion?: number } };
      if (r.type === RendererType.WEBGL && r.context?.webGLVersion !== 2) return null;
      if (r.type !== RendererType.WEBGL && r.type !== RendererType.WEBGPU) return null;
      return new Dice3D(app);
    } catch (e) { console.warn('[dice3d] init failed', e); return null; }
  }

  private constructor(private app: Application) {
    const W = 1280, Hh = 720;
    this.view = new View3D({
      width: W, height: Hh, anchor: 0.5,
      passes: [new OutlinePass({ width: 0.04, color: 0x2a2140 })],
    });
    this.view.eventMode = 'none';
    this.wrap.position.set(640, 360);
    this.wrap.addChild(this.view);
    this.wrap.visible = false;
    this.wrap.eventMode = 'none';
    app.stage.addChild(this.wrap);
    const res = app.renderer.resolution;
    if (res > 2) this.view.resolution = 2;

    const cam = this.view.camera;
    cam.fov = 30;
    cam.position.set(0, 12.4, 6.0);
    cam.lookAt({ x: 0, y: 0, z: 0.2 });

    const sun = new DirectionalLight({ color: 0xfff6e6, intensity: 0.68 });
    sun.position.set(-2.2, 8, 2.4); sun.lookAt({ x: 0, y: 0, z: 0 });
    this.view.root.addChild(sun, new AmbientLight({ color: 0xf3ecff, intensity: 1.3 }));

    const shTex = blobTex('rgba(20,16,50,.55)', 'rgba(20,16,50,0)');
    const ringTex = blobTex('rgba(255,255,255,1)', 'rgba(255,214,90,0)', true);
    for (let i = 0; i < 2; i++) {
      const sh = new Mesh3D({
        geometry: new PlaneGeometry({ width: 1.5, height: 1.5 }),
        material: new FlatMaterial({ baseColorTexture: shTex, alphaMode: 'blend' }),
        castShadow: false, receiveShadow: false,
      });
      sh.rotation.x = -Math.PI / 2;
      const ring = new Mesh3D({
        geometry: new PlaneGeometry({ width: 1.6, height: 1.6 }),
        material: new FlatMaterial({ baseColorTexture: ringTex, alphaMode: 'blend' }),
        castShadow: false, receiveShadow: false,
      });
      ring.rotation.x = -Math.PI / 2; ring.visible = false;
      const d = new Mesh3D({ geometry: this.geo, material: this.materials('classic')[i], castShadow: false, receiveShadow: false });
      this.view.root.addChild(sh, ring, d);
      this.shadows.push(sh); this.rings.push(ring); this.dice.push(d);
    }
  }

  private materials(skin: string): ToonMaterial[] {
    const key = DICE_SKINS[skin] ? skin : 'classic';
    let m = this.mats.get(key);
    if (!m) {
      const def = DICE_SKINS[key];
      const cache = new Map<DieLook, ToonMaterial>();
      m = def.dice.map((L) => {
        let mat = cache.get(L);
        if (!mat) {
          mat = new ToonMaterial({
            baseColor: 0xffffff, baseColorTexture: Texture.from(faceAtlas(L)),
            // 平面上 Toon 高光会整面泛白，关掉（-1 让 smoothstep 永不触发）；光泽改由贴图高光 + 边缘光表现
            bands: 3, specularSize: -1, rimIntensity: L.rim, rimPower: 2.6, extraBits: [srgbDecodeBit],
            passes: { outline: { shaderDescriptor: solidMeshDescriptor({ color: L.outline, extrude: 0.04 }) } },
          });
          cache.set(L, mat);
        }
        return mat;
      });
      this.mats.set(key, m);
    }
    return m;
  }

  /**
   * 预热 + 自检：同步渲染一帧（编译着色器，避免第一次掷骰卡顿）。
   * 若 3D 渲染在这台设备上抛错，返回 false，调用方销毁并回退 2D。
   */
  warm(skin: string | null): boolean {
    this.dice.forEach((d, i) => { d.material = this.materials(skin || 'classic')[i]; d.position.set(i ? 0.75 : -0.75, 0.5, 0); });
    this.wrap.visible = true; this.wrap.alpha = 0.01;
    try { this.app.renderer.render(this.app.stage); return true; }
    catch (e) { console.warn('[dice3d] warm-up render failed', e); return false; }
    finally { this.wrap.visible = false; this.wrap.alpha = 1; }
  }

  /** 播放抛掷并落到 (a, b)；onLand 在两枚都落定时回调（播音效） */
  roll(a: number, b: number, skin: string | null, onLand?: () => void, hold = 340): Promise<void> {
    if (this.busy) return Promise.resolve();
    this.busy = true;
    const mats = this.materials(skin || 'classic');
    this.dice.forEach((d, i) => { d.material = mats[i]; });
    const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
    const throws: Throw[] = [a, b].map((v, i) => {
      const s = i ? 1 : -1;
      const to = new Vector3(s * rnd(0.68, 0.8), 0, rnd(-0.12, 0.12));
      const from = new Vector3(s * rnd(0.58, 0.66), 0, rnd(0.5, 0.8));
      const dir = new Vector3(to.x - from.x, 0, to.z - from.z).normalize();
      const a1 = new Vector3(dir.z, 0, -dir.x); // dir × up：沿前进方向滚动
      const a2 = new Vector3(rnd(-1, 1), rnd(0.2, 1), rnd(-1, 1)).normalize();
      return {
        from, to, a1, a2, qf: faceUpQuat(v, rnd(-0.45, 0.45) + (Math.random() < 0.5 ? 0 : Math.PI / 2)),
        th1: Math.PI * rnd(3.2, 4.2), th2: Math.PI * rnd(0.8, 1.5), delay: i ? 0.05 : 0,
      };
    });
    const q = new Quaternion(), p = new Vector3(), sc = new Vector3();
    const landAt = FLY + SETTLE + 0.05;
    const end = landAt + hold / 1000 + 0.22;
    const t0 = Dice3D.clock();
    this.wrap.visible = true; this.wrap.alpha = 1; this.wrap.scale.set(1);
    let landed = false;
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        this.app.ticker.remove(tick);
        this.wrap.visible = false; this.wrap.alpha = 1; this.wrap.scale.set(1);
        this.rings.forEach((r) => { r.visible = false; });
        this.busy = false;
        if (!landed) onLand?.();
        resolve();
      };
      const tick = (_t: Ticker) => {
        try {
          const t = (Dice3D.clock() - t0) / 1000;
          throws.forEach((T, i) => {
            const st = sample(T, t, q, p, sc);
            const d = this.dice[i];
            d.quaternion.copyFrom(q); d.position.copyFrom(p);
            // 落定后的“啵”一下
            const tl = t - landAt;
            const pop = tl > 0 && tl < 0.24 ? 1 + 0.12 * Math.sin((tl / 0.24) * Math.PI) : 1;
            d.scale.set(sc.x * pop, sc.y * pop, sc.z * pop);
            const sh = this.shadows[i];
            sh.position.set(p.x, 0.003, p.z);
            const k = Math.max(0, 1 - st.air / 2.6);
            sh.scale.set(0.55 + 0.45 * k, 0.55 + 0.45 * k, 1);
            (sh.material as FlatMaterial).alpha = 0.2 + 0.6 * k;
            const ring = this.rings[i];
            const rt = tl + 0.05;
            ring.visible = rt > 0 && rt < 0.42;
            if (ring.visible) {
              const e = rt / 0.42;
              ring.position.set(p.x, 0.006, p.z);
              ring.scale.set(0.7 + e * 1.1, 0.7 + e * 1.1, 1);
              (ring.material as FlatMaterial).alpha = (1 - e) * (1 - e);
            }
          });
          if (!landed && t >= landAt) { landed = true; onLand?.(); }
          const tf = t - (end - 0.22);
          if (tf > 0) { const e = Math.min(1, tf / 0.22); this.wrap.alpha = 1 - e; this.wrap.scale.set(1 - 0.35 * e); this.wrap.y = 360 - 30 * e; }
          else this.wrap.y = 360;
          if (t >= end) finish();
        } catch (e) { console.warn('[dice3d] frame failed', e); finish(); }
      };
      this.app.ticker.add(tick);
      // 后台标签页 ticker 暂停时也不能卡住对局流程
      if (Dice3D.clock === realClock) setTimeout(finish, (end + 1.5) * 1000);
    });
  }

  destroy() { try { this.wrap.destroy({ children: true }); } catch { /* ignore */ } }
}
