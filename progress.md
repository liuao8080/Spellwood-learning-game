Original prompt: 接手词灵对决 Spellwood PR #6 的实际最新版本，先建立真实本地运行、GPU和交互基线，再精细打磨原创三维人物/棋盘、手牌、元素攻击、回血护盾和全屏开包；保留英语学习、权威匹配与旧存档；每轮浏览器操作和独立复核；完成后提交并推送独立分支，不合并或公网部署。dist/assets 是源素材，必须保留；先读两份诊断文档。

## 2026-10-10 takeover

- Empty initial workspace, no existing local modifications. PR #6 read via GitHub: draft/open/unmerged, head fd82c1aa8bfc381d6a6a298197a93945206ea5e7, base codex/teacher-expansion-integrated (6d7bb94).
- Independent branch: codex/local-gpu-refinement. Node 24.14.1, locked npm ci completed; ordinary network build; local persistent authority at http://127.0.0.1:4173, health protocol2/net-2.3/combat2.3.
- Read README, server/E2E docs, COMPACT-BOARD-POLISH, ARENA-CLARITY-DIAGNOSTIC, FRAME-DIAGNOSTIC; no project-local AGENTS/skills/DeepSeek router present.
- Device: MacBook Air Mac16,12, Apple M4 (10 CPU / 8 GPU cores), 16GiB, macOS27.0.1. Isolated headed Chrome154.0.8037.99 reports ANGLE Metal Apple M4 and hardware WebGL. Original production defaults unchanged.
- First local smoke + normal-motion 2/2 passed. Original 250ms recording-gap assertion: max38ms / 92frames / 3.032s. Attack HP18→17 once, return displacement0. Evidence: test-results/local-browser-evidence/2026-10-10T04-04-04-413Z-c77e3d12. This is local desktop evidence, not a physical phone/public-network pass.
- Independent full baseline pending. First full run exposed a local test transport origin omission (hardcoded4173 versus isolated4184); it is a harness failure, not a product failure. Retain it and rerun from the beginning after explicit origin adaptation.
- Native Chrome actual UI: camp, custom-deck slot replacement/save, matching/10-second computer fallback, opening, I details, Escape focus return, keyboard selection, English ritual/feedback. Native screenshot shows own guest name overruns hero-panel width. Independent 844x390 image shows hand-introduction notice covering unit attributes.

## Priority plan before product edits

1. Input safety: fix independently reproduced delayed hand long-press becoming selection; constrain pack gestures to one primary left/touch pointer and clear stale gestures on blur/cancel/context loss. Preserve authority-only ownership and reward save-before-reveal.
2. Legibility: fit long localized effect text and hero names without clipping; clear introductory hand notice when a real selection needs board visibility. Keep unit click areas and hand size.
3. Motion: inspect normal-speed elemental/heal/shield/pack presentation, then make narrowly evidenced improvements to charge→flight→contact and readable effects. Do not reduce quality or change250ms gate.
4. Rebuild once after the first coherent batch, play through browser and retain original evidence; independent review and full local suite, meaningful unit/protocol checks. Document exact limits and remaining real-phone/public-network work.

## Evidence rules

- Code/Three geometry fixtures, real browser UI, continuous motion metrics, independent image review and publication are separate records.
- Existing official GitHub CI guards untouched; tests/local and playwright.local.config.mjs explicitly handle this authorized local path. No fake CI variables.
- No secrets, cookies, databases or saved browser profiles in committed evidence. dist/assets untouched; public services and main/base branches untouched.

## Completed local refinement

- Complete unmodified baseline28/29: original24 gameplay23/24,5 materials5/5; actual44px999 label overflow. Original cloud995ms failure not rewritten. Original local motion47ms under unchanged250ms.
- Fixed delayed long-hold selection, primary pack pointer ownership/cancel, same saved-batch canvas continuity across remote reveal dirty/ack, long hero name/numeric/float text bounds, stale introductory hand notice, first-frame dual-float lanes and original corner leaf stone texture. Existing timing/quality/authority/old save/assets kept. Three build entries and typecheck/check pass.
- Actual native Chrome and dedicated Codex browser manual actions covered camp/deck/save/matching/AI/English/card/details/wardrobe/pack. Final reload retained pack1/10, physical next-card click saved2/10, continued later and returned to connected camp; no final page console errors. Assisted manual game distinguished from automated real-browser complete match.
- Final full local run2026-10-10T06-00-44-822Z-b7d72d4e:33/33,zero retries/skips,all5 source integrity checks true, bundle b059f5bf1100fdaee258efac63508f466c035cdd6f9abdfde98f74f68d4678be. Native normal-motion max36ms/250; extra OS-native DPR2 window52ms,level0/pixel1/shadow1024. Before and candidate failures remain.
- Supplemental after-final3/3 (c49 pack continuous original canvas,mask0→1,maxPTS51ms); after-lanes1/1 covers spark/heal/shield/maxHP (final b059 PTS47/50/56/50ms). Independent source/5viewport/first-float/pack-frame review ready, no blocking findings.
- Final Node1144:1141pass/3fail/no skip,all3EADDRNOTAVAIL127.0.0.2 macOS real multi-IP cases. Original tests retained for Linux CI. Targeted scene/effect64 and local cleanup4pass separately.
- Dedicated local helpers have bounded cleanup and reliable server finally. Pack about:blank only after original game assertions/screenshots/diagnostics;5second close failure limit kept. First-name status metadata trim bug fixed locally. OfficialCI unchanged/no fake env.
- Durable reportdocs/LOCAL-PLAYTEST-2026-10-10.md and evidence/local-gpu-2026-10-10:13 archives/1213 original files, SHA readback checked;25 selected/manual screenshots/videos with separate hash manifest and responsive review.html. Internal Playwright error contexts/profiles/secrets/DB excluded. Intermediate safe reports selected, full originals retained locally.

## Remaining boundaries

- Physical-phone/public human matchmaking/low-end GPU/audio/long whole-session FPS and adaptive recovery under pressure unverified.320 far hero and short landscape units still small.
- Source delivery uses independent codex/local-gpu-refinement and a draft PR against codex/teacher-expansion-integrated; merge/public deployment require a separate user instruction.
