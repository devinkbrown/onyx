# Private account management: final bounded extension

Architecture/source contract, 2026-11-04. Extend existing account journeys; do not
leave mandatory-runtime gates as final disabled features. No tests, typechecks,
builds, browsers or servers run until all implementation is integrated. Preserve
the existing private-account-security.md and Namespace's current reply grammar.

## Ownership and public boundary

- **Namespace Luna:** extend private-account-security.ts and authored tests with
  the finite intents/parsers below; keep identity-owner continuation work intact.
- **Platform Luna:** bootstrap/private form/ref/host brokers, current source
  ingress, private encoded transport, account-transition and credential retirement.
- **Main Luna:** App/Main/ports/View.Account/View.GuestClaim/Services integration,
  safe status and replacement controls. No passwords/codes in Elm input messages,
  model, SendLine, diagnostics, cache, URL or account export.

Reuse the existing private security `begin(context,intent)`/safe status methods
and its serialized physical operation ownership. Do not introduce arbitrary
command/field/value sending. Main mounts private DOM forms into registered hosts;
Elm receives only opaque formRef and safe labels/status. Pending raw legacy
ACCOUNTSET/SETPASS/RESETPASS/REGISTER/VERIFY/DROP operations cannot race these
private forms and steal unlabelled replies.

## Exact finite intent and form shape

Add these intents to the private security service:

| Intent | Private form kind and exact fields | Actual command |
|---|---|---|
| `{action:'account-email',formRef}` | account-email: email,currentPassword | ACCOUNTSET currentAccount currentPassword email email |
| `{action:'account-password',formRef}` | account-password: currentPassword,newPassword,confirmPassword | SETPASS currentPassword newPassword |
| `{action:'account-certificate-reset',formRef}` | account-certificate-reset: newPassword,confirmPassword | SETPASS newPassword; only current actual cert-verified account |
| `{action:'account-drop',formRef,confirm:true}` | account-drop: confirmAccount,currentPassword | DROP currentAccount currentPassword |
| `{action:'password-reset-request',account}` | no secret form | RESETPASS account |
| `{action:'password-reset-confirm',account,formRef}` | password-reset-confirm: resetCode,newPassword,confirmPassword | RESETPASS account resetCode newPassword |
| `{action:'account-register',account,formRef}` | account-register: email,password,confirmPassword | REGISTER account email-or-* password |
| `{action:'account-verify',account,formRef}` | account-verify: verificationCode | VERIFY account verificationCode |

Account/password change/drop target current actually source-proven account only;
caller cannot supply a different account. Register/reset/verify account input is
a validated public account identifier, never assumed authenticated identity.
Email is read privately; show actual observed email only through the account-info
privacy projection if desired. Private form field names are an explicit allowlist,
not arbitrary DOM selectors. One-use formRefs bind request/owner/kind/expiry.

`readAndClearPrivateForm(formRef,context,kind)` returns a private discriminated
union of these exact field sets using strings or owned byte buffers. It clears
DOM secrets even on invalid input/rejection. Do not trim or normalize passwords.
New passwords match confirmation, differ from current for normal change and
contain8..512 UTF-8 bytes per actual server password policy. Reject NUL/CR/LF,
unpaired surrogates and invalid wire controls without truncation. Current password
used as a middle IRC parameter must fit existing wireToken grammar; do not silently
truncate/strip spaces or inject IRC syntax. New/final passwords use the existing
encoder's trailing-parameter form when required. Validate full encoded byte cap.
Email uses existing isValidAccountEmail semantics and bounded wire value; optional
registration email '*' preserves the existing server feature. Reset/verification
codes are private bounded source token inputs (actual reset token32hex); reject
invalid control/length rather than logging them. DROP requires exact current
account confirmation and explicit destructive submit; transport admission alone
does not close the panel or claim deletion.

Certificate reset is offered only when actual connection auth factor/certificate
binding is known; missing current factor hides/refuses only that variant, not
normal password change. It must never be inferred from a saved cert fingerprint
or an arbitrary generic proof API.

The service receives a private `isCertificateVerifiedAccount(owner)` predicate
from the current connection/authentication facts. It checks that predicate at
submission and never exposes the factor or certificate binding in safe status.

## Actual server outcomes

Exact learned server prefix/current physical endpoint/target/request correlation
is mandatory. Reuse source parser/IRC encoder, not body substring success checks.

| Operation | Accepted source reply | Other required behavior |
|---|---|---|
| Email | NOTICE body `Account <exact account> updated (email)` | ACCOUNTSET FAIL code or461/464 for this pending operation is failure. Refresh ACCOUNTINFO separately; update notice does not prove email ownership. |
| Password | NOTICE `SETPASS: your password has been changed` | FAIL SETPASS WRONG_PASSWORD/INVALID_PASSWORD/TEMPORARILY_UNAVAILABLE/ACCOUNT_REQUIRED is failure; no ACCOUNTSET password support. |
| Certificate reset | NOTICE `SETPASS: your password has been reset (verified by client certificate)` | RESET_NOT_AUTHORIZED is explicit refusal, not fallback to an unproven reset. |
| Drop | NOTICE `Account <exact account> dropped` | Server then closes requester. Lost notice/close alone is unknown. Accepted notice retires live account credentials/proofs/session authority; preserve scoped encrypted local data until explicit clear. |
| Reset request | NOTICE `RESETPASS: if that account has a verified email, a reset code has been sent.` | Report neutral request acknowledged only. Never expose account existence, claim delivery or mark password reset. UNAVAILABLE says feature not configured. |
| Reset confirm | `RESETPASS SUCCESS <exact account> :Password reset; log in with your new password` | NO_REQUEST/EXPIRED/BAD_CODE/TOO_MANY_ATTEMPTS/INVALID_PASSWORD/TEMPORARILY_UNAVAILABLE are distinct safe errors. Does not log in; clear private input and offer explicit login. |
| Registration | `REGISTER SUCCESS <exact account> :Account registered` | Registration result and current account proof transition remain distinct state projections. Preserve actual server binding path; do not automatically submit IDENTIFY using a password stored in Elm. |
| Email verification | NOTICE `VERIFY: your account email is now verified` | `VERIFY: nothing to verify for your account` means no pending verification, not verified success. EXPIRED/INVALID_CODE/TOO_MANY_ATTEMPTS/ACCOUNT_REQUIRED failures are preserved. No login is implied. |

Source anchors (server repo `/home/kain/onyx-server`):

- `src/daemon/server.zig` handleAccountSet57626–57679 supports email/flags/secure/
  enforce only. The legacy Elm password ACCOUNTSET builder is incompatible;
  private replacement uses actual handleSetpass54948–54999.
- handleDrop54891–54931 queues the committed dropped notice before terminal close
  and retires account session/reset/TOTP authority.
- handleResetpass55015–55060 uses a neutral request reply and dedicated SUCCESS
  command only after durable password admission; reset code is32 lowercase hex.
- handleRegister54510–54570 binds account, emits REGISTER SUCCESS and separately
  explains emailed/unverified email state. Do not claim email verification from
  registration success.
- handleVerify35473–35523 explicitly distinguishes verified/no-pending/error.
- Existing client App.requestAccountSetEmail26959,
  requestAccountSetPassword26993, requestDropAccount27047 and Services builders
  show the journeys to preserve. View.GuestClaim's password/code onInput paths
  must be replaced under the active private runtime as well as View.Account.

## Correlation, safe projection and transitions

Install pending operation state before network admission. Exactly one unlabelled
private account mutation/recovery operation owns the stream; labels may refine
matching only when actually negotiated. Deadlines remain the existing30seconds.
Definitively blocked zero-write is blocked; admitted is pending, never accepted.
Timeout/transport loss/ambiguous send is unknown and retains operation provenance;
no automatic retry of DROP/password/reset/register. Keep stream ambiguity until
source reconciliation or physical retirement. Bare ACK/PONG cannot settle it.

Extend the existing safe SecurityStatus action union, without raw reply text:

```
{schemaVersion:1,requestId,operationRef,ownerRef,accountGeneration,
 connectionGeneration,action,phase,reason,
 accountOutcome:
 'none'|'email-updated'|'password-changed'|'certificate-password-reset'|
 'account-dropped'|'reset-request-acknowledged'|'password-reset'|
 'account-registered'|'email-verified'|'no-pending-verification',
 targetAccount:string|null,requiresLogin:boolean}
```

Existing TOTP/recovery fields remain; management actions use their safe defaults.
Fixed reasons include invalid-form, password-mismatch, weak-password,
wrong-password, invalid-email, invalid-code, expired, no-request,
too-many-attempts, account-required, reset-not-authorized, unavailable,
temporarily-unavailable, permission-denied, stale-owner, transport-blocked,
transport-unknown and response-unknown. Unknown server codes map to a fixed
operation-failed code, never String(error)/raw body.

For registration/account-change source events, bootstrap notifies the private
service with the actual prior→next owner transition on the same physical socket.
Only its matching pending registration/account action may migrate its result to
the proven successor context; this is not a general stale-result exception.
DROP notice must be recorded before retiring credentials/owner so its safe result
survives terminal close. Logout/close alone does not prove deletion. Password/
reset/factor changes retire/reconcile source-invalidated account continuation
tokens through identity-owner; do not invent bouncer credential revocation beyond
actual server outcomes. Require actual source account proof for any subsequent
authenticated operation.

## UI preservation and bounded audit result

Mandatory-runtime replacement must provide real controls in Account settings for
email/password/drop, and GuestClaim/sign-in for registration/verification/reset.
Keep password/code fields in the private DOM. Main may retain safe account labels,
busy/error/status/selected action and opaque formRef only. Wipe old secret model
fields and stop their onInput/outbound paths under the private runtime; replacing
a secret form with a notice alone is unfinished work. Gate only while its actual
replacement is mounting, not as feature completion.

Existing TOTP/recovery private replacement and WebAuthn private ceremony work
remain owned by their current writers. Do not overwrite them. This extension
does not add general flags/secure/enforce controls, arbitrary host management,
new recovery protocols or an invented generic proof method. Existing login/
registration/verify/drop/password/email are the bounded secret-form audit scope.

Authored cases: actual success/failure grammar, ACCOUNTSET password rejection
versus SETPASS success, neutral reset request, private code intake, duplicate/
late ACK, wrong account/prefix, DROP notice-before-close versus lost receipt,
registration account-generation transition, expired reset/verify, byte limits
and absence of secrets in Elm/public logs/cache. Execute only after all code is
integrated.
