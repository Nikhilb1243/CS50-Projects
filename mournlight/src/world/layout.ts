/**
 * MOURNLIGHT world layout (data file).
 *
 * One seamless map. Coordinates: +X east, -Z north, +Y up, meters.
 *
 *                 N (-Z)
 *        [ The Godwound (boss) ]            z -172
 *        [ Cathedral of the Last Vigil ]    z -122 .. -50   (plateau y 14)
 *  Drowned Stair ramp  |  Undercroft tower  |  bridge over the ravine
 *   [ Brinemoor ]  <-  [ The Barrow Road ]  ->  [ Gallowwood ]  (ridge y 14)
 *                      [ The Wick Ossuary ]                  z 80 .. 142  (underground, y -9)
 *                 S (+Z)
 *
 * Everything here is plain data; world.ts interprets it.
 */
import type { EnemyType } from '../data/enemies';

export type V3 = [number, number, number];
export type MatId = 'stone' | 'darkstone' | 'flag' | 'wood' | 'wetwood' | 'plaster' | 'rock' | 'roof' | 'iron' | 'bone' | 'wax';
export type Side = 'n' | 's' | 'e' | 'w';

export interface Opening {
  side: Side;
  at: number;
  w: number;
  h: number;
  sill?: number;
}

export type Structure =
  | { t: 'box'; p: V3; s: V3; ry?: number; rx?: number; rz?: number; m: MatId; col?: boolean }
  | { t: 'room'; x0: number; x1: number; z0: number; z1: number; y: number; h: number; wall: number; m: MatId; floor: MatId | null; ceil: MatId | null; openings?: Opening[]; floorThick?: number }
  | { t: 'stairs'; a: V3; b: V3; w: number; m: MatId; sides?: number; sideTop?: number; sideM?: MatId }
  | { t: 'pillar'; p: V3; r: number; h: number; m: MatId; square?: boolean }
  | { t: 'house'; p: V3; w: number; d: number; h: number; ry: number; door: Side; roof: 'gable' | 'ruin' | 'none'; m: MatId; stilts?: number; broken?: number }
  | { t: 'tower'; p: V3; inner: number; wall: number; h: number; top: number; m: MatId; door: Side; exit?: Side; stairW: number; roof: 'spire' | 'open' | 'none'; windows?: boolean; belfry?: boolean }
  | { t: 'bridge'; a: V3; b: V3; w: number; m: MatId; rail?: boolean; arches?: boolean }
  | { t: 'boardwalk'; pts: V3[]; w: number; m: MatId }
  | { t: 'arch'; p: V3; ry: number; w: number; h: number; depth: number; m: MatId }
  | { t: 'wall'; a: [number, number]; b: [number, number]; y: number; h: number; thick: number; m: MatId }
  | { t: 'ribs'; c: V3; r: number; count: number }
  | { t: 'altar'; p: V3; ry: number };

export interface TerrainMod {
  kind: 'flat' | 'ellipse' | 'ramp' | 'trench' | 'circle' | 'raise';
  /** rect for flat: [x0, z0, x1, z1] */
  rect?: [number, number, number, number];
  c?: [number, number];
  r?: [number, number] | number;
  a?: [number, number, number];
  b?: [number, number, number];
  w?: number;
  h?: number;
  blend: number;
  noise?: number;
  op?: 'set' | 'min' | 'max';
}

export interface RegionDef {
  id: string;
  name: string;
  /** Test shapes: rect [x0,z0,x1,z1] with optional y range. */
  rect?: [number, number, number, number];
  circle?: [number, number, number];
  yMin?: number;
  yMax?: number;
  fogColor: number;
  fogDensity: number;
  ambient: number;
  moon: number;
  dread: number;
  reverb: number;
  drone: 'crypt' | 'road' | 'water' | 'forest' | 'choir' | 'wound';
  spawn: V3;
}

export interface ShrineDef {
  id: string;
  name: string;
  p: V3;
  yaw: number;
}

export interface EnemySpawn {
  type: EnemyType;
  p: V3;
  yaw?: number;
  patrol?: V3[];
  /** Crawler ambush surface. */
  cling?: 'ceiling' | 'wall';
  /** Outward normal of the wall when clinging to a wall. */
  n?: V3;
}

export type ItemKind = 'marrow' | 'vessel' | 'oil' | 'whetstone' | 'greatsword' | 'daggers' | 'bow';

export interface ItemDef {
  id: string;
  kind: ItemKind;
  p: V3;
  amount?: number;
}

export interface DoorDef {
  id: string;
  p: V3;
  yaw: number;
  w: number;
  h: number;
  /** Which side may lift the bar: 'front' is along the yaw direction. */
  openFrom: 'front' | 'back';
}

export interface MessageDef {
  p: V3;
  yaw: number;
  text: string;
  kind: 'scrawl' | 'carved';
  size?: [number, number];
}

export interface HintDef {
  p: V3;
  r: number;
  kb: string;
  pad: string;
}

export interface CorpseDef {
  p: V3;
  yaw: number;
  pose: 'crawl' | 'reach' | 'slump' | 'hang' | 'curl';
}

export interface CageDef {
  p: V3;
  drop: number;
  body?: boolean;
}

export interface FlameDef {
  p: V3;
  kind: 'brazier' | 'candles' | 'sconce' | 'arena';
  intensity?: number;
}

// ===========================================================================
// Terrain
// ===========================================================================
export const TERRAIN = {
  size: 400,
  cells: 200,
  center: [0, -25] as [number, number],
  play: [-178, -206, 178, 156] as [number, number, number, number],
  waterLevel: -0.55,
  waterRect: [-178, -48, -52, 96] as [number, number, number, number],
};

export const TERRAIN_MODS: TerrainMod[] = [
  // Brinemoor: drowned basin with islands
  { kind: 'ellipse', c: [-114, 22], r: [60, 72], h: -1.55, blend: 16, noise: 0.35 },
  { kind: 'circle', c: [-82, 30], r: 9, h: 0.35, blend: 3 },
  { kind: 'circle', c: [-97, 45], r: 10, h: 0.4, blend: 3 },
  { kind: 'circle', c: [-108, 16], r: 8, h: 0.35, blend: 3 },
  { kind: 'circle', c: [-128, -12], r: 9, h: 0.35, blend: 3 },
  { kind: 'circle', c: [-141, 30], r: 7, h: 0.35, blend: 3 },
  { kind: 'circle', c: [-120, 62], r: 7, h: 0.35, blend: 3 },
  { kind: 'circle', c: [-100, -8], r: 6, h: 0.35, blend: 3 },
  { kind: 'circle', c: [-78, -12], r: 7, h: 0.35, blend: 3 },

  // Barrow over the Wick Ossuary
  { kind: 'flat', rect: [-26, 62, 26, 152], h: 1.5, blend: 12, noise: 0.1 },
  { kind: 'flat', rect: [-19, 74, 19, 146], h: -9.2, blend: 0.1, op: 'min' },
  { kind: 'trench', a: [0, 82, -9.3], b: [0, 58, 1.2], w: 6.4, blend: 0.1 },

  // Cathedral plateau and its cliffs
  { kind: 'flat', rect: [-52, -210, 52, -36], h: 14, blend: 3.5, noise: 0.15, op: 'max' },
  // Undercroft tower footing at the cliff base
  { kind: 'flat', rect: [-9, -33, 9, -15], h: 0.6, blend: 3 },
  // The Godwound crater
  { kind: 'circle', c: [0, -172], r: 26, h: 4, blend: 5, op: 'min' },
  { kind: 'trench', a: [0, -120, 14.0], b: [0, -150, 3.9], w: 7.4, blend: 0.1 },

  // The Drowned Stair: causeway climbing from Brinemoor to the plateau
  { kind: 'ramp', a: [-75, -14, 0.2], b: [-51, -66, 14], w: 8, blend: 2.5 },

  // Gallowwood ridge and the ravine that splits it from the plateau
  { kind: 'flat', rect: [68, -126, 122, -64], h: 14, blend: 28, noise: 0.6, op: 'max' },
  { kind: 'flat', rect: [54, -170, 65, -6], h: -24, blend: 2.2, op: 'min' },
  // Sunken hollow (optional area)
  { kind: 'circle', c: [148, 118], r: 12, h: -3.5, blend: 9, op: 'min' },
  // Forest shrine clearing
  { kind: 'circle', c: [104, 44], r: 9, h: 1.0, blend: 6 },
];

// ===========================================================================
// Regions
// ===========================================================================
export const REGIONS: RegionDef[] = [
  { id: 'crypt', name: 'The Wick Ossuary', rect: [-22, 56, 22, 150], yMax: -1, fogColor: 0x08090b, fogDensity: 0.03, ambient: 0.32, moon: 0.0, dread: 0.25, reverb: 0.55, drone: 'crypt', spawn: [0, -9, 136] },
  { id: 'arena', name: 'The Godwound', circle: [0, -172, 34], yMax: 12, fogColor: 0x151013, fogDensity: 0.017, ambient: 0.36, moon: 0.8, dread: 0.4, reverb: 0.35, drone: 'wound', spawn: [0, 4.2, -152] },
  { id: 'cathedral', name: 'Cathedral of the Last Vigil', rect: [-60, -150, 60, -34], yMin: 9, fogColor: 0x121418, fogDensity: 0.024, ambient: 0.36, moon: 0.9, dread: 0.3, reverb: 0.5, drone: 'choir', spawn: [0, 14.4, -46] },
  { id: 'village', name: 'Brinemoor', rect: [-180, -60, -58, 110], fogColor: 0x131a1b, fogDensity: 0.026, ambient: 0.38, moon: 0.9, dread: 0.2, reverb: 0.12, drone: 'water', spawn: [-74, 0.4, 27] },
  { id: 'forest', name: 'Gallowwood', rect: [52, -170, 180, 160], fogColor: 0x121513, fogDensity: 0.03, ambient: 0.32, moon: 0.8, dread: 0.3, reverb: 0.08, drone: 'forest', spawn: [104, 1, 50] },
  { id: 'road', name: 'The Barrow Road', rect: [-60, -40, 60, 160], fogColor: 0x151a20, fogDensity: 0.022, ambient: 0.38, moon: 1.0, dread: 0.12, reverb: 0.06, drone: 'road', spawn: [0, 1.6, 55] },
];

// ===========================================================================
// Structures
// ===========================================================================
const S: Structure[] = [];

// ---- The Wick Ossuary (underground crypt, floor y -9) ----------------------
const CY = -9;
S.push(
  // capstone over the barrow (hides the carved-out basin)
  { t: 'box', p: [-11.75, 1.25, 110.5], s: [18.5, 0.5, 78], m: 'flag' },
  { t: 'box', p: [11.75, 1.25, 110.5], s: [18.5, 0.5, 78], m: 'flag' },
  { t: 'box', p: [0, 1.25, 110.85], s: [5.1, 0.5, 77.3], m: 'flag' },
  // Room A: Sarcophagus Hall (awakening)
  { t: 'room', x0: -8, x1: 8, z0: 126, z1: 142, y: CY, h: 6, wall: 1, m: 'darkstone', floor: 'flag', ceil: 'darkstone', openings: [{ side: 'n', at: 0, w: 3.2, h: 3 }] },
  // Corridor A-B
  { t: 'room', x0: -1.8, x1: 1.8, z0: 118, z1: 126, y: CY, h: 3, wall: 1, m: 'darkstone', floor: 'flag', ceil: 'darkstone', openings: [{ side: 'n', at: 0, w: 3.6, h: 3 }, { side: 's', at: 0, w: 3.6, h: 3 }] },
  // Room B: Ossuary
  { t: 'room', x0: -11, x1: 11, z0: 100, z1: 118, y: CY, h: 6.5, wall: 1, m: 'darkstone', floor: 'flag', ceil: 'darkstone', openings: [{ side: 's', at: 0, w: 3.2, h: 3 }, { side: 'n', at: 0, w: 3.2, h: 3 }, { side: 'e', at: 107, w: 3, h: 3 }] },
  // Ossuary side alcove (optional loot, crawler overhead)
  { t: 'room', x0: 12, x1: 18, z0: 103, z1: 111, y: CY, h: 3.4, wall: 1, m: 'darkstone', floor: 'flag', ceil: 'darkstone', openings: [{ side: 'w', at: 107, w: 3, h: 3 }] },
  // Corridor B-C
  { t: 'room', x0: -1.8, x1: 1.8, z0: 94, z1: 100, y: CY, h: 3, wall: 1, m: 'darkstone', floor: 'flag', ceil: 'darkstone', openings: [{ side: 'n', at: 0, w: 3.6, h: 3 }, { side: 's', at: 0, w: 3.6, h: 3 }] },
  // Room C: Chapel of the First Wick (shrine)
  { t: 'room', x0: -8, x1: 8, z0: 81, z1: 94, y: CY, h: 6, wall: 1, m: 'darkstone', floor: 'flag', ceil: 'darkstone', openings: [{ side: 's', at: 0, w: 3.2, h: 3 }, { side: 'n', at: 0, w: 4, h: 4.2 }] },
  // Exit stair rising north to the barrow top
  { t: 'stairs', a: [0, CY, 80], b: [0, 1.5, 59], w: 4, m: 'flag', sides: 2.5, sideTop: 2.3, sideM: 'darkstone' },
  { t: 'box', p: [0, 0.1, 76.5], s: [5.2, 1.8, 8.6], m: 'darkstone' }, // tunnel roof under capstone
);
// Ossuary pillars and sarcophagi
for (const z of [104, 110, 116]) {
  for (const x of [-6, 6]) S.push({ t: 'pillar', p: [x, CY, z], r: 0.55, h: 6.5, m: 'darkstone', square: true });
}
for (let i = 0; i < 4; i++) {
  S.push({ t: 'box', p: [-5.2, CY + 0.5, 128.5 + i * 3.6], s: [1.2, 1, 2.4], m: 'stone' });
  S.push({ t: 'box', p: [5.2, CY + 0.5, 128.5 + i * 3.6], s: [1.2, 1, 2.4], m: 'stone' });
}
S.push({ t: 'box', p: [0, CY + 0.55, 139], s: [1.6, 1.1, 2.8], m: 'stone' }); // the Revenant's own opened sarcophagus
S.push({ t: 'box', p: [1.4, CY + 0.2, 139], s: [0.5, 0.4, 2.8], m: 'stone', ry: 0.4 }); // pushed lid
// bone shelves in the Ossuary
for (const z of [102, 108, 114]) {
  S.push({ t: 'box', p: [-10.6, CY + 1.4, z], s: [0.8, 0.12, 4], m: 'bone' });
  S.push({ t: 'box', p: [-10.6, CY + 2.6, z], s: [0.8, 0.12, 4], m: 'bone' });
}
// Crypt mouth: arch and parapets at the barrow top
S.push(
  { t: 'arch', p: [0, 1.5, 59.5], ry: 0, w: 5, h: 4.5, depth: 1.2, m: 'darkstone' },
  { t: 'pillar', p: [-4.2, 1.5, 58], r: 0.35, h: 2.2, m: 'stone', square: true },
  { t: 'pillar', p: [4.2, 1.5, 58], r: 0.35, h: 2.2, m: 'stone', square: true },
);

// ---- The Barrow Road -------------------------------------------------------
S.push(
  // gallows
  { t: 'box', p: [-14, 2.4, 14], s: [0.35, 5, 0.35], m: 'wood' },
  { t: 'box', p: [-8, 2.4, 14], s: [0.35, 5, 0.35], m: 'wood' },
  { t: 'box', p: [-11, 4.95, 14], s: [7, 0.35, 0.35], m: 'wood' },
  { t: 'box', p: [-11, 0.35, 14], s: [7.5, 0.5, 2.6], m: 'wood' },
  // wrecked cart
  { t: 'box', p: [18, 0.95, 8], s: [2.2, 0.25, 3.6], m: 'wood', ry: 0.4, rz: 0.25 },
  { t: 'box', p: [19.2, 0.8, 7.2], s: [0.2, 1.2, 1.2], m: 'wood', ry: 0.4 },
  // roadside wayshrine ruin
  { t: 'box', p: [-26, 1.2, -6], s: [3, 2.4, 0.6], m: 'stone' },
  { t: 'box', p: [-27.3, 1.8, -4.6], s: [0.5, 3.6, 0.5], m: 'stone' },
  // low retaining wall along the cliff foot
  { t: 'wall', a: [-50, -34.5], b: [-8.5, -34.5], y: 0, h: 15, thick: 1.6, m: 'stone' },
  { t: 'wall', a: [8.5, -34.5], b: [51, -34.5], y: 0, h: 15, thick: 1.6, m: 'stone' },
  // ravine fence
  { t: 'wall', a: [50.4, -3], b: [69, -3], y: 0.3, h: 1.1, thick: 0.3, m: 'wood' },
  { t: 'wall', a: [50.4, -33.5], b: [50.4, -3], y: 0.3, h: 1.1, thick: 0.3, m: 'wood' },
  // forest signboard
  { t: 'box', p: [96, 2.2, 52], s: [0.15, 1.4, 3], m: 'wood' },
  { t: 'box', p: [96, 1.0, 50.8], s: [0.2, 2.4, 0.2], m: 'wood' },
  { t: 'box', p: [96, 1.0, 53.2], s: [0.2, 2.4, 0.2], m: 'wood' },
  // gallows sign
  { t: 'box', p: [87, 2.9, 70.22], s: [4.8, 1.4, 0.1], m: 'wood' },
);

// ---- Undercroft tower (shortcut) ------------------------------------------
S.push(
  { t: 'tower', p: [0, 0.6, -26], inner: 9.4, wall: 1.2, h: 16.4, top: 14.2, m: 'stone', door: 's', exit: 'n', stairW: 2.3, roof: 'open', windows: true },
  { t: 'bridge', a: [0, 14.2, -31.6], b: [0, 14.2, -38.5], w: 3.2, m: 'stone', rail: true },
);

// ---- Brinemoor --------------------------------------------------------------
S.push(
  { t: 'house', p: [-83, 0.4, 32], w: 6, d: 7, h: 3.4, ry: 0.2, door: 'e', roof: 'ruin', m: 'plaster', broken: 0.3 },
  { t: 'house', p: [-106, 0.4, 20], w: 5.5, d: 6, h: 3.2, ry: -0.3, door: 's', roof: 'gable', m: 'plaster' },
  { t: 'house', p: [-111, 0.4, 11], w: 5, d: 5, h: 3.0, ry: 0.6, door: 'e', roof: 'ruin', m: 'wood', broken: 0.5 },
  { t: 'house', p: [-141, 0.4, 31], w: 6, d: 6.5, h: 3.4, ry: 0.1, door: 'e', roof: 'gable', m: 'plaster' },
  { t: 'house', p: [-120, 0.4, 63], w: 6.5, d: 6, h: 3.4, ry: -0.5, door: 's', roof: 'ruin', m: 'plaster', broken: 0.2 },
  { t: 'house', p: [-100, 0.4, -9], w: 5, d: 5.5, h: 3, ry: 0.9, door: 'n', roof: 'gable', m: 'wood' },
  { t: 'house', p: [-80, 0.4, -9], w: 5, d: 5, h: 3, ry: -0.2, door: 'w', roof: 'ruin', m: 'plaster', broken: 0.4 },
  // stilt houses over the water
  { t: 'house', p: [-92, 0.75, 12], w: 4.5, d: 4.5, h: 2.8, ry: 0.4, door: 'w', roof: 'gable', m: 'wood', stilts: 2.6 },
  { t: 'house', p: [-126, 0.75, 42], w: 4.5, d: 5, h: 2.8, ry: -0.2, door: 'e', roof: 'ruin', m: 'wood', stilts: 2.6, broken: 0.3 },
  // Chapel (shrine 2)
  { t: 'room', x0: -101, x1: -93, z0: 38, z1: 51, y: 0.45, h: 6, wall: 0.8, m: 'stone', floor: 'flag', ceil: null, openings: [{ side: 'e', at: 46, w: 2.6, h: 3.4 }, { side: 'w', at: 44, w: 1.2, h: 2.4, sill: 2 }, { side: 's', at: -97, w: 1.4, h: 2.8, sill: 1.6 }] },
  { t: 'box', p: [-97, 6.75, 41], s: [9.6, 0.4, 7], m: 'roof', rx: 0.25 },
  // Bell tower (loot at the top)
  { t: 'tower', p: [-128, 0.4, -12], inner: 7.2, wall: 1, h: 19, top: 15.2, m: 'stone', door: 'e', stairW: 1.8, roof: 'spire', windows: true, belfry: true },
);
// boardwalks linking islands (deck y 0.35)
const BW = 0.35;
S.push(
  { t: 'boardwalk', pts: [[-66, BW, 30], [-74, BW, 30]], w: 2.4, m: 'wetwood' },
  { t: 'boardwalk', pts: [[-88, BW, 36], [-92, BW, 40]], w: 2.2, m: 'wetwood' },
  { t: 'boardwalk', pts: [[-86, BW, 24], [-92, BW, 16], [-101, BW, 16]], w: 2.2, m: 'wetwood' },
  { t: 'boardwalk', pts: [[-112, BW, 10], [-120, BW, -4]], w: 2.2, m: 'wetwood' },
  { t: 'boardwalk', pts: [[-114, BW, 20], [-126, BW, 26], [-135, BW, 28]], w: 2.2, m: 'wetwood' },
  { t: 'boardwalk', pts: [[-100, BW, 53], [-114, BW, 58]], w: 2.2, m: 'wetwood' },
  { t: 'boardwalk', pts: [[-104, BW, 10], [-101, BW, -2]], w: 2.2, m: 'wetwood' },
  { t: 'boardwalk', pts: [[-94, BW, -8], [-85, BW, -10]], w: 2.2, m: 'wetwood' },
  { t: 'boardwalk', pts: [[-121, BW, 45], [-126, BW, 52]], w: 2, m: 'wetwood' },
);
// Drowned Stair parapets: short wall segments stepping up both sides of the causeway
{
  const a = [-75, -14, 0.2];
  const b = [-51, -66, 14];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const px = -dz / len;
  const pz = dx / len;
  const segs = 14;
  for (let i = 0; i < segs; i++) {
    if (i === 6) continue; // gap: a way down into the water
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const y = a[2] + (b[2] - a[2]) * t0;
    for (const side of [-1, 1]) {
      const off = 4.1 * side;
      S.push({
        t: 'wall',
        a: [a[0] + dx * t0 + px * off, a[1] + dz * t0 + pz * off],
        b: [a[0] + dx * t1 + px * off, a[1] + dz * t1 + pz * off],
        y: y - 1.2,
        h: 2.2 + (b[2] - a[2]) / segs,
        thick: 0.6,
        m: 'stone',
      });
    }
  }
}

// ---- Gallowwood -------------------------------------------------------------
S.push(
  // wayside shrine gazebo
  { t: 'pillar', p: [100, 1.0, 40], r: 0.3, h: 4, m: 'stone', square: true },
  { t: 'pillar', p: [108, 1.0, 40], r: 0.3, h: 4, m: 'stone', square: true },
  { t: 'pillar', p: [100, 1.0, 48], r: 0.3, h: 4, m: 'stone', square: true },
  { t: 'box', p: [104, 5.2, 44], s: [9.6, 0.4, 9.6], m: 'roof', rz: 0.08 },
  // gallows trees platform
  { t: 'box', p: [84, 1.5, 70], s: [0.4, 6, 0.4], m: 'wood' },
  { t: 'box', p: [90, 1.5, 70], s: [0.4, 6, 0.4], m: 'wood' },
  { t: 'box', p: [87, 4.4, 70], s: [7, 0.4, 0.4], m: 'wood' },
  // watch ruin on the ridge (loot at the top)
  { t: 'tower', p: [96, 14, -98], inner: 6.4, wall: 1, h: 9, top: 7.2, m: 'stone', door: 's', stairW: 1.7, roof: 'none', windows: true },
  // bridge across the ravine to the cathedral plateau
  { t: 'bridge', a: [47, 14.1, -78], b: [71, 14.1, -78], w: 3.6, m: 'stone', rail: true, arches: true },
);

// ---- Cathedral of the Last Vigil (floor y 14.3) ------------------------------
const K = 14.3;
S.push(
  {
    t: 'room', x0: -24, x1: 24, z0: -122, z1: -50, y: K, h: 20, wall: 1.4, m: 'stone', floor: 'flag', ceil: null, floorThick: 1.2,
    openings: [
      { side: 's', at: 0, w: 6, h: 9 },
      { side: 's', at: -16, w: 2.5, h: 6, sill: 9 },
      { side: 's', at: 16, w: 2.5, h: 6, sill: 9 },
      { side: 'w', at: -70, w: 4, h: 5 },
      { side: 'e', at: -78, w: 4, h: 5 },
      { side: 'n', at: 0, w: 4, h: 5 },
      { side: 'w', at: -60, w: 2, h: 5, sill: 9 },
      { side: 'w', at: -84, w: 2, h: 5, sill: 9 },
      { side: 'w', at: -98, w: 2, h: 5, sill: 9 },
      { side: 'w', at: -112, w: 2, h: 5, sill: 9 },
      { side: 'e', at: -60, w: 2, h: 5, sill: 9 },
      { side: 'e', at: -94, w: 2, h: 5, sill: 9 },
      { side: 'e', at: -108, w: 2, h: 5, sill: 9 },
      { side: 'n', at: -14, w: 2, h: 7, sill: 8 },
      { side: 'n', at: 14, w: 2, h: 7, sill: 8 },
    ],
  },
  // galleries over the aisles (floor top y 21.3), with a hole above the west stair
  { t: 'box', p: [-15.25, K + 6.75, -61], s: [8.5, 0.5, 22], m: 'flag' },
  { t: 'box', p: [-21.75, K + 6.75, -70], s: [4.5, 0.5, 4], m: 'flag' },
  { t: 'box', p: [-17.5, K + 6.75, -97], s: [13, 0.5, 50], m: 'flag' },
  { t: 'box', p: [17.5, K + 6.75, -86], s: [13, 0.5, 72], m: 'flag' },
  // gallery balustrades
  { t: 'wall', a: [-11.2, -50], b: [-11.2, -100.6], y: K + 7, h: 1.1, thick: 0.3, m: 'stone' },
  { t: 'wall', a: [-11.2, -103.4], b: [-11.2, -122], y: K + 7, h: 1.1, thick: 0.3, m: 'stone' },
  { t: 'wall', a: [11.2, -50], b: [11.2, -100.6], y: K + 7, h: 1.1, thick: 0.3, m: 'stone' },
  { t: 'wall', a: [11.2, -103.4], b: [11.2, -122], y: K + 7, h: 1.1, thick: 0.3, m: 'stone' },
  // rood bridge across the nave joining both galleries
  { t: 'bridge', a: [-11, K + 7, -102], b: [11, K + 7, -102], w: 2.6, m: 'stone', rail: true },
  // stair to the west gallery along the outer wall
  { t: 'stairs', a: [-21.5, K, -52.5], b: [-21.5, K + 7, -68], w: 3, m: 'flag' },
  // aisle roofs
  { t: 'box', p: [-17.5, K + 15.5, -86], s: [14, 0.6, 74], m: 'roof', rz: -0.12 },
  { t: 'box', p: [17.5, K + 15.5, -86], s: [14, 0.6, 74], m: 'roof', rz: 0.12 },
  // broken nave roof: beams and a few remaining slabs
  { t: 'box', p: [0, K + 19.6, -60], s: [20, 0.6, 7], m: 'roof', rx: 0.05 },
  { t: 'box', p: [0, K + 19.4, -112], s: [20, 0.6, 16], m: 'roof', rx: -0.04 },
  // apse dais and altar
  { t: 'box', p: [0, K + 0.4, -116], s: [18, 0.8, 11.6], m: 'flag' },
  { t: 'stairs', a: [0, K, -107.8], b: [0, K + 0.8, -110.2], w: 8, m: 'flag' },
  { t: 'altar', p: [0, K + 0.8, -118], ry: 0 },
  // courtyard plinths
  { t: 'pillar', p: [-6, 14, -44], r: 0.5, h: 3.2, m: 'stone', square: true },
  { t: 'pillar', p: [6, 14, -44], r: 0.5, h: 3.2, m: 'stone', square: true },
);
// moonlight shafts through the east windows and the broken nave roof
export const SHAFTS: { p: V3; w: number; h: number; len: number }[] = [
  { p: [24.6, K + 11.5, -60], w: 2, h: 4.6, len: 17 },
  { p: [24.6, K + 11.5, -94], w: 2, h: 4.6, len: 17 },
  { p: [24.6, K + 11.5, -108], w: 2, h: 4.6, len: 17 },
  { p: [-3, K + 20.5, -72], w: 3, h: 2.5, len: 25 },
  { p: [4, K + 20.5, -86], w: 2.4, h: 3.5, len: 25 },
  { p: [-2, K + 20.5, -98], w: 3.4, h: 2.2, len: 25 },
];
for (const z of [-58, -66, -74, -82, -90, -98, -106, -114]) {
  S.push({ t: 'pillar', p: [-10.5, K, z], r: 0.8, h: 20, m: 'stone' });
  S.push({ t: 'pillar', p: [10.5, K, z], r: 0.8, h: 20, m: 'stone' });
}
for (const z of [-66, -82, -98]) S.push({ t: 'box', p: [0, K + 19, z], s: [22, 0.8, 0.8], m: 'wood' });
// pews, some overturned
for (let i = 0; i < 7; i++) {
  const z = -58 - i * 6;
  S.push({ t: 'box', p: [-4.5, K + 0.45, z], s: [5.5, 0.9, 0.7], m: 'wood', ry: i % 3 === 1 ? 0.3 : 0 });
  S.push({ t: 'box', p: [4.5, K + 0.45, z], s: [5.5, 0.9, 0.7], m: 'wood', ry: i % 4 === 2 ? -0.5 : 0, rz: i === 4 ? 1.2 : 0 });
}

// ---- The Descent and the Godwound --------------------------------------------
S.push(
  { t: 'stairs', a: [0, K, -123.4], b: [0, 4.0, -149], w: 5.2, m: 'darkstone', sides: 3, sideTop: 15.5, sideM: 'darkstone' },
  { t: 'ribs', c: [0, 4, -172], r: 21, count: 6 },
);

export const STRUCTURES: Structure[] = S;

// ===========================================================================
// Points of interest
// ===========================================================================
export const PLAYER_START = { p: [0, CY, 137] as V3, yaw: Math.PI };

export const SHRINES: ShrineDef[] = [
  { id: 'ossuary', name: 'Shrine of the First Wick', p: [0, CY, 88.5], yaw: 0 },
  { id: 'brinemoor', name: 'Brinemoor Chapel', p: [-97, 0.45, 44.5], yaw: Math.PI / 2 },
  { id: 'gallowwood', name: 'Gallowwood Wayside', p: [104, 1.0, 44], yaw: -Math.PI / 2 },
  { id: 'vigil', name: 'The Last Vigil', p: [7.5, K + 0.8, -114], yaw: Math.PI },
];

export const BOSS = {
  p: [0, 4.0, -183] as V3,
  yaw: 0,
  arena: [0, 4.0, -172] as V3,
  radius: 24,
  fogWall: { p: [0, 4.0, -150.5] as V3, yaw: 0, w: 5.4, h: 5 },
  name: 'Oskeline, the Wick-Mother',
  phase2Name: 'Oskeline, Unwicked',
};

export const DOORS: DoorDef[] = [
  // Undercroft tower: barred from the inside, opens onto the Barrow Road
  { id: 'undercroft', p: [0, 0.6, -20.7], yaw: 0, w: 2.6, h: 3.4, openFrom: 'back' },
];

export const ENEMIES_LAYOUT: EnemySpawn[] = [
  // Ossuary
  { type: 'mimic', p: [-6, CY, 120], yaw: 0.4 },
  { type: 'shambler', p: [0, CY, 108], yaw: Math.PI, patrol: [[-6, CY, 108], [6, CY, 112]] },
  { type: 'crawler', p: [15, CY + 3.3, 107], cling: 'ceiling' },
  // Barrow Road
  { type: 'moths', p: [10, 0.6, 40] },
  { type: 'shambler', p: [-8, 0.6, 30], patrol: [[-8, 0.6, 30], [4, 0.6, 22], [-14, 0.6, 6]] },
  { type: 'shambler', p: [22, 0.6, 0], yaw: 2 },
  { type: 'stalker', p: [24, 0.6, -24] },
  // Brinemoor
  { type: 'screamer', p: [-104, 0.4, 14] },
  { type: 'mimic', p: [-90, 0.45, 40], yaw: 2 },
  { type: 'shambler', p: [-84, 0.4, 27] },
  { type: 'shambler', p: [-96, -1.5, 29], patrol: [[-96, -1.5, 29], [-104, -1.5, 36]] },
  { type: 'shambler', p: [-108, 0.4, 22] },
  { type: 'shambler', p: [-118, -1.5, 4], patrol: [[-118, -1.5, 4], [-110, -1.5, -2]] },
  { type: 'shambler', p: [-139, 0.4, 27] },
  { type: 'knight', p: [-121, 0.4, -5], yaw: 1.6 },
  { type: 'crawler', p: [-128, 9, -8.8], cling: 'wall', n: [0, 0, -1] },
  { type: 'shambler', p: [-80, 0.4, -12] },
  { type: 'knight', p: [-119, 0.4, 57], yaw: 3 },
  { type: 'shambler', p: [-64, 7.5, -40] },
  // Gallowwood
  { type: 'moths', p: [112, 1, 30] },
  { type: 'screamer', p: [130, 1, 70] },
  { type: 'moths', p: [146, -3, 112] },
  { type: 'stalker', p: [90, 1, 18] },
  { type: 'stalker', p: [122, 1, 62] },
  { type: 'stalker', p: [142, -3, 108] },
  { type: 'stalker', p: [154, -3, 122] },
  { type: 'shambler', p: [80, 1, 48], patrol: [[80, 1, 48], [92, 1, 60]] },
  { type: 'shambler', p: [112, 1, 2] },
  { type: 'crawler', p: [96, 14 + 6.6, -98], cling: 'ceiling' },
  { type: 'knight', p: [78, 14, -80], yaw: -1.6 },
  // Cathedral
  { type: 'mimic', p: [-4, 14.3, -80], yaw: 1 },
  { type: 'knight', p: [0, K, -86], yaw: 0 },
  { type: 'knight', p: [5, K + 0.8, -112], yaw: 0.3 },
  { type: 'crawler', p: [-17.5, K + 6.45, -90], cling: 'ceiling' },
  { type: 'crawler', p: [17.5, K + 6.45, -66], cling: 'ceiling' },
  { type: 'stalker', p: [18, K + 7, -102] },
  { type: 'shambler', p: [8, 14, -45], patrol: [[8, 14, -45], [-8, 14, -45]] },
  { type: 'shambler', p: [-32, 14, -70] },
  // Undercroft tower
  { type: 'crawler', p: [-4.3, 9.5, -26], cling: 'wall', n: [1, 0, 0] },
];

export const ITEMS: ItemDef[] = [
  { id: 'crypt-alcove', kind: 'marrow', p: [16, CY, 107], amount: 160 },
  { id: 'brine-house', kind: 'marrow', p: [-141, 0.4, 31], amount: 260 },
  { id: 'bell-vessel', kind: 'vessel', p: [-128, 15.2, -12] },
  // armaments
  { id: 'crypt-bow', kind: 'bow', p: [14, CY, 104] },
  { id: 'brine-daggers', kind: 'daggers', p: [-139, 0.4, 33] },
  { id: 'hollow-slab', kind: 'greatsword', p: [146, -3.4, 121] },
  { id: 'hollow-oil', kind: 'oil', p: [148, -3.4, 118] },
  { id: 'hollow-marrow', kind: 'marrow', p: [144, -3.2, 124], amount: 320 },
  { id: 'watch-whetstone', kind: 'whetstone', p: [96, 14 + 7.2, -98] },
  { id: 'gallery-vessel', kind: 'vessel', p: [20, K + 7, -110] },
  { id: 'apse-marrow', kind: 'marrow', p: [-7, K + 0.8, -118], amount: 420 },
  { id: 'ridge-marrow', kind: 'marrow', p: [110, 14, -118], amount: 200 },
];

export const MESSAGES: MessageDef[] = [
  { p: [0, CY + 3.2, 141.45], yaw: Math.PI, text: 'WE SEALED THE DOOR FROM WITHIN.\nIT DID NOT MATTER.', kind: 'scrawl', size: [6, 1.5] },
  { p: [-10.97, CY + 4.2, 108], yaw: Math.PI / 2, text: 'THE FLAME REMEMBERS\nWHAT THE BONES FORGET', kind: 'carved', size: [5, 1.3] },
  { p: [0, CY + 5.15, 81.05], yaw: 0, text: 'WHAT YOU CARRY, YOU DROP WHEN YOU FALL.\nWALK BACK FOR IT.', kind: 'carved', size: [7, 1.4] },
  { p: [0, 4.9, -20.04], yaw: 0, text: 'THE BAR IS ON THE INSIDE', kind: 'scrawl', size: [4.5, 0.9] },
  { p: [0, 5.2, -30.65], yaw: 0, text: 'UP IS NOT AWAY', kind: 'scrawl', size: [4, 1] },
  { p: [-83.71, 2.2, 28.51], yaw: Math.PI + 0.2, text: 'THE BELLS STILL RING\nBENEATH THE WATER', kind: 'scrawl', size: [4, 1.4] },
  { p: [-132.65, 2.6, -12], yaw: -Math.PI / 2, text: 'DO NOT ANSWER THEM', kind: 'scrawl', size: [4, 1] },
  { p: [96.09, 2.2, 52], yaw: Math.PI / 2, text: 'IT ONLY MOVES\nWHEN YOU LOOK AWAY', kind: 'scrawl', size: [2.8, 1.2] },
  { p: [87, 2.9, 70.28], yaw: 0, text: 'KEEP THE FLAME BETWEEN\nYOU AND THE TREES', kind: 'scrawl', size: [4.5, 1.2] },
  { p: [-23.95, K + 4, -86], yaw: Math.PI / 2, text: 'SHE ATE THE LAST OF HIS LIGHT', kind: 'scrawl', size: [7, 1.2] },
  { p: [23.95, K + 4, -64], yaw: -Math.PI / 2, text: 'PRAY WITH YOUR EYES OPEN', kind: 'scrawl', size: [6, 1.2] },
  { p: [-2.57, 9, -140], yaw: Math.PI / 2, text: 'TURN BACK, LAMPBEARER.\nTHE MOTHER IS HUNGRY.', kind: 'scrawl', size: [6, 1.4] },
];

export const HINTS: HintDef[] = [
  { p: [0, CY, 136], r: 5, kb: 'WASD move · Mouse look · Shift run · F shutter the lantern', pad: 'Left stick move · Right stick look · Hold B run · LT shutter the lantern' },
  { p: [0, CY, 122], r: 4, kb: 'Space dodge roll (you cannot be harmed mid-roll) · C leap', pad: 'Tap B dodge roll (you cannot be harmed mid-roll) · A leap' },
  { p: [0, CY, 116], r: 5, kb: 'LMB strike · Shift+LMB heavy strike (hold to gather) · Q / MMB fix your gaze on a foe', pad: 'RB strike · RT heavy strike (hold to gather) · R3 fix your gaze on a foe' },
  { p: [0, CY, 104], r: 6, kb: 'RMB guard — raise it the instant a blow lands to turn it aside, then strike to pierce', pad: 'LB guard — raise it the instant a blow lands to turn it aside, then strike to pierce' },
  { p: [0, CY, 96], r: 4, kb: 'R drink a Tallow Draught · strike a foe from behind to pierce its heart', pad: 'X drink a Tallow Draught · strike a foe from behind to pierce its heart' },
  { p: [0, CY, 89], r: 5, kb: 'E kneel at the candle. Rest mends you — and wakes the dead again.', pad: 'Y kneel at the candle. Rest mends you — and wakes the dead again.' },
];

export const CORPSES: CorpseDef[] = [
  { p: [0.4, CY, 127.5], yaw: Math.PI, pose: 'reach' },
  { p: [-1.2, CY, 119.5], yaw: Math.PI + 0.3, pose: 'crawl' },
  { p: [8, CY, 101.5], yaw: 0.4, pose: 'slump' },
  { p: [-3, 1.5, 55], yaw: Math.PI - 0.2, pose: 'crawl' },
  { p: [5, 0.6, 30], yaw: 2.2, pose: 'crawl' },
  { p: [1.2, 0.6, -21.4], yaw: 0, pose: 'reach' },
  { p: [-0.8, 0.6, -22.6], yaw: 0.3, pose: 'crawl' },
  { p: [-84, 0.4, 36], yaw: 1, pose: 'slump' },
  { p: [-96, 0.4, 16], yaw: -1, pose: 'curl' },
  { p: [-127, 0.4, -6.4], yaw: 0, pose: 'reach' },
  { p: [102, 1, 47], yaw: 2, pose: 'slump' },
  { p: [0.5, K, -52], yaw: 0, pose: 'crawl' },
  { p: [-6, K, -70], yaw: 1.2, pose: 'curl' },
  { p: [1.5, K, -121], yaw: Math.PI, pose: 'reach' },
  { p: [-2, 4, -150], yaw: 0, pose: 'crawl' },
  { p: [66, 14, -76], yaw: 1.5, pose: 'slump' },
];

export const CAGES: CageDef[] = [
  { p: [-12.6, 4.8, 14], drop: 1.5, body: true },
  { p: [-9.4, 4.8, 14], drop: 2.1, body: false },
  { p: [86, 4.2, 70], drop: 1.4, body: true },
  { p: [88.5, 4.2, 70], drop: 2.0, body: true },
  { p: [-3, K + 18.6, -82], drop: 5, body: true },
  { p: [3, K + 18.6, -98], drop: 7, body: false },
  { p: [-6, K + 18.6, -66], drop: 3.5, body: true },
];

export const FLAMES: FlameDef[] = [
  { p: [-3, CY, 90.5], kind: 'candles' },
  { p: [3, CY, 90.5], kind: 'candles' },
  { p: [-7.7, CY + 2.2, 134], kind: 'sconce' },
  { p: [10.7, CY + 2.2, 110], kind: 'sconce' },
  { p: [-3.4, 1.5, 57.5], kind: 'brazier', intensity: 0.8 },
  { p: [-2.8, 14.3, -48.5], kind: 'brazier' },
  { p: [2.8, 14.3, -48.5], kind: 'brazier' },
  { p: [-2.2, 0.6, -18.8], kind: 'brazier', intensity: 0.7 },
  { p: [0, K + 0.8, -118.5], kind: 'candles', intensity: 1.2 },
  { p: [-97, 0.45, 49.5], kind: 'candles' },
  { p: [104, 1.0, 40.6], kind: 'candles' },
  { p: [-126, 15.3, -9], kind: 'candles', intensity: 0.7 },
];

/** Braziers around the Godwound; snuffed when the Wick-Mother transforms. */
export const ARENA_BRAZIERS: V3[] = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
  return [Math.sin(a) * 19.5, 4, -172 + Math.cos(a) * 19.5] as V3;
});

/** Figures that stand in the fog and vanish when approached. */
export const SILHOUETTES: V3[] = [
  [0, 14, -40],
  [-58, 14, -104],
  [128, 14, -88],
  [-156, 0.4, 76],
  [64, 1, 128],
  [-40, 0.6, 20],
  [150, 1, 20],
  [30, 14, -140],
];

/** Areas kept free of instanced trees and debris. */
export const CLEARINGS: [number, number, number][] = [
  [104, 44, 10],
  [87, 70, 6],
  [148, 118, 7],
  [0, 58, 10],
];

export const FOREST_RECT: [number, number, number, number] = [68, -130, 174, 150];
