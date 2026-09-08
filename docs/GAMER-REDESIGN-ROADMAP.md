# Onyx gamer redesign roadmap

Status: first public-composition pass in progress. This document is an honest
handoff, not commercial clearance. Screenshot, focused-test, shell-foundation,
and cross-surface evidence gates remain pending until recorded below.

## Astra direction

The public front door is a matte arcade social space for gamers and their
friends: graphite and raised slate surfaces, large display type, cobalt focus
and selection, and a distinct primary action token. The landing story starts
with “Meet here. Make a night of it.”, one dominant Open Onyx action, and a
wide static fictional game-night conversation preview below the hero. Rooms,
conversation, calls, and catch-up follow as substantial product sections.

The public UI consumes the shared semantic font and action variables. It does
not replace the inline theme pipeline, invent live counts or integrations, or
use the normal action color for danger. Invite and Connect copy describes a
destination and a join handoff; room access rules still apply.

## First-pass audit and status

| Surface | First-pass work | Status / gate |
| --- | --- | --- |
| Landing | Full hero, wide preview, room-entry board, product modes, trust band, and reduced duplicate CTAs | Implemented; screenshot and focused tests pending |
| Product preview | Fictional game-night copy, truthful static label, shell-like top nav, 256px room rail, keyboard tabs, matching active section | Implemented; focused tests pending |
| Public frame/header/footer | Shared matte frame and consistent section anchoring across public routes | Implemented; screenshot and focused tests pending |
| About | Social-room story, large type, direct panels, no brochure treatment | Implemented; focused tests pending |
| Guides | Room-first progress and handoff layout retained with new public language | Implemented; focused tests pending |
| Invite | Destination preview and display-name join flow with explicit access-rule note | Implemented; focused tests pending |
| Download | Browser-first release page with factual package/checksum states | Implemented; focused tests pending |
| Status / Roadmap | Matte, readable contract pages with live/status semantics unchanged | Implemented; focused tests pending |
| Privacy / Guidelines / Contact | Shared public-information composition; copy and safety/security meaning retained | Implemented; focused tests pending |
| Connect | Desktop destination context beside form; mobile context before form; guest/sign-in/register/recovery behavior retained | Implemented; viewport and focused tests pending |
| Metadata | Root title, description, social title/description, and image alt aligned to public front door | Implemented; metadata tests pending |

## Evidence gates

- [ ] Desktop landing screenshot at 1440px and mobile landing screenshot at
  390px reviewed for hierarchy, overflow, high zoom, and reduced motion.
- [ ] Connect desktop and phone checkpoint reviewed; destination context must
  remain separate from the form without changing join behavior.
- [ ] Focused route, public-frame, Connect, preview, and owned e2e contracts
  pass. Full build and full suite are intentionally not run in this wave.
- [ ] Shared Foundation/Luna token remap supplies the approved matte palette,
  `var(--font-display)`, `var(--font-sans)`,
  `var(--commercial-action-primary)`, and safe on-accent text. Public CSS is
  already consuming those variables.
- [ ] Payload remains within the existing +5% budget; no baseline is changed
  to hide growth.
- [ ] Shell-owned stale aesthetic expectations are updated by Luna; this lane
  does not edit shell phone/art/token tests.

## Astra follow-up gates — pending evidence

These items are recorded for the next wave and are not claimed complete here.

| Priority | Finding | Owner | Status |
| --- | --- | --- | --- |
| P0 | Call controls and recording ownership stay coherent across navigation | Shell Luna | Pending implementation and evidence |
| P0 | Deleted, redacted, and locked pin previews fail closed | Shell Luna | Pending implementation and evidence |
| P1 | Account/device settings are coherent | Secondary Luna | Pending implementation and evidence |
| P1 | Search scope and header anchoring are clear | Secondary Luna | Pending implementation and evidence |
| P1 | Threads show parent/reply loading states and Reply uses the composer | Secondary Luna | Pending implementation and evidence |
| P1 | Invite copy/share status is visible without implying restricted admission is granted | Secondary Luna | Pending implementation and evidence |
| P1 | Notification unread state refers to notifications, not conversations | Secondary Luna | Pending implementation and evidence |
| P1 | Voice device labels, permission states, and navigation focus are clear | Secondary Luna | Pending implementation and evidence |

No item in this table is commercial clearance. Each stays pending until its
owner supplies source, focused-test, and runtime/browser evidence.
