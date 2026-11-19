/** 业务服（apps/account）客户端：登录 / 注册 / 票据。对战服把 /api/account/* 反代到业务服，所以与 prefs.server 同源。 */
export interface AccountView {
  id: string; username: string; coins: number;
  chars: Record<string, { exp: number; level: number }>;
  items: Record<string, number>;
}
export interface ShopInfo { items: { id: string; name: string; price: number }[]; train: { cost: number; exp: number; expPerLevel: number; maxLevel: number } }

const KEY = 'dt.acct.v1';
export const apiBase = (server: string) => server.replace(/^ws/, 'http').replace(/\/$/, '') + '/api/account';

export function savedToken(): string { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }
function saveToken(t: string) { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* ignore */ } }

async function call<T>(server: string, path: string, method = 'GET', body?: unknown, auth = true): Promise<T> {
  const tok = savedToken();
  const r = await fetch(apiBase(server) + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && auth) saveToken('');
    throw new Error((j as { error?: string }).error || `请求失败（${r.status}）`);
  }
  return j as T;
}

export async function authenticate(server: string, mode: 'login' | 'register', username: string, password: string): Promise<AccountView> {
  const r = await call<{ token: string; account: AccountView }>(server, `/${mode}`, 'POST', { username, password }, false);
  saveToken(r.token);
  return r.account;
}
export const me = (s: string) => call<{ account: AccountView }>(s, '/me').then((r) => r.account);
export const shop = (s: string) => call<ShopInfo>(s, '/shop', 'GET', undefined, false);
export const buy = (s: string, item: string) => call<{ account: AccountView }>(s, '/shop/buy', 'POST', { item, qty: 1 }).then((r) => r.account);
export const train = (s: string, char: string) => call<{ account: AccountView }>(s, '/train', 'POST', { char }).then((r) => r.account);
export const checkin = (s: string) => call<{ account: AccountView; bonus: number }>(s, '/checkin', 'POST');
export async function logout(s: string) { try { await call(s, '/logout', 'POST'); } catch { /* ignore */ } saveToken(''); }

/** 联机入座前取票据；未登录返回 null（匿名入座，沿用本地档案 id） */
export async function fetchTicket(server: string): Promise<{ ticket: string; accountId: string } | null> {
  if (!savedToken()) return null;
  return call<{ ticket: string; accountId: string }>(server, '/ticket', 'POST');
}
