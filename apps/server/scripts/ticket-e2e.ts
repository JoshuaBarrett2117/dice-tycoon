/**
 * 票据联机校验（需先启动：业务服 + 对战服，且两边 TICKET_KEYS 相同）：
 *   TICKET_KEYS=k1:secret-one PORT=8080 DATA_FILE=/tmp/acc.json ./account         # 业务服
 *   TICKET_KEYS=k1:secret-one ACCOUNT_URL=http://localhost:8080 npm run dev:server  # 对战服
 *   npm run ticket -w @dt/server
 */
import { createHmac } from 'node:crypto';
import { Client } from '@colyseus/sdk';
import { ROOM_NAME } from '@dt/shared';
import { checkTicket } from '../src/ticket';

const URL = process.env.SERVER_URL || 'ws://localhost:2567';
const HTTP = URL.replace(/^ws/, 'http');
const KEY = process.env.TICKET_TEST_KEY || 'k1:secret-one';
const [kid, secret] = KEY.split(':');
const fails: string[] = [];
const check = (name: string, cond: unknown, extra: unknown = '') => { console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : extra); if (!cond) fails.push(name); };

function forge(accountId: string, expSec: number, sec = secret, k = kid): string {
  const p = Buffer.from(JSON.stringify({ a: accountId, e: expSec, k })).toString('base64url');
  return `${p}.${createHmac('sha256', sec).update(p).digest('base64url')}`;
}
async function tryJoin(ticket?: string): Promise<string | null> {
  const c = new Client(URL);
  try {
    const room = await c.create(ROOM_NAME, { name: 't', charId: 'jin', ...(ticket !== undefined ? { ticket } : {}) });
    await room.leave();
    return null;
  } catch (e) { return (e as Error).message || 'rejected'; }
}
async function api(path: string, method = 'GET', body?: unknown, token?: string) {
  const r = await fetch(HTTP + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json()) as Record<string, any> };
}

// 单元：checkTicket 的 TICKET_REQUIRED 行为
process.env.TICKET_KEYS = KEY;
delete process.env.TICKET_REQUIRED;
check('未要求票据时空票据放行', checkTicket(undefined).ok);
process.env.TICKET_REQUIRED = '1';
check('要求票据时空票据拒绝', !checkTicket(undefined).ok);
check('要求票据时有效票据放行', checkTicket(forge('acc_x', Math.floor(Date.now() / 1000) + 60)).ok);
delete process.env.TICKET_REQUIRED;

console.log('联机入座');
check('无票据（单机式匿名）可入座', (await tryJoin()) === null);
check('乱码票据被拒', (await tryJoin('garbage')) !== null);
check('错误签名被拒', (await tryJoin(forge('acc_x', Math.floor(Date.now() / 1000) + 60, 'wrong-secret'))) !== null);
check('未知密钥 ID 被拒', (await tryJoin(forge('acc_x', Math.floor(Date.now() / 1000) + 60, secret, 'zzz'))) !== null);
check('过期票据被拒', (await tryJoin(forge('acc_x', Math.floor(Date.now() / 1000) - 5))) !== null);
check('本地伪造的有效签名票据可入座', (await tryJoin(forge('acc_x', Math.floor(Date.now() / 1000) + 60))) === null);

console.log('业务服（经对战服反代 /api/account）');
const name = 'tk' + Date.now().toString(36);
const reg = await api('/api/account/register', 'POST', { username: name, password: 'secret1' });
check('注册成功', reg.status === 201, reg.json);
const tok = reg.json.token as string;
const tk = await api('/api/account/ticket', 'POST', undefined, tok);
check('签发票据', tk.status === 200 && typeof tk.json.ticket === 'string', tk.json);
check('业务服签发的票据可入座', (await tryJoin(tk.json.ticket)) === null);
check('篡改业务服票据被拒', (await tryJoin(String(tk.json.ticket).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))) !== null);

if (fails.length) { console.log(`\n失败 ${fails.length} 项：${fails.join('；')}`); process.exit(1); }
console.log('\n全部通过');
process.exit(0);
