# Onyx v3 calls — voice & video interface design

Status: design spec, replaces roadmap Phase 6 (6.1–6.7). Companion
prototype: `prototype.html` (static, dark, state switcher).

Scope: everything a person sees between "there is voice in this room" and
"the call ended" — presence, join, the in-call stage and bar, DM ringing,
PiP, captions, reactions, settings, privacy, degradation, errors, stage
mode, and the 375px layouts for each. Not in scope: Watch Together (its own
activity card, unchanged from the oracle), spatial audio pad (post-ship).

Design-to-state rule: every surface below is designed against the state the
Elm core actually has today (`elm/src/App.elm`, `elm/src/Media.elm`,
`elm/ports.js`). Anything that needs new state is marked **NEW** in the data
contract (§5), and the slice plan (§6) orders work so each slice ships on
existing state before adding its own.

---

## 1. Principles

1. **Voice lives in the room.** A call is a property of an IRC room (or a
   DM), not a separate place. Presence shows where the room shows (sidebar
   row, room header), joining happens from the room, and leaving returns you
   to the same scrollback. This is the Discord/Slack "drop-in channel" model
   rather than the Zoom "meeting" model: no lobby, no meeting ID, no
   ringing for rooms. Only DMs ring.
2. **Drop-in, never dragged in.** Nothing joins, accepts, or starts a call
   except an explicit button with the verb on it. The Calls hub, the
   sidebar count, the header chip and the banner are all read-only or
   single-verb. Ringing and provisional states are never labelled
   established (hub rule, kept verbatim from `View/Calls.elm`).
3. **One accent, one meaning: live audio now.** The sea-glass accent
   (`--onyx-accent`) is used in calls for exactly two things: the live pip
   and the speaking ring/border. Toggle "on" states invert to off-white on
   dark; attention states use `--onyx-warn` (hand raised, degraded,
   connecting) and `--onyx-bad` (leave, insecure, lost). Nothing glows.
4. **Trust is calm and specific.** The security chip is always present in
   a live call, reads one short label, and opens a sheet that says exactly
   what is protected and from whom. It never claims more than the engine
   reports (`callSecurity.ts` padlock honesty), and the reserved "Privacy
   code" slot stays visibly empty rather than inventing a safety word.
5. **Honest degradation.** Poor networks, reconnects and codec failures are
   shown as what they are, in the stage status line and one banner at a
   time, with one suggested action. The stage never fakes video, never
   fakes "connected", and keeps your place in the conversation.
6. **Hierarchy by weight and size, not decoration.** 6px radii, 1px
   `--onyx-line` borders, no gradients/glass/emoji glyphs. Icons are inline
   stroke SVG. The control bar is the only chrome; everything else is
   tiles and type.

---

## 2. Surface inventory and states

Copy quoted in "double quotes" is oracle copy; file refs point at the
SolidJS source it comes from. Copy marked (new) has no oracle.

### 2.1 Voice presence — sidebar row

Where: each room row in the sidebar (`View/Rail.elm` today; the sectioned
sidebar lands in roadmap 1.5).

| State | Rendering |
|---|---|
| No one in voice | Nothing. |
| N in voice, you not in it | Right-aligned `pip(faint) N`, 12px/600. aria-label "N in voice". |
| N in voice, you in it (established) | `pip(accent) N`, text `--onyx-text`. aria-label "N in voice, current call". |
| You in it, provisional | `pip(warn) N`. |

Rules: counts only (no participant list under the row — Discord shows
avatars under the channel, but our rows are dense and the header chip
carries faces). Never a badge colour other than the pip.

### 2.2 Voice presence — room header chip (`PresenceRibbon.tsx` L758–770)

Shown when voice count > 0 in the active room. Button, 30px tall,
pip + up to 3 faces + "N in voice" + "· status".

Status text (first match, `buildVoiceRoomStatus` L111–167):
"{nick} speaking" / "{n} speaking" / "{nick} raised" / "{n} raised" /
"listening" (you, in call, nothing else) / "{n} muted".

aria-label: "{n} person|people in voice in {channel}, current call, {status}"
when you are in it; "{n} … in voice in {channel}, {status}; join voice"
otherwise. title: names joined with ", " + " · " + status.

Click: joins audio-only (never video from the chip). If already in this
call: no-op (scrolls stage into view). `data-active="true"` + accent border
when established.

Lifecycle pills next to the chip (`ribbon-call-status`, `aria-live=polite`):
"Incoming", "Calling", "Connecting…", "In call".

Idle join button in the header: "Join call" when anyone is in voice, else
"Call" (`ribbon-join-call`). aria-label and title "Join call". Hidden when
the `voiceEntry` preference is off → moves into the More menu as "Join call".

### 2.3 Pre-join banner (`CallJoinBanner.tsx`, `callJoinCopy.ts`)

Lives at the top of the message column, under the room header. Two
variants; at most one shows.

**Invite (new copy, no oracle):** when voice count > 0 and you are idle.
- Title: "{n} person is|people are in voice."
- Sub: "Join to listen; your microphone starts off until you unmute."
  (true because `callSelfMuted` resets and "Join muted" is the default
  we ship — see §2.11).
- Buttons: ghost "Join with video" (aria "Join with video in {channel}"),
  primary "Join call" (aria "Join call in {channel}"). These map 1:1 to the
  existing `CallJoin { channel, video }`.
- Dismissible per room per session via "×" (aria "Hide voice banner") —
  the header chip remains the permanent entry.

**Failed / rejoin (oracle):** when the last join failed or the transport
dropped a live call (`callRejoinState.ts`).
- Title: "Couldn't join. Try again." (`CALL_JOIN_FAILED_COPY`)
- Sub (new): "Your place in {channel} is kept."
- Button: "Try again" (`call-join-retry`) → `CallJoin { video = False }`.
- `role="status"`, warn border.

Mobile: stacked; buttons full-width, 44px.

### 2.4 In-call control bar (`VoiceBar.tsx`)

Rendered only for lifecycle `RingingOut | RingingIn | InCall` (oracle
L1349). Docked at the bottom of the stage; on mobile it is the bottom bar.
`role="toolbar" aria-label="Voice call controls"`.

Three zones (desktop grid `1fr auto 1fr`):

**Left — where/when/who:** room or peer (750 weight), timer `MM:SS` /
`H:MM:SS` (`role="timer"`, aria "Call duration: …", only when established),
"· N person|people". The active-speaker chip (oracle `active-speaker`) is
dropped: the speaking ring on the stage already says it, and the chip was
`aria-hidden` anyway.

**Centre — primary controls** (`role="group" aria-label="Call controls"`),
56×44 icon+caption buttons, `aria-pressed` on toggles:

| Button | Caption | aria-label (off → on) | Fill when on |
|---|---|---|---|
| Mute | "Mute" / "Unmute" | "Mute microphone" / "Unmute microphone" | off-white (muted = pressed) |
| Camera | "Camera" | "Turn on camera" / "Turn off camera" | off-white |
| Share | "Share" / "Sharing" | "Share screen" / "Stop sharing screen"; pending "Starting screen sharing"; unavailable "Screen sharing unavailable" (disabled) | off-white |
| Hand | "Hand" | "Raise hand" / "Lower hand" | `--onyx-warn` fill, ink text |
| React | "React" | "Send a reaction" (`aria-haspopup="menu"`) | — |
| Captions | "Captions" | "Show live captions" / "Hide live captions" | off-white |
| More | "More" | "More call tools" (`aria-haspopup="dialog"`, `aria-expanded`) | — |
| Leave | "Leave" | "Leave voice call" | `--onyx-bad`, always last, 6px extra gap |

Note the caption for Camera stays "Camera" in both states (the oracle's
"Video"/"Video off" inversion is confusing; the aria-label carries the
verb).

**More call tools** (`role="dialog" aria-label="More call tools"`, anchored
popover, Escape closes, focus returns to More): Deafen ("Deafen"/"Undeafen",
hides the user's own output; wire is local-only — see §5), Record ("Record
local audio" + the oracle's state labels), Invite ("Invite with room link"
→ clipboard; status "Invite link copied" / "Could not copy invite link"),
Layout ("Switch to spotlight layout"/"Switch to grid layout"), Stage size
("Expand call stage"/"Fullscreen call stage"/"Compact call stage"),
Settings ("Open voice settings").

**Right — trust and quality:**
- Security chip (`call-security-chip`, `aria-haspopup="dialog"`): icon +
  label from `callSecurity.ts`; aria-label "{detail} Open call privacy
  details." Tones: ok (text colour) for hop_protected/e2ee; warn for
  e2ee_degraded/connecting/stage; danger for insecure. Priority: stage >
  insecure > degraded > e2ee > connecting > hop_protected. Never rendered
  idle.
- Connection pip (`role="img" aria-label="Connection: {Excellent|Good|Fair|Poor}"`,
  four bars; tier 2 bars warn, tier 3 bar bad + the word "Poor" shown).
- SFU badge ("Local SFU" / "Network relay · N hops" / "Media path degraded")
  moves into the privacy sheet; it is operator detail, not a glanceable.

Live regions in the bar (all `sr-only role="status" aria-live="polite"
aria-atomic`): `invite-status`, `screenshare-status`, `record-status`.

Mobile (375): icon-only 48×48 targets, captions become sr-only; order
Mute · Camera · Hand · Captions · More · Leave (Share and React move into
More — browsers on phones rarely support `getDisplayMedia`). Where/timer go
to a header line above the stage; chip + quality sit under it.

### 2.5 Voice-only stage (`VoiceStage.tsx` `data-mode="audio"`)

`role="region" aria-label="Voice call participants"`. Status line top-left
(`role="status" aria-live="polite"`, `voice-stage-state`):
"Ready to join…" (prejoin) / "Connecting to the call…" / "The call is
connected, but local media is unavailable. You can stay and listen." /
"Call is live" / "Call ended" — plus " · {security label}" appended when
known.

Participants: centred flex-wrap of 112px "person" cells (72px avatar, name
650, optional sub-line). Self always first, then peers by join order
(never re-sort on speaking — stability over recency).

Per-person states:
| State | Visual | aria (appended to name, in this order) |
|---|---|---|
| speaking (and not muted) | 2px accent ring + 1px breathing halo (reduced-motion: static 60% halo) | "speaking" |
| muted | 24px badge bottom-right, mic-off glyph, dim | "muted" |
| hand raised | ring in `--onyx-warn`, hand badge warn | "hand raised" |
| self | "· you" in faint after the name | "(you)" |
| deafened (self only) | headset-off badge | "deafened" |
| role (q/o/v) | sub-line "owner" / "op" / "voice" (never a sigil glyph) | — |

Counts: up to 12 cells at full size; 13+ switch to 56px avatars without
names on hover-less devices → show names on a second line at 12px; 25+
collapse to a facepile + "and N more" and the roster lives in the member
list (`View/Roster.elm`) with a voice section.

### 2.6 Video grid / speaker view / screenshare

Layouts (`data-layout`): `grid` (default), `spotlight`, `screenshare`
(forced while anyone shares). Tiles are 16:9 with `object-fit: contain`
(Daily/Jitsi guidance: never crop faces by default).

**Grid columns by participant count (desktop):**

| Count | Columns | Notes |
|---|---|---|
| 1 | 1 | self only: centred, max 56rem wide |
| 2 | 2 | side by side; on <640px stack 1 column |
| 3–4 | 2 | 2×2 |
| 5–9 | 3 | 3×3 |
| 10–16 | 4 | page 1 of N; paginate at 16 (Meet tiled default) |
| 17+ | 4 | pages of 16, speakers promoted to page 1 (LiveKit stable-update rule: reorder only on page boundaries, never mid-page) |

Mobile: 2 columns, 3:4 tiles, max 4 video tiles on screen (Daily mobile
guidance ≈3 remote); more become avatar-only tiles below the fold.

**Spotlight:** primary = pinned participant, else the dominant speaker
(`activeSpeaker.ts`: 400ms hold, 800ms release — the layout never flips
faster than that), else self. Filmstrip of 160×90 tiles under it,
horizontal scroll, `role="list" aria-label="Other participants"`.

**Screenshare:** the share is the primary tile, labelled "{nick}'s screen"
with a Screen tag; the sharer's camera tile goes first in the filmstrip
with the speaking border. A grid button on the primary tile offers
"Switch to grid layout". Remote shares (peer `kind = screen`) also trigger
this layout (the oracle only honoured local shares — see §7 open
questions).

Stage sizes (compact / expanded / fullscreen) are kept from the oracle;
fullscreen is `position: fixed; inset: 0`, Escape returns to compact.

### 2.7 Participant tile anatomy (`ParticipantTile.tsx`)

`role="group" data-nick`, aria-label = "{nick}[, (you)][, hand raised]
[, speaking][, muted][, camera off][, {Quality} connection]" (oracle
order). Border 2px: line → accent (speaking) → warn (hand) → dim (pinned);
speaking wins over pinned, hand wins over speaking (a raised hand is a
request that must stay visible even while they talk).

- Top-left tags (24px, dark plate): "Muted" (mic-off), "Hand raised",
  "Camera off", "Screen", "Video paused" (bandwidth stop, new copy).
- Top-right: pin ("Pin {nick} to spotlight"/"Unpin {nick}"), native PiP
  when supported ("Open {nick} video in Picture-in-Picture").
- Bottom-left name plate: nick, "· you", three accent talk bars while
  speaking (aria-hidden; the border + label carry the meaning).
- Bottom-right: 3-bar quality pips, only when the engine reports per-peer
  quality (today it does not — slot reserved; `role="img"` "{label}
  connection").
- E2EE per tile: no lock on tiles. The call-level chip is the trust
  signal; per-peer fingerprints live in the sheet. (A per-tile lock would
  imply per-peer verification we cannot make.)
- No video: avatar `lg` centred on `--onyx-panel-2`.

### 2.8 Picture-in-picture (`VoicePip.tsx`)

Shows when lifecycle is `InCall` and the viewed target ≠ call target
(room or DM peer). `section role="region" tabindex="0" aria-label="Mini
voice view for {target}"`, 300px wide, bottom-right default, 12px margin.

- Handle: live pip, target, "{n} live" (aria "{n} speaking") or "live",
  and a corner-cycle button "Move mini view to next corner" (WCAG 2.5.7:
  dragging must have a non-drag alternative).
- Optional 110px video strip: dominant speaker's video if any.
- Body: facepile (≤5, speakers first, accent outline on speaking),
  "Mute"/"Unmute" (`aria-pressed`), "Return" (aria "Return to call in
  {target}" → `CallsReturnToCall`), danger "Leave".
- Keyboard: arrows move 16px, Shift+arrows 48px; Escape blurs.
- Position persisted at `onyx:voice-pip-position`.
- Must never fully cover the composer or a focused element (WCAG 2.4.11):
  the shell adds `scroll-padding-bottom` equal to PiP height while it is
  shown, and the PiP yields (fades to 40% opacity, pointer-events none)
  when a focused element's rect intersects it.

Mobile: 160px card docked top-right under the header (bottom is reserved
for the composer), no video strip, same buttons at 28px.

### 2.9 Incoming / outgoing DM call overlays (`overlays/*`)

`ModalShell`: `role="dialog" aria-modal="true"`, labelled by the title,
described by the body, focus trap, focus restore.

**Incoming** (`ringing_in`): kicker "Incoming voice call", title "Incoming
call", caller name (or "Unknown caller") with "Direct message" sub, body
"A voice call is waiting. Accept to join with your current audio
settings, or decline to dismiss it.", buttons danger "Decline" (aria
"Decline call from {caller}") and primary "Accept" / "Accepting…" (aria
"Accept call from {caller}", disabled while accepting), meta "Your
microphone stays muted if Join muted is enabled."
- Initial focus: **Decline** (APG: least destructive). Escape = decline.
  Backdrop click = nothing (change from oracle: a stray click must not
  decline a call).
- Announce once, `role="alert"` region: "Incoming call from {caller}".
- Engine ring timeout is 30s (`RING_TIMEOUT_MS`); the dialog does not show
  a countdown (nothing to act on) and closes on the engine's idle.
- Busy: `role="status"` "Accepting call from {caller}…"; error
  `role="alert"` "Could not accept the call from {caller}. Try again."

**Outgoing** (`ringing_out`): kicker "Outgoing voice call", title
"Calling", callee (or "Unknown recipient"), "Waiting for them to answer."
(`aria-live="polite"`), body "The call request is being sent. You can
cancel before they answer.", one danger "Cancel" (aria "Cancel call to
{callee}"), initial focus Cancel, Escape cancels.

Mobile: both become full-screen sheets; Accept/Decline 52px tall, equal
width, Decline left.

### 2.10 Captions and reactions

**Captions** (`CaptionsOverlay.tsx`): `section aria-label="Live captions"`,
`role="log" aria-live="polite"`, last 3 lines, anchored bottom-centre of
the stage **above** the bar (MAUR VP-5: never over controls), 15px text
on a 94%-opaque `--onyx-bg` plate with a 1px line border (≥ 4.5:1 on
`--onyx-text`). Each line: "{nick}" 650 in `--onyx-dim`, then text; older
lines 75% opacity. Header row when expanded: "Live captions", "Live from
this call" / "Captions unavailable while reconnecting", "Copy transcript"
(aria "Copy live caption transcript"; results "Copied" / "Clipboard
unavailable"). Per-line "Translate" is kept from the oracle. Data:
`media.transcripts` already exists.

**Reactions** (`ReactionsOverlay.tsx`): the React menu (`role="menu"
aria-label="Send a reaction"`, 8 items, roving arrows/Home/End) sends
`MEDIA REACT`. Incoming reactions render as a small chip bottom-right of
the stage ("{avatar} {nick} {glyph} {verb}") for 2600ms, max 3 stacked,
`aria-hidden`, slide-in 160ms (none under reduced motion). Raised hand via
✋ reaction maps to the "raised a hand" chip and the hand state (15s
auto-clear, oracle). No confetti, no floating emoji.

### 2.11 Device / voice settings (`settings/VoiceSettings.tsx`)

Sheet "Voice settings" / "Devices, activation, and signal processing." /
close "Close voice settings". Reachable from More → Settings and from the
You hub (roadmap 1.2).

- Devices: "Microphone" (empty "System microphone"), "Speakers" ("System
  speaker", plus "Choose speaker…" when `selectAudioOutput` exists),
  "Camera" ("System camera"), "Output volume" 0–100. Loading "Checking
  media devices…"; errors `role="alert"` "Device enumeration is
  unavailable in this browser." / "Device enumeration failed. Check media
  permissions."
- Processing: "Join muted" (default **on** — matches the banner promise),
  "Voice activity", "Sensitivity" Low/Medium/High ("Threshold for opening
  the voice gate."), "Noise suppression", "Echo cancellation".
- Push to talk: toggle "Push to talk" / "Require a key press before
  transmitting."; "Talk key" display (`aria-live="polite"`: key name, "Not
  set", "Press a key"); "Capture key"/"Cancel capture"; "Clear".
  Capture: next non-IME key, Escape cancels, Space stored as "Space",
  focus returns to the capture button. Runtime: keydown with
  `repeat === false` opens, keyup/blur/visibilitychange closes; ignored in
  typing targets and with Ctrl/Meta/Alt (WCAG 2.1.4: single-key PTT is
  user-chosen and remappable, so it complies).

### 2.12 Call privacy sheet (`CallPrivacySheet`, `callPrivacy.ts`)

Title by level: "End-to-end encrypted call" / "Call not secure" / "Stage
broadcast" / otherwise "Call privacy". Sub "How this call is protected."
Close "Close call privacy".

Body: level card (icon + label + detail), then `dl`:
- "Media path": "Encrypted to this server — operators can access call
  media." or "End-to-end — only people in this call can hear or see."
- "SFU topology": label + " — " + detail (moved here from the bar).
- "Privacy code": reserved; "Available when end-to-end media encryption
  is active." until the engine mints one.
- "Your media fingerprint": 12-char Base58 shown as 3×4 groups in mono
  (`MooringSession.ts`), or "Loading…" / "Unavailable until the media
  engine is ready."
- "People in this call" (new): nick + their fingerprint from
  `onMooringState`, "Loading…" while absent. No "verified" toggle — the
  engine has no call-level verification state; the hint stays honest.
- Hint: "Compare this code out of band to confirm your media identity. It
  does not prove end-to-end encryption by itself."

Safety words: **not designed**. Signal/WhatsApp show 60-digit numbers for
a pairwise session; our group media key has no pairwise code
(`epochCode` is `null` by design). The slot is reserved so the layout does
not change when one ships.

### 2.13 Connection-quality degradation

Tiers 0–3 (`types.ts`). Visible effects:
- Bar pip changes bars/colour; tier 3 adds the word "Poor".
- Toasts (info, 4.5s, 2.5s hysteresis): "Adjusting video quality" /
  "Lowering video quality to keep audio clear."; "Protecting audio" /
  "Connection is weak — reducing video to keep audio clear."
- Prompt strip above the bar (`role="status"`), tier 3 held ≥2.5s with
  camera on: "Poor connection — turn off camera to keep audio clear."
  + "Turn off camera" + "×" (aria "Dismiss connection tip"). Consumed on
  act/dismiss, re-arms below tier 3.
- Stage status appends " · Protecting audio" while tier 3.
- When the engine stops video below 30kbps, affected tiles show "Video
  paused" (new copy) and fall back to the avatar; never a frozen frame.

### 2.14 Reconnecting

The engine has no `reconnecting` state; the shell derives it: lifecycle
`InCall` while `connection /= Live` (App.elm `connection`), or the
provisional window after a `SESSION RESUME`.
- Stage status: "Reconnecting…" with the warn pip.
- Banner (`role="alert"`, bad border): "Connection lost." + "Trying to
  rejoin {channel} — your place in the conversation is kept." + "Leave".
- Tiles dim to 55%, all toggles disabled except Leave, timer shows "—".
- On recovery: status "Call is live", announcer says "Reconnected" (new
  copy). If the transport gives up: hub outcome `CallDropped` → "The
  connection dropped." / "Rejoin from the room — your place in the
  conversation is kept." and the rejoin banner (§2.3).

### 2.15 Errors

All engine `onError` strings arrive as inbox entries "Voice: {msg}" and a
toast. Specific surfaces:

| Case | Where | Copy |
|---|---|---|
| Join failed (any reason) | banner §2.3 + hub outcome | "Couldn't join. Try again." |
| Permission denied (`NotAllowedError`) | banner sub (new) | "Onyx needs microphone access. Allow it in your browser's site settings, then try again." |
| No device (`NotFoundError`) | banner sub (new) | "No microphone was found. Connect one or check Voice settings." |
| Codec WASM load | toast | "Media codec unavailable" / "Could not load the media codec. Video and enhanced audio are disabled in this browser." |
| Encoder init | toast | "Camera could not start" / "Video encoding failed after trying every quality. Your camera preview may show, but others cannot see you." |
| Decode / mismatch | toast once per peer+kind | "Video unavailable" / "Could not decode {media} from {peer}…"; "Incompatible video codec" / "Cannot play {media} from {peer} — codecs do not match." |
| Screen share refused | `screenshare-status` | "Screen sharing did not start. Check browser permission and try again" |
| Removed by op | toast + leave | "You were removed from voice by {nick}" |
| Room near capacity | toast | "Room near capacity" / "This voice room is almost full." |

The two new device strings require the bridge to classify the
`getUserMedia` error name (§5, NEW).

### 2.16 Stage mode (`StagePanel.tsx`)

A stage is a room state (CTCP `STAGE RAISE_HAND` etc.), layered on the
voice stage:
- Speakers render as person cells (voice) or tiles (video); the audience
  is a single line under the stage: facepile + "Audience · N listening ·
  M raised hands". Audience members never get tiles.
- Status line: "Stage is live · You are a speaker" / "… · You are in the
  audience".
- Security chip forced to "Stage broadcast" (warn).
- Host side panel "Raised hands" (`ul aria-label="Raised hands"`): rows
  nick + "Invite to speak". Speak invite (`role="alert"`): "{from} invited
  you to speak." + "Accept"/"Decline".
- Audience controls replace the bar's centre group: "Raise hand"/"Lower
  hand", "Leave stage". Hosts additionally get "End stage". Dormant strip
  for ops: "Start stage" with hint "Stage is available here. Start one to
  host speakers with a raised-hand queue."; offline: "Stage is unavailable
  while Onyx reconnects. Your room is unchanged."

### 2.17 Calls hub (`View/Calls.elm`)

Unchanged copy and rules. Visual update only: the hub gains the voice
stage inline when established (so "Return to call" and the stage are the
same place) and otherwise lists rooms with voice presence ("Rooms with
voice" — count rows reuse §2.1).

### 2.18 Mobile (375px) summary

| Surface | 375px treatment |
|---|---|
| Sidebar / header | count on row; chip collapses to pip + "3" + faces, status hidden |
| Banner | stacked, full-width 44px buttons |
| Voice stage | 96px cells, 2–3 per row |
| Video grid | 2 columns 3:4, ≤4 video tiles, rest avatar-only |
| Speaker/share | primary full width 16:9, filmstrip 96×54 |
| Bar | 6 icon buttons 48×48, Leave rightmost, safe-area padding |
| Incoming/outgoing | full-screen sheet, 52px actions |
| PiP | 160px card top-right |
| Captions | 1 line, 15px, above the bar |
| Sheets | full-height bottom sheets with grab handle |
| Stage mode | raised-hands panel becomes a bottom sheet from "M raised hands" |

No horizontal scroll at 375px anywhere (roadmap rule).

---

## 3. Interaction details

### 3.1 Keyboard shortcuts

All chords use a modifier (WCAG 2.1.4); all listed in the `?` overlay
under "Voice & Video" (group already declared in
`useKeyboardShortcuts.ts`, empty today). Active only while a call is
live; never while typing in the composer except PTT.

| Action | Default | Rationale |
|---|---|---|
| Mute / unmute | Ctrl+Shift+M (⌘⇧M) | Discord default; note the oracle's `mute.channel` already uses this chord for notifications — it moves to Ctrl+Shift+N (open question §7) |
| Camera | Ctrl+Shift+E (⌘⇧E) | Meet uses Ctrl+E; shifted to avoid browser conflicts |
| Raise / lower hand | Ctrl+Shift+H | Meet pattern |
| Captions | Ctrl+Shift+C | — |
| Push to talk | user-bound key, hold (default unset; Space suggested) | Meet/Zoom hold-Space |
| Leave (with confirm when >2 people) | Ctrl+Shift+L | Zoom Alt+Q equivalent |
| Cycle layout grid → spotlight → (screenshare if any) | Ctrl+Shift+G | — |
| Stage size cycle | Ctrl+Shift+F; Escape exits fullscreen | — |
| Return to call | from PiP: Enter on the region | — |

`aria-keyshortcuts` is set on the corresponding buttons.

### 3.2 Focus order

Stage region → tiles (pin/PiP buttons only; tiles themselves are not
focusable) → captions copy button → control bar (left to right, Leave
last) → security chip → quality pip is `role="img"` (skipped). PiP is a
single tab stop (`tabindex=0`) whose inner buttons follow.

Dialogs trap focus; initial focus: incoming → Decline, outgoing → Cancel,
privacy sheet → close button, voice settings → first select, More tools →
first item. Closing returns focus to the opener.

### 3.3 Live regions (what announces)

| Event | Region | Politeness | Text |
|---|---|---|---|
| peer joins/leaves (delta only, never self, never baseline) | `call-status-announcer` | polite | "{names} has|have joined the call" / "… left the call" (`CallStatusAnnouncer.tsx`, names 1/2/3/"N people") |
| lifecycle change | `voice-stage-state` | polite | stage status strings §2.5 |
| incoming call | overlay alert | assertive | "Incoming call from {caller}" |
| connection lost / restored | stage banner | assertive / polite | "Connection lost." / "Reconnected" |
| mute/camera/hand toggled by self | the button's `aria-pressed` | — | no extra announcement |
| hand raised by peer | announcer | polite | "{nick} raised a hand" (new) |
| quality prompt | `connection-quality-prompt` | polite | §2.13 |
| captions | `role="log"` | polite | line text |
| speaking changes | none | — | too chatty; the tile label updates silently (Meet offers an on-demand "announce who is speaking" — Ctrl+Shift+S reads "{nick} is speaking" into the announcer) |

### 3.4 Motion

- Speaking ring: 1.6s opacity breathe on a 1px halo; static under
  `prefers-reduced-motion` and when `sceneMotion == SceneOff`.
- Tile reflow: 160ms position transition; none under reduced motion.
  Layout changes are batched to the active-speaker hold (400ms) so tiles
  never thrash.
- Reactions chip: 160ms slide; none under reduced motion.
- No pulsing on the incoming dialog; the pip is static warn.
- Nothing animates continuously except the speaking halo.

---

## 4. Copy reference (consolidated)

Oracle copy is reused verbatim; refs are to `src/shell/voice/*` unless
noted. New copy is marked.

**Bar:** "Mute"/"Unmute"; "Mute microphone"/"Unmute microphone"; "Turn on
camera"/"Turn off camera"; "Share screen"/"Stop sharing screen"/"Starting
screen sharing"/"Screen sharing unavailable"; "Raise hand"/"Lower hand";
"Send a reaction"; "Show live captions"/"Hide live captions"; "More call
tools"; "Leave" / "Leave voice call"; "Deafen"/"Undeafen"; "Invite with
room link"; "Invite link copied"/"Could not copy invite link"; "Record
local audio", "Stop recording and download", "Saving recording",
"Recording unavailable", "Recording available in call"; "Switch to
spotlight layout"/"Switch to grid layout"; "Expand call stage"/"Fullscreen
call stage"/"Compact call stage"; "Open voice settings"
(`VoiceBar.tsx` L1439–1883).

**Security:** labels/details table in §2.4 (`callSecurity.ts` L99–140);
sheet titles (`callPrivacy.ts` L43–58); "How this call is protected.";
"Close call privacy"; "Media path"; "SFU topology"; "Privacy code";
"Available when end-to-end media encryption is active."; "Your media
fingerprint"; "Loading…"; "Unavailable until the media engine is ready.";
hint sentence (§2.12). New: "People in this call".

**Stage status:** §2.5 (`VoiceStage.tsx` L272). New: "Reconnecting…",
"Reconnected", " · Protecting audio", "{nick} is sharing their screen".

**Tiles:** "(you)", "hand raised", "speaking", "muted", "camera off",
"{Quality} connection"; "Hand raised"; "Camera off"; "Muted"; "Deafened";
"Pin {nick} to spotlight"/"Unpin {nick}"; PiP labels (§2.7). New: "Video
paused", "Screen", "{nick}'s screen".

**Overlays:** §2.9 verbatim (`IncomingCallOverlay.tsx`,
`OutgoingCallOverlay.tsx`). New: "Incoming call from {caller}" (alert),
"Direct message".

**PiP:** "Mini voice view for {target}", "{n} live"/"live", "{n}
speaking", "Mute"/"Unmute", "Leave" (`VoicePip.tsx`). New: "Return",
"Return to call in {target}", "Move mini view to next corner".

**Banner:** "Couldn't join. Try again.", "Try again"
(`callJoinCopy.ts`, `CallJoinBanner.tsx`). New: "{n} person is|people are
in voice.", "Join to listen; your microphone starts off until you
unmute.", "Join call", "Join with video", "Join call in {channel}", "Join
with video in {channel}", "Your place in {channel} is kept.", "Hide voice
banner", and the two device-error sentences in §2.15.

**Quality:** §2.13 verbatim (`connectionQualityAction.ts` L128–132,
`bandwidthLadderFeedback.ts` L151–162). "Connection: {label}";
"Excellent"/"Good"/"Fair"/"Poor".

**Settings:** §2.11 verbatim (`VoiceSettings.tsx`).

**Hub:** unchanged (`View/Calls.elm`, `Media.callOutcomeCopy`).

**Stage mode:** §2.16 verbatim (`StagePanel.tsx` L103–118 and actions).
New: "Audience · N listening · M raised hands", "Stage is live · You are
a speaker".

---

## 5. Data contract

Per surface: what the view reads and emits. EXISTS = present in
`App.elm`/`Media.elm`/`ports.js` under that name. NEW = must be added.

### Core call state

| Field / msg | Status | Notes |
|---|---|---|
| `model.calls : Media.CallHub` (`lifecycle`, `channel`, `withPeer`, `startedAt`, `outcome`) | EXISTS | lifecycle `Idle | RingingOut | RingingIn | InCall` |
| `model.callSelfMuted : Bool` | EXISTS | local capture flag |
| `model.callsOpen : Bool` | EXISTS | hub toggle |
| `model.media : Media.MediaState` (`participants`, `speaking`, `muted`, `hands`, `transcripts`, `reactions`) | EXISTS | lowercased nicks, per-channel participants |
| `model.connection : ConnectionState` | EXISTS | used to derive reconnecting |
| `model.sceneMotion : Prefs.SceneMotion` | EXISTS | motion gate |
| `model.nick`, `model.activeChannel`, `model.channels`, `model.members` | EXISTS | self, viewed target, roles |
| msgs `CallJoin {channel, video}`, `CallLeave`, `CallToggleMute`, `CallsReturnToCall`, `CallsChooseRoom`, `CallHubChanged`, `CallHubSnapshot` | EXISTS | |
| effects `VoiceJoin`, `VoiceLeave`, `VoiceMute` | EXISTS | ports `voiceJoin/voiceLeave/voiceMute`, feed `voiceCallHub` |
| `Media.mediaReact`, `mediaRoster`, `mediaOffer`, `mediaMute`, `mediaJoin`, `mediaLeave` | EXISTS | wire builders (pure) |

### Per surface

| Surface | Reads | Emits | NEW |
|---|---|---|---|
| Sidebar count (2.1) | `media.participants[chan]` length, `calls` | — | none |
| Header chip (2.2) | `media.participants/speaking/hands/muted`, `calls`, `callSelfMuted` | `CallJoin` | `callSelfDeafened : Bool`, `callCameraOn : Bool`, `callSharing : Bool`, `captionsOn : Bool` (for the local-health status) |
| Banner (2.3) | `media.participants`, `calls.outcome`, `activeChannel` | `CallJoin`, `CallBannerDismiss chan` | `callBannerDismissed : Set String`; `callRejoin : Maybe String` (from `noteTransportLost`); `callJoinError : Maybe JoinError` (`Permission | NoDevice | Other`) fed by a classified `voiceCallHub` snapshot field `errorKind` |
| Bar (2.4) | all above + `callSecurity`, `callQualityTier` | `CallToggleMute` (exists), `CallToggleCamera`, `CallToggleShare`, `CallToggleHand`, `CallReact emoji`, `CallToggleCaptions`, `CallToggleDeafen`, `CallRecordToggle`, `CallInvite`, `CallLayoutSet`, `CallStageSize`, `CallMoreToggle`, `CallPrivacyOpen` | effects `VoiceCamera {on}`, `VoiceShare {on}`, `VoiceDeafen {on}`, `VoiceRecord {on}`; model `callSecurity : SecurityLevel` (`Connecting | HopProtected | E2ee | E2eeDegraded | Insecure | Stage`), `callQualityTier : Int`, `callLayout : Grid|Spotlight`, `callStageSize`, `callMoreOpen : Bool`, `callRecording : RecordState`; feed fields on `voiceCallHub`: `securityLevel`, `qualityTier`, `e2eeActive/degraded`, `recording` |
| Voice stage (2.5) | `media.*`, `calls`, `members` (roles) | — | `callDominant : Maybe String` (from `onPeerSpeaking` through the active-speaker rules; can be computed in Elm from `media.speaking` with the hold/release timers — pure, testable) |
| Video grid / tiles (2.6–2.7) | + `callPeers : Dict String PeerMedia` (`hasVideo`, `kind`, `screen`) | `CallPin nick`, `CallNativePip nick` | `callPeers` feed via `voicePeerState` port; `callPinned : Maybe String`; `callVideoPaused : Set String`; video elements attach via a `data-voice-tile` hook in ports (Elm never touches MediaStreams) |
| PiP (2.8) | `calls`, `activeChannel`, `media`, `callPipPos` | `CallToggleMute`, `CallLeave`, `CallsReturnToCall`, `CallPipMove`, `CallPipCorner` | `callPipPos : Maybe {x,y}` + `PipPositionSave` effect (`onyx:voice-pip-position`) |
| Incoming / outgoing (2.9) | `calls.lifecycle`, `calls.withPeer` | `CallAccept`, `CallDecline`, `CallCancel`, `CallStart peer` | effects `VoiceAccept`, `VoiceReject`, `VoiceHangup`, `VoiceStartCall {peer}`; `callAccepting : Bool`, `callAcceptError : Bool` |
| Captions (2.10) | `media.transcripts[chan]`, `captionsOn`, `connection` | `CallToggleCaptions`, `CaptionsCopy` (clipboard effect exists) | `captionsOn` |
| Reactions (2.10) | `media.reactions` (exists, 32 cap) | `CallReact` | reaction timestamps for the 2600ms expiry (`MediaReaction` gains `at : Int`) |
| Settings (2.11) | `voicePrefs` | `VoicePrefSet …`, `VoiceDeviceEnumerate`, `VoicePttCapture` | `voicePrefs : VoicePrefs` record + `voiceDevices : DeviceList`; effects `VoicePrefsSave`, `VoiceDevicesRequest`; ports mirror `voiceSettingsPersistence.ts` |
| Privacy sheet (2.12) | `callSecurity`, `callLocalFingerprint`, `callPeerFingerprints`, `callSfu` | `CallPrivacyClose` | `callLocalFingerprint : Maybe String`, `callPeerFingerprints : Dict String String` (from `onMooringState`), `callSfu : Maybe SfuPath`, `callPrivacyOpen : Bool` |
| Quality (2.13) | `callQualityTier`, `callCameraOn`, `callQualityPromptConsumed` | `CallQualityPromptAct`, `CallQualityPromptDismiss` | `callQualityPromptConsumed : Bool`, stable-tier timer (2.5s) as a pure fold on `nowMs` |
| Reconnecting (2.14) | `calls`, `connection`, `callRejoin` | `CallLeave` | derived only; `callRejoin` as above |
| Stage mode (2.16) | `stage : StageState` | `StageRaise`, `StageLower`, `StageInvite nick`, `StageAccept`, `StageDecline`, `StageStart`, `StageEnd`, `StageLeave`, `StageJoinAudience` | whole `StageState` + CTCP builders (port of `store.ts` 15599–15609) |

Bridge notes (`ports.js`): today `mountVoiceFeed` only forwards lifecycle
snapshots. Slices below extend the single `voiceCallHub` snapshot rather
than adding many ports: `{ state, nick, channel, startedAt, outcome,
securityLevel?, qualityTier?, recording?, errorKind? }`, plus one
`voicePeerState` port for per-peer media flags and one `voiceCommand`
outbound port carrying `{verb, …}` for camera/share/deafen/record/
accept/reject/hangup/start. All decoded fail-closed in `Media.elm`.

---

## 6. Slice plan (replaces roadmap 6.1–6.7)

Each slice = one commit (App fold + View + vectors + COVERAGE row),
independently shippable, gates `elm make`, `elm-test`, smoke suites,
375px no-scroll.

| # | Slice | Size | Needs | Acceptance |
|---|---|---|---|---|
| C1 | **Presence + banner** — sidebar count, header chip with status, invite/failed banners, hub "Rooms with voice" | M | existing state only (+ `callBannerDismissed`) | Chip text/aria match §2.2 vectors; banner joins via existing `CallJoin`; failed banner shows on `CallFailed`; dismiss persists for the session; 375px stacked |
| C2 | **Voice-only stage + bar v1** — person cells (speaking/muted/hand/you/role), status line, bar with Mute/Leave/More(Settings stub)/timer/people, announcer | M | existing `media.*`, `calls`, `callSelfMuted` | Announcer delta vectors (1/2/3/N names, has/have); speaking ring static under reduced motion; timer from `startedAt`; Leave resets flag |
| C3 | **Security chip + privacy sheet** — snapshot gains `securityLevel`, local + peer fingerprints, SFU detail | S | feed fields | Priority table vectors; padlock honesty (never closed lock unless `e2ee` and honest); reserved privacy-code slot; sheet focus trap |
| C4 | **Camera / share / deafen commands + quality** — `voiceCommand` port, `callCameraOn/Sharing/Deafened`, quality tier pip, ladder toasts, turn-off-camera prompt | M | new effects + feed `qualityTier` | Prompt only after 2.5s stable tier 3 with camera on; consumed/re-arm vectors; share unavailable disabled state; aria-pressed states |
| C5 | **Video grid + tiles + layouts** — `voicePeerState`, tile anatomy, grid column rules, spotlight, screenshare (local and remote), pin, stage sizes, Escape from fullscreen, dominant-speaker fold | L | `callPeers`, `callPinned`, `callLayout` | Column-count vectors for 1/2/3–4/5–9/10+; dominant speaker hold/release vectors (400/800ms); share forces layout; remote share honoured; no reorder within a page |
| C6 | **DM ring overlays** — incoming/outgoing dialogs, accept/decline/cancel/start, alert region, backdrop no-op | S | `VoiceAccept/Reject/Hangup/StartCall` | Initial focus Decline/Cancel; Escape semantics; busy/error states; hub never answers; mobile full-screen |
| C7 | **PiP** — mini view when viewing another target, drag + corner cycle + arrows, persisted position, focus-obscure yield | M | `callPipPos`, save effect | Shows only off-target and `InCall`; corner cycle works without drag; never covers focused composer (scroll-padding + yield); 375px top-right card |
| C8 | **Captions + reactions** — captions log above bar, copy transcript, reaction menu + chips with expiry, hand via ✋ | M | `captionsOn`, `MediaReaction.at` | Last 3 lines; contrast ≥4.5:1 vector on token values; chips expire 2600ms via `nowMs` fold; roving menu keys |
| C9 | **Voice settings + PTT** — sheet, device enumeration, prefs persistence, talk-key capture, runtime PTT keydown/keyup/blur | M | `voicePrefs`, `voiceDevices`, ports | Join muted default on; capture ignores IME/repeat, Escape cancels; PTT releases on blur/visibilitychange; prefs round-trip smoke |
| C10 | **Reconnecting + errors** — derived reconnecting state, lost/restored banner, rejoin memory, classified join errors (permission/no device), codec toasts, removed-by-op | S | `callRejoin`, `errorKind` | Banner shows while `InCall ∧ connection ≠ Live`; toggles disabled except Leave; outcome `CallDropped` → rejoin banner; device error copy by `errorKind` |
| C11 | **Stage mode** — `StageState`, CTCP builders, speaker/audience rendering, raised-hands panel, invites, chip forced to "Stage broadcast" | L | whole `StageState` | Audience never tiles; host queue + invite alert; audience bar swap; offline hint; 375px bottom sheet |
| C12 | **Shortcuts + a11y pass** — chord table, `aria-keyshortcuts`, `?` overlay group, Ctrl+Shift+S "who is speaking", focus order audit, 24px target audit, reduced-motion audit | S | none | Every chord listed in overlay; no single-key shortcut without PTT opt-in; all targets ≥24px with spacing; axe-style checks in e2e |

Watch Together stays as roadmap 6.7b (unchanged activity card, S).

---

## 7. Open questions for the product owner

1. **Mute chord conflict:** the oracle binds Ctrl+Shift+M to "Mute / unmute
   room" (notifications). Calls want it for the microphone (Discord
   convention). Proposal: microphone takes Ctrl+Shift+M, room
   notifications move to Ctrl+Shift+N. OK?
2. **Join muted by default:** the banner promises "your microphone starts
   off until you unmute". That requires `joinMuted = true` as the shipped
   default (oracle setting exists, default unknown). Confirm.
3. **Remote screenshare layout:** the oracle only focuses local shares; this
   spec focuses any `kind = screen` peer. Needs the engine to expose the
   share as a distinct peer entry — confirm it does on the Onyx Server
   roster (`ROSTER` has only voice/video lists today).
4. **Deafen / record / kick on the wire:** `DEAFEN`, `VOICE_KICK`,
   `RECORD_*` currently send nothing (`MediaEngine.ts` default branch).
   The UI treats deafen as local-only and recording as local WebM. Should
   remote "N is recording" toasts stay if nothing is ever sent?
5. **Safety words:** `epochCode` is reserved-null. Is a group-epoch code on
   the server roadmap, or should the "Privacy code" row be removed until
   then?
6. **Per-peer fingerprints in the sheet** rely on `onMooringState` being
   forwarded through the bridge; today it only fires a window event. Fine
   to add to the feed?
7. **Ring timeout UX:** engine hangs up at 30s with "Media request timed
   out". Should the outgoing dialog show "No answer." as a distinct
   outcome (new `CallOutcome`), or reuse `CallEnded`?

---

## 8. Sources

Platform conventions
- Discord voice drop-in, mute vs deafen, keybinds: https://support.discord.com/hc/en-us/articles/360045138571-Beginner-s-Guide-to-Discord ; https://support.discord.com/hc/en-us/articles/31232432266647-Discord-Commands-Shortcuts-and-Navigation-Guide ; input modes https://support.discord.com/hc/en-us/articles/211376518
- Discord Stage channels (moderator/speaker/audience, request to speak): https://support.discord.com/hc/en-us/articles/1500005513722-Stage-Channels-FAQ
- Google Meet layouts (Auto ≤9, Tiled 16 default/49 max, Spotlight, Sidebar): https://support.google.com/meet/answer/9292748 ; shortcuts (Ctrl+D, Ctrl+E, Ctrl+Alt+H, hold-Space PTT, Ctrl+Alt+S announce speaker): https://support.google.com/meet/answer/9298571 ; PiP: https://support.google.com/meet/answer/13665919
- Zoom gallery 25/49, speaker view, hot keys, space-to-talk: https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060612 ; https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0067050 ; network indicator thresholds: https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0083291
- FaceTime incoming call options: https://support.apple.com/en-us/105088
- Signal safety numbers (60 digits, 12×5): https://support.signal.org/hc/en-us/articles/360007060632 ; https://signal.org/blog/safety-number-updates/
- WhatsApp security code: https://faq.whatsapp.com/820124435853543
- Slack huddles (sidebar headphones icon, floating toolbar when navigating, hand raise, captions): https://slack.com/help/articles/4402059015315-Use-huddles-in-Slack ; https://slack.com/help/articles/115004846068-Slack-updates-and-changes
- Around (floating circles, 15-person cap): https://techcrunch.com/2020/03/18/around-video-calling/ ; Tuple (minimal chrome): https://tuple.app/

Accessibility
- WAI-ARIA 1.2 live regions: https://www.w3.org/TR/wai-aria-1.2/ ; MDN live regions: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions
- APG modal dialog (focus on least destructive action, Escape): https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- WCAG 2.2 — 2.4.11 Focus Not Obscured: https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html ; 2.5.7 Dragging Movements: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html ; 2.5.8 Target Size: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html ; 2.1.4 Character Key Shortcuts: https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html ; 1.4.13 Content on Hover or Focus: https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html ; 2.3.3 / C39 reduced motion: https://www.w3.org/WAI/WCAG22/Techniques/css/C39 ; 2.2.1 Timing Adjustable and 1.2.4/1.4.3/1.4.11: https://www.w3.org/TR/WCAG22/
- Media Accessibility User Requirements (caption placement, opacity, not over controls): https://www.w3.org/TR/media-accessibility-reqs/
- KeyboardEvent.repeat for PTT: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/repeat

Grid/tile guidance
- Daily (25 default / 49 max tiles, ≤3 remote on mobile, active-speaker default): https://docs.daily.co/reference/daily-js/factory-methods/create-frame ; https://www.daily.co/blog/tips-to-improve-performance/
- LiveKit GridLayout / visually stable updates: https://docs.livekit.io/reference/components/react/hook/usegridlayout/
- Twilio dominant speaker: https://www.twilio.com/docs/video/detecting-dominant-speaker
- Jitsi tile view config (25 visible, last-N): https://raw.githubusercontent.com/jitsi/jitsi-meet/master/config.js
