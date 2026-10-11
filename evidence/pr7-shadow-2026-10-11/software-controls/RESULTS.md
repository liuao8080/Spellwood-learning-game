# PR7 software controls — 2026-10-11

Three sequential executions of the original real-UI case `@combat-motion normal melee leaves its slot, changes hero HP once and returns` passed. The software backend was reproduced; the original CI250ms failure was not reproduced.

| Mode | Original test | Native frames | Maximum original PTS gap | Click+3s observed RAF gap | RAF tail bracketed |
| --- | --- | --- | --- | --- | --- |
| Chrome154 default Metal, headed | Pass | 92 | 36ms | 19ms | Yes |
| Chrome154 SwiftShader, headed | Pass | 72 | 199ms | 197.8ms | No, 10ms uncovered |
| Chrome154 SwiftShader, headless | Pass | 75 | 163ms | 162.2ms | No, 38.3ms uncovered |
| Original CI38030577115, Headless Shell156 | **Fail retained** | 18 | **977ms** | **632ms**, also342/347ms | See original evidence |

Both software controls read the actual arena as `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)`. Original CI reads SwiftShader Subzero. Software-driver mode can still label WebGL/compositing as enabled or hardware accelerated in Chrome feature status; that label cannot establish physical GPU use. Backend identification here uses the actual arena's unmasked renderer.

All local runs used the same source HEAD1eb618be87023ebdb9c2e4fb7f2587b881e80a29/tree406e3371819900434a3fc52e094bb77df9042734 and actually served app SHA256b059f5bf1100fdaee258efac63508f466c035cdd6f9abdfde98f74f68d4678be. Product, original E2E, original CI, shared local infrastructure, generated code and built app/HTML hashes were unchanged at each run end. Own Chrome contexts/server cleanup passed; port4188 was free after the final run.

Original body, two independent guest contexts, normal A/reduced B, legal deck and trusted attack, HP/state/event assertions, native bounded recorder and250ms rule remained intact. Zero retries, no CI impersonation, no tracing, no throttling, no clock override, no skipped scene or manually selected game-quality values. Every local attack sample remained production default adaptive level0/pixelScale1/shadow1024. Actual DPR1; A arena CSS/drawing buffer708×208 and B1280×546. These differ from original CI level3/.65/512 and cannot be treated as an identical rendering workload. No local lowering was used to seek a pass.

Host facts: Apple M4,10logical CPUs,16GiB,ARM64 macOS,installed Chrome154.0.8037.99. Per-process utilization/CPU headroom was not sampled. This is not Ubuntu24/x86/official headless-shell156 and does not establish CI hardware/resource parity. Software driver selection is explicit, while CI's automatic fallback/compositor path may differ. One run per mode provides no statistical guarantee. Unbracketed software RAF tails remain unknown; a screenshot cannot close that gap.

I reviewed unchanged decoded PNG frames00/02/03/04/11 from each run: full board/models, initial aim line, visible departure toward the enemy hero and return to the original slot. Those selected arena-only frames do not establish every transient flash or floating DOM HP text, and are not fluidity evidence. Formal motion/state assertions passed independently.

Evidence directories:

- `runs/hardware-headed-2026-10-11T01-52-10-121Z-7b761d56`
- `runs/swiftshader-headed-2026-10-11T01-52-47-859Z-9ef1000c`
- `runs/swiftshader-headless-2026-10-11T01-53-58-074Z-8b95c115`

Each retains `source-manifest.json`, `software-combat-result.json`, `control-summary.json`, `environment-worker-0.json`, HTTP served-build hashes, safe actor observations/cleanup, original native WebM and unchanged decoder PNGs. `control-matrix.json` links all three to the preserved original CI evidence. `PLAN.md` records concrete commands/launch choices. All preparation and execution artifacts are under ignored `test-results`; no product or formal local configuration was changed by this diagnostic.
