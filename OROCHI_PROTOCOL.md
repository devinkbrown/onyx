# Orochi Protocol — Client Integration Reference (for Ocean)

Everything a client needs to talk to **Orochi**, the pure-Zig clean-room
sovereign-mesh IRC daemon (modern-only successor to C "Ophion"). This is the
authoritative surface for refactoring Ocean's IRC layer (`lib/irc/`).

Orochi is **modern-only**: there is **no STARTTLS**, **no WEBIRC**, **no identd /
RFC1413**, **no DCC proxy/filehost**, **no `OPER` command** (operator status is
granted at SASL login), and **no pseudo-clients** — services are real server
commands (`REGISTER`, `CHANNEL`, `TEGAMI`, …), never ChanServ/NickServ fake users.

> Source of truth lives in the open Orochi repo under `docs/reference/` and
> `docs/architecture/`. This file consolidates it for Ocean. When something here
> conflicts with a live server, trust the server and the Orochi docs.

---

## 1. Transport & Endpoints

Live network is **IRCXNet**, two nodes: `eshmaki.me` and `ircx.us`. Listeners are
**dual-stack IPv6** (`[listen] host = "::"`).

| Port | Transport | Use |
|---|---|---|
| `6667` | Plaintext TCP | Plain IRC (dev/local only) |
| `6697` | Implicit TLS | TLS IRC (TLS 1.3 + hardened 1.2 profile) |
| `8080` | **Secure WebSocket (wss)** | **Browser clients — Ocean uses this** |
| `6900` | Mesh S2S (Tsumugi PQ) | Server↔server only — **not for clients** |

TLS is **1.3 plus a hardened 1.2 profile** (AEAD/ECDHE-only; no RSA key exchange,
CBC, compression, or renegotiation). There is no plaintext→TLS upgrade; pick a TLS
port up front.

### 1.1 WebSocket framing (CRITICAL — this bit Ocean before)

Orochi's wss listener sends **one IRC message per WebSocket frame, with NO trailing
CRLF** (per the IRCv3 WebSocket sub-protocol). A frame is exactly
`:eshmaki.me CAP * LS :...` — no `\n`.

- **Do NOT** do `buffer += data; lines = buffer.split('\n'); buffer = lines.pop()`.
  A CRLF-less frame gets stashed in the buffer forever → CAP LS never parses →
  registration hangs → "WebSocket error / won't connect."
- **Do** split each frame on optional CR/LF (`/\r?\n/`) and process every non-empty
  segment, **without carrying a remainder across frames**. The browser reassembles
  continuation frames, so each `onmessage` is one complete logical message (it may
  batch several CRLF-separated lines).
- Sub-protocol: send `text` frames; UTF-8 only (`UTF8ONLY` is advertised).

---

## 2. Registration Flow

```
(optional) PASS <token>          # recorded, not validated
CAP LS 302                       # negotiate caps (see §4)
CAP REQ :cap1 cap2 ...
AUTHENTICATE ...                 # SASL, see §5 (during CAP, before CAP END)
NICK <nick>
USER <username> 0 * :<realname>
CAP END                          # release the registration hold
```

On success the server emits the welcome burst:

| Numeric | Name | Notes |
|---|---|---|
| `001` | RPL_WELCOME | `Welcome to the IRCXNet network, <nick> — you are <nick!user@host>` |
| `002` | RPL_YOURHOST | `Your host is <server> (node N), running orochi-<hash>` |
| `003` | RPL_CREATED | uptime/创建 line |
| `004` | RPL_MYINFO | `<server> orochi-<hash> <usermodes> <chanmodes> <chanmodes-with-param>` |
| `005` | RPL_ISUPPORT | one or more lines, trailing `are supported by this server` |

Then MOTD (`375`/`372`/`376` or `422`), and any autojoins. A client is **registered**
once `NICK`+`USER`(+`CAP END`) complete. Caps may be negotiated before or after
registration; SASL must be during registration.

Errors during registration: `432` erroneous nick, `433` nick in use, `437` nick held
(nick-delay), `462` already registered, `461` need more params, `410` invalid CAP cmd.

**PING/PONG:** server may `PING`; reply `PONG <token>`. Server-sourced PINGs are
`:<server> PING <server> :<token>` and server PONG to a client PING is
`:<server> PONG <server> :<token>` (RFC-compliant; some clients reject a bare form).

---

## 3. ISUPPORT (005) Tokens

| Token | Default | Meaning |
|---|---|---|
| `NETWORK` | `Orochi` (live: `IRCXNet`) | Network name |
| `CHANTYPES` | `#&` | Channel prefixes |
| `PREFIX` | `(YQqov)*!.@+` | Status modes → prefix chars (see §8) |
| `CHANMODES` | `beIZ,k,lfj,imnstCTNMSgWOAVUFD` | 4 classes: list, param-always, param-on-set, flag |
| `STATUSMSG` | `!.@+` | Status-target prefixes for channel messages |
| `EXTBAN` | `$,acgmrz` | Extban namespace + types (see §8.4) |
| `NICKLEN` | `64` | Max nick bytes |
| `CHANNELLEN` | `64` | Max channel name bytes |
| `TOPICLEN` | `390` | Max topic bytes (UTF-8 boundary truncation) |
| `AWAYLEN` | `256` | Max AWAY bytes |
| `KICKLEN` | `307` | Max KICK comment bytes |
| `MAXLIST` | `beIZ:100` | Per-channel list-mode cap |
| `CHANLIMIT` | `#&:50` | Max joined channels per prefix class |
| `MAXTARGETS` | `4` | Max PRIVMSG/NOTICE targets per command |
| `MODES` | `4` (live nodes set `1`) | Mode changes a client should **combine per MODE line** |
| `MONITOR` | `128` | Max MONITOR targets |
| `SILENCE` | `32` | Max SILENCE masks |
| `CASEMAPPING` | `ascii` | Case folding for nicks/channels |
| `BOT` | `B` | Bot user-mode letter |
| `WHOX` | present | WHOX extended WHO supported |
| `UTF8ONLY` | present | Message bodies must be valid UTF-8 |

`MODES` is tunable via server `[limits] modes_per_line`; the live nodes run `1`
(one mode/target per `MODE` line). Honor it when emitting MODE.

Per-class policy (`CHANLIMIT`/`MAXTARGETS`/`MONITOR`/`SILENCE`) may be tightened for
your connection after registration; the advertised value is the global default.

---

## 4. IRCv3 Capabilities (CAP LS 302)

Caps with a `=value` are shown; the rest carry no value.

```
server-time            message-tags          echo-message
sasl=PLAIN,EXTERNAL,SCRAM-SHA-256            multi-prefix
userhost-in-names      away-notify           setname
extended-join          invite-notify         account-tag
chghost                no-implicit-names      account-notify
batch                  bot                    cap-notify
labeled-response       standard-replies       extended-monitor
draft/chathistory      draft/message-redaction   draft/message-editing
draft/read-marker      draft/typing          draft/react   draft/reply
draft/event-playback   draft/channel-rename  draft/channel-context
draft/metadata-2       draft/pre-away
draft/account-registration=custom-account-name
draft/multiline=max-bytes=4096,max-lines=24
sts=<runtime policy>   (only if STS configured)
orochi/session-sync    orochi/bouncer        (vendor — see §6)
```

Notes for Ocean:
- **`draft/event-playback`** — when negotiated, CHATHISTORY/bouncer replay includes
  channel events (JOIN/PART/MODE/TOPIC/KICK/NICK/QUIT) as `:sender CMD <body>`;
  without it you get messages only.
- **`no-implicit-names`** — suppresses the automatic NAMES burst on JOIN.
- **`draft/typing` / `draft/react` / `draft/reply`** — client-only tags relayed
  through TAGMSG (Discord-style typing indicators, reactions, replies).
- **`echo-message`** — your own sent messages are echoed back (use for optimistic
  UI confirmation / msgid capture).
- **`labeled-response`** — echo `@label=` on a command to correlate replies.
- The live CAP registry namespace is `orochi/*`. There is **no `ocean/*` cap**.

CAP subcommands: `LS [302]`, `REQ`, `ACK`/`NAK`, `LIST`, `END`, plus `NEW`/`DEL`
(cap-notify; not fired for the static set).

---

## 5. SASL Authentication

Negotiate `sasl`, then run `AUTHENTICATE` during registration (before `CAP END`).

Mechanisms (advertised `PLAIN,EXTERNAL,SCRAM-SHA-256`; live boot also enables
`SCRAM-SHA-512` and `SESSION-TOKEN`):

| Mechanism | Use |
|---|---|
| `PLAIN` | `base64(authzid \0 authcid \0 password)` |
| `SCRAM-SHA-256` / `SCRAM-SHA-512` | Challenge-response, no plaintext password on wire |
| `EXTERNAL` | TLS client-cert fingerprint (bind it first with `CERTADD`, see §7) |
| `SESSION-TOKEN` | **Reconnect reclaim** — present a prior session token (see §6) |

Flow: `AUTHENTICATE <MECH>` → server `AUTHENTICATE +` (or challenge) → client
`AUTHENTICATE <base64 payload>` → `900 RPL_LOGGEDIN` then `903 RPL_SASLSUCCESS`.
`AUTHENTICATE *` aborts. Failures: `904 ERR_SASLFAIL`, `906 ERR_SASLABORTED`.

`SASLINFO` reports configured mechanisms and login state. Account names are stored
lowercased. **Operator status is derived from the SASL account** (config binds
account→oper class) — there is no `OPER` command (`491` says so).

---

## 6. Sessions, Reconnect Reclaim & Bouncer (Ocean-critical)

Ocean should reconnect instantly into its live session instead of a JOIN storm.

- **`SESSION`** command: `SESSION LIST` (live sessions for your account),
  `SESSION TOKEN` (reveals this session's local reclaim token, plus an optional
  mesh `MTOKEN` for cross-node reclaim), `SESSION RESUME <token>` (resume a detached
  session). Replies are `NOTE SESSION LIST|TOKEN|MTOKEN`. Failures
  `FAIL SESSION INVALID_TOKEN|NO_SESSION`.
- **`SESSION-TOKEN` SASL mech**: reconnect by presenting the token from
  `SESSION TOKEN` — re-attaches to the same account session.
- **`orochi/session-sync` cap**: multi-client "keep both" — when set, on login the
  server syncs the new connection into the same channels as your other same-account
  sessions. **Gate your `001` autojoin storm behind `!sessionSyncActive`** — the
  server drives the JOINs when the cap is present (this is already the pattern in
  Ocean's `lib/store`).
- **`orochi/bouncer` cap**: automatic history rewind on join/rejoin. Combine with
  CHATHISTORY; **dedup by `msgid`** on reconnect (auto-reconnect preserves channel
  state, so replayed history would otherwise duplicate).
- **Hot upgrade**: the server can be upgraded in place (USR2/Helix) preserving every
  client socket — but if a connection does drop, reconnect + `SESSION-TOKEN` to
  reclaim seamlessly.

---

## 7. Accounts & Services (real commands, no pseudo-clients)

| Command | Purpose |
|---|---|
| `REGISTER <account> <email\|*> <password>` | Create account, log in now; optional `VERIFY <token>` follows. Replies `REGISTER SUCCESS`. `FAIL REGISTER ACCOUNT_EXISTS\|BAD_ACCOUNT_NAME\|INVALID_PASSWORD\|…` |
| `VERIFY <token>` | Confirm email verification token |
| `IDENTIFY <account> <password>` | Log into existing account |
| `LOGOUT` | Drop login (revokes account-derived `+o`) |
| `DROP <account> <password>` | Delete account |
| `ACCOUNTINFO [account]` | `account=<name> flags=<n>` |
| `ACCOUNTSET <account> <password> <email\|flags\|secure\|enforce> <value>` | `secure on` = only recognized via identify; `enforce on/off` = nick-protection on the registered nick |
| `SASLINFO` | Configured mechs + login state |
| `GHOST <nick> <password>` | Disconnect a stale session on your account's nick (`ERROR :Ghosted by <nick>`) |
| `RECOVER <nick>` | Force an unauthenticated holder off your registered nick (force-renamed to `Guest…`), then briefly hold it |
| `RELEASE <nick>` | Drop the server-held reservation on your registered nick early |
| `CHANNEL <REGISTER\|DROP\|INFO\|ACCESS\|AKICK\|SET MLOCK\|TRANSFER> <#chan> …` | Channel services (alias `CS`) |
| `AUTOJOIN <LIST\|ADD\|DEL\|CLEAR> [#chan]` | Account autojoin list (applied after login) |
| `GROUP …` | Account grouping |
| `SEEN <account>` | Last seen/login + recent login history |
| `TEGAMI [LIST\|CLEAR\|SEND <account> :msg]` (alias `MEMO`) | Offline account messages (手紙); delivered + cleared on login |
| `VHOST [USE\|OFF\|CLAIM\|REQUEST\|LIST\|…]` | Visible host personas; applying broadcasts native `CHGHOST` to capable peers |
| `CERTADD` / `CERTLIST` / `CERTDEL <fp>` | Bind/list/remove TLS client-cert fingerprints for SASL EXTERNAL |

Service failures use IRCv3 `FAIL <CMD> <CODE>` (e.g. `ACCOUNT_REQUIRED`,
`TEMPORARILY_UNAVAILABLE`, `NEED_MORE_PARAMS`). Many service replies are server
`NOTICE`s or `NOTE <CMD>` lines.

---

## 8. Channels & Modes

### 8.1 Channel commands
`JOIN <#chan[,#chan]> [key[,key]]` · `PART <#chan[,#chan]> [:reason]` ·
`NAMES <#chan>` · `MODE` (see below) · `KICK <#chan> <nick> [:reason]` ·
`INVITE <nick> <#chan>` · `TOPIC <#chan> [:topic]` · `KNOCK <#chan> [:reason]` ·
`CREATE <#chan> [modes]` (IRCX create-or-join; oper takeover) ·
`RENAME <old> <new> [:reason]` (cap `draft/channel-rename`) ·
`CLEAR <#chan> USERS [KEEP <rank>] [ALLOW <acct,…>] [:reason]` (mass-kick) ·
`TEMPMODE ADD\|CANCEL\|SWEEP …` (timed channel modes) ·
`CHANNEL AKICK <#chan> ADD\|DEL\|LIST …` (persistent auto-kick).

JOIN replies: `JOIN` broadcast, `332`/`331` topic, `353`/`366` names, possibly
`470` forward. JOIN errors: `403 405 471 473 474 475 477 480 489 437` (see §11).

### 8.2 Member status modes / prefixes (`PREFIX=(YQqov)*!.@+`)
| Mode | Prefix | Rank | Meaning |
|---|---|---:|---|
| `Y` | `*` | 5 | Network operator (oper override tier; above founder) |
| `Q` | `!` | 4 | Founder (creation-only; first joiner; not grantable by MODE) |
| `q` | `.` | 3 | Owner (IRCX owner tier; admin aliases owner) |
| `o` | `@` | 2 | Channel operator |
| `v` | `+` | 1 | Voice |

Rank gating: you may only set/clear a tier ≤ your own rank, and cannot change a
higher-ranked member's modes unless you're a server oper. `multi-prefix` cap shows
all prefixes a member holds.

### 8.3 Channel modes (`CHANMODES=beIZ,k,lfj,imnstCTNMSgWOAVUFD`)
- **List (A):** `b` ban, `e` ban-exception, `I` invite-exception, `Z` quiet.
  Query → `367/368` (b), `348/349` (e), `346/347` (I), `728/729` (Z).
- **Param-always (B):** `k` key.
- **Param-on-set (C):** `l` limit, `f` forward (target channel), `j` join-throttle.
- **Flag (D):** `i` invite-only, `m` moderated, `n` no-external, `s` secret,
  `t` topic-ops-only, `C` no-CTCP, `T` no-TAGMSG?, `N` …, `M` reg-moderated,
  `S` TLS-only, `g` …, `W` NOWHISPER, `O` oper-only, `A` admin-only,
  `V` NOCOMICDATA, `U` OPMODERATE, `F` FREETARGET, `D` DISFORWARD.
- `MODE #chan` query → `324 RPL_CHANNELMODEIS` (hides `+k`/`+l` values from
  non-members). Set → `MODE` broadcast.
- **`MODEX <#chan> [+NAMEDMODE …]`** — IRCX named-mode front end (`+AUTHONLY` etc.);
  lists named modes via `806/807`, else delegates to `MODE`.

### 8.4 Extbans (`$,acgmrz`)
`$a:<account>`, `$c:<#chan>`, `$g:<country>`, `$m:<mute-mask>`, `$r:<realname>`,
`$z:<tls-fingerprint>` (and `$o:<class>`), with `$~<type>:…` negation. Used in
`+b/+e/+I/+Z` masks.

### 8.5 User modes
`+B` bot (advertised `BOT=B`, surfaced in WHOIS), `+R` registered-only PMs
(blocks unauthenticated senders → `477`), `+z` oper-set gag, plus standard
`+i/+w/+o` style flags. `MODE <ownnick>` → `221 RPL_UMODEIS`. Changing another
user's mode → `502`.

---

## 9. Messaging

| Command | Notes |
|---|---|
| `PRIVMSG <target> :<text>` | nick / `#chan` / status-prefixed (`@#chan`, `+#chan`, …). UTF-8 enforced; invalid → `FAIL <cmd> INVALID_UTF8`. `MAXTARGETS` cap. Away target → `301`. |
| `NOTICE <target> :<text>` | Same engine; delivery-failure numerics suppressed (no error loops). |
| `TAGMSG <target>` | Tag-only message — carries `draft/typing`, `draft/react`, `draft/reply` client tags. Example `@+typing=active TAGMSG #chat`. |
| `REDACT <target> <msgid> [:reason]` | Message redaction (cap `draft/message-redaction`). |
| `EDIT …` | Message editing (cap `draft/message-editing`). |
| `CHATHISTORY <sub> <target> …` | IRCv3 history playback, returns batches. `LATEST/BEFORE/AFTER/AROUND/BETWEEN`. |
| `MARKREAD <target> <ts\|msgid>` | Bouncer read marker. |
| `METADATA <target> <sub> [key] [value]` | IRCv3 metadata; `761/762`, errors `766/767/769`. |
| `MONITOR <+\|-\|C\|L\|S> [nicks]` | Presence monitor; `730/731/732/733`, `734` full. `extended-monitor` adds richer state. |
| `SILENCE [+\|-]<mask>` | Per-user ignore list; `271/272`. |
| `ACCEPT [+\|-]<nick>` | Caller-id allow list; `281/282`. |

**CTCP** is parsed for policy (`+C` blocks); standard CTCP replies apply. **DCC is
parser-only** — no server-mediated DCC/filehost; do not rely on a server DCC surface.
For file sharing use the external upload service (Ocean already integrates one).

Message tags you'll see/use: `time=` (server-time), `msgid=`, `account=`,
`batch=`, `label=`, and client-only `+typing`/`+react`/`+reply`/`+draft/…`.

---

## 10. Queries, IRCX & Whispers

**Queries:** `WHOIS [server] <nick>` (311/312/313/317/318/319/320/330/276/671/338,
GeoIP+real host for opers/self) · `WHO <target> [%fields]` (plain `352` or WHOX
`354`, end `315`) · `WHOWAS <nick>` (314/360/369) · `LIST [filters]` (321/322/323) ·
`ISON <nicks>` (303) · `USERHOST <nicks>` (302) · `AWAY [:msg]` (305/306, away-notify
fanout) · `SETNAME :<realname>` · `HELP/HELPOP [topic]` · `WELCOME`.

**IRCX:** `IRCX`/`ISIRCX` (enable/query → `800 RPL_IRCX` with state, version, SASL
package list, max msg size) · `DATA`/`REQUEST`/`REPLY <target> <tag> :<msg>` (typed
app messaging; tag `[A-Za-z][A-Za-z0-9.]{0,14}`; `SYS`/`ADM` need oper, `OWN`/`HST`
need chan authority) · `WHISPER <#chan> <nick[,nick]> :<text>` (channel-scoped
private msg; `+w` blocks → `923`) · `PROP <entity> [keys [:value]]` (IRCX props;
list `818`, end `819`; built-ins `NAME/OID/CREATION/MEMBERCOUNT/MEMBERLIMIT/MEMBERKEY`)
· `ACCESS <#chan> <ADD\|DELETE\|LIST\|CLEAR> …` (`801-805`) · `LISTX [filter]`
(extended channel list `811/812/816/817`).

---

## 11. Network-Wide Operator Events (Event Spine & OBSERVE)

Two parallel **network-wide** oper surfaces — an event raised on any node fans to
every node, rendered with the **originating** server name. (Relevant if Ocean has an
operator/admin view.)

- **Category feed:** `EVENT ADD <category>` / `EVENT DEL <category>` /
  `EVENT LIST`. Categories: `CONNECT DISCONNECT SERVER_LINK FLOOD ERROR ANNOUNCE
  OPER_ACTION KILL SPAM DEBUG POLICY SERVICE SECURITY`. User connect/disconnect/nick
  and raid/flood/oper-action alerts publish here. Delivered as
  `:<origin-server> EVENT <your-nick> <BODY>`.
- **Targeted OBSERVE:** `EVENT OBSERVE <mask> [connect quit nick oper]` installs a
  standing `nick!user@host` glob filter; `EVENT OBSERVE LIST` / `EVENT OBSERVE OFF`.
  Pushes `:<origin-server> EVENT <you> OBSERVE <action> <nick>!<user>@<host> acct=…`
  with the subject's **real, uncloaked** host. Matches subjects network-wide.
- **Broadcast / WALLOPS:** `EVENT BROADCAST :<text>` → rendered as
  `:<server> NOTE EVENT <CATEGORY> :<sender-mask>: <text>`. WALLOPS rides this; there
  is **no `+w` user-mode WALLOPS path**.

---

## 12. Voice / Video / Screen (MEDIA) — Discord-style calls

`MEDIA <subcommand> <#channel> [args]` (feature-gated; control plane only — **media
bytes never flow over the IRC socket**). You must be a channel member. All replies
are `NOTE MEDIA …` lines; failures `FAIL MEDIA <CODE>`.

Subcommands: `JOIN <kind>` · `LEAVE` · `OFFER <codecs> [transport=webrtc]` ·
`ANSWER <codecs>` · `ROSTER` · `PROFILE` · `STATS` · `MUTE`/`UNMUTE <kind>` ·
`SPEAKING` · `HAND` · `REACT` · `LAYER` (simulcast) · `BREAKOUT` · `POS` (spatial) ·
`CAPTION` · `TRANSCRIPT`.

- **kind** = `voice` | `video` | `screen` (default `voice`).
- **codecs** (CSV) = `kaguravox` (audio) | `kaguravis` (video) | `raw`. `OFFER` may request
  `transport=webrtc` for the browser/WebRTC leg; otherwise the native KAGURAVOX/KAGURAVIS
  UDP leg is used.
- Two media planes, bridged by header-rewrap only (no transcode): a **WebRTC-compatible
  RTP/STUN UDP plane** (`MEDIA OFFER transport=webrtc` → ICE creds, SRTP group key)
  and a **native KAGURAVOX/KAGURAVIS UDP leg** (`kagura_frame` datagrams). SFU forwarding,
  simulcast, ABR; room cap 64 participants.
- **Browser codec:** Orochi ships WASM codec exports (`kagura_wasm.zig`: KAGURAVOX
  audio + KAGURAVIS video encode/decode for `wasm32-freestanding`) — Ocean can use these
  for the native leg, or use standard WebRTC for the RTP leg.
- **`ACTIVITY <target> <state> [text]`** — presence/activity broadcast (rich presence).

`MEDIA ROSTER`/`SPEAKING`/`MUTE` give you the call roster + live speaking/mute state
to render a Discord-style voice UI. `OFFER-ACK`/`ANSWER-ACK`/`TRANSPORT`/`NATIVE`
`NOTE MEDIA` lines carry the negotiated transport + endpoint info.

---

## 13. Mesh Behaviors Visible to Clients

Orochi is a CRDT **mesh** (not a TS6 tree). What a client sees:

- **Cross-node PMs** work transparently: a remote user is routable if they share any
  channel OR are otherwise present (every registered user is gossiped via a hidden
  `~presence~` route). A DM to a truly unroutable nick fails closed with `401`.
- **NAMES/WHOIS** project remote members with their real `user@host` (not a
  `mesh@<server>` placeholder).
- **Network-wide events** (§11) and **cross-node MODE** show the **setter's nick**
  (e.g. `:kain MODE #chan +q nick`), not the origin server.
- `LINKS` (`364/365`) and `MAP` (`015/017`) render the Suimyaku mesh, not a spanning
  tree. Oper mesh introspection: `MESH`/`NETSTAT`, `ROUTE`, `NETHEALTH`.

---

## 14. Numeric Reference (client-relevant)

**Registration:** 001 welcome · 002 yourhost · 003 created · 004 myinfo ·
005 isupport · 410 invalid CAP · 421 unknown cmd · 432 erroneous nick ·
433 nick in use · 437 nick held/reserved · 451 not registered · 461 need params ·
462 already registered.

**SASL/account:** 900 logged-in · 903 SASL success · 904 SASL fail · 906 SASL aborted.

**Channel/MODE/messaging:** 221 umodeis · 301 away · 305 unaway · 306 nowaway ·
324 channelmodeis · 331 notopic · 332 topic · 341 inviting · 346/347 invex ·
348/349 exceptlist · 353/366 names · 367/368 banlist · 728/729 quietlist ·
401 no such nick · 403 no such channel · 404 cannot send · 405 too many channels ·
407 too many targets · 441 user not in chan · 442 not on chan · 443 user on chan ·
470 forward · 471 +l full · 473 +i · 474 +b/akick · 475 +k · 477 +a/+R ·
478 list full · 480 +j throttle · 482 chanop needed · 489 +S TLS required · 502 user mismatch.

**Queries:** 302 userhost · 303 ison · 311-319 whois · 320/330/338/276/671 whois extra ·
314/360/369 whowas · 321/322/323 list · 352/315 who · 354 whox.

**Lists/monitor/silence/knock/metadata:** 271/272 silence · 281/282 accept ·
710/711 knock · 713/714 knock errs · 730-734 monitor · 761/762 metadata ·
766/767/769 metadata errs.

**IRCX:** 800 RPL_IRCX · 801-805 access · 806/807 modex · 811/812/816/817 listx ·
818/819 prop · 904 badtag · 906 badvalue · 913 noaccess · 923 nowhisper.

**Oper/server/mesh:** 015/017 map · 211 statsl · 218 statsy · 219 endstats ·
242 uptime · 243 statso · 270 privs · 364/365 links · 381 youreoper · 382 rehashing ·
481 no privileges · 491 OPER disabled (use SASL).

### Standard replies (not numerics)
`FAIL <command> <CODE> [context] :<desc>` · `WARN …` · `NOTE …` (and Event-Spine
`:<server> NOTE EVENT <CATEGORY> :…`). Common codes: `ACCOUNT_REQUIRED`,
`NEED_MORE_PARAMS`, `INVALID_PARAMS`, `TEMPORARILY_UNAVAILABLE`, `INVALID_UTF8`,
`PERMISSION_DENIED`, `ACCOUNT_EXISTS`, `BAD_ACCOUNT_NAME`, `INVALID_PASSWORD`,
`INVALID_TOKEN`, `NO_SESSION`, plus the full catalog in the Orochi numerics doc.

---

## 15. Anti-Abuse (client-visible behavior)

- **Connection classes** assign per-connection sendq/recvq, flood, and admission
  policy at registration (by IP/TLS/account/oper/ident/host). Admission can refuse
  before welcome.
- **Flood guard**: keep-alives free, commands weighted, distinct-target spread
  throttle; sustained over-budget → `ERROR :Excess Flood` disconnect. Throttled
  lines are still processed (no silent drops) — only the excess threshold cuts you.
- **Raid guard**: per-channel `+j` plus a network-wide default; over-threshold JOINs
  → `480 ERR_THROTTLE`.
- **Nick delay**: a registered nick is held after its owner exits; reuse → `437`
  (`Nick is held (nick delay); try again shortly`). Owner reclaims via identify or
  `RECOVER`/`RELEASE`.

---

## 16. Removed / Absent (do not implement against these)

- **No STARTTLS** — TLS is implicit (`:6697`/`:8080`). No plaintext upgrade.
- **No WEBIRC**, **no identd/RFC1413**.
- **No `OPER` command** — oper status comes from the SASL account (`491`).
- **No DCC proxy / filehost / `draft/file-upload`** — DCC is parse-only; use the
  external upload service for files.
- **No pseudo-clients** — all services are real commands.
- **No `+w` user-mode WALLOPS** — use `EVENT BROADCAST`.
- **No `ocean/*` vendor cap** in the live registry — use `orochi/session-sync` and
  `orochi/bouncer`.

---

## 17. Ocean Refactor Checklist

- [ ] WebSocket reader splits on `/\r?\n/`, no cross-frame remainder (§1.1).
- [ ] CAP LS 302 → REQ the caps Ocean uses (echo-message, server-time, message-tags,
      batch, labeled-response, account-notify, away-notify, chghost, extended-join,
      multi-prefix, draft/chathistory, draft/event-playback, draft/typing,
      draft/react, draft/reply, draft/message-redaction, orochi/session-sync,
      orochi/bouncer, sasl).
- [ ] SASL during registration; support PLAIN + SCRAM-SHA-256 (+ SESSION-TOKEN for
      reconnect, EXTERNAL if using client certs).
- [ ] Gate the `001` autojoin storm behind `!session-sync`; let the server drive JOINs.
- [ ] On reconnect: `SESSION TOKEN` capture + `SESSION-TOKEN` SASL reclaim; dedup
      CHATHISTORY/bouncer replay by `msgid`.
- [ ] Parse `time=`/`msgid=`/`account=` tags; render typing/react/reply TAGMSG tags.
- [ ] Honor `MODES` (combine modes per line per the advertised value; live = 1).
- [ ] Map service `FAIL`/`NOTE`/`NOTICE` replies to UI (REGISTER/IDENTIFY/CHANNEL/…).
- [ ] Voice/video via `MEDIA` (control) + WebRTC RTP leg or native KAGURAVOX/KAGURAVIS WASM
      codec; render roster/speaking/mute from `NOTE MEDIA`.
- [ ] Treat `:server NOTE EVENT <CAT> :…` and `EVENT … OBSERVE …` as the oper feed.
