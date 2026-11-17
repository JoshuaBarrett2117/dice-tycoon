/**
 * 机器人 / 托管 AI。服务端用它补位和代替掉线玩家，客户端单机模式同样调用。
 * 策略刻意简单、可读；v0.5 起按难度（简单/普通/困难）参数化（BOT_LEVELS）。
 * 决策均为纯函数：「随机」只用对局状态的确定性哈希，不调用 Math.random、不改状态。
 */
import { BOARD_SIZE, boardOf } from './board';
import { BOT_DEFAULT_DIFFICULTY, BOT_LEVELS, ZONES } from './config';
import { applyAction, itemTargets, mortgageValue, redeemCost, tollOf, totalAssets } from './engine';
import type { Action, GameState } from './types';

function lv(s: GameState, seat: number) { return BOT_LEVELS[s.seats[seat].difficulty ?? BOT_DEFAULT_DIFFICULTY]; }

/** 由局面派生的 [0,1) 确定性伪随机（同局面同结果，保证机器人是纯函数、可回放） */
function chance(s: GameState, seat: number, salt: number): number {
  const p = s.seats[seat];
  let h = (s.seq * 2654435761 + p.pos * 40503 + p.cash * 97 + seat * 7919 + salt * 104729 + s.rng) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489917) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 评估落在某格的好坏（越大越好） */
function tileScore(s: GameState, seat: number, i: number): number {
  const d = boardOf(s).tiles[i], t = s.tiles[i], cash = s.seats[seat].cash, L = lv(s, seat);
  if (d.kind === 'city' || d.kind === 'tour') {
    if (t.owner == null) {
      let v = d.price <= cash ? 3 : 0;
      if (d.group && boardOf(s).groups[d.group].some((x) => s.tiles[x].owner === seat)) v += 2 * L.group;
      if (d.kind === 'tour' && boardOf(s).tours.some((x) => s.tiles[x].owner === seat)) v += 2 * L.group;
      return v;
    }
    if (t.owner === seat) return t.lv < 4 ? 2 : 0.5;
    return (-tollOf(s, i) * L.toll) / 15;
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
  if (chance(s, seat, 1) < lv(s, seat).noise) return Math.floor(chance(s, seat, 2) * ZONES.length);
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
  const L = lv(s, seat);
  if (L.itemUse < 1 && chance(s, seat, 3) >= L.itemUse) return null;
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
  if (has('swap') && p.islandTurns === 0) {
    let tg = -1, v = 2.9;
    for (const q of itemTargets(s, seat, 'swap')) { const sc = tileScore(s, seat, s.seats[q].pos); if (sc > v) { v = sc; tg = q; } }
    if (tg >= 0) tries.push({ type: 'useItem', item: 'swap', target: tg });
  }
  if (has('taxFree') && !p.taxFree && cash >= 250) tries.push({ type: 'useItem', item: 'taxFree' });
  if (has('freeze')) {
    const tg = itemTargets(s, seat, 'freeze').sort((a, c) => totalAssets(s, c) - totalAssets(s, a) || a - c)[0];
    if (tg !== undefined && totalAssets(s, tg) >= totalAssets(s, seat)) tries.push({ type: 'useItem', item: 'freeze', target: tg });
  }
  if (has('freeBuild')) {
    const c = itemTargets(s, seat, 'freeBuild').sort((a, b) => boardOf(s).tiles[b].price - boardOf(s).tiles[a].price)[0];
    if (c !== undefined) tries.push({ type: 'useItem', item: 'freeBuild', target: c });
  }
  if (has('demolish')) {
    const c = itemTargets(s, seat, 'demolish').sort((a, b) => s.tiles[b].lv - s.tiles[a].lv || boardOf(s).tiles[b].price - boardOf(s).tiles[a].price)[0];
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
    const liOk = s.tiles.some((t, i) => t.owner != null && t.owner !== seat && t.lv < 4 && boardOf(s).tiles[i].kind === 'city' && ahead(i)) && cash >= 120;
    if ((p.charId !== 'li' || liOk) && chance(s, seat, 4) < L.skillUse) tries.push({ type: 'useSkill' });
  }
  for (const a of tries) if (a && valid(a)) return a;
  return null;
}

/** 前方 2–12 格内他人地产的最大过路费（抵押 / 赎回的判断依据；有护盾时视为无威胁） */
function tollThreat(s: GameState, seat: number): number {
  const p = s.seats[seat];
  if (p.shield) return 0;
  let m = 0;
  for (let n = 2; n <= 12; n++) {
    const i = (p.pos + n) % BOARD_SIZE, t = s.tiles[i];
    if (t.owner != null && t.owner !== seat && !t.mortgaged) m = Math.max(m, tollOf(s, i));
  }
  return m;
}

/**
 * 抵押 / 赎回：只在「面临支付」时才抵押——前方有付不起的过路费、现金又低于它时，
 * 按过路费价值从低到高抵押；现金充裕（赎回后仍高于威胁与安全线）才赎回。绝不主动抵押。
 * 抵押条件 cash < threat 与赎回条件 cash - cost >= threat 互斥，同一回合不会来回振荡。
 */
export function mortgageDecision(s: GameState, seat: number): Action | null {
  const p = s.seats[seat], L = lv(s, seat), threat = tollThreat(s, seat) * L.mortgageAt;
  const mine = s.tiles.map((t, i) => (t.owner === seat ? i : -1)).filter((i) => i >= 0);
  if (threat > 0 && p.cash < threat) {
    const c = mine.filter((i) => !s.tiles[i].mortgaged)
      .sort((a, b) => tollOf(s, a) - tollOf(s, b) || mortgageValue(s, b) - mortgageValue(s, a))[0];
    if (c !== undefined) return { type: 'mortgage', tile: c };
    return null;
  }
  const r = mine.filter((i) => s.tiles[i].mortgaged)
    .sort((a, b) => redeemCost(s, a) - redeemCost(s, b))
    .find((i) => p.cash - redeemCost(s, i) >= Math.max(L.redeemMin, threat));
  return r !== undefined ? { type: 'redeem', tile: r } : null;
}

/** 竞拍估值：地价 ×0.9，凑同色组 / 观光地每多一块 +35%，上限内最低价出价，超限或会掏空现金则弃拍 */
function auctionLimit(s: GameState, seat: number, tile: number): number {
  const d = boardOf(s).tiles[tile];
  let own = 0;
  if (d.kind === 'city' && d.group) own = boardOf(s).groups[d.group].filter((x) => s.tiles[x].owner === seat).length;
  else if (d.kind === 'tour') own = boardOf(s).tours.filter((x) => s.tiles[x].owner === seat).length;
  const L = lv(s, seat);
  return Math.round(d.price * (L.auctionBase + L.auctionGroup * own));
}

export function botAction(s: GameState, seat: number): Action {
  if (s.phase === 'roll') {
    const m = mortgageDecision(s, seat);
    if (m && applyAction(s, seat, m).ok) return m;
    return preRollAction(s, seat) ?? { type: 'roll', zone: chooseZone(s, seat) };
  }
  const p = s.pending!;
  const cash = s.seats[seat].cash;
  const L = lv(s, seat);
  const reserve = Math.max(L.reserveMin, cash * L.reserveFrac);
  switch (p.kind) {
    case 'item': return { type: 'choose', option: -1 };
    case 'auction': {
      const o = p.options[0], limit = auctionLimit(s, seat, p.tile!);
      return { type: 'choose', option: o && o.value <= limit && cash - o.value >= 40 ? 0 : -1 };
    }
    case 'buy':
    case 'upgrade': {
      // 选能负担的最高档，同时保留一部分现金应对过路费
      let pickIdx = -1;
      if (L.noise > 0 && chance(s, seat, 5) < L.noise) return { type: 'choose', option: -1 }; // 简单档：偶尔手滑放弃
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
