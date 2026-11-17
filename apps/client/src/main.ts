import './style.css';
import { CHARACTERS, CHAR_IDS, computeStats, entryFromRecord, type BotDifficulty, type CharId, type GameRecord, type RoomBrief, type SeatConfig } from '@dt/shared';
import { deleteHistory, loadHistory, loadProfile, loadReplay, pushHistory, saveProfile } from './core/store';
import { AU } from './audio/audio';
import { Director, charUrl } from './game/Director';
import { NetSource, LocalSource, ReplaySource, type GameSource, type LobbyMsg } from './net/source';
import { mountReplayBar } from './ui/ReplayBar';
import { Hud } from './ui/Hud';
import { World } from './view/World';

const stage = document.getElementById('stage')!;
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

let world: World | null = null;
let worldReady: Promise<void> = Promise.resolve();
let source: GameSource | null = null;

function newWorld() {
  world = new World();
  worldReady = world.init(stage);
  return worldReady;
}

async function boot() {
  await Promise.all([newWorld(), document.fonts.ready]);
  showMenu();
}

// ───────────────────────── 主菜单 ─────────────────────────
function showMenu(msg = '') {
  teardownGame();
  const m = overlay('menu');
  m.innerHTML = `
    <div class="logo st3">掷富天下</div>
    <div class="tag">网页大富翁 · v0.4 开发版</div>
    <div class="form">
      <label>昵称 <input id="nm" maxlength="12" value="${prefs.name}"></label>
      <div class="chars">${CHAR_IDS.map((c) => `
        <button class="ch ${c === prefs.charId ? 'on' : ''}" data-c="${c}" style="--c:${CHARACTERS[c].color}">
          <img src="${charUrl(c)}" alt=""><b>${CHARACTERS[c].name}</b><small>${CHARACTERS[c].skill}</small>
        </button>`).join('')}</div>
      <label>单机机器人难度 <select id="diff">${(['easy', 'normal', 'hard'] as const).map((d) => `<option value="${d}" ${d === prefs.difficulty ? 'selected' : ''}>${{ easy: '简单', normal: '普通', hard: '困难' }[d]}</option>`).join('')}</select></label>
      <div class="btns">
        <button class="big gold" id="solo">单机对战<small>你 vs 3 个机器人</small></button>
        <button class="big blue" id="create">创建房间<small>好友联机，空位机器人补齐</small></button>
        <button class="big green" id="quick">快速匹配<small>凑满 4 人开局，超时机器人补位</small></button>
      </div>
      <div class="join"><input id="rid" placeholder="输入房间号加入"><button id="joinb">加入</button></div>
      <div class="subbtns"><button id="watch">观战列表</button><button id="prof">档案与历史</button><label class="fbtn">导入回放 JSON<input id="rfile" type="file" accept=".json,application/json" hidden></label></div>
      <details><summary>服务器</summary><input id="srv" value="${prefs.server}"></details>
      <div class="msg">${msg}</div>
    </div>`;
  m.querySelectorAll<HTMLButtonElement>('.ch').forEach((b) => (b.onclick = () => {
    prefs.charId = b.dataset.c as CharId;
    m.querySelectorAll('.ch').forEach((x) => x.classList.toggle('on', x === b));
    AU.unlock(); AU.play('click');
  }));
  const save = () => {
    prefs.name = (m.querySelector<HTMLInputElement>('#nm')!.value.trim() || prefs.name).slice(0, 12);
    prefs.server = m.querySelector<HTMLInputElement>('#srv')!.value.trim() || DEFAULT_SERVER;
    prefs.difficulty = m.querySelector<HTMLSelectElement>('#diff')!.value as BotDifficulty;
    try { localStorage.setItem('dt.diff', prefs.difficulty); } catch { /* ignore */ }
    profile.name = prefs.name; profile.charId = prefs.charId; saveProfile(profile); try { localStorage.setItem('dt.server', prefs.server); } catch { /* ignore */ }
    AU.unlock();
  };
  m.querySelector<HTMLButtonElement>('#solo')!.onclick = () => { save(); startSolo(); };
  m.querySelector<HTMLButtonElement>('#create')!.onclick = () => { save(); void startOnline(); };
  m.querySelector<HTMLButtonElement>('#quick')!.onclick = () => { save(); void startQuick(); };
  m.querySelector<HTMLButtonElement>('#watch')!.onclick = () => { save(); showRooms(); };
  m.querySelector<HTMLButtonElement>('#prof')!.onclick = () => { save(); showProfile(); };
  m.querySelector<HTMLInputElement>('#rfile')!.onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      startReplay(JSON.parse(await f.text()) as GameRecord, true);
    } catch (err) {
      showMenu(`回放文件无法播放：${(err as Error).message || err}`);
    }
  };
  m.querySelector<HTMLButtonElement>('#joinb')!.onclick = () => {
    save();
    const id = m.querySelector<HTMLInputElement>('#rid')!.value.trim();
    if (id) void startOnline(id);
  };
}

// ───────────────────────── 档案与历史 ─────────────────────────
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
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
  const d = (t: number) => new Date(t).toLocaleString('zh-CN', { hour12: false });
  o.innerHTML = `<div class="panel"><div class="ttl">档案与历史</div>
    <div class="hint"><b>${esc(profile.name)}</b> · ${CHARACTERS[profile.charId].name} · 建档于 ${d(profile.createdAt)}<br>
    总局数 <b>${st.games}</b> · 胜场 <b>${st.wins}</b> · 胜率 <b>${(st.winRate * 100).toFixed(0)}%</b>　（仅保存在本浏览器）</div>
    <div class="rooms" id="hist">${hist.length ? hist.map((h) => `<div class="rm"><span>${d(h.at)} · ${h.kind === 'online' ? '联机' : '单机'} · ${h.rank ? `第 ${h.rank} 名` : '—'}${h.won ? ' 🏆' : ''} · ${h.winner ? esc(h.winner) + ' 获胜' : ''} · ${h.rounds} 回合</span><button data-p="${h.id}">回放</button><button data-e="${h.id}">导出</button><button data-d="${h.id}">删除</button></div>`).join('') : '暂无对局记录，打完一局就会出现在这里'}</div>
    <button class="link" id="back">返回</button><div class="err">${esc(note)}</div></div>`;
  o.querySelector<HTMLButtonElement>('#back')!.onclick = () => showMenu();
  const need = (id: string) => {
    const rec = loadReplay(id);
    if (!rec) showProfile('这条记录的回放数据已丢失或损坏');
    return rec;
  };
  o.querySelectorAll<HTMLButtonElement>('button[data-p]').forEach((b) => (b.onclick = () => { const r = need(b.dataset.p!); if (r) startReplay(r); }));
  o.querySelectorAll<HTMLButtonElement>('button[data-e]').forEach((b) => (b.onclick = () => { const r = need(b.dataset.e!); if (r) download(r); }));
  o.querySelectorAll<HTMLButtonElement>('button[data-d]').forEach((b) => (b.onclick = () => { deleteHistory(b.dataset.d!); showProfile(); }));
}

// ───────────────────────── 单机 ─────────────────────────
function startSolo() {
  closeOverlay();
  const others = CHAR_IDS.filter((c) => c !== prefs.charId);
  const seats: SeatConfig[] = [
    { id: 'me', name: prefs.name, charId: prefs.charId, accountId },
    { id: 'bot1', name: '阿柚', charId: others[0], isBot: true, difficulty: prefs.difficulty },
    { id: 'bot2', name: '老周', charId: others[1], isBot: true, difficulty: prefs.difficulty },
    { id: 'bot3', name: '阿星', charId: others[2], isBot: true, difficulty: prefs.difficulty },
  ];
  void startGame(new LocalSource(seats), 'solo');
}

// ───────────────────────── 在线 ─────────────────────────
async function startOnline(roomId?: string) {
  const o = overlay('lobby');
  o.innerHTML = '<div class="panel"><div class="ttl">连接中…</div></div>';
  let net: NetSource;
  try {
    net = await NetSource.connect(prefs.server, { name: prefs.name, charId: prefs.charId, accountId }, roomId);
  } catch (err) {
    showMenu(`连接失败：${(err as Error).message || err}（请确认对战服已启动）`);
    return;
  }
  net.onError((e) => { const el = o.querySelector('.err'); if (el) el.textContent = e.message; });
  let started = false;
  net.onLobby((m: LobbyMsg) => {
    if (started) return;
    const isHost = m.hostSessionId === net.sessionId;
    o.innerHTML = `<div class="panel">
      <div class="ttl">房间 <b class="rid">${m.roomId}</b></div>
      <div class="hint">把房间号发给好友，在主菜单输入即可加入</div>
      <div class="seats">${[0, 1, 2, 3].map((i) => {
        const s = m.seats[i];
        return s ? `<div class="seat" style="--c:${CHARACTERS[s.charId].color}"><img src="${charUrl(s.charId)}" alt=""><b>${s.name}</b><small>${s.isBot ? '机器人' : s.sessionId === m.hostSessionId ? '房主' : '已加入'}</small></div>`
          : '<div class="seat empty"><b>空位</b><small>开局后由机器人补齐</small></div>';
      }).join('')}</div>
      ${isHost ? '<button class="big gold" id="go">开始对局</button>' : '<div class="hint">等待房主开始…</div>'}
      <button class="link" id="back">离开房间</button><div class="err"></div></div>`;
    o.querySelector<HTMLButtonElement>('#go')?.addEventListener('click', () => net.start());
    o.querySelector<HTMLButtonElement>('#back')!.onclick = () => { net.dispose(); showMenu(); };
    if (m.started) {
      started = true;
      closeOverlay();
      void startGame(net, 'online');
    }
  });
}

// ───────────────────────── 快速匹配 ─────────────────────────
async function startQuick() {
  const o = overlay('lobby');
  o.innerHTML = '<div class="panel"><div class="ttl">正在寻找对局…</div></div>';
  let net: NetSource;
  try {
    net = await NetSource.connectQuick(prefs.server, { name: prefs.name, charId: prefs.charId, accountId });
  } catch (err) {
    showMenu(`匹配失败：${(err as Error).message || err}（请确认对战服已启动）`);
    return;
  }
  let started = false, total = 0;
  const cancel = () => { started = true; net.dispose(); showMenu(); };
  net.onError((e) => { const el = o.querySelector('.err'); if (el) el.textContent = e.message; });
  net.onLobby((m: LobbyMsg) => {
    if (started) return;
    if (m.started) { started = true; closeOverlay(); void startGame(net, 'online'); return; }
    const q = m.quick;
    if (q) total = Math.max(total, q.remainingMs);
    const left = q ? Math.ceil(q.remainingMs / 1000) : 0;
    o.innerHTML = `<div class="panel">
      <div class="ttl">匹配中 <b class="rid">${m.seats.length}/${q?.size ?? 4}</b></div>
      <div class="hint">凑满 4 人立即开局；${left > 0 ? `<b>${left}</b> 秒后` : '即将'}由机器人补位开局</div>
      <div class="qbar"><i style="width:${total ? Math.round((1 - (q?.remainingMs ?? 0) / total) * 100) : 0}%"></i></div>
      <div class="seats">${[0, 1, 2, 3].map((i) => {
        const s = m.seats[i];
        return s ? `<div class="seat" style="--c:${CHARACTERS[s.charId].color}"><img src="${charUrl(s.charId)}" alt=""><b>${s.name}</b><small>${s.sessionId === net.sessionId ? '你' : '已匹配'}</small></div>`
          : '<div class="seat empty"><b>等待中…</b><small>可由机器人补位</small></div>';
      }).join('')}</div>
      <button class="link" id="cancel">取消匹配</button><div class="err"></div></div>`;
    o.querySelector<HTMLButtonElement>('#cancel')!.onclick = cancel;
  });
}

// ───────────────────────── 观战 ─────────────────────────
const httpBase = () => prefs.server.replace(/^ws/, 'http').replace(/\/+$/, '');

function showRooms() {
  const o = overlay('lobby');
  o.innerHTML = `<div class="panel"><div class="ttl">观战列表</div>
    <div class="hint">进行中的房间可以观战：只看不操作，不占座位</div>
    <div class="rooms" id="rooms">加载中…</div>
    <div class="subbtns"><button id="refresh">刷新</button></div>
    <button class="link" id="back">返回</button><div class="err"></div></div>`;
  const box = o.querySelector<HTMLElement>('#rooms')!;
  const load = async () => {
    box.textContent = '加载中…';
    try {
      const r = await fetch(`${httpBase()}/api/rooms`);
      const { rooms } = (await r.json()) as { rooms: RoomBrief[] };
      if (!rooms.length) { box.textContent = '暂时没有房间'; return; }
      box.innerHTML = rooms.map((x) => `<div class="rm"><span>房间 <b>${x.roomId}</b> · ${x.started ? `第 ${x.round ?? 1} 回合` : '等待开局'} · ${x.players.join('、') || '机器人局'}${x.bots ? ` + ${x.bots} 机器人` : ''}</span><span>观战 ${x.spectators}/${x.maxSpectators}</span><button data-r="${x.roomId}" ${x.spectatable ? '' : 'disabled'}>${x.spectatable ? '观战' : x.started ? '已满' : '未开局'}</button></div>`).join('');
      box.querySelectorAll<HTMLButtonElement>('button[data-r]').forEach((b) => (b.onclick = () => void startSpectate(b.dataset.r!)));
    } catch (err) {
      box.textContent = `获取失败：${(err as Error).message || err}（请确认对战服已启动）`;
    }
  };
  o.querySelector<HTMLButtonElement>('#refresh')!.onclick = () => void load();
  o.querySelector<HTMLButtonElement>('#back')!.onclick = () => showMenu();
  void load();
}

async function startSpectate(roomId: string) {
  try {
    const net = await NetSource.spectate(prefs.server, { name: prefs.name, charId: prefs.charId, accountId }, roomId);
    closeOverlay();
    void startGame(net);
  } catch (err) {
    const el = document.querySelector('#overlay .err');
    if (el) el.textContent = `无法观战：${(err as Error).message || err}`;
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
  const hud = new Hud(stage);
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
      } catch (err) { console.warn('[history]', err); }
    } : undefined);
  AU.startBGM();
}

/** 结束当前对局：断开数据源、移除 HUD、重建一个干净的世界层 */
function teardownGame() {
  if (!source) return;
  source.dispose(); source = null;
  document.getElementById('hud')?.remove();
  world?.app.destroy(true, { children: true });
  void newWorld();
}

function overlay(cls: string) {
  closeOverlay();
  const o = document.createElement('div');
  o.id = 'overlay'; o.className = cls;
  stage.appendChild(o);
  return o;
}
function closeOverlay() { document.getElementById('overlay')?.remove(); }

void boot();
