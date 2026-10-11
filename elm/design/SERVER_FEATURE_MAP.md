# Onyx Server ⇄ Onyx Elm — complete server feature map

Every client-reachable capability of the Onyx Server daemon, and whether the
Elm client (`elm/`, the product) supports it. This map drives the
"close all gaps" build wave. Prioritised gap list: **§22**.

- **Server:** `/home/kain/onyx-server` at version `0.7.0`
  (`build.zig.zon:18`). Read-only: `src/`, `docs/`, `build.zig*` only.
  Server citations are `path:line` relative to the server repo. Line numbers are
  current. The line numbers in `docs/reference/**` are out of date, so this map
  cites source.
- **Client:** branch `v3/docs` at HEAD `609cb240` (the live release). The map
  was written at `7e03d47f` on `v3/map-server`; about 250 commits and the
  `v3/gap-*` / `v3/rx-*` slices have landed since, and every status below was
  re-verified against HEAD (2026-10-11). Elm citations are relative to `elm/`
  (for example `src/App.elm:6238`); a `symbol:NNN` cite is a line in
  `src/App.elm` unless a path is given. Provenance tags such as `(v3/gap-auth)`
  name the slice that closed a gap.
- **Spec under audit:** `ONYX_SERVER_PROTOCOL.md` (repo root). §21 lists every
  place it disagrees with the server source.
- Generated 2026-10-10 at `7e03d47f`; refreshed 2026-10-11 against `609cb240` (every row re-verified from code, not from commit messages). Raids get one row (§17). PvP was out of scope by request.

## Legend

| Status | Meaning |
|---|---|
| **FULL** | Elm sends/handles it **and** a user can reach it from UI (button, panel, or a dedicated slash verb) and see the outcome. |
| **PARTIAL** | Partly wired; the row says exactly what is missing. |
| **CORE-ONLY** | A parser, fold or builder exists in Elm, but there is no UI trigger and/or no display. |
| **RAW** | No feature code. The user can still type the command because unknown slash verbs pass through raw (`sendRawSlashCommand`, `src/App.elm:12763`). Since v3/gap-shell the reply is not lost: it lands in the Activity sheet as a plain log line, and a `FAIL`/`WARN` also raises an inbox error (§0.1, §0.2). So a RAW command is usable by a power user who knows it, but it has no discovery (not in `/help` or autocomplete), no form, and no structured result. |
| **MISSING** | Nothing. |
| **N/A** | Server-internal, or the client has no use for it (reason given). |

Access column: `any` (also pre-registration), `reg` (registered client),
`acct` (logged-in account), `op`/`owner`/`founder` (channel tier), `oper[:priv]`
(network operator + privilege), `cfg:<feature>` (config-gated).

---

## 0. Read this first — cross-cutting findings

These findings cut across every table below. At `7e03d47f` each one hid or
broke many features at once. §0.1, §0.2 and most of §0.4 are **fixed at HEAD**;
the text keeps what was true then, marks what changed, and says what is still
open.

### 0.1 The reply sink (was invisible; fixed in v3/gap-shell)

At `7e03d47f` a server-origin `NOTICE` that no dedicated fold claimed went to
`logService` and a numeric with no arm went to `logNumeric`, both writing only
`model.serviceLog`, and **no view rendered `serviceLog`**. At HEAD:

- The routing is unchanged: an unclaimed server `NOTICE` → `logService`
  (`src/App.elm:26008`), an unclaimed numeric → `logNumeric`
  (`src/App.elm:10050`). Both write `model.serviceLog` (newest first, capped at
  500, `maxServiceLog` `src/App.elm:3504`).
- **New:** `settleStepGapShell` (`src/App.elm:11448`) → `stampActivity`
  (`src/App.elm:11463`) copies every new log line into `gapShell.activity` with
  a time and a kind (Problem / Connection / Notice, `GapShell.classifyEntry`
  `src/GapShell.elm:227`). The **Activity** sheet renders it
  (`View.GapShell.activitySheet` `src/View/GapShell.elm:57`) with an
  All / Problems filter and an unseen-problem badge. It opens from the rail
  "Activity" door and the You hub "Network activity"
  (`src/View/GapShell.elm:236`, `:352`; `GapShell.ActivityOpen`
  `src/App.elm:11255`). Tests: `GapShellTest`, `gapShell.smoke.mjs`.
- **New:** `logNumeric` also raises an inbox error row for every error-class
  numeric no fold claims (4xx, 5xx, 9xx except 900/901/903/908;
  `routeErrorNumeric` `src/App.elm:11075`).
- **New:** MOTD is collected (`startMotd` `src/App.elm:4876`, `finishMotd`
  `src/App.elm:4903`) and shown as a "From the network" card on Home, together
  with the onboarding WELCOME pack (`View.GapShell.motdCard`
  `src/View/GapShell.elm:543`, `src/View/Home.elm:119`).
- So the replies that are `noticeTo` NOTICEs (326 call sites in
  `src/daemon/server.zig`: `SEEN`, `MEMO LIST`, `HELP`, `LISTCHANS`, `STATS`,
  `MESH`, `WARD LIST`, `APPEAL filed`, `HOLD stored`, `UNFURL …`,
  `DEFER: scheduled`) are readable now: inside a feature surface where one
  exists (§5), otherwise as a timestamped line in Activity.
- **Still open:** Activity is one global 500-line log. A reply is not shown next
  to the command that caused it, has no structure (plain text), and the sheet
  has no search. `MOTD` has no manual re-request verb.

### 0.2 Unknown `FAIL`/`WARN` were dropped silently (fixed in v3/gap-shell)

`foldStandardReply` (`src/App.elm:24037`) still has dedicated arms for:

- `SESSION`, `MEDIA`, `E2EEGROUP`, `E2EEKEY`, `SEARCH`, `CHATHISTORY`
- `MEMO`(NOTE), `IDENTIFY`, `REGISTER`/`VERIFY`, `TOTP`, `RECOVERYCODES`
- `ACCOUNTINFO`, `ACCOUNTSET`, `RENAME`, `IDENTITY STALE_EPOCH`, `WEBAUTHN`
- a generic account arm for `ACCOUNTSET LOGOUT RECOVER DROP KEYTRANS CERT*`
  (`src/App.elm:24153-24198`)
- messaging `FAIL`s for `PRIVMSG NOTICE TAGMSG WHISPER` (`foldLabeledFail`
  `src/App.elm:35578`)

`CHANNEL`/`CS`/`SUCCESSOR` are consumed by the chanserv fold
(`settleStepChanserv` `src/App.elm:50651`), and three folds claim their lines
*before* `foldLine`: `foldAuthGateLine` (`src/App.elm:53473`: IDENTIFY with a
code, SETPASS, RESETPASS, 913), `foldLineUserModes` (`src/App.elm:47842`: MEMO,
AUTOJOIN, SILENCE, ACCEPT, 716-718, SETNAME …) and the operator folds
(`observeOperLines` `src/App.elm:20763`, desk only).

**Changed:** the default arm no longer returns `( model, [] )`. It calls
`foldUnknownStandardReply` (`src/App.elm:11092`, called at `:24207`): a
`FAIL`/`WARN` becomes an inbox error row "`<CMD> failed: <text> (<CODE>)`" plus
an Activity line, and a `NOTE` goes to Activity. So `FAIL PINS`, `EDIT`,
`REDACT`, `VHOST`, `GHOST`, `RELEASE`, `SESSIONTOKEN`, `NAMES`, `WHO`,
`MARKREAD`, `ACCESS`, `BATCH`, `WEBPUSH` … all surface now, with the server's
own text rather than tailored copy (§15 lists which have specific copy).

### 0.3 Raw passthrough is power-user only

- Any unknown `/verb a b c` goes out as `VERB a b c` (`sendRawSlashCommand`,
  `src/App.elm:12763`). `/quote` sends a raw line (`src/App.elm:15658`,
  `planSlash` arm `src/App.elm:13216`).
- Multi-word trailing text needs an explicit `:` (for example
  `/memo send alice :hi there`), because `Wire.formatIrcLine` only adds the
  colon to a last param that contains a space (`src/Wire.elm:623`).
- **New (v3/gap-commands):** raw content verbs (`PRIVMSG`, `NOTICE`, `MSG`,
  `QUERY`, `ME`, `EDIT`, `WHISPER`, `MEMO SEND` …) are refused when the
  destination is an encrypted conversation, so a raw line cannot bypass sealing
  (`rawContentDestination` `src/App.elm:52129`, copy `rawSlashLeakCopy`).
- **Changed:** because of §0.1 and §0.2 the reply is now visible (Activity, or
  an inbox error for a failure), so these commands "work" for someone who knows
  them. They are still undiscoverable: not in `/help` or autocomplete
  (`slashCommands` `src/App.elm:15634`), no forms, no structured results.


### 0.4 Defects found while mapping (server behaviour vs Elm code)

Status at HEAD: D1-D7 and D9 are **fixed** (the tag names the slice); **D8** is still open; **D10** is a new server-side defect found by v3/gap-oper. The defect and server columns keep the 7e03d47f text; the Elm column describes HEAD.

| # | Defect | Server evidence | Elm evidence |
|---|---|---|---|
| D1 | **FIXED (v3/gap-auth).** **Change password is broken.** Elm sends `ACCOUNTSET <acct> <pw> password <new>`. The server accepts only `email\|flags\|secure\|enforce` and answers `FAIL ACCOUNTSET INVALID_FIELD`. The correct verb is `SETPASS <current> <new>`. | `src/daemon/server.zig:47152-47179`; `SETPASS` `src/daemon/server.zig:44617` | `requestAccountSetPassword` `src/App.elm:30821` now builds `SETPASS <current> <new>` with `Services.setPass` (`src/Services.elm:918`), stages the new password ports-side, and finishes on the SETPASS success NOTICE or `FAIL SETPASS` (`AuthGate.setPassNotice`/`setPassFailCopy` `src/AuthGate.elm:1179`, `foldAuthGateLine` `src/App.elm:53473`). Tests: `AuthGateTest`, `authGate.smoke.mjs`. |
| D2 | **FIXED (v3/gap-auth).** **A 2FA account can no longer sign in from Elm.** With TOTP active, PLAIN/SCRAM SASL fails with `904 :Two-factor authentication required: log in with IDENTIFY <account> <password> <code>`. Elm's connect gate uses SASL only and fails closed on 904. It has no IDENTIFY-with-code path. The cap `onyx/2fa=IDENTIFY` advertises this, and Elm ignores it. | `src/daemon/dispatch.zig:2048-2058`; cap `src/daemon/dispatch.zig:433` | The 904 "Two-factor" refusal is claimed in `foldAuthGateLine` (`src/App.elm:53482`) before the SASL failure path; `AuthGate.onTwoFactorRefused` (`src/AuthGate.elm:774`) opens a code step (`View/AuthGate.elm:331 twoFactorPanel`), the gate dials a plain `Guest#####` connection and ports.js composes `IDENTIFY <acct> <password> <code>` (the password never enters Elm state). It reacts to the 904 text, not to the `onyx/2fa` cap value. Test: `authGate.smoke.mjs`. |
| D3 | **FIXED (v3/gap-auth).** **Elm cannot get past a pre-001 CHALLENGE.** When `[challenge]` is enabled and the raid shield is engaged on *any* channel, or the source IP has bad reputation, registration is held. The server sends `NOTICE CHALLENGE pow <hex-seed>` (solve: `Blake3(seed‖answer)[0]==0`) or `CHALLENGE question <text>`. The client must answer `CHALLENGE <answer>`. Elm never answers, so new connections hang during a raid. | `challengeRequired` `src/daemon/server.zig:17437`; `armChallengeHold` `:17448`; `noticeChallenge` `:17464`; PoW `src/daemon/challenge.zig:47-55` | Pre-001 `NOTICE CHALLENGE …` is parsed by `AuthGate.parseChallengeNotice` (`src/AuthGate.elm:576`, `authGateNotice` `src/App.elm:53568`, pre-001 only). The proof of work is solved in `ports.js:2114 solveChallengePow` (BLAKE3, in slices so the page stays responsive) and answered with `CHALLENGE <answer>` (`AuthGate.challengeAnswerLine` `src/AuthGate.elm:1074`); a `question` shows a prompt (`View/AuthGate.elm:240 questionPanel`); `failed`/`wait` give an honest stop. Tests: `challenge.smoke.mjs` (official BLAKE3 vectors), `authGate.smoke.mjs`. |
| D4 | **FIXED (v3/gap-auth).** **Custom status never reaches the server.** Elm sends `PROP * STATUS <text>`. A user PROP needs the entity to equal your own nick, so `*` gets `913 ERR_NOACCESS`, which then landed in the (then invisible) log. | `propAccess` `src/daemon/server.zig:39768-39782` | `setCustomStatus` `src/App.elm:23240` now sends `PROP <ournick> STATUS <text>`; a 913 shows a "Your status wasn't saved" toast and `statusError` (`authGateNoAccess` `src/App.elm:53771`). |
| D5 | **FIXED (v3/gap-oper).** **The oper live Event Spine feed is discarded.** Live oper events arrive as `@onyx_server.io/category=FLOOD;…severity=warn :srv EVENT <oper> FLOOD …`. `Spine.foldEventLine` re-dispatches only the `MEDIA` and `WEBAUTHN` planes. It ignores every category body, `OBSERVE` push, `AUDIT` row and `EVENT BROADCAST`. Only `EVENT REPLAY JSON`, which opers must pull, is shown. | `renderEventTagged` `src/daemon/event_spine.zig:482`; delivery `src/daemon/server.zig:55973-55997` | `Spine.foldEventLine` (`src/Spine.elm:699`) now returns `EventAsFeed` for category events, OBSERVE pushes, ANNOUNCE broadcasts and AUDIT rows (`OperFeed.parseEvent`); `foldEvent` (`src/App.elm:8875`, arm `:8904`) hands them to `OperConsole.observeEvent`, and the Live tab renders them (`View/OperFeedPanel.elm:134 feedPanel`; bounded 400-row ring, low-severity rate limit, repeat collapse). Tests: `OperFeedTest`, `SpineTest`. |
| D6 | **FIXED (v3/gap-shell).** **Disconnect reasons are hidden.** `ERROR :<reason>` went to the (then invisible) log. Covered reasons: Excess Flood, K-line/Ward, Killed, Ghosted, raid ban, reputation, too many connections, draining, ping/registration timeout. The `KILL` line has no arm. | ERROR sites `src/daemon/server.zig:9776,9834,11709,11724,11744,17689,22262,25000` | `ERROR` arm `src/App.elm:5361` → `foldServerError` (`src/App.elm:10708`) and `KILL` arm `:5368` → `foldKill` (`src/App.elm:10776`): an inbox row, the reason on the reconnect banner / connect gate (`gapShellBanner` `src/App.elm:11183`), and auto-reconnect stops for bans, kills, ghosting, "Closing Link" and "access denied" (`GapShell.closeReason`/`isFatalClose` `src/GapShell.elm:387`, `:421`). Tests: `GapShellTest`. |
| D7 | **FIXED (v3/gap-chanserv).** **"Delete room" sends `CHANNEL DROP`, but Elm never registers rooms.** The DROP therefore fails with `FAIL CHANNEL CHANNEL_UNKNOWN`/`ACCOUNT_REQUIRED`, which was dropped (§0.2 at `7e03d47f`). Only the PART takes effect. | `handleChannel` `src/daemon/server.zig:47370` | `requestStewardDeleteRoom` `src/App.elm:24747` → `chanservBeginDelete` (`src/App.elm:50849`): `CHANNEL INFO` first, `DROP` only for a registered room (`src/Chanserv.elm`). (The doc comment above `requestStewardDeleteRoom` still says "`CHANNEL DROP` plus the goodbye PART".) |
| D8 | **Mesh `SESSION REDIRECT: session lives on <node>; reconnect there to reclaim` is not handled.** It only reaches the Activity log, and the reclaim banner never learns the target node. | `src/daemon/server.zig:49447`, `:49634` | no `REDIRECT` match in `src/App.elm`, `src/Session.elm`, `src/Wire.elm` or `src/GapShell.elm` at HEAD. **Still open.** The line is no longer silent (it reaches Activity as a plain log line, §0.1) but the reclaim banner still never learns the target node. |
| D9 | **FIXED (v3/gap-shell for 477/480/489/520; v3/gap-chanserv for 470).** **Error numerics for `+S`/`+O`/`+A` joins are silent.** `489 ERR_SECUREONLYCHAN` and `520 ERR_OPERONLYCHAN` have no arm, so the user sees the join silently fail. | `joinDenied` `src/daemon/server.zig:22401-22418` | `foldJoinDenied` `src/App.elm:11143` (v3/gap-shell) answers 477/480/489/520 on the join prompt (arms `src/App.elm:6080-6098`); 470 is explained by `chanservForwarded` `src/App.elm:50807` (arm `:6100`, v3/gap-chanserv). |
| D10 | **SERVER: `WARD ADD country <CC>` can never succeed.** The broad-pattern guard counts a two-letter country code as under three literal bytes and answers `WARD: pattern too broad (needs more literal characters)`. Found by v3/gap-oper. | `src/daemon/oper_cmd.zig:574-577` (`wildcard_limit.isTooBroad`, `Policy.channel_ban` `min_non_wildcard = 3`, `src/proto/wildcard_limit.zig:54`) | `OperPlan` lets the daemon answer for `address`/`country` facets (`src/OperPlan.elm:845`); the desk shows the daemon's refusal |

### 0.5 Scorecard

Over the 143 rows of the §5 command catalog (aliases grouped, so this is not a
raw command count). The HEAD column is counted by script from the tables in
§5 (the first bold status of each row), not estimated.

| Status | At `7e03d47f` | At HEAD `609cb240` |
|---|---|---|
| FULL | 38 | 81 |
| PARTIAL | 24 | 27 |
| CORE-ONLY | 7 | 3 |
| RAW (typed verb only; the reply shows in Activity) | 57 | 25 |
| MISSING | 13 | 3 |
| N/A | 4 | 4 |

- **Strong:** messaging, IRCv3 chat semantics, sessions/reclaim, sign-in
  (two-step, passkey, forgot password, pre-001 challenge), the account security
  panel and names/protection, channel services and every channel mode, user-mode
  privacy and caller-id, offline messages, voice calls, bans, ACCESS, webhooks,
  stats and the operator console (Live feed, bans, silence, abuse, appeals,
  content, network).
- **Weak (still RAW, MISSING or PARTIAL):**
  - server info verbs: `VERSION`, `TIME`, `ADMIN`, `INFO`, `DIRECTORY`, `USERS`,
    `LINKS`, `MAP` (typed verb only)
  - the operator long tail: `FORCE*`, `SUMMON`, `RESV`/`JUPE`/`SACCESS`,
    `GRANT`/`REVOKE`, `TRACE`, `DEBUG`, `CLOSE`, `UPGRADE`/`DIE`/`RESTART`,
    `COMMANDS`/`OROWASM`, `BOTGRANT`/`OUTHOOK`, `GEOIP`
  - calls: `HAND`/`QUEUE`, `CONSENT`/`RECORD`, `CAPTION` send, `TRANSCRIPT`
  - room-op extras: `CHANBADWORDS`, clone-`CREATE`, `RENAME`, tier keys,
    `RETAIN`, the `HOLD` setting, sealed rooms, a stand-alone `CLEAR`
  - protocol: mesh `SESSION REDIRECT` (D8), netsplit batches, the message bot
    badge, SCRAM-SHA-512 / OAUTHBEARER / SESSION-TOKEN, `SESSIONTOKEN`,
    WebTransport, `DATA`/`REQUEST`/`REPLY`, `LISTX`, ISUPPORT hygiene

---

## 1. Transport, registration and handshake

| Item | Server evidence | Behaviour / replies | Access | Elm | Elm evidence / notes |
|---|---|---|---|---|---|
| WebSocket transport | `src/proto/websocket.zig`, `src/proto/permessage_deflate.zig`; frames handled in `src/daemon/server.zig:17410-17432` | One IRC message per frame, no CRLF. Ping/pong/close control frames. Binary frames carry Cadence media datagrams (`handleWsMediaDatagram` `src/daemon/server.zig:53961`). | any | **FULL** | `src/Wire.elm` `splitWireFrame`; ports.js socket; `mediaBinarySend` ports |
| WebTransport (HTTP/3 `/wt`) | `src/daemon/webtransport_listener.zig:1-20` (QUIC+H3+WT, proxied to the IRC listener) | Alternative browser transport | any | **MISSING** | `grep -i webtransport ports.js src/` → none |
| STS policy cap | `src/daemon/dispatch.zig:418-425` (`requires_policy`) | `sts=duration=…,port=…` only when configured | any | **N/A** | Deliberately not requested (`src/Session.elm:657-668`); browser uses wss |
| PASS | `src/daemon/dispatch.zig:1842` | Recorded only, not validated | any | **N/A** | Not sent |
| NICK (pre-reg) | `src/daemon/dispatch.zig:1854` | NICKLEN/control checks. Account-owned nicks need SASL. Errors 432/433/437. | any | **FULL** | `WsOpened` → NICK (`src/App.elm:40921`); nick alias rotation `src/App.elm:10556-10627` |
| USER | `src/daemon/dispatch.zig:1874` | 4 params | any | **FULL** | `src/App.elm:40922` |
| CAP LS/REQ/LIST/END (NEW/DEL never fire) | `src/daemon/dispatch.zig:1891` | 410 for bad subcmd | any | **FULL** | `foldCap` `src/App.elm:10297` (LS/ACK/NAK/NEW/DEL) |
| AUTHENTICATE | `src/daemon/dispatch.zig:1918-2075` | 900/903/904/905/906/907/908 | any (pre-reg, cap sasl) | **PARTIAL** | PLAIN/SCRAM-SHA-256/EXTERNAL only (`beginSasl` `src/App.elm:10196`, `foldAuthenticate` `:10222`). No SCRAM-SHA-512, SESSION-TOKEN, OAUTHBEARER or ANONYMOUS. A 2FA account is refused with 904 and finishes through `IDENTIFY` with a code (D2, fixed v3/gap-auth); sign-in failure copy comes from `GapShell.classifySasl` (`src/GapShell.elm:292`). |
| PING / PONG | `src/daemon/dispatch.zig:2163,2172`; registered PONG `src/daemon/modules/feature_misc.zig:90` | 409 no origin | any | **FULL** | `src/App.elm:5329-5340`; keepalive ports (`pingKeepalive.smoke.mjs`) |
| QUIT | `src/daemon/modules/user_query.zig` → `handleQuit` `src/daemon/server.zig:59893` | Records WHOWAS/SEEN; nick-delay hold | any | **FULL** | `SessionDisconnect`/Leave |
| Welcome burst 001-005 | `src/daemon/dispatch.zig:2216` | 001 welcome text, 002 yourhost, 003, 004 myinfo, 005 | — | **FULL** | 001 `src/App.elm:5372`, 004 `:4944`, 005 `:4929`. 002/003 (and the other numerics no fold claims) are logged and shown in Activity (§0.1). |
| Post-welcome LUSERS + MOTD | `handleLusers` `src/daemon/server.zig:42489`, `handleMotd` `:42649` | 251-255/265/266/250; 375/372/376 | — | **FULL** | LUSERS → home stats (`foldLusers` `src/App.elm:22913`). MOTD is collected (`startMotd` `src/App.elm:4876`, `finishMotd` `:4903`) and shown on Home as "From the network" with a dismiss (`View/GapShell.elm:543 motdCard`, `View/Home.elm:119`; v3/gap-shell). No manual `/motd` verb. |
| Connect-time GeoIP metadata | `setGeoLocation` `src/daemon/server.zig:39078` | Sets own METADATA `location`, `country` | — | **CORE-ONLY** | Elm folds METADATA generically (`foldMetadataCommand` `src/App.elm:9829`). There is no UI for location. |
| Pre-001 CHALLENGE (PoW / question) | `src/daemon/server.zig:17437-17540`; `src/daemon/challenge.zig` | `NOTICE CHALLENGE pow <seed>` \| `CHALLENGE question <q>`; answer `CHALLENGE <answer>` → `CHALLENGE failed\|wait\|not required` | any (pre-reg) | **FULL** | v3/gap-auth (D3): `AuthGate.parseChallengeNotice` `src/AuthGate.elm:576`; `pow` solved in `ports.js:2114 solveChallengePow` and answered `CHALLENGE <answer>`; `question` prompt `View/AuthGate.elm:240`; `failed`/`wait` end in an honest stop. Tests `challenge.smoke.mjs`, `authGate.smoke.mjs`, `AuthGateTest`. |
| `REGISTER` before 001 | `src/daemon/server.zig:17744` | `FAIL REGISTER COMPLETE_CONNECTION_REQUIRED` | — | **N/A** | Elm registers after 001 (guest-claim) |
| `APPEAL` before 001 | `src/daemon/server.zig:17759` (pre-reg route) | Banned users may file without registering | any | **FULL** | v3/gap-oper: the connect screen's "Appeal a ban" (`View/Appeal.elm:55 appealButton`, sheet `:28`) saves the text (`OperConsole.SendUserAppeal` `src/OperConsole.elm:737`) and `WsOpened` sends it ahead of the handshake (`settleStepOper` `src/App.elm:20709`); in-app `/appeal` (`runSlashAppeal` `src/App.elm:20587`) sends at once. `APPEAL filed <id>` / "already filed" show in the sheet (`src/OperConsole.elm:1616`). Test `AppealTest`. §5.7 APPEAL. |
| `draft/pre-away` AWAY before 001 | `src/daemon/server.zig:17733` | Away applied before welcome | any | **MISSING** | Cap is requested, but Elm never sends AWAY pre-001 |
| `SESSION RESUME` gate | `src/daemon/server.zig:17843-17849` | `FAIL SESSION RESUME_PENDING` until resume completes | — | **FULL** | `maybeSendSessionCommands` `src/App.elm:20226` |
| Registration refusal `ERROR`s | `src/daemon/server.zig:9776` (reg timeout), `:11709` (draining), `:11724` (reputation), `:11744` (too many connections), `:22262` (SACCESS) | Socket closes | any | **FULL** | v3/gap-shell (D6): `foldServerError` `src/App.elm:10708` puts the reason on the connect gate / reconnect banner (`gapShellBanner` `src/App.elm:11183`), and a ban, kill, ghosting or "Closing Link" stops the reconnect loop (`GapShell.isFatalClose` `src/GapShell.elm:421`). |
| Labeled-response / ACK | `src/daemon/server.zig:17908-17952`; `src/proto/labeled_response.zig` | Single line, BATCH, or bare `ACK` | reg | **FULL** | `src/App.elm:6258` (ACK); label stamping `src/Labels.elm` |
| Multiline inbound | `routeMultiline` `src/daemon/server.zig:17903`; cap value `max-bytes=40000,max-lines=64` | `BATCH +ref draft/multiline <target>` | reg | **FULL** | `src/Multiline.elm`; send gate `src/App.elm:12215` |

## 2. IRCv3 capabilities (live table `src/daemon/dispatch.zig:315-435`)

Elm requests every advertised cap except `tls`, `sts`, `sasl` (without
credentials), `no-implicit-names`, `draft/file-upload` and `bot`
(`Session.wantedCaps`, `src/Session.elm:657-668`).

| Cap (value) | Server effect | Elm |
|---|---|---|
| `server-time` | `time=` tag | **FULL** (`serverTimeMsOf`) |
| `message-tags` | Client tag relay; server tags `msgid`, `account`, `bot`, `time` | **FULL** |
| `echo-message` | Own messages echoed | **FULL** (`isLiveSelfEcho`, label correlation) |
| `sasl=<per-connection list>` | Built by `writeSaslCapValue` `src/daemon/dispatch.zig:1531` (PLAIN, EXTERNAL, SCRAM-SHA-256, SCRAM-SHA-512, SCRAM-SHA-512-PLUS, SESSION-TOKEN, OAUTHBEARER, ANONYMOUS when live) | **PARTIAL** (3 mechanisms, §4) |
| `multi-prefix` | All prefixes in NAMES/WHO | **FULL** (`Wire.parseNamesPrefix`) |
| `userhost-in-names` | `nick!user@host` in 353 | **FULL** |
| `away-notify` | AWAY broadcasts | **FULL** (`"AWAY"` arm `src/App.elm:6190`) |
| `setname` | SETNAME broadcasts | **FULL** (v3/gap-usermodes): inbound `foldSetname` `src/App.elm:6379`; outbound `SETNAME :realname` from the self card (`UserModes.setnameLine` `src/UserModes.elm:813`, `View.UserModes.selfNameRow` `src/View/UserModes.elm:938`) |
| `extended-join` | Account/realname on JOIN | **FULL** |
| `invite-notify` | INVITE fan-out to ops | **FULL** (`foldInvite` `src/App.elm:28690`) |
| `account-tag` | `account=` tag | **FULL** |
| `onyx/session-sync` | Sibling mirroring; server-driven rejoin | **FULL** (`rejoinLiveChannels` `src/App.elm:26347`) |
| `onyx/bouncer` | Automatic rewind on (re)join | **FULL** (msgid dedup) |
| `onyx/topics` | `+onyx/topic=<label>` tag; topic-filtered CHATHISTORY | **FULL** (`src/TopicRead.elm`, `topicMessageTag`) |
| `onyx/e2ee` | `+onyx/e2ee` tag; required rooms reject plaintext | **FULL** (`src/App.elm:15419`, `:47308`) |
| `chghost` | CHGHOST lines on vhost change | **CORE-ONLY** (consumed silently, `src/App.elm:6290-6296`) |
| `no-implicit-names` / `draft/no-implicit-names` (same id) | Suppresses NAMES on JOIN | **FULL**: the draft token is requested and Elm then sends NAMES itself (`namesAfterSelfJoin` `src/App.elm:26293`) |
| `draft/chathistory` | CHATHISTORY | **FULL** (§5.3) |
| `draft/search` | SEARCH | **FULL** (`src/App.elm:36166-36290`) |
| `draft/message-redaction` | REDACT | **FULL** |
| `draft/message-editing` | EDIT | **FULL** |
| `draft/read-marker` | MARKREAD | **FULL** |
| `draft/event-playback` | Events in history replay | **FULL** (`divertReplayEvent`) |
| `draft/typing` / `draft/react` / `draft/reply` | TAGMSG client tags | **FULL** |
| `batch` | chathistory, netsplit, netjoin, labeled-response, multiline batches | **PARTIAL**: chathistory/multiline/labeled handled (`src/App.elm:36666-36678`); netsplit/netjoin batches are not summarised (QUITs fold one by one) |
| `bot` | Bot flag/tag | **PARTIAL**: not requested; the WHOIS 335 badge works (`src/View/Profile.elm:86-88`); no per-message bot tag display |
| `draft/channel-rename` | Native RENAME (else PART+JOIN) | **PARTIAL**: inbound `foldRename` `src/App.elm:32611`; no outbound RENAME |
| `extended-monitor` | AWAY/SETNAME/CHGHOST/ACCOUNT for MONITOR targets | **FULL** (routed through the normal folds) |
| `account-notify` | ACCOUNT lines | **FULL** (`src/App.elm:5732`) |
| `draft/account-registration=custom-account-name` | REGISTER live | **FULL** (guest claim) |
| `draft/metadata-2` | METADATA GET/LIST/SET/CLEAR | **PARTIAL** (§12) |
| `standard-replies` | FAIL/WARN/NOTE | **FULL**: specific arms for the commands Elm drives, and every other `FAIL`/`WARN` becomes an inbox row (§0.2, v3/gap-shell) |
| `cap-notify` | Static set, no NEW/DEL | **FULL** |
| `labeled-response` | §1 | **FULL** |
| `draft/pre-away` | AWAY before 001 | **CORE-ONLY** (requested, never used) |
| `draft/channel-context` | `+draft/channel-context` tag relay | **MISSING** (`grep channel-context src/` → none) |
| `draft/multiline=max-bytes=40000,max-lines=64` | §1 | **FULL** |
| `sts` | §1 | N/A |
| `account-extban=a` | `$a` bans | **FULL** (ban builder `src/View/Bans.elm:217`) |
| `utf8-only` | UTF-8 enforced | **FULL** (Elm emits UTF-8) |
| `draft/netsplit` / `draft/netjoin` | Typed netsplit/netjoin BATCHes | **CORE-ONLY** (requested; batch type not interpreted) |
| `onyx/2fa=IDENTIFY` | Signals that 2FA accounts must log in via IDENTIFY | **FULL** (v3/gap-auth): the behaviour is reached from the 904 refusal text, not from the cap value (`foldAuthGateLine` `src/App.elm:53473`, D2) |

## 3. ISUPPORT (005)

Static list: `src/proto/protocol_inventory.zig` `isupport_tokens`. Dynamic
overrides plus PREFIX/STATUSMSG/MODES/NETWORKICON/VAPID/ACCOUNTRESIDENCE:
`buildIsupportTokens` `src/daemon/server.zig:1901-1975`. Elm parses only
`ACCOUNTRESIDENCE CASEMAPPING CHANLIMIT CHANMODES CHANTYPES IRCX MAXCHANNELS
MODES NETWORK NICKLEN PREFIX SILENCE STATUSMSG TOPICLEN VAPID`
(`src/Isupport.elm`).

| Token (default) | Meaning | Elm |
|---|---|---|
| `IRCX` | Speaks IRCX; Elm sends `IRCX` on 001 | **FULL** (`src/App.elm:5467`) |
| `NETWORK=` (`[network] name`) | Network name | **FULL** |
| `CHANTYPES=#&` | | **FULL** |
| `NICKLEN=64` | | **FULL** |
| `TOPICLEN=390` | | **FULL** |
| `AWAYLEN=256`, `KICKLEN=307`, `CHANNELLEN=64`, `KEYLEN=64` | Length caps | **MISSING** (not parsed; Elm uses fixed bounds) |
| `MAXLIST=beIZ:100` | List-mode cap | **MISSING** |
| `CHANLIMIT=#&:50` | | **FULL** |
| `MAXTARGETS=4` | | **MISSING** (Elm never multi-targets) |
| `MONITOR=128` | | **MISSING** (Elm uses its own contact cap) |
| `SILENCE=32` |  | **FULL** (v3/gap-usermodes): read as the server block-list limit (`silenceLimit` `src/App.elm:47811`, `UserModes.silenceFull` `src/UserModes.elm:699`, `View/UserModes.elm:745 serverBlocks`) |
| `CHATHISTORY=64` | Per-request cap | **MISSING** (Elm uses a fixed `historyPageSize`) |
| `ELIST=CMNTU`, `SAFELIST` | LIST filters | **MISSING** (Elm sends a bare LIST) |
| `EXCEPTS=e`, `INVEX=I` | | **MISSING** |
| `MAXPROP`, `MAXACCESS`, `MAXCODEPAGE=0`, `MAXLANGUAGE=0` | IRCX limits | **MISSING** |
| `CASEMAPPING=ascii` | | **FULL** |
| `CHANMODES=beIZ,k,lfj,imnstCTNgSMWOAphuadErzxwVUFD` | Derived at comptime from `chanmode.default_specs` + Z/f/j + every `chanmode_ext` flag except `f` (`src/proto/protocol_inventory.zig` `deriveChanmodes`; test `src/daemon/isupport_advertise.zig:10-42` asserts `x`) | **FULL** (data-driven `Modes.parseChanGroups`) |
| `BOT=B` | | **MISSING** (not parsed) |
| `EXTBAN=$,acgmrz` | | **PARTIAL**: Elm hard-codes the types (`Modes.parseExtBan`) and also offers `$o`, which is not advertised |
| `WHOX`, `UTF8ONLY` | | N/A |
| `PREFIX=(YQqov)*!.@+` | `chanmode.MemberModes.isupport_prefix` (`src/daemon/chanmode.zig:405`) | **FULL** |
| `STATUSMSG=!.@+` | `src/daemon/chanmode.zig:411` | **FULL** (`Isupport.statusmsgChannel`, composer audiences) |
| `MODES=<[limits] modes_per_line, default 4>` | | **CORE-ONLY** (parsed; Elm sends one mode per line anyway) |
| `NETWORKICON=<url>` (optional) | | **MISSING** |
| `VAPID=<key>` (optional) | Web Push key | **FULL** (`src/Push.elm`) |
| `ACCOUNTRESIDENCE=<16-hex>` (optional) | `IDENTITY RESIDENCE` binding | **FULL** (`src/Attribution.elm`) |

## 4. SASL and login mechanisms

| Mechanism / path | Server | Elm |
|---|---|---|
| PLAIN | `src/proto/sasl.zig`, `src/daemon/dispatch.zig:1918` | **FULL** (a 2FA account is refused by the server and continues through `IDENTIFY` with a code, D2, v3/gap-auth) |
| SCRAM-SHA-256 | `src/proto/sasl_scram_server.zig` | **FULL** (WebCrypto in ports.js) |
| SCRAM-SHA-512 / -512-PLUS | `src/proto/sasl_scram512_server.zig` | **MISSING** |
| EXTERNAL (client cert) | `src/proto/sasl_external*.zig` | **CORE-ONLY**: selectable, but a browser cannot present a client cert over wss in practice |
| SESSION-TOKEN (`sst_…` from `SESSIONTOKEN`) | `src/daemon/server.zig:45058` | **MISSING** (Elm reclaims with `SESSION RESUME` instead) |
| OAUTHBEARER | `src/proto/sasl_oauthbearer.zig`, `src/daemon/oauth_jwt.zig` | **MISSING** |
| ANONYMOUS | `src/proto/sasl_anonymous.zig` | **MISSING** (Elm guests use plain NICK) |
| IRCX `AUTH <package>` | `handleIrcxAuth` `src/daemon/server.zig:41063` | **MISSING** |
| `IDENTIFY <acct> <pw> [code]` (works for 2FA) | `handleIdentify` `src/daemon/server.zig:44434` | **FULL** (v3/gap-auth): used by guest claim and reclaim (`requestIdentify` `src/App.elm:32092`) and by two-step sign-in, where a plain guest connection sends `IDENTIFY <acct> <pw> <code>` composed ports-side (`AuthGate.onTwoFactorRefused` `src/AuthGate.elm:774`, `View/AuthGate.elm:331`) |
| Passkey login `WEBAUTHN AUTH`/`AUTH-FINISH` | `src/daemon/server.zig:46942-47000` | **FULL** (v3/gap-auth): "Sign in with a passkey" on the connect screen (`View/AuthGate.elm:661 signInLinks`, `passkeyPanel` `:388`) dials a guest connection and runs `Passkey.webauthnAuth` (`src/Passkey.elm:339`) / `webauthnAuthFinish` (`:382`) (`src/App.elm:53373`) |
| Recovery-code login `RECOVERYCODES LOGIN` | `src/daemon/server.zig:28358` | **FULL** (connect gate, `requestRecoveryCodesLogin` `src/App.elm:31577`) |

## 5. Command catalog (every registered command)

All commands live in `src/daemon/modules/*.zig` (SerpentRegistry, manifest
`src/daemon/modules/manifest.zig:26-39`). Dispatch gates:

- too few params → `461`
- `.access=.oper` → `481`
- `.access=.registered` → `451`
- feature disabled → `421`

Sources: `src/daemon/server.zig:18061-18079`. Handshake verbs fall through to
`src/daemon/dispatch.zig:1821` (`command_table`). Loaded OroWasm plugins can add
commands after a registry miss (`src/daemon/server.zig:18083-18107`).

Module line = registration site. Handler = `src/daemon/server.zig` unless noted.

### 5.1 `query.info` (`src/daemon/modules/query_info.zig`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| VERSION | `query_info.zig:74` / `handleVersion:42740` | → 351 + 005 | reg | **RAW** | Elm never sends VERSION. It reads the 004 version (`src/App.elm:4944`). `"VERSION"` in `src/App.elm:7839` is the CTCP reply. |
| TIME | `:75` / `handleTime:42718` | → 391 | reg | **RAW** | `src/App.elm:7842` is CTCP TIME, not this command |
| ADMIN | `:76` / `handleAdmin:42727` | → 256/257/259 | reg | **RAW** | — |
| INFO | `:77` / `handleInfo:57182` | → 373/371…/374 (limits, classes, nick-delay, peers) | reg | **RAW** | — |
| DIRECTORY | `:78` / `handleDirectory:57251` | → 371 lines: listing flag, node, rank inputs, heatline | reg | **RAW** | `foldDirectoryNotice` (`src/App.elm:25128`) is the **E2EE device directory**, not this command |
| MOTD | `:79` / `handleMotd:42649` | → 375/372/376 (template with `{weather}`/`{news}` placeholders, `src/proto/motd_template.zig`) | reg | **FULL** | v3/gap-shell: collected at 001 (`startMotd` `src/App.elm:4876`, `finishMotd` `:4903`) and shown on Home as "From the network" (`View/GapShell.elm:543 motdCard`, `View/Home.elm:119`), with the onboarding WELCOME pack. No manual `/motd`; a typed `/motd` goes out raw. |
| LUSERS | `:80` / `handleLusers:42489` | → 251-255, 250, 265, 266 | reg | **FULL** | Sent at 001 (`src/App.elm:5478`), home stats `foldLusers:22913` |
| USERS | `:81` / `handleUsers:57291` | → 392/393/394/395 | reg | **RAW** | — |
| LINKS | `:82` / `handleLinks:57313` | → 364/365 mesh peers | reg | **RAW** | Status page uses its own node probe (`src/Nodes.elm`) |
| MAP | `:83` / `handleMap:57696` | → 015/017 | reg | **RAW** | — |
| CHANSTATS | `:84` / `handleChanstats:57040` | `CHANSTATS <TOPUSERS\|WORDS\|ACTIVITY\|RECORD\|HELP> [#chan]` → NOTICEs; needs `[stats].channel_dir` | reg, cfg | **PARTIAL** | The command is not used, but the **same data** is rendered from the JSON the server writes (`index.json`/`<slug>.json`, `src/daemon/chanstats.zig:479-535`) by `src/Stats.elm:106-108,767-777` + `src/View/Stats.elm` |

### 5.2 `channel.ops` (`src/daemon/modules/channel_ops.zig`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| JOIN | `:59` / `handleJoin:22515`, gates `joinDenied:22382`, `joinOneWith:22598` | `JOIN #a,#b k1,k2` \| `JOIN 0`. Gates: CHANLIMIT 405, quarantine 474, `+S` 489, `+O`/`+A` 520, `+a` 477, AKICK, IRCX ACCESS DENY 474, `+b` 474, `+i` 473, `+k` 475, `+j`/raid throttle 480, `+l` 471 → `+d` clone or `+f` forward (470), RESV/SACCESS 437 | reg | **FULL** | `enterBrowserRoom` `src/App.elm:19537`, `/join` `src/App.elm:15639`. Refusals: 471/473/474/475 on the join prompt (`foldErrorNumeric` `src/App.elm:19976`); 477/480/489/520 with plain copy (`foldJoinDenied` `src/App.elm:11143`, v3/gap-shell); 470 forwarding explained (`chanservForwarded` `src/App.elm:50807`) and "Ask to join" (KNOCK) on the refusal card (`View/Chanserv.elm:1103 joinPromptCard`) (v3/gap-chanserv); 405 → inbox. |
| PART | `:60` / `handlePart:22973` | `PART #a,#b [:reason]`; ONPART prop message delivered | reg | **FULL** | `/part` `src/App.elm:15640`; leaving a room asks first (`GapShell.LeaveConfirm`, v3/gap-shell), room leave |
| NAMES | `:61` / `handleNames:23076` | → 353/366; sealed rooms → `FAIL NAMES MEMBERSHIP_SEALED` | reg | **FULL** | `foldNames` `src/App.elm:26598`, `namesAfterSelfJoin` `:26293`. The sealed `FAIL` now shows as a generic inbox error (§0.2) but the roster just renders empty. |
| MODE | `:62` / `handleMode:23200`, user `handleUserMode:23742`, oper `handleOperUserMode:23812` | Channel query/set (324/329/367-368/346-347/348-349/728-729); own umodes 221; oper may set others' `+M`/`+P` only | reg | **PARTIAL** | Channel modes: every advertised letter has a control except the oper-set markers `E r z` and the MODEX-only `f` NOFORMAT (§7: Room rules, "More rules", "Mutes and exceptions", timed rules; v3/gap-chanserv). Own umodes: Preferences → Privacy for `R g C i p P Q` (§9; 221 seeds the switches; v3/gap-usermodes). `/mode` slash `src/App.elm:15649` for the rest. Missing: oper cross-user `+M`/`+P`, `MODES=` batching (Elm sends 3 targets per line, `slashModeLines` `src/App.elm:12948`). |
| KICK | `:63` / `handleKick:23892` | `KICK #c nick [:reason]` | op | **FULL** | `/kick:15651`, desk `applyModerationAction:12513`, profile controls `src/View/Profile.elm:796` |
| INVITE | `:64` / `handleInvite:24857` | `INVITE nick #c` → 341; `+g` free-invite | op (`+g`: member) | **FULL** | `/invite:15643`, desk invite form `src/View/Bans.elm:477`, `src/App.elm:46784` |
| TOPIC | `:65` / `handleTopic:59817` | `TOPIC #c [:text]` → 331/332/333 | `+t`: op | **FULL** | `src/RoomSettings.elm:996`, `/topic:15637`, topic history |
| KNOCK | `:66` / `handleKnock:25118` | `KNOCK #c [:reason]` → 711 to caller, 710 to ops; 713 open, 714 on chan | reg | **FULL** | v3/gap-chanserv, both directions: "Ask to join" on the refusal card sends `KNOCK #c :note` (`Chanserv.knockLine` `src/Chanserv.elm:678`, `View/Chanserv.elm:1150 promptActions`); 711/713/714 answer the asker and 710 gives hosts an inbox row with an Invite action (`Chanserv.fold` `src/Chanserv.elm:2159`, `knockAction` `View/Chanserv.elm:1255`). Test `ChanservTest`. |
| CREATE | `:67` / `handleCreate:41973` | `CREATE #c [modes] [clone-source]`; 926 exists | reg | **MISSING** | Elm creates rooms with JOIN (`submitCreateRoom:18784`); no clone-from-room |
| RENAME | `:68` / `handleRename:25173` | `RENAME #old #new [:reason]`; `FAIL RENAME CANNOT_RENAME\|CHANNEL_NAME_IN_USE\|INVALID_PARAMS` | op | **PARTIAL** | Inbound `foldRename:32611`, FAIL arm `src/App.elm:24122`; no rename UI or sender |
| CHANBADWORDS | `:69` / `handleChanbadwords:25677` | `CHANBADWORDS #c ADD\|DEL\|LIST [pattern]` → NOTICEs | op | **RAW** | — |

### 5.3 `messaging` (`src/daemon/modules/messaging.zig`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| PRIVMSG | `:62` / `handleMessage:58733` | nick / `#c` / `@#c` STATUSMSG / multi-target (MAXTARGETS). Refusals: 404 (`+m +n +C +T` ban/quiet, slowmode `"(slowmode)"` `:58213`), 401, 407, 477, 716/717, `FAIL PRIVMSG CTCP_BLOCKED\|E2EE_REQUIRED\|INVALID_UTF8\|TEMPORARILY_UNAVAILABLE`; first-message HOLD (`captureFirstHold:43395`) | reg | **FULL** | composer send `src/App.elm:12210`; failures toast (`foldLabeledFail`); STATUSMSG audiences (`composerSendTarget`); a slowmode refusal is explained and the composer counts down (`View/Chanserv.elm:1297 slowState`, v3/gap-chanserv) |
| NOTICE | `:63` | Same engine, errors suppressed | reg | **FULL** | `/notice:15646` |
| TAGMSG | `:64` / `handleTagmsg:58223` | Relays allowed `+` client tags | reg | **FULL** | typing `sendTyping:6960`, reactions `sendReaction:7181` |
| REDACT | `:65` / `handleRedact:42303` | `REDACT #c msgid [:reason]` (op); `FAIL REDACT NEED_REGISTRATION\|UNKNOWN_MSGID` | op | **FULL** | `requestDelete:8540`, inbound `foldRedact:7494`; `FAIL REDACT` is a generic inbox row unless labeled |
| EDIT | `:66` / `handleEdit:42365` | `EDIT target msgid :text` (author only) → PRIVMSG with `+draft/edit` | reg | **FULL** | `requestEdit:8486`, `foldEdit:7536`; `FAIL EDIT` is a generic inbox row unless labeled; v3/gap-convo folds the server's tagged-`PRIVMSG` edit fan-out in place (`gapEditLine` `src/App.elm:55286`, `gapFoldTaggedEdit` `:55364`) |
| CHATHISTORY | `:67` / `handleChathistory:27289`, targets `:27237` | `LATEST\|BEFORE\|AFTER\|AROUND\|BETWEEN\|TARGETS` (`src/proto/chathistory_cmd.zig:137-179`, `src/proto/chathistory_targets.zig:120`); `+onyx/topic` filter; 64 cap | reg+cap | **FULL** | LATEST `src/App.elm:26835`, BEFORE `:27019`, AROUND `:27063`, TARGETS `:37319`. AFTER/BETWEEN are unused on purpose (COVERAGE) |
| SEARCH | `:68` / `handleSearch:27450`, `src/daemon/search_cmd.zig` | `SEARCH <target> :<query>`; `FAIL SEARCH INVALID_PARAMS\|INVALID_TARGET\|RATE_LIMITED\|RESULTS_TOO_LARGE` | reg+cap | **FULL** | `src/App.elm:36290`, `src/View/Search.elm:292` |
| MARKREAD | `:69` / `handleMarkread:25442` | `MARKREAD <target> [timestamp=…]` | reg+cap | **FULL** | `src/App.elm:26829`, `:34675` |
| PINS | `:70` / `handlePins:25535` | `PINS #c [LIST\|ADD id\|DEL id\|CLEAR]` → `:srv PINS #c :ids` | list: member; edit: op | **PARTIAL** | Elm writes the `PINS` channel **PROP** instead (`writePins:16409`), so pinning works for ops. The `PINS` command and its replies are unused. `src/View/Pins.elm` |
| METADATA | `:71` / `handleMetadata:42155` | `GET\|LIST\|SET\|CLEAR` (no SUB/SYNC); 761/762/766/767/769 | reg+cap | **PARTIAL** | Own profile SET (`setOwnMetadata:9860`, keys §12), `GET ocean.dm-key` (`src/App.elm:39431`, `:50921`); LIST/CLEAR are not used |
| MONITOR | `:72` / `handleMonitor:25252` | `+ - C L S`; 730-734 | reg | **FULL** | friends/watch contacts `monitorAddContact:29042`, `foldMonitorOnline:29493` |
| SILENCE | `:73` / `handleSilence:25605` | `SILENCE [+\|-mask]` → 271/272 | reg | **FULL** | v3/gap-usermodes: Notifications sheet → "Also block on the server" mirrors `/ignore` to `SILENCE +nick!*@*` and lists/removes the account's blocks (`UserModes.silenceAddLine` `src/UserModes.elm:666`, 271/272 and the echo in `foldWire` `src/UserModes.elm:2142-2163`, limit from `SILENCE=`, `View/UserModes.elm:745 serverBlocks`, `View/Notify.elm:542`). Signed-in accounts only. |

### 5.4 `accounts` (`src/daemon/modules/accounts.zig`, feature `accounts`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| REGISTER | `:133` / `handleRegister:44313` | `REGISTER <acct\|*> <email\|*> <pw>` → raw `REGISTER SUCCESS`; FAIL `ACCOUNT_EXISTS BAD_ACCOUNT_NAME INVALID_PASSWORD INVALID_EMAIL ACCOUNT_FORBIDDEN TEMPORARILY_UNAVAILABLE NEED_MORE_PARAMS` (`registerFailCode:44146`) | reg | **FULL** | guest claim `requestRegister:28520`, `src/View/GuestClaim.elm`, connect "create account" |
| VERIFY | `:134` / `handleVerify:28066` | `VERIFY [acct] <code>` | reg | **FULL** | `requestVerify:28558` |
| IDENTIFY | `:135` / `handleIdentify:44434` | `IDENTIFY <acct> <pw> [code]`; `FAIL IDENTIFY TOTP_REQUIRED` | reg | **FULL** | `requestIdentify` `src/App.elm:32092` (guest claim, reclaim) plus two-step sign-in: the connect gate sends `IDENTIFY <acct> <pw> <code>` on a plain guest connection, composed ports-side (`AuthGate.onTwoFactorRefused` `src/AuthGate.elm:774`, `View/AuthGate.elm:331 twoFactorPanel`; v3/gap-auth, D2). `FAIL IDENTIFY TOTP_REQUIRED` is handled by `foldIdentifyReply` `src/App.elm:24219`. |
| TOTP | `:136` / `handleTotp:28197` | `ENROLL\|CONFIRM <code>\|DISABLE\|STATUS` | acct | **FULL** | `src/View/Account.elm:511-740`, `requestTotp*:31877-31968`, `foldTotpNotice:32026` |
| RECOVERYCODES | `:137` / `handleRecoveryCodes:28291` | `STATUS\|GENERATE [pw]\|CLEAR [pw]\|LOGIN <acct> <code>` | acct / any for LOGIN | **FULL** | `src/View/Account.elm:1151-1314`, `foldRecoveryCodesNotice:31723` |
| LOGOUT | `:138` / `handleLogout:44505` | → 901 + NOTICE | acct | **FULL** | `requestLogout:30361` |
| DROP | `:139` / `handleDrop:44567` | `DROP <acct> <pw>` | acct | **FULL** | `requestDropAccount:30901`, `src/View/Account.elm` drop section |
| SETPASS | `:140` / `handleSetpass:44617` | `SETPASS <cur> <new>` \| `SETPASS <new>` (cert-verified) | acct | **FULL** | v3/gap-auth (D1): Account → change password. `requestAccountSetPassword` `src/App.elm:30821` sends `SETPASS <current> <new>` (`Services.setPass` `src/Services.elm:918`); the success NOTICE (`AuthGate.setPassNotice`) and `FAIL SETPASS` copy (`setPassFailCopy` `src/AuthGate.elm:1179`) are folded by `foldAuthGateLine` `src/App.elm:53473`. |
| RESETPASS | `:141` / `handleResetpass:44684` | `RESETPASS <acct>` → emailed code; `RESETPASS <acct> <code> <new>` | any reg (logged out) | **FULL** | v3/gap-auth: connect screen "Forgot password?" (`View/AuthGate.elm:661 signInLinks`, `resetPanel` `:477`) dials a guest connection, sends `RESETPASS <acct>` then `RESETPASS <acct> <code> <new>` (`AuthGate.resetRequestLine` `src/AuthGate.elm:1090`); `RESETPASS SUCCESS` and the `FAIL RESETPASS *` codes are folded in `foldAuthGateLine` `src/App.elm:53522`. Test `authGate.smoke.mjs`. |
| SUCCESSOR | `:142` / `handleSuccessor:44761` | `SUCCESSOR #c SHOW\|SET <acct>\|CLEAR` | founder/oper | **FULL** | v3/gap-chanserv: Room settings → Registration → "Successor" (`SHOW`/`SET`/`CLEAR`, `src/Chanserv.elm`, `View/Chanserv.elm:608 registeredBody`); `FAIL SUCCESSOR` has specific copy (§6.1) |
| ACCOUNTINFO | `:143` / `handleAccountInfo:44872` | → `account=… flags=… suspended=… forbidden=… noexpire=…` | reg | **FULL** | `requestAccountInfo:30218`, `foldAccountInfoNotice:30285`, overview `src/View/Account.elm:123` |
| ACCOUNT | `:144` / `handleAccountAdmin:44906` | `ACCOUNT SUSPEND\|UNSUSPEND\|FORBID\|UNFORBID\|NOEXPIRE\|INFO <acct> [on\|off]` | oper:service_admin | **FULL** | v3/gap-oper: operator desk → Network → Accounts: `INFO`, `SUSPEND`, `UNSUSPEND`, `FORBID`, `UNFORBID`, `NOEXPIRE on\|off`, each reviewed first (`OperPlan.AccountAdmin` `src/OperPlan.elm:671`, `View/ModDesk.elm:577 accountsCard`) |
| SASLINFO | `:145` / `handleSaslInfo:44999` | → NOTICEs | reg | **RAW** | `Services.saslInfo` is never called |
| ACCOUNTSET | `:146` / `handleAccountSet:47144` | `<acct> <pw> email\|flags\|secure\|enforce <value>` | acct | **FULL** | `email` (`requestAccountSetEmail` `src/App.elm:30786`); `secure` and `enforce` (Account → Protection: `View/GapAccount.elm:111 protectionSection`, sent by `updateGapAccount` `src/App.elm:54988`; v3/gap-account). `flags` is oper-privileged (`PRIVILEGED_FLAGS`), so it has no user control by design. The password is no longer sent through ACCOUNTSET (D1 fixed). |
| GHOST | `:147` / `handleGhost:47197` | `GHOST <nick> <pw>` | acct | **FULL** | nick reclaim `ghostNick:32123`, `reclaimNickWithPassword:32138`; `FAIL GHOST` is a generic inbox error |
| RECOVER | `:148` / `handleRecover:47257` | `RECOVER <nick>` | acct | **FULL** | v3/gap-account: Account → Names & addresses → "Recover a name" (`View/GapAccount.elm:192`), sent by `gapRecoverSend` `src/App.elm:54943` via `Services.recover`; `RECOVER:` NOTICEs and `FAIL RECOVER` have specific copy (`GapAccount.classifyReply` `src/GapAccount.elm:547`) |
| RELEASE | `:149` / `handleRelease:47320` | `RELEASE <nick>` | acct | **FULL** | v3/gap-account: same "Recover a name" form, "Release" action (`gapRecoverSend` `src/App.elm:54943` via `Services.releaseNick`); `FAIL RELEASE` has specific copy |
| CHANNEL / CS | `:150-151` / `handleChannel:47370` | §6.1 | acct | **FULL** | v3/gap-chanserv: Room settings → Registration and "Your rooms"; every subcommand in §6.1 (`src/Chanserv.elm`, `View/Chanserv.elm:556 registrationSection`, `settleStepChanserv` `src/App.elm:50651`) |
| SESSION | `:152` / `handleSession:49009` | §6.2 | acct | **FULL** (exc. REDIRECT D8) | §6.2 |
| SESSIONTOKEN | `:153` / `handleSessionToken:45058` | → `NOTICE SESSIONTOKEN <acct> <token> expires=<s>` (TLS only) | acct | **MISSING** | — |
| CERTADD / CERTLIST / CERTDEL | `:154,160,161` / `:45065,45077,45093` | Bind/list/remove TLS cert fingerprints | acct | **FULL** | `src/View/Account.elm:743-800`, `requestCert*:31002-31037`, `foldCertNotice:31098` (browser cannot present a cert, so CERTADD is moot) |
| WEBAUTHN | `:155` / `handleWebauthn:46733` | §6.4 | acct / any (AUTH) | **FULL** | register/list/remove/rename (`src/Passkey.elm`, `src/View/Account.elm:1319`); `WEBAUTHN STATUS` is sent with `LIST` (`Passkey.webauthnStatus` `src/Passkey.elm:352`, `src/App.elm:30617`); passkey sign-in `AUTH`/`AUTH-FINISH` from the connect screen (`View/AuthGate.elm:388 passkeyPanel`, `src/App.elm:53373`; v3/gap-auth) |
| KEYTRANS | `:156` / `handleKeyTrans:46400` | `STATUS\|ROOT\|PROOF n\|EVENT n\|DEVICE acct dev\|CONSISTENCY n\|STORE …\|PEER node\|REQUIRE on\|off` | reg | **PARTIAL** | STATUS + PROOF (`requestKeytrans*:29709-29728`, `src/View/Account.elm:801`); the other 7 subcommands are missing |
| E2EEKEY | `:157` / `handleE2eeKey:46104` | `STATUS\|LIST [acct]\|ADD dev alg key\|DEL dev` | acct | **FULL** | `src/View/Account.elm:832`, `requestE2eeKey*:30925-30977`; automated publish `src/GroupPublisher.elm` |
| E2EEGROUP | `:158` / `handleE2eeGroup:45949`, oper barrier `:45858` | `E2EEGROUP #c KEY-PACKAGE\|COMMIT\|WELCOME from [to-acct to-dev] :payload`; oper `STATUS\|ON\|OFF` | acct + IRCX + onyx/e2ee | **PARTIAL** | client records FULL (automated, `src/GroupControl.elm`, `foldE2eGroupReply:25996`); oper STATUS/ON/OFF missing |
| IDENTITY | `:159` / `handleIdentity:46206` | `STATUS\|LIST [acct]\|ADD label pub sig\|DEL label\|RESIDENCE node epoch expiry sig\|VERIFY acct label pub sig` | acct | **PARTIAL** | ADD/RESIDENCE are automated (`src/App.elm:24469-24483`, `src/Attribution.elm`); LIST/DEL/VERIFY/STATUS have no UI |
| RECOGNIZE | `:162` / `handleRecognize:25367` | `RECOGNIZE ADD\|DEL\|LIST [mask]` | acct | **FULL** | v3/gap-account: Account → Names & addresses → "Recognised addresses" list/add/remove (`GapAccount.recognizeLine` `src/GapAccount.elm:450`, `View/GapAccount.elm:238 namesSection`) |
| LISTCHANS | `:163` / `handleListchans:25648` | → `LISTCHANS #c level`… | acct | **FULL** | v3/gap-chanserv: Account sheet "Your rooms" (`View/Chanserv.elm:919 myRoomsSection`, `Chanserv.elm` `LISTCHANS` fold) |

### 5.5 `ircx` (`src/daemon/modules/ircx.zig`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| IRCX / ISIRCX | `:59-60` / `handleIrcx:41053` | → 800 | any | **FULL** | IRCX sent on 001 `src/App.elm:5467`; 800 goes to Activity |
| DATA / REQUEST / REPLY | `:61-63` / `handleData:41176` | `DATA <target> <tag> :msg`; 904 badtag, 913, 531 (`+V`) | reg | **CORE-ONLY** | builders `src/Ircx.elm:1139-1159` are never called; inbound DATA has no fold |
| WHISPER | `:64` / `handleWhisper:41621` | `WHISPER #c n1,n2 :text`; 923 if `+w` | member | **PARTIAL** | receive FULL (`Ircx.foldWhisperLine`, `src/View/Thread.elm:591`); **no send UI** (`Ircx.whisper` is never called) |
| PROP | `:65` / `handleProp:40574` | §11 | reg; write op/self/oper | **PARTIAL** | §11 |
| ACCESS | `:66` / `handleAccess:39602` | `ACCESS #c ADD\|DELETE\|LIST\|CLEAR [level] [mask] [secs] [:reason]` → 801-805; `NOTE ACCESS ACCESS_COPIED` | op/owner/founder | **FULL** | `src/View/RoomSettings.elm:489` access manager, `src/Ircx.elm:1216-1303`, `foldAccess` (801-805, 775/776) |
| SACCESS | `:67` / `handleSaccess:39584` | `SACCESS ADD DENY\|GAG\|GRANT\|NOCHANNEL\|NONICK\|HOLDNICK <mask> [secs] [:reason] \| DEL \| LIST \| CLEAR` | oper:service_admin | **RAW** | — |
| AUTH | `:68` / `handleIrcxAuth:41063` | IRCX SASL packages; 912 for ANON/GateKeeper | any | **MISSING** | — |
| EVENT | `:69` / `handleEvent:37040` | §13 | reg (CHANNEL/MEMBER/MEDIA) / oper | **PARTIAL** | Non-oper planes: `EVENT ADD MEDIA *` on 001 (`src/App.elm:5475`); CHANNEL/MEMBER planes are unused. Oper side (v3/gap-oper): categories follow/unfollow (`OperPlan.Follow`), `EVENT SEVERITY <floor>` (`MinSeverity`), `EVENT LIST`, `EVENT STATS JSON` (`EventStats`), `/events`, `/observe`, `/broadcast`, `EVENT REPLAY`; the delivered lines fill the Live tab (D5 fixed, `View/OperFeedPanel.elm:134`). |
| MODEX | `:70` / `handleModex:36921` | `MODEX #c[,nick] [+NAMED …]` → 826/827 | reg; set: op | **PARTIAL** | query-only `/modex` (`src/App.elm:15650`, `requestModex:22397`, `foldModexList:22576`); no named-mode setting |
| LISTX | `:71` / `handleListx:24395` | `LISTX [filters]` → 811/812/813/816/817 | reg | **CORE-ONLY** | builder `src/Ircx.elm:1313` is never called; numerics go to Activity |

### 5.6 `user.query` (`src/daemon/modules/user_query.zig`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| ISON | `:75` / `handleIson:24008` | → 303 | reg | **N/A** | MONITOR is used instead |
| USERHOST | `:76` / `handleUserhost:24028` | → 302 | reg | **N/A** | — |
| WHOIS | `:77` / `handleWhois:24478`, `src/daemon/whois.zig` | 311,312,313,317,318,319,320,330,335,338,276,671,301,401; remote mesh WHOIS | reg | **FULL** | `foldWhois:6317`, `src/View/Profile.elm:29-335` |
| LIST | `:78` / `handleList:24287` | ELIST filters → 321/322/323 | reg | **PARTIAL** | browse `refreshChannelList:19326`, `src/View/Browser.elm`; no server-side filters |
| WHO / WHOX | `:79-80` / `handleWho:24189`, `handleWhox:24051` | 352/354/315; sealed → `FAIL WHO MEMBERSHIP_SEALED` | reg | **FULL** | v3/gap-people: our own join sends `WHO #room %tcnfa,616`; the 354 rows (token 616) set away and the peer account (`PeerAccount.parseWhoxRow`); other 354 replies still reach the numeric log |
| WHOWAS | `:81` / `handleWhowas:25080` | → 314/312/369/406 | reg | **FULL** | v3/gap-usermodes: an offline person's card/profile asks `WHOWAS <nick> 1` and shows their real name and sign-off time (`UserModes.whowasLine` `src/UserModes.elm:827`; 314/312/369/406 in `foldWire` `src/UserModes.elm:2166-2209`; `View.UserModes.offlineBlock` `src/View/UserModes.elm:988`, `src/View/Profile.elm:67`) |
| AWAY | `:82` / `handleAway:43289` | → 305/306 | reg | **FULL** | `/away` `/back` `setUserStatus:22697`, 305/306 arms |
| SETNAME | `:83` / `handleSetname:43339` | `SETNAME :realname` | reg | **FULL** | v3/gap-usermodes: the self card edits the real name (`UserModes.setnameLine` `src/UserModes.elm:813`, `RealnameSave` `:1466`, `View.UserModes.selfNameRow` `src/View/UserModes.elm:938`); it is re-sent after a reconnect; inbound `foldSetname` `src/App.elm:6379` |
| NICK | `:84` / `handleNickChange:42964` | 431/432/433/437/438 | reg | **FULL** | `/nick:15638`, `foldNick:32314` |
| QUIT | `:85` / `handleQuit:59893` | | reg | **FULL** | — |
| ACCEPT | `:86` / `handleAcceptCmd:29262` | `ACCEPT +n -n *` → 281/282; 456-458 | reg | **FULL** | v3/gap-usermodes: Preferences → Privacy → "Approve new conversations" (`+g`) with an "Approved people" list (`UserModes.acceptAddLine` `src/UserModes.elm:645`, `View/UserModes.elm:260`); 281/282 and 716-718 are folded in `foldWire` (`src/UserModes.elm:2038-2083`) and blocked senders appear as message requests in the Inbox (`requestsBlock` `src/View/UserModes.elm:333`). 456-458 only reach Activity. |
| HELP / HELPOP | `:87-88` / `handleHelp:42438`, `src/proto/help_db.zig` | → 704/705/706, 524 | reg | **CORE-ONLY** | `/help` is local-only (`src/App.elm:15683`); 704-706 and 524 only reach Activity (`src/App.elm:5012-5023`); `Services.helpTopic`/`helpOp` are never called |
| AUTOJOIN | `:89` / `handleAutojoin:27975` | `AUTOJOIN ADD\|DEL\|LIST [#c]` (per account, applied on login) | acct | **FULL** | v3/gap-usermodes: Account → Autojoin (`UserModes.autojoinLine` `src/UserModes.elm:797`, `View.UserModes.autojoinSection` `src/View/UserModes.elm:859`); `/autojoin` and `/unautojoin` also mirror to the account when signed in (`userModesAutojoinOut` `src/App.elm:48114`); guests keep the device-local list (`src/App.elm:15667`) |
| GROUP | `:90` / `handleGroup:28016` | `GROUP ADD\|DEL\|LIST\|PRIMARY [nick]` | acct | **FULL** | v3/gap-account: Account → Names & addresses → "Grouped names" (`GapAccount.groupLine` `src/GapAccount.elm:468`, `View/GapAccount.elm:238 namesSection`) |
| WELCOME | `:91` / `handleWelcome:28386` | `WELCOME [SHOW]` (any); `ADD :line\|CLEAR` (network onboarding pack, sent once to new accounts) | reg / oper for edits | **PARTIAL** | The arrival pack (`NOTICE WELCOME :…`) is collected (`GapShell.takeWelcomeLine` `src/GapShell.elm:542`) and shown on Home under "Getting started" (`View/GapShell.elm:543`; v3/gap-shell). The builders `Services.welcomeShow/Add/Clear` (`src/Services.elm:1364-1378`) are never called: no re-request, no oper edit. |

### 5.7 `feature.misc` (`src/daemon/modules/feature_misc.zig`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| VHOST | `:97` / `handleVhost:55139` | §6.3 | reg/acct; oper for APPROVE/DENY/OFFER/SET | **PARTIAL** | LIST/USE/OFF/CLAIM (`requestVhost*:31320-31400`, `src/View/Account.elm:876`); REQUEST/OFFERLIST/oper verbs missing |
| PRIVS | `:98` / `handlePrivs:55111` | → 270 | oper | **FULL** | `/privs` (`src/App.elm:15689`) and the desk's "Show my privileges" (`OperPrivs` `src/App.elm:17094`) send it; the 270 reply is parsed by `OperReply.classify` (`src/OperReply.elm:233`) and shown as "Your class is …" with its privileges (`View/ModDesk.elm:529-548`) |
| FILTER | `:99` / `handleFilter:55036` | `FILTER ADD\|DEL\|LIST [pattern]` | oper | **FULL** | v3/gap-oper: Content tab lists, adds and removes patterns (`OperPlan.FilterList/FilterAdd/FilterRemove` `src/OperPlan.elm:279-281`, `View/OperTabs.elm:1212 filtersCard`); each change is reviewed first |
| POLICY | `:100` / `handlePolicy:54998` | `POLICY [LIST\|ROLLBACK]` (ward/filter/class/ban generations) | oper | **FULL** | v3/gap-oper: Content tab `POLICY LIST` and `POLICY ROLLBACK` (`OperPlan.PolicyShow/PolicyRollback` `src/OperPlan.elm:285-286`, `View/OperTabs.elm:1379 policyCard`) |
| OUTHOOK | `:101` / `handleOutboundWebhook:7277` | `OUTHOOK ADD <url> <secret> <categories> \| DEL <url> \| LIST` | oper:server_admin | **RAW** | — |
| BOTGRANT | `:102` / `handleBotGrant:7397` | `BOTGRANT ADD <acct> <speak\|webhook\|history> <#c> <ttl> \| DEL … \| LIST [acct]` | oper:server_admin | **RAW** | — |
| DEFER | `:103` / `handleDefer:38762` | `DEFER AT <unix-ms> #c :text` \| `DEFER CRON m h dom mon dow #c :text` \| `DEFER <when> OPER #c <flag>`; no LIST/CANCEL | reg (OPER form: oper) | **PARTIAL** | v3/gap-usermodes: signed-in people can keep a send-later on the server ("Where to keep it", `View.UserModes.scheduleWhere` `src/View/UserModes.elm:1039`): `DEFER AT <ms> #c :text` (`UserModes.deferAtLine` `src/UserModes.elm:749`; ≤400 bytes, member-only rooms, never encrypted rooms). The server has no LIST/CANCEL, so held sends are remembered locally and cannot be cancelled (`heldRows`, `View/Scheduled.elm:56-77`). Not wired: `DEFER CRON` (builder `deferCronLine` `src/UserModes.elm:772` is tested but no control reaches it) and the `OPER` form. The client-side timer (`src/Schedule.elm`) remains for cancellable sends. |
| UNFURL | `:104` / `handleUnfurl:27752` | `UNFURL ON\|OFF\|https://…` → `NOTICE UNFURL title=… description=… image=…` | reg, cfg | **N/A (alternative)** | Elm previews use the deployment `/linkpreview` proxy (ports.js) and `liveUnfurlPrivacy` |
| APPEAL | `:105` / `handleAppeal:27892` | `APPEAL <text>` (once per window, works **pre-registration**) → `APPEAL filed <id>`; oper `APPEAL LIST`, `APPEAL ANSWER <id> :text` | any; oper for LIST/ANSWER | **FULL** | v3/gap-oper: person side — connect-screen "Appeal a ban" and `/appeal` (§1); operator side — Appeals tab: `APPEAL LIST` and `APPEAL ANSWER <id> :text` (`OperPlan.AppealsList/AppealAnswer` `src/OperPlan.elm:276-277`, `View/OperTabs.elm:1030 appealsTab`). Tests `AppealTest`, `OperConsoleTest`. |
| CHALLENGE | `:106` / `handleChallenge:17480` | pre-001 `CHALLENGE <answer>`; oper `CHALLENGE METHOD pow\|question`, `CHALLENGE QUESTION <q> :<a>` | any / oper | **FULL** | Client answer: §1 (v3/gap-auth). Operator side (v3/gap-oper): Content tab `CHALLENGE METHOD pow\|question` and `CHALLENGE QUESTION <q> :<a>` (`OperPlan.ChallengeMethod/ChallengeQuestion` `src/OperPlan.elm:287-288`, `View/OperTabs.elm:1425 challengeCard`) |
| HOLD | `:107` / `handleHold:43409` | `HOLD RELEASE\|DROP #c <nick>` (first-message review queue, see `HOLD` prop §11) | oper | **FULL** | v3/gap-oper: Content tab `HOLD RELEASE\|DROP #c <nick>` (`OperPlan.HoldAct` `src/OperPlan.elm:284`, `View/OperTabs.elm:1346 holdCard`). The held sender still sees nothing (§11 `HOLD`, §17) and there is no room setting for it. |
| QUARANTINE | `:108` / `handleQuarantine:43538` | `QUARANTINE <nick> #c :reason` (parts all, joins #c, audited) | oper | **FULL** | v3/gap-oper: Silence tab `QUARANTINE <nick> #c :reason`, reviewed first (`OperPlan.Quarantine` `src/OperPlan.elm:271`, `View/OperTabs.elm:445 silenceTab`) |
| BOTCMD | `:109` / `handleBotCmd:43467` | `BOTCMD ADD <name> <argc> :help \| RUN <name> [args] \| LIST` (bot accounts with a speak grant) | acct (bot) | **N/A** | bot-side API |
| MEDIA | `:110` / `media_cmd.zig` (`handleMedia:53929`) | §6.5 | member, cfg:media | **PARTIAL** | §6.5 |
| MEMO | `:111` / `handleMemo:52990` | `MEMO [LIST\|CLEAR\|SEND acct :msg\|FORWARD [acct\|OFF\|NONE]\|IGNORE [ADD\|DEL\|LIST] [acct]]` | acct | **FULL** | v3/gap-usermodes: Inbox → "Offline messages" sheet (`View.UserModes.memoSheet` `src/View/UserModes.elm:422`): `MEMO LIST`, `CLEAR` (with confirm), `SEND acct :msg`, `FORWARD [acct\|OFF]`, `IGNORE ADD\|DEL\|LIST` (`UserModes.memoLine` `src/UserModes.elm:713`). Login delivery `MEMO from X :text` is rendered (`parseMemoBody` `src/App.elm:21198`, `trackOfflineMemo` `:23981`); DMs to offline accounts become memos server-side; `FAIL MEMO` has specific copy (`src/UserModes.elm:2262`). |
| WEBPUSH | `:112` / `handleWebpush:53189` | `SUBSCRIBE ep p256dh auth \| UNSUBSCRIBE ep \| LIST` | acct | **FULL** | ports.js `:10178`, `:10251`; `src/Push.elm`; `src/View/Account.elm:480`; `FAIL WEBPUSH` is a generic inbox row |
| ACTIVITY | `:113` / `handleActivity:58588` | `ACTIVITY SUBSCRIBE\|UNSUBSCRIBE #c`, `ACTIVITY TALLY #c <msgid>`; pushes `:<nick> ACTIVITY #c typing <state>` and react events | member | **PARTIAL** | SUBSCRIBE/UNSUBSCRIBE + typing/react folds (`activitySubscribeLine:6804`, `foldActivityTyping:6884`, `foldActivityReact:7272`); TALLY is unused |
| GEOIP | `:114` / `handleGeoip:39348` | `GEOIP <ip>` | oper:oper_spy | **RAW** | — |
| SUMMON | `:115` / `handleSummon:43575` | `SUMMON <nick> #c` → 342 (oper force-join) | oper | **RAW** | — |
| PONG | `:116` | no reply | any | **FULL** | — |

### 5.8 `services.ext` (`src/daemon/modules/services_ext.zig`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| RESV / UNRESV | `:53-54` / `handleResv:38279` | `RESV [ADD] #pat <ms> :reason \| DEL \| LIST \| SWEEP`; join → 437 | oper | **RAW** | — |
| JUPE / UNJUPE | `:56-57` / `handleJupe:38345` | `JUPE <glob> <ms> :reason \| DEL \| LIST \| SWEEP` | oper | **RAW** | — |
| FORCEOP/FORCEDEOP/FORCEJOIN/FORCEPART/FORCETOPIC | `:58-62` / `handleForceAction:38441` | `FORCE* #c nick [...]`; audited with `proof=` | oper | **RAW** | — |
| CLEAR | `:63` / `handleClear:38588` | `CLEAR #c USERS [KEEP <rank>] [ALLOW a,b] [:reason]` → KICKs + NOTICE count; `FAIL CLEAR PARTIAL` | founder/oper | **PARTIAL** | `/clear` is local scrollback (`src/App.elm:15659`). `CLEAR #c USERS` is sent only inside "Delete room" for a founder (`src/Chanserv.elm:1319`; an owner without CLEAR kicks one by one, capped). There is no stand-alone "Clear room" with `KEEP <rank>`, `ALLOW` or a reason (v3/gap-chanserv). |
| TEMPMODE | `:64` / `handleTempmode:38928` | `TEMPMODE ADD #c <flag> [param] <dur> \| CANCEL #c <flag> [param] \| SWEEP` | op; oper for SWEEP | **PARTIAL** | v3/gap-chanserv: "More rules" → timed rules send `TEMPMODE ADD #c +<flag> <ms>` for `m i M N t s` (5 minutes … 1 day) and `TEMPMODE CANCEL` (`src/Chanserv.elm:1962`, `:1975`, `View/Chanserv.elm:402-489`). The server refuses `b` ("boolean flags only"), so Elm's temp-ban is still a **client timer** (`requestTempBan` `src/App.elm:23585`, `fireTempBan` `:23774`) that dies with the tab. `SWEEP` unused. |
| CLONES | `:65` / `handleClones:39444` | NOTICE report | oper | **FULL** | v3/gap-oper: Abuse tab "Scan for clones" (`OperPlan.ClonesScan` `src/OperPlan.elm:274`, `View/OperTabs.elm:807 clonesCard`) |
| SEEN | `:66` / `handleSeen:38995` | `SEEN <acct>` → NOTICEs | reg | **FULL** | v3/gap-usermodes: an offline person's card/profile offers "Last seen" (`UserModes.seenLine` `src/UserModes.elm:832`, `View.UserModes.lastSeenButton` `src/View/UserModes.elm:1017`, `src/View/Profile.elm:634`); account holders only |

### 5.9 `oper.security`, `ops.upgrade`, `diag.introspect`, `webhook`

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| OPER | `oper_security.zig:153` / `src/daemon/oper_cmd.zig:913` | Always 491 (oper via SASL account binding or GRANT) | reg | **FULL** | 381/491 arms `src/App.elm:5970-5996` (badge) |
| REHASH | `:154` / `oper_cmd.zig:1130` | → 382 | oper:server_rehash | **FULL** | `/rehash` (`src/App.elm:15688`) and the desk button (`View/ModDesk.elm:537`); the 382 line is classified (`OperReply` `RehashDone`, `src/OperReply.elm:249`) and logged on the Network tab (`src/OperConsole.elm:1558`) |
| GRANT / REVOKE / GRANTS | `:155-157` / `oper_cmd.zig:920,956,978` | `GRANT <acct> <class> [privs]`, `REVOKE <acct>`, `GRANTS` | oper:oper_grant | **PARTIAL** | v3/gap-oper: only the read side — Network tab "Operator grants" sends `GRANTS` (`OperPlan.serverQueries` `src/OperPlan.elm:309`). `GRANT`/`REVOKE` are not offered. |
| KILL | `:158` / `oper_cmd.zig:93` | `KILL <nick> [:reason]` (mesh relay) | oper:client_kill | **FULL** | `/kill:15687`, desk kill form `src/View/ModDesk.elm:500-511` |
| CLOSE | `:159` / `oper_cmd.zig:65` | | oper:client_moderate | **RAW** | — |
| DRAIN | `:160` / `oper_cmd.zig:54` | `DRAIN [OFF]` | oper:server_admin | **FULL** | v3/gap-oper: Network tab "Stop accepting new connections" / "Accept new connections again" (`OperPlan.serverActions` `src/OperPlan.elm:329-337`, `View/ModDesk.elm:710 nodeControlsCard`), reviewed first |
| UNREJECT | `:161` / `oper_cmd.zig:34` | `UNREJECT <ip>`; `FAIL UNREJECT INVALID_IP` | oper | **FULL** | v3/gap-oper: Network tab "Clear an address's penalty" (`OperPlan.serverActions` `src/OperPlan.elm:331`, `View/ModDesk.elm:710`) |
| WARD | `:162` / `oper_cmd.zig:506` | `WARD ADD <match> <pattern> [node\|mesh] [refuse\|expel\|quarantine\|require_auth] [secs] [:reason] \| DEL \| LIST [match] \| TEST <match> <value>`; match ∈ address host mask account realname certfp country asn | oper:client_moderate | **FULL** | v3/gap-oper: Bans tab adds, lists, lifts and tests wards with facet/scope/action/duration pickers (`OperPlan.BanAdd/BanRemove/BanList/BanTest` `src/OperPlan.elm:261-264`, `View/OperTabs.elm:189 bansTab`); the broad-mask guard mirrors the daemon. A `country` ward is refused by the daemon itself (D10). |
| SPAMTRAP | `:163` / `oper_cmd.zig:1067` | `SPAMTRAP ADD\|DEL NICK\|CHAN <target> \| LIST` | oper:client_moderate | **FULL** | v3/gap-oper: Content tab `SPAMTRAP ADD\|DEL NICK\|CHAN` and `LIST` (`OperPlan.SpamtrapSet/SpamtrapStatus` `src/OperPlan.elm:282-283`, `View/OperTabs.elm:1286 spamtrapCard`) |
| KLINE / DLINE / XLINE | `:164-166` / `oper_cmd.zig:599` | `[ADD\|DEL] <pattern> [secs] [:reason]` → Warden aliases | oper:client_moderate | **FULL** | v3/gap-oper: Bans tab kinds "Server ban", "Address ban", "Real-name ban" (`OperPlan.banKinds` `src/OperPlan.elm:92`); lifting uses `WARD DEL` (the lines are Warden aliases) |
| SHUN / UNSHUN | `:167-168` / `oper_cmd.zig:410` | `SHUN [<mask> [secs] [:reason]]`, `UNSHUN <mask>` | oper:client_moderate | **FULL** | v3/gap-oper: Silence tab (`OperPlan.ShunAdd/ShunRemove/ShunList` `src/OperPlan.elm:267-269`, `View/OperTabs.elm:445 silenceTab`) |
| ABUSE | `:169` / `oper_cmd.zig:304` | `ABUSE <nick>` (why throttled/shunned/DNSBL/reputation) | oper | **FULL** | v3/gap-oper: Abuse tab (`OperPlan.AbuseCheck` `src/OperPlan.elm:272`, `View/OperTabs.elm:727 abuseTab`) |
| GLOBAL | `:170` / `oper_cmd.zig:474` | `GLOBAL [mask\|#c] :text` | oper:server_admin | **PARTIAL** | v3/gap-oper: Network tab "Message everyone on this node" sends `GLOBAL :text` (`planServerAction` `src/OperPlan.elm:744`). No `mask` or `#c` audience. Distinct from `EVENT BROADCAST` (operators only). |
| OPERMOTD | `:171` / `oper_cmd.zig:382` | `OPERMOTD [SET :text]` | oper | **PARTIAL** | v3/gap-oper: read only — Network tab "Operator message of the day" (`OperPlan.serverQueries` `src/OperPlan.elm:321`); `SET` is not offered |
| DIE / RESTART | `:172-173` / `oper_cmd.zig:684` | | oper:server_shutdown/restart | **RAW** | — |
| CONNECT / SQUIT | `:174-175` / `oper_cmd.zig:800,837` | `CONNECT <host> <port>`, `SQUIT <server>` | oper:mesh_admin | **FULL** | v3/gap-oper: Network tab "Link to another node" / "Unlink a node" (`OperPlan.serverActions` `src/OperPlan.elm:334-335`), reviewed first, marked destructive |
| TRACE / ETRACE | `:176-177` / `oper_cmd.zig:710,774` | 205/262, 709 | oper | **RAW** | — |
| STATS | `:178` / `oper_cmd.zig:146` | letters `u o k/K d/D y/Y l/L z/Z p/P c/C i/I m/M`; only `p` is public | reg (`p`) / oper | **PARTIAL** | v3/gap-oper: Network tab reports for `u o k d y l z m c i` (`OperPlan.serverQueries` `src/OperPlan.elm:311-320`, `View/ModDesk.elm:826 reportsCard`). The public `p` (online operators) and the upper-case aliases are not offered. |
| TESTLINE / TESTMASK | `:179-180` / `oper_cmd.zig:874,891` | 725/726, 727 | oper | **FULL** | v3/gap-oper: Bans tab "Check before banning" (`OperPlan.TestLine/TestMask` `src/OperPlan.elm:265-266`, `View/OperTabs.elm:391`); 725-727 are classified by `OperReply` (`src/OperReply.elm:279-295`) |
| USERIP | `:181` / `oper_cmd.zig:651` | 340 | oper:oper_spy | **FULL** | v3/gap-oper: Abuse tab (`OperPlan.UserIp` `src/OperPlan.elm:273`, `View/OperTabs.elm:762`); 340 is classified by `OperReply` (`src/OperReply.elm:241`) |
| DEBUG | `:182` / `oper_cmd.zig:862` | flight recorder NOTICEs | oper:audit_read | **RAW** | `"DEBUG"` in `src/Spine.elm` is a category name only |
| AUDIT | `:183` / `oper_cmd.zig:994` | `AUDIT [JSON] [oper] [count] \| AUDIT PROOF [JSON] <id>` → `EVENT <oper> AUDIT …` | oper:audit_read | **PARTIAL** | v3/gap-oper: Network tab "Recent audit rows" sends `AUDIT 20` (`OperPlan.serverQueries` `src/OperPlan.elm:310`, `View/ModDesk.elm:799 auditCard`) and the Live feed renders `EVENT … AUDIT` rows (D5). No `JSON`/oper filter and no `AUDIT PROOF`. |
| SESSIONS | `:184` / `oper_cmd.zig:725` | `SESSIONS [oper\|user] [tls\|clear] [glob] [account=] [ip=] [sort=connected] [limit=N]` → 205/262 | oper | **FULL** | v3/gap-oper: Abuse tab session search with every filter as one trailing parameter (`OperPlan.SessionsList` `src/OperPlan.elm:275`, `View/OperTabs.elm:889 sessionsCard`); 204/205/262 classified by `OperReply` |
| MESH / NETSTAT / ROUTE / NETHEALTH | `:185-188` / `oper_cmd.zig:1334,1486,1503` | `MESH [LOG\|GRANTS\|ADMISSION]` | oper | **PARTIAL** | v3/gap-oper: Network tab sends `MESH` (+ `LOG`/`GRANTS`/`ADMISSION`), `NETHEALTH` and `ROUTE` (`OperPlan.serverQueries` `src/OperPlan.elm:303-308`); `NETSTAT` is not offered. The status page still shows client-probe latency only. |
| UPGRADE | `upgrade.zig:24` / `handleUpgradeCommand:29364` | Helix hot upgrade | oper:server_restart | **RAW** | — |
| MODULES / MODLIST | `introspect.zig:326` | `MODULES [id]` | oper | **PARTIAL** | v3/gap-oper: Network tab "Loaded modules" sends bare `MODULES` (`OperPlan.serverQueries` `src/OperPlan.elm:322`); no `[id]` form |
| COMMANDS | `introspect.zig:344` | `COMMANDS [name]` → 371 lines | any | **RAW** | useful for slash autocomplete; not used |
| OROWASM | `introspect.zig:345` | `OROWASM [STATUS\|ABI\|WIT\|PLUGINS]` | oper | **RAW** | — |
| WEBHOOK | `webhook.zig:24` / `handleWebhook:7117` | `WEBHOOK CREATE #c [name] \| LIST #c \| DELETE <id>` → one-time secret URL NOTICE | op/oper, cfg:webhook | **FULL** | `requestWebhook*` (any op via `webhookGate`), `foldWebhookNotice`, `View/RoomTools.elm`, `/webhook` |

## 6. Subcommand deep dives

### 6.1 `CHANNEL` / `CS` — registered-channel services

Sources: `handleChannel` `src/daemon/server.zig:47370-47633`; parser
`src/proto/chanserv_cmd.zig:55-222`; FAIL codes `channelFailCode`
`src/daemon/server.zig:47635` (`ACCESS_DENIED BAD_CHANNEL_NAME CHANNEL_EXISTS
CHANNEL_UNKNOWN INVALID_PARAMS TEMPORARILY_UNAVAILABLE`) plus `ACCOUNT_REQUIRED`
and `NEED_MORE_PARAMS`. AKICK live-mirror codes: `akickLiveFailCode`
`src/daemon/server.zig:4158` (`AKICK_EXISTS LIST_FULL …`). All success
replies are server NOTICEs.

| Subcommand | Server | Reply shape | Who | Elm |
|---|---|---|---|---|
| `REGISTER #c` | `:47391-47397` | `Channel #c registered to <acct>` | acct (op on channel) | **FULL** (v3/gap-chanserv: `src/Chanserv.elm`, Registration section in `src/View/RoomSettings.elm` via `src/View/Chanserv.elm`) |
| `DROP #c` | `:47400-47405` | `Channel #c dropped` | founder | **FULL** ("Delete room" now asks `CHANNEL INFO` first and sends `DROP` only for a registered room; Registration section "Drop registration") |
| `INFO #c` | `:47407-47425` | `channel=… founder=… flags=… mlock=… topiclock=… guard=… private=…`, `  desc:`, `  url:` | acct | **FULL** (registration status, founder, description, website) |
| `SET #c MLOCK <+modes-modes>` | `:47436-47449` (`mode_lock.LockSpec`) | `Channel #c MLOCK set to …`; enforced on MODE (325 RPL_CHANNELMLOCK) | founder | **FULL** ("Protection and locked rules") |
| `SET #c KEEPTOPIC on\|off` | `:47450-47465` | snapshot restored on recreate | founder | **FULL** |
| `SET #c TOPICLOCK\|GUARD\|PRIVATE on\|off` | `:47466-47485` (PRIVATE flips live `+s`) | `Channel #c <field> on\|off` | founder | **FULL** |
| `SET #c DESC\|URL <text>` | `:47486-47505` | `DESC set\|cleared`, `URL set to …` | founder | **FULL** (a description can be replaced, not blanked: the server parser refuses empty values) |
| `ACCESS #c LIST\|ADD\|DEL <acct> <FOUNDER\|OP\|VOICE>` | `:47510-47545` | `ACCESS #c acct LEVEL`, `End of ACCESS list` | founder | **FULL** ("Account access"; distinct from the IRCX mask `ACCESS` in Roles) |
| `AKICK #c LIST\|ADD <mask\|account:x> [reason]\|DEL <mask>` | `:47546-47604` | `AKICK #c mask :reason`, `AKICK added/removed …`; enforced at JOIN (474) | founder/admin | **FULL** ("Auto-kick") |
| `TRANSFER #c <acct>` | `:47605-47613` | `Channel #c founder transferred to <acct>` | founder | **FULL** — v3/gap-people: Room care "Hand it over" sends it for registered (`+r`) rooms when the recipient's account is known (`RoomTransfer.handoverPlan` `src/RoomTransfer.elm:335`, `transferHandoverPlan` `src/App.elm:52585`), plus `MODE +q`/`-q`. The server has no offer/accept step or pending-transfer state; the offer travels as a client-tag `TAGMSG` (`+onyx/room-transfer`) and lives only in the two clients' memory (documented server gap: **SERVER**) |
| `SUCCESSOR #c SHOW\|SET\|CLEAR` (top-level) | `handleSuccessor:44761` | NOTICEs; FAIL `ACCOUNT_UNKNOWN NOT_FOUNDER INVALID_VALUE …` | founder/oper | **FULL** ("Successor") |
| `LISTCHANS` (top-level) | `handleListchans:25648` | `LISTCHANS #c level` … `End of LISTCHANS (n)` | acct | **FULL** (Account sheet "Your rooms") |

Elm evidence for every row above (v3/gap-chanserv): pure core `src/Chanserv.elm` (`fold` `:2121`, `foldFail` `:2461`, `foldServerNotice` `:2591`), App glue `chanservUpdate` `src/App.elm:50572` / `settleStepChanserv` `src/App.elm:50651`, views `View/Chanserv.elm` (`registrationSection` `:556`, `listsSection` `:981`, `myRoomsSection` `:919`). Tests: `ChanservTest`, `RoomSettingsTest`.

### 6.2 `SESSION` (multi-device reclaim)

Source: `handleSession` `src/daemon/server.zig:49009-49065`;
`handleSessionDrop:48917`; `handleSessionResume:49220`; mesh
`handleMeshReclaim:49462`, `handleMeshExactReclaim:49386`.

| Subcommand / line | Server | Elm |
|---|---|---|
| `SESSION LIST` → `SESSION LIST <*\|-> #n signon=<ms> <attached\|detached> [sid=<32hex>]`, `SESSION: end of session list` | `:49009` | **FULL** (`requestSessionList:30375`, roster `src/View/Account.elm:229-286`) |
| `SESSION DROP <#n\|sid=…>` → `SESSION DROP #n ok`; FAIL `INVALID_INDEX AMBIGUOUS_SID STALE_LIST CANNOT_DROP_CURRENT NO_SUCH_SESSION` | `:48917-49003` | **FULL** (`src/App.elm:42434-42439`) |
| `SESSION TOKEN` → NOTICE `SESSION TOKEN <hex\|credential>` + `SESSION MTOKEN <sealed> expires=<s>` | `:49032-49100` | **FULL** (`foldSessionTokenNotice:20343`) |
| `SESSION RESUME <token>` → `SESSION RESUME: already attached\|attached to live session\|…mesh session\|session restored`; `WARN SESSION ORIGIN_UNREACHABLE\|TEMPORARILY_UNAVAILABLE\|RESUME_CREDENTIAL_PRESERVED`; FAIL `INVALID_TOKEN NO_SESSION NO_ATTACHMENT ATTACHMENT_IN_USE RESUME_PENDING` | `:49220` | **FULL** (`maybeSendSessionCommands:20226`, `foldSessionReply:20298`) |
| `SESSION REDIRECT: [exact ]session lives on <node>; reconnect there to reclaim` | `:49447`, `:49634` | **MISSING** (D8) |

### 6.3 `VHOST` (host personas, "wardrobe")

Source: `handleVhost:55139` and siblings `:55206-55360`; durable store
`src/daemon/vhost_durable.zig`; persona/offer model `src/daemon/guise.zig`.
Applying a vhost sends `CHGHOST` to capable peers.

| Subcommand | Who | Elm |
|---|---|---|
| `VHOST` / `VHOST LIST` (wardrobe + offers) | reg | **FULL** (`requestVhostList:31320`, `src/View/Account.elm:876-984`) |
| `VHOST USE <name>` | acct | **FULL** (`requestVhostUse:31343`) |
| `VHOST OFF` | acct | **FULL** (`requestVhostOff:31400`) |
| `VHOST CLAIM <host>` (claim an offered template) | acct | **FULL** (`requestVhostClaim:31372`) |
| `VHOST REQUEST <host>` (ask opers) | acct | **MISSING** |
| `VHOST OFFERLIST` | reg | **MISSING** (offers arrive through LIST) |
| `VHOST APPROVE\|DENY <acct> [:reason]` | oper | **MISSING** |
| `VHOST OFFER <template> [:label]` | oper | **MISSING** |
| `VHOST SET <acct> <host> [name]`, bare `VHOST <host>` | oper | **MISSING** |
| FAIL `ACCOUNT_REQUIRED HOST_NOT_YOURS HOST_TAKEN INVALID_HOST TEMPORARILY_UNAVAILABLE` | — | **PARTIAL** (generic inbox error since v3/gap-shell, no specific copy; `foldVhostNotice` `src/App.elm:31423` folds NOTICEs only) |

### 6.4 `WEBAUTHN` (passkeys)

Source: `handleWebauthn:46733-47140`. Replies are Event-Spine lines
`:srv EVENT <nick> WEBAUTHN <BODY>` (`webauthnReply:46720`), **not** `NOTE`.

| Subcommand | Elm |
|---|---|
| `STATUS` | **FULL** (`Passkey.webauthnStatus` `src/Passkey.elm:352`, sent with `LIST` at `src/App.elm:30617`; v3/gap-auth) |
| `REGISTER [label]` → `REGISTER-CHALLENGE <chal> <rp> :<acct>`; `REGISTER-FINISH <cred> <cdj> <authdata> [att]` → `REGISTERED` | **FULL** (`src/Passkey.elm:325-376`, ports WebAuthn) |
| `AUTH <acct>` → `AUTH-CHALLENGE`, `ALLOW-CRED`…; `AUTH-FINISH …` → login | **FULL** (v3/gap-auth: `Passkey.webauthnAuth` `src/Passkey.elm:339`, `webauthnAuthFinish` `:382`; connect-screen "Sign in with a passkey", `View/AuthGate.elm:388`, `src/App.elm:53373`) |
| `LIST`, `REMOVE <cred\|label>`, `RENAME <cred> :<label>` | **FULL** (`src/Passkey.elm:346-366`, `src/View/Account.elm:1319+`) |
| 25 FAIL codes (§15) | **FULL** (`foldPasskeyReply:26017`) |

### 6.5 `MEDIA` (calls)

Source: `src/daemon/media_cmd.zig:40-523`. Feature-gated `[media]`
(`feature_misc.zig:110`). Events arrive as `:srv EVENT <nick> MEDIA <VERB> #c
<nick> [detail]` (`broadcastMediaEvent` `src/daemon/server.zig:53938`).

Elm sends media commands through two paths: its own folds/builders
(`src/Media.elm`, `src/CallUi.elm`), and the bundled Cadence engine
(`media/voice-core.ts` and `media/voice-engine.ts` in `elm/`, bundling the repo-root `src/lib/cadence-media/*`) over the shared socket
(`ports.js:3029-3060`). Repo state: voice ships, video is off on the live
network (commit `fbe04585`).

| Subcommand | Server | Elm |
|---|---|---|
| `JOIN #c [voice\|video\|screen]` (`TX_DENIED` if `+M`) | `media_cmd.zig:486-491` | **FULL** (voice; engine `media/voice-core.ts:327`) / video+screen **PARTIAL** (off on live). `a96afd2e`: the video-off switch fails closed on every path (`VIDEO_ENABLED = false` `media/voice-engine.ts:107`, audio-only joins `:115`, `cameraSupported` defaults to False `src/CallMedia.elm:118`, join buttons gated `src/View/Calls.elm:285`; `bundleBoot.smoke.mjs:358`) |
| `LEAVE #c` | `:472-476` | **FULL** (engine) |
| `MUTE`/`UNMUTE #c <kind>` | `:492-505` | **FULL** (engine; `src/Media.elm:452-470` builder unused) |
| `SPEAKING #c <kind> on\|off` → `SPEAKING`/`SILENT` | `:506-519` | **FULL** (engine `media/voice-core.ts:511`; fold `src/Media.elm:306`) |
| `OFFER #c <codecs> [transport=webrtc] [fingerprint=… setup=…]` → `OFFER-ACK`, `CAPS`, `TRANSPORT`, `NATIVE`, `KIND-DENIED` | `:62-75` | **FULL** (engine) |
| `ANSWER #c <codecs> …` → `ANSWER-ACK` | `:76-85` | **MISSING** (not used by the engine) |
| `ROSTER #c` → `ROSTER`…`ROSTER-END` | `:58-61` | **FULL** (engine + fold) |
| `PROFILE #c` | `:86-92` | **MISSING** |
| `STATS #c` → `STATS`…`STATS-END` | `:93-96` | **PARTIAL** (engine uses it; there is no stats panel) |
| `QUALITY #c` (members or oper) | `:44-51` | **MISSING** (Elm computes pips locally, `src/CallMedia.elm:387`) |
| `CONSENT #c on\|off` / `RECORD #c [stop]` (all must consent) | `:97-155` | **MISSING** |
| `LAYER #c <spatial> <temporal>` | `:156-184` | **MISSING** |
| `ABR #c <cur> <avail> <loss> <rtt> [nack]` | `:185-262` | **MISSING** |
| `BREAKOUT #c <room>` | `:263-280` | **CORE-ONLY** (`src/Media.elm:562` builder never called) |
| `POS #c <x> <y>` (spatial audio) | `:281-306` | **MISSING** |
| `CAPTION #c :text` | `:307-322` | **PARTIAL**: receive + render (`src/Media.elm:159`, `src/CallCaptions.elm`); Elm never sends captions |
| `TRANSCRIPT #c` → `TRANSCRIPT`…`TRANSCRIPT-END count=` | `:323-333` | **PARTIAL** (fold only; no request button) |
| `HAND #c [up\|down]` → `HAND` | `:437-451` | **PARTIAL**: inbound fold `src/Media.elm:335`; the Elm hand raise sends a ✋ `REACT` instead (`src/App.elm:45741-45769`) |
| `QUEUE #c` (speaking queue) | `:433-436` | **MISSING** |
| `REACT #c <emoji>` | `:452-467` | **FULL** (`src/App.elm:40499-40509`) |
| `E2EE-HANDSHAKE` / `E2EE-GROUPKEY` (acct + participant) / server `E2EE-DETACH` | `:334-432`, `:468-471` | **FULL** (Cadence engine) |
| Binary WS datagrams (Cadence frames, MACKEY) | `handleWsMediaDatagram` `src/daemon/server.zig:53961` | **FULL** (`mediaBinarySend`/`mediaBinaryReceived` ports) |
| 29 FAIL MEDIA codes (§15) | — | **PARTIAL** (all folded through `Media.foldMediaLine`; few have specific copy) |

## 7. Channel modes

Advertised `CHANMODES=beIZ,k,lfj,imnstCTNgSMWOAphuadErzxwVUFD`. Sources:

- core `src/daemon/chanmode.zig:98-118`
- IRCX ext `src/proto/chanmode_ext.zig` `mode_specs`
- Z/f/j `src/proto/protocol_inventory.zig` `world_modes`
- MODE handler `src/daemon/server.zig:23200-23740` (`+j` `:23630`, `+f` `:23650`, `+Z` `:23609`)

"Slash" means reachable only by typing `/mode #c ±X` (`src/App.elm:15649`).
Elm folds every advertised letter through `Modes.applyChannelModeDelta`
(data-driven), so display state stays correct even when no UI exists.

Controls (v3/gap-chanserv): "More rules" `View/Chanserv.elm:351 moreRules` (rule list `Chanserv.ruleGroups` `src/Chanserv.elm:473`), timed rules, forwarding and join-rate limit in the same disclosure, "Mutes and exceptions" `View/Chanserv.elm:981 listsSection`, "Locked rules" and registration `View/Chanserv.elm:556`, the everyday toggles `RoomSettings.flagToggles` (`src/RoomSettings.elm`). Tests `ChanservTest`, `RoomSettingsTest`.

| Letter (MODEX name) | Group / param | Set by | Effect | Elm |
|---|---|---|---|---|
| `b` ban | A mask (+extbans) | op | Blocks JOIN (474); `+e` exempts | **FULL** (`src/View/Bans.elm`, `requestBanList:22186`, extban builder) |
| `e` exempt | A mask | op | Exempts from `+b`/`+Z` | **FULL** (Room settings → Mutes and exceptions → Exceptions) |
| `I` invite-exception | A mask | op | Bypass `+i` | **FULL** (Invite passes) |
| `Z` quiet | A mask | op | Mutes without blocking JOIN | **FULL** (Muted; Mute / Unmute on the member card) |
| `k` key | B | op | JOIN key (475) | **FULL** (`src/RoomSettings.elm:1022-1039`) |
| `l` limit | C int | op | 471, then `+d` clone or `+f` forward | **FULL** (`src/RoomSettings.elm:1043-1068`) |
| `f` forward | C #target (needs ops on target unless `+F`) | op | Redirect refused joins (470) | **FULL** (More rules: "Send people elsewhere when they can't join") |
| `j` join throttle | C `joins:secs` | op | 480 + one-shot raid alert | **FULL** (More rules: "Join rate limit") |
| `i` invite-only | D | op | 473 | **FULL** (RoomSettings + desk) |
| `m` moderated | D | op | voice+ to speak | **FULL** |
| `n` no-external | D | op | | **FULL** |
| `t` topic-ops | D | op | | **FULL** |
| `s` secret | D | op | hidden from LIST; roster gated | **FULL** (also Stewardship "close room" `+si`, `src/App.elm:24739`) |
| `C` no-CTCP | D | op | 404 / `FAIL PRIVMSG CTCP_BLOCKED` | **FULL** (More rules) |
| `T` no-notice | D | op | drop non-op NOTICE | **FULL** (More rules) |
| `N` no-nick | D | op | blocks nick changes | **FULL** (More rules; also a timed rule) |
| `g` free-invite | D | op | any member may INVITE under `+i` | **FULL** (More rules) |
| `S` TLS-only | D | op | 489 | **FULL** (More rules; 489 now explained on the join prompt) |
| `M` moderate-unregistered | D | op | unauth members need voice | **FULL** (More rules; also a timed rule) |
| `W` news-wire | D | op | enables `!news`/`!localnews` | **FULL** (More rules) |
| `O` oper-only / `A` admin-only | D | oper | 520 | **FULL** (More rules, network operators only; 520 explained) |
| `p` PRIVATE | D (ext) | op | roster gated for non-members | **FULL** (More rules) |
| `h` HIDDEN | D (ext) | op | omitted from LIST/NAMES enumeration | **FULL** (More rules) |
| `u` KNOCK | D (ext) | op | enables KNOCK | **FULL** (More rules: "Allow join requests"; Ask to join + host Invite) |
| `a` AUTHONLY | D (ext) | op | accounts only (477) | **FULL** (More rules; 477 explained) |
| `f` NOFORMAT (MODEX only) | ext | op | strips formatting | `/modex` cannot set it either (query-only) → **MISSING** |
| `d` CLONEABLE | D (ext) | op | auto-clone `#c1…` when full | **FULL** (More rules) |
| `E` CLONE / `r` REGISTERED / `z` SERVICE | D (ext) | **oper** | markers | Slash |
| `x` AUDITORIUM | D (ext) | op | members hidden from each other | **FULL** to set (More rules); the roster still cannot explain an empty NAMES |
| `w` NOWHISPER | D (ext) | op | 923 | **FULL** (More rules) |
| `V` NOCOMICDATA | D (ext) | op | DATA refused (531) | **FULL** (More rules) |
| `U` OPMODERATE | D (ext) | op | blocked messages routed to ops | **FULL** to set (More rules); held messages are not rendered specially |
| `F` FREETARGET / `D` DISFORWARD | D (ext) | op | forward-target policy | **FULL** (More rules, Forwarding) |
| MLOCK (services) | 325 `RPL_CHANNELMLOCK` | founder | Locks modes | **FULL** ("Locked rules"; a refused change shows "That rule is locked") |

## 8. Member status prefixes (`PREFIX=(YQqov)*!.@+`, `src/daemon/chanmode.zig:405`)

| Mode | Prefix | Meaning | Elm display | Elm control |
|---|---|---|---|---|
| `Y` | `*` | derived net-oper override tier | **FULL** (`Modes.statusRank`) | n/a |
| `Q` | `!` | founder (creator) | **FULL** | n/a (not grantable) |
| `q` | `.` | owner | **FULL** | **PARTIAL**: only the Stewardship hand-over (`src/Stewardship.elm:481-493`; Room care "Hand it over" now has an offer/accept the other person sees, `src/RoomTransfer.elm`, v3/gap-people). There is no stand-alone co-owner grant. |
| `o` | `@` | operator | **FULL** | **FULL** (op/deop desk, profile, `/op`) |
| `v` | `+` | voice | **FULL** | **FULL** (`/voice`, desk) |
| `MODEX #c,nick` member names | 826/827 | — | **PARTIAL** (query) | — |

## 9. User modes (`src/proto/usermode.zig:148-166`)

Elm's catalog (`Modes.userModeAccess`, `src/Modes.elm:351`) now drives
Preferences → Privacy (v3/gap-usermodes, `View.UserModes.privacyPanel`
`src/View/UserModes.elm:141`). `UserModes.privacyModes` (`src/UserModes.elm:131`)
lists the seven modes the server both lets a user set **and** enforces. A
switch sends `MODE <me> ±X` (`UserModes.modeLine` `src/UserModes.elm:609`),
is seeded by 221 and the live `MODE` echoes (`foldWire` `src/UserModes.elm:2006`,
`:2025`) and is re-applied after every connect. Typing `/mode <ownnick> ±X`
still works. Tests `UserModesTest`, `GapUserModesTest`.

| Mode | Policy | Effect | Elm |
|---|---|---|---|
| `i` invisible | user | hidden from WHO/ISON for strangers | **FULL** (Preferences → Privacy → "Invisible to strangers") |
| `B` bot | user | WHOIS 335, `bot` tag | **MISSING** (bots are external) |
| `D` deaf | user | no channel messages | **N/A**: no server code reads it (`.deaf` appears only in the catalog and tests, `src/proto/usermode.zig:19,152`), so a switch would change nothing; Elm deliberately omits it (`src/UserModes.elm:116-121`) |
| `g` caller-id | user | DMs need ACCEPT (716/717/718) | **FULL** (Privacy → "Approve new conversations", Approved people list, Inbox message requests; v3/gap-usermodes) |
| `C` no-CTCP | user | blocks direct CTCP | **FULL** (Privacy → "Block app pings"; the channel-level `+C` is a "More rules" switch, §7) |
| `R` regonly-PM | user | only logged-in users may DM you | **FULL** (Privacy → "Only signed-in people can message me"; a refused DM shows as an inbox error, 477) |
| `p` hide-chans | user | hides your channels in WHOIS | **FULL** (Privacy → "Hide my rooms") |
| `Q` no-forward | user | never forwarded by `+f` | **FULL** (Privacy → "Never redirect me") |
| `H` hide-oper | user (oper) | | **MISSING** |
| `P` media-presence-private | user / oper cross-user | hides call presence | **PARTIAL**: the self switch is FULL (Privacy → "Keep calls quiet"); oper cross-user `MODE nick +P` has no UI |
| `j` override | oper:oper_override | audited channel override | **MISSING** |
| `r`, `x`, `a`, `o` | server | registered / cloaked / admin / oper | **PARTIAL**: `o`/`a` via 381 badge only |
| `z` | server catalog (TLS); **oper cross-user `MODE nick +z` = GAG** (`applyGag` `src/daemon/server.zig:23137`, `:23219-23228`) |  | **FULL** for the oper GAG (Silence tab, `OperPlan.GagUser` `src/OperPlan.elm:270`; v3/gap-oper); the server-managed TLS marker is never shown |
| `M` media-tx-deny | server / oper cross-user (`handleOperUserMode:23812`) | blocks MEDIA tx | **MISSING** |

## 10. Extbans (`EXTBAN=$,acgmrz`, `src/proto/extban*.zig`)

| Type | Meaning | Elm |
|---|---|---|
| `$a:<account>` | account | **FULL** (builder `Modes.buildExtBan`, `src/View/Bans.elm:217-280`) |
| `$c:<#chan>` | member of channel | **FULL** |
| `$g:<CC>` | GeoIP country | **FULL** |
| `$m:<mask>` | mute-mask | **FULL** |
| `$r:<realname>` | realname | **FULL** |
| `$z:<certfp>` | TLS fingerprint | **FULL** |
| `$~…` negation | | **FULL** |
| `$o:<class>` | **not advertised** | Elm offers it anyway → **drift** |

## 11. IRCX `PROP` keys

Catalog: `src/proto/ircx_prop_store.zig:152-243`. Channel built-ins and
validators: `channelBuiltinGet` `src/daemon/server.zig:39925` and
`channelBuiltinSet` `:40184-40285`. Write access: `propAccess` `:39768`
(channel = op → `owner` level; user = self; oper = sysop). Entities: `#chan`,
`nick`, `#chan:nick` (member).

| Key | Entity | Read / write | Server effect | Elm |
|---|---|---|---|---|
| `OID NAME CREATION MEMBERCOUNT` | channel | read-only | computed | **CORE-ONLY** (`foldPropRow:23455`; 329 creation is used) |
| `MEMBERLIMIT` / `MEMBERKEY` | channel | host / owner (secret) | writes through to `+l`/`+k` | **N/A** (Elm uses MODE) |
| `FOUNDERKEY OWNERKEY HOSTKEY VOICEKEY` | channel | owner/host, **secret per tier** | a keyed JOIN matching `FOUNDERKEY`/`OWNERKEY`/`HOSTKEY` grants Q/q/o (`src/daemon/server.zig:22841-22852`); `VOICEKEY` is stored and read-gated only | **MISSING** ("role keys" UI) |
| `LANGUAGE` (31) / `SUBJECT` (31) | channel | host | LISTX filters (`S=`, language) | **MISSING** |
| `TOPIC` (160) | channel | host | IRCX topic mirror | **N/A** |
| `ONJOIN` / `ONPART` (255) | channel | host | server NOTICE to the joiner/leaver `:srv NOTICE <nick> :[#chan] <text>` (`deliverChannelPropMessage` `src/daemon/server.zig:22965-22970`) | **FULL** (v3/gap-chanserv: the notice is a system row in the room; host settings "Welcome message" / "Goodbye message") |
| `PICS` (255) | channel | sysop_manager | LISTX 813 | **N/A** |
| `CLIENT LAG ACCOUNT CLIENTGUID SERVICEPATH` | channel | host/owner/sysop | IRCX legacy | **N/A** |
| `no-ai` / `local-only` / `server-ai-ok` (`0\|1`) | channel | host | AI consent policy | **PARTIAL**: read (`src/AiPolicy.elm:66-69`); no setter UI |
| `history-policy` (`public\|members\|opers`) | channel | host | CHATHISTORY visibility | **FULL** (`src/View/RoomSettings.elm:701`, `src/HistoryPolicy.elm`) |
| `encryption-policy` (`off\|optional\|required`) | channel | host | `required` rejects plaintext (`FAIL PRIVMSG E2EE_REQUIRED`) | **FULL** (`src/RoomSettings.elm:1107`, `src/View/RoomSettings.elm:656`) |
| `membership-visibility` (`ordinary\|sealed`) | channel | host | sealed rooms refuse NAMES/WHO (`src/proto/sealed_room.zig`) | **MISSING** |
| `EPHEMERAL` (secs; 0 off) | channel | host | hides older replay | **FULL** (`src/RoomSettings.elm:1088`, retention section `src/View/RoomSettings.elm:387`) |
| `RETAIN` (secs) | channel | host | **deletes** rows after TTL (`channelRetainTtlMs` `src/daemon/server.zig:27040`) | **MISSING** |
| `SLOWMODE` (secs ≤ 86400) | channel | host | per-member send gap; 404 "(slowmode)"; set automatically by the raid shield (§17) | **FULL** (host setting "Slow mode", composer countdown, honest 404 copy; "0" turns it off because the server refuses an empty value) |
| `SLOWVOICE` (`0\|1`) | channel | host | whether voice/ops wait too | **FULL** ("Hosts and voiced people wait too"; "1" restores the exemption) |
| `HOLD` (n) | channel | host | first *n* messages per new member held for oper review (`captureFirstHold` `src/daemon/server.zig:43395`; sender gets NOTICE `HOLD stored`) | **MISSING** (sender sees nothing; message looks sent) |
| `PINS` (csv msgids) | channel | host | pinned messages | **FULL** (via PROP, `writePins:16409`, `src/View/Pins.elm`) |
| `onyx_server.topics` (csv) | channel | host (auto-added) | named-conversation registry | **PARTIAL**: topics are used through tags; there is no registry editor |
| `ocean.event` (client key) | channel | host | stored generically | **FULL** (`scheduleChannelEvent:16647`, `/event`) |
| `URL GENDER PICTURE BIO EMAIL` | user profile | self | IRCX user profile | **MISSING** (Elm uses METADATA `ocean.*` instead) |
| `STATUS` (client key) | user | self | — | **FULL** (v3/gap-auth, D4: `setCustomStatus` `src/App.elm:23240` sends `PROP <ournick> STATUS`; a 913 shows a toast) |
| `e2ee.device.<id>` | user | self (via E2EEKEY) | signed device facts | **FULL** (via E2EEKEY) |
| `identity.key.<label>` | user | self (via IDENTITY) | | **FULL** (automated) |
| Read markers | — | `ERR_SECURITY` "use MARKREAD" | | N/A |
| PROP errors 913/906/905/907/908 | — | — | — | **PARTIAL**: 913 is explained (`authGateNoAccess` `src/App.elm:53771`); 905/907/908 reach Activity or the inbox only as generic lines (`isErrorNumeric` `src/App.elm:11061`) |
| `ocean.watch` (client key) | channel | custom key: needs `propAccess` owner level (a channel op); ≤512 bytes (`ircx.MAX_PROP_VALUE` `src/proto/ircx.zig:13`) | stored generically; the setter gets 818+819, other IRCX members get `:setter PROP #c ocean.watch :value` | **PARTIAL** (v3/gap-watch): Watch Together shares a title, optional link, play/pause state and position (`WatchTogether` `src/WatchTogether.elm`, room card `src/View/Thread.elm:68` / `View/WatchTogether.elm:116`, header menu `View/RoomHeader.elm:289`, `PROP` writes `src/App.elm:16211`; tests `WatchTogetherTest`, `WatchTogetherAppTest`). It is a timeline and link, not a media relay. **SERVER:** only channel operators may write a custom key, so only ops can start, join, pause or hand off; other members can watch the clock but not take part |

## 12. `METADATA` keys (draft/metadata-2)

`handleMetadata` `src/daemon/server.zig:42155-42290`: `GET`, `LIST`, `SET`,
`CLEAR` only (no `SUB`/`SYNC`). `*` = self.

| Key | Writer | Server use | Elm |
|---|---|---|---|
| `location`, `country` | server at connect (`setGeoLocation:39078`) | `!weather` default and units | **MISSING** (no "my location" setting; users could `METADATA * SET location`) |
| `weather_location` (on channel) | `!setweather` | `!weather` channel default | **N/A** (fantasy) |
| `ocean.display-name`, `ocean.pronouns`, `ocean.bio`, `ocean.accent`, `ocean.links`, `ocean.banner` (+ unprefixed aliases) | client | wire-format profile (CLAUDE.md) | **FULL** (`metadataProfilePatch:9653`, `setOwnMetadata:9860`, Profile view) |
| `ocean.dm-key`, `ocean.dm-keys` | client | DM E2EE key directory | **FULL** (ports.js:9401, `src/App.elm:39431`) |

## 13. Event Spine (`EVENT`) and OBSERVE

- **Categories** (`src/daemon/event_spine.zig:12-60`): `CONNECT DISCONNECT
  SERVER_LINK FLOOD ERROR ANNOUNCE OPER_ACTION KILL SPAM DEBUG POLICY SERVICE
  SECURITY`. Separate IRCX token planes: `CHANNEL MEMBER USER MEDIA`.
- **Severities:** `debug info notice warn error critical`.
- **Wire:** `@onyx_server.io/category=<CAT>;onyx_server.io/severity=<sev>
  :<origin> EVENT <you> <BODY>` (`renderEventTagged`
  `src/daemon/event_spine.zig:482`).
- **Numerics:** 806 add, 807 delete, 808 start, 809 list, 810 end, 821 dup,
  822 missing, 823 no such event, 825 change (server enum
  `src/daemon/server.zig:1787-1795`).

| Subcommand | Who | Server | Elm |
|---|---|---|---|
| `EVENT ADD\|DEL\|CLEAR\|LIST CHANNEL\|MEMBER\|MEDIA [mask]` | any member | `handleEvent:37040` (non-oper limited to these 3 planes) | **PARTIAL**: `EVENT ADD MEDIA *` only (`src/App.elm:5475`); CHANNEL/MEMBER planes unused |
| `EVENT ADD\|DEL <category>\|ALL` | oper:event_subscribe | `:37218` usage | **FULL** (v3/gap-oper: Live tab follow/unfollow per category, `/events` `src/App.elm:15690`); delivered lines now fill the Live feed (D5 fixed) |
| `EVENT LIST` | oper | 808/809/810 | **FULL** (v3/gap-oper: `OperPlan.EventsReport` `src/OperPlan.elm:291`; the 808-810 reply is classified as the followed-category list, `OperReply.EventCategories` `src/OperReply.elm:185`) |
| `EVENT SEVERITY <floor>` | oper | `handleEventSeverity:37259` | **FULL** (v3/gap-oper: severity floor in the Live tab, `OperPlan.MinSeverity` `src/OperPlan.elm:290`) |
| `EVENT REPLAY [JSON] …` | oper | `handleEventReplay:37283` | **FULL** (`src/EventReplay.elm`, desk console `src/View/ModDesk.elm:920`) |
| `EVENT STATS [JSON]` (`operator_surfaces` map) | oper | `handleEventStats:37406` | **FULL** (v3/gap-oper: `OperPlan.EventStats` `src/OperPlan.elm:292`, button in `View/OperFeedPanel.elm`) |
| `EVENT BROADCAST :text` (ANNOUNCE to opers; the WALLOPS replacement) | oper | `src/daemon/server.zig:37052-37066` | **FULL**: send (desk + `/broadcast`); received announces now show in the Live feed (D5 fixed). Elm's `WALLOPS` fold (`foldWallops` `src/App.elm:21116`, arm `:6241`) still never fires because the server never sends WALLOPS |
| `EVENT OBSERVE <mask> [connect quit nick join part host oper]` / `LIST` / `OFF` → `EVENT <you> OBSERVE …` | oper | `handleObserve:37943`; action tokens `src/daemon/observe.zig:31-41` | **FULL**: send (`/observe`, desk; same token set as `operObserveActions`, `src/App.elm:16827`); pushes now show in the Live feed (D5 fixed) |

## 14. Numerics

**Sources:** `src/proto/numeric.zig:12-260` (full enum),
`src/daemon/server.zig:1700-1841` (server-local enum), and literal emitters:
USERIP 340 (`src/proto/userip.zig:20`), ETRACE 709
(`src/daemon/oper_cmd.zig:784`), IRCX AUTH 910/912
(`src/daemon/server.zig:40922`, `:41068`), and the PROP/ACCESS/LISTX/MODEX
builders in `src/proto/ircx_*.zig`.

**Elm side:** `foldLine` arms are at `src/App.elm:4926-6300`; numerics claimed before it by
the auth, user-mode, chanserv and operator folds are noted per row. A numeric
nothing claims goes to `logNumeric` (§0.1). In the Elm column, **Activity** means
the line is logged and shown in the Activity sheet; **inbox error** means it also
raises an error row (error-class numerics 4xx/5xx/9xx, `routeErrorNumeric`
`src/App.elm:11075`). `FULL` and the other statuses are as in the Legend.

**Two server-side code-point collisions:**

- IRCX errors `900 904 905 906 907 908` (`src/daemon/server.zig:1829-1833`)
  reuse SASL numerics `900 903-908`. Elm only treats `903/904/905` as SASL
  while an exchange is in flight (COVERAGE "IRCX-reuse pass-through").
- `489` is `ERR_SECUREONLYCHAN` in the server enum (`src/daemon/server.zig:1705`)
  but `ERR_VOICENEEDED` in `src/proto/numeric.zig:213`.
- The EVENT numerics differ too: the server enum has `806/807` for add/delete
  (`:1787-1788`), while `src/proto/numeric.zig:234-241` has `808` for add and
  `824` for delete.

| Code(s) | Name | Emitted by | Elm |
|---|---|---|---|
| 001 | WELCOME | registration | **FULL** (`src/App.elm:5372`) |
| 002, 003 | YOURHOST, CREATED | registration | Activity |
| 004 | MYINFO (version) | registration | **FULL** (`src/App.elm:4944`) |
| 005 | ISUPPORT | registration, VERSION | **FULL** (`src/App.elm:4929`) |
| 015/017 | MAP/MAPEND | MAP | Activity |
| 200-209, 205, 262 | TRACE*, ENDOFTRACE | TRACE, SESSIONS | Activity; the oper SESSIONS rows 204/205/262 are classified for the Abuse tab (`OperReply` `src/OperReply.elm:219-225`, v3/gap-oper) |
| 211-219, 242, 243, 249, 250 | STATS* | STATS, LUSERS(250) | Activity; an operator report window captures them in the desk (`OperConsole.observeUnclaimed` `src/OperConsole.elm:1297`) |
| 221 | UMODEIS | MODE self | **FULL** (v3/gap-usermodes: `UserModes.foldWire` `src/UserModes.elm:2006` seeds the Privacy switches; the generic arm `src/App.elm:5341` still logs it) |
| 251, 252, 254, 255 | LUSER* | LUSERS | **FULL** (home stats) |
| 253, 265, 266 | LUSERUNKNOWN, LOCAL/GLOBALUSERS | LUSERS | Activity |
| 256-259 | ADMIN* | ADMIN | Activity |
| 270 | PRIVS | PRIVS | **FULL** for opers (`OperReply` `src/OperReply.elm:233`, `View/ModDesk.elm:529-548`) |
| 271/272 | SILELIST | SILENCE | **FULL** (v3/gap-usermodes: `foldWire` `src/UserModes.elm:2155`, `:2163`) |
| 276 | WHOISCERTFP | WHOIS | **FULL** |
| 281/282 | ACCEPTLIST | ACCEPT | **FULL** (v3/gap-usermodes: `foldWire` `src/UserModes.elm:2038`, `:2047`) |
| 301 | AWAY | PRIVMSG to away user, WHOIS | **FULL** |
| 302, 303 | USERHOST, ISON |  | Activity (unused) |
| 305/306 | UNAWAY/NOWAWAY | AWAY | **FULL** |
| 311-313, 317-320, 330, 335, 338, 671 | WHOIS* | WHOIS | **FULL** (`src/App.elm:6109-6151`) |
| 314, 369, 406 | WHOWAS*, WASNOSUCHNICK | WHOWAS | **FULL** (v3/gap-usermodes: WHOWAS in `foldWire` `src/UserModes.elm:2166`, `:2209`, `:2201`) |
| 315, 352, 354 | WHO/WHOX | WHO | 352 **FULL**; 354 **FULL** for the token-616 roster WHOX (v3/gap-people: `PeerAccount.parseWhoxRow` `src/App.elm:5005`), any other 354 and 315 → Activity |
| 321/322/323 | LIST | LIST | **FULL** (browser) |
| 324, 329 | CHANNELMODEIS, CREATIONTIME | MODE query | **FULL** |
| 325 | CHANNELMLOCK | MODE/services | Activity (a refused change to a locked rule is explained from the services NOTICE, `Chanserv.foldServerNotice` `src/Chanserv.elm:2591`) |
| 331/332/333 | TOPIC | JOIN/TOPIC | **FULL** (333 folded with 332) |
| 340 | USERIP | USERIP | **FULL** for opers (`OperReply` `src/OperReply.elm:241`, Abuse tab USERIP) |
| 341 | INVITING | INVITE | Activity (the invite still succeeds) |
| 342 | SUMMONING | SUMMON | Activity |
| 346/347, 348/349 | INVITELIST, EXCEPTLIST | MODE `+I`/`+e` query | **FULL** (v3/gap-chanserv: `Chanserv.fold` `src/Chanserv.elm:2231-2240`, "Mutes and exceptions") |
| 351 | VERSION | VERSION | Activity |
| 353/366 | NAMES | JOIN/NAMES | **FULL** |
| 364/365 | LINKS | LINKS | Activity |
| 367/368 | BANLIST | MODE `+b` query | **FULL** |
| 371-374 | INFO*, ENDOFINFO | INFO, DIRECTORY, MODULES, COMMANDS, OROWASM | Activity |
| 375/372/376 | MOTD | MOTD | **FULL** (collected and shown on Home, §0.1) |
| 381 | YOUREOPER | oper elevation | **FULL** (badge) |
| 382 | REHASHING | REHASH | **FULL** for opers (`OperReply` `src/OperReply.elm:249`, logged on the Network tab) |
| 391 | TIME | TIME | Activity |
| 392-395 | USERS* | USERS | Activity |
| 401 | NOSUCHNICK | many | **FULL** (`fold401:6446`) |
| 402 | NOSUCHSERVER | SQUIT | inbox error + Activity (generic) |
| 403, 404, 405, 407 | NOSUCHCHANNEL, CANNOTSENDTOCHAN, TOOMANYCHANNELS, TOOMANYTARGETS | | **FULL** (`foldErrorNumeric:19976`: inbox error rows) |
| 409, 411, 412 | NOORIGIN, NORECIPIENT, NOTEXTTOSEND |  | inbox error + Activity (generic) |
| 410 | INVALIDCAPCMD | CAP | inbox error + Activity (generic) (`src/App.elm:5885`) |
| 421 | UNKNOWNCOMMAND (also feature-disabled) | dispatch | **FULL** (inbox "Unknown command") |
| 431-433, 437 | nick errors | NICK | **FULL** (`foldNickError`) |
| 438 | NICKTOOFAST | NICK | inbox error + Activity (generic) |
| 441-443, 451, 461, 464, 467 | | | **FULL** (inbox) |
| 456-458 | ACCEPT errors | ACCEPT | inbox error + Activity (generic) |
| 462 | ALREADYREGISTRED |  | inbox error + Activity (generic) (`src/App.elm:5880`) |
| 465 | YOUREBANNEDCREEP |  | inbox error + Activity (generic), and the `ERROR` that follows is explained (D6) |
| 470 | LINKCHANNEL (forwarded) | JOIN `+f` | **FULL** (v3/gap-chanserv: `chanservForwarded` `src/App.elm:50807` says where you landed) |
| 471, 473-477 | join refusals | JOIN | **FULL** (join prompt / inbox; 477 on a room via `foldJoinDenied`) |
| 472 | UNKNOWNMODE | MODE/TEMPMODE | inbox error + Activity (generic) |
| 478 | BANLISTFULL | MODE | inbox error + Activity (generic) |
| 479 | BADCHANNAME | portable | inbox error + Activity (generic) |
| 480 | THROTTLE (`+j`/raid) | JOIN | **FULL** (v3/gap-shell: join prompt "This room is letting people in slowly right now. Try again in a moment."; no countdown) |
| 481 | NOPRIVILEGES | oper gates | inbox error + Activity (generic); the operator desk explains it (`OperReply` `src/OperReply.elm:276`) |
| 482 | CHANOPRIVSNEEDED | | **FULL** (inbox) |
| 489 | SECUREONLYCHAN | JOIN `+S` | **FULL** (v3/gap-shell: `foldJoinDenied` `src/App.elm:11143`) |
| 491 | NOOPERHOST | OPER | **FULL** |
| 502 | USERSDONTMATCH | MODE | inbox error + Activity (generic) |
| 520 | OPERONLYCHAN | JOIN `+O`/`+A` | **FULL** (v3/gap-shell: `foldJoinDenied`) |
| 524 | HELPNOTFOUND | HELP | inbox error + Activity (generic) (`src/App.elm:5012`) |
| 531 | NOCOMICDATA | DATA under `+V` | inbox error + Activity (generic) |
| 704-706 | HELPSTART/TXT/END | HELP | Activity (`src/App.elm:5015-5021`) |
| 709 | ETRACE row | ETRACE | Activity |
| 710/711/713/714 | KNOCK, KNOCKDLVR, CHANOPEN, KNOCKONCHAN | KNOCK | **FULL** (v3/gap-chanserv: `Chanserv.fold` `src/Chanserv.elm:2159-2215`; hosts get an inbox row with an Invite action, the asker sees the outcome) |
| 716/717/718 | CANTSENDTOUSER, TARGNOTIFY, UMODEGMSG (caller-id) | PRIVMSG to `+g` | **FULL** (v3/gap-usermodes: `foldWire` `src/UserModes.elm:2050-2083`; the sender sees "waiting for X to accept you", the target gets a message request) |
| 725/726/727 | TESTLINE/NOTESTLINE/TESTMASK | oper | **FULL** for opers (`OperReply` `src/OperReply.elm:279-295`, Bans tab "Check before banning") |
| 728/729 | QUIETLIST | MODE `+Z` | **FULL** (v3/gap-chanserv: `Chanserv.fold` `src/Chanserv.elm:2225-2228`) |
| 730-734 | MONITOR | MONITOR | **FULL** |
| 761/762, 766 | KEYVALUE, METADATAEND, KEYNOTSET | METADATA | **FULL** (`foldMetadata`, `src/App.elm:6211-6214`) |
| 767/769 | KEYINVALID, KEYNOPERMISSION | METADATA SET | Activity (`src/App.elm:6217-6222`) |
| 800 | IRCX | IRCX/ISIRCX | Activity |
| 801-805 | ACCESS ADD/DEL/START/ENTRY/END | ACCESS, SACCESS | **FULL** (`foldAccess`) |
| 806-810, 821-825 | EVENT add/del/start/list/end, dup/mis/nosuch/change | EVENT | Activity; 808-810 for `EVENT LIST` are classified for opers (`OperReply.EventCategories`) |
| 811-817 | LISTX | LISTX | Activity |
| 818/819 | PROPLIST/PROPEND | PROP | **FULL** (`foldPropRow` `src/App.elm:23455`) |
| 826/827 | MODEXLIST/END | MODEX | **FULL** (`/modex`) |
| 900/901 | LOGGEDIN/LOGGEDOUT | SASL/IDENTIFY/LOGOUT | **FULL** |
| 902 | (not emitted by the server) | — | named arm |
| 903-905 | SASL success/fail/toolong | AUTHENTICATE | **FULL** while an exchange is in flight. v3/gap-shell keeps the server text: a "Two-factor" 904 is claimed by the two-step flow (`foldAuthGateLine` `src/App.elm:53482`, D2 fixed); other reasons are mapped by `GapShell.classifySasl` (`src/GapShell.elm:292`). |
| 906-908 | SASLABORTED, SASLALREADY, SASLMECHS | AUTHENTICATE | inbox error + Activity (generic) (`src/App.elm:5874` still mislabels 906 as RPL_SASLMECHS in its comment) |
| 900, 903-908 (IRCX meaning) | BADCOMMAND, BADLEVEL, BADTAG, BADPROPERTY, BADVALUE, RESOURCE, SECURITY | PROP/DATA | inbox error + Activity (generic) / collision (see above) |
| 910/912 | IRCX AUTH | AUTH | inbox error + Activity (generic) |
| 913 | NOACCESS | PROP/DATA | **FULL** (v3/gap-auth: `authGateNoAccess` `src/App.elm:53771`; a status toast for `*` or your own nick, an inbox error otherwise) |
| 914-916 | DUPACCESS, MISACCESS, TOOMANYACCESSES | ACCESS/SACCESS | inbox error + Activity (generic) |
| 923 | NOWHISPER | WHISPER | inbox error + Activity (generic) |
| 924-927 | NOSUCHOBJECT, NOTSUPPORTED, CHANNELEXIST, ALREADYONCHANNEL | CREATE etc. | inbox error + Activity (generic) |

## 15. Standard replies (`FAIL`/`WARN`/`NOTE`) — full catalog

Emitters: `failReply` / `warnReply` / `noteReply` at
`src/daemon/server.zig:55449-55500`. Clients without `standard-replies` get a
NOTICE instead. The catalog below combines literal codes with the codes
returned by `registerFailCode:44146`, `accountAdminFailCode:44962`,
`channelFailCode:47635`, `akickLiveFailCode:4158`, the device-property
outcome switch (`src/daemon/server.zig:19531-19540`), CHATHISTORY, SETPASS,
RESETPASS, CERTDEL, E2EEGROUP and RENAME.

Elm column: **specific** = dedicated copy/state; **generic** = the server's own text
as an inbox error row (and an Activity line) from the default arm, v3/gap-shell
(§0.2); **toast** = send-failure toast. At `7e03d47f` many rows were **dropped**
(silently ignored); no row is dropped at HEAD.

| Command | Codes | Elm |
|---|---|---|
| FAIL ACCESS | `ACCESS_COPY_FAILED`; NOTE `ACCESS_COPIED` | generic (inbox row, v3/gap-shell) |
| FAIL ACCOUNT (oper) | `ACCOUNT_UNKNOWN BAD_ACCOUNT_NAME INVALID_SUBCOMMAND INVALID_VALUE NEED_MORE_PARAMS TEMPORARILY_UNAVAILABLE` | specific in the operator desk (`OperReply.Failed` `src/OperReply.elm:213`); generic otherwise |
| FAIL ACCOUNTINFO | `ACCOUNT_UNKNOWN TEMPORARILY_UNAVAILABLE` | specific (`src/App.elm:24104`) |
| FAIL ACCOUNTSET | `INVALID_FIELD INVALID_VALUE PRIVILEGED_FLAGS TEMPORARILY_UNAVAILABLE` | specific for the Protection toggles (`GapAccount.classifyReply` `src/GapAccount.elm:575-580`, v3/gap-account), generic otherwise (D1 no longer produces `INVALID_FIELD`) |
| FAIL AUTOJOIN | `ACCOUNT_REQUIRED` | specific (`UserModes.failReply` `src/UserModes.elm:2430`, v3/gap-usermodes) |
| FAIL BATCH | `MULTILINE_INVALID` | generic (inbox row) |
| FAIL CERTADD/CERTLIST/CERTDEL | `CERT_ADD_FAILED NOT_LOGGED_IN NO_CLIENT_CERT TEMPORARILY_UNAVAILABLE CERT_LIST_FAILED CERT_NOT_OWNED CERT_NOT_FOUND CERT_DEL_FAILED NEED_MORE_PARAMS` | generic |
| FAIL CHANNEL | `ACCESS_DENIED ACCOUNT_REQUIRED BAD_CHANNEL_NAME CHANNEL_EXISTS CHANNEL_UNKNOWN INVALID_PARAMS NEED_MORE_PARAMS TEMPORARILY_UNAVAILABLE AKICK_EXISTS LIST_FULL` | specific (`Chanserv.foldFail` `src/Chanserv.elm:2461`; the channel comes from the last `CHANNEL` line this client sent; v3/gap-chanserv) |
| FAIL CHATHISTORY | `ACCESS_DENIED INVALID_PARAMS NEED_MORE_PARAMS NEED_REGISTRATION REPLAY_TOO_LARGE` | specific (history exhausted/error) |
| FAIL CLEAR | `PARTIAL` | generic (inbox row) |
| FAIL CREATE / JOIN / PART / KICK / MODE / TAGMSG / WHISPER | `TEMPORARILY_UNAVAILABLE` (mesh durable admission) | TAGMSG/WHISPER toast; the others generic (inbox row) |
| FAIL DROP | `TEMPORARILY_UNAVAILABLE` | generic |
| FAIL E2EEGROUP / WARN E2EEGROUP | `BAD_PAYLOAD CAP_REQUIRED DEVICE_NOT_OWNED IRCX_REQUIRED NOT_LOGGED_IN NOT_ON_CHANNEL ORIGIN_REJECTED PEERS_NOT_CURRENT SESSION_UNAVAILABLE TARGET_UNAVAILABLE BAD_CHANNEL BAD_KIND BAD_DEVICE BAD_ACCOUNT`; WARN `AUTHORING_QUIESCED TEMPORARILY_UNAVAILABLE` | specific (`foldE2eGroupReply:25996`) |
| FAIL E2EEKEY | `BAD_DEVICE BAD_KEY DURABLE_UNAVAILABLE INVALID_SUBCOMMAND NEED_MORE_PARAMS NOT_LOGGED_IN SIGNER_UNAVAILABLE TEMPORARILY_UNAVAILABLE DEVICE_OWNER_MISMATCH BAD_DEVICE_FACT STALE_FACT REPLAY EQUIVOCATION RESTART_REQUIRED STORE_FAILED` | specific (`foldDirectoryFailure:25200`) |
| FAIL EDIT | `EDIT_FAILED INVALID_PARAMS NEED_REGISTRATION PERMISSION_DENIED UNKNOWN_MSGID` | generic inbox row unless labeled (then the send-failure toast) |
| FAIL FILTER | `INVALID_PATTERN INVALID_SUBCOMMAND NO_SUCH_PATTERN TEMPORARILY_UNAVAILABLE` | specific in the operator desk (`OperReply.Failed`); generic otherwise |
| FAIL GHOST | `ACCOUNT_REQUIRED NICK_NOT_OWNED TEMPORARILY_UNAVAILABLE` | generic (inbox row); the reclaim UI still ends by timeout |
| FAIL GROUP | `ACCOUNT_REQUIRED` | specific (`GapAccount.classifyReply` `src/GapAccount.elm:588`, v3/gap-account) |
| FAIL IDENTIFY | `TEMPORARILY_UNAVAILABLE TOTP_REQUIRED` | specific (`foldIdentifyReply` `src/App.elm:24219`); `TOTP_REQUIRED` now leads into the two-step code entry (v3/gap-auth, D2) |
| FAIL IDENTITY | `BAD_ASSERTION BAD_EPOCH BAD_EXPIRY BAD_LABEL BAD_NODE INVALID_SUBCOMMAND NEED_MORE_PARAMS NOT_LOGGED_IN STALE_EPOCH STORE_FAILED TEMPORARILY_UNAVAILABLE WRONG_NODE` | `STALE_EPOCH` specific; the rest generic (inbox row) |
| FAIL KEYTRANS | `BAD_ACCOUNT BAD_HEAD BAD_NODE BAD_POSITION BAD_SIGNATURE BAD_SIZE BAD_VALUE INVALID_SUBCOMMAND KEY_MISMATCH MISSING_LOG NEED_MORE_PARAMS NO_SUCH_DEVICE NO_SUCH_LEAF TEMPORARILY_UNAVAILABLE UNKNOWN_CHECKPOINT DISABLED INTERNAL_ERROR` | generic |
| FAIL MARKREAD | `NEED_REGISTRATION TEMPORARILY_UNAVAILABLE` | generic (inbox row) |
| FAIL MEDIA | `AUTH_REQUIRED BAD_ABR BAD_CONSENT BAD_E2EE_GROUPKEY BAD_E2EE_HANDSHAKE BAD_E2EE_SENDER BAD_E2EE_TARGET BAD_FINGERPRINT BAD_LAYER BREAKOUT_FAILED CONSENT_REQUIRED DTLS_UNAVAILABLE HAND_FAILED INVALID_KIND INVALID_POSITION INVALID_REACTION INVALID_SUBCOMMAND JOIN_FAILED NOT_IN_CALL NOT_PUBLISHING NO_CODECS NO_COMMON_CODEC NO_OFFER POS_FAILED SECURE_SIGNALING_REQUIRED TRANSPORT_UNAVAILABLE TURN_CUT TX_DENIED UNENROLLED_E2EE_IDENTITY` | specific (media plane fold + engine `voice-core.ts:649`) |
| FAIL MEMO / NOTE MEMO | `ACCOUNT_REQUIRED ACCOUNT_UNKNOWN FORWARD_CYCLE INVALID_ACCOUNT INVALID_SUBCOMMAND MAILBOX_FULL INVALID_MESSAGE TEMPORARILY_UNAVAILABLE` | NOTE specific (ceiling); FAIL specific (`UserModes.failReply`, v3/gap-usermodes) |
| FAIL NAMES / WHO | `MEMBERSHIP_SEALED` | generic (inbox row); the roster still renders empty |
| FAIL PINS | `INVALID_SUBCOMMAND` | generic (inbox row; Elm uses PROP) |
| FAIL PRIVMSG (and NOTICE/TAGMSG where applicable) | `CTCP_BLOCKED E2EE_REQUIRED INVALID_UTF8 INPUT_TOO_LONG ONYX_FILTERED` (content filter or channel word filter, `src/daemon/server.zig:58879`, `:58890`) `TEMPORARILY_UNAVAILABLE` (mesh durable admission) | toast (`humanizeSendFail`); there is no specific "blocked by filter" copy |
| FAIL RECOVER / RELEASE | `ACCESS_DENIED NICK_NOT_REGISTERED TEMPORARILY_UNAVAILABLE` | specific (`GapAccount.classifyReply`, v3/gap-account) |
| FAIL RECOVERYCODES | `ACCOUNT_REQUIRED AUTH_FAILED INSECURE_TRANSPORT INTERNAL_ERROR INVALID_SUBCOMMAND NEED_MORE_PARAMS TEMPORARILY_UNAVAILABLE` | specific |
| FAIL REDACT | `NEED_REGISTRATION UNKNOWN_MSGID` | generic inbox row unless labeled |
| FAIL REGISTER | `ACCOUNT_EXISTS ACCOUNT_FORBIDDEN BAD_ACCOUNT_NAME COMPLETE_CONNECTION_REQUIRED INVALID_EMAIL INVALID_PASSWORD NEED_MORE_PARAMS TEMPORARILY_UNAVAILABLE` | specific (`foldRegisterFail`) |
| FAIL RENAME | `CANNOT_RENAME CHANNEL_NAME_IN_USE INVALID_PARAMS` | specific |
| FAIL RESETPASS | `BAD_CODE EXPIRED NO_REQUEST TEMPORARILY_UNAVAILABLE TOO_MANY_ATTEMPTS UNAVAILABLE INVALID_PASSWORD` | specific (`AuthGate.resetFailCopy` `src/AuthGate.elm:1150`, v3/gap-auth) |
| FAIL SEARCH | `INVALID_PARAMS INVALID_TARGET NEED_REGISTRATION RATE_LIMITED RESULTS_TOO_LARGE` | specific |
| FAIL SESSION / WARN SESSION | `AMBIGUOUS_SID ATTACHMENT_IN_USE CANNOT_DROP_CURRENT INVALID_INDEX INVALID_TOKEN NEED_MORE_PARAMS NO_ATTACHMENT NO_SESSION NO_SUCH_SESSION RESUME_PENDING STALE_LIST`; WARN `ORIGIN_UNREACHABLE RESUME_CREDENTIAL_PRESERVED TEMPORARILY_UNAVAILABLE` | specific (`foldSessionReply:20298`) |
| FAIL SESSIONTOKEN | `INSECURE_TRANSPORT NOT_LOGGED_IN TOKEN_ISSUE_FAILED TEMPORARILY_UNAVAILABLE` | generic (inbox row) |
| FAIL SETPASS | `ACCOUNT_REQUIRED INVALID_PASSWORD RESET_NOT_AUTHORIZED TEMPORARILY_UNAVAILABLE WRONG_PASSWORD` | specific (`AuthGate.setPassFailCopy` `src/AuthGate.elm:1179`, v3/gap-auth) |
| FAIL SUCCESSOR | `ACCOUNT_UNKNOWN INVALID_SUBCOMMAND INVALID_VALUE NOT_FOUNDER TEMPORARILY_UNAVAILABLE NEED_MORE_PARAMS` | specific (`Chanserv.foldFail`, v3/gap-chanserv) |
| FAIL TOTP | `ACCOUNT_REQUIRED ALREADY_ENROLLED INSECURE_TRANSPORT INTERNAL_ERROR INVALID_CODE INVALID_SUBCOMMAND NEED_MORE_PARAMS NO_PENDING TEMPORARILY_UNAVAILABLE` | specific (`foldTotpFail`) |
| FAIL UNREJECT | `INVALID_IP` | specific in the operator desk (`OperReply.Failed`); generic otherwise |
| FAIL VERIFY | `ACCOUNT_REQUIRED EXPIRED INVALID_CODE TEMPORARILY_UNAVAILABLE TOO_MANY_ATTEMPTS` | specific |
| FAIL VHOST | `ACCOUNT_REQUIRED HOST_NOT_YOURS HOST_TAKEN INVALID_HOST TEMPORARILY_UNAVAILABLE` | generic (inbox row) |
| FAIL WEBAUTHN | `ATTESTATION_REQUIRED BAD_ACCOUNT BAD_ATTESTATION BAD_AUTHDATA BAD_CLIENT_DATA BAD_CREDENTIAL BAD_CREDENTIAL_ID BAD_LABEL BAD_ORIGIN CHALLENGE_MISMATCH CREDENTIAL_ID_MISMATCH INTERNAL_ERROR INVALID_SUBCOMMAND LABEL_TOO_LONG NEED_MORE_PARAMS NOT_CONFIGURED NOT_LOGGED_IN NO_CREDENTIAL NO_PENDING RP_MISMATCH TEMPORARILY_UNAVAILABLE UNSUPPORTED_KEY USER_PRESENCE_REQUIRED USER_VERIFICATION_REQUIRED WRONG_TYPE` | specific (`foldPasskeyReply:26017`) |
| FAIL WEBPUSH | `ACCOUNT_REQUIRED DISABLED INVALID_ENDPOINT INVALID_KEY INVALID_SUBCOMMAND NEED_MORE_PARAMS NOT_SUBSCRIBED TEMPORARILY_UNAVAILABLE TOO_MANY_SUBSCRIPTIONS` | generic (inbox row); ports.js still only checks send success |

## 16. Other server-originated lines a client must understand

| Line | Server | Elm |
|---|---|---|
| `ERROR :<reason>` (Excess Flood, Ping timeout, Registration timeout, draining, reputation, too many connections, SACCESS, Closing Link (Killed …), Banned) | §0.4 D6 | **FULL** (v3/gap-shell: inbox row, connect-gate / banner reason; bans, kills, ghosting and "Closing Link" stop the reconnect; `foldServerError` `src/App.elm:10708`) |
| `:<oper> KILL <you> :<reason>` | `src/daemon/oper_cmd.zig:93` | **FULL** (`foldKill` `src/App.elm:10776`) |
| `ERROR :Ghosted by <nick>` | `handleGhost:47197` | **FULL** (`foldServerError`: "Another session on your account signed this one out."; no auto-reconnect) |
| `CHGHOST` | VHOST | consumed silently |
| `RENAME #old #new :reason` | RENAME | **FULL** |
| `INVITE`, `ACCOUNT`, `AWAY`, `SETNAME`, `TAGMSG`, `REDACT`, `MARKREAD`, `METADATA`, `PROP` | various | **FULL** (arms `src/App.elm:5043-6232`) |
| `:<nick> ACTIVITY #c typing <state>` / react tally | ACTIVITY | **FULL** |
| `:<srv> PINS #c :ids` | PINS | not used (Elm reads PROP) |
| `:<srv> NOTICE <you> :[#c] <ONJOIN text>` | §11 | **FULL** (system row in the room, v3/gap-chanserv) |
| `:<srv> NOTICE #c :<fantasy reply>` | `fantasyReply:39116` | rendered as a channel notice |
| `:<srv> NOTICE <you> :WELCOME :<line>` (onboarding pack) | `handleWelcome:28386` | **FULL** (Home "Getting started" card, v3/gap-shell) |
| `:<srv> NOTICE <you> :MEMO from <acct> :<text>` | MEMO delivery | **FULL** |
| `:<srv> NOTICE <you> :HOLD stored` | `captureFirstHold:43395` | Activity only (the held sender gets no explanation) |
| `:<srv> NOTICE <you> :CHALLENGE pow\|question …` | D3 | **FULL** (answered, v3/gap-auth, D3) |
| `REGISTER SUCCESS <acct> :…` / `RESETPASS SUCCESS …` |  | REGISTER **FULL**; RESETPASS **FULL** (v3/gap-auth) |
| `BATCH +id netsplit\|netjoin <servers>` | `src/daemon/netsplit_batch.zig` | QUITs/JOINs fold one by one; no summary |

## 17. Protection and abuse subsystems (user-visible behaviour)

| Subsystem | Server | Trigger → what the offender sees | What ops/opers see; controls | Elm |
|---|---|---|---|---|
| **Raid shield** (brief) | `src/daemon/raid_shield.zig`; `noteRaidJoin` `src/daemon/server.zig:26995`; `evaluateRaidShield:27004`; `+j`/network guard `:22665-22685`; config `raid_joins`/`raid_window` (`src/daemon/config_format.zig:438-441`) | **Two layers.** (1) Join throttle: channel `+j joins:secs`, or the network default `raid_joins`/`raid_window` (0 = off). Over budget → `480 :Cannot join channel (+j) - join rate exceeded`. Opers and invitees bypass. (2) Mesh correlator: a GCRA burst (5/s, burst 4) with joins from ≥3 distinct Mooring peers inside 2 s engages that channel. It auto-sets `PROP SLOWMODE 10` (setter `raid-shield`), relaxes after 30 s quiet, and is checkpointed across Helix. While any channel is engaged and `[challenge]` is on, **every new connection gets a pre-001 CHALLENGE** (D3). | Oper Event Spine `FLOOD possible raid on #c…` (`raidAlert:55804`) and `FLOOD raid shield engaged slowmode on #c` | 480 → join-prompt copy (v3/gap-shell); slow mode is a host setting with a composer countdown (v3/gap-chanserv); CHALLENGE answered (D3 fixed, v3/gap-auth); oper `FLOOD` lines in the Live feed (D5 fixed, v3/gap-oper) |
| Flood guard | `src/daemon/flood_guard.zig`; `src/daemon/server.zig:17676-17694` | Weighted token buckets per connection class; throttling still processes lines; sustained excess → `ERROR :Excess Flood` + close | `noteAccountAbuse` score (oper `ABUSE`) | `ERROR :Excess Flood` is now shown (D6). It is not in `GapShell.isFatalClose` (`src/GapShell.elm:421`), so the normal reconnect backoff still applies after it. |
| Slowmode | `SLOWMODE`/`SLOWVOICE` props; `noteSlowmodeSend:26928` | `404 #c :Cannot send to channel (slowmode)` (`:58213`) | op sets prop; raid shield sets it | **FULL** (v3/gap-chanserv): the 404 "(slowmode)" refusal is explained, the composer counts down (`View/Chanserv.elm:1297 slowState`), hosts set it in "Welcome and slow mode" (`View/Chanserv.elm:182 paceSection`) |
| First-message hold | `HOLD` prop; `captureFirstHold:43395`; `src/daemon/first_hold.zig` | The first *n* PRIVMSGs of a member are stored, not delivered; NOTICE `HOLD stored` | oper `HOLD RELEASE\|DROP #c nick` (release re-broadcasts as `nick!nick@held`) | **PARTIAL**: opers have `HOLD RELEASE\|DROP` in the Content tab (v3/gap-oper); the sender's row still looks sent and there is no room setting for it. **SERVER:** there is no queue listing command |
| Content filter (Koshi) | `src/daemon/content_filter.zig`; send path `:58879` | `FAIL PRIVMSG ONYX_FILTERED :Message blocked by the content filter` | oper `FILTER ADD\|DEL\|LIST` | oper `FILTER` list/add/remove in the Content tab (v3/gap-oper); the sender still gets a generic toast with the server text (no specific "blocked by the content filter" copy) |
| Channel word filter | `src/daemon/svc_chanbadwords.zig`; `:58890` | `FAIL PRIVMSG ONYX_FILTERED :…channel word filter` (non-ops) | op `CHANBADWORDS` | toast; no CHANBADWORDS UI |
| Spam trap | `src/daemon/spamtrap.zig`; `spamtrapCheck:55815` | Silent; the offender is flagged | Oper `FLOOD spamtrap tripped …`; `SPAMTRAP` | oper `SPAMTRAP` in the Content tab; the `FLOOD spamtrap tripped` events show in the Live feed (v3/gap-oper, D5 fixed) |
| Shun (silent mute) | `src/daemon/shun.zig`; check `:26404` | Messages silently dropped | oper `SHUN`/`UNSHUN` | oper `SHUN`/`UNSHUN` in the Silence tab (v3/gap-oper); the shunned user cannot tell (by design) |
| GAG (IRCX `+z`) | `src/daemon/gag_set.zig`; `applyGag:23137` | IP-bound silence surviving reconnect | oper `MODE nick +z` | oper Gag / un-gag in the Silence tab (`MODE nick +z`, v3/gap-oper) |
| Warden (K/D/X-lines unified) | `src/daemon/warden.zig`; `src/daemon/oper_cmd.zig:506-650` | refuse / expel (`ERROR :Closing Link …`) / quarantine (cannot join: 474 "You are quarantined") / require_auth | oper `WARD`, `KLINE`, `DLINE`, `XLINE`, `TESTLINE` | oper `WARD`/`KLINE`/`DLINE`/`XLINE`/`TESTLINE` in the Bans tab (v3/gap-oper); `ERROR` now shown (D6); a quarantine 474 still shows as a generic ban refusal |
| Quarantine move | `handleQuarantine:43538` | Parted everywhere, joined to the quarantine channel | oper `QUARANTINE` | oper `QUARANTINE` in the Silence tab; the moved person still sees ordinary PART/JOIN with no explanation |
| Clone limits (local + mesh) | `src/daemon/clone_limit.zig`, `src/daemon/mesh_clones.zig`; `:11744` | `ERROR :Too many connections from your host` | oper `CLONES` | `ERROR` now shown (D6); oper `CLONES` in the Abuse tab |
| IP reputation | `src/daemon/ip_reputation.zig`; `:11724` | `ERROR :Connection refused (reputation)` **or** CHALLENGE (D3) | `ABUSE`, `UNREJECT` | `ERROR :Connection refused (reputation)` is shown and stops the reconnect (D6); a CHALLENGE hold is answered (D3); oper `ABUSE` (Abuse tab) and `UNREJECT` (Network tab) |
| DNSBL | `src/daemon/dnsbl.zig`, `src/daemon/dnsbl_resolver.zig`; `[dnsbl] action` (`src/daemon/server.zig:2700`) | Warden ban (closes) or mark | `ABUSE` | the `Banned` / "Connection refused" `ERROR` is shown and stops the reconnect (D6); oper `ABUSE` |
| Connection throttle | `throttle_connects` (`src/daemon/config_format.zig:434-435`) | refused before welcome | `UNREJECT <ip>` | shown if the daemon sends an `ERROR` line (D6); oper `UNREJECT` in the Network tab |
| Nick delay | `src/daemon/nick_delay.zig`; `:18208`, `:43047` | `437 <nick> :Nick is held (nick delay); try again shortly` | owner `RELEASE`/`RECOVER` | 437 → "Nick/channel temporarily unavailable" notice (`src/App.elm:10589-10597`); Account → "Recover a name" has `RELEASE`/`RECOVER` (v3/gap-account) |
| Nick enforcement (ENFORCE/SECURE) | `src/daemon/nick_enforcement.zig`, `src/daemon/svc_enforce.zig` | Unauthenticated holder of a registered nick is force-renamed to `Guest…` after a grace period | `ACCOUNTSET … enforce\|secure on\|off`, `RECOGNIZE` | Account → Protection toggles `ACCOUNTSET … enforce\|secure` (v3/gap-account); rename handled (`forcedGuestRename` `src/App.elm:27271`, auto-reclaim `startNickReclaim:27289`) |
| Login throttle | `src/daemon/svc_login_throttle.zig` | IDENTIFY lockout (464/FAIL) | — | generic |
| Account abuse score | `src/daemon/account_abuse.zig`; `noteAccountAbuse:26382` | Survives reconnect | `ABUSE <nick>` | N/A |
| Challenge ladder | `src/daemon/challenge.zig` | §1, D3 | `CHALLENGE METHOD\|QUESTION` | **FULL**: client answer (v3/gap-auth), oper `CHALLENGE METHOD\|QUESTION` in the Content tab (v3/gap-oper) |
| Appeals | `src/daemon/appeal.zig`; `handleAppeal:27892` | Banned user may `APPEAL <text>` once per window, even pre-registration → `APPEAL filed <id>` / `already filed` | `APPEAL LIST`, `APPEAL ANSWER <id> :text` (audited) | **FULL** both sides (v3/gap-oper): connect-screen "Appeal a ban" / `/appeal`; Appeals tab for `APPEAL LIST` / `ANSWER` |
| Sealed rooms | `src/proto/sealed_room.zig` | `FAIL NAMES\|WHO MEMBERSHIP_SEALED` | `membership-visibility` prop | `FAIL NAMES\|WHO MEMBERSHIP_SEALED` is a generic inbox row; the roster still renders empty |
| Policy generations | `handlePolicy:54998` | — | `POLICY LIST\|ROLLBACK` | **FULL** (v3/gap-oper): Content tab `POLICY LIST` / `ROLLBACK` |
| Connection classes | `src/daemon/conn_class.zig` | Per-class sendq/recvq/flood/max_targets/monitor/silence/require_tls/sasl | `STATS Y`, `STATS i` | N/A; the oper Network tab reports `STATS y` / `STATS i` |

## 18. Bots, webhooks, link previews, uploads, push, HTTP surfaces

| Surface | Server | Elm |
|---|---|---|
| Bot accounts / grants: `BOTGRANT` scopes `speak\|webhook\|history` with TTL; gated-bot speak checks (`botHasSpeakGrant:43452`) | `src/daemon/bot_registry.zig`, `handleBotGrant:7397` | **MISSING** (oper UI) |
| Bot identity: umode `+B`, WHOIS 335, `bot` message tag, `BOT=B` | `src/proto/usermode.zig:149`, `src/daemon/whois.zig:29` | **PARTIAL**: profile badge only (`src/View/Profile.elm:86-88`); no badge in the message list; the `bot` cap is not requested |
| Bot command registry `BOTCMD` | `handleBotCmd:43467`, `src/daemon/slash_cmd.zig` | N/A (bot-side) |
| Incoming webhooks: `WEBHOOK CREATE\|LIST\|DELETE`; HTTP `POST /api/webhooks/<id>/<token>` (Discord-compatible JSON; 204/400/401/404/405/411/413/429; loopback, behind a proxy) | `src/daemon/webhook_http.zig:1-20,173`; render `src/daemon/webhook_render.zig` | **FULL** (management `src/View/RoomTools.elm:24 webhookManager`, any room op via `webhookGate` `src/App.elm:52570`, v3/gap-people; posts render as normal messages) |
| Outbound webhooks `OUTHOOK` (HMAC secret, category mask) | `handleOutboundWebhook:7277`, `src/daemon/webhook.zig` | **MISSING** (oper) |
| Server-side link preview `UNFURL ON\|OFF\|<https url>` → `NOTICE UNFURL title= description= image=` (SSRF-guarded: `unfurl.deniedAddress`) | `handleUnfurl:27752`, `src/daemon/unfurl.zig` | **N/A**: Elm uses the deployment's `/linkpreview` proxy (repo CLAUDE.md) and never uses UNFURL |
| File uploads | **None in the daemon.** "Attachments" in `src/daemon/attachment_*.zig` are *session* attachments, not files. | **FULL** via the external `/upload` service (`src/Upload.elm`, `uploadBridge.smoke.mjs`) |
| Web Push `WEBPUSH SUBSCRIBE\|UNSUBSCRIBE\|LIST` (≤3/account); pushes for `dm` (offline memo), `mention`, `call` invite | `handleWebpush:53189`; `webpushNotifyKind:53542`, `…ChannelMentions:53602`, `…CallInvite:53617` | **FULL** (`ports.js:10178,10251`, `src/Push.elm`, toggle `src/View/Account.elm:480`); LIST unused; FAIL WEBPUSH is a generic inbox row |
| `MEMO_PUSH` mesh hint | `src/proto/memo_push_relay.zig` | N/A |
| HTTP `GET /history` (loopback, TLS 1.3, account-scoped) | `src/daemon/history_http.zig:1-20,116` | N/A (not reachable from a browser) |
| HTTP `/metrics` (Prometheus, loopback) | `src/daemon/metrics_http.zig:192` | N/A |
| ACME http-01 `/.well-known/acme-challenge/` | `src/daemon/acme_http01_server.zig:15` | N/A |
| WebTransport `/wt` | §1 | **MISSING** |
| Public JSON feeds `status.json`, `stats.json`, chanstats `index.json`/`<slug>.json`/`windows.json` | `src/daemon/server.zig:9228`, `:9435-9443`; `src/daemon/chanstats.zig:479-535` | **FULL** (`src/Status.elm:59-61`, `src/Stats.elm:106-108`, `src/View/Status.elm`, `src/View/Stats.elm`) |
| OroWasm plugins (third-party commands after a registry miss) | `src/daemon/server.zig:18083-18107`, `src/wasm/host/*` | **RAW** (any plugin command works only through the raw passthrough) |
| Announce board, polls, proposals | `src/daemon/announce_board.zig` (imported at `src/daemon/server.zig:434`, unused); `src/daemon/poll.zig`, `src/daemon/proposal.zig` (only referenced from `src/daemon/root.zig`) | **N/A**: library code with no client command yet. If they are wired later, they will need UI. |

## 19. Media plane summary

Detail is in §6.5.

- **Implemented:** voice calls via the Cadence engine (JOIN, LEAVE, MUTE,
  SPEAKING, OFFER, ROSTER, REACT, E2EE handshake/groupkey/detach, binary
  frames). Captions and transcripts are received; hand raise is approximated
  with a ✋ reaction.
- **Not implemented:** ANSWER, PROFILE, QUALITY, CONSENT/RECORD (recording
  with all-party consent), LAYER/ABR (simulcast/bandwidth), POS (spatial
  audio), QUEUE (speaking queue), real HAND, BREAKOUT (builder only), CAPTION
  send, TRANSCRIPT request.
- **Constraints:** the user-side `MODE <me> +P` ("Keep calls quiet") has a switch
  (v3/gap-usermodes), but the oper cross-user `MODE nick +M`/`+P` and the `TX_DENIED`
  messaging have no UI. Video/screen are disabled on the live network by product
  decision (`a96afd2e` makes the switch fail closed on every path).

## 20. Info, stats, mesh and "fun" modules

| Feature | Server | Elm |
|---|---|---|
| Fantasy `!weather`/`!w`/`!wx [place]`, `!setweather`/`!sw <place\|clear>` (op), `!news`/`!n [source]`, `!localnews [CC]` (`!news*` need `+W`) → `:srv NOTICE #c :…` | `handleFantasy:39156`, `handleFantasyWeather:39236`, `handleFantasySetWeather:39208`, `handleFantasyNews:39269`, `fantasyReply:39116`; `src/daemon/geo_services.zig`, `src/proto/news_sources.zig`, `src/proto/weather_units.zig`; `[geo] enabled` | **PARTIAL**: works when typed, and replies render as channel notices from the server name. No discoverability (slash/help/autocomplete) and no location setting. A host can switch `+W` ("News commands", More rules, v3/gap-chanserv). |
| MOTD templating (`{weather}`, `{news}`, greetings, live figures) | `src/proto/motd_template.zig`, `handleMotd:42649` | **FULL** (rendered on Home like any MOTD; the `{weather}`/`{news}` placeholders arrive already filled by the server) |
| Welcome onboarding pack (once per new account) | `src/daemon/welcome_pack.zig`, `handleWelcome:28386` | **FULL** (Home "Getting started" card, v3/gap-shell) |
| CHANSTATS / public stats pages | §5.1 | **FULL** via JSON feeds |
| DIRECTORY (public discovery summary) | `handleDirectory:57251` | **RAW** |
| LUSERS / home widget | §5.1 | **FULL** |
| LINKS / MAP / mesh topology | `handleLinks:57313`, `handleMap:57696` | **RAW** (status page uses the client probe `src/Nodes.elm`) |
| Mesh presence: cross-node DMs, remote WHOIS, setter attribution | `src/daemon/mesh_presence_*.zig`; `findRemoteWhois` (`src/daemon/server.zig:24672`) | **FULL** (transparent) |
| Netsplit/netjoin batches | `src/daemon/netsplit_batch.zig` | **CORE-ONLY** (no "N users left in a netsplit" summary) |
| Session portability (MTOKEN cross-node) | `src/proto/session_portability.zig`, `handleMeshReclaim:49462` | **FULL** except REDIRECT (D8) |
| Mesh search fan-out for SEARCH | `src/daemon/mesh_search.zig` | **FULL** (transparent) |
| HELP topics (`src/proto/help_db.zig`) | §5.6 | **CORE-ONLY** |
| Games / PvP | None found in the command registry or modules (by request, not searched further) | N/A |

## 21. `ONYX_SERVER_PROTOCOL.md` vs server source — disagreements

| § (line) | Doc says | Source says |
|---|---|---|
| §2 (l.71) | 003 is "uptime/创建 line" | Garbled text; 003 is RPL_CREATED. Fix the copy. |
| §3 (l.95), §8.3 (l.303) | `CHANMODES=beIZ,k,lfj,imnstCTNMSgWOAVUFD` | `beIZ,k,lfj,imnstCTNgSMWOAphuadErzxwVUFD`. Every `chanmode_ext` flag except `f` is advertised (`src/proto/protocol_inventory.zig` `deriveChanmodes`; test `src/daemon/isupport_advertise.zig:10-42`). §8.3 "live-but-unadvertised `p h u a d E r z x`" is **wrong**: they are advertised. `docs/reference/commands/channels.md` is also stale. |
| §3 (l.88-116) | Token table | Missing `IRCX`, `KEYLEN`, `CHATHISTORY=64`, `ELIST=CMNTU`, `SAFELIST`, `EXCEPTS=e`, `INVEX=I`, `MAXPROP`, `MAXACCESS`, `MAXCODEPAGE`, `MAXLANGUAGE`, optional `NETWORKICON`, `VAPID`, `ACCOUNTRESIDENCE` (`src/daemon/server.zig:1901-1975`) |
| §4 (l.139) | `draft/multiline=max-bytes=4096,max-lines=24` | `max-bytes=40000,max-lines=64` (`src/daemon/dispatch.zig:427`) |
| §4 | Cap list | Omits `draft/no-implicit-names`, `draft/search`, `onyx/topics`, `onyx/e2ee`, `onyx/2fa=IDENTIFY`, `account-extban=a`, `utf8-only`, `draft/netsplit`, `draft/netjoin` (`src/daemon/dispatch.zig:315-435`) |
| §4 (l.154), §16 (l.526) | "There is **no `onyx/*` cap**" | Five `onyx/*` caps exist: session-sync, bouncer, topics, e2ee, 2fa. The sentence contradicts itself and the source. |
| §5 (l.165) | Advertised `PLAIN,EXTERNAL,SCRAM-SHA-256` | Per-connection list built by `writeSaslCapValue` (`src/daemon/dispatch.zig:1531`): adds SCRAM-SHA-512, SCRAM-SHA-512-PLUS, SESSION-TOKEN, OAUTHBEARER, ANONYMOUS when live |
| §5 | No mention of 2FA | PLAIN/SCRAM are **refused** for TOTP accounts: `904 :Two-factor authentication required: log in with IDENTIFY …` (`src/daemon/dispatch.zig:2048-2058`) |
| §5.1 (l.187) | Passkey replies are `NOTE WEBAUTHN …` | They are Event-Spine lines `:srv EVENT <nick> WEBAUTHN …` (`webauthnReply` `src/daemon/server.zig:46720-46731`). Elm already handles that form (`src/Spine.elm` `EventAsPasskey`). |
| §6 (l.228) | `SESSION` replies are `NOTE SESSION LIST\|TOKEN\|MTOKEN` | They are server NOTICEs: `SESSION TOKEN <hex>`, `SESSION MTOKEN … expires=`, `SESSION LIST …` (`src/daemon/server.zig:49056-49094`). `SESSION DROP` and `SESSION REDIRECT` are undocumented. |
| §6 (l.230-232) | "SESSION-TOKEN SASL … re-attaches to the same account session" | SESSION-TOKEN (from `SESSIONTOKEN`) only authenticates the account and never selects a session; reattach is `SESSION RESUME` (`docs/reference/commands/accounts-services.md` SESSION/SESSIONTOKEN; `src/daemon/server.zig:45058`) |
| §7 (l.261) | `CHANNEL … SET MLOCK` only | `SET TOPICLOCK\|GUARD\|PRIVATE\|DESC\|URL\|MLOCK\|KEEPTOPIC` and `TRANSFER` are all implemented (`src/proto/chanserv_cmd.zig:112-141`, `src/daemon/server.zig:47426-47613`). `docs/reference/commands/accounts-services.md` ("TRANSFER … unavailable") is stale too. |
| §7 (l.262) | `AUTOJOIN <LIST\|ADD\|DEL\|CLEAR>` | No CLEAR: `Usage: AUTOJOIN <ADD\|DEL\|LIST> [#channel]` (`src/daemon/server.zig:27992`) |
| §7 | Command table | Missing TOTP, RECOVERYCODES, SETPASS, RESETPASS, SUCCESSOR, ACCOUNT, SESSIONTOKEN, WEBAUTHN (beyond §5.1), KEYTRANS, E2EEKEY, E2EEGROUP, IDENTITY, RECOGNIZE, LISTCHANS, WEBPUSH, WELCOME, GROUP subcommands (`ADD\|DEL\|LIST\|PRIMARY`) |
| §8.1 (l.281) | `CREATE` "create-or-join; oper takeover" | `CREATE` fails with `926 ERR_CHANNELEXIST` if the channel exists; it takes an optional clone-source (`handleCreate:41973`, `src/proto/ircx_create.zig`) |
| §9 (l.357) | CHATHISTORY `LATEST/BEFORE/AFTER/AROUND/BETWEEN` | Plus `TARGETS` (`src/proto/chathistory_targets.zig:120`) and the `+onyx/topic` filter |
| §9 | PRIVMSG FAIL codes | Also `ONYX_FILTERED`, `INPUT_TOO_LONG`, `E2EE_REQUIRED`, `CTCP_BLOCKED` |
| §10 (l.377), §14 (l.479) | WHOWAS 314/**360**/369 | The server emits 314/312/369/406 (`docs/reference/commands/queries.md` WHOWAS; `handleWhowas:25080`); 360 is not emitted |
| §11 (l.408), §14 (l.494) | BROADCAST renders as `:<server> NOTE EVENT <CATEGORY> :<sender>: <text>` | It renders as a tagged `:<srv> EVENT <oper> <sender>: <text>` in category ANNOUNCE (`src/daemon/server.zig:37052-37066`, `src/daemon/event_spine.zig:482`). §17 checklist l.551 repeats the error. |
| §11 (l.403) | OBSERVE actions `connect quit nick oper` | Actions are `connect quit nick join part host oper` (`src/daemon/observe.zig:21-41`) |
| §11 | Event subscriptions are oper-only | Non-opers may ADD/DEL/LIST the `CHANNEL`, `MEMBER` and `MEDIA` planes (`handleEvent:37040-37048`) |
| §12 (l.421) | Subcommand list | Missing QUALITY, CONSENT, RECORD, QUEUE, ABR, E2EE-HANDSHAKE, E2EE-GROUPKEY, E2EE-DETACH (`src/daemon/media_cmd.zig:44-506`) and FAIL codes TX_DENIED, AUTH_REQUIRED, CONSENT_REQUIRED, BAD_CONSENT, HAND_FAILED, SECURE_SIGNALING_REQUIRED, TRANSPORT_UNAVAILABLE, TURN_CUT, DTLS_UNAVAILABLE, BAD_FINGERPRINT, UNENROLLED_E2EE_IDENTITY |
| §12 (l.432-434) | `kagura_frame` / `kagura_wasm.zig` naming | Dead names. The repo naming rule is CadenceVox/CadenceVis; the server still accepts `kaguravox/kaguravis` aliases for one release (`docs/reference/commands/media.md`). Rename in the doc. |
| §14 (l.485) | IRCX `806/807 event-add/del` | The server enum has 806/807 (`src/daemon/server.zig:1787-1788`) but `src/proto/numeric.zig:234-241` has 808/824; an internal inconsistency to resolve server-side. 900-908 IRCX error codes collide with SASL 900-908 and are undocumented. |
| §14 | 489 = "+S TLS required" | Matches the server enum; `src/proto/numeric.zig:213` names 489 `ERR_VOICENEEDED`. 520 `ERR_OPERONLYCHAN`, 470, 709, 725-729, 340 and 810-817 are missing from the list. |
| §15 (l.501-515) | Anti-abuse list | Missing: pre-001 CHALLENGE (PoW `Blake3(seed‖answer)[0]==0` or question), raid-shield auto-SLOWMODE + challenge coupling, `HOLD` first-message review, slowmode 404 text, `ONYX_FILTERED`, quarantine, APPEAL, and the ERROR reasons (§16 here) |
| §17 (l.534-542) | Checklist asks clients to REQ a specific cap list + SESSION-TOKEN reclaim | Superseded: Elm requests all caps minus a deny-list and reclaims with `SESSION RESUME` |

## 22. Prioritised gap list

Order: blocking or broken first, then everyday user value, then channel-op
power, then oper tooling, then protocol polish. Each line is
`[audience][priority] gap — sketch`. "Sketch" names the Elm files/functions to
add or touch. Numbering is the original (`7e03d47f`) numbering so cross
references still work.

At HEAD (`609cb240`): **[Closed — v3/<slice>]** means the item shipped and was
verified in code (the evidence is in the table rows cited from §0 and §5-§17).
**[Partly closed — v3/<slice>]** says what shipped and what is still missing.
An item without a marker is still open; "Still missing" states exactly what.
**SERVER** marks a gap the client cannot finish without a server change.

### P0 — broken or blocking today (all nine closed)

1. **[User][P0] 2FA accounts cannot sign in (D2).** **[Closed — v3/gap-auth]**
   - Shipped: the 904 "Two-factor" refusal opens a code step; the gate dials a guest connection and ports.js sends `IDENTIFY <acct> <pw> <code>` (`View/AuthGate.elm:331`, `foldAuthGateLine` `src/App.elm:53473`). The `onyx/2fa` cap value is not read; the 904 text is the trigger.
2. **[User][P0] Change password is broken (D1).** **[Closed — v3/gap-auth]**
   - Shipped: `requestAccountSetPassword` (`src/App.elm:30821`) sends `SETPASS <current> <new>` and folds the success NOTICE and `FAIL SETPASS`.
3. **[User][P0] Pre-001 CHALLENGE is unanswered (D3).** **[Closed — v3/gap-auth]**
   - Shipped: the PoW is solved in `ports.js:2114` (BLAKE3) and answered; a `question` shows a prompt (`View/AuthGate.elm:240`); `failed`/`wait` end in an honest stop.
4. **[All][P0] Server replies are invisible (§0.1/§0.2).** **[Closed — v3/gap-shell]**
   - Shipped: the Activity sheet over `serviceLog` (`View/GapShell.elm:57`), unknown `FAIL`/`WARN` and error-class numerics as inbox rows (`foldUnknownStandardReply` `src/App.elm:11092`, `routeErrorNumeric` `:11075`), MOTD and WELCOME on Home.
   - Polish still open (not a blocker): a reply is not attached to the command that caused it, Activity has no search, and the copy for most `FAIL`s is the server's own text (§15).
5. **[User][P0] Disconnect reasons are hidden (D6).** **[Closed — v3/gap-shell]**
   - Shipped: `ERROR`/`KILL` reasons on the gate and reconnect banner; bans, kills, ghosting and "Closing Link" stop auto-reconnect (`foldServerError` `src/App.elm:10708`, `foldKill` `:10776`).
6. **[User][P0] Forgot-password flow is missing.** **[Closed — v3/gap-auth]**
   - Shipped: connect-screen "Forgot password?" → `RESETPASS <acct>` → code + new password (`View/AuthGate.elm:477`, `AuthGate.resetRequestLine`).
7. **[User][P0] Custom status is broken (D4).** **[Closed — v3/gap-auth]**
   - Shipped: `setCustomStatus` (`src/App.elm:23240`) sends `PROP <ournick> STATUS`; a 913 shows a toast.
8. **[Op][P0] "Delete room" silently fails server-side (D7).** **[Closed — v3/gap-chanserv]**
   - Shipped: `CHANNEL INFO` first, `DROP` only for a registered room, then the room is emptied and left (`chanservBeginDelete` `src/App.elm:50849`).
9. **[User][P0] `+S`/`+O`/`+A`/forward joins fail or redirect silently (D9).** **[Closed — v3/gap-shell, v3/gap-chanserv]**
   - Shipped: 477/480/489/520 answer the join prompt (`foldJoinDenied` `src/App.elm:11143`); 470 says where you landed (`chanservForwarded` `src/App.elm:50807`).

### P1 — high-value user features

10. **[User][P1] Server-side scheduled messages.** **[Partly closed — v3/gap-usermodes]**
    - Shipped: signed-in people can keep a send-later on the server (`DEFER AT`, "Where to keep it", `View/UserModes.elm:1039`); held sends are remembered locally and labelled as uncancellable.
    - Still missing: `DEFER CRON` (the builder `deferCronLine` `src/UserModes.elm:772` is tested but no control reaches it) and the `OPER` form. **SERVER:** there is no `DEFER LIST`/`CANCEL`, so the client can neither list nor cancel a held send.
11. **[User][P1] KNOCK ("Ask to join") for `+i`/`+k`/`+l` rooms.** **[Closed — v3/gap-chanserv]**
    - Shipped: "Ask to join" on the refusal card and a host inbox row with Invite (`View/Chanserv.elm:1150`, `:1255`).
12. **[User][P1] Privacy user modes.** **[Closed — v3/gap-usermodes]**
    - Shipped: Preferences → Privacy for `+R +g +C +i +p +P +Q` (`View/UserModes.elm:141`), seeded by 221, re-applied on connect. `+D` is omitted on purpose: **SERVER** — no daemon code reads it (`src/proto/usermode.zig:19,152`).
13. **[User][P1] Blocked-DM feedback (caller-id).** **[Closed — v3/gap-usermodes]**
    - Shipped: 716/717/718 folded; the sender sees "waiting for X to accept you", the target gets an Inbox message request with Accept.
14. **[User][P1] Server-side ignore that follows the account across devices.** **[Closed — v3/gap-usermodes]**
    - Shipped: "Also block on the server" mirrors `/ignore` to `SILENCE`, lists 271/272, respects `SILENCE=` (`View/UserModes.elm:745`).
15. **[User][P1] Offline-message mailbox (MEMO).** **[Closed — v3/gap-usermodes]**
    - Shipped: Inbox → "Offline messages" (`View/UserModes.elm:422`): list, clear, send, forward, ignore.
16. **[User][P1] Show the MOTD and the onboarding WELCOME pack.** **[Closed — v3/gap-shell]**
    - Shipped: Home "From the network" / "Getting started" card (`View/GapShell.elm:543`).
17. **[User][P1] Room welcome message.** **[Closed — v3/gap-chanserv]**
    - Shipped: host settings "Welcome message" / "Goodbye message"; the delivered notice is a system row.
18. **[User][P1] Slowmode experience.** **[Closed — v3/gap-chanserv]**
    - Shipped: "Slow mode" setting, composer countdown, honest 404 copy (`View/Chanserv.elm:182`, `:1297`).
19. **[User][P1] Account-wide autojoin.** **[Closed — v3/gap-usermodes]**
    - Shipped: Account → Autojoin; `/autojoin` mirrors to the account when signed in.
20. **[User][P1] Nick protection controls.** **[Closed — v3/gap-account]**
    - Shipped: Account → Protection (`ACCOUNTSET secure|enforce`), "Recover a name" (`RECOVER`/`RELEASE`), recognised addresses (`RECOGNIZE`) and grouped names (`GROUP`) (`View/GapAccount.elm:111`, `:238`).
21. **[User][P1] Profile depth.** **[Closed — v3/gap-usermodes]**
    - Shipped: real name edit (`SETNAME`), offline profile (`WHOWAS`), "Last seen" (`SEEN`).
22. **[User][P1] Passkey sign-in.** **[Closed — v3/gap-auth]**
    - Shipped: "Sign in with a passkey" on the connect screen (`View/AuthGate.elm:388`); `WEBAUTHN STATUS` is sent with the list.
23. **[User][P1] Hand raise and speaking queue in calls.**
    - Still missing: `MEDIA HAND #c up|down` and `MEDIA QUEUE`. The hand raise still sends a ✋ `REACT` (`src/App.elm:45743-45764`); only the inbound `HAND` fold exists (`src/Media.elm:335`).
    - Sketch: send the real `HAND`, add a queue view, reuse the fold.
24. **[User][P1] Call recording with consent.**
    - Still missing: `MEDIA CONSENT #c on|off` and `MEDIA RECORD #c [stop]` are never sent; no "recording" banner (`src/View/CallStage.elm`); no `CONSENT_REQUIRED` mapping.
25. **[User][P1] Live captions send and transcript.**
    - Still missing: `MEDIA CAPTION #c :text` is never sent and there is no "Load transcript" (`MEDIA TRANSCRIPT #c`); receive and render exist (`src/Media.elm:159`, `src/CallCaptions.elm`).
26. **[User][P1] Fantasy discoverability.** **[Partly closed — v3/gap-chanserv]**
    - Shipped: hosts can switch `+W` ("News commands") in More rules.
    - Still missing: `!weather [place]`, `!news [src]`, `!localnews [CC]` are not in `slashCommands` (`src/App.elm:15634`) or the palette, and there is no "my weather location" setting (`METADATA * SET location <place>`).

### P2 — channel operator power

27. **[Op][P1] Register a room and channel services.** **[Closed — v3/gap-chanserv]**
    - Shipped: Registration section, account access, successor, "Your rooms" (§6.1).
28. **[Op][P1] Persistent auto-kick list.** **[Closed — v3/gap-chanserv]**
    - Shipped: "Auto-kick" in Registration.
29. **[Op][P1] Exceptions, invite exceptions and quiet lists.** **[Closed — v3/gap-chanserv]**
    - Shipped: "Mutes and exceptions" and a Mute action on the member card (`View/Chanserv.elm:981`, `:1372`).
30. **[Op][P1] Server-side timed modes.** **[Closed — v3/gap-chanserv for flags]**
    - Shipped: timed rules via `TEMPMODE ADD`/`CANCEL`. The server refuses `b` ("boolean flags only"), so the temp-ban stays on the client timer (`requestTempBan` `src/App.elm:23585`).
31. **[Op][P1] Full channel mode toggles.** **[Closed — v3/gap-chanserv]**
    - Shipped: every advertised flag except the oper markers `E r z` and MODEX-only `f`; `+f` forward and `+j` throttle inputs. Not done: batching by `MODES=`, and the owner `+q` grant is only the hand-over flow.
32. **[Op][P1] Room tier keys.**
    - Still missing: owner setting for `FOUNDERKEY`/`OWNERKEY`/`HOSTKEY`/`VOICEKEY` (`PROP #c KEY value`); the join prompt's key field only carries a `+k` key.
33. **[Op][P1] History retention.**
    - Still missing: `RETAIN` (delete after N) next to `EPHEMERAL` in `src/View/RoomSettings.elm`.
34. **[Op][P1] Word filter.**
    - Still missing: "Blocked words" → `CHANBADWORDS #c ADD|DEL|LIST`; `FAIL PRIVMSG ONYX_FILTERED` is not mapped in `humanizeSendFail` (`src/App.elm:35535`), so the sender sees the server text in a toast.
35. **[Op][P1] Mass clear.** **[Partly closed — v3/gap-chanserv]**
    - Shipped: a founder's "Delete room" empties the room with `CLEAR #c USERS` (`src/Chanserv.elm:1319`).
    - Still missing: a stand-alone owner action "Clear room" with `KEEP <rank>`, `ALLOW` and a reason.
36. **[Op][P2] Rename room.**
    - Still missing: a room setting → `RENAME #old #new :reason`. Inbound `foldRename` and the `FAIL RENAME` arm exist (`src/App.elm:32611`, `:24122`).
37. **[Op][P2] Clone room (IRCX CREATE).**
    - Still missing: "Create from this room" → `CREATE #new [modes] #source`.
38. **[Op][P2] Whisper.**
    - Still missing: a member action "Whisper" (`Ircx.whisper` builder `src/Ircx.elm:1179`); receive is already rendered.
39. **[Op][P2] Sealed rooms and AI policy setters.**
    - Still missing: room settings for `membership-visibility` and `no-ai`/`local-only`/`server-ai-ok` (read path `src/AiPolicy.elm`); `FAIL NAMES|WHO MEMBERSHIP_SEALED` is now a generic inbox row but the roster does not explain an empty list.
40. **[Op][P2] First-message hold.** **[Partly closed — v3/gap-oper]**
    - Shipped: opers release or drop held messages (`HOLD RELEASE|DROP`, Content tab).
    - Still missing: a room setting `HOLD n`, and a notice to the sender on `HOLD stored` (it only reaches Activity). **SERVER:** there is no command to list the held queue.
41. **[Op][P2] Named modes and topics registry.**
    - Still missing: `MODEX` set support in `/modex` (`requestModex` `src/App.elm:22397`, query-only); an editor for the `onyx_server.topics` registry.

### P3 — network operator tooling

The operator console (v3/gap-oper) covers items 42-47 and part of 44, 45, 48,
49 and 51: tabs Live, Bans, Silence, Abuse, Appeals, Content, Network behind
`/desk [tab]` and the operator toggle (`View/ModDesk.elm:227 operDesk`), pure
cores `OperPlan` (validated wire plans), `OperReply` (reply classification),
`OperFeed` (live ring) and `OperConsole` (state, review/confirm for every
change, reply window per tab). Replies stay in the desk. Tests:
`OperPlanTest`, `OperReplyTest`, `OperFeedTest`, `OperConsoleTest`,
`OperDeskViewTest`, `AppealTest`.

42. **[Oper][P1] Live Event Spine feed (D5).** **[Closed — v3/gap-oper]**
    - Shipped: tagged category events, OBSERVE pushes, ANNOUNCE and AUDIT rows in the Live tab; `EVENT SEVERITY` and `EVENT STATS JSON` (`View/OperFeedPanel.elm:134`).
43. **[Oper][P1] Network bans.** **[Closed — v3/gap-oper]**
    - Shipped: `WARD ADD|DEL|LIST|TEST`, `KLINE`/`DLINE`/`XLINE`, `TESTLINE`/`TESTMASK` (Bans tab). **SERVER:** `WARD ADD country <CC>` is always refused by the daemon (D10).
44. **[Oper][P1] Silencing.** **[Partly closed — v3/gap-oper]**
    - Shipped: `SHUN`/`UNSHUN`, user `+z` GAG, `QUARANTINE` (Silence tab).
    - Still missing: oper cross-user `MODE nick +M` (media deny) and `+P`.
45. **[Oper][P1] Abuse insight.** **[Partly closed — v3/gap-oper]**
    - Shipped: `ABUSE`, `CLONES`, `SESSIONS` filters, `USERIP` (Abuse tab).
    - Still missing: `GEOIP`, `TRACE`/`ETRACE`.
46. **[Oper][P1] Appeals.** **[Closed — v3/gap-oper]**
    - Shipped: connect-screen "Appeal a ban" and `/appeal` (works before registration); Appeals tab for `APPEAL LIST` and `APPEAL ANSWER`.
47. **[Oper][P1] Content controls.** **[Closed — v3/gap-oper]**
    - Shipped: `FILTER`, `SPAMTRAP`, `HOLD`, `POLICY LIST|ROLLBACK`, `CHALLENGE METHOD|QUESTION` (Content tab).
48. **[Oper][P2] Accounts admin.** **[Partly closed — v3/gap-oper]**
    - Shipped: `ACCOUNT SUSPEND|UNSUSPEND|FORBID|UNFORBID|NOEXPIRE|INFO` (Network tab, `View/ModDesk.elm:577`).
    - Still missing: `VHOST APPROVE|DENY|OFFER|SET` (and user `REQUEST`/`OFFERLIST`), `SACCESS`, `RESV`/`UNRESV`, `JUPE`/`UNJUPE`.
49. **[Oper][P2] Staff.** **[Partly closed — v3/gap-oper]**
    - Shipped: `PRIVS` (full), `GRANTS` (read), `AUDIT 20` plus AUDIT rows in the Live feed.
    - Still missing: `GRANT`/`REVOKE`, `AUDIT PROOF`, `AUDIT JSON`/oper filter.
50. **[Oper][P2] Force actions.**
    - Still missing: `FORCEOP`/`FORCEDEOP`/`FORCEJOIN`/`FORCEPART`/`FORCETOPIC`, `SUMMON`; `GLOBAL` is only the all-users form (Network tab) without its `mask`/`#c` audience.
51. **[Oper][P2] Mesh and server.** **[Partly closed — v3/gap-oper]**
    - Shipped: `MESH` (+ `LOG`/`GRANTS`/`ADMISSION`), `NETHEALTH`, `ROUTE`, `STATS u o k d y l z m c i`, `CONNECT`/`SQUIT`, `DRAIN`, `UNREJECT`, `REHASH`, `OPERMOTD` (read), `MODULES`.
    - Still missing: `LINKS`/`MAP`, `NETSTAT`, `STATS p` and the upper-case aliases, `CLOSE`, `UPGRADE`, `DIE`/`RESTART`, `TRACE`, `DEBUG`, `MODULES [id]`, `COMMANDS`, `OROWASM`, `OPERMOTD SET`.
52. **[Oper][P2] Integrations.**
    - Still missing: `BOTGRANT`, `OUTHOOK`, `E2EEGROUP STATUS|ON|OFF` (no operator UI).

### P4 — protocol completeness and polish

53. **[User][P2] Mesh session redirect (D8).**
    - Still missing: parsing `SESSION REDIRECT: … lives on <node>`; today it only reaches Activity. Sketch: reconnect to that node with the stored MTOKEN (`src/Nodes.elm` pin + `maybeSendSessionCommands` `src/App.elm:20226`).
54. **[User][P2] Netsplit/netjoin summary.**
    - Still missing: `BATCH netsplit|netjoin` is not interpreted; QUITs and JOINs fold one by one (`foldHistoryBatch` `src/App.elm:36633` handles only history, multiline and labeled batches).
55. **[User][P2] Message-level bot badge.**
    - Still missing: the `bot` tag is not rendered on rows and the `bot` cap is not requested (`Session.wantedCaps` `src/Session.elm:657`); only the WHOIS 335 badge exists (`src/View/Profile.elm:86`).
56. **[User][P3] Remaining SASL mechanisms.**
    - Still missing: SCRAM-SHA-512, SESSION-TOKEN (`SESSIONTOKEN` for "remember this device") and OAUTHBEARER in `Wire.selectSaslMechanism` (`src/Wire.elm:881`) and ports.js.
57. **[User][P3] ISUPPORT hygiene.** **[Partly closed — v3/gap-usermodes]**
    - Shipped: `SILENCE=` is read as the block-list limit.
    - Still missing: `AWAYLEN KICKLEN CHANNELLEN KEYLEN MAXLIST MAXTARGETS MONITOR CHATHISTORY ELIST BOT EXTBAN NETWORKICON` are not parsed (`src/Isupport.elm`), and the unadvertised `$o` extban is still offered (`src/View/Bans.elm:127`, `src/Modes.elm:790`).
58. **[User][P3] Server-side LIST filters.**
    - Still missing: Browse sends a bare `LIST` (`refreshChannelList` `src/App.elm:19326`); no `ELIST` masks and no `LISTX` (`src/Ircx.elm:1313` builder unused).
59. **[User][P3] Server info.** **[Partly closed — v3/gap-shell]**
    - Shipped: the MOTD is shown on Home.
    - Still missing: `VERSION`, `ADMIN`, `INFO`, `TIME`, `LUSERS` detail, `DIRECTORY` and `HELP <topic>` (704-706) are only reachable as raw verbs whose reply lands in Activity.
60. **[User][P3] `draft/pre-away`.**
    - Still missing: `AWAY` is never sent before 001 when restoring an away/DND status.
61. **[User][P3] `draft/channel-context`.**
    - Still missing: DMs opened from a room carry no `+draft/channel-context=#c` tag and show no context.
62. **[User][P3] WebTransport.**
    - Still missing: optional `/wt` transport in ports.js for lossy networks.
63. **[User][P3] DATA/REQUEST/REPLY.**
    - Still missing: the typed IRCX messages are never sent or folded (`src/Ircx.elm:1139-1159` builders unused).
64. **[Docs][P3] Fix `ONYX_SERVER_PROTOCOL.md`.**
    - Still open: every row in §21 is unchanged. `elm/COVERAGE.md` "unadvertised ext flags" and "CHANNEL SET MLOCK only" claims are documentation to regenerate (not verified in this refresh).
