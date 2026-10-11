# Supplemental local normal-motion evidence

This driver is separate from `playwright.local.config.mjs` and its acceptance
cases. It does not rerun or replace the official melee motion gate. The original
250 ms limit and official GitHub-only configuration remain unchanged.

After `npm ci` and `npm run build:network`, run:

```sh
SPELLWOOD_MOTION_PHASE=after SPELLWOOD_MOTION_RUN_ID=after-final \
  npx playwright test --config=playwright.motion.config.mjs
```

Choose a fresh run ID for every run. The config reserves port 4185, creates a
temporary SQLite database, launches installed headed Google Chrome with its
sandbox enabled, and snapshots the current `client-dist`. To inspect a preserved
before build, explicitly set `SPELLWOOD_MOTION_PHASE=before` and
`SPELLWOOD_MOTION_CLIENT_ROOT` to that saved client folder. The source manifest
distinguishes an explicit prebuilt bundle from its current runtime source tree.

The driver creates real isolated guests, builds legal decks through the visible
library, matches through the real server and uses ordinary turns and natural
shuffling. It tests the English spark ritual, healing, shield and maximum health
effects, plus a normal pack opening and an individual canvas-card reveal. It
never injects engine state, changes storage or clocks, inspects the opponent's
hidden hand, fabricates CI variables, or changes game quality.

For the English question, the operator reads the actually displayed question and
options in `test-results/motion-evidence/<run-id>/pending-question.json`, then
writes `selected-answer.json` in the same folder with `{"text":"<exact displayed
option text>"}`. The driver clicks that visible option and removes both temporary
question/selection files. It never imports a correct answer from game data. A
missing operator choice or an unreachable naturally drawn card is a coverage
failure. To run the pack case alone, add `--grep 'normal fullscreen'`.

Only synthetic anonymous arena or pack canvases are recorded natively, with one
video stream, no audio, a six-second hard cap and a two-MiB limit. There is no
desktop capture, whole-session video, HAR, Playwright trace, account creation,
profile export, cookie recording or retained database. Explicit screenshots mask
credential controls. Decode uses original VP8 PTS and selected existing frames;
it does not interpolate, scale or change playback speed. These diagnostic clips
and RAF intervals have recorder overhead and do not establish physical-phone,
public-human-matchmaking or whole-session performance acceptance.

Each run gets unique generated and evidence folders, SHA-256 hashes for the fixed
bundle, product source, original helpers, generated driver and local
infrastructure. `SPELLWOOD_LOCAL_CLIENT_DIST` explicitly selects that snapshot
for the isolated server. Each browser case verifies the real `/health`, homepage
and served `/app.js` SHA-256 against its fixed snapshot. The reporter checks the
source hashes at completion. The shared local cleanup adapter bounds diagnostics,
context shutdown and this test's owned server shutdown; a timeout still fails and
the original page-error assertion stays unchanged. Its source hash is recorded
alongside the collector version. Evidence JSON
retains recording gaps and canvas replacement rather than reconnecting a
recorder to hide an animation interruption. Screenshots demonstrate appearance;
the videos/PTS and passive RAF samples provide the separate motion evidence.
