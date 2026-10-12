# Changelog

Notable user-visible and public-source changes are recorded here. The project
does not yet promise semantic-version compatibility for every client/server
extension; wire contracts are documented separately.

## Unreleased

### The SolidJS client is removed

- The Elm client in `elm/` is the only client. The SolidJS client, its Vite /
  Tailwind / Playwright setup and the `ONYX_CLIENT` deploy switch are deleted;
  the last commit containing them is the annotated tag `solid-client-final`.
- `pnpm build` is now the Elm build plus `tools/build-site.mjs`, which writes
  every route document, the root `index.html` and the flat `404.html` directly
  (no Vite pass, no overlay). `./deploy.sh` has one path and builds the Elm client.
- The Cadence media engine and canvas background renderer the Elm build bundles
  moved from `src/` to `elm/engine/` with their Vitest suites; the legacy
  `ocean-*` → `onyx:*` localStorage migration now runs from `elm/ports.js`.

### Public source release

- Publish the Onyx client under AGPL-3.0-or-later.
- Replace the private/internal documentation posture with a public README,
  contributor setup, configuration, testing/release, security, and conduct
  guidance.
- Add accurate package and repository descriptions and document the boundary
  between the browser client, the hosted network, and Onyx Server.
- Label E2EE scope precisely: direct-message and Cadence media paths are wired;
  group-room control/key-wrap integration remains separately staged.
- Ignore local deployment backup trees so generated public-site snapshots do
  not enter source publication.

### Product work included in the publication branch

- Continue the responsive product-shell overhaul, public route work, OnyxOS
  route integration, network status surfaces, and associated Vitest/Playwright
  coverage already present in the working branch.

## 0.1.1

- Current application package version before the first public-source release.
- Included the SolidJS/Vite client (since removed), local history vault, IRC/IRCX transport,
  E2EE direct messages, Cadence media, PWA shell, public information routes,
  account/session surfaces, imports, search, and accessibility coverage.
