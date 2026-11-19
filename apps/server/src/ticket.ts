import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 业务服（apps/account，Go）签发的票据：base64url(payload JSON) + "." + base64url(HMAC-SHA256(payload 段, 密钥))
 * payload: {"a":accountId,"e":过期 unix 秒,"k":密钥 ID}
 * 密钥来自环境变量 TICKET_KEYS="kid:secret[,kid2:secret2]"（与业务服同一份；多把用于轮换，按 kid 查找）。
 * TICKET_REQUIRED=1：联机入座必须带有效票据；否则仅在带了票据时校验。
 */
export type TicketResult = { ok: true; accountId?: string } | { ok: false; message: string };

export function parseKeys(s: string | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of (s || '').split(',')) {
    const p = part.trim();
    const i = p.indexOf(':');
    if (i > 0 && i < p.length - 1) m.set(p.slice(0, i), p.slice(i + 1));
  }
  return m;
}

export function verifyTicket(ticket: string, keys: Map<string, string>, nowSec: number): { accountId: string } | { error: string } {
  const parts = ticket.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { error: '票据格式无效' };
  let pl: { a?: unknown; e?: unknown; k?: unknown };
  try { pl = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return { error: '票据格式无效' }; }
  if (typeof pl.a !== 'string' || !pl.a || typeof pl.e !== 'number' || typeof pl.k !== 'string') return { error: '票据格式无效' };
  const key = keys.get(pl.k);
  if (key === undefined) return { error: '票据密钥未知' };
  const want = createHmac('sha256', key).update(parts[0]).digest();
  let got: Buffer;
  try { got = Buffer.from(parts[1], 'base64url'); } catch { return { error: '票据签名无效' }; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { error: '票据签名无效' };
  if (nowSec >= pl.e) return { error: '票据已过期，请重新登录' };
  return { accountId: pl.a };
}

export function checkTicket(ticket: unknown, now: number = Date.now()): TicketResult {
  const required = process.env.TICKET_REQUIRED === '1';
  if (ticket === undefined || ticket === null || ticket === '') {
    return required ? { ok: false, message: '联机需要登录票据，请先登录账号' } : { ok: true };
  }
  if (typeof ticket !== 'string') return { ok: false, message: '票据格式无效' };
  const keys = parseKeys(process.env.TICKET_KEYS);
  if (keys.size === 0) return { ok: false, message: '对战服未配置票据密钥，无法校验票据' };
  const r = verifyTicket(ticket, keys, Math.floor(now / 1000));
  return 'error' in r ? { ok: false, message: r.error } : { ok: true, accountId: r.accountId };
}
