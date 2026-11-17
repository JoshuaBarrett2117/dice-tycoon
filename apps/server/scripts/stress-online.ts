/**
 * 联机多房并发压测（先启动对战服，建议加速）：
 *   MATCH_TIMEOUT_MS=3000 SMOKE_SPEED=20 npm run dev:server
 *   npm run stress:online -w @dt/server          # 默认 10 房并发，每房 1 真人（脚本代打）+ 3 机器人
 * STRESS_ROOMS 房间数，STRESS_TIMEOUT_S 单局上限（默认 180）。
 * 输出每房耗时、完成数、失败数、服务端内存（/api/stats），写 STRESS_ONLINE_REPORT；有失败则退出码 1。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Client } from '@colyseus/sdk';
import { ROOM_NAME, actorOf, botAction, replayGame, type GameRecord, type GameState } from '@dt/shared';

const URL = process.env.SERVER_URL || 'ws://localhost:2567';
const HTTP = URL.replace(/^ws/, 'http');
const ROOMS = Number(process.env.STRESS_ROOMS || 10);
const LIMIT = Number(process.env.STRESS_TIMEOUT_S || 180) * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stats = async () => { try { return await (await fetch(`${HTTP}/api/stats`)).json() as Record<string, number>; } catch { return null; } };

const before = await stats();
const t0 = Date.now();
const results: { room: number; ok: boolean; ms: number; syncs: number; errors: number; detail?: string }[] = [];
let peakRss = before?.rssMB ?? 0;
const poll = setInterval(async () => { const s = await stats(); if (s) peakRss = Math.max(peakRss, s.rssMB); }, 1000);

async function one(n: number) {
  const start = Date.now();
  const st = { syncs: 0, errors: 0, last: null as GameState | null, replay: null as GameRecord | null };
  try {
    const room = await new Client(URL).create(ROOM_NAME, { name: `压测${n}`, charId: 'jin' });
    let seat = -1;
    room.onMessage('seat', (m: { seat: number }) => { seat = m.seat; });
    room.onMessage('error', () => { st.errors++; });
    room.onMessage('replay', (m: GameRecord) => { st.replay = m; });
    room.onMessage('sync', (m: { state: GameState }) => {
      st.syncs++; st.last = m.state;
      if (m.state.phase !== 'ended' && actorOf(m.state) === seat) { const s = m.state; setTimeout(() => room.send('action', botAction(s, seat)), 20); }
    });
    await sleep(200);
    room.send('start', {});
    while (Date.now() - start < LIMIT && st.last?.phase !== 'ended') await sleep(200);
    const ended = st.last?.phase === 'ended';
    let detail = ended ? undefined : `${LIMIT / 1000}s 内未结束`;
    if (ended) {
      room.send('exportReplay', {}); await sleep(500);
      try { if (!st.replay || replayGame(st.replay).state.seq !== st.last!.seq) detail = '回放不一致'; } catch (e) { detail = `回放失败 ${(e as Error).message}`; }
    }
    await room.leave();
    results.push({ room: n, ok: ended && !detail, ms: Date.now() - start, syncs: st.syncs, errors: st.errors, ...(detail ? { detail } : {}) });
  } catch (e) {
    results.push({ room: n, ok: false, ms: Date.now() - start, syncs: st.syncs, errors: st.errors, detail: (e as Error).message });
  }
}

await Promise.all(Array.from({ length: ROOMS }, (_, i) => one(i + 1)));
clearInterval(poll);
const after = await stats();
const ms = results.map((r) => r.ms).sort((a, b) => a - b);
const report = {
  kind: 'stress-online', rooms: ROOMS, completed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length,
  elapsedMs: Date.now() - t0, roomMsP50: ms[Math.floor(ms.length / 2)], roomMsMax: ms[ms.length - 1],
  serverRssMB: { before: before?.rssMB ?? null, peak: peakRss || null, after: after?.rssMB ?? null },
  clientErrors: results.reduce((a, r) => a + r.errors, 0), results,
};
console.log(JSON.stringify(report, null, 2));
const out = process.env.STRESS_ONLINE_REPORT || 'data/stress-online-report.json';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
process.exit(report.failed ? 1 : 0);
