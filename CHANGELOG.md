# Changelog

Notable user-visible and public-source changes. The project doesn't yet promise
semantic-version compatibility for every client/server extension; wire
contracts are documented separately.

## Unreleased

### Interface overhaul (2026-11-05/06)

- **Connect gate** before the app: continue as guest, sign in, or create an
  account. Passwords stay in the private runtime.
- **Five destinations:** Home, Rooms, Messages, Calls and You. Desktop has an
  icon rail and sidebar; phones get a bottom bar, full-page conversations with
  Back, and a full-screen You.
- **Conversation view:** room header with topic, member count and details;
  grouped messages with gutter times, day and "new" dividers, load-older and
  jump pills; message menu as a popover or phone bottom sheet with quick
  reactions; reply bar; growing one-row composer with a + tray on phones.
- **Inbox** as a modal sheet with typed rows that jump to their message;
  actionable invites and kicks; server notices no longer filed as DMs.
- **Themes:** token layer, working Pearl light theme, "match device" default,
  new Graphite, Sepia, Mist, Plum and High contrast looks; applied before first
  paint and AA-checked.
- Real modal dialogs with inert backgrounds and focus restore; members grouped
  by role with badges; plain-language error messages; 44px touch targets on
  phones; call bar across the shell; `/stats` charts fixed.
- "Local services and recovery" moved to **You > Advanced**.
- New public website built from real app screenshots
  (`elm/tools/marketing-capture.mjs`), light and dark, iOS theme-color and
  safe-area handling.
- Retired the `ircx.us` node from the node list.

### Wire fixes

- Request `draft/metadata-2`; without it METADATA was refused, breaking DM keys
  and display names.
- Send `EVENT` subscriptions only after IRCX `800`.
- No `CHATHISTORY` before registration (`001`).

### Updates and deploys

- Returning visitors get new deploys: the legacy `onyx-shell-*` cache is
  removed on takeover, and the runtime activates a waiting build when the page
  is idle, then reloads once.
- `/onyxos/` is excluded from the service-worker precache (its bytes come from
  another site and failed the install everywhere).
- New `tools/verify-live-shell.mjs` checks every precached asset hash at the
  public origin.
- `deploy.sh` defaults to `ONYX_CLIENT=elm` and supports the Elm service-worker
  envelope.

### Testing

- Permanent Playwright UI audit (`pnpm test:e2e:elm:audit`): 628 checks across
  Chromium dark/light/reduced-motion and iPhone 13, iPhone 13 light and iPhone SE
  emulation, with opt-in stock Firefox.
- Encrypted-room lab (`elm/tools/lab/run.mjs --suite group`) passes all 8
  stages against a local Onyx Server.

### The SolidJS client is removed

- Merge `a6f98902`: the Elm client in `elm/` is the only client. The SolidJS
  app, routes, shell and store are deleted; the last commit containing them is
  the tag `solid-client-final`.
- `src/` keeps only the shared modules `elm/runtime` imports (Cadence media,
  E2EE helpers, IRC parser).
- `pnpm build`/`dev`/`preview`/`test:e2e` now target the Elm client (clean
  `dist/` + `tools/build-elm-site.mjs`; dev serves on :3000); SolidJS packages
  and config removed.

### Public source release

- Onyx client published under AGPL-3.0-or-later with public README,
  contributor, configuration, testing, security and conduct guides.

## 0.1.1

- Last application version before the public-source release. Shipped the
  SolidJS/Vite client (since removed) alongside the early Elm build.
