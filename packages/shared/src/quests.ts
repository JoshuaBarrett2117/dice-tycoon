/**
 * 每日任务与成就（纯逻辑，与存储无关）。
 * 进度只来自对局记录：digestRecord(GameRecord) → GameDigest → applyDigest(state, digest)。
 * 不碰引擎规则；任务抽取由日期字符串确定性哈希决定，不用 Math.random。
 */
import { GROUPS } from './board';
import { QUESTS } from './config';
import { totalAssets } from './engine';
import { ReplayPlayer, type GameRecord } from './replay';

/** 单局摘要（我这个账号视角） */
export interface GameDigest {
  id: string; won: boolean; online: boolean;
  buys: number; events: number; sets: number; peakAssets: number;
}

const GROUP_LIST = Object.values(GROUPS);

/** 由已结束的回放记录推导摘要；找不到我、记录未结束或损坏返回 null */
export function digestRecord(rec: GameRecord, accountId: string, id: string, online: boolean): GameDigest | null {
  try {
    if (!rec.result || rec.result.phase !== 'ended') return null;
    const seat = rec.seats.findIndex((s) => s.accountId === accountId);
    if (seat < 0) return null;
    const pl = new ReplayPlayer(rec);
    let buys = 0, events = 0, peak = 0, sets = 0;
    let prevSets = 0;
    for (const f of pl.frames) {
      for (const e of f.events) {
        if (e.t === 'buy' && e.seat === seat) buys++;
        else if (e.t === 'auctionWin' && e.seat === seat) buys++;
        else if (e.t === 'globalEvent') events++;
      }
      peak = Math.max(peak, totalAssets(f.state, seat));
      // 色组独占：统计「集齐的色组数」上升的次数（抵押中的不计）
      const now = GROUP_LIST.filter((g) => g.every((i) => f.state.tiles[i].owner === seat && !f.state.tiles[i].mortgaged)).length;
      if (now > prevSets) sets += now - prevSets;
      prevSets = now;
    }
    const won = rec.result.ranking?.find((r) => r.accountId === accountId)?.won ?? false;
    return { id, won, online, buys, events, sets, peakAssets: peak };
  } catch { return null; }
}

export interface QuestsState {
  v: 1;
  /** 本地日期 YYYY-MM-DD */
  day: string;
  /** 当天任务进度：id → 累计值 */
  daily: Record<string, number>;
  /** 当天已选任务 id（固定下来，避免配置变动后错位） */
  dailyIds: string[];
  /** 当天已达成任务 id */
  dailyDone: string[];
  /** 终身累计 */
  life: { games: number; wins: number; online: number; buys: number; events: number; sets: number; peakAssets: number };
  /** 成就 id → 点亮时间戳 */
  unlocked: Record<string, number>;
  seen: string[];
}

/** 本地日期键 */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 按日期确定性抽取当天任务（同一天同一批；部分 Fisher-Yates，种子为 mulberry32） */
export function pickDaily(day: string, n: number = QUESTS.dailyCount): string[] {
  const ids = QUESTS.pool.map((q) => q.id) as string[];
  let a = hash(day);
  const rnd = () => {
    let t = (a = (a + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids.slice(0, Math.min(n, ids.length));
}

export function freshQuests(now: number): QuestsState {
  const day = dayKey(now);
  return {
    v: 1, day, daily: {}, dailyIds: pickDaily(day), dailyDone: [],
    life: { games: 0, wins: 0, online: 0, buys: 0, events: 0, sets: 0, peakAssets: 0 }, unlocked: {}, seen: [],
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
const strs = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : []);

/** 反序列化：空 / 损坏 / 未知版本 → 全新状态；并在跨日时重置当天任务（未完成不累积） */
export function parseQuests(raw: string | null | undefined, now: number): QuestsState {
  let st = freshQuests(now);
  if (raw) {
    try {
      const o: unknown = JSON.parse(raw);
      if (isObj(o) && o.v === 1 && typeof o.day === 'string' && isObj(o.life) && isObj(o.daily) && isObj(o.unlocked)) {
        const l = o.life;
        st = {
          v: 1, day: o.day, dailyIds: strs(o.dailyIds), dailyDone: strs(o.dailyDone),
          daily: Object.fromEntries(Object.entries(o.daily).map(([k, v]) => [k, num(v)])),
          life: { games: num(l.games), wins: num(l.wins), online: num(l.online), buys: num(l.buys), events: num(l.events), sets: num(l.sets), peakAssets: num(l.peakAssets) },
          unlocked: Object.fromEntries(Object.entries(o.unlocked).map(([k, v]) => [k, num(v)])),
          seen: strs(o.seen).slice(-QUESTS.seenLimit),
        };
      }
    } catch { /* 损坏 → 新状态 */ }
  }
  return rollDay(st, now);
}

export const serializeQuests = (s: QuestsState) => JSON.stringify(s);

/** 跨本地日期：重置当天任务，终身数据与成就保留 */
export function rollDay(s: QuestsState, now: number): QuestsState {
  const day = dayKey(now);
  if (s.day === day && s.dailyIds.length) return s;
  return { ...s, day, daily: {}, dailyIds: pickDaily(day), dailyDone: [] };
}

export interface QuestView { id: string; title: string; badge: string; progress: number; target: number; done: boolean }
export interface AchievementView { id: string; title: string; desc: string; badge: string; progress: number; target: number; unlocked: boolean; at: number }

export function dailyView(s: QuestsState): QuestView[] {
  return s.dailyIds.map((id) => QUESTS.pool.find((q) => q.id === id)).filter((q): q is (typeof QUESTS.pool)[number] => !!q).map((q) => ({
    id: q.id, title: q.title, badge: q.badge, target: q.target,
    progress: Math.min(q.target, s.daily[q.id] ?? 0), done: s.dailyDone.includes(q.id),
  }));
}

export function achievementView(s: QuestsState): AchievementView[] {
  return QUESTS.achievements.map((a) => {
    const v = s.life[a.metric as keyof QuestsState['life']] ?? 0;
    const at = s.unlocked[a.id] ?? 0;
    return { id: a.id, title: a.title, desc: a.desc, badge: a.badge, target: a.target, progress: Math.min(a.target, v), unlocked: a.id in s.unlocked, at };
  });
}

export interface DigestApplyResult { state: QuestsState; newDaily: QuestView[]; newAchievements: AchievementView[] }

/** 把一局摘要计入进度；同一局（id）只计一次。纯函数，不修改入参 */
export function applyDigest(prev: QuestsState, d: GameDigest, now: number): DigestApplyResult {
  const s0 = rollDay(prev, now);
  if (s0.seen.includes(d.id)) return { state: s0, newDaily: [], newAchievements: [] };
  const inc = { games: 1, wins: d.won ? 1 : 0, online: d.online ? 1 : 0, buys: d.buys, events: d.events > 0 ? 1 : 0, sets: d.sets };
  const life = {
    games: s0.life.games + 1, wins: s0.life.wins + inc.wins, online: s0.life.online + inc.online,
    buys: s0.life.buys + d.buys, events: s0.life.events + d.events, sets: s0.life.sets + d.sets,
    peakAssets: Math.max(s0.life.peakAssets, d.peakAssets),
  };
  const daily = { ...s0.daily };
  const dailyDone = [...s0.dailyDone];
  const newDaily: QuestView[] = [];
  for (const id of s0.dailyIds) {
    const q = QUESTS.pool.find((x) => x.id === id);
    if (!q) continue;
    daily[id] = (daily[id] ?? 0) + (inc[q.metric as keyof typeof inc] ?? 0);
    if (!dailyDone.includes(id) && daily[id] >= q.target) dailyDone.push(id);
  }
  const unlocked = { ...s0.unlocked };
  const state: QuestsState = { ...s0, daily, dailyDone, life, unlocked, seen: [...s0.seen, d.id].slice(-QUESTS.seenLimit) };
  const before = new Set(s0.dailyDone);
  dailyView(state).filter((q) => q.done && !before.has(q.id)).forEach((q) => newDaily.push(q));
  const newAchievements: AchievementView[] = [];
  for (const a of achievementView(state)) {
    if (!a.unlocked && a.progress >= a.target) { unlocked[a.id] = now; newAchievements.push({ ...a, unlocked: true, at: now }); }
  }
  return { state, newDaily, newAchievements };
}
