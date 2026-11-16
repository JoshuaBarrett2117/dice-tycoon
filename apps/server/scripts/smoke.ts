/**
 * 冒烟测试：连上本地对战服，2 名真人 + 2 个机器人，真人用托管策略自动出手，
 * 跑 N 秒后打印统计。用法：先 `npm run dev:server`，再 `npm run smoke -w @dt/server`。
 */
import { Client } from '@colyseus/sdk';
import { ROOM_NAME, botAction, type GameState } from '@dt/shared';

const URL = process.env.SERVER_URL || 'ws://localhost:2567';
const SECONDS = Number(process.env.SECONDS || 25);

async function player(name: string, charId: string, create: boolean, roomId?: string) {
  const c = new Client(URL);
  const room = create ? await c.create(ROOM_NAME, { name, charId }) : await c.joinById(roomId!, { name, charId });
  let seat = -1, syncs = 0, acted = 0, last: GameState | null = null, errors = 0;
  room.onMessage('seat', (m: { seat: number }) => { seat = m.seat; });
  room.onMessage('lobby', () => {});
  room.onMessage('error', (m: { message: string }) => { errors++; console.log(name, '错误', m.message); });
  room.onMessage('sync', (m: { state: GameState; events: unknown[] }) => {
    syncs++; last = m.state;
    if (m.state.turn === seat && m.state.phase !== 'ended') {
      setTimeout(() => { room.send('action', botAction(m.state, seat)); acted++; }, 300);
    }
  });
  return { room, stats: () => ({ name, seat, syncs, acted, errors, round: last?.round, phase: last?.phase }) };
}

const a = await player('测试甲', 'jin', true);
const b = await player('测试乙', 'li', false, a.room.roomId);
await new Promise((r) => setTimeout(r, 300));
a.room.send('start', {});
await new Promise((r) => setTimeout(r, SECONDS * 1000));
console.log(a.stats(), b.stats());
await a.room.leave(); await b.room.leave();
process.exit(a.stats().syncs > 3 && a.stats().errors === 0 ? 0 : 1);
