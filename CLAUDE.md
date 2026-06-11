# Ocean — IRC Webchat

Modern IRC client backed by the Orochi IRC engine (pure-Zig successor to Ophion; source at /home/kain/orochi). Dark luxury design.

## Stack
- **Next.js 16** (App Router, static export)
- **TypeScript + Tailwind 4**
- **Zustand** state management
- **pnpm** (always pnpm, never npm)

## Key libs (do NOT rewrite these from scratch)
- `lib/irc/` — IRC WebSocket client with SASL PLAIN/SCRAM, CAP, IRCv3, IRCX
- `lib/ladon-media/` — Orochi voice+video engine (NOT WebRTC); signaling = MEDIA subcommands + NOTE MEDIA events
  - VeilSession.ts — P-256 ECDH + AES-256-GCM encryption
  - MediaEngine.ts — voice/video send+recv, adaptive bitrate
  - VeilGroup.ts — group session key derivation
  - ChunkAssembler.ts — MCHUNK reassembly
  - PeerRegistry.ts — per-peer audio/video decode

## Voice / Audio
Voice and video use the **Orochi media protocol**, NOT WebRTC.
Transport: IRC messages (MEDIA subcommands + NOTE MEDIA events over WebSocket).
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
| Orochi account (built-in) | Ocean account |
| CHATHISTORY | Message history |
| IRCX PROP | Channel/user properties |
| IRCX ACCESS | Permission overrides |
| MEDIA subcommands + NOTE MEDIA | Voice/video channel |

## Build
```bash
pnpm build          # builds to out/
pnpm dev            # development server
```

## Deploy
```bash
bash deploy/deploy.sh       # copies out/ to nginx webroot
```

Configure `NEXT_PUBLIC_IRC_WS` in `.env.local` to point to your Orochi WebSocket endpoint; `NEXT_PUBLIC_MEDIA_URL` points at the nexus-upload proxy (`/upload` POST, files under `/uploads`).

## Design system
All design tokens live in `app/globals.css` under `:root`.
- Surfaces: `--bg-void` through `--bg-overlay` (6 levels)
- Default theme: `midnight` — sky blue `--accent` (#0ea5e9), bioluminescent cyan `--gold` (#67e8f9)
- Accent: `--accent` (sky blue #0ea5e9 in default/midnight theme)
- Gold: `--gold` (#67e8f9, bioluminescent cyan)
- Component styles are co-located as `<style>` tags inside components

## Auth features integrated
- **SASL PLAIN** — direct password login
- **SESSION TOKEN / RESUME** — persistent login: after SASL, request `SESSION TOKEN` (arrives as `NOTE SESSION TOKEN`); reconnect with `SESSION RESUME <token>`
- **SCRAM-SHA-256** — preferred when advertised (Orochi: sasl=PLAIN,EXTERNAL,SCRAM-SHA-256)
- **CERTFP** — future: cert-based auth
- **IDENTIFY** — automatic on connect when password provided
- **ACCOUNT GHOST** — kill a stale session using Ophion's built-in services (no NickServ)
- **ACCOUNT** tag — account name auto-populates from server

## Services (Orochi built-in — NO NickServ bot)
Orochi services are real server commands; results arrive as standard replies (NOTE/FAIL/WARN), not NOTICE text.
- `REGISTER` / `VERIFY` — account signup (draft/account-registration)
- `IDENTIFY` / `LOGOUT` / `DROP` / `ACCOUNTINFO` / `ACCOUNTSET` — account lifecycle
- `GHOST <nick>` — kill a stale session claiming your nick
- `CERTADD` / `CERTLIST` / `CERTDEL` — certificate fingerprint binding
