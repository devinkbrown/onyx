# Era 3 — 20× platform wave (2026-07-25)

Integration ledger for the **onyx-platform-20x** expansion wave on branch
`onyx-solid`. Complements `docs/era3-40-game-changers.md` (item-level truth).

## Named partials closed this integrate

| Partial | Fix | Status |
|---------|-----|--------|
| `linkPreview` ↔ `mayUnfurlUrl` | Privacy prefs (`linkPreviews`, https-only, blocked hosts) threaded into `isPreviewableUrl` / `pickPreviewUrl` / `fetchLinkPreview` | **SHIPPED** |
| `searchVaultHybrid` recency | `vaultHitAgeMs` reads **`hit.message.time` only** (Date / ms / ISO); post-RRF `boostedScore` with same-room + self-nick | **SHIPPED** |
| prefs `reactionDensity` | `REACTION_DENSITIES` + persist/sanitize; PreferencesPanel control | **SHIPPED** |
| `BoostBar` density modes | Renders from prefs density (full / compact / counts-only / hidden) | **SHIPPED** |
| `shortcutsRegistry` | Expanded chord set + `formatChordDisplay` + `shortcutById`; wired via `useKeyboardShortcuts` | **SHIPPED** |

## Additional slices wired this wave

- Oper EVENT REPLAY JSON parse (`lib/irc/eventReplayJson`) + OperEventConsole
- Group E2EE envelope fail-closed edges + tests
- Multi-device safety number (`safetyNumberForDeviceSet`) + DmSafetySheet
- Media padlock honesty → callSecurity / VoiceBar
- SFU cascade indicator → VoiceBar
- Scheduled send queue + store
- Webhook Block-Kit flatten → NOTICE / MsgBody
- Notification body summary polish
- Edit history vault hooks
- Reply privacy helpers + tests

## Worktree harvest

Agent worktrees under `.claude/worktrees/*` were scanned. Most sit on pre-era3
bases (`9bca011` / `9cf2a50`) with HomeView/era1 fleets already landed on
`onyx-solid`. **No clean disjoint diffs applied** — would conflict with the
already-merged main-tree wave. Server repo untouched (client-only integrate).

## Gates (integrate pass)

- `pnpm typecheck` — green
- `pnpm lint` — green
- Focused Vitest on changed modules — see commit / report
- `./deploy.sh` — SPA → `out/`

## See also

- `docs/era3-40-game-changers.md` — full 40-item status table
- `.grok/workflows/onyx-platform-20x.rhai` — orchestration script
