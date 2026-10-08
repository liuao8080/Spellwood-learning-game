# Expansion artwork and arena consumers

## Card faces and units

`CardTextures` gives an explicit `CARD.artPath` precedence over legacy atlas and individual paths. The full square source is contained in the visible art window: 462×359 on full cards (ending above the nameplate), and 472×323 on hand cards. This keeps feet, horns, caps, wing tips, props, and spell edges intact. Existing cards without `artPath` retain their previous path/crop behavior. Expanded full rules fit into up to four lines; hand summaries retain the existing two-line/six-character layout.

`get(id, finish, mode, displayCost)` accepts an optional authoritative numeric display cost. The only extra face is `max(0, baseCost - 1)`; other values use the base cost. Cache keys contain the bounded cost variant, never hand/instance IDs. Parallel hand costs choose the per-instance face; existing callers and base-cost keys remain compatible, and `retainTextures` releases unused variants.

`creature-expansion-v4.mjs` adds eight original solid models through `V4_BUILDERS`. The original 18 unit builders and their geometry are unchanged. All 26 current unit cards are registered. New species preserve their art identities: acorn armor and acorn; spotted cap, apron and pitcher; reed collar; aquamarine spiral with exactly two stalk eyes; long kingfisher beak and wings; striped badger with brass clasp; two curled crystal horns; terracotta salamander with cocoa markings and ember tail. Resting salamanders do not emit a continuous flame.

Low-LOD new-unit triangles total 13,338, a 52.2% reduction from the first implementation without deleting body parts or props. Per unit: squirrel 1,748; medic 1,810; frog 1,660; snail 1,068; kingfisher 1,466; badger 1,950; ram 1,832; salamander 1,804. The intermediate 20,608-triangle pass and its measured performance are retained in the evidence. Medium/high geometry is unchanged by the low-LOD reductions. Every new unit is below 5,000 triangles and uses 4–6 opaque merged meshes.

## Hero API

`new ArenaScene({ ..., heroSkins: { self: "forest_apprentice", opponent: "butterfly_scholar" } })` creates two real heroes. Both default to the free `forest_apprentice`. Arena heroes deliberately use low LOD on both renderers; two free heroes use 3,040 triangles, and any pair in the supplied catalog uses at most 3,664. Each instance owns three visible meshes and a fixed pick proxy.

`scene.setHeroSkins({ self, opponent })` changes presentation only. Omitted keys retain their current skin. Unknown/prototype-like IDs resolve to the free default. Reapplying the same ID retains the same instance. Replacing a model cancels its pose channels, disposes it once, creates the new instance and updates matrices/pickables immediately. Hero seats are inset/clamped into the current viewport so wide cosmetics do not inherit the old crystal's edge clipping.

The caller owns unlock/equip authorization and room freeze. Map authoritative absolute seats to relative names: self is `youSeat`, opponent is `1 - youSeat`; pass the room-frozen skin IDs on snapshot application/reconnect. Do not pass a mutable wardrobe selection into an active room. This scene API does not persist, authorize, unlock, choose stats, modify rules, or freeze the room itself.

When the self player supplies `legalCardTargets`, selected-card rings use its matching `index` and `{target, seat}` entries. Empty authoritative entries produce no target hints. This supports friendly unit targets and a discounted card that legacy cost calculations would reject. Older snapshots without the field retain the existing preview behavior.

`heroFor("hero:0" | "hero:1")` resolves an absolute seat to the current model. Existing `anchor(key, y)` keeps its board-height semantics; aim/projectile effects use the model's semantic label/projectile/impact anchors. Existing `pick` results remain `{kind:"hero", relativeSeat:0|1}`. Unit creation, placement, picking, attack and snapshot APIs remain compatible.

The scene drives idle and cast/hit/heal/armor/win/lose pose channels. Concurrent channels compose, newer same-channel effects supersede older tokens, and no model starts a timer or animation loop. Summon casts and spell projectiles animate the actor; health/armor gains and damage animate the affected hero; celebrate animates both sides. Cancel, hidden view, context loss, reduced motion and destroy reset pose baselines. Replacement and repeated disposal release instance geometry/materials.

Pass `celebrate(null)` for a draw; it keeps neutral particles and never chooses a hero winner. Only an explicit boolean outcome starts win/lose poses.

## Accepted event fields

Presentation reads server-produced changes; it does not infer these effects from a missing unit or card name:

- `returned:true`, `removed:false`, `hpDelta:0`, `atkDelta:0`: nonlethal recall, a return label and shrinking travel toward that seat's hero. No hit/death presentation or draw-from-deck animation. Cancellation restores the unit; final snapshot synchronization removes it. The presentation promise waits for recall travel before final synchronization.
- `shieldGained:true`: persistent barrier badge plus gain feedback, separate from `shieldLost`.
- `maxHpDelta > 0`: distinct life-cap growth label/effect, in addition to any actual `hpDelta` healing.
- `atkDelta < 0`: visible reduction feedback for the reed frog. Existing positive attack, health, armor and shield-loss feedback remains.

Reduced motion keeps readable labels and persistent status badges, with no travel or animated hero deformation. Multi-target spells aim at an explicitly changed unit and show each accepted target's impact. The salamander's arrival uses a fire projectile; staged summoning retains the old target until that accepted effect lands, including lethal arrivals. This does not create any authoritative game event.

## Verification and offline evidence

`scripts/render-expansion-visuals.mjs` renders actual application card painters, unit geometry and `ArenaScene` with `SoftwareRenderer`. It requires an installed `@napi-rs/canvas` or `skia-canvas` supplied by `SPELLWOOD_CANVAS_MODULE`. No production dependency was added. Run modes separately serially in a bounded development environment:

- `units`: 960×612 low-LOD contact sheet
- `arena`: 960×600 actual arena, eight new units and two real heroes
- `arena-idle` / `arena-cast`: same complete scene, 3 warmup frames plus 12 render samples; cast includes an actual fire effect
- `arena-baseline`: same camera, slots, heroes and stage with eight named original unit models, as a control
- `art OUTPUT 0` / `art OUTPUT 1`: all twelve original illustrations on actual full and hand faces, two batches of six at 768×720

Current evidence is under the separately retained expansion QA artifact: `units-low-contact.png`, `art-full-0.png`, `art-full-1.png`, `art-hand-0.png`, `art-hand-1.png`, and the complete arena under `renderer-ab/idle-current.png`. These are offline application CPU pixel renders, not browser screenshots, WebGL measurements or device FPS results. Font caching uses a writable temporary cache. Actual renderer/browser behavior, mobile hardware performance and the whole-scene performance regression target still need their own validation.

### CPU performance remains a blocker

The later controlled A/B is the more useful renderer comparison. `scripts/benchmark-expansion-renderer-ab.mjs` holds one scene and one pose per pair in the same process, alternates renderer order, and runs 15 warmups plus 24 measured frames for each renderer in both idle and cast cases. Eight sampled complete canvas hashes (including overlays) are exactly equal. Current renderer SHA: `de9002d36e116bb4bbd6a9d622bda06ce9adb98db437601bca27caa646c3a89a`.

| Paired A/B case | Original median / P95 | Current median / P95 | Median paired current−original |
| --- | ---: | ---: | ---: |
| Idle | 85.5 / 375.6 ms | 60.1 / 253.1 ms | −8.93 ms |
| Cast | 98.9 / 260.7 ms | 81.6 / 348.6 ms | +0.34 ms |

The cast comparison does not establish a speedup, and its tail is still worse. Current stage medians are geometry 26.2 ms / dynamic raster 30.1 ms during idle, and geometry 41.4 ms / dynamic raster 36.4 ms during cast. Static-cache work is approximately zero; presentation is about 0.9–2.0 ms. Stage medians are separate distributions and must not be summed as a total median. Geometry processing and dynamic raster work remain the useful optimization targets.

The first A/B attempt hit the specifically authorized 384 MiB guard at 389.2 MiB and did not finish. The bounded retry resets the offline Skia canvas context before each complete opaque frame, outside render timing, to discard dead display-list history; both renderers receive the same reset. It uses a 96 MiB Node old-space / 4 MiB semi-space limit, completed in 22.3 seconds and peaked at 174.5 MiB. No production renderer code is changed by this harness. The reset and memory limits are part of the method, not a device measurement.

Current raw samples, warmups, stage timing and hashes are persisted at the separately retained `renderer-ab/renderer-ab.json`, with a per-frame JSONL alongside it. Some early temporary evidence was unavailable after an environment interruption; current figures and images were regenerated and checked.

Final full-scene Node measurements at 960×600 use 3 warmups and 12 sampled frames per independent process. Median averages the middle pair; p95 is nearest-rank. These samples include the arena, eight units, two heroes, three enemy card backs, deck stacks, contact shadows, fireflies, and a real fire effect in the cast case. The separate pose median excludes render time. Browser/DOM/frame scheduling is excluded.

| Final source case | Median render | P95 render | Median pose | Sampled process-tree peak |
| --- | ---: | ---: | ---: | ---: |
| Eight new units, idle | 112.7 ms | 236.6 ms | 5.01 ms | 195.9 MiB |
| Eight new units, cast | 72.0 ms | 165.6 ms | 1.91 ms | 209.9 MiB |
| Eight original units, idle control | 64.5 ms | 100.1 ms | 3.52 ms | 208.5 MiB |

The control uses fox, sprite, sprout, turtle, owl, bear, stag and dragon in the same eight slots with the same two new heroes/camera/stage. Their 23,334 authored triangles exceed the final expansion's 13,338. The small samples have substantial early slow frames and run-to-run variability; no profiler trace establishes whether JIT, GC or host scheduling dominates. Neither triangle reduction nor the renderer refactor is a verified speedup. These data do **not** establish the 24–30 FPS target or an acceptable regression.

Those earlier isolated measurement hashes were renderer `9239e6ae164545e126081ec17995bc8f0285ca1db1ae51730b0609b7e6b38d22` and expansion model `6fd8f1e6c246098cad8fbfc343364dba396bcdf88a419a8b84b0de875be11deb`. The earlier 20,608-triangle and pre-refactor control runs reported their p50 using the upper middle sample. Their original shared-directory JSON files became unavailable with that directory; the recorded outcomes and resource-gate history remain historical evidence. The controlled A/B raw JSON/JSONL above is the current persisted performance evidence.

The focused tests cover every model/LOD, real geometry/anchors/ownership, card asset routing and unclipped source rectangles, bounded discounted faces, authoritative target hints, hand layouts, hero replacement and immediate picking, overlapping pose cancellation, viewport fit, recall, shield gain, life-cap growth and lethal arrival timing. Canvas/renderer mocks in behavior tests are explicitly not pixel evidence. Long aggregate scene runs hit the 256 MiB process-tree guard before completion; final scene regression is split into bounded batches rather than increasing that limit. The final three scene batches passed 17/17, 11/11 and 10/10; a later target/cost batch passed 6/6. Model/card/layout tests passed 97/97 after the final 13,338-triangle reduction. HandScene's owner separately passed 35/35 component, hand, layout and practice checks, including same-name per-instance cost swaps and cleanup.
