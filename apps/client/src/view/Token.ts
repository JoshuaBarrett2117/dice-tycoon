/** 棋子：投影 + 玩家色环 + 角色立绘；支持逐格跳跃（挤压拉伸）、待机呼吸、当前行动指示 */
import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { ease, hexNum, sleep, tween } from '../core/tween';

const BODY_H = 80;

export class Token extends Container {
  private ring = new Graphics();
  private hopC = new Container();
  private body: Sprite;
  private arrow: Text;
  private steps: Container;
  private stepsText: Text;
  private face = 1;
  private active = false;
  private idleT0 = performance.now();

  constructor(tex: Texture, private color: string, private seat: number) {
    super();
    const sh = new Graphics().ellipse(0, 0, 22, 8).fill({ color: 0x141e32, alpha: 0.35 });
    this.ring.ellipse(0, 0, 20, 7).stroke({ width: 3, color: hexNum(color) }).ellipse(0, 0, 23, 9).stroke({ width: 2, color: 0xffffff });
    this.body = new Sprite(tex);
    this.body.anchor.set(0.5, 1);
    this.body.scale.set(BODY_H / tex.height);
    this.arrow = new Text({ text: '▼', style: { fontSize: 22, fill: 0xffd21f, stroke: { color: 0x6b3a10, width: 4 }, fontWeight: '900' }, resolution: 2 });
    this.arrow.anchor.set(0.5); this.arrow.y = -BODY_H - 18; this.arrow.visible = false;
    this.steps = new Container();
    const disc = new Graphics().circle(0, 0, 17).fill(0xffffff).stroke({ width: 3, color: hexNum(color) });
    this.stepsText = new Text({ text: '', style: { fontSize: 19, fontWeight: '900', fill: hexNum(color) }, resolution: 2 });
    this.stepsText.anchor.set(0.5);
    this.steps.addChild(disc, this.stepsText); this.steps.y = -BODY_H - 22; this.steps.visible = false;
    this.hopC.addChild(this.body, this.arrow, this.steps);
    this.addChild(sh, this.ring, this.hopC);
    requestAnimationFrame(this.tick);
  }

  private tick = () => {
    if (this.destroyed) return;
    const t = (performance.now() - this.idleT0) / 1000 + this.seat * 0.55;
    if (!this.steps.visible) {
      const k = Math.sin((t * Math.PI * 2) / 2.2) * 0.03;
      this.body.scale.set((BODY_H / this.body.texture.height) * (1 + k) * this.face, (BODY_H / this.body.texture.height) * (1 - k));
    }
    if (this.active) {
      this.arrow.y = -BODY_H - 18 - Math.abs(Math.sin(t * 7)) * 7;
      this.ring.alpha = 0.6 + 0.4 * Math.abs(Math.sin(t * 4.5));
    }
    requestAnimationFrame(this.tick);
  };

  setActive(on: boolean) { this.active = on; this.arrow.visible = on; this.ring.alpha = 1; }
  setSad(on: boolean) { this.body.tint = on ? 0xb8b8c8 : 0xffffff; }

  moveTo(x: number, y: number, dur = 0) {
    const fx = this.x, fy = this.y;
    this.zIndex = y * 10 + 5;
    if (!dur) { this.position.set(x, y); return Promise.resolve(); }
    return tween(dur, (k) => this.position.set(fx + (x - fx) * k, fy + (y - fy) * k));
  }

  /** 跳到下一格 */
  async hop(x: number, y: number, remain: number, D = 240) {
    if (Math.abs(x - this.x) > 1) this.face = x < this.x ? -1 : 1;
    this.steps.visible = true; this.stepsText.text = String(remain); this.arrow.visible = false;
    const fx = this.x, fy = this.y, base = BODY_H / this.body.texture.height;
    this.zIndex = Math.max(fy, y) * 10 + 5;
    await tween(D, (k) => {
      this.position.set(fx + (x - fx) * k, fy + (y - fy) * k);
      this.hopC.y = -Math.sin(k * Math.PI) * 30;
      const sq = k < 0.2 ? 1 - k * 0.5 : k > 0.85 ? 1 - (k - 0.85) * 1.2 : 1 + Math.sin(k * Math.PI) * 0.08;
      this.body.scale.set(base * (2 - sq) * this.face, base * sq);
    }, ease.linear);
    this.zIndex = y * 10 + 5;
    this.body.scale.set(base * 1.14 * this.face, base * 0.84);
    await tween(90, (k) => this.body.scale.set(base * (1.14 - 0.14 * k) * this.face, base * (0.84 + 0.16 * k)));
    await sleep(30);
  }

  endMove() { this.steps.visible = false; this.hopC.y = 0; this.arrow.visible = this.active; }

  /** 飞行/瞬移：缩小上升 → 落下弹跳 */
  async warp(x: number, y: number, fly: boolean) {
    await tween(fly ? 450 : 300, (k) => { this.hopC.y = -k * 120; this.alpha = fly ? 1 : 1 - k; });
    this.position.set(x, y); this.zIndex = y * 10 + 5;
    await tween(fly ? 450 : 300, (k) => { this.hopC.y = -(1 - k) * 120; this.alpha = fly ? 1 : k; }, ease.outBack);
    this.hopC.y = 0; this.alpha = 1;
  }

  async shake() {
    const x0 = this.hopC.x;
    await tween(420, (k) => { this.hopC.x = x0 + Math.sin(k * Math.PI * 6) * 5 * (1 - k); this.hopC.rotation = Math.sin(k * Math.PI * 6) * 0.1 * (1 - k); });
    this.hopC.x = x0; this.hopC.rotation = 0;
  }

  async cheer() {
    await tween(520, (k) => { this.hopC.y = -Math.abs(Math.sin(k * Math.PI * 2)) * 16 * (1 - k * 0.4); });
    this.hopC.y = 0;
  }
}
