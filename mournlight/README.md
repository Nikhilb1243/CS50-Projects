# MOURNLIGHT

A fully 3D, third-person, open-world soulslike with a survival-horror tone.
TypeScript + Vite + Three.js + Rapier + pmndrs `postprocessing` + Web Audio.
Every model, texture and sound is generated in code: there are no asset files.

> When Ithrenn, the Kindling God, died, no one buried Him. He fell at the heart
> of Vael and began to rot, and from the rot rose the fog. You were ash once.
> Now you are a revenant bound to a lantern, carrying the last flame in the world.

## Running

```bash
cd mournlight      # the game lives in this folder of the repository
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle in dist/
```

Click the page once so the browser allows audio and pointer lock. Headphones help.

## Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move / camera | WASD / mouse | Left stick / right stick |
| Run | Hold Shift | Hold B |
| Dodge roll (i-frames) | Space | Tap B |
| Leap | C | A |
| Strike (3-hit chain) | Left mouse | RB |
| Heavy strike (hold to charge) | Shift + left mouse | RT |
| Guard (press as a blow lands to parry) | Right mouse | LB |
| Lock on / recenter camera | Q or middle mouse | R3 |
| Switch target | Mouse wheel or flick | Flick right stick / D-pad |
| Tallow Draught | R | X |
| Interact / rest | E | Y |
| Shutter the lantern | F | LT / D-pad up |
| Swap armament | X | D-pad down |
| Ultimate (when the meter is full) | V | Back / View |
| Bow: draw (hold) and loose (release) | Hold left mouse | Hold RB |
| Bow: aim over the shoulder | Hold right mouse | Hold LB |
| Journal | J | |
| Map | M | |
| Pause | Esc | Start |
| Debug overlay | F1 | |

When the debug overlay is open: F2 shows hitboxes, F3 toggles god mode, F4 gives 5000 Marrow, F6 kills nearby creatures, F7 refills you, and keys 1 to 6 teleport to each region.

## Enhancement pass

See `ENHANCE_PLAN.md` for the milestone plan and per-milestone notes.

- **Lighting and graphics:** half-float HDR chain with N8AO ambient occlusion, GPU auto-exposure (eyes adapt between black crypts and moonlit fields), moon god rays, bloom, ACES or AgX tone mapping, a procedurally baked colour-grading LUT per region, SMAA, cascaded soft moon shadows (High/Ultra), a procedural environment map for reflections, wet surfaces and puddles, moonlight shafts through the cathedral windows, gusting candle and torch light. Quality presets **Low / Medium / High / Ultra** apply instantly; High and Ultra also scale resolution dynamically to hold 60 fps.
- **Armaments** (found in the world, swapped with X or from Pause > Armaments):
  - *Wickblade* (longsword): the balanced three-cut chain. Ultimate **Pale Crescent**, a travelling crescent of spectral blue fire.
  - *Coffin-Lid Slab* (greatsword, Gallowwood hollow): slow, hyper-armoured, staggers anything. Ultimate **Gravebreak**, a slam that splits the earth into a line of eruptions.
  - *Hush and Lull* (twin daggers, a Brinemoor house): fast four-hit chains; hits build **bleed** that bursts for heavy damage. Ultimate **Hushstep**, blinking through up to five foes and leaving cuts of cold blue light.
  - *Gloamstring* (bow, the Wick Ossuary): hold to draw, release to loose; aim over the shoulder with zoom and a crosshair; arrows drop with gravity, headshots deal 1.8x, the quiver refills at candles. Ultimate **Pale Deluge**: an arrow into the sky, then a rain of blue-flame arrows over a marked circle that leaves the ground burning.
  - The **ultimate meter** fills from dealing damage, parrying and being hit.
- **Guidance:** a main objective per region plus optional deeds (tracker at the top right, journal on J), a fog-of-war map on M, region title cards, notes of the dead that hint at secrets and boss weaknesses, a hint after several minutes without progress, and a lantern flame that leans toward where you must go while faint wisps mark the way.
- **Creatures:** eye halos, drips and crawling skin on every creature, stop-motion twitching for stalkers, crawlers and screamers, unsettling idles. New: the **Corpse-Mimic** (lies among the dead and rises when you come close), the **Screamer** (wails and summons everything nearby) and the **Ashwing Swarm** (moths that smother your lantern).
- **Two new regions**, unlocked boss by boss through passages: the **Weeping Catacombs** beneath the Godwound (a flooded ossuary whose water rises and falls; boss **The Bone Choir**, a singing mass of fused bodies that splits into three) and **Bellspire** (a tower climbed through wind gusts and lightning; boss **The Hanged Warden**, who swings from a gibbet and, when its chains snap, fights with its bell). Each has two shrines, a shortcut, loot and an upgrade (Choir-Bone Charm, Stormglass Whetstone).
- **Sound:** footsteps by surface, stone impacts, bow creak and twang, arrow whistle, roaring blue flame, a generated reverb impulse per region, muffling behind walls, and music that moves from sparse bell tolls to a boss ostinato that intensifies each phase.
- **Polish:** controller rumble, a FOV punch on connecting blows, animated menus, auto-save at shrines and passages with Continue on the title screen.

## What's in the vertical slice

- **One seamless map, five overworld regions, explorable in any order** (plus the two deep regions above). The Wick Ossuary is an underground crypt that teaches the controls. Brinemoor is a drowned village with stilt houses, boardwalks and a bell tower. Gallowwood is a dead forest with a ridge, a ravine and a sunken hollow. The Cathedral of the Last Vigil is a nave with galleries, a rood bridge and an apse. The Godwound is the boss arena, ringed by a dead god's ribs.
- **Verticality:** cliffs and a 14 m plateau, a causeway ramp, switchback stair towers, galleries, a bridge over the ravine, a stair shaft out of the crypt, and fall damage.
- **Four Candle Shrines.** Resting heals you, refills your draughts and lantern oil, respawns creatures, and opens the level-up and fast-travel menus.
- **Shortcut door:** the Undercroft tower door is barred from the inside and can only be opened from the cathedral side.
- **Optional loot:** a Tallow Vessel (+1 draught) at the top of the bell tower and another in the cathedral gallery, Grave-Moss Oil in the forest hollow, a Knucklebone Whetstone on top of the watch ruin, and bundles of Marrow.
- **Four enemy types plus a boss**, all driven by a state machine (patrol, investigate noise or lantern light, chase, telegraphed attack, recovery):
  - *Shambler*: slow and tanky, with a swipe and a grab that bites three times.
  - *Stalker*: fast. It moves only while it is outside the light or out of your view, and freezes mid-stride when you look at it inside your lantern's glow.
  - *Crawler*: clings to ceilings and walls, then drops on you and hunts on all fours.
  - *Drowned Knight*: an elite with chained combos, a long delayed overhead swing and high poise.
  - *Oskeline, the Wick-Mother*: the boss waits behind a fog wall and has a named health bar. At 50% she transforms into *Oskeline, Unwicked*: her mask falls off as a physics prop, she drops her candelabrum, grows claws and gains a leaping slam, rot bursts and flame waves. The arena's braziers gutter out and the god's heart lights the arena red.
- **Combat:**
  - Light chains and a charged heavy.
  - Block, plus a timed parry: the first 0.2 s of a guard press.
  - Ripostes on parried enemies, backstabs, and posture breaks on the boss.
  - Stamina costs for sprinting, rolling, attacking and blocking.
  - Hit-stop, camera shake, sparks, blood and ichor.
- **Swept hitboxes:** each weapon is a segment attached to the animated skeleton. Every simulation step during an attack's active frames, it sweeps from its previous pose to its current pose (5 sub-samples) and is tested against capsule hurtboxes. No attack uses a distance check.
- **Death loop:** when you die you drop all your Marrow where you last stood and respawn at your last shrine. Reclaim it by reaching it; die first and it is gone for good.
- **Horror layer:**
  - The lantern has limited oil, and a lit lantern draws creatures from farther away. Shuttering it hides you but leaves you nearly blind.
  - Dread rises in the dark, near horrors and at low health. As it climbs you get whispers, phantom footsteps, screen warping, and fake creatures that dissolve when struck.
  - Distant silhouettes stand in the fog and vanish when you approach or stare at them.
  - Hanging cages, corpses frozen mid-escape, and messages scrawled in blood.
  - Heartbeat at low health, and rare stingers.

## Architecture

```
src/
  core/      loop (fixed 60 Hz + interpolation), time/hit-stop, input (kb/mouse/pointer lock/gamepad),
             physics wrapper (Rapier KCC), camera (orbit, sphere-cast collision, lock-on), settings, save, events
  data/      attacks.ts (windup/active/recovery frames, lunges, hazards), weapons.ts, enemies.ts, stats.ts
  world/     layout.ts  <- the whole map as data (terrain modifiers, structures, spawns, items, messages)
             terrain (heightfield + triplanar shader), builder (merges geometry, creates colliders),
             props (instanced trees/rocks/graves/reeds, cages, physics barrels), lights (flame pool),
             interactables (shrines, door, fog wall, pickups, remnant), textures (procedural PBR), world.ts
  entities/  rig (skeleton, pose blending, skinned mesh builder), poses (keyframes + locomotion),
             animator, models (procedural models + GLTF provider), actor, player, lantern
  combat/    swept hit detection, area hazards (shockwaves, bursts, flame waves), arrows + ultimates
  ai/        enemy state machine + perception, creature types, creature dressing, Oskeline, deep bosses, noise bus
  audio/     procedural synthesis, AudioEngine (THREE.PositionalAudio pool + convolution reverb), ambience
  fx/        post-processing (AO, exposure, LUT, god rays, SMAA), fog, particles + GPU particles, trails,
             sky, env map, horror director (dread)
  ui/        HUD, menus (title/pause/armaments/journal/map/death/level-up/travel/settings/controls), map, debug overlay
```

- **Fixed timestep:** the simulation always steps at 60 Hz, and rendering interpolates actor transforms by the leftover fraction of a step. Hit-stop scales simulation time, not rendering time.
- **Procedural animation:** every character shares one 17-joint hierarchical rig. Poses are Euler-angle keyframes blended in two layers: speed-driven locomotion, plus an action layer with per-joint masks for upper-body actions such as drinking or blocking. The procedural characters are single skinned meshes with rigidly bound primitives, so each costs 1 to 3 draw calls.
- **Swapping in GLTF models:** `entities/models.ts` exposes a `ModelLibrary` of providers. To register a GLTF character:
  ```ts
  const gltf = new GLTFModelProvider();
  await gltf.load('shambler', '/models/shambler.glb', { hips: 'Hips', spine: 'Spine', /* ... */ }, { sockets: { weaponBase: { bone: 'RightHand', pos: [0, 0, 0] } } });
  models.register(gltf, true); // takes priority over the procedural builder
  ```
  The skeleton must map onto the 17 named joints. Poses are applied on top of each bone's rest rotation.
- **Performance:**
  - Static architecture is merged per material into 48 m chunks.
  - Props are instanced per 40 m chunk and culled at the fog distance.
  - Flames share one instanced draw call.
  - The point-light count stays fixed (a pool assigned to the nearest flames) so shaders never recompile.
  - Creatures far from the player sleep.
  - The moon's shadow frustum follows the player.
  - Quality presets (Low/Medium/High/Ultra, `QUALITY_PROFILES` in `core/settings.ts`) set resolution, AO, SMAA, shadow resolution/softness/cascades, god rays, point-light count and lantern shadows, and apply at runtime.

## Notes

- Progress (stats, lit shrines, opened doors, looted items, dropped Marrow, boss state) is saved to `localStorage` when you rest, pick something up, open a door, die or defeat the boss. **Continue** on the title screen resumes from your last shrine.
- `viewer.html` (dev server only) is a model and pose viewer, for example `/viewer.html?ids=revenant&poses=guard,slashR_wind,slashR_hit`.
- Development URL flags: `?autostart&tp=<region>&god&hitboxes&debug&boss&arms&weapon=bow&ult&pos=x,y,z`. `tp` also accepts `catacombs` and `bellspire`.
