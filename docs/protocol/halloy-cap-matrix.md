# Halloy CAP matrix vs Onyx Server (Era 2 B11)

*Generated 2026-07-25 from `onyx-server/src/daemon/dispatch.zig` `cap_specs` and
the Onyx client negotiation surface. Live QA: run Halloy against both public
nodes and tick the Acceptance column.*

## How to use

1. Point Halloy at `wss://` (or TLS IRC) for each node.
2. Complete SASL (PLAIN or SCRAM-SHA-256 preferred).
3. For each row: confirm CAP LS advertises, CAP REQ ACKs when requested, and the
   **Acceptance** behavior works without Onyx-only UI.
4. File failures against the daemon wire, not the web client.

## IRCv3 / draft caps (daemon)

| Cap | Daemon | Halloy expected | Acceptance (manual) | Status |
|-----|--------|-----------------|---------------------|--------|
| `server-time` | yes | yes | Messages carry `@time=` | wire-ready |
| `message-tags` | yes | yes | Client tags survive | wire-ready |
| `echo-message` | yes | yes | Own PRIVMSG echoed | wire-ready |
| `sasl` | yes (`PLAIN,EXTERNAL,SCRAM-SHA-256,SCRAM-SHA-512`) | yes | Login without NickServ | wire-ready |
| `multi-prefix` | yes | yes | `@%+` ranks in NAMES | wire-ready |
| `userhost-in-names` | yes | optional | host in NAMES | wire-ready |
| `away-notify` | yes | optional | AWAY lines for peers | wire-ready |
| `setname` | yes | optional | SETNAME updates | wire-ready |
| `extended-join` | yes | optional | JOIN carries account | wire-ready |
| `invite-notify` | yes | optional | INVITE notices | wire-ready |
| `account-tag` | yes | optional | `@account=` on messages | wire-ready |
| `chghost` | yes | optional | CHGHOST on vhost | wire-ready |
| `draft/no-implicit-names` / `no-implicit-names` | yes | optional | No auto NAMES on JOIN | wire-ready |
| `draft/chathistory` | yes | **yes for B7** | CHATHISTORY LATEST/AROUND/TARGETS | wire-ready |
| `draft/search` | yes | optional | SEARCH returns batch | wire-ready |
| `draft/message-redaction` | yes | optional | REDACT | wire-ready |
| `draft/message-editing` | yes | optional | EDIT | wire-ready |
| `draft/read-marker` | yes | optional | MARKREAD | wire-ready |
| `draft/event-playback` | yes | optional | playback events | wire-ready |
| `draft/typing` | yes | optional | typing TAGMSG | wire-ready |
| `draft/react` | yes | optional | react TAGMSG | wire-ready |
| `draft/reply` | yes | optional | reply TAGMSG | wire-ready |
| `batch` | yes | **yes** | chathistory / netsplit batches | wire-ready |
| `bot` | yes | optional | bot flag in WHOIS | wire-ready |
| `draft/channel-rename` | yes | optional | RENAME | wire-ready |
| `extended-monitor` | yes | optional | MONITOR extras | wire-ready |
| `account-notify` | yes | optional | ACCOUNT lines | wire-ready |
| `draft/account-registration` | yes (`custom-account-name`) | optional | REGISTER | wire-ready |
| `draft/metadata-2` | yes | optional | METADATA | wire-ready |
| `standard-replies` | yes | **yes** | FAIL/WARN | wire-ready |
| `cap-notify` | yes | optional | CAP NEW/DEL (static set) | wire-ready |
| `labeled-response` | yes | optional | `@label=` responses | wire-ready |
| `draft/pre-away` | yes | optional | AWAY before 001 | wire-ready |
| `draft/channel-context` | yes | optional | DM channel-context tag | wire-ready |
| `draft/multiline` | yes (`max-bytes=40000,max-lines=64`) | optional | multiline BATCH | wire-ready |
| `sts` | config-gated | optional | TLS policy only when configured | conditional |
| `account-extban` | yes (`a`) | optional | `$a` bans | wire-ready |
| `utf8-only` | yes | optional | invalid UTF-8 rejected | wire-ready |
| `draft/netsplit` / `draft/netjoin` | yes | optional | typed netsplit BATCH | wire-ready |

## Onyx-only caps (Halloy may ignore)

| Cap | Purpose | Halloy |
|-----|---------|--------|
| `onyx/session-sync` | Multi-device DM mirror | ignore OK |
| `onyx/bouncer` | Auto rewind on rejoin | ignore OK |
| `onyx/topics` | Named conversation filter | ignore OK |
| `onyx/e2ee` | E2EE control-plane tag | ignore OK |

## Minimal Halloy green path (Era 2 exit)

Must pass on both public nodes without the Onyx web UI:

1. CAP + SASL → 001  
2. JOIN `#room` → NAMES with ranks  
3. PRIVMSG with `server-time` / `message-tags`  
4. `CHATHISTORY LATEST #room * 50` (or client history UI) → BATCH of lines  
5. Optional: react/reply TAGMSG if Halloy exposes them  

## Source anchors

- Cap table: `onyx-server/src/daemon/dispatch.zig` (`cap_specs`)
- Client TARGETS discovery: `onyx/src/lib/store/store.ts` (`_requestHistoryTargetDiscovery`)
- Client push body fail-closed: `onyx/public/sw.js` (`pushBodyFor`)

## Live QA log

| Date | Node | Operator | Result | Notes |
|------|------|----------|--------|-------|
| _pending_ | node A | | | |
| _pending_ | node B | | | |
