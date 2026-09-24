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
