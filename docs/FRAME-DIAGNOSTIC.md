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


## Drawing isolation result and limit

CI30 obtained five of six planned samples. The second skipped-arena trial did not
reach the chosen creature within its legal preparation limit; that missing sample
is preserved. Baseline RAF maxima were 451.3/461.7 ms, skipped-hand 265.5/270.3 ms,
and the first skipped-arena 205 ms. The skipped-arena build adapted to quality 0
and a different buffer, so this is not a clean numerical quality comparison.

CI31 obtained both requested partner controls, a trailing baseline and the missing
skipped-arena repeat. Its leading baseline did not draw the chosen creature within
14 ordinary turns and is retained as a preparation coverage failure. With A held
at quality 3, 460×135 pixels and 102 reported calls/62,244 triangles, skipping only
B's arena drawing produced 106.6/106.9 ms maximum overlapping RAF gaps. The trailing
baseline with B drawing measured 609.5 ms. B still processed state and real actions;
only its separate fixed lab build omitted drawing. B normally drew its 1280×546
arena four times and hand once, not continuously. The repeated A-arena omission
measured 291.3 ms, so its earlier 205 ms must not be treated as a stable threshold.

These results support a substantial contribution from the second software-rendered
page on the same runner. They do not establish real-device performance, an exact
GPU root cause, or acceptable production animation. No production canvas is omitted.
Further visual deletion experiments stop here. The original full-scene 250 ms gate
stays unchanged. A separately reproduced redundant hand-layout issue is corrected
as a product change, with independent normal-motion input regression.

## Local hardware follow-up, 10 October 2026

An independent installed Chrome/Apple M4 Metal check ran the actual fd82c1a
production network build with ordinary matching and input. The complete local
baseline recorded47ms maximum native frame gap; the final refined33/33 run
recorded36ms, and a separate OS-native DPR2 window recorded52ms. An earlier
candidate48ms sample remains historical. These pass the unchanged250ms gate
at level0/pixelScale1/1024-shadow settings.
No effect, shadow, quality default or threshold was reduced. This establishes
those bounded desktop windows; it does not explain every cloud stall or establish
physical-phone/public-network/whole-session performance. Local input and actual
pack-reveal continuity defects were fixed separately. See [the local playtest
report](LOCAL-PLAYTEST-2026-10-10.md) for source attribution, videos, failures and limits.
