# MOURNLIGHT: enhancement plan

Working plan for the enhancement pass. Milestones are done in order; after each one the work is
committed and pushed, and a progress note is added at the bottom of this file so a later session
can pick up where the last one stopped.

Rules: extend existing systems (don't rewrite), same stack (TypeScript + Vite + Three.js + Rapier +
pmndrs postprocessing + Web Audio), everything original (names, lore, enemies, designs), verify with
`npm run build` plus a console-error check, at most one screenshot per milestone.

## Milestone 1: Lighting, graphics and HDR
- HDR rendering: half-float buffers, AgX or ACES tone mapping, and auto-exposure that adapts when moving between dark interiors and brighter areas.
- Cascaded soft shadows, ambient occlusion (N8AO or SSAO), god rays through windows and fog, flickering torch and candle light, emissive materials with bloom.
- A procedural environment map and moody sky for reflections, plus a colour-grading LUT per region.
- Procedural PBR textures (stone, wet wood, rusted metal, flesh) with normal and roughness detail, and wet surfaces and puddles with reflections.
- SMAA anti-aliasing.
- Quality presets (Low / Medium / High / Ultra) that apply instantly without reloading.

## Milestone 2: Weapons and ultimate attacks
- A weapon system with 4 weapons, each with its own light/heavy moveset, stats, swing trails and impact effects:
  1. Longsword (refine the existing weapon)
  2. Greatsword: slow, heavy, big stagger
  3. Twin daggers: fast combos with bleed build-up
  4. Bow: over-the-shoulder aim with zoom and crosshair, draw time, arrows with gravity, headshot bonus, arrows refilled at shrines
- Weapons are found in the world and switched from the inventory or a quick-swap key.
- An ultimate meter that fills from dealing damage, parrying and taking hits. When full, each weapon unleashes a spectacular ultimate:
  - Bow, "Pale Deluge": fire an arrow into the sky; after a short pause, a rain of blue-flame arrows falls over a targeted circle, with glowing trails, bright impact bursts, lingering blue fire on the ground that deals damage over time, flashing light, camera shake, and a brief slow-motion moment on activation.
  - Longsword: a crescent wave of spectral blue fire that travels forward.
  - Greatsword: a ground slam that splits the earth with erupting flame.
  - Daggers: a blink-dash through several enemies, leaving cuts of cold blue light.
- Build a reusable instanced GPU particle system (trails, sparks, embers, smoke, heat haze). Pool dynamic lights to protect performance.

## Milestone 3: Objectives and guidance (players must never get stuck)
- Each region has a main objective and optional ones, shown in an on-screen tracker and a journal (J key).
- Diegetic guidance: the lantern flame leans toward the current objective, and faint wisps light the main path.
- A map (M key) that reveals explored areas and marks shrines, bosses and objectives.
- Title cards when entering a new region.
- Notes left by the dead that hint at secrets and boss weaknesses.
- A subtle hint if the player makes no progress for several minutes.
- Clear progression: beating a boss unlocks the way to the next region.

## Milestone 4: Scarier, more refined monsters
- Rebuild the 4 existing enemies with far more detail: layered procedural geometry, glowing eyes, dripping particles, subtly shifting skin.
- Better animation: procedural IK legs for crawlers, twitchy stop-motion movement, unsettling idle behaviours, proper death animations.
- 3 new enemy types, each with its own horror mechanic: a corpse-mimic that ambushes, a screamer that calls nearby enemies, and a moth swarm that smothers your lantern.
- Distinct sounds for every enemy: breathing, footsteps, attack cues, deaths.

## Milestone 5: Two new regions and bosses
- Region 2, the Weeping Catacombs: a flooded underground ossuary with rising and falling water, heavy on darkness.
  - Boss: The Bone Choir, a mass of fused bodies that sings. In phase 2 it splits into three parts.
- Region 3, Bellspire: a ruined bell tower climbed vertically through wind and lightning.
  - Boss: The Hanged Warden, a giant hanging from chains that attacks while swinging. In phase 2 it crashes down and fights with its bell.
- Each boss gets a cinematic intro (camera move and name card), 2–3 phases with readable telegraphs, a weak point, and its own arena lighting.
- Each region gets at least 2 shrines, a shortcut, optional loot, and one new weapon or upgrade.

## Milestone 6: Sound
- Layered procedural effects: swings with pitch variation, impacts by material (flesh, metal, stone), footsteps by surface, bow creak and twang, arrow whistle, roaring blue flame.
- Reverb per region (generated impulse responses) and muffling for sounds behind walls.
- Dynamic music: ambient drones while exploring that build into boss themes, rising in intensity each phase.
- If network access is available, CC0 (public domain) sounds and textures only (Poly Haven, ambientCG, Kenney), each listed in `CREDITS.md` with its source link. Otherwise stay procedural.

## Milestone 7: Polish
- Save system: auto-save at shrines and "Continue" on the title screen.
- Controller vibration, smoother UI animations, stronger hit feedback.
- Performance pass: 60 fps on a mid-range GPU at High.
- Update README.md with the new controls, weapons and regions.

## Progress notes

### Milestone 1: done (session 1)
- `core/settings.ts`: `QUALITY_PROFILES` (Low/Medium/High/Ultra) + tone-mapping setting (ACES/AgX). `Game.applyQuality()` applies a preset at runtime: pixel ratio, post chain rebuild, shadow res/softness, cascades on/off, point-light pool size, lantern shadow, env map. Texture detail is now fixed at full size so nothing needs a reload.
- `fx/post.ts`: half-float chain: N8AO (`n8ao` package, half/full res by preset) -> auto-exposure (`ExposureEffect`, GPU luminance mip chain + adaptation, no readback) -> moon god rays (High+) -> bloom -> ACES/AgX -> grade with per-region 3D LUT cross-fade -> vignette -> SMAA -> chroma + grain.
- `fx/lut.ts`: procedural per-region grades baked into 24^3 LUTs. `fx/envmap.ts`: procedural PMREM night environment; `scene.environmentIntensity` per region (`REGION_LOOK` in game.ts).
- `world/lights.ts`: cascaded shadow maps via three's CSM addon on High/Ultra (materials are patched automatically, chained with existing `onBeforeCompile`), PCF radius softness, flame gust/gutter flicker and swaying light positions.
- `world/wetness.ts`: wet-surface/puddle shader patch on world materials + terrain, amount per region. New textures: rusted iron with metalness map, wet wood (boardwalks, stilts), flesh (the Godwound heart).
- `world/shafts.ts` + `SHAFTS` in layout: moonlight shafts through the cathedral windows and roof breaks.
- Dev helpers: `window.__settings.set('quality','ultra')`, `window.__lum()` (adapted luminance).

### Milestone 2: done (session 1)
- `data/weapons.ts`: 4 weapons (Wickblade longsword, Coffin-Lid Slab greatsword, Hush and Lull twin daggers, Gloamstring bow) with own light chains/heavies (new attack defs merged into `ATTACKS`), stats, trail/impact colours, hit-stop scale, bleed, ultimates. `BOW` and `ULT_*` tuning.
- `entities/weapons.ts`: procedural weapon meshes + `WeaponRig` (attaches to hand bones, moves striker sockets per weapon, left-hand `weaponL` striker for the daggers, animated bow string). The Wickblade is no longer baked into the Revenant mesh.
- Player: `equip/cycleWeapon/giveWeapon`, bow `draw` state (hold strike to draw, release to loose; guard = aim; over-the-shoulder camera zoom `cam.aim`, crosshair that tightens with draw), ultimate meter (`gainUlt` from damage dealt, parries, hits taken), `ult` state with i-frames. Keys: X swap (D-pad down), V ultimate (Back/View).
- `combat/abilities.ts`: arrows with gravity, world sticking, capsule hits and headshot bonus; ultimates Pale Deluge (signal arrow, 46 blue-flame arrows over a marked circle, impact bursts, lingering blue fire DoT patches, slow-mo, flashes, shake), Pale Crescent, Gravebreak (fissure eruptions), Hushstep (blink through up to 5 foes, cold light cuts, bleed).
- `fx/gpuparticles.ts`: instanced GPU particle system (analytic motion in the vertex shader, ring-buffer writes, velocity stretch; additive / alpha / haze layers). Heat haze is approximated with shimmering low-alpha quads (no true refraction yet).
- `fx/trails.ts`: swing ribbons. `LightManager.flash()`: transient lights borrow the fixed pool (no extra lights).
- Enemy bleed build-up (`Enemy.addBleed`). Weapons are pickups (bow: crypt near the alcove; daggers: Brinemoor house; slab: Gallowwood hollow); arrows refill at shrines; weapons/arrows saved. Pause menu -> Armaments page to equip.
- Dev: `?arms&weapon=bow&ult`, `window.__game`.

### Milestone 3: done (session 1)
- `world/objectives.ts`: `OBJECTIVES` (main chain: First Wick -> Brinemoor Chapel -> Gallowwood Wayside -> Last Vigil -> Wick-Mother; optional deeds per region), evaluated from game facts every 0.5 s by `ObjectiveTracker` (no scripted triggers). Idle hint after 4 min without progress (then every 3 min). `NOTES`: notes of the dead (read by walking up to them) with secret and boss-weakness hints.
- HUD tracker (top right, main + nearby optional), toast on completion, title cards with a subtitle on first entry to a region (`REGION_SUBTITLES` in game.ts).
- Journal (J) and map (M) screens in `ui/menus.ts`; `ui/map.ts` fog-of-war map (4 m cells revealed around the player, region tints, shrines, boss, objectives, notes, player arrow). Explored mask, notes and visited regions are saved.
- Diegetic guidance: the lantern flame leans toward the main objective (`Lantern.lean`), faint blue wisps appear along the ground in that direction (skipped during boss fights).
- Left for M5: "beating a boss unlocks the next region" (the new regions don't exist yet). Wisps follow the straight-line direction, not a navmesh path.

### Milestone 4: done, reduced scope (session 1)
- `ai/dress.ts`: `CreatureDress` for shambler, stalker, crawler, knight and the new types: blooming eye halos (brighter when hunting), periodic drips (GPU particles), and a "crawling skin" shader patch (sub-surface swelling in the vertex shader + pulsing dark veins), chained onto the existing material patches.
- `ai/enemy.ts`: stop-motion pose holding for stalkers (3 steps), crawlers (2) and screamers (4); unsettling idle head-snaps and crooked leans; `summon()` for screams.
- New creatures in `ai/creatures.ts` + `data/enemies.ts` + spawns in layout: **Corpse-Mimic** (lies as a corpse, fingers twitch in lantern light, rises with cracking joints when you come within 3 m), **Screamer** (keeps its distance, wails and summons every creature within 38 m, 14 s cooldown), **Ashwing Swarm** (instanced moths drawn to a lit lantern that smother it and drain fuel; shutter the lantern and they lose interest; hits scatter them).
- New procedural sounds: `screamer_wail`, `mimic_crack`, `moth_flutter`.
- Not done (left for a later pass): procedural IK legs for crawlers, full per-enemy geometry rebuilds, new bespoke death animations (existing death poses are used), distinct footstep/breath sets for the original four (they already had per-type breath/voice/step sounds).

### Milestone 5: done, reduced scope (session 1)
- Two new regions built as layout data far east of the overworld (x ~290-360), reached by `PASSAGES` (glowing stair/lift rings, `Passage` interactable) that unlock when the previous boss falls: Godwound -> **Weeping Catacombs** (after Oskeline) -> **Bellspire** (after the Bone Choir); return passages and a bell-rope lift down from the top of the tower.
- Weeping Catacombs: flooded ossuary (arrival hall with bone niches, barred direct corridor = shortcut door `catacomb-bar`, Weeping Nave detour, the Choir's hall). Flood water rises and falls on a ~55 s tide (`World.floodLevel`, slows the player). Very dark fog/LUT. Shrines: Drowned Reliquary, Weeping Nave. Loot: Choir-Bone Charm (ultimate meter +35%), 600 Marrow.
- Bellspire: rock shelf, 42 m tower with an inner stair (existing tower builder), gibbet deck at the top. Wind gusts shove the player above 20 m, lightning flashes + delayed thunder. Shrines: Bellfoot, The Ropewalk. Loot: Stormglass Whetstone (+15% damage), 900 Marrow. Shortcut: bell-rope lift.
- `ai/bosses.ts`: `DeepBoss` base (Combatant, lockable, weak point = double damage, telegraph markers, own arena flames, reset on death/leaving), **The Bone Choir** (crawling fused mass, Dirge ring / Bone Hail / Grasp wave; weak point the Cantor head; phase 2 splits into three orbiting singing parts with separate health) and **The Hanged Warden** (pendulum swings from a gibbet that scythe the deck, Toll shockwave; weak point the caged heart; phase 2 the chains snap, it crashes down and fights with its bell: slam, Knell, wave).
- Cinematic intro (camera move + name card via `hud.banner`) for both; boss bar, boss music flag, saving of defeated bosses; objectives and notes (Cantor weakness, caged heart) extended for both regions.
- Not done: third phase, bespoke boss audio (reuses wail/shockwave/roar), rising water drowning damage, extra weapons (upgrades were added instead).
