import * as THREE from 'three';
import { clamp, damp, dampAngle, noise1, yawTo } from './math';
import type { Physics } from './physics';
import { settings } from './settings';

/**
 * Over-the-shoulder orbit camera with sphere-cast collision, lock-on
 * framing and trauma-based shake.
 */
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI;
  pitch = -0.12;
  distance = 3.4;
  private curDist = 3.4;
  private pivot = new THREE.Vector3();
  private pivotInit = false;
  private shoulder = 0.55;
  private curShoulder = 0.55;
  private trauma = 0;
  private shakeTime = 0;
  private fovBoost = 0;
  private lockBlend = 0;
  /** Over-the-shoulder aim (bow): 0..1 target, blended. */
  aim = false;
  private aimBlend = 0;
  /** When set, the camera frames the target. */
  lockTarget: THREE.Vector3 | null = null;
  /** Height of the lock target's center of mass (for tall bosses). */
  lockHeight = 1.2;
  /** Cinematic override (death, boss intro). */
  override: { pos: THREE.Vector3; look: THREE.Vector3; blend: number } | null = null;

  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private look = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(settings.value.fov, aspect, 0.08, 220);
  }

  addTrauma(t: number): void {
    this.trauma = clamp(this.trauma + t, 0, 1);
  }

  setFovBoost(v: number): void {
    this.fovBoost = v;
  }

  /** Horizontal forward direction of the camera. */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  right(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  snapBehind(playerYaw: number): void {
    this.yaw = playerYaw + Math.PI;
    this.pitch = -0.12;
  }

  update(dt: number, target: THREE.Vector3, look: { x: number; y: number }, physics: Physics, playerHeight = 1.55): void {
    const s = settings.value;
    if (Math.abs(this.camera.fov - (s.fov + this.fovBoost)) > 0.01) {
      this.camera.fov = damp(this.camera.fov, s.fov + this.fovBoost, 6, dt);
      this.camera.updateProjectionMatrix();
    }

    // Look input
    const locked = !!this.lockTarget;
    this.lockBlend = damp(this.lockBlend, locked ? 1 : 0, 8, dt);
    this.aimBlend = damp(this.aimBlend, this.aim ? 1 : 0, 10, dt);
    if (!locked) {
      this.yaw -= look.x;
      this.pitch -= look.y;
    } else {
      // lock-on: yaw points from player toward target; allow slight pitch nudge
      const lt = this.lockTarget!;
      const dx = lt.x - target.x;
      const dz = lt.z - target.z;
      const desiredYaw = yawTo(dx, dz) + Math.PI;
      this.yaw = dampAngle(this.yaw, desiredYaw, 9, dt);
      const hd = Math.max(1.5, Math.hypot(dx, dz));
      const dy = lt.y + this.lockHeight * 0.5 - (target.y + playerHeight);
      const desiredPitch = clamp(Math.atan2(dy, hd + this.curDist) - 0.1, -0.55, 0.45);
      this.pitch = damp(this.pitch, desiredPitch, 6, dt);
    }
    this.pitch = clamp(this.pitch, -1.2, 0.95);

    // Smooth pivot follow (fast horizontally, softer vertically)
    if (!this.pivotInit) {
      this.pivot.copy(target);
      this.pivotInit = true;
    }
    this.pivot.x = damp(this.pivot.x, target.x, 22, dt);
    this.pivot.z = damp(this.pivot.z, target.z, 22, dt);
    this.pivot.y = damp(this.pivot.y, target.y, 12, dt);

    const head = this.tmp.set(this.pivot.x, this.pivot.y + playerHeight, this.pivot.z);
    this.curShoulder = damp(this.curShoulder, this.shoulder * (1 - this.lockBlend * 0.25) + this.aimBlend * 0.25, 6, dt);
    const cp = Math.cos(this.pitch);
    // camera offset direction (from pivot toward camera)
    this.dir.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    // pull back further for towering targets so both stay framed
    const big = clamp((this.lockHeight - 2) * 0.55, 0, 2.2);
    const dist = (this.distance + this.lockBlend * (0.6 + big)) * (1 - this.aimBlend * 0.5);
    this.desired
      .copy(head)
      .addScaledVector(this.dir, dist)
      .add(this.look.set(rx * this.curShoulder, 0, rz * this.curShoulder));

    // Collision: sphere-cast from the head to the desired position
    const to = this.look.subVectors(this.desired, head);
    const len = to.length();
    to.divideScalar(len);
    const hit = physics.sphereCast(head, to, len, 0.22);
    const allowed = hit === null ? len : Math.max(0.3, hit - 0.05);
    this.curDist = allowed < this.curDist ? allowed : damp(this.curDist, allowed, 4, dt);
    const camPos = this.desired.copy(head).addScaledVector(to, this.curDist);

    // Look target: slightly ahead of the head, or between player and lock target
    const lookAt = this.look.copy(head).addScaledVector(this.dir, -4).add(new THREE.Vector3(rx * this.curShoulder, 0, rz * this.curShoulder));
    if (this.lockTarget && this.lockBlend > 0.01) {
      const mid = new THREE.Vector3(this.lockTarget.x, this.lockTarget.y + this.lockHeight * 0.5, this.lockTarget.z).lerp(head, 0.35);
      lookAt.lerp(mid, this.lockBlend * 0.85);
    }

    // Shake
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.shakeTime += dt;
    const sh = this.trauma * this.trauma;
    if (sh > 0) {
      const t = this.shakeTime * 28;
      camPos.x += noise1(t, 1) * 0.35 * sh;
      camPos.y += noise1(t, 2) * 0.35 * sh;
      camPos.z += noise1(t, 3) * 0.35 * sh;
    }

    if (this.override && this.override.blend > 0) {
      camPos.lerp(this.override.pos, this.override.blend);
      lookAt.lerp(this.override.look, this.override.blend);
    }

    this.camera.position.copy(camPos);
    this.camera.lookAt(lookAt);
    if (sh > 0) this.camera.rotation.z += noise1(this.shakeTime * 20, 7) * 0.04 * sh;
  }
}
