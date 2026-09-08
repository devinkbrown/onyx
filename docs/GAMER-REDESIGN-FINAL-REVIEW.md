# Gamer redesign — final review ledger

Updated: 2026-09-08. Reviewer: Astra ULTRA. **CURRENT: DEPLOYED; bounded production acceptance GREEN on Main's receipts; source release publication COMPLETE. Final predeploy review CLEARED; frozen-source continuity confirmed. The final docs receipt commit is still forthcoming.**

## Current production receipt and document freeze

Main reports actual deployment session `7747`, exit 0, stamp `onyx-shell-20260908-044550-79bcd0e9-dirty`. Recovery snapshot: `/home/kain/onyx/.onyx-deploy-backups/onyx-out-20260908-044550-79bcd0e9-dirty`.

- **HTTPS artifact verification (R):** `verify-public` exit 0 at `2026-09-08T02:46:19.342Z`; **169/169 exact SHA-256 matches, zero failures**, covering 19 root/routes plus service worker, manifest, and all current JS/CSS.
- **Actual public connected acceptance (R):** `public-connected-smoke` session `28608`, exit 0, PASS at `2026-09-08T02:46:27.374Z` against `https://eshmaki.me`: two actual guest UI connections at 1440/390, two bidirectional messages rendered on both, no overflow, zero page errors, contexts closed. No fixture or store seeding; only a synthetic fresh QA room.
- **Continuity (R):** Main confirms the same frozen-source fingerprint `e370506d174a495b9f78b6a72bbafd590b265c65fa58b0cef086a05932dc91f9` and final built assets. Reviewed candidate digest: `2e75a9d46fb5d33f8e6c580587e3ce603a81b71a5ee0020ace6bed66d1c3775a`.

**Verdict: bounded deployed acceptance GREEN.** This establishes the reported deployed artifact identity and tested public guest-chat journey, not hardware capture, account-authentication journeys, peer media, every application function, or universal commercial quality. Astra did not deploy or independently execute these production checks. Earlier source reviews and screenshot inspections remain separately classified below.

**Source release publication COMPLETE (R):** Main reports source release commit `9382b8d2626eaaa507fbe8658b16f87616f24d9f` (168 files), integrated directly on default branch `onyx-solid`. Push to remote `github`, `HEAD:refs/heads/onyx-solid`, session `17853`, exited 0. Main independently ran `git ls-remote` and confirmed that exact remote SHA. No PR or merge into a separate `main` branch is claimed. Main reports application source unchanged.

**Final docs receipt commit remains forthcoming:** this ledger update is not claimed committed or pushed, and its future commit hash is not yet known. This review document is frozen again for Main to stage after this update; no further reviewer writes are planned before staging. No Git operation was performed by Astra. Earlier HOLD/pending states below are retained historical checkpoints, not the current verdict.

This is an evidence ledger and bounded predeploy review, not a roadmap or independent authorization to execute deployment. Main reports the user's deployment authorization; this reviewer executes no deployment or Git operations. This document is the reviewer's only authorized write path. Application/source inspection is read-only; the reviewer has not run tests, builds, deployment, model CLIs, or agents. Existing entries must not disappear when later receipts arrive: update their status and retain the reason/evidence.

## Evidence classes and checkpoint

- **S — independently inspected source:** current files/diffs reviewed by Astra, including prior turns. Source closure does not establish browser behavior or complete feature correctness.
- **V — independently viewed capture:** Astra inspected the named screenshot. This proves only its visible state, not keyboard behavior, network requests, or all functions.
- **R — reported receipt:** Main or a writer supplied the result; Astra did not execute that check. Writer and Main results are distinguished below.
- **A — independently read artifact:** Astra parsed an existing result artifact; this verifies its recorded results, not an independent test execution.
- **Pending:** no acceptance inferred from a running gate, source freeze, build, fixture, or older capture.

Main reports build session `68143` PASS in 22s plus budget PASS; artifact digest `89615675d41de710e9bfdb4ffa20571140dbbf647570f9268ca1a8676dc8d22a`. Type/lint session `66753`: PASS, zero errors, 33 warnings. One warning is the PresenceRibbon queued-callback Solid reactivity warning near line 525; it is not independently established as a runtime defect.

Latest post-correction R receipts: Main's five-file focused run **55/55 PASS in 19.68s** (16 moderation + 28 vault + 11 harbor). Build session `48807` **PASS in 19.77s**, budget PASS, digest `2e75a9d46fb5d33f8e6c580587e3ce603a81b71a5ee0020ace6bed66d1c3775a`. Reported AppShell CSS raw/gzip `379497/56406`, JS `508954/152958`. Main now reports latest type/lint **PASS, zero errors / 33 warnings**.

On that post-correction build, Main reports **Chromium contextual 6/6 PASS in 1.0m**, each at three widths: Account Back/preferences, notifications/voice, Search, gallery geometry/privacy, moderation permission loss, and actual theme persistence. **WebKit moderation 1/1 PASS in 17.4s**, at three widths. Main reports no known remaining browser failures after the scoped reruns. Astra did not execute these checks; moderation owner-replacement closure is S plus focused R evidence, while the new browser moderation case establishes permission-loss behavior.

**Full-unit r2 GREEN:** Main reports session `24693`, exit 0, **604/604 files, 7,573/7,573 tests, 515.42s**. Astra independently parsed `/tmp/onyx-connected-evidence.7kJLLz/final-unit-r2.json`: `success: true`, 604 file results, no failed file results, 7,573 passed tests, zero failed/pending/todo tests. Its separate suite counter is 1,884/1,884 (suite groups, not file count). Duration and process exit are R; JSON contents/counts are A.

**Final predeploy verdict: CLEARED.** No known source or browser finding remains open; the full-unit gate is green. Review clearance applies to candidate digest `2e75a9d46fb5d33f8e6c580587e3ce603a81b71a5ee0020ace6bed66d1c3775a`. Main freshly confirms frozen-source diff fingerprint `e370506d174a495b9f78b6a72bbafd590b265c65fa58b0cef086a05932dc91f9` matches, `git diff --check` PASS, and no source changes. These aggregate continuity checks are R evidence; Astra has not independently recomputed that aggregate. Astra did reconfirm unchanged hashes for all four corrective L4c files, gallery CSS, and both releaseguard files against this ledger at final review. No new source correction or broader review packet is requested.

Fingerprint continuity is now confirmed by Main; Main may proceed within the user's deployment authorization. Perform actual production verification after deployment; GitHub last, after production acceptance. This predeploy clearance does not claim deployed success, universal commercial quality, or hardware-media proof. A further application change requires reassessing relevant evidence before deployment.

Historical execution checkpoint (R): Main began authorized actual deployment after confirming the fingerprint and diff-check; deployment completion and production acceptance were then pending. **Superseded by the GREEN production receipts at the top of this ledger.** Astra has made no deployment or Git changes.

**Dry-run staging complete, R PASS:** Main reports session `66046` completed using pnpm 10 and `DEPLOY_DRY_RUN=1 ONYX_LIVE_OUT=/home/kain/onyx/out ./deploy.sh`. Build, route materialization, title guard, stamping, allowlisted legacy staging, and unchanged SPA fingerprints passed. Planned stamp: `20260908-043017-79bcd0e9-dirty`. Main reports no actual deployment/out writes and identical pre/post live-file SHA-256 values:

```text
out/index.html 789103bcd9c625e7bf06b32daa2f3daba8e0b2c88172d3b42789a08ea2e961e3
out/sw.js      830a999a0990c726157d0d0806c4afdd1f4c2a830dfceaab7cdf7b0cd78f2262
```

Astra did not run the dry-run or independently collect these hashes. The two matching hashes establish the reported preservation of those files, not an independent complete-tree audit. Dry-run success is not production deployment or deployed acceptance.

**Earlier checkpoint retained, superseded by green r2 above:** Main reported **604 files, 602 PASS / 2 FAIL; 7,570 tests, 7,568 PASS / 2 FAIL / 0 skipped; 706.53s**. The two failures were the asynchronous vault test and the harbor-phone stale Download font contract. Both received reported test-only corrections and focused recovery; final r2 now establishes a complete green run. Browser failures have reported scoped recovery, not a claimed single monolithic all-browser rerun.

## Open findings and acceptance work

### L4C-OWNER — P2: pending moderation review lacks owner/client binding

**Source-closed after fresh independent four-file corrective review. No remaining P1/P2 found in that correction. Post-correction focused, permission-loss browser, and final full-unit passes are recorded above.**

Original finding, retained for audit (pre-correction line numbers):

- `src/shell/ModerationCockpit.tsx:83` and `src/shell/moderation/BanListPanel.tsx:36` invalidate pending review only when `local.channel` changes.
- Their confirm handlers, respectively lines 114 and 65, check matching channel, current permission, and connected booleans, but not the account/server/client under which the review was prepared.
- Source-derived path: prepare block/lift in `#garden`; replace owner/client while the component and channel remain, with current moderation authority true; confirm. Old intent can dispatch through the replacement context. The mobile parent at `src/shell/AppShell.tsx:1585` mounts by open/view/channel state, not owner/client identity. This is stale destructive intent, not a demonstrated permission bypass or a claimed new regression.

Correction scope: `ModerationCockpit.tsx`, its test, `moderation/BanListPanel.tsx`, its test. Bind pending review to existing owner/server/client scope, invalidate on replacement, and compare synchronously at dispatch. Preserve offline form drafts separately; no protocol/store/helper rewrite. Required regression: prepare under A, replace account/client under the same channel with permission true, attempt stale confirmation, assert zero mutation commands; a fresh review under B must work, for both block and lift.

Reviewed pre-correction SHA-256:

```text
ModerationCockpit.tsx cc2c7da773e0aefed87e2023c82c822930715073827f61f29679abd9dd99e8a1
BanListPanel.tsx     728aa28c3e36fa1c00a8b7b08f673b6396af78d7dc4a6d16e71ce1f6634cc1ee
```

L4c otherwise: channel-change invalidation and current permission/disconnection rejection are S-accepted. `ModerationActionReview.tsx` was unchanged; validation, review-first dispatch, blocked explanations, and cancel-focus wiring remain. Eight original scoped files were stable during inspection. Main independently reported pre-correction 14/14 PASS in 6.92s; writer reported 14/14 and type PASS. Those older results did not cover the replacement scenario.

Corrective S closure:

- `ModerationCockpit.tsx:61` / `moderation/BanListPanel.tsx:34` capture account, server ID/URL, client object, and existing device-memory context. The existing read-only helpers bind normalized owner namespace, client, and account generation (`src/lib/store/store.ts:5679`).
- Custom equality covers those identities and device-memory owner/generation; `useStore` subscribes through that equality. Effects at Cockpit line 140 / BanList line 93 clear pending review, captured authority, and stale return-focus target on replacement. Channel-change invalidation remains. Form input drafts are not cleared by these effects.
- Dispatch handlers at Cockpit line 184 / BanList line 135 synchronously compare the captured authority with current state, in addition to current connection/permission/channel checks. The send path has no asynchronous gap between that check and dispatch. Successful send and cancel clear captured review authority.
- Both new regressions retain A's confirmation element, replace account/server/client while the channel and permission remain, observe proactive dismissal, attempt the stale element, assert no corresponding block/lift command through A or B, then prove a fresh review can send through B. Cockpit also asserts its typed mask survives. Writer reports corrective 16/16 PASS; Astra inspected but did not execute these tests.
- Coverage boundary: the new tests combine replacement fields and exercise post-invalidation stale elements; they are not separate runtime proofs for every individual identity field, generation-only change, or the pre-effect dispatch window. Those guards were inspected in source. No concrete remaining defect found in the bounded correction.

All four corrective hashes matched before and after independent inspection:

```text
src/shell/ModerationCockpit.tsx                  91aa134c5327e2f2da8ef34243bce1409a1d1e6ffbe23eab94004a3186dd12dc
src/shell/ModerationCockpit.test.tsx             a7746fd14a62ffdcd7e255af39b4ee30a2ac99dcb89bdfe97e2dcbb210900726
src/shell/moderation/BanListPanel.tsx            e8b3c8e0ab74f6df5a08a6804fecaccf6481e9c4132cc6ad4d9ba3e691d228ea
src/shell/moderation/BanListPanel.test.tsx       6278de0aa1624437ec265bf4cbcbbb56c2fad6a4ab455ec9f1d35d65b08c1c7a
```

### GALLERY-TABS / GALLERY-IMAGE — two P2 visual defects

**Closed: corrections S-accepted; fresh 320px Chromium/WebKit captures V-accepted; Main reports three-width geometry/privacy PASS in both engines.**

Astra and Main independently viewed the 320px defects in:

`/tmp/onyx-connected-evidence.7kJLLz/contextual-journeys/contextual-redesign-contex-5fa81-ump-to-real-loaded-messages-chromium/`

- `media-before-consent-320.png`: PICTURES label spills toward FILES.
- `media-explicit-load-320.png`: loaded preview overlaps the filename.

Euler's frozen CSS correction changes `src/shell/room-media-index.css:32` to content-sized wrapping tabs and lines 92–98 to an absolutely positioned image inside a relative aspect-ratio frame. S-accepted; no text-clipping workaround. CSS SHA-256 `df55eef649ae050298b73f6789cb082d2089cb67410ffd4ef064eca164024d32`. Privacy TSX/tests remained unchanged. Writer reports existing privacy 15/15 PASS; this is not new geometry proof.

The earlier detached/stale gallery test failure was subsequently addressed, per Main, by waiting for media I/O and bounded non-activating scroll retries (no click retry). Main reports actual three-width geometry plus privacy PASS on build `89615675…`: Chromium session `53562` in 35.1s and WebKit session `28576` in 1.2m. This supersedes the gallery-specific pending browser result, not the complete browser/full-unit gates.

Astra independently viewed all four fresh `media-before-consent-320.png` / `media-explicit-load-320.png` captures under:

- `/tmp/onyx-connected-evidence.7kJLLz/gallery-stable-chromium/contextual-redesign-contex-5fa81-ump-to-real-loaded-messages-chromium/`
- `/tmp/onyx-connected-evidence.7kJLLz/gallery-stable-webkit/contextual-redesign-contex-5fa81-ump-to-real-loaded-messages-webkit/`

In both engines, all three tab labels remain within separate controls, and the loaded preview frame ends before the filename rather than overlapping it. Load and Jump are visually separate. V closure is limited to these two reported defects at 320px; network-request/consent behavior and the other widths are R evidence, not inferable from screenshots. Existing privacy closure stands.

### VAULTSYNC-CHECKPOINT — test synchronization receipt

Main reports the full-unit failure was `read []` versus remembered content: an optimistic asynchronous watermark became visible before persistence completed. Euler's bounded test-only correction polls actual persistence after close, preserving all assertions; focused result 28 PASS. No production vault changes reported. Astra has not independently inspected this test correction or reproduced the diagnosis. The focused receipt alone was not full-suite closure; final r2 now provides the separately recorded complete green result.

### CHECKPOINT-TESTS / FIREFOX — reported recovery

- Main identifies the only other full-checkpoint failure as `harbor-phone`'s stale Download font contract. Both failing tests received test-only corrections: Main vault 28 PASS; Euler combined Harbor + vault 39 PASS. These are R focused receipts, not a new complete unit run or independent source review of the test changes.
- Main reports Firefox four-spec keyboard run **5/5 PASS in 24.3s**, exercising actual keyboard semantics and covering the earlier four failures. Those four Firefox failures are closed on R evidence; no independent browser execution claimed.
- **No known source review finding remains open after L4C-OWNER's corrective S closure.** Gallery's two visual P2s remain closed. Final full-unit verification is green; Main has confirmed aggregate fingerprint continuity. No predeploy review condition remains outstanding for this candidate.

### Final disposition / publication ownership

- Main: aggregate source continuity is R-confirmed. All known predeploy review findings and verification gates are closed for the reviewed candidate; r2 is green. The earlier failing checkpoint is retained, not relabeled.
- Dry-run staging is R-closed by session `66046`. Actual deployment is R-complete by session `7747`, with bounded public acceptance GREEN as recorded at the top; this reviewer performed neither.
- Main/Mill: no known remaining browser failures are reported after scoped reruns. Preserve prior batch evidence at `/tmp/onyx-connected-evidence.7kJLLz/final-chromium` and `final-webkit-contextual` alongside the fresh passes; do not rewrite earlier failing batches as all-pass.
- L4c corrective source is frozen and S-closed; post-correction permission-loss browser acceptance is now reported for Chromium/WebKit. No additional implementation requested by this review.
- Final predeploy review is cleared and bounded production acceptance is GREEN for the recorded deployment. Source release publication is R-complete at `9382b8d2626eaaa507fbe8658b16f87616f24d9f`, after production acceptance. Only the forthcoming final docs receipt commit/publication remains Main-owned; this ledger does not claim that future step complete. No full commercial-quality, hardware-media, or all-functions claim.

## Closed findings / bounded acceptance

| Finding | Status and evidence | Limits |
| --- | --- | --- |
| Reply/withdrawn/encrypted text privacy | S-closed: withdrawn-first reply guard; MessageView encrypted-boundary/body/ARIA guards; Composer resolves already-armed reply against latest buffer and updates withdrawn snapshot. Main reports frozen privacy 85 PASS. | No blanket claim about every unrelated sink. |
| Theme validator | S-closed: finite brand-action allowlist without loosening URL/CSS grammar. Main reports 33 PASS. | Not proof of every possible custom-theme visual combination. |
| Recording start truth (prior P2) | S-closed: MediaEngine explicit start result; VoiceBar enters Recording only on accepted start, with rejected/missing/thrown starts handled. Main reports correction packet 153 PASS; final recording-focused 123/123 was also reported earlier. | Browser-local capture only. Recording lifetime/race fixes were reported and reviewed in the bounded client packet; no hardware capture, remote audio capture, or universal repeated-call proof claimed. |
| CallsHub/AppShell DM navigation (prior P2) | S-closed: return action handles channel/peer and rechecks live call/target; navigation does not start/join/accept a call. | Not hardware-media acceptance. |
| PublicInfo slashless routes (prior P2) | S-closed: explicit canonical/slashless allowlist; unknown/suffix routes rejected. Main reports Euler correction packet 50 PASS. | No arbitrary routing grammar expansion. |
| Guides recording claim | S-closed: visible/shareable copy distinguishes no automatic recording from optional local recording of one's own audio. Writer reports 28 PASS. | Not proof of capture availability on every browser. |
| L2 roster measurement/reflow | S-closed: per-identity heights, anchor rebasing/cap; measurement signature excludes first-row away italics; responsive nickname column fixes. Main reports built `571146e7` strict desktop/mobile 3k roster 2/2 PASS, root16/32, resize, far-end/back. | Exact earlier CPU hang not reproduced/proven resolved. Evidence: `/tmp/onyx-connected-evidence.7kJLLz/l2-built-fixed`. |
| G4 status / announcers | S-closed: Account action error takes precedence over generic pending; error alert retained. Preference storage and reset confirmation statuses distinctly named. Main reports 149/149 PASS. | No unrelated account-command changes accepted by implication. |
| G4 phone category visibility | S-closed: indexed default hide and more-specific selected reveal replace blanket exclusion. Main subsequently reports all nine categories visible at 320 on `a772163`. | Scope is tested category flow, not all account operations. |
| G4 Back focus/scroll | S-closed at Account.tsx lines 175/631: preventScroll focus, nearest modal-body-only conditional scrollBy with behavior `auto` (not `instant`). Geometry tests cover Session +140px and visible Overview no-scroll. Main 41/41 plus actual `a772163` 320px all-nine-category result closes reported runtime defect. | No window scroll / scrollIntoView in this correction. |
| Phone Search entry | S-closed: context-actions room/DM menu item closes More, checks surviving trigger/current view, focuses trigger, opens existing Search. Writer 33 PASS; Main `a772163` reports three-width matches/locked-result/Escape-focus PASS. | Coordinator unchanged; no network command on opening. |
| Gallery automatic remote-fetch P1 | S-closed, with R runtime closure: explicit remote per-item consent, preview preference/URL policy, no-referrer, scope/URL/identity consent reset, separate Jump. Main built `9e318531` reports actual interception at 1440/390/320: disabled previews no img/load/request; enabling Preferences alone zero requests; explicit Load triggers fixture PNG; protected entries absent. Main subsequently reports geometry/privacy PASS in Chromium and WebKit on `89615675…`. | Synthetic intercepted PNG, not arbitrary remote-media/hardware proof. Both separate visual P2s are now closed as detailed above. |
| L4b notifications/voice | S-accepted: history count/action scope agrees; navigation/focus safeguards preserved; push permission/host/async guards and explicit speaker chooser/epoch/disposal handling unchanged. Writer reports 43/43; Main actual panels PASS at three widths. | Bounded source and contextual evidence, not all devices/push-delivery environments. |
| Release title guard | S-closed: shared fixed-string full title-element check before deployment and after sync matches index title; legacy/wrong/punctuation/extra-text/metadata-only cases rejected. Main independently reports controller 113 PASS. | No deployment performed. Source guard, not comprehensive HTML-parser validation. |

Releaseguard reviewed stable hashes:

```text
deploy.sh                       6d94a514599c6ba27abc0d42b8f7f827a6698be4fdc16cdbe383a506a9b0a724
tools/deploy-controller.test.sh d0b002e441a29d178736a8e39380ecbdb1818a6e9c0adbd99f217edeb0ef9c54
```

Gallery privacy source hashes (unchanged through CSS correction):

```text
RoomMediaIndex.tsx      2b80675b5a219ead0bb03f507786932e8c28f8a9d6b4d4d79e19d01cddf7a557
RoomMediaIndex.test.tsx 9918b891713760d7ce89988a6ff070d64cacf98eec6c6ef168a21ee4b8df7b6c
```

## Additional receipts and visual boundaries

- G2 Connect atmosphere stacking blocker: Main reported rebuilt fixed desktop/phone captures after `.conn-stage` position/z-index correction. The earlier browser-injected diagnostic was not final proof. This ledger does not substitute a fresh independent view of those captures.
- Main reports public Chromium 16/16, public keyboard Firefox 1/WebKit 1, and WebKit gamer 4/4 on the earlier `571146e7` checkpoint. Documented sub-1px hidden-edge tolerance preserved hidden/pointer/focus invariants. The later four Firefox failures are separately closed by the reported four-spec 5/5 keyboard run above, not by these older receipts.
- Main reports corrected contextual 3/3 in 30.6s on `a772163`: Account Back, phone Search, and actual Pearl/custom-token persistence at three widths. Earlier 3/6 contextual failures are superseded only for those named cases.
- V sample from `contextual-journeys`: desktop gallery; desktop/320 notifications; desktop Email and 320 Email/Session were readable without another concrete visual blocker. Gallery's two V defects are recorded above. Scrolled content outside the viewport is not automatically clipping. These captures predate later fixes and cannot certify those fixes.
- Main reports connected DEV 3/3 in 3.8m after server restart: two-peer DM ciphertext on wire/decrypted rendering, missing-key locked/no plaintext, room invite creation to recipient preview. Local origin `127.0.0.1:5174` to real `wss://eshmaki.me:8080`; not production-deployed acceptance.
- Main reports actual built frontdoor blackbox: two guest UI connections at 1440/390, two bidirectional messages, zero overflow/page errors; preview port 4790 to real network, no seeded/mock connection. Not production-deployed acceptance.

Source changes after a checkpoint require fresh relevant verification. Passing receipts accumulate evidence; they do not erase unresolved findings or authorize deployment.
