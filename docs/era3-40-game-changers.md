# Era 3 — 40 game-changing platform items (2026-07-25)

Evidence ledger for the “40 big things” Onyx platform wave. Item-level truth:
**DONE** means code + focused tests in tree; **WIRED** means store/UI path uses it;
**LIVE** means dual-node daemon / SPA deploy accepted.

| # | Item | Status | Home |
|---|------|--------|------|
| 1 | Multi-device DM seal fan-out (C2) | **DONE+WIRED** | `dmCipher.sealDmToDevices`, `sealDmTrustedToDevices`, `store.peerDmDeviceKeys` |
| 2 | Group room E2EE envelope foundation (C1) | **DONE** | `lib/e2ee/groupEnvelope.ts` |
| 3 | File attachment message builder (C4) | **DONE** | `lib/upload/attachmentMessage.ts` (+ existing `upload.ts`) |
| 4 | Slash command platform expansion | **DONE** | `lib/commands/registry.ts` SLASH_COMMANDS |
| 5 | Channel category/folder model (C5) | **DONE** | `lib/channel/categories.ts` |
| 6 | Topic-as-thread history keys (C6) | partial prior | `lib/topics/*`, TopicFilterBar (B9) |
| 7 | Quiet-hours DND | **DONE** prior | `quietHours.ts` + store `isDndActive` |
| 8 | Portable identity export/import (C10) | **DONE** | `lib/identity/portableIdentity.ts` |
| 9 | Oper Event Spine REPLAY console (B14) | **DONE+WIRED** | `shell/OperEventConsole.tsx` + `eventReplayJson` EVENT REPLAY JSON |
| 10 | Call/mention push (C3) | **DONE** server+client | `webpushNotifyKind`; binary `0.5.6+a969f5a` |
| 11 | Read-marker multi-device | prior | draft/read-marker + store markers |
| 12 | Invite encryption-policy badge | **DONE** | `lib/invite/encryptionPolicyBadge.ts` |
| 13 | Composer draft persistence | prior | `lib/composer/drafts.ts` |
| 14 | Search hybrid ranking boost | **DONE+WIRED** | `rankingBoost` + `searchVaultHybrid.vaultHitAgeMs` (`hit.message.time`) + hybrid search UI |
| 15 | Webhook Block-Kit flatten | **DONE+WIRED** | `lib/integrations/webhookBlockKit.ts` → NOTICE store + MsgBody |
| 16 | Cold vault paint before 001 | prior | `hydrateHistory` on connect |
| 17 | Mesh SFU cascade indicator (C8 UX) | **DONE+WIRED** | `lib/media/sfuCascade.ts` → VoiceBar cascade chip |
| 18 | Media E2EE padlock honesty (C7) | **DONE+WIRED** | `lib/media/padlockHonesty.ts` → `callSecurity` / VoiceBar chip |
| 19 | Safety number multi-device display | **DONE+WIRED** | `safetyNumberForDeviceSet` + `DmSafetySheet` device count |
| 20 | KEYTRANS / E2EEKEY Account surface | prior | Account + store commands |
| 21 | Presence heatline | prior | Phase 4 |
| 22 | Channel bookmarks / favorites | **DONE** | `lib/channel/bookmarks.ts` |
| 23 | Smart mute (keyword + noise) | **DONE+WIRED** decision | `smartMute.ts` + `decision.smartMuted` |
| 24 | Scheduled / delayed send | **DONE+WIRED** | `scheduledSend.ts` + `dispatch.ts` + store queue |
| 25 | Message edit history (local) | **DONE+WIRED** | `lib/vault/editHistory.ts` + historyVault hooks |
| 26 | Reaction density modes | **DONE+WIRED** | `density.ts` + prefs `reactionDensity` + BoostBar modes |
| 27 | Link unfurl privacy | **DONE+WIRED** | `unfurlPrivacy` + `linkPreview` mayUnfurl + prefs httpsOnly/blockedHosts |
| 28 | Guest → account upgrade | prior | Connect / Account flows |
| 29 | Network / partition banner | **DONE** | `lib/net/partitionBanner.ts` |
| 30 | Keyboard chord map | **DONE+WIRED** | `shortcutsRegistry` expanded chords + `formatChordDisplay` / `useKeyboardShortcuts` |
| 31 | Mobile composer gestures | prior | mobile primitives |
| 32 | Accessibility live regions | prior | a11y audits ongoing |
| 33 | Theme accent per-room | later | theme factory |
| 34 | Stats deep-link room insights | prior | B10 RoomInsightsStrip |
| 35 | MEMO offline queue | prior | offline memo path |
| 36 | RECOVERYCODES acceptance smoke | server | `tools/era2_acceptance_smoke.sh` |
| 37 | Dual-node mesh post-deploy | ops | `docs/ops/*` onyx-server only |
| 38 | Client capability matrix | **DONE** | `lib/irc/capabilityMatrix.ts` |
| 39 | This acceptance ledger | **DONE** | this file |
| 40 | Gates commit push deploy | **NOW** | typecheck/lint/test + remotes |

## Security notes

- Multi-device fan-out never downgrades a designated E2EE DM to plaintext when
  the directory entry is present but invalid (`store` e2eeDesignated guard).
- Multi-device TOFU pins the full device set; a new device after pin is
  `key-changed` until the user re-pins.
- Portable identity refuses documents that include secret-looking fields.
- Media padlock is honest: `honestPrivate` only when Mooring + E2EE seal + MAC.
