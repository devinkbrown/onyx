# Onyx Solid continuous-wave checkpoint — 2026-08-13

## Repository state

- Branch: `onyx-solid` at baseline `4c31f31`.
- The worktree contains intentional concurrent desktop, OnyxOS, E2EE, contract, and UI work.
- This wave is uncommitted and undeployed. Preserve unrelated dirty files, especially the existing OnyxOS and desktop-host lanes.

## Accepted encrypted-group client work

- Executable contract v2 mirror and checker:
  - `docs/protocol/onyx-client-contract.v2.json`
  - `tools/check-server-contract-v2.mjs`
  - `tools/check-server-contract-v2.test.mjs`
- Authenticated device directory and signer resolution.
- OGCMT2 commit and OGWLC2 welcome codecs.
- `GroupSession` state machine and atomic verified-pair application.
- `groupControlSessionAdapter` with fail-closed trust/directory handling, canonical pair keys, both reorder orders, bounded pending/active work, per-session serialization, retry-safe transient outcomes, in-flight duplicate classification, abort-safe destruction, and deterministic zeroization.

Terra final adversarial verdict: PASS for the production `GroupSession` path.

Current evidence:

- All `src/lib/e2ee` tests: 21 files, 193 tests pass.
- Adapter/welcome/session focused tests: 36/36 pass.
- Post-replay session/adapter gate: 29/29 pass.
- Full typecheck: pass.
- Full lint: pass.
- Contract checker: 97/97 tests pass; canonical validation passes.

## Accepted UI and website work

Wave 1 additive system under `src/ui/**`:

- Room Current semantic tokens and enforceable token contract.
- Deterministic `SystemSpecimen` lab.
- Layout primitives.
- Public frame/navigation/footer/skip-link system.
- Reactive accessible icon system.
- Truthful Proof Rail and receipt states.

Wave 2 visible strangler at `/`:

- `src/routes/Landing.tsx` now uses `PublicFrame` as the sole document frame.
- Home opts into the semantic UI layer without touching secondary public routes.
- Exactly one primary `Open Onyx` action is retained.
- Network state is rendered conservatively through Proof Rail.
- Product aperture remains explicitly labelled Preview/not-live.
- Dirty OnyxOS work remains out of scope.

Current evidence:

- UI foundation: 6 files, 145 tests pass.
- Landing/PublicFrame/ProofRail: 18/18 tests pass.
- Full typecheck and full lint pass.
- Production `pnpm build` passes (457 modules transformed).
- No browser screenshot, connected-server, deployed-byte, commit, push, or deployment proof exists for this wave.

### Conversation Spine shell rearchitecture

The production shell now uses one shared `PrimaryNavigation` contract on
desktop and mobile, with current-page state kept orthogonal to Rooms/Messages
collection selection and drawer expansion. Conversation rows expose
`aria-current="location"`; You remains a transient dialog rather than a page;
collection headings and counts are dynamic and grammatically correct.

The visual system is an Onyx-specific vertical Conversation Spine with a
restrained seam/node hierarchy, stable semantic tokens, a sans collection
heading, and no generic glyph boxes or per-item `nth-child` accents. Forced
colors, reduced motion, high zoom, short landscape, safe areas, focus return,
and inert drawer behavior are covered. A Chromium test enables actual
forced-colors emulation and checks computed active/inactive text, background,
and icon contrast.

Fable final architecture verdict: PASS. Accepted scope is the seven shell files
under `src/shell/` plus `tests/e2e/primary-nav-forced-colors.spec.ts`, with
manifest SHA-256
`795d33078e5a1e853ace057e53d287fd8bd3056125f4592ee12e3853b254cecb`.

Evidence: focused 109/109; full shell 88 files and 1,121 tests; typecheck;
scoped ESLint; forced-colors Playwright; three responsive Playwright specs;
and `git diff --check` all pass. This is source/runtime-shell acceptance, not a
connected-server or deployed-byte claim.

### Current UI integration acceptance pins

The current shared-tree UI packets were rechecked together after the shell
wave. These pins distinguish executable contracts from production mounting;
they do not convert an unmounted component into runtime evidence.

**C0 information architecture.** The reusable `PrimaryNavigation` is mounted
on both desktop (`ChannelSidebar`) and mobile (`AppShell`) and remains
navigation-only. The pure `shellNavigationModel` contract and its tests are
accepted as a separately executable IA specification, but that model module is
not currently imported by production code; do not describe it as the mounted
runtime source of truth.

- `src/shell/navigation/shellNavigationModel.ts`: `3a20d94083b2c01dff4b1a8e2c22ecf787c83789031512b204131bd92141c09e`
- `src/shell/navigation/shellNavigationModel.test.ts`: `0ea82f4bcefdf6da8e916ed0b938393831f7fb0a764568e92b7bee47cff94318`
- `src/shell/PrimaryNavigation.tsx`: `47d3292b13924ae88c340b2ae1ea53b2a3adf8f13a7d8996aee42b1f7c5716af`
- `src/shell/PrimaryNavigation.test.tsx`: `d30af46b4bb91482d9dcce0b3f4619229f20c56883a5f6fe570ca1f773df0026`

Fresh focused gate: 2 files and 10/10 tests pass.

**T1 session-truth projection.** The pure projection keeps transport,
identity, continuity, group control, group message protection, DM protection,
call establishment, and call media distinct. The passive `SessionTruthBar`
renders that projection without owning a store or mutating session state.
Neither the bar nor the projection is mounted in production yet, so this is
contract/component acceptance only.

- `src/shell/session/sessionTruth.ts`: `80969d9a894cdd8966ea0a6756207d326191cf4dae3762d804d14bf854991ae7`
- `src/shell/session/sessionTruth.test.ts`: `ca2c3537b3b6c2dae3af13834a60f778ee0cf5b37b6a5fc3efb0ec77f93f2ac1`
- `src/shell/session/SessionTruthBar.tsx`: `78eead8d380d2e6b6b612278ae44c6572d930378233281f9f1f78490d004e4da`
- `src/shell/session/SessionTruthBar.test.tsx`: `f3bcd047341f8e665d39cc4ed3c95102fc375ff9557f433b5e461d4137bf93b2`
- `src/shell/session/session-truth-bar.css`: `6b982638df022bbfdeb80124411c7bf55beeb81ca230e078a9737f692e2565a6`

Fresh focused gate: 2 files and 19/19 tests pass.

**Canonical CallsHub integration.** `AppShell` mounts `CallsHub` with the real
voice-store call state, room/peer target, and establishment timestamp.
`PresenceRibbon` consumes the same pure presentation classifier. The hub only
navigates to a room or established call; it does not join, accept, decline, or
start calls and it does not equate provisional `in_call` with established
media.

- `src/shell/CallsHub.tsx`: `2461291ffea746546d9ad06ce66d33cf8590f1f040d70dcb48e9287d06b2c294`
- `src/shell/CallsHub.test.tsx`: `60de0f6efa037ebd9397e8c25e9c3dcbd6fdcf24a6bd712dd98e1354545a65f1`
- `src/shell/AppShell.tsx`: `361c021d76a486721a7967fd397e195a2a9c5ced3ed4a69f358af81ec365cc49`
- `src/shell/AppShell.calls-hub.test.tsx`: `a045b6e2b2a9b80b257eb21e783a839eb6449939e2d22225cf48b0a4b00d33e5`
- `src/shell/PresenceRibbon.tsx`: `445bcd5719174060e263dae9a2ad2c21384e3fb9f1c52346129f1944782b0010`

Fresh focused gate: 2 files and 13/13 tests pass.

**PublicFrame 400% zoom closure.** Landing was the first migrated public
route. The semantic frame, skip target, mobile disclosure/focus behavior, and
Landing composition pass their focused unit gate. A Chromium run at 400% zoom
passes on an isolated preview port without horizontal document overflow. The
later Status and About migrations are pinned separately below; no claim is
made here that Stats, Roadmap, Download, Invite, or another secondary route has
migrated.

- `src/ui/public/PublicFrame.tsx`: `42052ef071a036d5aef8ac8c95bfc24eda9242ecad64c9676f131269b394cf2c`
- `src/ui/public/PublicFrame.test.tsx`: `fdcad5e83a3792ab322575dcb7533c4852f6bb18331a0d5be7d71d9c990258d0`
- `src/ui/public/public-frame.css`: `8af47e71e44d9cc6549d0706fd916ef3fb1407d3883aa11d048a2a599b799047`
- `src/routes/Landing.tsx`: `2c4446c9efd27aed761c5749d6e7e8cde5ed8b5cc76d44eae4c768c038474251`
- `src/routes/Landing.test.tsx`: `0ee827a5edd3fdb1402c84a8f447619b8cff9c0f331087a0acb9f5082279476a`
- `tests/e2e/landing-route-high-zoom-reflow.spec.ts`: `dd103ab969d69f340be77ebc952ecbd763ad3fdc191dd7ee08f383ca3b8495cc`

Fresh focused gate: 2 files and 10/10 tests pass; Chromium high-zoom gate
1/1 passes at `ONYX_PLAYWRIGHT_PORT=4199`; scoped ESLint and the full
TypeScript no-emit check pass.

**Status PublicFrame migration.** `/status/` now uses `PublicFrame` as its
only document frame while preserving the bounded public-feed seam. Pending,
unavailable, stale, degraded, and complete/current observations remain
distinct; only a current complete topology is labelled operational. The
canonical skip target, one primary Open Onyx handoff, mobile disclosure focus
return, forced-colors readability, 320 px viewport, and 400% text zoom are
covered.

- `src/routes/Status.tsx`: `50002e654ce7c6026b59db2de133a3f76c35eb22da132740a4b39518b486586d`
- `src/routes/Status.test.tsx`: `7db049f44722eaf445e4675d70665164ee543c307c5b2bfa842cba986c938804`
- `src/routes/status.css`: `7cd4fffe9747e1c970da419f0ee88ebd4c2b3e3969b8d774813ef663a12e5d0d`
- `tests/e2e/status-route-high-zoom-reflow.spec.ts`: `6ede4ed12e918443463f82ce724417566fa461e50f31054fda910449663ad2fa`

Accepted focused evidence: Status unit 5/5 and production-preview Chromium
high-zoom/forced-colors 1/1 pass. Fresh checkpoint reconfirmation repeats the
5/5 unit gate. This is source and local production-browser acceptance only,
not a connected-server status-feed, deployed-byte, commit, push, or deployment
claim.

**About PublicFrame migration.** `/about/` now uses `PublicFrame` as its only
document frame while retaining its local topic navigation and bounded public
mesh badge. The badge does not turn pending or unavailable observations into a
network-availability claim. The canonical skip target, mobile disclosure focus
return, forced colors, 320 px viewport, and 400% text zoom are covered without
duplicating header, main, or footer landmarks.

- `src/routes/About.tsx`: `aaded492319e839b1ea298d99e8fd8676c5e5ba87b5ed93435c6fb17b752528e`
- `src/routes/About.test.tsx`: `68d070987796a6291e28e48165196f2fe7680b32273672d99d8a96d237bffa61`
- `src/routes/about.css`: `c4c5aabb7ac22df6b35f27066abab0b5699931f519e64a1e7f5c5c55af50cb17`
- `tests/e2e/about-route-high-zoom-reflow.spec.ts`: `8df02329fa2e6539842edeb5e2a6d96227209562e52441a5a6faf637c926dfbc`

Accepted focused evidence: About unit 85/85 and production-preview Chromium
high-zoom/forced-colors 1/1 pass. Fresh checkpoint reconfirmation repeats the
85/85 unit gate. This is source and local production-browser acceptance only;
the bounded public feed may still be unavailable and no deployed-byte, commit,
push, or deployment claim is made.

**Roadmap PublicFrame migration.** `/roadmap/` now uses `PublicFrame` as its
only document frame. The existing priority sequence remains intact, while its
state legend distinguishes current focus, next work, and evidence-gated work.
The route adds one explicit release rule: roadmap priority does not establish
deployment. Canonical navigation, one primary Open Onyx handoff, first-tab
skip focus, mobile disclosure focus return, forced colors, reduced motion,
44 px interactive targets, a 320 px viewport, and 400% text zoom are covered.

- `src/routes/Roadmap.tsx`: `09a818b199aa8c99fa5264da1bc9b6be396c47987e8743d64536309b402e4bd1`
- `src/routes/Roadmap.test.tsx`: `77197545af04ba9a8d10c2bef1eee75deeca98096e96bd79ea90847e61f81515`
- `src/routes/roadmap.css`: `47964b0b783774553492ef6e684dc21a3d280f14496885d4bc916268f5c4961a`
- `tests/e2e/roadmap-route-high-zoom-reflow.spec.ts`: `4c916ac3945b7b402584425a9362150b741a316ee1f021cdc89face10c671b16`

Evidence: focused Roadmap unit 3/3; scoped ESLint; full TypeScript no-emit;
production build with 478 modules; Roadmap Chromium high-zoom/forced-colors
1/1; combined accepted About/Roadmap/Status browser reflow 3/3; scoped diff
check; and post-build UI budget enforcement all pass. The post-build budget
digest is `c9097def2b8067d0869db35c748eabefea1c9c6d9abc9a37a843811dc0e21140`.
This is source and local production-browser acceptance only, not deployed-byte,
connected-server, commit, push, or deployment proof.

**J1 UI performance ratchet.** The post-build ratchet counts the complete
entry-static JS/CSS closure through either Vite's chunk manifest or the emitted
HTML module script, stylesheets, and every module preload. Arbitrary vendor
names and CSS attached to static imports cannot evade the aggregate roles;
named runtime, AppShell, and optional-media roles remain diagnostic overlaps.
Artifact counts, raw bytes, Node gzip level 9 bytes, content hashes, and a
path-stable digest are enforced. Optional media entering the eager graph fails
closed.

- `tools/check-ui-budgets.mjs`: `6ea8908396ed8bc7dcd3c20c51722388ac995fd95599a37763fde551fdb6c171`
- `tools/check-ui-budgets.test.mjs`: `2ed60eded9024eb21fabf708e78bca6db78a46f750179abf67ab721e17022f1e`
- `docs/ui-performance-baseline.json`: `24d0fd6ef4ffa94ae4734850bda931a02fd4cc6b93842a9c8e1fb2b911868f8f`
- `docs/architecture/ui-performance-budget.md`: `54d92c9f40ec56f50926106ddbfe93dfa6670e6d6280c2e34093852a3185285e`

Independent acceptance: 7/7 fixtures pass; current HTML and independently
manifest-enabled fresh production builds classified the same four eager JS
files and one eager CSS file and produced digest
`b831896a2d36c1fb261aa8e114004bbc12182651cec6c46731dd43d68930e860`.
All ceilings are exactly `Math.ceil(baseline * 1.05)`. A deliberately eager
media manifest failed with the explicit optional-media diagnostic. No package
script, deployment, commit, or push is part of this acceptance.

**Grok 4.6 J0 accessibility foundation.** The accepted additive J0 packet
provides a reactive route-announcement primitive, an ordered native-hash
`SkipLinkSet`, and a typed public-route information-architecture manifest. The
manifest is descriptive metadata and is checked against current router and
shared-public-navigation declarations. `RouteAnnouncer`, `SkipLinkSet`, and
`PUBLIC_ROUTE_MANIFEST` are not imported by production code yet; this remains
an executable contract/component foundation, not mounted runtime behavior.

- `src/ui/a11y/RouteAnnouncer.tsx`: `65439686411088ab304a03e11c5527b65e5ab9e9f52e37dce39125490f02db`
- `src/ui/a11y/RouteAnnouncer.test.tsx`: `e6fb5123cb640368ff3d07c5c948a0209ff40132d527627108d3adba33a818fa`
- `src/ui/a11y/SkipLinkSet.tsx`: `a471dd63c698ab6b994c489b84f4586de10ce3c41614ddbc72428c2d8025732c`
- `src/ui/a11y/SkipLinkSet.test.tsx`: `c6cc9112718e7d500f0f77fd00f786d1125675c51082844b68349414bdec5943`
- `src/ui/a11y/index.ts`: `a35c1da8a8cf9a1cbc5f74ed0fe723d1e1d5d298a622033dc90e462b082121cb`
- `src/ui/navigation/publicRouteManifest.ts`: `656dd3c23d83667974e40a8aa417dfcebb5be67428196f1b98cb2dd553522c9a`
- `src/ui/navigation/publicRouteManifest.test.ts`: `30c1567b5b86c6b6a6bb1bdb122ad269c6b293cf2e9ca012824047d0bad42a3f`

Accepted focused evidence and fresh checkpoint reconfirmation: 3 files and
33/33 tests pass. The packet does not install a focus manager, mutate router or
store state, mount an announcer or expanded skip set, alter public routing, or
authorize deployment.

**Paired connected/server evidence.** The UI security path remains anchored to
the accepted D2 artifact
`.work/d2-connected/2189014-1786613122639/summary.json` (browser 1/1,
artifact secret scan pass, blocker null) and to the separately accepted Onyx
Server OCG2 Step 5 hashes and 8,111-pass/4-skip/0-fail final module gate below.
That pairing proves the bounded local D2 path and configured-local session
provenance foundation only. It does not prove OCG2 activation, a mounted
`SessionTruthBar`, multi-node signed-mesh behavior, deployed bytes, commit, or
push.

## Model-routing truth

- Sol was the main architect and final arbiter.
- Fable supplied supporting UI architecture.
- Opus and Terra were used for senior bounded UI work.
- Luna and Haiku supplied bounded implementation/review work.
- An earlier direct Grok 4.6 route was rejected and an alternate route that
  silently ran Sonnet 5 remains credited to Sonnet. A later verified Grok 4.6
  run produced the separately pinned J0 accessibility foundation above; that
  later packet does not retroactively change the provenance of earlier work.

## Next massive client/UI wave

1. Wire `groupControlSessionAdapter` into the real inbound control dispatch and lifecycle; the current accepted adapter is not yet proof of runtime activation.
2. Make session ownership explicit per room/account/device and destroy adapters on disconnect, identity switch, vault reset, and route teardown.
3. Surface honest locked/pending/applied group-control states without exposing key material or claiming E2EE activation prematurely.
4. Add connected-browser acceptance for commit-before-welcome, welcome-before-commit, reconnect retry, duplicate/equivocation, destroyed-session late completion, and multi-device recipient selection.
5. Integrate the accepted device-directory/group-control runtime into the real
   store and shell with truthful locked/pending/applied states, preserving the
   accepted Conversation Spine semantics.
6. Visually inspect `/` and the authenticated shell at 320 px, tablet, and
   desktop sizes; correct token integration while preserving each surface's
   established visual language.
7. Keep all secondary public routes and dirty OnyxOS files untouched until the
   `/` strangler and authenticated-shell integration pass browser and
   accessibility review.

### Next conflict-free UI slice readiness

The previously proposed `/status/` slice is now implemented and accepted at
the bounded source/local-browser level recorded above. `/about/` and
`/roadmap/` are likewise migrated. `/download/` is the next high-value legacy
public-frame candidate, but it has a materially larger contract surface:
catalog availability, checksum sidecars, clipboard state, per-platform
artifacts, and the `/install/` compatibility alias must all be preserved. Its
next owner should own only Download route files/tests, an optional production
browser test, and the checkpoint. Shared `PublicFrame`, Landing, Status, About,
Roadmap, navigation, AppShell, and ChannelSidebar remain outside that
ownership.

Do not start the T1 mount or consolidate the duplicate navigation model in
this slice: both would touch currently dirty shared shell files and require a
separate integration owner.

No deployment is authorized. The next runtime-wiring packet requires Sol architecture first, then a bounded writer, Terra/Sonnet adversarial review, full E2EE gates, typecheck/lint/build, and connected-browser proof.

### Group-control integration substrate accepted

Four new files now provide an isolated production-integration owner without
editing the live store, IRC client, shell, trust store, or raw logger:

- `src/lib/e2ee/groupControlIntegration.ts`
- `src/lib/e2ee/groupControlIntegration.test.ts`
- `src/lib/e2ee/groupControlSelectors.ts`
- `src/lib/e2ee/groupControlSelectors.test.ts`

The owner attaches one existing extra-message handler, binds runtime ownership
to the exact client/endpoint/account/device tuple, generation-guards directory
and control work, accepts directory rows only from a pure server NOTICE path,
and tears down or rebuilds on reconnect, replacement, disconnect, verified
vault reset, local PART/KICK, and destroy. It projects only safe lifecycle,
room-status, and bounded counter state. Missing durable signer authority fails
closed. It never creates a `GroupSession`, persists keys, or activates group
message encryption; `activation` remains `hold`.

The first Fable review found and closed generation-drift and shared-waiter
double-advance races. A subsequent bounded-metadata hardening pass prunes the
final shared-timeout marker only after every sibling continuation consumes it.
A non-enumerable, immutable size-only probe exists solely in Vitest mode and is
absent from the production bundle. A 96-cycle stress regression proves both
internal metadata maps return to zero without losing generation alignment.

Sol final architecture verdict: PASS. Current evidence: focused integration
12/12; broader E2EE 27 files and 254 tests; independent final review 47/47;
typecheck; full lint; production in-memory build/probe exclusion; and diff
checks pass. Combined four-file manifest SHA-256:
`bee67c4ffed2b879c0acb7cbda235ff902af1c0d7407da20b6704b7c8360db28`.

This remains an accepted isolation substrate, not live store/shell wiring and
not group-message encryption activation. The next packet must supply a durable
trusted-signer adapter and explicit raw-log redaction policy before activation
can move beyond `hold`.

### Client Packet D0 security prerequisite awaiting Sol acceptance

Live store/shell wiring was architecture-gated behind a mandatory D0 security
substrate. The implementation stays within four files:

- `src/lib/e2ee/trustedGroupSignerStore.ts`
- `src/lib/e2ee/trustedGroupSignerStore.test.ts`
- `src/lib/irc/client.ts`
- `src/lib/irc/client.groupControlRawLog.test.ts`

The new fail-closed IndexedDB adapter scopes signer pins by the SHA-256 digest
of the exact trimmed `ws:`/`wss:` endpoint plus canonical local/remote account
and remote device. It retains path/query distinctions without persisting the
endpoint, bounds the store at 1,024 rows with no eviction/fallback, linearizes
conflicting TOFU writes, validates every row, and writes durable tombstones
that cannot silently reopen first use. The IRC raw-log copy now redacts direct,
tagged, prefixed, mixed-case, NOTICE-wrapped, and FAIL/WARN/NOTE E2EE control
and directory forms before `onRaw` and parse/handler diagnostics while leaving
the original WebSocket/parser bytes unchanged. Existing safe SASL visibility
is retained and exchange chunks remain redacted.

Sol's first adversarial review correctly blocked exception-message diagnostic
leakage, malformed/multi-line bypasses, and incomplete IndexedDB schema and
failure cleanup. Those gaps are now closed: diagnostics omit exception
objects/messages; a conservative whole-line fallback catches malformed forms;
all WebSocket protocols reject embedded CR/LF; the database requires exact
`keyPath: "key"` with no auto-increment; blocked late success closes its handle;
failed read transactions are consumed; and missing WebCrypto, wrong schema,
blocked-open release, and write-abort cases are covered.

Current corrected writer evidence: focused 4 files/84 tests; E2EE 28 files/262
tests; full 482 files/6,124 tests; typecheck; clean lint; production build with
458 modules; and diff checks all pass. Current SHA-256 values:

- signer store: `a9bde72e67285c2d1cb00789892f54dfe5fdde4a874e5462de0c705c28702087`
- signer tests: `0edf10a6a20800ff3e68595cad791ee60596efaf3032bd43c25791f76668280b`
- IRC client: `93efe214a5e5c6379e6ca1d8e1e8230655e3d37897e932f1ec7f80f815c851cc`
- raw-log tests: `b531d7a0ae2c3b35685421c60eefa6fb194e83f4093da752cc733e19e21d567f`

Sol final D0 review is active. Do not begin D1 or claim live activation until
that verdict is PASS. The UI-design review separately froze a passive,
channel-only PresenceRibbon indicator whose invariant truth is "Message
protection: not active"; it does not authorize implementation before D0.

The second Sol review found one parser-differential bypass: IRC parsing strips
NUL bytes, but log classification did not. The corrected classifier now strips
NULs in its private log copy before inspection while retaining original wire
and parser bytes. Inbound/outbound regressions split NULs at token beginnings
and interiors across AUTHENTICATE, direct E2EE controls, wrapped E2EEKEY NOTICE,
and FAIL/WARN/NOTE subjects. Focused evidence is now 4 files/86 tests. Current
changed hashes superseding the client/raw-test values above:

- IRC client: `6d33560c30414b4056691079a63bcbbb17819fedd79fd0d3e3a0cf684047abb7`
- raw-log tests: `63405b258302747a5dfec65aa0df209613e10c25061b9cbf35412ea4a880f122`

Sol final D0 verdict: PASS on those pinned hashes. D1 live store bridge and
passive channel UI may now proceed, but activation remains on HOLD: no
`GroupSession`, provisioning, E2EEGROUP send, composer/message-crypto change,
or encryption-readiness predicate is authorized.

### D1 bridge/store accepted implementation, UI mount pending

The live store bridge now owns exactly one integration per IRC client outside
Zustand and publishes only `GroupControlRuntimeState | null`. An owner token
invalidates stale async work; bridge creation precedes `client.connect()`;
destruction clears the public snapshot synchronously before integration and
client cleanup. Authenticated 001/900/self-ACCOUNT/901/logout, disconnect/
reconnect/replacement, and live self PART/KICK paths are wired. The signer
adapter is scoped by exact endpoint and canonical local account with device ID
omitted for accepted projection. Server-prefix dispatch is explicit and frozen.
No session, control-send, message crypto, activation flag, or UI behavior was
added in this slice.

Evidence: focused bridge/store 12/12; focused E2EE/store 76/76; E2EE 262/262;
full 6,142/6,142; typecheck; lint; production build with 472 modules; and diff
checks pass. Connected authenticated-server/browser proof remains physically
unverified. Current SHA-256:

- `src/lib/store/groupControlBridge.ts`: `1aa38f19345aeadad59421df7bfe9887f7bcea8ecbecf2733de3181d8cc9b68b`
- bridge tests: `494dd3669e5626331e83a065d606258d9a7d319c60dfc0f846e4fd0fd8408529`
- `src/lib/store/store.ts`: `89c546d677eb2e714ad807fba7b31391746e43a322b1f462f5ae94e2267d1457`
- store tests: `530dc26d03bb7caadb67f678d04b7fe034a2f9e7971f3bd8f89db55ad8bad6b1`

The prop-driven passive indicator is now mounted in the authenticated active
channel's PresenceRibbon Place group. It reads only the safe snapshot and
authenticated-account truth, requires a matching room-local projection, and
hides for Home, DM, status, guests, and missing projections. It is passive and
non-focusable; every state retains the invariant "Message protection: not
active", including `control-applied`.

Sol integrated D1 verdict: PASS at source/test/typecheck/lint/build level.
Accepted UI SHA-256 values:

- indicator: `b715d463f1d412f1d9a94ce1800222b2fd4487bff883d5f56d0e4feb01e5530b`
- indicator CSS: `8602ac4ae5e75051e6a814b81105f5a0918a92d4402291f9e423eb112d8fc144`
- indicator tests: `df52bcc47c7e6b12195b32a92851d53b44b202e679b4282f054c559ea6b1f08f`
- PresenceRibbon: `445bcd5719174060e263dae9a2ad2c21384e3fb9f1c52346129f1944782b0010`
- ribbon tests: `efdc8ccb5112f9b4b73af31e081b22b58918cf745444c23fa8005e2d67e6d125`

Evidence: integrated focused 20/20 in Sol review and 18/18 in a fresh root
run; bridge/store full 6,142; E2EE 262; UI 6; ribbon 20; typecheck; lint;
production build; and diff checks pass. No session provisioning, control send,
message crypto, readiness predicate, deployment, or activation was introduced.
Connected authenticated-server/browser proof remains physically unverified.

### D2 connected proof architecture and prerequisite bug

Sol froze a disposable, loopback-only local Onyx Server plus production-client
Playwright packet under `.work/d2-connected/<run-id>/`, with real initial SASL,
exact server-prefix E2EEKEY directory replies, real control delivery, reconnect,
logout, fresh-account login, live PART/KICK, artifact secrecy, 320 px, 200%
text scaling, forced colors, and keyboard checks. It forbids `window.__onyx`,
test-only state injection, bundled credentials, production accounts, deployed
site claims, and raw payload evidence.

Architecture inspection found a production bug before that run:
`setIdentity({account})` bypasses `resolveIdentity`, so the trusted initial 900
path can remain permanently `identity-pending` when device ID is intentionally
omitted. The bounded generation-safe fix is accepted: omitted IDs use the
existing projection path; transitions immediately install an account-scoped
null-device fail-closed runtime; explicit null and explicit device semantics
remain distinct; and switch/logout/reconnect/vault-reset/destroy/late async
work cannot publish stale ownership. Focused 19/19, E2EE 28 files/271,
typecheck, lint, production build with 475 modules, and diff checks pass.
Accepted SHA-256:

- integration: `d580372d5e87601f023430877773771ef58d39cf999c68ebae7756d547fe34f9`
- integration tests: `272ad204604e902bc4de5c67fcb42378f6b171af6be3f494b7260db9bbe12c86`

D2 must still report, not conceal, these later boundaries:
mid-session IDENTIFY lacks self-900;
`control-applied` is unreachable without a provisioned `GroupSession`; and a
single-node browser run cannot physically prove signed mesh duplicate/
equivocation. Activation remains HOLD.

Canonical ODD1 publication is now accepted after two independent-review
correction rounds. The bridge-owned publisher projects the existing durable
Ed25519 signer and P-256 encryption identity, derives the canonical device ID,
and sends exactly one `E2EEKEY ADD ... onyx-ogc1-v1 ...` per owner/connection
generation with one bounded retry. Only the exact frozen 001 server prefix may
produce `server-ack-observed`; ADDED is never treated as account/generation
confirmation. Lifecycle invalidation covers account, logout, reconnect, reset,
replacement, and destroy. No DEL, new third keypair, directory bytes in public
state/logs, session provisioning, or activation was added.

Persisted P-256 pairs are validated as hostile data: genuine CryptoKeys,
private/public types, nonextractable private, ECDH/P-256, exact public empty
usages, exact new `{deriveBits}` or legacy `{deriveKey,deriveBits}` private
usages, valid public point, and symmetric witness-ECDH pair correspondence.
Corrupt rows fail closed without replacement; new rows are persisted, reread,
and revalidated. Legacy identity reuse is covered.

Accepted SHA-256:

- publisher: `3c7f9fec2bb4379088ea7953a1980b2afe5e99b18a5d4a4396fffba644698332`
- publisher tests: `47ab00d5a440e19e40ac4d00ea71c08043ce50bbf38ce9d26889aec15ce3e309`
- bridge: `3aada60632ba74df33c20a6e27942333bd9dc0f1ef0e277c3c80f527898f156c`
- bridge tests: `37b9762b6e8e85b6e46dc59e59889baf76ba8d7c47b7e608bf29772d93dc3853`
- DM identity: `62a8e1283dbd84d5bde1bdd3af658ec4ff9b5b67739365a62af69a0ce455e6ea`
- security tests: `dfebcc9a1d81e50ab155724e5aa18c91593f58a15bd18777d741eda3ba5d71a7`

Evidence: writer focused 43, E2EE 29 files/284, typecheck, lint, build 476,
and diff checks pass; independent final focused review 53/53 PASS.

D2 harness has now produced real partial connected evidence at
`.work/d2-connected/2097192-1786608363424/summary.json`: a disposable loopback
server started from generated config; two disposable accounts were created
using the exact `REGISTER SUCCESS` protocol; the production client built and
previewed against the dynamic WebSocket port; Playwright used runtime-only
credentials through the visible Sign in UI; the authenticated shell rendered
with `__onyx` absent; the browser joined a unique room through the visible Join
flow; spawned processes were PID-group cleaned; and the artifact secret scan
passed. Trace, video, and credential-entry screenshots are disabled.

This is not yet complete control-delivery evidence. A persistent raw actor must
negotiate IRCX and `onyx/e2ee`, retain a reusable session, publish a valid
derived ODD1 identity, and author an authenticated signed control payload.
Until that protocol-complete actor exists, directory/control transitions,
KICK teardown, and real applied state remain unproven. No such claim is made.

### D2 final connected acceptance and server prerequisite closure

The protocol-complete actor and production-client run is now green at
`.work/d2-connected/2189014-1786613122639`. `summary.json` records the
disposable Onyx Server as started, browser acceptance as passed, the artifact
secret scan as passed, and no blocker. Playwright passed 1/1. The raw actor
completed through KICK, directory/control payloads are represented only by
length and SHA-256 evidence, private keys remained memory-only, and no
activation or session-applied claim was made. Spawned server/browser support
processes were cleaned up.

Two server defects discovered by this acceptance are closed and independently
reviewed. Mixed-case canonical ODD1 device IDs now preserve strict wire
validation while allowing only ASCII-insensitive comparison at the already
folded durable-key boundary; durable commit, PROP/LIST, OroStore reopen, and
server restoration are regression-tested. KICK bodies now receive exactly one
`\r\n` at the server send boundary, so the actor and target observe a complete
KICK before the next NAMES reply. Independent KICK review returned ACCEPT with
no findings on:

- `/home/kain/onyx-server/src/daemon/server.zig`: `c58a8f62dc2e11ebd678fa95bac6c5039f9b0ce1ec866897a2175242d5ed2774`
- `/home/kain/onyx-server/src/proto/e2ee_policy.zig`: `1af7c7627127c3e84a2342aa32e9c9bd8b28f31e075c60725cc3a628a1f5a595`
- `/home/kain/onyx-server/src/daemon/durable_credential_props.zig`: `a6b60a48da724784fecea02b1002153142a7703016b863b5989237838705837b`
- `/home/kain/onyx-server/src/daemon/helix/prop_checkpoint.zig`: `90a7407e820c9598a506a55372a485d9cfc74c16914977bba58d591c1b5475bc`

The server's post-fix/current-shared-tree full module gate completed 4/4 with
8,101 passed, 4 skipped, 0 failed (8,105 total); focused Debug/ReleaseSafe KICK
tests, format checks, and diff checks pass. Step 4 OCG2 configuration/strict
boot was separately accepted with no runtime consumer. These results complete
the bounded local D2 connected proof; OCG2 activation, multi-node signed-mesh
duplicate/equivocation proof, deployment, commit, and push remain outside this
checkpoint.

### Server OCG2 Step 5 final acceptance

The paired Onyx Server Step 5 sealed session-provenance foundation and runtime
integration are now accepted. Runtime authority remains configured-local only:
the server passes durable authority as `.disabled`, and legacy OCG1 plus the
inactive OCG2 image cannot grant session privileges, prefixes, WHOIS/NAMES
operator status, KICK immunity, reserved DATA access, or operator lifecycle
events. Direct Helix adoption and detached-session restore clear carried
authority and recompute from the successor's live configured binding.

Accepted server-side SHA-256:

- `/home/kain/onyx-server/src/daemon/server.zig`: `eb893fc58ffc21e8245417085a2026ba0e6556da57f907b0bf70af289e38206a`
- `/home/kain/onyx-server/src/daemon/dispatch.zig`: `75b603f93088bf1db67b104deee32ac764083f85a26ad38ff9757b53996cc6fc`
- `/home/kain/onyx-server/src/daemon/oper_session_provenance.zig`: `9cb63edbdd9bbd5539d0a2469a0d35499dba265f651f418d09392ddf534d99c4`
- `/home/kain/onyx-server/src/daemon/services.zig`: `73a47184ec9037b00c12abe9e7e80d9b8e33d4bd3e05a4344276aca029389361`

Independent foundation and final server reviews returned ACCEPT. Final server
evidence: OCG2PROV 84/84 in Debug and ReleaseSafe; account-switch 71/71 in
both modes; GRANT/non-authorization 77/77; migrated profile 72/72; broad oper
304 passed and 1 skipped; exact EXTERNAL restore 70/70 in both modes; Debug and
ReleaseSafe check builds pass. The final full module gate completed with 8,111
passed, 4 skipped, and 0 failed (8,115 total) in 16 minutes, with 622 MiB
maximum test RSS and 1 GiB compile RSS.

Step 6 is architecture-only and remains on HOLD. No OCG2 runtime activation,
deployment, commit, or push occurred. The complete transactional
grant/revoke/expiry architecture packet and acceptance matrix are recorded in
`/home/kain/onyx-server/CONTINUOUS_WAVE_CHECKPOINT_2026-08-13.md`.

### Roadmap PublicFrame final acceptance

The Roadmap PublicFrame wave is accepted after independent accessibility
review returned **ACCEPT**. The shared focused unit run passed 97/97 and the
high-zoom/reflow Roadmap E2E passed 1/1.

Accepted SHA-256:

- `src/routes/Roadmap.tsx`:
  `accc02e1f03757b83d332cd4564064bfb06d8f525d3bad273490b9be5bf5574d`
- `src/routes/Roadmap.test.tsx`:
  `c85795316461d2c611b45a0d3d295bb7c4da26eb43838d5aa2356e98114ffec5`
- `src/routes/roadmap.css`:
  `1b03da24099cabcb3058f39997508c144f8add7f5fb24366e26e67693d5cf9d1`
- `tests/e2e/roadmap-route-high-zoom-reflow.spec.ts`:
  `d932b66f1e65c46ad84eda84a08d9ba35eb1bf95e68f40b9c3beb5ee3ca68eaa`

This acceptance covers the current local PublicFrame implementation and its
recorded unit, browser-layout, and accessibility evidence only. It is not a
deployment or connected-server acceptance claim.

### Download PublicFrame final acceptance

The Download PublicFrame wave was implemented by the assigned **Grok 4.6**
main-writer lane, received senior **Opus** review, and then received final
independent accessibility closure **ACCEPT**. The Download-focused unit gate
passed 17/17; the combined PublicFrame UI unit gate passed 110/110; and the
Download E2E gate passed 2/2. Typecheck and the production build passed with
479 transformed modules.

Accepted SHA-256:

- `src/routes/Download.tsx`:
  `b66f79e7a9a0a3906805b67c421ef27e23bb506c65deed745f91c41a3d99968c`
- `src/routes/Download.test.tsx`:
  `2c02c3e576e9b49e665d3bc022f277644538692b38927e92fceddaf467fe095f`
- `src/routes/download.css`:
  `75d2c98e0558b7c5f813b487a6d435f6920bc3af5e025e8bdaf48fe5bc9eab08`
- unchanged `src/routes/downloadMeta.ts`:
  `89b6ac141a941a18cf973162b6c8d1f20a59267b117923e7f01b4b6d110c0f96`
- `tests/e2e/download-route-high-zoom-reflow.spec.ts`:
  `87ddb5f77d9b8d206dc1784bd1bd43d02026c35b85ccfd3e456b2319fcd62276`

The accepted production budget report digest is
`6b77dee7f50cd990041713fb9c4ee7c3bba4ff97065b54ce63a20a8d560e060f`.
Its recorded eager budgets are 172,833 bytes gzip JavaScript and 24,105 bytes
gzip CSS.

This is a bounded local UI/build/browser acceptance. No deployment, publish,
commit, push, or connected-server validation occurred, and no such claim is
made by this checkpoint entry.

### Stats PublicFrame migration (W-STATS-PF)

`/stats/` now uses `PublicFrame` as its only document frame
(`currentPath="/stats/"`, `mainLabel="Onyx network stats"`). Local
`PageChrome` / `main` / header / `PublicFooter` chrome is dissolved. The
route retains `r-ground` / `r-flecks` / `r-grain`, the local Stats sections
nav, and the existing functional, data, privacy, inspector, deeplink, timer,
sr-only, and page-meta contracts.

The six-state header live pill now lives in exactly one hero observation
(`role="status"`, `aria-live="polite"`, `aria-atomic="true"`) with
byte-identical state values and labels: `stats current`, `stats stale`,
`stats time mismatch`, `stats undated`, `stats incomplete`, and
`stats unavailable`. Stats remains absent from primary-nav IA. Route-scoped
forced-colors, reduced-motion, and 320×256 / root-64 reflow styles live in
`src/routes/stats.css` only.

`tests/e2e/public-route-mobile-nav.spec.ts` was repaired only for stale
PublicFrame rows. About keeps its local-topic navigation behavior.

Writer: **Grok 4.6** (main UI writer). Baseline: `onyx-solid` at `4c31f31`.
Unrelated concurrent dirty files were preserved and were not reverted.

Accepted SHA-256:

- `src/routes/Stats.tsx`:
  `01a77a36a07fdea584c153312a55e12fce898172d84228b9e405e5bcf83dcf8e`
- `src/routes/Stats.test.tsx`:
  `9d1184a32e9db9788df7d945733099b0f26ca8e122bcaa7d21ff9bcab7aa52d3`
- `src/routes/stats.css`:
  `c834b68e9c469ae583194f6e55e3388b8b8d563606ffc6feee6bd53ba9a66680`
- `tests/e2e/stats-route-high-zoom-reflow.spec.ts`:
  `09fdce0ef38e02398920407428cc95f0f1e763b35e2afd3516b40063c32392a0`
- `tests/e2e/public-route-mobile-nav.spec.ts`:
  `3f9ddf5b5645ed238d5f51a2b41a65d5bd2c26c52e638f3567d00e7a55503a56`

Evidence:

- Focused Stats units: 1 file, 16/16 pass.
- Shared publicLinks / publicControls / pageMeta / manifest / PublicFrame
  plus Stats: 6 files, 36/36 pass.
- Full TypeScript no-emit: pass.
- Scoped ESLint on owned TS/TSX/e2e files: pass.
- Production `pnpm build`: pass, 479 modules transformed.
- `node tools/check-ui-budgets.mjs`: pass. Digest
  `b5bcb1c65357808c1d03315a4ac2fa1e2f3b1a622f6a28303ae67489e9262f06`.
- Isolated-port Chromium (`ONYX_PLAYWRIGHT_PORT=4227`): 7/7 pass
  (new Stats high-zoom 1/1; data-routes `/stats/` + Invite 2/2;
  repaired mobile-nav About/Roadmap/Status/Stats 4/4).
- `git diff --check` on owned paths: pass.

This is source and local production-preview browser acceptance only. It is
not a connected-server stats-feed, deployed-byte, commit, push, or
deployment claim.

### Invite PublicFrame migration (W-INVITE-PF)

`/invite/` now uses `PublicFrame` as its only document frame
(`currentPath="/invite/"`, `mainLabel="Onyx invite"`) with content root
`class="ui-root r data-page invite-page"`. Local `main` / `header.r-status` /
`PublicFooter` chrome is dissolved. The route retains `r-ground` / `r-flecks`
/ `r-veins` / `r-grain`, dynamic `setPageMeta` / canonical query handling,
validated token/invite parsing, `appHrefFromInvite` `/app/` fallback, copy
epoch / busy / unmount, success `role="status"`, failure `role="alert"`, the
full validated app query, and bare-invite network-only preview. Invite
remains absent from primary-nav IA. No Invite CSS was added; shared
`landing.css` / `data-pages.css`, PublicFrame, nav, manifest, `index`,
`PublicFooter`, OnyxOS, PublicInfo, and package files were not edited.

`tests/e2e/public-route-mobile-nav.spec.ts` received only the additive
`/invite/` PublicFrame row. Existing About / Roadmap / Status / Stats rows
are unchanged.

Writer: **Grok 4.6** (main UI writer). Baseline: `onyx-solid` at `4c31f31`.
Unrelated concurrent dirty files were preserved and were not reverted.

Accepted SHA-256:

- `src/routes/Invite.tsx`:
  `1b877262074c770f88d2df6147da097b9598089146c8cdc497926793bb2bad49`
- `src/routes/Invite.test.tsx`:
  `48a09c15ecdd80894ff461470c04243eb0f7030b5051637b5d89801aa1b94f15`
- `tests/e2e/invite-route-high-zoom-reflow.spec.ts`:
  `3805242fb74dd5d082d1a32e76cee25a12a628b24eb9575117edd3987ef0e1fd`
- `tests/e2e/public-route-mobile-nav.spec.ts`:
  `ca122bd639aea0c22ff913d87344e9f782b9c48b80aa7b90b474e0e162e5ed54`

Evidence:

- Focused Invite units: 1 file, 9/9 pass.
- Shared publicLinks / publicControls / pageMeta / routeEntrypoints /
  PublicFrame plus Invite: 6 files, 28/28 pass.
- Full TypeScript no-emit: pass.
- Scoped ESLint on owned TS/TSX/e2e files: pass.
- Production `pnpm build`: pass, 479 modules transformed.
- `node tools/check-ui-budgets.mjs`: pass. Digest
  `78e14cc33b9bd82c3c2761d67b2c69449c7c46cdae41d8884882b542f9bf29a5`.
- Isolated-port Chromium (`ONYX_PLAYWRIGHT_PORT=4239`): 13/13 pass
  (new Invite high-zoom 1/1; unchanged data-routes `/invite/` + `/stats/`
  2/2; mobile-nav About/Roadmap/Status/Stats/Invite 5/5; invite consume-side
  5/5). No connected create-side invite test was run or claimed.
- `git diff --check` on owned paths: pass.

This is source and local production-preview browser acceptance only. It is
not a connected-server invite create-side, deployed-byte, commit, push, or
deployment claim.

## UI Stage B — Public OnyxOS and PublicInfo Cutover — ACCEPTED

Accepted after the Grok 4.6 adversarial repair and an independent accessibility
review. The cutover keeps OnyxOS and all four PublicInfo variants under the
shared PublicFrame, preserves one landmark set, adds correct tab semantics and
roving keyboard focus, and retains forced-colors, reduced-motion, 44px target,
and true 400% reflow behavior. The concrete Chromium defect was a decorative
OnyxOS arrow compressed into an internal scroller by the shared high-zoom rule;
the fix gives inline glyphs stable boxes and removes the extreme-zoom hero
constraint without hiding overflow.

Accepted SHA-256:

- `src/routes/OnyxOS.tsx`:
  `bb5c60be2daac259e8f61a69942f944496db152e7eea7d49eff7f8bfbc58a955`
- `src/routes/OnyxOS.test.tsx`:
  `87acc0aee91dc5d8775490c1ea12fc5bb7016c1db5b6acacd352c7af53be5bdb`
- `src/routes/onyxos.css`:
  `936de8b17949ad02265a08c67724861dbcdf84f009dc045bca8dca3463a04f44`
- `src/routes/PublicInfo.tsx`:
  `0f12fc55a213b6311a7fe4ae7cee74eede8f8603309f4a4420796feb18f1ea52`
- `src/routes/PublicInfo.test.tsx`:
  `5452232085ec78d4e8b574b3edba0fbc1f4585abac736f867ebbc085399f4860`
- `tests/e2e/onyxos-route-high-zoom-reflow.spec.ts`:
  `36dfbc663dacc5b8c765513a1444b782f2a22d1fa94cde135c07c6f2b0448d55`
- `tests/e2e/public-route-mobile-nav.spec.ts`:
  `f9eac65ac50ecffa5ed8ed1536db3ff3b37afef1c70d98d0d22639db008e1fbf`
- `tests/e2e/public-info-route-high-zoom-reflow.spec.ts`:
  `4facfadd4e85cd147d68e734f8414b4ec8aeb27092990e9795db58141b20d6ac`

Evidence:

- Focused OnyxOS/PublicInfo units: 45/45 pass.
- Full TypeScript no-emit and scoped ESLint: pass.
- Production build and diff check: pass.
- Grok isolated Chromium matrix: 17/17 pass.
- Independent clean-port Chromium reproduction: 16/16 pass (OnyxOS 1,
  PublicInfo 4, mobile navigation 11).
- Independent accessibility audit: ACCEPT, no confirmed high- or
  medium-severity findings.

Stage C route-lifecycle work is deliberately not admitted here. Its functional
tests pass, but its eager index artifact remains 610 gzip bytes over the fixed
budget and an obsolete pre-cutover high-zoom spec still requires an explicitly
reviewed update. No `out/`, commit, push, or deployment claim is made.

## UI Stage C — Persistent Route Lifecycle + Production Deploy — ACCEPTED

Grok 4.6 moved route announcements under the persistent Solid Router root,
then corrected two independently reproduced races: navigation completed before
the lazy controller arrived, and an initial unknown route followed by a mapped
route. The eager root now captures the initial pathname once and passes that
seed across the lazy boundary; the outlet remains immediate. The announcer
distinguishes absent legacy initialization from an explicit empty unknown seed.
Both static route inspectors now fail closed while accepting scalar and literal
array route paths.

Accepted SHA-256:

- `src/ui/a11y/RouteLifecycleRoot.tsx`: `acb4ca67534d0fbf031691a31e6441db70a903dcb1e3abffe1b3bc6ebdd6093e`
- `src/ui/a11y/RouteLifecycle.tsx`: `5b908957efd9018e95dbd5d1b3033b0c761b749db24d5d6d096241ba9b200b4e`
- `src/ui/a11y/RouteLifecycleRoot.test.tsx`: `1d465e6f1afd836f76ae64d2286b8ab8cd68183759d11f6a84d42943455d28cc`
- `src/ui/a11y/RouteLifecycleRoot.lazy.test.tsx`: `74ba1c5511981b9bb8c1337b7152944d31ac93539e653badc26ab43ed6a7cf52`
- `src/ui/a11y/RouteAnnouncer.tsx`: `6cbc608466ed8e0d9a2db57d6b6cbc2908b976c0cb7c27da3bd660029676e50e`
- `src/ui/a11y/RouteAnnouncer.test.tsx`: `d9aa82a123d10259d3767c0437cf7b3a99093bd385170876bf9adcbfbff4dbb4`
- `src/ui/a11y/index.ts`: `e0b84c6917482330fcc377cd5c2d90a054285408597507c40a922bc74dd6d7dc`
- `src/pwa/routeEntrypoints.test.ts`: `ff7ebd06175c8ad0096a288e662a506fab23839cb2f51f93df6fa3feae68032f`
- `src/ui/navigation/publicRouteManifest.test.ts`: `495e5412956dd8aa75bc3bc2e632b788639724951d1325c972abbc7555fdbf60`
- `src/index.tsx`: `08e4c19aeb2440b857fbd13d44f814ac043a98f6fef14b33189388960d149834`
- `tests/e2e/public-route-high-zoom-nav.spec.ts`: `60005f534d3e734fef7c32f9a43e1eac3362b86032156976e577bcec3781e3c2`
- `tests/e2e/public-route-lifecycle-announcer.spec.ts`: `99e31bf022afb6be555c5a8d349dd40ecbe79892ac6ed572c7963b61447bf663`

Acceptance evidence:

- Focused correction matrix: 48/48 pass.
- Full client suite: 498 files, 6,319/6,319 pass.
- Typecheck, full lint, production build, and diff checks: pass.
- Chromium: lifecycle 5/5, mobile navigation 11/11, high zoom 1/1.
- Independent TypeScript rereview: ACCEPT; held-chunk mapped and unknown
  transitions announce exactly once; `/download/` to `/install/` remains silent.
- UI budget digest `7fd6c7aa0029e47e6f8a7fbc889b2615465d1f7412f8991db1efa7b68ca68e3c`:
  eager index 53,859 raw / 18,918 gzip, 20 raw bytes under the immutable ceiling.

Deployment:

- Deploy controller: 99/99 pass; dry run pass.
- Atomic deploy version: `onyx-shell-20260813-214404-4c31f31-dirty`.
- Rollback snapshot: `.onyx-deploy-backups/onyx-out-20260813-214404-4c31f31-dirty`.
- Live URL: `https://eshmaki.me`.
- HTTPS 200 and exact live/deployed byte equality proved for `/`, `/app/`,
  `/roadmap/`, `/status/`, and `/sw.js`.

The working tree remains intentionally dirty and no commit or push was made.
## 2026-08-13 final combined deployment

- Release commit: `a2e547e4` (`feat: ship current desk and resilient group encryption`).
- Live client release: `onyx-shell-20260813-231920-a2e547e4` at `https://eshmaki.me`.
- Atomic deploy snapshot: `/home/kain/onyx/.onyx-deploy-backups/onyx-out-20260813-231920-a2e547e4`.
- Live `index.html`, `/app/index.html`, and `sw.js` were byte-checked against `/home/kain/onyx/out`; the service-worker cache stamp matches the release above.
- Final source gates: TypeScript pass; ESLint 0 errors (2 existing Solid reactivity warnings); production build 485 modules; UI budget pass; 500 unit files / 6,404 tests pass.
- Final browser gates: connected Current Ledger 1/1, existing Home/mobile/forced-color 6/6, authenticated group-control connected runner 1/1.
- D3 accepted hashes: runtime `b2e21c54876157ca00ca9e0f058a3bc9817489a27ca8235f80b30ee09b256daa`, runtime test `2c8bdaefbfdea824ac427869d033af70bdd794c0f1a9b330375b66db9a09c53d`, integration test `38e3c3d8c4a0c4f975249e14b7e98e8a3e2b22c6ae92f5deb9754b9f5077432c`; independent focused gate 80/80 plus typecheck/ESLint/diff-check.
- Group-control runtime activation remains truthful: provisioning/retry/lifecycle behavior is implemented and verified, but production activation remains HOLD where the server/session authority is intentionally not wired.
