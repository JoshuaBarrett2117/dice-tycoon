/** DOM 版 HUD：头像芯片、掷骰键与蓄力条、骰子、提示条、选择面板、金币飞行、结算页 */
import { GLOBAL_EVENTS, ZONES, zoneOfPower, type GlobalEventId, type Pending } from '@dt/shared';
import { AU } from '../audio/audio';
import { sleep } from '../core/tween';

export interface HudPlayer { name: string; charName: string; color: string; img: string; isMe: boolean }
export interface SheetSpec {
  title: string;
  color: string;
  kind: string;
  img?: string;
  rows: [string, string][];
  pending: Pending;
  /** 选项的展示文字 */
  optionLabel: (k: number) => string;
  grid?: boolean;
}

/** 掷骰前的行动栏：手牌 / 技能 / 额外按钮 */
export interface ActsSpec {
  enabled: boolean;
  items: { id: string; name: string; desc: string }[];
  skill: { name: string; desc: string; cd: number } | null;
  extras: { label: string; title: string; on: () => void }[];
  onItem: (id: string) => void;
  onSkill: () => void;
}

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, s: string) => root.querySelector(s) as T;
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[25, 25], [50, 50], [75, 75]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]], 6: [[28, 22], [72, 22], [28, 50], [72, 50], [28, 78], [72, 78]],
};
export const GRAD = {
  gold: 'linear-gradient(90deg,#d99a00,#ffc21a,#d99a00)',
  blue: 'linear-gradient(90deg,#2563eb,#60a5fa,#2563eb)',
  green: 'linear-gradient(90deg,#16a34a,#4ade80,#16a34a)',
  purple: 'linear-gradient(90deg,#7c3aed,#c084fc,#7c3aed)',
  red: 'linear-gradient(90deg,#e11d48,#fb7185,#e11d48)',
  gray: 'linear-gradient(90deg,#64748b,#94a3b8,#64748b)',
};

export class Hud {
  private chips: HTMLElement[] = [];
  private cash: number[] = [];
  private toastT = 0;
  private deadlineTimer = 0;
  /** 取消当前等待中的输入（服务端已托管或状态已变化时调用） */
  private cancelFn: (() => void) | null = null;
  cancelInput() { this.cancelFn?.(); this.cancelFn = null; }

  constructor(private stage: HTMLElement) {
    stage.insertAdjacentHTML('beforeend', `
      <div id="hud">
        <div id="topbar"><div id="round">第 <b>1</b>/20 回合</div><div class="win">胜利：三区独占 · 整排独占 · 观光地独占 · 对手破产</div><div id="timer"></div></div>
        <div id="snd"><button id="bm" title="音乐">♫</button><button id="bs" title="音效">🔊</button></div>
        <div id="roll" class="busy"><div class="who"><img alt=""></div><div class="lbl st3">掷 骰</div><div class="sub st2"></div></div>
        <div id="gauge"></div><div id="glab" class="st2"></div>
        <div id="dice"><div class="die" id="d1"></div><div class="die" id="d2"></div></div>
        <div id="toast" class="st3"></div>
        <div id="gbanner"></div>
        <div id="acts"></div>
        <div id="props"></div>
        <div id="chips"></div>
        <div id="sheet"><div class="rib st2"></div><div class="kind"></div><div class="bimg"><img alt=""></div><div class="info"></div><div class="opts"></div><div class="tbar"><i></i></div><button class="bt no">放 弃</button></div>
        <div id="fx"></div>
        <div id="result"></div>
      </div>`);
    const g = $(stage, '#gauge');
    ZONES.forEach((z) => {
      const d = document.createElement('div');
      d.className = 'z'; d.style.flex = String(z.width); d.style.background = z.color; d.textContent = `${z.lo}–${z.hi}`;
      g.appendChild(d);
    });
    g.insertAdjacentHTML('beforeend', '<div id="gneedle"></div>');
    $(stage, '#bm').onclick = (e) => { e.stopPropagation(); $(stage, '#bm').classList.toggle('off', !AU.toggleMusic()); };
    $(stage, '#bs').onclick = (e) => { e.stopPropagation(); $(stage, '#bs').classList.toggle('off', !AU.toggleSfx()); };
    this.showGauge(false);
  }

  // ───────────────────────── 头像芯片 ─────────────────────────
  setupPlayers(ps: HudPlayer[], cash: number[]) {
    const box = $(this.stage, '#chips');
    box.innerHTML = '';
    this.chips = ps.map((p, i) => {
      const d = document.createElement('div');
      d.className = 'chip' + (i === 1 || i === 2 ? ' top' : '');
      d.id = 'c' + i;
      d.style.setProperty('--c', p.color);
      d.innerHTML = `<div class="av"><img src="${p.img}" alt=""></div><div class="nm">${esc(p.name)}${p.isMe ? '<em>我</em>' : ''}<i>${esc(p.charName)}</i></div><div class="cs">¥<span class="cash">${cash[i]}</span><small>万</small></div><div class="pp"></div><div class="st"></div>`;
      box.appendChild(d);
      return d;
    });
    this.cash = [...cash];
  }

  setCash(seat: number, to: number) {
    const span = $(this.chips[seat], '.cash'), from = this.cash[seat];
    this.cash[seat] = to;
    const t0 = performance.now();
    const f = (t: number) => {
      const k = Math.min(1, (t - t0) / 600);
      span.textContent = String(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
      if (k < 1) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }
  setProps(seat: number, n: number) { $(this.chips[seat], '.pp').textContent = `地产 ${n}`; }
  setTurn(seat: number, text: string) {
    this.chips.forEach((c, i) => { c.classList.toggle('on', i === seat); c.classList.toggle('dim', i !== seat); });
    this.chipText(seat, text);
  }
  chipText(seat: number, t: string) { $(this.chips[seat], '.st').textContent = t; }
  chipFx(seat: number, cls: 'hit' | 'gain') {
    const c = this.chips[seat];
    c.classList.remove(cls); void c.offsetWidth; c.classList.add(cls);
    setTimeout(() => c.classList.remove(cls), 500);
  }
  setBankrupt(seat: number) { this.chips[seat].classList.add('broke'); }
  chipPos(seat: number): [number, number] {
    const r = this.chips[seat].getBoundingClientRect(), st = this.stage.getBoundingClientRect(), k = st.width / 1280;
    return [(r.left + r.width / 2 - st.left) / k, (r.top + r.height / 2 - st.top) / k];
  }
  setRound(r: number, max: number) { $(this.stage, '#round').innerHTML = `第 <b>${r}</b>/${max} 回合`; }

  setDeadline(deadline: number | null) {
    clearInterval(this.deadlineTimer);
    const el = $(this.stage, '#timer');
    if (!deadline) { el.textContent = ''; return; }
    const f = () => {
      const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      el.textContent = s <= 10 ? `⏱ ${s}s` : '';
    };
    f();
    this.deadlineTimer = window.setInterval(f, 250);
  }

  // ───────────────────────── 全局事件横幅 / 行动栏 ─────────────────────────
  setGlobalEvent(id: GlobalEventId | null) {
    const el = $(this.stage, '#gbanner');
    if (!id || id === 'none') { el.classList.remove('show'); return; }
    const d = GLOBAL_EVENTS[id];
    el.innerHTML = `<b>全局事件 · ${esc(d.name)}</b><span>${esc(d.desc)}（本回合）</span>`;
    el.classList.add('show');
  }

  /** 渲染掷骰前行动栏；enabled=false 时只展示不可点 */
  setActs(spec: ActsSpec | null) {
    const box = $(this.stage, '#acts');
    box.innerHTML = '';
    if (!spec || (!spec.items.length && !spec.skill && !spec.extras.length)) { box.classList.remove('show'); return; }
    box.classList.add('show'); box.classList.toggle('off', !spec.enabled);
    const mk = (cls: string, html: string, title: string, on: () => void, dis = false) => {
      const b = document.createElement('button');
      b.className = 'act ' + cls + (dis ? ' cd' : ''); b.innerHTML = html; b.title = title;
      b.onclick = (e) => { e.stopPropagation(); if (dis || !spec.enabled) return; AU.unlock(); AU.play('click'); on(); };
      box.appendChild(b);
    };
    spec.items.forEach((it) => mk('item', `<b>${esc(it.name)}</b><small>${esc(it.desc)}</small>`, it.desc, () => spec.onItem(it.id)));
    if (spec.skill) mk('skill', `<b>${esc(spec.skill.name)}</b><small>${spec.skill.cd > 0 ? `冷却 ${spec.skill.cd} 回合` : '可用'}</small>`, spec.skill.desc, spec.onSkill, spec.skill.cd > 0);
    spec.extras.forEach((x) => mk('extra', `<b>${esc(x.label)}</b>`, x.title, x.on));
  }

  /** 我的地产面板：抵押 / 赎回入口 */
  showProps(rows: { name: string; info: string; action: string; can: boolean; mortgaged: boolean; go: () => void }[]) {
    const box = $(this.stage, '#props');
    const close = () => { box.classList.remove('show'); box.innerHTML = ''; };
    box.innerHTML = `<div class="pn"><div class="ph">我的地产 · 抵押 / 赎回<button class="x">✕</button></div><div class="pl"></div><div class="pf">抵押得款 = 投入 ×50%；赎回价 = 得款 ×110%；抵押中的地产不收过路费、不可升级，也不计入独占胜利</div></div>`;
    const list = $(box, '.pl');
    rows.forEach((r) => {
      const d = document.createElement('div');
      d.className = 'pr' + (r.mortgaged ? ' mg' : '');
      d.innerHTML = `<b>${esc(r.name)}</b><span>${esc(r.info)}</span>`;
      const b = document.createElement('button');
      b.textContent = r.action; b.disabled = !r.can;
      b.onclick = (e) => { e.stopPropagation(); close(); r.go(); };
      d.appendChild(b);
      list.appendChild(d);
    });
    $(box, '.x').onclick = (e) => { e.stopPropagation(); close(); };
    box.classList.add('show');
  }
  closeProps() { const b = $(this.stage, '#props'); b.classList.remove('show'); b.innerHTML = ''; }

  // ───────────────────────── 提示 ─────────────────────────
  toast(text: string, bg: string = GRAD.red) {
    const t = $(this.stage, '#toast');
    t.textContent = text; t.style.background = bg; t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => t.classList.remove('show'), 1500);
  }

  floatText(x: number, y: number, text: string, color: string) {
    const e = document.createElement('div');
    e.className = 'ftxt st3'; e.textContent = text; e.style.color = color; e.style.left = x + 'px'; e.style.top = y + 'px';
    $(this.stage, '#fx').appendChild(e);
    e.animate([
      { transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
      { transform: 'translate(-50%,-90%) scale(1.15)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%,-140%) scale(1)', opacity: 1, offset: 0.8 },
      { transform: 'translate(-50%,-170%)', opacity: 0 },
    ], { duration: 1300, easing: 'ease-out' }).onfinish = () => e.remove();
  }

  async coins(a: [number, number], b: [number, number], n: number, img: string) {
    for (let i = 0; i < n; i++) {
      const c = document.createElement('img');
      c.src = img; c.className = 'coin';
      $(this.stage, '#fx').appendChild(c);
      const mx = (a[0] + b[0]) / 2 + (Math.random() * 60 - 30), my = Math.min(a[1], b[1]) - 80 - Math.random() * 40;
      c.animate([
        { left: a[0] + 'px', top: a[1] + 'px', transform: 'scale(.5)' },
        { left: mx + 'px', top: my + 'px', transform: 'scale(1.15) rotate(180deg)', offset: 0.45 },
        { left: b[0] + 'px', top: b[1] + 'px', transform: 'scale(.7) rotate(360deg)' },
      ], { duration: 680, easing: 'ease-in-out' }).onfinish = () => c.remove();
      setTimeout(() => AU.play('coin'), 520);
      await sleep(70);
    }
    await sleep(620);
  }

  // ───────────────────────── 掷骰 ─────────────────────────
  private showGauge(on: boolean) {
    $(this.stage, '#gauge').style.opacity = on ? '1' : '0';
    $(this.stage, '#glab').style.opacity = on ? '1' : '0';
  }

  setRollWaiting(name: string, color: string, img: string) {
    const r = $(this.stage, '#roll');
    r.className = 'wait'; r.style.opacity = '1';
    r.style.setProperty('--c', color);
    $<HTMLImageElement>(r, '.who img').src = img;
    $(r, '.sub').textContent = `${name} 行动中…`;
    this.showGauge(false);
  }
  hideRoll() { $(this.stage, '#roll').style.opacity = '0'; this.showGauge(false); }

  /** 等待本地玩家按住蓄力并松开，返回区间序号（被取消时为 -1）；onZone 用于在棋盘上预览落点 */
  waitRoll(control: number, again: boolean, onZone: (zone: number | null) => void): Promise<number> {
    const r = $(this.stage, '#roll'), needle = $(this.stage, '#gneedle'), lab = $(this.stage, '#glab');
    const zEls = [...$(this.stage, '#gauge').querySelectorAll<HTMLElement>('.z')];
    r.className = 'ready'; r.style.opacity = '1';
    $(r, '.sub').textContent = again ? '再掷一次' : '按住蓄力';
    this.showGauge(true);
    lab.innerHTML = `按住蓄力 · 松开掷骰 · 控骰 <b>${Math.round(control * 100)}%</b>`;
    zEls.forEach((z) => z.classList.remove('on'));
    needle.style.left = '3px';
    return new Promise((res) => {
      let power = 0, dir = 1, raf = 0, cur = -1, charging = false;
      const loop = () => {
        power += dir * 1.25;
        if (power >= 100) { power = 100; dir = -1; }
        if (power <= 0) { power = 0; dir = 1; }
        needle.style.left = 3 + (power / 100) * 328 + 'px';
        const z = zoneOfPower(power);
        if (z !== cur) {
          if (cur >= 0) AU.play('zone', z);
          cur = z;
          zEls.forEach((e, k) => e.classList.toggle('on', k === z));
          lab.innerHTML = `瞄准 <b>${ZONES[z].lo}–${ZONES[z].hi}</b> 步 · 命中率 <b>${Math.round(control * 100)}%</b>`;
          onZone(z);
        }
        raf = requestAnimationFrame(loop);
      };
      const down = (e: Event) => {
        e.preventDefault();
        if (charging) return;
        AU.unlock(); AU.play('charge');
        charging = true; r.className = 'charge'; $(r, '.sub').textContent = '松开掷骰';
        power = 0; dir = 1; cur = -1; loop();
      };
      const cleanup = () => {
        cancelAnimationFrame(raf);
        r.removeEventListener('pointerdown', down);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
        onZone(null);
        r.className = 'busy';
        this.showGauge(false);
        this.cancelFn = null;
      };
      const up = () => {
        if (!charging) return;
        charging = false;
        cleanup();
        res(zoneOfPower(power));
      };
      this.cancelFn = () => { charging = false; cleanup(); res(-1); };
      const kd = (e: KeyboardEvent) => { if (e.code === 'Space' && !e.repeat) down(e); };
      const ku = (e: KeyboardEvent) => { if (e.code === 'Space') up(); };
      r.addEventListener('pointerdown', down);
      window.addEventListener('pointerup', up);
      window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    });
  }

  async rollDice(a: number, b: number) {
    this.hideRoll();
    AU.play('dice');
    const d = $(this.stage, '#dice'), d1 = $(this.stage, '#d1'), d2 = $(this.stage, '#d2');
    d.style.display = 'block';
    const an = (el: HTMLElement, s: number) => el.animate([
      { transform: `translate(${s * 40}px,120px) scale(.4) rotate(0)`, opacity: 0 },
      { transform: `translate(${-s * 20}px,-60px) scale(1.1) rotate(${s * 300}deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(${s * 12}px,8px) rotate(${s * 560}deg)`, offset: 0.7 },
      { transform: 'translate(0,0) rotate(720deg)' },
    ], { duration: 820, easing: 'cubic-bezier(.2,.7,.3,1)' });
    an(d1, 1); const x2 = an(d2, -1);
    const iv = setInterval(() => { face(d1, 1 + Math.floor(Math.random() * 6)); face(d2, 1 + Math.floor(Math.random() * 6)); }, 70);
    await x2.finished;
    clearInterval(iv); face(d1, a); face(d2, b);
    AU.play('diceLand');
    await Promise.all([d1, d2].map((e) => e.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }], { duration: 260 }).finished));
    await sleep(250);
    await d.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.4) translateY(-40px)' }], { duration: 220 }).finished;
    d.style.display = 'none';
  }

  // ───────────────────────── 选择面板 ─────────────────────────
  choose(spec: SheetSpec, timeoutMs: number): Promise<number> {
    const s = $(this.stage, '#sheet');
    AU.play('sheet');
    const rib = $(s, '.rib'); rib.textContent = spec.title; rib.style.background = spec.color;
    $(s, '.kind').textContent = spec.kind;
    const im = $<HTMLImageElement>(s, '.bimg img');
    im.style.display = spec.img ? '' : 'none';
    if (spec.img) im.src = spec.img;
    s.classList.toggle('grid', !!spec.grid);
    $(s, '.info').innerHTML = spec.rows.map((r) => `<div><span>${r[0]}</span>${r[1]}</div>`).join('');
    const opts = $(s, '.opts');
    opts.innerHTML = '';
    s.classList.add('show');
    const bar = $(s, '.tbar i');
    const an = bar.animate([{ width: '100%' }, { width: '0%' }], { duration: timeoutMs, fill: 'forwards' });
    return new Promise((res) => {
      let done = false;
      const finish = (v: number, silent = false) => {
        if (done) return; done = true; this.cancelFn = null;
        if (!silent) AU.play('click');
        an.cancel(); s.classList.remove('show');
        setTimeout(() => res(v), silent ? 0 : 250);
      };
      this.cancelFn = () => finish(-2, true);
      spec.pending.options.forEach((o, k) => {
        const b = document.createElement('button');
        b.className = 'opt' + (k === spec.pending.options.length - 1 && !spec.grid ? ' best' : '');
        b.innerHTML = spec.grid ? `<b>${esc(spec.optionLabel(k))}</b>` : `<b>${esc(spec.optionLabel(k))}</b>${o.cost ? `<span>¥${o.cost} 万</span>` : ''}`;
        b.onclick = () => finish(k);
        opts.appendChild(b);
      });
      $<HTMLButtonElement>(s, '.no').onclick = () => finish(-1);
      an.onfinish = () => finish(-1);
    });
  }
  closeSheet() { $(this.stage, '#sheet').classList.remove('show'); }

  // ───────────────────────── 结算 ─────────────────────────
  showResult(title: string, sub: string, rows: { name: string; color: string; img: string; value: number; tag: string }[], onAgain: () => void, onExport?: () => Promise<void>) {
    const r = $(this.stage, '#result');
    r.innerHTML = `<div class="panel"><div class="ttl st3">${esc(title)}</div><div class="sub">${esc(sub)}</div>
      ${rows.map((x, i) => `<div class="row" style="--c:${x.color}"><span class="rk">${i + 1}</span><img src="${x.img}" alt=""><span class="n">${esc(x.name)}</span><span class="tg">${esc(x.tag)}</span><span class="v">¥${x.value}万</span></div>`).join('')}
      <div class="rb">${onExport ? '<button class="exp">导出回放 JSON</button>' : ''}<button class="again">再来一局</button></div></div>`;
    r.classList.add('show');
    const exp = r.querySelector<HTMLButtonElement>('.exp');
    if (exp && onExport) exp.onclick = async () => {
      exp.disabled = true; exp.textContent = '导出中…';
      try { await onExport(); exp.textContent = '已导出 ✓'; } catch { exp.textContent = '导出失败，点击重试'; }
      exp.disabled = false;
    };
    $<HTMLButtonElement>(r, '.again').onclick = () => { r.classList.remove('show'); onAgain(); };
  }
}

function face(el: HTMLElement, n: number) {
  el.innerHTML = PIPS[n].map(([x, y]) => `<i class="p" style="left:${x}%;top:${y}%"></i>`).join('');
}
function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
