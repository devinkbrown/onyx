> **Archived 2026-11-06.** Historical record from the SolidJS era; paths and status here are not current. See [`../README.md`](../README.md).

# Onyx website and client release — 2026-10-09

The release ships the Elm public website and client through `deploy.sh` with
`ONYX_CLIENT=elm`. The Solid source remains supported and passes its production
build and repository gates. Existing roadmap items are not automatically
complete merely because their UI now renders correctly.

## Completed waves

- **Startup and transport:** minify Elm as a classic script so `Elm.Main` stays
  available under a module package; keep a startup regression test. Process
  complete WebSocket frames immediately, including CRLF-less CAP and welcome
  messages. Send exactly one CRLF on the legacy transport and no terminator on
  `text.ircv3.net`; reject embedded separators and NUL.
- **Website:** shared brand tokens, visible primary action labels, responsive
  navigation, readable typography, mobile definition lists, download artifact
  rows, OnyxOS sections, and consistent touch actions. The homepage uses the
  existing brand mark and desktop seal art; phone layouts keep entry actions
  prominent. All 19 public routes retain their content at 320/390/768/1440 px.
- **Conversation:** phone layouts devote the working area to chat. Rooms and
  Members open mutually exclusively, close on selection/Escape, and retain the
  desktop sidebars. The composer fits shortened viewports; latest messages
  remain visible. Moderation lives in the roster rather than an extra grid row.
- **Panels and accessibility:** finish search, pins, media, inbox, and image
  preview layouts. Modal focus moves before background isolation, traps Tab,
  restores original attributes and opener focus, and supports nested dialogs.
  Escape closes the highest visible modal through its existing Elm action.
- **Connection and buffer follow-up:** accessible connection dialog with live status, validated chat-name edits, DOM-only account passwords, and guarded disconnect recovery for a stuck sign-in. Confirmed browser joins open the conversation immediately without stealing focus for older requests. Empty conversations offer room discovery and creation; date/history controls and the compact mobile composer improve reading space. A 181-message fixture verifies buffered history and latest-message visibility.
- **Warnings:** remove all 63 lint warnings without weakening rules. Preserve
  inferred lazy-component prop types, use intentional untracked reads in
  asynchronous guards, and remove dead assignments/helpers. Independent
  reviews found no remaining security or modal-focus findings.

## Evidence

- `pnpm typecheck`, `pnpm lint`: pass; zero lint errors/warnings.
- `pnpm test --maxWorkers=4`: 608 files, 7,596 tests passed.
- `pnpm build`: Solid production build passed.
- `elm-test`: 2,556 tests passed.
- `node --test elm/*.smoke.mjs`: 286 bridge tests passed.
- `pnpm test:e2e:elm`: 15 Chromium scenarios passed, including every public
  route at four widths, shortened mobile viewports, search/pins/media/inbox,
  keyboard navigation, primary-action contrast, and clean client console.
- Published release `onyx-shell-20261009-145542-55bfa9cf-dirty`: live mobile registration, Browse rooms → Join #root → active chat, five-member roster, enabled composer, and connection-dialog open/close all verified. Client/home/about have no console warnings or runtime errors; document width is 390 at a 390 px viewport.

The deterministic mobile transport fixture verifies composition and UI
interaction. The live-origin check independently verifies actual registration;
it does not claim a multi-user call or encrypted-DM interoperability test.
