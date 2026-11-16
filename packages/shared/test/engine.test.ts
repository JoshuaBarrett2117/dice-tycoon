import { describe, expect, it } from 'vitest';
import {
  BOARD, GROUPS, ISLAND_INDEX, RULES, TOURS, ZONES,
  applyAction, botAction, createGame, investedValue, takeoverCost, tollOf,
  type GameState, type SeatConfig,
} from '../src';

const SEATS: SeatConfig[] = [
  { id: 'a', name: '我', charId: 'jin' },
  { id: 'b', name: '阿柚', charId: 'li' },
  { id: 'c', name: '老周', charId: 'wang' },
  { id: 'd', name: '阿星', charId: 'xing' },
];

function ok(s: GameState, seat: number, a: Parameters<typeof applyAction>[2]) {
  const r = applyAction(s, seat, a);
  if (!r.ok) throw new Error(r.error);
  return r;
}

/** 让机器人一直玩到结束，返回最终状态与步数 */
function playOut(seed: number, maxSteps = 5000) {
  let s = createGame({ seed, seats: SEATS.map((x) => ({ ...x, isBot: true })) });
  let steps = 0;
  while (s.phase !== 'ended' && steps < maxSteps) {
    s = ok(s, s.turn, botAction(s, s.turn)).state;
    steps++;
  }
  return { s, steps };
}

describe('棋盘', () => {
  it('32 格、四角位置正确', () => {
    expect(BOARD).toHaveLength(32);
    expect([0, 8, 16, 24].map((i) => BOARD[i].kind)).toEqual(['corner', 'corner', 'corner', 'corner']);
    expect(TOURS).toHaveLength(4);
    expect(Object.values(GROUPS).flat()).toHaveLength(19);
  });
});

describe('掷骰与控骰', () => {
  it('同一 seed 同一操作序列结果完全一致（可回放）', () => {
    const a = playOut(42), b = playOut(42);
    expect(a.s).toEqual(b.s);
    expect(a.steps).toBe(b.steps);
  });

  it('命中率接近角色控骰值', () => {
    let hits = 0, n = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const s = createGame({ seed, seats: SEATS });
      const r = ok(s, 0, { type: 'roll', zone: 1 });
      const e = r.events.find((x) => x.t === 'roll')!;
      if (e.t === 'roll') {
        const sum = e.dice[0] + e.dice[1];
        if (sum >= ZONES[1].lo && sum <= ZONES[1].hi) hits++;
        n++;
      }
    }
    // 金多多 45% 必中 + 55% × 自然落入 5–7 的概率 (15/36) ≈ 68%
    expect(hits / n).toBeGreaterThan(0.6);
    expect(hits / n).toBeLessThan(0.76);
  });

  it('非当前玩家或错误阶段的操作被拒绝', () => {
    const s = createGame({ seed: 1, seats: SEATS });
    expect(applyAction(s, 1, { type: 'roll', zone: 0 }).ok).toBe(false);
    expect(applyAction(s, 0, { type: 'choose', option: 0 }).ok).toBe(false);
    expect(applyAction(s, 0, { type: 'roll', zone: 9 }).ok).toBe(false);
  });
});

describe('地产', () => {
  it('过路费按等级计算，节庆翻倍，收购价为投入 ×2', () => {
    const s = createGame({ seed: 1, seats: SEATS });
    s.tiles[9] = { owner: 1, lv: 2 }; // 东京 18 万
    expect(tollOf(s, 9)).toBe(Math.round(18 * RULES.tollMult[2]));
    s.festivalTile = 9;
    expect(tollOf(s, 9)).toBe(Math.round(18 * RULES.tollMult[2] * 2));
    expect(investedValue(s, 9)).toBe(18 + 9 + 18);
    // 小狸收购折扣 10%
    expect(takeoverCost(s, 1, 9)).toBe(Math.round(45 * 2 * 0.9));
  });

  it('踩到别人地付费，然后可收购；地标不可收购', () => {
    const base = createGame({ seed: 7, seats: SEATS });
    // 找一个能让 0 号玩家走到 9（东京）的种子：直接把棋子放在 9 前面
    for (let seed = 1; seed < 400; seed++) {
      const s = structuredClone(base);
      s.rng = seed;
      s.seats[0].pos = 2;
      s.tiles[9] = { owner: 1, lv: 1 };
      const r = ok(s, 0, { type: 'roll', zone: 1 });
      if (r.state.seats[0].pos !== 9) continue;
      const pay = r.events.find((e) => e.t === 'pay');
      expect(pay && pay.t === 'pay' && pay.to).toBe(1);
      expect(r.state.pending?.kind).toBe('takeover');
      const r2 = ok(r.state, 0, { type: 'choose', option: 0 });
      expect(r2.state.tiles[9].owner).toBe(0);
      // 地标锁定
      const s3 = structuredClone(base);
      s3.rng = seed; s3.seats[0].pos = 2; s3.tiles[9] = { owner: 1, lv: 4 };
      const r3 = ok(s3, 0, { type: 'roll', zone: 1 });
      expect(r3.state.pending?.kind).not.toBe('takeover');
      return;
    }
    throw new Error('没找到合适的种子');
  });

  it('现金不足先变卖地产，仍不足则破产', () => {
    const s = createGame({ seed: 3, seats: SEATS.slice(0, 2) });
    s.seats[0].cash = 1;
    s.tiles[1] = { owner: 0, lv: 0 };
    s.tiles[30] = { owner: 1, lv: 4 }; s.tiles[31] = { owner: 1, lv: 4 };
    for (let seed = 1; seed < 400; seed++) {
      const t = structuredClone(s);
      t.rng = seed; t.seats[0].pos = 26;
      const r = applyAction(t, 0, { type: 'roll', zone: 0 });
      if (!r.ok || ![30, 31].includes(r.state.seats[0].pos)) continue;
      expect(r.events.some((e) => e.t === 'sell')).toBe(true);
      expect(r.state.seats[0].bankrupt).toBe(true);
      expect(r.state.phase).toBe('ended');
      expect(r.state.winner).toBe(1);
      return;
    }
    throw new Error('没找到合适的种子');
  });
});

describe('胜负', () => {
  it('观光地独占立即获胜', () => {
    const s = createGame({ seed: 5, seats: SEATS });
    TOURS.slice(0, 3).forEach((i) => (s.tiles[i] = { owner: 0, lv: 0 }));
    for (let seed = 1; seed < 500; seed++) {
      const t = structuredClone(s);
      t.rng = seed; t.seats[0].pos = 22; // 26 大峡谷在 4 步后
      const r = ok(t, 0, { type: 'roll', zone: 0 });
      if (r.state.seats[0].pos !== 26) continue;
      const r2 = ok(r.state, 0, { type: 'choose', option: 0 });
      expect(r2.state.phase).toBe('ended');
      expect(r2.state.winReason).toBe('tour');
      return;
    }
    throw new Error('没找到合适的种子');
  });

  it('连续三次双数进无人岛', () => {
    for (let seed = 1; seed < 20000; seed++) {
      let s = createGame({ seed, seats: SEATS });
      s.rng = seed;
      let doubles = 0, island = false;
      for (let k = 0; k < 3; k++) {
        const r = applyAction(s, 0, { type: 'roll', zone: 0 });
        if (!r.ok) break;
        const e = r.events.find((x) => x.t === 'roll');
        if (!e || e.t !== 'roll' || e.dice[0] !== e.dice[1]) break;
        doubles++;
        s = r.state;
        if (s.phase === 'choose') s = ok(s, 0, { type: 'choose', option: -1 }).state;
        if (s.seats[0].pos === ISLAND_INDEX && s.seats[0].islandTurns > 0) { island = true; break; }
        if (s.turn !== 0) break;
      }
      if (doubles === 3) { expect(island).toBe(true); return; }
    }
    throw new Error('没找到三连双数');
  });

  it('机器人对局总能结束（独占、破产或回合上限）', () => {
    const reasons = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const { s } = playOut(seed);
      expect(s.phase).toBe('ended');
      expect(s.winner).not.toBeNull();
      reasons.add(s.winReason!);
      // 资金守恒性检查：没有负现金
      s.seats.forEach((p) => expect(p.cash).toBeGreaterThanOrEqual(0));
    }
    expect(reasons.size).toBeGreaterThan(1);
  });
});
