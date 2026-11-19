import { describe, expect, it } from 'vitest';
import {
  BOARD, GLOBAL_EVENT_IDS, GROUPS, ISLAND_INDEX, RULES, TOURS, ZONES,
  CHARACTERS, FREE_CHAR_IDS, PAID_CHAR_IDS, MATCH, SPECIAL_TILES, THEMES, THEME_IDS, MatchQueue, ReplayPlayer, ReplayRecorder, SPECTATE, actorOf, applyAction, botAction, buildCost, createGame, groupSetOwner, investedValue, migrateState, monopolyOf, mortgageValue, redeemCost, replayGame, takeoverCost, tollOf, totalAssets, upgradeOptions,
  type BotDifficulty, type GameState, type SeatConfig,
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
    s = ok(s, actorOf(s), botAction(s, actorOf(s))).state;
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
    s.tiles[9] = { owner: 1, lv: 2, mortgaged: false }; // 东京 18 万
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
      s.tiles[9] = { owner: 1, lv: 1, mortgaged: false };
      const r = ok(s, 0, { type: 'roll', zone: 1 });
      if (r.state.seats[0].pos !== 9) continue;
      const pay = r.events.find((e) => e.t === 'pay');
      expect(pay && pay.t === 'pay' && pay.to).toBe(1);
      expect(r.state.pending?.kind).toBe('takeover');
      const r2 = ok(r.state, 0, { type: 'choose', option: 0 });
      expect(r2.state.tiles[9].owner).toBe(0);
      // 地标锁定
      const s3 = structuredClone(base);
      s3.rng = seed; s3.seats[0].pos = 2; s3.tiles[9] = { owner: 1, lv: 4, mortgaged: false };
      const r3 = ok(s3, 0, { type: 'roll', zone: 1 });
      expect(r3.state.pending?.kind).not.toBe('takeover');
      return;
    }
    throw new Error('没找到合适的种子');
  });

  it('现金不足先变卖地产，仍不足则破产', () => {
    const s = createGame({ seed: 3, seats: SEATS.slice(0, 2) });
    s.seats[0].cash = 1;
    s.tiles[1] = { owner: 0, lv: 0, mortgaged: false };
    s.tiles[30] = { owner: 1, lv: 4, mortgaged: false }; s.tiles[31] = { owner: 1, lv: 4, mortgaged: false };
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
    TOURS.slice(0, 3).forEach((i) => (s.tiles[i] = { owner: 0, lv: 0, mortgaged: false }));
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
    s.tiles[9] = { owner: 0, lv: 2, mortgaged: false };
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
    while ((cur.turn !== 0 || cur.phase !== 'roll') && cur.phase !== 'ended') {
      expect(cur.seats[0].doubleToll).toBe(true);
      cur = ok(cur, actorOf(cur), botAction(cur, actorOf(cur))).state;
    }
    if (cur.phase !== 'ended') expect(cur.seats[0].doubleToll).toBe(false);
  });

  it('强拆 / 免费建造 / 传送', () => {
    const s = fresh();
    s.seats[0].items = ['demolish', 'freeBuild', 'teleport'];
    s.tiles[9] = { owner: 1, lv: 3, mortgaged: false };
    s.tiles[10] = { owner: 1, lv: 4, mortgaged: false };
    s.tiles[1] = { owner: 0, lv: 1, mortgaged: false };
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
    while (r.state.phase === 'choose') r = ok(r.state, actorOf(r.state), { type: 'choose', option: -1 }); // 放弃购买 → 竞拍全员弃拍
    expect(r.state.phase).toBe('roll');
    expect(r.state.turn).toBe(0);
  });

  it('五个角色技能与冷却', () => {
    const run = (charId: 'jin' | 'li' | 'wang' | 'xing' | 'panda') => {
      const s = createGame({ seed: 3, seats: [{ id: 'a', name: 'a', charId }, SEATS[1]] });
      s.tiles[1] = { owner: 0, lv: 1, mortgaged: false };
      return s;
    };
    let s = run('jin');
    let r = ok(s, 0, { type: 'useSkill' });
    expect(r.state.seats[0].cash).toBe(RULES.startCash + Math.round((RULES.startCash + 6) * RULES.jinSkillRate));
    expect(r.state.seats[0].skillCd).toBe(RULES.skillCooldown);
    expect(applyAction(r.state, 0, { type: 'useSkill' }).ok).toBe(false);
    s = run('jin'); s.seats[0].cash = 5000;
    expect(ok(s, 0, { type: 'useSkill' }).state.seats[0].cash).toBe(5000 + RULES.jinSkillCap);

    s = run('li'); s.tiles[9] = { owner: 1, lv: 1, mortgaged: false };
    const before = takeoverCost(s, 0, 9);
    r = ok(s, 0, { type: 'useSkill' });
    expect(Math.abs(takeoverCost(r.state, 0, 9) - before * RULES.liSkillTakeover)).toBeLessThanOrEqual(1);

    s = run('wang'); s.tiles[9] = { owner: 0, lv: 1, mortgaged: false };
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
    s = run('panda'); s.tiles[1] = { owner: 0, lv: 4, mortgaged: false };
    r = ok(s, 0, { type: 'useSkill' });
    expect(r.state.seats[0].cash).toBe(RULES.startCash + RULES.pandaSkillCash);
  });

  it('冷却随自己的回合递减', () => {
    let s = fresh();
    s.seats[0].skillCd = 2;
    for (let n = 0; n < 40 && s.phase !== 'ended'; n++) {
      s = ok(s, actorOf(s), botAction(s, actorOf(s))).state;
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
      const r = ok(s, actorOf(s), botAction(s, actorOf(s)));
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
      const r = ok(s, actorOf(s), botAction(s, actorOf(s)));
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
    s.tiles[9] = { owner: 1, lv: 2, mortgaged: false };  // 东京（城市，小狸持有）
    s.tiles[5] = { owner: 1, lv: 0, mortgaged: false };  // 桂林（观光地）
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
    GROUPS.g3.forEach((i) => (s.tiles[i] = { owner: 2, lv: 1, mortgaged: false })); // 老王集齐 g3（东京、大阪）
    s.festivalTile = 9;
    s.seats[2].doubleToll = true;
    s.globalEvent = { id: 'propertyBoom', untilRound: s.round };
    const expected = Math.round(18 * RULES.tollMult[1] * RULES.festivalMult * RULES.groupSetTollMult * (1 + 0.1) * RULES.doubleTollMult * 1.3);
    expect(tollOf(s, 9)).toBe(expected);
  });

  it('色组集齐：该组城市过路费 ×1.5，缺一块则无加成；观光地不受影响', () => {
    const s = fresh();
    s.tiles[9] = { owner: 0, lv: 1, mortgaged: false };
    const base = tollOf(s, 9);
    s.tiles[10] = { owner: 0, lv: 0, mortgaged: false };
    expect(groupSetOwner(s, 9)).toBe(0);
    expect(tollOf(s, 9)).toBe(Math.round(18 * RULES.tollMult[1] * RULES.groupSetTollMult));
    expect(tollOf(s, 9)).toBeGreaterThan(base);
    s.tiles[10] = { owner: 1, lv: 0, mortgaged: false };
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
    cardRun('back', (s) => { s.tiles[31] = { owner: 1, lv: 1, mortgaged: false }; }, (r) => {
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

describe('v0.2 阶段3：回放导出与 accountId 透传', () => {
  const record = (seed: number, seats: SeatConfig[]) => {
    const cfg = { seed, seats };
    let s = createGame(cfg);
    const rec = new ReplayRecorder(cfg);
    while (s.phase !== 'ended') {
      const who = actorOf(s), a = botAction(s, who);
      const r = ok(s, who, a);
      rec.push(who, a);
      s = r.state;
    }
    return { final: s, rec: rec.toRecord(s) };
  };

  it('重放同一操作序列得到与原局完全一致的最终 GameState', () => {
    for (const seed of [3, 42, 777]) {
      const { final, rec } = record(seed, SEATS.map((x) => ({ ...x, isBot: true })));
      // 经 JSON 往返，确保导出文件可独立重放
      const parsed = JSON.parse(JSON.stringify(rec));
      const re = replayGame(parsed);
      expect(re.state).toEqual(final);
      expect(re.state.seq).toBe(rec.result!.seq);
      expect(rec.result!.winner).toBe(final.winner);
      expect(re.events.some((e) => e.t === 'end')).toBe(true);
    }
  });

  it('被篡改的操作序列在重放时被拒绝', () => {
    const { rec } = record(5, SEATS.map((x) => ({ ...x, isBot: true })));
    rec.actions[0] = { seat: 3, action: { type: 'roll', zone: 0 } };
    expect(() => replayGame(rec)).toThrow();
    expect(() => replayGame({ ...rec, format: 'x' as never })).toThrow();
  });

  it('accountId 只透传：写入座位与回放记录，不影响规则结果', () => {
    const withAcc = SEATS.map((x, i) => ({ ...x, isBot: true, accountId: `acc-${i}` }));
    const a = record(9, withAcc), b = record(9, SEATS.map((x) => ({ ...x, isBot: true })));
    expect(a.final.seats.map((p) => p.accountId)).toEqual(['acc-0', 'acc-1', 'acc-2', 'acc-3']);
    expect(b.final.seats.every((p) => p.accountId === undefined)).toBe(true);
    expect(a.rec.seats.map((x) => x.accountId)).toEqual(['acc-0', 'acc-1', 'acc-2', 'acc-3']);
    // 去掉 accountId 后两局完全一致
    const strip = (s: GameState) => ({ ...s, seats: s.seats.map(({ accountId: _a, ...p }) => p) });
    expect(strip(a.final)).toEqual(strip(b.final));
  });
});

describe('v0.2 阶段4：竞拍', () => {
  const fresh = () => {
    const s = createGame({ seed: 31, seats: SEATS });
    s.seats.forEach((p) => (p.items = []));
    return s;
  };
  /** 0 号落在东京（9，地价 18）并拿到「购买」待选项 */
  const landBuy = (s = fresh()) => {
    s.seats[0].pos = 0; s.seats[0].forcedSum = 9;
    const r = ok(s, 0, { type: 'roll', zone: 2 });
    expect(r.state.pending?.kind).toBe('buy');
    return r.state;
  };
  const pass = (s: GameState) => ok(s, actorOf(s), { type: 'choose', option: -1 });

  it('放弃购买 → 竞拍，起拍价为地价 50%，由下家开始出价；非出价人不能操作', () => {
    const r = ok(landBuy(), 0, { type: 'choose', option: -1 });
    const p = r.state.pending!;
    expect(p.kind).toBe('auction');
    expect(p.seat).toBe(1);
    expect(p.tile).toBe(9);
    expect(p.options[0].value).toBe(Math.round(18 * RULES.auctionStartRatio));
    expect(r.state.turn).toBe(0); // 回合玩家不变
    expect(actorOf(r.state)).toBe(1);
    expect(applyAction(r.state, 0, { type: 'choose', option: 0 }).ok).toBe(false);
    expect(applyAction(r.state, 2, { type: 'choose', option: 0 }).ok).toBe(false);
    expect(r.events.some((e) => e.t === 'auctionStart')).toBe(true);
  });

  it('全员弃拍 → 流拍，地块仍无主，回合照常推进', () => {
    let r = ok(landBuy(), 0, { type: 'choose', option: -1 });
    r = pass(r.state); r = pass(r.state); r = pass(r.state);
    expect(r.state.tiles[9].owner).toBeNull();
    expect(r.events.some((e) => e.t === 'auctionFail')).toBe(true);
    expect(r.state.phase).toBe('roll');
    expect(r.state.turn).toBe(1);
  });

  it('轮流加价，价高者以 lv0 成交并付款，最小加价 5 万', () => {
    let r = ok(landBuy(), 0, { type: 'choose', option: -1 });   // 1 号先出价
    r = ok(r.state, 1, { type: 'choose', option: 0 });          // 1 出 9
    expect(r.state.pending!.seat).toBe(2);
    expect(r.state.pending!.options[0].value).toBe(9 + RULES.auctionMinRaise);
    r = ok(r.state, 2, { type: 'choose', option: 1 });          // 2 出 14+10=24
    expect(r.state.pending!.options[0].value).toBe(24 + RULES.auctionMinRaise);
    r = pass(r.state);                                          // 3 弃拍
    expect(r.state.pending!.seat).toBe(1);                      // 1 号再次被询问（已被超过）
    r = pass(r.state);                                          // 1 弃拍 → 2 号最高价者得
    expect(r.state.tiles[9]).toEqual({ owner: 2, lv: 0, mortgaged: false });
    expect(r.state.seats[2].cash).toBe(RULES.startCash - 24);
    expect(r.state.seats[1].cash).toBe(RULES.startCash);        // 弃拍者不付钱
    expect(r.state.seats[0].cash).toBe(RULES.startCash);
    expect(r.events.find((e) => e.t === 'auctionWin')).toMatchObject({ seat: 2, tile: 9, amount: 24 });
    expect(r.state.turn).toBe(1);
  });

  it('现金不足最低报价的玩家自动弃拍；出价选项不超过现金', () => {
    const s = landBuy();
    s.seats[1].cash = 5; s.seats[2].cash = 12;
    const r = ok(s, 0, { type: 'choose', option: -1 });
    expect(r.events.some((e) => e.t === 'auctionPass' && e.seat === 1)).toBe(true);
    expect(r.state.pending!.seat).toBe(2);
    expect(r.state.pending!.options.map((o) => o.value)).toEqual([9]); // 9+10 超过 12 现金
  });

  it('机器人 / 托管能推进竞拍，且整局可回放', () => {
    let seen = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { s } = playOut(seed);
      expect(s.phase).toBe('ended');
      const a = playOut(seed).s;
      expect(a).toEqual(s);
    }
    // 统计竞拍确实发生过
    for (let seed = 1; seed <= 40 && !seen; seed++) {
      let s = createGame({ seed, seats: SEATS.map((x) => ({ ...x, isBot: true })) });
      while (s.phase !== 'ended') {
        const r = ok(s, actorOf(s), botAction(s, actorOf(s)));
        if (r.events.some((e) => e.t === 'auctionWin')) seen++;
        s = r.state;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('v0.2 阶段4：抵押与赎回', () => {
  const fresh = () => {
    const s = createGame({ seed: 41, seats: SEATS });
    s.seats.forEach((p) => (p.items = []));
    return s;
  };

  it('抵押：得款为投入 ×50%，赎回价为得款 ×110%；非法情形报错且不改状态', () => {
    const s = fresh();
    s.tiles[9] = { owner: 0, lv: 2, mortgaged: false }; // 18 + 9 + 18 = 45
    const gain = Math.round(45 * RULES.mortgageRatio);
    expect(mortgageValue(s, 9)).toBe(gain);
    expect(redeemCost(s, 9)).toBe(Math.round(gain * RULES.redeemMult));
    expect(applyAction(s, 0, { type: 'mortgage', tile: 10 }).ok).toBe(false); // 无主
    expect(applyAction(s, 1, { type: 'mortgage', tile: 9 }).ok).toBe(false);  // 非本回合
    expect(applyAction(s, 0, { type: 'mortgage', tile: 2 }).ok).toBe(false);  // 非地产
    expect(applyAction(s, 0, { type: 'redeem', tile: 9 }).ok).toBe(false);    // 未抵押
    const r = ok(s, 0, { type: 'mortgage', tile: 9 });
    expect(r.state.tiles[9].mortgaged).toBe(true);
    expect(r.state.seats[0].cash).toBe(RULES.startCash + gain);
    expect(r.state.phase).toBe('roll');
    expect(s.tiles[9].mortgaged).toBe(false); // 入参未被修改
    expect(applyAction(r.state, 0, { type: 'mortgage', tile: 9 }).ok).toBe(false);
    const r2 = ok(r.state, 0, { type: 'redeem', tile: 9 });
    expect(r2.state.tiles[9].mortgaged).toBe(false);
    expect(r2.state.seats[0].cash).toBe(RULES.startCash + gain - redeemCost(s, 9));
    const poor = structuredClone(r.state); poor.seats[0].cash = 1;
    expect(applyAction(poor, 0, { type: 'redeem', tile: 9 }).ok).toBe(false);
    expect(poor.seats[0].cash).toBe(1);
  });

  it('抵押中的地产：不收过路费、不可收购、不可升级、不可强拆', () => {
    const s = fresh();
    s.tiles[9] = { owner: 1, lv: 1, mortgaged: true };
    expect(tollOf(s, 9)).toBe(0);
    s.seats[0].pos = 0; s.seats[0].forcedSum = 9;
    const r = ok(s, 0, { type: 'roll', zone: 2 });
    expect(r.state.seats[0].pos).toBe(9);
    expect(r.events.some((e) => e.t === 'pay')).toBe(false);
    expect(r.state.pending?.kind).not.toBe('takeover');
    expect(r.state.seats[0].cash).toBe(RULES.startCash);
    // 自己的抵押地产没有升级选项
    const t = fresh(); t.tiles[9] = { owner: 0, lv: 1, mortgaged: true };
    expect(upgradeOptions(t, 0, 9)).toEqual([]);
    t.seats[1].items = [];
    t.seats[0].items = ['demolish'];
    t.tiles[10] = { owner: 1, lv: 2, mortgaged: true };
    expect(applyAction(t, 0, { type: 'useItem', item: 'demolish', target: 10 }).ok).toBe(false);
    // 赎回后恢复收费
    t.tiles[9].mortgaged = false;
    expect(tollOf(t, 9)).toBeGreaterThan(0);
  });

  it('现金不足清算：抵押地产不提供现金（清算价值 0），只随破产收归银行', () => {
    const s = createGame({ seed: 3, seats: SEATS.slice(0, 2) });
    s.seats.forEach((p) => (p.items = []));
    s.seats[0].cash = 1;
    s.tiles[1] = { owner: 0, lv: 0, mortgaged: false };
    s.tiles[3] = { owner: 0, lv: 3, mortgaged: true };
    s.tiles[30] = { owner: 1, lv: 4, mortgaged: false }; s.tiles[31] = { owner: 1, lv: 4, mortgaged: false };
    for (let seed = 1; seed < 400; seed++) {
      const t = structuredClone(s);
      t.rng = seed; t.seats[0].pos = 26;
      const r = applyAction(t, 0, { type: 'roll', zone: 0 });
      if (!r.ok || ![30, 31].includes(r.state.seats[0].pos)) continue;
      const sold = r.events.filter((e) => e.t === 'sell').map((e) => (e.t === 'sell' ? e.tile : -1));
      expect(sold).toEqual([1]);
      expect(r.state.seats[0].bankrupt).toBe(true);
      expect(r.state.tiles[3]).toEqual({ owner: null, lv: 0, mortgaged: false });
      return;
    }
    throw new Error('没找到合适的种子');
  });

  it('抵押中的地产不计入独占胜利与色组加成；总资产按净值计算', () => {
    const s = fresh();
    TOURS.forEach((i) => (s.tiles[i] = { owner: 0, lv: 0, mortgaged: false }));
    expect(monopolyOf(s, 0)).toBe('tour');
    s.tiles[TOURS[0]].mortgaged = true;
    expect(monopolyOf(s, 0)).toBeNull();
    GROUPS.g3.forEach((i) => (s.tiles[i] = { owner: 1, lv: 1, mortgaged: false }));
    expect(groupSetOwner(s, 9)).toBe(1);
    s.tiles[10].mortgaged = true;
    expect(groupSetOwner(s, 9)).toBeNull();
  });

  it('总资产：抵押后现金增加，资产只扣掉赎回价，不会重复计入', () => {
    const s = fresh();
    s.tiles[9] = { owner: 0, lv: 2, mortgaged: false };
    const before = totalAssets(s, 0);
    const r = ok(s, 0, { type: 'mortgage', tile: 9 });
    expect(totalAssets(r.state, 0)).toBe(before - (redeemCost(s, 9) - mortgageValue(s, 9)));
  });

  it('机器人：只在面临付不起的过路费时才抵押，现金充裕不抵押，并会在安全时赎回', () => {
    const s = fresh();
    s.tiles[9] = { owner: 0, lv: 2, mortgaged: false };      // 我方地产
    s.tiles[31] = { owner: 1, lv: 4, mortgaged: false };     // 对手地标（高额过路费）
    s.seats[0].pos = 28; s.seats[0].cash = 10;               // 31 在前方 3 格
    const a = botAction(s, 0);
    expect(a).toEqual({ type: 'mortgage', tile: 9 });
    const rich = structuredClone(s); rich.seats[0].cash = 5000;
    expect(botAction(rich, 0).type).not.toBe('mortgage');
    // 没有威胁时不抵押
    const calm = structuredClone(s); calm.seats[0].pos = 0; calm.seats[0].cash = 10;
    expect(botAction(calm, 0).type).not.toBe('mortgage');
    // 抵押过且现金充裕、前方无威胁 → 赎回
    const back = structuredClone(calm); back.tiles[9].mortgaged = true; back.seats[0].cash = 1000;
    expect(botAction(back, 0)).toEqual({ type: 'redeem', tile: 9 });
  });

});

describe('v0.3 阶段1：回放播放器', () => {
  const bots = SEATS.map((x) => ({ ...x, isBot: true }));
  const make = (seed: number) => {
    let s = createGame({ seed, seats: bots });
    const rec = new ReplayRecorder({ seed, seats: bots });
    while (s.phase !== 'ended') { const who = actorOf(s), a = botAction(s, who); s = ok(s, who, a).state; rec.push(who, a); }
    return { final: s, rec: JSON.parse(JSON.stringify(rec.toRecord(s))) as ReturnType<ReplayRecorder['toRecord']> };
  };

  it('逐 seq 的状态与直接重放前 n 步完全一致，帧下标 = state.seq', () => {
    const { rec } = make(11);
    const player = new ReplayPlayer(rec);
    expect(player.total).toBe(rec.actions.length);
    for (const n of [0, 1, 2, 17, Math.floor(player.total / 2), player.total - 1, player.total]) {
      const direct = replayGame({ ...rec, actions: rec.actions.slice(0, n) }).state;
      const f = player.seek(n);
      expect(f.index).toBe(n);
      expect(f.state.seq).toBe(n);
      expect(f.state).toEqual(direct);
    }
    // 全量逐帧：每帧状态 = 上一帧状态 + 该步操作
    let prev = player.frames[0].state;
    for (const f of player.frames.slice(1)) {
      const r = ok(prev, f.seat!, f.action!);
      expect(r.state).toEqual(f.state);
      expect(r.events).toEqual(f.events);
      prev = f.state;
    }
    expect(player.frames[player.total].state).toEqual(replayGame(rec).state);
  });

  it('单步前进 / 后退 / 跳转，越界被夹住', () => {
    const { rec } = make(12);
    const p = new ReplayPlayer(rec);
    expect(p.atStart).toBe(true);
    expect(p.prev()).toBeNull();
    expect(p.next()!.index).toBe(1);
    expect(p.next()!.index).toBe(2);
    expect(p.prev()!.index).toBe(1);
    expect(p.seek(-5).index).toBe(0);
    expect(p.seek(1e9).index).toBe(p.total);
    expect(p.atEnd).toBe(true);
    expect(p.next()).toBeNull();
    expect(p.seek(NaN).index).toBe(0);
  });

  it('第 0 帧带开局事件；回放文件损坏或被篡改时抛错', () => {
    const { rec } = make(13);
    const p = new ReplayPlayer(rec);
    expect(p.frames[0].events.length).toBeGreaterThan(0);
    expect(() => new ReplayPlayer({ ...rec, format: 'x' as never })).toThrow();
    expect(() => new ReplayPlayer({ ...rec, actions: undefined as never })).toThrow();
    const bad = { ...rec, actions: [{ seat: 3, action: { type: 'roll', zone: 0 } as const }, ...rec.actions] };
    expect(() => new ReplayPlayer(bad)).toThrow();
  });

  it('回放摘要记录胜负与名次：胜者第一，终局才有 ranking', () => {
    const { final, rec } = make(14);
    const rk = rec.result!.ranking!;
    expect(rk).toHaveLength(4);
    expect(rk[0].seat).toBe(final.winner);
    expect(rk[0].won).toBe(true);
    expect(rk.filter((r) => r.won)).toHaveLength(1);
    expect(rk.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(rk.every((r) => r.assets === totalAssets(final, r.seat))).toBe(true);
    const mid = new ReplayRecorder({ seed: 1, seats: bots }).toRecord(createGame({ seed: 1, seats: bots }));
    expect(mid.result!.ranking).toBeUndefined();
  });
});

describe('v0.3 阶段2：观战（引擎侧约束）', () => {
  it('观战者（不在座位上，seat = -1 或越界）的任何操作都被拒绝，且不改变状态、不影响 actorOf', () => {
    const s0 = createGame({ seed: 21, seats: SEATS.map((x) => ({ ...x, isBot: true })) });
    const snapshot = JSON.stringify(s0);
    const actor = actorOf(s0);
    const actions = [
      { type: 'roll', zone: 0 }, { type: 'choose', option: 0 }, { type: 'useSkill' },
      { type: 'useItem', item: 'shield' }, { type: 'mortgage', tile: 1 }, { type: 'redeem', tile: 1 },
    ] as const;
    for (const seat of [-1, 4, 99]) for (const a of actions) {
      const r = applyAction(s0, seat, a);
      expect(r.ok).toBe(false);
    }
    expect(JSON.stringify(s0)).toBe(snapshot);
    expect(actorOf(s0)).toBe(actor);
  });

  it('含「观战者乱发操作」的机器人对局：不死锁、不抛错，分出胜负，结果与无观战者的对局完全一致', () => {
    for (const seed of [5, 8, 13]) {
      const clean = playOut(seed).s;
      let s = createGame({ seed, seats: SEATS.map((x) => ({ ...x, isBot: true })) });
      let steps = 0, rejected = 0;
      while (s.phase !== 'ended' && steps++ < 5000) {
        // 观战者每一步都试图操作（座位号 -1 / 4）
        for (const seat of [-1, 4]) if (!applyAction(s, seat, { type: 'roll', zone: 1 }).ok) rejected++;
        s = ok(s, actorOf(s), botAction(s, actorOf(s))).state;
      }
      expect(s.phase).toBe('ended');
      expect(s.winner).not.toBeNull();
      expect(rejected).toBeGreaterThan(0);
      expect(s).toEqual(clean);
    }
  });

  it('观战席上限在 config.ts 里（提案值）', () => {
    expect(SPECTATE.maxSpectators).toBeGreaterThan(0);
  });
});

describe('v0.3 阶段3：快速匹配队列', () => {
  const T = MATCH.timeoutMs;

  it('凑满 4 人立即开局，无机器人', () => {
    const q = new MatchQueue();
    q.join('a', 0); q.join('b', 10); q.join('c', 20);
    expect(q.poll(30).kind).toBe('waiting');
    q.join('d', 40);
    const d = q.poll(50);
    expect(d).toEqual({ kind: 'start', members: ['a', 'b', 'c', 'd'], bots: 0, reason: 'full' });
    expect(q.size).toBe(0);
    expect(q.poll(60).kind).toBe('idle');
  });

  it('超时后机器人补位：按队首入队时间起算，补足到 4 人', () => {
    const q = new MatchQueue();
    q.join('a', 1000); q.join('b', 5000);
    const w = q.poll(1000 + T - 1);
    expect(w).toMatchObject({ kind: 'waiting', waiting: 2, size: 4, deadline: 1000 + T });
    const d = q.poll(1000 + T);
    expect(d).toEqual({ kind: 'start', members: ['a', 'b'], bots: 2, reason: 'timeout' });
    expect(q.size).toBe(0);
    // 单人也能超时补位 3 个机器人
    const solo = new MatchQueue();
    solo.join('x', 0);
    expect(solo.poll(T)).toEqual({ kind: 'start', members: ['x'], bots: 3, reason: 'timeout' });
  });

  it('匹配中可取消：取消后不再被拉入开局，队首变化后超时重新起算，清空后回到 idle', () => {
    const q = new MatchQueue();
    q.join('a', 0); q.join('b', 8000);
    expect(q.cancel('a')).toBe(true);
    expect(q.cancel('a')).toBe(false);
    // a 走了，b 成为队首，超时从 b 的入队时间起算
    expect(q.poll(T)).toMatchObject({ kind: 'waiting', waiting: 1, deadline: 8000 + T });
    expect(q.cancel('b')).toBe(true);
    expect(q.poll(T * 10).kind).toBe('idle');
    // 重复入队只算一次
    q.join('c', 0); q.join('c', 5);
    expect(q.size).toBe(1);
  });

  it('peek 不改队列，poll 才出队；真人数不足 minHumans 时不超时开局；超过 4 人只取前 4 个', () => {
    const q = new MatchQueue();
    q.join('a', 0);
    expect(q.peek(T).kind).toBe('start');
    expect(q.size).toBe(1);
    const strict = new MatchQueue({ minHumans: 2 });
    strict.join('a', 0);
    expect(strict.poll(T * 2).kind).toBe('waiting');
    strict.join('b', 1);
    expect(strict.poll(T * 2)).toMatchObject({ kind: 'start', bots: 2, reason: 'timeout' });
    const big = new MatchQueue();
    ['a', 'b', 'c', 'd', 'e'].forEach((id, i) => big.join(id, i));
    expect(big.poll(10)).toMatchObject({ kind: 'start', members: ['a', 'b', 'c', 'd'], bots: 0 });
    expect(big.size).toBe(1);
  });

  it('匹配成局后用补位的机器人开局，整局可正常打完', () => {
    const q = new MatchQueue();
    q.join('p1', 0);
    const d = q.poll(T);
    if (d.kind !== 'start') throw new Error('应当开局');
    const seats = SEATS.map((x, i) => ({ ...x, isBot: i >= d.members.length }));
    let s = createGame({ seed: 77, seats });
    let n = 0;
    while (s.phase !== 'ended' && n++ < 5000) s = ok(s, actorOf(s), botAction(s, actorOf(s))).state;
    expect(s.phase).toBe('ended');
    expect(seats.filter((x) => x.isBot)).toHaveLength(d.bots);
  });
});

import { type HistoryEntry, PROFILE, addHistory, computeStats, entryFromRecord, newProfile, parseHistory, parseProfile, removeHistory, serializeHistory, serializeProfile } from '../src';

describe('v0.4：本地档案与对局历史', () => {
  const mk = (i: number, won = false): HistoryEntry => ({ id: 'g' + i, at: 1000 + i, kind: 'solo', rank: won ? 1 : 2, won, winner: 'x', winReason: null, rounds: 5, seats: [], ranking: [], seed: i, steps: 3 });
  it('档案往返；脏数据 / 旧版本 / 空值重建不抛错', () => {
    const p = newProfile(123456);
    expect(parseProfile(serializeProfile(p), 1)).toEqual({ profile: p, rebuilt: false });
    for (const bad of [null, '', '{oops', '[]', '"x"', '{"v":0,"id":"a"}', '{"v":1}', '{"v":1,"id":""}']) {
      const r = parseProfile(bad, 99);
      expect(r.rebuilt).toBe(true);
      expect(r.profile.id).toBeTruthy();
    }
    const part = parseProfile('{"v":1,"id":"a1","name":"  ","charId":"zzz","createdAt":"x"}', 77).profile;
    expect(part.id).toBe('a1'); expect(part.charId).toBe('jin'); expect(part.createdAt).toBe(77); expect(part.name.length).toBeGreaterThan(0);
  });
  it('历史写入 / 读取 / 删除 / 上限截断', () => {
    let items: HistoryEntry[] = [];
    let dropped = 0;
    for (let i = 0; i < PROFILE.historyLimit + 5; i++) { const r = addHistory(items, mk(i)); items = r.items; dropped += r.dropped.length; }
    expect(items).toHaveLength(PROFILE.historyLimit);
    expect(dropped).toBe(5);
    expect(items[0].id).toBe('g' + (PROFILE.historyLimit + 4));
    const back = parseHistory(serializeHistory(items));
    expect(back).toHaveLength(PROFILE.historyLimit);
    expect(removeHistory(back, back[0].id)).toHaveLength(PROFILE.historyLimit - 1);
  });
  it('历史脏数据安全丢弃', () => {
    expect(parseHistory('nope')).toEqual([]);
    expect(parseHistory('{"v":2,"items":[]}')).toEqual([]);
    expect(parseHistory('{"v":1,"items":[1,null,{"id":"ok","seats":"bad","ranking":[5]}]}').map((x) => x.id)).toEqual(['ok']);
  });
  it('统计', () => {
    expect(computeStats([])).toEqual({ games: 0, wins: 0, winRate: 0 });
    expect(computeStats([mk(1, true), mk(2), mk(3), mk(4, true)])).toEqual({ games: 4, wins: 2, winRate: 0.5 });
  });
  it('由回放生成条目：名次按 accountId，未结束返回 null', () => {
    const seats: SeatConfig[] = SEATS.map((s, i) => (i === 0 ? { ...s, accountId: 'p-me' } : { ...s, isBot: true }));
    const rec = new ReplayRecorder({ seed: 5, seats, maxRounds: 3 });
    let s = createGame({ seed: 5, seats, maxRounds: 3 });
    expect(entryFromRecord(rec.toRecord(s), 'p-me', 'solo', 1)).toBeNull();
    let n = 0;
    while (s.phase !== 'ended' && n++ < 5000) { const a = actorOf(s); const act = botAction(s, a); const r = applyAction(s, a, act); if (!r.ok) throw new Error(r.error); rec.push(a, act); s = r.state; }
    const rc = rec.toRecord(s);
    const e = entryFromRecord(rc, 'p-me', 'solo', 2)!;
    expect(e.rank).toBe(rc.result!.ranking!.find((x) => x.accountId === 'p-me')!.rank);
    expect(e.steps).toBe(rc.actions.length);
    expect(e.seats).toHaveLength(4);
    expect(e.won).toBe(rc.result!.winner === 0);
    expect(entryFromRecord(rc, 'nobody', 'online', 3)!.rank).toBe(0);
  });
});

describe('v0.5 机器人难度分级', () => {
  const DIFFS: BotDifficulty[] = ['easy', 'normal', 'hard'];
  const withDiff = (d: BotDifficulty, seat: number): SeatConfig[] => SEATS.map((x, i) => ({ ...x, isBot: true, ...(i === seat ? { difficulty: d } : {}) }));

  it('同一局面下三档决策不同（买地 / 道具 / 抵押）', () => {
    const base = () => createGame({ seed: 7, seats: SEATS.map((x) => ({ ...x, isBot: true })) });
    // 买地：有 100 现金买 80 价地，简单档储备低；困难档储备高
    const decide = (d: BotDifficulty, f: (s: GameState) => void) => { const s = base(); s.seats[0].difficulty = d; f(s); return JSON.stringify(botAction(s, 0)); };
    // 抵押：前方有大额过路费，现金处于 threat*0.5..1.4 之间时 简单不抵押、困难抵押
    const mort = (s: GameState) => {
      const i = 5; s.tiles[i].owner = 1; s.tiles[i].lv = 3; s.seats[0].pos = i - 3;
      const mine = BOARD.findIndex((d, k) => d.kind === 'city' && k !== i && k > 20); s.tiles[mine].owner = 0;
      const th = tollOf(s, i); s.seats[0].cash = Math.floor(th * 1.2);
    };
    const m = DIFFS.map((d) => decide(d, mort));
    expect(m[0]).not.toBe(m[2]);
    expect(m[2]).toContain('mortgage');
    // 道具：持有 shield 且现金低，简单档大概率不用（概率门），普通/困难使用
    const item = (s: GameState) => { s.seats[0].items = ['shield'] as never; s.seats[0].cash = 100; };
    const used = (d: BotDifficulty) => { let n = 0; for (let k = 0; k < 40; k++) { const s = base(); s.seq = k; s.seats[0].difficulty = d; item(s); if (botAction(s, 0).type === 'useItem') n++; } return n; };
    expect(used('normal')).toBe(40);
    expect(used('hard')).toBe(40);
    expect(used('easy')).toBeLessThan(25);
    // 买地：简单档有概率手滑放弃
    const buys = (d: BotDifficulty) => { let n = 0; for (let k = 0; k < 40; k++) { const s = base(); s.seats[0].difficulty = d; s.seq = k; s.pending = { kind: 'buy', tile: 1, options: [{ cost: 60, value: 1 }] } as never; s.phase = 'pending' as never; const a = botAction(s, 0); if (a.type === 'choose' && a.option === 0) n++; } return n; };
    expect(buys('normal')).toBe(40);
    expect(buys('easy')).toBeLessThan(40);
  });

  it('机器人纯函数：同局面重复调用结果一致且不改状态', () => {
    const s = createGame({ seed: 3, seats: withDiff('easy', 0) });
    const before = JSON.stringify(s);
    const a = JSON.stringify(botAction(s, actorOf(s)));
    expect(JSON.stringify(botAction(s, actorOf(s)))).toBe(a);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('同 seed 下各档各打 N 局：困难 > 普通 > 简单（平均名次）', () => {
    const N = 40;
    const avg: Record<string, number> = {};
    for (const d of DIFFS) {
      let sum = 0;
      for (let seed = 1; seed <= N; seed++) {
        // 被测档位轮流坐 4 个座位，其余 3 个为普通
        const seat = seed % 4;
        const seats = SEATS.map((x, i) => ({ ...x, isBot: true, difficulty: (i === seat ? d : 'normal') as BotDifficulty }));
        let s = createGame({ seed, seats });
        for (let n = 0; s.phase !== 'ended' && n < 8000; n++) s = ok(s, actorOf(s), botAction(s, actorOf(s))).state;
        const order = s.seats.map((p, i) => ({ i, a: p.bankrupt ? -1 : totalAssets(s, i) })).sort((x, y) => y.a - x.a);
        sum += order.findIndex((o) => o.i === seat) + 1;
      }
      avg[d] = sum / N;
    }
    console.log('平均名次(越小越好)', avg);
    expect(avg.hard).toBeLessThan(avg.easy);
    expect(avg.easy - avg.hard).toBeGreaterThanOrEqual(0.4);
    expect(avg.hard).toBeLessThanOrEqual(avg.normal);
  });

  it('含难度机器人的对局可回放且一致', () => {
    const seats = SEATS.map((x, i) => ({ ...x, isBot: true, difficulty: DIFFS[i % 3] }));
    const cfg = { seed: 11, seats };
    const rec = new ReplayRecorder(cfg);
    let s = createGame(cfg);
    for (let n = 0; s.phase !== 'ended' && n < 8000; n++) { const w = actorOf(s), a = botAction(s, w); rec.push(w, a); s = ok(s, w, a).state; }
    const record = JSON.parse(JSON.stringify(rec.toRecord(s)));
    expect(record.seats.map((x: SeatConfig) => x.difficulty)).toEqual(['easy', 'normal', 'hard', 'easy']);
    expect(replayGame(record).state).toEqual(s);
  });
});

import { QUESTS, achievementView, applyDigest, dailyView, digestRecord, freshQuests, parseQuests, pickDaily, rollDay, serializeQuests, type GameDigest } from '../src';

describe('v0.6 每日任务与成就', () => {
  const T0 = new Date(2026, 10, 17, 10, 0).getTime();
  const T1 = new Date(2026, 10, 18, 9, 0).getTime();
  const dg = (id: string, o: Partial<GameDigest> = {}): GameDigest => ({ id, won: false, online: false, buys: 0, events: 0, sets: 0, peakAssets: 300, ...o });
  /** 固定当天任务为已知集合，便于断言 */
  const withDaily = (ids: string[]) => ({ ...freshQuests(T0), dailyIds: ids });

  it('每日抽取：确定性、数量、不重复', () => {
    const a = pickDaily('2026-11-17');
    expect(a).toEqual(pickDaily('2026-11-17'));
    expect(a).toHaveLength(QUESTS.dailyCount);
    expect(new Set(a).size).toBe(a.length);
    const days = new Set(Array.from({ length: 20 }, (_, i) => pickDaily('2026-12-' + i).join()));
    expect(days.size).toBeGreaterThan(1);
  });
  it('任务进度由对局累积并只计一次', () => {
    let s = withDaily(['win1', 'buy5', 'play3']);
    let r = applyDigest(s, dg('g1', { won: true, buys: 3 }), T0);
    expect(dailyView(r.state).map((q) => [q.id, q.progress, q.done])).toEqual([['win1', 1, true], ['buy5', 3, false], ['play3', 1, false]]);
    expect(r.newDaily.map((q) => q.id)).toEqual(['win1']);
    const dup = applyDigest(r.state, dg('g1', { won: true, buys: 3 }), T0);
    expect(dup.state).toEqual(r.state); expect(dup.newDaily).toEqual([]);
    r = applyDigest(r.state, dg('g2', { buys: 2 }), T0);
    expect(dailyView(r.state).find((q) => q.id === 'buy5')!.done).toBe(true);
    expect(r.newDaily.map((q) => q.id)).toEqual(['buy5']);
    s = r.state; expect(s.life.games).toBe(2);
  });
  it('跨本地日期重置当天任务，终身与成就保留', () => {
    const r = applyDigest(withDaily(['win1']), dg('g1', { won: true }), T0);
    const next = rollDay(r.state, T1);
    expect(next.day).toBe('2026-11-18');
    expect(next.dailyDone).toEqual([]); expect(next.daily).toEqual({});
    expect(next.life.wins).toBe(1); expect(next.unlocked.firstWin).toBeTruthy();
    expect(rollDay(next, T1)).toBe(next);
    const loaded = parseQuests(serializeQuests(r.state), T1);
    expect(loaded.dailyDone).toEqual([]); expect(loaded.life.wins).toBe(1);
  });
  it('成就达成条件与点亮状态（只点亮一次）', () => {
    let s = freshQuests(T0);
    let r = applyDigest(s, dg('a', { won: true, sets: 1, peakAssets: 1200 }), T0);
    expect(r.newAchievements.map((a) => a.id).sort()).toEqual(['assets1000', 'firstWin', 'set1']);
    expect(achievementView(r.state).filter((a) => a.unlocked)).toHaveLength(3);
    r = applyDigest(r.state, dg('b', { won: true, sets: 1, peakAssets: 1500 }), T0);
    expect(r.newAchievements).toEqual([]);
    s = r.state;
    for (let i = 0; i < 8; i++) s = applyDigest(s, dg('w' + i, { won: true }), T0).state;
    expect(s.unlocked.win10).toBeTruthy();
    expect(achievementView(s).find((a) => a.id === 'win10')!.unlocked).toBe(true);
  });
  it('脏数据安全重建', () => {
    for (const bad of [null, '', '{x', '[]', '{"v":2}', '{"v":1,"day":1}']) expect(parseQuests(bad, T0).dailyIds).toHaveLength(QUESTS.dailyCount);
  });
  it('由对局记录推导摘要（纯函数、确定性），未结束返回 null', () => {
    const seats = SEATS.map((x, i) => ({ ...x, isBot: true, accountId: 'acc' + i }));
    const cfg = { seed: 77, seats };
    let s = createGame(cfg);
    const rec = new ReplayRecorder(cfg);
    expect(digestRecord(rec.toRecord(s), 'acc0', 'x', false)).toBeNull();
    while (s.phase !== 'ended') { const a = actorOf(s); const act = botAction(s, a); rec.push(a, act); s = ok(s, a, act).state; }
    const r = rec.toRecord(s);
    const d = digestRecord(r, 'acc0', 'x', true)!;
    expect(d).toEqual(digestRecord(r, 'acc0', 'x', true));
    expect(d.online).toBe(true); expect(d.buys).toBeGreaterThan(0); expect(d.peakAssets).toBeGreaterThanOrEqual(totalAssets(s, 0));
    expect(d.won).toBe(s.winner === 0);
    expect(digestRecord(r, 'nobody', 'x', false)).toBeNull();
  });
});

describe('v0.7 特殊格与主题', () => {
  const mk = (specials: boolean) => createGame({ seed: 5, seats: SEATS, specials });
  /** 让 0 号玩家从 from 格掷出指定点数 */
  const roll = (s: GameState, from: number, sum: number) => {
    const t = structuredClone(s); t.seats[0].pos = from; t.seats[0].forcedSum = sum; t.turn = 0; t.phase = 'roll'; t.pending = null;
    return t;
  };
  it('奖金格：停留领取奖金；未启用特殊格时仍是机会格', () => {
    const t = roll(mk(true), 26, 2);
    const cash = t.seats[0].cash;
    const r = ok(t, 0, { type: 'roll', zone: 1 });
    expect(r.state.seats[0].pos).toBe(28);
    expect(r.state.seats[0].cash).toBe(cash + SPECIAL_TILES[28].amount!);
    expect(r.events.some((e) => e.t === 'special' && e.kind === 'bonus')).toBe(true);
    const r0 = ok(roll(mk(false), 26, 2), 0, { type: 'roll', zone: 1 });
    expect(r0.events.some((e) => e.t === 'special')).toBe(false);
  });
  it('传送格：停留传送到指定格并结算落地', () => {
    const t = roll(mk(true), 9, 2);
    const r = ok(t, 0, { type: 'roll', zone: 1 });
    expect(r.state.seats[0].pos).toBe(SPECIAL_TILES[11].to);
    expect(r.events.some((e) => e.t === 'special' && e.kind === 'teleport')).toBe(true);
    expect(r.events.some((e) => e.t === 'move' && e.via === 'warp')).toBe(true);
  });
  it('主题只是表现数据：默认经典，含霓虹夜市，不含规则字段', () => {
    expect(THEME_IDS).toContain('classic'); expect(THEME_IDS).toContain('neon');
    expect(THEMES.neon.name).toBe('霓虹夜市');
  });
  it('启用特殊格的整局可回放且一致；旧回放（无 specials）仍按原规则重放', () => {
    for (const specials of [true, false]) {
      const cfg = { seed: 31, seats: SEATS.map((x) => ({ ...x, isBot: true })), specials };
      let s = createGame(cfg);
      const rec = new ReplayRecorder(cfg);
      while (s.phase !== 'ended') { const a = actorOf(s); const act = botAction(s, a); rec.push(a, act); s = ok(s, a, act).state; }
      const json = JSON.parse(JSON.stringify(rec.toRecord(s)));
      expect(!!json.specials).toBe(specials);
      expect(replayGame(json).state).toEqual(s);
      expect(new ReplayPlayer(json).frames.at(-1)!.state).toEqual(s);
    }
  });
});

describe('v0.8 道具与角色后续批次', () => {
  const mk = (seed = 7, chars: ('jin' | 'rock' | 'li')[] = ['jin', 'li']) =>
    createGame({ seed, itemsV8: true, seats: chars.map((c, i) => ({ id: 'p' + i, name: 'P' + i, charId: c })) });

  it('换位卡：交换位置、使用者结算落地、不领月薪；对方不结算；非法目标不消耗', () => {
    const s = mk();
    s.seats[0].pos = 3; s.seats[1].pos = 5; s.seats[0].items = ['swap'];
    const cash0 = s.seats[0].cash;
    expect(applyAction(s, 0, { type: 'useItem', item: 'swap', target: 0 }).ok).toBe(false);
    expect(s.seats[0].items).toEqual(['swap']);
    const r = ok(s, 0, { type: 'useItem', item: 'swap', target: 1 });
    expect(r.state.seats[0].pos).toBe(5);
    expect(r.state.seats[1].pos).toBe(3);
    expect(r.state.seats[0].items).toEqual([]);
    expect(r.events.some((e) => e.t === 'swap')).toBe(true);
    expect(r.events.some((e) => e.t === 'salary')).toBe(false);
    expect(r.state.seats[0].cash).toBeLessThanOrEqual(cash0 + 0);
  });

  it('换位卡不带目标走 pending 选择，可取消不消耗', () => {
    const s = mk();
    s.seats[0].pos = 3; s.seats[1].pos = 5; s.seats[0].items = ['swap'];
    let r = ok(s, 0, { type: 'useItem', item: 'swap' });
    expect(r.state.phase).toBe('choose');
    r = ok(r.state, 0, { type: 'choose', option: -1 });
    expect(r.state.seats[0].items).toEqual(['swap']);
    expect(r.state.seats[0].pos).toBe(3);
  });

  it('免税卡：下次税务局免缴且只免一次', () => {
    const taxIdx = BOARD.findIndex((d) => d.kind === 'tax');
    const run = (withCard: boolean) => {
      const s = mk(); s.seats[0].items = withCard ? ['taxFree'] : [];
      if (withCard) { const r = ok(s, 0, { type: 'useItem', item: 'taxFree' }); expect(r.state.seats[0].taxFree).toBe(true); expect(applyAction(r.state, 0, { type: 'useItem', item: 'taxFree' }).ok).toBe(false); }
      return s;
    };
    const s = run(true);
    s.seats[0].taxFree = true; s.seats[0].pos = taxIdx - 3; s.seats[0].forcedSum = 3;
    const r = ok(s, 0, { type: 'roll', zone: 0 });
    expect(r.events.some((e) => e.t === 'taxFreeUsed')).toBe(true);
    expect(r.events.some((e) => e.t === 'pay' && e.reason === 'tax')).toBe(false);
    expect(r.state.seats[0].taxFree).toBe(false);
  });

  it('冻结卡：对手下回合整体跳过，只一次；不能重复冻结', () => {
    const s = mk(7, ['jin', 'li', 'jin']); s.seats[0].items = ['freeze', 'freeze'];
    let r = ok(s, 0, { type: 'useItem', item: 'freeze', target: 1 });
    expect(r.state.seats[1].frozen).toBe(true);
    expect(applyAction(r.state, 0, { type: 'useItem', item: 'freeze', target: 1 }).ok).toBe(false);
    r.state.seats[0].pos = 1;
    r = ok(r.state, 0, { type: 'roll', zone: 0 });
    // 走完本回合后：跳过座位 1，轮到座位 2
    let st = r.state, guard = 0;
    const evs: string[] = r.events.map((e) => e.t);
    while (st.turn === 0 && st.phase !== 'ended' && guard++ < 20) { const x = ok(st, actorOf(st), botAction(st, actorOf(st))); st = x.state; evs.push(...x.events.map((e) => e.t)); }
    expect(evs).toContain('frozenSkip');
    expect(st.seats[1].frozen).toBe(false);
    expect(st.turn).not.toBe(1);
  });

  it('岩盾阿岩：被动过路费 -10%；主动获得护盾并向最富对手收保护费', () => {
    const s = mk(3, ['rock', 'li']);
    const r = ok(s, 0, { type: 'useSkill' });
    expect(r.state.seats[0].shield).toBe(true);
    expect(r.state.seats[0].cash).toBe(RULES.startCash + RULES.rockSkillFee);
    expect(r.state.seats[1].cash).toBe(RULES.startCash - RULES.rockSkillFee);
    expect(CHARACTERS_ROCK.tollCut).toBe(0.1);
  });

  it('含新道具/新角色的机器人整局可回放且一致；新池含三种新道具', () => {
    const cfg = { seed: 99, itemsV8: true, seats: (['rock', 'jin', 'li', 'xing'] as const).map((c, i) => ({ id: 'b' + i, name: 'B' + i, charId: c, isBot: true })) };
    let s = createGame(cfg);
    const rec = new ReplayRecorder(cfg);
    const seen = new Set<string>();
    let n = 0;
    while (s.phase !== 'ended' && n++ < 5000) { const a = actorOf(s), act = botAction(s, a); const r = ok(s, a, act); rec.push(a, act); r.events.forEach((e) => { if (e.t === 'itemGained') seen.add(e.item); }); s = r.state; }
    const re = replayGame(JSON.parse(JSON.stringify(rec.toRecord(s))));
    expect(re.state).toEqual(s);
    expect(['swap', 'taxFree', 'freeze'].some((i) => seen.has(i))).toBe(true);
  });

  it('旧回放（无 itemsV8）仍沿用 7 种旧池：不会抽到新道具', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = createGame({ seed, seats: SEATS.map((x) => ({ ...x })) });
      expect(s.itemsV8).toBeUndefined();
      for (const p of s.seats) for (const it of p.items) expect(['swap', 'taxFree', 'freeze']).not.toContain(it);
    }
  });
});
const CHARACTERS_ROCK = CHARACTERS.rock;

// ───────────────────────── v1.0 风控 / 埋点 ─────────────────────────
import { ActionGuard, RISK, buildMatchSummary, checkReplayConsistency, classifyReject } from '../src';

describe('v1.0 风控', () => {
  it('ActionGuard：重复、超快、超速被拒，正常放行', () => {
    const g = new ActionGuard();
    const roll = { type: 'roll', zone: 1 } as const;
    expect(g.check('s', roll, 1000)).toBeNull();
    expect(g.check('s', roll, 1000 + RISK.duplicateMs - 1)).toBe('duplicate');
    expect(g.check('s', { type: 'choose', option: 0 }, 1000 + RISK.minIntervalMs - 1)).toBe('too_fast');
    expect(g.check('s', { type: 'choose', option: 0 }, 1000 + RISK.minIntervalMs + 1)).toBeNull();
    expect(g.check('other', roll, 1001)).toBeNull(); // 会话互不影响
    const h = new ActionGuard();
    let t = 0, limited = 0;
    for (let i = 0; i < 30; i++) { t += RISK.minIntervalMs + 5; if (h.check('x', { type: 'choose', option: i }, t) === 'rate_limited') limited++; }
    expect(limited).toBeGreaterThan(0);
  });
  it('classifyReject：非行动座位 / 非法 / 已结束', () => {
    const s = createGame({ seed: 5, seats: SEATS });
    expect(classifyReject(s, (actorOf(s) + 1) % 4)).toBe('out_of_turn');
    expect(classifyReject(s, actorOf(s))).toBe('illegal');
    expect(classifyReject({ ...s, phase: 'ended' }, 0)).toBe('ended');
  });
  it('回放一致性抽查：一致通过，被篡改则报不一致', () => {
    const cfg = { seed: 77, seats: SEATS.map((x) => ({ ...x, isBot: true })) };
    let s = createGame(cfg);
    const rec = new ReplayRecorder(cfg);
    while (s.phase !== 'ended') { const w = actorOf(s); const a = botAction(s, w); s = ok(s, w, a).state; rec.push(w, a); }
    const r = rec.toRecord(s);
    expect(checkReplayConsistency(r, s).ok).toBe(true);
    expect(checkReplayConsistency({ ...r, seed: r.seed + 1 }, s).ok).toBe(false);
    expect(checkReplayConsistency({ ...r, actions: r.actions.slice(0, -3) }, s).ok).toBe(false);
  });
  it('终局埋点摘要不含 accountId', () => {
    const seats = SEATS.map((x) => ({ ...x, isBot: true, accountId: 'secret-account' }));
    const cfg = { seed: 3, seats };
    let s = createGame(cfg);
    const rec = new ReplayRecorder(cfg);
    while (s.phase !== 'ended') { const w = actorOf(s); const a = botAction(s, w); s = ok(s, w, a).state; rec.push(w, a); }
    const sum = buildMatchSummary(rec.toRecord(s), s);
    expect(JSON.stringify(sum)).not.toContain('secret-account');
    expect(sum.ranking).toHaveLength(4);
    expect(sum.steps).toBe(rec.toRecord().actions.length);
  });
});

import { BOARDS, BOARD_CFGS, BOARD_IDS, boardOf, type BoardId } from '../src';
describe('v1.1 第二张棋盘', () => {
  const mk = (board?: BoardId) => createGame({ seed: 5, seats: SEATS, specials: true, ...(board ? { board } : {}) });
  const roll = (s: GameState, from: number, sum: number) => {
    const t = structuredClone(s); t.seats[0].pos = from; t.seats[0].forcedSum = sum; t.turn = 0; t.phase = 'roll'; t.pending = null;
    return t;
  };
  it('棋盘配置：32 格、角格位置固定、至少 1 传送 + 1 奖金；缺省 = 经典', () => {
    expect(BOARD_IDS).toEqual(expect.arrayContaining(['classic', 'island']));
    for (const id of BOARD_IDS) {
      const b = BOARDS[id];
      expect(b.tiles.length).toBe(32);
      expect([0, 8, 16, 24].map((i) => b.tiles[i].corner)).toEqual(['start', 'island', 'festival', 'airport']);
      const sp = Object.values(b.specials);
      expect(sp.some((x) => x.kind === 'teleport')).toBe(true);
      expect(sp.some((x) => x.kind === 'bonus')).toBe(true);
      for (const [i, x] of Object.entries(b.specials)) { expect(b.tiles[+i].kind).toBe('card'); if (x.to != null) expect(['city', 'tour']).toContain(b.tiles[x.to].kind); }
    }
    expect(boardOf(mk()).id).toBe('classic');
    expect(mk().board).toBeUndefined();
    expect(mk('island').board).toBe('island');
  });
  it('海岛棋盘：奖金格与传送格复用特殊格结算', () => {
    const t = roll(mk('island'), 24, 2);
    const cash = t.seats[0].cash;
    const r = ok(t, 0, { type: 'roll', zone: 1 });
    expect(r.state.seats[0].pos).toBe(26);
    expect(r.state.seats[0].cash).toBe(cash + BOARD_CFGS.island.specials[26].amount!);
    const r4 = ok(roll(mk('island'), 7, 3), 0, { type: 'roll', zone: 1 });
    expect(r4.state.seats[0].pos).toBe(BOARD_CFGS.island.specials[10].to);
  });
  it('地价取自所选棋盘', () => {
    expect(investedValue(mk('island'), 1)).toBe(BOARD_CFGS.island.groupPrice.g1);
    expect(investedValue(mk(), 1)).toBe(BOARD_CFGS.classic.groupPrice.g1);
  });
  it('机器人三档在两张棋盘各打若干局均可结束，且回放一致（经典无 board 字段）', () => {
    const DIFFS: BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const board of ['classic', 'island'] as BoardId[]) for (const d of DIFFS) for (let seed = 1; seed <= 4; seed++) {
      const cfg = { seed: seed * 17, seats: SEATS.map((x) => ({ ...x, isBot: true, difficulty: d })), specials: true, itemsV8: true, board };
      let s = createGame(cfg); const rec = new ReplayRecorder(cfg); let n = 0;
      while (s.phase !== 'ended' && n++ < 8000) { const a = actorOf(s); const act = botAction(s, a); rec.push(a, act); s = ok(s, a, act).state; }
      expect(s.phase).toBe('ended');
      const json = JSON.parse(JSON.stringify(rec.toRecord(s)));
      expect(json.board).toBe(board === 'island' ? 'island' : undefined);
      expect(replayGame(json).state).toEqual(s);
    }
  });
});

describe('v1.7 付费角色：锦鲤阿棠（tang）', () => {
  const TSEATS: SeatConfig[] = [
    { id: 'a', name: '棠', charId: 'tang' },
    { id: 'b', name: 'b', charId: 'li' },
    { id: 'c', name: 'c', charId: 'wang' },
    { id: 'd', name: 'd', charId: 'xing' },
  ];
  const pass = (s: GameState) => {
    const c = structuredClone(s);
    c.seats[0].pos = 30; c.seats[0].forcedSum = 4; c.turn = 0; c.phase = 'roll'; c.pending = null;
    return ok(c, 0, { type: 'roll', zone: 0 });
  };
  const salaryOf = (r: ReturnType<typeof pass>) => { const e = r.events.find((x) => x.t === 'salary'); return e && e.t === 'salary' ? e.amount : -1; };
  it('被动：月薪 30 万 → 45 万；免费角色不变', () => {
    expect(CHARACTERS.tang.salaryBonus).toBe(0.5);
    expect(salaryOf(pass(createGame({ seed: 5, seats: TSEATS })))).toBe(45);
    expect(salaryOf(pass(createGame({ seed: 5, seats: TSEATS.map((x, i) => (i ? x : { ...x, charId: 'jin' as const })) })))).toBe(RULES.salary);
  });
  it('锦鲤附体：下次过起点月薪 90 万且只生效一次；冷却 5 回合', () => {
    const s0 = createGame({ seed: 6, seats: TSEATS });
    const r = ok(s0, 0, { type: 'useSkill' });
    expect(r.state.seats[0].doubleSalary).toBe(true);
    expect(r.state.seats[0].skillCd).toBe(RULES.skillCooldown);
    expect(RULES.skillCooldown).toBe(5);
    const r2 = pass(r.state);
    expect(salaryOf(r2)).toBe(90);
    expect(r2.state.seats[0].doubleSalary).toBe(false);
    const r3 = pass(r2.state);
    expect(salaryOf(r3)).toBe(45);
    expect(applyAction(r.state, 0, { type: 'useSkill' }).ok).toBe(false);
  });
  it('机器人选用 tang 的整局回放一致', () => {
    const cfg = { seed: 21, seats: TSEATS.map((x) => ({ ...x, isBot: true })) };
    let s = createGame(cfg);
    const rec = new ReplayRecorder(cfg);
    while (s.phase !== 'ended') { const who = actorOf(s), a = botAction(s, who); const r = ok(s, who, a); rec.push(who, a); s = r.state; }
    expect(replayGame(JSON.parse(JSON.stringify(rec.toRecord(s)))).state).toEqual(s);
  });
  it('FREE/PAID 角色划分', () => {
    expect(PAID_CHAR_IDS).toEqual(['tang']);
    expect(FREE_CHAR_IDS).toHaveLength(6);
    expect(FREE_CHAR_IDS).not.toContain('tang');
  });
});
