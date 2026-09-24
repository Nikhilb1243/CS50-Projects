import { TERRAIN } from '../world/layout';

/**
 * Fog-of-war map. The play area is split into 4 m cells that are revealed
 * around the player; explored cells are tinted by region. Markers: shrines,
 * the boss, objectives and the player. The explored mask is saved.
 */
const CELL = 4;
const [X0, Z0, X1, Z1] = TERRAIN.play;
const W = Math.ceil((X1 - X0) / CELL);
const H = Math.ceil((Z1 - Z0) / CELL);

export interface MapMarker {
  x: number;
  z: number;
  kind: 'shrine' | 'shrine-lit' | 'boss' | 'objective' | 'objective-main' | 'note';
  label?: string;
}

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private explored = new Uint8Array(W * H);
  private tint: string[] = [];

  constructor(regionColor: (x: number, z: number) => string) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W * 3;
    this.canvas.height = H * 3;
    this.canvas.className = 'map-canvas';
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) this.tint.push(regionColor(X0 + (i + 0.5) * CELL, Z0 + (j + 0.5) * CELL));
  }

  reveal(x: number, z: number, r = 20): void {
    const ci = Math.floor((x - X0) / CELL);
    const cj = Math.floor((z - Z0) / CELL);
    const rc = Math.ceil(r / CELL);
    for (let j = cj - rc; j <= cj + rc; j++)
      for (let i = ci - rc; i <= ci + rc; i++) {
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        if ((i - ci) ** 2 + (j - cj) ** 2 <= rc * rc) this.explored[j * W + i] = 1;
      }
  }

  isExplored(x: number, z: number): boolean {
    const i = Math.floor((x - X0) / CELL);
    const j = Math.floor((z - Z0) / CELL);
    return i >= 0 && j >= 0 && i < W && j < H && this.explored[j * W + i] === 1;
  }

  serialize(): string {
    let s = '';
    for (let k = 0; k < this.explored.length; k += 8) {
      let b = 0;
      for (let q = 0; q < 8; q++) if (this.explored[k + q]) b |= 1 << q;
      s += String.fromCharCode(b);
    }
    return btoa(s);
  }

  load(data: string | undefined): void {
    this.explored.fill(0);
    if (!data) return;
    try {
      const s = atob(data);
      for (let k = 0; k < s.length; k++) {
        const b = s.charCodeAt(k);
        for (let q = 0; q < 8; q++) if (k * 8 + q < this.explored.length) this.explored[k * 8 + q] = (b >> q) & 1;
      }
    } catch {
      /* corrupt: start unexplored */
    }
  }

  draw(player: { x: number; z: number; yaw: number }, markers: MapMarker[]): void {
    const g = this.canvas.getContext('2d')!;
    const s = 3;
    g.fillStyle = '#07080a';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        if (!this.explored[j * W + i]) continue;
        g.fillStyle = this.tint[j * W + i];
        g.fillRect(i * s, j * s, s + 0.5, s + 0.5);
      }
    const px = (x: number): number => ((x - X0) / CELL) * s;
    const pz = (z: number): number => ((z - Z0) / CELL) * s;
    g.font = '11px Georgia, serif';
    g.textAlign = 'center';
    for (const m of markers) {
      const x = px(m.x);
      const y = pz(m.z);
      const known = m.kind.startsWith('objective') || this.isExplored(m.x, m.z);
      if (!known) continue;
      g.save();
      switch (m.kind) {
        case 'shrine':
        case 'shrine-lit':
          g.fillStyle = m.kind === 'shrine-lit' ? '#ffb060' : '#6a645c';
          g.beginPath();
          g.moveTo(x, y - 7);
          g.lineTo(x + 4, y + 4);
          g.lineTo(x - 4, y + 4);
          g.fill();
          break;
        case 'boss':
          g.strokeStyle = '#c0302a';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(x - 5, y - 5);
          g.lineTo(x + 5, y + 5);
          g.moveTo(x + 5, y - 5);
          g.lineTo(x - 5, y + 5);
          g.stroke();
          break;
        case 'objective':
        case 'objective-main':
          g.strokeStyle = m.kind === 'objective-main' ? '#9fd0ff' : '#5a7890';
          g.lineWidth = m.kind === 'objective-main' ? 2 : 1;
          g.beginPath();
          g.moveTo(x, y - 6);
          g.lineTo(x + 6, y);
          g.lineTo(x, y + 6);
          g.lineTo(x - 6, y);
          g.closePath();
          g.stroke();
          break;
        case 'note':
          g.fillStyle = '#d8d0c0';
          g.fillRect(x - 2, y - 3, 4, 6);
          break;
      }
      if (m.label) {
        g.fillStyle = 'rgba(220,210,190,0.8)';
        g.fillText(m.label, x, y - 10);
      }
      g.restore();
    }
    // player arrow (yaw 0 faces +z, which is down on the map)
    const x = px(player.x);
    const y = pz(player.z);
    g.save();
    g.translate(x, y);
    g.rotate(-player.yaw);
    g.fillStyle = '#f4ecd8';
    g.beginPath();
    g.moveTo(0, 8);
    g.lineTo(5, -5);
    g.lineTo(0, -2);
    g.lineTo(-5, -5);
    g.fill();
    g.restore();
  }
}
