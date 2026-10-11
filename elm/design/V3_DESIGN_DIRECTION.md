# Onyx v3 (Elm) — design direction

Research pass by Fable (2026-10-10). This document covers the design
direction, the changes it implies for the roadmap, and the Elm
architecture. It is grounded in the current repo state:

- `App.elm` is ~41k lines and has ~700 `Msg` constructors. `update` already
  returns its effects as data, as `List Outbound`.
- `View/Thread.elm` uses no `Html.Keyed` and no `Html.Lazy`.
- `Main.elm` has no global key subscription.
- `View/Rail.elm` is a bare `<h2>Channels</h2><ul>`.
- The Solid oracle already has the right information architecture:
  `shellNavigationModel.ts`, `ChannelSidebar.tsx` and `HomeBriefingView.tsx`.

## Information architecture: five destinations, two collections, one palette

Port the Solid `shellNavigationModel` as is; do not invent a new IA for
Elm. The five destinations are Home / Rooms / Messages / Calls / You.
"You" is a dialog, never a location.

### Layout by viewport

**Desktop**

- A 56px icon rail on the far left. Labels show on hover/focus, and the
  current item carries `aria-current="page"`.
- Next to it, a 280px collection sidebar:
  - Rooms → Favorites, then folders, then rooms.
  - Messages → DMs with previews.
- Then the conversation column, then an optional context rail.

**Mobile (<600px)** (v3/rx-shell moved the seam from 768px)

- A bottom nav with the same five items.
- The collection sidebar becomes the Rooms / Messages page.
- A conversation is a pushed page with a back control.
- "You" is a full-screen dialog.

**Every other ratio** (`css/rx-shell.css`)

- 600–767px (foldables open, small tablets, 200% zoom): the icon rail,
  the list and the conversation side by side — a real two-pane, not a
  stretched phone.
- Windows under 520px tall (landscape phones, short laptops at zoom): the
  global bar folds into the sidebar head and shares one 44px row with the
  room header.
- Wide screens: the transcript keeps a ~72ch measure; from 1960px the
  frame stops growing inside a calm surround; the context rail's member
  list pins its head, filter and section headings.
- Touch (`hover: none`) keeps 44px targets at every width. Note the frame
  gives every button a 24px floor at specificity (0,3,0): size rules for
  shell buttons need three classes (guarded by `rxShellCss.smoke.mjs`).
- Rows carry an overflow menu (Favorite, Mark as read, Notifications,
  Leave — which asks first); a DM's has Mark as read and Mute.

### Rules

- Keep Rooms and Messages as separate collections:
  - Element had to partly reinstate "People" after merging them.
  - Slack ships a dedicated DMs tab.
- Never mix DMs into one alphabetised "Channels" list.
- Give the sidebar a single-select filter row above the list:
  All / Unread / @Mentions / Favorites.
- Add the collapsed text-filter disclosure from the Solid sidebar.
- No Discord-style server rail: Onyx is one network, so the rail slot
  belongs to primary navigation.

### Ctrl/Cmd+K palette

- Use the combobox pattern:
  - The input keeps DOM focus.
  - A listbox with a virtual highlight.
  - Escape restores focus to the opener.
  - Recents are keyed by stable id.
  - Shortcuts are shown inline.
- Scope: rooms, DMs and actions (join, new DM, settings, theme).
- It is the fallback for everything the shell can't fit.

### Unread model

- Rooms with unread messages: a neutral count pill.
- Mentions: an accent `@` glyph.
- Muted rooms: an activity dot.
- The nav items show totals across collections.
- Messages are marked read when the viewport reaches the bottom.
- Home has an explicit "Mark all caught up".

## Home / catch-up

Home is where the user lands after connect, not a room. Order from top
to bottom:

1. Welcome strip, with the "claim this name" chip for guests.
2. Continue (resume points).
3. Needs you (mentions, DM unread, invites).
4. Quiet unread rooms, collapsed by default.
5. Mark all caught up.

Prior art:

- Zulip's Inbox-as-home works because it empties.
- Slack's Activity tab is the same idea.
- Discord has not shipped a catch-up surface (as of 2025), so this is a
  genuine differentiator for Onyx.

The "Since you left" digest belongs on Home, not inside the room.

## Room / DM layout

**Header and panels**

- Header: name, privacy glyph, one-line expandable topic, facepile,
  overflow menu.
- Thread, pins and members:
  - right-rail panels on desktop;
  - sheets on mobile;
  - never a modal over everything.

**Transcript**

- Group messages by author. A new group starts when the author changes
  or after a gap of more than 5 minutes.
- Show avatar and name on the first row of a group only.
- Show the timestamp on hover for continuation rows.
- Day dividers.
- System events as single dim lines.
- An unread divider, plus a "Jump to latest" pill when scrolled up.

**Density**

- Two modes:
  - Default: grouped, with avatars.
  - Compact: no avatars, name inline, IRC-like.
- Plus a "space between groups" token.
- Compact is the honest IRC-heritage mode. It is a preference, not the
  default.

**DMs**

- The header shows the E2EE safety state.
- A key change appears as an inline row, not a toast.

## Onboarding / progressive identity

The connect gate is right. Add three things:

- Pre-fill the nick from `?join=` or an invite.
- When a nick is taken, add a suffix and explain why.
- Let the user claim the name later.

Guests land on Home with a dismissable "Keep the name X" chip. Prompt
again only after a meaningful action: their first message or first DM.
Never gate settings or appearance on having an account.

What reads as dated IRC:

- visible mode letters;
- raw numerics in the transcript;
- NickServ-style commands as the only path;
- the nick list as the default right rail;
- a "Channels" header;
- monospace everywhere.

What reads as modern:

- names rather than nicks;
- roles as words;
- structured NOTE/FAIL replies rendered as inline cards;
- empty states that offer a next action.

## Visual system

Keep the abyssal monochrome look and the single sea-glass accent.

**Tokens and type**

- Adopt the Solid token ladder:
  - `--space-*`;
  - `--text-xs..2xl`;
  - `--dur-micro/fast/base`;
  - `--target-min: 44px`;
  - an inset-hairline `--focus-ring`;
  - `--shell-measure`.
- Body text: 15px / 1.5 for chat.
- Secondary text: 13px.
- Kickers: 11px.
- Mono only for code and timestamps.

**Accent budget**

- The accent marks four things only:
  - the current location;
  - the primary action;
  - the focus ring;
  - the mention glyph.
- Unread uses heavier text and a neutral pill, never the accent.

**Surfaces**

- Three steps: bg / panel / panel-2.
- Separate them with the 1px line seam, not shadows.
- Sheets alone get one short, cool shadow.

**Motion**

- Durations: 100 / 160 / 220ms.
- Entrance animation only, for sheets and toasts.
- No looping animation in the shell.
- `prefers-reduced-motion`:
  - zeroes the duration tokens;
  - also sets `animation: none` on loops, because duration tokens alone
    don't stop rAF or canvas animation.

**Accessibility floor: WCAG 2.2**

- Minimum target size is 24×24 (2.5.8).
- Focus Not Obscured (2.4.11): use `scroll-padding` so the sticky
  composer and bottom nav never hide a focused row.
- Dialogs follow the APG dialog pattern:
  - initial focus goes inside;
  - Tab wraps;
  - Escape closes;
  - focus returns to the opener;
  - `aria-modal` only when the background is truly inert.
- The transcript:
  - is `role="log" aria-live="polite" aria-relevant="additions"`;
  - is present from first paint;
  - is assertive only for mentions and connection loss.

## Elm architecture

**Approach**

- Keep effects-as-data; don't adopt nested TEA.
- `List Outbound` is the Effect pattern that elm-program-test needs:
  - map it through `simulateEffects`;
  - test with `simulateIncomingPort`, `ensureOutgoingPortValues` and
    `expectViewHas`.
- Split by concept, following Feldman's "Scaling Elm Apps":
  - make `update` a matchmaker;
  - narrow argument types;
  - use extensible records to restrict arguments only.

**Concrete steps**

1. **Feature modules.** Each feature is a `Feature/X.elm` module with its
   own `Model`, `Msg`, `update : Msg -> Model -> ( Model, List Outbound )`
   and `view : Config msg -> Model -> Html msg`.
   - Wire it in with one model field, one wrapper `Msg` and one
     two-line `update` branch.
   - Cross-feature intents (open room, open DM, toast) are returned as
     intents, not reached into.
2. **Registry blocks.** `App.elm` gets three alphabetised registry
   blocks: `-- FEATURE MODELS`, `-- FEATURE MSGS`, `-- FEATURE UPDATE`.
   Insertions sorted this way merge cleanly. (This rests on reasoning,
   not a published study.)
3. **One keyboard port and one focus port.**
   - Why a port: `Browser.Events.onKeyDown` can't call
     `preventDefault`, and it fires inside inputs.
   - A `shortcut` incoming port, where `ports.js` owns the scope rules:
     not inside editable fields, `?`, Ctrl+K, Esc, Alt+↑/↓.
   - A `dialog` outgoing port that mounts a focus trap and restores
     focus afterwards.
   - The overlay stack lives in the model, so Escape is a pure state
     transition.
4. **Transcript.**
   - Render with `Html.Keyed` keyed by msgid, and `Html.Lazy.lazy3` per
     row with stable inputs (precompute the row flags).
   - Window the list with spacer divs.
   - A `scrollPolicy` port handles stick-to-bottom and history-prepend
     anchoring.
5. **CSS.** Hand-rolled CSS with per-feature prefixes, one file per
   feature, and a single `tokens.css` copied from Solid.
6. **elm-review.**
   - `NoUnused.*`.
   - `NoExposingEverything`.
   - A rule forbidding `import App` from `Feature/*`.
7. **Testing pyramid.**
   1. Oracle vectors.
   2. elm-program-test flows per feature.
   3. Playwright against `elm make --optimize`, at 375 / 768 / 1280,
      with screenshot baselines.
   4. An axe smoke test per surface.

## Weak evidence

- No published Elm source covers conventions for avoiding merge
  conflicts.
- Discord's catch-up feature exists only as announcements.
- Slack's tab details vary by rollout stage.
- Zulip's topic model draws pushback. Adopt Inbox-as-home, not
  mandatory topics.

## Sources

**Slack**
- https://slack.com/help/articles/16764236868755
- https://slack.com/intl/en-au/help/articles/44134792609555-A-consolidated-set-of-tabs-for-Slack-on-desktop

**Discord**
- https://support.discord.com/hc/en-us/articles/12654190110999
- https://discord.com/blog/making-discord-on-desktop-look-just-right-display-settings-to-ease-the-eyes
- https://nerdschalk.com/discord-plans-ai-tools-to-help-users-catch-up-on-missed-conversations/
- https://support.discord.com/hc/sv/community/posts/360051950273-getting-started

**Element / Matrix**
- https://element.io/blog/new-element-web-and-desktop-apps-have-distinct-element-x-vibes
- https://matrix.org/blog/2025/11/14/this-week-in-matrix-2025-11-14/

**Zulip**
- https://zulip.com/help/inbox
- https://www.lesswrong.com/posts/R8fADFuJeYo7QxTtH/why-i-like-zulip-instead-of-slack-or-discord

**Command palettes, onboarding, chat layout, sheets and dialogs**
- https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/
- https://libera.chat/guides/webchat
- https://mui.com/x/react-chat/display/message-appearance/
- https://material.io/components/sheets-bottom
- https://m2.material.io/components/dialogs

**Accessibility and motion**
- https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- https://dequeuniversity.com/resources/wcag-2.2
- https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- https://getstream.io/chat/docs/sdk/react/guides/accessibility/
- https://web.dev/articles/prefers-reduced-motion

**Elm architecture**
- https://elm-radio.com/episode/scaling-elm-apps
- https://elm-radio.com/episode/life-of-a-file
- https://elm.land/concepts/effect
- https://guide.elm-lang.org/optimization/keyed
- https://discourse.elm-lang.org/t/arbitrary-html-rendering-and-performance-optimization-in-elm/4671

**Testing and tooling**
- https://elm-program-test.netlify.app/cmds.html
- https://elm-program-test.netlify.app/ports.html
- https://github.com/jfmengels/elm-review
- https://argos-ci.com/blog/playwright-visual-regression-testing-ci
- https://testquality.com/playwright-visual-regression-guide/
- https://www.npmjs.com/package/focus-trap
