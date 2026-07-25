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

## Follow-on wave (post-20x “more”)

| Slice | Status |
|-------|--------|
| encryption-policy=required fail-closed channel send | **SHIPPED** |
| `/clear` local scrollback + `/search` open Search Center | **SHIPPED** |
| `publishDeviceKey` also sets `ocean.dm-keys` | **SHIPPED** |
| Cold vault hydrate toast (device memory honesty) | **SHIPPED** |
| Status buffer capability matrix strip | **SHIPPED** |
| Guest upgrade CTA + E2EE step | **SHIPPED** |
| Notify controls smart-mute summary | **SHIPPED** |
| Slash: ignore/read/star + mark-read ribbon + offline memo toast | **SHIPPED** |

## 10× product surface wave (2026-07-25)

| Slice | Status |
|-------|--------|
| Local slash: mute/unmute, autojoin, highlight, snooze/dnd, color, share, export, notify, help | **SHIPPED** |
| `conversationExport` txt/json download (device-only honesty) | **SHIPPED** |
| ChannelSettings Export transcript section | **SHIPPED** |
| Ribbon More: mute channel + export transcript | **SHIPPED** |
| Composer placeholder discoverability (`/mute /export /help`) | **SHIPPED** |
| Composer accessible name clean of slash noise | **SHIPPED** |
| Shortcuts: mute channel, export transcript | **SHIPPED** |
| Feed empty states (channel / DM / status) with slash hints | **SHIPPED** |
| Ribbon DND chip when quiet hours / snooze / manual DND | **SHIPPED** |
| Composer Tab nick / @-mention completion | **SHIPPED** |
| Message menu: Ignore nick (device-local) | **SHIPPED** |
| Document title attention `(N) Onyx` for mentions | **SHIPPED** |
| Preferences: Ignored nicks list (add/unignore) | **SHIPPED** |
| Member card: Ignore / Unignore | **SHIPPED** |
| Message menu: toggle Unignore when already ignored | **SHIPPED** |
| `/ignore` with no args lists current device ignore list | **SHIPPED** |
| Channel settings: Leave channel (confirm + PART) | **SHIPPED** |

## See also

- `docs/era3-40-game-changers.md` — full 40-item status table
- `.grok/workflows/onyx-platform-20x.rhai` — orchestration script
