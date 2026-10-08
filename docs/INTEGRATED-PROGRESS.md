# Teacher and expansion progress integration

This local integration is based on teacher runtime `33fa224b23551086467754bf1b67797867bae444`, with the expansion delta from `84f8b18` and its previously uncommitted source, tests, and assets. The original teacher and expansion worktrees remain unchanged. This document covers the progress/learning core only, not full-game or deployment acceptance.

## Compatibility contracts

- The answer-free metadata catalogue contains 432 school and 48 teacher questions. Teacher question/result grade and semester remain null; category is separate. Account preferences retain school grade/course while teacher bank/category is selected.
- Schema 3 migrates to schema 4 exactly once with the original profile ID, all mastery and receipts across both banks, custom deck, combat rating, collection, unfinished card pack, result history, and recovery reference. Local v1/v2/v3 keys remain untouched. The new storage key and transaction lock are both version 4. Missing/corrupt schema-4 journey data fails closed.
- Offline rule versions 1.0, 2.0, 2.1, and 2.2 retain their rule strings and original match shape on continuation. Version 2.3 requires a safe nonnegative `handSeq`, parallel hand identities unique across both seats, safe positive suffixes no greater than `handSeq`, and grants attached to that seat's existing identity with exactly amount 1 in the current active turn. A kingfisher marker belongs only to a kingfisher and is an integer in `1..match.turn`. New cards and 2.3-only fields are rejected in older-rule imports. Import validation never runs factory repair.
- Export/import/reload preserves duplicate-card identities and only the selected instance's discount. A saved kingfisher marker prevents another draw in the same turn.

## Reward timing and ledger contracts

`noteChallenge(playerId, challengeId, issuedAt, {source: 'study' | 'match'})` accepts explicit trusted source metadata. The default remains `study` for compatibility; production call sites must pass the proper source.

Valid early navigation returns success with `{changed:false, qualified:false}`. It neither writes a participation receipt nor leaves remote progress dirty. The answer can be fast: eligibility requires 3,200 ms from issue and 1,200 ms after answering. Impossible, missing, fractional, or stale observations fail. The first valid qualifying observation is frozen before an atomic write; if that write fails, later retries keep the same time even when ordinary challenge timing is pruned. Successful commits can discard ephemeral timing because the permanent ledger replays the exact receipt after restart.

Both banks use original question IDs and one Shanghai issue-day for daily tasks and the original five-day reward. Trusted school unit keys retain `g<grade>:b<book-or-semester>:<unitId>`. Teacher unit keys are `teacher-academic:<validated-category>:<validated-unitId>`. Match questions count toward distinct daily questions but cannot complete the same-unit study route.

Result events retain `(roomId, youSeat)` identity. School receipt fingerprints omit explicit `bank:"school"` to replay pre-bank history; teacher fingerprints keep bank scope. New result receipts include the trusted stable participation shape from the first commit. Adding participation to an already committed older result conflicts instead of granting a retroactive reward. Deferred result retries retain cloned bank and counters.

## Regression fixtures and verification

`tests/fixtures/teacher-v3-progress.json` is synthetic data generated using the unchanged teacher schema-3 runtime at the exact base commit above. It includes both banks' mastery and result receipts, independent teacher/school preferences, a custom deck, combat rating, an unfinished original card opening, an unfinished rule-2.2 match, and a recovery reference. It contains no user account data.

`tests/integrated-progress-core.test.mjs` exercises whole-account local/SQLite migration, all four prior rule versions, 2.3 exact round-trip and fail-closed imports, cross-bank/day timing, source/unit separation, frozen failed-write retries, and historical/deferred result compatibility. Existing teacher authority, player progress, local store, HTTP, remote store, and reward persistence suites remain part of the required checks.

Final core checks (2026-10-08, shared heavy-job gate, serial, 120-second bound):

- Core integration, teacher authority, reward persistence, progress HTTP and remote-store suites: **57/57 passed**, sampled peak 184,968 KiB under 256 MiB.
- Legacy local progress store, including its full-size compaction/replay fixtures: **27/27 passed**, sampled peak 286,504 KiB under an explicitly approved 384 MiB limit.
- Player-progress and permanent ledger suite, including full-size account data: **18/18 passed**, sampled peak 204,728 KiB under the same approved 384 MiB limit.
- Engine, original expanded-combat and independent reward-storage suites: **87/89 initially passed**, including all 120 rule-only simulations. The two failures were test fixtures: an emptied hand retained factory hand IDs, and a catalogue assertion still expected 24 cards. Both fixtures were corrected; a focused three-test run covering both failures and legacy rule continuation passed **3/3**. No production code changed after this group.
- TypeScript check and `git diff --check` passed.

The first broad core batch was stopped by the 256 MiB resource guard during the legacy stress suite. That was a resource limit, not a product failure. It was rerun separately under the approved bound; the production fixture was not reduced. Component tests do not certify GameService counters, voluntary English actions, new-card targeting, card/hero rendering, narrow-screen UI, integrated browser acceptance, or a release. Those are separate integration work.

## Authoritative display-clock follow-up

Every successful progress HTTP envelope now includes a required `serverNow` Unix-millisecond timestamp. `createProgressHttp({now})` can inject a server clock for tests; its default is `Date.now()`. The timestamp is validated, and caller-provided extra envelope fields cannot override it. Request whitelists still reject client clock fields. It never enters account data, exports, permanent event payloads, or fingerprints.

`RemoteProgressStore` strictly rejects missing, fractional, negative, non-numeric, or out-of-range timestamps rather than using the local wall clock. Its read-only `serverNow` getter returns the last valid server observation. Its `rewardNow()` method returns that observation plus elapsed monotonic time, clamped at the reducer's supported timestamp maximum. Both return null before the first accepted snapshot or after an account switch/disposal. Rejected responses preserve the last accepted account and clock. Production uses `performance.now()`; tests may inject `monotonicNow`.

Reward UI must render a loading/sync state while remote `rewardNow()` is null. It should recalculate its displayed Shanghai date from `rewardNow()` when refreshing an open task panel; the store does not emit periodic change callbacks. Local displays keep their injected local clock. Neither display clock decides reward eligibility.

The local ProgressStore participation adapter now accepts a complete foreground budget of at least 3,200 cumulative milliseconds and at least 1,200 feedback milliseconds, matching the authoritative fast-answer continuation. It translates that budget into the unchanged original collection/card-day reducer contract. Invalid or incomplete observations still grant nothing and do not leave the store dirty.

The follow-up regression group passed **67/67** (core migration/timing, actual HTTP, remote parser/store, study desk, reward persistence), sampled peak 183,976 KiB under the 256 MiB gate. This includes noon/Shanghai-midnight transitions with an incorrect or jumping local wall clock, clock removal on identity changes, rejected client clock injection, and export/account-state isolation. Existing success-response fixtures were updated to the new required field, rather than weakening the parser. The independent local collection/progress regression suite also passed **37/37**, sampled peak 187,872 KiB under 256 MiB.

## Local practice completion

The later local ProgressStore journey/skin gap is implemented and documented in [LOCAL-JOURNEY-PERSISTENCE.md](LOCAL-JOURNEY-PERSISTENCE.md). This adds actual local methods and atomic reducers; earlier remote/server checks alone did not certify those local features.

## Release boundary

A schema-3 client rejects schema-4 responses. The parent integration must coordinate client/server versions and handle already-open old clients. Rolling back to an old server is unsafe once its accounts have migrated to schema 4. No push, deployment, or student Sites hosting was performed for this core work.
