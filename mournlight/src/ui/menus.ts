import { el, escapeHtml } from './dom';
import { settings, type Quality } from '../core/settings';
import type { MenuAction } from '../core/input';
import { levelCost, levelOf, maxHealth, maxStamina, damageMultiplier, type Attributes } from '../data/stats';

export type ScreenName = 'loading' | 'title' | 'pause' | 'settings' | 'controls' | 'death' | 'shrine' | 'levelup' | 'travel' | 'intro' | 'victory';

export interface MenuCallbacks {
  newGame(): void;
  continueGame(): void;
  resume(): void;
  quitToTitle(): void;
  levelUp(attrs: Attributes, cost: number): void;
  travel(shrineId: string): void;
  leaveShrine(): void;
  startFromIntro(): void;
  click(): void;
  move(): void;
}

export interface LevelInfo {
  attrs: Attributes;
  marrow: number;
  dmgBonus: number;
}

const CONTROLS: [string, string, string][] = [
  ['Move', 'W A S D', 'Left stick'],
  ['Camera', 'Mouse', 'Right stick'],
  ['Run', 'Hold Shift', 'Hold B'],
  ['Dodge roll', 'Space', 'Tap B'],
  ['Leap', 'C', 'A'],
  ['Strike', 'Left mouse', 'RB'],
  ['Heavy strike (hold to charge)', 'Shift + Left mouse', 'RT'],
  ['Guard / parry (press as a blow lands)', 'Right mouse', 'LB'],
  ['Lock on / recenter', 'Q  or  Middle mouse', 'R3'],
  ['Switch target', 'Mouse wheel / flick', 'Flick right stick'],
  ['Tallow Draught', 'R', 'X'],
  ['Interact / rest', 'E', 'Y'],
  ['Shutter lantern', 'F', 'LT / D-pad up'],
  ['Pause', 'Esc', 'Start'],
  ['Debug', 'F1', ''],
];

/** Title, pause, death, shrine, level-up, travel and settings screens. */
export class Menus {
  private screens = new Map<ScreenName, HTMLDivElement>();
  current: ScreenName | null = null;
  private backStack: ScreenName[] = [];
  private loadFill!: HTMLDivElement;
  private loadLabel!: HTMLDivElement;
  private continueBtn!: HTMLButtonElement;
  private levelInfo: LevelInfo | null = null;
  private pending: Attributes | null = null;
  private travelList: { id: string; name: string }[] = [];
  private shrineName = '';
  private deathText!: HTMLDivElement;
  private deathSub!: HTMLDivElement;
  private victoryText!: HTMLDivElement;

  constructor(
    private root: HTMLElement,
    private cb: MenuCallbacks,
  ) {
    this.buildLoading();
    this.buildTitle();
    this.buildIntro();
    this.buildPause();
    this.buildSettings();
    this.buildControls();
    this.buildDeath();
    this.buildShrine();
    this.buildLevelUp();
    this.buildTravel();
    this.buildVictory();
  }

  private screen(name: ScreenName, cls = ''): HTMLDivElement {
    const s = el('div', `screen ${cls}`, this.root);
    this.screens.set(name, s);
    return s;
  }

  private button(parent: HTMLElement, label: string, fn: () => void): HTMLButtonElement {
    const b = el('button', '', parent, escapeHtml(label));
    b.addEventListener('click', () => {
      this.cb.click();
      fn();
    });
    b.addEventListener('mouseenter', () => b.focus());
    return b;
  }

  show(name: ScreenName | null, pushBack = false): void {
    if (pushBack && this.current) this.backStack.push(this.current);
    if (!pushBack) this.backStack = [];
    for (const [n, s] of this.screens) s.classList.toggle('active', n === name);
    this.current = name;
    if (name === 'levelup') this.renderLevelUp();
    if (name === 'travel') this.renderTravel();
    if (name === 'shrine') this.renderShrine();
    if (name === 'settings') this.syncSettings();
    // focus the first control
    requestAnimationFrame(() => {
      const f = this.focusables()[0];
      f?.focus();
    });
  }

  back(): void {
    const prev = this.backStack.pop();
    if (prev) {
      const stack = this.backStack;
      this.show(prev, false);
      this.backStack = stack;
    } else if (this.current === 'pause') this.cb.resume();
    else if (this.current === 'shrine') this.cb.leaveShrine();
  }

  private focusables(): HTMLElement[] {
    if (!this.current) return [];
    const s = this.screens.get(this.current)!;
    return Array.from(s.querySelectorAll<HTMLElement>('button:not([disabled]), input, select'));
  }

  nav(a: MenuAction): void {
    const list = this.focusables();
    if (!list.length) {
      if (a === 'back') this.back();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    let i = active ? list.indexOf(active) : -1;
    switch (a) {
      case 'up':
        i = i <= 0 ? list.length - 1 : i - 1;
        list[i].focus();
        this.cb.move();
        break;
      case 'down':
        i = i < 0 || i >= list.length - 1 ? 0 : i + 1;
        list[i].focus();
        this.cb.move();
        break;
      case 'left':
      case 'right': {
        const dir = a === 'left' ? -1 : 1;
        if (active instanceof HTMLInputElement && active.type === 'range') {
          const step = Number(active.step) || 0.05;
          active.value = String(Math.min(Number(active.max), Math.max(Number(active.min), Number(active.value) + step * dir)));
          active.dispatchEvent(new Event('input'));
          this.cb.move();
        } else if (active instanceof HTMLSelectElement) {
          active.selectedIndex = Math.min(active.options.length - 1, Math.max(0, active.selectedIndex + dir));
          active.dispatchEvent(new Event('change'));
          this.cb.move();
        } else if (active instanceof HTMLInputElement && active.type === 'checkbox') {
          active.checked = !active.checked;
          active.dispatchEvent(new Event('change'));
        } else if (active?.dataset.stepper) {
          const row = active.closest('.row');
          const btn = row?.querySelector<HTMLButtonElement>(dir < 0 ? '[data-dec]' : '[data-inc]');
          btn?.click();
          active.focus();
        }
        break;
      }
      case 'accept':
        if (active instanceof HTMLInputElement && active.type === 'checkbox') {
          active.checked = !active.checked;
          active.dispatchEvent(new Event('change'));
        } else active?.click();
        break;
      case 'back':
        this.cb.click();
        this.back();
        break;
    }
  }

  // ---------------------------------------------------------------------------
  private buildLoading(): void {
    const s = this.screen('loading', 'loading');
    s.style.background = '#050506';
    el('div', 'title-logo', s, 'MOURNLIGHT');
    const bar = el('div', 'bar', s);
    this.loadFill = el('div', 'fill', bar);
    this.loadLabel = el('div', 'label', s, 'The fog gathers…');
  }

  setLoading(p: number, label: string): void {
    this.loadFill.style.width = `${Math.round(p * 100)}%`;
    this.loadLabel.textContent = label + '…';
  }

  private buildTitle(): void {
    const s = this.screen('title', 'dim');
    s.style.background = 'radial-gradient(ellipse at center, rgba(0,0,0,0.15), rgba(0,0,0,0.8))';
    el('div', 'title-logo', s, 'MOURNLIGHT');
    el('div', 'title-sub', s, 'The last flame of Vael');
    const m = el('div', 'menu', s);
    this.continueBtn = this.button(m, 'Continue', () => this.cb.continueGame());
    this.button(m, 'New Pilgrimage', () => this.show('intro', true));
    this.button(m, 'Settings', () => this.show('settings', true));
    this.button(m, 'Controls', () => this.show('controls', true));
    el('div', 'footer-hint', s, 'Best with headphones · Click to play');
  }

  setContinueAvailable(v: boolean): void {
    this.continueBtn.style.display = v ? '' : 'none';
  }

  private buildIntro(): void {
    const s = this.screen('intro', 'dim');
    s.style.background = 'rgba(0,0,0,0.92)';
    el(
      'div',
      'lore',
      s,
      'When Ithrenn, the Kindling God, died, no one buried Him.<br>He fell at the heart of Vael and began to rot, and from the rot rose the fog.<br><br>You were ash once. Now you are a revenant bound to a lantern,<br>carrying the last flame in the world.<br><br>Something in the Godwound is eating what light remains.',
    );
    const m = el('div', 'menu', s);
    this.button(m, 'Rise', () => this.cb.newGame());
    this.button(m, 'Back', () => this.back());
  }

  private buildPause(): void {
    const s = this.screen('pause', 'dim');
    el('div', 'title-sub', s, 'Paused');
    const m = el('div', 'menu', s);
    this.button(m, 'Resume', () => this.cb.resume());
    this.button(m, 'Settings', () => this.show('settings', true));
    this.button(m, 'Controls', () => this.show('controls', true));
    this.button(m, 'Return to Title', () => this.cb.quitToTitle());
  }

  private settingRows: { sync(): void }[] = [];

  private buildSettings(): void {
    const s = this.screen('settings', 'dim');
    const p = el('div', 'panel', s);
    el('h2', '', p, 'Settings');
    el('div', 'sub', p, 'Changes are kept between visits');
    const range = (label: string, key: 'mouseSensitivity' | 'padSensitivity' | 'masterVolume' | 'sfxVolume' | 'ambienceVolume' | 'fov', min: number, max: number, step: number, fmt: (v: number) => string): void => {
      const row = el('div', 'row', p);
      el('span', '', row, label);
      const wrap = el('span', 'v', row);
      const input = el('input', '', wrap) as HTMLInputElement;
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      const out = el('span', '', wrap);
      out.style.display = 'inline-block';
      out.style.width = '52px';
      out.style.textAlign = 'right';
      input.addEventListener('input', () => {
        settings.set(key, Number(input.value));
        out.textContent = fmt(Number(input.value));
      });
      this.settingRows.push({
        sync: () => {
          input.value = String(settings.value[key]);
          out.textContent = fmt(settings.value[key]);
        },
      });
    };
    range('Mouse sensitivity', 'mouseSensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2));
    range('Gamepad sensitivity', 'padSensitivity', 0.3, 2.5, 0.05, (v) => v.toFixed(2));
    {
      const row = el('div', 'row', p);
      el('span', '', row, 'Invert camera Y');
      const input = el('input', '', el('span', 'v', row)) as HTMLInputElement;
      input.type = 'checkbox';
      input.addEventListener('change', () => settings.set('invertY', input.checked));
      this.settingRows.push({ sync: () => (input.checked = settings.value.invertY) });
    }
    range('Field of view', 'fov', 50, 85, 1, (v) => `${Math.round(v)}°`);
    range('Master volume', 'masterVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}`);
    range('Effects volume', 'sfxVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}`);
    range('Ambience volume', 'ambienceVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}`);
    {
      const row = el('div', 'row', p);
      el('span', '', row, 'Graphics quality');
      const sel = el('select', '', el('span', 'v', row)) as HTMLSelectElement;
      for (const q of ['low', 'medium', 'high']) {
        const o = el('option', '', sel, q[0].toUpperCase() + q.slice(1));
        (o as HTMLOptionElement).value = q;
      }
      const note = el('div', 'sub', p, '');
      note.style.marginTop = '10px';
      note.style.marginBottom = '0';
      sel.addEventListener('change', () => {
        settings.set('quality', sel.value as Quality);
        note.textContent = 'Some quality changes apply after reloading the page.';
      });
      this.settingRows.push({ sync: () => (sel.value = settings.value.quality) });
    }
    const m = el('div', 'menu', p);
    m.style.marginTop = '20px';
    this.button(m, 'Back', () => this.back());
  }

  private syncSettings(): void {
    for (const r of this.settingRows) r.sync();
  }

  private buildControls(): void {
    const s = this.screen('controls', 'dim');
    const p = el('div', 'panel', s);
    el('h2', '', p, 'Controls');
    el('div', 'sub', p, 'Keyboard & mouse · Gamepad');
    const t = el('div', 'controls-table', p);
    el('div', 'h', t, 'Action');
    el('div', 'h', t, 'Keyboard / Mouse');
    el('div', 'h', t, 'Gamepad');
    for (const [a, k, g] of CONTROLS) {
      el('div', '', t, escapeHtml(a));
      el('div', '', t, escapeHtml(k)).style.color = 'var(--ember-hot)';
      el('div', '', t, escapeHtml(g)).style.color = 'var(--dim)';
    }
    const m = el('div', 'menu', p);
    m.style.marginTop = '20px';
    this.button(m, 'Back', () => this.back());
  }

  private buildDeath(): void {
    const s = this.screen('death');
    s.style.background = 'radial-gradient(ellipse at center, rgba(20,0,0,0.35), rgba(0,0,0,0.85))';
    s.style.pointerEvents = 'none';
    this.deathText = el('div', 'death-text', s, 'THE FLAME GUTTERS');
    this.deathSub = el('div', 'death-sub', s, '');
  }

  showDeath(sub: string): void {
    this.deathText.classList.remove('show');
    this.deathSub.classList.remove('show');
    this.deathSub.textContent = sub;
    this.show('death');
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.deathText.classList.add('show');
        this.deathSub.classList.add('show');
      }),
    );
  }

  private shrinePanel!: HTMLDivElement;
  private buildShrine(): void {
    const s = this.screen('shrine', 'dim');
    s.style.background = 'radial-gradient(ellipse at center, rgba(40,20,5,0.25), rgba(0,0,0,0.75))';
    this.shrinePanel = el('div', 'panel', s);
  }

  openShrine(name: string, travel: { id: string; name: string }[], level: LevelInfo): void {
    this.shrineName = name;
    this.travelList = travel;
    this.levelInfo = level;
    this.show('shrine');
  }

  updateLevelInfo(level: LevelInfo): void {
    this.levelInfo = level;
  }

  private renderShrine(): void {
    const p = this.shrinePanel;
    p.innerHTML = '';
    el('h2', '', p, escapeHtml(this.shrineName));
    el('div', 'sub', p, 'The candle burns. For a while, nothing hunts you.');
    const m = el('div', 'menu', p);
    this.button(m, 'Offer Marrow', () => this.show('levelup', true));
    const tb = this.button(m, 'Travel', () => this.show('travel', true));
    if (this.travelList.length < 2) tb.disabled = true;
    this.button(m, 'Rise', () => this.cb.leaveShrine());
  }

  private levelPanel!: HTMLDivElement;
  private buildLevelUp(): void {
    const s = this.screen('levelup', 'dim');
    this.levelPanel = el('div', 'panel', s);
  }

  private renderLevelUp(): void {
    const info = this.levelInfo;
    if (!info) return;
    if (!this.pending) this.pending = { ...info.attrs };
    const base = info.attrs;
    const cur = this.pending;
    const lvl0 = levelOf(base);
    const lvl1 = levelOf(cur);
    let cost = 0;
    for (let l = lvl0; l < lvl1; l++) cost += levelCost(l);
    const nextCost = levelCost(lvl1);
    const p = this.levelPanel;
    p.innerHTML = '';
    el('h2', '', p, 'Offer Marrow');
    el('div', 'sub', p, 'The flame takes what the dead leave behind');
    const row = (label: string, v: string, up = false): void => {
      const r = el('div', 'row', p);
      el('span', '', r, label);
      el('span', `v ${up ? 'stat-up' : ''}`, r, v);
    };
    row('Level', lvl1 !== lvl0 ? `${lvl0} → ${lvl1}` : String(lvl0), lvl1 !== lvl0);
    row('Marrow held', (info.marrow - cost).toLocaleString('en-US'));
    row('Marrow for next level', nextCost.toLocaleString('en-US'));
    const sep = el('div', '', p);
    sep.style.height = '14px';
    const canAfford = info.marrow - cost >= nextCost;
    const stat = (key: keyof Attributes, label: string, desc: string): void => {
      const r = el('div', 'row', p);
      const left = el('span', '', r, `${label} <span style="color:var(--dim);font-size:14px;font-style:italic">${desc}</span>`);
      void left;
      const st = el('span', 'stepper', r);
      const dec = el('button', '', st, '−');
      dec.dataset.dec = '1';
      dec.dataset.stepper = '1';
      const num = el('span', `num ${cur[key] !== base[key] ? 'stat-up' : ''}`, st, String(cur[key]));
      void num;
      const inc = el('button', '', st, '+');
      inc.dataset.inc = '1';
      inc.dataset.stepper = '1';
      dec.disabled = cur[key] <= base[key];
      inc.disabled = !canAfford || cur[key] >= 60;
      dec.addEventListener('click', () => {
        if (cur[key] > base[key]) {
          cur[key]--;
          this.cb.move();
          this.renderLevelUp();
          this.refocus(key, 'dec');
        }
      });
      inc.addEventListener('click', () => {
        if (canAfford && cur[key] < 60) {
          cur[key]++;
          this.cb.move();
          this.renderLevelUp();
          this.refocus(key, 'inc');
        }
      });
      r.dataset.key = key;
    };
    stat('vigor', 'Vigor', 'health');
    stat('endurance', 'Endurance', 'stamina');
    stat('strength', 'Strength', 'damage');
    const sep2 = el('div', '', p);
    sep2.style.height = '14px';
    const dmg0 = damageMultiplier(base, info.dmgBonus);
    const dmg1 = damageMultiplier(cur, info.dmgBonus);
    row('Health', `${maxHealth(base)}${maxHealth(cur) !== maxHealth(base) ? ' → ' + maxHealth(cur) : ''}`, maxHealth(cur) !== maxHealth(base));
    row('Stamina', `${maxStamina(base)}${maxStamina(cur) !== maxStamina(base) ? ' → ' + maxStamina(cur) : ''}`, maxStamina(cur) !== maxStamina(base));
    row('Strike', `${Math.round(dmg0 * 100)}%${dmg1 !== dmg0 ? ' → ' + Math.round(dmg1 * 100) + '%' : ''}`, dmg1 !== dmg0);
    const m = el('div', 'menu', p);
    m.style.marginTop = '20px';
    const confirm = this.button(m, 'Confirm', () => {
      this.cb.levelUp({ ...cur }, cost);
      this.pending = null;
      this.back();
    });
    confirm.disabled = lvl1 === lvl0;
    this.button(m, 'Back', () => {
      this.pending = null;
      this.back();
    });
  }

  private refocus(key: string, which: 'inc' | 'dec'): void {
    const row = this.levelPanel.querySelector<HTMLElement>(`.row[data-key="${key}"]`);
    const b = row?.querySelector<HTMLButtonElement>(which === 'inc' ? '[data-inc]' : '[data-dec]');
    if (b && !b.disabled) b.focus();
    else row?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }

  private travelPanel!: HTMLDivElement;
  private buildTravel(): void {
    const s = this.screen('travel', 'dim');
    this.travelPanel = el('div', 'panel', s);
  }

  private renderTravel(): void {
    const p = this.travelPanel;
    p.innerHTML = '';
    el('h2', '', p, 'Travel');
    el('div', 'sub', p, 'Walk through the ash between candles');
    const m = el('div', 'menu', p);
    for (const t of this.travelList) this.button(m, t.name, () => this.cb.travel(t.id));
    this.button(m, 'Back', () => this.back());
  }

  private buildVictory(): void {
    const s = this.screen('victory');
    s.style.background = 'radial-gradient(ellipse at center, rgba(40,30,10,0.2), rgba(0,0,0,0.8))';
    this.victoryText = el('div', 'death-text victory', s, 'THE WICK-MOTHER IS UNMADE');
    this.victoryText.style.color = '#e8c070';
    this.victoryText.style.fontSize = 'clamp(30px, 4.6vw, 64px)';
    el('div', 'lore', s, 'The fog does not lift. But somewhere beneath the drowned bells, a flame steadies.').style.marginTop = '30px';
    const m = el('div', 'menu', s);
    this.button(m, 'Walk on', () => this.cb.resume());
  }

  showVictory(): void {
    this.victoryText.classList.remove('show');
    this.show('victory');
    requestAnimationFrame(() => requestAnimationFrame(() => this.victoryText.classList.add('show')));
  }
}
