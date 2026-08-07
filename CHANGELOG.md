# Changelog

Notable user-visible and public-source changes are recorded here. The project
does not yet promise semantic-version compatibility for every client/server
extension; wire contracts are documented separately.

## Unreleased

### Public source release

- Publish the Onyx SolidJS client under AGPL-3.0-or-later.
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
- Includes the SolidJS/Vite client, local history vault, IRC/IRCX transport,
  E2EE direct messages, Cadence media, PWA shell, public information routes,
  account/session surfaces, imports, search, and accessibility coverage.
