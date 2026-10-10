# Local normal-motion evidence, 10 October 2026

This is supplemental evidence from installed headed Chrome 154, Apple M4/16 GiB
with confirmed hardware-accelerated WebGL. It is separate from the full browser
suite and the unchanged official 250 ms melee gate. The [safe summary](summary.json)
records precise bundle hashes, real UI actions, original video PTS, passive RAF
intervals and limitations. It does not claim a uniformly green 33-case or Node run.

The `after-final` fixed bundle (`c49e8b2c…db70`) passed three supplemental cases.
Its normal pack reveal kept the same original canvas throughout the three-second
RAF window, and a real saved response changed mask 0→1 before that scene flipped
the card. The preserved before build had detached the canvas within about 12 ms
of the reveal pointer input. The before result and collector gaps remain in the
local original evidence folder.

The later `after-lanes` bundle (`b059f5bf…678be`) passed one actual UI case covering
English spark, healing, shield and maximum health after the initial floating-label
lane correction. All four arena samples reported quality 0, pixel scale 1,
1024-pixel shadows and normal motion. Each caused exactly one accepted command
and one authoritative event. An independent reviewer inspected the first sampled
frame containing maximum-health floats and confirmed complete, separated lines from source frame
16 at 0.538 s. The earlier source frame 16 at 0.542 s had a crowded initial pose.
Natural cards and boards differ, so this is not a strict pixel A/B.

All six [WebM clips](summary.json) and PNGs in this folder are unaltered copies of
the bounded anonymous native canvas recordings and their original decoded
frames. There is no audio, desktop capture, profile, credential, cookie, database,
HAR or whole-session video. Clips are lossy VP8; decoder selection used existing
source frames without interpolation, scaling or playback-speed changes. The
summary includes original SHA-256 hashes so the copies can be checked.

| Sample | Maximum observed RAF interval | Maximum original video PTS gap |
| --- | ---: | ---: |
| [English spark](final-ritual-spark.webm) | 17.8 ms | 47 ms |
| [Healing](final-heal.webm) | 17.8 ms | 50 ms |
| [Shield](final-shield.webm) | 17.8 ms | 56 ms |
| [Maximum health](final-maximum-health.webm) | 17.7 ms | 50 ms |
| [Pack opening](pack-opening.webm) | 18.8 ms | 69 ms |
| [Pack reveal](pack-reveal.webm) | 18.7 ms | 51 ms |

These are samples with recorder overhead. Pack reveal video contains 18 dynamic
frames spanning 0.532 s; the canvas stops drawing after settling, while passive
RAF observation continues for three seconds. The unrecorded static tail is not
evidence of zero delay. Screenshot appearance is not performance evidence.
Physical phones, public human matches, audio and lower-end devices remain untested.

Full local observations, source manifests and cleanup stages remain under
`test-results/motion-evidence/after-final` and `after-lanes`. Reproduction uses
[the dedicated local driver](../../../tests/local/MOTION-README.md).

The summary's `evidenceIndexes` includes every actual before, after-final and
after-lanes directory, source/hash/HTTP proof and clip's input markers, commands,
RAF/PTS values and canvas state. `collectorHistory` distinguishes old capture
failures, unsampled values and later tool repairs; none are retroactively marked
as passes. All copied videos/PNGs are recorded in `files` with unchanged SHA-256.
