import * as THREE from 'three';
import { models, buildLantern } from '../entities/models';
import { keyPose, locomotion, STYLES, rollPose } from '../entities/poses';
import { makePose } from '../entities/rig';
import { installFogChunks } from '../fx/fog';

installFogChunks();
const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2d33);
const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
scene.add(new THREE.HemisphereLight(0xc8d0e0, 0x303030, 1.6));
const dl = new THREE.DirectionalLight(0xffffff, 2.2);
dl.position.set(3, 6, 5);
dl.castShadow = true;
scene.add(dl);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x444444 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const ids = (params.get('ids') ?? 'revenant,shambler,stalker,crawler,knight,wickmother').split(',');
const poses = (params.get('poses') ?? '').split(',').filter(Boolean);
const spacing = Number(params.get('spacing') ?? 2.2);
const insts: { inst: ReturnType<typeof models.create>; pose: string }[] = [];
let x = -((Math.max(ids.length, poses.length) - 1) * spacing) / 2;
const n = Math.max(ids.length, poses.length);
for (let i = 0; i < n; i++) {
  const id = ids[Math.min(i, ids.length - 1)];
  const inst = models.create(id);
  inst.root.position.set(x, 0, 0);
  inst.root.rotation.y = Number(params.get('yaw') ?? 0.5);
  scene.add(inst.root);
  if (id === 'revenant') {
    const l = buildLantern();
    inst.sockets.get('lantern')!.add(l.group);
  }
  insts.push({ inst, pose: poses[i] ?? poses[0] ?? 'idle' });
  x += spacing;
}
const camDist = Number(params.get('dist') ?? 9);
const camY = Number(params.get('camy') ?? 1.6);
cam.position.set(Number(params.get('camx') ?? 0), camY, camDist);
cam.lookAt(0, Number(params.get('looky') ?? 1.0), 0);
const p = makePose();
let t = Number(params.get('t') ?? 0.5);
function frame() {
  t += 1 / 60;
  for (const { inst, pose } of insts) {
    if (pose === 'idle') locomotion(p, t, 0, 0, STYLES.revenant);
    else if (pose.startsWith('walk:')) locomotion(p, t, t * 5, 1, STYLES[pose.split(':')[1]]);
    else if (pose.startsWith('run:')) locomotion(p, t, t * 7, 2, STYLES[pose.split(':')[1]]);
    else if (pose.startsWith('roll:')) rollPose(p, Number(pose.split(':')[1]));
    else p.set(keyPose(pose));
    inst.rig.apply(p);
  }
  renderer.render(scene, cam);
  if (!params.has('still')) requestAnimationFrame(frame);
}
frame();
(window as unknown as { ready: boolean }).ready = true;
