/**
 * v1.11 真 3D 骰子（PixiJS 3D · @pixi/3d）：对标《天天富翁》系“皮肤骰子”的商业手游质感。
 *
 * - 骰体：大圆角“糖块”立方体（平滑法线），每面一圈凸起彩色包边。
 * - 材质：PBR Material3D + 清漆（clearcoat）+ 程序生成的法线 / ORM / 自发光贴图（diceSkins.ts），
 *   再叠一个自定义 ShaderBit：影棚灯箱窗形反射、彩色菲涅尔亮边、通透内发光。
 * - 描边：去掉黑色粗描边，改为同色系深色细边。
 * - 特效：2D 叠加层（按骰子投影位置）——飞行拖尾光粒 / 气泡、弹跳小冲击、落地星星迸溅 + 闪光 + 顶面十字星。
 *   所有特效状态都是“时间的纯函数”，与骰子动画共用同一时钟，冻结时钟即可逐帧截图。
 *
 * 点数始终由规则引擎 / 对战服给出：动画只是“解”到给定的朝上面——先算出目标姿态，再把翻滚
 * 旋转按时间衰减叠加回去，最后一帧恰好等于目标姿态，因此结果与表现永远一致。
 *
 * 嵌在世界层同一块 PixiJS 画布里（View3D 是普通显示对象），不新开 WebGL 上下文。
 * 任意一步失败（无 WebGL2、着色器编译异常等）由调用方回退到原 2D 骰子。
 */
import {
  DirectionalLight, FlatMaterial, Geometry3D, Material3D, Mesh3D, PlaneGeometry, Quaternion, Vector3, View3D,
} from '@pixi/3d';
import { OutlinePass, solidMeshDescriptor } from '@pixi/3d/extras';
import {
  CanvasSource, Container, Point, RendererType, Sprite, Texture, type Application, type Ticker,
} from 'pixi.js';
import type { ShaderBit } from '@pixi/3d';
import { CELL, DICE_SKINS, PAD, buildSkinTextures, type DieLook } from './diceSkins';

export { DICE_SKINS };

// ───────────────────────── 着色：影棚反射 + 彩色亮边 + 通透感 ─────────────────────────
/**
 * 叠在 PBR 光照之后（linear 空间）：
 *  - 三块“灯箱”（左上主灯箱、右侧竖条、前下方反光条）按反射向量做窗形高光，强度由 fx.R 控制，
 *    金属部分（fx.B）按本色染色——这是商业手游骰子“釉面发亮”的关键。
 *  - 彩色菲涅尔亮边（fx.G 遮罩，发光点数处关闭）。
 *  - 通透感：视线正对处按本色补一层内发光（白玉 / 果冻 / 水晶）。
 */
const GL_HEADER = `
float dtBox(vec3 R, vec3 D, float w, float h) {
  float c = dot(R, D);
  if (c <= 0.05) return 0.0;
  vec3 U = normalize(cross(D, vec3(0.0, 1.0, 0.001)));
  vec3 V = cross(U, D);
  float a = abs(dot(R, U) / c), b = abs(dot(R, V) / c);
  return (1.0 - smoothstep(w * 0.55, w, a)) * (1.0 - smoothstep(h * 0.55, h, b));
}
`;
const GPU_HEADER = `
fn dtBox(R: vec3<f32>, D: vec3<f32>, w: f32, h: f32) -> f32 {
  let c = dot(R, D);
  if (c <= 0.05) { return 0.0; }
  let U = normalize(cross(D, vec3<f32>(0.0, 1.0, 0.001)));
  let V = cross(U, D);
  let a = abs(dot(R, U) / c);
  let b = abs(dot(R, V) / c);
  return (1.0 - smoothstep(w * 0.55, w, a)) * (1.0 - smoothstep(h * 0.55, h, b));
}
`;
const GL_POST = `
{
  vec4 dtM = sampleDtFx(vUV);
  float dtNv = clamp(dot(normal, viewDir), 0.0, 1.0);
  vec3 dtR = reflect(-viewDir, normal);
  vec3 dtTint = mix(vec3(1.0), albedo * 1.6, dtM.b);
  float dtL = dtBox(dtR, normalize(vec3(-0.45, 0.8, -0.4)), 0.42, 0.26) * material.dtGloss.x
            + dtBox(dtR, normalize(vec3(0.85, 0.42, 0.3)), 0.1, 0.55) * material.dtGloss.y
            + dtBox(dtR, normalize(vec3(-0.25, 0.2, 0.95)), 0.6, 0.09) * material.dtGloss.z;
  finalColor += dtTint * (dtL * dtM.r * 1.25);
  finalColor += material.dtRim.rgb * (pow(1.0 - dtNv, material.dtRim.w) * dtM.g);
  finalColor += albedo * material.dtSss.rgb * (dtNv * dtNv);
}
`;
const GPU_POST = `
{
  let dtM = sampleDtFx(input.vUV);
  let dtNv = clamp(dot(normal, viewDir), 0.0, 1.0);
  let dtR = reflect(-viewDir, normal);
  let dtTint = mix(vec3<f32>(1.0), albedo * 1.6, dtM.b);
  let dtL = dtBox(dtR, normalize(vec3<f32>(-0.45, 0.8, -0.4)), 0.42, 0.26) * material.dtGloss.x
          + dtBox(dtR, normalize(vec3<f32>(0.85, 0.42, 0.3)), 0.1, 0.55) * material.dtGloss.y
          + dtBox(dtR, normalize(vec3<f32>(-0.25, 0.2, 0.95)), 0.6, 0.09) * material.dtGloss.z;
  finalColor += dtTint * (dtL * dtM.r * 1.25);
  finalColor += material.dtRim.rgb * (pow(1.0 - dtNv, material.dtRim.w) * dtM.g);
  finalColor += albedo * material.dtSss.rgb * (dtNv * dtNv);
}
`;
const studioBit: ShaderBit = {
  name: 'dtDiceStudio',
  bindings: { material: { dtGloss: 'vec4<f32>', dtRim: 'vec4<f32>', dtSss: 'vec4<f32>' } },
  textures: ['dtFx'],
  gpu: { header: GPU_HEADER, fragment: { lobePostLighting: GPU_POST } },
  gl: { fragment: { header: GL_HEADER, lobePostLighting: GL_POST } },
};

// ───────────────────────── 几何：圆角立方体（平滑法线，描边无断口） ─────────────────────────
const H = 0.5; // 半边长（骰子边长 1）
const R = 0.2; // 圆角半径（大圆角 = 胖乎乎的“糖块”）
/** 面：法线、右向量；点数按标准骰（对面和为 7） */
const FACES: { n: [number, number, number]; u: [number, number, number]; v: number }[] = [
  { n: [0, 1, 0], u: [1, 0, 0], v: 1 },
  { n: [0, -1, 0], u: [1, 0, 0], v: 6 },
  { n: [0, 0, 1], u: [1, 0, 0], v: 2 },
  { n: [0, 0, -1], u: [-1, 0, 0], v: 5 },
  { n: [1, 0, 0], u: [0, 0, -1], v: 3 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: 4 },
];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function roundedBox(): Geometry3D {
  const m = 8, flat = 8;
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

const canvasTex = (cv: HTMLCanvasElement, mips = true) =>
  new Texture({ source: new CanvasSource({ resource: cv, autoGenerateMipmaps: mips, scaleMode: 'linear' }) });

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function makeMaterial(L: DieLook): Material3D {
  const t = buildSkinTextures(L);
  const orm = canvasTex(t.orm);
  const mat = new Material3D({
    baseColor: 0xffffff, baseColorTexture: canvasTex(t.color),
    normalTexture: canvasTex(t.normal), normalScale: 1,
    metallic: 1, roughness: 1, metallicRoughnessTexture: orm,
    occlusionTexture: orm, occlusionStrength: 1,
    emissive: { color: 0xffffff, strength: L.emissive, texture: canvasTex(t.emissive) },
    clearcoat: { factor: L.clearcoat, roughness: 0.06 },
    ...(L.iridescence ? { iridescence: { factor: L.iridescence, thicknessMinimum: 180, thicknessMaximum: 480 } } : {}),
    extraBits: [studioBit],
    textures: { dtFx: canvasTex(t.fx) },
    passes: { outline: { shaderDescriptor: solidMeshDescriptor({ color: L.outline, extrude: 0.014 }) } },
  } as ConstructorParameters<typeof Material3D>[0]);
  const d = mat.data as unknown as Record<string, number[]>;
  d.dtGloss = [1.15, 0.8, 0.45, 0];
  d.dtRim = [lin(L.rim[0] / 1.4) * 0.9, lin(L.rim[1] / 1.4) * 0.9, lin(L.rim[2] / 1.4) * 0.9, L.rimPower];
  d.dtSss = [L.sss, L.sss, L.sss, 0];
  return mat;
}

// ───────────────────────── 2D 特效贴图 ─────────────────────────
function fxTex(kind: 'dot' | 'star' | 'ring' | 'bubble'): Texture {
  const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d')!, c = S / 2;
  if (kind === 'dot') {
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  } else if (kind === 'star') { // 四芒星 + 中心亮点
    g.fillStyle = '#fff';
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, r = i % 2 ? S * 0.07 : S * 0.48; g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); }
    g.closePath(); g.fill();
    const gr = g.createRadialGradient(c, c, 0, c, c, S * 0.28);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  } else if (kind === 'ring') {
    const gr = g.createRadialGradient(c, c, S * 0.3, c, c, S * 0.5);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  } else { // 气泡：亮边 + 高光点
    const gr = g.createRadialGradient(c, c, S * 0.2, c, c, S * 0.48);
    gr.addColorStop(0, 'rgba(255,255,255,.08)'); gr.addColorStop(0.8, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(c, c, S * 0.48, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.ellipse(c - S * 0.14, c - S * 0.15, S * 0.09, S * 0.06, -0.7, 0, Math.PI * 2); g.fill();
  }
  return Texture.from(cv);
}
/** 可复现的伪随机（特效是时间的纯函数） */
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
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
const TRAIL_DT = 1 / 40, TRAIL_LIFE = 0.42, BURST_LIFE = 0.8, POOL = 110;
export class Dice3D {
  /** 时钟（毫秒）；仅供截图脚本冻结时间，游戏内恒为 performance.now */
  static clock = realClock;
  private view: View3D;
  private dice: Mesh3D[] = [];
  private shadows: Mesh3D[] = [];
  private rings: Mesh3D[] = [];
  private mats = new Map<DieLook, Material3D>();
  private geo = roundedBox();
  private busy = false;
  private wrap = new Container();
  private under = new Container();
  private over = new Container();
  private pool: Sprite[] = [];
  private used = 0;
  private tex!: Record<'dot' | 'star' | 'ring' | 'bubble', Texture>;
  private tmpQ = new Quaternion(); private tmpP = new Vector3(); private tmpS = new Vector3();
  private gp = new Point(); private lp = new Point();

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
      // 半球环境光：天空亮、地面取棋盘米色，清漆 / 金属反射出“上亮下暖”的渐变
      environment: { skyColor: 0xf2f6ff, groundColor: 0xc9ab84, intensity: 0.8 },
      passes: [new OutlinePass({ width: 0.014, color: 0x3a2a35 })],
    });
    this.view.eventMode = 'none';
    this.wrap.position.set(640, 360);
    this.wrap.addChild(this.under, this.view, this.over);
    this.wrap.visible = false;
    this.wrap.eventMode = 'none';
    this.under.eventMode = this.over.eventMode = 'none';
    app.stage.addChild(this.wrap);
    const res = app.renderer.resolution;
    if (res > 2) this.view.resolution = 2;

    const cam = this.view.camera;
    cam.fov = 30;
    cam.position.set(0, 12.4, 6.0);
    cam.lookAt({ x: 0, y: 0, z: 0.2 });

    const key = new DirectionalLight({ color: 0xfff3e0, intensity: 2.3 });
    key.position.set(-3.2, 8, 3.6); key.lookAt({ x: 0, y: 0, z: 0 });
    const fill = new DirectionalLight({ color: 0xdfe8ff, intensity: 1.0 });
    fill.position.set(5, 3, 2); fill.lookAt({ x: 0, y: 0, z: 0 });
    const front = new DirectionalLight({ color: 0xfff0e4, intensity: 0.6 });
    front.position.set(0, 1.5, 8); front.lookAt({ x: 0, y: 0, z: 0 });
    this.view.root.addChild(key, fill, front);

    this.tex = { dot: fxTex('dot'), star: fxTex('star'), ring: fxTex('ring'), bubble: fxTex('bubble') };
    const shTex = blobTex('rgba(30,20,50,.6)', 'rgba(30,20,50,0)');
    const ringTex = blobTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)', true);
    for (let i = 0; i < 2; i++) {
      const sh = new Mesh3D({
        geometry: new PlaneGeometry({ width: 1.55, height: 1.55 }),
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
    for (let i = 0; i < POOL; i++) {
      const s = new Sprite(this.tex.dot);
      s.anchor.set(0.5); s.blendMode = 'add'; s.visible = false;
      (i < 6 ? this.under : this.over).addChild(s);
      this.pool.push(s);
    }
  }

  private looks(skin: string | null): [DieLook, DieLook] {
    return (DICE_SKINS[skin || 'classic'] || DICE_SKINS.classic).dice;
  }
  private materials(skin: string | null): Material3D[] {
    return this.looks(skin).map((L) => {
      let m = this.mats.get(L);
      if (!m) { m = makeMaterial(L); this.mats.set(L, m); }
      return m;
    });
  }

  /**
   * 预热 + 自检：同步渲染一帧（编译着色器、生成贴图，避免第一次掷骰卡顿）。
   * 若 3D 渲染在这台设备上抛错，返回 false，调用方销毁并回退 2D。
   */
  warm(skin: string | null): boolean {
    try {
      this.dice.forEach((d, i) => { d.material = this.materials(skin)[i]; d.position.set(i ? 0.75 : -0.75, 0.5, 0); });
      this.wrap.visible = true; this.wrap.alpha = 0.01;
      this.app.renderer.render(this.app.stage); return true;
    } catch (e) { console.warn('[dice3d] warm-up render failed', e); return false; }
    finally { this.wrap.visible = false; this.wrap.alpha = 1; }
  }

  // ───── 2D 特效：每帧从时间重建（无状态） ─────
  private sprite(tex: Texture, x: number, y: number, scale: number, tint: number, alpha: number, rot = 0, under = false): void {
    let s: Sprite | undefined;
    if (under) s = this.pool.slice(0, 6).find((p) => !p.visible);
    else if (this.used < POOL - 6) s = this.pool[6 + this.used++];
    if (!s) return;
    s.visible = true; s.texture = tex; s.position.set(x, y); s.scale.set(scale); s.tint = tint; s.alpha = alpha; s.rotation = rot;
  }
  private project(x: number, y: number, z: number): Point | null {
    const g = this.view.worldToScreen({ x, y, z }, this.gp, true);
    if (!g) return null;
    return this.over.toLocal(g, undefined, this.lp);
  }

  private fx(t: number, throws: Throw[], looks: [DieLook, DieLook]) {
    for (const s of this.pool) s.visible = false;
    this.used = 0;
    const { tmpQ: q, tmpP: p, tmpS: sc } = this;
    throws.forEach((T, i) => {
      const L = looks[i], pal = L.fx, bub = !!pal.bubbles;
      const tLand = T.delay + FLY;
      // 飞行光晕（骰子身后）
      if (t > T.delay && t < tLand + 0.1) {
        sample(T, t, q, p, sc);
        const c = this.project(p.x, p.y, p.z);
        const k = Math.min(1, (t - T.delay) / 0.15) * (t > tLand ? 1 - (t - tLand) / 0.1 : 1);
        if (c) this.sprite(this.tex.dot, c.x, c.y, 2.6, pal.ring, 0.35 * k, 0, true);
      }
      // 拖尾：按固定时间格生成，粒子位置 = 生成时刻骰子位置 + 哈希抖动 + 上飘
      const n0 = Math.floor(t / TRAIL_DT);
      for (let j = 0; j * TRAIL_DT < TRAIL_LIFE; j++) {
        const ts = (n0 - j) * TRAIL_DT, age = t - ts;
        if (ts < T.delay + 0.03 || ts > tLand - 0.03 || age < 0) continue;
        sample(T, ts, q, p, sc);
        for (let k = 0; k < 2; k++) {
          const seed = i * 7919 + (n0 - j) * 13 + k * 5;
          const e = age / TRAIL_LIFE;
          const wx = p.x + (hash(seed) - 0.5) * 0.7, wz = p.z + (hash(seed + 1) - 0.5) * 0.6;
          const wy = p.y + (hash(seed + 2) - 0.5) * 0.5 + age * (bub ? 1.4 : 0.6);
          const c = this.project(wx, wy, wz);
          if (!c) continue;
          const tint = pal.trail[Math.floor(hash(seed + 3) * pal.trail.length)];
          const star = !bub && hash(seed + 4) > 0.45;
          const tex = bub ? (k ? this.tex.bubble : this.tex.dot) : star ? this.tex.star : this.tex.dot;
          const sz = (bub ? 0.3 + 0.25 * hash(seed + 5) : star ? 0.38 + 0.3 * hash(seed + 5) : 0.22 + 0.2 * hash(seed + 5)) * Math.pow(1 - e, 0.6) * (bub ? 0.6 + e * 0.6 : 1);
          this.sprite(tex, c.x, c.y, sz, tint, (1 - e) * (bub && k ? 0.9 : 0.85), age * 4 + seed);
        }
      }
      // 弹跳小冲击（前几次触地）
      for (let b = 0, te = T.delay; b < SEG.length - 1; b++) {
        te += SEG[b];
        const age = t - te;
        if (age < 0 || age > 0.32) continue;
        sample(T, te, q, p, sc);
        const e = age / 0.32, rr = 0.45 + 0.5 * e;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + b;
          const c = this.project(p.x + Math.cos(a) * rr, 0.06 + e * 0.15, p.z + Math.sin(a) * rr * 0.9);
          if (c) this.sprite(this.tex.dot, c.x, c.y, 0.28 * (1 - e) + 0.06, pal.ring, 0.55 * (1 - e) * (1 - b * 0.25));
        }
      }
      // 落地：闪光 + 星星迸溅 + 顶面十字星
      const tl = t - tLand;
      if (tl >= 0 && tl < BURST_LIFE) {
        sample(T, tLand + SETTLE, q, p, sc);
        const c0 = this.project(p.x, p.y + 0.35, p.z);
        if (c0) {
          const cx = c0.x, cy = c0.y;
          if (tl < 0.4) { const e = tl / 0.4; this.sprite(this.tex.dot, cx, cy, 2.4 + 2.6 * e, 0xffffff, 0.75 * (1 - e) * (1 - e), 0, true); }
          if (tl < 0.5) { const e = tl / 0.5; this.sprite(this.tex.ring, cx, cy + 6, 1.2 + 3.2 * e, pal.ring, 0.9 * (1 - e)); }
          const N = 14;
          for (let k = 0; k < N; k++) {
            const seed = i * 101 + k * 7 + 3;
            const a = (k / N) * Math.PI * 2 + hash(seed) * 0.4;
            const sp = 70 + 70 * hash(seed + 1);
            const e = tl / BURST_LIFE;
            const rad = sp * (1 - Math.exp(-tl * 6.5));
            const x = cx + Math.cos(a) * rad * 1.15, y = cy + Math.sin(a) * rad * 0.8 - 30 * Math.sin(Math.min(1, e * 1.4) * Math.PI) + 60 * tl * tl;
            const tint = pal.burst[k % pal.burst.length];
            const star = !bub || k % 2 === 0;
            const sz = (star ? 0.55 + 0.35 * hash(seed + 2) : 0.4 + 0.3 * hash(seed + 2)) * (1 - e * 0.7);
            this.sprite(star ? this.tex.star : this.tex.bubble, x, y, sz, tint, Math.pow(1 - e, 1.3), tl * 5 * (hash(seed + 3) - 0.5));
          }
          if (tl > 0.08 && tl < 0.7) { // 顶面十字星闪
            const e = (tl - 0.08) / 0.62, k = Math.sin(e * Math.PI);
            const g = this.project(p.x - 0.22, p.y + 0.52, p.z - 0.12);
            if (g) {
              this.sprite(this.tex.star, g.x, g.y, 1.1 * k, 0xffffff, k, e * 1.2);
              this.sprite(this.tex.dot, g.x, g.y, 0.7 * k, pal.ring, 0.8 * k);
            }
          }
        }
      }
    });
  }

  /** 播放抛掷并落到 (a, b)；onLand 在两枚都落定时回调（播音效） */
  roll(a: number, b: number, skin: string | null, onLand?: () => void, hold = 340): Promise<void> {
    if (this.busy) return Promise.resolve();
    this.busy = true;
    const mats = this.materials(skin);
    const looks = this.looks(skin);
    this.dice.forEach((d, i) => { d.material = mats[i]; });
    this.rings.forEach((r, i) => { (r.material as FlatMaterial).baseColor = looks[i].fx.ring; });
    const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
    const throws: Throw[] = [a, b].map((v, i) => {
      const s = i ? 1 : -1;
      const to = new Vector3(s * rnd(0.7, 0.82), 0, rnd(-0.12, 0.12));
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
        for (const s of this.pool) s.visible = false;
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
            const rt = t - (T.delay + FLY);
            ring.visible = rt > 0 && rt < 0.5;
            if (ring.visible) {
              const e = rt / 0.5;
              ring.position.set(p.x, 0.006, p.z);
              ring.scale.set(0.7 + e * 1.3, 0.7 + e * 1.3, 1);
              (ring.material as FlatMaterial).alpha = (1 - e) * (1 - e);
            }
          });
          this.fx(t, throws, looks);
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

function blobTex(inner: string, outer: string, ring = false): Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, ring ? 40 : 0, 64, 64, 62);
  gr.addColorStop(0, ring ? 'rgba(255,255,255,0)' : inner); gr.addColorStop(ring ? 0.35 : 0.55, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return Texture.from(cv);
}
