import * as THREE from 'three';
import { Time } from './core/time';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { Physics } from './core/physics';
import { ThirdPersonCamera } from './core/camera';
import { settings } from './core/settings';
import { events } from './core/events';
import { clamp01, damp, lerp } from './core/math';
import { loadSave, writeSave, type SaveData } from './core/save';
import type { DebugFlags, GameContext } from './core/context';
import { AudioEngine } from './audio/audio';
import { Ambience } from './audio/ambience';
import { Particles } from './fx/particles';
import { PostFX } from './fx/post';
import { installFogChunks, fogUniforms } from './fx/fog';
import { HorrorDirector } from './fx/horror';
import { Sky } from './fx/sky';
import { CombatSystem } from './combat/combat';
import { HazardSystem } from './combat/hazards';
import { NoiseBus } from './ai/noise';
import { World } from './world/world';
import { Player } from './entities/player';
import type { Enemy } from './ai/enemy';
import { createEnemy } from './ai/creatures';
import type { Boss } from './ai/boss';
import { ENEMIES_LAYOUT, BOSS, PLAYER_START, REGIONS, HINTS, type RegionDef } from './world/layout';
import { ITEM_INFO, type Interactable, type Pickup, type Shrine } from './world/interactables';
import { Hud } from './ui/hud';
import { Menus } from './ui/menus';
import { DebugOverlay } from './ui/debug';
import { START_ATTRIBUTES } from './data/stats';
import { PLAYER_TUNING } from './data/stats';

type Mode = 'loading' | 'title' | 'playing' | 'paused' | 'menu' | 'dead' | 'cinematic';

/** Where the title screen's camera lingers: the cathedral portal. */
const TITLE_FOCUS = new THREE.Vector3(0, 14.3, -44);
const HEMI_SKY = new THREE.Color(0x4f5d74);
const HEMI_RED = new THREE.Color(0x8a2a1c);

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam: ThirdPersonCamera;
  private input: Input;
  private time = new Time();
  private loop: GameLoop;
  private physics!: Physics;
  private audio: AudioEngine;
  private ambience: Ambience;
  private particles!: Particles;
  private post!: PostFX;
  private combat = new CombatSystem();
  private hazards!: HazardSystem;
  private noise = new NoiseBus();
  private world!: World;
  private player!: Player;
  private enemies: Enemy[] = [];
  private boss!: Boss;
  private horror!: HorrorDirector;
  private sky!: Sky;
  private hud: Hud;
  private menus: Menus;
  private debugOverlay!: DebugOverlay;
  private ctx!: GameContext;
  private debug: DebugFlags = { enabled: false, hitboxes: false, god: false, fps: false };
  private fog = new THREE.FogExp2(0x0d1013, 0.03);
  private mode: Mode = 'loading';
  private quality = settings.value.quality;
  private region: RegionDef = REGIONS[0];
  private regionTimer = 0;
  private lastRegionBanner = new Map<string, number>();
  private lastShrine: Shrine | null = null;
  private itemsTaken = new Set<string>();
  private playTime = 0;
  private deaths = 0;
  private bossDefeated = false;
  private flashAmt = 0;
  private flashColor = new THREE.Color(1, 1, 1);
  private fadeAmt = 1;
  private fadeTarget = 0;
  private titleT = 0;
  private cinematicT = 0;
  private prompt: { target: Interactable; text: string } | null = null;
  private tmp = new THREE.Vector3();
  private fogColor = new THREE.Color(0x0d1013);
  private fogDensity = 0.03;
  private moonK = 1;
  private rotK = 0;
  private hurtK = 0;
  private uiRoot: HTMLElement;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.uiRoot = uiRoot;
    installFogChunks();
    const q = this.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 1.5) : q === 'medium' ? Math.min(dpr, 1) : Math.min(dpr, 1) * 0.75);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.fog = this.fog;
    this.scene.background = this.fogColor;
    this.cam = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
    this.scene.add(this.cam.camera);
    // faint cold fill that follows the view so silhouettes stay readable
    const fill = new THREE.PointLight(0x8a96a8, 0.9, 8, 1.3);
    fill.position.set(0, 0.4, 0);
    this.cam.camera.add(fill);
    this.input = new Input(canvas);
    this.audio = new AudioEngine(this.cam.camera);
    this.ambience = new Ambience(this.audio);
    this.loop = new GameLoop(this.time, (dt) => this.fixedUpdate(dt), (a, dt) => this.render(a, dt));
    this.hud = new Hud(uiRoot);
    this.menus = new Menus(uiRoot, {
      newGame: () => this.newGame(),
      continueGame: () => this.continueGame(),
      resume: () => this.resume(),
      quitToTitle: () => this.quitToTitle(),
      levelUp: (a, cost) => this.applyLevelUp(a, cost),
      travel: (id) => this.travel(id),
      leaveShrine: () => this.leaveShrine(),
      startFromIntro: () => this.newGame(),
      click: () => this.audio.play('ui_click', { volume: 0.6 }),
      move: () => this.audio.play('ui_move', { volume: 0.5 }),
    });
    this.menus.show('loading');
    window.addEventListener('resize', () => this.onResize());
    canvas.addEventListener('click', () => {
      this.audio.resume();
      if (this.mode === 'playing') this.input.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.mode === 'playing') this.pause();
    });
    this.input.onKey((code) => this.debugOverlay?.handleKey(code));
    this.bindEvents();
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  async init(): Promise<void> {
    this.loop.start();
    const progress = (p: number, label: string): void => this.menus.setLoading(p, label);
    progress(0.01, 'Waking the physics');
    this.physics = await Physics.create();
    this.particles = new Particles(this.scene, this.quality);
    this.particles.setViewport(window.innerHeight * this.renderer.getPixelRatio(), this.cam.camera.fov);
    this.world = new World(this.scene, this.physics, this.quality);
    await this.world.build(progress);
    progress(0.96, 'Composing the dirge');
    await this.audio.init(this.scene, (p) => progress(0.96 + p * 0.03, 'Composing the dirge'));
    this.sky = new Sky(this.scene, new THREE.Vector3(0.45, 0.62, -0.64));
    this.post = new PostFX(this.renderer, this.scene, this.cam.camera, this.quality);
    this.post.setSize(window.innerWidth, window.innerHeight);

    // Context & entities
    const self = this;
    this.ctx = {
      scene: this.scene,
      physics: this.physics,
      audio: this.audio,
      ambience: this.ambience,
      particles: this.particles,
      combat: this.combat,
      hazards: null as unknown as HazardSystem,
      lights: this.world.lights,
      noise: this.noise,
      time: this.time,
      cam: this.cam,
      input: this.input,
      debug: this.debug,
      world: this.world,
      player: null as unknown as Player,
      enemies: this.enemies,
      hitstop: (d, s) => self.time.hitstop(d, s),
      shake: (a) => self.cam.addTrauma(a),
      flash: (a, c) => self.flash(a, c),
      message: (t, d) => self.hud.message(t, d),
    };
    this.hazards = new HazardSystem(this.ctx);
    this.ctx.hazards = this.hazards;
    this.player = new Player(this.ctx, new THREE.Vector3(...PLAYER_START.p), PLAYER_START.yaw, this.quality);
    this.ctx.player = this.player;
    this.combat.add(this.player);
    this.player.onDeath = () => this.afterDeath();
    this.player.setCinematic(true);
    this.physics.refreshQueries();
    for (const spawn of ENEMIES_LAYOUT) {
      const s = { ...spawn, p: [...spawn.p] as [number, number, number] };
      if (!s.cling) {
        const g = this.physics.groundHeight(s.p[0], s.p[2], s.p[1] + 2.5, 8);
        if (g !== null) s.p[1] = g;
      }
      const e = createEnemy(this.ctx, s);
      this.enemies.push(e);
      this.combat.add(e);
    }
    const bossSpawn = { type: 'boss' as const, p: [...BOSS.p] as [number, number, number], yaw: BOSS.yaw };
    this.boss = createEnemy(this.ctx, bossSpawn) as Boss;
    this.enemies.push(this.boss);
    this.combat.add(this.boss);
    this.boss.onPhase2 = () => this.onBossPhase2();
    this.boss.onDefeated = () => this.onBossDefeated();
    for (const d of this.world.dynamics) this.combat.knockables.push(d);
    this.horror = new HorrorDirector(this.ctx);
    this.debugOverlay = new DebugOverlay(
      this.uiRoot,
      this.debug,
      () => this.ctx,
      {
        teleport: (id) => this.debugTeleport(id),
        giveMarrow: (n) => this.addMarrow(n),
        killNearby: () => {
          for (const e of this.enemies) if (e.alive && e.pos.distanceTo(this.player.pos) < 25) e.die(this.player);
        },
        refill: () => {
          this.player.health = this.player.maxHealth;
          this.player.draughts = this.player.progress.draughtsMax;
          this.player.lantern.refill();
        },
      },
      this.renderer,
      this.scene,
    );
    this.menus.setContinueAvailable(!!loadSave());
    // Warm up shaders so the first frame of play does not hitch
    this.renderer.compile(this.scene, this.cam.camera);
    this.mode = 'title';
    this.fadeTarget = 0;
    this.menus.show('title');
    this.hud.setVisible(false);
    this.devParams();
  }

  /** Development URL parameters: ?autostart&tp=<region>&yaw=<rad>&nolantern&hitboxes&god */
  private devParams(): void {
    const q = new URLSearchParams(location.search);
    if (q.has('hidemenu')) this.menus.show(null);
    if (q.has('maxsteps')) {
      // headless testing: let the simulation keep real time at very low frame rates
      this.loop.maxSteps = Number(q.get('maxsteps'));
      this.loop.maxDt = this.loop.maxSteps / 60;
    }
    if (!q.has('autostart')) return;
    this.newGame();
    this.player.endRest();
    const tp = q.get('tp');
    if (tp) this.debugTeleport(tp);
    if (q.has('pos')) {
      const [x, y, z] = q.get('pos')!.split(',').map(Number);
      this.player.teleport(new THREE.Vector3(x, y, z));
    }
    if (q.has('yaw')) {
      this.player.yaw = this.player.prevYaw = Number(q.get('yaw'));
      this.cam.snapBehind(this.player.yaw);
    }
    if (q.has('pitch')) this.cam.pitch = Number(q.get('pitch'));
    if (q.has('nolantern')) this.player.lantern.on = false;
    if (q.has('hitboxes')) this.debug.hitboxes = true;
    if (q.has('god')) this.debug.god = true;
    if (q.has('debug')) this.debug.enabled = true;
    if (q.has('marrow')) this.addMarrow(Number(q.get('marrow')));
    if (q.has('phase2')) {
      this.world.setArenaPhase(2);
      this.rotK = 1;
    }
    if (q.has('boss')) {
      this.player.teleport(new THREE.Vector3(0, 4.2, -156));
      window.setTimeout(() => this.startBossIntro(), 500);
    }
    this.debugOverlay.sync();
    this.fadeAmt = 0;
  }

  private bindEvents(): void {
    events.on('enemy:killed', (e) => this.addMarrow(e.marrow));
    events.on('player:died', () => this.onPlayerDied());
    events.on('player:hurt', () => {
      this.hurtK = 1;
    });
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------
  private beginPlay(): void {
    this.audio.resume();
    this.ambience.start();
    this.menus.show(null);
    this.hud.setVisible(true);
    this.mode = 'playing';
    this.input.gameplayEnabled = true;
    this.input.clearAll();
    this.input.requestPointerLock();
    this.cam.override = null;
    this.cam.snapBehind(this.player.yaw);
    this.loop.resetAccumulator();
  }

  private newGame(): void {
    const p = this.player;
    p.progress = { attrs: { ...START_ATTRIBUTES }, marrow: 0, draughtsMax: PLAYER_TUNING.startDraughts, dmgBonus: 0, fuelMax: PLAYER_TUNING.lanternFuelMax };
    p.recalcStats(true);
    p.respawn(new THREE.Vector3(...PLAYER_START.p), PLAYER_START.yaw);
    this.fadeAmt = 1;
    this.fadeTarget = 0;
    this.save();
    this.beginPlay();
    // wake in the sarcophagus hall
    this.player.startRest();
    window.setTimeout(() => {
      this.player.endRest();
      this.hud.region(this.region.name);
    }, 2200);
    this.lastRegionBanner.set('crypt', performance.now());
  }

  private continueGame(): void {
    const s = loadSave();
    if (!s) {
      this.newGame();
      return;
    }
    this.applySave(s);
    this.beginPlay();
  }

  private applySave(s: SaveData): void {
    const p = this.player;
    p.progress = { attrs: { ...s.attrs }, marrow: s.marrow, draughtsMax: s.draughtsMax, dmgBonus: s.dmgBonus, fuelMax: s.fuelMax };
    p.recalcStats(true);
    p.lantern.drainMult = s.fuelMax > PLAYER_TUNING.lanternFuelMax ? 0.8 : 1;
    for (const sh of this.world.shrines) if (s.shrinesLit.includes(sh.def.id)) sh.kindle();
    this.lastShrine = this.world.shrines.find((sh) => sh.def.id === s.lastShrine) ?? null;
    for (const d of this.world.doors) if (s.doorsOpen.includes(d.def.id)) d.openDoor(true);
    for (const it of this.world.items) {
      if (s.itemsTaken.includes(it.id)) {
        it.take();
        this.itemsTaken.add(it.id);
      }
    }
    this.bossDefeated = s.bossDefeated;
    if (s.bossDefeated) {
      this.boss.alive = false;
      this.boss.model.root.visible = false;
      this.boss.removed = true;
      if (this.boss.char) this.physics.setCharacterEnabled(this.boss.char, false);
      this.world.fogWall.dissolve();
      this.world.setArenaPhase(3);
    }
    if (s.remnant) this.world.remnant.place(new THREE.Vector3(...s.remnant.p), s.remnant.amount);
    this.playTime = s.playTime;
    this.deaths = s.deaths;
    const { pos, yaw } = this.shrineSpawn(this.lastShrine);
    p.respawn(pos, yaw);
    this.fadeAmt = 1;
    this.fadeTarget = 0;
  }

  private save(): void {
    const p = this.player;
    const r = this.world.remnant;
    writeSave({
      version: 1,
      attrs: { ...p.progress.attrs },
      marrow: p.progress.marrow,
      draughtsMax: p.progress.draughtsMax,
      dmgBonus: p.progress.dmgBonus,
      fuelMax: p.progress.fuelMax,
      shrinesLit: this.world.shrines.filter((s) => s.lit).map((s) => s.def.id),
      lastShrine: this.lastShrine?.def.id ?? null,
      doorsOpen: this.world.doors.filter((d) => d.open).map((d) => d.def.id),
      itemsTaken: [...this.itemsTaken],
      bossDefeated: this.bossDefeated,
      remnant: r.enabled ? { p: [r.pos.x, r.pos.y, r.pos.z], amount: r.amount } : null,
      playTime: this.playTime,
      deaths: this.deaths,
    });
  }

  private pausedAt = 0;

  private pause(): void {
    if (this.mode !== 'playing') return;
    this.pausedAt = performance.now();
    this.mode = 'paused';
    this.input.gameplayEnabled = false;
    this.menus.show('pause');
    this.input.exitPointerLock();
  }

  private resume(): void {
    if (this.menus.current === 'victory') {
      this.menus.show(null);
      this.hud.setVisible(true);
      this.mode = 'playing';
      this.input.gameplayEnabled = true;
      this.input.clearAll();
      this.input.requestPointerLock();
      return;
    }
    if (this.mode !== 'paused') return;
    this.menus.show(null);
    this.mode = 'playing';
    this.input.gameplayEnabled = true;
    this.input.clearAll();
    this.input.requestPointerLock();
    this.loop.resetAccumulator();
  }

  private quitToTitle(): void {
    this.save();
    location.reload();
  }

  private shrineSpawn(sh: Shrine | null): { pos: THREE.Vector3; yaw: number } {
    if (!sh) return { pos: new THREE.Vector3(...PLAYER_START.p), yaw: PLAYER_START.yaw };
    const f = new THREE.Vector3(Math.sin(sh.yaw), 0, Math.cos(sh.yaw));
    const pos = sh.pos.clone().addScaledVector(f, 2.2);
    const g = this.physics.groundHeight(pos.x, pos.z, pos.y + 2, 6);
    if (g !== null) pos.y = g;
    return { pos, yaw: sh.yaw + Math.PI };
  }

  // ---------------------------------------------------------------------------
  // Death loop
  // ---------------------------------------------------------------------------
  private onPlayerDied(): void {
    this.deaths++;
    const p = this.player;
    const marrow = p.progress.marrow;
    // Previous remnant is lost forever; the new one holds everything carried.
    if (marrow > 0) {
      const at = p.lastSafe.clone();
      this.world.remnant.place(at, marrow);
      p.progress.marrow = 0;
    } else {
      this.world.remnant.clear();
    }
    this.mode = 'dead';
    this.input.gameplayEnabled = false;
    this.hud.setVisible(false);
    window.setTimeout(() => {
      this.menus.showDeath(marrow > 0 ? 'Your Marrow lies where you fell.' : 'The dark keeps what it takes.');
    }, 900);
    this.save();
  }

  private afterDeath(): void {
    window.setTimeout(() => {
      this.fadeTarget = 1;
      window.setTimeout(() => this.respawnAtShrine(), 1300);
    }, 2400);
  }

  private respawnAtShrine(): void {
    this.menus.show(null);
    this.resetWorldAfterRestOrDeath();
    if (!this.bossDefeated) {
      this.boss.resetFight();
      this.world.fogWall.restore();
      this.world.setArenaPhase(1);
      this.horror.bossFight = false;
      this.rotK = 0;
    }
    const { pos, yaw } = this.shrineSpawn(this.lastShrine);
    this.player.respawn(pos, yaw);
    this.cam.snapBehind(yaw);
    this.fadeTarget = 0;
    this.mode = 'playing';
    this.input.gameplayEnabled = true;
    this.input.clearAll();
    this.hud.setVisible(true);
    this.save();
  }

  private resetWorldAfterRestOrDeath(): void {
    for (const e of this.enemies) if (e !== this.boss && !e.phantom) e.reset();
    this.horror.clearPhantoms();
    this.hazards.clear();
    this.world.resetDynamics();
  }

  // ---------------------------------------------------------------------------
  // Shrines, items, doors, fog wall
  // ---------------------------------------------------------------------------
  private interact(target: Interactable): void {
    const p = this.player;
    switch (target.kind) {
      case 'shrine': {
        const sh = target as Shrine;
        const face = Math.atan2(sh.pos.x - p.pos.x, sh.pos.z - p.pos.z);
        if (!sh.lit) {
          p.startInteract(1.6, face, () => {
            sh.kindle();
            this.audio.playAt('shrine_ignite', sh.flamePos, { volume: 1, ref: 5 });
            this.particles.flameBurst(sh.flamePos, 40);
            this.hud.banner('CANDLE KINDLED', { gold: true, sub: sh.def.name });
            window.setTimeout(() => this.rest(sh), 1800);
          });
        } else {
          p.startInteract(0.2, face, () => this.rest(sh));
        }
        break;
      }
      case 'door': {
        const d = target as import('./world/interactables').ShortcutDoor;
        if (d.canOpenFrom(p.pos)) {
          p.startInteract(1.6, d.def.yaw + (d.def.openFrom === 'front' ? Math.PI : 0), () => {
            d.openDoor();
            this.audio.playAt('door_creak', d.pos, { volume: 1, ref: 6 });
            this.hud.message('The way is open.', 3);
            this.save();
          });
        } else {
          this.audio.playAt('step_wood', d.pos, { volume: 0.9, rate: 0.6 });
          this.hud.message('Barred from the other side.', 2.5);
        }
        break;
      }
      case 'fogwall': {
        const fw = this.world.fogWall;
        const inward = new THREE.Vector3(0, 0, -1);
        fw.setPassable(true);
        this.audio.play('fogwall', { volume: 0.9 });
        p.startFogWalk(inward, 1.7, () => {
          fw.setPassable(false);
          if (this.boss.alive && this.boss.state === 'dormant') this.startBossIntro();
        });
        break;
      }
      case 'item': {
        const it = target as Pickup;
        p.startInteract(0.7, null, () => {
          it.take();
          this.itemsTaken.add(it.id);
          const info = ITEM_INFO[it.item];
          const prog = p.progress;
          switch (it.item) {
            case 'marrow':
              this.addMarrow(it.amount);
              this.hud.toast(`${info.name} (${it.amount})`, info.desc);
              break;
            case 'vessel':
              prog.draughtsMax++;
              p.draughts++;
              this.hud.toast(info.name, info.desc);
              break;
            case 'oil':
              prog.fuelMax += 50;
              p.lantern.fuelMax = prog.fuelMax;
              p.lantern.drainMult = 0.8;
              p.lantern.refill();
              this.hud.toast(info.name, info.desc);
              break;
            case 'whetstone':
              prog.dmgBonus += 0.12;
              this.hud.toast(info.name, info.desc);
              break;
          }
          this.audio.play('pickup', { volume: 0.8 });
          this.particles.wisps(it.pos.clone().setY(it.pos.y + 0.5), 12, ITEM_INFO[it.item].color);
          this.save();
        });
        break;
      }
      case 'remnant': {
        const r = this.world.remnant;
        p.startInteract(0.6, null, () => {
          const amt = r.amount;
          r.clear();
          this.addMarrow(amt);
          this.audio.play('marrow', { volume: 1 });
          this.particles.wisps(r.pos.clone().setY(r.pos.y + 0.4), 30, 0xbfffe0);
          this.hud.message('You reclaim what you lost.', 3);
          events.emit('marrow:recovered', { amount: amt });
          this.save();
        });
        break;
      }
    }
  }

  private rest(sh: Shrine): void {
    const p = this.player;
    p.startRest();
    this.lastShrine = sh;
    this.audio.play('rest', { volume: 0.8 });
    this.fadeTarget = 0.65;
    window.setTimeout(() => {
      p.health = p.maxHealth;
      p.stamina = p.maxStamina;
      p.draughts = p.progress.draughtsMax;
      p.lantern.refill();
      p.lantern.on = true;
      this.resetWorldAfterRestOrDeath();
      this.fadeTarget = 0;
      this.save();
      this.mode = 'menu';
      this.input.gameplayEnabled = false;
      this.input.exitPointerLock();
      this.menus.openShrine(sh.def.name, this.litShrines(), this.levelInfo());
    }, 900);
  }

  private litShrines(): { id: string; name: string }[] {
    return this.world.shrines.filter((s) => s.lit).map((s) => ({ id: s.def.id, name: s.def.name }));
  }

  private levelInfo(): { attrs: import('./data/stats').Attributes; marrow: number; dmgBonus: number } {
    const p = this.player.progress;
    return { attrs: { ...p.attrs }, marrow: p.marrow, dmgBonus: p.dmgBonus };
  }

  private leaveShrine(): void {
    this.menus.show(null);
    this.player.endRest();
    this.mode = 'playing';
    this.input.gameplayEnabled = true;
    this.input.clearAll();
    this.input.requestPointerLock();
  }

  private applyLevelUp(a: import('./data/stats').Attributes, cost: number): void {
    const p = this.player;
    if (cost > p.progress.marrow) return;
    p.progress.marrow -= cost;
    p.progress.attrs = a;
    p.recalcStats(true);
    this.audio.play('levelup', { volume: 0.9 });
    this.menus.updateLevelInfo(this.levelInfo());
    this.save();
  }

  private travel(id: string): void {
    const sh = this.world.shrines.find((s) => s.def.id === id);
    if (!sh) return;
    this.fadeTarget = 1;
    this.menus.show(null);
    window.setTimeout(() => {
      const { pos, yaw } = this.shrineSpawn(sh);
      this.player.respawn(pos, yaw);
      this.cam.snapBehind(yaw);
      this.lastShrine = sh;
      this.save();
      this.fadeTarget = 0;
      this.menus.openShrine(sh.def.name, this.litShrines(), this.levelInfo());
      this.player.startRest();
    }, 1100);
  }

  private addMarrow(n: number): void {
    if (n <= 0) return;
    this.player.progress.marrow += n;
    this.hud.gain(n);
  }

  // ---------------------------------------------------------------------------
  // Boss
  // ---------------------------------------------------------------------------
  private startBossIntro(): void {
    this.mode = 'cinematic';
    this.cinematicT = 0;
    this.player.setCinematic(true);
    this.player.lockTarget = null;
    this.boss.wake();
    this.horror.bossFight = true;
    this.hud.setVisible(false);
  }

  private onBossPhase2(): void {
    this.world.setArenaPhase(2);
    this.hud.banner(this.boss.displayName, { sub: 'The wax gives way to rot', dur: 3 });
    this.rotK = 1;
  }

  private onBossDefeated(): void {
    this.bossDefeated = true;
    this.horror.bossFight = false;
    this.world.fogWall.dissolve();
    this.world.setArenaPhase(3);
    this.rotK = 0;
    this.save();
    window.setTimeout(() => {
      this.audio.play('victory', { volume: 0.9, vary: 0 });
      this.mode = 'menu';
      this.input.gameplayEnabled = false;
      this.input.exitPointerLock();
      this.hud.setVisible(false);
      this.menus.showVictory();
    }, 4200);
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------
  private fixedUpdate(dt: number): void {
    if (this.mode === 'loading' || !this.player) {
      this.input.endStep();
      return;
    }
    if (this.mode === 'paused' || this.mode === 'menu') {
      this.input.endStep();
      return;
    }
    this.combat.beginStep();
    this.noise.setTime(this.time.sim);
    this.player.update(dt);
    for (const e of this.enemies) e.update(dt);
    this.hazards.update(dt);
    this.physics.step();
    this.world.step();
    if (this.mode === 'playing') {
      this.playTime += dt;
      this.gameplayChecks();
    }
    if (this.mode === 'cinematic') {
      this.cinematicT += dt;
      if (this.cinematicT > 3.5) {
        this.mode = 'playing';
        this.player.setCinematic(false);
        this.input.gameplayEnabled = true;
        this.hud.setVisible(true);
        events.emit('boss:start', { name: this.boss.displayName });
        this.player.lockTarget = this.boss;
      }
    }
    this.regionTimer -= dt;
    if (this.regionTimer <= 0) {
      this.regionTimer = 0.25;
      this.updateRegion();
    }
    this.horror.update(dt, this.region);
    this.input.endStep();
  }

  private gameplayChecks(): void {
    const p = this.player;
    // nearest interactable
    this.prompt = null;
    if (p.canInteract) {
      let best: Interactable | null = null;
      let bd = Infinity;
      for (const it of this.world.interactables) {
        if (!it.enabled) continue;
        const d = it.pos.distanceTo(p.pos);
        if (d < it.radius && d < bd) {
          if (it.kind === 'fogwall' && (p.pos.z < this.world.fogWall.pos.z || !this.boss.alive)) continue;
          best = it;
          bd = d;
        }
      }
      if (best) {
        this.prompt = { target: best, text: this.promptText(best) };
        if (this.input.consume('interact')) this.interact(best);
      }
    }
  }

  private promptText(it: Interactable): string {
    switch (it.kind) {
      case 'shrine':
        return (it as Shrine).lit ? 'Rest at the candle' : 'Kindle the candle';
      case 'door':
        return (it as import('./world/interactables').ShortcutDoor).canOpenFrom(this.player.pos) ? 'Lift the bar' : 'Try the door';
      case 'fogwall':
        return 'Pass through the fog';
      case 'item':
        return `Take ${ITEM_INFO[(it as Pickup).item].name}`;
      case 'remnant':
        return 'Reclaim your Marrow';
    }
  }

  private get focus(): THREE.Vector3 {
    return this.mode === 'title' ? TITLE_FOCUS : this.player.pos;
  }

  private updateRegion(): void {
    const r = this.world.regionAt(this.focus);
    if (r.id !== this.region.id) {
      this.region = r;
      const last = this.lastRegionBanner.get(r.id) ?? -1e9;
      if (this.mode === 'playing' && performance.now() - last > 90000) {
        this.hud.region(r.name);
        this.lastRegionBanner.set(r.id, performance.now());
      }
    }
    this.ambience.setRegion(r.drone);
    this.audio.setReverb(r.reverb);
    this.world.lights.setRegionLighting(r.moon * (this.world.arenaPhase === 2 && r.id === 'arena' ? 0.2 : 1), r.ambient);
  }

  private debugTeleport(id: string): void {
    const r = REGIONS.find((x) => x.id === id);
    if (!r) return;
    const pos = new THREE.Vector3(...r.spawn);
    const g = this.physics.groundHeight(pos.x, pos.z, pos.y + 3, 10);
    if (g !== null) pos.y = g;
    this.player.teleport(pos);
    this.cam.snapBehind(this.player.yaw);
  }

  flash(amount: number, color?: THREE.ColorRepresentation): void {
    this.flashAmt = Math.max(this.flashAmt, amount);
    this.flashColor.set(color ?? 0xffffff);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  private frameCount = 0;

  private render(alpha: number, realDt: number): void {
    this.frameCount++;
    (window as unknown as { __stats: unknown }).__stats = { frames: this.frameCount, dt: realDt, mode: this.mode, calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles };
    this.input.poll(realDt);
    if (this.mode === 'loading' || !this.player) {
      this.renderer.setClearColor(0x050506);
      this.renderer.clear();
      return;
    }
    if (this.input.consume('pause')) {
      if (this.mode === 'playing') this.pause();
      // Esc both releases pointer lock (which pauses) and sends a key press:
      // ignore the echo so the game does not immediately resume.
      else if (this.mode === 'paused' && performance.now() - this.pausedAt > 400) this.resume();
    }
    let a;
    while ((a = this.input.consumeMenu())) {
      if (this.mode === 'title' && this.menus.current === 'title' && a === 'back') continue;
      this.menus.nav(a);
    }
    const scaledDt = realDt * this.time.currentScale;
    const p = this.player;

    // Camera
    const look = this.mode === 'playing' || this.mode === 'dead' ? this.input.consumeLook(realDt) : { x: 0, y: 0 };
    if (this.mode === 'title' || (this.mode === 'menu' && this.menus.current === 'victory' && false)) {
      this.titleT += realDt;
      const t = this.titleT * 0.04;
      const pos = new THREE.Vector3(Math.sin(t) * 7 + 3, 16.4 + Math.sin(t * 0.7) * 0.4, -36.5 + Math.cos(t) * 1.5);
      this.cam.camera.position.copy(pos);
      this.cam.camera.lookAt(0, 19.5, -52);
    } else {
      const lt = p.lockTarget;
      this.cam.lockTarget = lt && lt.alive ? lt.pos : null;
      this.cam.lockHeight = lt ? lt.height * (lt.def.type === 'boss' ? 0.55 : 0.9) : 1.2;
      if (this.mode === 'cinematic') {
        const b = this.boss;
        const toBoss = this.tmp.subVectors(b.pos, p.pos).setY(0).normalize();
        const side = new THREE.Vector3(-toBoss.z, 0, toBoss.x);
        const k = clamp01(this.cinematicT / 1.2);
        this.cam.override = {
          pos: p.pos.clone().addScaledVector(toBoss, 3).addScaledVector(side, 3.2).add(new THREE.Vector3(0, 2.2, 0)),
          look: b.pos.clone().setY(b.pos.y + 3.5 + 1.5 * clamp01(this.cinematicT / 2)),
          blend: this.cinematicT < 2.9 ? k : 1 - clamp01((this.cinematicT - 2.9) / 0.6),
        };
      } else this.cam.override = null;
      this.cam.setFovBoost(p.sprinting ? 4 : 0);
      const target = this.tmp.lerpVectors(p.prevPos, p.pos, alpha);
      this.cam.update(realDt, target, look, this.physics);
    }

    // Visuals
    p.renderUpdate(realDt, alpha);
    for (const e of this.enemies) if (!e.sleeping && !e.removed) e.render(alpha);
    this.updateAtmosphere(realDt);
    const camPos = this.cam.camera.position;
    const fogDist = Math.min(170, 2.6 / Math.max(0.012, this.fogDensity));
    this.world.update(realDt, this.time.real, camPos, this.focus, alpha, fogDist);
    this.particles.update(scaledDt);
    this.ambientParticles(realDt);
    fogUniforms.fogTime.value = this.time.real;
    this.sky.update(camPos, this.fogColor, this.time.real, this.moonK);

    // Audio
    this.ambience.update(realDt, {
      dread: this.horror.dread,
      health: p.health / p.maxHealth,
      playerPos: p.pos,
      forward: this.cam.forward(new THREE.Vector3()),
      bossActive: this.boss.fightActive && this.boss.alive,
      bossPhase: this.boss.phase,
      paused: this.mode === 'paused' || this.mode === 'title',
    });

    // HUD
    this.updateHud();

    // Post
    this.flashAmt = Math.max(0, this.flashAmt - realDt * 2.2);
    this.fadeAmt = damp(this.fadeAmt, this.fadeTarget, 3, realDt);
    this.hurtK = Math.max(0, this.hurtK - realDt * 1.5);
    const lowHp = clamp01((0.35 - p.health / p.maxHealth) / 0.35);
    this.post.update({
      time: this.time.real,
      dread: this.mode === 'title' ? 0.2 : this.horror.dread,
      hurt: Math.max(this.hurtK * 0.8, lowHp * (0.55 + 0.25 * Math.sin(this.time.real * 5)), p.damageTakenFlash * 0.6),
      fade: this.fadeAmt,
      flash: this.flashAmt,
      flashColor: this.flashColor,
      rot: this.rotK,
    });
    this.renderer.info.reset();
    this.post.render(realDt);
    this.debugOverlay.update(realDt, `region ${this.region.id} · dread ${this.horror.dread.toFixed(2)} · mode ${this.mode}`);
  }

  private updateAtmosphere(dt: number): void {
    const r = this.region;
    let target = new THREE.Color(r.fogColor);
    let density = r.fogDensity;
    if (r.id === 'arena' && this.world.arenaPhase === 2) {
      target = new THREE.Color(0x1a0705);
      density = 0.026;
    }
    // shuttering the lantern makes the fog swallow even more
    if (!this.player.lantern.lit && this.mode === 'playing') density *= 1.12;
    this.fogColor.lerp(target, 1 - Math.exp(-1.2 * dt));
    this.fogDensity = lerp(this.fogDensity, density, 1 - Math.exp(-1.2 * dt));
    this.fog.color.copy(this.fogColor);
    this.fog.density = this.fogDensity;
    this.moonK = damp(this.moonK, r.id === 'crypt' ? 0 : r.moon > 0 ? 1 : 0, 1, dt);
    // the rotting heart bathes the Godwound in red once the Wick-Mother is unmade
    const red = r.id === 'arena' && this.world.arenaPhase === 2;
    this.world.lights.hemi.color.lerp(red ? HEMI_RED : HEMI_SKY, 1 - Math.exp(-1.5 * dt));
    fogUniforms.fogHeightBase.value = damp(fogUniforms.fogHeightBase.value, this.focus.y - 2, 1, dt);
  }

  private ambientParticles(dt: number): void {
    const kind = this.region.id === 'forest' || this.region.id === 'arena' ? 'ash' : this.region.id === 'village' ? 'spore' : 'dust';
    this.particles.ambient(dt, this.cam.camera.position, kind);
    // flames shed embers
    for (const f of this.world.lights.flames) {
      if (f.level < 0.3) continue;
      if (f.pos.distanceToSquared(this.player.pos) > 900) continue;
      if (Math.random() < dt * 6 * f.level) this.particles.embers(f.pos, 1, 0.15);
      if (f.tag === 'shrine' && Math.random() < dt * 2) this.particles.smoke(f.pos.clone().setY(f.pos.y + 0.3), 1);
    }
    for (const it of this.world.items) if (it.enabled && Math.random() < dt * 3) this.particles.wisps(it.pos.clone().setY(it.pos.y + 0.5), 1, ITEM_INFO[it.item].color);
    const r = this.world.remnant;
    if (r.enabled && Math.random() < dt * 8) this.particles.wisps(r.pos.clone().setY(r.pos.y + 0.3), 1, 0xbfffe0);
    for (const s of this.world.shrines) if (!s.lit && Math.random() < dt * 1.2 && s.pos.distanceToSquared(this.player.pos) < 400) this.particles.smoke(s.flamePos, 1, 0x3a3836);
  }

  private updateHud(): void {
    if (this.mode !== 'playing' && this.mode !== 'cinematic') return;
    const p = this.player;
    let lock: { x: number; y: number; crit: boolean } | null = null;
    const lt = p.lockTarget;
    if (lt && lt.alive) {
      const c = lt.center(new THREE.Vector3()).project(this.cam.camera);
      if (c.z < 1) {
        lock = {
          x: (c.x * 0.5 + 0.5) * window.innerWidth,
          y: (-c.y * 0.5 + 0.5) * window.innerHeight,
          crit: lt.canRiposte(),
        };
      }
    }
    let hint: string | null = null;
    for (const h of HINTS) {
      if (Math.hypot(p.pos.x - h.p[0], p.pos.z - h.p[2]) < h.r && Math.abs(p.pos.y - h.p[1]) < 3) {
        hint = this.input.usingGamepad ? h.pad : h.kb;
        break;
      }
    }
    const key = this.input.usingGamepad ? 'Y' : 'E';
    this.hud.update({
      hp: p.health,
      maxHp: p.maxHealth,
      st: p.stamina,
      maxSt: p.maxStamina,
      fuel: p.lantern.fuel,
      fuelMax: p.lantern.fuelMax,
      lanternOn: p.lantern.lit,
      draughts: p.draughts,
      draughtsMax: p.progress.draughtsMax,
      marrow: p.progress.marrow,
      dread: this.horror.dread,
      lock,
      boss: this.boss.fightActive || (this.boss.alive && this.boss.state === 'transform') ? { name: this.boss.displayName, hp: this.boss.health, max: this.boss.maxHealth } : null,
      prompt: this.prompt ? { key, text: this.prompt.text } : null,
      hint,
    });
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
    this.post?.setSize(w, h);
    this.particles?.setViewport(h * this.renderer.getPixelRatio(), this.cam.camera.fov);
  }
}
