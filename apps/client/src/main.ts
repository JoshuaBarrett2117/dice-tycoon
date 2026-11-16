import './style.css';
import { CHARACTERS, CHAR_IDS, type CharId, type SeatConfig } from '@dt/shared';
import { AU } from './audio/audio';
import { Director, charUrl } from './game/Director';
import { NetSource, LocalSource, type GameSource, type LobbyMsg } from './net/source';
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

const prefs = {
  name: localStorage.getItem('dt.name') || '玩家' + Math.floor(Math.random() * 900 + 100),
  charId: (localStorage.getItem('dt.char') as CharId) || 'jin',
  server: localStorage.getItem('dt.server') || DEFAULT_SERVER,
};

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
    <div class="tag">网页大富翁 · v0.1 开发版</div>
    <div class="form">
      <label>昵称 <input id="nm" maxlength="12" value="${prefs.name}"></label>
      <div class="chars">${CHAR_IDS.map((c) => `
        <button class="ch ${c === prefs.charId ? 'on' : ''}" data-c="${c}" style="--c:${CHARACTERS[c].color}">
          <img src="${charUrl(c)}" alt=""><b>${CHARACTERS[c].name}</b><small>${CHARACTERS[c].skill}</small>
        </button>`).join('')}</div>
      <div class="btns">
        <button class="big gold" id="solo">单机对战<small>你 vs 3 个机器人</small></button>
        <button class="big blue" id="create">创建房间<small>好友联机，空位机器人补齐</small></button>
      </div>
      <div class="join"><input id="rid" placeholder="输入房间号加入"><button id="joinb">加入</button></div>
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
    localStorage.setItem('dt.name', prefs.name); localStorage.setItem('dt.char', prefs.charId); localStorage.setItem('dt.server', prefs.server);
    AU.unlock();
  };
  m.querySelector<HTMLButtonElement>('#solo')!.onclick = () => { save(); startSolo(); };
  m.querySelector<HTMLButtonElement>('#create')!.onclick = () => { save(); void startOnline(); };
  m.querySelector<HTMLButtonElement>('#joinb')!.onclick = () => {
    save();
    const id = m.querySelector<HTMLInputElement>('#rid')!.value.trim();
    if (id) void startOnline(id);
  };
}

// ───────────────────────── 单机 ─────────────────────────
function startSolo() {
  closeOverlay();
  const others = CHAR_IDS.filter((c) => c !== prefs.charId);
  const seats: SeatConfig[] = [
    { id: 'me', name: prefs.name, charId: prefs.charId },
    { id: 'bot1', name: '阿柚', charId: others[0], isBot: true },
    { id: 'bot2', name: '老周', charId: others[1], isBot: true },
    { id: 'bot3', name: '阿星', charId: others[2], isBot: true },
  ];
  void startGame(new LocalSource(seats));
}

// ───────────────────────── 在线 ─────────────────────────
async function startOnline(roomId?: string) {
  const o = overlay('lobby');
  o.innerHTML = '<div class="panel"><div class="ttl">连接中…</div></div>';
  let net: NetSource;
  try {
    net = await NetSource.connect(prefs.server, { name: prefs.name, charId: prefs.charId }, roomId);
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
    if (m.seats.length === 4 && m.seats.some((s) => s.isBot)) {
      started = true;
      closeOverlay();
      void startGame(net);
    }
  });
}

// ───────────────────────── 对局 ─────────────────────────
async function startGame(src: GameSource) {
  source = src;
  await worldReady;
  const hud = new Hud(stage);
  new Director(world!, hud, src, () => showMenu());
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
