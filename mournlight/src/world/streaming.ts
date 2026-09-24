import * as THREE from 'three';

interface Entry {
  obj: THREE.Object3D;
  parent: THREE.Object3D;
  x: number;
  z: number;
  r: number;
  loaded: boolean;
  freed: boolean;
  geos: THREE.BufferGeometry[];
}

/**
 * Distance streaming for static world chunks. A chunk joins the scene graph when it comes
 * within the fog range and leaves it (no traversal, culling, shadow or draw cost) once it is
 * well past it. Chunks that are far behind also release their GPU buffers; three.js uploads
 * them again on return. The load radius sits where the exponential fog is already opaque,
 * so chunks fade in out of the murk instead of popping.
 */
export class ChunkStreamer {
  private items: Entry[] = [];
  loaded = 0;

  constructor(private hysteresis = 12) {}

  /** Register a chunk (already parented or not). `freeGpu` releases its geometry when far. */
  add(obj: THREE.Object3D, parent: THREE.Object3D, x: number, z: number, r: number, freeGpu = false): void {
    const geos: THREE.BufferGeometry[] = [];
    if (freeGpu) obj.traverse((o) => (o as THREE.Mesh).isMesh && geos.push((o as THREE.Mesh).geometry));
    this.items.push({ obj, parent, x, z, r, loaded: obj.parent === parent, freed: false, geos });
  }

  get total(): number {
    return this.items.length;
  }

  update(cam: THREE.Vector3, dist: number): void {
    let n = 0;
    for (const e of this.items) {
      const d = Math.hypot(e.x - cam.x, e.z - cam.z) - e.r;
      if (!e.loaded && d < dist) {
        e.parent.add(e.obj);
        e.loaded = true;
        e.freed = false;
      } else if (e.loaded && d > dist + this.hysteresis) {
        e.obj.removeFromParent();
        e.loaded = false;
      } else if (!e.loaded && !e.freed && e.geos.length && d > dist * 2 + 40) {
        for (const g of e.geos) g.dispose();
        e.freed = true;
      }
      if (e.loaded) n++;
    }
    this.loaded = n;
  }
}
