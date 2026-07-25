# Web Push + channel notify modes

## Server (Onyx Server)

| Type | When | Payload |
|------|------|---------|
| `dm` | Offline MEMO / closed-tab DM | `{type,from,text}` |
| `mention` | Channel PRIVMSG nick-token match | `{type,from,text,channel}` |
| `call` | MEDIA JOIN first kind in room | `{type,from,text,channel}` |

Body text that looks like E2EE envelope is redacted in the **service worker** (`New encrypted message`).

## Client

| Layer | Role |
|-------|------|
| `shouldNotify` (`decision.ts`) | Desktop/sound gate: DND, mute, focus, throttle; alert kinds include `mention`/`dm`/`follow`/`call` |
| Channel notify mode | Per-channel `all` / `mentions` / `mute` via `channelNotifyMode` |
| `recoverWebPush` | Re-bind after reconnect / SW update |

## Operator check

1. Account → enable push while connected  
2. Close tab; send a mention / start MEDIA JOIN from another client  
3. Lock-screen shows mention/call title, never ciphertext  
