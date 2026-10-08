# Local practice journey persistence

The local ProgressStore now implements the journey and skin interfaces used by the practice UI. The earlier server/HTTP implementation did not provide these local methods; this change closes that separate integration gap. It changes `src/network/progress.mjs` and persistence regression tests, not the server award adapter.

## Caller interfaces

The following methods match RemoteProgressStore's signatures:

- `skinAction(action)`
- `openSkinPack(mode = 'test', count = 1)`
- `revealSkinPack(mode, batchId, index = 'all')`
- `closeSkinPack(mode, batchId)`
- `redeemSkin(mode, skinId)`
- `equipSkin(mode, skinId)`

The same strict intent whitelist applies. Caller-supplied outcomes, balances, and randomness are rejected. Local randomness is generated once per new intent and retained with that pending operation through failed writes and retries. `ProgressStore({now, random})` accepts injectable sources for tests; production defaults remain Date.now and Math.random.

For local learning, the presentation adapter calls `noteChallenge(challengeId, {source: 'study' | 'match', issuedAt})` with the local authority's original issue timestamp. Repeated calls preserve the first source and issue time. A missing `issuedAt` falls back to the local observation clock; production practice now supplies the original timestamp. A source is required. After saving the learning receipt, `qualifyLearning(challengeId, {questionMs, feedbackMs})` commits a qualified observation. Legacy callers that never register source context retain their original card-day behavior and cannot fabricate a study-unit journey award.

Qualification checks the cumulative 3,200 ms foreground budget, 1,200 ms feedback budget, and consistent local issue/answer/observation timestamps. A fast answer may finish reading in feedback. The first valid observation is retained for failed-write retries. Wrong answers count. School and teacher questions retain their original IDs and bank-aware unit keys; match questions cannot advance the same-unit study route. Old card days and journey awards use the same Shanghai issue-day.

`addResult(snapshot)` accepts the actual local GameService terminal snapshot. Only its explicit `participation: {startedAt, ownTurns, ownActions}` enables a journey match award. Nothing is inferred from scores, English accuracy, or total room rounds. A normal health/draw ending needs two own turns and three own human actions. Old results and old seatless rows are not awarded retroactively.

## Transactions and recovery

All local reducers run inside the existing short Web Locks transaction and one version-4 save write. The original collection wallet, journey, result/learning history, and exact opening results therefore commit together. Test skins/compensation stay in the test wallet; official duplicates and redemptions use the existing earned dust wallet. Ordinary skin draws spend the local journey's earned tickets, with no paid system.

Identical overlapping skin calls share one promise. A retry after a failed write uses the same operation and random values. A matching paid opening already written by another tab is retained without a second debit. A stale skin business conflict is discarded while independent learning can still commit. Competing redemptions cannot spend the same dust twice when Web Locks are available; the existing single-page limitation remains explicit where locks are unavailable.

On a write failure, the in-memory rescue copy may contain the pending results, but the call reports failure and `store.dirty` remains true. New reveal/equip/other skin operations are blocked until saving succeeds. UI animation must begin only after `ok` and a clean store. Reload, partial reveal, early dismissal, and resume preserve the durable opening and mask.

New local skin, participation, and result intents are bound to the profile active when the method is called. If an explicit restore is already queued, those old intents cannot run against the restored profile. Cross-page profile changes continue to use the existing fail-closed protection. Successful restore clears ephemeral challenge context.

This is local application authority and browser storage, not protection against a user editing their own archive or DevTools. Importing such an archive into an online account still follows the server's unverified-import path: it cannot mint official online rewards. Pure createProgressModel operations do not activate the local reward flags, so the server adapter does not award twice.

## Verification

- New local suite: nine scenarios covering cross-bank wrong answers, issue-day/source deduplication, atomic failed-write retry, locked ten-pull/reload/reveal/equip, official/test separation, competing tabs/openings/redemptions, real snapshot counters/no retroactive awards, delayed midnight presentation, and profile-bound queued intents.
- Local + original card-day + core regression group: 54/54 passed before the final profile-binding guard (206,212 KiB sampled peak).
- Final local + core group after that guard: 18/18 passed (105,596 KiB sampled peak).
- Combined local + teacher + remote/HTTP + reward persistence regression: 69/69 passed before the final local-only guard (186,164 KiB sampled peak).
- All used the shared serial heavy-job gate, 256 MiB cap, and 120-second bound. One busy-lock attempt returned 75 and was retried after the other job finished.

These are persistence/component checks. Parent-owned integrated UI, actual practice presentation, full build, and release checks remain separate. No push, deployment, or student Sites hosting was performed here.
