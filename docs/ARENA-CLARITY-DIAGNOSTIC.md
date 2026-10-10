# Settled arena clarity: CI51

The sampled battlefield stays softer than the independently rendered hand because its adaptive drawing buffer remains at 65% of its CSS display size. These observations do **not** establish a broken recovery controller, a duplicate CSS scale, or acceptable physical-device performance.

## Actual evidence

[Browser acceptance CI51](https://github.com/liuao8080/Spellwood-learning-game/actions/runs/38000038822) ran head `b322aea94015385bb9354c38a3cf5bac9a9e8af0`. The runner's merge commit `484eadbc9b011fe5efb1be416e9454e30affd6a3` has the verified tree `1d1c74ac9b445f7aee32eb3cb188f987a3d3b71c` and contains the source head as a parent. Product/rendering code is unchanged from CI50.

The real fox-and-neighbour match remained on revision 9, with no new game commands during the three viewport observations. The initial turn had 148.5 seconds remaining, so no extra turn was needed. Original screenshots were taken around 2, 5 and 10 seconds at each size. No clocks, quality values, rendering functions or peer state were changed.

| Viewport | Arena drawing buffer | Arena CSS size | Hand buffer / CSS | Quality at all three samples |
|---|---|---|---|---|
| 1280 × 800 | 832 × 354 | 1280 × 546 | 906 × 230 / same | level 3, scale 0.65 |
| 390 × 844 | 253 × 269 | 390 × 414 | 390 × 190 / same | level 3, scale 0.65 |
| 844 × 390 | 460 × 135 | 708 × 208 | 708 × 168 / same | level 3, scale 0.65 |

DPR was 1, CSS transform was `none`, and image rendering was `auto`. Integer buffer rounding accounts for the small differences from exactly 0.65. The opponent page was visible, reduced-motion and on-demand at scale 1; it was not closed or disabled for this observation.

Outside screenshot-call intervals, passive observer RAF gaps had medians of 166.6 ms on the desktop viewport and 83.3 ms at both phone-sized viewports. Screenshot calls themselves took about 1.82 seconds or 0.90–0.94 seconds respectively and are retained separately in the record. Renderer submission samples were about 1–2 ms, but these are CPU submission timings, **not GPU completion measurements**. Public renderer samples can repeat between observer callbacks.

The existing controller requires eight uninterrupted healthy seconds with a frame mean at most 22 ms and maximum at most 40 ms before stepping quality back up. Those conditions did not occur here, even outside screenshot-call intervals. Remaining at level 3 is therefore consistent with the existing policy; these data do not prove that its recovery implementation is defective.

## Scope and limits

- CI51 retained 22/23 actual game scenarios and 5/5 isolated fixtures. Its formal normal-motion gate still failed: **994 ms maximum recorded gap versus the unchanged 250 ms limit**
- The extra still-image observations are diagnostics, not additional game or performance passes
- All 299 original PNG/JSON/WebM evidence files were copied unchanged into seven bounded parts, verified against per-file SHA256, and preserved. No sharpening, upscaling, interpolation or retiming was applied
- A screenshot cannot prove continuous animation, input latency, GPU headroom or physical-phone usability
- No rendering thresholds, production quality defaults or CSS filters were changed in response to this result

## Idle-work source audit

The follow-up read-only source audit found no proven low-risk redundant normal-idle work to remove: scene models and hand geometry are keyed by identity/layout, card textures are cached and invalidated only when painted, effect compilation occurs at initialization or context restoration, and settled external hands stop requesting frames. Hero vertex animation is capped at 12 Hz and only updates changed joint ranges. Creature heads, wings and tails remain animated, so their casting shadows genuinely change. Explicit shadow invalidation is guarded by a map-size change.

These guards do not prove the remaining rendering cost is cheap. No shadow, animation, detail or quality reduction was made on this basis. Further ungrounded performance experimentation is deferred pending the independent device check below; visual and interaction improvements continue separately.

## Required independent device check

The next performance conclusion requires an independently verified hardware-accelerated GPU browser or physical mobile device running the same production build and real input/authority flow. It must record the actual renderer/device conditions, CSS and drawing-buffer sizes, DPR, applied quality, and normal-speed motion; repeat the 2/5/10-second settled observations and retain original recordings. Both immediate interaction and quality recovery must be observed rather than inferred from short submission times. The existing 250 ms acceptance rule must remain unchanged.

This check had not been performed in the CI51 handoff. No physical-device or Hearthstone-level smoothness claim follows from those CI results.

## Local hardware follow-up, 10 October 2026

The independent local takeover verified installed headed Chrome154 on an Apple M4/Metal GPU with WebGL hardware acceleration. The unchanged fd82c1a full local baseline passed28/29 (a44px three-digit label failed), with47ms maximum native motion gap. The final refined full local run passed33/33 with36ms under the unchanged250ms gate at adaptive level0, pixelScale1 and1024 shadows; a separate OS-native DPR2 window measured52ms. Earlier candidate48ms and failed local-tool runs remain preserved. These are bounded desktop samples, not whole-session FPS, physical-phone acceptance, or a rewrite of CI51/CI54. The2/5/10-second observations, actual CSS/buffer/DPR, original recordings and source attribution are in [the local playtest report](LOCAL-PLAYTEST-2026-10-10.md).
