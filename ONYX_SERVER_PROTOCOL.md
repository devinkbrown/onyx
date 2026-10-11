# Onyx Server Protocol — Client Integration Reference (for Onyx)

Everything a client needs to talk to **Onyx Server**, the pure-Zig clean-room
sovereign-mesh IRC daemon (modern-only successor to C "Ophion"). This is the
authoritative surface for refactoring Onyx's IRC layer (`src/lib/irc/`).

Onyx Server is **modern-only**: there is **no STARTTLS**, **no WEBIRC**, **no identd /
RFC1413**, **no DCC proxy/filehost**, **no `OPER` command** (operator status is
granted at SASL login), and **no pseudo-clients** — services are real server
commands (`REGISTER`, `CHANNEL`, `MEMO`, …), never ChanServ/NickServ fake users.

> Source of truth lives in the Onyx Server repo under `docs/reference/` and
> `docs/architecture/`. This file consolidates it for Onyx. When something here
> conflicts with a live server, trust the server and the Onyx Server docs.

---

## 1. Transport & Endpoints

The live network is **Onyx** (the consumer brand; the daemon behind it is
**Onyx Server**), two nodes: `eshmaki.me` and `ircx.us`. Listeners are **dual-stack
IPv6** (`[listen] host = "::"`). The wire `NETWORK` name is operator-set via
`[network] name` (default `Onyx Server`); see §3.

| Port | Transport | Use |
|---|---|---|
| `6667` | Plaintext TCP | Plain IRC (dev/local only) |
| `6697` | Implicit TLS | TLS IRC (TLS 1.3 + hardened 1.2 profile) |
| `8080` | **Secure WebSocket (wss)** | **Browser clients — Onyx uses this** |
| `6900` | Mesh S2S (Mooring PQ) | Server↔server only — **not for clients** |

TLS is **1.3 plus a hardened 1.2 profile** (AEAD/ECDHE-only; no RSA key exchange,
CBC, compression, or renegotiation). There is no plaintext→TLS upgrade; pick a TLS
port up front.

### 1.1 WebSocket framing (CRITICAL — this bit Onyx before)

Onyx Server's wss listener sends **one IRC message per WebSocket frame, with NO trailing
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
| `001` | RPL_WELCOME | `Welcome to the <NETWORK> network, <nick> — you are <nick!user@host>` (`<NETWORK>` = the `[network] name`, live: `Onyx`) |
| `002` | RPL_YOURHOST | `Your host is <server> (node N), running onyx-server-<ver>+<hash>` |
| `003` | RPL_CREATED | uptime/创建 line |
| `004` | RPL_MYINFO | `<server> onyx-server-<ver>+<hash> <usermodes> <chanmodes> <chanmodes-with-param>` |
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
| `NETWORK` | `Onyx Server` (live: `Onyx`) | Network name (operator-set via `[network] name`) |
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
onyx/session-sync    onyx/bouncer        (vendor — see §6)
```

Notes for Onyx:
- **`draft/event-playback`** — when negotiated, CHATHISTORY/bouncer replay includes
  channel events (JOIN/PART/MODE/TOPIC/KICK/NICK/QUIT) as `:sender CMD <body>`;
  without it you get messages only.
- **`no-implicit-names`** — suppresses the automatic NAMES burst on JOIN.
- **`draft/typing` / `draft/react` / `draft/reply`** — client-only tags relayed
  through TAGMSG (Discord-style typing indicators, reactions, replies).
- **`echo-message`** — your own sent messages are echoed back (use for optimistic
  UI confirmation / msgid capture).
- **`labeled-response`** — echo `@label=` on a command to correlate replies.
- The live CAP registry namespace is `onyx/*`. There is **no `onyx/*` cap**.

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

### 5.1 Passkeys (WebAuthn)

Passwordless login via the `WEBAUTHN` command, paired with browser
`navigator.credentials`. This is a **standard-reply-driven** exchange, not a SASL
mechanism: challenges/results arrive as `NOTE WEBAUTHN <SUBCODE> …` (and `FAIL
WEBAUTHN …` / `WARN WEBAUTHN …` on error), the client answers with `WEBAUTHN
<SUBCOMMAND> …`. All binary fields on the wire are **base64url, no padding**
(IRC-token-safe). Onyx's half is `src/lib/webauthn/passkey.ts`; the store handler
is `src/lib/store/store.ts:4710`.

**Register a passkey** (must already be logged in):

```
→ WEBAUTHN REGISTER [label]
← NOTE WEBAUTHN REGISTER-CHALLENGE <chal_b64url> <rp_id> :<account>
→ WEBAUTHN REGISTER-FINISH <credId_b64url> <clientDataJSON_b64url> <authData_b64url>
← NOTE WEBAUTHN REGISTERED <credId_b64url> :<label>
```

**Sign in with a passkey** (passwordless; no prior login):

```
→ WEBAUTHN AUTH <account>
← NOTE WEBAUTHN AUTH-CHALLENGE <chal_b64url> <rp_id> :<account>
← NOTE WEBAUTHN ALLOW-CRED <credId_b64url>            (0..n, one per allowed credential)
→ WEBAUTHN AUTH-FINISH <credId_b64url> <clientDataJSON_b64url> <authData_b64url> <sig_b64url>
← (IDENTIFY login side effects — you are now logged in)
```

Client-side fail-closed rules Onyx enforces before prompting the device: the
`rp_id` must be a non-empty whitespace-free host label, the challenge must decode
as valid base64url and be **≥ 16 bytes** (WebAuthn L2 §13.4.3 minimum), and the
offered algorithms are ES256 (-7) and EdDSA (-8) only — the algorithms the
daemon's COSE parser accepts. `ALLOW-CRED` lines follow the `AUTH-CHALLENGE` and
are collected before the `get()` ceremony runs.

---

## 6. Sessions, Reconnect Reclaim & Bouncer (Onyx-critical)

Onyx should reconnect instantly into its live session instead of a JOIN storm.

- **`SESSION`** command: `SESSION LIST` (live sessions for your account),
  `SESSION TOKEN` (reveals this session's local reclaim token, plus an optional
  mesh `MTOKEN` for cross-node reclaim), `SESSION RESUME <token>` (resume a detached
  session). Replies are `NOTE SESSION LIST|TOKEN|MTOKEN`. Failures
  `FAIL SESSION INVALID_TOKEN|NO_SESSION`.
- **`SESSION-TOKEN` SASL mech**: reconnect by presenting the token from
  `SESSION TOKEN` — re-attaches to the same account session.
- **`onyx/session-sync` cap**: multi-client "keep both" — when set, on login the
  server syncs the new connection into the same channels as your other same-account
  sessions. **Gate your `001` autojoin storm behind `!sessionSyncActive`** — the
  server drives the JOINs when the cap is present (this is already the pattern in
  Onyx's `src/lib/store`).
- **`onyx/bouncer` cap**: automatic history rewind on join/rejoin. Combine with
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
| `MEMO [LIST\|CLEAR\|SEND <account> :msg\|FORWARD <account>\|OFF\|IGNORE ADD\|DEL\|LIST <account>]` | Offline account messages; delivered + cleared on login. Command name is **`MEMO` only** (no `TEGAMI` alias). |
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
  `t` topic-ops-only, `C` no-CTCP, `T` no-notice (drops channel NOTICE from
  non-ops), `N` no-nick (blocks nick changes by non-ops while joined),
  `M` reg-moderated, `S` TLS-only, `g` free-invite (any member may INVITE
  while `+i`), `W` news-wire (in-channel news fantasy commands),
  `O` oper-only, `A` admin-only,
  `V` NOCOMICDATA, `U` OPMODERATE, `F` FREETARGET, `D` DISFORWARD.
  NOWHISPER is the lowercase IRCX ext flag `w` (`923 ERR_NOWHISPER`), not
  `+W`. Further live-but-unadvertised IRCX ext flags: `p` PRIVATE,
  `h` HIDDEN, `u` KNOCK, `a` AUTHONLY, `f` NOFORMAT, `d` CLONEABLE,
  `E` CLONE, `r` REGISTERED, `z` SERVICE, `x` AUDITORIUM.
  Source: `docs/reference/protocol/modes.md` (drawn from live source).
- `MODE #chan` query → `324 RPL_CHANNELMODEIS` (hides `+k`/`+l` values from
  non-members). Set → `MODE` broadcast.
- **`MODEX <#chan> [+NAMEDMODE …]`** — IRCX named-mode front end (`+AUTHONLY` etc.);
  lists named modes via `826/827`, else delegates to `MODE`.
  (806/807 are EVENT ADD/DEL per draft-pfenning-04; MODEX lives
  just past the EVENT range — see `ircx_modex.zig`.)

### 8.4 Extbans (`$,acgmrz`)
`$a:<account>`, `$c:<#chan>`, `$g:<country>`, `$m:<mute-mask>`, `$r:<realname>`,
`$z:<tls-fingerprint>` (and `$o:<class>`), with `$~<type>:…` negation. Used in
`+b/+e/+I/+Z` masks.

### 8.5 User modes
Client-writable (self `MODE <ownnick>` only): `i` invisible, `B` bot
(advertised `BOT=B`, surfaced in WHOIS), `D` deaf, `g` callerid (DMs need
ACCEPT), `C` no-ctcp, `R` regonly-pm (rejects unauthenticated senders),
`p` hide-chans, `Q` no-forward, `H` hide-oper, `P` media-presence-private,
`j` override (privilege-gated). Server-managed (read-only to clients):
`o` operator (derived from SASL elevation), `r` registered, `x` cloaked,
`z` secure-tls (opers may use cross-user `+z` as GAG), `M` media-tx-deny,
`a` admin. There is **no `+w`** (wallops/snomask do not use user modes;
operator notifications ride the Event Spine as raw `EVENT` lines).
`MODE <ownnick>` → `221 RPL_UMODEIS`. Changing another user's mode →
`502` (except the oper `+z` GAG and `+M`/`+P` media paths).
Source: `docs/reference/protocol/modes.md` (drawn from live source).

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
For file sharing use the external upload service (Onyx already integrates one).

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
every node, rendered with the **originating** server name. (Relevant if Onyx has an
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

## 12. Voice / Video / Screen (MEDIA) — channel calls on the IRC WebSocket

Browser calls ride the **same `wss` connection as IRC**. `MEDIA …` text lines are
the control plane, and **binary WebSocket frames carrying Cadence frames** (codecs
`cadencevox` / `cadencevis`) are the media plane (`src/daemon/server.zig:2785`).
Media payloads are client-held E2EE ciphertext. The server checks framing and
authority, never decrypts, and never re-wraps browser media onto its UDP legs
(`src/daemon/server.zig:53953`). The native Cadence UDP leg and the WebRTC RTP/STUN
leg are for non-browser clients. A WebSocket caller is never offered `NATIVE`, and
gets `TRANSPORT` only for an explicit `transport=webrtc` with a routable candidate
(`src/daemon/server.zig:65968`, `:65973`, `:66024`). Onyx uses neither UDP leg.

Evidence paths below are in the Onyx Server repo.

### 12.1 Client checklist (joining a call)

1. **Socket:** use `wss://<node>:8080` and offer `onyx.irc-media.v1` first
   (`new WebSocket(url, ['onyx.irc-media.v1', 'text.ircv3.net'])`). The server
   selects the first protocol it supports, in your offer order
   (`src/proto/websocket.zig:638`). `text.ircv3.net` is text-only: a binary frame
   on it closes the socket with 1002 (`src/daemon/server.zig:17349`, `:66678`). TLS
   must terminate at Onyx Server. Plain `ws://` exists only as the testing listener
   `[listen] ws_plain` (`src/daemon/server.zig:2543`), and `MEDIA JOIN` on it fails
   with `SECURE_SIGNALING_REQUIRED` (§12.3).
2. **Account:** log in with SASL (§5). The media E2EE verbs require an account,
   and the server relays a binary frame only after an accepted E2EE handshake.
   A guest can appear in the call roster, but it cannot send media.
3. **Events:** send `IRCX`, then `EVENT ADD MEDIA [<#chan-glob>]`. `EVENT` is
   IRCX-gated, so it returns 421 until you send `IRCX`
   (`src/proto/ircx_gate.zig:45`). Non-opers may subscribe to MEDIA
   (`src/daemon/server.zig:37043`), and delivery requires channel membership
   (`src/daemon/server.zig:37693`).
4. **Device key:** send `IDENTITY ADD <label> <pubhex> <sighex>` and wait for
   `NOTICE <you> :IDENTITY ADDED label=<label>` (§12.6). Do this before the
   handshake on every session (re-adding a label overwrites it). Do **not** gate
   it on ISUPPORT `ACCOUNTRESIDENCE` (§12.8).
5. **Channel:** `JOIN #room`. MEDIA targets are **channels only**: a nick or DM
   target gets `403` (§12.3), so there are no DM or 1:1 calls yet.
6. **Join the call:** `MEDIA JOIN #room voice` returns a caller-only
   `EVENT <you> MEDIA MACKEY #room <base64>` (only when the node runs with
   `[media] ws_media_relay` on, §12.2), and the room sees
   `MEDIA JOIN #room <you> voice`. `MEDIA OFFER #room cadencevox,cadencevis` is
   optional for browsers.
7. **Handshake:** send `MEDIA E2EE-HANDSHAKE #room :<base64>` **after** the JOIN,
   because the server requires you to be in the call. Any JOIN that adds a new kind
   clears the connection's attachment (`src/daemon/server.zig:66254`), so send the
   handshake again after `MEDIA JOIN #room video|screen`.
8. **Group key:** exchange `MEDIA E2EE-GROUPKEY …` with each peer's attachment
   (§12.6).
9. **Media:** send binary Cadence frames on the same socket, each tagged with the
   MACKEY HMAC (§12.7).
10. **Leave:** `MEDIA LEAVE #room`. Disconnecting, PART, KICK, NICK and account
    changes also retire the call (`src/daemon/server.zig:17064`, `:23029`,
    `:23978`, `:43105`, `:44267`).

### 12.2 Server prerequisites (operator config)

| Key | Default | Effect for browser calls |
|---|---|---|
| `[media] ws_media_relay` | `false` | **Must be `true`.** When it is false, a WS `MEDIA JOIN` gets no MACKEY and binary frames are ignored without a reply (`src/daemon/server.zig:2219`, `:53962`). |
| `[media] ws_media_require_mac` | `false` | When true, untagged frames are dropped. When false, untagged frames relay, but a tag that is present must verify (`src/daemon/server.zig:2225`; `src/substrate/cadence_frame.zig:361`). |
| `[media] enabled` | `false` | Controls the UDP legs only. WS call membership works without it (`src/daemon/server.zig:6124`). |
| feature `media` | on | When this feature is disabled, `MEDIA` returns `421 … :Command disabled by configuration` (`src/daemon/modules/feature_misc.zig:110`; `src/daemon/server.zig:18075`). |
| `[media] max_participants` | `64` | Room cap, at most 256 (`src/daemon/media_room.zig:18`). |

### 12.3 Requirements, and what you get when one is missing

| Missing | Reply | Evidence |
|---|---|---|
| Channel target (nick/DM, or a channel that does not exist) | `403 <target> :No such channel`. This is a **numeric, not a FAIL**. | `src/daemon/media_cmd.zig:36` |
| Channel membership | `442 <#chan> :You're not on that channel` (opers are exempt for `QUALITY` only) | `src/daemon/media_cmd.zig:44`, `:52` |
| Registration | `451` (MEDIA requires a registered client) | `src/daemon/registry.zig:377` |
| Protected `wss` socket | `FAIL MEDIA SECURE_SIGNALING_REQUIRED` on WS `JOIN`, and on `OFFER`/`ANSWER` when they would issue endpoint credentials. The check requires a live TLS session on the connection itself. | `src/daemon/server.zig:6205`, `:54447`, `:65350` |
| Media-capable subprotocol | WS close `1002` on the first binary frame | `src/daemon/server.zig:17349` |
| Logged-in account | `FAIL MEDIA AUTH_REQUIRED` on `E2EE-HANDSHAKE`/`E2EE-GROUPKEY`, and `FAIL IDENTITY NOT_LOGGED_IN` on `IDENTITY ADD`. `MEDIA JOIN` itself does not check for an account. | `src/daemon/media_cmd.zig:341`; `src/daemon/server.zig:46255` |
| Enrolled device key | `FAIL MEDIA UNENROLLED_E2EE_IDENTITY` | `src/daemon/media_cmd.zig:362` |
| Being in the call | `FAIL MEDIA NOT_IN_CALL` | `src/daemon/media_cmd.zig:345` (and per verb) |
| Accepted handshake (binary frames) | Frame dropped and `404 <#chan> :Media frame rejected` (§12.7) | `src/daemon/server.zig:54026`, `:54053` |
| Transmit permission | `FAIL MEDIA TX_DENIED`. The server-managed umode `+M` (media-tx-deny) blocks JOIN/OFFER/UNMUTE/SPEAKING and frames. | `src/daemon/media_cmd.zig:63`, `:487`; `src/proto/usermode.zig:160` |

### 12.4 Subcommands

The form is `MEDIA <sub> <#chan> [args]`; fewer than 2 params returns `461`
(`src/daemon/media_cmd.zig:30`). In this table:

- **room → `VERB <nick> [detail]`** means the line
  `:<srv> EVENT <you> MEDIA VERB <#chan> <nick> [detail]`.
- **caller → `VERB [detail]`** means the line
  `:<srv> EVENT <you> MEDIA VERB <#chan> [detail]`, which carries **no nick token** (§12.5).

| Subcommand + args | Result |
|---|---|
| `JOIN [voice\|audio\|video\|screen]` (default `voice`) | With WS and relay on: caller → `MACKEY <base64 32-byte key>` (`src/daemon/server.zig:66458`). Room → `JOIN <nick> <kind>` on the nick's first attachment of that kind (`src/daemon/server.zig:6221`). Re-joining a kind you already hold is a silent no-op. |
| `LEAVE` | Room → `LEAVE <nick>` when the nick's last attachment leaves. If another same-nick device stays in the call, the room gets `E2EE-DETACH <nick> <att>` instead (`src/daemon/server.zig:53828`, `:53833`). If you are not in the call: `NOTICE <you> :MEDIA: you are not in this call` (`src/daemon/media_cmd.zig:474`). |
| `MUTE <kind>` / `UNMUTE <kind>` | Room → `MUTE\|UNMUTE <nick> <kind>`. Otherwise `NOT_IN_CALL` (`src/daemon/media_cmd.zig:492`). While a kind is muted, the server rejects its frames (§12.7). |
| `SPEAKING <kind> <on\|1\|off>` | Room → `SPEAKING\|SILENT <nick> <kind>`. Otherwise `NOT_PUBLISHING` (`src/daemon/media_cmd.zig:506`). |
| `ROSTER` | Caller → `ROSTER <nick> <kinds> <breakout> <x> <y> <hand\|-> [codecs=… fec=…] consent=0\|1` for each participant, then `ROSTER-END count=N`. `kinds` is a comma list; a `-` prefix means muted and `*` means speaking (`src/daemon/server.zig:54748`). |
| `HAND [up\|down]` (bare = up) · `QUEUE` | Room → `HAND <nick> up\|down`. `QUEUE`: caller → `QUEUE <i> <nick>` … `QUEUE-END count=N` (`src/daemon/media_cmd.zig:437`; `src/daemon/server.zig:54735`). |
| `REACT <token>` (≤32 bytes) | Room → `REACT <nick> <token>`. Ephemeral (`src/daemon/media_cmd.zig:452`). |
| `OFFER <codec,…> [transport=webrtc] [fingerprint=sha-256:<hex>]` | Codecs are `cadencevox`, `cadencevis`, `raw`. Caller → `OFFER-ACK codecs=<agreed> fec=<scheme>`, plus `KIND-DENIED kind=<k> reason=no_common_codec`. Room → `CAPS <nick> codecs=… fec=…` and `PROFILE <nick> …` (`src/daemon/server.zig:54433`, `:66086`, `:54201`). |
| `ANSWER <codec,…>` | Caller → `ANSWER-ACK …`. Before any OFFER: `NO_OFFER` (`src/daemon/server.zig:54437`). |
| `PROFILE` | Caller → `PROFILE codecs=… fec=…`, or `NO_OFFER` (`src/daemon/media_cmd.zig:86`). |
| `STATS` | Caller → `STATS <nick> leg=webrtc\|native …` … `STATS-END count=N`. Counts **UDP legs only**; WS media is not counted (`src/daemon/server.zig:54684`). |
| `QUALITY` | Caller → `QUALITY <nick> loss= rtt= spatial= bitrate=` … `QUALITY-END count=N` (`src/daemon/server.zig:54713`). |
| `ABR <cur_kbps> <avail_kbps> <loss_pct> <rtt_ms> [nack/s]` | Caller → `ABR action= bitrate= fec= keyframe= spatial<= temporal<=` (`src/daemon/media_cmd.zig:185`). |
| `LAYER <max_spatial> <max_temporal 0-7>` | Caller → `LAYER spatial<=S temporal<=T`. Applies to SFU (UDP) forwarding (`src/daemon/media_cmd.zig:156`). |
| `BREAKOUT <room>` · `POS <x> <y>` | Room → `BREAKOUT <nick> <room>` · `POS <nick> <x> <y>` (`src/daemon/media_cmd.zig:263`). |
| `CAPTION :<text>` · `TRANSCRIPT` | Room → `CAPTION <nick> <text>` (also retained). `TRANSCRIPT`: caller → `TRANSCRIPT <speaker> :<text>` … `TRANSCRIPT-END count=N` (`src/daemon/media_cmd.zig:307`). |
| `CONSENT <on\|off>` · `RECORD [stop]` | Room → `CONSENT <nick> on\|off`, `RECORD <nick> started\|stopped`. RECORD needs every participant's consent (`CONSENT_REQUIRED`) (`src/daemon/media_cmd.zig:97`). |
| `E2EE-HANDSHAKE` · `E2EE-GROUPKEY` | See §12.6. |
| `E2EE-DETACH` | Server-originated only. A client that sends it gets `INVALID_SUBCOMMAND` (`src/daemon/media_cmd.zig:468`). |
| `TURN …` | Always `FAIL MEDIA TURN_CUT`: no TURN relay is offered (`src/daemon/media_cmd.zig:26`). |

Users with umode `+P` (media-presence-private) suppress their own presence
broadcasts: JOIN, LEAVE, MUTE, SPEAKING, HAND, REACT, POS, BREAKOUT, CONSENT and
RECORD (`src/daemon/server.zig:53938`; `src/proto/usermode.zig:161`). `CAPTION`,
`CAPS`, `PROFILE` and the `E2EE-*` events are always published.

### 12.5 Reply shapes

- **Room events (Event Spine):**
  `[@tags ]:<srv> EVENT <you> MEDIA <VERB> <#chan> <nick> [detail]`, where `<srv>`
  is the originating node. These reach MEDIA subscribers on every mesh node
  (`src/daemon/server.zig:37529`; `src/daemon/event_spine.zig:482`). The sender is
  not excluded, so your own actions come back to you; ignore your own nick
  (`src/daemon/server.zig:55988`).
- **Caller-only replies** (no subscription needed; they may carry secrets):
  `[@tags ]:<srv> EVENT <you> MEDIA <VERB> <#chan> [detail]`
  (`src/daemon/server.zig:37651`). **There is no nick token**, so do not parse
  these with the room-event shape. These are `MACKEY`, `ROSTER`/`-END`,
  `STATS`/`-END`, `QUALITY`/`-END`, `QUEUE`/`-END`, `TRANSCRIPT`/`-END`,
  `OFFER-ACK`, `ANSWER-ACK`, `KIND-DENIED`, `PROFILE`, `LAYER`, `ABR`, `RECORD`,
  and (UDP legs only) `TRANSPORT`, `NATIVE` and `NATIVE-MACKEY`.
- **Failures:** `FAIL MEDIA <CODE> :<reason>` when you have negotiated
  `standard-replies`. Otherwise the server sends `NOTICE <you> :FAIL MEDIA <CODE>: <reason>`
  (`src/daemon/server.zig:55449`). MEDIA emits **no `NOTE` or `WARN` lines**.

| FAIL MEDIA code | Meaning |
|---|---|
| `AUTH_REQUIRED` | E2EE verb without a logged-in account |
| `UNENROLLED_E2EE_IDENTITY` | The handshake's Ed25519 key is not an `IDENTITY ADD`ed key on your account |
| `BAD_E2EE_HANDSHAKE` | Wrong arity; non-canonical base64, length or version; or the signature does not verify for this channel |
| `BAD_E2EE_GROUPKEY` / `BAD_E2EE_SENDER` / `BAD_E2EE_TARGET` | Bad GROUPKEY arity or encoding / sender attachment is not this connection's accepted handshake / target is not a member in the call |
| `SECURE_SIGNALING_REQUIRED` | The connection is not a live TLS (`wss`) session |
| `NOT_IN_CALL` / `NOT_PUBLISHING` | No `MEDIA JOIN` yet / that kind is not published |
| `TX_DENIED` | Umode `+M` |
| `INVALID_KIND` / `INVALID_SUBCOMMAND` | Kind is not voice/audio/video/screen / unknown verb |
| `JOIN_FAILED` / `TRANSPORT_UNAVAILABLE` | Media routing is unavailable on this node (`src/daemon/server.zig:6200`, `:54444`) |
| `NO_CODECS` / `NO_COMMON_CODEC` / `NO_OFFER` | Empty codec list / no overlap / ANSWER or PROFILE before any OFFER |
| `BAD_FINGERPRINT` / `DTLS_UNAVAILABLE` | WebRTC leg only |
| `BAD_LAYER` `BAD_ABR` `BAD_CONSENT` `CONSENT_REQUIRED` `INVALID_POSITION` `POS_FAILED` `BREAKOUT_FAILED` `HAND_FAILED` `INVALID_REACTION` | Bad arguments or state for that verb |
| `TURN_CUT` | No TURN relay |

### 12.6 Media E2EE: `IDENTITY ADD`, `E2EE-HANDSHAKE`, `E2EE-GROUPKEY`

**Enrollment.** The form is `IDENTITY ADD <label> <pub-hex 64> <sig-hex 128>`
(`src/daemon/server.zig:46253`).

- The label is `[A-Za-z0-9._-]{1,32}`.
- The signature is Ed25519 over
  `"ONYX-ACCOUNT-IDENTITY-v1" 0x00 <account> 0x00 <label> 0x00 <32-byte pubkey>`
  (`src/proto/account_identity.zig:25`, `:73`, `:95`). `<account>` is the name
  from `900`.
- The key is stored as the user PROP `identity.key.<label>` and replicated across
  the mesh (`src/daemon/server.zig:46270`).
- Success is `:<srv> NOTICE <you> :IDENTITY ADDED label=<label>` (`src/daemon/server.zig:46191`, `:46273`).
- Failure is `FAIL IDENTITY NOT_LOGGED_IN|NEED_MORE_PARAMS|BAD_ASSERTION|BAD_LABEL|STORE_FAILED`
  (`src/daemon/server.zig:46255`–`:46267`).

**`MEDIA E2EE-HANDSHAKE <#chan> :<b64>`** takes exactly 3 params. `<b64>` is
standard padded base64 of a 275-byte signed-v2 envelope
(`src/daemon/media_cmd.zig:350`; `src/daemon/server.zig:37545`, `:37571`):

| Bytes | Field |
|---|---|
| `[0]` | version `0x02` |
| `[1..17)` | attachment id (16 bytes) |
| `[17..82)` | P-256 static public key (`0x04…`) |
| `[82..147)` | P-256 ephemeral public key (`0x04…`) |
| `[147..179)` | call nonce (opaque to the server) |
| `[179..211)` | Ed25519 device signing public key (**must be enrolled**) |
| `[211..275)` | Ed25519 signature over `"onyx-media-handshake-v2" 0x00 ‖ lower(#chan) ‖ 0x00 ‖ bytes[0..211)` |

The server checks the canonical encoding and the point prefixes. It then checks
that the signing key matches an `identity.key.*` prop on your account
(`src/daemon/server.zig:37626`); if not, you get `UNENROLLED_E2EE_IDENTITY`.
Last, it strict-verifies the signature (`src/daemon/server.zig:37602`); if that
fails, you get `BAD_E2EE_HANDSHAKE`.

On success the room gets `E2EE-HANDSHAKE <nick> :<b64>`, and the attachment is
bound to **this connection**. A connection holds one attachment: a new handshake
first publishes `E2EE-DETACH` for the old one (`src/daemon/media_cmd.zig:370`–`:385`).

**`MEDIA E2EE-GROUPKEY <#chan> <sender-att> <target-nick> <target-att> <epoch> :<b64-wrapped>`**
takes exactly 7 params (`src/daemon/media_cmd.zig:388`).

- An attachment token is 22-char **unpadded base64url** of the 16-byte id
  (`src/daemon/server.zig:37614`).
- `<sender-att>` must equal this connection's accepted handshake attachment.
- `<target-nick>` must be a channel member who is in the call.
- `<epoch>` is a canonical u64 decimal.
- The wrapped key is canonical padded base64 of at most 512 bytes.
- The relay goes to **every MEDIA subscriber in the channel** as
  `E2EE-GROUPKEY <sender> <sender-att> <target> <target-att> <epoch> :<wrapped>`.
  Receivers filter on target.

**Naming.** Outbound subtypes are `E2EE-HANDSHAKE` / `E2EE-GROUPKEY` only. The
server's MEDIA handler has no `TSUMUGI_*` branch. Such a line falls through to
kind parsing and is refused with `INVALID_KIND` or `INVALID_SUBCOMMAND`
(`src/daemon/media_cmd.zig:479`, `:521`), and the server never emits one.
`TSUMUGI_*` survive only as historical client-side interop literals (inbound-only).
Never send them, and never introduce new Japanese names.

### 12.7 Binary media frames (same socket)

**Admission.** The server checks these in order (`src/daemon/server.zig:53961`–`:54002`):

1. `ws_media_relay` is on and you are registered.
2. You do not have `+M`.
3. The socket is bound to a call by a WS `MEDIA JOIN`.
4. The Cadence frame shape and the MAC (if present, or if required) are valid.
5. **Authorization** (`src/daemon/server.zig:54018`–`:54056`):
   - You are a channel member.
   - The payload **starts with this connection's 16-byte handshake attachment id**
     and is at least 16 + 64 bytes long.
   - The codec is `cadencevox` (0x01) or `cadencevis` (0x02). `raw` is rejected.
   - `stream_id` equals FNV-1a32 of `lower(#chan) 0x00 lower(nick) 0x00 "audio"|"video"`
     (`src/daemon/server.zig:54062`).
   - You joined the matching kind (voice for `cadencevox`, video or screen for
     `cadencevis`) and have not `MEDIA MUTE`d it, because a muted kind cannot
     publish (`src/substrate/undertow/media.zig:128`).

A rejected frame is dropped, and the server sends `404 <#chan|*> :<reason>` at
most once per second. The IRC session stays up (`src/daemon/server.zig:54008`).

**Cadence frame layout** (`src/substrate/cadence_frame.zig:12`–`:23`), all little-endian:

| Field | Size |
|---|---|
| payload length | u32 |
| band (≥ 64) | u8 |
| stream_id | u32 |
| sequence | u32 |
| timestamp | u64 |
| flags (bit 0 = keyframe) | u8 |
| codec tag | u8 |
| payload | variable |
| optional MAC tag | 16 bytes |

The tag is `HMAC-SHA256(MACKEY, frame bytes)[0..16]`, where MACKEY is the base64
32-byte key from `MEDIA MACKEY` (`src/substrate/cadence_frame.zig:70`, `:286`).

**Binding.** Each socket has one call binding: the channel and nick at JOIN time
(`src/daemon/server.zig:3368`). A JOIN in another channel rebinds the socket and
clears its attachment.

**Size and SendQ.**

- One binary message, after reassembly of continuation frames, may be at most
  **4 MiB**. A larger message closes the socket with `1009`
  (`src/daemon/helix/ws_snapshot.zig:55`; `src/daemon/server.zig:2794`, `:66667`).
- Relayed frames enter each recipient's normal SendQ. The default class SendQ is
  1 MiB (`src/daemon/conn_class.zig:55`; `src/daemon/sendq.zig:68`).
- A recipient whose SendQ cannot take a frame is **disconnected** with
  `Delivery gap; reconnect/resume required` (`src/daemon/server.zig:13252`, `:12975`).
- So keep frames, and especially video keyframes, well under the class SendQ.

**Fan-out.** Frames go to the other call participants in the channel, on WS
sockets whose subprotocol admits binary (`src/daemon/server.zig:54099`–`:54124`).
They also go once to mesh peers, which fan out locally and never re-mesh
(`src/daemon/server.zig:54089`; `src/proto/media_ws_relay.zig:6`). The sender gets
no echo.

### 12.8 ISUPPORT `ACCOUNTRESIDENCE` — do not rely on it

`buildIsupportTokens` adds `ACCOUNTRESIDENCE=<16-hex node shortId>` only when
`cfg.node_identity != null` (`src/daemon/server.zig:1913`, `:1966`). The daemon
builds the 005 list **once**, at `src/main.zig:1820`, and installs it at `:1821`.
After that it is read-only (`src/proto/protocol_inventory.zig:160`), and every 005
burst reads that list (`src/daemon/server.zig:42757`).

The node identity is assigned **later**, at `src/main.zig:1901`, and nothing sets
it earlier. So a live node never advertises `ACCOUNTRESIDENCE`, even when it has
a mesh identity. `IDENTITY RESIDENCE` still reads the identity at runtime
(`src/daemon/server.zig:46287`). Treat a missing token as "unknown", not
"unsupported". Calls never depend on it: enroll with `IDENTITY ADD`
unconditionally.

`ACTIVITY` is not part of MEDIA. It is `ACTIVITY SUBSCRIBE|UNSUBSCRIBE <#chan>`,
a channel activity stream for members (`src/daemon/server.zig:58586`).

---

## 13. Mesh Behaviors Visible to Clients

Onyx Server is a CRDT **mesh** (not a TS6 tree). What a client sees:

- **Cross-node PMs** work transparently: a remote user is routable if they share any
  channel OR are otherwise present (every registered user is gossiped via a hidden
  `~presence~` route). A DM to a truly unroutable nick fails closed with `401`.
- **NAMES/WHOIS** project remote members with their real `user@host` (not a
  `mesh@<server>` placeholder).
- **Network-wide events** (§11) and **cross-node MODE** show the **setter's nick**
  (e.g. `:kain MODE #chan +q nick`), not the origin server.
- `LINKS` (`364/365`) and `MAP` (`015/017`) render the Cadence mesh, not a spanning
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

**IRCX:** 800 RPL_IRCX · 801-805 access · 806/807 event-add/del · 811/812/816/817 listx · 826/827 modex ·
818/819 prop · 904 badtag · 906 badvalue · 913 noaccess · 923 nowhisper.

**Oper/server/mesh:** 015/017 map · 211 statsl · 218 statsy · 219 endstats ·
242 uptime · 243 statso · 270 privs · 364/365 links · 381 youreoper · 382 rehashing ·
481 no privileges · 491 OPER disabled (use SASL).

### Standard replies (not numerics)
`FAIL <command> <CODE> [context] :<desc>` · `WARN …` · `NOTE …` (and Event-Spine
`:<server> NOTE EVENT <CATEGORY> :…`). Common codes: `ACCOUNT_REQUIRED`,
`NEED_MORE_PARAMS`, `INVALID_PARAMS`, `TEMPORARILY_UNAVAILABLE`, `INVALID_UTF8`,
`PERMISSION_DENIED`, `ACCOUNT_EXISTS`, `BAD_ACCOUNT_NAME`, `INVALID_PASSWORD`,
`INVALID_TOKEN`, `NO_SESSION`, plus the full catalog in the Onyx Server numerics doc.

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
- **No `onyx/*` vendor cap** in the live registry — use `onyx/session-sync` and
  `onyx/bouncer`.

---

## 17. Onyx Refactor Checklist

- [ ] WebSocket reader splits on `/\r?\n/`, no cross-frame remainder (§1.1).
- [ ] CAP LS 302 → REQ the caps Onyx uses (echo-message, server-time, message-tags,
      batch, labeled-response, account-notify, away-notify, chghost, extended-join,
      multi-prefix, draft/chathistory, draft/event-playback, draft/typing,
      draft/react, draft/reply, draft/message-redaction, onyx/session-sync,
      onyx/bouncer, sasl).
- [ ] SASL during registration; support PLAIN + SCRAM-SHA-256 (+ SESSION-TOKEN for
      reconnect, EXTERNAL if using client certs).
- [ ] Gate the `001` autojoin storm behind `!session-sync`; let the server drive JOINs.
- [ ] On reconnect: `SESSION TOKEN` capture + `SESSION-TOKEN` SASL reclaim; dedup
      CHATHISTORY/bouncer replay by `msgid`.
- [ ] Passkey login via `WEBAUTHN` (§5.1): validate the server challenge fail-closed
      (base64url, ≥16 bytes, host-label `rp_id`) before calling `navigator.credentials`.
- [ ] Parse `time=`/`msgid=`/`account=` tags; render typing/react/reply TAGMSG tags.
- [ ] Honor `MODES` (combine modes per line per the advertised value; live = 1).
- [ ] Map service `FAIL`/`NOTE`/`NOTICE` replies to UI (REGISTER/IDENTIFY/CHANNEL/…).
- [ ] Voice/video via `MEDIA` (control) + WebRTC RTP leg or native CADENCEVOX/CADENCEVIS WASM
      codec; render roster/speaking/mute from `EVENT ... MEDIA ...`.
- [ ] Treat `:server NOTE EVENT <CAT> :…` and `EVENT … OBSERVE …` as the oper feed.
