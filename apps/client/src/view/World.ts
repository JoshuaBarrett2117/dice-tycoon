/**
 * 世界层（PixiJS）：背景、斜视棋盘、角落地标、建筑、棋子、地面特效与镜头。
 * HUD 在 DOM 层（ui/Hud.ts），两者通过 toStage() 坐标换算对齐。
 */
import {
  Application, Assets, BlurFilter, Container, Graphics, Matrix, Sprite, Text, type Texture,
} from 'pixi.js';
import { BOARD_SIZE, boardOf, GROUP_COLOR, THEMES, THEME_DEFAULT, type ThemeId, type GameState, groupSetOwner, tollOf } from '@dt/shared';
import { A, B, BASEH, CW, GEO, OX, OY, P, S, TH, W, ZT, buildingAnchor, tileCorners, tokenAnchor } from './iso';
import { ease, hexNum, shade, tween } from '../core/tween';
import { Token } from './Token';

const FONT = '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
const CORNER_TINT: Record<string, string> = { start: '#ffe69a', island: '#a8e3ff', festival: '#ffc9e4', airport: '#c9efc0' };
const CORNER_TEX: Record<string, string> = { start: 'c_start', island: 'c_island', festival: 'c_fest', airport: 'c_air' };
const BLD_H = [0, 52, 76, 100, 96];

export const ASSET_LIST = [
  'bg.jpg', 'c_start.png', 'c_island.png', 'c_fest.png', 'c_air.png',
  'bld1.png', 'bld2.png', 'bld3.png', 'bld4.png', 'coin.png',
  'char1.png', 'char2.png', 'char3.png', 'char4.png', 'char5.png', 'char6.svg', 'char7.svg',
  'skin_jin.svg', 'skin_li.svg', 'skin_wang.svg', 'skin_xing.svg', 'skin_panda.svg', 'skin_rock.svg',
];

export const CHAR_TEX: Record<string, string> = { jin: 'char1', li: 'char2', wang: 'char3', xing: 'char4', panda: 'char5', rock: 'char6', tang: 'char7' };

export class World {
  app = new Application();
  tex: Record<string, Texture> = {};
  root = new Container();
  private boardG = new Graphics();
  private tileTops: Container[] = [];
  private ground = new Container();
  objs = new Container();
  private buildings: (Container | null)[] = [];
  tokens: Token[] = [];
  cam = { x: 0, y: 0, s: 1 };
  private colors: string[] = [];
  /** buildBoard 创建的所有装饰（阴影、广场、地块顶面、角落地标、标签），重建棋盘前统一销毁 */
  private decor: Container[] = [];
  private theme: ThemeId = THEME_DEFAULT;
  private bgSp: Sprite | null = null;
  private lastState: GameState | null = null;

  /** 切换主题：仅表现层；已有棋盘时即时重绘 */
  setTheme(id: ThemeId) {
    this.theme = id;
    if (this.bgSp) this.bgSp.tint = THEMES[id].bgTint;
    if (this.lastState && this.decor.length) this.buildBoard(this.lastState);
  }

  async init(host: HTMLElement) {
    await this.app.init({ width: 1280, height: 720, backgroundAlpha: 0, antialias: true, resolution: this.res(), autoDensity: true });
    host.prepend(this.app.canvas);
    const base = import.meta.env.BASE_URL + 'assets/';
    const loaded = await Assets.load(ASSET_LIST.map((f) => ({ alias: f.replace(/\.\w+$/, ''), src: base + f })), (pr: number) => {
      const pct = Math.round(pr * 100);
      const lf = document.getElementById('lf'), lp = document.getElementById('lp');
      if (lf) lf.style.width = pct + '%';
      if (lp) lp.textContent = `加载中 ${pct}%`;
    });
    document.getElementById('loading')?.remove();
    this.tex = loaded as Record<string, Texture>;
    this.app.stage.addChild(this.root);
    const bg = new Sprite(this.tex.bg);
    bg.width = 1280; bg.height = 720; bg.tint = THEMES[this.theme].bgTint; this.bgSp = bg;
    this.objs.sortableChildren = true;
    this.root.addChild(bg, this.boardG, this.ground, this.objs);
    addEventListener('resize', () => this.onResize());
  }

  private res() {
    const fit = Math.min(innerWidth / 1280, innerHeight / 720);
    return Math.min(2.5, Math.max(1, (devicePixelRatio || 1) * fit));
  }
  private onResize() {
    this.app.renderer.resolution = this.res();
    this.app.renderer.resize(1280, 720);
  }

  // ───────────────────────── 棋盘 ─────────────────────────
  setPlayers(colors: string[], chars: string[], skins: (string | null)[] = []) {
    this.colors = colors;
    this.tokens.forEach((t) => t.destroy());
    this.tokens = chars.map((c, i) => {
      const tk = new Token((skins[i] && this.tex[skins[i]!]) || this.tex[CHAR_TEX[c]], colors[i], i);
      this.objs.addChild(tk);
      return tk;
    });
  }

  buildBoard(state: GameState) {
    const BOARD = boardOf(state).tiles;
    this.lastState = state;
    const TH = THEMES[this.theme];
    const g = this.boardG;
    g.clear();
    // 重建（回放跳转 / 重新开局）：先清掉上一次的装饰、建筑与地面特效
    this.decor.forEach((d) => d.destroy({ children: true }));
    this.decor = [];
    this.buildings.forEach((b) => b?.destroy({ children: true }));
    this.buildings = [];
    this.tileTops = [];
    this.ground.removeChildren().forEach((x) => x.destroy());
    // 投影阴影
    const sh = new Graphics();
    sh.poly([P(0, 0, -6), P(S, 0, -6), P(S, S, -6), P(0, S, -6)].flatMap(([x, y]) => [x, y + 14])).fill({ color: 0x0a283c, alpha: 0.45 });
    sh.filters = [new BlurFilter({ strength: 14 })];
    this.root.addChildAt(sh, 1);
    this.decor.push(sh as unknown as Container);
    slab(g, -8, -8, S + 8, S + 8, 0, BASEH, TH.base[0], TH.base[1], TH.base[2], TH.base[3]);
    g.poly([P(CW + 6, CW + 6, BASEH), P(S - CW - 6, CW + 6, BASEH), P(S - CW - 6, S - CW - 6, BASEH), P(CW + 6, S - CW - 6, BASEH)].flat())
      .fill(TH.inner).stroke({ width: 2, color: TH.innerLine });
    const plaza = planeLayer(BASEH);
    const logo = txt('掷富天下', 70, TH.logo);
    logo.alpha = 0.2; logo.rotation = -Math.PI / 4; logo.position.set(S / 2 - 120, S / 2 - 120);
    plaza.addChild(logo);
    this.root.addChildAt(plaza, 3);
    this.decor.push(plaza);

    // 地块：从远到近绘制
    const order = [...GEO].sort((a, b) => a.r[2] + a.r[3] - (b.r[2] + b.r[3]));
    this.tileTops = [];
    for (const geo of order) {
      const d = BOARD[geo.i], [u0, v0, u1, v1] = geo.r, gap = 2.5;
      if (d.kind === 'corner') {
        const col = CORNER_TINT[d.corner!];
        slab(g, u0 + gap, v0 + gap, u1 - gap, v1 - gap, BASEH, ZT, hexNum(col), shade(col, -0.25), shade(col, -0.35), 0xffffff);
      } else {
        const col = GROUP_COLOR[(d.group ?? d.kind) as keyof typeof GROUP_COLOR];
        slab(g, u0 + gap, v0 + gap, u1 - gap, v1 - gap, BASEH, ZT, TH.tileTop, shade(col, -0.2), shade(col, -0.32), 0xffffff);
      }
    }
    BOARD.forEach((_, i) => {
      const c = planeLayer(ZT);
      this.root.addChildAt(c, this.root.getChildIndex(this.ground));
      this.decor.push(c);
      this.tileTops[i] = c;
      this.drawTileTop(i, state);
    });
    // 四角地标
    BOARD.filter((d) => d.kind === 'corner').forEach((d) => {
      const geo = GEO[d.index], [x, y] = P(geo.cu, geo.cv, ZT - 4);
      const sp = new Sprite(this.tex[CORNER_TEX[d.corner!]]);
      sp.anchor.set(0.5, 1);
      const h = d.corner === 'island' ? 84 : 100;
      sp.scale.set(h / sp.texture.height);
      sp.position.set(x, y + 30);
      sp.zIndex = (y - 10) * 10;
      this.objs.addChild(sp);
      this.decor.push(sp as unknown as Container);
      const lab = planeLayer(ZT);
      const t = txt(d.name, 15, TH.label); t.alpha = 0.55; t.rotation = Math.PI / 4; t.anchor.set(0.5);
      t.position.set(geo.cu - 28, geo.cv + 28);
      lab.addChild(t);
      this.root.addChildAt(lab, this.root.getChildIndex(this.ground));
      this.decor.push(lab);
    });
    this.buildings = BOARD.map(() => null);
    state.tiles.forEach((_, i) => this.setBuilding(i, state, false));
  }

  /** 重绘一个格子的顶面装饰（色带、城市名、价格/过路费、归属色） */
  drawTileTop(i: number, state: GameState) {
    const BOARD = boardOf(state).tiles;
    const c = this.tileTops[i];
    c.removeChildren().forEach((x) => x.destroy());
    const d = BOARD[i], geo = GEO[i], t = state.tiles[i];
    if (d.kind === 'corner') return;
    const TH = THEMES[this.theme];
    const spc = state.specials ? boardOf(state).specials[i] : undefined;
    const col = spc ? (spc.kind === 'teleport' ? '#06b6d4' : '#e5a800') : GROUP_COLOR[(d.group ?? d.kind) as keyof typeof GROUP_COLOR];
    const inner = new Container();
    inner.position.set(geo.cu, geo.cv); inner.rotation = geo.th;
    c.addChild(inner);
    const gap = 2.5, lw = W - 2 * gap, ld = CW - 2 * gap, band = ld * 0.36;
    const g = new Graphics();
    const own = t.owner != null ? this.colors[t.owner] : null;
    if (own) g.rect(-lw / 2, -ld / 2, lw, ld - band).fill(shade(own, 0.62));
    if (state.festivalTile === i) g.rect(-lw / 2, -ld / 2, lw, ld - band).stroke({ width: 3, color: 0xff4fa3 });
    // 色组集齐：金色描边 + 星标（过路费 ×1.5）
    const setOwner = groupSetOwner(state, i);
    if (setOwner != null) g.rect(-lw / 2, -ld / 2, lw, ld).stroke({ width: 3, color: 0xffd23f });
    g.rect(-lw / 2, ld / 2 - band, lw, band).fill(hexNum(col));
    g.rect(-lw / 2, ld / 2 - band, lw, 3).fill({ color: 0xffffff, alpha: 0.28 });
    inner.addChild(g);
    if (t.mortgaged) {
      // 抵押中：灰色蒙层 + 斜杠
      const m = new Graphics();
      m.rect(-lw / 2, -ld / 2, lw, ld).fill({ color: 0x475569, alpha: 0.5 });
      m.moveTo(-lw / 2, -ld / 2).lineTo(lw / 2, ld / 2).stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
      inner.addChild(m);
    }
    const nm = txt(spc ? spc.name : d.name, d.name.length > 3 ? 11 : 14, 0xffffff, 0x000000, 3);
    nm.anchor.set(0.5); nm.y = ld / 2 - band / 2 + 1;
    inner.addChild(nm);
    let sub: Text | null = null;
    if (own) sub = txt(t.mortgaged ? '抵押中' : `${setOwner != null ? '★ ' : ''}过路费 ¥${tollOf(state, i)}万`, 9, shade(own, -0.1));
    else if (spc) { sub = txt(spc.kind === 'teleport' ? '⇄' : '¥', 32, spc.kind === 'teleport' ? 0x06b6d4 : 0xe5a800); sub.y = -ld * 0.16; }
    else if (d.kind === 'card') { sub = txt('?', 34, hexNum(col)); sub.y = -ld * 0.16; }
    else if (d.kind === 'tax') sub = txt('税', 22, 0x64748b);
    else if (d.kind === 'tour') sub = txt(`观光地 ¥${d.price}万`, 10, 0x0b6e9e);
    else sub = txt(`¥${d.price}万`, 10, TH.subText);
    sub.anchor.set(0.5);
    if (own) sub.y = ld / 2 - band - 7; else if (d.kind !== 'card' && !spc) sub.y = -ld * 0.08;
    inner.addChild(sub);
  }

  setBuilding(i: number, state: GameState, pop: boolean) {
    const BOARD = boardOf(state).tiles;
    this.buildings[i]?.destroy({ children: true });
    this.buildings[i] = null;
    const t = state.tiles[i], d = BOARD[i];
    if (t.owner == null || d.kind === 'corner') return;
    const col = this.colors[t.owner];
    const [x, y] = buildingAnchor(i);
    const c = new Container();
    c.position.set(x, y); c.zIndex = y * 10;
    const base = new Graphics().ellipse(0, 0, 24, 9).fill({ color: hexNum(col), alpha: 0.55 });
    c.addChild(base);
    let top = -46;
    if (d.kind === 'city' && t.lv > 0) {
      const sp = new Sprite(this.tex[`bld${t.lv}`]);
      sp.anchor.set(0.5, 1);
      sp.scale.set(BLD_H[t.lv] / sp.texture.height);
      c.addChild(sp);
      top = -BLD_H[t.lv] - 14;
      if (pop) {
        sp.scale.set(0.01);
        const target = BLD_H[t.lv] / sp.texture.height;
        void tween(550, (k) => sp.scale.set(Math.max(0.01, target * k)), ease.outBack);
      }
    }
    const flag = new Graphics();
    flag.rect(10, top, 3, t.lv > 0 ? 22 : 40).fill(0x3b2a1a);
    flag.roundRect(13, top, 16, 11, 3).fill(hexNum(col)).stroke({ width: 2, color: 0xffffff });
    c.addChild(flag);
    this.objs.addChild(c);
    this.buildings[i] = c;
  }

  // ───────────────────────── 棋子 ─────────────────────────
  /** 把所有棋子摆到所在格（多人同格错位） */
  layoutAll(positions: number[], alive: boolean[], animate = false) {
    const byTile = new Map<number, number[]>();
    positions.forEach((p, k) => { if (alive[k]) byTile.set(p, [...(byTile.get(p) ?? []), k]); });
    byTile.forEach((ks, tile) => {
      const [bx, by] = tokenAnchor(tile);
      const offs = [[0, 0], [-14, -3], [14, 3], [-16, -4], [16, -4], [0, 6], [-16, 6], [16, 6]];
      const table: number[][][] = [[[0, 0]], [[-14, -3], [14, 3]], [[-16, -4], [16, -4], [0, 6]], [[-16, -6], [16, -6], [-16, 6], [16, 6]]];
      ks.forEach((k, j) => {
        const o = table[ks.length - 1]?.[j] ?? offs[j];
        this.tokens[k].moveTo(bx + o[0], by + o[1], animate ? 180 : 0);
      });
    });
    this.tokens.forEach((t, k) => (t.visible = alive[k]));
  }

  // ───────────────────────── 地面特效 ─────────────────────────
  flashTile(i: number, color: string, alpha = 0.35): Graphics {
    const g = new Graphics();
    g.poly(tileCorners(i).flat()).fill({ color: hexNum(color), alpha }).stroke({ width: 3, color: 0xffffff, join: 'round' });
    this.ground.addChild(g);
    return g;
  }

  pulse(g: Graphics) {
    const t0 = performance.now();
    const f = () => { if (g.destroyed) return; g.alpha = 0.55 + 0.45 * Math.abs(Math.sin((performance.now() - t0) / 320)); requestAnimationFrame(f); };
    f();
  }

  puffs(x: number, y: number) {
    for (let k = 0; k < 6; k++) {
      const p = new Graphics().circle(0, 0, 7).fill(0xfffdf5);
      p.position.set(x, y); p.zIndex = y * 10 + 6;
      this.objs.addChild(p);
      const a = (k / 6) * Math.PI * 2;
      void tween(450, (e) => {
        p.position.set(x + Math.cos(a) * 26 * e, y + (Math.sin(a) * 10 - 4) * e);
        p.scale.set(0.4 + e);
        p.alpha = 0.95 * (1 - e);
      }).then(() => p.destroy());
    }
  }

  // ───────────────────────── 镜头 ─────────────────────────
  camTo(x: number, y: number, s: number, dur = 380) {
    let tx = 640 - x * s, ty = 380 - y * s;
    tx = Math.min(0, Math.max(1280 - 1280 * s, tx));
    ty = Math.min(0, Math.max(720 - 720 * s, ty));
    if (s === 1) { tx = 0; ty = 0; }
    const from = { ...this.cam };
    this.cam = { x: tx, y: ty, s };
    return tween(dur, (k) => {
      this.root.position.set(from.x + (tx - from.x) * k, from.y + (ty - from.y) * k);
      this.root.scale.set(from.s + (s - from.s) * k);
    }, ease.inOutCubic);
  }

  /** 屏幕坐标（clientX/Y）→ 被点中的格子下标；点在棋盘外返回 -1 */
  tileAt(clientX: number, clientY: number): number {
    const r = this.app.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return -1;
    const sx = ((clientX - r.left) / r.width) * 1280, sy = ((clientY - r.top) / r.height) * 720;
    const wx = (sx - this.cam.x) / this.cam.s, wy = (sy - this.cam.y) / this.cam.s;
    for (let i = 0; i < BOARD_SIZE; i++) if (inPoly(wx, wy, tileCorners(i))) return i;
    return -1;
  }

  /** 世界坐标 → 舞台坐标（按镜头最终位置） */
  toStage(x: number, y: number): [number, number] {
    return [x * this.cam.s + this.cam.x, y * this.cam.s + this.cam.y];
  }
}

function inPoly(x: number, y: number, pts: [number, number][]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ───────────────────────── 绘制工具 ─────────────────────────
function slab(g: Graphics, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number,
  top: number, sideL: number, sideR: number, stroke: number) {
  g.poly([P(u0, v1, z1), P(u1, v1, z1), P(u1, v1, z0), P(u0, v1, z0)].flat()).fill(sideL);
  g.poly([P(u1, v0, z1), P(u1, v1, z1), P(u1, v1, z0), P(u1, v0, z0)].flat()).fill(sideR);
  g.poly([P(u0, v0, z1), P(u1, v0, z1), P(u1, v1, z1), P(u0, v1, z1)].flat()).fill(top).stroke({ width: 1.5, color: stroke });
}

/** 一个贴在棋盘平面上的图层（平面坐标 u,v） */
function planeLayer(z: number) {
  const c = new Container();
  c.setFromMatrix(new Matrix(A, B, -A, B, OX, OY - z));
  return c;
}

function txt(s: string, size: number, fill: number, stroke?: number, sw = 0) {
  const t = new Text({
    text: s,
    style: { fontFamily: FONT, fontSize: size, fontWeight: '900', fill, ...(stroke != null ? { stroke: { color: stroke, width: sw, alpha: 0.25 } } : {}) },
    resolution: 3,
  });
  t.anchor.set(0.5);
  return t;
}

export { TH };
