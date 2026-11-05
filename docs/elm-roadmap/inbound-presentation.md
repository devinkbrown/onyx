# Bounded inbound chat presentation

Wave 47 adds opt-in batching for eligible public channel chat between browser
runtime and Elm. This local path changes no IRC lines, WebSocket protocol, or
Onyx Server behavior.

## Contract

Optional `BrowserRuntimeConfig.onFrames` receives `{ owner, frames }`, with
each frame retaining its `{ at, lines }` receipt. Without it, the runtime
calls legacy `onLines` immediately. `elm/index.html` forwards opt-in batches to
the `wsFrames` port; `Main.wsFramesMessage` decodes `WsFramesReceived`.

The runtime batcher fences with the full `OwnerSnapshot`, including physical
transport reference, owner reference, network, nullable account, and both
generations. The port carries the public five-field stamp: owner reference,
network, nullable account, account generation, and connection generation.
Elm folds only an exact match with `runtimeOwnerStamp`; stale or malformed
batches are ignored.

Frames fold in order through existing `WsBatchReceived`, preserving per-line
receipt times, PONG latency sampling, and monotonic clock behavior. Outbound
replies accumulate in frame and line order; Main's existing dispatch keeps
that wire order. Legacy `wsLines` and `WsBatchReceived` remain available.

## Eligibility and boundaries

Only peer-originated plaintext `PRIVMSG` lines for a channel joined on the
current physical connection are eligible. Runtime requires a current owner,
learned server prefix, nick, and case mapping; it excludes server/self
messages and rejects tagged control or CTCP/control-byte bodies. Other public
and private/control traffic remains immediate.

Queued chat flushes before ineligible ingress, validated sends and current-
owner domain actions, and account/connection retirement, connect/close, and
disposal while the previous full owner is current. Stale-owner data drops.

The queue holds at most 16 frame records with a conservative 64 KiB accounting
bound: each UTF-16 code unit costs up to three UTF-8 bytes. It requests a flush
after 8 ms; browser timer clamping means that is not a real-time promise.
Overflow flushes existing records before the next eligible frame; an oversized
frame is delivered immediately if its owner remains current.

The intended tradeoff is a small, bounded delay for eligible chat presentation
relative to unrelated UI work. The path preserves the order of its own frames
and replies; it does not claim identical interleaving with unrelated UI
updates compared with immediate delivery.

Timer-driven flush catches renderer errors after clearing the failed batch and
never retries it. A reentrant current-owner batch stays queued separately; a
frame the refilled queue declines is presented immediately only while its
owner remains current. Ordinary enqueue/overflow and immediate-frame callback
errors are contained without replay. Control-line and send-boundary flushes
propagate errors to synchronous transport hooks, which fail closed. During
disposal, full `OwnerSnapshot` equality drains received frames before queue
disposal, while strict `isCurrent` rejects new authoring once disposal starts.
Retirement and disposal contain renderer errors and continue resource cleanup.

## Source and tests

Implementation: [`bootstrap.ts`](../../elm/runtime/bootstrap.ts),
[`public-ingress-batcher.ts`](../../elm/runtime/public-ingress-batcher.ts),
[`transport-owner.ts`](../../elm/runtime/transport-owner.ts),
[`index.html`](../../elm/index.html), [`Main.elm`](../../elm/src/Main.elm),
[`App.elm`](../../elm/src/App.elm). Tests cover the
[`batcher`](../../elm/runtime/public-ingress-batcher.test.ts),
[`runtime boundaries`](../../elm/runtime/bootstrap-domain-integration.test.ts),
[`transport hooks`](../../elm/runtime/transport-owner.test.ts), Elm
[`AppTest`](../../elm/tests/AppTest.elm), and [`MainTest`](../../elm/tests/MainTest.elm).

This states the opt-in contract only; acceptance and measured performance remain unestablished.
