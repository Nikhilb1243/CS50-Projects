import * as THREE from 'three';
import { el } from './dom';
import type { DebugFlags, GameContext } from '../core/context';
import { REGIONS } from '../world/layout';

export interface DebugActions {
  teleport(regionId: string): void;
  giveMarrow(n: number): void;
  killNearby(): void;
  refill(): void;
}

const MAX_VERTS = 24000;

/**
 * F1 debug overlay: FPS/frame stats, hitbox visualisation, god mode,
 * teleports to each region and a few cheats for testing.
 */
export class DebugOverlay {
  private panel: HTMLDivElement;
  private info: HTMLDivElement;
  private fpsEl: HTMLDivElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private frames = 0;
  private acc = 0;
  private fps = 0;
  private worst = 0;
  private lastT = 0;
  private lines: THREE.LineSegments;
  private positions = new Float32Array(MAX_VERTS * 3);
  private colors = new Float32Array(MAX_VERTS * 3);
  private count = 0;

  constructor(
    root: HTMLElement,
    readonly flags: DebugFlags,
    private ctx: () => GameContext,
    private actions: DebugActions,
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
  ) {
    this.fpsEl = el('div', 'fps', root);
    this.panel = el('div', 'debug', root);
    el('h3', '', this.panel, 'MOURNLIGHT · DEBUG (F1)');
    this.info = el('div', '', this.panel);
    el('div', 'sep', this.panel);
    const toggles = el('div', '', this.panel);
    this.toggle(toggles, 'hitboxes', 'Hitboxes [F2]');
    this.toggle(toggles, 'god', 'God mode [F3]');
    this.toggle(toggles, 'fps', 'FPS counter');
    el('div', 'sep', this.panel);
    const act = el('div', '', this.panel);
    this.btn(act, '+5000 Marrow [F4]', () => actions.giveMarrow(5000));
    this.btn(act, 'Kill nearby [F6]', () => actions.killNearby());
    this.btn(act, 'Refill [F7]', () => actions.refill());
    el('div', 'sep', this.panel);
    el('div', '', this.panel, 'Teleport (with debug open: keys 1–6)');
    const tp = el('div', '', this.panel);
    REGIONS.forEach((r, i) => this.btn(tp, `${i + 1} ${r.name}`, () => actions.teleport(r.id)));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9, fog: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 999;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  private toggle(parent: HTMLElement, key: 'hitboxes' | 'god' | 'fps', label: string): void {
    const b = el('button', '', parent, label);
    b.addEventListener('click', () => {
      this.flags[key] = !this.flags[key];
      this.sync();
    });
    this.buttons.set(key, b);
  }

  private btn(parent: HTMLElement, label: string, fn: () => void): void {
    const b = el('button', '', parent, label);
    b.addEventListener('click', fn);
  }

  sync(): void {
    for (const [k, b] of this.buttons) b.classList.toggle('on', !!this.flags[k as keyof DebugFlags]);
    this.panel.classList.toggle('show', this.flags.enabled);
    this.fpsEl.classList.toggle('show', this.flags.fps || this.flags.enabled);
  }

  handleKey(code: string): void {
    if (code === 'F1') {
      this.flags.enabled = !this.flags.enabled;
      this.sync();
      return;
    }
    if (!this.flags.enabled) return;
    if (code === 'F2') this.flags.hitboxes = !this.flags.hitboxes;
    else if (code === 'F3') this.flags.god = !this.flags.god;
    else if (code === 'F4') this.actions.giveMarrow(5000);
    else if (code === 'F6') this.actions.killNearby();
    else if (code === 'F7') this.actions.refill();
    else if (code.startsWith('Digit')) {
      const n = Number(code.slice(5)) - 1;
      if (REGIONS[n]) this.actions.teleport(REGIONS[n].id);
    }
    this.sync();
  }

  update(realDt: number, extra: string): void {
    // wall-clock frame time: the loop's realDt is clamped, which would flatter slow frames
    const now = performance.now();
    const ft = this.lastT > 0 ? (now - this.lastT) / 1000 : realDt;
    this.lastT = now;
    this.frames++;
    this.acc += ft;
    this.worst = Math.max(this.worst, ft);
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.fpsEl.textContent = `${this.fps.toFixed(0)} fps · worst ${(this.worst * 1000).toFixed(1)} ms`;
      this.frames = 0;
      this.acc = 0;
      this.worst = 0;
      if (this.flags.enabled) {
        const ri = this.renderer.info;
        const c = this.ctx();
        const p = c.player;
        this.info.innerHTML = [
          `draw calls ${ri.render.calls} · tris ${(ri.render.triangles / 1000).toFixed(0)}k`,
          `geometries ${ri.memory.geometries} · textures ${ri.memory.textures}`,
          `pos ${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)}`,
          `state ${p.state} · grounded ${p.grounded}`,
          `hp ${p.health.toFixed(0)}/${p.maxHealth} · st ${p.stamina.toFixed(0)}`,
          `awake enemies ${c.enemies.filter((e) => !e.sleeping && e.alive).length}/${c.enemies.length}`,
          extra,
        ].join('<br>');
      }
    }
    this.drawHitboxes();
  }

  private seg(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Color): void {
    if (this.count + 2 > MAX_VERTS) return;
    const i = this.count * 3;
    this.positions.set([a.x, a.y, a.z, b.x, b.y, b.z], i);
    this.colors.set([c.r, c.g, c.b, c.r, c.g, c.b], i);
    this.count += 2;
  }

  private capsule(a: THREE.Vector3, b: THREE.Vector3, r: number, c: THREE.Color): void {
    const n = 12;
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    for (const center of [a, b]) {
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        p0.set(center.x + Math.cos(a0) * r, center.y, center.z + Math.sin(a0) * r);
        p1.set(center.x + Math.cos(a1) * r, center.y, center.z + Math.sin(a1) * r);
        this.seg(p0, p1, c);
      }
    }
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      const ox = Math.cos(ang) * r;
      const oz = Math.sin(ang) * r;
      this.seg(p0.set(a.x + ox, a.y, a.z + oz), p1.set(b.x + ox, b.y, b.z + oz), c);
    }
    this.seg(a, b, c);
  }

  private drawHitboxes(): void {
    this.lines.visible = this.flags.hitboxes;
    if (!this.flags.hitboxes) return;
    this.count = 0;
    const ctx = this.ctx();
    const boxes: { a: THREE.Vector3; b: THREE.Vector3; r: number }[] = [];
    const green = new THREE.Color(0.2, 1, 0.3);
    const yellow = new THREE.Color(1, 0.9, 0.2);
    const red = new THREE.Color(1, 0.15, 0.1);
    for (const c of ctx.combat.combatants) {
      if (!c.alive || c.pos.distanceTo(ctx.player.pos) > 45) continue;
      boxes.length = 0;
      c.hurtboxes(boxes);
      for (const hb of boxes) this.capsule(hb.a, hb.b, hb.r, c.team === 'player' ? green : yellow);
    }
    for (const s of ctx.combat.debugSweeps) this.capsule(s.a, s.b, s.r, red);
    const g = this.lines.geometry;
    g.setDrawRange(0, this.count);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}
