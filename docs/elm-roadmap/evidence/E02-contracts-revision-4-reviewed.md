# Compatibility matrix for roadmap §15

This records contract drift and its source-backed correction. “Observed”
describes source behavior, not deployment or client acceptance. The client
remains subject to its own source-bound receipts.

| ID | Contract/document claim | Current source behavior | Client implication | Status / next evidence |
|---|---|---|---|---|
| C1 | Historical v2 contract and account reference listed `SESSION MTOKEN` as a command. | Server accepts `SESSION TOKEN`; an optional `SESSION MTOKEN <credential> expires=<unix>` is a TOKEN response. Source anchors: `src/daemon/session_sid.zig`, `handleSession` in `src/daemon/server.zig`. | Revision 4 separates request commands and response forms; v1 remains historical and unchanged. Never send MTOKEN. | Source correction authored; independent review and focused contract lanes pending. Candidate-5 disagreement remains historical evidence. |
| C2 | “One IRC message per frame” conflated WebSocket frames/fragments with WebSocket application messages and protocols. | Text IRC uses one complete line per application message, without CR/LF/NUL; `text.ircv3.net` is text-only. `onyx.irc-media.v1` permits binary Cadence messages and frame fragmentation is allowed. | Revision 4 records the application-message rule and protocol-specific media exception. | Source correction authored; protocol/browser scenarios and focused contract lanes remain pending. |
| C3 | v2 `production_wired` client claims can be read as proof of current implementation acceptance. | A claim in a JSON artifact does not fingerprint or test this dirty Elm working tree. | Record a source manifest and complete client results separately from intended contract fields. | Candidate-5 mismatch remains a historical observation; revision-4 source semantics still require independent validator and acceptance evidence. |
| C4 | Required room policy text that mentions only `+onyx/e2ee` can imply the tag alone is sufficient. | Current canonical room body validation requires valid `ONYXROOM1` payload in addition to the marker; tagging plaintext is rejected. Roadmap anchor: v2 policy vectors and live `e2ee_policy`/message admission path. | Validate marker and body envelope; do not accept marker-only payloads. | Policy and body vectors need a receipt mapped to the inspected Elm source. |
| C5 | Session inventory, revoke end, or positive lease can be mistaken for complete durable denial. | These are distinct observations; none alone proves all group-associated credentials are durably denied. | Keep partial inventory/revocation states truthful; do not infer complete durable denial. | Candidate pagination and durable-denial runtime evidence remain open. |

## Guardrails

- This matrix records the authorized revision-4 correction as well as historical
  observations; it does not certify deployment or client acceptance.
- Preserve the candidate-5 validator failure (`client observer/runtime/message
  activation split is frozen`) as historical evidence. Revision 4 is a separate
  source-backed correction, not a deletion of the check or a manufactured green
  result. Keep the server session-persistence activation hold and strict policy
  and security checks.
- For each row, future receipts need the exact client manifest digest and, where
  relevant, the server source revision, artifact/configuration hash, and runtime
  observation.

## E02 validator observation and correction

The last recorded working-tree observation is deliberately preserved as a
failure: `pnpm check:server-contract-v2` exited **0**, while
`python3 -B tools/check-client-contract.py` in `/home/kain/onyx-server` exited
**1** with `client observer/runtime/message activation split is frozen`.
This is not a fresh result from the infrastructure implementation turn. The
revision-4 correction now aligns the independently specified validators and
mirrored v2 JSON for current source-backed client wiring, SESSION request versus
response forms, and WebSocket application-message framing. It leaves the v1
artifact untouched and preserves `group_control_runtime.session_persistence:
activation_hold`. The `contract-observations` runner remains observation-only;
it records both command results and does not edit contracts or weaken checks.
The new correction remains pending independent review and focused positive and
negative contract runs; normative/source-wired semantics alone are not release
acceptance.
