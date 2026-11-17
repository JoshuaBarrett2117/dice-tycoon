/**
 * 规则引擎（服务端权威）。
 *
 * - 纯数据进出：applyAction(state, seat, action) 返回新 state + 事件流，不修改入参。
 * - 所有随机都来自 state.rng，因此「seed + 操作序列」可完整回放，便于反作弊与复盘。
 * - 客户端单机模式与对战服使用同一份代码。
 */
import { BOARD, BOARD_SIZE, GROUPS, ISLAND_INDEX, SIDES, TOURS, isOwnable } from './board';
import { CHARACTERS } from './characters';
import { GLOBAL_EVENTS, GLOBAL_EVENT_IDS, ITEM_IDS, RULES, ZONES, type GlobalEventDef } from './config';
import { nextFloat, nextInt, pick } from './rng';
import type {
  Action, AuctionState, ApplyResult, CardId, GameConfig, GameEvent, GameState, ItemId, Pending, PendingOption, PlayerState, TileState, WinReason,
} from './types';

interface Ctx { s: GameState; ev: GameEvent[] }

const emptyTile = (): TileState => ({ owner: null, lv: 0, mortgaged: false });

const LV_NAME = ['空地', '别墅', '公寓', '酒店', '地标'];

// ───────────────────────── 创建 ─────────────────────────
export function createGame(cfg: GameConfig): GameState {
  if (cfg.seats.length < 2 || cfg.seats.length > 4) throw new Error('需要 2–4 名玩家');
  const seats: PlayerState[] = cfg.seats.map((c, seat) => ({
    seat, id: c.id, name: c.name, charId: c.charId, isBot: !!c.isBot, ...(c.difficulty ? { difficulty: c.difficulty } : {}), ...(c.accountId !== undefined ? { accountId: c.accountId } : {}),
    cash: RULES.startCash, pos: 0, islandTurns: 0, doubles: 0, bankrupt: false, flyNext: false, shield: false,
    items: [], skillCd: 0, doubleToll: false, wangToll: false, liDiscount: false, xingPerfect: false, forcedSum: null, doubleSalary: false,
  }));
  const g: GameState = {
    version: 2, seed: cfg.seed >>> 0, rng: cfg.seed >>> 0, seq: 0, seats,
    tiles: BOARD.map(() => (emptyTile())),
    turn: 0, round: 1, maxRounds: cfg.maxRounds ?? RULES.maxRounds,
    phase: 'roll', pending: null, festivalTile: null, globalEvent: null, roadblocks: [], winner: null, winReason: null,
  };
  // 开局发牌（走引擎 RNG，保证可回放）
  for (const p of g.seats) for (let k = 0; k < RULES.itemStart; k++) p.items.push(pick(g, ITEM_IDS));
  return g;
}

// ───────────────────────── 计价 ─────────────────────────
/** 已投入总价（地价 + 各级建设费，不含折扣） */
export function investedValue(s: GameState, i: number): number {
  const d = BOARD[i], t = s.tiles[i];
  if (d.kind === 'tour') return d.price;
  let v = d.price;
  for (let l = 1; l <= t.lv; l++) v += d.price * RULES.buildCostMult[l];
  return Math.round(v);
}

/** 当前生效的全局事件倍率（无事件 = 全 1）。所有计价函数统一从这里取，禁止在别处散落判断 */
export function globalMods(s: GameState): GlobalEventDef {
  const g = s.globalEvent;
  return GLOBAL_EVENTS[g && g.untilRound >= s.round ? g.id : 'none'];
}

/** 该城市所在色组是否被同一玩家集齐（返回持有者，否则 null）；观光地 / 非城市恒为 null */
export function groupSetOwner(s: GameState, i: number): number | null {
  const d = BOARD[i];
  if (d.kind !== 'city' || !d.group) return null;
  const o = s.tiles[i].owner;
  if (o == null) return null;
  // 抵押中的地产不计入色组集齐
  return GROUPS[d.group].every((x) => s.tiles[x].owner === o && !s.tiles[x].mortgaged) ? o : null;
}

/** 从 from 级建到 to 级的建设费：先角色折扣，再全局事件（建设补贴），最后取整 */
export function buildCost(s: GameState, seat: number, i: number, from: number, to: number): number {
  const d = BOARD[i], disc = CHARACTERS[s.seats[seat].charId].buildDiscount;
  let c = 0;
  for (let l = from + 1; l <= to; l++) c += d.price * RULES.buildCostMult[l];
  return Math.round(c * (1 - disc) * globalMods(s).build);
}

/**
 * 过路费：所有倍率集中在此一处计算（v0.2 叠加顺序）：
 *   ① 单格 / 色组 / 持有者倍率：节庆 ×2 → 色组集齐 ×1.5 → 角色被动 → 双倍收租卡 → 老王金算盘（全部相乘）
 *   ② 全局事件倍率：过路费倍率（地产热潮 / 经济萧条）→ 观光地倍率（旅游旺季，仅观光地）
 *   ③ 最后一次性四舍五入，中间不取整
 */
export function tollOf(s: GameState, i: number): number {
  const d = BOARD[i], t = s.tiles[i];
  if (t.owner == null || t.mortgaged) return 0; // 抵押中不收过路费
  const op = s.seats[t.owner], g = globalMods(s);
  const owner = (1 + CHARACTERS[op.charId].tollBonus) * (op.doubleToll ? RULES.doubleTollMult : 1) * (op.wangToll ? RULES.wangSkillToll : 1);
  if (d.kind === 'tour') {
    const n = TOURS.filter((x) => s.tiles[x].owner === t.owner && !s.tiles[x].mortgaged).length;
    return Math.round(RULES.tourTollBase * 2 ** (n - 1) * owner * g.toll * g.tourToll);
  }
  const fest = s.festivalTile === i ? RULES.festivalMult : 1;
  const set = groupSetOwner(s, i) != null ? RULES.groupSetTollMult : 1;
  return Math.round(d.price * RULES.tollMult[t.lv] * fest * set * owner * g.toll);
}

export function takeoverCost(s: GameState, seat: number, i: number): number {
  const disc = CHARACTERS[s.seats[seat].charId].takeoverDiscount;
  const li = s.seats[seat].liDiscount ? RULES.liSkillTakeover : 1;
  return Math.round(investedValue(s, i) * RULES.takeoverMult * (1 - disc) * li);
}

/** 总资产 = 现金 + 地产投入；抵押中的地产已把得款计入现金，故只计「投入 − 赎回价」的净值，避免重复计算 */
export function totalAssets(s: GameState, seat: number): number {
  let v = s.seats[seat].cash;
  s.tiles.forEach((t, i) => { if (t.owner === seat) v += t.mortgaged ? investedValue(s, i) - redeemCost(s, i) : investedValue(s, i); });
  return v;
}

/** 抵押得款 = 已投入总价 × mortgageRatio（与变卖 sellRatio 同口径） */
export function mortgageValue(s: GameState, i: number): number {
  return Math.round(investedValue(s, i) * RULES.mortgageRatio);
}
/** 赎回价 = 抵押得款 × redeemMult */
export function redeemCost(s: GameState, i: number): number {
  return Math.round(mortgageValue(s, i) * RULES.redeemMult);
}

/** 当前需要行动的座位：待选择阶段是 pending 的当事人（竞拍时是出价人），否则是回合玩家 */
export function actorOf(s: GameState): number {
  return s.phase === 'choose' && s.pending ? s.pending.seat : s.turn;
}

/** 本玩家实际控骰命中率 */
export function controlOf(p: PlayerState): number {
  return Math.min(RULES.controlCap, CHARACTERS[p.charId].control);
}

// ───────────────────────── 入口 ─────────────────────────
export function applyAction(state: GameState, seat: number, action: Action): ApplyResult {
  if (state.phase === 'ended') return { ok: false, error: '对局已结束' };
  if (seat !== actorOf(state)) return { ok: false, error: '还没轮到你' };
  const ctx: Ctx = { s: structuredClone(state), ev: [] };
  const s = ctx.s;
  if (action.type === 'roll') {
    if (s.phase !== 'roll') return { ok: false, error: '当前不能掷骰' };
    if (!Number.isInteger(action.zone) || action.zone < 0 || action.zone >= ZONES.length) return { ok: false, error: '无效的区间' };
    doRoll(ctx, seat, action.zone);
  } else if (action.type === 'choose') {
    if (s.phase !== 'choose' || !s.pending || s.pending.seat !== seat) return { ok: false, error: '当前没有待选择项' };
    const o = action.option;
    if (!Number.isInteger(o) || o < -1 || o >= s.pending.options.length) return { ok: false, error: '无效的选项' };
    doChoose(ctx, seat, o);
  } else if (action.type === 'useItem') {
    const err = useItem(ctx, seat, action.item, action.target);
    if (err) return { ok: false, error: err };
  } else if (action.type === 'useSkill') {
    const err = useSkill(ctx, seat);
    if (err) return { ok: false, error: err };
  } else if (action.type === 'mortgage' || action.type === 'redeem') {
    const err = mortgageAction(ctx, seat, action.type, action.tile);
    if (err) return { ok: false, error: err };
  } else {
    return { ok: false, error: '未知操作' };
  }
  s.seq++;
  return { ok: true, state: s, events: ctx.ev };
}

/** 对局开始时调用一次，产生首个 turn 事件 */
export function openingEvents(s: GameState): GameEvent[] {
  return [{ t: 'turn', seat: s.turn, round: s.round }];
}

// ───────────────────────── 掷骰与移动 ─────────────────────────
function rollDice(ctx: Ctx, p: PlayerState, zone: number): { dice: [number, number]; hit: boolean } {
  const z = ZONES[zone];
  if (p.forcedSum != null) {
    const sum = p.forcedSum;
    p.forcedSum = null;
    p.xingPerfect = false;
    const pairs: [number, number][] = [];
    for (let a = 1; a <= 6; a++) { const b = sum - a; if (b >= 1 && b <= 6) pairs.push([a, b]); }
    return { dice: pick(ctx.s, pairs), hit: sum >= z.lo && sum <= z.hi };
  }
  const perfect = p.xingPerfect;
  p.xingPerfect = false;
  if (nextFloat(ctx.s) < (perfect ? 1 : controlOf(p))) {
    const sum = nextInt(ctx.s, z.lo, z.hi);
    const pairs: [number, number][] = [];
    for (let a = 1; a <= 6; a++) { const b = sum - a; if (b >= 1 && b <= 6) pairs.push([a, b]); }
    return { dice: pick(ctx.s, pairs), hit: true };
  }
  const a = nextInt(ctx.s, 1, 6), b = nextInt(ctx.s, 1, 6);
  return { dice: [a, b], hit: a + b >= z.lo && a + b <= z.hi };
}

function doRoll(ctx: Ctx, seat: number, zone: number) {
  const s = ctx.s, p = s.seats[seat];
  const { dice, hit } = rollDice(ctx, p, zone);
  ctx.ev.push({ t: 'roll', seat, zone, dice, hit });
  const isDouble = dice[0] === dice[1];
  const sum = dice[0] + dice[1];

  if (p.islandTurns > 0) {
    if (isDouble) {
      p.islandTurns = 0;
      ctx.ev.push({ t: 'islandEscape', seat });
      walk(ctx, seat, sum);
      landAndFinish(ctx, seat, false);
    } else {
      p.islandTurns--;
      ctx.ev.push({ t: 'islandStay', seat, left: p.islandTurns });
      endTurn(ctx);
    }
    return;
  }

  if (isDouble) {
    p.doubles++;
    ctx.ev.push({ t: 'doubles', seat, count: p.doubles });
    if (p.doubles >= RULES.doublesToIsland) {
      sendToIsland(ctx, seat);
      endTurn(ctx);
      return;
    }
  }
  walk(ctx, seat, sum);
  landAndFinish(ctx, seat, isDouble);
}

function walk(ctx: Ctx, seat: number, steps: number) {
  const p = ctx.s.seats[seat], path: number[] = [];
  for (let k = 0; k < steps; k++) {
    p.pos = (p.pos + 1) % BOARD_SIZE;
    path.push(p.pos);
    const rb = ctx.s.roadblocks.findIndex((r) => r.tile === p.pos && r.owner !== seat);
    if (rb >= 0) {
      const owner = ctx.s.roadblocks[rb].owner;
      ctx.s.roadblocks.splice(rb, 1);
      ctx.ev.push({ t: 'move', seat, path, via: 'walk' });
      ctx.ev.push({ t: 'roadblockHit', seat, owner, tile: p.pos });
      if (path.includes(0)) paySalary(ctx, seat);
      return;
    }
  }
  ctx.ev.push({ t: 'move', seat, path, via: 'walk' });
  if (path.includes(0)) paySalary(ctx, seat);
}

function paySalary(ctx: Ctx, seat: number) {
  const p = ctx.s.seats[seat];
  // 月薪：基数 × 全局事件（经济萧条）× 双倍月薪卡，最后取整
  const amount = Math.round(RULES.salary * globalMods(ctx.s).salary * (p.doubleSalary ? RULES.doubleSalaryMult : 1));
  p.doubleSalary = false;
  p.cash += amount;
  ctx.ev.push({ t: 'salary', seat, amount });
  if (p.items.length < RULES.itemMax) {
    const item = pick(ctx.s, ITEM_IDS);
    p.items.push(item);
    ctx.ev.push({ t: 'itemGained', seat, item });
  }
}

function sendToIsland(ctx: Ctx, seat: number) {
  const p = ctx.s.seats[seat];
  p.pos = ISLAND_INDEX; p.islandTurns = RULES.islandTurns; p.doubles = 0;
  ctx.ev.push({ t: 'move', seat, path: [ISLAND_INDEX], via: 'warp' });
  ctx.ev.push({ t: 'island', seat, turns: p.islandTurns });
}

// ───────────────────────── 落地结算 ─────────────────────────
/** 结算落脚格；若产生待选择项则停在 choose 阶段，否则收尾 */
function landAndFinish(ctx: Ctx, seat: number, again: boolean) {
  const r = resolveTile(ctx, seat);
  if (r.stopAgain) again = false;
  if (r.pending) { setPending(ctx, { ...r.pending, again }); return; }
  finish(ctx, seat, again);
}

interface Resolve { pending?: Omit<Pending, 'again'>; stopAgain?: boolean }

function resolveTile(ctx: Ctx, seat: number): Resolve {
  const s = ctx.s, p = s.seats[seat], i = p.pos, d = BOARD[i], t = s.tiles[i];
  switch (d.kind) {
    case 'corner':
      if (d.corner === 'island') { sendIslandInPlace(ctx, seat); return { stopAgain: true }; }
      if (d.corner === 'festival') {
        const opts = ownCities(s, seat).map((x) => ({ value: x, cost: 0, label: `${BOARD[x].name} 过路费 ×${RULES.festivalMult}` }));
        return opts.length ? { pending: { kind: 'festival', seat, tile: i, options: opts } } : {};
      }
      if (d.corner === 'airport') { p.flyNext = true; ctx.ev.push({ t: 'airport', seat }); return { stopAgain: true }; }
      return {};
    case 'card': return drawCard(ctx, seat);
    case 'tax': {
      const fee = Math.round(p.cash * RULES.taxRate);
      if (fee > 0) pay(ctx, seat, null, fee, i, 'tax');
      return {};
    }
    case 'tour':
    case 'city': {
      if (t.owner == null) {
        const opts = buyOptions(s, seat, i);
        return opts.length ? { pending: { kind: 'buy', seat, tile: i, options: opts } } : {};
      }
      if (t.owner === seat) {
        const opts = upgradeOptions(s, seat, i);
        return opts.length ? { pending: { kind: 'upgrade', seat, tile: i, options: opts } } : {};
      }
      // 别人的地：抵押中不收费也不可收购；否则付过路费 → 可收购
      if (t.mortgaged) return {};
      const owner = t.owner;
      if (p.shield) {
        p.shield = false;
        ctx.ev.push({ t: 'shieldUsed', seat, tile: i });
      } else {
        pay(ctx, seat, owner, tollOf(s, i), i, 'toll');
        if (p.bankrupt) return {};
      }
      if (d.kind === 'city' && t.lv < 4) {
        const cost = takeoverCost(s, seat, i);
        if (cost <= p.cash) {
          return { pending: { kind: 'takeover', seat, tile: i, options: [{ value: 1, cost, label: `收购 ${d.name}` }] } };
        }
      }
      return {};
    }
  }
}

function sendIslandInPlace(ctx: Ctx, seat: number) {
  const p = ctx.s.seats[seat];
  p.islandTurns = RULES.islandTurns; p.doubles = 0;
  ctx.ev.push({ t: 'island', seat, turns: p.islandTurns });
}

function ownCities(s: GameState, seat: number) {
  // 抵押中的城市不能作为节庆 / 升级等目标
  return s.tiles.map((t, i) => (t.owner === seat && !t.mortgaged && BOARD[i].kind === 'city' ? i : -1)).filter((i) => i >= 0);
}

export function buyOptions(s: GameState, seat: number, i: number): PendingOption[] {
  const d = BOARD[i], cash = s.seats[seat].cash;
  if (d.kind === 'tour') return d.price <= cash ? [{ value: 0, cost: d.price, label: `购买观光地 ${d.name}` }] : [];
  const out: PendingOption[] = [];
  for (let lv = 0; lv <= 3; lv++) {
    const cost = d.price + buildCost(s, seat, i, 0, lv);
    if (cost <= cash) out.push({ value: lv, cost, label: lv === 0 ? '只买地' : `买地 + ${LV_NAME[lv]}` });
  }
  return out;
}

export function upgradeOptions(s: GameState, seat: number, i: number): PendingOption[] {
  const d = BOARD[i], t = s.tiles[i], cash = s.seats[seat].cash;
  if (d.kind !== 'city' || t.lv >= 4 || t.mortgaged) return [];
  const targets = t.lv < 3 ? [1, 2, 3].filter((l) => l > t.lv) : [4];
  return targets
    .map((lv) => ({ value: lv, cost: buildCost(s, seat, i, t.lv, lv), label: `升级为${LV_NAME[lv]}` }))
    .filter((o) => o.cost <= cash);
}

// ───────────────────────── 机会卡 ─────────────────────────
const CARDS: { id: CardId; text: string }[] = [
  { id: 'bonus', text: '旅游奖金：获得 ¥20 万' },
  { id: 'fine', text: '超速罚单：缴纳 ¥15 万' },
  { id: 'toStart', text: '直达起点：前往起点并领取月薪' },
  { id: 'island', text: '遭遇风暴：漂流到无人岛' },
  { id: 'freeUpgrade', text: '政府补贴：免费升级一处城市' },
  { id: 'shield', text: '免单券：下次过路费全免' },
  { id: 'birthday', text: `生日派对：其他玩家各付你 ¥${RULES.birthdayGift} 万` },
  { id: 'forward', text: `前进 ${RULES.cardMoveSteps} 步并结算落地` },
  { id: 'back', text: `后退 ${RULES.cardMoveSteps} 步并结算落地（不领月薪）` },
  { id: 'itemSupply', text: `道具补给：随机获得 1 张道具（手牌满则改发 ¥${RULES.itemSupplyCash} 万）` },
  { id: 'taxRefund', text: `税务返还：获得现金的 ${Math.round(RULES.refundRate * 100)}%（上限 ¥${RULES.refundCap} 万）` },
  { id: 'doubleSalary', text: `双倍月薪：下次经过起点月薪 ×${RULES.doubleSalaryMult}` },
];

function drawCard(ctx: Ctx, seat: number): Resolve {
  const s = ctx.s, p = s.seats[seat], c = pick(s, CARDS);
  ctx.ev.push({ t: 'card', seat, card: c.id, text: c.text });
  switch (c.id) {
    case 'bonus': p.cash += 20; ctx.ev.push({ t: 'bonus', seat, amount: 20 }); return {};
    case 'fine': pay(ctx, seat, null, 15, p.pos, 'fine'); return {};
    case 'toStart': walk(ctx, seat, (BOARD_SIZE - p.pos) % BOARD_SIZE || BOARD_SIZE); return {};
    case 'island': sendToIsland(ctx, seat); return { stopAgain: true };
    case 'freeUpgrade': {
      const c2 = ownCities(s, seat).filter((i) => s.tiles[i].lv < 3);
      if (!c2.length) { p.cash += 10; ctx.ev.push({ t: 'bonus', seat, amount: 10 }); return {}; }
      const i = pick(s, c2), from = s.tiles[i].lv;
      s.tiles[i].lv++;
      ctx.ev.push({ t: 'upgrade', seat, tile: i, from, lv: s.tiles[i].lv, cost: 0 });
      return {};
    }
    case 'shield': p.shield = true; return {};
    case 'birthday':
      for (const o of s.seats) if (o.seat !== seat && !o.bankrupt) pay(ctx, o.seat, seat, RULES.birthdayGift, p.pos, 'birthday');
      return {};
    case 'forward':
      // 前进：复用 walk（路障 / 过起点月薪照常），再按落地格结算；卡牌格不会连环抽卡
      walk(ctx, seat, RULES.cardMoveSteps);
      return BOARD[p.pos].kind === 'card' ? {} : resolveTile(ctx, seat);
    case 'back': {
      // 后退：逐格倒走，经过起点不领月薪，不触发路障；落地后正常结算
      const path: number[] = [];
      for (let k = 1; k <= RULES.cardMoveSteps; k++) path.push((p.pos - k + BOARD_SIZE) % BOARD_SIZE);
      p.pos = path[path.length - 1];
      ctx.ev.push({ t: 'move', seat, path, via: 'walk' });
      return BOARD[p.pos].kind === 'card' ? {} : resolveTile(ctx, seat);
    }
    case 'itemSupply':
      if (p.items.length < RULES.itemMax) {
        const item = pick(s, ITEM_IDS);
        p.items.push(item);
        ctx.ev.push({ t: 'itemGained', seat, item });
      } else { p.cash += RULES.itemSupplyCash; ctx.ev.push({ t: 'bonus', seat, amount: RULES.itemSupplyCash }); }
      return {};
    case 'taxRefund': {
      const amount = Math.min(RULES.refundCap, Math.round(p.cash * RULES.refundRate));
      if (amount > 0) { p.cash += amount; ctx.ev.push({ t: 'bonus', seat, amount }); }
      return {};
    }
    case 'doubleSalary': p.doubleSalary = true; return {};
  }
}

// ───────────────────────── 支付与破产 ─────────────────────────
function pay(ctx: Ctx, from: number, to: number | null, amount: number, tile: number | null, reason: 'toll' | 'tax' | 'fine' | 'birthday') {
  const s = ctx.s, p = s.seats[from];
  if (p.cash < amount) liquidate(ctx, from, amount);
  const paid = Math.min(p.cash, amount);
  p.cash -= paid;
  if (to != null) s.seats[to].cash += paid;
  ctx.ev.push({ t: 'pay', from, to, amount: paid, tile, reason });
  if (paid < amount) goBankrupt(ctx, from);
}

/** 现金不足时按投入从低到高变卖地产，直到够付 */
function liquidate(ctx: Ctx, seat: number, need: number) {
  const s = ctx.s, p = s.seats[seat];
  // 抵押地产的清算价值 = 变卖价 − 已得抵押款 = 0：优先级最低、不提供现金，只在破产时随全部地产收归银行
  const mine = s.tiles.map((t, i) => (t.owner === seat && !t.mortgaged ? i : -1)).filter((i) => i >= 0)
    .sort((a, b) => investedValue(s, a) - investedValue(s, b));
  for (const i of mine) {
    if (p.cash >= need) break;
    const amount = Math.round(investedValue(s, i) * RULES.sellRatio);
    s.tiles[i] = emptyTile();
    if (s.festivalTile === i) s.festivalTile = null;
    p.cash += amount;
    ctx.ev.push({ t: 'sell', seat, tile: i, amount });
  }
}

function goBankrupt(ctx: Ctx, seat: number) {
  const s = ctx.s, p = s.seats[seat];
  p.bankrupt = true; p.cash = 0; p.items = [];
  s.roadblocks = s.roadblocks.filter((r) => r.owner !== seat);
  s.tiles.forEach((t, i) => { if (t.owner === seat) { s.tiles[i] = emptyTile(); if (s.festivalTile === i) s.festivalTile = null; } });
  ctx.ev.push({ t: 'bankrupt', seat });
}

// ───────────────────────── 道具与技能 ─────────────────────────
const TARGETED: ItemId[] = ['dice', 'roadblock', 'demolish', 'freeBuild', 'teleport'];

/** 可选目标（dice 为总点数；其余为格子序号） */
export function itemTargets(s: GameState, seat: number, item: ItemId): number[] {
  const p = s.seats[seat];
  switch (item) {
    case 'dice': return [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    case 'roadblock': {
      const out: number[] = [];
      for (let n = 1; n <= RULES.roadblockRange; n++) {
        const i = (p.pos + n) % BOARD_SIZE;
        if (!s.roadblocks.some((r) => r.tile === i)) out.push(i);
      }
      return out;
    }
    case 'demolish':
      return s.tiles.map((t, i) => (t.owner != null && t.owner !== seat && !s.seats[t.owner].bankrupt && BOARD[i].kind === 'city' && !t.mortgaged && t.lv >= 1 && t.lv <= 3 ? i : -1)).filter((i) => i >= 0);
    case 'freeBuild': return upgradableCities(s, seat);
    case 'teleport': return BOARD.filter((d) => d.index !== p.pos && !(d.kind === 'corner' && d.corner === 'island')).map((d) => d.index);
    default: return [];
  }
}

function upgradableCities(s: GameState, seat: number) {
  return ownCities(s, seat).filter((i) => s.tiles[i].lv < 3);
}

function itemLabel(item: ItemId, v: number): string {
  if (item === 'dice') return `指定点数 ${v}`;
  return BOARD[v].name;
}

function useItem(ctx: Ctx, seat: number, item: ItemId, target?: number): string | null {
  const s = ctx.s, p = s.seats[seat];
  if (s.phase !== 'roll') return '当前不能使用道具';
  if (!(ITEM_IDS as readonly string[]).includes(item)) return '未知道具';
  if (p.items.indexOf(item) < 0) return '你没有这张道具';
  if (item === 'teleport' && p.islandTurns > 0) return '在无人岛上无法传送';
  if (item === 'dice' && p.forcedSum != null) return '遥控骰子已在生效';
  if (item === 'shield' && p.shield) return '护盾已在生效';
  if (item === 'doubleToll' && p.doubleToll) return '双倍收租已在生效';
  const targets = itemTargets(s, seat, item);
  if (TARGETED.includes(item)) {
    if (!targets.length) return '没有可选目标';
    if (target === undefined) {
      const options = targets.map((v) => ({ value: v, cost: 0, label: itemLabel(item, v) }));
      setPending(ctx, { kind: 'item', item, seat, tile: null, options, again: false });
      return null;
    }
    if (!targets.includes(target)) return '无效的目标';
  }
  p.items.splice(p.items.indexOf(item), 1);
  ctx.ev.push({ t: 'itemUsed', seat, item, target: target ?? null });
  switch (item) {
    case 'dice': p.forcedSum = target!; break;
    case 'roadblock':
      s.roadblocks.push({ tile: target!, owner: seat });
      ctx.ev.push({ t: 'roadblockPlaced', seat, tile: target! });
      break;
    case 'shield': p.shield = true; break;
    case 'doubleToll': p.doubleToll = true; break;
    case 'demolish': {
      const t = s.tiles[target!], lv = t.lv - 1;
      t.lv = lv;
      ctx.ev.push({ t: 'demolish', seat, from: t.owner!, tile: target!, lv });
      break;
    }
    case 'freeBuild': freeUpgrade(ctx, seat, target!); break;
    case 'teleport': {
      const dest = target!, passStart = dest < p.pos;
      p.pos = dest;
      ctx.ev.push({ t: 'move', seat, path: [dest], via: 'fly' });
      if (passStart) paySalary(ctx, seat);
      // 传送后仍可继续掷骰（again=true）；落到无人岛等会自行结束回合
      landAndFinish(ctx, seat, true);
      break;
    }
  }
  return null;
}

function freeUpgrade(ctx: Ctx, seat: number, i: number) {
  const t = ctx.s.tiles[i], from = t.lv;
  t.lv++;
  ctx.ev.push({ t: 'upgrade', seat, tile: i, from, lv: t.lv, cost: 0 });
}

function useSkill(ctx: Ctx, seat: number): string | null {
  const s = ctx.s, p = s.seats[seat];
  if (s.phase !== 'roll') return '当前不能使用技能';
  if (p.skillCd > 0) return `技能冷却中（还需 ${p.skillCd} 回合）`;
  const def = CHARACTERS[p.charId];
  p.skillCd = RULES.skillCooldown;
  ctx.ev.push({ t: 'skillUsed', seat, charId: p.charId, text: def.active.name });
  switch (p.charId) {
    case 'jin': {
      const amount = Math.min(RULES.jinSkillCap, Math.round(totalAssets(s, seat) * RULES.jinSkillRate));
      p.cash += amount;
      ctx.ev.push({ t: 'bonus', seat, amount });
      break;
    }
    case 'li': p.liDiscount = true; break;
    case 'wang': p.wangToll = true; break;
    case 'xing': p.xingPerfect = true; break;
    case 'panda': {
      // 确定性：升级地价最高的可升城市（同价取序号小者）
      const c = upgradableCities(s, seat).sort((a, b) => BOARD[b].price - BOARD[a].price || a - b);
      if (c.length) freeUpgrade(ctx, seat, c[0]);
      else { p.cash += RULES.pandaSkillCash; ctx.ev.push({ t: 'bonus', seat, amount: RULES.pandaSkillCash }); }
      break;
    }
  }
  return null;
}

// ───────────────────────── 选择 ─────────────────────────
function setPending(ctx: Ctx, pending: Pending) {
  ctx.s.pending = pending;
  ctx.s.phase = 'choose';
  ctx.ev.push({ t: 'prompt', pending });
}

function doChoose(ctx: Ctx, seat: number, idx: number) {
  const s = ctx.s, pend = s.pending!, p = s.seats[seat];
  s.pending = null;
  const again = pend.again;
  if (pend.kind === 'item') {
    s.phase = 'roll';
    if (idx === -1) { ctx.ev.push({ t: 'decline', seat, kind: 'item' }); return; }
    const err = useItem(ctx, seat, pend.item!, pend.options[idx].value);
    if (err) throw new Error(err);
    return;
  }
  if (pend.kind === 'auction') { doAuctionChoice(ctx, seat, pend, idx); return; }
  if (idx === -1) {
    ctx.ev.push({ t: 'decline', seat, kind: pend.kind });
    // 放弃购买无主地块 → 进入竞拍（其余玩家有机会拍下），而不是直接流空
    if (pend.kind === 'buy' && startAuction(ctx, seat, pend.tile!, again)) return;
    // 放弃起飞 = 正常掷骰
    if (pend.kind === 'fly') { s.phase = 'roll'; return; }
    finish(ctx, seat, again);
    return;
  }
  const o = pend.options[idx];
  const i = pend.tile!;
  switch (pend.kind) {
    case 'buy': {
      if (o.cost > p.cash) break;
      p.cash -= o.cost;
      s.tiles[i] = { owner: seat, lv: o.value, mortgaged: false };
      ctx.ev.push({ t: 'buy', seat, tile: i, lv: o.value, cost: o.cost });
      break;
    }
    case 'upgrade': {
      if (o.cost > p.cash) break;
      const from = s.tiles[i].lv;
      p.cash -= o.cost;
      s.tiles[i].lv = o.value;
      ctx.ev.push({ t: 'upgrade', seat, tile: i, from, lv: o.value, cost: o.cost });
      break;
    }
    case 'takeover': {
      const owner = s.tiles[i].owner!;
      if (o.cost > p.cash || owner === seat) break;
      p.cash -= o.cost;
      s.seats[owner].cash += o.cost;
      s.tiles[i].owner = seat;
      p.liDiscount = false;
      ctx.ev.push({ t: 'takeover', seat, from: owner, tile: i, cost: o.cost });
      // 收购后可以顺势加盖
      if (!checkWin(ctx)) {
        const up = upgradeOptions(s, seat, i);
        if (up.length) { setPending(ctx, { kind: 'upgrade', seat, tile: i, options: up, again }); return; }
      } else return;
      break;
    }
    case 'festival': {
      s.festivalTile = o.value;
      ctx.ev.push({ t: 'festival', seat, tile: o.value });
      break;
    }
    case 'fly': {
      const dest = o.value;
      const passStart = dest < p.pos || dest === 0;
      p.pos = dest;
      ctx.ev.push({ t: 'move', seat, path: [dest], via: 'fly' });
      if (passStart) paySalary(ctx, seat);
      landAndFinish(ctx, seat, false);
      return;
    }
  }
  finish(ctx, seat, again);
}

// ───────────────────────── 回合推进与胜负 ─────────────────────────
function finish(ctx: Ctx, seat: number, again: boolean) {
  if (checkWin(ctx)) return;
  const p = ctx.s.seats[seat];
  if (again && !p.bankrupt && p.islandTurns === 0) {
    ctx.s.phase = 'roll';
    return;
  }
  endTurn(ctx);
}

function endTurn(ctx: Ctx) {
  const s = ctx.s, n = s.seats.length;
  let next = s.turn;
  for (let k = 0; k < n; k++) {
    next = (next + 1) % n;
    if (!s.seats[next].bankrupt) break;
  }
  const newRound = next <= s.turn;
  if (newRound) s.round++;
  if (s.round > s.maxRounds) { endByAssets(ctx); return; }
  startTurn(ctx, next, newRound);
}

function startTurn(ctx: Ctx, seat: number, newRound = false) {
  const s = ctx.s, p = s.seats[seat];
  s.turn = seat; p.doubles = 0; s.pending = null; s.phase = 'roll';
  p.doubleToll = false; p.wangToll = false; p.liDiscount = false; p.xingPerfect = false; p.forcedSum = null;
  if (p.skillCd > 0) p.skillCd--;
  ctx.ev.push({ t: 'turn', seat, round: s.round });
  if (newRound) rollGlobalEvent(ctx);
  if (p.flyNext) {
    p.flyNext = false;
    const opts = BOARD.filter((d) => d.index !== p.pos && !(d.kind === 'corner' && d.corner === 'island'))
      .map((d) => ({ value: d.index, cost: 0, label: `飞往 ${d.name}` }));
    setPending(ctx, { kind: 'fly', seat, tile: p.pos, options: opts, again: false });
  }
}

/**
 * 新一轮开始时刷新全局事件：旧事件失效；每 RULES.globalEventEvery 回合用 state.rng 按权重抽一次（含「无事件」）。
 * 事件持续 1 回合（untilRound = 当前回合）。
 */
function rollGlobalEvent(ctx: Ctx) {
  const s = ctx.s, had = s.globalEvent != null;
  s.globalEvent = null;
  if (s.round % RULES.globalEventEvery === 0) {
    const total = GLOBAL_EVENT_IDS.reduce((a, id) => a + GLOBAL_EVENTS[id].weight, 0);
    let r = nextInt(s, 0, total - 1);
    let id = GLOBAL_EVENT_IDS[0] as (typeof GLOBAL_EVENT_IDS)[number];
    for (const x of GLOBAL_EVENT_IDS) { if (r < GLOBAL_EVENTS[x].weight) { id = x; break; } r -= GLOBAL_EVENTS[x].weight; }
    if (id !== 'none') s.globalEvent = { id, untilRound: s.round };
    ctx.ev.push({ t: 'globalEvent', id, round: s.round });
  } else if (had) {
    ctx.ev.push({ t: 'globalEvent', id: 'none', round: s.round });
  }
}

/** 返回 true 表示对局已结束 */
function checkWin(ctx: Ctx): boolean {
  const s = ctx.s;
  if (s.phase === 'ended') return true;
  const alive = s.seats.filter((p) => !p.bankrupt);
  if (alive.length === 1) { end(ctx, alive[0].seat, 'bankrupt'); return true; }
  const order = [s.turn, ...s.seats.map((p) => p.seat).filter((x) => x !== s.turn)];
  for (const seat of order) {
    if (s.seats[seat].bankrupt) continue;
    const r = monopolyOf(s, seat);
    if (r) { end(ctx, seat, r); return true; }
  }
  return false;
}

export function monopolyOf(s: GameState, seat: number): WinReason | null {
  const owns = (i: number) => s.tiles[i].owner === seat && !s.tiles[i].mortgaged; // 抵押中的地产不计入独占
  if (TOURS.every(owns)) return 'tour';
  if (SIDES.some((side) => side.every(owns))) return 'line';
  const groups = Object.values(GROUPS).filter((g) => g.every(owns)).length;
  if (groups >= RULES.tripleGroups) return 'triple';
  return null;
}

function endByAssets(ctx: Ctx) {
  const s = ctx.s;
  let best = -1, bestV = -Infinity;
  s.seats.forEach((p) => { if (!p.bankrupt) { const v = totalAssets(s, p.seat); if (v > bestV) { bestV = v; best = p.seat; } } });
  s.round = s.maxRounds;
  end(ctx, best, 'assets');
}

function end(ctx: Ctx, winner: number, reason: WinReason) {
  const s = ctx.s;
  s.phase = 'ended'; s.pending = null; s.winner = winner; s.winReason = reason;
  ctx.ev.push({ t: 'end', winner, reason });
}

// ───────────────────────── 竞拍 ─────────────────────────
function auctionMinBid(au: AuctionState): number {
  return au.highSeat == null ? au.start : au.high + RULES.auctionMinRaise;
}

/** 放弃购买后开启竞拍；没有可参与的对手时返回 false（地块照旧流空） */
function startAuction(ctx: Ctx, starter: number, tile: number, again: boolean): boolean {
  const s = ctx.s, n = s.seats.length, order: number[] = [];
  for (let k = 1; k < n; k++) { const q = (starter + k) % n; if (!s.seats[q].bankrupt) order.push(q); }
  if (!order.length) return false;
  const au: AuctionState = {
    tile, starter, start: Math.round(BOARD[tile].price * RULES.auctionStartRatio),
    high: 0, highSeat: null, order, out: [],
  };
  ctx.ev.push({ t: 'auctionStart', seat: starter, tile, start: au.start });
  auctionStep(ctx, au, -1, again);
  return true;
}

/** 轮到下一位出价人；全员弃拍 → 流拍，轮回到最高价者 → 成交。出价需要的现金不足者自动弃拍 */
function auctionStep(ctx: Ctx, au: AuctionState, from: number, again: boolean) {
  const s = ctx.s, n = au.order.length;
  let idx = from < 0 ? -1 : au.order.indexOf(from);
  for (let guard = 0; guard <= n * 2; guard++) {
    let cand = -1;
    for (let j = 1; j <= n; j++) {
      const c = au.order[(idx + j + n) % n];
      if (!au.out.includes(c)) { cand = c; idx = au.order.indexOf(c); break; }
    }
    if (cand < 0) break; // 无人可出价
    if (au.highSeat === cand) { auctionEnd(ctx, au, again); return; } // 其余人都已表态，最高价者得
    const min = auctionMinBid(au), cash = s.seats[cand].cash;
    if (cash < min) { au.out.push(cand); ctx.ev.push({ t: 'auctionPass', seat: cand, tile: au.tile }); continue; }
    const values = [...new Set(RULES.auctionBidSteps.map((x) => min + x))].filter((v) => v <= cash);
    const options = values.map((v) => ({ value: v, cost: v, label: `出价 ¥${v} 万` }));
    setPending(ctx, { kind: 'auction', seat: cand, tile: au.tile, options, again, auction: au });
    return;
  }
  auctionEnd(ctx, au, again);
}

function auctionEnd(ctx: Ctx, au: AuctionState, again: boolean) {
  const s = ctx.s;
  s.pending = null;
  if (au.highSeat != null) {
    s.seats[au.highSeat].cash -= au.high;
    s.tiles[au.tile] = { owner: au.highSeat, lv: 0, mortgaged: false };
    ctx.ev.push({ t: 'auctionWin', seat: au.highSeat, tile: au.tile, amount: au.high });
  } else {
    ctx.ev.push({ t: 'auctionFail', tile: au.tile });
  }
  finish(ctx, au.starter, again);
}

function doAuctionChoice(ctx: Ctx, seat: number, pend: Pending, idx: number) {
  const au = structuredClone(pend.auction!);
  if (idx === -1) {
    au.out.push(seat);
    ctx.ev.push({ t: 'auctionPass', seat, tile: au.tile });
  } else {
    const amount = pend.options[idx].value;
    au.high = amount; au.highSeat = seat;
    ctx.ev.push({ t: 'auctionBid', seat, tile: au.tile, amount });
  }
  auctionStep(ctx, au, seat, pend.again);
}

// ───────────────────────── 抵押与赎回 ─────────────────────────
function mortgageAction(ctx: Ctx, seat: number, kind: 'mortgage' | 'redeem', tile: number): string | null {
  const s = ctx.s, p = s.seats[seat];
  if (s.phase !== 'roll') return '当前不能抵押 / 赎回';
  if (!Number.isInteger(tile) || tile < 0 || tile >= BOARD_SIZE || !isOwnable(tile)) return '无效的地产';
  const t = s.tiles[tile];
  if (t.owner !== seat) return '这不是你的地产';
  if (kind === 'mortgage') {
    if (t.mortgaged) return '该地产已在抵押中';
    const amount = mortgageValue(s, tile);
    p.cash += amount; t.mortgaged = true;
    ctx.ev.push({ t: 'mortgage', seat, tile, amount });
  } else {
    if (!t.mortgaged) return '该地产没有被抵押';
    const cost = redeemCost(s, tile);
    if (p.cash < cost) return `现金不足，赎回需要 ¥${cost} 万`;
    p.cash -= cost; t.mortgaged = false;
    ctx.ev.push({ t: 'redeem', seat, tile, cost });
  }
  return null;
}

export { isOwnable };

/**
 * 存量快照升级：把 v0.1 / v0.2 阶段 1 的快照（version 1）补齐新字段后升为 version 2。
 * 只补默认值，不改变既有字段；version 2 的快照原样返回（深拷贝）。
 */
export function migrateState(raw: unknown): GameState {
  const s = structuredClone(raw) as unknown as GameState & { version: number };
  const ver: number = s.version;
  if (ver !== 1 && ver !== 2) throw new Error(`不支持的快照版本：${ver}`);
  s.version = 2;
  s.globalEvent ??= null;
  s.roadblocks ??= [];
  for (const t of s.tiles) t.mortgaged ??= false;
  for (const p of s.seats) {
    p.items ??= []; p.skillCd ??= 0; p.doubleToll ??= false; p.wangToll ??= false; p.liDiscount ??= false;
    p.xingPerfect ??= false; p.forcedSum ??= null; p.doubleSalary ??= false;
  }
  return s;
}
