# Web Push + channel notify modes

## Server (Onyx Server)

| Type | When | Payload |
|------|------|---------|
| `dm` | Offline MEMO / closed-tab DM | `{type,from,text}` |
| `mention` | Channel PRIVMSG nick-token match | `{type,from,text,channel}` |
| `call` | MEDIA JOIN first kind in room | `{type,from,text,channel}` |

The client service worker (`elm/sw.js`) never shows payload text: the body is
always generic ("You have a new notification."), DM titles never name the
sender, and the title depends on the user's preview policy (`private`,
`sender-only`, `message-preview`).

## Client

| Layer | Role |
|-------|------|
| `elm/src/Notify.elm`, `QuietHours.elm` | Desktop/sound gate: do-not-disturb, quiet hours, mute, focus |
| Per-room notify level | `onyx:channel-notify` (`all` / `mentions` / `mute`) |
| `elm/src/Push.elm`, `PushLifecycle.elm`, `elm/runtime/push-lifecycle.ts` | Web Push subscription via the server `WEBPUSH` contract and this browser's service worker; re-bind after reconnect or worker update |
| `elm/sw.js` | `push` handler and owner-checked `notificationclick` routing |

## Operator check

1. Turn on notifications in the app while connected (the browser must grant permission)
2. Close tab; send a mention / start MEDIA JOIN from another client
3. Lock screen shows a generic notification, never message text or ciphertext
