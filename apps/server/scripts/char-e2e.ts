/**
 * v1.7 付费角色联机校验（需先启动业务服 + 对战服；两边 TICKET_KEYS 相同、INTERNAL_TOKEN 相同，对战服配 ACCOUNT_URL）：
 *   TICKET_KEYS=k1:secret-one INTERNAL_TOKEN=tok PORT=8080 DATA_FILE=/tmp/acc.json ./account
 *   TICKET_KEYS=k1:secret-one INTERNAL_TOKEN=tok ACCOUNT_URL=http://localhost:8080 npm run dev:server
 *   INTERNAL_TOKEN=tok npm run char -w @dt/server
 */
import { Client } from '@colyseus/sdk';
import { ROOM_NAME } from '@dt/shared';

const URL = process.env.SERVER_URL || 'ws://localhost:2567';
const HTTP = URL.replace(/^ws/, 'http');
const ACC = process.env.ACCOUNT_URL || 'http://localhost:8080';
const TOK = process.env.INTERNAL_TOKEN || 'tok';
const fails: string[] = [];
const check = (name: string, cond: unknown, extra: unknown = '') => { console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : extra); if (!cond) fails.push(name); };
async function api(path: string, method = 'GET', body?: unknown, token?: string, base = HTTP) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json()) as Record<string, any> };
}
async function tryJoin(charId: string, ticket?: string): Promise<string | null> {
  const c = new Client(URL);
  try { const room = await c.create(ROOM_NAME, { name: 't', charId, ...(ticket ? { ticket } : {}) }); await room.leave(); return null; } catch (e) { return (e as Error).message || 'rejected'; }
}

const u = 'tang' + Math.random().toString(36).slice(2, 8);
const reg = await api('/api/account/register', 'POST', { username: u, password: 'secret1' });
const tok = reg.json.token as string, id = reg.json.account.id as string;
const ticket = async () => (await api('/api/account/ticket', 'POST', undefined, tok)).json.ticket as string;

const shop = await api('/api/account/shop');
const item = (shop.json.categories as any[]).find((c) => c.id === 'char')?.items.find((i: any) => i.id === 'char_tang');
check('商城「角色」分类含 char_tang，500 金币', item && item.price === 500, shop.json);
check('匿名选 tang 被拒', (await tryJoin('tang')) !== null);
check('已登录未购选 tang 被拒', (await tryJoin('tang', await ticket())) !== null);
check('免费角色照常入座', (await tryJoin('jin', await ticket())) === null);
check('金币不足购买 402', (await api('/api/account/shop/buy', 'POST', { item: 'char_tang' }, tok)).status === 402);
await api('/internal/grant', 'POST', { accountId: id, coins: 400 }, TOK, ACC);
const buy = await api('/api/account/shop/buy', 'POST', { item: 'char_tang' }, tok);
check('购买成功并扣 500', buy.status === 200 && buy.json.account.coins === 100, buy.json);
check('重复购买 400', (await api('/api/account/shop/buy', 'POST', { item: 'char_tang' }, tok)).status === 400);
check('已购可入座', (await tryJoin('tang', await ticket())) === null);
const tr = await api('/api/account/train', 'POST', { char: 'tang' }, tok);
check('训练 tang 正常', tr.status === 200 && tr.json.account.chars.tang.exp === 40, tr.json);
console.log(fails.length ? `FAIL ${fails.length}` : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
