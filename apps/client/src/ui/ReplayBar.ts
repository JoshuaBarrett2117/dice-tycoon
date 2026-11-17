/** 回放控制条：播放 / 暂停 / 单步 / 调速 / 拖动跳转到指定 seq / 退出 */
import { REPLAY_PLAYER } from '@dt/shared';
import type { ReplaySource } from '../net/source';

export function mountReplayBar(host: HTMLElement, src: ReplaySource, onExit: () => void) {
  const el = document.createElement('div');
  el.id = 'rbar';
  el.innerHTML = `
    <button class="rb-btn" id="rb-start" title="回到开头">⏮</button>
    <button class="rb-btn" id="rb-prev" title="上一步">◀</button>
    <button class="rb-btn main" id="rb-play" title="播放 / 暂停">▶</button>
    <button class="rb-btn" id="rb-next" title="下一步">▶|</button>
    <button class="rb-btn spd" id="rb-spd" title="调速">1×</button>
    <input id="rb-seek" type="range" min="0" max="${src.player.total}" value="0" step="1">
    <span id="rb-pos" title="当前 seq / 总步数">0 / ${src.player.total}</span>
    <button class="rb-btn exit" id="rb-exit">退出回放</button>`;
  host.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const seek = q<HTMLInputElement>('#rb-seek');
  let dragging = false;

  q('#rb-start').onclick = () => src.seek(0);
  q('#rb-prev').onclick = () => src.stepBack();
  q('#rb-next').onclick = () => src.stepForward();
  q('#rb-play').onclick = () => src.toggle();
  q('#rb-spd').onclick = () => {
    const sp = REPLAY_PLAYER.speeds as readonly number[];
    src.setSpeed(sp[(sp.indexOf(src.speed) + 1) % sp.length]);
  };
  q('#rb-exit').onclick = onExit;
  seek.oninput = () => { dragging = true; q('#rb-pos').textContent = `${seek.value} / ${src.player.total}`; };
  seek.onchange = () => { dragging = false; src.seek(Number(seek.value)); };

  const kd = (e: KeyboardEvent) => {
    if (e.code === 'Space') { e.preventDefault(); src.toggle(); }
    else if (e.code === 'ArrowRight') src.stepForward();
    else if (e.code === 'ArrowLeft') src.stepBack();
  };
  window.addEventListener('keydown', kd);

  src.onUi((u) => {
    q('#rb-play').textContent = u.playing ? '⏸' : '▶';
    q('#rb-spd').textContent = `${u.speed}×`;
    if (!dragging) { seek.value = String(u.index); q('#rb-pos').textContent = `${u.index} / ${u.total}`; }
  });
  return () => { window.removeEventListener('keydown', kd); el.remove(); };
}
