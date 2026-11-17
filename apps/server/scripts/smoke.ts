/**
 * 联机冒烟测试（先启动对战服）：
 *   MATCH_TIMEOUT_MS=3000 SMOKE_SPEED=20 npm run dev:server     # 终端 1：缩短匹配超时与机器人等待
 *   SMOKE_FAST=1 npm run smoke -w @dt/server                    # 终端 2：整局打完并校验
 * 不加 SMOKE_FAST 也能跑（服务端用默认节奏），此时只校验「不死锁、无异常、回放可重放」，不要求打完一局。
 *
 * 覆盖：
 *  A. 朋友房：2 真人 + 机器人，回放导出可重放，名次摘要在终局后存在
 *  B. 观战：中途加入、任何操作被拒绝、观战席上限、/api/rooms 列出可观战房间、观战者收到的 sync 与玩家一致
 *  C. 快速匹配：4 人凑满立即开局（无机器人）；单人匹配可取消；单人超时由机器人补位开局并打完
 */
import { Client, type Room } from '@colyseus/sdk';
import {
  ROOM_NAME, SPECTATE, actorOf, botAction, replayGame,
  type GameRecord, type GameState, type RoomBrief,
} from '@dt/shared';

const URL = process.env.SERVER_URL || 'ws://localhost:2567';
const HTTP = URL.replace(/^ws/, 'http');
const SECONDS = Number(process.env.SMOKE_SECONDS || 25);
const FAST = !!process.env.SMOKE_FAST;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fails: string[] = [];
const check = (name: string, cond: unknown, extra: unknown = '') => {
  console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : extra);
  if (!cond) fails.push(name);
};

interface Lobby { seats: { isBot: boolean }[]; started: boolean; quick?: { waiting: number; remainingMs: number } }

function wire(room: Room, name: string, auto: boolean) {
  const st = { name, seat: -1, syncs: 0, errors: [] as string[], last: null as GameState | null, replay: null as GameRecord | null, lobby: null as Lobby | null, ended: false, spec: 0 };
  room.onMessage('seat', (m: { seat: number }) => { st.seat = m.seat; });
  room.onMessage('lobby', (m: Lobby) => { st.lobby = m; });
  room.onMessage('spectators', (m: { count: number }) => { st.spec = m.count; });
  room.onMessage('error', (m: { message: string }) => { st.errors.push(m.message); });
  room.onMessage('replay', (m: GameRecord) => { st.replay = m; });
  room.onMessage('sync', (m: { state: GameState }) => {
    st.syncs++; st.last = m.state;
    if (m.state.phase === 'ended') st.ended = true;
    if (auto && actorOf(m.state) === st.seat && m.state.phase !== 'ended') {
      const s = m.state;
      setTimeout(() => room.send('action', botAction(s, st.seat)), FAST ? 15 : 300);
    }
  });
  return st;
}
async function human(c: Client, name: string, charId: string, opts: Record<string, unknown> = {}) {
  const room = await c.create(ROOM_NAME, { name, charId, ...opts });
  return { room, st: wire(room, name, true) };
}
async function waitFor(cond: () => boolean, ms: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(100); }
  return cond();
}
async function rooms(): Promise<RoomBrief[]> {
  return ((await (await fetch(`${HTTP}/api/rooms`)).json()) as { rooms: RoomBrief[] }).rooms;
}

// ───────────── A + B：朋友房 + 观战 ─────────────
console.log('A/B 朋友房与观战');
const c = new Client(URL);
const a = await human(c, '测试甲', 'jin');
const bRoom = await new Client(URL).joinById(a.room.roomId, { name: '测试乙', charId: 'li' });
const b = { room: bRoom, st: wire(bRoom, '测试乙', true) };
await sleep(300);
const beforeStart = await new Client(URL).joinById(a.room.roomId, { name: '早到的观众', charId: 'jin', spectate: true }).then(() => 'joined', (e: Error) => e.message);
check('未开局不能观战', beforeStart !== 'joined', beforeStart);
a.room.send('start', {});
await waitFor(() => a.st.syncs > 0, 3000);
const spectators: { room: Room; st: ReturnType<typeof wire> }[] = [];
for (let i = 0; i < SPECTATE.maxSpectators; i++) {
  const r = await new Client(URL).joinById(a.room.roomId, { name: `观众${i}`, charId: 'jin', spectate: true });
  spectators.push({ room: r, st: wire(r, `观众${i}`, false) });
}
const over = await new Client(URL).joinById(a.room.roomId, { name: '多余观众', charId: 'jin', spectate: true }).then(() => 'joined', (e: Error) => e.message);
check(`观战席上限 ${SPECTATE.maxSpectators}，超出被拒`, over !== 'joined', over);
const lateJoin = await new Client(URL).joinById(a.room.roomId, { name: '晚到的玩家', charId: 'jin' }).then(() => 'joined', (e: Error) => e.message);
check('开局后不能以玩家身份加入', lateJoin !== 'joined', lateJoin);
await sleep(300);
check('观战者进房即收到当前快照', spectators.every((s) => s.st.syncs >= 1 && s.st.last));
check('观战者没有座位', spectators.every((s) => s.st.seat === -1));
check('玩家收到观战人数', a.st.spec === SPECTATE.maxSpectators, a.st.spec);
const list = await rooms();
const mine = list.find((r) => r.roomId === a.room.roomId);
check('/api/rooms 列出该房间', !!mine && mine.started && mine.maxSpectators === SPECTATE.maxSpectators, JSON.stringify(mine));
check('观战席满后标为不可观战', mine && !mine.spectatable, JSON.stringify(mine));

// 观战者持续乱发操作：必须全部被拒绝
const spam = setInterval(() => spectators.forEach((s) => { s.room.send('action', { type: 'roll', zone: 1 }); s.room.send('action', { type: 'choose', option: 0 }); }), 200);
await waitFor(() => a.st.ended, FAST ? SECONDS * 1000 : 0);
if (!FAST) await sleep(SECONDS * 1000);
clearInterval(spam);
await sleep(300);
check('观战者的操作全部被拒绝', spectators.every((s) => s.st.errors.length > 0 && s.st.errors.every((m) => m.includes('观战'))), spectators[0].st.errors.slice(0, 2));
check('玩家未收到观战者引起的错误', a.st.errors.length === 0 && b.st.errors.length === 0, [a.st.errors, b.st.errors]);
check('对局持续推进', a.st.syncs > 3, a.st.syncs);
check('观战者与玩家看到的最终 seq 一致', spectators.every((s) => s.st.last?.seq === a.st.last?.seq), [spectators[0].st.last?.seq, a.st.last?.seq]);
if (FAST) check('整局打完', a.st.ended && a.st.last?.winner != null);
a.room.send('exportReplay', {});
await sleep(600);
const rec = a.st.replay;
check('回放可重放且 seq 一致', rec && replayGame(rec).state.seq === rec.result?.seq);
if (a.st.ended) check('终局回放摘要含名次与胜者', rec?.result?.ranking?.[0]?.won === true && rec.result.ranking.length === 4);
spectators[0].room.send('exportReplay', {});
await sleep(400);
check('观战者收到回放', !!spectators[0].st.replay);
for (const s of spectators) await s.room.leave();
await sleep(300);
check('观战者离开后人数回落', a.st.spec === 0, a.st.spec);
await a.room.leave(); await b.room.leave();

// ───────────── C：快速匹配 ─────────────
console.log('C 快速匹配');
const qc = async (n: string) => {
  const room = await new Client(URL).joinOrCreate(ROOM_NAME, { name: n, charId: 'jin', quick: true });
  return { room, st: wire(room, n, true) };
};
// C1 取消
const q1 = await qc('排队者');
await sleep(500);
check('匹配房给出排队状态', q1.st.lobby?.quick?.waiting === 1 && !q1.st.lobby.started, JSON.stringify(q1.st.lobby));
await q1.room.leave();
await sleep(500);
// C2 4 人凑满（取消的人不会被算进去）
const q4: Awaited<ReturnType<typeof qc>>[] = [];
for (let i = 0; i < 4; i++) q4.push(await qc(`匹配${i}`));
await waitFor(() => q4.every((q) => q.st.lobby?.started), 5000);
check('4 人凑满立即开局', q4.every((q) => q.st.lobby?.started));
check('凑满开局没有机器人，且 4 人同房', q4.every((q) => q.st.lobby!.seats.length === 4 && q4[0].room.roomId === q.room.roomId && q.st.lobby!.seats.every((s) => !s.isBot)), JSON.stringify(q4[0].st.lobby));
check('取消的玩家没有被拉入', q4.every((q) => q.st.seat >= 0) && new Set(q4.map((q) => q.st.seat)).size === 4);
const full = await rooms();
check('开局后的匹配房可观战', !!full.find((r) => r.roomId === q4[0].room.roomId)?.started);
for (const q of q4) await q.room.leave();
await sleep(300);
// C3 单人超时补位
const t0 = Date.now();
const solo = await qc('独行侠');
const waitMs = FAST ? 15000 : 30000;
const started = await waitFor(() => !!solo.st.lobby?.started, waitMs);
check(`单人匹配超时后机器人补位开局（用时 ${Math.round((Date.now() - t0) / 1000)} 秒）`, started);
check('补位 3 个机器人', solo.st.lobby?.seats.filter((s) => s.isBot).length === 3, JSON.stringify(solo.st.lobby));
const watcher = await new Client(URL).joinById(solo.room.roomId, { name: '旁观', charId: 'li', spectate: true });
const w = wire(watcher, '旁观', false);
await waitFor(() => solo.st.ended, FAST ? 60000 : 5000);
if (FAST) check('含观战者的机器人对局打完且分出胜负', solo.st.ended && solo.st.last?.winner != null && w.ended, `ended=${solo.st.ended} syncs=${solo.st.syncs}`);
else check('含观战者的对局推进', solo.st.syncs > 2 && w.syncs > 2);
check('观战者与玩家同步', w.last?.seq === solo.st.last?.seq || !solo.st.ended, [w.last?.seq, solo.st.last?.seq]);
await watcher.leave(); await solo.room.leave();

console.log(fails.length ? `\n失败 ${fails.length} 项：${fails.join('；')}` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
