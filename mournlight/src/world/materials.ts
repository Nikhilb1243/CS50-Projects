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
    stone: std(tex.stone, { color: 0xe4e0d8, normalScale: new THREE.Vector2(1.1, 1.1) }, 3.2),
    darkstone: std(tex.stone, { color: 0xa8a49c, normalScale: new THREE.Vector2(1.2, 1.2) }, 2.8),
    flag: std(tex.flag, { color: 0xdcd8d0 }, 3),
    wood: std(tex.wood, { color: 0xd8ccbc }, 2.4),
    plaster: std(tex.plaster, { color: 0xe0d8ca }, 3.4),
    rock: std(tex.rock, { color: 0xdcd8d0, normalScale: new THREE.Vector2(1.4, 1.4) }, 6),
    roof: std(tex.roof, { color: 0xd0c6bc }, 3),
    iron: std(tex.iron, { color: 0xc8c8c8, metalness: 0.75 }, 2),
    bone: std(tex.plaster, { color: 0xfff4dc, roughness: 0.8 }, 1.4),
    wax: std(tex.plaster, { color: 0xfff8e8, roughness: 0.55 }, 1.2),
    bark: std(tex.bark, { color: 0xc8c0b4 }, 1.6),
    cloth: std(tex.cloth, { color: 0xd0c0b8, side: THREE.DoubleSide }, 1.5),
    vertexColor: patchFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })),
  };
}
