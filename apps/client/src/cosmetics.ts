/** v1.6 装饰（角色外观 / 骰子皮肤）当前装备：业务服为准，本地缓存最近一次结果，供单机与联机对局内读取（本期仅自己可见）。 */
const KEY = 'dt.cos.v1';
export type Equipped = Record<string, string>;
let cur: Equipped = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Equipped; } catch { return {}; } })();

export function setEquipped(e: Equipped | undefined | null) {
  cur = e && typeof e === 'object' ? { ...e } : {};
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* ignore */ }
}
export const getEquipped = (): Equipped => cur;
/** 当前装备的某角色外观贴图名（无则 null） */
export const skinOf = (charId: string): string | null => (cur[`skin:${charId}`] && /^skin_[a-z]+$/.test(cur[`skin:${charId}`]) ? cur[`skin:${charId}`] : null);
/** 当前骰子皮肤 class 后缀（无则 null＝经典） */
export const diceSkin = (): string | null => (/^dice_[a-z]+$/.test(cur.dice || '') ? cur.dice!.slice(5) : null);
