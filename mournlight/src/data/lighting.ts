/**
 * Hand-tuned lighting per region. This is the single source of truth for how a region is lit:
 * the key light (the moon, whose direction is global), the fill (hemisphere sky/ground ambient),
 * fog, colour grading, the rim light that keeps characters readable against the dark, and the
 * soft fill carried around the player. Colours are sRGB hex. Grading LUTs live in fx/lut.ts.
 */
export interface RegionLighting {
  key: { color: number; intensity: number };
  fill: { sky: number; ground: number; intensity: number };
  fog: { color: number; density: number };
  /** exposure: bias on auto-exposure; saturation: grade (0 grey .. 1 full); lift: blue lift in the blacks. */
  grade: { exposure: number; saturation: number; lift: number };
  rim: { color: number; strength: number };
  /** Intensity of the soft light that follows the player (never casts shadows). */
  playerFill: number;
  /** Surface wetness 0..1 and environment-map reflection strength. */
  wet: number;
  env: number;
}

export const REGION_LIGHTING: Record<string, RegionLighting> = {
  crypt: {
    key: { color: 0x8ea4c8, intensity: 0 },
    fill: { sky: 0x5c5248, ground: 0x1e1812, intensity: 0.44 },
    fog: { color: 0x0a0b0d, density: 0.03 },
    grade: { exposure: 1, saturation: 0.52, lift: 1 },
    rim: { color: 0xb8a48c, strength: 0.22 },
    playerFill: 0.72,
    wet: 0.55,
    env: 0.06,
  },
  road: {
    key: { color: 0x9fb2d4, intensity: 1.3 },
    fill: { sky: 0x506078, ground: 0x1c1914, intensity: 0.4 },
    fog: { color: 0x161b22, density: 0.022 },
    grade: { exposure: 1, saturation: 0.48, lift: 1 },
    rim: { color: 0x9fb4d8, strength: 0.19 },
    playerFill: 0.55,
    wet: 0.35,
    env: 0.45,
  },
  village: {
    key: { color: 0x98b0c0, intensity: 1.17 },
    fill: { sky: 0x4d6468, ground: 0x1a1a16, intensity: 0.4 },
    fog: { color: 0x141b1c, density: 0.026 },
    grade: { exposure: 1, saturation: 0.46, lift: 1.1 },
    rim: { color: 0x9cc0c0, strength: 0.19 },
    playerFill: 0.55,
    wet: 1,
    env: 0.55,
  },
  forest: {
    key: { color: 0x9aaec0, intensity: 1.04 },
    fill: { sky: 0x4c5a58, ground: 0x1a1812, intensity: 0.36 },
    fog: { color: 0x131714, density: 0.03 },
    grade: { exposure: 1, saturation: 0.44, lift: 1.1 },
    rim: { color: 0xa8b8a0, strength: 0.22 },
    playerFill: 0.61,
    wet: 0.45,
    env: 0.35,
  },
  cathedral: {
    key: { color: 0xa0b0d0, intensity: 1.17 },
    fill: { sky: 0x545c70, ground: 0x1e1a16, intensity: 0.38 },
    fog: { color: 0x131519, density: 0.024 },
    grade: { exposure: 1, saturation: 0.5, lift: 1 },
    rim: { color: 0xb4bcd4, strength: 0.19 },
    playerFill: 0.55,
    wet: 0.3,
    env: 0.3,
  },
  arena: {
    key: { color: 0xb09aa0, intensity: 1.04 },
    fill: { sky: 0x5a4c54, ground: 0x1e1210, intensity: 0.38 },
    fog: { color: 0x161114, density: 0.017 },
    grade: { exposure: 1, saturation: 0.52, lift: 1 },
    rim: { color: 0xd0a090, strength: 0.22 },
    playerFill: 0.55,
    wet: 0.25,
    env: 0.35,
  },
  catacombs: {
    key: { color: 0x8ea4c8, intensity: 0 },
    fill: { sky: 0x3c4a50, ground: 0x10141a, intensity: 0.3 },
    fog: { color: 0x07090c, density: 0.048 },
    grade: { exposure: 1, saturation: 0.46, lift: 1.25 },
    rim: { color: 0x88a8b8, strength: 0.24 },
    playerFill: 0.83,
    wet: 1,
    env: 0.04,
  },
  bellspire: {
    key: { color: 0xa4b6dc, intensity: 1.3 },
    fill: { sky: 0x56627c, ground: 0x1c1c20, intensity: 0.34 },
    fog: { color: 0x1a1e26, density: 0.018 },
    grade: { exposure: 1, saturation: 0.48, lift: 1 },
    rim: { color: 0xa8bce0, strength: 0.19 },
    playerFill: 0.5,
    wet: 0.7,
    env: 0.5,
  },
};

export const DEFAULT_LIGHTING = REGION_LIGHTING.road;

export function regionLighting(id: string): RegionLighting {
  return REGION_LIGHTING[id] ?? DEFAULT_LIGHTING;
}
