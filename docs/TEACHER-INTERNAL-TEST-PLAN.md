# Teacher academic-English internal test

Status: implementation candidate, not yet deployed or accepted.

This isolated branch starts at verified commit 84f8b18. It retains the existing 24 cards, combat 2.2, AI, rating, rituals, free rewards and school questions. It does not include the separate unfinished new-card, daily-task or hero-skin branch.

## Content

48 original questions: 12 academic vocabulary in context, 12 advanced grammar and usage, 12 complex-sentence comprehension and 12 short-reading questions across six original passages. The audience is teachers testing postgraduate academic English, not a promised standardized-exam score or a calibrated CEFR test. An author checks every item and a separate reviewer checks the single answer, distractors, naturalness and explanation.

Teacher content has the explicit bank ID `teacher-academic`. It is not a seventh school grade. Original 432 questions across grades 1–6 remain byte-for-byte unchanged. Teacher vocabulary/syntax topics do not require disciplinary trivia. New passages are authored for this project rather than reproduced textbook material.

## Access and persistence

The match preparation sheet switches between 小学英语 and 教师内测. School grade/course and teacher category selections are retained independently. Teacher study mastery uses its own question IDs; personal score views and pairing require the same bank and scope. The existing account, cards, cosmetics, combat rating and reward rules remain shared and unchanged. Switching content is not creating a second wallet or a second account.

The existing public browser site still runs computer opponents until a verified update is published. A teacher option in this site will not make public human matchmaking available. The Node authority implementation pairs teachers using the same teacher scope; it remains a separately tested server deployment path.

No prerecorded voice clips are being claimed for the new 48 items. Teacher questions are text-based; the UI explains this and does not show a usable audio button without an actual clip. Existing school audio remains intact.

## Acceptance

- Independently review all 48 prompts/options/answers/explanations; fix ambiguity before release
- Validate exact counts, unique IDs, balanced coverage and no private-answer leakage in network challenges
- Exercise all six original grade scopes, teacher-only matching, school/teacher separation and AI fallback
- Verify old-save compatibility, teacher mastery and score round trips, duplicate receipts and separate-account state
- Use a real browser to switch/reload/return to school, answer teacher questions and inspect 320px portrait and 844px landscape reading flows
- Keep options and navigation accessible via ordinary scrolling, without horizontal page overflow or obscured controls
- Run relevant Node/type/build checks, push a separate draft PR, and verify CI against that exact commit
- Inspect actual screenshots from the authorized GitHub browser environment, then publish the reviewed practice update through the existing supported process

Only new test evidence can close these checks. Earlier school-only acceptance does not prove the new teacher flow. Cloud viewport tests are not physical-phone testing; automated browser opponents are not two human teachers manually playing.
