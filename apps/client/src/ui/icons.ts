/** v0.9 矢量图标：道具 / 技能 / 竞拍（内联 SVG，无额外请求，随首包） */
const P: Record<string, string> = {
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="12" cy="12" r="1"/>',
  roadblock: '<path d="M3 17h18M5 17V9h14v8M8 9v8M12 9v8M16 9v8"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  doubleToll: '<circle cx="12" cy="12" r="9"/><path d="M8 9l3 6M11 9l-3 6M14 9h4M14 15h4"/>',
  demolish: '<path d="M4 20h16M6 20V10l6-5 6 5v10M9 14l6 4M15 14l-6 4"/>',
  freeBuild: '<path d="M4 20h16M6 20V10l6-5 6 5v10M12 11v6M9 14h6"/>',
  teleport: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2"/>',
  swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  taxFree: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 15l8-6M9 9h.01M15 15h.01"/>',
  freeze: '<path d="M12 3v18M4 7.5l16 9M20 7.5l-16 9M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  forceBuy: '<path d="M6 21V4M6 5h11l-2.5 3.5L17 12H6"/><circle cx="17" cy="18" r="2.6"/>',
  shop: '<path d="M4 9h16l-1.5 11h-13zM8 9V7a4 4 0 018 0v2"/>',
  props: '<path d="M4 20h16M6 20V10l6-5 6 5v10M10 20v-5h4v5"/>',
  log: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  tang: '<path d="M3 12c3-5 9-5 13 0-4 5-10 5-13 0zM16 12l5-4v8zM8 11h.01"/>',
  // 技能（按角色）
  jin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4"/>',
  li: '<path d="M4 20h16M6 20V9l6-5 6 5v11M10 20v-6h4v6"/>',
  wang: '<path d="M3 8l4 3 5-6 5 6 4-3-2 11H5z"/>',
  xing: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  panda: '<circle cx="12" cy="13" r="7"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="6.5" r="2.5"/><circle cx="9.5" cy="12" r="1"/><circle cx="14.5" cy="12" r="1"/>',
  rock: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  skill: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  // 竞拍
  auction: '<path d="M14 4l6 6M12 6l6 6M5 19l8-8M3 21h8M15 3l-4 4 6 6 4-4"/>',
};

/** v1.9 彩色徽章图标（圆角渐变底 + 白色线性字形 + 描边，统一 Q 版立绘的明快色调）；size 为像素边长，行动栏默认 26 */
const COLORS: Record<string, [string, string]> = {
  dice: ['#8ec5ff', '#2f6fe0'], roadblock: ['#ffb36b', '#e8590c'], shield: ['#7ee0c3', '#0f9d76'], doubleToll: ['#ffe27a', '#f0a000'],
  demolish: ['#ff9aa2', '#d6284a'], freeBuild: ['#a8e86b', '#3ba31c'], teleport: ['#c9a2ff', '#7a3fe0'], swap: ['#7fd8ff', '#1783c9'],
  taxFree: ['#ffd1e8', '#e0489c'], freeze: ['#bdeeff', '#3fa9e8'], forceBuy: ['#ffd23f', '#c2410c'],
  jin: ['#ffe27a', '#f0a000'], li: ['#ffb36b', '#e8590c'], wang: ['#ffd36b', '#b45309'], xing: ['#ffa6f0', '#c026d3'],
  panda: ['#cbd5e1', '#475569'], rock: ['#9fe0ff', '#2a6fe0'], tang: ['#ff9f7a', '#e11d48'],
  skill: ['#ffd25a', '#ff7a00'], shop: ['#7ee0c3', '#0f9d76'], props: ['#8ec5ff', '#2f6fe0'], log: ['#c9a2ff', '#7a3fe0'], auction: ['#ffe27a', '#f0a000'],
};
export function icon(id: string, size = 26): string {
  const [a, b] = COLORS[id] ?? COLORS.skill, gid = `ig-${id}`;
  return `<svg class="ic" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="url(#${gid})" stroke="#fff" stroke-width="2"/><ellipse cx="16" cy="8" rx="10" ry="5" fill="#fff" opacity=".28"/><g transform="translate(4 4) scale(1)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 1px 0 rgba(0,0,0,.35))">${P[id] ?? P.skill}</g></svg>`;
}

/** v1.8 界面小图标（按钮内的线性字形，非角色 / 商品美术） */
const G: Record<string, string> = {
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  book: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 5v16M8 7h7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 17v3h16v-3"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3"/>',
  gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13M12 8S10 3 7.5 4.5 9 8 12 8zM12 8s2-5 4.5-3.5S15 8 12 8z"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  wifi: '<path d="M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0"/><circle cx="12" cy="19.5" r="1"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
};
export function glyph(id: string, size = 18): string {
  return `<svg class="gi" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${G[id] ?? G.bolt}</svg>`;
}
