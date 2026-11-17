/**
 * 本地档案与对局历史（纯逻辑，与存储无关；客户端把字符串存进 localStorage）。
 * 脏数据一律安全丢弃 / 重建，绝不抛错。
 */
import { CHAR_IDS, type CharId } from './characters';
import { PROFILE } from './config';
import type { GameRecord, RankEntry } from './replay';

export interface Profile { v: 1; id: string; name: string; charId: CharId; createdAt: number }

/** 历史条目：只存回放摘要；完整回放 JSON 另存（键 replayPrefix + id），不进历史记录 */
export interface HistoryEntry {
  id: string; at: number; kind: 'solo' | 'online';
  /** 我的名次（1 起）；找不到我时为 0 */
  rank: number; won: boolean;
  winner: string | null; winReason: string | null; rounds: number;
  seats: { name: string; charId: CharId; isBot: boolean }[];
  ranking: RankEntry[];
  seed: number; steps: number;
}

export interface Stats { games: number; wins: number; winRate: number }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isChar = (c: unknown): c is CharId => typeof c === 'string' && (CHAR_IDS as readonly string[]).includes(c);
const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const cleanName = (s: unknown, fallback: string) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, PROFILE.nameMax) : fallback);

export function newProfile(now: number, rnd: () => number = Math.random): Profile {
  const id = 'p-' + now.toString(36) + '-' + Math.floor(rnd() * 36 ** 6).toString(36);
  return { v: 1, id, name: '玩家' + Math.floor(rnd() * 900 + 100), charId: 'jin', createdAt: now };
}

export const serializeProfile = (p: Profile) => JSON.stringify(p);

/** 反序列化：空 / 损坏 / 未知版本 → 重建新档案；缺字段的旧数据尽量保留可用部分 */
export function parseProfile(raw: string | null | undefined, now: number, rnd?: () => number): { profile: Profile; rebuilt: boolean } {
  const fresh = newProfile(now, rnd);
  if (!raw) return { profile: fresh, rebuilt: true };
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return { profile: fresh, rebuilt: true }; }
  if (!isObj(o) || o.v !== 1 || typeof o.id !== 'string' || !o.id) return { profile: fresh, rebuilt: true };
  return {
    rebuilt: false,
    profile: { v: 1, id: o.id.slice(0, 64), name: cleanName(o.name, fresh.name), charId: isChar(o.charId) ? o.charId : 'jin', createdAt: num(o.createdAt, now) },
  };
}

function cleanRank(r: unknown): RankEntry | null {
  if (!isObj(r) || typeof r.name !== 'string') return null;
  return {
    seat: num(r.seat), name: r.name.slice(0, 24), ...(typeof r.accountId === 'string' ? { accountId: r.accountId } : {}),
    assets: num(r.assets), bankrupt: !!r.bankrupt, won: !!r.won, rank: num(r.rank, 1),
  };
}

function cleanEntry(e: unknown): HistoryEntry | null {
  if (!isObj(e) || typeof e.id !== 'string' || !e.id) return null;
  const seats = Array.isArray(e.seats) ? e.seats.filter(isObj).map((s) => ({
    name: typeof s.name === 'string' ? s.name.slice(0, 24) : '?', charId: isChar(s.charId) ? s.charId : ('jin' as CharId), isBot: !!s.isBot,
  })) : [];
  return {
    id: e.id, at: num(e.at), kind: e.kind === 'online' ? 'online' : 'solo',
    rank: Math.max(0, Math.floor(num(e.rank))), won: !!e.won,
    winner: typeof e.winner === 'string' ? e.winner : null, winReason: typeof e.winReason === 'string' ? e.winReason : null,
    rounds: num(e.rounds), seats,
    ranking: Array.isArray(e.ranking) ? e.ranking.map(cleanRank).filter((x): x is RankEntry => !!x) : [],
    seed: num(e.seed), steps: num(e.steps),
  };
}

/** 读历史：损坏 → 空；坏条目被丢弃；按时间新→旧并截断到上限 */
export function parseHistory(raw: string | null | undefined): HistoryEntry[] {
  if (!raw) return [];
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return []; }
  if (!isObj(o) || o.v !== 1 || !Array.isArray(o.items)) return [];
  const items = o.items.map(cleanEntry).filter((x): x is HistoryEntry => !!x);
  return items.sort((a, b) => b.at - a.at).slice(0, PROFILE.historyLimit);
}

export const serializeHistory = (items: HistoryEntry[]) => JSON.stringify({ v: 1, items });

/** 新增一条（最新在前），超过上限丢弃最旧；返回新数组与被挤出的条目（调用方据此清理其回放 JSON） */
export function addHistory(items: HistoryEntry[], e: HistoryEntry, limit: number = PROFILE.historyLimit): { items: HistoryEntry[]; dropped: HistoryEntry[] } {
  const all = [e, ...items.filter((x) => x.id !== e.id)].sort((a, b) => b.at - a.at);
  return { items: all.slice(0, limit), dropped: all.slice(limit) };
}

export const removeHistory = (items: HistoryEntry[], id: string) => items.filter((x) => x.id !== id);

export function computeStats(items: HistoryEntry[]): Stats {
  const games = items.length, wins = items.filter((x) => x.won).length;
  return { games, wins, winRate: games ? wins / games : 0 };
}

/** 由一份已结束的回放记录生成历史条目；回放未结束（无 ranking）返回 null */
export function entryFromRecord(rec: GameRecord, profileId: string, kind: 'solo' | 'online', now: number, rnd: () => number = Math.random): HistoryEntry | null {
  const r = rec.result;
  if (!r || r.phase !== 'ended' || !r.ranking) return null;
  const mine = r.ranking.find((x) => x.accountId === profileId);
  const winnerRow = r.ranking.find((x) => x.won);
  return {
    id: 'g-' + now.toString(36) + '-' + Math.floor(rnd() * 36 ** 4).toString(36), at: now, kind,
    rank: mine?.rank ?? 0, won: !!mine?.won,
    winner: winnerRow?.name ?? null, winReason: r.winReason, rounds: r.round,
    seats: rec.seats.map((s) => ({ name: s.name, charId: s.charId, isBot: !!s.isBot })),
    ranking: r.ranking, seed: rec.seed, steps: rec.actions.length,
  };
}
