# Reward persistence integration handoff

Historical expansion-source handoff. For the combined teacher/schema-4 core, see [INTEGRATED-PROGRESS.md](INTEGRATED-PROGRESS.md); its validation and compatibility contracts supersede the pending core-validation notes below.

Scope: this document covers the isolated `spellwood-content-upgrade` checkout. It does not describe a deployed release or certify the complete upgraded game. The stable 4.0 checkout and the separate teacher-test work were not edited.

## Durable schema and migration

- Canonical progress is schema 4, local key `spellwood.save.v4`, lock `spellwood.save.v4.transaction`.
- Existing v3/v2/v1 keys remain untouched. New writes never use an old key, so an old tab cannot overwrite the v4 wallet.
- Valid schema 3 preserves its profile ID, old mastery, collection, unfinished card pack, custom deck, rating, result receipts, and recovery reference. A schema 3 server record is migrated with one SQLite revision/CAS write; failed migration rolls back and competing migration rereads the winner.
- A missing journey is allowed only for a schema 3 migration. Missing, null, corrupt, foreign-owner or unknown-version journey data in schema 4 fails closed.
- `journey.ownerId` matches the final `profileId`, including first local bootstrap, old local origin IDs, explicit local restore, and server import.
- Registration retains the guest player ID and its journey.
- Explicit import into an inactive account preserves old skins only in test/display ownership and equipment. It resets formal tickets, guarantee, days, newcomer status, openings, and official dust. Existing authority/mutations or reward activity prevent replacement.

## Caller contract

`createProgressBridge.noteChallenge(playerId, challengeId, issuedAt, {source:'study'|'match'})`

The fourth argument is optional for compatibility; omitted source defaults to `study`. Production study and battle callers should pass it explicitly. Issuance, answer and qualification clocks are server observations. The HTTP participation body remains only `{requestId, challengeId}`; client timing, correctness, wallet or reward claims are rejected.

Qualification requires at least 3200ms from issue and 1200ms after the answer. A quick answer can keep reading feedback. The first qualifying observation is frozen for retries. Both new daily rewards and old card learning days use the same Shanghai date derived from challenge issuance. Correctness and mastery calculation are unchanged. Grade, book/semester and unit metadata determine unit identity; question IDs remain the original server metadata IDs.

`createProgressBridge.result(playerId, snapshot)` accepts optional trusted:

`participation: {startedAt, ownTurns, ownActions}`

Only normal `health`/`draw` termination with at least two own turns and three own legal card/attack actions qualifies the match task. Missing metadata does not qualify. The caller must exclude automated actions. Existing combat rating rules are independent.

## Skin API

`POST /api/progress/skins`

Requires the authenticated cookie, matching `X-Spellwood-Player`, allowed Origin, and JSON. Body is `{requestId, action}`. Allowed complete actions:

- `{kind:'open', mode:'official'|'test', count:1|10}`
- `{kind:'reveal', mode:'official'|'test', batchId, index:0..9|'all'}`
- `{kind:'close', mode:'official'|'test', batchId}`
- `{kind:'redeem', mode:'official'|'test', skinId}`
- `{kind:'equip', mode:'official'|'test', skinId}`
- `{kind:'equip', mode:'base', skinId:'forest_apprentice'}`

No client-owned items, balances, timestamps, operation IDs, random numbers or result arrays are accepted. The server maps request ID to the opening operation ID and generates random draws and time. Permanent SQLite receipt `skin:<requestId>` fingerprints stable intent only. Same request plus same intent returns the original receipt and latest saved state; changed intent conflicts. Both collection dust and journey commit in the same event transaction.

RemoteProgressStore methods:

- `skinAction(action)`
- `openSkinPack(mode='test', count=1)`
- `revealSkinPack(mode, batchId, index='all')`
- `closeSkinPack(mode, batchId)`
- `redeemSkin(mode, skinId)`
- `equipSkin(mode, skinId)`

These use the existing serial queue, identical-click coalescing, unknown-outcome retry ID, account epoch, strict response validation, rescue export, and latest durable export. Read `data.journey` from the validated snapshot and call `dailySummary(data.journey, serverNow)` locally; no separate summary request is needed. The HTTP mutation receipt also contains the pure reducer receipt under `receipt.reward`.

## Verification

`tests/reward-persistence.test.mjs` adds actual HTTP IdentityClient/RemoteProgressStore and SQLite coverage for migration/CAS/failure, wrong answers, fast-answer continuation, 3/6 daily tasks, original five-day card gift, Shanghai midnight, registration, strict intent fields, identity and Origin rejection, skin ten-pull/double-click/reload/restart, unknown response recovery, stale account completion, SQL-trigger rollback, inactive-account import, unit/source isolation, match eligibility, official redemption, and permanent historical receipt replay.

Existing player-progress, local progress-store and study-desk tests passed as a separate 57-test group. New reward persistence, remote-progress and progress-HTTP tests are verified separately under the shared resource gate. One initial multi-file run exceeded the 256 MB cap; subsequent runs used the same cap with a smaller heap and no subprocess isolation. No cap was raised.

## Pending full-game integration

- Parent-owned study/battle callers must pass explicit challenge source and trustworthy own-turn/action participation metadata.
- Parent-owned UI still needs daily task and skin presentation; no full-game browser or release certification is claimed here.
- Offline game persistence now whitelists `match.handSeq`, `players[].handIds`, `players[].handBoosts`, and `board[].kingfisherDrawTurn` so the new engine's state is not silently dropped.
- **Pending: `learning.mjs` must validate the new hand/boost/draw fields and current/legacy rules before the upgraded offline game is declared ready.** This worker did not edit `learning.mjs`, engine, cards, gameplay service, application or collection UI.
- Rule-author field constraints are recorded below after confirmation. Whitelisting alone is not a substitute for validation.

### Confirmed engine field shapes

The rule author confirmed these are the only new durable fields:

- `Match.handSeq`: nonnegative safe integer, monotonically allocated.
- `Player.handIds?`: array parallel to `hand`, same length (0–7). Each string matches `^h[1-9][0-9]*$`; IDs are unique across both seats, and each numeric suffix is at most `handSeq`.
- `Player.handBoosts?`: map from one of that player's current hand IDs to `{turn:number, amount:1}`. The engine applies the discount only under rule 2.3, on that player's active turn, when the grant turn equals the match turn. Playing the card deletes the grant; turn start removes expired grants on both seats. Empty maps are valid.
- `Unit.kingfisherDrawTurn?`: integer global match turn in `1..match.turn`, indicating the storm kingfisher's last trigger. Returning a unit to hand discards the board instance and this field.

Older rules do not receive these additions automatically. Their preservation has been added to the progress sanitizer, while validation remains an explicit parent-owned blocker.

Final verification: **37/37** reward/remote/HTTP tests passed after the final persistence edits, including **15** new reward-persistence tests. The earlier player/local/study group passed **57/57**. Both used `MAX_RSS_MB=256 MAX_SECONDS=120` with `heavy_job.py REWARD_PERSISTENCE -- node --max-old-space-size=96 --test --test-isolation=none --test-concurrency=1 ...`; the final group peaked at 156588 KiB and the existing group at 250084 KiB. Full application integration, full-suite and browser verification were not run by this worker.
