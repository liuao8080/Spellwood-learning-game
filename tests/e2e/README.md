# Real browser acceptance

These tests are authored separately from the application implementation. They
exercise the network build through real Chromium pages and real UI inputs. A
test listing is not a browser execution, and a passing smoke is not a completed
game acceptance.

## Execution boundary

Run browsers only through `.github/workflows/browser-acceptance.yml`, on the
authorized standard GitHub `ubuntu-24.04` runner. The configuration and server
fixture reject ordinary local execution. Do not set fake CI environment flags
to bypass that restriction. Local static inspection is allowed:

```sh
npx --no-install playwright test --list
```

The workflow has one job, one worker, no retry, `contents: read`, no secrets,
no persistent account provision, and a 20-minute job limit. It runs `npm ci`,
`build:network`, and official Playwright Chromium installation. A separate smoke
step must succeed before the remaining scenarios run. A failed smoke leaves
the later scenarios **not run**, not passed. The workflow runs on pull requests to main or the import checkpoint branch, and on later updates to those pull requests. The maintainer freezes the candidate commit before pushing.

Every test starts the ordinary `server/index.mjs` entry point on runner-local
`127.0.0.1:4173`. Each owns a temporary SQLite directory beneath `RUNNER_TEMP`.
The persistence test stops that actual process and starts it again with the
same database. No test-only endpoints or game configuration overrides exist.
The default 10-second queue, 60-second opening, 150-second turn, and 20-second
reconnect allowance remain in effect. The fixture cleans up its own process
and directory after the test. It does not use a public Site or anyone's computer.

## What is checked

| Scenario | Required observations |
| --- | --- |
| Smoke | Two `browser.newContext()` cookie/storage islands; guest learning via a displayed choice; real registration form; same player ID and learning after registration; account and independent guest in one human room |
| Full PvP | Both players summon, attack and answer English through real UI; actual hand-canvas pointer selection; keyboard `I` and `Enter`; matching public board after actions; same seat and unchanged board after offline/reload recovery; no replay of acknowledged actions; both result screens agree on normal health/draw completion with no proxy assistance |
| AI fallback | Visible waiting UI; actual default roughly 10-second server wait; `pve` / bot identity and visible computer description |
| Durable identity | Learning and a ten-card test gift; account login from another cookie jar; original guest restored on logout with separate learning; consumed guest is not reused after registration; SQLite data survives a real process restart; unfinished rooms do not pretend to survive; fresh-context login sees the saved learning/collection |
| Responsive | Real screenshots at 320×740, 390×844 and 844×390; camp, registration form, matchmaking options and English choices; basic width, target size and overflow checks |
| New targets | Legal 20-card custom decks built by UI replacement, with three copies each of two new enemy-target cards and two new friendly-target cards; public highlight seats/UIDs and accepted attack, damage, growth or recall effects; must actually observe both directions within 24 alternating turns |
| CPU compatibility | One isolated context returns null only for WebGL context requests; actual application CPU wardrobe/reveal and live hand pointer/keyboard interactions; 24 continuous RAF intervals and UI acknowledgement timings, explicitly not a performance pass or real GPU-absence claim |
| Daily and official skin | Three distinct visible study questions, real foreground participation, daily/newcomer awards, one committed official debit, save-before-presentation ordering, equip and registration/reload preservation |
| Wardrobe and resume | All 20 reward models selected sequentially, one actual preview model at a time, per-model screenshots; partial test ten-pull resumes the same saved batch after reload, reveal-all/archive, unchanged official wallet; compact daily/wardrobe/reveal controls hit-tested at 44px |
| Card library | Three one-click presets, legal two-click custom replacement, saved/reloaded 20-card deck, all 36 free card details |
| Draw English | Two real players' second/third own turns, visible grammar correctness/distractor and cancel, same pending challenge after reload, exact held-instance discount, expiry next turn, two-use caps and unchanged original ritual charges; compact hand and draw-action screenshots |

The full-match driver intentionally uses a simple strategy: inspect accessible
hand names and costs, play affordable cards, attack highlighted targets, and
select the first displayed English answer. It does not need every answer to
be right. It never imports an engine, AI, question bank, answer key or private
client object; never writes local/session storage; never injects a winner; and
never sends game commands with an API client. DOM evaluation only reads visible
semantics, layout, visibility and renderer attributes. WebSocket and REST
observation is passive, limited to the test's own traffic, and reduced before
reporting. The full-match test fails if it merely ends turns without real plays,
attacks and answers, or if proxy assistance takes over.

Short offline/reload recovery is separate from a turn-timeout proxy scenario.
The suite does not claim to cover the latter. It also does not claim physical
touchscreen/dragging, full-session FPS, or polished visual approval from viewport
checks alone. The missing-WebGL context is a narrowly scoped test simulation,
not a browser launch flag or a change to browser security. Expansion tests do
not import hidden answer keys; the grammar fixture chooses from displayed
English using independently authored language expectations. The target scenario
never controls random draws: a failure to reach both directions is reported as
a coverage gap until its cause is diagnosed, not automatically a product bug.
Captured screenshots still need human visual review.

The original nine scenarios remain, and seven expansion/inspection scenarios
bring the list to sixteen. Per-test expansion bounds are 90–180 seconds.
One worker and no retries are used. The workflow runs the smoke scenario,
then the focused `@interaction` scenario, then the other fourteen scenarios;
the early check is not duplicated in the final group. Each invocation has a
thirteen-minute global browser ceiling; the entire standard-runner job has a
twenty-five-minute ceiling. Local validation is listing only; CI establishes
actual elapsed time. The inspection case passively records a bounded set of
public pointer/context-menu event fields to diagnose native input differences.

## Evidence and privacy

Artifacts retain only `test-results/browser-evidence/*.png` and `*.json` for
three days. JSON contains statuses, timings, safe action counts, result reason,
small renderer/visibility samples, and a bounded native-error classification.
Errors retain only allowlisted generic templates (with arbitrary identifiers and
property names removed) and numeric line/column coordinates in the known local
`app.js` bundle. Raw errors, stacks and unknown error messages are discarded.
No raw network bodies, identity tokens,
cookies, saved browser profiles, database files, recovery codes, traces, HARs,
videos, or Playwright error-context files are uploaded. Automated screenshots
are disabled; explicit screenshots skip the recovery-code screen and mask
password/recovery fields. Test usernames contain only fictional English letters,
and the test password is the disposable six-character `forest`.

`acceptance-smoke.json` and `acceptance-full.json` identify the tested commit and
the scenario outcomes. `*-observations.json` and labeled screenshots complement
the workflow log. Missing/failed/not-run checks must be reported as such. A
renderer FPS field is one sample, not a performance benchmark.

## Official references and action pins

- [Playwright isolation](https://playwright.dev/docs/browser-contexts)
- [Playwright CI installation](https://playwright.dev/docs/ci-intro)
- [Playwright offline contexts](https://playwright.dev/docs/api/class-browsercontext#browser-context-set-offline)
- [Playwright WebSocket observation](https://playwright.dev/docs/api/class-websocket)
- [Playwright custom reporters](https://playwright.dev/docs/test-reporters)
- [GitHub action security](https://docs.github.com/en/actions/reference/security/secure-use)
- [checkout v4.2.2, full commit](https://github.com/actions/checkout/commit/11bd71901bbe5b1630ceea73d27597364c9af683)
- [setup-node v4.4.0, full commit](https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020)
- [upload-artifact v4.6.2, full commit](https://github.com/actions/upload-artifact/commit/ea165f8d65b6e75b540449e92b4886f43607fa02)

The release-to-commit links above were checked against the official `actions`
repositories while authoring. Pin changes should be checked there again.
