import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrivateAccountSecurity, createPrivateWebAuthnCeremonies, type PrivateAccountManagementForm, type PrivateAccountSecurityStatus, type PrivateRecoveryLoginSourceSuccess, type PrivateWebAuthnInput, type PrivateWebAuthnStatus } from './private-account-security';
import type { EndpointId, OwnerSnapshot, RequestContext } from './contracts';

const owner: OwnerSnapshot = {
  networkId: 'network-a' as OwnerSnapshot['networkId'], accountId: 'alice' as OwnerSnapshot['accountId'],
  accountGeneration: 2 as OwnerSnapshot['accountGeneration'], connectionGeneration: 4 as OwnerSnapshot['connectionGeneration'],
  physicalRef: 'physical-a' as OwnerSnapshot['physicalRef'], ownerRef: 'owner-a' as OwnerSnapshot['ownerRef'],
};
const context: RequestContext = {
  schemaVersion: 1,
  requestId: '0123456789abcdef0123456789abcdef' as RequestContext['requestId'],
  owner,
};
const success = { kind: 'transport-admitted' as const };
const secret = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const formBytes = (value: string) => new TextEncoder().encode(value);
afterEach(() => vi.unstubAllGlobals());

function setup(formResult?: Uint8Array | PrivateAccountManagementForm | null) {
  const statuses: PrivateAccountSecurityStatus[] = [];
  const sent: string[] = [];
  let liveOwner = owner;
  const host = document.createElement('div');
  const formBytes = new TextEncoder().encode('123456');
  const recoveryProofs: PrivateRecoveryLoginSourceSuccess[] = [];
  const registrationProofs: PrivateRecoveryLoginSourceSuccess[] = [];
  let refCounter = 0;
  const service = createPrivateAccountSecurity({
    ownerSnapshot: () => liveOwner,
    isCurrent: (value) => value.ownerRef === liveOwner.ownerRef && value.connectionGeneration === liveOwner.connectionGeneration,
    currentServerPrefix: () => 'onyx.example', currentNick: () => 'alice', endpointId: () => 'endpoint-a' as EndpointId,
    isAccountProven: () => true, isCertificateVerifiedAccount: () => true,
    onRecoveryLoginSourceSuccess: input => recoveryProofs.push(input),
    onRegistrationSourceSuccess: input => registrationProofs.push(input),
    sendLine: ({ line }) => { sent.push(line); return success; },
    readAndClearPrivateForm: async () => formResult === undefined ? formBytes : formResult,
    resolvePresentationHost: () => host,
    clipboardWrite: async () => true,
    emitSafeStatus: (status) => statuses.push(status), now: () => Date.now(),
    randomRef: () => `private-reference-${String(++refCounter).padStart(18, '0')}`,
  });
  return { service, statuses, sent, host, formBytes, recoveryProofs, registrationProofs, setOwner: (next: OwnerSnapshot) => { liveOwner = next; } };
}

describe('private account security', () => {
  it('consumes server TOTP secrets, validates the URI, and renders only once into the private host', async () => {
    const { service, statuses, sent, host } = setup();
    await service.begin(context, { action: 'totp-enroll' });
    expect(sent).toEqual(['TOTP ENROLL\r\n']);
    expect(service.ingest({ line: `:peer!u@h NOTICE alice :TOTP: secret ${secret}`, owner, serverPrefix: 'onyx.example' })).toBe(true);
    expect(service.ingest({ line: `:onyx.example NOTICE alice :TOTP: secret ${secret}`, owner, serverPrefix: 'onyx.example' })).toBe(true);
    expect(service.ingest({
      line: `:onyx.example NOTICE alice :TOTP: otpauth://totp/onyx.example:alice?secret=${secret}&issuer=onyx.example&algorithm=SHA1&digits=6&period=30`,
      owner, serverPrefix: 'onyx.example',
    })).toBe(true);
    const accepted = statuses.at(-1);
    expect(accepted?.phase).toBe('accepted');
    expect(accepted?.totpState).toBe('pending');
    expect(accepted?.reason).toBeNull();
    expect(JSON.stringify(statuses)).not.toContain(secret);
    expect(service.present(context, accepted?.presentationRef ?? '', 'host')).toBe(true);
    expect(host.textContent).toContain(secret);
    expect(service.present(context, accepted?.presentationRef ?? '', 'host')).toBe(false);
    service.dispose();
  });

  it('holds malformed duplicate/partial recovery sets as unknown without publishing any codes', async () => {
    const { service, statuses, sent, host } = setup();
    await service.begin(context, { action: 'recovery-generate', formRef: null });
    expect(sent).toEqual(['RECOVERYCODES GENERATE\r\n']);
    service.ingest({ line: ':onyx.example NOTICE alice :RECOVERYCODES: generated 2 single-use codes — copy them now; they will not be shown again', owner, serverPrefix: 'onyx.example' });
    service.ingest({ line: ':onyx.example NOTICE alice :RECOVERYCODES: 1. ABCDE-FGHJK', owner, serverPrefix: 'onyx.example' });
    service.ingest({ line: ':onyx.example NOTICE alice :RECOVERYCODES: 1. KMNPQ-RSTVW', owner, serverPrefix: 'onyx.example' });
    expect(statuses.at(-1)?.phase).toBe('unknown');
    expect(statuses.at(-1)?.presentationRef).toBeNull();
    expect(host.textContent).toBe('');
    expect(JSON.stringify(statuses)).not.toMatch(/ABCDE|KLMNP/u);
    service.dispose();
  });

  it('admits only a complete contiguous recovery set and renders it privately', async () => {
    const { service, statuses, host } = setup();
    await service.begin(context, { action: 'recovery-generate', formRef: null });
    service.ingest({ line: ':onyx.example NOTICE alice :RECOVERYCODES: generated 2 single-use codes — copy them now; they will not be shown again', owner, serverPrefix: 'onyx.example' });
    service.ingest({ line: ':onyx.example NOTICE alice :RECOVERYCODES: 2. KMNPQ-RSTVW', owner, serverPrefix: 'onyx.example' });
    expect(statuses.at(-1)?.phase).toBe('pending');
    service.ingest({ line: ':onyx.example NOTICE alice :RECOVERYCODES: 1. ABCDE-FGHJK', owner, serverPrefix: 'onyx.example' });
    const accepted = statuses.at(-1);
    expect(accepted?.phase).toBe('accepted');
    expect(accepted?.remainingCodes).toBe(2);
    expect(JSON.stringify(statuses)).not.toMatch(/ABCDE|KLMNP/u);
    expect(service.present(context, accepted?.presentationRef ?? '', 'host')).toBe(true);
    expect(host.textContent).toContain('1. ABCDE-FGHJK');
    expect(host.textContent).toContain('2. KMNPQ-RSTVW');
    service.dispose();
  });

  it('never downgrades a rejected supplied password form to a passwordless command', async () => {
    const { service, statuses, sent } = setup(null);
    const result = await service.begin(context, { action: 'recovery-clear', formRef: 'form-reference-000000000000' });
    expect(result.admission.kind).toBe('blocked');
    expect(sent).toEqual([]);
    expect(statuses.at(-1)?.reason).toBe('invalid-input');
    service.dispose();
  });

  it('consumes only source-proven TOTP failures and publishes a fixed safe reason', async () => {
    for (const line of [
      'FAIL TOTP INVALID_CODE :the private reason must not escape',
      ':onyx.example NOTICE alice :FAIL TOTP INVALID_CODE: the private reason must not escape',
    ]) {
      const { service, statuses, sent } = setup();
      const result = await service.begin(context, { action: 'totp-confirm', formRef: 'form-reference-000000000000' });
      expect(result.admission).toEqual(success);
      expect(service.ingest({ line, owner, serverPrefix: 'onyx.example' })).toBe(true);
      expect(statuses.at(-1)?.phase).toBe('failed');
      expect(statuses.at(-1)?.reason).toBe('server-failure');
      expect(JSON.stringify(statuses)).not.toContain('private reason');
      expect(sent).toEqual(['TOTP CONFIRM 123456\r\n']);
      service.dispose();
    }
  });

  it('does not settle the pending operation for prefixless FAIL on another physical owner', async () => {
    const { service, statuses } = setup();
    await service.begin(context, { action: 'totp-status' });
    const otherOwner = { ...owner, physicalRef: 'physical-b' as OwnerSnapshot['physicalRef'] };
    service.ingest({ line: 'FAIL TOTP INVALID_CODE :reason', owner: otherOwner, serverPrefix: 'onyx.example' });
    expect(statuses.at(-1)?.phase).toBe('pending');
    service.dispose();
  });

  it('zeroes private form bytes after submitting the actual TOTP confirmation command', async () => {
    const { service, statuses, sent, formBytes } = setup();
    const result = await service.begin(context, { action: 'totp-confirm', formRef: 'form-reference-000000000000' });
    expect(result.admission).toEqual(success);
    expect(sent).toEqual(['TOTP CONFIRM 123456\r\n']);
    expect(formBytes.every(byte => byte === 0)).toBe(true);
    expect(statuses[0]?.requestId).toBe(context.requestId);
    expect(result.admission).toEqual(success);
    service.dispose();
  });

  it('submits account email only through the private exact field set and accepts its source notice', async () => {
    const form: PrivateAccountManagementForm = { kind: 'account-email', email: formBytes('alice@example.com'), currentPassword: formBytes('oldSecret') };
    const { service, statuses, sent } = setup(form);
    await service.begin(context, { action: 'account-email', formRef: 'form-reference-000000000000' });
    expect(sent).toEqual(['ACCOUNTSET alice oldSecret email alice@example.com\r\n']);
    expect(statuses.at(-1)?.phase).toBe('pending');
    service.ingest({ line: ':onyx.example NOTICE alice :Account alice updated (email)', owner, serverPrefix: 'onyx.example' });
    expect(statuses.at(-1)?.accountOutcome).toBe('email-updated');
    expect(statuses.at(-1)?.phase).toBe('accepted');
    expect(JSON.stringify(statuses)).not.toContain('oldSecret');
    service.dispose();
  });

  it('uses SETPASS for password change and never accepts legacy ACCOUNTSET password success', async () => {
    const form: PrivateAccountManagementForm = { kind: 'account-password', currentPassword: formBytes('oldSecret'), newPassword: formBytes('newSecret123'), confirmPassword: formBytes('newSecret123') };
    const { service, statuses, sent } = setup(form);
    await service.begin(context, { action: 'account-password', formRef: 'form-reference-000000000000' });
    expect(sent).toEqual(['SETPASS oldSecret newSecret123\r\n']);
    service.ingest({ line: ':onyx.example NOTICE alice :Account alice updated (password)', owner, serverPrefix: 'onyx.example' });
    expect(statuses.at(-1)?.phase).toBe('pending');
    service.ingest({ line: ':onyx.example NOTICE alice :SETPASS: your password has been changed', owner, serverPrefix: 'onyx.example' });
    expect(statuses.at(-1)?.accountOutcome).toBe('password-changed');
    expect(statuses.at(-1)?.phase).toBe('accepted');
    service.dispose();
  });

  it('keeps reset request neutral and requires a source success before reset confirmation is accepted', async () => {
    const request = setup();
    await request.service.begin(context, { action: 'password-reset-request', account: 'alice' });
    expect(request.sent).toEqual(['RESETPASS alice\r\n']);
    request.service.ingest({ line: ':onyx.example NOTICE alice :RESETPASS: if that account has a verified email, a reset code has been sent.', owner, serverPrefix: 'onyx.example' });
    expect(request.statuses.at(-1)?.accountOutcome).toBe('reset-request-acknowledged');
    expect(request.statuses.at(-1)?.targetAccount).toBe('alice');
    request.service.dispose();

    const form: PrivateAccountManagementForm = { kind: 'password-reset-confirm', resetCode: formBytes('0123456789abcdef0123456789abcdef'), newPassword: formBytes('newSecret123'), confirmPassword: formBytes('newSecret123') };
    const confirm = setup(form);
    await confirm.service.begin(context, { action: 'password-reset-confirm', account: 'alice', formRef: 'form-reference-000000000000' });
    expect(confirm.sent).toEqual(['RESETPASS alice 0123456789abcdef0123456789abcdef newSecret123\r\n']);
    confirm.service.ingest({ line: ':onyx.example RESETPASS SUCCESS alice :Password reset; log in with your new password', owner, serverPrefix: 'onyx.example' });
    expect(confirm.statuses.at(-1)?.accountOutcome).toBe('password-reset');
    expect(confirm.statuses.at(-1)?.requiresLogin).toBe(true);
    expect(confirm.statuses.at(-1)?.phase).toBe('accepted');
    confirm.service.dispose();
  });

  it('requires the exact account drop receipt and distinguishes registration from account proof', async () => {
    const dropForm: PrivateAccountManagementForm = { kind: 'account-drop', confirmAccount: formBytes('alice'), currentPassword: formBytes('oldSecret') };
    const drop = setup(dropForm);
    await drop.service.begin(context, { action: 'account-drop', formRef: 'form-reference-000000000000', confirm: true });
    expect(drop.sent).toEqual(['DROP alice oldSecret\r\n']);
    expect(drop.statuses.at(-1)?.phase).toBe('pending');
    drop.service.ingest({ line: ':onyx.example NOTICE alice :Account alice dropped', owner, serverPrefix: 'onyx.example' });
    expect(drop.statuses.at(-1)?.accountOutcome).toBe('account-dropped');
    drop.service.dispose();

    const registerForm: PrivateAccountManagementForm = { kind: 'account-register', email: formBytes('*'), password: formBytes('newSecret123'), confirmPassword: formBytes('newSecret123') };
    const register = setup(registerForm);
    await register.service.begin(context, { action: 'account-register', account: 'New-User', formRef: 'form-reference-000000000000' });
    expect(register.sent).toEqual(['REGISTER New-User * newSecret123\r\n']);
    const registeredOwner: OwnerSnapshot = { ...owner, accountId: 'new-user' as OwnerSnapshot['accountId'], accountGeneration: 3 as OwnerSnapshot['accountGeneration'], ownerRef: 'owner-registered' as OwnerSnapshot['ownerRef'] };
    register.setOwner(registeredOwner);
    register.service.onAccountProven(owner, registeredOwner);
    register.service.ingest({ line: ':onyx.example REGISTER SUCCESS New-User :Account registered', owner: registeredOwner, serverPrefix: 'onyx.example' });
    expect(register.statuses.at(-1)?.accountOutcome).toBe('account-registered');
    expect(register.statuses.at(-1)?.phase).toBe('accepted');
    expect(register.registrationProofs).toHaveLength(1);
    expect(register.registrationProofs[0]?.account).toBe('New-User');
    register.service.dispose();
  });

  it('rejects mismatched or too-short private passwords without sending bytes', async () => {
    const form: PrivateAccountManagementForm = { kind: 'account-password', currentPassword: formBytes('oldSecret'), newPassword: formBytes('short'), confirmPassword: formBytes('different') };
    const { service, statuses, sent } = setup(form);
    const result = await service.begin(context, { action: 'account-password', formRef: 'form-reference-000000000000' });
    expect(result.admission.kind).toBe('blocked');
    expect(sent).toEqual([]);
    expect(statuses.at(-1)?.phase).toBe('blocked');
    service.dispose();
  });

  it('keeps certificate reset authorization separate and distinguishes no-pending verification', async () => {
    const certForm: PrivateAccountManagementForm = { kind: 'account-certificate-reset', newPassword: formBytes('newSecret123'), confirmPassword: formBytes('newSecret123') };
    const { service, statuses, sent } = setup(certForm);
    await service.begin(context, { action: 'account-certificate-reset', formRef: 'form-reference-000000000000' });
    expect(sent).toEqual(['SETPASS newSecret123\r\n']);
    service.ingest({ line: ':onyx.example NOTICE alice :SETPASS: your password has been reset (verified by client certificate)', owner, serverPrefix: 'onyx.example' });
    expect(statuses.at(-1)?.accountOutcome).toBe('certificate-password-reset');
    service.dispose();

    const verification: PrivateAccountManagementForm = { kind: 'account-verify', verificationCode: formBytes('verify-code-123') };
    const verify = setup(verification);
    await verify.service.begin(context, { action: 'account-verify', account: 'alice', formRef: 'form-reference-000000000000' });
    expect(verify.sent).toEqual(['VERIFY alice verify-code-123\r\n']);
    verify.service.ingest({ line: ':onyx.example NOTICE alice :VERIFY: nothing to verify for your account', owner, serverPrefix: 'onyx.example' });
    expect(verify.statuses.at(-1)?.accountOutcome).toBe('no-pending-verification');
    verify.service.dispose();
  });

  it('requests a narrow recovery account transition only after the exact pending source success', async () => {
    const { service, statuses, recoveryProofs, setOwner } = setup(formBytes('ABCDE-FGHJK'));
    const result = await service.begin(context, { action: 'recovery-login', account: 'ALICE', formRef: 'form-reference-000000000000' });
    expect(result.admission).toEqual(success);
    expect(recoveryProofs).toEqual([]);
    service.ingest({ line: ':onyx.example NOTICE alice :RECOVERYCODES: login ok — that code is now spent', owner, serverPrefix: 'onyx.example' });
    expect(recoveryProofs).toHaveLength(1);
    expect(recoveryProofs[0]?.operationRef).toBe(statuses[0]?.operationRef);
    expect(recoveryProofs[0]?.account).toBe('ALICE');
    expect(statuses.at(-1)?.phase).toBe('pending');
    const nextOwner: OwnerSnapshot = { ...owner, accountId: 'alice' as OwnerSnapshot['accountId'], accountGeneration: 3 as OwnerSnapshot['accountGeneration'], ownerRef: 'owner-next' as OwnerSnapshot['ownerRef'] };
    setOwner(nextOwner);
    service.onAccountProven(owner, nextOwner);
    expect(statuses.at(-1)?.phase).toBe('accepted');
    service.dispose();
  });

  it('maps private reset failures to fixed reasons and never publishes error text', async () => {
    const { service, statuses } = setup();
    await service.begin(context, { action: 'password-reset-request', account: 'alice' });
    service.ingest({ line: 'FAIL RESETPASS UNAVAILABLE :secret server error text', owner, serverPrefix: 'onyx.example' });
    expect(statuses.at(-1)?.phase).toBe('failed');
    expect(statuses.at(-1)?.reason).toBe('unavailable');
    expect(JSON.stringify(statuses)).not.toContain('secret server error');
    service.dispose();

    const fallbackForm: PrivateAccountManagementForm = { kind: 'password-reset-confirm', resetCode: formBytes('0123456789abcdef0123456789abcdef'), newPassword: formBytes('newSecret123'), confirmPassword: formBytes('newSecret123') };
    const fallback = setup(fallbackForm);
    await fallback.service.begin(context, { action: 'password-reset-confirm', account: 'alice', formRef: 'form-reference-000000000000' });
    fallback.service.ingest({ line: ':onyx.example NOTICE alice :FAIL RESETPASS EXPIRED: private error details', owner, serverPrefix: 'onyx.example' });
    expect(fallback.statuses.at(-1)?.reason).toBe('expired');
    expect(JSON.stringify(fallback.statuses)).not.toContain('private error details');
    fallback.service.dispose();
  });
  it('fails a refused reset without proofs and turns a silent reset into unknown', async () => {
    const form: PrivateAccountManagementForm = { kind: 'password-reset-confirm', resetCode: formBytes('0123456789abcdef0123456789abcdef'), newPassword: formBytes('newSecret123'), confirmPassword: formBytes('newSecret123') };
    const refused = setup(form);
    await refused.service.begin(context, { action: 'password-reset-confirm', account: 'alice', formRef: 'form-reference-000000000000' });
    expect(refused.service.ingest({ line: 'FAIL RESETPASS BAD_CODE :reset code mismatch', owner, serverPrefix: 'onyx.example' })).toBe(true);
    expect(refused.statuses.at(-1)).toMatchObject({ phase: 'failed', reason: 'invalid-code', accountOutcome: 'none', requiresLogin: true });
    // A success arriving after the definitive failure cannot flip the outcome.
    refused.service.ingest({ line: ':onyx.example RESETPASS SUCCESS alice :Password reset; log in with your new password', owner, serverPrefix: 'onyx.example' });
    expect(refused.statuses.at(-1)?.phase).toBe('failed');
    expect(refused.recoveryProofs).toEqual([]);
    expect(refused.registrationProofs).toEqual([]);
    refused.service.dispose();

    vi.useFakeTimers();
    try {
      const silent = setup();
      await silent.service.begin(context, { action: 'password-reset-request', account: 'alice' });
      expect(silent.statuses.at(-1)?.phase).toBe('pending');
      vi.advanceTimersByTime(30_000);
      expect(silent.statuses.at(-1)).toMatchObject({ phase: 'unknown', reason: 'timeout', accountOutcome: 'none' });
      expect(silent.recoveryProofs).toEqual([]);
      silent.service.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('fails a refused recovery-code operation without proofs, times out as unknown, and stays busy', async () => {
    const login = setup(formBytes('ABCDE-FGHJK'));
    await login.service.begin(context, { action: 'recovery-login', account: 'alice', formRef: 'form-reference-000000000000' });
    expect(login.service.ingest({ line: 'FAIL RECOVERYCODES INVALID_CODE :private detail', owner, serverPrefix: 'onyx.example' })).toBe(true);
    expect(login.statuses.at(-1)).toMatchObject({ phase: 'failed', reason: 'server-failure', presentationRef: null });
    login.service.ingest({ line: ':onyx.example NOTICE alice :RECOVERYCODES: login ok — that code is now spent', owner, serverPrefix: 'onyx.example' });
    expect(login.recoveryProofs).toEqual([]);
    expect(JSON.stringify(login.statuses)).not.toContain('private detail');
    login.service.dispose();

    vi.useFakeTimers();
    try {
      const silent = setup();
      await silent.service.begin(context, { action: 'recovery-generate', formRef: null });
      vi.advanceTimersByTime(30_000);
      expect(silent.statuses.at(-1)).toMatchObject({ phase: 'unknown', reason: 'timeout', presentationRef: null });
      // An unknown generation may have minted codes server-side: a second
      // begin must not race it into a second mint.
      const again = await silent.service.begin({ ...context, requestId: 'fedcba9876543210fedcba9876543210' as RequestContext['requestId'] }, { action: 'recovery-generate', formRef: null });
      expect(again.admission.kind).toBe('blocked');
      expect(silent.statuses.at(-1)).toMatchObject({ phase: 'blocked', reason: 'busy' });
      expect(silent.sent).toEqual(['RECOVERYCODES GENERATE\r\n']);
      expect(silent.recoveryProofs).toEqual([]);
      silent.service.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('never reports TOTP active after a confirmation failure', async () => {
    const { service, statuses } = setup();
    await service.begin(context, { action: 'totp-confirm', formRef: 'form-reference-000000000000' });
    service.ingest({ line: 'FAIL TOTP INVALID_CODE :bad code', owner, serverPrefix: 'onyx.example' });
    service.ingest({ line: ':onyx.example NOTICE alice :TOTP: two-factor authentication is now ACTIVE — future logins require a code', owner, serverPrefix: 'onyx.example' });
    expect(statuses.at(-1)?.phase).toBe('failed');
    expect(statuses.some(status => status.totpState === 'active')).toBe(false);
    service.dispose();
  });
});

describe('private WebAuthn ceremonies', () => {
  it('keeps registration result bytes private and sends the existing source-shaped finish command', async () => {
    class FakePublicKeyCredential {
      readonly rawId = Uint8Array.from([1, 2, 3]).buffer;
      readonly response = {
        clientDataJSON: Uint8Array.from([4, 5]).buffer,
        getAuthenticatorData: () => Uint8Array.from([6, 7]).buffer,
      };
    }
    vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
    const credential = new FakePublicKeyCredential();
    const credentials = { create: vi.fn(async () => credential as unknown as Credential), get: vi.fn() } as unknown as CredentialsContainer;
    vi.stubGlobal('navigator', { credentials });
    const input: PrivateWebAuthnInput = {
      context, ceremonyRef: 'ceremony-reference-000000000001', action: 'register', challenge: new Uint8Array(32).fill(9),
      rpId: 'example.com', account: 'alice',
    };
    const sent: string[] = [];
    const statuses: PrivateWebAuthnStatus[] = [];
    const service = createPrivateWebAuthnCeremonies({ isCurrent: () => true, origin: () => 'https://chat.example.com',
      sendLine: (_context, line) => { sent.push(line); return success; }, emitSafeStatus: status => statuses.push(status) });
    const result = await service.begin(input);
    expect(result.phase).toBe('transport-admitted');
    expect(sent).toEqual(['WEBAUTHN REGISTER-FINISH AQID BAU Bgc\r\n']);
    expect(JSON.stringify(statuses)).not.toMatch(/AQID|BAU|Bgc/u);
    expect(input.challenge.every(byte => byte === 9)).toBe(true);
    service.dispose();
    vi.unstubAllGlobals();
  });

  it('does not send a late WebAuthn result after the native ceremony is cancelled', async () => {
    class FakePublicKeyCredential { readonly rawId = Uint8Array.from([1]).buffer; readonly response = {}; }
    vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
    const release: { current: ((value: Credential | null) => void) | null } = { current: null };
    const credentials = { create: () => new Promise<Credential | null>(resolve => { release.current = resolve; }), get: vi.fn() } as unknown as CredentialsContainer;
    vi.stubGlobal('navigator', { credentials });
    const input: PrivateWebAuthnInput = {
      context, ceremonyRef: 'ceremony-reference-000000000002', action: 'register', challenge: new Uint8Array(32).fill(8),
      rpId: 'example.com', account: 'alice',
    };
    const sent: string[] = [];
    const service = createPrivateWebAuthnCeremonies({ isCurrent: () => true, origin: () => 'https://chat.example.com',
      sendLine: (_context, line) => { sent.push(line); return success; }, emitSafeStatus: () => undefined });
    const pending = service.begin(input);
    expect(service.cancel(input.ceremonyRef)).toBe(true);
    release.current?.(new FakePublicKeyCredential() as unknown as Credential);
    await pending;
    expect(sent).toEqual([]);
    expect(input.challenge.every(byte => byte === 8)).toBe(true);
    service.dispose();
    vi.unstubAllGlobals();
  });
  it('reports an explicit unsupported state without invoking the authenticator when PublicKeyCredential is absent', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    const create = vi.fn(async () => null);
    vi.stubGlobal('navigator', { credentials: { create, get: vi.fn() } as unknown as CredentialsContainer });
    const input: PrivateWebAuthnInput = { context, ceremonyRef: 'ceremony-reference-000000000003', action: 'register',
      challenge: new Uint8Array(32).fill(7), rpId: 'example.com', account: 'alice' };
    const sent: string[] = [];
    const statuses: PrivateWebAuthnStatus[] = [];
    const service = createPrivateWebAuthnCeremonies({ isCurrent: () => true, origin: () => 'https://chat.example.com',
      sendLine: (_context, line) => { sent.push(line); return success; }, emitSafeStatus: status => statuses.push(status) });
    const result = await service.begin(input);
    expect(result).toMatchObject({ phase: 'blocked', reason: 'unsupported' });
    expect(statuses.at(-1)).toMatchObject({ phase: 'blocked', reason: 'unsupported' });
    expect(create).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    service.dispose();
    vi.unstubAllGlobals();
  });

  it('maps an authenticator NotAllowedError to cancelled and sends nothing', async () => {
    class FakePublicKeyCredential {}
    vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential);
    const create = vi.fn(async () => { throw new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'); });
    vi.stubGlobal('navigator', { credentials: { create, get: vi.fn() } as unknown as CredentialsContainer });
    const input: PrivateWebAuthnInput = { context, ceremonyRef: 'ceremony-reference-000000000004', action: 'register',
      challenge: new Uint8Array(32).fill(6), rpId: 'example.com', account: 'alice' };
    const sent: string[] = [];
    const statuses: PrivateWebAuthnStatus[] = [];
    const service = createPrivateWebAuthnCeremonies({ isCurrent: () => true, origin: () => 'https://chat.example.com',
      sendLine: (_context, line) => { sent.push(line); return success; }, emitSafeStatus: status => statuses.push(status) });
    const result = await service.begin(input);
    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ phase: 'blocked', reason: 'cancelled' });
    expect(statuses.map(status => status.phase)).toEqual(['pending', 'blocked']);
    expect(statuses.some(status => status.phase === 'transport-admitted')).toBe(false);
    expect(sent).toEqual([]);
    service.dispose();
    vi.unstubAllGlobals();
  });
});
