/** v1.8 界面组件：分段选择（替代原生 <select>）、金币、图片（缺图 onerror 隐藏）等，菜单 / 账号 / 大厅共用 */

export const esc = (t: string) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const base = () => import.meta.env.BASE_URL + 'assets/';
export const assetUrl = (f: string) => base() + f;
/** 缺图时隐藏 <img>，并给父元素打 .noimg 标记（可显示文字兜底），绝不回退到 SVG / 占位图 */
export const IMG_ERR = `onerror="this.style.visibility='hidden';this.parentElement&&this.parentElement.classList.add('noimg')"`;
export const img = (src: string, cls = '', alt = '') => `<img class="${cls}" src="${src}" alt="${esc(alt)}" loading="lazy" draggable="false" ${IMG_ERR}>`;
/** 金币图标 + 数字 */
export const coin = (n: number | string, cls = '') => `<span class="coinv ${cls}">${img(assetUrl('coin.png'), 'ci')}<b>${n}</b></span>`;

/** 商品图：char_tang→char7.png；skin_<ch>→skin_<ch>.png；dice_<x>→dice_<x>.png */
const CHAR_PNG: Record<string, string> = { jin: 'char1', li: 'char2', wang: 'char3', xing: 'char4', panda: 'char5', rock: 'char6', tang: 'char7' };
export const charPng = (c: string) => assetUrl(`${CHAR_PNG[c] ?? 'char1'}.png`);
export function productImg(id: string): string {
  if (id.startsWith('char_')) return charPng(id.slice(5));
  return assetUrl(`${id}.png`);
}

/** 段位徽章配色 */
export const TIER_CLASS: Record<string, string> = { 青铜: 't-bronze', 白银: 't-silver', 黄金: 't-gold', 铂金: 't-plat', 钻石: 't-dia', 王者: 't-king' };
export const tierBadge = (t: string, extra = '') => `<span class="tier ${TIER_CLASS[t] ?? ''}">${esc(t)}${extra}</span>`;

export interface SegOption { value: string; label: string; sub?: string }

/** 分段选择（radiogroup）。id 落在外层容器上，当前值在 data-value；支持点击、←/→/↑/↓/Home/End 键盘操作 */
export function segHtml(id: string, label: string, opts: SegOption[], value: string, cls = '') {
  return `<div class="field ${cls}"><span class="flabel" id="${id}-lbl">${esc(label)}</span>
    <div class="seg" id="${id}" role="radiogroup" aria-labelledby="${id}-lbl" data-value="${esc(value)}">${opts.map((o) => {
      const on = o.value === value;
      return `<button type="button" role="radio" class="sg${on ? ' on' : ''}" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-v="${esc(o.value)}">${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</button>`;
    }).join('')}</div></div>`;
}

/** 绑定分段选择的交互；onChange 只在值变化时调用 */
export function bindSeg(root: ParentNode, id: string, onChange: (v: string) => void) {
  const box = root.querySelector<HTMLElement>(`#${id}`);
  if (!box) return;
  const btns = [...box.querySelectorAll<HTMLButtonElement>('.sg')];
  const set = (b: HTMLButtonElement, focus = false) => {
    const v = b.dataset.v!;
    const changed = box.dataset.value !== v;
    btns.forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
    box.dataset.value = v;
    if (focus) b.focus();
    if (changed) onChange(v);
  };
  btns.forEach((b, i) => {
    b.onclick = () => set(b);
    b.onkeydown = (e) => {
      const k = e.key;
      let j = -1;
      if (k === 'ArrowRight' || k === 'ArrowDown') j = (i + 1) % btns.length;
      else if (k === 'ArrowLeft' || k === 'ArrowUp') j = (i - 1 + btns.length) % btns.length;
      else if (k === 'Home') j = 0;
      else if (k === 'End') j = btns.length - 1;
      if (j >= 0) { e.preventDefault(); e.stopPropagation(); set(btns[j], true); }
    };
  });
}
export const segValue = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`#${id}`)?.dataset.value ?? '';

/** 页面头：返回按钮 + 标题 */
export const pageHead = (title: string, right = '', backId = 'back', backLabel = '返回') =>
  `<div class="phead"><button class="btn ghost sm back" id="${backId}"><span class="arr">‹</span>${esc(backLabel)}</button><div class="ptitle">${esc(title)}</div><div class="pright">${right}</div></div>`;
