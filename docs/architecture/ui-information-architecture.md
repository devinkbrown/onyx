# UI information architecture

## Current boundary

The public site and authenticated shell are separate information architectures.
`src/ui/navigation/publicRouteManifest.ts` describes canonical public paths,
link hrefs, and ordered groups. `src/shell/navigation/shellNavigationModel.ts`
describes the authenticated shell's five product destinations: Home, Rooms,
Messages, Calls, and You. The public manifest now supplies shared public-link
consumers; router declarations remain the runtime authority.

Public canonical `path` match keys omit trailing slashes. Public `href` values
are `/` for Home and trailing-slash destinations elsewhere. Route normalization
ignores trailing slashes, query strings, and fragments before matching a path.
The router may retain compatibility aliases; `/install` remains an alias of
`/download`, not a second public destination. Visibility mirrors the existing
public header:
About, OnyxOS, Roadmap, Status, and Downloads are shown at both breakpoints;
Home is the brand link. Other routable/supporting surfaces remain in the
manifest but are not public-navigation links.

Header placement is explicit metadata: `brand` is the Home brand link,
`primary` identifies links inside the `Primary navigation` landmark, and `none`
keeps supporting routes out of the shared header. `navigationOrder` preserves
the current About, OnyxOS, Roadmap, Status, Downloads order independently from
the manifest's product/trust/resources grouping.

## Shell navigation invariants

- Desktop and mobile expose the same five destinations in the same order.
- Home, Rooms, Messages, and Calls can be current locations. You is an account
  dialog trigger, never a current page.
- A collection's current location, selected collection, and expanded drawer
  state are independent values.
- Calls is a destination only. Navigation metadata must not imply an active
  call, media availability, connection, account state, permission, encryption,
  or authorization result.
- Landmark and action labels are explicit: desktop uses `Primary`; mobile uses
  `Mobile navigation` and `Open {label}` actions.

## Strangler migration order

1. Keep the current router and `PrimaryNavigation` as runtime authorities while
   cross-boundary tests pin their parity with the metadata contracts. The router
   check parses `src/index.tsx` as TSX because that entrypoint renders at import
   time and therefore cannot be imported safely into a unit test.
2. Retain explicit compatibility aliases in the router while remaining public
   link producers migrate to the manifest.
3. Adapt `PrimaryNavigation` to render the shell model while preserving its
   existing callback and ARIA behavior.
4. Move shell view-selection translation into one adapter at `AppShell`; do not
   add global navigation state.
5. Only after connected UI regression coverage proves parity, remove duplicate
   local navigation arrays and route literals.

This ordering keeps route matching, protocol/store ownership, and live call
truth outside the descriptive IA modules until each consumer is explicitly
migrated.
