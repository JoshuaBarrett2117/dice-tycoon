/**
 * v1.3 结算挂钩联机校验（需先启动业务服 + 对战服，两边 TICKET_KEYS 相同，对战服配 ACCOUNT_URL 与与业务服相同的 INTERNAL_TOKEN）：
 *   TICKET_KEYS=k1:secret-one INTERNAL_TOKEN=tt PORT=8080 DATA_FILE=/tmp/acc.json ./account
 *   SMOKE_SPEED=20 TICKET_KEYS=k1:secret-one INTERNAL_TOKEN=tt ACCOUNT_URL=http://localhost:8080 npm run dev:server
 *   npm run settle -w @dt/server
 * 一个登录玩家 + 一个匿名玩家 + 机器人打完一局：登录玩家上榜、局数 +1；匿名玩家不上榜；单局只结算一次。
 */
import { Client } from '@colyseus/sdk';
import { ROOM_NAME, actorOf, botAction, type GameState } from '@dt/shared';

const URL = process.env.SERVER_URL || 'ws://localhost:2567';
const HTTP = URL.replace(/^ws/, 'http');
const fails: string[] = [];
const check = (name: string, cond: unknown, extra: unknown = '') => { console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : extra); if (!cond) fails.push(name); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(path: string, method = 'GET', body?: unknown, token?: string) {
  const r = await fetch(HTTP + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json()) as Record<string, any> };
}

const name = 'e2e' + Math.random().toString(36).slice(2, 8);
const reg = await api('/api/account/register', 'POST', { username: name, password: 'secret1' });
check('注册', reg.status === 201, reg.json);
const tok = reg.json.token as string;
const tk = (await api('/api/account/ticket', 'POST', undefined, tok)).json;
const c1 = new Client(URL), c2 = new Client(URL);
const r1 = await c1.create(ROOM_NAME, { name: 'login', charId: 'jin', ticket: tk.ticket });
const r2 = await c2.joinById(r1.roomId, { name: 'anon', charId: 'li', accountId: 'acc_forged' });
let last: GameState | null = null;
for (const [room, seatRef] of [[r1, { s: -1 }], [r2, { s: -1 }]] as [any, { s: number }][]) {
  room.onMessage('seat', (m: { seat: number }) => { seatRef.s = m.seat; });
  room.onMessage('sync', (m: { state: GameState }) => {
    last = m.state;
    if (m.state.phase !== 'ended' && actorOf(m.state) === seatRef.s) setTimeout(() => room.send('action', botAction(m.state, seatRef.s)), 20);
  });
}
await sleep(300);
r1.send('start');
const t0 = Date.now();
while (Date.now() - t0 < 180_000 && (last as GameState | null)?.phase !== 'ended') await sleep(300);
check('整局打完', (last as GameState | null)?.phase === 'ended');
await sleep(1500);
const me = (await api('/api/account/me', 'GET', undefined, tok)).json.account;
check('登录玩家局数 +1', me.games === 1, me);
check('登录玩家拿到奖励金币', me.coins > 200, me.coins);
const board = (await api('/api/account/leaderboard?by=rating')).json.list as { username: string }[];
check('登录玩家上榜', board.some((e) => e.username === name), board);
check('匿名/伪造 accountId 不上榜', board.length === 1 || !JSON.stringify(board).includes('forged'));
await r1.leave(); await r2.leave();
console.log(fails.length ? `✗ ${fails.length} 项失败` : '✓ 全部通过');
process.exit(fails.length ? 1 : 0);
