# Normal-motion stall diagnosis

## Established baseline

CI28, run 37883772480 on head 89dff0d9, passed 19 of 20 browser cases.
Normal-motion recording had a maximum 1.031-second frame gap, above the unchanged
0.250-second requirement. The accepted functionality does not imply smooth motion.
The runner uses official Chromium on a standard Ubuntu host; WebGL2 support does
not establish hardware acceleration or physical phone performance.

## Controlled observation, 9 October 2026

CI29 head 54f9f75b adds a separate diagnostic job. The original normal-motion test
body is byte-identical to CI28 and continues to run independently. Diagnostic
completion is not a substitute for that acceptance gate.

A real UI-created deck, normal matchmaking and ordinary turns reach one low-attack
melee unit. The same room and source unit perform six ordinary attacks in order:

1. Baseline, native arena-only recording
2. No recorder or capture stream created
3. Unit labels use visibility:hidden, native recording
4. Unit labels use visibility:hidden, native recording
5. No recorder or capture stream created
6. Baseline, native arena-only recording

The first and last baseline bracket changing game state. Turns and hands naturally
change; this is a recorded confound, not seeded replay. The viewport, normal-motion
preference, other participant, public input flow and one-second warmup are retained.
Visibility:hidden suppresses label paint and hit testing; it does not remove layout
or JavaScript anchor updates. It cannot establish the cost of all DOM processing.

Main RAF metrics cover the same trusted attack click plus 3000 ms. Intervals crossing
either boundary retain their full duration and are reported separately. The final
sample before the boundary, first subsequent sample and unobserved tail are retained;
a missing later frame is unknown, never evidence of zero delay. Full bounded samples
remain available. App update/submission values are CPU timings, not GPU timers.

Browser tracing exists in all conditions and adds overhead. Only fixed allowlisted
numeric duration aggregates survive; URLs, function names, arguments, request data
and raw trace files are not stored. These trace totals include setup/encoding/transfer
and cleanup, so they are not equal-window wall-time comparisons. Overlapping slices
must not be added as elapsed time; missing event names do not prove absent work.

Playwright session video, HAR and trace remain disabled. Native clips contain only
the anonymous arena canvas, no audio, at most six seconds and two MiB. No page clock,
engine state, network messages, device security or browser restrictions are changed.

## Status

The first six paired trials completed. Maximum overlapping RAF gaps were:
- Baseline: 616.8 and 642.2 ms
- No recorder: 638.1 and 660.9 ms
- Hidden labels: 638.6 and 649.3 ms

Every attack contained three gaps over 250 ms, with the final window bracketed.
Removing recording or label paint did not remove the stall in this environment.
It does not prove that either has zero cost. Browser main-frame slices remained
long; their names alone cannot identify the GPU as the cause.

The next separate lab build compares baseline, skipped arena drawing and skipped
hand drawing, each twice with a baseline before and after. Actor A loads one fixed
HTML/JS variant; B always loads the instrumented baseline. Production app.js is
hash-checked unchanged. There is no runtime toggle in the production bundle.
Skipped draw calls retain scene/camera matrix updates and ordinary model/DOM/game
updates. Actual draw/update counters, viewport, quality, triangle/call counts and
public game state are retained for both participants. All six real legal openings
select Moon Hare. Different naturally drawn hands are recorded as a confound.
No native recorder is created in any second-stage condition.

These blank/static lab canvases are diagnostic only and cannot be presented as
visual acceptance or a product optimization. The original motion gate stays fixed.
