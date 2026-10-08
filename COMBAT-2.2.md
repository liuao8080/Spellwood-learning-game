# Combat 2.2: cards, teaching strength and local adaptation

This change addresses a concrete beginner barrier: the previous computer always searched multi-action winning lines, defended against public lethal damage, and had four reliably successful rituals. The new first-game preset uses a fixed foundation deck and a simple policy. Players can select easy, standard or adaptive strength; the server must report the actual chosen preset.

## Cards and rules

There are 24 cards, with unchanged original 12 card values and nine new creatures plus three new spells. Each has at most one keyword. Otter has a shield that blocks the first positive damage instance. Boar gives other friendly creatures +1 attack when played. These create timing, trade and board-development choices without adding a second resource or a new target-selection mode. Frost deals 5, Dew heals 3, and Lantern draws 1; older spell values remain 3/5/2. The three 20-card decks emphasize defense/growth, immediate attack, and hand resources respectively. All cards expose one of four visual elements; elements do not secretly alter damage.

Rules are versioned as 2.2 / net-1.1. Imported 1.0, 2.0 and 2.1 saves keep their original resources, opening behavior and original-card combat/AI semantics. Existing saved hand and deck order are not rebuilt. Original rule fixtures exercise compatibility. New `shield` is optional, so old units require no invented state.

## Visible, fixed computer strength

| Level | Deck | Decision policy | Ritual policy |
| --- | --- | --- | --- |
| Easy | Fixed foundation 20-card deck | Play an affordable creature, take a safe trade, attack hero; single-step card/spell choice | At most two uses, from round 3, then alternate rounds |
| Standard | Opponent's full preset deck | Single-step evaluation | At most three, from round 2, then alternate rounds |
| Tactical | Opponent's full preset deck | Existing lethal/defense search and two-step evaluation | At most four |

The available charges and combat numbers do not change. The weaker ritual use is an announced computer strategy, not an answer-sensitive handicap. Every policy masks the human hand and both draw orders. No policy sees English answers, invents a draw, or guarantees a player win. The plan is copied at room creation and returned in the snapshot/result. PVP contains no computer plan. Real server default remains fixed tactical; local practice explicitly sets its own next-match plan.

## Local performance profile

`combatRating` is separate from English mastery. It begins at 700 with no sample history. The first three completed adaptive games stay easy, and the first five are labeled provisional. The Elo-shaped update uses fixed preset anchors 700/950/1200, expected result `1 / (1 + 10 ** ((anchor - rating) / 400))`, K=48 for the first five games, then K=24, bounded to 400–1600. These are product tuning constants, not population-calibrated human Elo estimates.

After the initial minimum sample, adaptive selects easy below 800, standard below 1050, and tactical above that. Each pair of consecutive losses lowers the next game by a tier, capped at easy. A completed win or draw resets that streak. Explicit easy/standard choices stay fixed. Only natural unassisted computer wins/losses/draws update the profile. Resignation, abandonment, expiry, errors, PVP and proxy assistance do not. Score/English correct totals do not enter the update. The module rejects an immediately repeated result ID; the persistence layer must use its permanent result receipt ledger for full replay idempotency.

## Custom 20-card decks

`validateCustomDeck(ids)` requires exactly 20 current card IDs and at most three copies of each. The queue accepts this only with `deckId="custom"`. Both protocol and match authority validate, clone and resolve card values from their own catalogue. Opponent construction and order stay private. The server does not trust any client card attributes or difficulty/rating input. Existing presets remain available. Collection ownership is separate local state, not a server account entitlement.

## Reproducible simulation evidence

Run `node scripts/simulate-difficulty.mjs 120 easy,standard,tactical`. The final 1,440-game evidence is in `evidence/combat-balance-2.2.json`. Every cell contains 120 fixed seeds, 60 games from each starting seat, and 40 with each player deck. Independent seeded streams govern dealing, moves and ritual correctness. Games must end naturally with legal progressing actions.

The novice policy plays the cheapest creature, attacks a random legal target, and uses rituals for hero damage. The intermediate policy uses single-step card decisions plus obvious healing/removal/draw ritual choices. Both use the same ordinary player rules. The computer uses its documented preset and successful rituals. English accuracy is independently sampled at 50% and 75%.

| Player policy / ritual accuracy | Easy player wins | Standard player wins | Tactical player wins |
| --- | --- | --- | --- |
| Novice / 50% | 60/120 (50.0%) | 0/120 | 0/120 |
| Novice / 75% | 56/120 (46.7%) | 0/120 | 0/120 |
| Intermediate / 50% | 114/120 (95.0%) | 27/120 (22.5%) | 24/120 (20.0%) |
| Intermediate / 75% | 118/120 (98.3%) | 36/120 (30.0%) | 33/120 (27.5%) |

This is implementation-author verification, not independent acceptance or human playtesting. It supports the directional finding that the foundation preset gives a weak policy plausible wins and rewards basic trading skill. It does not predict any child's win rate. The easy-to-standard gap is large; adaptation and manual easy mode keep that visible and reversible. The small novice accuracy reversal can occur because wrong answers grant armor, direct hero damage is a weak fixed strategy, and later states diverge. It is not evidence that English errors should be rewarded in mastery or rating. Real novice playtests should verify comprehension, guard targeting, avoiding wasteful trades and whether the standard transition feels too abrupt.

Meaningful automated checks cover shield consumption/retaliation/event visibility, rally targeting and lethal search, spell magnitudes, no hidden-information access at all strengths, rating eligibility/placement/demotion, rule 2.1 save compatibility, locked server configuration, PVP separation, strict custom deck validation and actual custom-versus-preset WebSocket matching.

## Standard transition follow-up

A separate paired 144-game pilot compared the original standard policy against three rituals, starting round 2 on alternate rounds; one intermediate-policy run per cell/seed, 36 seeds for each of two English accuracies and both configurations. At 50% accuracy, wins changed 10/36 to 11/36; at 75%, 16/36 to 21/36. The evidence is `evidence/standard-transition-pilot.json`. The final standard preset adopts that modest reduction in early ritual pressure. The 1,440-game table above remains labeled evidence for the earlier four-ritual standard; do not present its standard column as measurements of the final preset. This small pilot does not establish a target win rate or remove every tier-transition issue. Adaptive easy protection and manual easy mode remain available. Rating anchors and thresholds were not fitted to this pilot.
