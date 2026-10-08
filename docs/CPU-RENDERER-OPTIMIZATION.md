# CPU renderer exact-output optimization — 2026-10-08

The renderer now avoids redundant projection work, per-mesh lighting-key strings, and unnecessary texture/alpha work for small opaque triangles. Geometry, poses, effects, depth semantics, transparency semantics and the 960×600 render size are unchanged. This is continuation of CPU performance work; no visual design changes were made.

## Retained changes

- Read ordinary position attributes once and reuse reciprocal W. Normalized, interleaved, half-float and custom accessors retain the original Three.js path. Arithmetic order and float32 output are preserved; direct data edits are still observed immediately.
- Validate lighting against retained numeric fields and the same normal/color identities and versions. This removes the temporary 26-value array and joined string per smooth mesh per frame. Shared geometry still validates each use; all light, material and normal-transform inputs are checked.
- Specialize small opaque triangles while preserving the original general path's exact barycentric additions, coverage checks, color rounding and depth writes. Translucent/textured triangles retain their original path. Bounds are computed once. The existing large-triangle scanline path is unchanged.
- Extend the same-process A/B harness to accept already-instrumented baselines, compare complete depth buffers as well as composed canvas pixels, record module/source provenance and process CPU usage, and check render counts and disposal. A failed equality or cleanup check now exits nonzero.

## Correctness checks

The 12 focused renderer tests passed through the shared 256 MiB / 120 second gate. Coverage includes seven unchanged pre-optimization whole-frame hashes; bitwise projection comparisons for six attribute families and subsequent mutations; 2,048 small-triangle cases (4,096 draws) against the original general raster path, including texture alpha, clipping, smooth colors and repeated/coplanar depth; and 13 cache scenarios compared with a fresh renderer. Existing depth, shared transparent edges, cutout, pool-release and static-subtree checks also pass. `git diff --check` passed for the changed renderer/test/script paths.

The two final A/B batches compared 96 same-scene frame pairs total. All 16 sampled complete canvas pixel buffers and all 16 sampled full float32 depth buffers matched. Triangle/call counts matched for every sampled pair. The confirmation batch explicitly verified both renderers released frame/depth buffers, static snapshots and triangle pools after disposal.

## Timing evidence

Both final batches compare the previously pooled renderer with this final implementation. Each mode has 15 warmup pairs followed by 24 measured pairs, alternating the first renderer. The scene has eight units (13,338 authored triangles), two heroes (3,200 triangles), card backs, deck stacks, contact shadows and fireflies; cast mode adds the complete fire effect and updates hero/unit poses. No geometry, effects or animation were reduced.

| Batch / mode | Before median | Current median | Paired median saving | Median paired saving | Current p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Final / idle | 18.46 ms | 15.85 ms | 2.44 ms | 13.5% | 18.66 ms |
| Final / cast | 19.90 ms | 17.59 ms | 2.22 ms | 11.6% | 22.26 ms |
| Confirmation / idle | 27.55 ms | 24.28 ms | 2.13 ms | 9.0% | 51.07 ms |
| Confirmation / cast | 26.60 ms | 21.30 ms | 3.77 ms | 15.6% | 77.78 ms |

Paired process-CPU median savings were 2.54/2.32 ms in the first batch and 2.02/4.40 ms in the confirmation batch (idle/cast). Process CPU usage includes native threads and does not represent browser frame time. Absolute timing and tails varied substantially; the confirmation cast batch contained a 263.24 ms current-renderer outlier. The cause of that variability was not isolated. These results support the median optimization and allocation reduction, **not a stable 24–30 FPS claim**. Browser/device performance remains unverified.

The initial projection-only and lighting-only runs were small/noisy improvements; they are not used as standalone speed claims. The final retained implementation showed useful combined gains in both complete-scene batches. The small-face implementation deliberately does not route to the numerically different scanline path.

## Reproduction and sources

Optional image-review dependency: the measured environment used `@napi-rs/canvas` 0.1.100. This package is not required by the game. From the repository root, in a separate development environment:

```sh
npm ci
npm install --no-save --package-lock=false @napi-rs/canvas@0.1.100
node scripts/benchmark-expansion-renderer-ab.mjs test-results/renderer-ab evidence/renderer/2026-10-08/pooled-baseline.mjs
node --test --test-concurrency=1 tests/software-renderer.test.mjs tests/software-renderer-pixel-equivalence.test.mjs
```

The renderer baseline is retained beside the numeric evidence, so the comparison does not require a machine-specific temporary file. `SPELLWOOD_CANVAS_MODULE` can point to another explicitly installed compatible Canvas package. The benchmark requires an explicit baseline path and writes bounded per-frame samples as it runs. Run one such workload at a time. This is an offline Canvas render comparison, not browser timing.

Measured investigation jobs used a 120-second timeout and sampled process-tree memory guards. The maximum observed process-tree RSS across paired runs was 358,932 KiB (350.52 MiB); the final and confirmation batches were 291,396/293,340 KiB. The final focused tests peaked at 107,600 KiB. Every retained run finished within 9 seconds. The offline Canvas context is reset before each complete frame, outside timing, to release dead display-list history; this is harness housekeeping, not a production rendering change.

- Final renderer SHA-256: `b28d2f603067b2828b7db20a27f6ba6ba1625db6065ccb6d827e4e235f5f6d5e`
- [Retained pooled baseline](../evidence/renderer/2026-10-08/pooled-baseline.mjs), SHA-256 `de9002d36e116bb4bbd6a9d622bda06ce9adb98db437601bca27caa646c3a89a`
- [First final batch](../evidence/renderer/2026-10-08/final.json)
- [Confirmation batch](../evidence/renderer/2026-10-08/confirmation.json)

Numeric copies replace only executor-specific path strings with package/repository paths. Measurements and source hashes are unchanged. Later portable defaults in the helper do not relabel historical numbers as a new measurement. This component verification neither deploys the game nor establishes browser/device performance.
