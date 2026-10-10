# Adaptive arena rendering — candidate verification

The default quality remains unchanged. Sustained, visible, continuously animated frame load can lower only the arena's shadow map to512, then pixel density to80% and65%. Eight seconds of consecutive substantial headroom restores one level at a time. Hidden/on-demand time, missing measurements and isolated first-use hitches cannot drive a downgrade or recovery. Hand cards, textures, HTML text and rules are unaffected.

CI18 recorded a real attack, a single HP18→16 change and return, but both native video and DOM observation lost approximately640ms around contact. The strict250ms gap gate remains failed. Its software WebGL renderer was SwiftShader; that fact alone does not establish the cause or physical-device performance.

Per-frame update/job, render-submission and anchor/DOM timings now accompany RAF gaps. Render submission time is not a GPU timer. Quality changes apply between visual jobs and before a fresh render, preserving effect clocks and avoiding an empty resized canvas frame.

Local candidate verification:13 controller tests,3 focused real-geometry/mocked-renderer tests,typecheck and network build passed. Browser evidence for this candidate is pending. No claim of normal-speed smoothness, physical-phone performance or publication is made.

Independent integration review found and repaired a delayed-application accounting issue: a pending tier now pauses further sampling, and its cooldown starts at actual application. The first apply-frame interval is excluded. Shadow-only changes no longer resize the drawing buffer; pixel changes resize once before rendering. Loop restart clears paused-time gaps. Current focused verification passed15 controller and2 scene-integration tests plus typecheck. These checks do not establish a browser performance gain.

## Retained effect-program warmup candidate

Detached representatives of the four real elemental casts and bursts plus the actual mapped SRGB floating-text material are compiled against the configured battle scene. They are never rendered as evidence or attached to the visible arena. References remain alive to retain shader programs; context loss, disposal and a bounded pending-compilation timeout release them. Initialization does not wait before advancing game rules. The renderer reports warmup status alongside the existing timing observations.

The combined portrait/warmup candidate passed 30 focused local tests (4 geometry,15 quality-controller,8 resource-parity/lifetime and3 scene integration), type checking and the network build. A test-fixture handler lookup failed once and was corrected and rerun; it was not a game exception. Complete browser verification is still required. CI19 had no demonstrated performance gain, and warmup is a measured hypothesis pending comparison.

## Hidden default-canvas first-draw experiment

CI22's shader warmup was ready, yet first-hit GL submission still took about263ms and the recording gap was1.062s. Therefore the next candidate tests a single8×8 initialization draw on the same default framebuffer, only while the actual gameplay canvas has its hidden attribute. A normal offscreen render target uses a different output color space in this installed Three version, so it is not substituted or disguised as the default target.

The helper refuses visible canvases, software renderers, owned render targets, owned/disposed resources and lost contexts. It restores scene membership, visibility, logical size, viewport, scissor and scissor-test state in finally, including render-error paths. It never renders a visible battle or creates acceptance footage. A draw-status value indicates submission returned, not that every shader has executed on the GPU or that performance improved. Existing shadow maps can cost more than the8×8 color buffer; initialization CPU timings are recorded for comparison.

Independent read-only review found no blocking scope issue and requested the DOM-hidden ordering check.17 resource/restoration/guard tests and2 lifecycle/ordering cases passed, plus typecheck and build. The routine retries a prior visible-canvas skip only after the actual DOM canvas becomes hidden and never repeats a successful preload. Same normal-motion clocks and250ms evidence gate remain in force; browser outcome is pending.
