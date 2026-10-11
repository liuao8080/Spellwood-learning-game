# User-authorized local browser acceptance

This path is explicitly for local validation with the installed Google Chrome.
It preserves the official GitHub-only configuration and server fixture. Never
set `GITHUB_ACTIONS` or `SPELLWOOD_BROWSER_CI` to run it.

With Node.js 24+, install dependencies and build the ordinary network client:

```sh
npm ci
npm run build:network
npx --no-install playwright test --config=playwright.local.config.mjs --list
npx --no-install playwright test --config=playwright.local.config.mjs --grep @smoke
npx --no-install playwright test --config=playwright.local.config.mjs --grep @combat-motion
npx --no-install playwright test --config=playwright.local.config.mjs --grep @local-polish
npx --no-install playwright test --config=playwright.local.config.mjs --grep @local-renderer
npx --no-install playwright test --config=playwright.local.config.mjs
npx --no-install playwright test --config=playwright.native.config.mjs
```

Chrome runs headed with its ordinary GPU path. No browser flag forces software
rendering, no quality preference is reduced, and the original 250 ms recording
gap assertion is unchanged. Read each run's `environment-worker-*.json` to check
the actual unmasked renderer and Chrome hardware-acceleration feature status.
If Chrome reports software rendering or lacks a confirmed renderer, record that
limit rather than claiming physical GPU validation.

Tests use their own loopback server at `127.0.0.1:4184` and per-test disposable
SQLite directories in the system temporary directory. An occupied port fails;
tests never reuse a running server or open the ordinary `.data` save. The
restart scenario restarts only the process it created with that same test DB.
Use `SPELLWOOD_LOCAL_PORT` for another distinct port; 4173 is reserved for manual
play. One worker and zero retries avoid overlap and hidden reruns.
The served build defaults explicitly to the repository's `client-dist`; an
independent diagnostic configuration can select an already-built snapshot with
`SPELLWOOD_LOCAL_CLIENT_DIST`. Its actual `app.js` hash is recorded. Inherited
`CLIENT_DIST` is not used to silently select a different build.

The local configuration copies the original E2E modules into the already ignored
`test-results/local-suite` directory at the same depth as `tests/e2e`. Only the
helper's local fixture/server imports, fixed navigation/error-source origin and
explicit evidence output paths change. No original per-test logic, timeout, game
rule, private engine access, answer or assertion is modified. A source/hash
manifest records the original and generated files,
current commit, dirty file names, unchanged official CI files and client bundle.
Do not run simultaneous local Playwright commands in one checkout because they
share that generated suite directory. Diagnostic drawing experiments are excluded
from default acceptance and do not count as visual/performance acceptance.

The three `@local-polish` cases are independent additions: real long-name account
HUDs at two wide viewports, immediate introductory-hint cleanup with keyboard
selection/inspection/focus preservation, and an actually saved test pack that
ignores right-click/multiple-touch input while retaining ordinary primary opening.
The local spec is copied beside the original suite and uses its public UI helpers.
It never imports private client/scene state, seeds a pack or edits saved data.
One additional `@local-renderer` observation holds each viewport without game
commands for 2, 5 and 10 seconds and records the public CSS/buffer/DPR/quality
attributes. Browser-context DPR is explicitly distinguished from physical display
resolution. It does not restore or force any quality level and is not an FPS pass.
The local actor cleanup records the start/end and duration of screenshots,
read-only diagnostics and context closure. They have independent bounded waits;
a timeout stays failed. Completed observations are saved before closure and all
contexts are attempted. The owned server closes in `finally`; its exit is bounded
after TERM/KILL, and an unconfirmed exit preserves its temporary database. This
local cleanup adaptation leaves original CI helpers and body assertions intact.
Both local configs use the same explicit adapter. Regression checks are run with
`node --test tests/local/cleanup.test.mjs`.
The native right-click pack case dismisses Chrome's menu with Escape and, if the
app also receives that key, its real `继续揭卡` control restores the same saved
batch. A blank canvas did not reproduce the close stall; the actual gift page
did. No product handler is changed or injected to suppress native menus.
Escape and minimizing were not sufficient in the actual test runner. The case
now saves all original body screenshots, batch/gesture assertions and safe body
diagnostics first, then navigates only its owned page to `about:blank` for release.
Navigation and the same five-second close limit still fail if they time out.

The separate native-DPR configuration reuses the original combat assertions and
250 ms gate with A's `viewport:null`, no DPR override, and only its owned native
window resized before game loading. It records actual `innerWidth/innerHeight`,
OS DPR and battle CSS/buffer/quality. B retains the original reduced-motion setup.
This supplemental desktop-window result is distinct from the original 844x390
DPR-1 acceptance and never relaxes recording byte, pixel or time limits.
Source and generated-module hashes are checked again when the run ends; changes
invalidate attribution and fail the local report.

Each run gets `test-results/local-browser-evidence/<run-id>/`: safe status JSON,
bounded reduced observations, explicit password/recovery-masked screenshots,
and the existing bounded anonymous arena-only clips/decoded frames. Profiles,
tokens, cookies, recovery codes, SQLite files, HAR, Playwright traces and session
videos are not retained. Temporary Playwright internal diagnostics must not be
published. Screenshots still require human review and do not establish smooth
motion; two browser contexts do not establish public human multiplayer, and
simulated phone sizes do not establish physical touchscreen/device acceptance.
