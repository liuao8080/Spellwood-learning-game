# Quiet central stone: bounded visual candidate

The board's original single-colour centre reads as a flat green sheet in the
actual CI32 battle images. This candidate retains the same solid inset, slots,
perimeter, camera and lights, and adds a low-frequency moss-green colour map.
Broad variation stays within roughly 8% of the base colour, with faint edge wear.
Whether this is a visible improvement requires before/after image review.

The central slab is separated from the combined matte mesh. It adds one normal
mesh submission and, while shadow casting is enabled, one shadow submission.
It adds no triangles. The 256-square RGBA texture uses 256 KiB at base level,
approximately 341 KiB including its mip chain, excluding implementation overhead.
There is no normal map, animated noise, extra light or reflection pass.

The real CPU compatibility renderer selects the original combined plain stone,
avoiding a large texture-sampled area in its general per-pixel rasterizer. The
model-library default also remains plain for callers that have not opted in.
Every arena owns its texture and material; geometry belongs to its existing
builder. Handle disposal, library disposal and responsive replacement are tested.

Validation planned for the candidate:
- Existing real populated match at 1280×800, 844×390, 740×360, 390×844 and 320×568;
  compare with saved CI32 original screenshots and retain natural board differences.
- Separate, clearly labelled low-geometry WebGL A/B fixture with identical camera,
  lights, renderer and dimensions; record normal and shadow submissions separately.
- Existing simulated-unavailable-WebGL real-match regression, asserting plain mode.
- Retain the normal-motion 250 ms gate and all gameplay checks. A static material
  comparison cannot demonstrate motion smoothness or physical-device performance.

Roll back the surface if it is visually noisier, indistinguishable at target
sizes, distorts targeting contrast, leaks resources or adds unexpected draw cost.
No improvement or performance pass is claimed before those checks finish.
