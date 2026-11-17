import { Room, type Client } from '@colyseus/core';
import {
  CHARACTERS, CHAR_IDS, SPECTATE, TURN_TIMEOUT_MS,
  BOT_DEFAULT_DIFFICULTY, MatchQueue, ReplayRecorder, actorOf, animBudget, applyAction, botAction, createGame, openingEvents,
  type Action, type CharId, type GameEvent, type GameState, type JoinOptions, type LobbySeat, type RoomBrief,
} from '@dt/shared';
import { registry } from '../registry';

const BOT_NAMES = ['阿柚', '老周', '阿星', '小麦', '大熊'];
const RECONNECT_SECONDS = 30;
/** 仅冒烟测试用：SMOKE_SPEED=20 把机器人的等待缩短 20 倍，让整局能在几十秒内打完（默认 1） */
const SPEED = Number(process.env.SMOKE_SPEED) > 0 ? Number(process.env.SMOKE_SPEED) : 1;

/**
 * 一局对战房间。
 * - 等待阶段：最多 4 人入座，房主发 start 后空位由机器人补齐。
 * - 快速匹配房（quick）：凑满 4 人立即开局；队首等候超时则机器人补位开局；玩家离开即取消匹配。
 * - 观战者（spectate）：对局开始后可加入，不占座位、不参与 actorOf，只收 sync / replay，任何操作都被拒绝。
 * - 对局阶段：只接受当前座位玩家的 action；超时或掉线由机器人托管。
 * - 所有结算都在服务端用 @dt/shared 规则引擎完成，客户端只做表现。
 */
export class MatchRoom extends Room {
  /** 4 个座位 + 观战席（观战者数量另在 onJoin 里限制） */
  maxClients = 4 + SPECTATE.maxSpectators;

  private seats: LobbySeat[] = [];
  private host: string | null = null;
  private game: GameState | null = null;
  private recorder: ReplayRecorder | null = null;
  /** sessionId → 透传的 accountId（只携带，不校验） */
  private accounts = new Map<string, string>();
  private deadline: number | null = null;
  private timer: { clear(): void } | null = null;
  /** 观战者的 sessionId（不在 seats 里） */
  private spectators = new Set<string>();
  /** 快速匹配房：排队逻辑在 shared 的 MatchQueue 里 */
  private queue: MatchQueue | null = null;
  private queueTimer: { clear(): void } | null = null;

  onCreate(options: Partial<JoinOptions> = {}) {
    if (options.quick) {
      const t = Number(process.env.MATCH_TIMEOUT_MS);
      this.queue = new MatchQueue(t > 0 ? { timeoutMs: t } : {});
      this.queueTimer = this.clock.setInterval(() => this.tickQueue(), 1000);
    }
    registry.add(this.roomId, () => this.brief());
    this.onMessage('start', (client) => {
      if (this.queue) { client.send('error', { message: '快速匹配房会自动开局' }); return; }
      this.handleStart(client);
    });
    this.onMessage('action', (client, action: Action) => this.handleAction(client, action));
    this.onMessage('exportReplay', (client) => {
      if (!this.recorder || !this.game) { client.send('error', { message: '对局尚未开始，无法导出回放' }); return; }
      client.send('replay', this.recorder.toRecord(this.game));
    });
  }

  onJoin(client: Client, options: Partial<JoinOptions> = {}) {
    if (options.spectate) { this.joinSpectator(client); return; }
    if (this.game) throw new Error('对局已开始');
    if (this.seats.filter((x) => !x.isBot).length >= 4) throw new Error('房间已满');
    const charId: CharId = CHAR_IDS.includes(options.charId as CharId) ? (options.charId as CharId) : 'jin';
    const name = String(options.name || '玩家').slice(0, 12);
    if (typeof options.accountId === 'string' && options.accountId) this.accounts.set(client.sessionId, options.accountId.slice(0, 64));
    this.seats.push({ sessionId: client.sessionId, name, charId, isBot: false, ready: true, connected: true });
    if (!this.host) this.host = client.sessionId;
    if (this.queue) this.queue.join(client.sessionId, Date.now());
    this.broadcastLobby();
    if (this.queue) this.clock.setTimeout(() => this.tickQueue(), 100);
  }

  private joinSpectator(client: Client) {
    if (!this.game) throw new Error('对局尚未开始，暂不能观战');
    if (this.spectators.size >= SPECTATE.maxSpectators) throw new Error('观战席已满');
    this.spectators.add(client.sessionId);
    client.send('sync', { state: this.game, events: [], deadline: this.deadline });
    this.broadcastSpectators();
  }

  async onDrop(client: Client) {
    if (this.spectators.has(client.sessionId)) return; // 观战者掉线直接走 onLeave
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
    if (this.spectators.delete(client.sessionId)) { this.broadcastSpectators(); return; }
    const seat = this.seatOf(client.sessionId);
    if (seat < 0) return;
    if (!this.game) {
      this.queue?.cancel(client.sessionId);
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
    this.queueTimer?.clear();
    registry.remove(this.roomId);
  }

  // ───────────────────────── 等待 → 开局 ─────────────────────────
  private handleStart(client: Client) {
    if (this.game) return;
    if (client.sessionId !== this.host) { client.send('error', { message: '只有房主可以开始' }); return; }
    this.startGame();
  }

  /** 快速匹配：满员或超时补位后开局 */
  private tickQueue() {
    if (!this.queue || this.game) return;
    const d = this.queue.poll(Date.now());
    if (d.kind === 'start') this.startGame();
    else this.broadcastLobby();
  }

  /** 空位由机器人补齐并开局（房主点开始 / 匹配满员或超时都走这里） */
  private startGame() {
    if (this.game) return;
    this.queueTimer?.clear();
    const used = new Set(this.seats.map((s) => s.charId));
    let b = 0;
    while (this.seats.length < 4) {
      const charId = CHAR_IDS.find((c) => !used.has(c)) ?? 'panda';
      used.add(charId);
      this.seats.push({ sessionId: null, name: BOT_NAMES[b++] ?? `机器人${b}`, charId, isBot: true, ready: true, connected: true });
    }
    // 不能 lock()：locked 的房间连 joinById 也会拒绝，观战者就进不来。
    // 改为 private：不再被 joinOrCreate / 公开列表匹配，但观战者仍可凭房间号加入。
    void this.setPrivate(true);
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const cfg = {
      seed,
      seats: this.seats.map((s, i) => ({
        id: s.sessionId ?? `bot-${i}`, name: s.name, charId: s.charId, isBot: s.isBot,
        ...(s.isBot ? { difficulty: BOT_DEFAULT_DIFFICULTY } : {}),
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
    if (this.spectators.has(client.sessionId)) { client.send('error', { message: '观战者不能操作' }); return; }
    const seat = this.seatOf(client.sessionId);
    if (seat < 0) { client.send('error', { message: '你不在本局座位上' }); return; }
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
    const wait = auto ? (animMs + 500 + Math.random() * 500) / SPEED : Math.max(0, (this.deadline ?? Date.now()) - Date.now());
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
    const q = this.queue && !this.game ? this.queue.peek(Date.now()) : null;
    this.broadcast('lobby', {
      seats: this.seats, hostSessionId: this.host, roomId: this.roomId, started: !!this.game,
      ...(q && q.kind === 'waiting' ? { quick: { waiting: q.waiting, size: q.size, remainingMs: Math.max(0, q.deadline - Date.now()) } } : {}),
    });
    // 注意 setMetadata 是整体替换：quick 必须带上，否则 joinOrCreate({quick}) 的 filterBy 就找不到这个房间了
    this.setMetadata({ players: this.seats.filter((s) => !s.isBot).length, started: !!this.game, ...(this.queue ? { quick: true } : {}) } as never);
  }

  private broadcastSpectators() {
    this.broadcast('spectators', { count: this.spectators.size, max: SPECTATE.maxSpectators });
  }

  /** 观战列表里的房间概览；匹配中的快速房不展示 */
  private brief(): RoomBrief | null {
    if (this.queue && !this.game) return null;
    return {
      roomId: this.roomId,
      started: !!this.game,
      spectatable: !!this.game && this.spectators.size < SPECTATE.maxSpectators,
      players: this.seats.filter((s) => !s.isBot).map((s) => s.name),
      bots: this.seats.filter((s) => s.isBot).length,
      round: this.game?.round ?? null,
      spectators: this.spectators.size,
      maxSpectators: SPECTATE.maxSpectators,
    };
  }
}

export { CHARACTERS };
