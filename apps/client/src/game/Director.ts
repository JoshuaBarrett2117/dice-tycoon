/**
 * 演出导演：把服务端（或本地引擎）发来的「快照 + 事件流」按顺序播成动画，
 * 播完后以权威快照校正画面，再根据状态决定是否等待本地玩家输入。
 */
import {
  BOARD, CHARACTERS, ITEMS, GROUP_COLOR, GROUPS, TURN_TIMEOUT_MS, ZONES,
  actorOf, controlOf, investedValue, mortgageValue, redeemCost, tollOf, totalAssets,
  GLOBAL_EVENTS,
  type Action, type GameEvent, type GameRecord, type GameState, type ItemId, type Pending, type WinReason,
} from '@dt/shared';
import { AU } from '../audio/audio';
import { sleep } from '../core/tween';
import { GRAD, type Hud, type SheetSpec } from '../ui/Hud';
import { CHAR_TEX, type World } from '../view/World';
import { buildingAnchor, tokenAnchor } from '../view/iso';
import type { GameSource, SyncMsg } from '../net/source';

export const SEAT_COLORS = ['#e8352a', '#2a7fe8', '#16a34a', '#9333ea'];
const LV_NAME = ['空地', '别墅', '公寓', '酒店', '地标'];
const WIN_TEXT: Record<WinReason, string> = {
  triple: '三区独占', line: '整排独占', tour: '观光地独占', bankrupt: '对手全部破产', assets: '回合结束 · 总资产最高',
};
const BANK: [number, number] = [640, 40];

export class Director {
  private vm: GameState | null = null;
  private queue: SyncMsg[] = [];
  private busy = false;
  private latest: SyncMsg | null = null;
  private preview: { destroy(): void }[] = [];

  private pendingJump: GameState | null = null;
  private abort = false;

  constructor(private world: World, private hud: Hud, private src: GameSource, private onRestart: () => void, private onWatchReplay?: (rec: GameRecord) => void, private onEnded?: (rec: GameRecord) => void) {
    src.onJump?.((s) => this.jump(s));
    src.onSync((m) => {
      this.hud.cancelInput();
      this.hud.closeProps();
      this.queue.push(m);
      void this.pump();
    });
  }

  private get me() { return this.src.mySeat; }

  /** 回放跳转：丢弃排队中的演出，当前这一步播完即停，然后把画面直接重置到 state */
  private jump(s: GameState) {
    this.queue = [];
    this.pendingJump = s;
    this.abort = true;
    this.hud.cancelInput();
    this.hud.closeProps();
    void this.pump();
  }

  private applyJump(s: GameState) {
    this.preview.forEach((g) => g.destroy());
    this.preview = [];
    this.hud.hideResult();
    this.vm = null;
    this.latest = null;
    this.init(s);
    this.hud.setTurn(s.turn, '行动中…');
    this.world.tokens.forEach((t, i) => t.setActive(i === s.turn));
    this.latest = { state: s, events: [], deadline: null };
    void this.world.camTo(0, 0, 1, 0);
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        if (this.pendingJump) {
          const s = this.pendingJump;
          this.pendingJump = null;
          this.abort = false;
          this.applyJump(s);
        }
        if (!this.queue.length) break;
        const m = this.queue.shift()!;
        if (this.latest && m.state.seq < this.latest.state.seq) continue;
        if (!this.vm) this.init(m.state);
        for (const e of m.events) { if (this.abort) break; await this.play(e); }
        if (this.abort) continue;
        this.reconcile(m.state);
        this.latest = m;
        this.hud.setDeadline(m.deadline);
      }
    } finally {
      this.busy = false;
    }
    if (this.latest && !this.queue.length) void this.input(this.latest);
    this.src.notifyIdle?.();
  }

  // ───────────────────────── 初始化与校正 ─────────────────────────
  private init(s: GameState) {
    this.vm = structuredClone(s);
    this.world.setPlayers(s.seats.map((_, i) => SEAT_COLORS[i]), s.seats.map((p) => p.charId));
    this.world.buildBoard(s);
    this.hud.setupPlayers(s.seats.map((p, i) => ({
      name: p.name, charName: CHARACTERS[p.charId].name, color: SEAT_COLORS[i],
      img: charUrl(p.charId), isMe: i === this.me,
    })), s.seats.map((p) => p.cash));
    this.hud.setRound(s.round, s.maxRounds);
    this.hud.setGlobalEvent(s.globalEvent?.id ?? null);
    this.layout(false);
    s.seats.forEach((_, i) => this.hud.setProps(i, this.propsOf(s, i)));
  }

  private reconcile(s: GameState) {
    const vm = this.vm!;
    s.seats.forEach((p, i) => {
      if (vm.seats[i].cash !== p.cash) this.hud.setCash(i, p.cash);
      if (p.bankrupt) this.hud.setBankrupt(i);
      this.hud.setProps(i, this.propsOf(s, i));
    });
    s.tiles.forEach((t, i) => {
      const o = vm.tiles[i];
      if (o.owner !== t.owner || o.lv !== t.lv) this.world.setBuilding(i, s, false);
    });
    this.vm = structuredClone(s);
    this.redrawTiles();
    this.layout(true);
    this.hud.setRound(s.round, s.maxRounds);
    this.hud.setGlobalEvent(s.globalEvent?.id ?? null);
    this.acts(s, false);
  }

  /** 行动栏：我的手牌 / 主动技能；只有轮到我且在掷骰阶段才可点 */
  private acts(s: GameState, enabled: boolean) {
    const me = s.seats[this.me];
    if (!me) return;
    const def = CHARACTERS[me.charId];
    const seq = s.seq;
    const press = (a: Action) => {
      this.acts(s, false);
      this.src.send(a);
      // 非法操作不会触发新快照：稍后若状态没变，恢复可点
      setTimeout(() => { if (this.latest?.state.seq === seq && !this.busy) this.acts(this.latest.state, enabled); }, 700);
    };
    this.hud.setActs({
      enabled,
      items: me.items.map((id) => ({ id, name: ITEMS[id].name, desc: ITEMS[id].desc })),
      skill: me.bankrupt ? null : { name: def.active.name, desc: def.active.desc, cd: me.skillCd },
      extras: this.extraActs(s, press),
      onItem: (id) => press({ type: 'useItem', item: id as ItemId }),
      onSkill: () => press({ type: 'useSkill' }),
    });
  }

  /** 行动栏的额外按钮（抵押 / 赎回入口等），由后续阶段补充 */
  private extraActs(s: GameState, press: (a: Action) => void): { label: string; title: string; on: () => void }[] {
    const mine = s.tiles.map((t, i) => (t.owner === this.me ? i : -1)).filter((i) => i >= 0);
    if (!mine.length) return [];
    return [{
      label: `地产 ${mine.length}`, title: '查看自己的地产，抵押换现金 / 赎回',
      on: () => this.hud.showProps(
        mine.map((i) => {
          const m = s.tiles[i].mortgaged;
          return {
            name: BOARD[i].name, info: `投入 ¥${investedValue(s, i)} 万${m ? ' · 抵押中' : ` · 过路费 ¥${tollOf(s, i)} 万`}`,
            action: m ? `赎回 -¥${redeemCost(s, i)}万` : `抵押 +¥${mortgageValue(s, i)}万`,
            can: m ? s.seats[this.me].cash >= redeemCost(s, i) : true,
            mortgaged: m,
            go: () => press({ type: m ? 'redeem' : 'mortgage', tile: i }),
          };
        }),
      ),
    }];
  }

  private propsOf(s: GameState, seat: number) { return s.tiles.filter((t) => t.owner === seat).length; }
  private layout(animate: boolean) {
    const vm = this.vm!;
    this.world.layoutAll(vm.seats.map((p) => p.pos), vm.seats.map((p) => !p.bankrupt), animate);
  }
  private redrawTiles() { BOARD.forEach((_, i) => this.world.drawTileTop(i, this.vm!)); }
  private tokStage(seat: number): [number, number] {
    const t = this.world.tokens[seat];
    return this.world.toStage(t.x, t.y - 60);
  }
  private addCash(seat: number, d: number) {
    const p = this.vm!.seats[seat];
    p.cash += d;
    this.hud.setCash(seat, p.cash);
  }

  // ───────────────────────── 事件演出 ─────────────────────────
  private async play(e: GameEvent) {
    const vm = this.vm!, W = this.world, H = this.hud;
    switch (e.t) {
      case 'turn': {
        vm.turn = e.seat; vm.round = e.round;
        H.setRound(e.round, vm.maxRounds);
        W.tokens.forEach((t, i) => t.setActive(i === e.seat));
        H.setTurn(e.seat, e.seat === this.me ? '轮到你' : '行动中…');
        if (e.seat === this.me) { H.toast('轮到你了！', GRAD.gold); AU.play('turn'); }
        else H.setRollWaiting(vm.seats[e.seat].name, SEAT_COLORS[e.seat], charUrl(vm.seats[e.seat].charId));
        await W.camTo(0, 0, 1, 400);
        await sleep(250);
        break;
      }
      case 'roll': {
        const z = ZONES[e.zone];
        if (e.seat !== this.me) {
          H.chipText(e.seat, `瞄准 ${z.lo}–${z.hi} · 控骰 ${Math.round(controlOf(vm.seats[e.seat]) * 100)}%`);
          await sleep(350);
        }
        await H.rollDice(e.dice[0], e.dice[1]);
        AU.play(e.hit ? 'hit' : 'miss');
        H.toast(e.hit ? `命中 ${z.lo}–${z.hi} 区间！` : `偏离区间 · 掷出 ${e.dice[0] + e.dice[1]}`, e.hit ? GRAD.green : GRAD.gray);
        H.chipText(e.seat, `前进 ${e.dice[0] + e.dice[1]} 步`);
        await sleep(450);
        break;
      }
      case 'doubles':
        AU.play('double');
        H.toast(e.count >= 3 ? '三连双数！被风暴卷走…' : '双数！可以再掷一次', GRAD.gold);
        await sleep(650);
        break;
      case 'move': await this.playMove(e.seat, e.path, e.via); break;
      case 'salary': {
        AU.play('salary');
        H.floatText(...this.tokStage(e.seat), `+¥${e.amount}万 月薪`, '#fff36b');
        this.addCash(e.seat, e.amount);
        await sleep(400);
        break;
      }
      case 'island':
        AU.play('island');
        vm.seats[e.seat].islandTurns = e.turns;
        H.toast(`漂流到无人岛 · 停留 ${e.turns} 回合（掷双数可逃脱）`, GRAD.blue);
        await sleep(1000);
        break;
      case 'islandStay':
        H.toast(e.left > 0 ? `还在无人岛 · 剩余 ${e.left} 回合` : '下回合离开无人岛', GRAD.blue);
        await sleep(800);
        break;
      case 'islandEscape':
        AU.play('hit');
        H.toast('掷出双数，成功逃离无人岛！', GRAD.green);
        await sleep(700);
        break;
      case 'pay': await this.playPay(e.from, e.to, e.amount, e.tile, e.reason); break;
      case 'shieldUsed':
        AU.play('card');
        H.toast('免单券生效：本次过路费全免', GRAD.purple);
        await sleep(800);
        break;
      case 'buy': {
        AU.play('cash');
        this.addCash(e.seat, -e.cost);
        await H.coins(H.chipPos(e.seat), this.bldStage(e.tile), 4, coinUrl());
        vm.tiles[e.tile] = { owner: e.seat, lv: e.lv, mortgaged: false };
        AU.play('build');
        W.setBuilding(e.tile, vm, true); this.redrawTiles();
        W.puffs(...buildingAnchor(e.tile));
        H.setProps(e.seat, this.propsOf(vm, e.seat));
        H.floatText(...this.tokStage(e.seat), BOARD[e.tile].kind === 'tour' ? '买下观光地！' : `建成${LV_NAME[e.lv]}！`, '#fff');
        await sleep(500);
        break;
      }
      case 'upgrade': {
        if (e.cost) { AU.play('cash'); this.addCash(e.seat, -e.cost); await H.coins(H.chipPos(e.seat), this.bldStage(e.tile), 4, coinUrl()); }
        else { AU.play('card'); }
        vm.tiles[e.tile].lv = e.lv;
        AU.play('build');
        W.setBuilding(e.tile, vm, true); this.redrawTiles();
        W.puffs(...buildingAnchor(e.tile));
        H.toast(`${BOARD[e.tile].name} 升级为${LV_NAME[e.lv]}`, GRAD.green);
        await sleep(600);
        break;
      }
      case 'takeover': {
        AU.play('takeover');
        H.toast(`${vm.seats[e.seat].name} 收购了 ${BOARD[e.tile].name}！`, GRAD.gold);
        this.addCash(e.seat, -e.cost);
        await H.coins(H.chipPos(e.seat), H.chipPos(e.from), 6, coinUrl());
        this.addCash(e.from, e.cost);
        vm.tiles[e.tile].owner = e.seat;
        W.setBuilding(e.tile, vm, true); this.redrawTiles();
        H.setProps(e.seat, this.propsOf(vm, e.seat)); H.setProps(e.from, this.propsOf(vm, e.from));
        await sleep(300);
        break;
      }
      case 'sell':
        vm.tiles[e.tile] = { owner: null, lv: 0, mortgaged: false };
        this.addCash(e.seat, e.amount);
        W.setBuilding(e.tile, vm, false); this.redrawTiles();
        H.floatText(...this.tokStage(e.seat), `变卖 ${BOARD[e.tile].name} +¥${e.amount}万`, '#ffd166');
        await sleep(450);
        break;
      case 'bankrupt':
        AU.play('ouch');
        vm.seats[e.seat].bankrupt = true;
        vm.tiles.forEach((t, i) => { if (t.owner === e.seat) { vm.tiles[i] = { owner: null, lv: 0, mortgaged: false }; W.setBuilding(i, vm, false); } });
        this.redrawTiles();
        H.setBankrupt(e.seat);
        H.toast(`${vm.seats[e.seat].name} 破产出局`, GRAD.gray);
        this.layout(true);
        await sleep(1300);
        break;
      case 'card':
        AU.play('card');
        H.toast(`机会卡 · ${e.text}`, GRAD.purple);
        await sleep(1300);
        break;
      case 'bonus':
        H.floatText(...this.tokStage(e.seat), `+¥${e.amount}万`, '#7cff6b');
        this.addCash(e.seat, e.amount);
        await sleep(450);
        break;
      case 'festival':
        AU.play('card');
        vm.festivalTile = e.tile; this.redrawTiles();
        H.toast(`环球节庆：${BOARD[e.tile].name} 过路费 ×2`, GRAD.purple);
        await sleep(900);
        break;
      case 'airport':
        AU.play('card');
        vm.seats[e.seat].flyNext = true;
        H.toast('环球航班：下回合可飞往任意格', GRAD.green);
        await sleep(900);
        break;
      case 'itemGained':
        H.toast(`获得道具：${ITEMS[e.item].name}`, GRAD.green);
        await sleep(500);
        break;
      case 'itemUsed':
        AU.play('card');
        H.toast(`${vm.seats[e.seat].name} 使用了 ${ITEMS[e.item].name}`, GRAD.purple);
        await sleep(800);
        break;
      case 'skillUsed':
        AU.play('card');
        H.toast(`${vm.seats[e.seat].name} 发动技能「${e.text}」`, GRAD.gold);
        await sleep(900);
        break;
      case 'roadblockPlaced':
        H.toast(`${BOARD[e.tile].name} 放置了路障`, GRAD.purple);
        await sleep(700);
        break;
      case 'roadblockHit':
        H.toast(`${vm.seats[e.seat].name} 被路障拦停在 ${BOARD[e.tile].name}`, GRAD.purple);
        await sleep(900);
        break;
      case 'demolish':
        vm.tiles[e.tile].lv = e.lv;
        W.setBuilding(e.tile, vm, e.lv > 0); this.redrawTiles();
        H.toast(`${BOARD[e.tile].name} 被强拆降为${LV_NAME[e.lv]}`, GRAD.purple);
        await sleep(900);
        break;
      case 'globalEvent':
        vm.globalEvent = e.id === 'none' ? null : { id: e.id, untilRound: e.round };
        H.setGlobalEvent(e.id);
        if (e.id !== 'none') {
          AU.play('card');
          H.toast(`全局事件：${GLOBAL_EVENTS[e.id].name} · ${GLOBAL_EVENTS[e.id].desc}`, GRAD.purple);
          this.redrawTiles();
          await sleep(900);
        }
        break;
      case 'auctionStart':
        AU.play('card');
        H.toast(`${vm.seats[e.seat].name} 放弃购买 ${BOARD[e.tile].name} → 开始竞拍（起拍 ¥${e.start} 万）`, GRAD.gold);
        await sleep(900);
        break;
      case 'auctionBid':
        AU.play('cash');
        H.toast(`${vm.seats[e.seat].name} 出价 ¥${e.amount} 万`, GRAD.blue);
        H.chipText(e.seat, `出价 ¥${e.amount} 万`);
        await sleep(700);
        break;
      case 'auctionPass':
        H.toast(`${vm.seats[e.seat].name} 弃拍`, GRAD.gray);
        await sleep(450);
        break;
      case 'auctionWin': {
        AU.play('takeover');
        this.addCash(e.seat, -e.amount);
        await H.coins(H.chipPos(e.seat), this.bldStage(e.tile), 4, coinUrl());
        vm.tiles[e.tile] = { owner: e.seat, lv: 0, mortgaged: false };
        W.setBuilding(e.tile, vm, true); this.redrawTiles();
        H.setProps(e.seat, this.propsOf(vm, e.seat));
        H.toast(`${vm.seats[e.seat].name} 以 ¥${e.amount} 万拍得 ${BOARD[e.tile].name}`, GRAD.gold);
        await sleep(500);
        break;
      }
      case 'auctionFail':
        H.toast(`${BOARD[e.tile].name} 流拍`, GRAD.gray);
        await sleep(600);
        break;
      case 'mortgage':
        AU.play('cash');
        vm.tiles[e.tile].mortgaged = true; this.redrawTiles();
        this.addCash(e.seat, e.amount);
        H.floatText(...this.tokStage(e.seat), `抵押 ${BOARD[e.tile].name} +¥${e.amount}万`, '#ffd166');
        await sleep(700);
        break;
      case 'redeem':
        AU.play('cash');
        vm.tiles[e.tile].mortgaged = false; this.redrawTiles();
        this.addCash(e.seat, -e.cost);
        H.floatText(...this.tokStage(e.seat), `赎回 ${BOARD[e.tile].name} -¥${e.cost}万`, '#7cff6b');
        await sleep(700);
        break;
      case 'prompt':
        if (e.pending.seat !== this.me) { H.chipText(e.pending.seat, e.pending.kind === 'auction' ? '竞拍出价中…' : '思考中…'); }
        break;
      case 'decline':
        break;
      case 'end':
        await sleep(400);
        this.showEnd(e.winner, e.reason);
        break;
    }
  }

  private bldStage(i: number): [number, number] {
    const [x, y] = buildingAnchor(i);
    return this.world.toStage(x, y - 20);
  }

  private async playMove(seat: number, path: number[], via: 'walk' | 'fly' | 'warp') {
    const vm = this.vm!, W = this.world, tk = W.tokens[seat];
    const dest = path[path.length - 1];
    if (via !== 'walk') {
      AU.play(via === 'fly' ? 'takeover' : 'island');
      const [x, y] = tokenAnchor(dest);
      await tk.warp(x, y, via === 'fly');
      vm.seats[seat].pos = dest;
      this.layout(true);
      return;
    }
    const flash = W.flashTile(dest, SEAT_COLORS[seat]);
    W.pulse(flash);
    for (let k = 0; k < path.length; k++) {
      const [x, y] = tokenAnchor(path[k]);
      AU.play('hop', k);
      void W.camTo(x, y - 40, 1.45, 240);
      await tk.hop(x, y, path.length - k);
    }
    tk.endMove();
    flash.destroy();
    vm.seats[seat].pos = dest;
    AU.play('land');
    W.puffs(...tokenAnchor(dest));
    this.layout(true);
    await sleep(200);
  }

  private async playPay(from: number, to: number | null, amount: number, tile: number | null, reason: string) {
    const vm = this.vm!, W = this.world, H = this.hud;
    if (reason === 'toll' && to != null && tile != null) {
      AU.play('ouch');
      H.toast(`${vm.seats[from].name} 踩到 ${vm.seats[to].name} 的 ${BOARD[tile].name}！`);
      W.tokens[from].setSad(true);
      await W.tokens[from].shake();
    } else if (reason === 'tax') {
      AU.play('tax'); H.toast(`税务局：缴纳资产税 ¥${amount}万`, GRAD.blue);
    } else {
      AU.play('pay');
    }
    const a = this.tokStage(from);
    H.floatText(a[0], a[1] - 30, `-¥${amount}万`, '#ff5a4a');
    this.addCash(from, -amount);
    H.chipFx(from, 'hit');
    await H.coins(a, to != null ? H.chipPos(to) : BANK, Math.min(8, 3 + Math.ceil(amount / 20)), coinUrl());
    if (to != null) {
      AU.play('gain');
      this.addCash(to, amount);
      H.chipFx(to, 'gain');
      const b = H.chipPos(to);
      H.floatText(b[0], b[1] + (to === 1 || to === 2 ? 50 : -50), `+¥${amount}万`, '#7cff6b');
      void W.tokens[to].cheer();
    }
    await sleep(500);
    W.tokens[from].setSad(false);
  }

  // ───────────────────────── 本地玩家输入 ─────────────────────────
  private async input(m: SyncMsg) {
    const s = m.state;
    if (s.phase === 'ended' || actorOf(s) !== this.me) return;
    const seq = s.seq;
    if (s.phase === 'roll') {
      this.acts(s, true);
      const again = s.seats[this.me].doubles > 0;
      const zone = await this.hud.waitRoll(controlOf(s.seats[this.me]), again, (z) => this.previewZone(z));
      if (zone < 0 || this.latest?.state.seq !== seq) return;
      this.src.send({ type: 'roll', zone });
      return;
    }
    if (s.phase === 'choose' && s.pending && s.pending.seat === this.me) {
      const timeout = m.deadline ? Math.max(1000, m.deadline - Date.now()) : TURN_TIMEOUT_MS.choose;
      const opt = await this.hud.choose(this.sheetSpec(s, s.pending), timeout);
      if (opt === -2 || this.latest?.state.seq !== seq) return;
      this.src.send({ type: 'choose', option: opt });
    }
  }

  private previewZone(z: number | null) {
    this.preview.forEach((g) => g.destroy());
    this.preview = [];
    if (z == null) return;
    const pos = this.vm!.seats[this.me].pos, zone = ZONES[z];
    for (let n = zone.lo; n <= zone.hi; n++) {
      const g = this.world.flashTile((pos + n) % BOARD.length, zone.color, 0.55);
      this.preview.push(g);
    }
  }

  /** 选目标的道具：高亮合法格，点选棋盘格即选定；点非法格只提示、不消耗道具 */
  private mountBoardPick(p: Pending, pick: (k: number) => void) {
    const legal = new Map<number, number>();
    p.options.forEach((o, k) => legal.set(o.value, k));
    const marks = [...legal.keys()].map((i) => {
      const g = this.world.flashTile(i, '#38bdf8', 0.5);
      this.world.pulse(g);
      return g;
    });
    const canvas = this.world.app.canvas;
    const onDown = (e: PointerEvent) => {
      const i = this.world.tileAt(e.clientX, e.clientY);
      if (i < 0) return;
      const k = legal.get(i);
      if (k != null) pick(k);
      else this.hud.toast(`「${BOARD[i].name}」不能作为目标`);
    };
    canvas.addEventListener('pointerdown', onDown);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      marks.forEach((g) => g.destroy());
    };
  }

  private sheetSpec(s: GameState, p: Pending): SheetSpec {
    const i = p.tile ?? 0, d = BOARD[i];
    const col = GROUP_COLOR[(d.group ?? d.kind) as keyof typeof GROUP_COLOR] ?? '#3b82f6';
    const label = (k: number) => p.options[k].label;
    const lvImg = (lv: number) => (lv > 0 ? bldUrl(lv) : undefined);
    switch (p.kind) {
      case 'buy': {
        if (d.kind === 'tour') {
          const n = s.tiles.filter((t, x) => t.owner === this.me && BOARD[x].kind === 'tour').length;
          return { title: d.name, color: col, kind: '观光地 · 集齐 4 处即「观光地独占」胜利', rows: [['地价', `¥${d.price} 万`], ['已拥有观光地', `${n} / 4`]], pending: p, optionLabel: label };
        }
        const g = GROUPS[d.group!], own = g.filter((x) => s.tiles[x].owner === this.me).length;
        return {
          title: d.name, color: col, kind: '空地 · 选择建造等级', img: lvImg(p.options[p.options.length - 1].value),
          rows: [['地价', `¥${d.price} 万`], ['同色组', `${own} / ${g.length} 已拥有`], ['现金', `¥${s.seats[this.me].cash} 万`]],
          pending: p, optionLabel: label,
        };
      }
      case 'upgrade':
        return {
          title: d.name, color: col, kind: `自己的地产 · 当前${LV_NAME[s.tiles[i].lv]}`, img: lvImg(p.options[p.options.length - 1].value),
          rows: [['当前过路费', `¥${tollOf(s, i)} 万`], ['现金', `¥${s.seats[this.me].cash} 万`]], pending: p, optionLabel: label,
        };
      case 'takeover': {
        const owner = s.seats[s.tiles[i].owner!];
        return {
          title: `收购 ${d.name}`, color: '#e11d48', kind: `${owner.name} 的${LV_NAME[s.tiles[i].lv]} · 支付 2 倍投入即可收购`, img: lvImg(s.tiles[i].lv),
          rows: [['收购后过路费', `¥${tollOf(s, i)} 万`], ['地标不可被收购', '升到地标即锁定']], pending: p, optionLabel: label,
        };
      }
      case 'festival':
        return { title: '环球节庆', color: '#ec4899', kind: '选择一座自己的城市，过路费 ×2', rows: [], pending: p, optionLabel: (k) => BOARD[p.options[k].value].name, grid: true };
      case 'item':
        return {
          title: ITEMS[p.item!].name, color: '#0ea5e9',
          kind: p.item === 'dice' ? ITEMS[p.item!].desc : `${ITEMS[p.item!].desc} · 可直接点击棋盘上发亮的目标格`,
          rows: [], pending: p, grid: true,
          optionLabel: (k) => (p.item === 'dice' ? `${p.options[k].value} 点` : BOARD[p.options[k].value].name),
          onMount: p.item === 'dice' ? undefined : (pick) => this.mountBoardPick(p, pick),
        };
      case 'auction': {
        const au = p.auction!;
        const holder = au.highSeat != null ? `${s.seats[au.highSeat].name} ¥${au.high} 万` : '暂无';
        return {
          title: `竞拍 ${d.name}`, color: '#f59e0b', kind: `${s.seats[au.starter].name} 放弃购买 · 价高者以空地成交`,
          rows: [['地价', `¥${d.price} 万`], ['起拍价', `¥${au.start} 万`], ['当前最高价', holder], ['现金', `¥${s.seats[this.me].cash} 万`]],
          pending: p, optionLabel: label,
        };
      }
      case 'fly':
        return { title: '环球航班', color: '#16a34a', kind: '选择目的地（经过起点可领月薪）', rows: [], pending: p, optionLabel: (k) => BOARD[p.options[k].value].name, grid: true };
    }
  }

  // ───────────────────────── 结算 ─────────────────────────
  private showEnd(winner: number, reason: WinReason) {
    const s = this.vm!;
    const rows = s.seats.map((p, i) => ({
      name: p.name, color: SEAT_COLORS[i], img: charUrl(p.charId),
      value: totalAssets(s, i), tag: i === winner ? '胜利' : p.bankrupt ? '破产' : '',
      w: i === winner ? 1 : 0,
    })).sort((a, b) => b.w - a.w || b.value - a.value);
    const kind = this.src.kind;
    const watching = kind === 'replay' || kind === 'spectate';
    const meWin = winner === this.me;
    if (meWin || watching) AU.play('win'); else AU.play('miss');
    if (!watching && this.onEnded) void this.src.exportReplay().then((rec) => this.onEnded!(rec)).catch(() => {});
    const doExport = async () => {
      const rec = await this.src.exportReplay();
      const url = URL.createObjectURL(new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `dice-tycoon-replay-${rec.seed}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
    this.hud.showResult(meWin ? '大获全胜' : `${s.seats[winner].name} 获胜`, WIN_TEXT[reason], rows,
      kind === 'replay' ? () => {} : this.onRestart, doExport,
      {
        againLabel: kind === 'replay' ? '返回回放' : kind === 'spectate' ? '返回菜单' : undefined,
        onReplay: !watching && this.onWatchReplay ? async () => this.onWatchReplay!(await this.src.exportReplay()) : undefined,
      });
  }
}

// 资源路径
const base = () => import.meta.env.BASE_URL + 'assets/';
export const charUrl = (c: string) => `${base()}${CHAR_TEX[c]}.png`;
const coinUrl = () => `${base()}coin.png`;
const bldUrl = (lv: number) => `${base()}bld${lv}.png`;
