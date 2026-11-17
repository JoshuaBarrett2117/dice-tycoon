import { describe, expect, it } from 'vitest';
import {
  BOARD, GLOBAL_EVENT_IDS, GROUPS, ISLAND_INDEX, RULES, TOURS, ZONES,
  applyAction, botAction, buildCost, createGame, groupSetOwner, investedValue, migrateState, takeoverCost, tollOf,
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

describe('v0.2 阶段1：道具卡与主动技能', () => {
  const fresh = (seed = 11) => createGame({ seed, seats: SEATS });

  it('开局每人 1 张道具，经过起点补牌且不超过上限', () => {
    const s = fresh();
    s.seats.forEach((p) => expect(p.items).toHaveLength(RULES.itemStart));
    s.seats[0].items = ['shield', 'shield', 'shield'];
    s.seats[0].pos = 30;
    let t = s;
    for (let seed = 1; seed < 200; seed++) {
      t = structuredClone(s); t.rng = seed;
      const r = ok(t, 0, { type: 'roll', zone: 0 });
      if (r.events.some((e) => e.t === 'salary')) { expect(r.state.seats[0].items).toHaveLength(RULES.itemMax); return; }
    }
    throw new Error('未经过起点');
  });

  it('非法使用：没有此牌 / 非掷骰阶段 / 目标非法均报错且不消耗', () => {
    const s = fresh();
    s.seats[0].items = ['teleport'];
    expect(applyAction(s, 0, { type: 'useItem', item: 'shield' }).ok).toBe(false);
    expect(applyAction(s, 0, { type: 'useItem', item: 'teleport', target: ISLAND_INDEX }).ok).toBe(false);
    expect(applyAction(s, 1, { type: 'useItem', item: 'teleport', target: 5 }).ok).toBe(false);
    expect(s.seats[0].items).toEqual(['teleport']);
  });

  it('遥控骰子：指定总点数；不带目标时走 pending 选目标，可取消', () => {
    const s = fresh();
    s.seats[0].items = ['dice'];
    const r = ok(s, 0, { type: 'useItem', item: 'dice' });
    expect(r.state.pending?.kind).toBe('item');
    const c = ok(r.state, 0, { type: 'choose', option: -1 });
    expect(c.state.seats[0].items).toEqual(['dice']);
    expect(c.state.phase).toBe('roll');
    const r2 = ok(r.state, 0, { type: 'choose', option: 5 }); // 7 点
    expect(r2.state.seats[0].forcedSum).toBe(7);
    expect(r2.state.seats[0].items).toEqual([]);
    const r3 = ok(r2.state, 0, { type: 'roll', zone: 0 });
    const e = r3.events.find((x) => x.t === 'roll')!;
    expect(e.t === 'roll' && e.dice[0] + e.dice[1]).toBe(7);
    expect(r3.state.seats[0].forcedSum).toBeNull();
  });

  it('路障：只拦其他玩家，触发后消失；范围限制', () => {
    const s = fresh();
    s.seats[0].items = ['roadblock'];
    expect(applyAction(s, 0, { type: 'useItem', item: 'roadblock', target: 20 }).ok).toBe(false);
    const r = ok(s, 0, { type: 'useItem', item: 'roadblock', target: 3 });
    expect(r.state.roadblocks).toEqual([{ tile: 3, owner: 0 }]);
    const t = structuredClone(r.state);
    t.turn = 1; t.seats[1].pos = 0; t.seats[1].forcedSum = 8;
    const r2 = ok(t, 1, { type: 'roll', zone: 2 });
    expect(r2.state.seats[1].pos).toBe(3);
    expect(r2.events.some((e) => e.t === 'roadblockHit')).toBe(true);
    expect(r2.state.roadblocks).toEqual([]);
    // 自己的路障不拦自己
    const u = structuredClone(r.state);
    u.seats[0].pos = 0; u.seats[0].forcedSum = 6;
    const r3 = ok(u, 0, { type: 'roll', zone: 1 });
    expect(r3.state.seats[0].pos).toBe(6);
    expect(r3.state.roadblocks).toHaveLength(1);
  });

  it('护盾 / 双倍收租（限时至自己下回合开始）', () => {
    const s = fresh();
    s.seats[0].items = ['shield', 'doubleToll'];
    s.tiles[9] = { owner: 0, lv: 2 };
    const base = tollOf(s, 9);
    let r = ok(s, 0, { type: 'useItem', item: 'shield' });
    expect(r.state.seats[0].shield).toBe(true);
    r = ok(r.state, 0, { type: 'useItem', item: 'doubleToll' });
    expect(tollOf(r.state, 9)).toBe(Math.round(base * RULES.doubleTollMult));
    const t = structuredClone(r.state);
    t.seats[0].pos = 0; t.seats[0].forcedSum = 3;
    // 回合结束后仍生效，轮回到自己时清除
    let cur = ok(t, 0, { type: 'roll', zone: 0 }).state;
    if (cur.phase === 'choose') cur = ok(cur, 0, { type: 'choose', option: -1 }).state;
    while (cur.turn !== 0 && cur.phase !== 'ended') {
      expect(cur.seats[0].doubleToll).toBe(true);
      cur = ok(cur, cur.turn, botAction(cur, cur.turn)).state;
    }
    if (cur.phase !== 'ended') expect(cur.seats[0].doubleToll).toBe(false);
  });

  it('强拆 / 免费建造 / 传送', () => {
    const s = fresh();
    s.seats[0].items = ['demolish', 'freeBuild', 'teleport'];
    s.tiles[9] = { owner: 1, lv: 3 };
    s.tiles[10] = { owner: 1, lv: 4 };
    s.tiles[1] = { owner: 0, lv: 1 };
    expect(applyAction(s, 0, { type: 'useItem', item: 'demolish', target: 10 }).ok).toBe(false);
    let r = ok(s, 0, { type: 'useItem', item: 'demolish', target: 9 });
    expect(r.state.tiles[9].lv).toBe(2);
    r = ok(r.state, 0, { type: 'useItem', item: 'freeBuild', target: 1 });
    expect(r.state.tiles[1].lv).toBe(2);
    expect(r.state.seats[0].cash).toBe(RULES.startCash);
    r = ok(r.state, 0, { type: 'useItem', item: 'teleport', target: 5 });
    expect(r.state.seats[0].pos).toBe(5);
    expect(r.events.some((e) => e.t === 'move' && e.via === 'fly')).toBe(true);
    // 传送后若无待选项，仍在 roll 阶段可继续掷骰
    if (r.state.phase === 'choose') r = ok(r.state, 0, { type: 'choose', option: -1 });
    expect(r.state.phase).toBe('roll');
    expect(r.state.turn).toBe(0);
  });

  it('五个角色技能与冷却', () => {
    const run = (charId: 'jin' | 'li' | 'wang' | 'xing' | 'panda') => {
      const s = createGame({ seed: 3, seats: [{ id: 'a', name: 'a', charId }, SEATS[1]] });
      s.tiles[1] = { owner: 0, lv: 1 };
      return s;
    };
    let s = run('jin');
    let r = ok(s, 0, { type: 'useSkill' });
    expect(r.state.seats[0].cash).toBe(RULES.startCash + Math.round((RULES.startCash + 6) * RULES.jinSkillRate));
    expect(r.state.seats[0].skillCd).toBe(RULES.skillCooldown);
    expect(applyAction(r.state, 0, { type: 'useSkill' }).ok).toBe(false);
    s = run('jin'); s.seats[0].cash = 5000;
    expect(ok(s, 0, { type: 'useSkill' }).state.seats[0].cash).toBe(5000 + RULES.jinSkillCap);

    s = run('li'); s.tiles[9] = { owner: 1, lv: 1 };
    const before = takeoverCost(s, 0, 9);
    r = ok(s, 0, { type: 'useSkill' });
    expect(Math.abs(takeoverCost(r.state, 0, 9) - before * RULES.liSkillTakeover)).toBeLessThanOrEqual(1);

    s = run('wang'); s.tiles[9] = { owner: 0, lv: 1 };
    const tb = tollOf(s, 9);
    r = ok(s, 0, { type: 'useSkill' });
    expect(tollOf(r.state, 9)).toBe(Math.round(tb * RULES.wangSkillToll));

    s = run('xing');
    r = ok(s, 0, { type: 'useSkill' });
    expect(r.state.seats[0].xingPerfect).toBe(true);
    const r2 = ok(r.state, 0, { type: 'roll', zone: 3 });
    const e = r2.events.find((x) => x.t === 'roll')!;
    expect(e.t === 'roll' && e.hit).toBe(true);

    s = run('panda');
    r = ok(s, 0, { type: 'useSkill' });
    expect(r.state.tiles[1].lv).toBe(2);
    s = run('panda'); s.tiles[1] = { owner: 0, lv: 4 };
    r = ok(s, 0, { type: 'useSkill' });
    expect(r.state.seats[0].cash).toBe(RULES.startCash + RULES.pandaSkillCash);
  });

  it('冷却随自己的回合递减', () => {
    let s = fresh();
    s.seats[0].skillCd = 2;
    for (let n = 0; n < 40 && s.phase !== 'ended'; n++) {
      s = ok(s, s.turn, botAction(s, s.turn)).state;
    }
    expect(s.seats[0].skillCd).toBeLessThanOrEqual(RULES.skillCooldown);
  });

  it('带道具技能的机器人对局仍可回放且能结束', () => {
    const a = playOut(7), b = playOut(7);
    expect(a.s).toEqual(b.s);
    expect(a.s.phase).toBe('ended');
    for (let seed = 100; seed < 130; seed++) expect(playOut(seed).s.phase).toBe('ended');
  });
});

describe('v0.2 阶段2：全局事件 / 色组加成 / 机会卡', () => {
  const fresh = (seed = 21) => createGame({ seed, seats: SEATS });
  const nextRoundStart = (s0: GameState) => {
    // 让全员依次结束回合直到轮回；返回刚进入新一轮时的 { state, events }
    let s = s0;
    for (let n = 0; n < 200; n++) {
      const r = ok(s, s.turn, botAction(s, s.turn));
      const wasRound = s.round;
      s = r.state;
      if (s.round > wasRound) return { s, events: r.events };
    }
    throw new Error('未进入下一轮');
  };

  it('全局事件：每 3 回合在回合开始抽取，持续 1 回合；其余回合无事件', () => {
    let s = fresh(5);
    const draws: number[] = [];
    for (let n = 0; n < 4000 && s.phase !== 'ended' && s.round <= 13; n++) {
      const wasRound = s.round;
      const r = ok(s, s.turn, botAction(s, s.turn));
      s = r.state;
      if (s.round !== wasRound) {
        if (s.round % RULES.globalEventEvery !== 0 && s.globalEvent) throw new Error('非抽取回合不应有事件');
        if (r.events.some((e) => e.t === 'globalEvent' && s.round % RULES.globalEventEvery === 0)) draws.push(s.round);
        if (s.globalEvent) expect(s.globalEvent.untilRound).toBe(s.round);
      }
    }
    expect(draws.length).toBeGreaterThanOrEqual(2);
    draws.forEach((r) => expect(r % RULES.globalEventEvery).toBe(0));
  });

  it('全局事件抽取覆盖所有类型且只走 state.rng（同 seed 可复现）', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const s = fresh(seed); s.round = 2;
      s.turn = 3; // 下一位是 0 号 → 进入第 3 回合
      s.seats[3].pos = ISLAND_INDEX; s.seats[3].islandTurns = 2; // 在岛上不掷双数则直接结束回合
      const r = ok(s, 3, { type: 'roll', zone: 1 });
      const e = r.events.find((x) => x.t === 'globalEvent');
      if (e && e.t === 'globalEvent') seen.add(e.id);
      const again = ok(s, 3, { type: 'roll', zone: 1 });
      expect(again.state.globalEvent).toEqual(r.state.globalEvent);
    }
    expect([...seen].sort()).toEqual([...GLOBAL_EVENT_IDS].sort());
  });

  it('全局事件倍率：旅游旺季 / 地产热潮 / 经济萧条 / 建设补贴；过期后恢复', () => {
    const s = fresh();
    s.tiles[9] = { owner: 1, lv: 2 };  // 东京（城市，小狸持有）
    s.tiles[5] = { owner: 1, lv: 0 };  // 桂林（观光地）
    const city = tollOf(s, 9), tour = tollOf(s, 5);
    s.globalEvent = { id: 'tourBoom', untilRound: s.round };
    expect(tollOf(s, 5)).toBe(tour * 2);
    expect(tollOf(s, 9)).toBe(city);
    s.globalEvent = { id: 'propertyBoom', untilRound: s.round };
    expect(tollOf(s, 9)).toBe(Math.round(18 * RULES.tollMult[2] * 1.3));
    s.globalEvent = { id: 'recession', untilRound: s.round };
    expect(tollOf(s, 9)).toBe(Math.round(18 * RULES.tollMult[2] * 0.7));
    s.globalEvent = { id: 'subsidy', untilRound: s.round };
    const cost = buildCost(s, 0, 9, 0, 1);
    s.globalEvent = null;
    expect(cost).toBe(Math.round(9 * (1 - 0.08) * 0.7));
    expect(cost).toBeLessThan(buildCost(s, 0, 9, 0, 1));
    // 已过期的事件不再生效
    s.globalEvent = { id: 'recession', untilRound: s.round - 1 };
    expect(tollOf(s, 9)).toBe(city);
  });

  it('经济萧条同时压低月薪', () => {
    const s = fresh(); s.seats[0].pos = 30; s.globalEvent = { id: 'recession', untilRound: s.round };
    for (let seed = 1; seed < 300; seed++) {
      const t = structuredClone(s); t.rng = seed;
      const r = ok(t, 0, { type: 'roll', zone: 0 });
      const e = r.events.find((x) => x.t === 'salary');
      if (e && e.t === 'salary') { expect(e.amount).toBe(Math.round(RULES.salary * 0.7)); return; }
    }
    throw new Error('未经过起点');
  });

  it('叠加顺序：先节庆/色组/持有者倍率，再全局倍率，最后取整一次', () => {
    const s = fresh();
    GROUPS.g3.forEach((i) => (s.tiles[i] = { owner: 2, lv: 1 })); // 老王集齐 g3（东京、大阪）
    s.festivalTile = 9;
    s.seats[2].doubleToll = true;
    s.globalEvent = { id: 'propertyBoom', untilRound: s.round };
    const expected = Math.round(18 * RULES.tollMult[1] * RULES.festivalMult * RULES.groupSetTollMult * (1 + 0.1) * RULES.doubleTollMult * 1.3);
    expect(tollOf(s, 9)).toBe(expected);
  });

  it('色组集齐：该组城市过路费 ×1.5，缺一块则无加成；观光地不受影响', () => {
    const s = fresh();
    s.tiles[9] = { owner: 0, lv: 1 };
    const base = tollOf(s, 9);
    s.tiles[10] = { owner: 0, lv: 0 };
    expect(groupSetOwner(s, 9)).toBe(0);
    expect(tollOf(s, 9)).toBe(Math.round(18 * RULES.tollMult[1] * RULES.groupSetTollMult));
    expect(tollOf(s, 9)).toBeGreaterThan(base);
    s.tiles[10] = { owner: 1, lv: 0 };
    expect(groupSetOwner(s, 9)).toBeNull();
    expect(tollOf(s, 9)).toBe(base);
  });

  const cardRun = (cardId: string, setup: (s: GameState) => void, check: (r: ReturnType<typeof ok>, s: GameState) => void) => {
    // 0 号站在起点，遥控 2 点落到机会格（2），搜索能抽到指定卡的 rng
    for (let seed = 1; seed < 6000; seed++) {
      const s = fresh(); setup(s); s.rng = seed; s.seats[0].forcedSum = 2;
      const r = applyAction(s, 0, { type: 'roll', zone: 0 });
      if (!r.ok) continue;
      const c = r.events.find((e) => e.t === 'card');
      if (c && c.t === 'card' && c.card === cardId) { check(r, s); return; }
    }
    throw new Error('没抽到 ' + cardId);
  };

  it('机会卡 12 种：生日派对', () => {
    cardRun('birthday', () => {}, (r) => {
      expect(r.state.seats[0].cash).toBe(RULES.startCash + 3 * RULES.birthdayGift);
      [1, 2, 3].forEach((i) => expect(r.state.seats[i].cash).toBe(RULES.startCash - RULES.birthdayGift));
    });
  });
  it('机会卡：前进 3 步按落地结算', () => {
    cardRun('forward', () => {}, (r) => {
      expect(r.state.seats[0].pos).toBe(5); // 机会(2)+3 = 桂林(观光地)
      expect(r.state.pending?.kind).toBe('buy');
    });
  });
  it('机会卡：后退 3 步（经过起点不领月薪），落地结算', () => {
    cardRun('back', (s) => { s.tiles[31] = { owner: 1, lv: 1 }; }, (r) => {
      expect(r.state.seats[0].pos).toBe(31);
      expect(r.events.some((e) => e.t === 'salary')).toBe(false);
      expect(r.events.some((e) => e.t === 'pay' && e.reason === 'toll' && e.tile === 31)).toBe(true);
    });
  });
  it('机会卡：道具补给（满手牌改发现金）', () => {
    cardRun('itemSupply', (s) => { s.seats[0].items = []; }, (r) => expect(r.state.seats[0].items).toHaveLength(1));
    cardRun('itemSupply', (s) => { s.seats[0].items = ['shield', 'shield', 'shield']; }, (r) => {
      expect(r.state.seats[0].items).toHaveLength(RULES.itemMax);
      expect(r.state.seats[0].cash).toBe(RULES.startCash + RULES.itemSupplyCash);
    });
  });
  it('机会卡：税务返还（10%，上限 20 万）', () => {
    cardRun('taxRefund', () => {}, (r) => expect(r.state.seats[0].cash).toBe(RULES.startCash + Math.min(RULES.refundCap, Math.round(RULES.startCash * RULES.refundRate))));
    cardRun('taxRefund', (s) => { s.seats[0].cash = 5000; }, (r) => expect(r.state.seats[0].cash).toBe(5000 + RULES.refundCap));
  });
  it('机会卡：双倍月薪只生效一次', () => {
    cardRun('doubleSalary', () => {}, (r) => {
      expect(r.state.seats[0].doubleSalary).toBe(true);
      const s = structuredClone(r.state);
      s.seats[0].pos = 30; s.seats[0].forcedSum = 4; s.turn = 0; s.phase = 'roll'; s.pending = null;
      const r2 = ok(s, 0, { type: 'roll', zone: 0 });
      const e = r2.events.find((x) => x.t === 'salary');
      expect(e && e.t === 'salary' && e.amount).toBe(RULES.salary * RULES.doubleSalaryMult);
      expect(r2.state.seats[0].doubleSalary).toBe(false);
    });
  });

  it('migrateState：v1 快照补齐新字段', () => {
    const s = fresh() as unknown as Record<string, unknown>;
    const old = structuredClone(s) as { version: number; globalEvent?: unknown; seats: { doubleSalary?: unknown }[] };
    old.version = 1; delete old.globalEvent; delete old.seats[0].doubleSalary;
    const m = migrateState(old);
    expect(m.version).toBe(2);
    expect(m.globalEvent).toBeNull();
    expect(m.seats[0].doubleSalary).toBe(false);
    expect(() => migrateState({ version: 9 })).toThrow();
  });
});
