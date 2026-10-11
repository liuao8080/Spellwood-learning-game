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

Second-candidate validation at `ba37f39d` / CI37:
- Independent original-image review retained the 384px medium/low and 96px low
  A/B sample: collar, sleeve, hem and boots separate without dirty black patches.
- The actual 20-preview wardrobe, free test redemption/equip and two-client
  authoritative skin checks passed; original images at 1280×800, 844×390 and
  320×568 passed independent review for this one hero's visible appearance.
- CI37 seated the equipped player first. The added legal opponent-end branch was
  not exercised in that sample. Earlier failed test-field, cache-version and
  active-turn wait assumptions remain in CI34–36 evidence.
- Overall CI37: 20/21 game scenarios and 2/2 isolated fixtures passed. Normal
  recorded animation still failed at 929ms against the unchanged 250ms gate.

This closes only the single-character material sample. It does not establish
physical-phone performance, fluid animation or overall game-art completion.
