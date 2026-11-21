import { describe, expect, it } from 'vitest';
import { ITEM_PRICES, RULES, actorOf, applyAction, botAction, createGame, replayGame, ReplayRecorder, takeoverCost, investedValue, itemTargets, type GameState, type SeatConfig, type GameEvent } from '../src';

const SEATS: SeatConfig[] = [
  { id: 'a', name: '我', charId: 'jin' },
  { id: 'b', name: '阿柚', charId: 'li' },
  { id: 'c', name: '老周', charId: 'wang' },
  { id: 'd', name: '阿星', charId: 'xing' },
];
const mk = (v19 = true) => createGame({ seed: 7, seats: SEATS, itemsV8: true, v19 });
function ok(s: GameState, seat: number, a: Parameters<typeof applyAction>[2]) {
  const r = applyAction(s, seat, a);
  if (!r.ok) throw new Error(r.error);
  return r;
}
/** 让 0 号从 2 号格掷骰落在 target，tweak 先改局面 */
function landOn(target: number, tweak: (s: GameState) => void, v19 = true) {
  for (let seed = 1; seed < 2000; seed++) {
    const s = mk(v19);
    s.rng = seed; s.seats[0].pos = target - 5; if (s.seats[0].pos < 0) s.seats[0].pos += 32;
    tweak(s);
    const r = applyAction(s, 0, { type: 'roll', zone: 1 });
    if (r.ok && r.state.seats[0].pos === target && !r.events.some((e) => e.t === 'doubles')) return { s, r };
  }
  throw new Error('no seed');
}

describe('v1.9 收购扩展', () => {
  it('地标（lv4）与观光地可收购，价格 = 收购价口径', () => {
    const { s, r } = landOn(9, (s) => { s.tiles[9] = { owner: 1, lv: 4, mortgaged: false }; s.seats[0].cash = 5000; });
    expect(r.state.pending?.kind).toBe('takeover');
    expect(r.state.pending!.options[0].cost).toBe(takeoverCost(s, 0, 9));
    const r2 = ok(r.state, 0, { type: 'choose', option: 0 });
    expect(r2.state.tiles[9]).toMatchObject({ owner: 0, lv: 4 });
    const t = landOn(5, (s) => { s.tiles[5] = { owner: 1, lv: 0, mortgaged: false }; s.seats[0].cash = 5000; });
    expect(t.r.state.pending?.kind).toBe('takeover');
    expect(t.r.state.pending!.options[0].cost).toBe(takeoverCost(t.s, 0, 5));
  });
  it('旧规则（无 v19）地标仍不可收购', () => {
    const { r } = landOn(9, (s) => { s.tiles[9] = { owner: 1, lv: 4, mortgaged: false }; s.seats[0].cash = 5000; }, false);
    expect(r.state.pending?.kind).not.toBe('takeover');
  });
  it('护盾免过路费后仍可收购', () => {
    const { r } = landOn(9, (s) => { s.tiles[9] = { owner: 1, lv: 2, mortgaged: false }; s.seats[0].cash = 5000; s.seats[0].shield = true; });
    expect(r.events.some((e) => e.t === 'shieldUsed')).toBe(true);
    expect(r.state.pending?.kind).toBe('takeover');
  });
  it('现金不足收购：给出 takeoverShort 事件而不是悄悄无事', () => {
    const { r } = landOn(9, (s) => { s.tiles[9] = { owner: 1, lv: 4, mortgaged: false }; s.seats[0].cash = 300; });
    expect(r.state.pending).toBeNull();
    const ev = r.events.find((e) => e.t === 'takeoverShort');
    expect(ev && ev.t === 'takeoverShort' && ev.cost > ev.cash).toBe(true);
  });
  it('抵押格：不收过路费、可购买（折价），抵押状态与赎回责任转给买家', () => {
    const { s, r } = landOn(9, (s) => { s.tiles[9] = { owner: 1, lv: 2, mortgaged: true }; s.seats[0].cash = 5000; });
    expect(r.events.some((e) => e.t === 'pay')).toBe(false);
    expect(r.state.pending?.kind).toBe('takeover');
    const full = Math.round(investedValue(s, 9) * RULES.takeoverMult * (1 - 0));
    const cost = r.state.pending!.options[0].cost;
    expect(cost).toBeLessThan(full);
    expect(cost).toBe(takeoverCost(s, 0, 9));
    const before1 = r.state.seats[1].cash;
    const r2 = ok(r.state, 0, { type: 'choose', option: 0 });
    expect(r2.state.tiles[9]).toMatchObject({ owner: 0, mortgaged: true });
    expect(r2.state.seats[1].cash).toBe(before1 + cost);
    expect(r2.state.phase).not.toBe('choose'); // 抵押中不可加盖
  });
});

describe('v1.9 对局商店', () => {
  it('买道具：扣现金、进手牌、写事件', () => {
    const s = mk(); s.seats[0].items = []; s.seats[0].cash = 100;
    const r = ok(s, 0, { type: 'buyItem', item: 'shield' });
    expect(r.state.seats[0].cash).toBe(100 - ITEM_PRICES.shield);
    expect(r.state.seats[0].items).toEqual(['shield']);
    expect(r.events.some((e) => e.t === 'shopBuy')).toBe(true);
  });
  it('手牌满 / 现金不足 / 非自己回合 / 旧局均拒绝', () => {
    const s = mk(); s.seats[0].cash = 1000;
    s.seats[0].items = ['dice', 'dice', 'dice'];
    expect(applyAction(s, 0, { type: 'buyItem', item: 'shield' }).ok).toBe(false);
    s.seats[0].items = []; s.seats[0].cash = ITEM_PRICES.shield - 1;
    expect(applyAction(s, 0, { type: 'buyItem', item: 'shield' }).ok).toBe(false);
    s.seats[0].cash = 1000;
    expect(applyAction(s, 1, { type: 'buyItem', item: 'shield' }).ok).toBe(false);
    expect(applyAction(mk(false), 0, { type: 'buyItem', item: 'shield' }).ok).toBe(false);
  });
  it('强制收购卡售价 200 万；其余道具价格均配置', () => {
    expect(ITEM_PRICES.forceBuy).toBe(200);
    expect(Object.values(ITEM_PRICES).every((v) => v > 0)).toBe(true);
    expect(Object.keys(ITEM_PRICES)).toHaveLength(11);
  });
});

describe('v1.9 强制收购卡', () => {
  it('目标含地标 / 抵押格 / 观光地，不含己方与空地；用卡即得、不另付钱、等级与抵押保留', () => {
    const s = mk(); s.seats[0].items = ['forceBuy']; s.seats[0].cash = 10;
    s.tiles[9] = { owner: 1, lv: 4, mortgaged: false };
    s.tiles[10] = { owner: 1, lv: 2, mortgaged: true };
    s.tiles[5] = { owner: 2, lv: 0, mortgaged: false };
    s.tiles[1] = { owner: 0, lv: 1, mortgaged: false };
    expect(itemTargets(s, 0, 'forceBuy').sort((a, b) => a - b)).toEqual([5, 9, 10]);
    expect(applyAction(s, 0, { type: 'useItem', item: 'forceBuy', target: 1 }).ok).toBe(false);
    // 不带目标 → 进入选目标流程
    const p = ok(s, 0, { type: 'useItem', item: 'forceBuy' });
    expect(p.state.pending?.kind).toBe('item');
    const r = ok(p.state, 0, { type: 'choose', option: p.state.pending!.options.findIndex((o) => o.value === 10) });
    expect(r.state.tiles[10]).toMatchObject({ owner: 0, lv: 2, mortgaged: true });
    expect(r.state.seats[0].cash).toBe(10);
    expect(r.state.seats[0].items).toEqual([]);
    const r2 = ok(s, 0, { type: 'useItem', item: 'forceBuy', target: 9 });
    expect(r2.state.tiles[9]).toMatchObject({ owner: 0, lv: 4 });
  });
  it('旧局无此道具', () => {
    const s = mk(false); s.seats[0].items = ['forceBuy']; s.tiles[9] = { owner: 1, lv: 1, mortgaged: false };
    expect(applyAction(s, 0, { type: 'useItem', item: 'forceBuy', target: 9 }).ok).toBe(false);
  });
  it('稀有：随机掉落概率约 1%，开局不会发', () => {
    let n = 0, got = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const g = createGame({ seed, seats: SEATS, itemsV8: true, v19: true });
      expect(g.seats.every((p) => !p.items.includes('forceBuy'))).toBe(true);
      // 用过起点月薪抽卡，统计强制收购卡出现次数
      g.seats[0].items = []; g.seats[0].pos = 30;
      const r = applyAction(g, 0, { type: 'roll', zone: 2 });
      if (r.ok) for (const e of r.events) if (e.t === 'itemGained') { n++; if (e.item === 'forceBuy') got++; }
    }
    expect(n).toBeGreaterThan(500);
    expect(got / n).toBeLessThan(0.05);
  });
});

describe('v1.9 回放与事件完整性', () => {
  it('含商店购买的整局可回放一致，事件覆盖各类别', () => {
    const cfg = { seed: 99, seats: SEATS.map((x) => ({ ...x, isBot: true })), specials: true, itemsV8: true, v19: true };
    let s = createGame(cfg); const rec = new ReplayRecorder(cfg); const types = new Set<string>();
    let steps = 0;
    while (s.phase !== 'ended' && steps < 5000) {
      const who = actorOf(s);
      let a = botAction(s, who);
      if (s.phase === 'roll' && steps % 7 === 0 && s.seats[who].items.length < 3 && s.seats[who].cash > 150) a = { type: 'buyItem', item: 'dice' };
      const r = ok(s, who, a); rec.push(who, a); s = r.state; r.events.forEach((e: GameEvent) => types.add(e.t)); steps++;
    }
    expect(s.phase).toBe('ended');
    expect(types.has('shopBuy')).toBe(true);
    expect(types.has('roll')).toBe(true);
    const out = replayGame(rec.toRecord(s));
    expect(out.state.seq).toBe(s.seq);
    expect(out.state.winner).toBe(s.winner);
  });
});
