import { Client, type Room } from '@colyseus/sdk';
import {
  ROOM_NAME, ReplayRecorder, actorOf, animBudget, applyAction, botAction, createGame, openingEvents,
  type Action, type CharId, type GameEvent, type GameRecord, type GameState, type LobbySeat, type SeatConfig,
} from '@dt/shared';

export interface SyncMsg { state: GameState; events: GameEvent[]; deadline: number | null }

/** 对局数据来源：单机（本地引擎 + 机器人）或在线（对战服） */
export interface GameSource {
  mySeat: number;
  onSync(cb: (m: SyncMsg) => void): void;
  send(a: Action): void;
  /** 导出本局回放（seed + 座位配置 + 操作序列） */
  exportReplay(): Promise<GameRecord>;
  dispose(): void;
}

// ───────────────────────── 单机 ─────────────────────────
export class LocalSource implements GameSource {
  mySeat = 0;
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
export interface LobbyMsg { seats: LobbySeat[]; hostSessionId: string | null; roomId: string }

export class NetSource implements GameSource {
  mySeat = -1;
  private cb: ((m: SyncMsg) => void) | null = null;
  private backlog: SyncMsg[] = [];
  private lastLobby: LobbyMsg | null = null;
  private lobbyCb: ((m: LobbyMsg) => void) | null = null;
  private errCb: ((m: { message: string }) => void) | null = null;
  private replayCb: ((r: GameRecord) => void) | null = null;

  private constructor(public room: Room) {
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
