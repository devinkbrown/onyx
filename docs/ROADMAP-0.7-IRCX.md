<!-- SPDX-FileCopyrightText: 2026 Devin Brown <devin.kyle.brown@gmail.com> -->
<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->

# Onyx client — 0.7 IRCX adaptation

**0.7 stays 0.7.** This is the client half of the major-release IRCX track.
Authoritative cross-repo plan:
[`../../onyx-server/docs/releases/0.7-MAJOR-ROADMAP.md`](../../onyx-server/docs/releases/0.7-MAJOR-ROADMAP.md)
(track **CX**, daemon track **IX**).

Onyx already opts into IRCX at connect (`src/lib/irc/client.ts` sends `IRCX`)
and folds PROP, ACCESS, inbound WHISPER, and oper EVENT. The gap is product
adaptation: the default UI still thinks in IRC MODE letters and LIST, not
LISTX / MODEX / WHISPER / PROP.

---

## Already shipped (do not rebuild)

| Surface | Where |
| --- | --- |
| `IRCX` on connect, `isIRCX` | `client.ts`, `store.ts` |
| PROP snapshot 818/819 + live `PROP` | `store.ts`; pins, topics, watch, stage, encryption, history, AI |
| ACCESS LIST/ADD/DELETE + settings UI | `store.ts`, `channelAccess.ts`, `ChannelSettings.tsx` (Advanced) |
| WHISPER inbound fold | `store.ts` `case 'WHISPER'` |
| Oper EVENT desk | `operDesk.ts`, `OperDesk.tsx` |
| Hostile PROP bounds | `store.inboundBounds.test.ts` (`__proto__`, oversize) |

## Missing (0.7 CX)

| ID | What the user can do | Owner | Server-first? |
| --- | --- | --- | --- |
| **CX-1** | Browse rooms with LISTX filters (members, age, topic, PICS); see truncation | `onyx-irc` · `onyx-ui` | IX-3 |
| **CX-2** | Change named modes (AUTHONLY, HIDDEN, AUDITORIUM, NOWHISPER, …) without typing `+a` | `onyx-ui` | IX-2 |
| **CX-3** | Send an in-channel WHISPER; see 923 when `+w`; inbound already renders | `onyx-ui` · `onyx-store` | IX-4 |
| **CX-4** | One PROP-backed room/user settings surface; values never `innerHTML` | `onyx-store` · `onyx-render` · `onyx-ui` | IX-7 |
| **CX-5** | Room lifecycle / media EVENT for non-opers | `onyx-irc` · `onyx-ui` | **IX-8 first** |
| **CX-6** | ACCESS timeout + reason; 482 fail-closed; SACCESS stays oper | `onyx-ui` | IX-5 |
| **CX-7** | Auditorium roster matches server visibility | `onyx-store` · `onyx-ui` | IX-6 |
| **CX-8** | DATA/REQUEST/REPLY as inert typed lines; known tags stay documented | `onyx-render` · `onyx-irc` | IX-4 |
| **CX-9** | Identity sheet = WHOIS + user PROP (C-01 merged) | `onyx-ui` | gated |
| **CX-10** | Slash/command palette: `/listx` `/modex` `/whisper` `/prop` | `onyx-cmdk` · `onyx-irc` | IX-10 |

## Client harden (HX-11…14)

Hostile IRCX payloads are part of 0.7, not a later polish train:

- **HX-11** render: topic / PROP / DATA / WHISPER → JSX text only (`onyx-render`).
- **HX-12** store: ACCESS / LISTX / EVENT JSON / MODEX bounds (`onyx-store`).
- **HX-13** E2EE fail-closed notify body (`onyx-crypto`, `onyx-notify`).
- **HX-14** origin-strict WSS (`onyx-irc`).

## Constraints

- `src/lib/store/store.ts` is wave-exclusive (`onyx-store`).
- Capability and new EVENT types ship **server-first**.
- Gate every slice: `pnpm typecheck && pnpm lint && pnpm test`.
- Do not invent daemon verbs the IX-1 matrix marks as divergences.

## Accept

A user who never types a MODE letter can find a room (LISTX), set named
modes (MODEX), whisper, edit ACCESS, and see PROP policy. A hostile PROP or
DATA value cannot become script.
