# Avoid repainting an unchanged hand for an authority revision

A battle acknowledgement changes room revision even if hand identities, costs,
finishes and selection do not change. Previously HandScene.setHand treated that
revision alone as a reason to start another 160 ms layout animation. The ordinary
attack diagnostics observed two hand draws on A and one on B, although this alone
does not establish that all of those draws had the same cause.

The correction retains the authority revision, increments the input generation and
cancels captured old gestures. It only requests another layout when card visuals
or selection change. The visual key still contains ordered card IDs, finish and
per-instance cost. Hover cancellation, focus, resize, reduced-motion changes and
hidden-state restoration retain their own rendering paths. Input disabled state
continues to reject selection.

## Verification

On 9 October 2026 at 14:02 UTC, a regression on the previous implementation failed
because an otherwise unchanged revision queued one unwanted RAF instead of zero.
After the correction, 30 hand scene/input tests passed, including fresh-revision
selection after cancellation, selection/cost/finish/hover/resize redraws, discount
instances, resource disposal, stale pointers and pending-resize keyboard behavior.
These tests use real Three.js geometry with a mock canvas renderer.

A separate browser case uses normal motion, a real match, an attack acknowledgement,
subsequent keyboard selection of the unchanged hand, then legal summon through real
turns. It remains pending until executed on this commit. The original 250 ms recorded
motion gate is unchanged; no performance target is claimed from the unit tests.
