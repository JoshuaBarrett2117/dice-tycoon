import {
  BOARD_DEFAULT, BOARD_IDS, BOARD_KEY, type BoardId, PROFILE, QUESTS, THEMES, THEME_DEFAULT, THEME_KEY, type ThemeId, addHistory, parseQuests, serializeQuests, parseHistory, parseProfile, removeHistory, serializeHistory, serializeProfile,
  type GameRecord, type HistoryEntry, type Profile, type QuestsState,
} from '@dt/shared';

/** localStorage 封装：任何读写失败（被禁用 / 配额满 / 脏数据）都安全降级，不抛错 */
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const del = (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

export function loadProfile(): Profile {
  const { profile, rebuilt } = parseProfile(get(PROFILE.keys.profile), Date.now());
  if (rebuilt) {
    // 旧版本（v0.3 及以前）只存了昵称与角色，首次建档时带过来
    const oldName = get('dt.name'), oldChar = get('dt.char');
    if (oldName) profile.name = oldName.slice(0, PROFILE.nameMax);
    if (oldChar && /^[a-z]+$/.test(oldChar)) profile.charId = oldChar as Profile['charId'];
    saveProfile(profile);
  }
  return profile;
}
export const saveProfile = (p: Profile) => set(PROFILE.keys.profile, serializeProfile(p));

export const loadHistory = (): HistoryEntry[] => parseHistory(get(PROFILE.keys.history));

export function pushHistory(e: HistoryEntry, rec: GameRecord) {
  const { items, dropped } = addHistory(loadHistory(), e);
  set(PROFILE.keys.replayPrefix + e.id, JSON.stringify(rec));
  dropped.forEach((d) => del(PROFILE.keys.replayPrefix + d.id));
  set(PROFILE.keys.history, serializeHistory(items));
}
export function deleteHistory(id: string) {
  set(PROFILE.keys.history, serializeHistory(removeHistory(loadHistory(), id)));
  del(PROFILE.keys.replayPrefix + id);
}
export function loadReplay(id: string): GameRecord | null {
  const raw = get(PROFILE.keys.replayPrefix + id);
  if (!raw) return null;
  try { return JSON.parse(raw) as GameRecord; } catch { return null; }
}

/** 每日任务与成就（v0.6）：与档案同在 localStorage，读时按本地日期自动跨日重置 */
export const loadQuests = (): QuestsState => parseQuests(get(QUESTS.key), Date.now());
export const saveQuests = (q: QuestsState) => set(QUESTS.key, serializeQuests(q));

/** 棋盘主题（v0.7）：只存本地，读失败回落默认 */
export const loadTheme = (): ThemeId => { const v = get(THEME_KEY); return v && v in THEMES ? (v as ThemeId) : THEME_DEFAULT; };
export const saveTheme = (id: ThemeId) => set(THEME_KEY, id);

/** 棋盘选择（v1.1）：只存本地，读失败回落经典 */
export const loadBoard = (): BoardId => { const v = get(BOARD_KEY); return v && (BOARD_IDS as string[]).includes(v) ? (v as BoardId) : BOARD_DEFAULT; };
export const saveBoard = (id: BoardId) => set(BOARD_KEY, id);
