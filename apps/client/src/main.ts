import './style.css';
import { BOARD_CFGS, BOARD_IDS, type BoardId, CHARACTERS, CHAR_IDS, FREE_CHAR_IDS, PAID_CHAR_IDS, THEMES, THEME_IDS, achievementView, applyDigest, computeStats, dailyView, digestRecord, entryFromRecord, type BotDifficulty, type ThemeId, type CharId, type GameRecord, type RoomBrief, type SeatConfig } from '@dt/shared';
import { deleteHistory, loadHistory, loadQuests, saveQuests, loadProfile, loadReplay, loadTheme, loadBoard, saveBoard, pushHistory, saveProfile, saveTheme } from './core/store';
import * as A from './account';
import { AU } from './audio/audio';
import { Director, charUrl } from './game/Director';
import { NetSource, LocalSource, ReplaySource, type GameSource, type LobbyMsg } from './net/source';
import { mountReplayBar } from './ui/ReplayBar';
import { Hud } from './ui/Hud';
import { World } from './view/World';
import * as K from './ui/kit';
import { esc, charPng } from './ui/kit';
import { glyph } from './ui/icons';

const stage = document.getElementById('stage')!;
document.documentElement.style.setProperty('--bgimg', `url(${import.meta.env.BASE_URL}assets/bg.jpg)`);
// 开发模式（vite）连本机 2567；生产镜像里网页与对战服同源，直接连当前地址
const WS = location.protocol === 'https:' ? 'wss' : 'ws';
const DEFAULT_SERVER = import.meta.env.VITE_SERVER_URL
  || (import.meta.env.DEV ? `${WS}://${location.hostname || 'localhost'}:2567` : `${WS}://${location.host}`);

// 舞台等比缩放（1280×720 逻辑分辨率，手机横屏 / PC 同一套布局）
function fit() {
  const s = Math.min(innerWidth / 1280, innerHeight / 720);
  stage.style.transform = `scale(${s})`;
}
addEventListener('resize', fit);
fit();

const profile = loadProfile();
const prefs = {
  name: profile.name,
  charId: profile.charId,
  server: localStorage.getItem('dt.server') || DEFAULT_SERVER,
  difficulty: ((): BotDifficulty => { const v = localStorage.getItem('dt.diff'); return v === 'easy' || v === 'hard' ? v : 'normal'; })(),
};
const accountId = profile.id;
// v1.6：已登录则静默刷新当前装备（外观 / 骰子皮肤），失败沿用本地缓存
if (A.savedToken()) void A.me(prefs.server).catch(() => {});

let world: World | null = null;
let worldReady: Promise<void> = Promise.resolve();
let source: GameSource | null = null;

function newWorld() {
  world = new World();
  worldReady = world.init(stage);
  return worldReady;
}

document.querySelector<HTMLButtonElement>('#rotate .rexit')?.addEventListener('click', () => showMenu());

async function boot() {
  await Promise.all([newWorld(), document.fonts.ready]);
  showMenu();
}

// ───────────────────────── 主菜单 ─────────────────────────
export const VERSION = 'v1.8';
/** 付费角色需登录且已购才可选；免费角色恒可选 */
const charUnlocked = (c: CharId) => !PAID_CHAR_IDS.includes(c) || A.ownedChars.has(c);
function charCards() {
  if (!charUnlocked(prefs.charId)) prefs.charId = 'jin';
  return CHAR_IDS.map((c) => {
    const lock = !charUnlocked(c);
    const on = c === prefs.charId;
    return `
        <button class="ch ${on ? 'on' : ''} ${lock ? 'locked' : ''}" data-c="${c}" style="--c:${CHARACTERS[c].color}" aria-pressed="${on}" title="${esc(CHARACTERS[c].name + '：' + CHARACTERS[c].skill)}">
          <span class="cimg">${K.img(charUrl(c, !lock), '', CHARACTERS[c].name)}</span><b>${esc(CHARACTERS[c].name)}</b><small>${esc(CHARACTERS[c].skill)}</small>${lock ? `<span class="lockb">${glyph('lock', 12)}商城解锁</span>` : ''}${PAID_CHAR_IDS.includes(c) && !lock ? '<span class="newb">已拥有</span>' : ''}
        </button>`;
  }).join('');
}
const DIFF_OPTS: K.SegOption[] = [{ value: 'easy', label: '简单' }, { value: 'normal', label: '普通' }, { value: 'hard', label: '困难' }];
function showMenu(msg = '') {
  teardownGame();
  const m = overlay('menu');
  m.innerHTML = `<div class="home">
    <header class="mhead"><div class="logo st3">掷富天下</div><div class="tag">网页大富翁 · ${VERSION}</div></header>
    <div class="chars" aria-label="选择角色">${charCards()}</div>
    <div class="settings">
      ${K.segHtml('diff', '单机难度', DIFF_OPTS, prefs.difficulty)}
      ${K.segHtml('theme', '棋盘主题', THEME_IDS.map((t) => ({ value: t, label: THEMES[t].name })), loadTheme())}
      ${K.segHtml('board', '棋盘', BOARD_IDS.map((b) => ({ value: b, label: BOARD_CFGS[b].name })), loadBoard())}
    </div>
    <div class="btns">
      <button class="big gold" id="solo">单机对战<small>你 vs 3 个机器人</small></button>
      <button class="big blue" id="create">创建房间<small>好友联机，空位机器人补齐</small></button>
      <button class="big green" id="quick">快速匹配<small>凑满 4 人开局，超时机器人补位</small></button>
    </div>
    <div class="mrow">
      <label class="inp"><span>昵称</span><input id="nm" maxlength="12" value="${esc(prefs.name)}" autocomplete="nickname"></label>
      <div class="inp join"><span>房间</span><input id="rid" placeholder="输入房间号加入" inputmode="text" autocomplete="off"><button class="btn green sm" id="joinb">加入</button></div>
    </div>
    <div class="subbtns">
      <button class="pill" id="watch">${glyph('eye')}观战列表</button>
      <button class="pill" id="prof">${glyph('book')}档案与历史</button>
      <button class="pill" id="acct">${glyph('user')}账号${A.savedToken() ? '<i class="dot"></i>' : ''}</button>
      <label class="pill fbtn" tabindex="0">${glyph('upload')}导入回放 JSON<input id="rfile" type="file" accept=".json,application/json" hidden></label>
    </div>
    <details class="srv"><summary>服务器</summary><input id="srv" value="${esc(prefs.server)}" spellcheck="false"></details>
    <div class="msg" role="status">${esc(msg)}</div>
  </div>`;
  const msgEl = () => m.querySelector<HTMLElement>('.msg');
  // 底部提示条 6 秒后自动收起，不长期遮挡「服务器」设置
  let msgT = 0;
  const autoHide = () => { clearTimeout(msgT); msgT = window.setTimeout(() => { const el = msgEl(); if (el) el.textContent = ''; }, 6000); };
  if (msg) autoHide();
  new MutationObserver(() => { if (msgEl()?.textContent) autoHide(); }).observe(m.querySelector('.msg')!, { childList: true, characterData: true, subtree: true });
  const bindChars = () => m.querySelectorAll<HTMLButtonElement>('.ch').forEach((b) => (b.onclick = () => {
    const c = b.dataset.c as CharId;
    const el = msgEl();
    if (!charUnlocked(c)) { if (el) el.textContent = A.savedToken() ? `「${CHARACTERS[c].name}」尚未购买：到「账号 → 商城」用金币购买后即可选用` : `「${CHARACTERS[c].name}」是付费角色：登录账号并在商城购买后可用于联机（单机仅限 6 名免费角色）`; AU.unlock(); AU.play('click'); return; }
    if (el) el.textContent = '';
    prefs.charId = c;
    m.querySelectorAll<HTMLElement>('.ch').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    AU.unlock(); AU.play('click');
  }));
  bindChars();
  // 已登录：拉取已购角色后刷新选角卡（失败则保持锁定态）
  if (A.savedToken()) void A.me(prefs.server).then(() => { const box = m.querySelector('.chars'); if (box) { box.innerHTML = charCards(); bindChars(); } }).catch(() => { /* 保持锁定 */ });
  K.bindSeg(m, 'diff', (v) => { prefs.difficulty = v as BotDifficulty; try { localStorage.setItem('dt.diff', v); } catch { /* ignore */ } AU.unlock(); AU.play('click'); });
  K.bindSeg(m, 'theme', (v) => { saveTheme(v as ThemeId); world?.setTheme(v as ThemeId); AU.unlock(); AU.play('click'); });
  K.bindSeg(m, 'board', (v) => { saveBoard(v as BoardId); AU.unlock(); AU.play('click'); });
  const save = () => {
    prefs.name = (m.querySelector<HTMLInputElement>('#nm')!.value.trim() || prefs.name).slice(0, 12);
    prefs.server = m.querySelector<HTMLInputElement>('#srv')!.value.trim() || DEFAULT_SERVER;
    prefs.difficulty = (K.segValue(m, 'diff') || prefs.difficulty) as BotDifficulty;
    try { localStorage.setItem('dt.diff', prefs.difficulty); } catch { /* ignore */ }
    profile.name = prefs.name; profile.charId = prefs.charId; saveProfile(profile); try { localStorage.setItem('dt.server', prefs.server); } catch { /* ignore */ }
    AU.unlock();
  };
  m.querySelector<HTMLButtonElement>('#solo')!.onclick = () => { save(); startSolo(); };
  m.querySelector<HTMLButtonElement>('#create')!.onclick = () => { save(); void startOnline(); };
  m.querySelector<HTMLButtonElement>('#quick')!.onclick = () => { save(); void startQuick(); };
  m.querySelector<HTMLButtonElement>('#watch')!.onclick = () => { save(); showRooms(); };
  m.querySelector<HTMLButtonElement>('#prof')!.onclick = () => { save(); showProfile(); };
  m.querySelector<HTMLButtonElement>('#acct')!.onclick = () => { save(); void showAccount(); };
  const fl = m.querySelector<HTMLElement>('.fbtn')!;
  fl.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); m.querySelector<HTMLInputElement>('#rfile')!.click(); } };
  m.querySelector<HTMLInputElement>('#rfile')!.onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      startReplay(JSON.parse(await f.text()) as GameRecord, true);
    } catch (err) {
      showMenu(`回放文件无法播放：${(err as Error).message || err}`);
    }
  };
  const join = () => {
    save();
    const id = m.querySelector<HTMLInputElement>('#rid')!.value.trim();
    if (id) void startOnline(id);
    else { const el = msgEl(); if (el) el.textContent = '请先输入好友发给你的房间号'; }
  };
  m.querySelector<HTMLButtonElement>('#joinb')!.onclick = join;
  m.querySelector<HTMLInputElement>('#rid')!.onkeydown = (e) => { if (e.key === 'Enter') join(); };
}

// ───────────────────────── 账号（业务服）─────────────────────────
/** 已登录则带票据入座（accountId 以票据为准）；未登录沿用本地档案 id。票据失效会抛错，由调用方回主菜单提示重新登录 */
async function authOpts(): Promise<{ accountId: string; ticket?: string }> {
  if (!A.savedToken()) return { accountId };
  try { await A.me(prefs.server); } catch { /* 沿用缓存 */ }
  try {
    const t = await A.fetchTicket(prefs.server);
    return t ? { accountId: t.accountId, ticket: t.ticket } : { accountId };
  } catch (e) { throw new Error(`账号登录已失效，请在「账号」里重新登录（${(e as Error).message}）`); }
}

/** 页面内提示条：ok=true 为成功（绿），否则为提醒（橙） */
const noteHtml = (note: string, ok = false) => `<div class="note ${note ? (ok ? 'ok' : 'warn') : ''}" role="status">${esc(note)}</div>`;
const loadingPage = (title: string) => `<div class="page narrow">${K.pageHead(title)}<div class="pbody center"><div class="spin"></div><div class="hint">加载中…</div></div></div>`;

let acctTab: 'shop' | 'train' = 'shop';
let lastUser = '';
let meName = '';
let shopCat = 'char';
async function showAccount(note = '', ok = false) {
  const o = overlay('lobby', 'acct');
  if (o.dataset.fresh) { o.innerHTML = loadingPage('账号中心'); o.querySelector<HTMLButtonElement>('#back')!.onclick = () => showMenu(); }
  let acc: A.AccountView | null = null;
  if (A.savedToken()) { try { acc = await A.me(prefs.server); } catch (e) { note = note || (e as Error).message; ok = false; } }
  if (!o.isConnected) return;
  if (!acc) {
    o.innerHTML = `<div class="page auth">
      ${K.pageHead('登录 / 注册')}
      <div class="pbody">
        <div class="authcard">
          <div class="authart">${K.img(charPng(prefs.charId), '', '')}</div>
          <div class="authform">
            <div class="logo sm st3">掷富天下</div>
            <div class="hint">登录后可养成角色、在商城购买外观并参与联机段位。单机与本地档案不受影响。</div>
            <label class="inp col"><span>用户名</span><input id="u" maxlength="20" autocomplete="username" placeholder="3–20 位字母 / 数字" value="${esc(lastUser)}"></label>
            <label class="inp col"><span>密码</span><input id="p" type="password" maxlength="72" autocomplete="current-password" placeholder="至少 6 位"></label>
            <div class="row2"><button class="btn gold lg" id="li">登录</button><button class="btn blue lg" id="rg">注册新账号</button></div>
            <div class="hint xs">新账号赠送 200 金币 · 每日签到 +50</div>
            ${noteHtml(note, ok)}
          </div>
        </div>
      </div></div>`;
    const go = (mode: 'login' | 'register') => async () => {
      const u = o.querySelector<HTMLInputElement>('#u')!.value.trim(), p = o.querySelector<HTMLInputElement>('#p')!.value;
      lastUser = u;
      if (!u || !p) { const n = o.querySelector('.note'); if (n) { n.className = 'note warn'; n.textContent = '请输入用户名和密码'; } return; }
      try { await A.authenticate(prefs.server, mode, u, p); void showAccount(mode === 'login' ? '登录成功，欢迎回来！' : '注册成功，已赠送 200 金币', true); } catch (e) { void showAccount((e as Error).message); }
    };
    o.querySelector<HTMLButtonElement>('#li')!.onclick = go('login');
    o.querySelector<HTMLButtonElement>('#rg')!.onclick = go('register');
    o.querySelector<HTMLInputElement>('#p')!.onkeydown = (e) => { if (e.key === 'Enter') void go('login')(); };
    o.querySelector<HTMLButtonElement>('#back')!.onclick = () => showMenu();
    return;
  }
  let info: A.ShopInfo | null = null;
  try { info = await A.shop(prefs.server); } catch { /* 商城暂不可用 */ }
  if (!o.isConnected) return;
  renderAccount(o, acc, info, note, ok);
}

function renderAccount(o: HTMLElement, acc: A.AccountView, info: A.ShopInfo | null, note: string, ok: boolean) {
  meName = acc.username;
  const own = new Set(acc.cosmetics?.owned || []);
  const equipped = acc.cosmetics?.equipped || {};
  const eqv = Object.values(equipped);
  const tier = A.tierOf(acc.rating || 0);
  const today = new Date().toISOString().slice(0, 10);
  const checked = acc.lastCheckin === today;
  const cats = (info?.categories || []).filter((c) => c.items.length);
  if (!cats.find((c) => c.id === shopCat) && cats[0]) shopCat = cats[0].id;
  const all = cats.flatMap((c) => c.items);
  const names = (id: string) => (id === 'dice_classic' ? '经典骰子' : all.find((i) => i.id === id)?.name || id);
  const tr = info?.train ?? { cost: 50, exp: 40, expPerLevel: 100, maxLevel: 20 };

  const card = (i: A.Cosmetic | { id: string; kind: string; name: string; price: number; char?: string }, free = false) => {
    const has = free || own.has(i.id);
    const on = free ? !equipped.dice : eqv.includes(i.id);
    const sub = i.kind === 'char' ? '付费角色 · 联机可用' : i.kind === 'skin' ? `${CHARACTERS[i.char as CharId]?.name ?? ''} 专属外观` : '掷骰动画皮肤';
    let btn: string;
    if (i.kind === 'char') btn = has ? `<button class="btn ghost sm" disabled>${glyph('check', 14)}已拥有</button>` : `<button class="btn gold sm" data-buy="${i.id}" ${acc.coins < i.price ? 'data-poor="1"' : ''}>购买</button>`;
    else if (!has) btn = `<button class="btn gold sm" data-buy="${i.id}" ${acc.coins < i.price ? 'data-poor="1"' : ''}>购买</button>`;
    else if (on) btn = free ? `<button class="btn green sm" disabled>${glyph('check', 14)}使用中</button>` : `<button class="btn green sm" data-eq="${i.id}" data-on="0">${glyph('check', 14)}已装备</button>`;
    else btn = `<button class="btn blue sm" data-eq="${i.id}" data-on="1">装备</button>`;
    const state = on ? 'equipped' : has ? 'owned' : '';
    return `<div class="pcard ${i.kind} ${state}">
      <div class="pimg">${K.img(K.productImg(i.id), '', i.name)}${on ? '<span class="ptag eq">装备中</span>' : has ? '<span class="ptag own">已拥有</span>' : ''}</div>
      <div class="pname">${esc(i.name)}</div><div class="psub">${esc(sub)}</div>
      <div class="pfoot">${free ? '<span class="free">免费</span>' : has ? '<span class="free">已购</span>' : K.coin(i.price, acc.coins < i.price ? 'poor' : '')}${btn}</div>
    </div>`;
  };
  const curCat = cats.find((c) => c.id === shopCat);
  const shopGrid = !cats.length ? `<div class="empty">${K.img(charPng('panda'), '', '')}<b>商城暂无在售商品</b><span>新品上架后会出现在这里</span></div>`
    : `<div class="pgrid">${shopCat === 'dice' ? card({ id: 'dice_classic', kind: 'dice', name: '经典骰子', price: 0 }, true) : ''}${(curCat?.items || []).map((i) => card(i)).join('')}${shopCat === 'char' ? `<div class="pcard soon"><div class="pimg"><span class="qm">?</span></div><div class="pname">新角色筹备中</div><div class="psub">更多付费角色即将上架</div><div class="pfoot"><span class="free">敬请期待</span></div></div>` : ''}</div>`;
  const trainGrid = `<div class="tgrid">${CHAR_IDS.map((c) => {
    const p = acc.chars[c] || { exp: 0, level: 1 };
    const locked = !(!PAID_CHAR_IDS.includes(c) || own.has('char_' + c));
    const max = p.level >= tr.maxLevel;
    const cur = max ? tr.expPerLevel : p.exp % tr.expPerLevel;
    const pct = Math.round((cur / tr.expPerLevel) * 100);
    return `<div class="tcard ${locked ? 'locked' : ''}" style="--c:${CHARACTERS[c].color}">
      <div class="timg">${K.img(charPng(c), '', CHARACTERS[c].name)}<span class="lv">Lv.${p.level}</span></div>
      <div class="tinfo"><b>${esc(CHARACTERS[c].name)}</b>
        <div class="xp"><i style="width:${pct}%"></i></div>
        <small>${max ? '已满级' : `经验 ${cur}/${tr.expPerLevel}`}</small>
        ${locked ? `<button class="btn ghost sm" disabled>${glyph('lock', 13)}未解锁</button>` : max ? '<button class="btn ghost sm" disabled>已满级</button>' : `<button class="btn blue sm" data-tr="${c}" ${acc.coins < tr.cost ? 'data-poor="1"' : ''}>训练 ${K.coin(tr.cost, 'mini')}</button>`}
      </div></div>`;
  }).join('')}</div>`;

  o.innerHTML = `<div class="page acct">
    ${K.pageHead('账号中心', `<button class="btn ghost sm" id="lo">${glyph('logout', 15)}退出登录</button>`)}
    <div class="abar">
      <div class="who"><div class="avatar" style="--c:${CHARACTERS[prefs.charId].color}">${K.img(charPng(prefs.charId), '', '')}</div>
        <div class="wn"><b>${esc(acc.username)}</b><span>${K.tierBadge(tier)}<em>${acc.rating || 0} 分 · ${acc.games || 0} 局 ${acc.wins || 0} 胜</em></span></div></div>
      <div class="bal">${K.coin(acc.coins, 'lg')}</div>
      <div class="acts">
        <button class="btn gold" id="ck" ${checked ? 'disabled' : ''}>${glyph('gift', 16)}<span>${checked ? '<span class="hide-sm">今日</span>已签到' : '<span class="hide-sm">每日</span>签到 +50'}</span></button>
        <button class="btn purple" id="lb">${glyph('trophy', 16)}排行榜</button>
      </div>
    </div>
    <div class="tabsrow">
      ${K.segHtml('atab', '', [{ value: 'shop', label: '商城' }, { value: 'train', label: '角色养成' }], acctTab, 'tabs')}
      ${acctTab === 'shop' && cats.length ? K.segHtml('scat', '', cats.map((c) => ({ value: c.id, label: c.name })), shopCat, 'chipseg') : ''}
      ${acctTab === 'train' ? `<div class="hint xs">训练：${K.coin(tr.cost, 'mini')} → ${tr.exp} 经验 · 每 ${tr.expPerLevel} 经验升 1 级（上限 Lv.${tr.maxLevel}）</div>` : '<div class="hint xs">金币购买外观与角色；对局道具卡仅在对局内出现</div>'}
    </div>
    <div class="pbody scroll">${acctTab === 'shop' ? shopGrid : trainGrid}</div>
    ${noteHtml(note, ok)}
  </div>`;
  const act = (fn: () => Promise<string>) => async () => { try { const msg = await fn(); void showAccount(msg, true); } catch (e) { void showAccount((e as Error).message); } };
  const poor = (b: HTMLElement, need: string) => { if (b.dataset.poor) { const n = o.querySelector('.note'); if (n) { n.className = 'note warn'; n.textContent = `金币不足：${need}`; } return true; } return false; };
  K.bindSeg(o, 'atab', (v) => { acctTab = v as 'shop' | 'train'; renderAccount(o, acc, info, '', false); });
  K.bindSeg(o, 'scat', (v) => { shopCat = v; renderAccount(o, acc, info, '', false); });
  o.querySelector<HTMLButtonElement>('#ck')!.onclick = act(async () => `签到成功，+${(await A.checkin(prefs.server)).bonus} 金币`);
  o.querySelectorAll<HTMLButtonElement>('[data-tr]').forEach((b) => (b.onclick = () => { if (poor(b, `训练需要 ${tr.cost} 金币`)) return; void act(async () => { await A.train(prefs.server, b.dataset.tr!); return `${CHARACTERS[b.dataset.tr as CharId].name} 训练完成，+${tr.exp} 经验`; })(); }));
  o.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => (b.onclick = () => { const it = all.find((x) => x.id === b.dataset.buy); if (poor(b, `「${it?.name}」需要 ${it?.price} 金币`)) return; void act(async () => { await A.buy(prefs.server, b.dataset.buy!); return `已购买 ${names(b.dataset.buy!)}`; })(); }));
  o.querySelectorAll<HTMLButtonElement>('[data-eq]').forEach((b) => (b.onclick = act(async () => { const on = b.dataset.on === '1'; await A.equip(prefs.server, b.dataset.eq!, on); return `${on ? '已装备' : '已卸下'} ${names(b.dataset.eq!)}`; })));
  o.querySelector<HTMLButtonElement>('#lb')!.onclick = () => void showBoard('rating');
  o.querySelector<HTMLButtonElement>('#lo')!.onclick = async () => { await A.logout(prefs.server); meName = ''; void showAccount('已退出登录', true); };
  o.querySelector<HTMLButtonElement>('#back')!.onclick = () => showMenu();
}

/** 全服排行榜（只展示账号名与公开数据；段位分只来自联机对局，单机/匿名不计） */
async function showBoard(by: A.BoardBy) {
  const o = overlay('lobby', 'board');
  if (o.dataset.fresh) { o.innerHTML = loadingPage('全服排行榜'); o.querySelector<HTMLButtonElement>('#back')!.onclick = () => void showAccount(); }
  let body = '', season = '';
  try {
    const r = await A.leaderboard(prefs.server, by);
    const day = (t: number) => new Date(t * 1000).toLocaleDateString('zh-CN');
    season = `<span class="spill">第 ${r.season.id} 赛季 · ${day(r.season.start)} ~ ${day(r.season.end)}</span>`;
    const val = (e: A.RankEntry) => (by === 'rating' ? `${e.rating}<small>分</small>` : by === 'wins' ? `${e.wins}<small>胜</small>` : `${e.assets}<small>金币</small>`);
    body = r.list.length ? `<div class="lb">${r.list.map((e) => `<div class="lrow r${e.rank <= 3 ? e.rank : ''}${e.username === meName ? ' me' : ''}">
        <span class="rk">${e.rank}</span><span class="lnw"><span class="ln">${esc(e.username)}</span>${K.tierBadge(e.tier)}${e.username === meName ? '<span class="youb">你</span>' : ''}</span>
        <span class="lm">${e.games} 局 · 胜 ${e.wins}</span><span class="lv2">${val(e)}</span></div>`).join('')}</div>`
      : `<div class="empty">${K.img(charPng('wang'), '', '')}<b>榜单虚位以待</b><span>登录后打完一局联机对局就会上榜</span></div>`;
  } catch (e) { body = noteHtml((e as Error).message); }
  if (!o.isConnected) return;
  o.innerHTML = `<div class="page board">
    ${K.pageHead('全服排行榜', season)}
    <div class="tabsrow">${K.segHtml('lbtab', '', [{ value: 'rating', label: '段位分' }, { value: 'wins', label: '赛季胜场' }, { value: 'assets', label: '总资产' }], by, 'tabs')}
      <div class="hint xs">赛季结束时段位分按 50% 保留，赛季胜场清零</div></div>
    <div class="pbody scroll">${body}</div></div>`;
  K.bindSeg(o, 'lbtab', (v) => void showBoard(v as A.BoardBy));
  o.querySelector<HTMLButtonElement>('#back')!.onclick = () => void showAccount();
}

// ───────────────────────── 档案与历史 ─────────────────────────
function download(rec: GameRecord) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `dice-tycoon-replay-${rec.seed}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function showProfile(note = '') {
  const o = overlay('lobby');
  const hist = loadHistory();
  const st = computeStats(hist);
  const qs = loadQuests();
  const d = (t: number) => new Date(t).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const daily = dailyView(qs), ach = achievementView(qs);
  o.innerHTML = `<div class="page prof">
    ${K.pageHead('档案与历史', '<span class="spill">仅保存在本浏览器</span>')}
    <div class="pbody scroll">
      <div class="pgrid2">
        <section class="card who2">
          <div class="avatar lg" style="--c:${CHARACTERS[profile.charId].color}">${K.img(charPng(profile.charId), '', '')}</div>
          <div><b class="nm2">${esc(profile.name)}</b><div class="hint xs">${esc(CHARACTERS[profile.charId].name)} · 建档于 ${new Date(profile.createdAt).toLocaleDateString('zh-CN')}</div></div>
          <div class="stats"><div><b>${st.games}</b><span>总局数</span></div><div><b>${st.wins}</b><span>胜场</span></div><div><b>${(st.winRate * 100).toFixed(0)}%</b><span>胜率</span></div></div>
        </section>
        <section class="card">
          <h3>今日任务 <small>按本地日期重置</small></h3>
          ${daily.map((q) => `<div class="quest ${q.done ? 'done' : ''}"><span class="qc">${q.done ? glyph('check', 14) : ''}</span><span class="qt">${esc(q.title)}</span><div class="xp sm"><i style="width:${Math.round((q.progress / q.target) * 100)}%"></i></div><span class="qn">${q.progress}/${q.target}</span>${q.done ? `<span class="badge">${esc(q.badge)}</span>` : ''}</div>`).join('') || '<div class="hint">今天暂无任务</div>'}
        </section>
      </div>
      <section class="card">
        <h3>成就 <small>已点亮 ${ach.filter((a) => a.unlocked).length}/${ach.length}</small></h3>
        <div class="achs">${ach.map((a) => `<div class="ach ${a.unlocked ? 'on' : ''}" title="${esc(a.desc)}"><span class="am">${a.unlocked ? glyph('trophy', 20) : glyph('lock', 18)}</span><b>${esc(a.title)}</b><small>${a.unlocked ? esc(a.badge) : `${a.progress}/${a.target}`}</small></div>`).join('')}</div>
      </section>
      <section class="card">
        <h3>对局历史 <small>最近 ${hist.length} 局</small></h3>
        <div class="hist" id="hist">${hist.length ? hist.map((h) => `<div class="hrow ${h.won ? 'won' : ''}">
          <span class="hr">${h.rank ? `第 ${h.rank} 名` : '—'}</span>
          <span class="hm"><b>${h.kind === 'online' ? '联机' : '单机'} · ${h.rounds} 回合${h.winner ? ` · ${esc(h.winner)} 获胜` : ''}</b><small>${d(h.at)}</small></span>
          <span class="hb"><button class="btn blue xs" data-p="${h.id}">${glyph('play', 12)}回放</button><button class="btn ghost xs" data-e="${h.id}">${glyph('download', 12)}导出</button><button class="btn red xs" data-d="${h.id}">${glyph('trash', 12)}删除</button></span>
        </div>`).join('') : `<div class="empty sm">${K.img(charPng('li'), '', '')}<b>暂无对局记录</b><span>打完一局就会出现在这里</span></div>`}</div>
      </section>
    </div>
    ${noteHtml(note)}
  </div>`;
  o.querySelector<HTMLButtonElement>('#back')!.onclick = () => showMenu();
  const need = (id: string) => {
    const rec = loadReplay(id);
    if (!rec) showProfile('这条记录的回放数据已丢失或损坏');
    return rec;
  };
  o.querySelectorAll<HTMLButtonElement>('button[data-p]').forEach((b) => (b.onclick = () => { const r = need(b.dataset.p!); if (r) startReplay(r); }));
  o.querySelectorAll<HTMLButtonElement>('button[data-e]').forEach((b) => (b.onclick = () => { const r = need(b.dataset.e!); if (r) download(r); }));
  o.querySelectorAll<HTMLButtonElement>('button[data-d]').forEach((b) => (b.onclick = () => {
    if (b.dataset.sure) { deleteHistory(b.dataset.d!); showProfile(); return; }
    b.dataset.sure = '1'; b.innerHTML = '确认删除？'; b.classList.add('pulse');
    setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.innerHTML = `${glyph('trash', 12)}删除`; b.classList.remove('pulse'); } }, 3000);
  }));
}

// ───────────────────────── 单机 ─────────────────────────
function startSolo() {
  if (PAID_CHAR_IDS.includes(prefs.charId)) { showMenu('单机模式仅限 6 名免费角色，付费角色只能用于登录后的联机对战'); return; }
  closeOverlay();
  const others = FREE_CHAR_IDS.filter((c) => c !== prefs.charId);
  const seats: SeatConfig[] = [
    { id: 'me', name: prefs.name, charId: prefs.charId, accountId },
    { id: 'bot1', name: '阿柚', charId: others[0], isBot: true, difficulty: prefs.difficulty },
    { id: 'bot2', name: '老周', charId: others[1], isBot: true, difficulty: prefs.difficulty },
    { id: 'bot3', name: '阿星', charId: others[2], isBot: true, difficulty: prefs.difficulty },
  ];
  void startGame(new LocalSource(seats, loadBoard()), 'solo');
}

// ───────────────────────── 在线 ─────────────────────────
const seatCard = (s: LobbyMsg['seats'][number] | undefined, tag: string, emptyTitle: string, emptySub: string, mine = false) => s
  ? `<div class="seat" style="--c:${CHARACTERS[s.charId].color}"><span class="sbg"></span>${K.img(charUrl(s.charId, mine), '', '')}<b>${esc(s.name)}</b><small class="stag">${esc(tag)}</small></div>`
  : `<div class="seat empty"><span class="ring"></span><b>${esc(emptyTitle)}</b><small>${esc(emptySub)}</small></div>`;
const connectingPage = (title: string, sub: string, cancelId = 'back', cancelLabel = '返回') =>
  `<div class="page narrow">${K.pageHead(title, '', cancelId, cancelLabel)}<div class="pbody center"><div class="spin"></div><div class="hint">${esc(sub)}</div></div></div>`;

async function startOnline(roomId?: string) {
  const o = overlay('lobby');
  let aborted = false;
  o.innerHTML = connectingPage(roomId ? `加入房间 ${roomId}` : '创建房间', '正在连接对战服…');
  o.querySelector<HTMLButtonElement>('#back')!.onclick = () => { aborted = true; showMenu(); };
  let net: NetSource;
  try {
    net = await NetSource.connect(prefs.server, { name: prefs.name, charId: prefs.charId, ...(await authOpts()), ...(roomId ? {} : { board: loadBoard() }) }, roomId);
  } catch (err) {
    if (!aborted) showMenu(`连接失败：${(err as Error).message || err}（请确认对战服已启动）`);
    return;
  }
  if (aborted) { net.dispose(); return; }
  net.onError((e) => { const el = o.querySelector('.note'); if (el) { el.className = 'note warn'; el.textContent = e.message; } });
  let started = false;
  net.onLobby((m: LobbyMsg) => {
    if (started) return;
    if (m.started) {
      started = true;
      closeOverlay();
      void startGame(net, 'online');
      return;
    }
    const isHost = m.hostSessionId === net.sessionId;
    const board = m.board ?? 'classic';
    o.innerHTML = `<div class="page room">
      ${K.pageHead('好友房间', '', 'back', '离开房间')}
      <div class="pbody">
        <div class="ridbox"><span class="hint xs">房间号</span><b class="rid">${esc(m.roomId)}</b><button class="btn ghost xs" id="cp">${glyph('copy', 13)}复制</button></div>
        <div class="hint">把房间号发给好友，在主菜单「房间」里输入即可加入 · 空位开局后由机器人补齐</div>
        <div class="seats">${[0, 1, 2, 3].map((i) => { const s = m.seats[i]; return seatCard(s, s?.isBot ? '机器人' : s?.sessionId === m.hostSessionId ? '房主' : s?.sessionId === net.sessionId ? '你' : '已加入', '空位', '开局后机器人补齐', s?.sessionId === net.sessionId); }).join('')}</div>
        <div class="rfoot">
          ${isHost ? K.segHtml('bsel', '棋盘', BOARD_IDS.map((b) => ({ value: b, label: BOARD_CFGS[b].name })), board) : `<div class="field"><span class="flabel">棋盘</span><span class="spill">${esc(BOARD_CFGS[board].name)}</span></div>`}
          ${isHost ? '<button class="big gold" id="go">开始对局<small>当前 ' + m.seats.length + ' 人 · 其余机器人补位</small></button>' : '<div class="waiting"><div class="spin sm"></div>等待房主开始…</div>'}
        </div>
      </div>
      ${noteHtml('')}
    </div>`;
    K.bindSeg(o, 'bsel', (v) => net.setBoard(v as BoardId));
    o.querySelector<HTMLButtonElement>('#go')?.addEventListener('click', () => net.start());
    o.querySelector<HTMLButtonElement>('#cp')!.onclick = () => {
      void navigator.clipboard?.writeText(m.roomId).then(() => { const b = o.querySelector('#cp'); if (b) b.innerHTML = `${glyph('check', 13)}已复制`; }).catch(() => {});
    };
    o.querySelector<HTMLButtonElement>('#back')!.onclick = () => { net.dispose(); showMenu(); };
  });
}

// ───────────────────────── 快速匹配 ─────────────────────────
async function startQuick() {
  const o = overlay('lobby');
  let aborted = false;
  o.innerHTML = connectingPage('快速匹配', '正在寻找对局…', 'cancel', '取消匹配');
  o.querySelector<HTMLButtonElement>('#cancel')!.onclick = () => { aborted = true; showMenu(); };
  let net: NetSource;
  try {
    net = await NetSource.connectQuick(prefs.server, { name: prefs.name, charId: prefs.charId, ...(await authOpts()) });
  } catch (err) {
    if (!aborted) showMenu(`匹配失败：${(err as Error).message || err}（请确认对战服已启动）`);
    return;
  }
  if (aborted) { net.dispose(); return; }
  let started = false, total = 0;
  const cancel = () => { started = true; net.dispose(); showMenu(); };
  net.onError((e) => { const el = o.querySelector('.note'); if (el) { el.className = 'note warn'; el.textContent = e.message; } });
  net.onLobby((m: LobbyMsg) => {
    if (started) return;
    if (m.started) { started = true; closeOverlay(); void startGame(net, 'online'); return; }
    const q = m.quick;
    if (q) total = Math.max(total, q.remainingMs);
    const left = q ? Math.ceil(q.remainingMs / 1000) : 0;
    o.innerHTML = `<div class="page room quick">
      ${K.pageHead('快速匹配', '', 'cancel', '取消匹配')}
      <div class="pbody">
        <div class="qhead"><div class="spin sm"></div><b>匹配中</b><span class="qcount">${m.seats.length}<small>/${q?.size ?? 4}</small></span></div>
        <div class="qbar"><i style="width:${total ? Math.round((1 - (q?.remainingMs ?? 0) / total) * 100) : 0}%"></i></div>
        <div class="hint">凑满 4 人立即开局；${left > 0 ? `<b>${left}</b> 秒后` : '即将'}由机器人补位开局</div>
        <div class="seats">${[0, 1, 2, 3].map((i) => { const s = m.seats[i]; return seatCard(s, s?.sessionId === net.sessionId ? '你' : '已匹配', '等待中…', '可由机器人补位', s?.sessionId === net.sessionId); }).join('')}</div>
      </div>
      ${noteHtml('')}
    </div>`;
    o.querySelector<HTMLButtonElement>('#cancel')!.onclick = cancel;
  });
}

// ───────────────────────── 观战 ─────────────────────────
const httpBase = () => prefs.server.replace(/^ws/, 'http').replace(/\/+$/, '');

function showRooms() {
  const o = overlay('lobby');
  o.innerHTML = `<div class="page rooms-pg">
    ${K.pageHead('观战列表', `<button class="btn blue sm" id="refresh">${glyph('refresh', 15)}刷新</button>`)}
    <div class="hint pad">进行中的房间可以观战：只看不操作，不占座位</div>
    <div class="pbody scroll"><div class="rooms" id="rooms"></div></div>
    ${noteHtml('')}</div>`;
  const box = o.querySelector<HTMLElement>('#rooms')!;
  const load = async () => {
    box.innerHTML = '<div class="empty"><div class="spin"></div><span>加载中…</span></div>';
    try {
      const r = await fetch(`${httpBase()}/api/rooms`);
      const { rooms } = (await r.json()) as { rooms: RoomBrief[] };
      if (!rooms.length) { box.innerHTML = `<div class="empty">${K.img(charPng('xing'), '', '')}<b>暂时没有进行中的房间</b><span>稍后点「刷新」再看看，或者自己开一局</span></div>`; return; }
      box.innerHTML = rooms.map((x) => `<div class="rm ${x.spectatable ? '' : 'off'}">
        <div class="rmid"><small>房间</small><b>${esc(x.roomId)}</b></div>
        <div class="rmi"><b>${x.players.map(esc).join('、') || '机器人局'}${x.bots ? `<em> + ${x.bots} 机器人</em>` : ''}</b>
          <small><span class="st ${x.started ? 'live' : ''}">${x.started ? `第 ${x.round ?? 1} 回合` : '等待开局'}</span>${x.board ? ` · ${esc(BOARD_CFGS[x.board]?.name ?? '')}` : ''} · 观战 ${x.spectators}/${x.maxSpectators}</small></div>
        <button class="btn purple sm" data-r="${esc(x.roomId)}" ${x.spectatable ? '' : 'disabled'}>${glyph('eye', 14)}${x.spectatable ? '观战' : x.started ? '已满' : '未开局'}</button></div>`).join('');
      box.querySelectorAll<HTMLButtonElement>('button[data-r]').forEach((b) => (b.onclick = () => void startSpectate(b.dataset.r!)));
    } catch (err) {
      box.innerHTML = `<div class="empty">${K.img(charPng('rock'), '', '')}<b>获取失败</b><span>${esc((err as Error).message || String(err))}（请确认对战服已启动）</span></div>`;
    }
  };
  o.querySelector<HTMLButtonElement>('#refresh')!.onclick = () => void load();
  o.querySelector<HTMLButtonElement>('#back')!.onclick = () => showMenu();
  void load();
}

async function startSpectate(roomId: string) {
  try {
    const net = await NetSource.spectate(prefs.server, { name: prefs.name, charId: prefs.charId, accountId, ...(roomId ? {} : { board: loadBoard() }) }, roomId);
    closeOverlay();
    void startGame(net);
  } catch (err) {
    const el = document.querySelector('#overlay .note');
    if (el) { el.className = 'note warn'; el.textContent = `无法观战：${(err as Error).message || err}`; }
  }
}

// ───────────────────────── 回放 ─────────────────────────
/** 播放一份回放：fromMenu 为 true 时，文件无效要回到菜单提示；否则（对局结束后点「回放本局」）直接切换 */
function startReplay(rec: GameRecord, fromMenu = false) {
  let src: ReplaySource;
  try {
    src = new ReplaySource(rec);
  } catch (err) {
    if (fromMenu) throw err;
    showMenu(`回放无法播放：${(err as Error).message || err}`);
    return;
  }
  teardownGame();
  closeOverlay();
  void startGame(src);
}

// ───────────────────────── 对局 ─────────────────────────
async function startGame(src: GameSource, kind?: 'solo' | 'online') {
  source = src;
  await worldReady;
  document.body.classList.add('ingame');
  const hud = new Hud(stage);
  if (src instanceof NetSource) watchNet(src, () => showMenu('与对战服的连接已断开'));
  let unmountBar: (() => void) | null = null;
  const exit = () => { unmountBar?.(); showMenu(); };
  if (src instanceof ReplaySource) unmountBar = mountReplayBar(document.getElementById('hud')!, src, exit);
  if (src instanceof NetSource && src.kind === 'spectate') {
    const hudEl = document.getElementById('hud')!;
    hudEl.insertAdjacentHTML('beforeend', '<div id="spec-tag">观战中 · 0 人观战</div><button id="spec-exit">退出观战</button>');
    hudEl.querySelector<HTMLButtonElement>('#spec-exit')!.onclick = exit;
    src.onSpectators((m) => { const t = document.getElementById('spec-tag'); if (t) t.textContent = `观战中 · ${m.count}/${m.max} 人观战`; });
  }
  new Director(world!, hud, src, exit, (rec) => startReplay(rec),
    kind ? (rec) => {
      try {
        const e = entryFromRecord(rec, accountId, kind, Date.now());
        if (e) pushHistory(e, rec);
        const dg = e && digestRecord(rec, accountId, e.id, kind === 'online');
        if (dg) {
          const r = applyDigest(loadQuests(), dg, Date.now());
          saveQuests(r.state);
          const lines = [...r.newDaily.map((q) => `✅ 每日任务完成：${q.title}　🎖 ${q.badge}`), ...r.newAchievements.map((a) => `🏅 解锁成就：${a.badge} ${a.title}`)];
          if (lines.length) {
            const rb = document.querySelector('#result .panel .rb');
            rb?.insertAdjacentHTML('beforebegin', `<div class="sub" style="margin:8px 0">${lines.map(esc).join('<br>')}</div>`);
          }
        }
      } catch (err) { console.warn('[history]', err); }
    } : undefined);
  AU.startBGM();
}

/** 结束当前对局：断开数据源、移除 HUD、重建一个干净的世界层 */
function teardownGame() {
  document.body.classList.remove('ingame');
  document.getElementById('netban')?.remove();
  if (!source) return;
  source.dispose(); source = null;
  document.getElementById('hud')?.remove();
  world?.app.destroy(true, { children: true });
  void newWorld();
}

/** 菜单 / 账号 / 大厅等全屏页：挂在 body 上（不随 1280×720 舞台缩放），按真实视口自适应，竖屏手机也能用 */
function overlay(cls: string, key = '') {
  const cur = document.getElementById('overlay');
  // 同一页面内刷新（账号操作后、榜单切换）复用容器：不闪加载页、不重播入场动画
  if (key && cur && cur.dataset.key === key) { cur.dataset.fresh = ''; return cur; }
  closeOverlay();
  const o = document.createElement('div');
  o.id = 'overlay'; o.className = cls; o.dataset.key = key; o.dataset.fresh = '1';
  document.body.appendChild(o);
  setTimeout(() => o.classList.add('settled'), 450);
  return o;
}

/** 对局内网络状态：掉线自动重连中显示横幅；彻底断开给出返回菜单 */
function watchNet(net: NetSource, onLost: () => void) {
  const show = (html: string, cls: string) => {
    let b = document.getElementById('netban');
    if (!b) { b = document.createElement('div'); b.id = 'netban'; document.getElementById('hud')?.appendChild(b); }
    b.className = cls; b.innerHTML = html;
    return b;
  };
  net.onConnection({
    drop: () => show(`<div class="nb"><div class="spin sm"></div><b>网络中断，正在重连…</b><small>30 秒内恢复可继续对局，期间由机器人托管</small></div>`, 'show'),
    reconnect: () => { const b = show(`<div class="nb ok">${glyph('wifi', 18)}<b>已重新连接</b></div>`, 'show ok'); setTimeout(() => b.classList.remove('show'), 1600); },
    leave: () => {
      if (document.querySelector('#result.show')) return; // 终局后服务端约 60 秒关房，属正常离开
      const b = show(`<div class="nb lost">${glyph('wifi', 20)}<b>与对战服的连接已断开</b><small>对局仍在服务器进行，可稍后在观战列表查看</small><button class="btn gold sm" id="netback">返回主菜单</button></div>`, 'show lost');
      b.querySelector<HTMLButtonElement>('#netback')!.onclick = onLost;
    },
  });
}
function closeOverlay() { document.getElementById('overlay')?.remove(); }

void boot();
