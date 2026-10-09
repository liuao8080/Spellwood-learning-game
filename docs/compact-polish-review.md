
## 9 October: independent evidence follow-up (candidate, not released)

The exact CI17 commit `261ce709` passed 17 of 18 browser scenarios, including populated five-viewport boards and real two-context matching. The normal-motion case failed at its initial Settings click under a custom three-second timeout, before any combat recording. This is not evidence of a completed normal-speed animation review. CI18 restores the established 12-second setup action budget; capture deadlines and visual/authority assertions remain unchanged.

Independent inspection of the five original populated screenshots found an issue that successful DOM collision checks missed: the own hero was hidden under slot zero in 320 and 390 portrait. A fixed front-center move was rejected after 21 skin geometries × 25 pose samples exposed clipping and wide-accessory overlap.

The new unaccepted candidate reserves a true hero seat. Tall portrait uses a front dock. Short portrait splits the own unit row around a central gap; the unit roots, carved rings and labels move together. Full-sized hand cards and 44-pixel controls are retained. Pointer parallax is disabled only for this tightly packed portrait field. Offline geometry and CPU renders are provisional checks; actual Chromium screenshots, normal-speed motion review and touch regression must still pass before readiness can be claimed.

Source-video evidence remains limited to the actual sequences previously watched in the user-supplied July Hearthstone video: opening selection, card enlargement, board spacing and an attack/contact sequence. Healing and pack-opening footage have not yet been observed. No proprietary assets or video copies are included here.

The later geometry candidate passed four focused cases:320×222 and390×414 arenas, both player viewpoints,all21 hero models and41 pose samples, full head geometry clear of opposing badges, aligned slot rings/shadows and complete dock extents. The short-portrait control rail is52px, retaining44px targets and the190px hand. Short own/enemy row depths are2.8/3.8; taller portrait uses2/3.2 and moves the far hero/card backs together. Original CPU snapshots were visually reviewed, but complete browser screenshots and touch flows remain pending for this revision.

CI21 obtained all five actual populated-board screenshots and completed the natural seven-card wheel/touch checks. The320px layout failed because older, more-specific optional-help rules kept the ritual and End Turn buttons on row2, below the new52px rail and behind the hand. Explicit row1 overrides repair that cascade; selected-card buttons are explicitly44px inside their52px bar. The normal-motion and remaining functional stages were skipped after this layout failure, so shader warmup has not yet been judged.

A new independently authored90-second portrait-command scenario adds real guest play, selected/cancelled commands, native hand/unit holds, detail dismissal and orientation return. It checks optional draw-help placement,44px controls,190px hand and zero unintended authority commands. Local discovery lists19 scenarios; actual execution and independent screenshot review are pending.

### CI23: first-draw experiment and verification limit

Head `1a2cee390fb8ba93203312ece3b6811971489a17`, Actions run
`37872867469`, completed 2026-10-09 UTC: 18/19 browser cases passed.
The runner merge `c873666f5bbfbc4c9b06624e7addbb6384191a57` has tree
`107831c744eab10f8dca07dd628a21a35bb7b081`, equal to the head tree.
Normal motion still failed the unchanged 0.25-second frame-gap gate at
0.631 seconds. Hidden default-canvas preparation returned in 145 ms after
184 ms of program preparation. At the first observed damage transition,
CPU update/submission were 5.4/2.4 ms, but surrounding RAF intervals were
383/633/367 ms. These are not GPU timings; no causal performance improvement
or physical-device smoothness is established.

An independent review of original decoded frames 05–08 observed departure
by roughly half a slot, return, then a white/purple ring around the hero.
The attacker reaching the contact point and continuous contact flash were
not visible. Original 460×135 evidence and its gaps limit visual conclusions.
The complete 179-file artifact has SHA256
`a345740e50fe693bb52802bc9f7d469a6012937b576c841e52db6002041e143c`.

The next diagnostic adds bounded passive long-task/long-animation-frame
CPU timeline observations. It records support/failure explicitly and no
script URLs or attribution names. It changes neither game code, clocks,
recording, nor the motion acceptance gate. Missing entries cannot establish
absence of stalls. The new diagnostic itself awaits browser execution.

### CI24 and phased melee reliability candidate

CI24 run `37874756677`, head `17de18b4f3c869ba89822cc7baed0be80f239463`,
finished 18/19 passed; motion frame gap 0.948 seconds still failed. Both passive
observers were supported. Attack-period long tasks measured 346/580/349ms;
long animation frames exposed substantial browser rendering-phase time with
little attributed scripting. This does not isolate a GPU/paint root cause.

The next narrow correction addresses a separately proven presentation flaw:
a single 740ms global tween could jump directly from anticipation into return
on a delayed frame, emitting damage without ever updating the contact pose.
Melee now runs anticipation (118ms), travel (230ms), contact (82ms) and return
(310ms) as sequential scene jobs. Anticipation ends at a retained -.08 setback;
travel starts there and ends at contact. Each phase's endpoint gets a scene
update before the next is scheduled. Browser presentation remains unverified.
The nominal budget is still 740ms; missed frames can extend the actual sequence.
It is not a frame-rate fix and does not relax the existing coverage gate.

Impact remains once-only and generation/token guarded. Hidden pages, context
loss, stale sequences and frame faults stop later phases. Finally cleanup
restores the owning model and releases its motion token on errors. Eleven
logic cases cover 16/33/120/633/2000ms intervals, all four cancellation points,
repeated impact attempts and rejected work; five real-Three-object/mock-renderer
cases cover actual scene integration and cleanup. All passed along with typecheck
and network build. These tests are not WebGL visual acceptance.
