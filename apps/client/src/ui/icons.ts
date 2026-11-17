/** v0.9 矢量图标：道具 / 技能 / 竞拍（内联 SVG，无额外请求，随首包） */
const wrap = (body: string) => `<svg class="ic" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

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

export function icon(id: string): string { return wrap(P[id] ?? P.skill); }
