import { Client, type Room } from '@colyseus/sdk';
import { clock } from '../core/tween';
import {
  REPLAY_PLAYER, ROOM_NAME, ReplayPlayer, ReplayRecorder, actorOf, animBudget, applyAction, botAction, createGame, openingEvents,
  type Action, type CharId, type GameEvent, type QuickStatus, type GameRecord, type GameState, type LobbySeat, type SeatConfig,
} from '@dt/shared';

export interface SyncMsg { state: GameState; events: GameEvent[]; deadline: number | null }

/** 对局数据来源：单机（本地引擎 + 机器人）或在线（对战服） */
export interface GameSource {
  mySeat: number;
  onSync(cb: (m: SyncMsg) => void): void;
  send(a: Action): void;
  /** 导出本局回放（seed + 座位配置 + 操作序列） */
  exportReplay(): Promise<GameRecord>;
  /** 数据源类型：影响结算页按钮等文案 */
  kind?: 'solo' | 'online' | 'replay' | 'spectate';
  /** 回放：跳转（不播动画，直接把画面重置到某个状态） */
  onJump?(cb: (state: GameState) => void): void;
  /** 导演把队列里的演出播完后调用，回放据此排下一步 */
  notifyIdle?(): void;
  dispose(): void;
}

// ───────────────────────── 单机 ─────────────────────────
export class LocalSource implements GameSource {
  mySeat = 0;
  kind = 'solo' as const;
  private state: GameState;
  private cb: ((m: SyncMsg) => void) | null = null;
  private timer = 0;

  private recorder: ReplayRecorder;

  constructor(seats: SeatConfig[]) {
    const cfg = { seed: (Math.random() * 2 ** 32) >>> 0, seats };
    this.state = createGame(cfg);
    this.recorder = new ReplayRecorder(cfg);
  }

  exportReplay() { return Promise.resolve(this.recorder.toRecord(this.state)); }

  onSync(cb: (m: SyncMsg) => void) {
    this.cb = cb;
    this.emit(openingEvents(this.state));
  }

  send(a: Action) { this.apply(actorOf(this.state) === this.mySeat ? this.mySeat : -1, a); }

  private apply(seat: number, a: Action) {
    const r = applyAction(this.state, seat, a);
    if (!r.ok) { console.warn('[local] 非法操作', r.error); return; }
    this.recorder.push(seat, a);
    this.state = r.state;
    this.emit(r.events);
  }

  private emit(events: GameEvent[]) {
    this.cb?.({ state: this.state, events, deadline: null });
    clearTimeout(this.timer);
    const s = this.state;
    const who = actorOf(s); // 竞拍时是当前出价人
    if (s.phase !== 'ended' && s.seats[who].isBot) {
      this.timer = window.setTimeout(() => this.apply(who, botAction(this.state, who)), animBudget(events) + 600);
    }
  }

  dispose() { clearTimeout(this.timer); this.cb = null; }
}

// ───────────────────────── 在线 ─────────────────────────
export interface LobbyMsg { seats: LobbySeat[]; hostSessionId: string | null; roomId: string; started: boolean; quick?: QuickStatus }

export class NetSource implements GameSource {
  mySeat = -1;
  kind: 'online' | 'spectate' = 'online';
  private cb: ((m: SyncMsg) => void) | null = null;
  private backlog: SyncMsg[] = [];
  private lastLobby: LobbyMsg | null = null;
  private lobbyCb: ((m: LobbyMsg) => void) | null = null;
  private errCb: ((m: { message: string }) => void) | null = null;
  private replayCb: ((r: GameRecord) => void) | null = null;
  private specCb: ((m: { count: number; max: number }) => void) | null = null;
  private lastSpec: { count: number; max: number } | null = null;

  private constructor(public room: Room) {
    room.onMessage('spectators', (m: { count: number; max: number }) => { this.lastSpec = m; this.specCb?.(m); });
    room.onMessage('seat', (m: { seat: number }) => { this.mySeat = m.seat; });
    room.onMessage('sync', (m: SyncMsg) => { if (this.cb) this.cb(m); else this.backlog.push(m); });
    room.onMessage('lobby', (m: LobbyMsg) => { this.lastLobby = m; this.lobbyCb?.(m); });
    room.onMessage('replay', (m: GameRecord) => { this.replayCb?.(m); this.replayCb = null; });
    room.onMessage('error', (m: { message: string }) => { console.warn('[server]', m.message); this.errCb?.(m); });
  }

  static async connect(url: string, opts: { name: string; charId: CharId }, roomId?: string) {
    const client = new Client(url);
    const room = roomId ? await client.joinById(roomId, opts) : await client.create(ROOM_NAME, opts);
    return new NetSource(room);
  }

  /** 快速匹配：加入（或创建）匹配房，凑满 4 人或超时补位后自动开局；离开房间即取消匹配 */
  static async connectQuick(url: string, opts: { name: string; charId: CharId }) {
    const client = new Client(url);
    const room = await client.joinOrCreate(ROOM_NAME, { ...opts, quick: true });
    return new NetSource(room);
  }

  /** 观战：凭房间号加入已开局的房间，不占座位、不能操作 */
  static async spectate(url: string, opts: { name: string; charId: CharId }, roomId: string) {
    const client = new Client(url);
    const room = await client.joinById(roomId, { ...opts, spectate: true });
    const net = new NetSource(room);
    net.kind = 'spectate';
    return net;
  }

  onSpectators(cb: (m: { count: number; max: number }) => void) { this.specCb = cb; if (this.lastSpec) cb(this.lastSpec); }

  get sessionId() { return this.room.sessionId; }
  onLobby(cb: (m: LobbyMsg) => void) { this.lobbyCb = cb; if (this.lastLobby) cb(this.lastLobby); }
  onError(cb: (m: { message: string }) => void) { this.errCb = cb; }
  start() { this.room.send('start', {}); }
  exportReplay() {
    return new Promise<GameRecord>((res, rej) => {
      const t = setTimeout(() => { this.replayCb = null; rej(new Error('导出超时')); }, 8000);
      this.replayCb = (r) => { clearTimeout(t); res(r); };
      this.room.send('exportReplay', {});
    });
  }

  onSync(cb: (m: SyncMsg) => void) {
    this.cb = cb;
    this.backlog.splice(0).forEach(cb);
  }
  send(a: Action) { this.room.send('action', a); }
  dispose() { this.cb = null; void this.room.leave(); }
}

// ───────────────────────── 回放 ─────────────────────────
export interface ReplayUiState { index: number; total: number; playing: boolean; speed: number }

/** 回放数据源：把 GameRecord 逐步喂给导演；支持播放 / 暂停 / 单步 / 调速 / 跳转 */
export class ReplaySource implements GameSource {
  mySeat = -1;
  kind = 'replay' as const;
  readonly player: ReplayPlayer;
  private cb: ((m: SyncMsg) => void) | null = null;
  private jumpCb: ((s: GameState) => void) | null = null;
  private uiCb: ((u: ReplayUiState) => void) | null = null;
  private timer = 0;
  private playing = false;
  /** 导演正在播放上一步的演出 */
  private busy = false;
  speed = 1;

  constructor(readonly record: GameRecord) {
    this.player = new ReplayPlayer(record);
  }

  get ui(): ReplayUiState { return { index: this.player.index, total: this.player.total, playing: this.playing, speed: this.speed }; }
  onUi(cb: (u: ReplayUiState) => void) { this.uiCb = cb; cb(this.ui); }
  private fire() { this.uiCb?.(this.ui); }

  onSync(cb: (m: SyncMsg) => void) {
    this.cb = cb;
    this.busy = true;
    cb({ state: this.player.frame.state, events: [], deadline: null });
  }
  onJump(cb: (s: GameState) => void) { this.jumpCb = cb; }
  send() { /* 回放不接受操作 */ }
  exportReplay() { return Promise.resolve(this.record); }
  dispose() { clearTimeout(this.timer); this.cb = null; this.jumpCb = null; this.uiCb = null; clock.scale = 1; }

  notifyIdle() {
    this.busy = false;
    if (!this.playing) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.advance(), REPLAY_PLAYER.gapMs / this.speed);
  }

  /** 播放下一步（带演出）；到末尾自动停 */
  private advance() {
    const f = this.player.next();
    if (!f) { this.playing = false; this.fire(); return; }
    this.busy = true;
    this.cb?.({ state: f.state, events: f.events, deadline: null });
    this.fire();
  }

  play() {
    if (this.player.atEnd) this.seek(0);
    this.playing = true;
    this.fire();
    if (!this.busy) this.advance();
  }
  pause() { this.playing = false; clearTimeout(this.timer); this.fire(); }
  toggle() { if (this.playing) this.pause(); else this.play(); }
  /** 单步前进（带演出） */
  stepForward() { this.pause(); this.advance(); }
  /** 单步后退：回到上一帧的状态（直接重置画面） */
  stepBack() { this.pause(); const f = this.player.prev(); if (f) this.jumpTo(f.state); }
  /** 跳转到指定 seq */
  seek(seq: number) { clearTimeout(this.timer); const f = this.player.seek(seq); this.jumpTo(f.state); }
  setSpeed(v: number) { this.speed = v; clock.scale = v; this.fire(); }

  private jumpTo(state: GameState) {
    this.busy = true;
    this.jumpCb?.(state);
    this.fire();
  }
}
