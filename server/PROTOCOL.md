# Spellwood local online protocol v1

Server owner: backend task. Native browser WebSocket at same-origin `/ws`. HTTP `/health` supplies protocol/rules/content versions. Default host127.0.0.1 port4173; tests use port0. Static root `client-dist`, controlled public assets `/assets/*` from `dist/assets`. No source/question/old HTML endpoints.

## Identity and progress HTTP

The network UI first POSTs /api/identity/guest; the server supplies HttpOnly same-origin cookies. GET /api/identity/me confirms the current public identity. POST register/login/logout/recover/recovery-code require JSON and exact Origin. Names are ASCII letters, case-insensitive; passwords are at least6 Unicode characters. Registration upgrades the same guest playerId. Recovery uses a one-time-display code, revokes old sessions and rotates that code. Raw authentication secrets are never session.ready fields.

GET /api/progress returns {playerId,revision,data,receipt?}. POST /api/progress/preferences, participation, collection, legacy-import carry a stable requestId and only allowed intent fields. Every POST requires X-Spellwood-Player matching the cookie player; GET verifies it when present. A mismatch is409 PROFILE_CHANGED before any mutation. The server owns learning, match results, wallet totals, pack randomness and transaction receipts. progress.updated is a private notice to reload the owner's progress, with no other player's data. Schema3 client exports are not authoritative result submissions. Details: ../docs/IDENTITY-PROGRESS.md.

## Connect

Send `{type:"session.open", protocol:1}` or `{type:"session.resume", protocol:1, resumeToken:"..."}` as first message. `session.ready` returns sessionId, playerId, identityKind, current game name, resumeToken (new sessions only), nextClientSeq, connectionEpoch, protocol, ruleset, combatRules, contentVersion. Keep resumeToken only in tab sessionStorage; the token and cookie must belong to the same player. The same player has one active game session; takeover replaces the old connection. Resume returns room snapshot/pending challenge if present. Errors before auth are `{type:"session.error",code}`.

## All later commands

`{type, commandId, clientSeq, roomId?, expectedRevision?, payload:{...}}`

commandId: unique string for one intent, max64 characters. clientSeq starts at session.ready.nextClientSeq and increments for each authenticated well-formed command, even a semantic rejection. Retry a lost ACK with the exact same ID, sequence and payload. Never reuse an ID with changed payload. Server reply is `command.ack` with commandId, clientSeq, ok, code?, revision?, nextClientSeq. Rejecting a stale room revision also sends current snapshot; create a new command after resync. Malformed/sequence-gap commands do not advance the sequence and include nextClientSeq.

Commands:

- queue.join payload `{grade:1..6, course:"all"|"s1"|"s2"|"s1-u1"... ,deckId:"grove"|"ember"|"moon"|"custom",customDeck?:[cardId,...], ruleset:"net-1.1",combatRules:"2.2",contentVersion:"pep1-2026.1"}`. Versions may be omitted to use the advertised current values; supplied incompatible versions are rejected
- queue.cancel payload `{}`
- opening.choose `{indices:[0,2]}` with roomId and expectedRevision; 0–2 indices. Client-selected side is never accepted
- battle.action `{action:{type:"play",index:0,target?:"hero"|unitUID}}`, `{action:{type:"attack",uid,target}}`, or `{action:{type:"end"}}` with roomId and expectedRevision. Human `power` actions are forbidden
- ritual.begin `{kind:"insight"|"spark"|"bloom",target?:"hero"|unitUID}` with roomId and expectedRevision
- ritual.answer `{challengeId,optionId}` with roomId and expectedRevision; no `correct`/answer index
- room.resync `{}` with roomId, no expectedRevision needed
- room.reclaim `{}` with roomId and expectedRevision: request return from proxy at a safe boundary
- room.resign `{}` with roomId and expectedRevision

## Server events

queue.status: `{status:"waiting"|"cancelled",matchBy?,grade?,course?}`; no fake online counts.

room.snapshot also includes `state:{rules:"net-1.1",phase,active,turn,seq,winner,players:[seat0,seat1]}`, `event` and `resync`. Only the viewer’s players item has hand. `event` has eventId/revision/kind/actorSeat plus safe public action fields. A resync snapshot always has event:null and events:[], so do not replay past animations.

room.snapshot: fields roomId,revision,ruleset,combatRules,contentVersion,grade,course,mode:"pvp"|"pve",assisted,phase:"opening"|"playing"|"finished",youSeat:0|1,activeSeat,turn,serverTime,turnDeadline,openingDeadline,canAct,canAnswer,opening:{selfConfirmed,opponentConfirmed,maxChanges:2},self,opponent,events,result?.

self/opponent: seat,name,avatar,controller:"human"|"bot"|"proxy",connected,hp,armor,mana,maxMana,handCount,deckCount,board:[{uid,cardId,atk,hp,maxHp,ready,shield?:boolean}],fatigue,ritualUsed,ritualsLeft,ritualReserved. Only self has `hand:[cardId,...]` and `controlRequestPending:boolean`. The latter confirms a request to return from proxy control at the next safe own-turn boundary; it is not included for the opponent. During a pending challenge ritualsLeft is the available count after its reservation; the reservation consumes once on resolution/expiry. Opponent never has hand, deck, seed, questions or learning details.

Events are structured records `{eventId,revision,kind,actorSeat,...}`. They refer to absolute seats; translate to self/opponent using youSeat. Card plays include the now-public cardId. No drawn card identities or question content go into public events.

private.challenge: `{roomId,revision,challengeId,kind,target,expiresAt,question:{type,prompt,text,grade,unitLabel,options:[{id,text}],listenText,listenAudioUrl,visual}}`. q.id, answer, target word, explanation and answer audio are absent. Listen audio reads the prompt/options, not the answer; option reading order is reflected in `listenText`; optional listenAudioUrls is a complete per-option clip list in that same order. visual is null or a safe descriptor; renderer must not import the private target mapping.

private.feedback: `{roomId,revision,challengeId,outcome:"correct"|"wrong"|"unanswered",selectedOptionId?,correctOptionId?,questionId?,explanation?,speak?,audioUrl?,learning?}`. Only answered challenges return explanation/answer and learning. `learning` is `{qid,correct,answeredAt}` for private feedback; the server commits it before advertising saved status, and the client reads its receipt; do not overwrite old offline match. Timeout is unanswered with 1 armor, consumes one ritual, and emits no learning event.

room.finished is followed by/also represented in snapshot.result: winnerSeat:null|0|1,reason,rounds,mode,assisted and own learning totals. No full hidden-state reveal. Online results remain separate from legacy local challenge boards.

## Timers and ownership

Default matching10s, opening60s, turn150s. Starting a question gives at least120s to answer, once per turn. Question target is committed and all other actor actions are blocked while pending. There is no cancel-to-reroll command. Expiry yields1armor without a learning mistake. Turn timeout/disconnection leads to visible proxy control; bot opponents use autonomous rituals, human-seat proxy plays cards/attacks only. Reconnect grace20s; pending question retains its full deadline. Human control returns at a safe boundary, normally the next own turn if proxy actions already began. Both disconnected stops bot-v-bot work and room expires after5min. Completed room5min; absolute room/session TTL2h.

Snapshots are authoritative. Do not await animation before committing server state; cancel obsolete effects on a newer snapshot/reconnect. Heartbeats/presence do not change combat revision. Store only resume credentials in sessionStorage; no room/hand writes into legacy localStorage.

## Security/known boundary

Strict Origin/Host and frame/rate limits, one active socket per session, owner-bound commands, crypto private deck orders. Server remains the sole legality/answer authority. The pre-existing offline bank and textbook may be consulted; this is not complete anti-cheat or authenticated human identity.

## Explicit manual study HTTP API

GET /api/curriculum returns version/books/units and answer-free question metadata. GET /api/study/:qid issues one study challenge. POST /api/study/:qid/answer uses JSON {challengeId,optionId}, with same-origin Origin header, and returns private-style answer feedback. These are intentional study access, not hidden battle qid disclosure. Challenges expire in5min, repeated same answer is idempotent, changed second answer is rejected; answered learning is atomically saved for the cookie owner. The UI sends X-Spellwood-Player so an old page cannot answer or start study for a newly selected identity.

## Recovery and precise event notes

Resolved private.feedback records (at most4 per seat) are replayed on session resume and exact answer-command retry with the original challengeId/answeredAt plus replayed:true. Server atomically deduplicates learning by challengeId; client reads the same receipt and should not reopen an already-seen explanation. Room expiry deletes feedback and matching command receipts. A stale old retry never re-applies effects.

Healing/drawing ritual events target actorSeat; wrong/unanswered rituals target actorSeat with effect:"armor", regardless of the originally selected spell target. Public HP/armor deltas remain the display authority. Events contain no hidden draw identities.

Option IDs are always fresh. Option order is randomized when a complete matching safe prerecorded route exists; if not, the source option order may be retained to use its whole safe clip. The full speech index and answer-only audio are never sent before an answer.

Concurrent opening confirmations may both cite the original opening revision, because the other player's confirmation cannot change this player's hand. Already-confirmed seats and any later playing-phase retries are still rejected/idempotent as appropriate. Other gameplay mutations require exact current revision.

session.ready always includes roomId:null or a currently retained room ID, for both open and resume. An explicit null means the client must discard a stale live room/pending question (preserving already stored learning/history), even if it missed room.expired while offline. When non-null, the server immediately sends the owner's resync snapshot. Do not infer room absence from a temporary lack of a snapshot.


## Combat rules 2.2 and computer presets

The pool contains 24 cards. New cards can have one keyword: `barrier` means the first positive damage instance is blocked and clears `unit.shield`; retaliation still happens. `rally` adds one attack to other friendly units when played. Public change events include `shieldLost:true`, including when HP delta is zero. New spells use server-owned amounts. Clients may display `element` from the public card catalogue; it does not modify combat damage.

`queue.join` accepts `deckId:"custom"` only with exactly 20 string card IDs, at most three of each, from the current catalogue. Preset IDs reject a supplied `customDeck`. Protocol parsing and duel creation each validate; no card stats, ownership claims, rating, or difficulty can be supplied. Matchmaking keys remain rules/content/grade/course. The authoritative deck is copied at room creation. Construction and remaining order are not included in opponent snapshots. All base combat cards are available. Online cosmetic collection belongs to the authenticated progress record; it never changes card statistics.

PVE snapshots and results include `computer:{mode,level,name,description,opponentRating,deckPolicy,ritualLimit,ritualStartRound,ritualInterval,provisional,tutorial}`. The server selects a named preset from persisted combatRating/combatMode at room creation (a dedicated test/operator config can supply an explicit preset); changes apply only to later rooms. No client queue field can choose a server AI preset. PVP has no `computer` field, and disconnected-human proxies retain their existing policy.

- easy: fixed foundation deck; one-step creature/trade/attack policy; rituals from round 3, every other round, at most two uses
- standard: normal opponent deck; single-step state evaluation; up to four rituals
- tactical: normal opponent deck; existing multi-action lethal and survival planning; up to four rituals

All presets keep ordinary card values, starting HP, mana, hidden-information protection and four available ritual charges. A lower use limit is the computer's announced decision policy. It never examines answers or changes difficulty during a game. The server default is `level:"tactical",mode:"fixed"`; local practice can configure the next room from its separate local performance profile. `opponentRating` is a preset anchor, not a measured human rating or leaderboard rank.
