/**
 * 机器人 / 托管 AI。服务端用它补位和代替掉线玩家，客户端单机模式同样调用。
 * 策略刻意简单、可读，后续可替换为按难度分级的版本。
 */
import { BOARD, BOARD_SIZE, GROUPS, TOURS } from './board';
import { ZONES } from './config';
import { applyAction, itemTargets, tollOf } from './engine';
import type { Action, GameState } from './types';

/** 评估落在某格的好坏（越大越好） */
function tileScore(s: GameState, seat: number, i: number): number {
  const d = BOARD[i], t = s.tiles[i], cash = s.seats[seat].cash;
  if (d.kind === 'city' || d.kind === 'tour') {
    if (t.owner == null) {
      let v = d.price <= cash ? 3 : 0;
      if (d.group && GROUPS[d.group].some((x) => s.tiles[x].owner === seat)) v += 2;
      if (d.kind === 'tour' && TOURS.some((x) => s.tiles[x].owner === seat)) v += 2;
      return v;
    }
    if (t.owner === seat) return t.lv < 4 ? 2 : 0.5;
    return -tollOf(s, i) / 15;
  }
  if (d.kind === 'card') return 0.8;
  if (d.kind === 'tax') return -Math.min(3, cash / 100);
  if (d.corner === 'island') return -2;
  if (d.corner === 'airport') return 1;
  if (d.corner === 'festival') return 0.5;
  return 1; // start
}

export function chooseZone(s: GameState, seat: number): number {
  const pos = s.seats[seat].pos;
  let best = 1, bestV = -Infinity;
  ZONES.forEach((z, k) => {
    let v = 0;
    for (let n = z.lo; n <= z.hi; n++) v += tileScore(s, seat, (pos + n) % BOARD_SIZE);
    v /= z.hi - z.lo + 1;
    if (v > bestV) { bestV = v; best = k; }
  });
  return best;
}

/** 掷骰前的道具 / 技能启发式。每个动作都会消耗手牌或进入冷却，且经引擎试算合法才返回，不会死循环 */
export function preRollAction(s: GameState, seat: number): Action | null {
  const p = s.seats[seat];
  const cash = p.cash;
  const valid = (a: Action) => (applyAction(s, seat, a).ok ? a : null);
  const best = (item: 'dice' | 'teleport') => {
    let tgt = -1, v = 2.9;
    for (const x of itemTargets(s, seat, item)) {
      const idx = item === 'dice' ? (p.pos + x) % BOARD_SIZE : x;
      const sc = tileScore(s, seat, idx);
      if (sc > v) { v = sc; tgt = x; }
    }
    return tgt;
  };
  const has = (i: string) => (p.items as string[]).includes(i);
  const owned = s.tiles.filter((t) => t.owner === seat).length;
  const tries: (Action | null)[] = [];
  if (has('teleport') && p.islandTurns === 0) { const t = best('teleport'); if (t >= 0) tries.push({ type: 'useItem', item: 'teleport', target: t }); }
  if (has('dice') && p.islandTurns === 0) { const t = best('dice'); if (t >= 0) tries.push({ type: 'useItem', item: 'dice', target: t }); }
  if (has('freeBuild')) {
    const c = itemTargets(s, seat, 'freeBuild').sort((a, b) => BOARD[b].price - BOARD[a].price)[0];
    if (c !== undefined) tries.push({ type: 'useItem', item: 'freeBuild', target: c });
  }
  if (has('demolish')) {
    const c = itemTargets(s, seat, 'demolish').sort((a, b) => s.tiles[b].lv - s.tiles[a].lv || BOARD[b].price - BOARD[a].price)[0];
    if (c !== undefined && s.tiles[c].lv >= 2) tries.push({ type: 'useItem', item: 'demolish', target: c });
  }
  if (has('shield') && !p.shield && cash < 150) tries.push({ type: 'useItem', item: 'shield' });
  if (has('doubleToll') && !p.doubleToll && owned >= 2) tries.push({ type: 'useItem', item: 'doubleToll' });
  if (has('roadblock')) {
    const c = itemTargets(s, seat, 'roadblock').filter((i) => s.tiles[i].owner === seat).sort((a, b) => tollOf(s, b) - tollOf(s, a))[0];
    if (c !== undefined) tries.push({ type: 'useItem', item: 'roadblock', target: c });
  }
  if (p.skillCd === 0) {
    // 小狸只在前方有可收购的他人城市时才用，其余角色冷却好了就用
    const ahead = (i: number) => { const d = (i - p.pos + BOARD_SIZE) % BOARD_SIZE; return d >= 2 && d <= 12; };
    const liOk = s.tiles.some((t, i) => t.owner != null && t.owner !== seat && t.lv < 4 && BOARD[i].kind === 'city' && ahead(i)) && cash >= 120;
    if (p.charId !== 'li' || liOk) tries.push({ type: 'useSkill' });
  }
  for (const a of tries) if (a && valid(a)) return a;
  return null;
}

export function botAction(s: GameState, seat: number): Action {
  if (s.phase === 'roll') return preRollAction(s, seat) ?? { type: 'roll', zone: chooseZone(s, seat) };
  const p = s.pending!;
  const cash = s.seats[seat].cash;
  const reserve = Math.max(40, cash * 0.25);
  switch (p.kind) {
    case 'item': return { type: 'choose', option: -1 };
    case 'buy':
    case 'upgrade': {
      // 选能负担的最高档，同时保留一部分现金应对过路费
      let pickIdx = -1;
      p.options.forEach((o, k) => { if (cash - o.cost >= reserve || (k === 0 && cash - o.cost >= 10)) pickIdx = k; });
      return { type: 'choose', option: pickIdx };
    }
    case 'takeover': {
      const o = p.options[0];
      return { type: 'choose', option: cash - o.cost >= reserve ? 0 : -1 };
    }
    case 'festival': {
      let best = 0, v = -1;
      p.options.forEach((o, k) => { const t = tollOf(s, o.value); if (t > v) { v = t; best = k; } });
      return { type: 'choose', option: best };
    }
    case 'fly': {
      // 优先飞往可买的空地，其次自己的地（升级）
      let best = -1, v = 0;
      p.options.forEach((o, k) => { const sc = tileScore(s, seat, o.value); if (sc > v) { v = sc; best = k; } });
      return { type: 'choose', option: best };
    }
  }
}
