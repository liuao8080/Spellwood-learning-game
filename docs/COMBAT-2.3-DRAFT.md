# Combat 2.3: twelve-card expansion

Implementation draft, 2026-10-08. This document describes engine rules and automated evidence, not a public deployment or real-device acceptance report.

## Catalog and version contract

- `RULES = "2.3"`; explicit legacy constants retain 2.2, 2.1, 2.0 and 1.0. `hasOpening` recognizes 2.3/2.2/2.1; finite four-use rituals recognize 2.3/2.2/2.1/2.0.
- The original 24 records, their IDs, combat values and the three existing preset deck lists are unchanged. Twelve records are appended, for 36 freely usable base cards. No ownership, rewards, currency or cosmetic state is consulted by deck validation or combat.
- Decks remain exactly 20 cards with at most three copies of an ID. Existing custom decks remain valid. Each new card has one effect keyword, an `introducedRules` marker, unique illustration slot 24–35 and `/assets/cards-v4/<id>.webp` metadata. Image rendering must consume `artPath`; metadata alone does not prove an asset has loaded.
- `isCardAvailable(id, rules)` rejects new IDs in legacy rules. Legal actions use it. Save validators must also use it when accepting a saved hand, deck or board. Existing legacy matches are continued under their original rule string and do not acquire new hand-identity fields.

## Cards

| ID               | Name                         | Cost / attack / HP | Effect and target                                                                                                                    |
| ---------------- | ---------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| acorn_squirrel   | 橡果松鼠 / Acorn Squirrel    | 1 / 1 / 2          | When its board HP reaches zero, owner gains 2 armor once. Recall is not death.                                                       |
| mushroom_medic   | 蘑菇医师 / Mushroom Medic    | 2 / 1 / 3          | On arrival, heal another living, wounded friendly unit for 3, capped at its maximum.                                                 |
| reed_frog        | 芦苇蛙 / Reed Frog           | 2 / 2 / 2          | On arrival, reduce one enemy unit's attack by 1, minimum 0, until it leaves. An already-zero enemy remains a legal target.           |
| glass_snail      | 琉璃蜗牛 / Glass Snail       | 3 / 1 / 4          | On arrival, shield another living friendly unit that has no shield. The shield blocks its next positive damage event in full.        |
| storm_kingfisher | 风羽翠鸟 / Wind Kingfisher   | 3 / 3 / 2          | After its active attack actually reduces the enemy hero's HP, draw 1, at most once per own turn. Armor-only damage does not trigger. |
| sun_badger       | 晨光獾 / Dawn Badger         | 4 / 3 / 5          | On arrival, owner gains 1 armor per other friendly unit, maximum 3.                                                                  |
| crystal_ram      | 晶角羊 / Crystal Ram         | 4 / 4 / 4          | Its active attack against a unit adds 1 to that single damage event. Hero attacks and retaliation have no bonus.                     |
| ember_salamander | 炉火蝾螈 / Hearth Salamander | 5 / 3 / 5          | On arrival, deal 2 to an enemy unit, never a hero.                                                                                   |
| thorn_sweep      | 荆棘扫掠 / Thorn Sweep       | 2 / spell          | Deal 1 simultaneously to every enemy unit. Requires at least one living enemy unit.                                                  |
| mending_rain     | 修复之雨 / Mending Rain      | 2 / spell          | Heal all living friendly units for 2, capped separately. Requires at least one wounded friendly unit. Does not heal heroes.          |
| tidal_recall     | 潮汐归途 / Tidal Recall      | 1 / spell          | Return one living friendly unit to the owner's hand as its base card and a new hand instance.                                        |
| sunseed_blessing | 阳种祝福 / Sunseed Blessing  | 2 / spell          | Give one living friendly unit +2 maximum HP, then heal it for 2. Lasts until it leaves. Full-HP targets are legal.                   |

`cardGuide` provides Chinese/English names, stats, exact effect text, legal targets, timing, interactions, and a specific usage example for every addition. Numerical examples and rule text read card data rather than maintaining an independent balance table in the guide. Elements remain visual categories with no elemental strengths or weaknesses.

## Target and resolution contracts

`legalActions` is authoritative for both player commands and AI. For a targeted arrival, it first checks mana and board space. If any legal target exists, it emits one action per target and no automatic-target action. With no legal target, it emits a normal summon. The newly summoned unit cannot target itself. Targeted spells require a legal target; area spells accept no target argument. Invalid actions return the identical input state, with no cost, hand, sequence or board mutation.

All combat damage in an exchange is determined from the pre-exchange attacks, then applied to both partners. All sweep hits likewise occur before cleanup. Cleanup first removes every HP-zero unit, then resolves the death effects in stable seat order and board order. Each removed squirrel adds armor once; later actions cannot repeat its effect. Winner evaluation runs after those effects and kingfisher draws/fatigue. Armor does not restore hero HP, so it cannot rescue an already-dead hero.

Zero actual damage does not break a shield. A zero-attack ordinary unit can still spend its attack opportunity and takes normal retaliation. Ram's bonus is part of one shieldable damage event, not a separate hit. Guards constrain ordinary attacks but not targeted arrival damage, damage spells or the area spell.

Healing only operates on units with positive HP. It cannot resurrect. Blessing raises maximum HP before applying its healing. It does not change attack, shield or readiness.

Kingfisher checks actual hero HP loss after armor, records `kingfisherDrawTurn`, and follows ordinary hand and fatigue rules. A full hand burns the drawn card; an empty deck deals escalating fatigue. The attack can kill both heroes and produce a draw. The marker belongs to that board instance, so recall removes it.

Recall consumes its spell and energy before checking hand space. A normal seven-card hand therefore has one space for the returned card. Only `cardId` is added, with a fresh hand ID. Damage, attack modifiers, extra maximum HP, shield, readiness, turn markers and any other unit fields are discarded. It does not enter death cleanup and does not trigger squirrel armor. Replaying the returned unit still costs its card's normal energy.

## Hand identity and integration

The engine keeps `hand: string[]` for compatibility and adds parallel `handIds: string[]` plus match-global `handSeq` only in 2.3. IDs are deterministic private `h<number>` values. Draws, spell/unit plays, successful mulligans and recalls update the arrays together. Draws burned at the seven-card cap create no hand instance. Unrelated hand IDs remain stable through index shifts.

`ensureHandIds(state)` mutates an owned state to initialize missing IDs or repair mismatched/duplicate IDs. Public transitions clone before invoking it. Authoritative adapters that replace factory hands must call it on their own state after replacement. Wire IDs should be opaque and visible only to the owner; these internal IDs are not an authorization token.

The optional `Player.handBoosts` map is an integration hook keyed by hand ID. `effectiveCardCost(state, side, index)` applies exactly a one-energy discount only for 2.3, on the owner's active turn, with a valid parallel identity array and a grant of `{turn: state.turn, amount: 1}`. It caps the result at zero. Legal-action checks and actual mana payment use the same function. Playing the instance deletes its grant; turn changes clear expired grants on both players, and recall creates an unboosted new ID. AI line deduplication distinguishes same-name cards with different effective costs. The engine does not issue these grants or trust a client to issue them; the authoritative challenge adapter owns that step.

Required integration outside this patch:

- Save validation: allow explicit 2.2; retain and validate 2.3 `handSeq`, `handIds`, optional `handBoosts` and `kingfisherDrawTurn`. The marker must be an integer not later than the saved turn. Grants must refer to existing hand IDs and the correct turn. Enforce the legacy catalog while reading old matches.
- Progress serialization: preserve those fields rather than dropping identities or the once-per-turn marker. Dropping the marker could allow a second trigger after a reload.
- Network/UI: accept friendly and enemy target options from legal actions and provide a visible choice when required. Heroes must never be offered for the new unit-only actions.
- Events: distinguish recall from death, include maximum-HP changes and shield gains, and group area outcomes. A recalled unit did not suffer lethal HP damage; it should not emit a death effect or sound.
- The additional two optional English draw challenges, issuing their discount grants, network version change and opaque wire IDs are separate work. This patch supplies the discount execution hook; it does not change question content, add challenge charges, or change ritual magnitudes.

## Candidate decks for explicit owner integration

These are additional IDs for review, not replacements for `grove`, `ember` or `moon`. Existing chosen IDs and custom decks must not be silently rewritten. The candidates are test fixtures and recommendations only; the UI/server preset lists have not been changed here.

- `grove23`: sprout×2, acorn_squirrel×2, sprite×2, mushroom_medic×2, glass_snail×1, turtle×2, sun_badger×1, bear×2, mending_rain×2, sunseed_blessing×2, dew×1, lantern×1.
- `ember23`: rabbit×2, acorn_squirrel×2, fox×2, reed_frog×2, wolf×2, storm_kingfisher×2, crystal_ram×2, ember_salamander×1, spark×2, thorn_sweep×2, lantern×1.
- `moon23`: firefly×2, fox×2, otter×2, mushroom_medic×1, glass_snail×1, storm_kingfisher×2, crystal_ram×1, ember_salamander×1, tidal_recall×2, sunseed_blessing×2, mending_rain×1, thorn_sweep×1, frost×1, lantern×1.

## Automated evidence

Final new-card file: 31 tests passed, covering all twelve cards' targets and rejection boundaries, shields, zero attack, death-trigger uniqueness, simultaneous exchange, healing caps, no resurrection, recall at full hand, hand identities, kingfisher fatigue loss/draw, hidden-information invariance, and tactical guard-removal/recall lines. Four additional tests cover same-name instance discounts, zero-energy plays, expiration/recall cleanup, invalid identity arrays and tactical use of discounted duplicates.

The final combined run with the new-card, expanded-combat, opening and card-guide suites passed 59 tests in 7.89 seconds; shared guard sampled peak process-tree RSS 108,320 KiB, 8.13 seconds total. Before the discount hook was added, the broader engine/expanded-combat/opening/card-guide/custom-decks run passed 76 tests, including 120 existing rule-only simulations, in 24.24 seconds (166,120 KiB sampled process-tree peak). TypeScript validation passed. All tests used the shared 256 MiB/120-second guard and serial test workers.

For each new card, all three personalities and all three difficulty policies produced legal actions and the same choice after the opponent's hidden cards and both hidden deck orders changed. Existing difficulty configurations and fixed easy-policy cadence are retained.

The reproducible beginner-policy simulation used two seeds for every legacy/candidate preset pairing, in both seat assignments: 36 matches, 23 legacy wins, 13 candidate wins, no draws, maximum 43 turns. It also completed 24 mirrored matches covering a three-copy extreme deck for each new card. Invariants were checked after every action. Rituals were disabled on both seats to isolate card play. The policies are fixed; no mid-match card-order or difficulty adjustment was used. This small result is an investigation signal, not evidence of human enjoyment or final balance.

Existing test updates are limited to catalog-size assertions (24→36) in `engine.test.mjs` and `expanded-combat.test.mjs`, the matching distinct-art count in `engine.test.mjs`, and the expected current rule string (2.2→2.3) in `expanded-combat.test.mjs`. The old 2.1 and 2.0 transition/AI comparisons against their fixtures remain intact and passed after the final engine changes.

Not verified here: UI target interactions, original artwork loading, animations, real-device CPU/GPU behavior, physical touch interaction, public multiplayer deployment, human balance or enjoyment.
