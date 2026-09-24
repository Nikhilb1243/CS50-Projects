import * as THREE from 'three';
import { patchFog } from '../fx/fog';
import type { TextureLibrary, TextureSet } from './textures';
import type { MatId } from './layout';

export interface WorldMaterial {
  material: THREE.MeshStandardMaterial;
  /** Meters covered by one texture repeat. */
  texScale: number;
}

function std(set: TextureSet, opts: THREE.MeshStandardMaterialParameters, texScale: number): WorldMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    roughness: 1,
    metalness: 0,
    ...opts,
  });
  return { material: patchFog(m), texScale };
}

export type MaterialLibrary = Record<MatId, WorldMaterial> & {
  bark: WorldMaterial;
  cloth: WorldMaterial;
  vertexColor: THREE.MeshStandardMaterial;
};

export function createMaterials(tex: TextureLibrary): MaterialLibrary {
  return {
    stone: std(tex.stone, { color: 0xb8b4ac, normalScale: new THREE.Vector2(1.1, 1.1) }, 3.2),
    darkstone: std(tex.stone, { color: 0x77736c, normalScale: new THREE.Vector2(1.2, 1.2) }, 2.8),
    flag: std(tex.flag, { color: 0xa9a49a }, 3),
    wood: std(tex.wood, { color: 0x9a8f80 }, 2.4),
    plaster: std(tex.plaster, { color: 0xb3ab9d }, 3.4),
    rock: std(tex.rock, { color: 0xa8a39a, normalScale: new THREE.Vector2(1.4, 1.4) }, 6),
    roof: std(tex.roof, { color: 0x9a9088 }, 3),
    iron: std(tex.iron, { color: 0x9a9a9a, metalness: 0.75 }, 2),
    bone: std(tex.plaster, { color: 0xd8ceb4, roughness: 0.8 }, 1.4),
    wax: std(tex.plaster, { color: 0xe8dcc0, roughness: 0.55 }, 1.2),
    bark: std(tex.bark, { color: 0x8a847c }, 1.6),
    cloth: std(tex.cloth, { color: 0x9a8c84, side: THREE.DoubleSide }, 1.5),
    vertexColor: patchFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })),
  };
}
