# Teacher academic-English candidate verification

Candidate: 4.0.0-alpha.2, based on verified account/server checkpoint 84f8b18. Public computer site remains 3.2.9-preview until separately published. New card/skin/reward work is outside this branch.

## Completed on 8 October 2026

- All 48 prompts, answer keys, alternatives, Chinese explanations and six original passages independently reviewed and revised. Final bank SHA-256: 401c77b34e55d2321230a3fb0fd4c9eeb1d7b823572c676e7744cfec45657345. See the item-level review in content/TEACHER-INDEPENDENT-REVIEW.md.
- Original school questions/curriculum, 24-card catalogue, battle engine, collection rewards and combat-rating code are byte-identical to checkpoint84f8b18.
- Final complete serial Node suite: 694 passed, 0 failed, approximately74seconds. This covers authority, metadata privacy, teacher/school matching isolation, AI fallback, persistence, old receipt replay, result separation, study views and prior game behavior.
- Typecheck passed within its existing core/JSDoc scope. Real network and computer-practice builds passed; private question/answer inputs remain excluded from the network client.
- The first complete regression exposed one test-harness omission: its import-stripping DOM model lacked the new shared category constant. The harness now supplies that actual imported constant; the affected19checks and the final full suite pass. This was not concealed by deleting tests.
- Browser test discovery finds9scenarios: the previous5plus4new teacher scenarios. No local browser bypass was used.

## Pending before acceptance

The new9-scenario GitHub browser run and its screenshots must be inspected against the pushed candidate. Content review and Node models do not establish mobile pixels or a real browser flow. Planned evidence includes320×740portrait and844×390landscape, long reading/explanation scrolling, two isolated teacher contexts, teacher/school matching separation, default computer fallback, saved scope and account isolation.

No physical-phone, continuous-frame-rate or audio-listening claim is made. The48new questions have no prerecorded audio. The public Site is still a computer-only delivery path; source-level teacher matching does not establish a publicly hosted human-matchmaking service.

## First real-browser run and correction

Run37769162830 at commit ebd3fbec4a6968ed21ee0616a50ccd2338d11588 completed with8of9scenarios passing. All five baseline flows, saved teacher/school scope and account isolation, two real teacher-browser contexts, and teacher/school queue separation with computer fallback passed. The320px reading screen was readable, but returning quickly after an answer made an ordinary nonqualifying reward check become an account error and blocked the study catalogue. The landscape part was not reached.

The server bridge now returns a successful unchanged response for a known answered challenge whose valid server-observed duration is too short. It grants no reward and writes no participation receipt; unknown or invalid requests still fail. A later eligible participation commits once. Question-answer mastery stays saved. The browser test keeps the quick return rather than adding a delay. New real-HTTP and controlled-clock regressions pass alongside related persistence checks (34/34); a new complete browser run is required before acceptance.

The original failed run has64safe JSON/PNG files, archive SHA-256 1cf6501a2d155d17fb137ff29ddaf08eaa7a56b037cd8fa71afde8e129485af6. Its failure is retained as evidence, not counted as a complete pass.
