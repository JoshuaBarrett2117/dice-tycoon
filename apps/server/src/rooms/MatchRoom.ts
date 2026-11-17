import { Room, type Client } from '@colyseus/core';
import {
  CHARACTERS, CHAR_IDS, TURN_TIMEOUT_MS,
  ReplayRecorder, actorOf, animBudget, applyAction, botAction, createGame, openingEvents,
  type Action, type CharId, type GameEvent, type GameState, type JoinOptions, type LobbySeat,
} from '@dt/shared';

const BOT_NAMES = ['阿柚', '老周', '阿星', '小麦', '大熊'];
const RECONNECT_SECONDS = 30;

/**
 * 一局对战房间。
 * - 等待阶段：最多 4 人入座，房主发 start 后空位由机器人补齐。
 * - 对局阶段：只接受当前座位玩家的 action；超时或掉线由机器人托管。
 * - 所有结算都在服务端用 @dt/shared 规则引擎完成，客户端只做表现。
 */
export class MatchRoom extends Room {
  maxClients = 4;

  private seats: LobbySeat[] = [];
  private host: string | null = null;
  private game: GameState | null = null;
  private recorder: ReplayRecorder | null = null;
  /** sessionId → 透传的 accountId（只携带，不校验） */
  private accounts = new Map<string, string>();
  private deadline: number | null = null;
  private timer: { clear(): void } | null = null;

  onCreate() {
    this.onMessage('start', (client) => this.handleStart(client));
    this.onMessage('action', (client, action: Action) => this.handleAction(client, action));
    this.onMessage('exportReplay', (client) => {
      if (!this.recorder || !this.game) { client.send('error', { message: '对局尚未开始，无法导出回放' }); return; }
      client.send('replay', this.recorder.toRecord(this.game));
    });
  }

  onJoin(client: Client, options: Partial<JoinOptions> = {}) {
    if (this.game) throw new Error('对局已开始');
    const charId: CharId = CHAR_IDS.includes(options.charId as CharId) ? (options.charId as CharId) : 'jin';
    const name = String(options.name || '玩家').slice(0, 12);
    if (typeof options.accountId === 'string' && options.accountId) this.accounts.set(client.sessionId, options.accountId.slice(0, 64));
    this.seats.push({ sessionId: client.sessionId, name, charId, isBot: false, ready: true, connected: true });
    if (!this.host) this.host = client.sessionId;
    this.broadcastLobby();
  }

  async onDrop(client: Client) {
    const seat = this.seatOf(client.sessionId);
    if (seat < 0) return;
    if (!this.game) return; // 等待阶段直接走 onLeave
    this.seats[seat].connected = false;
    this.scheduleNext();
    try {
      await this.allowReconnection(client, RECONNECT_SECONDS);
    } catch {
      /* 超时未重连：保持机器人托管 */
    }
  }

  onReconnect(client: Client) {
    const seat = this.seatOf(client.sessionId);
    if (seat < 0) return;
    this.seats[seat].connected = true;
    client.send('seat', { seat });
    if (this.game) client.send('sync', { state: this.game, events: [], deadline: this.deadline });
    this.scheduleNext();
  }

  onLeave(client: Client) {
    const seat = this.seatOf(client.sessionId);
    if (seat < 0) return;
    if (!this.game) {
      this.seats.splice(seat, 1);
      if (this.host === client.sessionId) this.host = this.seats.find((s) => !s.isBot)?.sessionId ?? null;
      this.broadcastLobby();
      return;
    }
    this.seats[seat].connected = false;
    this.seats[seat].sessionId = null;
    this.scheduleNext();
  }

  onDispose() {
    this.timer?.clear();
  }

  // ───────────────────────── 等待 → 开局 ─────────────────────────
  private handleStart(client: Client) {
    if (this.game) return;
    if (client.sessionId !== this.host) { client.send('error', { message: '只有房主可以开始' }); return; }
    const used = new Set(this.seats.map((s) => s.charId));
    let b = 0;
    while (this.seats.length < 4) {
      const charId = CHAR_IDS.find((c) => !used.has(c)) ?? 'panda';
      used.add(charId);
      this.seats.push({ sessionId: null, name: BOT_NAMES[b++] ?? `机器人${b}`, charId, isBot: true, ready: true, connected: true });
    }
    this.lock();
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const cfg = {
      seed,
      seats: this.seats.map((s, i) => ({
        id: s.sessionId ?? `bot-${i}`, name: s.name, charId: s.charId, isBot: s.isBot,
        ...(s.sessionId && this.accounts.has(s.sessionId) ? { accountId: this.accounts.get(s.sessionId) } : {}),
      })),
    };
    this.game = createGame(cfg);
    this.recorder = new ReplayRecorder(cfg);
    this.clients.forEach((c) => c.send('seat', { seat: this.seatOf(c.sessionId) }));
    this.broadcastLobby();
    this.publish(openingEvents(this.game));
  }

  // ───────────────────────── 对局 ─────────────────────────
  private handleAction(client: Client, action: Action) {
    if (!this.game) return;
    const seat = this.seatOf(client.sessionId);
    this.apply(seat, action, client);
  }

  private apply(seat: number, action: Action, client?: Client) {
    if (!this.game) return;
    const r = applyAction(this.game, seat, action);
    if (!r.ok) { client?.send('error', { message: r.error }); return; }
    this.recorder?.push(seat, action);
    this.game = r.state;
    this.publish(r.events);
  }

  private publish(events: GameEvent[]) {
    const g = this.game!;
    const anim = animBudget(events);
    this.deadline = g.phase === 'ended' ? null : Date.now() + anim + TURN_TIMEOUT_MS[g.phase === 'choose' ? 'choose' : 'roll'];
    this.broadcast('sync', { state: g, events, deadline: this.deadline });
    this.scheduleNext(anim);
  }

  /** 机器人/掉线座位：动画播完后自动行动；真人座位：到时限后托管一次 */
  private scheduleNext(animMs = 0) {
    this.timer?.clear();
    const g = this.game;
    if (!g || g.phase === 'ended') {
      if (g?.phase === 'ended') this.clock.setTimeout(() => this.disconnect(), 60_000);
      return;
    }
    const seat = actorOf(g); // 竞拍时是当前出价人
    const auto = this.seats[seat].isBot || !this.seats[seat].connected;
    const wait = auto ? animMs + 500 + Math.random() * 500 : Math.max(0, (this.deadline ?? Date.now()) - Date.now());
    const seq = g.seq;
    this.timer = this.clock.setTimeout(() => {
      if (!this.game || this.game.seq !== seq) return;
      const who = actorOf(this.game);
      this.apply(who, botAction(this.game, who));
    }, wait);
  }

  // ───────────────────────── 工具 ─────────────────────────
  private seatOf(sessionId: string) {
    return this.seats.findIndex((s) => s.sessionId === sessionId);
  }

  private broadcastLobby() {
    this.broadcast('lobby', { seats: this.seats, hostSessionId: this.host, roomId: this.roomId });
    this.setMetadata({ players: this.seats.filter((s) => !s.isBot).length, started: !!this.game } as never);
  }
}

export { CHARACTERS };
