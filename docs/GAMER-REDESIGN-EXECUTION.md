# Gamer redesign execution ledger

Checkpoint: 2026-09-08. Repository: `/home/kain/onyx`.

**DEPLOYED. BOUNDED PRODUCTION ACCEPTANCE GREEN.**
HTTPS bytes, real public two-peer UI smoke and public landing checks at
1440/390/320px verified. **SOURCE RELEASE PUBLICATION COMPLETE** on default
branch `onyx-solid`: `9382b8d2626eaaa507fbe8658b16f87616f24d9f`.
This final documentation receipt awaits its own commit/push and is frozen for Main.

This ledger records implementation handoffs and bounded evidence, not release
clearance. Main may append newer receipts below. A source implementation, a
focused test pass, a screenshot, and a connected journey are different evidence
classes; none substitutes for the others.

## Current status summary — latest Main checkpoint, 2026-09-08

**Earlier ownership/status tables and receipts below are historical snapshots,
not authoritative current status.** Read them with the latest appended Main
receipt; preserve their history without carrying old blockers or passes forward.

Main reports L4a, G4, L4b and L2 source closures; the known integrated source
and browser follow-ups are closed. Corrected Account, Search and Appearance checks have Main's
**3/3 PASS** receipt on interim build `a772163…`; the earlier three contextual
passes are a separate run, not a final six-case candidate receipt. Astra's two
gallery CSS P2 source fixes are now frozen with Euler's handoff; new tab-label
containment and loaded-image/filename non-overlap assertions are complete and
frozen, with corrected gallery reruns passing in Chromium and WebKit at all
three widths on build `89615675…`.
Refreshed connected DEV checks
are **3/3 PASS**, a separate evidence class from built-runtime fixture checks.
**Final r2 source and tests are frozen**, including Gauss's owner/client fix
(16 tests; Main's separate five-file receipt is **55/55 PASS**). Current
typecheck/lint `97319` passes with **0 errors / 33 warnings**. Build `48807`
and budget pass; the supplied digest is
`2e75a9d46fb5d33f8e6c580587e3ce603a81b71a5ee0020ace6bed66d1c3775a`.
Fresh r2 **Chromium contextual 6/6 PASS in 1.0 minute**, all six cases at three
widths, and **WebKit moderation 1/1 PASS in 17.4 seconds** on `2e75a9d4…`.
Main reports all known browser failures closed by scoped reruns, not a new
combined-suite total. Main's deploy dry run `66046` **PASS** is **staging only,
no `out/` writes**, with unchanged pre/post live index and service-worker hashes.
**Astra SOURCE CLOSED the last L4C-OWNER finding**; Main reports no known source
or browser findings open. **Full unit r2 GREEN:** Main run `24693`, exit **0**,
**604/604 files and 7,573/7,573 tests PASS in 515.42 seconds**. Report:
`/tmp/onyx-connected-evidence.7kJLLz/final-unit-r2.json`. **Predeploy gates are
green.** Source/E2E remain frozen; unchanged final type/lint/build/browser
receipts and dry-run PASS remain valid per Main. Astra's written predeploy
**CLEARED** and Main's fingerprint confirmation preceded actual deployment.
**Deploy `7747` exited 0**, stamp `onyx-shell-20260908-044550-79bcd0e9-dirty`.
HTTPS verification exited 0 with **169/169 exact SHA-256 matches** at
`2026-09-08T02:46:19.342Z`. **Actual public two-peer UI smoke `28608`: exit 0,
PASS at `2026-09-08T02:46:27.374Z`** on `https://eshmaki.me`: two actual guest
UI connections at 1440px/390px, two bidirectional messages rendered on both,
no overflow and zero page errors; contexts closed. No fixture or store seed;
only a synthetic fresh QA room. **Bounded production acceptance is GREEN** on
the same frozen source hash and final built assets. This does not prove hardware,
account authentication or peer media. **Source release commit
`9382b8d2626eaaa507fbe8658b16f87616f24d9f` is pushed and independently confirmed
at the remote default branch `onyx-solid` by Main.** Integration was directly
to that branch; no PR or `main` merge is claimed. This final documentation
receipt is not yet committed/pushed. Recovery snapshot and exact hashes are appended.

Earlier browser receipts remain historical: Chromium finished **13/14 PASS** and
WebKit contextual **5/6 PASS**, each failing only the gallery scroll-row race.
The bounded harness synchronization fix is frozen; gallery reruns passed
**Chromium 1/1** and **WebKit 1/1** as separate receipts on the same build.
Firefox public's earlier **17/21 PASS** is followed by corrected four-spec
run `80506`: **5/5 PASS**, including the install alias. These receipts are not
summed. Unit run `94613` is
**complete but checkpoint-only**: **604 files, 602 PASS / 2 FAIL; 7,570 tests,
7,568 PASS / 2 FAIL / 0 skipped**, in **706.53 seconds**. Failures are the old
vaultSync async test (Euler's correction has 28 PASS) and harbor-phone's stale
Download heading expectation. Main
reports no new application regression known from this suite; this is not a
green suite or proof of absence. The corrected r2 full run now passes as
recorded above; this historical red checkpoint remains intact, not relabeled.
Landing budget
`32055` passes at **36.66 KiB gzip across three eager files**.
Predeploy gates, Astra clearance, deployment and HTTPS-byte verification are
complete per Main, as are bounded public two-peer smoke acceptance and source
release publication. Only this final documentation receipt's commit/push remains
pending; its future commit hash is not yet known or claimed.
Exact bounded receipts are appended at the end of this ledger.

## Candidate identity and precedence

- Main-supplied baseline branch: `onyx-solid`.
- Main-supplied baseline HEAD: `79bcd0e9431a268b610180ff7e2872348801710a`.
- The candidate includes concurrent, uncommitted work. **Current dirty source
  and Main's explicit ownership handoffs are authoritative**, not baseline HEAD
  alone or the historical completion language of an older roadmap.
- Design direction and acceptance packets: [Astra ULTRA roadmap](GAMER-REDESIGN-ULTRA-ROADMAP.md).
  The [first-pass roadmap](GAMER-REDESIGN-ROADMAP.md) remains historical context;
  neither roadmap is overwritten by this ledger.
- This documentation pass read the roadmap head and P0–P4 packets, refreshed
  client contracts, and inspected current implementation anchors read-only.
  For example, `MemberList.tsx` imports the collection stylesheet and contains
  identity-keyed row measurements; `MessageView.tsx` imports its commercial
  stylesheet; the G1 and L4a source seams exist. Source presence is not browser
  acceptance or proof that an in-progress packet is finished.
- Unless explicitly identified as the L2 writer's direct receipt, results below
  are Main-reported checkpoint facts, not reruns by this documentation writer.
  No Git inventory, build, tests, deployment, or publication was run for this
  docs-only pass. The sole write path is this new document.

## Ownership and packet status

The roadmap's original GROK/LUNA reservations are not a claim about who actually
wrote a later packet. Main authorized LUNA MAX FAST writers/fallbacks; GROK 4.6
CLI performed G2 and recording work and is currently working on G4. Explicit
current assignments below take precedence. They do not grant new write scope.

| Packet / surface | Current owner or handoff | Recorded progress | Still open |
| --- | --- | --- | --- |
| Design / independent review | Astra ULTRA | ULTRA roadmap and two independent review rounds delivered; second review is **HOLD** | Three P2 findings assigned to Mill/Euler in the latest receipt below; no final acceptance |
| G1 — homepage / preview / room board | LUNA MAX FAST implementation | Implemented; 25 focused tests passed | Integrated final browser/design acceptance |
| G2 — Connect / Invite | GROK 4.6 CLI; Main integrates layer fix | 99 focused tests passed; layer fix received actual-browser verification: 13 checks across gamer layout, Connect and invite consumption, including gamer 4/4 | Reconfirm affected journeys on the final candidate; this is not a full-suite receipt |
| G3a — public frame, About / Guides / Download | LUNA MAX FAST; Euler owns current follow-ups | 72 focused tests passed | Euler follow-ups in progress, then fresh checks/review |
| G3b — Status / Stats / Roadmap / information and trust pages | LUNA MAX FAST | 85 focused tests passed | Integrated route/state/browser review |
| L1 — transcript / composer | LUNA MAX FAST | 114 focused tests passed | Final populated room/DM, reflow, action and render/privacy review |
| L2 — Rooms / Messages / People | LUNA MAX FAST; initial source freeze accepted, then owned scope returned after this docs checkpoint | Earlier presentation checkpoint: 91 tests passed. Later variable-height roster checkpoint: 36 tests passed across 2 files; new production browser mobile case passed | Desktop browser case has 11px horizontal overflow; fix actual layout, preserve strict assertions, rebuild and retest |
| L3 — Home / Calls | LUNA MAX FAST; Euler owns current CSS polish | Source checkpoint: 35 focused tests passed | Euler CSS polish in progress; refresh browser/design evidence afterward |
| Privacy follow-ups | Darwin | 85 focused tests passed | Preserve fail-closed behavior across remaining packets and final review |
| Custom theme verification | Main's reported verification receipt | 33 tests passed | Final integrated real-theme/browser evidence |
| Recording ownership / controls | GROK 4.6 CLI; Mill owns review follow-up | Final source checkpoint: 123 focused tests passed; newer real Chromium AppShell Record → Leave receipt passed (details below) | Astra P2 recording-start acknowledgment HOLD; synthetic local fake microphone is not peer/hardware proof |
| L4a — search / pins / room media | Gauss | In progress | Complete bounded source handoff, focused tests, privacy states and browser review |
| G4 — account / preferences | GROK 4.6 CLI | In progress | Complete bounded handoff and account/preferences state verification |
| Typecheck repair | Gauss | Current typecheck found two Grok-related type errors; repair in progress | Fresh integrated typecheck must pass; no current green claim |
| L4b — notifications / voice settings | Pending Main dispatch/handoff | Pending | Exact ownership, implementation and full relevant state evidence; not media-stage ownership |
| L4c — moderation | Pending Main dispatch/handoff | Pending | Exact ownership, implementation, permission/server-result evidence and independent security review |
| Integration / shared seams / browser / release | Main and explicitly assigned owners | Coordinates current candidate and receipts | Shared source remains outside other writers' scope; release gates remain open |

Main retains integration authority over `AppShell`, navigation, `PresenceRibbon`,
shared shell/phone CSS, theme/token machinery, primitives and other unassigned
dependencies. Existing delegated ownership, including call-control owners,
must be preserved. L4a/G4 do not authorize changes to authentication, vault,
search engines, encryption, notification decisions or media engines. L4b does
not implicitly own `VoiceStage`, `VoiceBar`, `VoicePip` or overlays. L4c requires
the existing permission/confirmation/server-result semantics to remain intact.

### Frozen L2 measurement checkpoint

Main initially accepted L2 source freeze for browser verification. The newer
receipt below returns the owned source scope after this documentation
checkpoint to fix a real desktop overflow; it does not authorize weakening
tests. The checkpoint paths are:

- `src/shell/MemberList.tsx`
- `src/shell/collection-navigation.css`
- `src/shell/memberWindow.ts`
- `src/shell/memberWindow.test.ts`
- `src/shell/MemberList.a11y.test.tsx`
- `tests/e2e/member-window-continuity.spec.ts` — explicitly assigned authorship;
  Main owns execution and acceptance.

The virtualizer measures mounted member and heading border boxes by identity;
unvisited rows remain estimates, not an assertion of uniform height. Measured
heights drive lookup and both spacers, with scroll-anchor correction after
layout changes. The window is capped at 96 flat rows. Continuation labels retain
list naming without introducing duplicate visual heading height. Scoped CSS
allows full nickname wrapping and disables the shared 36px intrinsic
paint-skipping placeholder only for the bounded mounted rows. Shared CSS was
not edited by L2.

Direct writer receipt: 36/36 focused tests passed, targeted lint passed, and the
new E2E file passed its standalone typecheck. The initial focused run failed
before tests with temporary-file write error `-122`; retrying with
`TMPDIR=/dev/shm` succeeded. Collection CSS source changed from 11,912 to 11,862
bytes (−50 bytes); this is **source size**, not a new bundled-budget measurement.

The two authored production-runtime browser cases cover desktop/mobile 3k
mixed-role rosters, deliberately unequal nickname heights, root sizes 16→32,
forward/reverse scroll continuity, group boundaries, retained DOM focus,
viewport resize, no clipping, far-end reachability and return scrolling. They
were **not run by the writer**; Main's newer mobile pass / desktop failure is
recorded below. Root-size stress is not equivalent to full
browser or text-only zoom; the roadmap's actual enlargement evidence remains
part of Main's final acceptance.

## Integrated gate evidence — do not combine overlapping counts

Focused counts above describe individual receipts that may overlap one another
and the full suite. **Do not sum them into a redesign-wide passing total.** The
13 browser checks already include gamer 4/4; those are not 17 separate checks.

| Gate / evidence | Recorded result | Interpretation |
| --- | --- | --- |
| Preliminary full unit suite | 603 files: 587 passed, 16 failed. 7,495 tests: 7,463 passed, 32 failed. Duration 793 seconds | Red preliminary run; **not full-suite green** |
| Subsequent old-layout expectation follow-ups | 8-file focused rerun: 225 tests passed; separate shell rerun: 96 passed | Repairs/rechecks of known older expectations; not a replacement full-suite run and not proof all 32 failures are closed |
| Current typecheck | Two Grok-related errors; Gauss fixing | Open gate until fresh pass on the integrated source |
| Lint checkpoint | 0 errors, 32 warnings | Not zero-warning output; refresh after remaining changes |
| Earlier built UI budget | AppShell CSS 376,790 bytes raw / 55,929 bytes gzip; budget passed | Superseded by the newer build receipt below; neither pass covers later source corrections |
| Connected DEV invite | 1 passed against `wss://eshmaki.me:8080`, using synthetic QA guest peers | Real connected DEV evidence, not deployed-production acceptance |
| Connected DEV DM security | 2 passed: ciphertext/decrypt and locked behavior, using synthetic QA guest peers | Bounded connected DM evidence; not a universal encryption/privacy or production-delivery claim |
| Final independent review / recording browser proof | Review pending/running; newer recording browser pass detailed below | No final integrated acceptance yet |
| Deployment / public HTTPS bytes / GitHub push | Not performed for this redesign checkpoint | Open release gates; no published completion claim |

Main's earlier recorded built UI-budget digest:

```text
262b9915ac8ba4cd3493eef0aeae496868a99b41833e790c692a15e93e4fbd5b
```

This identifies the reported budget checkpoint, not baseline HEAD or a newly
verified digest of the current dirty source. The recorded AppShell raw ceiling
is 380,503 bytes: that build had 3,713 bytes of raw headroom. Neither this
headroom nor the budget pass can be carried forward across newer source edits.
Do not raise ceilings to make a candidate pass.

## Execution environment and resolved interruptions

- Use the existing **pnpm 10** installation for every command and every child
  process. No installs, package changes or lockfile changes are authorized by
  this ledger. The inspected local wrapper targets the existing 10.33.0 binary.
- Export its directory at the front of `PATH` in each launcher/new shell and
  preserve that environment in all spawned children. An absolute parent pnpm
  invocation alone is insufficient: budget tools and Playwright's preview
  server spawn `pnpm` by name. A login shell or sanitized child environment must
  not silently select a different version.

```sh
export PATH="/home/kain/.local/share/pnpm/.tools/pnpm-exe/10.33.0:$PATH"
pnpm --version
# Must resolve to the existing pnpm 10 installation in this shell and children.
```

- Main reports the HMR trace-artifact self-reload problem fixed by using a
  `watch: null` server and keeping evidence under `/tmp`. This is a harness
  correction, not a reason to weaken application assertions or an assertion
  that production HMR behavior changed. Record evidence paths with the run.
- There is **no current Grok account-quota blocker**: retry worked. The earlier
  fallback remains an authorized historical handoff, not a standing outage.
- The Grok CLI 30-turn cap was reached and resumed normally. It is not task
  completion, acceptance or a persistent blocker.
- Keep QA screenshots/traces free of real private messages, session tokens,
  account secrets and invite capabilities. Fixture-connected layout evidence
  and actual connected DEV WS evidence must remain separately labeled.

## Follow-up and release checklist

Every item below is open unless Main appends a newer scoped receipt. Commands
are future work for the assigned owner, not commands run by this docs lane.

- [ ] **Euler:** finish G3a follow-ups and L3 CSS polish; return exact changed
  files, focused results and remaining visual findings.
- [ ] **Gauss:** finish the two type repairs and L4a search/pins/media packet;
  preserve locked/deleted/redacted preview safety and honest search provenance.
- [ ] **GROK 4.6 CLI:** finish G4 account/preferences; keep auth/theme/helper
  boundaries intact and supply focused state/interaction evidence.
- [ ] **Main:** explicitly dispatch/receive L4b notifications/voice settings and
  L4c moderation, with permission-sensitive independent review for moderation.
- [ ] **Astra / Main:** receive the running second independent review and the
  recording review; resolve findings and review corrective changes. Obtain
  actual recording browser evidence; 123 source tests do not close this gate.
- [ ] **Main:** run `tests/e2e/member-window-continuity.spec.ts` against the
  freshly built frozen L2 candidate, initially Chromium, and record both case
  results. Preserve the 96-row bound, full names/roles, focus and group
  continuity; do not mask failures with clipping or mount-all behavior.
- [ ] **Main:** freeze all contributing source and record exact candidate
  identity, owner handoffs and evidence timestamps. Reopen only an explicitly
  assigned correction scope; changes invalidate affected older receipts.
- [ ] **Main:** rerun final `pnpm typecheck`, `pnpm lint` and the **full**
  `pnpm test` on that candidate. Record file/test pass/fail/skipped counts and
  duration; resolve the preliminary red suite rather than relabeling focused
  subsets as a full pass.
- [ ] **Main:** fresh `pnpm build` into `dist/`, existing UI/raw/gzip budget
  checks and `pnpm check:landing-budget`. Record new digests and sizes without
  raising ceilings. Keep pinned pnpm 10 on every child process's `PATH`.
- [ ] **Main:** refresh integrated production-build browser evidence for gamer
  layout, Connect/Invite, populated room/DM, collections/People, supporting
  routes, Home/Calls and completed P4 surfaces. Include keyboard/touch,
  empty/busy/error/permission states, desktop and narrow/short-height layouts,
  actual light/custom themes, reduced motion, safe area and text enlargement;
  preserve actual callbacks and privacy semantics. Apply relevant additional
  browser-engine checks from the roadmap.
- [ ] **Main / independent reviewers:** review the final integrated candidate
  with screenshots, functional/connected receipts and privacy/render findings;
  no writer self-certifies release acceptance. Reconfirm connected journeys
  affected by final changes without presenting synthetic peers as real users.
- [ ] **Main, only with release authorization and green pre-deploy gates:**
  deploy through `./deploy.sh`. **Only `deploy.sh` writes `out/`**; normal
  builds write `dist/`. No manual copy, test output or alternative build target
  may write the live tree.
- [ ] **Main:** verify actual public HTTPS responses and asset bytes against
  the accepted deployed candidate, including appropriate route/cache/service
  worker and real-origin journey checks. Local build/preview success is not
  public-byte verification.
- [ ] **Main:** GitHub push **last**, only after successful deployment and
  real-HTTPS acceptance under the authorized release workflow. Record the
  resulting revision and receipts before changing the overall status.

## Append-only newer receipts

Main can append updates here without erasing the limits of older checkpoints.
For each update record: timestamp; owner; exact candidate/source or build
identity; packet and changed paths; command with pinned pnpm environment;
exit code and pass/fail/skipped counts; browser/fixture/connected scope;
artifact paths or digests; findings resolved; and remaining holds. Do not add
overlapping focused counts together. Completion, deployment and push each need
their own explicit receipt.

### Main update received during documentation checkpoint — 2026-09-08

These are newer Main-reported receipts; this documentation lane did not rerun
them. They supersede the corresponding older pending/build statuses above,
not the overall **not complete / not deployed / not pushed** status. The
checklist retains final-candidate reruns even where an interim pass now exists.

- Build reference supplied by Main: `40849`. Recorded digest:
  `d0768d977ba356b3e5d6e949757d26f56b75d4e59b81ce9ad3f75bedf18851fd`.
  UI budget **PASS**: AppShell CSS **376,567 bytes raw / 55,919 bytes gzip**.
  Raw headroom against 380,503 bytes is 3,936 bytes. Further corrections need
  another fresh build; this digest does not identify those future edits.
- Gamer layout on this new build: **4/4 passed**.
- New 3k-member production E2E: **mobile passed; desktop failed**. The desktop
  failure is `member-window-continuity.spec.ts:123`, horizontal overflow
  **11px**, expected **≤1px**, reached at line 203 after `seek(1995)` in the
  root-size loop. Do not infer which root-size iteration failed without the
  artifact. Main's full selected browser run was **10 cases: 7 passed,
  3 failed**; the other two failures belong to Euler. Do not add the gamer or
  roster subset counts to that run as additional independent cases.
- Desktop failure evidence:
  `/tmp/onyx-connected-evidence.7kJLLz/layout-next/member-window-continuity-3-ad114-ot-16-32-resize-and-far-end-chromium/test-failed-1.png`
  and `error-context.md` in the same directory. These local artifact paths
  are evidence pointers, not publication links.
- **L2 follow-up:** after this docs checkpoint Main returns the existing owned
  source scope to Luna. Diagnose and fix the actual overflow, preserve the
  ≤1px overflow and strict continuity assertions, then supply focused evidence
  for Main to rebuild and retest. No unrelated source scope is granted.
- Real Chromium **MediaRecorder via AppShell Record → Leave passed**:
  **122,955-byte WebM**, EBML signature **`1a45dfa3`**; final state idle,
  tracks ended, recording owner and toolbar unmounted. This is actual browser
  recording/lifecycle evidence using a **synthetic local fake microphone**,
  not evidence of real peer audio or physical microphone hardware. It replaces
  the earlier pending browser-recording receipt; Astra review and final
  integrated release acceptance remain open.

### Main clarification / second Astra review delivered — 2026-09-08

No local time was supplied for this receipt; none is inferred. This update
supersedes the earlier description of Astra's second review as running.

- **Astra second independent review: DELIVERED — HOLD**, with three P2 items:
  recording-start acknowledgment (**Mill**), PublicInfo slashless route handling
  (**Euler**), and Calls return to a DM (**Mill**). These need bounded fixes and
  fresh evidence/review; delivery of the review is not acceptance.
- Astra closes the current privacy, theme and Connect findings, and marks the
  old fixed-height roster model and recording-stop races **source-closed**.
  Source closure is not a claim that the newer roster browser overflow passed
  or that the recording-start acknowledgment finding is resolved.
- Latest supplied build remains digest
  `d0768d977ba356b3e5d6e949757d26f56b75d4e59b81ce9ad3f75bedf18851fd`:
  budget **PASS**, AppShell CSS **376,567 bytes raw / 55,919 bytes gzip**.
- The selected layout run remains **10 cases: 7 passed / 3 failed**. Main now
  identifies the exact failures: **L2 desktop roster 11px overflow at root 32
  after `seek(1995)`**; **G1 preview bottom 901.95 > 900**; **About scene body
  scroll width 417 > 320**. Euler owns the latter two. Mobile 3k continuity
  passed; gamer layout 4/4 passed. These subset counts overlap the selected run.
- The successful real Chromium recording receipt remains **122,955 bytes**,
  WebM EBML **`1a45dfa3`**, tracks ended and owner/toolbar unmounted. Its scope
  remains local synthetic fake-microphone browser recording, not real peer or
  hardware proof.
- Documentation checkpoint is complete. Only the previously owned L2 source
  scope returns to Luna for the desktop overflow correction. **Do not change
  assertions or weaken strict continuity.** Main must rebuild and retest the
  corrected source; Euler retains the other two layout failures. Main may
  append subsequent receipts without this lane editing other documents.

### Main receipt — Mill source fixes / Gauss handoff — 2026-09-08

- **L2 is frozen again for Main's browser verification.** The bounded metadata
  wrapping correction is source-addressed, not a new desktop browser pass.
  Existing strict overflow/continuity assertions remain unchanged.
- **Mill's two P2 source fixes are done:** Calls DM return and recording-start
  acknowledgment. Main reports **153/153 across four direct test files**:
  DM return **22**, recording acknowledgment **131**. These are the supplied
  breakdown of this receipt, not additions to earlier overlapping focused
  totals. **Main's fresh review is pending**; source fixes do not automatically
  turn Astra's HOLD into final acceptance.
- **Gauss finished the type fixes** and passed the pinned TypeScript check,
  then released engine ownership to **Mill**. This is a scoped handoff/pass;
  **final integrated typecheck remains open** after concurrent changes.
- **GROK G4 remains ongoing.** The interruption was our CLI maximum-turn cap,
  not account quota. No quota blocker is recorded.
- **Main/Euler are handling eight public-route failures.** This is a newly
  supplied failure checkpoint, not an added unique-failure total across the
  earlier runs; no further per-case details or new pass receipt were supplied.
- **L4a remains first in the serial sequence.** L4b/L4c inspection below is
  read-only preparation, not dispatch or permission to edit source/tests.

### Read-only next-writer risk checklist — L4b, then L4c

Source and same-basename test contracts were inspected; no tests were run for
this preparatory checklist. These are preservation requirements and targeted
verification risks, not a claim that every listed edge currently fails.

**Dispatch boundary:** finish/review L4a, obtain Main's exact handoff, then L4b;
L4c follows L4b and requires independent permission/security review. L2 stays
frozen. Mill owns the engine handoff; Euler owns public-route corrections.

| Packet / source anchor | Preserve / verify before accepting presentation changes |
| --- | --- |
| L4b — `NotificationCenter.tsx` | Bell count is unread attention notifications; inbox summary counts all unread notifications. Neither is conversation unread state. Preserve newest-first filters, follow-topic navigation, mark/dismiss callbacks, stale-row checks, focus recovery after local/synchronized removal, Tab containment and Escape return. Do not introduce raw message fallbacks into preview text or accessible labels. |
| L4b — `YouNotifications.tsx` | Browser permission, account-bound push arming, per-room policy, global notification mode, DND/quiet hours and sound are distinct gates. Preserve unsupported-host honesty and operation-generation guards across account/client/connection changes, disable failures and unmount. Permission granted is not proof of closed-tab delivery; never add automatic permission prompting merely by opening a redesigned sheet. |
| L4b — `voice/settings/VoiceSettings.tsx` | Preserve latest-enumeration wins, devicechange cleanup, disconnected-device fallback and existing selections on rejection. Speaker chooser stays an explicit user action; unsupported, canceled, denied, invalid and stale results remain distinct. Keep PTT capture ahead of app shortcuts while respecting IME/claimed keys; Escape cancels capture without closing the sheet. Preserve both inline and sheet mounting, labels, focus and actual store callbacks; no call/media engine or recording edits. |
| L4c — `ModerationCockpit.tsx` / `moderation/ModerationActionReview.tsx` | Keep current permission/connection checks, experience-mode action filtering, target/mask validation, local draft versus server echo, explicit confirmation/cancel and return focus. Do not optimistically report a command as accepted or conflate server moderation with device-local mute/block. Test permission loss and disconnect while review is open. |
| L4c — `moderation/BanListPanel.tsx` | Preserve authoritative fetch/refresh and loading-with-existing-entries, empty, error, unavailable and populated states. Lift remains review-first. **Room-switch probe:** pending drafts capture the original channel while permission selectors follow the current channel in both callers. Test switching rooms with a review open; if stale target/authority can be confirmed, escalate the exact correction to Main/security rather than silently widening presentation scope. This is a source-derived risk, not a reproduced exploit. |

Reserved presentation paths, only after dispatch:

- **L4b:** `src/shell/NotificationCenter.tsx`, `notification-center.css`,
  `YouNotifications.tsx`, `you-notifications.css`,
  `src/shell/voice/settings/VoiceSettings.tsx`, `voice-settings.css` in that
  directory, and their existing same-basename direct tests.
- **L4c:** `src/shell/ModerationCockpit.tsx`, `moderation-cockpit.css`,
  `src/shell/moderation/ModerationActionReview.tsx`, `BanListPanel.tsx`,
  `moderation-desk.css` in that directory, and their same-basename direct tests.
- Helpers, notification policy/store, auth, media engine, primitives, shared
  shell CSS, `ChannelSettings` integration and E2E writes remain with Main or
  their assigned owners. `ModerationActionReview` also serves member actions:
  scoped CSS changes need regression evidence for that existing caller, not
  edits to frozen L2 source.

Minimum next-writer evidence: focused direct tests with inherited pinned pnpm
10 `PATH` and `--maxWorkers=1`; actual empty/busy/error/permission states;
keyboard and focus restoration; 320px/root-32 plus actual text-enlargement and
short-height checks with long device names, notification metadata and masks.
Inspect real containment: current voice sections use `overflow: hidden` and
inbox previews use line clamping, so neither alone proves all controls/labels
are reachable. Do not weaken strict assertions or conceal failures by adding
clipping. Keep component-scoped CSS lean, preserve shared consumers and obtain
Main's fresh build/budget/browser receipts before declaring acceptance.

### Main receipt — public gates / contextual browser handoff — 2026-09-08

Main-reported checkpoint, appended without rerunning gates. Build identity is
the supplied short reference `2646f99`; no full digest or exact run commands
were supplied. Overall status remains **not complete / not deployed / not
pushed**. Counts below are scoped receipts, not additive unique-test totals.

- **Public Chromium: 16/16 PASS** on build `2646f99`. App CSS budget **PASS**:
  **380,031 bytes raw / 56,345 bytes gzip**.
- **Typecheck `69703`: PASS. Lint `49958`: 0 errors / 32 warnings.** These
  receipts do not replace final integrated gates after subsequent changes.
- **G4: Main's 149 direct tests PASS before the phone CSS correction.** Grok
  has now completed/frozen the account-phone specificity fix and added direct
  mutual-selection/Back-focus coverage. Actual browser validation of all nine
  account categories remains pending in the new contextual spec.
- **Firefox: 12/13 PASS**, including gamer layout **4/4 PASS** with actual
  Pearl light selection. The remaining About focus-outline finding is under
  **Euler** review; gamer counts are a subset, not four additional passes.
- **WebKit: 13 cases unable to launch due to missing host flite libraries**,
  not 13 application failures. Main is checking an isolated dependency route;
  no successful launch or remedy is claimed here.
- **L4a privacy P1 remains open:** Main discovered automatic remote-image
  fetching in the gallery; Astra confirmed it; **Gauss** owns restoration of
  consent, preference and privacy boundaries. Source repair and fresh browser
  evidence are required before acceptance.
- **L2 remains open:** the earlier desktop 11px overflow was fixed, then Main
  observed 96 rows flagged as clipped at the final seek and an alternate-path CPU loop.
  **Kierkegaard** owns the source repair; no new continuity pass is claimed.
- **L4b / L4c are not done.** Their earlier preservation checklist is not a
  completion or dispatch receipt.
- **Luna browser handoff:** `tests/e2e/contextual-redesign.spec.ts` is complete,
  frozen and **unrun**: six cases at 1440×900, 390×844 and 320×740. Covers
  account/preferences (all nine phone categories), notifications/voice
  settings, populated search, protected pins/media, moderation permission loss,
  and persisted Pearl/custom themes with computed-token assertions. Uses the
  real built runtime with fictional QA state, blocked external requests/WS,
  and local image fixture fulfillment only after explicit consent. Gallery
  opening must issue zero image requests; loading and jumping are separate.
  Screenshots use `testInfo.outputPath`. This is bounded UI evidence, not
  authentication, server enforcement, push delivery or real-call proof. Main
  will run it against the next rebuilt candidate after Grok's phone CSS fix;
  the finalized gallery consent selector also requires validation.

This append changes documentation only. No source edits, gate execution,
deployment, commit or push occurred in this documentation checkpoint.

### Main receipt — WebKit isolated launch blocker resolved — 2026-09-08

Main reports the missing-library launch blocker above **resolved** through an
isolated test launcher, with **no host, cache or package changes**. Official
Ubuntu Noble `libflite1` package bytes, SHA-256
`367f1d0da5cd38759a0515eafc27aa133b2d7bf99308cac34831df0212e96b75`, were
extracted into `/tmp/onyx-webkit-libs.uDldWF`. A temporary wrapper/config uses
the existing bundled **WPE WebKit 26.4** with its actual dependencies satisfied;
host validation was not skipped. Main's initial real Home opening **PASS**.

The **13 WebKit cases are now running** through that temporary configuration.
This supersedes the earlier launch-blocked status only: no completed suite
result or overall green acceptance is claimed. Documentation lane did not
rerun or independently verify the launcher, package digest or browser result.

### Main receipt — source closures and remaining integrated gates — 2026-09-08

Main-reported checkpoint, appended without rerunning any checks. These are
separate, potentially overlapping receipts; **do not sum the counts** or
interpret source closure as final browser/release acceptance.

- **L4a / G4 / L4b / L2: source closures reported.** Remaining integrated
  findings and browser checks are recorded separately below.
- **L2: Main built-runtime checks 2 PASS. WebKit gamer layout: 4 PASS.**
  About keyboard checks: **Firefox 1 PASS; WebKit 1 PASS**.
- **Latest Main search/preferences checks: 9 PASS. Interaction checks:
  10 PASS.** These bounded runs do not close the separate normal-phone Search
  entry-point failure.
- **Contextual built-runtime run `53716`: 3 of 6 PASS.** Passing cases are
  gallery/pins with actual explicit external-image consent, notifications/voice
  settings, and moderation permission loss; each covers all three fixture
  widths. The three failing cases remain distinct:
  - **Account:** at 320px, Session → Back restored focus but left the category
    offscreen. Grok's new Back-focus fix has **Main 41 PASS**; browser rerun
    remains pending. The strict viewport assertion is preserved.
  - **Search:** a real normal-phone entry-point gap is assigned to **Euler**.
    Contextual phone navigation awaits the source handoff; no shortcut was
    substituted to conceal the missing visible action.
  - **Appearance:** the stale nested `summary` locator now selects the direct
    child. This E2E-only correction is frozen and **pending rerun**.
- **Release guard, Luna/Main: 113 PASS.** This is a controller/guard receipt,
  not evidence that deployment occurred or release gates are complete.
- **Current typecheck: PASS. Lint: 0 errors / 32 baseline warnings.** The
  interim 33-warning output was during Grok's write; that helper is now used.
- **L4c: Gauss active.** The passing contextual permission-loss case is not
  comprehensive moderation acceptance or server-authority proof.
- **Final full suite / build / Astra review / deployment / Git remain open.**
  No final candidate-wide green claim, commit, push or deployment is recorded.

Contextual evidence remains bounded to the real built runtime seeded with
clearly fictional QA state. External traffic is blocked, and the gallery image
is fulfilled locally only after explicit Load. This does not prove real account
authentication, live notification delivery, media calls or server enforcement.
This checkpoint edits only this ledger; no app/E2E edits or gate runs occurred.

### Main receipt — connected DEV refresh / phone Search harness — 2026-09-08

- **Refreshed connected DEV: 3/3 PASS**, covering DM wire/decrypt, locked
  behavior and invite; Main reports **3.8 minutes**. Evidence:
  `/tmp/onyx-connected-evidence.7kJLLz/final-connected-dev`. This is connected
  DEV evidence, not deployed-production or built-candidate acceptance.
- Read-only inspection confirms Euler's current phone Room actions menu has
  `ribbon-more-search`, role `menuitem`, named **Search messages**. Its handler
  closes the popover and focuses the persistent Room actions button before
  opening Search. Source presence is not a new browser pass or source freeze.
- The contextual Search case now uses that real menu route at 390px/320px and
  requires Escape to restore focus to **Room actions**. Desktop retains the
  existing ribbon Search route. Search-input focus, loaded-result navigation,
  locked-text exclusion and Account's strict Back-visibility assertion remain
  intact. This bounded E2E correction is **pending Main's built-browser run**;
  the last contextual receipt remains 3/6 PASS.

Only the contextual spec and this ledger changed in this checkpoint. No app
source edits, tests, browser runs, build, deployment or Git operations occurred.
Final integrated release gates remain open; counts above are not additive.

### Main receipt — corrected contextual passes / gallery geometry P2 — 2026-09-08

- **Run `25718`: corrected contextual subset 3/3 PASS in 30.6 seconds**, on
  interim build `a772163…`. Main verified all nine Account categories and Back
  visibility at 320px; normal-phone Search's two loaded matches, locked-text
  exclusion and Escape focus return; and actual Pearl/custom computed tokens
  with persisted selection. These supersede those three failures, not the
  requirement for final integrated acceptance. Do not add separate run counts.
- **Astra identified two gallery CSS P2 findings:** Pictures tab text overflows
  at 320px, and the loaded image overlaps its filename. **Euler** owns the
  CSS/direct-test correction; neither finding is closed by the earlier passing
  gallery consent journey.
- The contextual gallery case now checks each full tab label's rendered text
  bounds and scroll dimensions against its button (1px geometry precision),
  and checks positive actual loaded-image/filename boxes for non-overlap.
  Both run at all three existing widths. All preference-off, preference-on,
  zero-request-before-consent, explicit local fixture Load, privacy and
  separate Jump checks are preserved. New geometry assertions are **unrun**;
  Main will rerun after Euler's fix.

Only the contextual spec and this ledger changed here; no app source edits or
gate execution. L4c remains active with Gauss, and this is not the final
candidate. Final full suite, build, Astra acceptance, deployment and Git gates
remain open. No completion, deployment or publication claim is made.

### Main receipt — all source frozen / final gates starting — 2026-09-08

- **Gauss L4c frozen: 14/14 PASS and typecheck PASS**, CSS **8,786 bytes**,
  reported net shrink. Astra review requested; source handoff is not final
  moderation/security acceptance.
- **Actual built front-door connected smoke: PASS at 02:09 UTC**, using
  `public-connected-smoke` against preview port **4790**. Main reports two new
  guests, desktop 1440px and phone 390px, joining a fresh QA room through the
  actual UI; two bidirectional messages rendered on both, **zero overflow and
  zero page errors**. No store seed or override was used. This is built-preview
  connected evidence, not deployment or universal server/privacy acceptance.
- **Euler's last gallery CSS correction is frozen:** reported **2-byte net
  shrink**, **15 existing tests PASS**. App source is now **SOURCE FROZEN**.
  The gallery geometry browser assertions remain unrun after this final fix.
- **Contextual E2E is complete and frozen:** all six cases retained. Gallery
  checks full Pictures/Files/Links label containment and positive loaded-image
  and filename boxes with no overlap at all three widths. Consent/privacy and
  separate Jump assertions remain intact; no assertions were weakened.
- **Main is starting final full suite / typecheck / lint / build.** Results
  are pending, as are final browser verification and Astra acceptance. Earlier
  focused counts are not summed or substituted for these integrated gates.

This receipt is documentation-only; the already-authored geometry assertions
were inspected read-only and the E2E file remains frozen. No app source edits
or gate runs by this writer. **Not deployed, committed or pushed** by this
checkpoint; no final-green claim.

### Main receipt — final-candidate build / integrated checks pending — 2026-09-08

Main-reported results, not rerun by this documentation writer:

- **Final-candidate build `68143`: PASS in 22 seconds; AppShell budget PASS.**
  Supplied candidate digest:
  `89615675d41de710e9bfdb4ffa20571140dbbf647570f9268ca1a8676dc8d22a`.
  AppShell CSS: **379,497 bytes raw / 56,406 bytes gzip**, raw ceiling
  **380,503 bytes**. JS: **508,954 bytes raw / 152,965 bytes gzip**.
- **Current typecheck/lint `66753`: PASS, 0 errors / 33 warnings.** This
  supersedes the earlier current-status claim of 32 baseline warnings. The
  additional warning is `solid/reactivity` on PresenceRibbon's queued callback;
  it is not the earlier Grok mid-write helper warning and is not claimed fixed.
- **Full unit suite `94613`: running.** No final file/test counts or pass
  result yet.
- **Chromium 21 cases and WebKit contextual six cases: running.** No pass
  totals yet; earlier subset receipts do not grade these candidate runs.
- **Landing budget `32055`: running.** The AppShell budget pass above is not
  a landing-budget result.

This is a successful build/budget checkpoint, **not overall final acceptance**.
Astra/release acceptance and deployment/Git gates remain open. Documentation
only: no app/E2E edits, gate execution, deployment, commit or push by this writer.

### Main correction — Chromium selection / landing budget — 2026-09-08

- The actual final Chromium command selects **14 tests**, not the earlier
  estimate of 21: six contextual, four gamer, two roster, one search and one
  preferences case. This is the selected count, **not a passing result**.
  Record the actual completed result when Main supplies it.
- **Landing budget `32055`: PASS**, **36.66 KiB gzip**, **three eager files**.
  This supersedes its pending status in the preceding receipt.

Final browser results remain pending. E2E files remain frozen throughout the
active runs; this correction changes only the ledger and makes no overall-green
or deployment claim.

### Main receipt — browser results / gallery synchronization / reopened L4c — 2026-09-08

- **Chromium: 13/14 PASS in 3.8 minutes. WebKit contextual: 5/6 PASS in
  4.4 minutes.** Both runs are done. Their only failure was gallery
  `scrollIntoViewIfNeeded` detachment at line 206 after reopening through the
  real preference change: Chrome 390px, WebKit 320px. The failed step preceded
  that width's Load/image geometry checks; no geometry-failure claim follows.
- Read-only traces show vault loading before scrolling, then completion with
  the replacement Jump row present. Source rebuilds indexed row objects when
  the async vault resource completes. The scroll failure occurred in about
  81ms on Chrome and 432ms on WebKit, consistent with a stale action handle
  during row replacement rather than a persistently missing control.
- With both runs finished, the contextual harness now waits for gallery
  loading to disappear, then retries only locator-resolved scrolling and its
  viewport assertion within a **5-second retry window**, with 1-second
  per-operation timeouts. Applied at initial open and reopen. No click is
  retried or forced; consent, privacy, geometry and separate Jump assertions
  are unchanged. **E2E refrozen, unrun; Main reruns gallery in both engines.**
- **Firefox public: 17/21 PASS.** Four focus-heuristic failures are assigned
  to Euler's four-spec-only scope; no app-source correction is claimed here.
- **Astra L4c P2:** same-channel account/server/client replacement can leave
  review authority true while the pending intent belongs to the prior owner.
  This is source-derived, not a server-bypass claim. Gauss owns exactly
  Cockpit/BanList plus their tests to capture owner/client and verify at
  confirmation. Other app source remains frozen.
- **Unit run `94613` is checkpoint evidence, not final release evidence.**
  One vaultSync cache-test failure has been observed; full report is pending
  and Main is pursuing focused reproduction. Main will rerun the full suite
  after the corrected source is stable.

Only the contextual spec and this ledger changed in this writer checkpoint.
No app-source edits or test/browser/build/Git/deploy execution. Final integrated
acceptance remains open; separate receipts are not summed into a green total.

### Main receipt — stable gallery browser passes / vaultSync test follow-up — 2026-09-08

- **Corrected gallery Chromium: 1/1 PASS in 35.1 seconds. WebKit: 1/1 PASS
  in 1.2 minutes**, on build `89615675…`. Both cover all three existing
  widths, actual tab-label/image geometry, privacy and explicit image consent.
  Main's artifact directories are
  `/tmp/onyx-connected-evidence.7kJLLz/gallery-stable-chromium` and
  `/tmp/onyx-connected-evidence.7kJLLz/gallery-stable-webkit`.
  These resolve the gallery harness failure as separate rerun receipts; they
  are not a newly executed combined browser-suite total.
- Gallery source and contextual tests remain **frozen**. No source geometry
  or privacy workaround was added by this writer.
- **Euler vaultSync test-only follow-up: 28 PASS**, using async durable-state
  polling after close. This is a focused test receipt, not a full-suite pass.
- **Full suite `94613` remains checkpoint-only**, finishing with the old
  failed case. Main will rerun the full suite after Gauss's owner fix; no final
  full-suite result or release acceptance is claimed.

Documentation-only append; no source/test edits or gate execution by this
writer. Final review/release gates remain open. Not deployed or pushed.

### Main receipt — Firefox keyboard correction verification — 2026-09-08

- **Firefox run `80506`: corrected four specs, 5/5 PASS in 24.3 seconds**,
  including the install alias. Main verified the actual keyboard loop on
  **Download / Roadmap / Stats / Status**.
- Public app source is unchanged from build `89615675…`; this is verification
  of the corrected test approach, not an app-source repair receipt.
- The earlier **17/21** result and this **5/5** correction run overlap and
  **must not be summed** into a newly executed suite total.
- Main reports **no browser runs currently active**. Source and tests remain
  frozen; this does not close pending full-suite, owner-fix or release gates.

Documentation only; no source/test edits or execution by this writer. No
overall final acceptance, deployment or push claim.

### Main receipt — full unit checkpoint `94613` completed — 2026-09-08

**Checkpoint only, not final release evidence.** Main reports artifact
`final-unit.json` and elapsed time **706.53 seconds**:

| Unit checkpoint | Total | PASS | FAIL | Skipped |
| --- | --- | --- | --- | --- |
| Files | 604 | 602 | 2 | — |
| Tests | 7,570 | 7,568 | 2 | 0 |

The two failures reported by Main are:

- **vaultSync async test:** this run executed the old test before Euler's
  test-only durable-poll correction; the correction's separate focused receipt
  is **28 PASS**. It does not retroactively turn this checkpoint green.
- **`harbor-phone.test`:** stale Download display-heading weight 400
  expectation versus the authorized task-heading weight 700/sans design.
  **Euler owns the test-only correction**, currently in progress.

Main reports **no new application regression known from this suite**, not a
blanket absence-of-regressions claim. Main still needs a full corrected rerun
after Gauss's moderation owner/client fix and test corrections are stable.
Documentation-only receipt; no app/test edits or gate execution by this writer.
Final integrated acceptance, deployment and Git gates remain open.

### Main receipt — final r2 source handoff / gates pending — 2026-09-08

- **Source and tests frozen for r2.** Gauss's moderation owner/client fix has
  a **16-test** handoff; Main's separate **five-file 55/55 PASS** receipt is
  not an additional unique-test total. Astra SOURCE closure remains pending.
- **Typecheck/lint `97319`: PASS, 0 errors / 33 warnings.**
- **Build `48807`: PASS in 19.77 seconds; budget PASS.** Supplied digest:
  `2e75a9d46fb5d33f8e6c580587e3ce603a81b71a5ee0020ace6bed66d1c3775a`.
  AppShell CSS: **379,497 bytes raw / 56,406 bytes gzip**.
  JS: **508,954 bytes raw / 152,958 bytes gzip**.
- Main-supplied **source/test binary-diff hash**:
  `e370506d174a495b9f78b6a72bbafd590b265c65fa58b0cef086a05932dc91f9`.
  Main describes its scope as `git diff --binary` over src/index/deploy/tools;
  this writer did not execute Git or recompute the hash. The collection CSS
  has a **separate, unchanged** hash, supplied only as `2d479736…`; no full
  digest is inferred or claimed for that separate file.
- **Fresh Chromium contextual six cases / WebKit moderation one case:
  running**, with no result yet. Earlier browser results do not grade these
  r2 runs.
- **Full r2 suite has not started:** Main is waiting for Astra SOURCE closure
  to avoid another edit race. The old `94613` result remains **checkpoint-only,
  7,568 PASS / 2 FAIL**, not full-suite green for either candidate.

This docs-only checkpoint records Main's supplied receipts without running
checks or changing app/tests. Final review and release gates remain open;
no deployment, commit or push claim.

### Main receipt — r2 browser acceptance receipts / staging-only dry run — 2026-09-08

- On post-correction build `2e75a9d4…`, **Chromium contextual 6/6 PASS in
  1.0 minute**, covering all six cases at all three widths. **WebKit moderation
  1/1 PASS in 17.4 seconds.** These supersede the pending status of those
  exact r2 runs.
- Main reports **all known browser failures closed through scoped reruns**.
  This is not a newly executed combined browser-suite total; keep prior and
  correction receipts separate.
- **Typecheck/lint PASS: 0 errors / 33 warnings.** No zero-warning claim.
- Main is performing a **deploy dry run, staging only**, with **no `out/`
  writes**. No dry-run completion result was supplied, and this is not a live
  deployment receipt or authorization to publish.
- **Full unit r2 remains pending Astra L4c SOURCE closure.** The earlier red
  `94613` checkpoint does not substitute for the required corrected full run.

**NOT DEPLOYED / NOT PUSHED.** Final source-review and full-unit gates remain
open. This writer updated documentation only: no app/test edits, checks, Git
operations or deployment execution.

### Main receipt — deploy dry run `66046` PASS, live bytes unchanged — 2026-09-08

Main reports **PASS** using pnpm 10 and this command; the documentation writer
did not execute it:

```sh
DEPLOY_DRY_RUN=1 ONYX_LIVE_OUT=/home/kain/onyx/out ./deploy.sh
```

- Build, materialized routes, strict new-title checks, staging allowlist and
  SPA fingerprint guard passed. Planned service-worker version:
  **`20260908-043017-79bcd0e9-dirty`** — planned in staging, not deployed.
- Main's pre/post live-file SHA-256 values were identical:
  - `out/index.html`:
    `789103bcd9c625e7bf06b32daa2f3daba8e0b2c88172d3b42789a08ea2e961e3`.
  - `out/sw.js`:
    `830a999a0990c726157d0d0806c4afdd1f4c2a830dfceaab7cdf7b0cd78f2262`.
  Main reports **no `out/` writes**; these two hash receipts specifically
  establish unchanged index/service-worker bytes, not a full-tree hash audit.
- Main reports no existing live downloads directory. Skipping native-artifact
  staging does not remove old artifacts; this run does **not** exercise
  preservation of pre-existing live downloads because none were present.
- Main reports remote HEAD still **`79bcd0e…` on `onyx-solid`**. This is a
  supplied remote-state receipt, not a Git check performed by this writer.

**No actual deployment, push or commit.** Dry-run success does not close the
pending Astra L4c source review or corrected full-unit gate. Documentation-only
append; no app/test edits or execution by this writer.

### Main receipt — Astra SOURCE CLOSED / full unit r2 started — 2026-09-08

- **Astra SOURCE CLOSED `L4C-OWNER`**, the last source finding. Main reports
  **no known source or browser findings open**; this is bounded review closure,
  not a claim that every possible defect has been excluded.
- **Full unit r2 STARTED**, with report path
  `/tmp/onyx-connected-evidence.7kJLLz/final-unit-r2.json`. It is now the
  **only pending predeploy gate**. No completed result or passing count is
  supplied yet; the old `94613` checkpoint must not be used as this run's result.
- Main confirms source/tests are frozen and unchanged final typecheck, lint,
  build and browser receipts remain valid. Deploy dry run `66046` already
  **PASS**; it is not pending and is not an actual deployment.

**NOT DEPLOYED / NOT PUSHED.** This writer remains docs-only: no app/test
edits, gate execution, deployment or Git operations.

### Main receipt — full unit r2 GREEN / production unchanged — 2026-09-08

- **Main run `24693`: exit 0; 604/604 files PASS, 7,573/7,573 tests PASS,
  515.42 seconds.** JSON report:
  `/tmp/onyx-connected-evidence.7kJLLz/final-unit-r2.json`.
- **Predeploy gates are green.** Source and E2E remain frozen; this completed
  r2 receipt supersedes its pending status, not the historical red `94613`
  record. Prior counts are preserved and are not combined with r2.
- **Production has not changed. NOT DEPLOYED / NOT PUSHED.** Main is awaiting
  Astra clearance, then authorized actual deployment, HTTPS hash verification
  and public actual two-peer smoke. **GitHub push last**, after post-deploy
  checks; none of those pending actions is claimed complete here.

Documentation-only update based on Main's supplied receipt. This writer did
not rerun gates, edit source/E2E, deploy, commit or push.

### Main receipt — actual deployment / HTTPS hash verification — 2026-09-08

- Astra issued written predeploy **CLEARED**, and Main confirmed the candidate
  fingerprint before deployment. **Actual deploy `7747`: exit 0**; build
  **12.03 seconds**, same final assets. Deployment stamp:
  **`onyx-shell-20260908-044550-79bcd0e9-dirty`**.
- Recoverable pre-deploy snapshot retained at
  `/home/kain/onyx/.onyx-deploy-backups/onyx-out-20260908-044550-79bcd0e9-dirty`.
  This is the supplied recovery location, not a claim that rollback was run.
- **HTTPS `verify-public.mjs`: exit 0**, checked
  **`2026-09-08T02:46:19.342Z`**. Main reports **169/169 exact SHA-256 matches**
  across 19 root/routes, service worker/manifest and all current JS/CSS.
  - Root SHA-256:
    `5a739bd6a3ab969311dd25334b515e56f4776470fabe1ebdae9dfa2329f61329`.
  - Service-worker SHA-256:
    `91ffb18230d584979be2bb50b0beca417fc345c5a076ae2184b855d180b50d92`.
  Byte identity is deployed-artifact evidence, not a substitute for the live
  two-peer interaction check.
- **Actual public two-peer UI smoke `28608`: running**, no result supplied
  yet. **Git not committed or pushed.** GitHub push remains last after public
  verification; no completed release/publication claim here.

This supersedes the earlier production-unchanged status while preserving those
historical receipts. Documentation-only update based on Main's report; this
writer did not deploy, rerun verification or perform Git/source/test changes.

### Main receipt — bounded production acceptance GREEN / Git pending — 2026-09-08

- **Actual deploy `7747`: exit 0**, stamp
  `onyx-shell-20260908-044550-79bcd0e9-dirty`. Recoverable snapshot:
  `/home/kain/onyx/.onyx-deploy-backups/onyx-out-20260908-044550-79bcd0e9-dirty`.
- **HTTPS `verify-public`: exit 0, 169/169 exact SHA-256 matches, zero
  failures**, at `2026-09-08T02:46:19.342Z`: 19 root/routes, service worker,
  manifest and all current JS/CSS. Exact root/SW hashes remain in the preceding
  receipt; no changed deployed-asset set is reported.
- **Real public `https://eshmaki.me` smoke `28608`: exit 0, PASS at
  `2026-09-08T02:46:27.374Z`.** Two actual guest connections through the UI,
  desktop 1440px and phone 390px, joined a synthetic fresh QA room. Two
  bidirectional messages rendered on both; **no overflow, zero page errors**;
  browser contexts closed. **No fixture and no store seeding.** This proves
  the bounded public guest/chat journey, not hardware, account authentication
  or peer-media behavior.
- Main confirms the **same frozen source hash and final built assets**.
  Predeploy gates and bounded post-deploy acceptance are **GREEN**.
  **Git publication remains pending: not committed or pushed.**

Historical red checkpoints, pending-stage receipts and separate run counts are
preserved. This documentation handoff is complete and **frozen for Main's
staging**. Only this ledger was edited; this writer performed no app/E2E edits,
test/deployment execution or Git operations.

### Main receipt — actual public landing / final source integrity — 2026-09-08

- **Actual public landing run `83693`: exit 0.** Widths **1440 / 390 / 320px
  all PASS**: current title, visible H1, no horizontal overflow and no page
  errors. Screenshots:
  `/tmp/onyx-connected-evidence.7kJLLz/public-final-{width}.png`.
  Main independently viewed the **320px full-page screenshot**. These are
  bounded actual-public landing checks, not fixture or universal layout proof.
- Main confirms the post-deploy source hash still matches
  `e370506d174a495b9f78b6a72bbafd590b265c65fa58b0cef086a05932dc91f9`,
  and reports **diff check PASS**. This writer did not run Git or recompute it.
- **Documentation complete and frozen for Main's staging.** Deployment and
  bounded production acceptance remain green. **Git publication is pending**;
  append confirmed publication only after Main's first commit/push receipt.

Only this ledger changed. No source/E2E edits or test, deploy or Git execution
by this writer. Historical receipts remain preserved.

### Main receipt — source release publication CONFIRMED — 2026-09-08

- **Source release commit:**
  `9382b8d2626eaaa507fbe8658b16f87616f24d9f`, **168 files**.
- Main reports `git push github HEAD:refs/heads/onyx-solid` **exit 0**, run
  **`17853`**, and independent `git ls-remote` confirmation of exact remote SHA
  **`9382b8d2626eaaa507fbe8658b16f87616f24d9f`**.
- **Source release publication COMPLETE** on the current default branch
  **`onyx-solid`**, integrated directly. **No PR or `main` merge is claimed.**
  App source is unchanged; this receipt follows the recorded deployment and
  bounded production acceptance.
- **This final documentation receipt still awaits its own commit/push.**
  No unknown self-hash or already-published claim is made for this update.

Only this ledger changed; historical pending/publication-stage receipts remain
intact. No new audits, gates, source/E2E changes or Git execution by this writer.
**Ledger refrozen for Main's documentation commit.**
