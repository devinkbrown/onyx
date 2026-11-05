# Onyx Elm local server and browser lab

This harness is a disposable acceptance lane for Elm against a supplied Onyx
Server binary. It builds Elm with `tools/build-elm-site.mjs` into a private
`/tmp` run directory, writes per-node configuration with mode `0600`, and
starts only the pinned binary from private `0700` node directories. Listeners
bind to `127.0.0.1`. Elm is served over local HTTPS and connects to the daemon's
WSS listener using the explicit `?ws=` endpoint. The Playwright context's
self-signed certificate bypass is enabled only for this run and recorded in
the run environment. HTTP and WebSocket routes block requests to every other
origin.

Example:

```sh
PATH=/tmp/onyx-elm-tools:$PATH \
ELM_HOME=/tmp/onyx-elm-home \
node elm/tools/lab/run.mjs \
  --server-bin /home/kain/onyx-server/zig-out/bin/onyx-server \
  --server-source /home/kain/onyx-server \
  --server-build-receipt /tmp/onyx-server-build-receipt.json \
  --scratch-parent /tmp \
  --topology line3 \
  --suite foundation \
  --scenario logical \
  --receipt /tmp/onyx-elm-lab.json
```

Required selectors are `foundation|sessions|history|group`, `logical|exact`, and
`two|line3`. `exact` enables composite session credential issuance only in
its private node config. No UPGRADE signal or command is sent. The harness
copies and hashes the supplied executable before use, validates current config
with the server's `--check-config`, initializes only the private guest issuer,
and tears down only its tracked process groups. The JSON receipt is a redacted,
strict-schema summary; it contains hashes, loopback ports, fixed case IDs,
counts, outcomes, bounded diagnostic enums, and limitations, never credentials,
IRC message bodies, transcripts, raw logs, or config text. Optional delivery
diagnostics contain only bounded actor-role/node pairs, exact marker match
counts, and fixed wait outcomes; they omit target text, marker text, and raw
server descriptions.

`--plan-only` checks CLI and receipt isolation policy and is explicitly
recorded as a plan. It cannot establish browser or server behavior. Runtime
results report binary-to-source binding independently: a protocol pass from an
unverified binary remains blocked for current-source acceptance. To prove the
supplied binary was produced from the supplied source closure, pass an immutable
external build receipt with `--server-build-receipt`. Its strict v1 JSON binds
the exact source-manifest digest, copied binary digest, compiler digest and
version, bounded `zig build` command, and exit status `0`. The lab rehashes the
source closure and private binary copy, checks the receipt file remains stable
during reading, and verifies the compiler executable bytes when available. A
missing, malformed, changed, or mismatched receipt leaves `sourceBinding`
unverified; matching version strings alone never prove source. The public lab
receipt includes only a redacted command summary and hashes.

The foundation browser suite checks real local Elm WSS registration, CAP/005,
single-line WebSocket framing, an in-session private account IDENTIFY, and an
authenticated canary send. The runner creates one synthetic account through
the raw TLS actor and passes its generated credentials only in the private
Playwright child environment. Authentication frames are excluded from wire
capture; credentials, message transcripts, and payloads are never written to
the receipt or public logs. The authenticated canary is held at the browser
WebSocket boundary while the lab checks only the matching owner and target
metadata in the durable outbox, then the server echo is released and rendered.
The same suite also checks that the server closes a connection after a client
binary frame. A separate raw TLS actor checks PING/PONG, echo, and reconnect.
Session logical runs exercise four attachments plus a fifth restore on the
three-node line: origin and near attachments on A, a middle attachment on B,
and far/fifth attachments on C. The channel canary must match once on each of
the five recipients with one shared message identity/time before later checks
can proceed. The authored positive DM path uses a separate account registered
and SASL-authenticated on A, then completes source-backed token issuance to
establish reusable-session authority. It sends to the origin and checks one
DM with identical msgid/time on all five
attachments; then the origin sends a `+draft/reply` to that exact seed msgid
and checks the reply on all five attachments and the negotiated peer. These
are fixture assertions awaiting Wave36 execution. Guest forwarding to far
nodes remains unproven and is not a substitute for the authenticated path.
Exact runs separately exercise busy/detached credentials, local LIST/DROP
snapshot safety, roster, and physical pings. History runs exercise LATEST,
BEFORE, AROUND, AFTER, BETWEEN, TARGETS, overlap-safe message identities,
unknown-selector rejection, and history-policy denial. Equal-time pagination
gaps and cross-network endpoint-spoofing remain blocked when the isolated
daemon cannot produce a deterministic trigger; neither is fabricated. A
three-node logical `sessions` run uses a manually held B-C mesh edge and
creates a disposable SASL account bound to the `netadmin` class in B's private
config; the config defines that group with only the `mesh_admin` privilege.
Exact-composite runs retain the connected line and leave the logical
retryable-failure injection blocked because exact reclaim has distinct
source-backed invalid-token and redirect outcomes.
The generated password stays in runner memory, while the account database and
config remain inside the mode-0700 scratch tree. Before any mesh control, the
runner requires the actual 381 operator-success numeric. It then uses the
server's real secured CONNECT command and confirms the full mesh metrics before
using SQUIT to hold C offline. If that baseline is not established, the
dependent ordinary session journey is reported blocked with zero executed
assertions. The recovery case requests a
portable session credential on A, checks C's actual retryable
`ORIGIN_UNREACHABLE` response, restores B-C, and retries the same credential
once. This case records only fixed scenario IDs and redacted diagnostics; it
does not turn a missing response into a pass. The session/history browser specs
separately establish Elm's real local WSS connection and are reported as
browser bootstrap cases, not raw protocol evidence.

Candidate 35's line3 logical receipt records a separate 15/15 raw TLS
mesh-fault scenario: authenticated operator gate, secured link establishment,
SQUIT partition, the source `ORIGIN_UNREACHABLE` response, reconnect, and retry
of the same logical credential. This scoped scenario passed while the larger
line3 logical session case later failed at its DM canary (ordinary session case
0/1; browser bootstrap 1/1). That earlier fixture used a guest sender, whose
far-node authority was unproven; the receipt did not identify a source refusal.
The authored authenticated-peer and reply checks above have not been run.
Candidate 35's exact detached restore case also failed 0/1 after an observed
`TEMPORARILY_UNAVAILABLE` warning; its cause remains unresolved (browser
bootstrap 1/1). These observations do not establish a complete session suite
or broader acceptance. The strict receipt schema bounds optional delivery rows
to five or six fixed role/node entries, a finite match count, and wait enums.
It accepts only source-backed PRIVMSG failure/warning/refusal families and
finite source-code/reason enums such as `session_message_refused` and
`session_reply_path_missing`; raw descriptions remain excluded.

## Group E2EE suite

`--suite group` requires `--topology two --scenario logical`. The runner
registers two synthetic accounts on node A and passes their credentials only in
the private Playwright child environment. `tests/e2e/elm-local-group.spec.ts`
drives two isolated browser contexts (founder and member), both attached to
node A, through serial stages:

1. `group-signin`: connection-dialog IDENTIFY for both accounts, then an
   explicit tab intent (Local services, "Start a fresh attachment") and the
   "Create a new attachment" session issuance. Server `E2EEGROUP` admission
   requires a reusable session.
2. `group-room-policy`: founder `/create #elm-group-lab` (an IRCX `CREATE`
   with the `0`+8hex OID reply) and `/prop … encryption-policy :required`.
3. `group-enroll`: founder "Enroll this device for room encryption"
   (`E2EEKEY ADD` plus authenticated readback).
4. `group-genesis`: while the founder is alone, it refreshes the directory,
   plans and confirms the fresh-room genesis (answering the private backup
   password prompt with a per-run random value), and the verified head must
   reach epoch 1.
5. `group-author-ciphertext`: the founder's room `PRIVMSG` and its echo must not
   contain the plaintext, and the author's view must render it.
6. `group-member-bootstrap`: the member joins and enrolls. The founder reviews
   the member device's signer fingerprint ("Review device fingerprint", then
   "Trust this device"; there is no automatic trust) and rotates the room key.
   The member reviews and approves the checkpoint, and both heads advance.
7. `group-encrypted-delivery`: a founder message is ciphertext on the wire and
   is rendered decrypted for the member. A member message is ciphertext on
   the wire and is rendered decrypted for the founder.
8. `group-device-removal`: the founder removes the member device, and the
   verified head must advance by one epoch. A later founder message reaches
   the removed device only as ciphertext and is not rendered for it.

Every failure throws a fixed `group_stage:<code>`. The receipt records it as
`group_<code>`, and stages after a failure are `blocked` with
`browser_stage_not_run`. The group receipt has its own strict schema
(`validateGroupReceipt` in `config.mjs`), so the shared schema still refuses
the group suite. Like the shared schema, it allows only hashes, loopback ports,
fixed IDs, counts and enums. Authentication, `E2EEKEY`, `E2EEGROUP`, `E2EE.*`
relay and session-token frames are counted and never retained. Setting
`ONYX_ELM_LAB_GROUP_DEBUG_DIR=/tmp/...` writes local diagnostics there: command
verbs, private-frame counts, and Local services status and item labels. No
bodies or key material are written. `ONYX_ELM_LAB_GROUP_SCREENSHOTS=1` adds page
screenshots to that directory. Diagnostics are never part of the receipt.

Run focused checks from the repository root:

```sh
node --test elm/tools/lab/*.test.mjs
pnpm exec tsc -p elm/tools/lab/tsconfig.json
pnpm exec playwright test --config=tests/e2e/elm-local.config.ts --list
```
