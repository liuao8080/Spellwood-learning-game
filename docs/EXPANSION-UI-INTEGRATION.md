# Daily rewards, wardrobe, and battle UI integration

Local implementation, 2026-10-08. No deployment, real-browser acceptance, or physical-device performance claim is made here.

## Entry points

The immersive four-entry camp now exposes the learning handbook, all-free card/deck library, today's three tasks, and the character wardrobe. “礼盒与记录” opens a short secondary panel for the unchanged five-learning-day card-cosmetic gift, records, and backup. No extra permanent menu covers the 3D camp.

Today's tasks render only committed `journey` data through the pure `dailySummary`. Remote time uses `RemoteProgressStore.rewardNow()` and shows syncing until a trusted anchor exists. A foreground page timer recalculates the Shanghai day at the next boundary. Neither the UI clock nor an interface click grants rewards. The task buttons can start a six-question learning round, a two-question same-unit round, or match setup without altering school/teacher selection. Teacher 48 and school 432 records are unchanged.

Study and battle feedback participation uses a foreground clock, a cumulative 3.2 seconds from local presentation, and 1.2 seconds of visible feedback. The local foreground observation is deliberately conservative relative to server issuance. Both the study response and battle challenge pass the original authority-issued `issuedAt` into `noteChallenge`; the first observation is retained across replay. A quick answer can continue reading and automatically submit participation; leaving early does not prevent navigation and does not start background qualification. Occluded feedback is paused per challenge. Server qualification remains authoritative.

## Deck and card surfaces

The deck library starts with the three existing recommendations and one-click equip. Custom adjustment is one existing card plus one replacement, preserving exactly 20 cards and at most three copies. Saves await durable success before closing. Catalogue counts use `CARDS.length`, and all 36 base cards are freely playable. New thumbnails and opening art use `artPath` so the twelve appended cards do not request old artwork paths.

## Character collection

`WardrobeView` sends only skin intents to the current progress store. Official and test collection/tickets/dust stay separate; the base apprentice is always available. Twenty earned models have their own portraits and catalogue descriptions. Official entry explains the free daily route, 5% ordinary chance per skin, 20 duplicate dust, 100-dust redemption, and the next-unowned draw after four consecutive duplicates while incomplete. Ten-pulls use the same rules and price per item. Existing card-cosmetic rewards remain a separate pool.

Open and reveal results render only after the store confirms its save. The opening ID and revealed mask come from saved data. Skip reveals the same batch, “稍后继续” retains it, refresh offers it again, and a new draw remains blocked by an unfinished batch in that mode. Busy state prevents double commands; account epochs suppress old completions. A failed/unknown save shows retry rather than an animation or another draw.

A persistent `HeroPreview` uses one low-LOD actual authored hero at a time, disposing the previous mesh. Catalogue cells load static thumbnails only. The preview is static outside a short, bounded reveal; reduced motion and hide/dispose stop it. A CPU fallback is bounded to 420×400 pixels. If no canvas renderer is available, the saved portrait remains usable. Reveal uses a full viewport, pedestal, local glow, audio settings, and safe-area controls.

## Battle authority

Client protocol 2 verifies `net-2.3`, combat rules, and content version before becoming ready. Mismatched clients show an explicit refresh action. Targeted cards consume `self.legalCardTargets` with the owning hand instance, index, target and seat; friendly targets are selectable. Effective cost comes from `self.handCosts` in controls, accessibility labels, and physical hand textures. Hand textures use bounded card/finish/cost keys and retained cleanup, never opaque-ID caches.

Optional English help sends `draw.begin`, `draw.answer`, and `draw.cancel`; answer routing reads `private.challenge.purpose`. It only appears when the server advertises `canBegin`. Copy states two uses per match, this-card/this-turn minus-one cost, original-card retention on wrong/cancel, and the shared once-per-turn English action with the original four rituals. Room snapshots supply frozen skin IDs to `ArenaScene.setHeroSkins`; the wardrobe cannot open during a room.

## Validation boundary

Tests cover saved daily summaries and day rollover; two-click legal deck replacements and save waiting; wardrobe source separation, public rules, save-before-animation, duplicate clicks, unknown/stale-account outcomes, same-batch skip/resume; authoritative target/cost identity; new protocol compatibility; foreground and early-exit participation; one-preview catalogue rendering; instance-specific hand textures and cleanup; and practice cosmetic freezing across rooms.

Separate existing regression groups cover real HTTP/WebSocket behavior with a DOM model, study desk, lifecycle restoration, and the practice authority. These are not screenshots, real touch gestures, actual GPU tests, or 320/390/844×390 browser layout acceptance. Mobile CSS includes 44px controls and safe-area fullscreen treatment; final browser CI and visual review must validate those layouts against the real built app.


Final UI validation, 2026-10-08 (all commands through the serial shared gate, 256 MiB / 120 s):

- Final expanded UI and legacy study reward timing group: **32/32 passed**, including 17 UI tests, the actual local schema-4 skin store, foreground timing, and source isolation; peak 90,328 KiB.
- Card cosmetic interface regression: **25/25 passed** in the preceding combined group. Its same-run timing failures were corrected by making the old fixture's issuance, answer, store and foreground observations use one clock. No production timing check was relaxed.
- Actual HTTP/WebSocket client continuity: **19/19 passed** after protocol, new imports, lifecycle, draw routing and effective-cost details were connected. The only failure in that combined run was a new test fixture with an empty metadata list; it now uses a valid catalogue fixture and passes.
- HandScene, hand-layout, practice runtime and earlier UI tests: **35/35 passed**. This includes per-instance same-name discounts, restoring base costs, bounded texture cleanup, and frozen practice cosmetics. Later UI checks retain those components.
- Earlier broader app/practice/study desk regression: **49/49 passed**.

The actual local progress interface was found missing during wiring and was subsequently implemented by its owner. The real local-store wardrobe integration now verifies a persisted ten-pull, reload of the same batch, reveal-all without reroll, archive, and official/test separation. The server and local stores are both consumed via the same intent API. New reveal motion and sound require both `result.ok` and a clean loaded store.
