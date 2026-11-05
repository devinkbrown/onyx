# Send admission and acceptance: frozen private registry

Finite source-backed implementation addendum. Platform owns bootstrap/private
registry; Namespace owns outbox-journal adapters; Main owns truthful pending/
accepted/unknown views and composer integration. No execution until all code is
integrated. Preserve the full-intent metadata/line-group contract.

## Actual source boundaries

- Server `dispatchRegistered` around22476–22534 captures actual post-registration
  replies for a negotiated `@label`, emitting one labelled reply, a labelled
  response BATCH, or ACK when there is no output. ACK is not send acceptance.
- `messageOneLong` around72625–72758 mints stable msgid/time and sends self echoes
  only under actual echo-message negotiation; actual sender client tags flow
  through MsgTags. `clientOnlyTags`79358 forwards valid '+' tags, but this design
  does not invent a new wire tag or trust a sender-controlled correlation tag.
- `routeMultiline`72378 precedes label capture. `deliverMultiline`72449 splits
  assembled content into ordinary newline messages via messageOneLong(...,null).
  Opening/chunk tags/labels are discarded and outbound multiline BATCH is NOT
  implemented. Do not wait for a nonexistent echoed batch-close or infer a source
  label/msgid mapping from body/time. Such a dispatched multiline group remains
  uncertain under this source. Its ordinary received messages still merge by
  their actual msgids; they do not automatically identify the original intent.
- MEMO SEND64640–64706 replies exact `MEMO: message stored for delivery` or
  `MEMO: message stored (forwarded to <account>)`, and specific FAIL MEMO errors.
  The same success is intentionally returned when recipient ignores sender!
  This proves server request acknowledgement, never actual mailbox storage or
  recipient delivery/read status.

## Actual policy: enable supported MEMO without inventing capability

For an explicitly configured source-bound Onyx Server endpoint contract supporting
MEMO SEND, proven matching account and explicit memo intent, offlineMemoAllowed
is true subject to actual current policy/permission/error state. No separate
imaginary MEMO CAP is required. For an unclassified endpoint it remains unknown
until configured/source-proven support; never hardcode false for the known engine.
Ordinary deferred chat is never rewritten into MEMO. Actual source failures can
disable/refuse current attempts without pretending the command was delivered.

## Exact registry API (private bootstrap implementation)

```
createSendAcceptanceRegistry({ownerSnapshot,isCurrent,negotiatedCaps,
                             currentServerPrefix,currentNick,onProofReady,now})

prepareAttempt({context,recordId,clientIntentId,claimNonce,operation,
                baseTarget,wireTarget,lines,semanticShape})
  -> {lines,validationReceipt,planHash}
validatePreparedDispatch(row,context,ticket,prepared):boolean
observeAdmission({recordId,claimNonce,planHash,kind}):void
ingest(privateIngressEvent):void
verifyAcceptanceProof(proofRef,context,row):boolean
memoCorrelationClear(context,ticket):boolean
retireOwner(owner):void
dispose():void
```

semanticShape is one of single-message, independent-message-lines, multiline-
batch-group or memo. Use actual existing parser and formatter. Capture immutable
owner/physical account generations, exact base/scoped target, row/intent/claim,
full canonical metadata commitment, current mapping revision, final ordered plan
hash and generated request labels. Do not persist plaintext plans; durable journal
attempt stores the already frozen hash/line count/claim metadata.

At most32 pending attempts,1024 line expectations/attempt,256 terminal proof
metadata records,30second expectation deadline. Bound batches/nesting using the
existing labelled-response parser. Timeout marks unknown and never authorizes
resend. Retire physical/account authority while preserving journal uncertainty.

## Actual labelled plan preparation

When message-tags+labeled-response are ACKed, assign a unique opaque fresh label
to each independent PRIVMSG or MEMO request using existing tagged IRC encoder.
Keep reply/action/audience metadata and all byte bounds. Install every expectation
and receipt before first network side effect; compute final plan hash AFTER
labels/tags are encoded. Labels must not be reused for another attempt/account.
Record whether echo-message is actually ACKed; advertised-only is insufficient.

For single-message/independent-line PRIVMSG, each expectation requires a real
label-bound self echo carrying a valid server-issued msgid on the current socket,
same physical source operation, exact scoped wire target and own authenticated
sender/account context. Accept direct labelled echo or echo enclosed in the exact
labelled-response BATCH. Do not require peer-message prefix to equal the server
name: actual self echo is user-prefixed. It must arrive via trusted physical
ingress and its current label/source-sender/account checks, never a peer PM that
merely copies a label. No-label self echo/msgid alone cannot attribute two identical
consecutive intents. Other attachment copies/session-sync/history cannot settle
this physical attempt without equivalent exact source request correlation.

Expected complete actual echo set, not bare ACK or batch-close alone, mints the
proof. For independent fallback lines require every line's own echo/msgid. Keep
partial IDs for display/reconciliation. For actual server multiline assembler,
tags/labels do not survive: mark its acceptance scope unavailable/unknown,
preserve actual messages and uncertain intent separately. Do not change server
code or silently convert a source limitation into successful complete evidence.

## MEMO correlation and accurate meaning

For labelled MEMO require exact pending label or correctly enclosing labelled-
response BATCH, exact learned server prefix/current account/physical context and
one of the two actual fixed success body grammars. Parse forwarded account only
with bounded valid AccountId grammar. Specific FAIL MEMO/461 under that label is
rejection, not acceptance. Bare ACK is insufficient. Set safe status to
server-accepted/request-acknowledged, not delivered/stored/read.

If labels unavailable, allow only ONE serialized MEMO command across the entire
physical private transport family, with expectation installed before send and
all legacy MEMO SEND callers participating. Exact server success/failure can then
settle the sole unambiguous pending request. Unknown timeout/lost response keeps
memoCorrelationClear false until actual physical retirement or explicit source
reconciliation; do not reuse the stream for a new MEMO and steal a late notice.
If another raw sender cannot be excluded, refuse this fallback and retain held
state rather than assert correlation. Recipient ignoring is intentionally opaque.

## Journal integration (required real caller)

Platform feeds the registry actual private ingress, negotiated capability changes
and actual transport line-group admission. It supplies the registry's real
validatePreparedDispatch/memoCorrelationClear/verifyAcceptanceProof callbacks to
the journal instead of false placeholders.

onProofReady receives private `{recordId,proofRef,context}`. Bootstrap queues that
proof if the self echo arrives before durable transport-admitted publication.
Once journal admission state is committed, it actually calls
`journal.reconcileAccepted({...context,recordId,proofRef})`. Only its successful
durable server-accepted return emits a server accepted journal observation; local
IDB failure remains unknown/reconcilable. Keep proof until durable reconciliation
or owner retirement, then retire it. verifyAcceptanceProof validates a registered
unexpired proof, exact row+attempt+hash+owner and complete evidence; caller-created
symbol/string is not proof. Duplicate same-row reconciliation is idempotent;
proof cannot accept another row/attempt. No transaction may reassign proof after
owner switch. No timers/PONG/body equality/bare ACK accepted paths.

Main shows transport-admitted versus server-accepted/request-acknowledged versus
unknown, preserves pending draft/intent metadata and actual accepted message IDs,
and offers only explicit duplicate-risk retry when acceptance cannot be proved.
Do not call unknown “failed, safe to resend”. Server multiline correlation limits
are an acceptance/source prerequisite, not permission to delete existing sending.

Authored cases: labelled echo/msgid, peer forged label, sibling/session-sync copy,
two identical messages, missing echo/batchclose, ACK-only, partial group, no-label
MEMO serialization+late reply, ignored-recipient identical acknowledgement, and
actual reconcileAccepted call/IDB failure. Execute only after implementation.
