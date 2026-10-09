# Leaf ranger: clothing separation on existing geometry

The large wardrobe preview joins the green tunic and sleeves into smooth colour
blocks, while the boots have weak upper/sole separation. This single-character
candidate shades existing garment vertices around the collar, underarm, belt,
hem and boot opening. It keeps broad colour regions instead of high-frequency
fabric noise, adds no mesh, light, texture, animated effect or material submission,
and leaves face, hair, pose geometry and every other hero unchanged.

Cloth and leather currently share the compiled body material. Changing its
roughness would also change the face and hair. This pass deliberately retains
the existing roughness and uses vertex colour separation, rather than silently
making the entire figure duller or adding another draw pass.

Four local regressions passed for low/medium geometry, unchanged topology,
normals, poses, unaffected heroes and versioned asset hashes. The original CPU asset script regenerated
only this hero's thumbnail and portrait; their content hashes are recorded in
the asset manifest. Only this hero's image URLs receive the new version key, so
the existing one-hour asset cache cannot show stale clothing after an update.
These offline asset renders are not live-browser acceptance.

The first candidate at `7067be48` passed both isolated material fixtures in CI34,
with three submissions unchanged. Independent original-image review rejected its
clothing contrast as too subtle. The second candidate widens the shaded areas
across existing sparse vertex rings and separates boot opening, toe and sole.
It remains a single-character, zero-new-geometry revision awaiting visual review.

CI34 reached the real wardrobe and equip flow, but its new match assertion used
`room.players[seat].skinId`, which is not part of that observer. The test now checks
the existing authoritative `selfSkinId` and peer `opponentSkinId` fields; this
repairs a test field error without removing cosmetic identity validation.
The three equipped-match screenshots were not reached in that failed run.

Pending second-candidate real-browser checks:
- Same camera, light and bind pose with detail off/on, medium and low geometry,
  full preview and 96×120 thumbnail size; expect the same three submissions.
- Real wardrobe preview, then existing free test-mode redemption and equip UI,
  followed by a two-client match with the ranger's authoritative skin identity.
- Screenshots of that equipped hero at desktop and compact landscape/portrait.

Keep only if independent original-image review finds readable clothing/boot
separation without dirty-looking bands, broken joints or lost small-scale clarity.
This visual candidate makes no claim about the outstanding motion performance gate.
