import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Physics } from '../core/physics';
import { Rng } from '../core/math';
import type { MaterialLibrary } from './materials';
import type { MatId, Opening, Side, Structure, V3 } from './layout';

const CHUNK = 48;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();

/**
 * Collects static geometry per material and spatial chunk, creates matching
 * Rapier colliders, and merges everything into a handful of meshes so the
 * whole world costs a few dozen draw calls.
 */
export class StaticBuilder {
  private batches = new Map<string, { mat: MatId | 'vc'; geos: THREE.BufferGeometry[] }>();
  private rng = new Rng(4242);
  readonly meshes: THREE.Mesh[] = [];

  constructor(
    private readonly physics: Physics,
    private readonly mats: MaterialLibrary,
  ) {}

  private key(mat: string, x: number, z: number): string {
    return `${mat}|${Math.floor(x / CHUNK)}|${Math.floor(z / CHUNK)}`;
  }

  /** Add prepared world-space geometry (must have position/normal/uv, indexed). */
  addGeometry(geo: THREE.BufferGeometry, mat: MatId, at: THREE.Vector3): void {
    const k = this.key(mat, at.x, at.z);
    let b = this.batches.get(k);
    if (!b) {
      b = { mat, geos: [] };
      this.batches.set(k, b);
    }
    b.geos.push(geo);
  }

  /** Non-indexed vertex-colored geometry (baked corpses etc.). */
  addColored(geo: THREE.BufferGeometry, at: THREE.Vector3): void {
    const k = this.key('vc', at.x, at.z);
    let b = this.batches.get(k);
    if (!b) {
      b = { mat: 'vc', geos: [] };
      this.batches.set(k, b);
    }
    b.geos.push(geo);
  }

  // ---------------------------------------------------------------------------
  // Primitives
  // ---------------------------------------------------------------------------
  box(
    center: V3 | THREE.Vector3,
    size: V3,
    mat: MatId,
    opts: { ry?: number; rx?: number; rz?: number; col?: boolean; vis?: boolean } = {},
  ): void {
    const c = center instanceof THREE.Vector3 ? center : new THREE.Vector3(center[0], center[1], center[2]);
    const [w, h, d] = size;
    if (w <= 0.001 || h <= 0.001 || d <= 0.001) return;
    _e.set(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    if (opts.vis !== false) {
      const g = new THREE.BoxGeometry(w, h, d);
      this.scaleBoxUV(g, w, h, d, this.mats[mat].texScale);
      _m.compose(c, _q, _s.set(1, 1, 1));
      g.applyMatrix4(_m);
      this.addGeometry(g, mat, c);
    }
    if (opts.col !== false) this.physics.addStaticBox(c, new THREE.Vector3(w / 2, h / 2, d / 2), _q.clone());
  }

  private scaleBoxUV(g: THREE.BufferGeometry, w: number, h: number, d: number, s: number): void {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const ou = this.rng.next();
    const ov = this.rng.next();
    // faces: +x, -x, +y, -y, +z, -z (4 verts each)
    const dims: [number, number][] = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ];
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < 4; i++) {
        const idx = f * 4 + i;
        uv.setXY(idx, uv.getX(idx) * (dims[f][0] / s) + ou, uv.getY(idx) * (dims[f][1] / s) + ov);
      }
    }
  }

  cylinder(base: V3 | THREE.Vector3, r: number, h: number, mat: MatId, opts: { seg?: number; col?: boolean; rTop?: number } = {}): void {
    const b = base instanceof THREE.Vector3 ? base : new THREE.Vector3(base[0], base[1], base[2]);
    const seg = opts.seg ?? 12;
    const g = new THREE.CylinderGeometry(opts.rTop ?? r, r, h, seg, 1);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const s = this.mats[mat].texScale;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ((Math.PI * 2 * r) / s), uv.getY(i) * (h / s));
    g.translate(b.x, b.y + h / 2, b.z);
    this.addGeometry(g, mat, b);
    if (opts.col !== false) this.physics.addStaticCylinder(new THREE.Vector3(b.x, b.y + h / 2, b.z), h / 2, r);
  }

  // ---------------------------------------------------------------------------
  // Composite structures
  // ---------------------------------------------------------------------------
  build(s: Structure): void {
    switch (s.t) {
      case 'box':
        this.box(s.p, s.s, s.m, { ry: s.ry, rx: s.rx, rz: s.rz, col: s.col });
        break;
      case 'room':
        this.room(s);
        break;
      case 'stairs':
        this.stairs(s.a, s.b, s.w, s.m, s.sides, s.sideTop, s.sideM);
        break;
      case 'pillar':
        if (s.square) this.box([s.p[0], s.p[1] + s.h / 2, s.p[2]], [s.r * 2, s.h, s.r * 2], s.m);
        else {
          this.cylinder(s.p, s.r, s.h, s.m, { seg: 14 });
          // base and capital
          this.box([s.p[0], s.p[1] + 0.3, s.p[2]], [s.r * 2.6, 0.6, s.r * 2.6], s.m, { col: false });
          this.box([s.p[0], s.p[1] + s.h - 0.4, s.p[2]], [s.r * 2.5, 0.8, s.r * 2.5], s.m, { col: false });
        }
        break;
      case 'house':
        this.house(s);
        break;
      case 'tower':
        this.tower(s);
        break;
      case 'bridge':
        this.bridge(s.a, s.b, s.w, s.m, s.rail ?? true, s.arches ?? false);
        break;
      case 'boardwalk':
        this.boardwalk(s.pts, s.w, s.m);
        break;
      case 'arch':
        this.arch(s.p, s.ry, s.w, s.h, s.depth, s.m);
        break;
      case 'wall':
        this.wallLine(s.a, s.b, s.y, s.h, s.thick, s.m);
        break;
      case 'ribs':
        this.ribs(s.c, s.r, s.count);
        break;
      case 'altar':
        this.altar(s.p, s.ry);
        break;
    }
  }

  /** Wall along one axis with door/window openings. */
  private wallWithOpenings(
    axis: 'x' | 'z',
    from: number,
    to: number,
    fixed: number,
    thick: number,
    y: number,
    h: number,
    mat: MatId,
    openings: Opening[],
  ): void {
    const ops = openings.slice().sort((a, b) => a.at - b.at);
    let cursor = from;
    const seg = (a: number, b: number, y0: number, y1: number): void => {
      if (b - a < 0.01 || y1 - y0 < 0.01) return;
      const mid = (a + b) / 2;
      const cy = (y0 + y1) / 2;
      if (axis === 'x') this.box([mid, cy, fixed], [b - a, y1 - y0, thick], mat);
      else this.box([fixed, cy, mid], [thick, y1 - y0, b - a], mat);
    };
    for (const o of ops) {
      const a = o.at - o.w / 2;
      const b = o.at + o.w / 2;
      seg(cursor, a, y, y + h);
      const sill = o.sill ?? 0;
      seg(a, b, y, y + sill);
      seg(a, b, y + sill + o.h, y + h);
      cursor = b;
    }
    seg(cursor, to, y, y + h);
  }

  private room(s: Extract<Structure, { t: 'room' }>): void {
    const t = s.wall;
    const ft = s.floorThick ?? 0.5;
    const ops = s.openings ?? [];
    const on = (side: Side): Opening[] => ops.filter((o) => o.side === side);
    if (s.floor) this.box([(s.x0 + s.x1) / 2, s.y - ft / 2, (s.z0 + s.z1) / 2], [s.x1 - s.x0 + 2 * t, ft, s.z1 - s.z0 + 2 * t], s.floor);
    if (s.ceil) this.box([(s.x0 + s.x1) / 2, s.y + s.h + 0.3, (s.z0 + s.z1) / 2], [s.x1 - s.x0 + 2 * t, 0.6, s.z1 - s.z0 + 2 * t], s.ceil);
    this.wallWithOpenings('x', s.x0 - t, s.x1 + t, s.z0 - t / 2, t, s.y, s.h, s.m, on('n'));
    this.wallWithOpenings('x', s.x0 - t, s.x1 + t, s.z1 + t / 2, t, s.y, s.h, s.m, on('s'));
    this.wallWithOpenings('z', s.z0, s.z1, s.x0 - t / 2, t, s.y, s.h, s.m, on('w'));
    this.wallWithOpenings('z', s.z0, s.z1, s.x1 + t / 2, t, s.y, s.h, s.m, on('e'));
  }

  /** Visual steps + a smooth invisible ramp collider (+ optional side walls). */
  stairs(a0: V3, b0: V3, w: number, mat: MatId, sides?: number, sideTop?: number, sideM?: MatId): void {
    let a = a0;
    let b = b0;
    if (a[1] > b[1]) [a, b] = [b, a];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const run = Math.hypot(dx, dz);
    const rise = b[1] - a[1];
    const dirX = dx / run;
    const dirZ = dz / run;
    const yaw = Math.atan2(dirX, dirZ);
    const steps = Math.max(1, Math.round(rise / 0.3));
    const sr = run / steps;
    const sh = rise / steps;
    for (let i = 0; i < steps; i++) {
      const top = a[1] + (i + 1) * sh;
      const bottom = Math.max(a[1] - 0.4, top - Math.max(sh * 3, 1.2));
      const s = (i + 0.5) * sr;
      this.box([a[0] + dirX * s, (top + bottom) / 2, a[2] + dirZ * s], [w, top - bottom, sr + 0.02], mat, { ry: yaw, col: false });
    }
    // smooth ramp collider through the tread midpoints
    const len = Math.hypot(run, rise) + 0.6;
    const pitch = Math.atan2(rise, run);
    const thick = 0.3;
    const midY = a[1] + sh / 2 + rise / 2;
    const cx = a[0] + dirX * (run / 2) + Math.sin(pitch) * dirX * (thick / 2);
    const cz = a[2] + dirZ * (run / 2) + Math.sin(pitch) * dirZ * (thick / 2);
    const cy = midY - Math.cos(pitch) * (thick / 2);
    _e.set(-pitch, yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    this.physics.addStaticBox(new THREE.Vector3(cx, cy, cz), new THREE.Vector3(w / 2, thick / 2, len / 2), _q.clone());
    // side walls
    if (sides || sideTop !== undefined) {
      const segN = Math.max(2, Math.ceil(run / 2));
      const px = dirZ;
      const pz = -dirX;
      const tw = 0.5;
      for (let i = 0; i < segN; i++) {
        const s0 = (i / segN) * run;
        const s1 = ((i + 1) / segN) * run;
        const lineTop = a[1] + (s1 / run) * rise + (sides ?? 1.2);
        const top = Math.max(lineTop, sideTop ?? -1e9);
        const bottom = a[1] + (s0 / run) * rise - 1.2;
        const sm = (s0 + s1) / 2;
        for (const side of [-1, 1]) {
          const off = (w / 2 + tw / 2) * side;
          this.box(
            [a[0] + dirX * sm + px * off, (top + bottom) / 2, a[2] + dirZ * sm + pz * off],
            [tw, top - bottom, s1 - s0 + 0.02],
            sideM ?? mat,
            { ry: yaw },
          );
        }
      }
    }
  }

  private house(s: Extract<Structure, { t: 'house' }>): void {
    const [px, py, pz] = s.p;
    const cos = Math.cos(s.ry);
    const sin = Math.sin(s.ry);
    const P = (lx: number, ly: number, lz: number): V3 => [px + lx * cos + lz * sin, py + ly, pz - lx * sin + lz * cos];
    const t = 0.3;
    const hw = s.w / 2;
    const hd = s.d / 2;
    const B = (l: V3, size: V3, mat: MatId, rx = 0, rz = 0, col = true): void => this.box(P(l[0], l[1], l[2]), size, mat, { ry: s.ry, rx, rz, col });
    // floor
    B([0, -0.15, 0], [s.w, 0.3, s.d], 'wood');
    // walls (local axes), openings expressed along the local axis
    const door: Opening = { side: s.door, at: 0, w: 1.4, h: 2.2 };
    const win = (side: Side): Opening => ({ side, at: 0, w: 0.9, h: 1.0, sill: 1.1 });
    const wallH = (side: Side): number => (s.broken && (side === 'n' || side === 'w') ? s.h * (1 - s.broken) : s.h);
    const localWall = (side: Side): void => {
      const o = side === s.door ? door : win(side);
      const h = wallH(side);
      const along = side === 'n' || side === 's' ? s.w : s.d;
      const a0 = -along / 2;
      const a1 = along / 2;
      const oa = o.at - o.w / 2;
      const ob = o.at + o.w / 2;
      const segs: [number, number, number, number][] = [
        [a0, oa, 0, h],
        [ob, a1, 0, h],
        [oa, ob, 0, o.sill ?? 0],
        [oa, ob, (o.sill ?? 0) + o.h, h],
      ];
      for (const [u0, u1, y0, y1] of segs) {
        if (u1 - u0 < 0.01 || y1 - y0 < 0.01) continue;
        const um = (u0 + u1) / 2;
        const ym = (y0 + y1) / 2;
        if (side === 'n') B([um, ym, -hd + t / 2], [u1 - u0, y1 - y0, t], s.m);
        if (side === 's') B([um, ym, hd - t / 2], [u1 - u0, y1 - y0, t], s.m);
        if (side === 'w') B([-hw + t / 2, ym, um], [t, y1 - y0, u1 - u0], s.m);
        if (side === 'e') B([hw - t / 2, ym, um], [t, y1 - y0, u1 - u0], s.m);
      }
    };
    (['n', 's', 'e', 'w'] as Side[]).forEach(localWall);
    // corner posts
    for (const [x, z] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) B([x, s.h / 2, z], [0.35, s.h + 0.2, 0.35], 'wood', 0, 0, false);
    // roof
    if (s.roof !== 'none') {
      const pitch = 0.62;
      const halfSpan = hw + 0.5;
      const slabW = halfSpan / Math.cos(pitch);
      const ridgeY = s.h - 0.3 + Math.tan(pitch) * halfSpan;
      const yC = s.h - 0.3 + Math.tan(pitch) * halfSpan * 0.5;
      B([-halfSpan / 2, yC, 0], [slabW, 0.18, s.d + 0.8], 'roof', 0, pitch);
      if (s.roof === 'gable') B([halfSpan / 2, yC, 0], [slabW, 0.18, s.d + 0.8], 'roof', 0, -pitch);
      else {
        // exposed rafters on the fallen side
        for (let i = 0; i < 4; i++) B([halfSpan / 2, yC, -hd + 0.4 + (i * (s.d - 0.8)) / 3], [slabW, 0.15, 0.15], 'wood', 0, -pitch, false);
      }
      B([0, ridgeY + 0.05, 0], [0.2, 0.2, s.d + 0.9], 'wood', 0, 0, false);
      // gable ends
      for (const z of [-hd + t / 2, hd - t / 2]) {
        B([0, s.h + 0.35, z], [s.w * 0.7, 0.7, t], s.m, 0, 0, false);
        B([0, s.h + 0.95, z], [s.w * 0.35, 0.6, t], s.m, 0, 0, false);
      }
    }
    // stilts
    if (s.stilts) {
      for (const [x, z] of [[-hw + 0.2, -hd + 0.2], [hw - 0.2, -hd + 0.2], [-hw + 0.2, hd - 0.2], [hw - 0.2, hd - 0.2], [0, 0]]) {
        B([x, -s.stilts / 2, z], [0.25, s.stilts, 0.25], 'wetwood', 0, 0, false);
      }
    }
  }

  private tower(s: Extract<Structure, { t: 'tower' }>): void {
    const [px, py, pz] = s.p;
    const S = s.inner;
    const t = s.wall;
    const half = S / 2;
    // floor
    this.box([px, py - 0.25, pz], [S + 2 * t, 0.5, S + 2 * t], 'flag');
    // walls with door, exit and windows
    const ops: Opening[] = [];
    const along = (side: Side): number => (side === 'n' || side === 's' ? px : pz);
    ops.push({ side: s.door, at: along(s.door), w: 2.6, h: 3.4 });
    if (s.exit) ops.push({ side: s.exit, at: along(s.exit), w: 2.4, h: 2.8, sill: s.top });
    if (s.windows) {
      for (const side of ['n', 's', 'e', 'w'] as Side[]) {
        if (side === s.door) continue;
        ops.push({ side, at: along(side), w: 0.8, h: 1.6, sill: s.top * 0.45 });
      }
    }
    if (s.belfry) {
      for (const side of ['n', 's', 'e', 'w'] as Side[]) ops.push({ side, at: along(side) + (side === s.exit ? 1.8 : 0), w: 2.6, h: 2.8, sill: s.top + 0.9 });
    }
    const on = (side: Side): Opening[] => ops.filter((o) => o.side === side);
    this.wallWithOpenings('x', px - half - t, px + half + t, pz - half - t / 2, t, py, s.h, s.m, on('n'));
    this.wallWithOpenings('x', px - half - t, px + half + t, pz + half + t / 2, t, py, s.h, s.m, on('s'));
    this.wallWithOpenings('z', pz - half, pz + half, px - half - t / 2, t, py, s.h, s.m, on('w'));
    this.wallWithOpenings('z', pz - half, pz + half, px + half + t / 2, t, py, s.h, s.m, on('e'));

    // Switchback stairs around the inner walls
    const sw = s.stairW;
    const run = S - 2 * sw;
    const maxRise = run * Math.tan((31 * Math.PI) / 180);
    const n = Math.max(1, Math.ceil(s.top / maxRise));
    const dh = s.top / n;
    const order: Side[] = ['s', 'e', 'n', 'w'];
    let wallIdx = (order.indexOf(s.door) + 1) % 4;
    // corners in loop order: flight along wall k goes from corner k to corner k+1
    const corner = (side: Side, end: 0 | 1): [number, number] => {
      const c = half - sw / 2;
      switch (side) {
        case 'e':
          return end === 0 ? [c, c] : [c, -c];
        case 'n':
          return end === 0 ? [c, -c] : [-c, -c];
        case 'w':
          return end === 0 ? [-c, -c] : [-c, c];
        case 's':
          return end === 0 ? [-c, c] : [c, c];
      }
    };
    let lastSide: Side = 'e';
    for (let i = 0; i < n; i++) {
      const side = order[wallIdx];
      const [ax, az] = corner(side, 0);
      const [bx, bz] = corner(side, 1);
      const dx = Math.sign(bx - ax) * (sw / 2);
      const dz = Math.sign(bz - az) * (sw / 2);
      const y0 = py + i * dh;
      const y1 = py + (i + 1) * dh;
      this.stairs([px + ax + dx, y0, pz + az + dz], [px + bx - dx, y1, pz + bz - dz], sw, 'flag');
      // landing at the end corner
      if (i < n - 1) this.box([px + bx, y1 - 0.2, pz + bz], [sw, 0.4, sw], 'flag');
      lastSide = side;
      wallIdx = (wallIdx + 1) % 4;
    }
    // top floor with a notch over the last flight
    const topY = py + s.top;
    // notch = the last flight's strip plus its start corner (headroom for the landing)
    const strip = (side: Side): [number, number, number, number] => {
      switch (side) {
        case 'e':
          return [half - sw, -half + sw, half, half];
        case 'w':
          return [-half, -half, -half + sw, half - sw];
        case 'n':
          return [-half + sw, -half, half, -half + sw];
        case 's':
          return [-half, half - sw, half - sw, half];
      }
    };
    const [nx0, nz0, nx1, nz1] = strip(lastSide);
    // cover the interior minus the notch using up to 4 rectangles
    const rects: [number, number, number, number][] = [
      [-half, -half, half, nz0],
      [-half, nz1, half, half],
      [-half, nz0, nx0, nz1],
      [nx1, nz0, half, nz1],
    ];
    for (const [x0, z0, x1, z1] of rects) {
      if (x1 - x0 < 0.05 || z1 - z0 < 0.05) continue;
      this.box([px + (x0 + x1) / 2, topY - 0.2, pz + (z0 + z1) / 2], [x1 - x0, 0.4, z1 - z0], 'flag');
    }
    // roof
    if (s.roof === 'spire') {
      const g = new THREE.ConeGeometry((S + 2 * t) * 0.78, S * 1.1, 4, 1);
      g.rotateY(Math.PI / 4);
      g.translate(px, py + s.h + S * 0.55, pz);
      this.addGeometry(g, 'roof', new THREE.Vector3(px, py, pz));
      if (s.belfry) {
        this.box([px, py + s.h - 0.4, pz], [S + 2 * t, 0.4, S + 2 * t], 'wood', { col: false });
      }
    }
  }

  private bridge(a: V3, b: V3, w: number, mat: MatId, rail: boolean, arches: boolean): void {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const run = Math.hypot(dx, dz);
    const len = Math.hypot(run, dy);
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(dy, run);
    const c: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.25, (a[2] + b[2]) / 2];
    this.box(c, [w, 0.5, len], mat, { ry: yaw, rx: -pitch });
    if (rail) {
      const px = Math.cos(yaw);
      const pz = -Math.sin(yaw);
      for (const side of [-1, 1]) {
        const off = (w / 2 - 0.15) * side;
        this.box([c[0] + px * off, c[1] + 0.8, c[2] + pz * off], [0.3, 1.1, len], mat, { ry: yaw, rx: -pitch });
      }
    }
    if (arches) {
      for (const t of [0.3, 0.7]) {
        const x = a[0] + dx * t;
        const z = a[2] + dz * t;
        const top = a[1] + dy * t - 0.5;
        this.box([x, top - 20, z], [w * 0.8, 40, 1.6], mat, { ry: yaw, col: false });
      }
    }
  }

  private boardwalk(pts: V3[], w: number, mat: MatId): void {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const len = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      const c: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.08, (a[2] + b[2]) / 2];
      this.box(c, [w, 0.16, len + w * 0.5], mat, { ry: yaw });
      const px = Math.cos(yaw);
      const pz = -Math.sin(yaw);
      const posts = Math.max(1, Math.floor(len / 2.6));
      for (let k = 0; k <= posts; k++) {
        const t = k / posts;
        for (const side of [-1, 1]) {
          const x = a[0] + dx * t + px * (w / 2) * side;
          const z = a[2] + dz * t + pz * (w / 2) * side;
          this.box([x, a[1] - 1.2, z], [0.18, 2.6, 0.18], 'wood', { col: false });
        }
      }
    }
  }

  private arch(p: V3, ry: number, w: number, h: number, depth: number, mat: MatId): void {
    const cos = Math.cos(ry);
    const sin = Math.sin(ry);
    for (const side of [-1, 1]) {
      const lx = (w / 2 + 0.35) * side;
      this.box([p[0] + lx * cos, p[1] + h / 2, p[2] - lx * sin], [0.7, h, depth], mat, { ry });
    }
    this.box([p[0], p[1] + h + 0.4, p[2]], [w + 1.8, 0.8, depth + 0.2], mat, { ry });
  }

  private wallLine(a: [number, number], b: [number, number], y: number, h: number, thick: number, mat: MatId): void {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    this.box([(a[0] + b[0]) / 2, y + h / 2, (a[1] + b[1]) / 2], [thick, h, len], mat, { ry: yaw });
  }

  private ribs(c: V3, r: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const z = c[2] + (i - (count - 1) / 2) * 7.5;
      const rr = r * (1 - Math.abs(i - (count - 1) / 2) * 0.08);
      const g = new THREE.TorusGeometry(rr, 0.75, 8, 28, Math.PI);
      g.scale(1, 0.85, 1);
      g.rotateZ(0.02 * (i - 2));
      g.translate(c[0], c[1] - 1.5, z);
      this.addGeometry(g, 'bone', new THREE.Vector3(c[0], c[1], z));
      for (const side of [-1, 1]) this.physics.addStaticCylinder(new THREE.Vector3(c[0] + rr * side, c[1] + 1.5, z), 3, 1.1);
    }
    // the dead god's spine along the top
    const spine = new THREE.CylinderGeometry(1.1, 1.3, count * 7.5 + 6, 10);
    spine.rotateX(Math.PI / 2);
    spine.translate(c[0], c[1] - 1.5 + r * 0.85, c[2]);
    this.addGeometry(spine, 'bone', new THREE.Vector3(c[0], c[1], c[2]));
  }

  private altar(p: V3, ry: number): void {
    this.box([p[0], p[1] + 0.55, p[2]], [3.2, 1.1, 1.6], 'stone', { ry });
    this.box([p[0], p[1] + 1.15, p[2]], [3.5, 0.15, 1.8], 'stone', { ry });
    // the Vigil statue: a hooded kneeling figure holding up an empty lantern hook
    this.cylinder([p[0], p[1], p[2] - 2.2], 1.0, 3.2, 'stone', { rTop: 0.55, seg: 10 });
    const head = new THREE.SphereGeometry(0.55, 10, 8);
    head.translate(p[0], p[1] + 3.6, p[2] - 2.1);
    this.addGeometry(head, 'stone', new THREE.Vector3(p[0], p[1], p[2]));
    this.box([p[0] + 0.7, p[1] + 3.6, p[2] - 1.6], [0.3, 1.8, 0.3], 'stone', { rx: -0.6, col: false });
  }

  // ---------------------------------------------------------------------------
  finish(scene: THREE.Scene): void {
    for (const [k, b] of this.batches) {
      if (b.geos.length === 0) continue;
      let geo: THREE.BufferGeometry | null;
      if (b.mat === 'vc') {
        geo = mergeGeometries(b.geos, false);
      } else {
        for (const g of b.geos) {
          if (!g.index) continue;
          if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
          for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        }
        const indexed = b.geos.filter((g) => g.index);
        const nonIndexed = b.geos.filter((g) => !g.index);
        const parts: THREE.BufferGeometry[] = [];
        if (indexed.length) parts.push(mergeGeometries(indexed, false)!);
        if (nonIndexed.length) {
          for (const g of nonIndexed) {
            if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
          }
          parts.push(mergeGeometries(nonIndexed, false)!);
        }
        geo = parts.length === 1 ? parts[0] : mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
      }
      if (!geo) {
        console.warn('merge failed for', k);
        continue;
      }
      geo.computeBoundingSphere();
      const mat = b.mat === 'vc' ? this.mats.vertexColor : this.mats[b.mat].material;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `static:${k}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scene.add(mesh);
      this.meshes.push(mesh);
      for (const g of b.geos) if (g !== geo) g.dispose();
    }
    this.batches.clear();
  }
}
