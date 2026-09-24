import { el, escapeHtml } from './dom';

export interface HudState {
  hp: number;
  maxHp: number;
  st: number;
  maxSt: number;
  fuel: number;
  fuelMax: number;
  lanternOn: boolean;
  draughts: number;
  draughtsMax: number;
  marrow: number;
  dread: number;
  lock: { x: number; y: number; crit: boolean } | null;
  boss: { name: string; hp: number; max: number } | null;
  prompt: { key: string; text: string } | null;
  hint: string | null;
  ult: number;
  ultReady: boolean;
  weapon: string;
  arrows: number | null;
  aiming: boolean;
  draw: number;
}

class Bar {
  readonly root: HTMLDivElement;
  private fill: HTMLDivElement;
  private ghost: HTMLDivElement;
  private lastW = -1;
  private lastMax = -1;
  private lastV = -1;
  constructor(parent: HTMLElement, cls: string, private pxPerUnit: number) {
    this.root = el('div', `bar ${cls}`, parent);
    this.ghost = el('div', 'ghost', this.root);
    this.fill = el('div', 'fill', this.root);
  }
  set(v: number, max: number): void {
    if (max !== this.lastMax) {
      this.lastMax = max;
      const w = Math.round(max * this.pxPerUnit);
      if (w !== this.lastW) {
        this.lastW = w;
        this.root.style.width = `${w}px`;
      }
    }
    const pct = Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100));
    const r = Math.round(pct * 10) / 10;
    if (r !== this.lastV) {
      if (r > this.lastV) this.ghost.style.width = `${r}%`;
      this.lastV = r;
      this.fill.style.width = `${r}%`;
      // ghost trails behind on damage
      requestAnimationFrame(() => (this.ghost.style.width = `${r}%`));
    }
  }
}

/** DOM heads-up display. Values only touch the DOM when they change. */
export class Hud {
  readonly root: HTMLDivElement;
  private hp: Bar;
  private st: Bar;
  private fuel: Bar;
  private draught: HTMLDivElement;
  private draughtCount: HTMLSpanElement;
  private lantern: HTMLDivElement;
  private marrowVal: HTMLSpanElement;
  private marrowGain: HTMLSpanElement;
  private reticle: HTMLDivElement;
  private ult: Bar;
  private weaponEl: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private boss: HTMLDivElement;
  private bossName: HTMLDivElement;
  private bossBar: Bar;
  private prompt: HTMLDivElement;
  private hint: HTMLDivElement;
  private dreadEye: SVGPathElement;
  private bannerEl: HTMLDivElement;
  private regionEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private msgEl: HTMLDivElement;
  private fadeEl: HTMLDivElement;
  private last: Partial<Record<string, string | number | boolean>> = {};
  private gainTotal = 0;
  private timers = new Map<string, number>();

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud hidden', parent);
    const bars = el('div', 'bars', this.root);
    this.hp = new Bar(bars, 'hp', 0.9);
    this.st = new Bar(bars, 'st', 2.3);
    this.fuel = new Bar(bars, 'fuel', 1.5);
    this.ult = new Bar(bars, 'ult', 1.6);
    const dread = el('div', 'dread', this.root);
    dread.innerHTML = `<svg viewBox="0 0 36 18"><path d="M1 9 Q18 -3 35 9 Q18 21 1 9 Z" fill="none" stroke="rgba(200,190,170,0.55)" stroke-width="1"/><path class="pupil" d="M18 9 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0" fill="#8e1d17"/></svg>`;
    this.dreadEye = dread.querySelector('.pupil')!;
    const bl = el('div', 'corner-bl', this.root);
    this.draught = el('div', 'draught', bl);
    el('div', 'vial', this.draught);
    this.draughtCount = el('span', 'count', this.draught);
    this.lantern = el('div', 'lantern-ico', bl);
    this.lantern.innerHTML = `<svg viewBox="0 0 26 40"><circle cx="13" cy="4" r="3" fill="none" stroke="#8d867b"/><path d="M6 10 L20 10 L22 32 L4 32 Z" fill="none" stroke="#8d867b"/><ellipse class="glow" cx="13" cy="22" rx="5" ry="8" fill="#ffb060"/></svg>`;
    const m = el('div', 'marrow', this.root);
    this.marrowGain = el('span', 'gain', m);
    this.marrowVal = el('span', 'val', m, '0');
    el('span', 'label', m, 'Marrow');
    this.reticle = el('div', 'reticle', this.root);
    this.weaponEl = el('div', 'weapon', bl);
    this.crosshair = el('div', 'crosshair', this.root);
    el('i', '', this.crosshair);
    this.boss = el('div', 'boss', this.root);
    this.bossName = el('div', 'name', this.boss);
    this.bossBar = new Bar(this.boss, 'bossbar', 1);
    this.bossBar.root.style.width = '100%';
    this.prompt = el('div', 'prompt', this.root);
    this.hint = el('div', 'hint', this.root);
    this.bannerEl = el('div', 'banner', parent);
    this.regionEl = el('div', 'banner region', parent);
    this.toastEl = el('div', 'toast', parent);
    this.msgEl = el('div', 'message', parent);
    this.fadeEl = el('div', 'fade', parent);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  private changed(key: string, v: string | number | boolean): boolean {
    if (this.last[key] === v) return false;
    this.last[key] = v;
    return true;
  }

  update(s: HudState): void {
    this.hp.set(s.hp, s.maxHp);
    this.st.set(Math.max(0, s.st), s.maxSt);
    this.fuel.set(s.fuel, s.fuelMax);
    this.ult.set(s.ult, 100);
    if (this.changed('ultReady', s.ultReady)) this.ult.root.classList.toggle('ready', s.ultReady);
    const wtxt = s.arrows === null ? s.weapon : `${s.weapon} · ${s.arrows} arrows`;
    if (this.changed('weapon', wtxt)) this.weaponEl.textContent = wtxt;
    if (this.changed('aiming', s.aiming)) this.crosshair.classList.toggle('on', s.aiming);
    const dr = Math.round(s.draw * 20);
    if (this.changed('draw', dr)) this.crosshair.style.setProperty('--draw', String(1 - dr / 20));
    if (this.changed('lanternOn', s.lanternOn)) {
      this.fuel.root.classList.toggle('off', !s.lanternOn);
      (this.lantern.querySelector('.glow') as SVGElement).style.opacity = s.lanternOn ? '1' : '0.08';
    }
    if (this.changed('draughts', `${s.draughts}/${s.draughtsMax}`)) {
      this.draughtCount.textContent = String(s.draughts);
      this.draught.classList.toggle('empty', s.draughts === 0);
      this.draught.style.setProperty('--lvl', `${Math.round((s.draughts / Math.max(1, s.draughtsMax)) * 100)}%`);
    }
    if (this.changed('marrow', s.marrow)) this.marrowVal.textContent = s.marrow.toLocaleString('en-US');
    const d = Math.round(s.dread * 20) / 20;
    if (this.changed('dread', d)) {
      this.dreadEye.setAttribute('transform', `translate(18 9) scale(${0.5 + d * 1.6}) translate(-18 -9)`);
      this.dreadEye.style.opacity = String(0.25 + d * 0.75);
    }
    if (s.lock) {
      this.reticle.style.display = 'block';
      this.reticle.style.left = `${s.lock.x}px`;
      this.reticle.style.top = `${s.lock.y}px`;
      this.reticle.classList.toggle('crit', s.lock.crit);
    } else if (this.changed('lockHidden', true)) this.reticle.style.display = 'none';
    if (s.lock) this.last.lockHidden = false;
    if (s.boss) {
      if (this.changed('bossShow', true)) this.boss.style.display = 'block';
      if (this.changed('bossName', s.boss.name)) this.bossName.textContent = s.boss.name;
      this.bossBar.set(s.boss.hp, s.boss.max);
    } else if (this.changed('bossShow', false)) this.boss.style.display = 'none';
    const pr = s.prompt ? `${s.prompt.key}|${s.prompt.text}` : '';
    if (this.changed('prompt', pr)) {
      if (s.prompt) {
        this.prompt.innerHTML = `<kbd>${escapeHtml(s.prompt.key)}</kbd>${escapeHtml(s.prompt.text)}`;
        this.prompt.style.display = 'block';
      } else this.prompt.style.display = 'none';
    }
    if (this.changed('hint', s.hint ?? '')) {
      if (s.hint) this.hint.textContent = s.hint;
      this.hint.classList.toggle('show', !!s.hint);
    }
  }

  private timed(key: string, elx: HTMLElement, dur: number): void {
    const prev = this.timers.get(key);
    if (prev) clearTimeout(prev);
    elx.classList.add('show');
    this.timers.set(
      key,
      window.setTimeout(() => elx.classList.remove('show'), dur * 1000),
    );
  }

  banner(text: string, opts: { sub?: string; gold?: boolean; dur?: number } = {}): void {
    this.bannerEl.innerHTML = `${escapeHtml(text)}${opts.sub ? `<span class="sub">${escapeHtml(opts.sub)}</span>` : ''}`;
    this.bannerEl.classList.toggle('gold', !!opts.gold);
    this.timed('banner', this.bannerEl, opts.dur ?? 3.5);
  }

  region(name: string): void {
    this.regionEl.textContent = name;
    this.timed('region', this.regionEl, 3.2);
  }

  toast(title: string, desc: string, dur = 4): void {
    this.toastEl.innerHTML = `<div class="t">${escapeHtml(title)}</div><div class="d">${escapeHtml(desc)}</div>`;
    this.timed('toast', this.toastEl, dur);
  }

  message(text: string, dur = 2.5): void {
    this.msgEl.textContent = text;
    this.timed('msg', this.msgEl, dur);
  }

  gain(n: number): void {
    this.gainTotal += n;
    this.marrowGain.textContent = `+${this.gainTotal.toLocaleString('en-US')}`;
    this.marrowGain.classList.add('show');
    const prev = this.timers.get('gain');
    if (prev) clearTimeout(prev);
    this.timers.set(
      'gain',
      window.setTimeout(() => {
        this.marrowGain.classList.remove('show');
        this.gainTotal = 0;
      }, 2500),
    );
  }

  fade(on: boolean): void {
    this.fadeEl.classList.toggle('show', on);
  }
}
