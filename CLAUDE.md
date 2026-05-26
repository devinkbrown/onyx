# Ocean — IRC Webchat

Modern IRC client backed by the Ophion IRC engine. Dark luxury design.

## Stack
- **Next.js 16** (App Router, static export)
- **TypeScript + Tailwind 4**
- **Zustand** state management
- **pnpm** (always pnpm, never npm)

## Key libs (do NOT rewrite these from scratch)
- `lib/irc/` — IRC WebSocket client with SASL PLAIN/SCRAM, CAP, IRCv3, IRCX
- `lib/ladon-media/` — LADON/Ophion voice+video engine (NOT WebRTC)
  - VeilSession.ts — P-256 ECDH + AES-256-GCM encryption
  - MediaEngine.ts — voice/video send+recv, adaptive bitrate
  - VeilGroup.ts — group session key derivation
  - ChunkAssembler.ts — MCHUNK reassembly
  - PeerRegistry.ts — per-peer audio/video decode

## Voice / Audio
Voice and video use the **LADON/Ophion media protocol**, NOT WebRTC.
Transport: IRC messages (MEDIAFRAME / MCHUNK commands over WebSocket).
No STUN/TURN servers needed.

## IRC → Ocean concept mapping
| IRC | Ocean |
|-----|-------|
| IRC network | Server |
| #channel | Text channel |
| Private message | DM |
| +q (owner) | Owner role (gold) |
| +o (operator) | Op role (violet) |
| +v (voice) | Voice role (green) |
| Ophion account (built-in) | Ocean account |
| CHATHISTORY | Message history |
| IRCX PROP | Channel/user properties |
| IRCX ACCESS | Permission overrides |
| LADON MEDIAFRAME | Voice/video channel |

## Build
```bash
pnpm build          # builds to out/
pnpm dev            # development server
```

## Deploy
```bash
bash deploy/deploy.sh       # copies out/ to nginx webroot
```

Configure `NEXT_PUBLIC_IRC_WS` in `.env.local` to point to your Ophion wsockd endpoint.

## Design system
All design tokens live in `app/globals.css` under `:root`.
- Surfaces: `--bg-void` through `--bg-overlay` (6 levels)
- Default theme: `midnight` — sky blue `--accent` (#0ea5e9), bioluminescent cyan `--gold` (#67e8f9)
- Accent: `--accent` (sky blue #0ea5e9 in default/midnight theme)
- Gold: `--gold` (#67e8f9, bioluminescent cyan)
- Component styles are co-located as `<style>` tags inside components

## Auth features integrated
- **SASL PLAIN** — direct password login
- **SASL SESSION-TOKEN** — persistent login via Ophion-issued 30-day tokens (auto-selected when token present)
- **SCRAM-SHA-256/512** — preferred if server advertises it (auto-selected)
- **CERTFP** — future: cert-based auth
- **IDENTIFY** — automatic on connect when password provided
- **ACCOUNT GHOST** — kill a stale session using Ophion's built-in services (no NickServ)
- **ACCOUNT** tag — account name auto-populates from server

## Services (Ophion built-in — NO NickServ bot)
Ophion services are built into the ircd. Commands are sent as `ACCOUNT <subcommand>`, not `PRIVMSG NickServ`.
Server notices from services arrive as `:<server> NOTICE <nick> :<Service>: <message>`.
- `ACCOUNT GHOST <nick>` — kill a stale session claiming your nick
- `ACCOUNT RECOVER <nick> <password>` — reclaim a nick without being identified
- `ACCOUNT REGISTER <password>` — register an account
