import { WEAPONS, BOW, type WeaponId } from './weapons';

/**
 * The Candle-Pedlar's stock. Prices are tuned so a careful player can afford one or two things
 * per region cleared without skipping level-ups: the shop helps, it is never required. Weapons
 * sold here can also be found in the world; the Pedlar only offers them once their region is cleared.
 */
export const UPGRADE_STEP = 0.08;
export const MAX_UPGRADE = 5;
export const ARROW_BUNDLE = 10;
export const ARROW_PRICE = 90;
export const MAX_SHOP_DRAUGHTS = 3;

const WEAPON_STOCK: { id: WeaponId; unlock: string; price: number }[] = [
  { id: 'bow', unlock: 'crypt', price: 900 },
  { id: 'daggers', unlock: 'village', price: 1400 },
  { id: 'greatsword', unlock: 'forest', price: 1800 },
];

export function upgradePrice(level: number): number {
  return Math.round((350 * Math.pow(level, 1.55)) / 10) * 10;
}

export function draughtPrice(bought: number): number {
  return 700 + bought * 700;
}

export type ShopKind = 'weapon' | 'upgrade' | 'arrows' | 'draught';

export interface ShopEntry {
  id: string;
  kind: ShopKind;
  weapon?: WeaponId;
  name: string;
  desc: string;
  price: number;
  available: boolean;
  /** Why it cannot be bought yet (locked, full, maxed). */
  reason?: string;
}

export interface ShopState {
  owned: WeaponId[];
  equipped: WeaponId;
  upgrades: Partial<Record<WeaponId, number>>;
  arrows: number;
  shopDraughts: number;
  draughtsMax: number;
  cleared: Set<string>;
}

export function shopStock(s: ShopState, regionName: (id: string) => string): ShopEntry[] {
  const out: ShopEntry[] = [];
  const n = s.cleared.size;
  for (const w of WEAPON_STOCK) {
    if (s.owned.includes(w.id)) continue;
    const ok = s.cleared.has(w.unlock);
    out.push({ id: `w-${w.id}`, kind: 'weapon', weapon: w.id, name: WEAPONS[w.id].name, desc: WEAPONS[w.id].desc, price: w.price, available: ok, reason: ok ? undefined : `Clear ${regionName(w.unlock)}` });
  }
  for (const id of s.owned) {
    const lvl = s.upgrades[id] ?? 0;
    const name = WEAPONS[id].name;
    if (lvl >= MAX_UPGRADE) {
      out.push({ id: `u-${id}`, kind: 'upgrade', weapon: id, name: `${name} +${MAX_UPGRADE}`, desc: 'Tempered as far as wax and bone allow.', price: 0, available: false, reason: 'Fully tempered' });
      continue;
    }
    // each region cleared lets the Pedlar temper one step further
    const ok = lvl + 1 <= Math.min(MAX_UPGRADE, 1 + n);
    out.push({
      id: `u-${id}`,
      kind: 'upgrade',
      weapon: id,
      name: `Temper ${name} to +${lvl + 1}`,
      desc: `The Pedlar works hot tallow and ground bone into the ${id === 'bow' ? 'limbs' : 'edge'}. +${Math.round(UPGRADE_STEP * 100)}% damage per temper.`,
      price: upgradePrice(lvl + 1),
      available: ok,
      reason: ok ? undefined : 'Clear another region',
    });
  }
  if (s.owned.includes('bow')) {
    const full = s.arrows >= BOW.maxArrows;
    out.push({ id: 'arrows', kind: 'arrows', name: `Bundle of ${ARROW_BUNDLE} arrows`, desc: 'Grey-fletched, bound with wick-thread. Candles restock your quiver too, but only so far.', price: ARROW_PRICE, available: !full, reason: full ? 'Quiver full' : undefined });
  }
  if (s.shopDraughts < MAX_SHOP_DRAUGHTS) {
    const ok = s.shopDraughts < Math.min(MAX_SHOP_DRAUGHTS, n);
    out.push({ id: 'draught', kind: 'draught', name: 'Tallow Vessel', desc: 'Carry one more Tallow Draught from every candle.', price: draughtPrice(s.shopDraughts), available: ok, reason: ok ? undefined : 'Clear another region' });
  }
  return out;
}

/** Stat rows for the shop card: [label, equipped value, value with this item]. */
export function compareRows(e: ShopEntry, s: ShopState): [string, string, string][] {
  if (e.kind === 'weapon' || e.kind === 'upgrade') {
    const cur = WEAPONS[s.equipped].stats;
    const curMul = 1 + UPGRADE_STEP * (s.upgrades[s.equipped] ?? 0);
    const id = e.weapon!;
    const nxt = WEAPONS[id].stats;
    const lvl = (s.upgrades[id] ?? 0) + (e.kind === 'upgrade' ? 1 : 0);
    const nxtMul = 1 + UPGRADE_STEP * lvl;
    const f = (v: number): string => v.toFixed(1);
    return [
      ['Damage', f(cur.damage * curMul), f(nxt.damage * nxtMul)],
      ['Speed', f(cur.speed), f(nxt.speed)],
      ['Stagger', f(cur.stagger), f(nxt.stagger)],
      ['Reach', f(cur.reach), f(nxt.reach)],
    ];
  }
  if (e.kind === 'arrows') return [['Arrows', String(s.arrows), String(Math.min(BOW.maxArrows, s.arrows + ARROW_BUNDLE))]];
  return [['Draughts', String(s.draughtsMax), String(s.draughtsMax + 1)]];
}
