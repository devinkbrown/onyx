import { formatIRCLine, parseIRCMessage } from '../../src/lib/irc/parser';
import {
  isRecoveryCodesCleared,
  isRecoveryCodesLoginOk,
  parseRecoveryCodeLine,
  parseRecoveryCodesStatus,
} from '../../src/lib/irc/recoveryCodes';
import { type EndpointId, type OwnerSnapshot, type RequestContext, type RequestId, type SendAdmission } from './contracts';

export type PrivateAccountSecurityIntent =
  | { readonly action: 'totp-status' | 'totp-enroll' | 'totp-disable' | 'recovery-status' }
  | { readonly action: 'totp-confirm'; readonly formRef: string }
  | { readonly action: 'recovery-generate' | 'recovery-clear'; readonly formRef: string | null }
  | { readonly action: 'recovery-login'; readonly account: string; readonly formRef: string }
  | { readonly action: 'account-email' | 'account-password' | 'account-certificate-reset'; readonly formRef: string }
  | { readonly action: 'account-drop'; readonly formRef: string; readonly confirm: true }
  | { readonly action: 'password-reset-request'; readonly account: string }
  | { readonly action: 'password-reset-confirm' | 'account-register' | 'account-verify'; readonly account: string; readonly formRef: string };

export type PrivateAccountSecurityAction = PrivateAccountSecurityIntent['action'];
export type PrivateAccountSecurityPhase = 'pending' | 'accepted' | 'unknown' | 'blocked' | 'failed' | 'dismissed';
export type PrivateAccountSecurityReason = 'busy' | 'stale-owner' | 'invalid-input' | 'transport-blocked' | 'timeout' | 'server-failure' | 'malformed-response' | 'not-proven' | 'expired' | 'copy-failed' | 'invalid-form' | 'password-mismatch' | 'weak-password' | 'wrong-password' | 'invalid-email' | 'invalid-code' | 'no-request' | 'too-many-attempts' | 'account-required' | 'reset-not-authorized' | 'unavailable' | 'temporarily-unavailable' | 'permission-denied' | 'transport-unknown' | 'response-unknown' | 'operation-failed';
export type TotpState = 'unknown' | 'disabled' | 'pending' | 'active';
export type PrivateAccountOutcome = 'none' | 'email-updated' | 'password-changed' | 'certificate-password-reset' | 'account-dropped' | 'reset-request-acknowledged' | 'password-reset' | 'account-registered' | 'email-verified' | 'no-pending-verification';

export interface PrivateAccountSecurityStatus {
  readonly schemaVersion: 1;
  readonly requestId: RequestId;
  readonly operationRef: string;
  readonly ownerRef: OwnerSnapshot['ownerRef'];
  readonly accountGeneration: number;
  readonly connectionGeneration: number;
  readonly action: PrivateAccountSecurityAction;
  readonly phase: PrivateAccountSecurityPhase;
  readonly reason: PrivateAccountSecurityReason | null;
  readonly totpState: TotpState;
  readonly remainingCodes: number | null;
  readonly presentationRef: string | null;
  readonly accountOutcome: PrivateAccountOutcome;
  readonly targetAccount: string | null;
  readonly requiresLogin: boolean;
}

export type PrivateFormKind = 'totp-code' | 'recovery-password' | 'recovery-code' | 'account-email' | 'account-password' | 'account-certificate-reset' | 'account-drop' | 'password-reset-confirm' | 'account-register' | 'account-verify';
export type PrivateAccountManagementForm =
  | { readonly kind: 'account-email'; readonly email: Uint8Array; readonly currentPassword: Uint8Array }
  | { readonly kind: 'account-password'; readonly currentPassword: Uint8Array; readonly newPassword: Uint8Array; readonly confirmPassword: Uint8Array }
  | { readonly kind: 'account-certificate-reset'; readonly newPassword: Uint8Array; readonly confirmPassword: Uint8Array }
  | { readonly kind: 'account-drop'; readonly confirmAccount: Uint8Array; readonly currentPassword: Uint8Array }
  | { readonly kind: 'password-reset-confirm'; readonly resetCode: Uint8Array; readonly newPassword: Uint8Array; readonly confirmPassword: Uint8Array }
  | { readonly kind: 'account-register'; readonly email: Uint8Array; readonly password: Uint8Array; readonly confirmPassword: Uint8Array }
  | { readonly kind: 'account-verify'; readonly verificationCode: Uint8Array };
export interface PrivateRecoveryLoginSourceSuccess {
  readonly context: RequestContext;
  readonly requestId: RequestId;
  readonly operationRef: string;
  readonly owner: OwnerSnapshot;
  readonly account: string;
  readonly endpointId: EndpointId;
}
export interface PrivateAccountSecurityDependencies {
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly currentServerPrefix: () => string | null;
  readonly currentNick: () => string | null;
  readonly endpointId: () => EndpointId;
  readonly isAccountProven: (owner: OwnerSnapshot) => boolean;
  readonly isCertificateVerifiedAccount: (owner: OwnerSnapshot) => boolean;
  /** Exact source success from the current pending RECOVERYCODES LOGIN; never a generic proof API. */
  readonly onRecoveryLoginSourceSuccess: (input: PrivateRecoveryLoginSourceSuccess) => void;
  /** Exact source success from the current pending REGISTER; proof remains a separate status. */
  readonly onRegistrationSourceSuccess: (input: PrivateRecoveryLoginSourceSuccess) => void;
  readonly sendLine: (input: { readonly line: string; readonly owner: OwnerSnapshot; readonly requestId: RequestId }) => SendAdmission;
  readonly readAndClearPrivateForm: (formRef: string, context: RequestContext, kind: PrivateFormKind) => Promise<Uint8Array | PrivateAccountManagementForm | null>;
  readonly resolvePresentationHost: (hostRef: string, context: RequestContext) => HTMLElement | null;
  readonly clipboardWrite: (text: string) => Promise<boolean>;
  readonly emitSafeStatus: (status: PrivateAccountSecurityStatus) => void;
  readonly now: () => number;
  readonly randomRef: () => string;
}

interface Presentation {
  readonly ref: string;
  readonly owner: OwnerSnapshot;
  readonly endpointId: EndpointId;
  readonly expiresAt: number;
  readonly operation: PendingOperation;
  totpSecret: string | null;
  totpUri: string | null;
  recoveryCodes: string[] | null;
  remainingCodes: number | null;
  hostRef: string | null;
  context: RequestContext | null;
  host: HTMLElement | null;
  presented: boolean;
}
interface PendingOperation {
  readonly request: RequestContext;
  readonly operationRef: string;
  readonly action: PrivateAccountSecurityAction;
  owner: OwnerSnapshot;
  readonly endpointId: EndpointId;
  readonly serverPrefix: string;
  readonly startedAt: number;
  readonly loginAccount: string | null;
  phase: PrivateAccountSecurityPhase;
  reason: PrivateAccountSecurityReason | null;
  totpState: TotpState;
  declaredCodes: number | null;
  codeRows: Map<number, string>;
  loginProofObserved: boolean;
  loginSuccessObserved: boolean;
  registrationSuccessObserved: boolean;
  outcome: PrivateAccountOutcome;
  targetAccount: string | null;
  requiresLogin: boolean;
  presentation: Presentation | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const OP_TIMEOUT_MS = 30_000;
const PRESENTATION_TTL_MS = 5 * 60_000;
const MAX_RECOVERY_CODES = 10;
const MAX_FORM_BYTES = 1024;
const BASE32_SECRET = /^[A-Z2-7]{32}$/u;
const RECOVERY_COUNT = /^RECOVERYCODES:\s*generated\s+([1-9][0-9]{0,2})\s+single-use codes\b/u;
const TOTP_SECRET = /^TOTP: secret ([A-Z2-7]{32})$/iu;
const TOTP_URI = /^TOTP: (otpauth:\/\/totp\/[\x21-\x7e]{1,280})$/u;
const SAFE_ACCOUNT = /^[A-Za-z0-9_.-]{1,64}$/u;
const RESET_CODE = /^[0-9a-f]{32}$/u;
const VERIFY_CODE = /^[A-Za-z0-9_-]{1,128}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@.]+$/u;

function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';
}
function privateFormBytes(form: Uint8Array | PrivateAccountManagementForm | null): Uint8Array[] {
  if (isUint8Array(form)) return [form];
  if (!form) return [];
  return Object.values(form).filter(isUint8Array);
}
function privateText(bytes: Uint8Array, maxBytes = MAX_FORM_BYTES): string | null {
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return /[\u0000-\u001f\u007f]/u.test(value) ? null : value;
  } catch { return null; }
}
function privateNewPassword(bytes: Uint8Array): string | null {
  const value = privateText(bytes, 512);
  return value !== null && bytes.byteLength >= 8 ? value : null;
}
function privateCurrentPassword(bytes: Uint8Array): string | null {
  const value = privateText(bytes, 512);
  return value !== null && !/\s/u.test(value) && !value.startsWith(':') ? value : null;
}
function privateEmail(bytes: Uint8Array, allowStar: boolean): string | null {
  const value = privateText(bytes, 254);
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 && (allowStar && normalized === '*' || EMAIL.test(normalized)) ? normalized : null;
}
function buildManagementLine(
  intent: PrivateAccountSecurityIntent,
  form: Uint8Array | PrivateAccountManagementForm | null,
  currentAccount: string | null,
  certificateVerified: boolean,
): { readonly line: string | null; readonly reason: PrivateAccountSecurityReason | null } {
  if (intent.action === 'password-reset-request') {
    return SAFE_ACCOUNT.test(intent.account) ? { line: formatIRCLine('RESETPASS', intent.account), reason: null }
      : { line: null, reason: 'invalid-form' };
  }
  if (!('formRef' in intent) || !form || isUint8Array(form) || form.kind !== intent.action) return { line: null, reason: 'invalid-form' };
  const account = intent.action === 'account-register' || intent.action === 'account-verify'
    || intent.action === 'password-reset-confirm' ? intent.account : currentAccount;
  if (!account || !SAFE_ACCOUNT.test(account)) return { line: null, reason: 'account-required' };
  let line: string | null = null;
  if (intent.action === 'account-email' && form.kind === 'account-email') {
    const current = privateCurrentPassword(form.currentPassword);
    const email = privateEmail(form.email, false);
    if (!email) return { line: null, reason: 'invalid-email' };
    if (!current) return { line: null, reason: 'invalid-form' };
    line = formatIRCLine('ACCOUNTSET', account, current, 'email', email);
  } else if (intent.action === 'account-password' && form.kind === 'account-password') {
    const current = privateCurrentPassword(form.currentPassword);
    const next = privateNewPassword(form.newPassword);
    const confirm = privateNewPassword(form.confirmPassword);
    if (!next || !confirm) return { line: null, reason: 'weak-password' };
    if (next !== confirm) return { line: null, reason: 'password-mismatch' };
    if (next === current) return { line: null, reason: 'invalid-form' };
    if (!current) return { line: null, reason: 'invalid-form' };
    line = formatIRCLine('SETPASS', current, next);
  } else if (intent.action === 'account-certificate-reset' && form.kind === 'account-certificate-reset') {
    if (!certificateVerified) return { line: null, reason: 'reset-not-authorized' };
    const next = privateNewPassword(form.newPassword);
    const confirm = privateNewPassword(form.confirmPassword);
    if (!next || !confirm) return { line: null, reason: 'weak-password' };
    if (next !== confirm) return { line: null, reason: 'password-mismatch' };
    line = formatIRCLine('SETPASS', next);
  } else if (intent.action === 'account-drop' && form.kind === 'account-drop' && intent.confirm === true) {
    const confirmation = privateText(form.confirmAccount, 64);
    const password = privateCurrentPassword(form.currentPassword);
    if (confirmation !== account || !password) return { line: null, reason: 'invalid-form' };
    line = formatIRCLine('DROP', account, password);
  } else if (intent.action === 'password-reset-confirm' && form.kind === 'password-reset-confirm') {
    const code = privateText(form.resetCode, 32);
    const next = privateNewPassword(form.newPassword);
    const confirm = privateNewPassword(form.confirmPassword);
    if (!code || !RESET_CODE.test(code)) return { line: null, reason: 'invalid-code' };
    if (!next || !confirm) return { line: null, reason: 'weak-password' };
    if (next !== confirm) return { line: null, reason: 'password-mismatch' };
    line = formatIRCLine('RESETPASS', account, code, next);
  } else if (intent.action === 'account-register' && form.kind === 'account-register') {
    const email = privateEmail(form.email, true);
    const password = privateNewPassword(form.password);
    const confirm = privateNewPassword(form.confirmPassword);
    if (!email) return { line: null, reason: 'invalid-email' };
    if (!password || !confirm) return { line: null, reason: 'weak-password' };
    if (password !== confirm) return { line: null, reason: 'password-mismatch' };
    line = formatIRCLine('REGISTER', account, email, password);
  } else if (intent.action === 'account-verify' && form.kind === 'account-verify') {
    const code = privateText(form.verificationCode, 128);
    if (!code || !VERIFY_CODE.test(code)) return { line: null, reason: 'invalid-code' };
    line = formatIRCLine('VERIFY', account, code);
  }
  if (!line) return { line: null, reason: 'invalid-form' };
  const wireBytes = new TextEncoder().encode(line).byteLength;
  return wireBytes <= 512 ? { line, reason: null } : { line: null, reason: 'invalid-form' };
}

function randomRef(deps: PrivateAccountSecurityDependencies): string {
  const value = deps.randomRef();
  if (!/^[A-Za-z0-9_-]{22,128}$/u.test(value)) throw new Error('private security reference generator returned an invalid ref');
  return value;
}
function validOwner(deps: PrivateAccountSecurityDependencies, context: RequestContext): boolean {
  const owner = deps.ownerSnapshot();
  return deps.isCurrent(context.owner)
    && owner.ownerRef === context.owner.ownerRef
    && owner.connectionGeneration === context.owner.connectionGeneration
    && owner.accountGeneration === context.owner.accountGeneration
    && owner.networkId === context.owner.networkId
    && owner.physicalRef === context.owner.physicalRef;
}
function sameAsciiAccount(left: string | null, right: string | null): boolean {
  if (left === null || right === null || !SAFE_ACCOUNT.test(left) || !SAFE_ACCOUNT.test(right)) return false;
  const asciiLower = (value: string) => value.replace(/[A-Z]/gu, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
  return asciiLower(left) === asciiLower(right);
}
function hasSecretShape(body: string): boolean {
  return /^(?:TOTP:|RECOVERYCODES:)/u.test(body);
}
function hasManagementReplyShape(body: string): boolean {
  return /^(?:Account [A-Za-z0-9_.-]{1,64} (?:updated \(email\)|dropped)|SETPASS:|RESETPASS:|RESETPASS SUCCESS |REGISTER SUCCESS |VERIFY:)/u.test(body);
}
type PrivateReplySource = 'prefixless-fail' | 'server-notice' | 'notice-failure';
function bodyOf(line: string): { prefix: string | null; recipient: string | null; body: string; family: string | null; failureCode: string | null; source: PrivateReplySource } | null {
  const parsed = parseIRCMessage(line);
  const managedFamilies = new Set(['TOTP', 'RECOVERYCODES', 'SETPASS', 'ACCOUNTSET', 'RESETPASS', 'REGISTER', 'VERIFY', 'DROP']);
  if (parsed.command === 'FAIL') {
    const family = parsed.params[0]?.toUpperCase() ?? null;
    return family !== null && managedFamilies.has(family)
      ? (parsed.prefix === null
        ? { prefix: null, recipient: parsed.params[1] ?? null, body: '', family, failureCode: parsed.params[1] ?? null, source: 'prefixless-fail' }
        : null) : null;
  }
  if (parsed.command === '461' || parsed.command === '464') {
    const family = parsed.params[1]?.toUpperCase() ?? null;
    if (!family || !managedFamilies.has(family)) return null;
    return { prefix: parsed.prefix, recipient: parsed.params[0] ?? null, body: parsed.params.at(-1) ?? '', family,
      failureCode: parsed.command, source: 'server-notice' };
  }
  if (parsed.command === 'RESETPASS' || parsed.command === 'REGISTER') {
    return { prefix: parsed.prefix, recipient: null, body: `${parsed.command} ${parsed.params.join(' ')}`, family: null, failureCode: null, source: 'server-notice' };
  }
  if (parsed.command !== 'NOTICE' || parsed.params.length !== 2) return null;
  const recipient = parsed.params[0];
  const body = parsed.params[1];
  if (!recipient || !body || !parsed.prefix) return null;
  const failure = /^FAIL\s+(TOTP|RECOVERYCODES|SETPASS|ACCOUNTSET|RESETPASS|REGISTER|VERIFY|DROP)\s+([A-Z0-9_-]{1,64})(?::\s|\s|$)/u.exec(body);
  return { prefix: parsed.prefix, recipient, body, family: failure?.[1] ?? null, failureCode: failure?.[2] ?? null,
    source: failure ? 'notice-failure' : 'server-notice' };
}
function validTotpUri(uri: string, account: string, prefix: string, secret: string): boolean {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'otpauth:' || parsed.hostname !== 'totp' || parsed.username.length !== 0
      || parsed.password || parsed.port || parsed.hash) return false;
    const label = decodeURIComponent(parsed.pathname.slice(1));
    const separator = label.indexOf(':');
    if (separator < 0 || decodeURIComponent(label.slice(separator + 1)) !== account) return false;
    const issuer = parsed.searchParams.get('issuer');
    return issuer !== null && issuer === decodeURIComponent(label.slice(0, separator))
      && issuer === prefix && parsed.searchParams.get('secret') === secret
      && parsed.searchParams.get('algorithm') === 'SHA1' && parsed.searchParams.get('digits') === '6'
      && parsed.searchParams.get('period') === '30';
  } catch { return false; }
}

export function createPrivateAccountSecurity(deps: PrivateAccountSecurityDependencies) {
  let active: PendingOperation | null = null;
  let presentation: Presentation | null = null;
  let presentationTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const current = (owner: OwnerSnapshot) => {
    if (disposed || !deps.isCurrent(owner)) return false;
    const snapshot = deps.ownerSnapshot();
    return snapshot.ownerRef === owner.ownerRef && snapshot.connectionGeneration === owner.connectionGeneration
      && snapshot.accountGeneration === owner.accountGeneration && snapshot.networkId === owner.networkId
      && snapshot.physicalRef === owner.physicalRef;
  };
  const status = (op: PendingOperation) => {
    const owner = op.owner;
    deps.emitSafeStatus({ schemaVersion: 1, requestId: op.request.requestId, operationRef: op.operationRef,
      ownerRef: owner.ownerRef, accountGeneration: owner.accountGeneration, connectionGeneration: owner.connectionGeneration,
      action: op.action, phase: op.phase, reason: op.reason, totpState: op.totpState,
      remainingCodes: op.presentation?.remainingCodes ?? null, presentationRef: op.presentation?.ref ?? null,
      accountOutcome: op.outcome, targetAccount: op.targetAccount, requiresLogin: op.requiresLogin });
  };
  const clearPresentation = (target: Presentation | null) => {
    if (!target) return;
    target.totpSecret = null;
    target.totpUri = null;
    target.recoveryCodes?.fill('');
    target.recoveryCodes = null;
    target.remainingCodes = null;
    target.presented = false;
    target.host?.replaceChildren();
    if (!target.host && target.hostRef && target.context) clearHost(target.context, target.hostRef);
    target.hostRef = null;
    target.context = null;
    target.host = null;
  };
  const clearHost = (context: RequestContext, hostRef: string) => {
    const host = deps.resolvePresentationHost(hostRef, context);
    host?.replaceChildren();
  };
  const settle = (op: PendingOperation, phase: PrivateAccountSecurityPhase, reason: PrivateAccountSecurityReason | null = null) => {
    if (op !== active) return;
    op.phase = phase;
    op.reason = reason;
    if (phase !== 'accepted') op.codeRows.clear();
    if (op.timer !== null) clearTimeout(op.timer);
    op.timer = null;
    status(op);
    if (phase !== 'unknown') active = null;
  };
  const makePresentation = (op: PendingOperation): Presentation => {
    if (presentationTimer !== null) clearTimeout(presentationTimer);
    if (presentation) clearPresentation(presentation);
    const value: Presentation = { ref: randomRef(deps), owner: op.owner, endpointId: op.endpointId, operation: op,
      expiresAt: deps.now() + PRESENTATION_TTL_MS, totpSecret: null, totpUri: null, recoveryCodes: null,
      remainingCodes: null, hostRef: null, context: null, host: null, presented: false };
    presentation = value;
    op.presentation = value;
    presentationTimer = setTimeout(() => {
      if (presentation !== value) return;
      clearPresentation(value);
      presentation = null;
      presentationTimer = null;
      if (active?.presentation?.ref === value.ref) {
        active.codeRows.clear();
        active.presentation = null;
        active.phase = 'unknown';
        active.reason = 'expired';
        status(active);
      } else {
        const op = value.operation;
        deps.emitSafeStatus({ schemaVersion: 1, requestId: op.request.requestId, operationRef: op.operationRef,
          ownerRef: op.owner.ownerRef, accountGeneration: op.owner.accountGeneration,
          connectionGeneration: op.owner.connectionGeneration, action: op.action, phase: 'dismissed', reason: 'expired',
          totpState: op.totpState, remainingCodes: null, presentationRef: null,
          accountOutcome: op.outcome, targetAccount: op.targetAccount, requiresLogin: op.requiresLogin });
      }
    }, PRESENTATION_TTL_MS);
    return value;
  };
  const outputLine = (action: PrivateAccountSecurityAction, secret: Uint8Array | null, loginAccount: string | null): string | null => {
    if (action === 'totp-status') return formatIRCLine('TOTP', 'STATUS');
    if (action === 'totp-enroll') return formatIRCLine('TOTP', 'ENROLL');
    if (action === 'totp-disable') return formatIRCLine('TOTP', 'DISABLE');
    if (action === 'recovery-status') return formatIRCLine('RECOVERYCODES', 'STATUS');
    let text = '';
    if (secret) {
      if ((secret.byteLength === 0 && action !== 'recovery-generate' && action !== 'recovery-clear')
        || secret.byteLength > MAX_FORM_BYTES) return null;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(secret); } catch { return null; }
    }
    if (action === 'totp-confirm') return /^[0-9]{6}$/u.test(text) ? formatIRCLine('TOTP', 'CONFIRM', text) : null;
    if (action === 'recovery-generate') return !secret || text.length === 0 ? formatIRCLine('RECOVERYCODES', 'GENERATE') : validPassword(text) ? formatIRCLine('RECOVERYCODES', 'GENERATE', text) : null;
    if (action === 'recovery-clear') return !secret || text.length === 0 ? formatIRCLine('RECOVERYCODES', 'CLEAR') : validPassword(text) ? formatIRCLine('RECOVERYCODES', 'CLEAR', text) : null;
    if (action === 'recovery-login' && loginAccount) {
      if (!SAFE_ACCOUNT.test(loginAccount) || !/^(?:[0-9A-HJKMNP-TV-Z]{10}|[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5})$/iu.test(text)) return null;
      const code = text.replace(/-/gu, '').toUpperCase();
      return /^[0-9A-HJKMNP-TV-Z]{10}$/u.test(code)
        ? formatIRCLine('RECOVERYCODES', 'LOGIN', loginAccount, code) : null;
    }
    return null;
  };

  return Object.freeze({
    async begin(context: RequestContext, intent: PrivateAccountSecurityIntent): Promise<{ readonly operationRef: string; readonly admission: SendAdmission }> {
      const operationRef = randomRef(deps);
      const safeBlocked = (reason: PrivateAccountSecurityReason, admission: SendAdmission) => {
        deps.emitSafeStatus({ schemaVersion: 1, requestId: context.requestId, operationRef, ownerRef: context.owner.ownerRef,
          accountGeneration: context.owner.accountGeneration, connectionGeneration: context.owner.connectionGeneration,
          action: intent.action, phase: 'blocked', reason, totpState: 'unknown', remainingCodes: null, presentationRef: null,
          accountOutcome: 'none', targetAccount: 'account' in intent ? intent.account : context.owner.accountId,
          requiresLogin: intent.action === 'password-reset-confirm' });
        return { operationRef, admission };
      };
      if (disposed) return safeBlocked('stale-owner', { kind: 'blocked', reason: 'owner-changed' });
      if (active !== null) return safeBlocked('busy', { kind: 'blocked', reason: 'backpressure' });
      if (!validOwner(deps, context)) return safeBlocked('stale-owner', { kind: 'blocked', reason: 'owner-changed' });
      const owner = context.owner;
      const endpointId = deps.endpointId();
      const prefix = deps.currentServerPrefix();
      const mayBeUnproven = intent.action === 'recovery-login' || intent.action === 'password-reset-request'
        || intent.action === 'password-reset-confirm' || intent.action === 'account-register' || intent.action === 'account-verify';
      if (!prefix || (!mayBeUnproven && !deps.isAccountProven(owner))) return safeBlocked('not-proven', { kind: 'blocked', reason: 'policy' });
      const op: PendingOperation = { request: context, operationRef, action: intent.action, owner, endpointId, serverPrefix: prefix,
        startedAt: deps.now(), loginAccount: intent.action === 'recovery-login' ? intent.account : null,
        phase: 'pending', reason: null, totpState: 'unknown', declaredCodes: null, codeRows: new Map(),
        loginProofObserved: false, loginSuccessObserved: false, registrationSuccessObserved: false, outcome: 'none',
        targetAccount: 'account' in intent ? intent.account : owner.accountId, requiresLogin: intent.action === 'password-reset-confirm',
        presentation: null, timer: null };
      active = op;
      status(op);
      op.timer = setTimeout(() => { if (active === op) settle(op, 'unknown', 'timeout'); }, OP_TIMEOUT_MS);
      let form: Uint8Array | PrivateAccountManagementForm | null = null;
      const formDescriptor = intent.action === 'totp-confirm' ? { ref: intent.formRef, kind: 'totp-code' as const }
        : intent.action === 'recovery-login' ? { ref: intent.formRef, kind: 'recovery-code' as const }
        : (intent.action === 'recovery-generate' || intent.action === 'recovery-clear') && intent.formRef !== null
          ? { ref: intent.formRef, kind: 'recovery-password' as const }
          : intent.action === 'account-email' || intent.action === 'account-password' || intent.action === 'account-certificate-reset'
            || intent.action === 'account-drop' || intent.action === 'password-reset-confirm' || intent.action === 'account-register' || intent.action === 'account-verify'
            ? { ref: intent.formRef, kind: intent.action as PrivateFormKind } : null;
      try {
        if (formDescriptor) form = await deps.readAndClearPrivateForm(formDescriptor.ref, context, formDescriptor.kind);
        if (formDescriptor && form === null) {
          settle(op, 'blocked', 'invalid-input');
          return { operationRef, admission: { kind: 'blocked', reason: 'invalid-intent' } };
        }
        if (!current(owner) || active !== op || endpointId !== deps.endpointId() || prefix !== deps.currentServerPrefix()) {
          privateFormBytes(form).forEach((bytes) => bytes.fill(0));
          settle(op, 'blocked', 'stale-owner');
          return { operationRef, admission: { kind: 'blocked', reason: 'owner-changed' } };
        }
        const management = intent.action.startsWith('account-') || intent.action.startsWith('password-reset-');
        const built = management
          ? buildManagementLine(intent, form, owner.accountId, deps.isCertificateVerifiedAccount(owner))
          : { line: outputLine(intent.action, isUint8Array(form) ? form : null, op.loginAccount), reason: null };
        const line = built.line;
        privateFormBytes(form).forEach((bytes) => bytes.fill(0));
        form = null;
        if (line === null) {
          settle(op, 'blocked', built.reason ?? 'invalid-input');
          return { operationRef, admission: { kind: 'blocked', reason: 'invalid-intent' } };
        }
        // Keep the private form registration and the command on one exact
        // broker request ID. Main deliberately reuses this ID after the
        // opaque formRef is returned.
        let admission: SendAdmission;
        try { admission = deps.sendLine({ line, owner, requestId: context.requestId }); }
        catch {
          settle(op, 'unknown', 'transport-unknown');
          return { operationRef, admission: { kind: 'unknown', reason: 'transport-error' } };
        }
        if (admission.kind !== 'transport-admitted') settle(op, admission.kind === 'unknown' ? 'unknown' : 'blocked', admission.kind === 'unknown' ? 'transport-unknown' : 'transport-blocked');
        return { operationRef, admission };
      } catch {
        privateFormBytes(form).forEach((bytes) => bytes.fill(0));
        settle(op, 'blocked', 'invalid-input');
        return { operationRef, admission: { kind: 'blocked', reason: 'invalid-intent' } };
      }
    },
    ingest(input: { readonly line: string; readonly owner: OwnerSnapshot; readonly serverPrefix: string }): boolean {
      const parsed = bodyOf(input.line);
      if (!parsed || (!hasSecretShape(parsed.body) && !hasManagementReplyShape(parsed.body) && parsed.family === null)) return false;
      if (disposed) return true;
      const op = active;
      if (!op) return true;
      if (!current(input.owner) || input.owner.ownerRef !== op.owner.ownerRef || input.owner.connectionGeneration !== op.owner.connectionGeneration
        || input.owner.accountGeneration !== op.owner.accountGeneration || input.owner.physicalRef !== op.owner.physicalRef
        || input.serverPrefix !== op.serverPrefix
        || (parsed.source === 'prefixless-fail'
          ? input.owner.physicalRef === null || op.owner.physicalRef === null
          : parsed.prefix !== op.serverPrefix || (parsed.recipient !== deps.currentNick()
            && !(parsed.recipient === null && /^(?:RESETPASS SUCCESS |REGISTER SUCCESS )/u.test(parsed.body))))
        || deps.endpointId() !== op.endpointId) return true;
      if (op.phase !== 'pending' || deps.now() - op.startedAt > OP_TIMEOUT_MS) return true;
      if (parsed.family !== null) {
        const managementAction = op.action.startsWith('account-') || op.action.startsWith('password-reset-');
        if (managementAction) {
          const familyForAction = op.action === 'account-email' ? 'ACCOUNTSET'
            : op.action === 'account-password' || op.action === 'account-certificate-reset' ? 'SETPASS'
            : op.action === 'account-drop' ? 'DROP'
            : op.action.startsWith('password-reset-') ? 'RESETPASS'
            : op.action === 'account-register' ? 'REGISTER' : op.action === 'account-verify' ? 'VERIFY' : null;
          if (parsed.family === familyForAction) {
            const code = parsed.failureCode?.toUpperCase() ?? parsed.recipient?.toUpperCase() ?? '';
            const reason: PrivateAccountSecurityReason = code === 'WRONG_PASSWORD' ? 'wrong-password'
              : code === 'INVALID_PASSWORD' ? 'weak-password'
              : code === 'TEMPORARILY_UNAVAILABLE' ? 'temporarily-unavailable'
              : code === 'ACCOUNT_REQUIRED' ? 'account-required'
              : code === 'RESET_NOT_AUTHORIZED' ? 'reset-not-authorized'
              : code === 'NO_REQUEST' ? 'no-request'
              : code === 'EXPIRED' ? 'expired'
              : code === 'BAD_CODE' || code === 'INVALID_CODE' ? 'invalid-code'
              : code === 'TOO_MANY_ATTEMPTS' ? 'too-many-attempts'
              : code === 'UNAVAILABLE' ? 'unavailable'
              : code === 'PERMISSION_DENIED' ? 'permission-denied'
              : code === '464' ? 'wrong-password'
              : code === '461' ? 'invalid-form' : 'operation-failed';
            settle(op, 'failed', reason);
          }
          return true;
        }
        const expectedFamily = op.action.startsWith('totp-') ? 'TOTP'
          : op.action.startsWith('recovery-') ? 'RECOVERYCODES' : null;
        if (parsed.family === expectedFamily) settle(op, 'failed', 'server-failure');
        return true;
      }
      const body = parsed.body;
      if (op.action.startsWith('account-') || op.action.startsWith('password-reset-')) {
        const account = op.targetAccount;
        if (!account) return true;
        let outcome: PrivateAccountOutcome | null = null;
        if (op.action === 'account-email' && body === `Account ${account} updated (email)`) outcome = 'email-updated';
        else if (op.action === 'account-password' && body === 'SETPASS: your password has been changed') outcome = 'password-changed';
        else if (op.action === 'account-certificate-reset' && body === 'SETPASS: your password has been reset (verified by client certificate)') outcome = 'certificate-password-reset';
        else if (op.action === 'account-drop' && body === `Account ${account} dropped`) outcome = 'account-dropped';
        else if (op.action === 'password-reset-request' && body === 'RESETPASS: if that account has a verified email, a reset code has been sent.') outcome = 'reset-request-acknowledged';
        else if (op.action === 'password-reset-confirm' && body === `RESETPASS SUCCESS ${account} Password reset; log in with your new password`) outcome = 'password-reset';
        else if (op.action === 'account-register' && body === `REGISTER SUCCESS ${account} Account registered`) outcome = 'account-registered';
        else if (op.action === 'account-verify' && body === 'VERIFY: your account email is now verified') outcome = 'email-verified';
        else if (op.action === 'account-verify' && body === 'VERIFY: nothing to verify for your account') outcome = 'no-pending-verification';
        if (outcome !== null) {
          if (outcome === 'account-registered' && !op.registrationSuccessObserved) {
            op.registrationSuccessObserved = true;
            try {
              deps.onRegistrationSourceSuccess({ context: op.request, requestId: op.request.requestId,
                operationRef: op.operationRef, owner: op.owner, account, endpointId: op.endpointId });
            } catch { /* registration outcome remains separate from account proof */ }
          }
          op.outcome = outcome;
          op.requiresLogin = outcome === 'password-reset';
          settle(op, 'accepted');
        }
        return true;
      }
      if (op.action.startsWith('totp-')) {
        if (!body.startsWith('TOTP:')) return true;
        const secretMatch = TOTP_SECRET.exec(body);
        if (secretMatch?.[1] && op.action === 'totp-enroll') {
          const secret = secretMatch[1].toUpperCase();
          if (!BASE32_SECRET.test(secret)) { settle(op, 'unknown', 'malformed-response'); return true; }
          const value = makePresentation(op);
          value.totpSecret = secret;
          status(op);
          return true;
        }
        const uriMatch = TOTP_URI.exec(body);
        if (uriMatch?.[1] && op.action === 'totp-enroll') {
          const value = op.presentation;
          if (!value?.totpSecret || !validTotpUri(uriMatch[1], op.owner.accountId ?? '', op.serverPrefix, value.totpSecret)) {
            settle(op, 'unknown', 'malformed-response');
            return true;
          }
          value.totpUri = uriMatch[1];
          status(op);
          op.totpState = 'pending';
          settle(op, 'accepted');
          return true;
        }
        if (body === 'TOTP: two-factor authentication is disabled' || body === 'TOTP: two-factor authentication was not enabled') {
          op.totpState = 'disabled';
          settle(op, 'accepted');
          return true;
        }
        if (body === 'TOTP: two-factor authentication is now ACTIVE — future logins require a code') {
          op.totpState = 'active';
          settle(op, 'accepted');
          return true;
        }
        if (body === 'TOTP: two-factor authentication is active') { op.totpState = 'active'; settle(op, 'accepted'); return true; }
        if (body === 'TOTP: two-factor authentication is disabled') { op.totpState = 'disabled'; settle(op, 'accepted'); return true; }
        if (body === 'TOTP: two-factor authentication is pending — run TOTP CONFIRM <code> to activate') {
          op.totpState = 'pending'; settle(op, 'accepted'); return true;
        }
        if (/^TOTP: two-factor authentication (?:disabled|was not enabled)$/u.test(body)) {
          op.totpState = 'disabled'; settle(op, 'accepted'); return true;
        }
        return true;
      }
      if (!body.startsWith('RECOVERYCODES:')) return true;
      const statusValue = parseRecoveryCodesStatus(body);
      if (statusValue && op.action === 'recovery-status') {
        const value = makePresentation(op);
        value.remainingCodes = statusValue.remaining;
        status(op);
        settle(op, 'accepted');
        return true;
      }
      const generated = RECOVERY_COUNT.exec(body);
      if (generated && op.action === 'recovery-generate') {
        const count = Number(generated[1]);
        if (!Number.isSafeInteger(count) || count < 1 || count > MAX_RECOVERY_CODES) { settle(op, 'unknown', 'malformed-response'); return true; }
        op.declaredCodes = count;
        return true;
      }
      const row = parseRecoveryCodeLine(body);
      if (row && op.action === 'recovery-generate') {
        if (op.declaredCodes === null || row.index > op.declaredCodes || op.codeRows.has(row.index)
          || [...op.codeRows.values()].includes(row.code)) { settle(op, 'unknown', 'malformed-response'); return true; }
        op.codeRows.set(row.index, row.code);
        if (op.codeRows.size === op.declaredCodes) {
          const codes = Array.from({ length: op.declaredCodes }, (_, index) => op.codeRows.get(index + 1));
          if (codes.some(code => code === undefined)) { settle(op, 'unknown', 'malformed-response'); return true; }
          const value = makePresentation(op);
          value.recoveryCodes = codes as string[];
          value.remainingCodes = op.declaredCodes;
          op.codeRows.clear();
          status(op);
          settle(op, 'accepted');
        }
        return true;
      }
      if (isRecoveryCodesCleared(body) && op.action === 'recovery-clear') { settle(op, 'accepted'); return true; }
      if (isRecoveryCodesLoginOk(body) && op.action === 'recovery-login') {
        if (!op.loginSuccessObserved && op.loginAccount !== null) {
          op.loginSuccessObserved = true;
          try {
            deps.onRecoveryLoginSourceSuccess({ context: op.request, requestId: op.request.requestId,
              operationRef: op.operationRef, owner: op.owner, account: op.loginAccount, endpointId: op.endpointId });
          } catch { /* source readback integration failure leaves the login unknown */ }
        }
        op.loginSuccessObserved = true;
        if (op.loginProofObserved) settle(op, 'accepted');
        return true;
      }
      return true;
    },
    onAccountProven(previousOwner: OwnerSnapshot, nextOwner: OwnerSnapshot): void {
      const op = active;
      const value = presentation;
      if (value && (value.owner.ownerRef === previousOwner.ownerRef || value.owner.accountId !== nextOwner.accountId)) {
        if (presentationTimer !== null) clearTimeout(presentationTimer);
        presentationTimer = null;
        clearPresentation(value);
        presentation = null;
        if (active?.presentation === value) active.presentation = null;
      }
      if (!op) return;
      const exactLoginTransition = op.action === 'recovery-login' && op.loginAccount !== null && current(nextOwner)
        && previousOwner.ownerRef === op.owner.ownerRef
        && previousOwner.physicalRef !== null && previousOwner.physicalRef === op.owner.physicalRef
        && nextOwner.physicalRef === op.owner.physicalRef
        && previousOwner.connectionGeneration === op.owner.connectionGeneration
        && nextOwner.connectionGeneration === op.owner.connectionGeneration
        && nextOwner.networkId === op.owner.networkId
        && sameAsciiAccount(nextOwner.accountId, op.loginAccount) && deps.endpointId() === op.endpointId;
      const exactRegistrationTransition = op.action === 'account-register' && op.phase === 'pending'
        && op.targetAccount !== null && current(nextOwner)
        && previousOwner.ownerRef === op.owner.ownerRef
        && previousOwner.physicalRef !== null && previousOwner.physicalRef === op.owner.physicalRef
        && nextOwner.physicalRef === op.owner.physicalRef
        && previousOwner.connectionGeneration === op.owner.connectionGeneration
        && nextOwner.connectionGeneration === op.owner.connectionGeneration
        && nextOwner.networkId === op.owner.networkId
        && sameAsciiAccount(nextOwner.accountId, op.targetAccount) && deps.endpointId() === op.endpointId;
      if (exactRegistrationTransition) {
        op.owner = nextOwner;
        status(op);
        return;
      }
      if (!exactLoginTransition) {
        if (previousOwner.ownerRef === op.owner.ownerRef || previousOwner.physicalRef === op.owner.physicalRef) {
          settle(op, 'unknown', 'stale-owner');
        }
        return;
      }
      op.owner = nextOwner;
      op.loginProofObserved = true;
      if (op.loginSuccessObserved) settle(op, 'accepted');
    },
    present(context: RequestContext, presentationRef: string, hostRef: string): boolean {
      const value = presentation;
      if (!value || value.ref !== presentationRef || value.expiresAt <= deps.now() || !validOwner(deps, context)
        || value.owner.ownerRef !== context.owner.ownerRef || value.endpointId !== deps.endpointId() || value.presented) return false;
      const host = deps.resolvePresentationHost(hostRef, context);
      if (!host) return false;
      value.hostRef = hostRef;
      value.context = context;
      value.host = host;
      const doc = host.ownerDocument;
      const fields: string[] = [];
      if (value.totpSecret) fields.push(`Secret: ${value.totpSecret}`);
      if (value.totpUri) fields.push(`Authenticator URI: ${value.totpUri}`);
      if (value.recoveryCodes) fields.push(...value.recoveryCodes.map((code, index) => `${index + 1}. ${code}`));
      if (value.remainingCodes !== null && fields.length === 0) fields.push(`${value.remainingCodes} recovery codes remain.`);
      host.replaceChildren(...fields.map(text => doc.createTextNode(text)));
      value.presented = true;
      return true;
    },
    async copy(context: RequestContext, presentationRef: string, selection: 'secret' | 'uri' | 'codes'): Promise<boolean> {
      const value = presentation;
      if (!value || value.ref !== presentationRef || value.expiresAt <= deps.now() || !validOwner(deps, context)
        || value.owner.ownerRef !== context.owner.ownerRef || value.endpointId !== deps.endpointId()) return false;
      const text = selection === 'secret' ? value.totpSecret : selection === 'uri' ? value.totpUri
        : value.recoveryCodes?.join('\n') ?? null;
      if (!text) return false;
      try { return await deps.clipboardWrite(text) && presentation === value && value.expiresAt > deps.now() && validOwner(deps, context); }
      catch { return false; }
    },
    dismiss(context: RequestContext, presentationRef: string): void {
      if (!presentation || presentation.ref !== presentationRef || !validOwner(deps, context)) return;
      if (presentationTimer !== null) clearTimeout(presentationTimer);
      presentationTimer = null;
      clearPresentation(presentation);
      presentation = null;
      if (active?.presentation?.ref === presentationRef) {
        active.presentation = null;
        active.phase = 'dismissed';
        active.reason = null;
        status(active);
      }
    },
    retireOwner(owner: OwnerSnapshot): void {
      const operation = active;
      const samePhysical = operation !== null && owner.physicalRef !== null && operation.owner.physicalRef === owner.physicalRef
        && operation.owner.connectionGeneration === owner.connectionGeneration && operation.owner.networkId === owner.networkId;
      if (operation && (operation.owner.ownerRef === owner.ownerRef || samePhysical)) {
        if (operation.timer !== null) clearTimeout(operation.timer);
        if (operation.phase === 'pending') {
          operation.phase = 'unknown';
          operation.reason = 'transport-unknown';
          status(operation);
        }
        active = null;
      }
      const samePresentationPhysical = owner.physicalRef !== null && presentation?.owner.physicalRef === owner.physicalRef
        && presentation?.owner.connectionGeneration === owner.connectionGeneration && presentation?.owner.networkId === owner.networkId;
      if (presentation?.owner.ownerRef === owner.ownerRef || samePresentationPhysical) {
        if (presentationTimer !== null) clearTimeout(presentationTimer);
        presentationTimer = null;
        clearPresentation(presentation);
        presentation = null;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (active?.timer !== null) clearTimeout(active?.timer);
      active = null;
      if (presentationTimer !== null) clearTimeout(presentationTimer);
      presentationTimer = null;
      clearPresentation(presentation);
      presentation = null;
    },
  });
}

function validPassword(value: string): boolean {
  const bytes = new TextEncoder().encode(value).byteLength;
  return bytes > 0 && bytes <= 1024 && !/[\u0000-\u001f\u007f]/u.test(value);
}

export type PrivateWebAuthnAction = 'register' | 'authenticate';
export type PrivateWebAuthnPhase = 'pending' | 'transport-admitted' | 'blocked' | 'unknown';
export type PrivateWebAuthnReason = 'invalid-ceremony' | 'stale-owner' | 'unsupported' | 'cancelled' | 'rp-mismatch' | 'invalid-response' | 'transport-blocked' | 'transport-unknown';
export interface PrivateWebAuthnInput {
  readonly context: RequestContext;
  readonly ceremonyRef: string;
  readonly action: PrivateWebAuthnAction;
  /** Raw challenge bytes parsed from the exact source REGISTER/AUTH challenge. */
  readonly challenge: Uint8Array;
  readonly rpId: string;
  readonly account: string;
  readonly allowCredentials?: readonly Uint8Array[];
}
export interface PrivateWebAuthnStatus {
  readonly requestId: RequestId;
  readonly ownerRef: OwnerSnapshot['ownerRef'];
  readonly ceremonyRef: string;
  readonly phase: PrivateWebAuthnPhase;
  readonly reason: PrivateWebAuthnReason | null;
}
export interface PrivateWebAuthnDependencies {
  /** Must compare the exact active request, owner, challenge, RP id and ceremony ref. */
  readonly isCurrent: (input: PrivateWebAuthnInput) => boolean;
  readonly origin: () => string;
  readonly sendLine: (context: RequestContext, line: string) => SendAdmission;
  readonly emitSafeStatus: (status: PrivateWebAuthnStatus) => void;
}

interface ActiveWebAuthnCeremony { readonly input: PrivateWebAuthnInput; readonly controller: AbortController }
const MAX_WEBAUTHN_CHALLENGE_BYTES = 1024;
const MAX_WEBAUTHN_FIELD_BYTES = 8192;
const WEBAUTHN_TIMEOUT_MS = 120_000;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x4000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x4000, bytes.length)));
  }
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}
function validRpForOrigin(rpId: string, origin: string): boolean {
  if (!/^[A-Za-z0-9.-]{1,253}$/u.test(rpId) || rpId.startsWith('.') || rpId.endsWith('.') || rpId.includes('..')) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === 'localhost')) return false;
    const host = parsed.hostname.toLowerCase();
    const rp = rpId.toLowerCase();
    return host === rp || host.endsWith(`.${rp}`);
  } catch { return false; }
}
/**
 * Keeps WebAuthn ceremony bytes in JS, aborts superseded ceremonies, and
 * sends only the source-shaped WEBAUTHN finish command through the private
 * transport. Account proof is still reported only by the actual server flow.
 */
export function createPrivateWebAuthnCeremonies(deps: PrivateWebAuthnDependencies) {
  let active: ActiveWebAuthnCeremony | null = null;
  let disposed = false;
  const emit = (input: PrivateWebAuthnInput, phase: PrivateWebAuthnPhase, reason: PrivateWebAuthnReason | null) => {
    deps.emitSafeStatus({ requestId: input.context.requestId, ownerRef: input.context.owner.ownerRef,
      ceremonyRef: input.ceremonyRef, phase, reason });
  };
  const stillCurrent = (input: PrivateWebAuthnInput, expected: ActiveWebAuthnCeremony) => !disposed
    && active === expected && !expected.controller.signal.aborted && deps.isCurrent(input)
    && validRpForOrigin(input.rpId, deps.origin());
  const cancelActive = (reason: PrivateWebAuthnReason) => {
    const previous = active;
    if (!previous) return;
    active = null;
    previous.controller.abort();
    previous.input.challenge.fill(0);
    previous.input.allowCredentials?.forEach(item => item.fill(0));
    emit(previous.input, 'blocked', reason);
  };
  const validInput = (input: PrivateWebAuthnInput): boolean => {
    if (!/^[A-Za-z0-9_-]{22,128}$/u.test(input.ceremonyRef) || input.context.schemaVersion !== 1
      || input.challenge.byteLength < 16 || input.challenge.byteLength > MAX_WEBAUTHN_CHALLENGE_BYTES
      || !/^[A-Za-z0-9_.-]{1,64}$/u.test(input.account) || !validRpForOrigin(input.rpId, deps.origin())
      || (input.action !== 'register' && input.action !== 'authenticate')) return false;
    if (input.action === 'authenticate') {
      const credentials = input.allowCredentials;
      if (!credentials || credentials.length > 64 || credentials.some(item => item.byteLength === 0 || item.byteLength > 1023)) return false;
    }
    return true;
  };
  return Object.freeze({
    async begin(input: PrivateWebAuthnInput): Promise<PrivateWebAuthnStatus> {
      if (disposed) return { requestId: input.context.requestId, ownerRef: input.context.owner.ownerRef,
        ceremonyRef: input.ceremonyRef, phase: 'blocked', reason: 'stale-owner' };
      cancelActive('cancelled');
      if (!validInput(input) || !deps.isCurrent(input)) {
        const reason: PrivateWebAuthnReason = validRpForOrigin(input.rpId, deps.origin()) ? 'invalid-ceremony' : 'rp-mismatch';
        emit(input, 'blocked', reason);
        return { requestId: input.context.requestId, ownerRef: input.context.owner.ownerRef, ceremonyRef: input.ceremonyRef, phase: 'blocked', reason };
      }
      const captured: PrivateWebAuthnInput = { ...input, challenge: input.challenge.slice(),
        ...(input.allowCredentials ? { allowCredentials: input.allowCredentials.map(item => item.slice()) } : {}) };
      const controller = new AbortController();
      const ceremony: ActiveWebAuthnCeremony = { input: captured, controller };
      active = ceremony;
      emit(captured, 'pending', null);
      const timeout = setTimeout(() => controller.abort(), WEBAUTHN_TIMEOUT_MS);
      try {
        if (typeof navigator === 'undefined' || !navigator.credentials || typeof PublicKeyCredential !== 'function'
          || (captured.action === 'register' ? typeof navigator.credentials.create !== 'function' : typeof navigator.credentials.get !== 'function')) {
          active = null; emit(captured, 'blocked', 'unsupported');
          return { requestId: captured.context.requestId, ownerRef: captured.context.owner.ownerRef, ceremonyRef: captured.ceremonyRef, phase: 'blocked', reason: 'unsupported' };
        }
        if (!stillCurrent(captured, ceremony)) {
          active = null; emit(captured, 'blocked', 'stale-owner');
          return { requestId: captured.context.requestId, ownerRef: captured.context.owner.ownerRef, ceremonyRef: captured.ceremonyRef, phase: 'blocked', reason: 'stale-owner' };
        }
        const credential = captured.action === 'register'
          ? await navigator.credentials.create({ signal: controller.signal, publicKey: {
            challenge: new Uint8Array(captured.challenge).buffer, rp: { id: captured.rpId, name: captured.rpId },
            user: { id: new TextEncoder().encode(captured.account).buffer, name: captured.account, displayName: captured.account },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -8 }],
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
            timeout: WEBAUTHN_TIMEOUT_MS, attestation: 'none',
          } })
          : await navigator.credentials.get({ signal: controller.signal, publicKey: {
            challenge: new Uint8Array(captured.challenge).buffer, rpId: captured.rpId,
            allowCredentials: captured.allowCredentials!.map(id => ({ type: 'public-key' as const, id: new Uint8Array(id).buffer })),
            userVerification: 'preferred', timeout: WEBAUTHN_TIMEOUT_MS,
          } });
        if (!stillCurrent(captured, ceremony)) {
          return { requestId: captured.context.requestId, ownerRef: captured.context.owner.ownerRef, ceremonyRef: captured.ceremonyRef, phase: 'blocked', reason: 'stale-owner' };
        }
        if (!(credential instanceof PublicKeyCredential)) {
          active = null; emit(captured, 'blocked', 'cancelled');
          return { requestId: captured.context.requestId, ownerRef: captured.context.owner.ownerRef, ceremonyRef: captured.ceremonyRef, phase: 'blocked', reason: 'cancelled' };
        }
        const rawId = new Uint8Array(credential.rawId);
        const clientData = new Uint8Array(credential.response.clientDataJSON);
        const authData = captured.action === 'register'
          ? new Uint8Array((credential.response as AuthenticatorAttestationResponse & { getAuthenticatorData(): ArrayBuffer }).getAuthenticatorData())
          : new Uint8Array((credential.response as AuthenticatorAssertionResponse).authenticatorData);
        const signature = captured.action === 'authenticate'
          ? new Uint8Array((credential.response as AuthenticatorAssertionResponse).signature) : null;
        if (rawId.byteLength === 0 || rawId.byteLength > 1023 || clientData.byteLength === 0 || clientData.byteLength > MAX_WEBAUTHN_FIELD_BYTES
          || authData.byteLength === 0 || authData.byteLength > MAX_WEBAUTHN_FIELD_BYTES
          || (signature && (signature.byteLength === 0 || signature.byteLength > MAX_WEBAUTHN_FIELD_BYTES))
          || !stillCurrent(captured, ceremony)) {
          rawId.fill(0); clientData.fill(0); authData.fill(0); signature?.fill(0);
          active = null; emit(captured, 'blocked', 'invalid-response');
          return { requestId: captured.context.requestId, ownerRef: captured.context.owner.ownerRef, ceremonyRef: captured.ceremonyRef, phase: 'blocked', reason: 'invalid-response' };
        }
        const args = [encodeBase64Url(rawId), encodeBase64Url(clientData), encodeBase64Url(authData)];
        if (signature) args.push(encodeBase64Url(signature));
        rawId.fill(0); clientData.fill(0); authData.fill(0); signature?.fill(0);
        const line = formatIRCLine('WEBAUTHN', captured.action === 'register' ? 'REGISTER-FINISH' : 'AUTH-FINISH', ...args);
        if (!stillCurrent(captured, ceremony)) {
          active = null; emit(captured, 'blocked', 'stale-owner');
          return { requestId: captured.context.requestId, ownerRef: captured.context.owner.ownerRef, ceremonyRef: captured.ceremonyRef, phase: 'blocked', reason: 'stale-owner' };
        }
        let admission: SendAdmission;
        try { admission = deps.sendLine(captured.context, line); }
        catch {
          active = null; emit(captured, 'unknown', 'transport-unknown');
          return { requestId: captured.context.requestId, ownerRef: captured.context.owner.ownerRef, ceremonyRef: captured.ceremonyRef, phase: 'unknown', reason: 'transport-unknown' };
        }
        active = null;
        if (admission.kind === 'transport-admitted') {
          emit(captured, 'transport-admitted', null);
          return { requestId: captured.context.requestId, ownerRef: captured.context.owner.ownerRef, ceremonyRef: captured.ceremonyRef, phase: 'transport-admitted', reason: null };
        }
        const reason: PrivateWebAuthnReason = admission.kind === 'unknown' ? 'transport-unknown' : 'transport-blocked';
        const phase: PrivateWebAuthnPhase = admission.kind === 'unknown' ? 'unknown' : 'blocked';
        emit(captured, phase, reason);
        return { requestId: captured.context.requestId, ownerRef: captured.context.owner.ownerRef, ceremonyRef: captured.ceremonyRef, phase, reason };
      } catch (error) {
        if (active === ceremony) active = null;
        // WebAuthn reports user dismissal and authenticator timeout as NotAllowedError.
        const nativeCancel = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError');
        const reason: PrivateWebAuthnReason = controller.signal.aborted || nativeCancel ? 'cancelled' : 'invalid-response';
        if (!disposed) emit(captured, 'blocked', reason);
        return { requestId: captured.context.requestId, ownerRef: captured.context.owner.ownerRef, ceremonyRef: captured.ceremonyRef, phase: 'blocked', reason };
      } finally {
        clearTimeout(timeout);
        captured.challenge.fill(0);
        captured.allowCredentials?.forEach(item => item.fill(0));
      }
    },
    cancel(ceremonyRef: string): boolean {
      if (!active || active.input.ceremonyRef !== ceremonyRef) return false;
      cancelActive('cancelled');
      return true;
    },
    retireOwner(owner: OwnerSnapshot): void {
      const input = active?.input;
      if (input && (input.context.owner.ownerRef === owner.ownerRef
        || (owner.physicalRef !== null && input.context.owner.physicalRef === owner.physicalRef
          && input.context.owner.connectionGeneration === owner.connectionGeneration))) cancelActive('stale-owner');
    },
    dispose(): void {
      if (disposed) return;
      cancelActive('stale-owner');
      disposed = true;
    },
  });
}
