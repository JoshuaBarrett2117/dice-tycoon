import { PAID_CHAR_IDS, type CharId } from '@dt/shared';

/**
 * v1.7 付费角色入座校验：免费角色直接放行；付费角色必须是票据验证过的账号，且向业务服（ACCOUNT_URL + INTERNAL_TOKEN）
 * 查询已购。匿名 / 未配置业务服 / 查询失败一律拒绝（不放行未购的付费角色）。
 */
export async function checkCharAllowed(charId: CharId, accountId: string | undefined, fetchFn: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!PAID_CHAR_IDS.includes(charId)) return { ok: true };
  if (!accountId) return { ok: false, message: '该角色需登录账号并在商城购买后才能使用' };
  const base = (process.env.ACCOUNT_URL || '').replace(/\/$/, '');
  const token = process.env.INTERNAL_TOKEN || '';
  if (!base || !token) return { ok: false, message: '对战服未配置业务服，无法校验付费角色' };
  try {
    const r = await fetchFn(`${base}/internal/owns?account=${encodeURIComponent(accountId)}&char=${encodeURIComponent(charId)}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return { ok: false, message: '无法校验角色是否已购，请稍后重试' };
    const j = (await r.json()) as { owned?: boolean };
    return j.owned === true ? { ok: true } : { ok: false, message: '尚未购买该角色，请先到商城购买' };
  } catch {
    return { ok: false, message: '业务服暂不可用，无法校验已购角色' };
  }
}
