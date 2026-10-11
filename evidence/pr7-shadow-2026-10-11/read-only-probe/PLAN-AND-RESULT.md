# B reduced-motion repeated-shadow probe

Temporary only: formal src, original helper/tests, local infrastructure and b059 client are unchanged. `source-copy` contains the86 original src files; only its Scene adds the probe import and one install call before the first start. `fixed-client/app.js` is SHA2564ba486f1fff14760f84351f4021bbbcf30140580a7096f96f41ee8cea23a584c. `fixed-probe-manifest.json` records every original/copied source hash and the formal b059 hash.

Probe chains every original `shadowMap.render`, caster `onBeforeShadow` and `renderBufferDirect` call. Actual depth calls require positive original `renderer.info.render.calls` delta with the same shadow-camera/geometry/material/object. It compares the complete canonical key string directly; hash equality alone is never used as proof. Key includes actual drawn caster world matrix, geometry/index/morph versions and groups, effective depth/original material alpha/side/displacement/texture/clipping values, skeletal/instance inputs, shadow-camera matrices/config and light/map configuration. It only reads these values. No draw, state, transform, quality, shadow flag or clock is changed.

Each page retains a rolling last240 primitive observations with drop count (`overflowDropped`), actual draw/caster/callback counts, exact `sameKey`, key hash, absolute `performance.now`, measured bookkeeping overhead, reduced flag, jobs, sprite opacity, unit/hero-pose counts and actual quality. Trusted enemy-hero pointerdown/click markers are read-only and bounded16. `timeOrigin + absPerformanceTime` can locate per-document browser observations; it is not a native-media timestamp, and different-page clocks must retain their separate origins. Post-body safe diagnostics dump before contexts exit. No raw profile, identity, cookie, DB, trace or HAR is published.

Concrete command (execution coordinated by root):

```sh
npx --no-install playwright test --config=test-results/shadow-control/playwright.config.mjs
```

The initial configuration allowed only SwiftShader headless. Root separately authorized the explicit `hardware-headed` Metal control; the allowlist-only change and before/after hashes are preserved in `config-mode-addition.json`. Installed Chrome154, sandbox enabled, unsafe fallback/self-XSS flags removed. Software mode uses explicit official `--use-gl=angle --use-angle=swiftshader`; Metal mode uses no added rendering flags. Port4189 and disposable owned server DB; HTTP app/HTML must equal the fixed snapshot. Original combat body restores byte-identical after the evidence-path change; every original assertion, stage budget and250ms gap rule is unchanged. Zero retries. This instrumented run is a diagnostic, not replacement formal acceptance.

First software execution `runs/swiftshader-headless-2026-10-11T02-08-55-644Z-298a60da` failed the unchanged isolated-guests25s deadline at25002ms. Both actual guest sessions were created with zero page errors, but attack/settings/deck stages and recording were not reached. B had not yet switched to reduced motion. Therefore the requested consecutive2–3 B shadow frames were **not established** in that software run.

Observed only one hidden arena prime shadow pass per actor,53 actual depth draws/casters each. Probe own bookkeeping costA2.9ms/B2.1ms; B original shadow submission551.5ms is a CPU wall sample, not GPU completion. No attack markers and no repeated sequence. Real arena unmasked renderer in post-body diagnostics is SwiftShader, but backend confirmation does not establish why startup exceeded the budget.

Failure cleanup additionally retained a5s timeout in B's safe failure screenshot. Both contexts and the owned server closed successfully (A41ms/B16ms/server16ms); port4189 was then free. Eleven source-integrity groups and HTTP probe hash passed; formal b059 stayed unchanged. `shadow-probe-summary.json` and original safe observations retain every failure. No automatic retry or expanded scenario was run; root was notified for explicit further diagnosis.

## Hardware observations and retained interruption

First hardware run `hardware-headed-2026-10-11T02-13-09-782Z-2982f922` actually executed, then its turn was intentionally interrupted. Original status remains failed at the8s native-recording-completion stage. `execution-interrupted.json` labels it incomplete; it is not reused as a pass.

After explicit user/root continuation, one fresh Metal run `hardware-headed-2026-10-11T03-02-33-699Z-9b8f23a6` passed the unchanged original case in10.3s. Actual unmasked renderer is ANGLE Metal Apple M4; this is a hardware observation, **not a SwiftShader or CI-equivalent performance run**. It produced91 original native frames with maximum PTS gap46ms. Trusted-click RAF window max20.4ms, with2.4ms unbracketed tail retained as unknown. HTTP fixed probe4ba486 matched, formal b059 stayed unchanged, all11 integrity groups and cleanup passed.

B reduced=true/visible had31 consecutive floating-sprite frames spanning493ms. Every frame compared equal to the complete preceding shadow-input canonical string, label hash `8ec5d41cb36e1ee4`, while still executing **37 actual depth draws from37 casters per frame**,1147 draws total. The earlier53 count belongs to hidden initialization and must not be copied into the battle result. Units/hero pose fields remained0, one job and one sprite existed; opacity changed in the last11 frames. The raw three-frame fading witness is:

| B absolute performance.now | Exact sameKey | Hash | Actual depth draws | Sprite opacity |
| --- | --- | --- | --- | --- |
| 5701.4ms | true | 8ec5d41cb36e1ee4 | 37 | .963333 |
| 5718.0ms | true | 8ec5d41cb36e1ee4 | 37 | .871111 |
| 5734.7ms | true | 8ec5d41cb36e1ee4 | 37 | .778333 |

A's ordinary attack control changed its shadow key in all60 sampled frames after the trusted click during the first1s, supporting that the key is sensitive to real moving casters rather than a constant label. A retained240/334 frames (94 dropped); B retained all43. The ring is rolling, so the attack evidence remains present despite earlier A samples being dropped.

B floating-phase measured probe bookkeeping median .3ms/p95 .5ms/max .5ms; whole-pass means A .349ms/B .342ms, whole-run maxima1ms. CPU depth submission samples include probe overhead and are not GPU time; timer granularity is visible. Do not subtract these values to claim measured optimization savings. Both pages remained q0/pixelScale1/shadow1024/DPR1, full scenes, A708×208/B1280×546 arena drawing buffers equal their CSS sizes.

This establishes redundant depth rendering in the real reduced-motion B scenario. It does not establish that the redundancy caused CI977ms stalls, quantify software cost, or authorize replacing the formal test. All software/interrupted failures remain preserved. Latest raw counts/primitive frames, host/launch, complete source/HTTP hashes and clock caveats are in the fresh run's `shadow-probe-summary.json` and original safe observations. No additional browser run was performed after this one.
