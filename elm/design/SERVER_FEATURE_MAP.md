# Onyx Server ⇄ Onyx Elm — complete server feature map

Every client-reachable capability of the Onyx Server daemon, and whether the
Elm client (`elm/`, the product) supports it. This map drives the
"close all gaps" build wave. Prioritised gap list: **§22**.

- **Server:** `/home/kain/onyx-server` at version `0.7.0`
  (`build.zig.zon:18`). Read-only: `src/`, `docs/`, `build.zig*` only.
  Server citations are `path:line` relative to the server repo. Line numbers are
  current. The line numbers in `docs/reference/**` are out of date, so this map
  cites source.
- **Client:** branch `v3/map-server` at `7e03d47f`. Elm citations are relative
  to `elm/` (for example `src/App.elm:5866`).
- **Spec under audit:** `ONYX_SERVER_PROTOCOL.md` (repo root). §21 lists every
  place it disagrees with the server source.
- Generated 2026-10-10. Raids get one row (§17). PvP was out of scope by request.

## Legend

| Status | Meaning |
|---|---|
| **FULL** | Elm sends/handles it **and** a user can reach it from UI (button, panel, or a dedicated slash verb) and see the outcome. |
| **PARTIAL** | Partly wired; the row says exactly what is missing. |
| **CORE-ONLY** | A parser, fold or builder exists in Elm, but there is no UI trigger and/or no display. |
| **RAW** | No feature code. The user can still type the command because unknown slash verbs pass through raw (`src/App.elm:11164`). Replies land in the invisible sink (§0.1), so in practice this is **MISSING**. |
| **MISSING** | Nothing. |
| **N/A** | Server-internal, or the client has no use for it (reason given). |

Access column: `any` (also pre-registration), `reg` (registered client),
`acct` (logged-in account), `op`/`owner`/`founder` (channel tier), `oper[:priv]`
(network operator + privilege), `cfg:<feature>` (config-gated).

---

## 0. Read this first — cross-cutting findings

These findings cut across every table below. Each one hides or breaks many
features at once.

### 0.1 The reply sink is invisible

- A server-origin `NOTICE` that no dedicated fold claims goes to
  `logService` (`src/App.elm:34689-34695` → `src/App.elm:22787`).
- A numeric with no arm goes to `logNumeric` (`src/App.elm:5926-5928` →
  `src/App.elm:9642`).
- Both write only to `model.serviceLog`. **No view renders `serviceLog`.**
  `grep -rn serviceLog src/View src/View.elm` finds nothing. The only readers
  are three filters: account cert notices (`src/App.elm:26793`),
  keytrans notices (`src/App.elm:26820`) and webhook notices (`src/App.elm:21639`).
- So on the server, almost every service reply is a `noticeTo` NOTICE (326
  call sites in `src/daemon/server.zig`). Examples: `CHANNEL INFO`,
  `SEEN`, `MEMO LIST`, `HELP`, `GROUP LIST`, `AUTOJOIN LIST`, `LISTCHANS`,
  `STATS`, `MESH`, `WARD LIST`, `APPEAL filed`, `HOLD stored`, `UNFURL …` and
  `DEFER: scheduled`. All of them are **invisible in Elm**.
- MOTD is collected (`startMotd`/`finishMotd`, `src/App.elm:4541`/`4568`,
  `showMotd = True`) but never rendered. No view reads `model.motd`.

### 0.2 Unknown `FAIL`/`WARN` are dropped silently

`foldStandardReply` (`src/App.elm:20833`) has arms for these replies and no others:

- `SESSION`, `MEDIA`, `E2EEGROUP`, `E2EEKEY`, `SEARCH`, `CHATHISTORY`
- `MEMO`(NOTE), `IDENTIFY`, `REGISTER`/`VERIFY`, `TOTP`, `RECOVERYCODES`
- `ACCOUNTINFO`, `ACCOUNTSET`, `RENAME`, `IDENTITY STALE_EPOCH`, `WEBAUTHN`
- a generic account arm for `ACCOUNTSET LOGOUT RECOVER DROP KEYTRANS CERT*`
  (`src/App.elm:20948-20989`)
- messaging `FAIL`s for `PRIVMSG NOTICE TAGMSG WHISPER`

Any other reply hits `( model, [] )` (`src/App.elm:20990-20991`). That covers
`FAIL CHANNEL`, `PINS`, `EDIT`, `REDACT`, `VHOST`, `SUCCESSOR`, `GHOST`,
`RELEASE`, `SETPASS`, `RESETPASS`, `JOIN`, `PART`, `KICK`, `MODE`, `NAMES`,
`WHO`, `MARKREAD`, `AUTOJOIN`, `GROUP`, `CREATE`, `CLEAR`, `FILTER`,
`ACCOUNT`, `SESSIONTOKEN`, `UNREJECT`, `BATCH`, `WEBPUSH` and `ACCESS`.

### 0.3 Raw passthrough is power-user only

- Any unknown `/verb a b c` goes out as `VERB a b c` (`sendRawSlashCommand`,
  `src/App.elm:11164`). `/quote` sends a raw line (`src/App.elm:13000`).
- Multi-word trailing text needs an explicit `:` (for example
  `/memo send alice :hi there`), because `Wire.formatIrcLine` only adds the
  colon to a last param that contains a space (`src/Wire.elm` `formatIrcLine`).
- Because of 0.1 and 0.2, these commands "work" but the user sees nothing.

### 0.4 Defects found while mapping (server behaviour vs Elm code)

| # | Defect | Server evidence | Elm evidence |
|---|---|---|---|
| D1 | **Change password is broken.** Elm sends `ACCOUNTSET <acct> <pw> password <new>`. The server accepts only `email\|flags\|secure\|enforce` and answers `FAIL ACCOUNTSET INVALID_FIELD`. The correct verb is `SETPASS <current> <new>`. | `src/daemon/server.zig:47152-47179`; `SETPASS` `src/daemon/server.zig:44617` | `requestAccountSetPassword` `src/App.elm:27142` (calls `Services.accountSet … "password"`, `src/App.elm:27162`) |
| D2 | **A 2FA account can no longer sign in from Elm.** With TOTP active, PLAIN/SCRAM SASL fails with `904 :Two-factor authentication required: log in with IDENTIFY <account> <password> <code>`. Elm's connect gate uses SASL only and fails closed on 904. It has no IDENTIFY-with-code path. The cap `onyx/2fa=IDENTIFY` advertises this, and Elm ignores it. | `src/daemon/dispatch.zig:2048-2058`; cap `src/daemon/dispatch.zig:433` | `beginSasl` `src/App.elm:9777`; 904 arm `src/App.elm:5492`; `totpCodeInput` is used only for `TOTP CONFIRM` (`src/App.elm:37911-37925`) |
| D3 | **Elm cannot get past a pre-001 CHALLENGE.** When `[challenge]` is enabled and the raid shield is engaged on *any* channel, or the source IP has bad reputation, registration is held. The server sends `NOTICE CHALLENGE pow <hex-seed>` (solve: `Blake3(seed‖answer)[0]==0`) or `CHALLENGE question <text>`. The client must answer `CHALLENGE <answer>`. Elm never answers, so new connections hang during a raid. | `challengeRequired` `src/daemon/server.zig:17437`; `armChallengeHold` `:17448`; `noticeChallenge` `:17464`; PoW `src/daemon/challenge.zig:47-55` | `grep -rn CHALLENGE src/` → no match |
| D4 | **Custom status never reaches the server.** Elm sends `PROP * STATUS <text>`. A user PROP needs the entity to equal your own nick, so `*` gets `913 ERR_NOACCESS`, which lands in the invisible sink. | `propAccess` `src/daemon/server.zig:39768-39782` | `src/App.elm:20128` |
| D5 | **The oper live Event Spine feed is discarded.** Live oper events arrive as `@onyx_server.io/category=FLOOD;…severity=warn :srv EVENT <oper> FLOOD …`. `Spine.foldEventLine` re-dispatches only the `MEDIA` and `WEBAUTHN` planes. It ignores every category body, `OBSERVE` push, `AUDIT` row and `EVENT BROADCAST`. Only `EVENT REPLAY JSON`, which opers must pull, is shown. | `renderEventTagged` `src/daemon/event_spine.zig:482`; delivery `src/daemon/server.zig:55973-55997` | `src/Spine.elm` `foldEventLine` (ignore arm); `src/App.elm:8484` |
| D6 | **Disconnect reasons are hidden.** `ERROR :<reason>` goes to the invisible sink. Covered reasons: Excess Flood, K-line/Ward, Killed, Ghosted, raid ban, reputation, too many connections, draining, ping/registration timeout. The `KILL` line has no arm. | ERROR sites `src/daemon/server.zig:9776,9834,11709,11724,11744,17689,22262,25000` | `src/App.elm:5008-5011`; no `"KILL"` arm in `foldLine` (`src/App.elm:4593-5928`) |
| D7 | **"Delete room" sends `CHANNEL DROP`, but Elm never registers rooms.** The DROP therefore fails with `FAIL CHANNEL CHANNEL_UNKNOWN`/`ACCOUNT_REQUIRED`, which is dropped (§0.2). Only the PART takes effect. | `handleChannel` `src/daemon/server.zig:47370` | `requestStewardDeleteRoom` `src/App.elm:21536-21560` |
| D8 | **Mesh `SESSION REDIRECT: session lives on <node>; reconnect there to reclaim` is not handled.** It falls into the invisible sink, and the reclaim banner never learns the target node. | `src/daemon/server.zig:49447`, `:49634` | no `REDIRECT` match in `src/App.elm`, `src/Session.elm` or `src/Wire.elm` |
| D9 | **Error numerics for `+S`/`+O`/`+A` joins are silent.** `489 ERR_SECUREONLYCHAN` and `520 ERR_OPERONLYCHAN` have no arm, so the user sees the join silently fail. | `joinDenied` `src/daemon/server.zig:22401-22418` | no `489`/`520` arms (`src/App.elm:5659-5735`) |

### 0.5 Scorecard

Over the 143 rows of the §5 command catalog (aliases grouped, so this is not
a raw command count):

| Status | Rows |
|---|---|
| FULL | 38 |
| PARTIAL | 24 |
| CORE-ONLY | 7 |
| RAW (effectively missing) | 57 |
| MISSING | 13 |
| N/A | 4 |

- **Strong:** messaging, IRCv3 chat semantics, sessions/reclaim, the account
  security panel, voice calls, bans, ACCESS, webhooks and stats.
- **Weak:**
  - channel services (CHANNEL/CS)
  - every channel mode other than `b`, `i`, `m`, `n`, `t`, `s`, `k`, `l`
  - user modes
  - oper tooling (only BROADCAST/EVENT/OBSERVE/KILL/REHASH/PRIVS)
  - anything whose reply is a NOTICE
  - the abuse-response surfaces: CHALLENGE, APPEAL, slowmode feedback, HOLD

---

## 1. Transport, registration and handshake

| Item | Server evidence | Behaviour / replies | Access | Elm | Elm evidence / notes |
|---|---|---|---|---|---|
| WebSocket transport | `src/proto/websocket.zig`, `src/proto/permessage_deflate.zig`; frames handled in `src/daemon/server.zig:17410-17432` | One IRC message per frame, no CRLF. Ping/pong/close control frames. Binary frames carry Cadence media datagrams (`handleWsMediaDatagram` `src/daemon/server.zig:53961`). | any | **FULL** | `src/Wire.elm` `splitWireFrame`; ports.js socket; `mediaBinarySend` ports |
| WebTransport (HTTP/3 `/wt`) | `src/daemon/webtransport_listener.zig:1-20` (QUIC+H3+WT, proxied to the IRC listener) | Alternative browser transport | any | **MISSING** | `grep -i webtransport ports.js src/` → none |
| STS policy cap | `src/daemon/dispatch.zig:418-425` (`requires_policy`) | `sts=duration=…,port=…` only when configured | any | **N/A** | Deliberately not requested (`src/Session.elm:657-668`); browser uses wss |
| PASS | `src/daemon/dispatch.zig:1842` | Recorded only, not validated | any | **N/A** | Not sent |
| NICK (pre-reg) | `src/daemon/dispatch.zig:1854` | NICKLEN/control checks. Account-owned nicks need SASL. Errors 432/433/437. | any | **FULL** | `WsOpened` → NICK (`src/App.elm:36790`); nick alias rotation `src/App.elm:10125-10190` |
| USER | `src/daemon/dispatch.zig:1874` | 4 params | any | **FULL** | `src/App.elm:36791` |
| CAP LS/REQ/LIST/END (NEW/DEL never fire) | `src/daemon/dispatch.zig:1891` | 410 for bad subcmd | any | **FULL** | `foldCap` `src/App.elm:9878` (LS/ACK/NAK/NEW/DEL) |
| AUTHENTICATE | `src/daemon/dispatch.zig:1918-2075` | 900/903/904/905/906/907/908 | any (pre-reg, cap sasl) | **PARTIAL** | PLAIN/SCRAM-SHA-256/EXTERNAL only (`beginSasl` `src/App.elm:9777`, `foldAuthenticate` `:9803`). No SCRAM-SHA-512, SESSION-TOKEN, OAUTHBEARER or ANONYMOUS. 2FA lockout D2. |
| PING / PONG | `src/daemon/dispatch.zig:2163,2172`; registered PONG `src/daemon/modules/feature_misc.zig:90` | 409 no origin | any | **FULL** | `src/App.elm:4976-4987`; keepalive ports (`pingKeepalive.smoke.mjs`) |
| QUIT | `src/daemon/modules/user_query.zig` → `handleQuit` `src/daemon/server.zig:59893` | Records WHOWAS/SEEN; nick-delay hold | any | **FULL** | `SessionDisconnect`/Leave |
| Welcome burst 001-005 | `src/daemon/dispatch.zig:2216` | 001 welcome text, 002 yourhost, 003, 004 myinfo, 005 | — | **FULL** | 001 `src/App.elm:5013`, 004 `:4609`, 005 `:4594`. 002/003 go to the invisible sink. |
| Post-welcome LUSERS + MOTD | `handleLusers` `src/daemon/server.zig:42489`, `handleMotd` `:42649` | 251-255/265/266/250; 375/372/376 | — | **PARTIAL** | LUSERS → home stats (`foldLusers` `src/App.elm:19778`). MOTD collected, never shown (§0.1). |
| Connect-time GeoIP metadata | `setGeoLocation` `src/daemon/server.zig:39078` | Sets own METADATA `location`, `country` | — | **CORE-ONLY** | Elm folds METADATA generically (`foldMetadataCommand` `src/App.elm:9433`). There is no UI for location. |
| Pre-001 CHALLENGE (PoW / question) | `src/daemon/server.zig:17437-17540`; `src/daemon/challenge.zig` | `NOTICE CHALLENGE pow <seed>` \| `CHALLENGE question <q>`; answer `CHALLENGE <answer>` → `CHALLENGE failed\|wait\|not required` | any (pre-reg) | **MISSING** | D3 |
| `REGISTER` before 001 | `src/daemon/server.zig:17744` | `FAIL REGISTER COMPLETE_CONNECTION_REQUIRED` | — | **N/A** | Elm registers after 001 (guest-claim) |
| `APPEAL` before 001 | `src/daemon/server.zig:17759` (pre-reg route) | Banned users may file without registering | any | **MISSING** | see §5.7 APPEAL |
| `draft/pre-away` AWAY before 001 | `src/daemon/server.zig:17733` | Away applied before welcome | any | **MISSING** | Cap is requested, but Elm never sends AWAY pre-001 |
| `SESSION RESUME` gate | `src/daemon/server.zig:17843-17849` | `FAIL SESSION RESUME_PENDING` until resume completes | — | **FULL** | `maybeSendSessionCommands` `src/App.elm:17357` |
| Registration refusal `ERROR`s | `src/daemon/server.zig:9776` (reg timeout), `:11709` (draining), `:11724` (reputation), `:11744` (too many connections), `:22262` (SACCESS) | Socket closes | any | **PARTIAL** | Reconnect happens, but the reason is hidden (D6) |
| Labeled-response / ACK | `src/daemon/server.zig:17908-17952`; `src/proto/labeled_response.zig` | Single line, BATCH, or bare `ACK` | reg | **FULL** | `src/App.elm:5886` (ACK); label stamping `src/Labels.elm` |
| Multiline inbound | `routeMultiline` `src/daemon/server.zig:17903`; cap value `max-bytes=40000,max-lines=64` | `BATCH +ref draft/multiline <target>` | reg | **FULL** | `src/Multiline.elm`; send gate `src/App.elm:10624` |

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
| `away-notify` | AWAY broadcasts | **FULL** (`"AWAY"` arm `src/App.elm:5818`) |
| `setname` | SETNAME broadcasts | **PARTIAL**: inbound `foldSetname` `src/App.elm:6007`; Elm never sends SETNAME |
| `extended-join` | Account/realname on JOIN | **FULL** |
| `invite-notify` | INVITE fan-out to ops | **FULL** (`foldInvite` `src/App.elm:25013`) |
| `account-tag` | `account=` tag | **FULL** |
| `onyx/session-sync` | Sibling mirroring; server-driven rejoin | **FULL** (`rejoinLiveChannels` `src/App.elm:23126`) |
| `onyx/bouncer` | Automatic rewind on (re)join | **FULL** (msgid dedup) |
| `onyx/topics` | `+onyx/topic=<label>` tag; topic-filtered CHATHISTORY | **FULL** (`src/TopicRead.elm`, `topicMessageTag`) |
| `onyx/e2ee` | `+onyx/e2ee` tag; required rooms reject plaintext | **FULL** (`src/App.elm:12756`, `:42950`) |
| `chghost` | CHGHOST lines on vhost change | **CORE-ONLY** (consumed silently, `src/App.elm:5918-5924`) |
| `no-implicit-names` / `draft/no-implicit-names` (same id) | Suppresses NAMES on JOIN | **FULL**: the draft token is requested and Elm then sends NAMES itself (`namesAfterSelfJoin` `src/App.elm:23072`) |
| `draft/chathistory` | CHATHISTORY | **FULL** (§5.3) |
| `draft/search` | SEARCH | **FULL** (`src/App.elm:32413-32537`) |
| `draft/message-redaction` | REDACT | **FULL** |
| `draft/message-editing` | EDIT | **FULL** |
| `draft/read-marker` | MARKREAD | **FULL** |
| `draft/event-playback` | Events in history replay | **FULL** (`divertReplayEvent`) |
| `draft/typing` / `draft/react` / `draft/reply` | TAGMSG client tags | **FULL** |
| `batch` | chathistory, netsplit, netjoin, labeled-response, multiline batches | **PARTIAL**: chathistory/multiline/labeled handled (`src/App.elm:32913-32925`); netsplit/netjoin batches are not summarised (QUITs fold one by one) |
| `bot` | Bot flag/tag | **PARTIAL**: not requested; the WHOIS 335 badge works (`src/View/Profile.elm:81-83`); no per-message bot tag display |
| `draft/channel-rename` | Native RENAME (else PART+JOIN) | **PARTIAL**: inbound `foldRename` `src/App.elm:28906`; no outbound RENAME |
| `extended-monitor` | AWAY/SETNAME/CHGHOST/ACCOUNT for MONITOR targets | **FULL** (routed through the normal folds) |
| `account-notify` | ACCOUNT lines | **FULL** (`src/App.elm:5373`) |
| `draft/account-registration=custom-account-name` | REGISTER live | **FULL** (guest claim) |
| `draft/metadata-2` | METADATA GET/LIST/SET/CLEAR | **PARTIAL** (§12) |
| `standard-replies` | FAIL/WARN/NOTE | **PARTIAL** (§0.2) |
| `cap-notify` | Static set, no NEW/DEL | **FULL** |
| `labeled-response` | §1 | **FULL** |
| `draft/pre-away` | AWAY before 001 | **CORE-ONLY** (requested, never used) |
| `draft/channel-context` | `+draft/channel-context` tag relay | **MISSING** (`grep channel-context src/` → none) |
| `draft/multiline=max-bytes=40000,max-lines=64` | §1 | **FULL** |
| `sts` | §1 | N/A |
| `account-extban=a` | `$a` bans | **FULL** (ban builder `src/View/Bans.elm:137`) |
| `utf8-only` | UTF-8 enforced | **FULL** (Elm emits UTF-8) |
| `draft/netsplit` / `draft/netjoin` | Typed netsplit/netjoin BATCHes | **CORE-ONLY** (requested; batch type not interpreted) |
| `onyx/2fa=IDENTIFY` | Signals that 2FA accounts must log in via IDENTIFY | **MISSING** (D2) |

## 3. ISUPPORT (005)

Static list: `src/proto/protocol_inventory.zig` `isupport_tokens`. Dynamic
overrides plus PREFIX/STATUSMSG/MODES/NETWORKICON/VAPID/ACCOUNTRESIDENCE:
`buildIsupportTokens` `src/daemon/server.zig:1901-1975`. Elm parses only
`ACCOUNTRESIDENCE CASEMAPPING CHANLIMIT CHANMODES CHANTYPES IRCX MAXCHANNELS
MODES NETWORK NICKLEN PREFIX SILENCE STATUSMSG TOPICLEN VAPID`
(`src/Isupport.elm`).

| Token (default) | Meaning | Elm |
|---|---|---|
| `IRCX` | Speaks IRCX; Elm sends `IRCX` on 001 | **FULL** (`src/App.elm:5108`) |
| `NETWORK=` (`[network] name`) | Network name | **FULL** |
| `CHANTYPES=#&` | | **FULL** |
| `NICKLEN=64` | | **FULL** |
| `TOPICLEN=390` | | **FULL** |
| `AWAYLEN=256`, `KICKLEN=307`, `CHANNELLEN=64`, `KEYLEN=64` | Length caps | **MISSING** (not parsed; Elm uses fixed bounds) |
| `MAXLIST=beIZ:100` | List-mode cap | **MISSING** |
| `CHANLIMIT=#&:50` | | **FULL** |
| `MAXTARGETS=4` | | **MISSING** (Elm never multi-targets) |
| `MONITOR=128` | | **MISSING** (Elm uses its own contact cap) |
| `SILENCE=32` | | **CORE-ONLY** (parsed, no SILENCE UI) |
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
| PLAIN | `src/proto/sasl.zig`, `src/daemon/dispatch.zig:1918` | **FULL** (refused for 2FA accounts, D2) |
| SCRAM-SHA-256 | `src/proto/sasl_scram_server.zig` | **FULL** (WebCrypto in ports.js) |
| SCRAM-SHA-512 / -512-PLUS | `src/proto/sasl_scram512_server.zig` | **MISSING** |
| EXTERNAL (client cert) | `src/proto/sasl_external*.zig` | **CORE-ONLY**: selectable, but a browser cannot present a client cert over wss in practice |
| SESSION-TOKEN (`sst_…` from `SESSIONTOKEN`) | `src/daemon/server.zig:45058` | **MISSING** (Elm reclaims with `SESSION RESUME` instead) |
| OAUTHBEARER | `src/proto/sasl_oauthbearer.zig`, `src/daemon/oauth_jwt.zig` | **MISSING** |
| ANONYMOUS | `src/proto/sasl_anonymous.zig` | **MISSING** (Elm guests use plain NICK) |
| IRCX `AUTH <package>` | `handleIrcxAuth` `src/daemon/server.zig:41063` | **MISSING** |
| `IDENTIFY <acct> <pw> [code]` (works for 2FA) | `handleIdentify` `src/daemon/server.zig:44434` | **PARTIAL**: used by guest claim and reclaim (`requestIdentify` `src/App.elm:28387`); no code field |
| Passkey login `WEBAUTHN AUTH`/`AUTH-FINISH` | `src/daemon/server.zig:46942-47000` | **CORE-ONLY**: builders exist (`src/Passkey.elm:338`, `:380`); sign-in UI is hidden |
| Recovery-code login `RECOVERYCODES LOGIN` | `src/daemon/server.zig:28358` | **FULL** (connect gate, `requestRecoveryCodesLogin` `src/App.elm:27872`) |

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
| VERSION | `query_info.zig:74` / `handleVersion:42740` | → 351 + 005 | reg | **RAW** | Elm never sends VERSION. It reads the 004 version (`src/App.elm:4609`). `"VERSION"` in `src/App.elm:7465` is the CTCP reply. |
| TIME | `:75` / `handleTime:42718` | → 391 | reg | **RAW** | `src/App.elm:7468` is CTCP TIME, not this command |
| ADMIN | `:76` / `handleAdmin:42727` | → 256/257/259 | reg | **RAW** | — |
| INFO | `:77` / `handleInfo:57182` | → 373/371…/374 (limits, classes, nick-delay, peers) | reg | **RAW** | — |
| DIRECTORY | `:78` / `handleDirectory:57251` | → 371 lines: listing flag, node, rank inputs, heatline | reg | **RAW** | `foldDirectoryNotice` (`src/App.elm:21907`) is the **E2EE device directory**, not this command |
| MOTD | `:79` / `handleMotd:42649` | → 375/372/376 (template with `{weather}`/`{news}` placeholders, `src/proto/motd_template.zig`) | reg | **CORE-ONLY** | Collected at 001, never shown (§0.1) |
| LUSERS | `:80` / `handleLusers:42489` | → 251-255, 250, 265, 266 | reg | **FULL** | Sent at 001 (`src/App.elm:5119`), home stats `foldLusers:19778` |
| USERS | `:81` / `handleUsers:57291` | → 392/393/394/395 | reg | **RAW** | — |
| LINKS | `:82` / `handleLinks:57313` | → 364/365 mesh peers | reg | **RAW** | Status page uses its own node probe (`src/Nodes.elm`) |
| MAP | `:83` / `handleMap:57696` | → 015/017 | reg | **RAW** | — |
| CHANSTATS | `:84` / `handleChanstats:57040` | `CHANSTATS <TOPUSERS\|WORDS\|ACTIVITY\|RECORD\|HELP> [#chan]` → NOTICEs; needs `[stats].channel_dir` | reg, cfg | **PARTIAL** | The command is not used, but the **same data** is rendered from the JSON the server writes (`index.json`/`<slug>.json`, `src/daemon/chanstats.zig:479-535`) by `src/Stats.elm:106-108,767-777` + `src/View/Stats.elm` |

### 5.2 `channel.ops` (`src/daemon/modules/channel_ops.zig`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| JOIN | `:59` / `handleJoin:22515`, gates `joinDenied:22382`, `joinOneWith:22598` | `JOIN #a,#b k1,k2` \| `JOIN 0`. Gates: CHANLIMIT 405, quarantine 474, `+S` 489, `+O`/`+A` 520, `+a` 477, AKICK, IRCX ACCESS DENY 474, `+b` 474, `+i` 473, `+k` 475, `+j`/raid throttle 480, `+l` 471 → `+d` clone or `+f` forward (470), RESV/SACCESS 437 | reg | **FULL** (join) / **PARTIAL** (errors) | `enterBrowserRoom:16689`, `/join` `src/App.elm:12981`. 471/473/474/475 join prompt (`foldErrorNumeric:17116`). 477/480 are generic notices; 489/520/470 are silent (D9). No KNOCK offer. |
| PART | `:60` / `handlePart:22973` | `PART #a,#b [:reason]`; ONPART prop message delivered | reg | **FULL** | `/part` `src/App.elm:12982`, room leave |
| NAMES | `:61` / `handleNames:23076` | → 353/366; sealed rooms → `FAIL NAMES MEMBERSHIP_SEALED` | reg | **FULL** | `foldNames:23377`, `namesAfterSelfJoin:23072`. The sealed FAIL is dropped (§0.2). |
| MODE | `:62` / `handleMode:23200`, user `handleUserMode:23742`, oper `handleOperUserMode:23812` | Channel query/set (324/329/367-368/346-347/348-349/728-729); own umodes 221; oper may set others' `+M`/`+P` only | reg | **PARTIAL** | See §7-§9: only `b i m n t s k l o v q` have UI; `/mode` slash `src/App.elm:12991` |
| KICK | `:63` / `handleKick:23892` | `KICK #c nick [:reason]` | op | **FULL** | `/kick:12993`, desk `applyModerationAction:10922`, profile controls `src/View/Profile.elm:765` |
| INVITE | `:64` / `handleInvite:24857` | `INVITE nick #c` → 341; `+g` free-invite | op (`+g`: member) | **FULL** | `/invite:12985`, desk invite form `src/View/Bans.elm:397`, `src/App.elm:42434` |
| TOPIC | `:65` / `handleTopic:59817` | `TOPIC #c [:text]` → 331/332/333 | `+t`: op | **FULL** | `src/RoomSettings.elm:996`, `/topic:12979`, topic history |
| KNOCK | `:66` / `handleKnock:25118` | `KNOCK #c [:reason]` → 711 to caller, 710 to ops; 713 open, 714 on chan | reg | **RAW** | 710/711/713/714 → invisible sink (`src/App.elm:4673-4690`) |
| CREATE | `:67` / `handleCreate:41973` | `CREATE #c [modes] [clone-source]`; 926 exists | reg | **MISSING** | Elm creates rooms with JOIN (`submitCreateRoom:15936`); no clone-from-room |
| RENAME | `:68` / `handleRename:25173` | `RENAME #old #new [:reason]`; `FAIL RENAME CANNOT_RENAME\|CHANNEL_NAME_IN_USE\|INVALID_PARAMS` | op | **PARTIAL** | Inbound `foldRename:28906`, FAIL arm `src/App.elm:20918`; no rename UI or sender |
| CHANBADWORDS | `:69` / `handleChanbadwords:25677` | `CHANBADWORDS #c ADD\|DEL\|LIST [pattern]` → NOTICEs | op | **RAW** | — |

### 5.3 `messaging` (`src/daemon/modules/messaging.zig`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| PRIVMSG | `:62` / `handleMessage:58733` | nick / `#c` / `@#c` STATUSMSG / multi-target (MAXTARGETS). Refusals: 404 (`+m +n +C +T` ban/quiet, slowmode `"(slowmode)"` `:58213`), 401, 407, 477, 716/717, `FAIL PRIVMSG CTCP_BLOCKED\|E2EE_REQUIRED\|INVALID_UTF8\|TEMPORARILY_UNAVAILABLE`; first-message HOLD (`captureFirstHold:43395`) | reg | **FULL** | composer send `src/App.elm:10619`; failures toast (`foldLabeledFail`); STATUSMSG audiences (`composerSendTarget`) |
| NOTICE | `:63` | Same engine, errors suppressed | reg | **FULL** | `/notice:12988` |
| TAGMSG | `:64` / `handleTagmsg:58223` | Relays allowed `+` client tags | reg | **FULL** | typing `sendTyping:6586`, reactions `sendReaction:6807` |
| REDACT | `:65` / `handleRedact:42303` | `REDACT #c msgid [:reason]` (op); `FAIL REDACT NEED_REGISTRATION\|UNKNOWN_MSGID` | op | **FULL** | `requestDelete:8154`, inbound `foldRedact:7120`; FAIL dropped |
| EDIT | `:66` / `handleEdit:42365` | `EDIT target msgid :text` (author only) → PRIVMSG with `+draft/edit` | reg | **FULL** | `requestEdit:8100`, `foldEdit:7162`; `FAIL EDIT` dropped |
| CHATHISTORY | `:67` / `handleChathistory:27289`, targets `:27237` | `LATEST\|BEFORE\|AFTER\|AROUND\|BETWEEN\|TARGETS` (`src/proto/chathistory_cmd.zig:137-179`, `src/proto/chathistory_targets.zig:120`); `+onyx/topic` filter; 64 cap | reg+cap | **FULL** | LATEST `src/App.elm:23614`, BEFORE `:23798`, AROUND `:23842`, TARGETS `:33566`. AFTER/BETWEEN are unused on purpose (COVERAGE) |
| SEARCH | `:68` / `handleSearch:27450`, `src/daemon/search_cmd.zig` | `SEARCH <target> :<query>`; `FAIL SEARCH INVALID_PARAMS\|INVALID_TARGET\|RATE_LIMITED\|RESULTS_TOO_LARGE` | reg+cap | **FULL** | `src/App.elm:32537`, `src/View/Search.elm:287` |
| MARKREAD | `:69` / `handleMarkread:25442` | `MARKREAD <target> [timestamp=…]` | reg+cap | **FULL** | `src/App.elm:23608`, `:30949` |
| PINS | `:70` / `handlePins:25535` | `PINS #c [LIST\|ADD id\|DEL id\|CLEAR]` → `:srv PINS #c :ids` | list: member; edit: op | **PARTIAL** | Elm writes the `PINS` channel **PROP** instead (`writePins:13561`), so pinning works for ops. The `PINS` command and its replies are unused. `src/View/Pins.elm` |
| METADATA | `:71` / `handleMetadata:42155` | `GET\|LIST\|SET\|CLEAR` (no SUB/SYNC); 761/762/766/767/769 | reg+cap | **PARTIAL** | Own profile SET (`setOwnMetadata:9453`, keys §12), `GET ocean.dm-key` (`src/App.elm:35660`, `:45081`); LIST/CLEAR are not used |
| MONITOR | `:72` / `handleMonitor:25252` | `+ - C L S`; 730-734 | reg | **FULL** | friends/watch contacts `monitorAddContact:25365`, `foldMonitorOnline:25816` |
| SILENCE | `:73` / `handleSilence:25605` | `SILENCE [+\|-mask]` → 271/272 | reg | **CORE-ONLY** | `Services.silenceEntry` is never called. `/ignore` is local only (`src/App.elm:13002`); 271/272 go to the invisible sink |

### 5.4 `accounts` (`src/daemon/modules/accounts.zig`, feature `accounts`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| REGISTER | `:133` / `handleRegister:44313` | `REGISTER <acct\|*> <email\|*> <pw>` → raw `REGISTER SUCCESS`; FAIL `ACCOUNT_EXISTS BAD_ACCOUNT_NAME INVALID_PASSWORD INVALID_EMAIL ACCOUNT_FORBIDDEN TEMPORARILY_UNAVAILABLE NEED_MORE_PARAMS` (`registerFailCode:44146`) | reg | **FULL** | guest claim `requestRegister:24843`, `src/View/GuestClaim.elm`, connect "create account" |
| VERIFY | `:134` / `handleVerify:28066` | `VERIFY [acct] <code>` | reg | **FULL** | `requestVerify:24881` |
| IDENTIFY | `:135` / `handleIdentify:44434` | `IDENTIFY <acct> <pw> [code]`; `FAIL IDENTIFY TOTP_REQUIRED` | reg | **PARTIAL** | `requestIdentify:28387` with no TOTP code (D2) |
| TOTP | `:136` / `handleTotp:28197` | `ENROLL\|CONFIRM <code>\|DISABLE\|STATUS` | acct | **FULL** | `src/View/Account.elm:511-740`, `requestTotp*:28172-28263`, `foldTotpNotice:28321` |
| RECOVERYCODES | `:137` / `handleRecoveryCodes:28291` | `STATUS\|GENERATE [pw]\|CLEAR [pw]\|LOGIN <acct> <code>` | acct / any for LOGIN | **FULL** | `src/View/Account.elm:1117-1280`, `foldRecoveryCodesNotice:28018` |
| LOGOUT | `:138` / `handleLogout:44505` | → 901 + NOTICE | acct | **FULL** | `requestLogout:26684` |
| DROP | `:139` / `handleDrop:44567` | `DROP <acct> <pw>` | acct | **FULL** | `requestDropAccount:27196`, `src/View/Account.elm` drop section |
| SETPASS | `:140` / `handleSetpass:44617` | `SETPASS <cur> <new>` \| `SETPASS <new>` (cert-verified) | acct | **MISSING** (and D1) | — |
| RESETPASS | `:141` / `handleResetpass:44684` | `RESETPASS <acct>` → emailed code; `RESETPASS <acct> <code> <new>` | any reg (logged out) | **MISSING** | no forgot-password flow |
| SUCCESSOR | `:142` / `handleSuccessor:44761` | `SUCCESSOR #c SHOW\|SET <acct>\|CLEAR` | founder/oper | **RAW** | — |
| ACCOUNTINFO | `:143` / `handleAccountInfo:44872` | → `account=… flags=… suspended=… forbidden=… noexpire=…` | reg | **FULL** | `requestAccountInfo:26541`, `foldAccountInfoNotice:26608`, overview `src/View/Account.elm:107` |
| ACCOUNT | `:144` / `handleAccountAdmin:44906` | `ACCOUNT SUSPEND\|UNSUSPEND\|FORBID\|UNFORBID\|NOEXPIRE\|INFO <acct> [on\|off]` | oper:service_admin | **RAW** | — |
| SASLINFO | `:145` / `handleSaslInfo:44999` | → NOTICEs | reg | **RAW** | `Services.saslInfo` is never called |
| ACCOUNTSET | `:146` / `handleAccountSet:47144` | `<acct> <pw> email\|flags\|secure\|enforce <value>` | acct | **PARTIAL** | email works (`requestAccountSetEmail:27108`); password is wrong (D1); secure/enforce/flags have no UI |
| GHOST | `:147` / `handleGhost:47197` | `GHOST <nick> <pw>` | acct | **FULL** | nick reclaim `ghostNick:28418`, `reclaimNickWithPassword:28433`; `FAIL GHOST` dropped |
| RECOVER | `:148` / `handleRecover:47257` | `RECOVER <nick>` | acct | **RAW** | `Services.recover` is never called; only its FAIL is folded (generic arm) |
| RELEASE | `:149` / `handleRelease:47320` | `RELEASE <nick>` | acct | **RAW** | — |
| CHANNEL / CS | `:150-151` / `handleChannel:47370` | §6.1 | acct | **PARTIAL** (DROP only, broken D7) | `src/App.elm:21559` |
| SESSION | `:152` / `handleSession:49009` | §6.2 | acct | **FULL** (exc. REDIRECT D8) | §6.2 |
| SESSIONTOKEN | `:153` / `handleSessionToken:45058` | → `NOTICE SESSIONTOKEN <acct> <token> expires=<s>` (TLS only) | acct | **MISSING** | — |
| CERTADD / CERTLIST / CERTDEL | `:154,160,161` / `:45065,45077,45093` | Bind/list/remove TLS cert fingerprints | acct | **FULL** | `src/View/Account.elm:743-800`, `requestCert*:27297-27332`, `foldCertNotice:27393` (browser cannot present a cert, so CERTADD is moot) |
| WEBAUTHN | `:155` / `handleWebauthn:46733` | §6.4 | acct / any (AUTH) | **PARTIAL** | register/list/remove/rename FULL (`src/Passkey.elm`, `src/View/Account.elm:1285`); AUTH login hidden; STATUS unused |
| KEYTRANS | `:156` / `handleKeyTrans:46400` | `STATUS\|ROOT\|PROOF n\|EVENT n\|DEVICE acct dev\|CONSISTENCY n\|STORE …\|PEER node\|REQUIRE on\|off` | reg | **PARTIAL** | STATUS + PROOF (`requestKeytrans*:26032-26051`, `src/View/Account.elm:801`); the other 7 subcommands are missing |
| E2EEKEY | `:157` / `handleE2eeKey:46104` | `STATUS\|LIST [acct]\|ADD dev alg key\|DEL dev` | acct | **FULL** | `src/View/Account.elm:832`, `requestE2eeKey*:27220-27272`; automated publish `src/GroupPublisher.elm` |
| E2EEGROUP | `:158` / `handleE2eeGroup:45949`, oper barrier `:45858` | `E2EEGROUP #c KEY-PACKAGE\|COMMIT\|WELCOME from [to-acct to-dev] :payload`; oper `STATUS\|ON\|OFF` | acct + IRCX + onyx/e2ee | **PARTIAL** | client records FULL (automated, `src/GroupControl.elm`, `foldE2eGroupReply:22775`); oper STATUS/ON/OFF missing |
| IDENTITY | `:159` / `handleIdentity:46206` | `STATUS\|LIST [acct]\|ADD label pub sig\|DEL label\|RESIDENCE node epoch expiry sig\|VERIFY acct label pub sig` | acct | **PARTIAL** | ADD/RESIDENCE are automated (`src/App.elm:21258-21272`, `src/Attribution.elm`); LIST/DEL/VERIFY/STATUS have no UI |
| RECOGNIZE | `:162` / `handleRecognize:25367` | `RECOGNIZE ADD\|DEL\|LIST [mask]` | acct | **RAW** | — |
| LISTCHANS | `:163` / `handleListchans:25648` | → `LISTCHANS #c level`… | acct | **RAW** | — |

### 5.5 `ircx` (`src/daemon/modules/ircx.zig`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| IRCX / ISIRCX | `:59-60` / `handleIrcx:41053` | → 800 | any | **FULL** | IRCX sent on 001 `src/App.elm:5108`; 800 goes to the invisible sink |
| DATA / REQUEST / REPLY | `:61-63` / `handleData:41176` | `DATA <target> <tag> :msg`; 904 badtag, 913, 531 (`+V`) | reg | **CORE-ONLY** | builders `src/Ircx.elm:1139-1159` are never called; inbound DATA has no fold |
| WHISPER | `:64` / `handleWhisper:41621` | `WHISPER #c n1,n2 :text`; 923 if `+w` | member | **PARTIAL** | receive FULL (`Ircx.foldWhisperLine`, `src/View/Thread.elm:555`); **no send UI** (`Ircx.whisper` is never called) |
| PROP | `:65` / `handleProp:40574` | §11 | reg; write op/self/oper | **PARTIAL** | §11 |
| ACCESS | `:66` / `handleAccess:39602` | `ACCESS #c ADD\|DELETE\|LIST\|CLEAR [level] [mask] [secs] [:reason]` → 801-805; `NOTE ACCESS ACCESS_COPIED` | op/owner/founder | **FULL** | `src/View/RoomSettings.elm:482` access manager, `src/Ircx.elm:1216-1303`, `foldAccess` (801-805, 775/776) |
| SACCESS | `:67` / `handleSaccess:39584` | `SACCESS ADD DENY\|GAG\|GRANT\|NOCHANNEL\|NONICK\|HOLDNICK <mask> [secs] [:reason] \| DEL \| LIST \| CLEAR` | oper:service_admin | **RAW** | — |
| AUTH | `:68` / `handleIrcxAuth:41063` | IRCX SASL packages; 912 for ANON/GateKeeper | any | **MISSING** | — |
| EVENT | `:69` / `handleEvent:37040` | §13 | reg (CHANNEL/MEMBER/MEDIA) / oper | **PARTIAL** | `EVENT ADD MEDIA *` on 001 (`src/App.elm:5116`); oper desk ADD/DEL/LIST/OBSERVE/BROADCAST/REPLAY; live feed dropped (D5) |
| MODEX | `:70` / `handleModex:36921` | `MODEX #c[,nick] [+NAMED …]` → 826/827 | reg; set: op | **PARTIAL** | query-only `/modex` (`src/App.elm:12992`, `requestModex:19270`, `foldModexList:19441`); no named-mode setting |
| LISTX | `:71` / `handleListx:24395` | `LISTX [filters]` → 811/812/813/816/817 | reg | **CORE-ONLY** | builder `src/Ircx.elm:1313` is never called; numerics go to the invisible sink |

### 5.6 `user.query` (`src/daemon/modules/user_query.zig`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| ISON | `:75` / `handleIson:24008` | → 303 | reg | **N/A** | MONITOR is used instead |
| USERHOST | `:76` / `handleUserhost:24028` | → 302 | reg | **N/A** | — |
| WHOIS | `:77` / `handleWhois:24478`, `src/daemon/whois.zig` | 311,312,313,317,318,319,320,330,335,338,276,671,301,401; remote mesh WHOIS | reg | **FULL** | `foldWhois:5945`, `src/View/Profile.elm:26-330` |
| LIST | `:78` / `handleList:24287` | ELIST filters → 321/322/323 | reg | **PARTIAL** | browse `refreshChannelList:16478`, `src/View/Browser.elm`; no server-side filters |
| WHO / WHOX | `:79-80` / `handleWho:24189`, `handleWhox:24051` | 352/354/315; sealed → `FAIL WHO MEMBERSHIP_SEALED` | reg | **FULL** | v3/gap-people: our own join sends `WHO #room %tcnfa,616`; the 354 rows (token 616) set away and the peer account (`PeerAccount.parseWhoxRow`); other 354 replies still reach the numeric log |
| WHOWAS | `:81` / `handleWhowas:25080` | → 314/312/369/406 | reg | **RAW** | `Services.whowas` is never called |
| AWAY | `:82` / `handleAway:43289` | → 305/306 | reg | **FULL** | `/away` `/back` `setUserStatus:19562`, 305/306 arms |
| SETNAME | `:83` / `handleSetname:43339` | `SETNAME :realname` | reg | **MISSING** | inbound only (`foldSetname:6007`) |
| NICK | `:84` / `handleNickChange:42964` | 431/432/433/437/438 | reg | **FULL** | `/nick:12980`, `foldNick:28609` |
| QUIT | `:85` / `handleQuit:59893` | | reg | **FULL** | — |
| ACCEPT | `:86` / `handleAcceptCmd:29262` | `ACCEPT +n -n *` → 281/282; 456-458 | reg | **CORE-ONLY** | `Services.acceptEntry` is never called; no `+g` UI |
| HELP / HELPOP | `:87-88` / `handleHelp:42438`, `src/proto/help_db.zig` | → 704/705/706, 524 | reg | **CORE-ONLY** | `/help` is local-only (`src/App.elm:13025`); 704-706 go to the invisible sink (`src/App.elm:4661-4672`) |
| AUTOJOIN | `:89` / `handleAutojoin:27975` | `AUTOJOIN ADD\|DEL\|LIST [#c]` (per account, applied on login) | acct | **MISSING** | `/autojoin` is **device-local** (`src/App.elm:13009`) |
| GROUP | `:90` / `handleGroup:28016` | `GROUP ADD\|DEL\|LIST\|PRIMARY [nick]` | acct | **RAW** | — |
| WELCOME | `:91` / `handleWelcome:28386` | `WELCOME [SHOW]` (any); `ADD :line\|CLEAR` (network onboarding pack, sent once to new accounts) | reg / oper for edits | **CORE-ONLY** | builders `src/Services.elm:1330-1344` are never called; the pack arrives as `NOTICE WELCOME :…` and goes to the invisible sink |

### 5.7 `feature.misc` (`src/daemon/modules/feature_misc.zig`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| VHOST | `:97` / `handleVhost:55139` | §6.3 | reg/acct; oper for APPROVE/DENY/OFFER/SET | **PARTIAL** | LIST/USE/OFF/CLAIM (`requestVhost*:27615-27695`, `src/View/Account.elm:876`); REQUEST/OFFERLIST/oper verbs missing |
| PRIVS | `:98` / `handlePrivs:55111` | → 270 | oper | **PARTIAL** | Sent by `/privs` (`src/App.elm:13029`) and the oper desk; the 270 reply has no arm and goes to the invisible sink |
| FILTER | `:99` / `handleFilter:55036` | `FILTER ADD\|DEL\|LIST [pattern]` | oper | **RAW** | — |
| POLICY | `:100` / `handlePolicy:54998` | `POLICY [LIST\|ROLLBACK]` (ward/filter/class/ban generations) | oper | **RAW** | — |
| OUTHOOK | `:101` / `handleOutboundWebhook:7277` | `OUTHOOK ADD <url> <secret> <categories> \| DEL <url> \| LIST` | oper:server_admin | **RAW** | — |
| BOTGRANT | `:102` / `handleBotGrant:7397` | `BOTGRANT ADD <acct> <speak\|webhook\|history> <#c> <ttl> \| DEL … \| LIST [acct]` | oper:server_admin | **RAW** | — |
| DEFER | `:103` / `handleDefer:38762` | `DEFER AT <unix-ms> #c :text` \| `DEFER CRON m h dom mon dow #c :text` \| `DEFER <when> OPER #c <flag>`; no LIST/CANCEL | reg (OPER form: oper) | **MISSING** | Elm scheduling is **client-side** (`src/Schedule.elm`, `requestScheduleMessage`, `src/View/Scheduled.elm`) and only fires while a tab is open |
| UNFURL | `:104` / `handleUnfurl:27752` | `UNFURL ON\|OFF\|https://…` → `NOTICE UNFURL title=… description=… image=…` | reg, cfg | **N/A (alternative)** | Elm previews use the deployment `/linkpreview` proxy (ports.js) and `liveUnfurlPrivacy` |
| APPEAL | `:105` / `handleAppeal:27892` | `APPEAL <text>` (once per window, works **pre-registration**) → `APPEAL filed <id>`; oper `APPEAL LIST`, `APPEAL ANSWER <id> :text` | any; oper for LIST/ANSWER | **MISSING** | — |
| CHALLENGE | `:106` / `handleChallenge:17480` | pre-001 `CHALLENGE <answer>`; oper `CHALLENGE METHOD pow\|question`, `CHALLENGE QUESTION <q> :<a>` | any / oper | **MISSING** | D3 |
| HOLD | `:107` / `handleHold:43409` | `HOLD RELEASE\|DROP #c <nick>` (first-message review queue, see `HOLD` prop §11) | oper | **MISSING** | — |
| QUARANTINE | `:108` / `handleQuarantine:43538` | `QUARANTINE <nick> #c :reason` (parts all, joins #c, audited) | oper | **RAW** | — |
| BOTCMD | `:109` / `handleBotCmd:43467` | `BOTCMD ADD <name> <argc> :help \| RUN <name> [args] \| LIST` (bot accounts with a speak grant) | acct (bot) | **N/A** | bot-side API |
| MEDIA | `:110` / `media_cmd.zig` (`handleMedia:53929`) | §6.5 | member, cfg:media | **PARTIAL** | §6.5 |
| MEMO | `:111` / `handleMemo:52990` | `MEMO [LIST\|CLEAR\|SEND acct :msg\|FORWARD [acct\|OFF\|NONE]\|IGNORE [ADD\|DEL\|LIST] [acct]]` | acct | **PARTIAL** | login delivery `MEMO from X :text` is rendered (`parseMemoBody:18071`, `trackOfflineMemo:20777`); DMs to offline accounts become memos server-side; `Services.memo` (`src/Services.elm:950-1012`) is never called, so there is no LIST/CLEAR/FORWARD/IGNORE UI |
| WEBPUSH | `:112` / `handleWebpush:53189` | `SUBSCRIBE ep p256dh auth \| UNSUBSCRIBE ep \| LIST` | acct | **FULL** | ports.js `:8509`, `:8582`; `src/Push.elm`; `src/View/Account.elm:464` |
| ACTIVITY | `:113` / `handleActivity:58588` | `ACTIVITY SUBSCRIBE\|UNSUBSCRIBE #c`, `ACTIVITY TALLY #c <msgid>`; pushes `:<nick> ACTIVITY #c typing <state>` and react events | member | **PARTIAL** | SUBSCRIBE/UNSUBSCRIBE + typing/react folds (`activitySubscribeLine:6430`, `foldActivityTyping:6510`, `foldActivityReact:6898`); TALLY is unused |
| GEOIP | `:114` / `handleGeoip:39348` | `GEOIP <ip>` | oper:oper_spy | **RAW** | — |
| SUMMON | `:115` / `handleSummon:43575` | `SUMMON <nick> #c` → 342 (oper force-join) | oper | **RAW** | — |
| PONG | `:116` | no reply | any | **FULL** | — |

### 5.8 `services.ext` (`src/daemon/modules/services_ext.zig`)

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| RESV / UNRESV | `:53-54` / `handleResv:38279` | `RESV [ADD] #pat <ms> :reason \| DEL \| LIST \| SWEEP`; join → 437 | oper | **RAW** | — |
| JUPE / UNJUPE | `:56-57` / `handleJupe:38345` | `JUPE <glob> <ms> :reason \| DEL \| LIST \| SWEEP` | oper | **RAW** | — |
| FORCEOP/FORCEDEOP/FORCEJOIN/FORCEPART/FORCETOPIC | `:58-62` / `handleForceAction:38441` | `FORCE* #c nick [...]`; audited with `proof=` | oper | **RAW** | — |
| CLEAR | `:63` / `handleClear:38588` | `CLEAR #c USERS [KEEP <rank>] [ALLOW a,b] [:reason]` → KICKs + NOTICE count; `FAIL CLEAR PARTIAL` | founder/oper | **MISSING** | `/clear` is local scrollback (`src/App.elm:13001`) |
| TEMPMODE | `:64` / `handleTempmode:38928` | `TEMPMODE ADD #c <flag> [param] <dur> \| CANCEL #c <flag> [param] \| SWEEP` | op; oper for SWEEP | **MISSING** | Elm temp-ban is a **client timer** (`requestTempBan:20427`, `fireTempBan:20570`) that dies with the tab |
| CLONES | `:65` / `handleClones:39444` | NOTICE report | oper | **RAW** | — |
| SEEN | `:66` / `handleSeen:38995` | `SEEN <acct>` → NOTICEs | reg | **RAW** | `Services.seen` is never called |

### 5.9 `oper.security`, `ops.upgrade`, `diag.introspect`, `webhook`

| Command | Module / handler | Syntax → replies | Access | Elm | Elm evidence |
|---|---|---|---|---|---|
| OPER | `oper_security.zig:153` / `src/daemon/oper_cmd.zig:913` | Always 491 (oper via SASL account binding or GRANT) | reg | **FULL** | 381/491 arms `src/App.elm:5610-5636` (badge) |
| REHASH | `:154` / `oper_cmd.zig:1130` | → 382 | oper:server_rehash | **PARTIAL** | Sent by `/rehash` (`src/App.elm:13028`) and the desk; the 382 confirmation goes to the invisible sink |
| GRANT / REVOKE / GRANTS | `:155-157` / `oper_cmd.zig:920,956,978` | `GRANT <acct> <class> [privs]`, `REVOKE <acct>`, `GRANTS` | oper:oper_grant | **RAW** | — |
| KILL | `:158` / `oper_cmd.zig:93` | `KILL <nick> [:reason]` (mesh relay) | oper:client_kill | **FULL** | `/kill:13027`, desk kill form `src/View/ModDesk.elm:367-378` |
| CLOSE | `:159` / `oper_cmd.zig:65` | | oper:client_moderate | **RAW** | — |
| DRAIN | `:160` / `oper_cmd.zig:54` | `DRAIN [OFF]` | oper:server_admin | **RAW** | — |
| UNREJECT | `:161` / `oper_cmd.zig:34` | `UNREJECT <ip>`; `FAIL UNREJECT INVALID_IP` | oper | **RAW** | — |
| WARD | `:162` / `oper_cmd.zig:506` | `WARD ADD <match> <pattern> [node\|mesh] [refuse\|expel\|quarantine\|require_auth] [secs] [:reason] \| DEL \| LIST [match] \| TEST <match> <value>`; match ∈ address host mask account realname certfp country asn | oper:client_moderate | **RAW** | — |
| SPAMTRAP | `:163` / `oper_cmd.zig:1067` | `SPAMTRAP ADD\|DEL NICK\|CHAN <target> \| LIST` | oper:client_moderate | **RAW** | — |
| KLINE / DLINE / XLINE | `:164-166` / `oper_cmd.zig:599` | `[ADD\|DEL] <pattern> [secs] [:reason]` → Warden aliases | oper:client_moderate | **RAW** | — |
| SHUN / UNSHUN | `:167-168` / `oper_cmd.zig:410` | `SHUN [<mask> [secs] [:reason]]`, `UNSHUN <mask>` | oper:client_moderate | **RAW** | — |
| ABUSE | `:169` / `oper_cmd.zig:304` | `ABUSE <nick>` (why throttled/shunned/DNSBL/reputation) | oper | **RAW** | — |
| GLOBAL | `:170` / `oper_cmd.zig:474` | `GLOBAL [mask\|#c] :text` | oper:server_admin | **RAW** | the desk "broadcast" uses `EVENT BROADCAST` (oper-only audience), not GLOBAL (all users) |
| OPERMOTD | `:171` / `oper_cmd.zig:382` | `OPERMOTD [SET :text]` | oper | **RAW** | — |
| DIE / RESTART | `:172-173` / `oper_cmd.zig:684` | | oper:server_shutdown/restart | **RAW** | — |
| CONNECT / SQUIT | `:174-175` / `oper_cmd.zig:800,837` | `CONNECT <host> <port>`, `SQUIT <server>` | oper:mesh_admin | **RAW** | — |
| TRACE / ETRACE | `:176-177` / `oper_cmd.zig:710,774` | 205/262, 709 | oper | **RAW** | — |
| STATS | `:178` / `oper_cmd.zig:146` | letters `u o k/K d/D y/Y l/L z/Z p/P c/C i/I m/M`; only `p` is public | reg (`p`) / oper | **RAW** | — |
| TESTLINE / TESTMASK | `:179-180` / `oper_cmd.zig:874,891` | 725/726, 727 | oper | **RAW** | — |
| USERIP | `:181` / `oper_cmd.zig:651` | 340 | oper:oper_spy | **RAW** | — |
| DEBUG | `:182` / `oper_cmd.zig:862` | flight recorder NOTICEs | oper:audit_read | **RAW** | `"DEBUG"` in `src/Spine.elm` is a category name only |
| AUDIT | `:183` / `oper_cmd.zig:994` | `AUDIT [JSON] [oper] [count] \| AUDIT PROOF [JSON] <id>` → `EVENT <oper> AUDIT …` | oper:audit_read | **RAW** | rows are EVENT lines and are ignored (D5) |
| SESSIONS | `:184` / `oper_cmd.zig:725` | `SESSIONS [oper\|user] [tls\|clear] [glob] [account=] [ip=] [sort=connected] [limit=N]` → 205/262 | oper | **RAW** | — |
| MESH / NETSTAT / ROUTE / NETHEALTH | `:185-188` / `oper_cmd.zig:1334,1486,1503` | `MESH [LOG\|GRANTS\|ADMISSION]` | oper | **RAW** | Status page shows probe latency only |
| UPGRADE | `upgrade.zig:24` / `handleUpgradeCommand:29364` | Helix hot upgrade | oper:server_restart | **RAW** | — |
| MODULES / MODLIST | `introspect.zig:326` | `MODULES [id]` | oper | **RAW** | — |
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
| `REGISTER #c` | `:47391-47397` | `Channel #c registered to <acct>` | acct (op on channel) | **MISSING** |
| `DROP #c` | `:47400-47405` | `Channel #c dropped` | founder | **PARTIAL**: sent by "delete room" (`src/App.elm:21559`); fails for unregistered rooms (D7) |
| `INFO #c` | `:47407-47425` | `channel=… founder=… flags=… mlock=… topiclock=… guard=… private=…`, `  desc:`, `  url:` | acct | **MISSING** |
| `SET #c MLOCK <+modes-modes>` | `:47436-47449` (`mode_lock.LockSpec`) | `Channel #c MLOCK set to …`; enforced on MODE (325 RPL_CHANNELMLOCK) | founder | **MISSING** |
| `SET #c KEEPTOPIC on\|off` | `:47450-47465` | snapshot restored on recreate | founder | **MISSING** |
| `SET #c TOPICLOCK\|GUARD\|PRIVATE on\|off` | `:47466-47485` (PRIVATE flips live `+s`) | `Channel #c <field> on\|off` | founder | **MISSING** |
| `SET #c DESC\|URL <text>` | `:47486-47505` | `DESC set\|cleared`, `URL set to …` | founder | **MISSING** |
| `ACCESS #c LIST\|ADD\|DEL <acct> <FOUNDER\|OP\|VOICE>` | `:47510-47545` | `ACCESS #c acct LEVEL`, `End of ACCESS list` | founder | **MISSING** (Elm manages **IRCX** `ACCESS`, which is a different, mask-based store) |
| `AKICK #c LIST\|ADD <mask\|account:x> [reason]\|DEL <mask>` | `:47546-47604` | `AKICK #c mask :reason`, `AKICK added/removed …`; enforced at JOIN (474) | founder/admin | **MISSING** |
| `TRANSFER #c <acct>` | `:47605-47613` | `Channel #c founder transferred to <acct>` | founder | **FULL** | v3/gap-people: Room care "Hand it over" sends it for registered (`+r`) rooms when the recipient's account is known (`RoomTransfer.handoverPlan`), plus `MODE +q`/`-q`. The server has no offer/accept step or pending-transfer state; the offer travels as a client-tag `TAGMSG` (`+onyx/room-transfer`) |
| `SUCCESSOR #c SHOW\|SET\|CLEAR` (top-level) | `handleSuccessor:44761` | NOTICEs; FAIL `ACCOUNT_UNKNOWN NOT_FOUNDER INVALID_VALUE …` | founder/oper | **RAW** |
| `LISTCHANS` (top-level) | `handleListchans:25648` | `LISTCHANS #c level` … `End of LISTCHANS (n)` | acct | **RAW** |

### 6.2 `SESSION` (multi-device reclaim)

Source: `handleSession` `src/daemon/server.zig:49009-49065`;
`handleSessionDrop:48917`; `handleSessionResume:49220`; mesh
`handleMeshReclaim:49462`, `handleMeshExactReclaim:49386`.

| Subcommand / line | Server | Elm |
|---|---|---|
| `SESSION LIST` → `SESSION LIST <*\|-> #n signon=<ms> <attached\|detached> [sid=<32hex>]`, `SESSION: end of session list` | `:49009` | **FULL** (`requestSessionList:26698`, roster `src/View/Account.elm:213-270`) |
| `SESSION DROP <#n\|sid=…>` → `SESSION DROP #n ok`; FAIL `INVALID_INDEX AMBIGUOUS_SID STALE_LIST CANNOT_DROP_CURRENT NO_SUCH_SESSION` | `:48917-49003` | **FULL** (`src/App.elm:38247-38252`) |
| `SESSION TOKEN` → NOTICE `SESSION TOKEN <hex\|credential>` + `SESSION MTOKEN <sealed> expires=<s>` | `:49032-49100` | **FULL** (`foldSessionTokenNotice:17463`) |
| `SESSION RESUME <token>` → `SESSION RESUME: already attached\|attached to live session\|…mesh session\|session restored`; `WARN SESSION ORIGIN_UNREACHABLE\|TEMPORARILY_UNAVAILABLE\|RESUME_CREDENTIAL_PRESERVED`; FAIL `INVALID_TOKEN NO_SESSION NO_ATTACHMENT ATTACHMENT_IN_USE RESUME_PENDING` | `:49220` | **FULL** (`maybeSendSessionCommands:17357`, `foldSessionReply:17429`) |
| `SESSION REDIRECT: [exact ]session lives on <node>; reconnect there to reclaim` | `:49447`, `:49634` | **MISSING** (D8) |

### 6.3 `VHOST` (host personas, "wardrobe")

Source: `handleVhost:55139` and siblings `:55206-55360`; durable store
`src/daemon/vhost_durable.zig`; persona/offer model `src/daemon/guise.zig`.
Applying a vhost sends `CHGHOST` to capable peers.

| Subcommand | Who | Elm |
|---|---|---|
| `VHOST` / `VHOST LIST` (wardrobe + offers) | reg | **FULL** (`requestVhostList:27615`, `src/View/Account.elm:876-984`) |
| `VHOST USE <name>` | acct | **FULL** (`requestVhostUse:27638`) |
| `VHOST OFF` | acct | **FULL** (`requestVhostOff:27695`) |
| `VHOST CLAIM <host>` (claim an offered template) | acct | **FULL** (`requestVhostClaim:27667`) |
| `VHOST REQUEST <host>` (ask opers) | acct | **MISSING** |
| `VHOST OFFERLIST` | reg | **MISSING** (offers arrive through LIST) |
| `VHOST APPROVE\|DENY <acct> [:reason]` | oper | **MISSING** |
| `VHOST OFFER <template> [:label]` | oper | **MISSING** |
| `VHOST SET <acct> <host> [name]`, bare `VHOST <host>` | oper | **MISSING** |
| FAIL `ACCOUNT_REQUIRED HOST_NOT_YOURS HOST_TAKEN INVALID_HOST TEMPORARILY_UNAVAILABLE` | — | **MISSING** (dropped, §0.2; `foldVhostNotice:27718` folds NOTICEs only) |

### 6.4 `WEBAUTHN` (passkeys)

Source: `handleWebauthn:46733-47140`. Replies are Event-Spine lines
`:srv EVENT <nick> WEBAUTHN <BODY>` (`webauthnReply:46720`), **not** `NOTE`.

| Subcommand | Elm |
|---|---|
| `STATUS` | **MISSING** |
| `REGISTER [label]` → `REGISTER-CHALLENGE <chal> <rp> :<acct>`; `REGISTER-FINISH <cred> <cdj> <authdata> [att]` → `REGISTERED` | **FULL** (`src/Passkey.elm:322-365`, ports WebAuthn) |
| `AUTH <acct>` → `AUTH-CHALLENGE`, `ALLOW-CRED`…; `AUTH-FINISH …` → login | **CORE-ONLY** (`src/Passkey.elm:338,380`; sign-in UI hidden) |
| `LIST`, `REMOVE <cred\|label>`, `RENAME <cred> :<label>` | **FULL** (`src/Passkey.elm:343-355`, `src/View/Account.elm:1285+`) |
| 25 FAIL codes (§15) | **FULL** (`foldPasskeyReply:22796`) |

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
| `JOIN #c [voice\|video\|screen]` (`TX_DENIED` if `+M`) | `media_cmd.zig:486-491` | **FULL** (voice; engine `media/voice-core.ts:293`) / video+screen **PARTIAL** (off on live) |
| `LEAVE #c` | `:472-476` | **FULL** (engine) |
| `MUTE`/`UNMUTE #c <kind>` | `:492-505` | **FULL** (engine; `src/Media.elm:452-470` builder unused) |
| `SPEAKING #c <kind> on\|off` → `SPEAKING`/`SILENT` | `:506-519` | **FULL** (engine `media/voice-core.ts:461`; fold `src/Media.elm:306`) |
| `OFFER #c <codecs> [transport=webrtc] [fingerprint=… setup=…]` → `OFFER-ACK`, `CAPS`, `TRANSPORT`, `NATIVE`, `KIND-DENIED` | `:62-75` | **FULL** (engine) |
| `ANSWER #c <codecs> …` → `ANSWER-ACK` | `:76-85` | **MISSING** (not used by the engine) |
| `ROSTER #c` → `ROSTER`…`ROSTER-END` | `:58-61` | **FULL** (engine + fold) |
| `PROFILE #c` | `:86-92` | **MISSING** |
| `STATS #c` → `STATS`…`STATS-END` | `:93-96` | **PARTIAL** (engine uses it; there is no stats panel) |
| `QUALITY #c` (members or oper) | `:44-51` | **MISSING** (Elm computes pips locally, `src/CallMedia.elm:385`) |
| `CONSENT #c on\|off` / `RECORD #c [stop]` (all must consent) | `:97-155` | **MISSING** |
| `LAYER #c <spatial> <temporal>` | `:156-184` | **MISSING** |
| `ABR #c <cur> <avail> <loss> <rtt> [nack]` | `:185-262` | **MISSING** |
| `BREAKOUT #c <room>` | `:263-280` | **CORE-ONLY** (`src/Media.elm:562` builder never called) |
| `POS #c <x> <y>` (spatial audio) | `:281-306` | **MISSING** |
| `CAPTION #c :text` | `:307-322` | **PARTIAL**: receive + render (`src/Media.elm:159`, `src/CallCaptions.elm`); Elm never sends captions |
| `TRANSCRIPT #c` → `TRANSCRIPT`…`TRANSCRIPT-END count=` | `:323-333` | **PARTIAL** (fold only; no request button) |
| `HAND #c [up\|down]` → `HAND` | `:437-451` | **PARTIAL**: inbound fold `src/Media.elm:335`; the Elm hand raise sends a ✋ `REACT` instead (`src/App.elm:41489-41517`) |
| `QUEUE #c` (speaking queue) | `:433-436` | **MISSING** |
| `REACT #c <emoji>` | `:452-467` | **FULL** (`src/App.elm:36392-36402`) |
| `E2EE-HANDSHAKE` / `E2EE-GROUPKEY` (acct + participant) / server `E2EE-DETACH` | `:334-432`, `:468-471` | **FULL** (Cadence engine) |
| Binary WS datagrams (Cadence frames, MACKEY) | `handleWsMediaDatagram` `src/daemon/server.zig:53961` | **FULL** (`mediaBinarySend`/`mediaBinaryReceived` ports) |
| 29 FAIL MEDIA codes (§15) | — | **PARTIAL** (all folded through `Media.foldMediaLine`; few have specific copy) |

## 7. Channel modes

Advertised `CHANMODES=beIZ,k,lfj,imnstCTNgSMWOAphuadErzxwVUFD`. Sources:

- core `src/daemon/chanmode.zig:98-118`
- IRCX ext `src/proto/chanmode_ext.zig` `mode_specs`
- Z/f/j `src/proto/protocol_inventory.zig` `world_modes`
- MODE handler `src/daemon/server.zig:23200-23740` (`+j` `:23630`, `+f` `:23650`, `+Z` `:23609`)

"Slash" means reachable only by typing `/mode #c ±X` (`src/App.elm:12991`).
Elm folds every advertised letter through `Modes.applyChannelModeDelta`
(data-driven), so display state stays correct even when no UI exists.

| Letter (MODEX name) | Group / param | Set by | Effect | Elm |
|---|---|---|---|---|
| `b` ban | A mask (+extbans) | op | Blocks JOIN (474); `+e` exempts | **FULL** (`src/View/Bans.elm`, `requestBanList:19059`, extban builder) |
| `e` exempt | A mask | op | Exempts from `+b`/`+Z` | **MISSING** (348/349 unhandled) |
| `I` invite-exception | A mask | op | Bypass `+i` | **MISSING** (346/347 unhandled) |
| `Z` quiet | A mask | op | Mutes without blocking JOIN | **MISSING** (728/729 unhandled) |
| `k` key | B | op | JOIN key (475) | **FULL** (`src/RoomSettings.elm:1022-1039`) |
| `l` limit | C int | op | 471, then `+d` clone or `+f` forward | **FULL** (`src/RoomSettings.elm:1043-1068`) |
| `f` forward | C #target (needs ops on target unless `+F`) | op | Redirect refused joins (470) | Slash |
| `j` join throttle | C `joins:secs` | op | 480 + one-shot raid alert | Slash |
| `i` invite-only | D | op | 473 | **FULL** (RoomSettings + desk) |
| `m` moderated | D | op | voice+ to speak | **FULL** |
| `n` no-external | D | op | | **FULL** |
| `t` topic-ops | D | op | | **FULL** |
| `s` secret | D | op | hidden from LIST; roster gated | **FULL** (also Stewardship "close room" `+si`, `src/App.elm:21528`) |
| `C` no-CTCP | D | op | 404 / `FAIL PRIVMSG CTCP_BLOCKED` | Slash |
| `T` no-notice | D | op | drop non-op NOTICE | Slash |
| `N` no-nick | D | op | blocks nick changes | Slash |
| `g` free-invite | D | op | any member may INVITE under `+i` | Slash |
| `S` TLS-only | D | op | 489 | Slash (and 489 is silent, D9) |
| `M` moderate-unregistered | D | op | unauth members need voice | Slash |
| `W` news-wire | D | op | enables `!news`/`!localnews` | Slash |
| `O` oper-only / `A` admin-only | D | oper | 520 | Slash (520 silent) |
| `p` PRIVATE | D (ext) | op | roster gated for non-members | Slash |
| `h` HIDDEN | D (ext) | op | omitted from LIST/NAMES enumeration | Slash |
| `u` KNOCK | D (ext) | op | enables KNOCK | Slash |
| `a` AUTHONLY | D (ext) | op | accounts only (477) | Slash |
| `f` NOFORMAT (MODEX only) | ext | op | strips formatting | `/modex` cannot set it either (query-only) → **MISSING** |
| `d` CLONEABLE | D (ext) | op | auto-clone `#c1…` when full | Slash |
| `E` CLONE / `r` REGISTERED / `z` SERVICE | D (ext) | **oper** | markers | Slash |
| `x` AUDITORIUM | D (ext) | op | members hidden from each other | Slash; Elm roster cannot explain an empty NAMES |
| `w` NOWHISPER | D (ext) | op | 923 | Slash |
| `V` NOCOMICDATA | D (ext) | op | DATA refused (531) | Slash |
| `U` OPMODERATE | D (ext) | op | blocked messages routed to ops | Slash; Elm never renders ops-routed held messages specially |
| `F` FREETARGET / `D` DISFORWARD | D (ext) | op | forward-target policy | Slash |
| MLOCK (services) | 325 `RPL_CHANNELMLOCK` | founder | Locks modes | **MISSING** (§6.1) |

## 8. Member status prefixes (`PREFIX=(YQqov)*!.@+`, `src/daemon/chanmode.zig:405`)

| Mode | Prefix | Meaning | Elm display | Elm control |
|---|---|---|---|---|
| `Y` | `*` | derived net-oper override tier | **FULL** (`Modes.statusRank`) | n/a |
| `Q` | `!` | founder (creator) | **FULL** | n/a (not grantable) |
| `q` | `.` | owner | **FULL** | **PARTIAL**: only the Stewardship transfer (`src/Stewardship.elm:481-493`) |
| `o` | `@` | operator | **FULL** | **FULL** (op/deop desk, profile, `/op`) |
| `v` | `+` | voice | **FULL** | **FULL** (`/voice`, desk) |
| `MODEX #c,nick` member names | 826/827 | — | **PARTIAL** (query) | — |

## 9. User modes (`src/proto/usermode.zig:148-166`)

Elm has a catalog (`Modes.userModeAccess`, `src/Modes.elm:351-404`) that is
**never used outside `Modes.elm`**. There is no preferences UI, and 221
`RPL_UMODEIS` goes to the invisible sink (`src/App.elm:4988-4992`). A user can
only type `/mode <ownnick> +R`.

| Mode | Policy | Effect | Elm |
|---|---|---|---|
| `i` invisible | user | hidden from WHO/ISON for strangers | **MISSING** |
| `B` bot | user | WHOIS 335, `bot` tag | **MISSING** (bots are external) |
| `D` deaf | user | no channel messages | **MISSING** |
| `g` caller-id | user | DMs need ACCEPT (716/717/718) | **MISSING** (no ACCEPT UI either) |
| `C` no-CTCP | user | blocks direct CTCP | **MISSING** |
| `R` regonly-PM | user | only logged-in users may DM you | **MISSING** (high-value anti-spam toggle) |
| `p` hide-chans | user | hides your channels in WHOIS | **MISSING** |
| `Q` no-forward | user | never forwarded by `+f` | **MISSING** |
| `H` hide-oper | user (oper) | | **MISSING** |
| `P` media-presence-private | user / oper cross-user | hides call presence | **MISSING** |
| `j` override | oper:oper_override | audited channel override | **MISSING** |
| `r`, `x`, `a`, `o` | server | registered / cloaked / admin / oper | **PARTIAL**: `o`/`a` via 381 badge only |
| `z` | server catalog (TLS); **oper cross-user `MODE nick +z` = GAG** (`applyGag` `src/daemon/server.zig:23137`, `:23219-23228`) | | **MISSING** |
| `M` media-tx-deny | server / oper cross-user (`handleOperUserMode:23812`) | blocks MEDIA tx | **MISSING** |

## 10. Extbans (`EXTBAN=$,acgmrz`, `src/proto/extban*.zig`)

| Type | Meaning | Elm |
|---|---|---|
| `$a:<account>` | account | **FULL** (builder `Modes.buildExtBan`, `src/View/Bans.elm:137-200`) |
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
| `OID NAME CREATION MEMBERCOUNT` | channel | read-only | computed | **CORE-ONLY** (`foldPropRow:20297`; 329 creation is used) |
| `MEMBERLIMIT` / `MEMBERKEY` | channel | host / owner (secret) | writes through to `+l`/`+k` | **N/A** (Elm uses MODE) |
| `FOUNDERKEY OWNERKEY HOSTKEY VOICEKEY` | channel | owner/host, **secret per tier** | a keyed JOIN matching `FOUNDERKEY`/`OWNERKEY`/`HOSTKEY` grants Q/q/o (`src/daemon/server.zig:22841-22852`); `VOICEKEY` is stored and read-gated only | **MISSING** ("role keys" UI) |
| `LANGUAGE` (31) / `SUBJECT` (31) | channel | host | LISTX filters (`S=`, language) | **MISSING** |
| `TOPIC` (160) | channel | host | IRCX topic mirror | **N/A** |
| `ONJOIN` / `ONPART` (255) | channel | host | server NOTICE to the joiner/leaver `:srv NOTICE <nick> :[#chan] <text>` (`deliverChannelPropMessage` `src/daemon/server.zig:22965-22970`) | **MISSING**: there is no room welcome-message setting, and the delivered NOTICE lands in the invisible sink (§0.1) |
| `PICS` (255) | channel | sysop_manager | LISTX 813 | **N/A** |
| `CLIENT LAG ACCOUNT CLIENTGUID SERVICEPATH` | channel | host/owner/sysop | IRCX legacy | **N/A** |
| `no-ai` / `local-only` / `server-ai-ok` (`0\|1`) | channel | host | AI consent policy | **PARTIAL**: read (`src/AiPolicy.elm:66-69`); no setter UI |
| `history-policy` (`public\|members\|opers`) | channel | host | CHATHISTORY visibility | **FULL** (`src/View/RoomSettings.elm:694`, `src/HistoryPolicy.elm`) |
| `encryption-policy` (`off\|optional\|required`) | channel | host | `required` rejects plaintext (`FAIL PRIVMSG E2EE_REQUIRED`) | **FULL** (`src/RoomSettings.elm:1107`, `src/View/RoomSettings.elm:649`) |
| `membership-visibility` (`ordinary\|sealed`) | channel | host | sealed rooms refuse NAMES/WHO (`src/proto/sealed_room.zig`) | **MISSING** |
| `EPHEMERAL` (secs; 0 off) | channel | host | hides older replay | **FULL** (`src/RoomSettings.elm:1088`, retention section `src/View/RoomSettings.elm:380`) |
| `RETAIN` (secs) | channel | host | **deletes** rows after TTL (`channelRetainTtlMs` `src/daemon/server.zig:27040`) | **MISSING** |
| `SLOWMODE` (secs ≤ 86400) | channel | host | per-member send gap; 404 "(slowmode)"; set automatically by the raid shield (§17) | **MISSING** (no setting, no countdown) |
| `SLOWVOICE` (`0\|1`) | channel | host | whether voice/ops wait too | **MISSING** |
| `HOLD` (n) | channel | host | first *n* messages per new member held for oper review (`captureFirstHold` `src/daemon/server.zig:43395`; sender gets NOTICE `HOLD stored`) | **MISSING** (sender sees nothing; message looks sent) |
| `PINS` (csv msgids) | channel | host | pinned messages | **FULL** (via PROP, `writePins:13561`, `src/View/Pins.elm`) |
| `onyx_server.topics` (csv) | channel | host (auto-added) | named-conversation registry | **PARTIAL**: topics are used through tags; there is no registry editor |
| `ocean.event` (client key) | channel | host | stored generically | **FULL** (`scheduleChannelEvent:13797`, `/event`) |
| `URL GENDER PICTURE BIO EMAIL` | user profile | self | IRCX user profile | **MISSING** (Elm uses METADATA `ocean.*` instead) |
| `STATUS` (client key) | user | self | — | **BROKEN** (D4) |
| `e2ee.device.<id>` | user | self (via E2EEKEY) | signed device facts | **FULL** (via E2EEKEY) |
| `identity.key.<label>` | user | self (via IDENTITY) | | **FULL** (automated) |
| Read markers | — | `ERR_SECURITY` "use MARKREAD" | | N/A |
| PROP errors 913/906/905/907/908 | — | — | — | **MISSING** (no arms → invisible sink) |

## 12. `METADATA` keys (draft/metadata-2)

`handleMetadata` `src/daemon/server.zig:42155-42290`: `GET`, `LIST`, `SET`,
`CLEAR` only (no `SUB`/`SYNC`). `*` = self.

| Key | Writer | Server use | Elm |
|---|---|---|---|
| `location`, `country` | server at connect (`setGeoLocation:39078`) | `!weather` default and units | **MISSING** (no "my location" setting; users could `METADATA * SET location`) |
| `weather_location` (on channel) | `!setweather` | `!weather` channel default | **N/A** (fantasy) |
| `ocean.display-name`, `ocean.pronouns`, `ocean.bio`, `ocean.accent`, `ocean.links`, `ocean.banner` (+ unprefixed aliases) | client | wire-format profile (CLAUDE.md) | **FULL** (`metadataProfilePatch:9257`, `setOwnMetadata:9453`, Profile view) |
| `ocean.dm-key`, `ocean.dm-keys` | client | DM E2EE key directory | **FULL** (ports.js:7766, `src/App.elm:35660`) |

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
| `EVENT ADD\|DEL\|CLEAR\|LIST CHANNEL\|MEMBER\|MEDIA [mask]` | any member | `handleEvent:37040` (non-oper limited to these 3 planes) | **PARTIAL**: `EVENT ADD MEDIA *` only (`src/App.elm:5116`); CHANNEL/MEMBER planes unused |
| `EVENT ADD\|DEL <category>\|ALL` | oper:event_subscribe | `:37218` usage | **FULL** to send (oper desk, `/events` `src/App.elm:13030`); delivered lines dropped (D5) |
| `EVENT LIST` | oper | 808/809/810 | **PARTIAL** (numerics go to the invisible sink) |
| `EVENT SEVERITY <floor>` | oper | `handleEventSeverity:37259` | **MISSING** (the desk filters client-side, `OperDesk.eventSeveritiesIn`) |
| `EVENT REPLAY [JSON] …` | oper | `handleEventReplay:37283` | **FULL** (`src/EventReplay.elm`, desk console `src/View/ModDesk.elm:449`) |
| `EVENT STATS [JSON]` (`operator_surfaces` map) | oper | `handleEventStats:37406` | **MISSING** |
| `EVENT BROADCAST :text` (ANNOUNCE to opers; the WALLOPS replacement) | oper | `src/daemon/server.zig:37052-37066` | **PARTIAL**: send FULL (desk + `/broadcast`); received announces dropped (D5); Elm's `WALLOPS` fold (`src/App.elm:5869`) never fires because the server never sends WALLOPS |
| `EVENT OBSERVE <mask> [connect quit nick join part host oper]` / `LIST` / `OFF` → `EVENT <you> OBSERVE …` | oper | `handleObserve:37943`; action tokens `src/daemon/observe.zig:31-41` | **PARTIAL**: send FULL (`/observe`, desk; same token set as `operObserveActions`, `src/App.elm:13977`); pushes dropped (D5) |

## 14. Numerics

**Sources:** `src/proto/numeric.zig:12-260` (full enum),
`src/daemon/server.zig:1700-1841` (server-local enum), and literal emitters:
USERIP 340 (`src/proto/userip.zig:20`), ETRACE 709
(`src/daemon/oper_cmd.zig:784`), IRCX AUTH 910/912
(`src/daemon/server.zig:40922`, `:41068`), and the PROP/ACCESS/LISTX/MODEX
builders in `src/proto/ircx_*.zig`.

**Elm side:** `foldLine` arms are at `src/App.elm:4593-5925`. Unlisted
numerics go to `logNumeric`, which is the invisible sink (§0.1).

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
| 001 | WELCOME | registration | **FULL** (`src/App.elm:5013`) |
| 002, 003 | YOURHOST, CREATED | registration | sink |
| 004 | MYINFO (version) | registration | **FULL** (`:4609`) |
| 005 | ISUPPORT | registration, VERSION | **FULL** (`:4594`) |
| 015/017 | MAP/MAPEND | MAP | sink |
| 200-209, 205, 262 | TRACE*, ENDOFTRACE | TRACE, SESSIONS | sink |
| 211-219, 242, 243, 249, 250 | STATS* | STATS, LUSERS(250) | sink (250 sink; 251-255 folded) |
| 221 | UMODEIS | MODE self | sink (`:4988`) |
| 251, 252, 254, 255 | LUSER* | LUSERS | **FULL** (home stats) |
| 253, 265, 266 | LUSERUNKNOWN, LOCAL/GLOBALUSERS | LUSERS | sink |
| 256-259 | ADMIN* | ADMIN | sink |
| 270 | PRIVS | PRIVS | sink |
| 271/272 | SILELIST | SILENCE | sink (`:5640-5648`) |
| 276 | WHOISCERTFP | WHOIS | **FULL** |
| 281/282 | ACCEPTLIST | ACCEPT | sink (`:5650-5657`) |
| 301 | AWAY | PRIVMSG to away user, WHOIS | **FULL** |
| 302, 303 | USERHOST, ISON | | sink (unused) |
| 305/306 | UNAWAY/NOWAWAY | AWAY | **FULL** |
| 311-313, 317-320, 330, 335, 338, 671 | WHOIS* | WHOIS | **FULL** (`:5737-5781`) |
| 314, 369, 406 | WHOWAS*, WASNOSUCHNICK | WHOWAS | sink |
| 315, 352, 354 | WHO/WHOX | WHO | 352 **FULL**; 315/354 sink |
| 321/322/323 | LIST | LIST | **FULL** (browser) |
| 324, 329 | CHANNELMODEIS, CREATIONTIME | MODE query | **FULL** |
| 325 | CHANNELMLOCK | MODE/services | sink |
| 331/332/333 | TOPIC | JOIN/TOPIC | **FULL** (333 folded with 332) |
| 340 | USERIP | USERIP | sink |
| 341 | INVITING | INVITE | sink (the invite still succeeds) |
| 342 | SUMMONING | SUMMON | sink |
| 346/347, 348/349 | INVITELIST, EXCEPTLIST | MODE `+I`/`+e` query | sink |
| 351 | VERSION | VERSION | sink |
| 353/366 | NAMES | JOIN/NAMES | **FULL** |
| 364/365 | LINKS | LINKS | sink |
| 367/368 | BANLIST | MODE `+b` query | **FULL** |
| 371-374 | INFO*, ENDOFINFO | INFO, DIRECTORY, MODULES, COMMANDS, OROWASM | sink |
| 375/372/376 | MOTD | MOTD | **CORE-ONLY** (collected, not shown) |
| 381 | YOUREOPER | oper elevation | **FULL** (badge) |
| 382 | REHASHING | REHASH | sink |
| 391 | TIME | TIME | sink |
| 392-395 | USERS* | USERS | sink |
| 401 | NOSUCHNICK | many | **FULL** (`fold401:6074`) |
| 402 | NOSUCHSERVER | SQUIT | sink |
| 403, 404, 405, 407 | NOSUCHCHANNEL, CANNOTSENDTOCHAN, TOOMANYCHANNELS, TOOMANYTARGETS | | **FULL** (`foldErrorNumeric:17116`: inbox error rows) |
| 409, 411, 412 | NOORIGIN, NORECIPIENT, NOTEXTTOSEND | | sink |
| 410 | INVALIDCAPCMD | CAP | sink (`src/App.elm:5525`) |
| 421 | UNKNOWNCOMMAND (also feature-disabled) | dispatch | **FULL** (inbox "Unknown command") |
| 431-433, 437 | nick errors | NICK | **FULL** (`foldNickError`) |
| 438 | NICKTOOFAST | NICK | sink |
| 441-443, 451, 461, 464, 467 | | | **FULL** (inbox) |
| 456-458 | ACCEPT errors | ACCEPT | sink |
| 462 | ALREADYREGISTRED | | sink (`:5520`) |
| 465 | YOUREBANNEDCREEP | | sink (and ERROR, D6) |
| 470 | LINKCHANNEL (forwarded) | JOIN `+f` | sink: the user lands in another room with no explanation |
| 471, 473-477 | join refusals | JOIN | **FULL** (join prompt / inbox) |
| 472 | UNKNOWNMODE | MODE/TEMPMODE | sink |
| 478 | BANLISTFULL | MODE | sink |
| 479 | BADCHANNAME | portable | sink |
| 480 | THROTTLE (`+j`/raid) | JOIN | **PARTIAL** (generic inbox text, no retry hint, `:5726`) |
| 481 | NOPRIVILEGES | oper gates | sink |
| 482 | CHANOPRIVSNEEDED | | **FULL** (inbox) |
| 489 | SECUREONLYCHAN | JOIN `+S` | sink (D9) |
| 491 | NOOPERHOST | OPER | **FULL** |
| 502 | USERSDONTMATCH | MODE | sink |
| 520 | OPERONLYCHAN | JOIN `+O`/`+A` | sink (D9) |
| 524 | HELPNOTFOUND | HELP | sink (`:4661`) |
| 531 | NOCOMICDATA | DATA under `+V` | sink |
| 704-706 | HELPSTART/TXT/END | HELP | sink (`:4664-4672`) |
| 709 | ETRACE row | ETRACE | sink |
| 710/711/713/714 | KNOCK, KNOCKDLVR, CHANOPEN, KNOCKONCHAN | KNOCK | sink (`:4673-4690`): ops never see knocks |
| 716/717/718 | CANTSENDTOUSER, TARGNOTIFY, UMODEGMSG (caller-id) | PRIVMSG to `+g` | sink: a blocked DM looks delivered |
| 725/726/727 | TESTLINE/NOTESTLINE/TESTMASK | oper | sink |
| 728/729 | QUIETLIST | MODE `+Z` | sink |
| 730-734 | MONITOR | MONITOR | **FULL** |
| 761/762, 766 | KEYVALUE, METADATAEND, KEYNOTSET | METADATA | **FULL** (`foldMetadata`, `:5839-5843`) |
| 767/769 | KEYINVALID, KEYNOPERMISSION | METADATA SET | sink (`:5845-5852`) |
| 800 | IRCX | IRCX/ISIRCX | sink |
| 801-805 | ACCESS ADD/DEL/START/ENTRY/END | ACCESS, SACCESS | **FULL** (`foldAccess`) |
| 806-810, 821-825 | EVENT add/del/start/list/end, dup/mis/nosuch/change | EVENT | sink |
| 811-817 | LISTX | LISTX | sink |
| 818/819 | PROPLIST/PROPEND | PROP | **FULL** (`foldPropRow:20297`) |
| 826/827 | MODEXLIST/END | MODEX | **FULL** (`/modex`) |
| 900/901 | LOGGEDIN/LOGGEDOUT | SASL/IDENTIFY/LOGOUT | **FULL** |
| 902 | (not emitted by the server) | — | named arm |
| 903-905 | SASL success/fail/toolong | AUTHENTICATE | **FULL** while an exchange is in flight (`:5476-5507`). 904 always shows the generic copy "SASL authentication failed" and drops the server text, including the 2FA hint (D2). |
| 906-908 | SASLABORTED, SASLALREADY, SASLMECHS | AUTHENTICATE | sink (`:5514` mislabels 906 as RPL_SASLMECHS) |
| 900, 903-908 (IRCX meaning) | BADCOMMAND, BADLEVEL, BADTAG, BADPROPERTY, BADVALUE, RESOURCE, SECURITY | PROP/DATA | sink/collision (see above) |
| 910/912 | IRCX AUTH | AUTH | sink |
| 913 | NOACCESS | PROP/DATA | sink (hides D4) |
| 914-916 | DUPACCESS, MISACCESS, TOOMANYACCESSES | ACCESS/SACCESS | sink |
| 923 | NOWHISPER | WHISPER | sink |
| 924-927 | NOSUCHOBJECT, NOTSUPPORTED, CHANNELEXIST, ALREADYONCHANNEL | CREATE etc. | sink |

## 15. Standard replies (`FAIL`/`WARN`/`NOTE`) — full catalog

Emitters: `failReply` / `warnReply` / `noteReply` at
`src/daemon/server.zig:55449-55500`. Clients without `standard-replies` get a
NOTICE instead. The catalog below combines literal codes with the codes
returned by `registerFailCode:44146`, `accountAdminFailCode:44962`,
`channelFailCode:47635`, `akickLiveFailCode:4158`, the device-property
outcome switch (`src/daemon/server.zig:19531-19540`), CHATHISTORY, SETPASS,
RESETPASS, CERTDEL, E2EEGROUP and RENAME.

Elm column: **specific** = dedicated copy/state; **generic** = action error +
inbox row; **toast** = send-failure toast; **dropped** = silently ignored
(§0.2).

| Command | Codes | Elm |
|---|---|---|
| FAIL ACCESS | `ACCESS_COPY_FAILED`; NOTE `ACCESS_COPIED` | dropped |
| FAIL ACCOUNT (oper) | `ACCOUNT_UNKNOWN BAD_ACCOUNT_NAME INVALID_SUBCOMMAND INVALID_VALUE NEED_MORE_PARAMS TEMPORARILY_UNAVAILABLE` | dropped |
| FAIL ACCOUNTINFO | `ACCOUNT_UNKNOWN TEMPORARILY_UNAVAILABLE` | specific (`src/App.elm:20900`) |
| FAIL ACCOUNTSET | `INVALID_FIELD INVALID_VALUE PRIVILEGED_FLAGS TEMPORARILY_UNAVAILABLE` | generic (D1 shows up here as `INVALID_FIELD`) |
| FAIL AUTOJOIN | `ACCOUNT_REQUIRED` | dropped |
| FAIL BATCH | `MULTILINE_INVALID` | dropped |
| FAIL CERTADD/CERTLIST/CERTDEL | `CERT_ADD_FAILED NOT_LOGGED_IN NO_CLIENT_CERT TEMPORARILY_UNAVAILABLE CERT_LIST_FAILED CERT_NOT_OWNED CERT_NOT_FOUND CERT_DEL_FAILED NEED_MORE_PARAMS` | generic |
| FAIL CHANNEL | `ACCESS_DENIED ACCOUNT_REQUIRED BAD_CHANNEL_NAME CHANNEL_EXISTS CHANNEL_UNKNOWN INVALID_PARAMS NEED_MORE_PARAMS TEMPORARILY_UNAVAILABLE AKICK_EXISTS LIST_FULL` | dropped |
| FAIL CHATHISTORY | `ACCESS_DENIED INVALID_PARAMS NEED_MORE_PARAMS NEED_REGISTRATION REPLAY_TOO_LARGE` | specific (history exhausted/error) |
| FAIL CLEAR | `PARTIAL` | dropped |
| FAIL CREATE / JOIN / PART / KICK / MODE / TAGMSG / WHISPER | `TEMPORARILY_UNAVAILABLE` (mesh durable admission) | TAGMSG/WHISPER toast; others dropped |
| FAIL DROP | `TEMPORARILY_UNAVAILABLE` | generic |
| FAIL E2EEGROUP / WARN E2EEGROUP | `BAD_PAYLOAD CAP_REQUIRED DEVICE_NOT_OWNED IRCX_REQUIRED NOT_LOGGED_IN NOT_ON_CHANNEL ORIGIN_REJECTED PEERS_NOT_CURRENT SESSION_UNAVAILABLE TARGET_UNAVAILABLE BAD_CHANNEL BAD_KIND BAD_DEVICE BAD_ACCOUNT`; WARN `AUTHORING_QUIESCED TEMPORARILY_UNAVAILABLE` | specific (`foldE2eGroupReply:22775`) |
| FAIL E2EEKEY | `BAD_DEVICE BAD_KEY DURABLE_UNAVAILABLE INVALID_SUBCOMMAND NEED_MORE_PARAMS NOT_LOGGED_IN SIGNER_UNAVAILABLE TEMPORARILY_UNAVAILABLE DEVICE_OWNER_MISMATCH BAD_DEVICE_FACT STALE_FACT REPLAY EQUIVOCATION RESTART_REQUIRED STORE_FAILED` | specific (`foldDirectoryFailure:21979`) |
| FAIL EDIT | `EDIT_FAILED INVALID_PARAMS NEED_REGISTRATION PERMISSION_DENIED UNKNOWN_MSGID` | dropped (unless labeled) |
| FAIL FILTER | `INVALID_PATTERN INVALID_SUBCOMMAND NO_SUCH_PATTERN TEMPORARILY_UNAVAILABLE` | dropped |
| FAIL GHOST | `ACCOUNT_REQUIRED NICK_NOT_OWNED TEMPORARILY_UNAVAILABLE` | dropped (the reclaim UI times out instead) |
| FAIL GROUP | `ACCOUNT_REQUIRED` | dropped |
| FAIL IDENTIFY | `TEMPORARILY_UNAVAILABLE TOTP_REQUIRED` | specific (`foldIdentifyReply`); but there is no code-entry path (D2) |
| FAIL IDENTITY | `BAD_ASSERTION BAD_EPOCH BAD_EXPIRY BAD_LABEL BAD_NODE INVALID_SUBCOMMAND NEED_MORE_PARAMS NOT_LOGGED_IN STALE_EPOCH STORE_FAILED TEMPORARILY_UNAVAILABLE WRONG_NODE` | `STALE_EPOCH` specific; the rest dropped |
| FAIL KEYTRANS | `BAD_ACCOUNT BAD_HEAD BAD_NODE BAD_POSITION BAD_SIGNATURE BAD_SIZE BAD_VALUE INVALID_SUBCOMMAND KEY_MISMATCH MISSING_LOG NEED_MORE_PARAMS NO_SUCH_DEVICE NO_SUCH_LEAF TEMPORARILY_UNAVAILABLE UNKNOWN_CHECKPOINT DISABLED INTERNAL_ERROR` | generic |
| FAIL MARKREAD | `NEED_REGISTRATION TEMPORARILY_UNAVAILABLE` | dropped |
| FAIL MEDIA | `AUTH_REQUIRED BAD_ABR BAD_CONSENT BAD_E2EE_GROUPKEY BAD_E2EE_HANDSHAKE BAD_E2EE_SENDER BAD_E2EE_TARGET BAD_FINGERPRINT BAD_LAYER BREAKOUT_FAILED CONSENT_REQUIRED DTLS_UNAVAILABLE HAND_FAILED INVALID_KIND INVALID_POSITION INVALID_REACTION INVALID_SUBCOMMAND JOIN_FAILED NOT_IN_CALL NOT_PUBLISHING NO_CODECS NO_COMMON_CODEC NO_OFFER POS_FAILED SECURE_SIGNALING_REQUIRED TRANSPORT_UNAVAILABLE TURN_CUT TX_DENIED UNENROLLED_E2EE_IDENTITY` | specific (media plane fold + engine `voice-core.ts:597`) |
| FAIL MEMO / NOTE MEMO | `ACCOUNT_REQUIRED ACCOUNT_UNKNOWN FORWARD_CYCLE INVALID_ACCOUNT INVALID_SUBCOMMAND MAILBOX_FULL INVALID_MESSAGE TEMPORARILY_UNAVAILABLE` | NOTE specific (ceiling); FAIL dropped |
| FAIL NAMES / WHO | `MEMBERSHIP_SEALED` | dropped |
| FAIL PINS | `INVALID_SUBCOMMAND` | dropped (Elm uses PROP) |
| FAIL PRIVMSG (and NOTICE/TAGMSG where applicable) | `CTCP_BLOCKED E2EE_REQUIRED INVALID_UTF8 INPUT_TOO_LONG ONYX_FILTERED` (content filter or channel word filter, `src/daemon/server.zig:58879`, `:58890`) `TEMPORARILY_UNAVAILABLE` (mesh durable admission) | toast (`humanizeSendFail`); there is no specific "blocked by filter" copy |
| FAIL RECOVER / RELEASE | `ACCESS_DENIED NICK_NOT_REGISTERED TEMPORARILY_UNAVAILABLE` | RECOVER generic; RELEASE dropped |
| FAIL RECOVERYCODES | `ACCOUNT_REQUIRED AUTH_FAILED INSECURE_TRANSPORT INTERNAL_ERROR INVALID_SUBCOMMAND NEED_MORE_PARAMS TEMPORARILY_UNAVAILABLE` | specific |
| FAIL REDACT | `NEED_REGISTRATION UNKNOWN_MSGID` | dropped (unless labeled) |
| FAIL REGISTER | `ACCOUNT_EXISTS ACCOUNT_FORBIDDEN BAD_ACCOUNT_NAME COMPLETE_CONNECTION_REQUIRED INVALID_EMAIL INVALID_PASSWORD NEED_MORE_PARAMS TEMPORARILY_UNAVAILABLE` | specific (`foldRegisterFail`) |
| FAIL RENAME | `CANNOT_RENAME CHANNEL_NAME_IN_USE INVALID_PARAMS` | specific |
| FAIL RESETPASS | `BAD_CODE EXPIRED NO_REQUEST TEMPORARILY_UNAVAILABLE TOO_MANY_ATTEMPTS UNAVAILABLE INVALID_PASSWORD` | dropped (feature missing) |
| FAIL SEARCH | `INVALID_PARAMS INVALID_TARGET NEED_REGISTRATION RATE_LIMITED RESULTS_TOO_LARGE` | specific |
| FAIL SESSION / WARN SESSION | `AMBIGUOUS_SID ATTACHMENT_IN_USE CANNOT_DROP_CURRENT INVALID_INDEX INVALID_TOKEN NEED_MORE_PARAMS NO_ATTACHMENT NO_SESSION NO_SUCH_SESSION RESUME_PENDING STALE_LIST`; WARN `ORIGIN_UNREACHABLE RESUME_CREDENTIAL_PRESERVED TEMPORARILY_UNAVAILABLE` | specific (`foldSessionReply:17429`) |
| FAIL SESSIONTOKEN | `INSECURE_TRANSPORT NOT_LOGGED_IN TOKEN_ISSUE_FAILED TEMPORARILY_UNAVAILABLE` | dropped |
| FAIL SETPASS | `ACCOUNT_REQUIRED INVALID_PASSWORD RESET_NOT_AUTHORIZED TEMPORARILY_UNAVAILABLE WRONG_PASSWORD` | dropped (feature missing) |
| FAIL SUCCESSOR | `ACCOUNT_UNKNOWN INVALID_SUBCOMMAND INVALID_VALUE NOT_FOUNDER TEMPORARILY_UNAVAILABLE NEED_MORE_PARAMS` | dropped |
| FAIL TOTP | `ACCOUNT_REQUIRED ALREADY_ENROLLED INSECURE_TRANSPORT INTERNAL_ERROR INVALID_CODE INVALID_SUBCOMMAND NEED_MORE_PARAMS NO_PENDING TEMPORARILY_UNAVAILABLE` | specific (`foldTotpFail`) |
| FAIL UNREJECT | `INVALID_IP` | dropped |
| FAIL VERIFY | `ACCOUNT_REQUIRED EXPIRED INVALID_CODE TEMPORARILY_UNAVAILABLE TOO_MANY_ATTEMPTS` | specific |
| FAIL VHOST | `ACCOUNT_REQUIRED HOST_NOT_YOURS HOST_TAKEN INVALID_HOST TEMPORARILY_UNAVAILABLE` | dropped |
| FAIL WEBAUTHN | `ATTESTATION_REQUIRED BAD_ACCOUNT BAD_ATTESTATION BAD_AUTHDATA BAD_CLIENT_DATA BAD_CREDENTIAL BAD_CREDENTIAL_ID BAD_LABEL BAD_ORIGIN CHALLENGE_MISMATCH CREDENTIAL_ID_MISMATCH INTERNAL_ERROR INVALID_SUBCOMMAND LABEL_TOO_LONG NEED_MORE_PARAMS NOT_CONFIGURED NOT_LOGGED_IN NO_CREDENTIAL NO_PENDING RP_MISMATCH TEMPORARILY_UNAVAILABLE UNSUPPORTED_KEY USER_PRESENCE_REQUIRED USER_VERIFICATION_REQUIRED WRONG_TYPE` | specific (`foldPasskeyReply:22796`) |
| FAIL WEBPUSH | `ACCOUNT_REQUIRED DISABLED INVALID_ENDPOINT INVALID_KEY INVALID_SUBCOMMAND NEED_MORE_PARAMS NOT_SUBSCRIBED TEMPORARILY_UNAVAILABLE TOO_MANY_SUBSCRIPTIONS` | dropped in Elm (ports.js only checks send success) |

## 16. Other server-originated lines a client must understand

| Line | Server | Elm |
|---|---|---|
| `ERROR :<reason>` (Excess Flood, Ping timeout, Registration timeout, draining, reputation, too many connections, SACCESS, Closing Link (Killed …), Banned) | §0.4 D6 | sink |
| `:<oper> KILL <you> :<reason>` | `src/daemon/oper_cmd.zig:93` | no arm |
| `ERROR :Ghosted by <nick>` | `handleGhost:47197` | sink |
| `CHGHOST` | VHOST | consumed silently |
| `RENAME #old #new :reason` | RENAME | **FULL** |
| `INVITE`, `ACCOUNT`, `AWAY`, `SETNAME`, `TAGMSG`, `REDACT`, `MARKREAD`, `METADATA`, `PROP` | various | **FULL** (arms `src/App.elm:4692-5860`) |
| `:<nick> ACTIVITY #c typing <state>` / react tally | ACTIVITY | **FULL** |
| `:<srv> PINS #c :ids` | PINS | not used (Elm reads PROP) |
| `:<srv> NOTICE <you> :[#c] <ONJOIN text>` | §11 | sink |
| `:<srv> NOTICE #c :<fantasy reply>` | `fantasyReply:39116` | rendered as a channel notice |
| `:<srv> NOTICE <you> :WELCOME :<line>` (onboarding pack) | `handleWelcome:28386` | sink |
| `:<srv> NOTICE <you> :MEMO from <acct> :<text>` | MEMO delivery | **FULL** |
| `:<srv> NOTICE <you> :HOLD stored` | `captureFirstHold:43395` | sink |
| `:<srv> NOTICE <you> :CHALLENGE pow\|question …` | D3 | sink |
| `REGISTER SUCCESS <acct> :…` / `RESETPASS SUCCESS …` | | REGISTER **FULL**; RESETPASS n/a |
| `BATCH +id netsplit\|netjoin <servers>` | `src/daemon/netsplit_batch.zig` | QUITs/JOINs fold one by one; no summary |

## 17. Protection and abuse subsystems (user-visible behaviour)

| Subsystem | Server | Trigger → what the offender sees | What ops/opers see; controls | Elm |
|---|---|---|---|---|
| **Raid shield** (brief) | `src/daemon/raid_shield.zig`; `noteRaidJoin` `src/daemon/server.zig:26995`; `evaluateRaidShield:27004`; `+j`/network guard `:22665-22685`; config `raid_joins`/`raid_window` (`src/daemon/config_format.zig:438-441`) | **Two layers.** (1) Join throttle: channel `+j joins:secs`, or the network default `raid_joins`/`raid_window` (0 = off). Over budget → `480 :Cannot join channel (+j) - join rate exceeded`. Opers and invitees bypass. (2) Mesh correlator: a GCRA burst (5/s, burst 4) with joins from ≥3 distinct Mooring peers inside 2 s engages that channel. It auto-sets `PROP SLOWMODE 10` (setter `raid-shield`), relaxes after 30 s quiet, and is checkpointed across Helix. While any channel is engaged and `[challenge]` is on, **every new connection gets a pre-001 CHALLENGE** (D3). | Oper Event Spine `FLOOD possible raid on #c…` (`raidAlert:55804`) and `FLOOD raid shield engaged slowmode on #c` | 480 → generic inbox; slowmode set without UI; CHALLENGE unsupported (D3); oper FLOOD lines dropped (D5) |
| Flood guard | `src/daemon/flood_guard.zig`; `src/daemon/server.zig:17676-17694` | Weighted token buckets per connection class; throttling still processes lines; sustained excess → `ERROR :Excess Flood` + close | `noteAccountAbuse` score (oper `ABUSE`) | ERROR hidden (D6); Elm's reconnect loop can re-flood (e.g. outbox flush) |
| Slowmode | `SLOWMODE`/`SLOWVOICE` props; `noteSlowmodeSend:26928` | `404 #c :Cannot send to channel (slowmode)` (`:58213`) | op sets prop; raid shield sets it | 404 → inbox error; no countdown/disabled composer; no setting |
| First-message hold | `HOLD` prop; `captureFirstHold:43395`; `src/daemon/first_hold.zig` | The first *n* PRIVMSGs of a member are stored, not delivered; NOTICE `HOLD stored` | oper `HOLD RELEASE\|DROP #c nick` (release re-broadcasts as `nick!nick@held`) | **MISSING**: the sender's row looks sent; no queue UI for opers |
| Content filter (Koshi) | `src/daemon/content_filter.zig`; send path `:58879` | `FAIL PRIVMSG ONYX_FILTERED :Message blocked by the content filter` | oper `FILTER ADD\|DEL\|LIST` | toast (generic); no FILTER UI |
| Channel word filter | `src/daemon/svc_chanbadwords.zig`; `:58890` | `FAIL PRIVMSG ONYX_FILTERED :…channel word filter` (non-ops) | op `CHANBADWORDS` | toast; no CHANBADWORDS UI |
| Spam trap | `src/daemon/spamtrap.zig`; `spamtrapCheck:55815` | Silent; the offender is flagged | Oper `FLOOD spamtrap tripped …`; `SPAMTRAP` | no oper UI; event dropped (D5) |
| Shun (silent mute) | `src/daemon/shun.zig`; check `:26404` | Messages silently dropped | oper `SHUN`/`UNSHUN` | user cannot tell (by design) |
| GAG (IRCX `+z`) | `src/daemon/gag_set.zig`; `applyGag:23137` | IP-bound silence surviving reconnect | oper `MODE nick +z` | no UI |
| Warden (K/D/X-lines unified) | `src/daemon/warden.zig`; `src/daemon/oper_cmd.zig:506-650` | refuse / expel (`ERROR :Closing Link …`) / quarantine (cannot join: 474 "You are quarantined") / require_auth | oper `WARD`, `KLINE`, `DLINE`, `XLINE`, `TESTLINE` | ERROR hidden; quarantine 474 shown as a generic ban |
| Quarantine move | `handleQuarantine:43538` | Parted everywhere, joined to the quarantine channel | oper `QUARANTINE` | rendered as ordinary PART/JOIN; no explanation |
| Clone limits (local + mesh) | `src/daemon/clone_limit.zig`, `src/daemon/mesh_clones.zig`; `:11744` | `ERROR :Too many connections from your host` | oper `CLONES` | ERROR hidden |
| IP reputation | `src/daemon/ip_reputation.zig`; `:11724` | `ERROR :Connection refused (reputation)` **or** CHALLENGE (D3) | `ABUSE`, `UNREJECT` | hidden / hang |
| DNSBL | `src/daemon/dnsbl.zig`, `src/daemon/dnsbl_resolver.zig`; `[dnsbl] action` (`src/daemon/server.zig:2700`) | Warden ban (closes) or mark | `ABUSE` | hidden |
| Connection throttle | `throttle_connects` (`src/daemon/config_format.zig:434-435`) | refused before welcome | `UNREJECT <ip>` | hidden |
| Nick delay | `src/daemon/nick_delay.zig`; `:18208`, `:43047` | `437 <nick> :Nick is held (nick delay); try again shortly` | owner `RELEASE`/`RECOVER` | 437 → "Nick/channel temporarily unavailable" notice (`src/App.elm:10152-10160`); no RELEASE/RECOVER buttons |
| Nick enforcement (ENFORCE/SECURE) | `src/daemon/nick_enforcement.zig`, `src/daemon/svc_enforce.zig` | Unauthenticated holder of a registered nick is force-renamed to `Guest…` after a grace period | `ACCOUNTSET … enforce\|secure on\|off`, `RECOGNIZE` | rename handled (`forcedGuestRename`, auto-reclaim `startNickReclaim:24068`); no settings UI |
| Login throttle | `src/daemon/svc_login_throttle.zig` | IDENTIFY lockout (464/FAIL) | — | generic |
| Account abuse score | `src/daemon/account_abuse.zig`; `noteAccountAbuse:26382` | Survives reconnect | `ABUSE <nick>` | N/A |
| Challenge ladder | `src/daemon/challenge.zig` | §1, D3 | `CHALLENGE METHOD\|QUESTION` | **MISSING** |
| Appeals | `src/daemon/appeal.zig`; `handleAppeal:27892` | Banned user may `APPEAL <text>` once per window, even pre-registration → `APPEAL filed <id>` / `already filed` | `APPEAL LIST`, `APPEAL ANSWER <id> :text` (audited) | **MISSING** both sides |
| Sealed rooms | `src/proto/sealed_room.zig` | `FAIL NAMES\|WHO MEMBERSHIP_SEALED` | `membership-visibility` prop | dropped; roster shows empty |
| Policy generations | `handlePolicy:54998` | — | `POLICY LIST\|ROLLBACK` | **MISSING** |
| Connection classes | `src/daemon/conn_class.zig` | Per-class sendq/recvq/flood/max_targets/monitor/silence/require_tls/sasl | `STATS Y`, `STATS i` | N/A |

## 18. Bots, webhooks, link previews, uploads, push, HTTP surfaces

| Surface | Server | Elm |
|---|---|---|
| Bot accounts / grants: `BOTGRANT` scopes `speak\|webhook\|history` with TTL; gated-bot speak checks (`botHasSpeakGrant:43452`) | `src/daemon/bot_registry.zig`, `handleBotGrant:7397` | **MISSING** (oper UI) |
| Bot identity: umode `+B`, WHOIS 335, `bot` message tag, `BOT=B` | `src/proto/usermode.zig:149`, `src/daemon/whois.zig:29` | **PARTIAL**: profile badge only (`src/View/Profile.elm:81-83`); no badge in the message list; the `bot` cap is not requested |
| Bot command registry `BOTCMD` | `handleBotCmd:43467`, `src/daemon/slash_cmd.zig` | N/A (bot-side) |
| Incoming webhooks: `WEBHOOK CREATE\|LIST\|DELETE`; HTTP `POST /api/webhooks/<id>/<token>` (Discord-compatible JSON; 204/400/401/404/405/411/413/429; loopback, behind a proxy) | `src/daemon/webhook_http.zig:1-20,173`; render `src/daemon/webhook_render.zig` | **FULL** (management `src/View/Stewardship.elm:423-507`; posts render as normal messages) |
| Outbound webhooks `OUTHOOK` (HMAC secret, category mask) | `handleOutboundWebhook:7277`, `src/daemon/webhook.zig` | **MISSING** (oper) |
| Server-side link preview `UNFURL ON\|OFF\|<https url>` → `NOTICE UNFURL title= description= image=` (SSRF-guarded: `unfurl.deniedAddress`) | `handleUnfurl:27752`, `src/daemon/unfurl.zig` | **N/A**: Elm uses the deployment's `/linkpreview` proxy (repo CLAUDE.md) and never uses UNFURL |
| File uploads | **None in the daemon.** "Attachments" in `src/daemon/attachment_*.zig` are *session* attachments, not files. | **FULL** via the external `/upload` service (`src/Upload.elm`, `uploadBridge.smoke.mjs`) |
| Web Push `WEBPUSH SUBSCRIBE\|UNSUBSCRIBE\|LIST` (≤3/account); pushes for `dm` (offline memo), `mention`, `call` invite | `handleWebpush:53189`; `webpushNotifyKind:53542`, `…ChannelMentions:53602`, `…CallInvite:53617` | **FULL** (`ports.js:8509,8582`, `src/Push.elm`, toggle `src/View/Account.elm:464`); LIST unused; FAIL WEBPUSH dropped |
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
- **Constraints:** the oper media controls `MODE nick +M`/`+P` and the
  `TX_DENIED` messaging have no UI. Video/screen are disabled on the live
  network by product decision.

## 20. Info, stats, mesh and "fun" modules

| Feature | Server | Elm |
|---|---|---|
| Fantasy `!weather`/`!w`/`!wx [place]`, `!setweather`/`!sw <place\|clear>` (op), `!news`/`!n [source]`, `!localnews [CC]` (`!news*` need `+W`) → `:srv NOTICE #c :…` | `handleFantasy:39156`, `handleFantasyWeather:39236`, `handleFantasySetWeather:39208`, `handleFantasyNews:39269`, `fantasyReply:39116`; `src/daemon/geo_services.zig`, `src/proto/news_sources.zig`, `src/proto/weather_units.zig`; `[geo] enabled` | **PARTIAL**: works when typed, and replies render as channel notices from the server name. No discoverability (slash/help/autocomplete), no `+W` toggle, no location setting. |
| MOTD templating (`{weather}`, `{news}`, greetings, live figures) | `src/proto/motd_template.zig`, `handleMotd:42649` | **CORE-ONLY** (not rendered) |
| Welcome onboarding pack (once per new account) | `src/daemon/welcome_pack.zig`, `handleWelcome:28386` | sink (§0.1) |
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
add or touch.

### P0 — broken or blocking today

1. **[User][P0] 2FA accounts cannot sign in (D2).**
   - Sketch: in `src/App.elm` `beginSasl`/904 arm, keep the server 904 text.
   - When it says "Two-factor", or when the account is known 2FA (or `onyx/2fa` is advertised), switch the connect gate to "connect as guest → `IDENTIFY <acct> <pw> <code>`".
   - Add a code field to `src/View/Connect.elm`; reuse `requestIdentify:28387` + `foldIdentifyReply` (it already handles `TOTP_REQUIRED`).
2. **[User][P0] Change password is broken (D1).**
   - Sketch: replace `requestAccountSetPassword:27142` with `SETPASS <current> <new>` (new `Services.setPass`).
   - Fold `NOTICE` success and `FAIL SETPASS *` into `accountActionError`.
3. **[User][P0] Pre-001 CHALLENGE is unanswered, so users cannot connect during a raid or reputation hold (D3).**
   - Sketch: detect pre-001 server NOTICE `CHALLENGE pow <hex>` in `foldChat`'s server-notice branch (`src/App.elm:34689`).
   - Add a `ports.js` worker that brute-forces `Blake3(seed‖answer)[0]==0` (~256 tries) and sends `CHALLENGE <answer>`.
   - For `CHALLENGE question <q>`, show a prompt in `src/View/Connect.elm`.
   - Handle `CHALLENGE failed\|wait`.
4. **[All][P0] Server replies are invisible (§0.1/§0.2).**
   - Sketch: add a "Server" console (new `src/View/ServerLog.elm`, opened from the You hub / status) that renders `model.serviceLog` with timestamps.
   - Make `foldStandardReply`'s default arm (`src/App.elm:20990`) add an inbox error row for every unknown `FAIL`/`WARN`.
   - Route `logNumeric` error-class numerics (4xx/5xx/9xx) to the inbox.
   - This one change turns ~90 RAW commands into usable power-user features.
5. **[User][P0] Disconnect reasons are hidden (D6).**
   - Sketch: keep the `ERROR` trailing text and fold `KILL` in `foldLine`.
   - Show the reason in the reconnect banner (`reconnectBanner`, `src/App.elm`).
   - Suppress auto-reconnect for bans and kills (Banned, Killed, Closing Link, Access denied).
6. **[User][P0] Forgot-password flow is missing.**
   - Sketch: add a "Forgot password" link in `src/View/Connect.elm` → guest connect → `RESETPASS <acct>` → code + new password form → `RESETPASS <acct> <code> <new>`.
   - Fold `RESETPASS SUCCESS` and the `FAIL RESETPASS *` codes.
7. **[User][P0] Custom status is broken (D4).**
   - Sketch: send `PROP <ownnick> STATUS <text>` instead of `PROP *` (`src/App.elm:20128`), or move status to `METADATA * SET ocean.status`.
   - Fold 913 into an error.
8. **[Op][P0] "Delete room" silently fails server-side (D7).**
   - Sketch: send `CHANNEL DROP` only when the room is registered (`CHANNEL INFO` first).
   - Otherwise do "close" (`+si`, kick, part), and surface `FAIL CHANNEL` (`requestStewardDeleteRoom:21536`).
9. **[User][P0] `+S`/`+O`/`+A`/forward joins fail or redirect silently (D9).**
   - Sketch: add 489/520/470 arms in `foldErrorNumeric:17116` with join-prompt copy ("TLS required", "operators only", "you were forwarded to #x").

### P1 — high-value user features

10. **[User][P1] Server-side scheduled messages.**
    - Sketch: when Live and registered, also submit `DEFER AT <unix-ms> #c :text` (cron via `DEFER CRON`) from `src/Schedule.elm`/`requestScheduleMessage`, so messages send with the tab closed.
    - The server has no cancel, so keep local scheduling for cancellable items and label server-held ones "can't be cancelled".
11. **[User][P1] KNOCK ("Ask to join") for `+i`/`+k`/`+l` rooms.**
    - Sketch: add a button on the 471/473/475 join prompt (`setChannelJoinPrompt`) → `KNOCK #c :reason`.
    - Fold 711 as a toast and 713/714 as errors.
    - For ops, fold 710 into an inbox "X asks to join #c" row with an Invite action (`src/App.elm:4673-4690`).
12. **[User][P1] Privacy user modes.**
    - Sketch: add a Preferences "Privacy" section (`src/View/Prefs.elm`) with toggles:
      - `+R` (only signed-in people can DM me)
      - `+g` (approve DMs, plus an ACCEPT list UI)
      - `+D` deaf
      - `+i` invisible
      - `+p` hide my rooms
      - `+Q` no forwarding
      - `+P` hide call presence
      - `+C` no CTCP
    - Each sends `MODE <me> ±X`; fold 221 to seed the state (`src/App.elm:4988`), using `Modes.userModeAccess`.
13. **[User][P1] Blocked-DM feedback (caller-id).**
    - Sketch: fold 716/717/718 so a DM to a `+g` user shows "waiting for X to accept you" and the target gets "X wants to message you — Accept" (`ACCEPT +nick`).
14. **[User][P1] Server-side ignore that follows the account across devices.**
    - Sketch: make `/ignore` optionally also send `SILENCE +nick!*@*`.
    - Fold 271/272 into the blocklist UI (`src/PersonSafety.elm`, `src/View/DmSafety.elm`); respect `SILENCE=32`.
15. **[User][P1] Offline-message mailbox (MEMO).**
    - Sketch: add an Inbox "Offline messages" panel using `Services.memo` (`src/Services.elm:950-1012`, unused today): `MEMO LIST`/`CLEAR`, explicit `SEND`, `FORWARD <acct>|OFF`, `IGNORE ADD|DEL|LIST`.
    - Fold the `MEMO:` NOTICEs and `FAIL MEMO` codes.
16. **[User][P1] Show the MOTD and the onboarding WELCOME pack.**
    - Sketch: render `model.motd` (already collected at `src/App.elm:4568`) on Home with a dismiss.
    - Fold `NOTICE WELCOME :…` lines into the same card.
17. **[User][P1] Room welcome message.**
    - Sketch: fold `NOTICE <me> :[#c] text` (ONJOIN/ONPART) as a pinned system row in that room.
    - Add an op setting "Welcome message" → `PROP #c ONJOIN :text` (`src/RoomSettings.elm` `WriteProp`).
18. **[User][P1] Slowmode experience.**
    - Sketch: op setting "Slow mode" → `PROP #c SLOWMODE <secs>` (+ `SLOWVOICE`).
    - In the composer, read `SLOWMODE` from props and show a countdown/disabled state after each send.
    - Special-case 404 "(slowmode)" copy (`foldErrorNumeric` 404 arm).
19. **[User][P1] Account-wide autojoin.**
    - Sketch: when signed in, mirror `/autojoin` and `/unautojoin` to `AUTOJOIN ADD|DEL #c` and show `AUTOJOIN LIST` in Account; keep the device list for guests.
20. **[User][P1] Nick protection controls.**
    - Sketch: Account → "Nick protection" toggles `ACCOUNTSET <acct> <pw> enforce on|off` and `secure on|off`.
    - Add "Take my nick back" buttons for `RECOVER <nick>` and `RELEASE <nick>` (builders exist: `src/Services.elm:922-927`).
    - Add `RECOGNIZE ADD|DEL|LIST` mask list and `GROUP ADD|DEL|LIST|PRIMARY` grouped nicks.
21. **[User][P1] Profile depth.**
    - Sketch: add `SETNAME` (realname) editing in `src/View/Profile.elm` (the `Services.setName` builder exists), plus `WHOWAS` (offline profile) and `SEEN <acct>` ("last seen") for offline people.
22. **[User][P1] Passkey sign-in.**
    - Sketch: un-hide the passkey path in `src/View/Connect.elm` using `src/Passkey.elm` `AUTH`/`AUTH-FINISH` (builders exist); add `WEBAUTHN STATUS` to Account.
23. **[User][P1] Hand raise and speaking queue in calls.**
    - Sketch: send real `MEDIA HAND #c up|down` instead of a ✋ reaction (`src/App.elm:41489`).
    - Add a `MEDIA QUEUE` view and reuse the `HAND` fold (`src/Media.elm:335`).
24. **[User][P1] Call recording with consent.**
    - Sketch: add `MEDIA CONSENT #c on|off` and `MEDIA RECORD #c [stop]`; fold `CONSENT`/`RECORD` events.
    - Show a "recording" banner (`src/View/CallStage.elm`); map `FAIL MEDIA CONSENT_REQUIRED`.
25. **[User][P1] Live captions send and transcript.**
    - Sketch: send `MEDIA CAPTION #c :text` from local speech recognition, and a `MEDIA TRANSCRIPT #c` "Load transcript" button (folds exist in `src/Media.elm:159`).
26. **[User][P1] Fantasy discoverability.**
    - Sketch: list `!weather [place]`, `!news [src]`, `!localnews [CC]` in the slash/command palette (`slashCommands:12976`).
    - Add a "my weather location" setting → `METADATA * SET location <place>`.
    - Show news only when the room has `+W` (op toggle).

### P2 — channel operator power

27. **[Op][P1] Register a room and channel services.**
    - Sketch: add a "Registration" section in `src/View/RoomSettings.elm` using `Services.channelService` (`src/Services.elm:930`, unused):
      - `CHANNEL REGISTER`/`INFO`/`DROP`/`TRANSFER`
      - `SET MLOCK|KEEPTOPIC|TOPICLOCK|GUARD|PRIVATE|DESC|URL`
      - account `ACCESS ADD|DEL|LIST <acct> FOUNDER|OP|VOICE`
      - `SUCCESSOR SHOW|SET|CLEAR`
      - `LISTCHANS` in Account
    - Fold the `CHANNEL`/`ACCESS`/`AKICK` NOTICE shapes (§6.1) and `FAIL CHANNEL`.
28. **[Op][P1] Persistent auto-kick list.**
    - Sketch: Bans view tab "Auto-kick (registered rooms)" → `CHANNEL AKICK #c ADD|DEL|LIST`; fold the `AKICK …` NOTICEs.
29. **[Op][P1] Exceptions, invite exceptions and quiet lists.**
    - Sketch: add tabs in `src/View/Bans.elm` for `+e`/`+I`/`+Z`; fold 348/349, 346/347, 728/729 like 367/368 (`foldBanListRow:19108`).
    - Add a "Mute" (`+Z`) member action next to Ban in the desk/profile.
30. **[Op][P1] Server-side timed modes.**
    - Sketch: replace the client temp-ban timer (`requestTempBan:20427`) with `TEMPMODE ADD #c b <mask> <ms>` (and timed `+m`/`+i`/`+N`); `TEMPMODE CANCEL` for undo.
31. **[Op][P1] Full channel mode toggles.**
    - Sketch: extend `RoomSettings.flagToggles` (`src/RoomSettings.elm:171-175`) with C T N g S M W u a d x w V U F D p h, each with plain-language copy.
    - Add `+f` forward and `+j joins:secs` param inputs, and owner `+q` grant/revoke.
    - Respect `MODES=` when batching.
32. **[Op][P1] Room tier keys.**
    - Sketch: owner setting for `FOUNDERKEY`/`OWNERKEY`/`HOSTKEY`/`VOICEKEY` (`PROP #c KEY value`), and a JOIN key field that can carry a tier key.
33. **[Op][P1] History retention.**
    - Sketch: add a `RETAIN` (delete after N) setting next to `EPHEMERAL` in the retention section (`src/View/RoomSettings.elm:380`).
34. **[Op][P1] Word filter.**
    - Sketch: room setting "Blocked words" → `CHANBADWORDS #c ADD|DEL|LIST`.
    - Map `FAIL PRIVMSG ONYX_FILTERED` to "Your message contains a blocked word" (`humanizeSendFail`).
35. **[Op][P1] Mass clear.**
    - Sketch: an owner action "Clear room" → `CLEAR #c USERS KEEP <rank> [ALLOW …] :reason` with confirmation.
36. **[Op][P2] Rename room.**
    - Sketch: room setting → `RENAME #old #new :reason` (FAIL arm exists, `src/App.elm:20918`).
37. **[Op][P2] Clone room (IRCX CREATE).**
    - Sketch: "Create from this room" → `CREATE #new [modes] #source`.
38. **[Op][P2] Whisper.**
    - Sketch: a member action "Whisper" in a room (`Ircx.whisper` builder exists, `src/Ircx.elm:1179`); receive is already rendered.
39. **[Op][P2] Sealed rooms and AI policy setters.**
    - Sketch: room settings for `membership-visibility` and `no-ai`/`local-only`/`server-ai-ok` (read path exists in `src/AiPolicy.elm`).
    - Fold `FAIL NAMES|WHO MEMBERSHIP_SEALED` into a roster note.
40. **[Op][P2] First-message hold.**
    - Sketch: room setting `HOLD n` with copy; tell the sender "your first messages are awaiting review" on NOTICE `HOLD stored`.
41. **[Op][P2] Named modes and topics registry.**
    - Sketch: `MODEX` set support in `/modex`; an editor for the `onyx_server.topics` registry.

### P3 — network operator tooling

All of these are RAW today. The sketch is one oper console with typed forms
plus folds for their NOTICE and numeric output. It can reuse the `src/View/ModDesk.elm`
`operSheet` and `planOperAction` validation (`src/App.elm:14179`).

42. **[Oper][P1] Live Event Spine feed (D5).**
    - Sketch: in `src/Spine.elm` `foldEventLine`, map tagged `EVENT <me> <CAT> …` lines (category/severity from tags), OBSERVE pushes and ANNOUNCE broadcasts into `OperDesk` rows.
    - Add `EVENT SEVERITY` and `EVENT STATS JSON`.
43. **[Oper][P1] Network bans.**
    - `WARD ADD|DEL|LIST|TEST` with match/scope/action/duration pickers.
    - `KLINE`/`DLINE`/`XLINE` shortcuts, `TESTLINE`/`TESTMASK` (725-727).
44. **[Oper][P1] Silencing.**
    - `SHUN`/`UNSHUN`, user `+z` GAG, `+M` media deny, and `QUARANTINE <nick> #c :reason`.
45. **[Oper][P1] Abuse insight.**
    - `ABUSE <nick>`, `CLONES`, `SESSIONS` filters, `USERIP`, `GEOIP`, `TRACE`/`ETRACE`.
46. **[Oper][P1] Appeals.**
    - Users: an `APPEAL <text>` form on the ban/kill screen, even pre-registration.
    - Opers: `APPEAL LIST` inbox and `APPEAL ANSWER <id> :text`.
47. **[Oper][P1] Content controls.**
    - `FILTER ADD|DEL|LIST`, `SPAMTRAP`, `HOLD RELEASE|DROP`, `POLICY LIST|ROLLBACK`, `CHALLENGE METHOD|QUESTION`.
48. **[Oper][P2] Accounts admin.**
    - `ACCOUNT SUSPEND|UNSUSPEND|FORBID|UNFORBID|NOEXPIRE|INFO`, `VHOST APPROVE|DENY|OFFER|SET`, `SACCESS`, `RESV`, `JUPE`.
49. **[Oper][P2] Staff.**
    - `GRANT`/`REVOKE`/`GRANTS`, `PRIVS` (fold 270), `AUDIT [JSON]` + `AUDIT PROOF` viewer (EVENT AUDIT rows).
50. **[Oper][P2] Force actions.**
    - `FORCEOP`/`FORCEDEOP`/`FORCEJOIN`/`FORCEPART`/`FORCETOPIC`, `SUMMON`, `GLOBAL` (user-wide notice; distinct from `EVENT BROADCAST`).
51. **[Oper][P2] Mesh and server.**
    - `MESH [LOG|GRANTS|ADMISSION]`, `ROUTE`, `NETHEALTH`, `LINKS`/`MAP`, `STATS <letter>`, `CONNECT`/`SQUIT`, `DRAIN`, `CLOSE`, `UNREJECT`, `REHASH` (fold 382), `UPGRADE`, `DIE`/`RESTART` (guarded), `OPERMOTD`, `DEBUG`, `MODULES`/`COMMANDS`/`OROWASM`.
52. **[Oper][P2] Integrations.**
    - `BOTGRANT`, `OUTHOOK`, `E2EEGROUP STATUS|ON|OFF`.

### P4 — protocol completeness and polish

53. **[User][P2] Mesh session redirect (D8).**
    - Sketch: parse `SESSION REDIRECT: … lives on <node>` and reconnect to that node with the stored MTOKEN (`src/Nodes.elm` pin + `maybeSendSessionCommands`).
54. **[User][P2] Netsplit/netjoin summary.**
    - Sketch: interpret `BATCH netsplit|netjoin` in the batch fold (`src/App.elm:32913`) and collapse the QUIT/JOIN storm into one system row.
55. **[User][P2] Message-level bot badge.**
    - Sketch: render the `bot` tag on rows; request the `bot` cap (`src/Session.elm:657-668`).
56. **[User][P3] Remaining SASL mechanisms.**
    - SCRAM-SHA-512, SESSION-TOKEN (`SESSIONTOKEN` for "remember this device") and OAUTHBEARER in `Wire.selectSaslMechanism` + ports.js crypto.
57. **[User][P3] ISUPPORT hygiene.**
    - Parse `AWAYLEN KICKLEN CHANNELLEN KEYLEN MAXLIST MAXTARGETS MONITOR CHATHISTORY ELIST BOT EXTBAN NETWORKICON` (`src/Isupport.elm`) and use them for composer/input limits.
    - Drop the unadvertised `$o` extban.
58. **[User][P3] Server-side LIST filters.**
    - Sketch: in Browse (`src/View/Browser.elm`), send `LIST >N`, `C<`, `T<` masks; use `LISTX` (`src/Ircx.elm:1313`) for subject/language/PICS.
59. **[User][P3] Server info.**
    - `VERSION`, `ADMIN`, `INFO`, `TIME`, `LUSERS` detail, `DIRECTORY` and `HELP <topic>` (704-706) on the Status/About pages.
60. **[User][P3] `draft/pre-away`.**
    - Send `AWAY` pre-001 when restoring an away/DND status.
61. **[User][P3] `draft/channel-context`.**
    - Tag DMs opened from a room with `+draft/channel-context=#c` and show the context.
62. **[User][P3] WebTransport.**
    - Optional `/wt` transport in ports.js for lossy networks.
63. **[User][P3] DATA/REQUEST/REPLY.**
    - Fold and send IRCX typed messages, for example as an app/bot channel (`src/Ircx.elm:1139-1159`).
64. **[Docs][P3] Fix `ONYX_SERVER_PROTOCOL.md`.**
    - Correct every row in §21. Regenerate `elm/COVERAGE.md` "unadvertised ext flags" and "CHANNEL SET MLOCK only" claims.
