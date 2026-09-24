# MOURNLIGHT: optimisation and AAA polish pass

Follow-up to `ENHANCE_PLAN.md`. Milestones are done in order; after each one the work is
committed and pushed to `main`, and a progress note is added at the bottom of this file so a
later session can continue.

Rules: extend existing systems (no rewrites), everything original (no names, designs or content
from Elden Ring or any other game), read only the files needed, targeted edits, verify with
`npm run build` plus a console-error check, at most one screenshot check per milestone (Milestone 2
gets one before/after pair). If a milestone grows too big, ship a smaller working version, note
what is left, and move on. Usage budget is tight (about US$25).

## Milestone 1: Performance and level streaming
- The whole level must not be built and spawned at once. Split each region into chunks that load and unload by distance from the player, fading in behind the fog so nothing visibly pops in.
- Spawn enemies only when the player gets near their area, and put distant enemies to sleep (no AI or physics updates).
- Merge static geometry and instance repeated props to cut draw calls. Add LODs for enemies and props, and cull by distance in line with the fog range.
- Precompile shaders behind a short loading screen with a progress bar, so there's no stutter the first time an effect or enemy appears.
- Add an FPS counter toggle in settings. Target a steady 60 fps on a mid-range GPU at High.

## Milestone 2: Fix the lighting
The lighting currently looks bad. Diagnose the causes and fix them properly:
- Check exposure, tone mapping, colour space and auto-exposure so scenes are neither crushed black nor washed out.
- Fix shadow acne, detached shadows, light leaking through walls, and flickering shadows.
- Darkness must stay playable: the player, enemy silhouettes, paths and interactable objects must always be readable. Use rim light on characters, a soft fill light around the player, and warm key lights at shrines and objectives.
- Give each region a hand-tuned lighting setup (key light, fill, fog colour, colour grading) stored in data.
- Do one before/after screenshot comparison to confirm the fix.

## Milestone 3: Level clearing, objectives and hints
- Each region has a clear goal list (main and optional). When the main goal and boss are done, show a "Region Cleared" screen with time, deaths, enemies defeated, secrets found and a reward, then open the way to the next region.
- Hints: a short tip the first time the player meets each new mechanic, a boss-weakness hint after repeated deaths, and a "Where do I go?" option in the pause menu that points toward the next objective.
- Mark objectives in the world with subtle markers (wisps, lit candles) as well as the on-screen tracker.

## Milestone 4: Weapon shop
- Add an original merchant character at shrines: hooded, lantern-lit, with an idle animation and a murmuring procedural voice.
- The shop sells weapons, arrows, healing-draught upgrades and weapon upgrades (+1 to +5) for Marrow. Its UI shows stats, a comparison with the equipped weapon, and a rotating 3D preview of the item.
- New stock unlocks as regions are cleared. Balance prices so the shop is useful but never required.

## Milestone 5: Refined monster models
- Improve every enemy and boss model: stronger silhouettes, better proportions, layered geometry, varied materials (wet skin, bone, cloth, rust), glowing eyes, and subtle breathing and twitching.
- Smoother animation blending, hit reactions that come from the direction of the hit, and better death animations (collapse, then dissolve into ash or mist).
- Use the LOD … *(the brief was cut off here; presumably: use the Milestone 1 LOD system for the refined models. Anything after this point was not received.)*

## Progress notes

### Milestone 1: done (2026-09-24)
- `world/streaming.ts` `ChunkStreamer`: merged static chunks (`World.chunks`) and instanced prop chunks
  (`PropSet.streamer`) join/leave the scene graph by distance with hysteresis. The load radius is the fog
  range (`2.6 / fogDensity`, where exp² fog is fully opaque), so chunks appear out of the murk with no pop.
  Static chunks far behind (> 2× range + 40 m) also release their GPU buffers; three.js re-uploads on return.
- Enemies (`ai/enemy.ts`): `Enemy.viewDist/wakeDist` are set each frame from the fog range. Beyond it an
  enemy is removed from the scene and its physics character disabled (`streamedOut`), with no AI, animation
  or audio. Between wake and view range it sleeps. Animation LOD: rig updates every 2nd step past 30 m and
  every 3rd past 55 m (full rate while attacking or dying). Shadows only within 28 m (as before).
- Prop LOD: trees have a low-detail geometry (fewer sides, twigs dropped, same rng so the silhouette
  matches) that is swapped per chunk past 40 m and shares the instance buffer; far chunks skip shadows.
- Shader warm-up: `Game.warmShaders()` compiles all scene materials in batches (parallel compile when
  `KHR_parallel_shader_compile` exists) behind the loading bar ("Kindling the shaders", 88–100 %).
- Settings: "Show FPS counter" checkbox (`showFps`) drives the debug FPS readout, which now uses wall-clock
  frame time.
- Left for later: static colliders are not streamed (Rapier's BVH makes them cheap); enemies still get
  constructed at load but live out of the scene and physics until near; enemy LOD is animation rate and
  shadows, not simplified meshes (M5 can add mesh LODs); shadow-depth and post shaders compile on the
  first title-screen frame rather than behind the bar.
