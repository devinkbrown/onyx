import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSnapshot, PrivateIngressEvent, RequestContext, RequestId } from './contracts';
import { createIntegrationOperations, type IntegrationResult } from './integration-operations';

const owner: OwnerSnapshot = {
  networkId: 'custom:wss://127.0.0.1:7443/ws' as OwnerSnapshot['networkId'],
  accountId: 'lab-account' as OwnerSnapshot['accountId'],
  accountGeneration: 2 as OwnerSnapshot['accountGeneration'],
  connectionGeneration: 4 as OwnerSnapshot['connectionGeneration'],
  physicalRef: 'physical-4' as OwnerSnapshot['physicalRef'],
  ownerRef: 'owner-lab' as OwnerSnapshot['ownerRef'],
};

const context: RequestContext = {
  schemaVersion: 1,
  requestId: 'request-abcdefghijklmnop' as RequestId,
  owner,
};

function fixture(options: { readonly labels?: boolean } = {}) {
  const sent: string[] = [];
  const emitted: IntegrationResult[] = [];
  let ref = 0;
  let onSend: ((line: string) => void) | null = null;
  const service = createIntegrationOperations({
    currentOwner: () => owner,
    isCurrent: candidate => candidate === owner || candidate.ownerRef === owner.ownerRef,
    currentNick: () => 'LabNick',
    currentServerPrefix: () => 'irc.example',
    hasNegotiatedLabels: () => options.labels ?? true,
    sendLine: ({ line }) => { sent.push(line); onSend?.(line); return { kind: 'transport-admitted' }; },
    now: () => 1_800_000_000_000,
    randomRef: () => `ref-${++ref}`,
    emit: result => emitted.push(result),
    openPrivateOutHookInput: () => () => undefined,
    presentPrivateOutHook: () => () => undefined,
  });
  const ingress = (line: string, sourceKind: PrivateIngressEvent['sourceKind'] = 'server'): boolean =>
    service.consumePrivateIngress({ line, owner, sourceKind });
  return { service, sent, emitted, ingress, setOnSend: (callback: (line: string) => void) => { onSend = callback; } };
}

function labelFrom(line: string): string {
  const match = /^@label=([^ ]+)/u.exec(line);
  if (!match?.[1]) throw new Error('Expected a labeled request');
  return match[1];
}

afterEach(() => vi.useRealTimers());

describe('private integration request correlation', () => {
  it('formats unframed commands, preserves trailing body whitespace, and rejects controls before sending', () => {
    const f = fixture({ labels: false });
    expect(f.service.refresh({ context, feature: 'botcmd' }).view.phase).toBe('pending');
    expect(f.sent[0]).toBe('COMMANDS BOTCMD');
    expect(f.sent[0]).not.toMatch(/[\r\n]/u);
    expect(f.ingress(':irc.example 371 LabNick :BOTCMD access=account params>=1')).toBe(true);
    expect(f.ingress(':irc.example 374 LabNick :End of COMMANDS')).toBe(true);

    const admitted = f.service.execute({ context, action: { type: 'botcmd-add', name: 'greet', argc: 1, help: 'help ' } });
    expect(admitted.view.phase).toBe('pending');
    expect(f.sent[1]).toBe('BOTCMD ADD greet 1 :help ');
    expect(f.sent[1]).not.toMatch(/[\r\n]/u);

    const beforeInvalid = f.sent.length;
    const rejected = f.service.execute({ context, action: { type: 'botcmd-add', name: 'unsafe', argc: 0, help: 'help\r\nJOIN #injected' } });
    expect(rejected.view.phase).toBe('blocked');
    expect(rejected.view.reason).toBe('invalid-request');
    expect(f.sent).toHaveLength(beforeInvalid);
    f.service.dispose();
  });

  it('rejects raw CRLF in a token argument before the formatter can remove it', () => {
    const f = fixture({ labels: false });
    f.service.refresh({ context, feature: 'botcmd' });
    expect(f.ingress(':irc.example 371 LabNick :BOTCMD access=account params>=1')).toBe(true);
    expect(f.ingress(':irc.example 374 LabNick :End of COMMANDS')).toBe(true);

    const beforeInvalid = f.sent.length;
    const rejected = f.service.execute({ context, action: { type: 'botcmd-run', name: 'greet', args: ['hi\r\n'] } });
    expect(rejected.view.phase).toBe('blocked');
    expect(rejected.view.reason).toBe('invalid-request');
    expect(f.sent).toHaveLength(beforeInvalid);
    f.service.dispose();
  });

  it('accepts only exact unprefixed labeled-response BATCH controls from private server ingress', () => {
    const f = fixture();
    f.service.refresh({ context, feature: 'botgrant' });
    const label = labelFrom(f.sent[0]!);

    expect(f.ingress(`@label=${label} BATCH +registry-1 labeled-response`, 'user')).toBe(false);
    expect(f.ingress(`@label=${label} BATCH +registry-1 labeled-response`, 'server')).toBe(false);
    expect(f.ingress(`@label=${label} :irc.example BATCH +registry-1 labeled-response`)).toBe(false);
    expect(f.ingress(`@label=${label} BATCH +registry-1 labeled-response`, 'prefixless-protocol')).toBe(true);
    expect(f.ingress(`@batch=registry-1 :irc.example 371 LabNick :BOTGRANT access=oper params>=1`)).toBe(true);
    expect(f.ingress(`@batch=registry-1 :irc.example 374 LabNick :End of COMMANDS`)).toBe(true);
    expect(f.emitted.at(-1)?.view.phase).toBe('pending');
    expect(f.ingress('BATCH -registry-1', 'user')).toBe(false);
    expect(f.ingress('BATCH -registry-1', 'prefixless-protocol')).toBe(true);
    expect(f.emitted.at(-1)?.view.phase).toBe('accepted');
    expect(f.emitted.at(-1)?.view.registry).toBe('enabled');
  });

  it('keeps nonempty labeled list rows incomplete until the exact batch end', () => {
    const f = fixture();
    f.service.refresh({ context, feature: 'botgrant' });
    const registryLabel = labelFrom(f.sent[0]!);
    f.ingress(`@label=${registryLabel} BATCH +registry-2 labeled-response`, 'prefixless-protocol');
    f.ingress(`@batch=registry-2 :irc.example 371 LabNick :BOTGRANT access=oper params>=1`);
    f.ingress(`@batch=registry-2 :irc.example 374 LabNick :End of COMMANDS`);
    f.ingress('BATCH -registry-2', 'prefixless-protocol');

    f.service.execute({ context, action: { type: 'botgrant-list', account: null } });
    const listLabel = labelFrom(f.sent[1]!);
    expect(f.ingress(`@label=${listLabel} BATCH +list-1 labeled-response`, 'prefixless-protocol')).toBe(true);
    expect(f.ingress('@batch=list-1 :irc.example NOTICE LabNick :BOTGRANT: alice speak #room expires=1800000000')).toBe(true);
    expect(f.emitted.at(-1)?.view.phase).toBe('pending');
    expect(f.ingress('BATCH -list-1', 'prefixless-protocol')).toBe(true);
    expect(f.emitted.at(-1)?.view.phase).toBe('accepted');
    expect(f.emitted.at(-1)?.view.rows).toHaveLength(1);
    f.service.dispose();
  });

  it('does not treat an empty labeled batch as list evidence or authorization', () => {
    const f = fixture();
    f.service.refresh({ context, feature: 'botgrant' });
    const registryLabel = labelFrom(f.sent[0]!);
    f.ingress(`@label=${registryLabel} BATCH +registry-empty labeled-response`, 'prefixless-protocol');
    f.ingress(`@batch=registry-empty :irc.example 371 LabNick :BOTGRANT access=oper params>=1`);
    f.ingress(`@batch=registry-empty :irc.example 374 LabNick :End of COMMANDS`);
    f.ingress('BATCH -registry-empty', 'prefixless-protocol');

    f.service.execute({ context, action: { type: 'botgrant-list', account: null } });
    const label = labelFrom(f.sent[1]!);
    f.ingress(`@label=${label} BATCH +empty-list labeled-response`, 'prefixless-protocol');
    expect(f.ingress('BATCH -empty-list', 'prefixless-protocol')).toBe(true);
    expect(f.emitted.at(-1)?.view.phase).toBe('unknown');
    expect(f.emitted.at(-1)?.view.authorization).toBe('unknown');
    f.service.dispose();
  });

  it('preserves unrelated synchronous ingress and counts public MEMO rows once during admission', () => {
    const f = fixture();
    f.setOnSend(line => {
      if (!line.includes('COMMANDS MEMO')) return;
      const label = labelFrom(line);
      expect(f.ingress(`@label=${label} :irc.example NOTICE LabNick :unrelated notice`)).toBe(false);
      f.ingress(`@label=${label} :irc.example 371 LabNick :MEMO account=oper`);
      f.ingress(`@label=${label} :irc.example 374 LabNick :End of COMMANDS`);
    });
    const refreshed = f.service.refresh({ context, feature: 'memo' });
    expect(refreshed.view.phase).toBe('accepted');
    expect(f.emitted.at(-1)?.view.rows).toEqual([
      { kind: 'status', label: 'MEMO', value: 'Registered on this connection', ref: null },
      { kind: 'status', label: 'MEMO', value: 'Registered on this connection', ref: null },
    ]);

    f.setOnSend(line => {
      if (!line.includes('MEMO LIST')) return;
      const label = labelFrom(line);
      expect(f.ingress(`@label=${label} :irc.example NOTICE LabNick :MEMO from Bob :hello`)).toBe(false);
      expect(f.ingress(`@label=${label} :irc.example NOTICE LabNick :MEMO: End of offline memos (1)`)).toBe(false);
    });
    const listed = f.service.execute({ context, action: { type: 'memo-list' } });
    expect(listed.view.phase).toBe('accepted');
    expect(listed.view.rows).toContainEqual({ kind: 'status', label: 'Offline memos', value: '1 message(s)', ref: null });
    f.service.dispose();
  });

  it('counts synchronous MEMO IGNORE LIST rows once across admission replay', () => {
    const f = fixture();
    f.setOnSend(line => {
      if (!line.includes('COMMANDS MEMO')) return;
      const label = labelFrom(line);
      f.ingress(`@label=${label} :irc.example 371 LabNick :MEMO account=oper`);
      f.ingress(`@label=${label} :irc.example 374 LabNick :End of COMMANDS`);
    });
    expect(f.service.refresh({ context, feature: 'memo' }).view.phase).toBe('accepted');
    f.setOnSend(line => {
      if (!line.includes('MEMO IGNORE LIST')) return;
      const label = labelFrom(line);
      expect(f.ingress(`@label=${label} :irc.example NOTICE LabNick :MEMO: ignoring Bob`)).toBe(true);
      expect(f.ingress(`@label=${label} :irc.example NOTICE LabNick :MEMO: End of ignore list (1)`)).toBe(true);
    });
    const result = f.service.execute({ context, action: { type: 'memo-ignore-list' } });
    expect(result.view.phase).toBe('accepted');
    expect(result.view.rows).toContainEqual({ kind: 'status', label: 'Ignored senders', value: '1 sender(s)', ref: null });
    f.service.dispose();
  });

  it('requires the current request label for a prefixless FAIL when labels are negotiated', () => {
    const f = fixture();
    f.service.refresh({ context, feature: 'memo' });
    const registryLabel = labelFrom(f.sent[0]!);
    f.ingress(`@label=${registryLabel} BATCH +registry-fail labeled-response`, 'prefixless-protocol');
    f.ingress(`@batch=registry-fail :irc.example 371 LabNick :MEMO account=oper`);
    f.ingress(`@batch=registry-fail :irc.example 374 LabNick :End of COMMANDS`);
    f.ingress('BATCH -registry-fail', 'prefixless-protocol');

    f.service.execute({ context, action: { type: 'memo-list' } });
    const label = labelFrom(f.sent[1]!);
    expect(f.ingress('@label=some-other-request FAIL MEMO ACCOUNT_REQUIRED :Sign in', 'prefixless-protocol')).toBe(false);
    expect(f.emitted.at(-1)?.view.phase).toBe('pending');
    expect(f.ingress(`@label=${label} FAIL MEMO ACCOUNT_REQUIRED :Sign in`, 'prefixless-protocol')).toBe(true);
    expect(f.emitted.at(-1)?.view.phase).toBe('rejected');
    expect(f.emitted.at(-1)?.view.reason).toBe('permission-denied');
    f.service.dispose();
  });

  it('retains unlabelled single-flight FAIL handling only when labels are not negotiated', () => {
    const f = fixture({ labels: false });
    f.service.refresh({ context, feature: 'memo' });
    expect(f.ingress(':irc.example 371 LabNick :MEMO account=oper')).toBe(true);
    expect(f.ingress(':irc.example 374 LabNick :End of COMMANDS')).toBe(true);
    f.service.execute({ context, action: { type: 'memo-list' } });
    expect(f.ingress('FAIL MEMO ACCOUNT_REQUIRED :Sign in', 'prefixless-protocol')).toBe(true);
    expect(f.emitted.at(-1)?.view.phase).toBe('rejected');
    f.service.dispose();
  });
  it('blocks a mutation before the registry is refreshed as feature-unknown and sends nothing', () => {
    const f = fixture({ labels: false });
    const result = f.service.execute({ context, action: { type: 'botgrant-add', account: 'bot', grant: 'speak', channel: '#room', ttlSeconds: 60 } });
    expect(result.view).toMatchObject({ phase: 'blocked', reason: 'feature-unknown', registry: 'unknown', effectiveFeature: 'unknown' });
    expect(f.service.readiness({ context, feature: 'botgrant' })).toMatchObject({ allowed: false, view: { reason: 'feature-unknown' } });
    expect(f.sent).toEqual([]);
    f.service.dispose();
  });

  it('never resends a mutation whose outcome timed out until a list re-read reconciles it', () => {
    vi.useFakeTimers();
    const f = fixture({ labels: false });
    f.service.refresh({ context, feature: 'botgrant' });
    f.ingress(':irc.example 371 LabNick :BOTGRANT access=oper params>=1');
    f.ingress(':irc.example 374 LabNick :End of COMMANDS');
    const add = { type: 'botgrant-add', account: 'bot', grant: 'speak', channel: '#room', ttlSeconds: 60 } as const;
    expect(f.service.execute({ context, action: add }).view.phase).toBe('pending');
    expect(f.sent.filter(line => line.startsWith('BOTGRANT ADD'))).toHaveLength(1);
    vi.advanceTimersByTime(15_000);
    expect(f.emitted.at(-1)?.view).toMatchObject({ phase: 'unknown', reason: 'response-timeout' });
    // A late acknowledgement for the timed-out write is not adopted.
    expect(f.ingress(':irc.example NOTICE LabNick :BOTGRANT: added')).toBe(false);
    expect(f.emitted.at(-1)?.view.phase).toBe('unknown');

    expect(f.service.execute({ context, action: add }).view).toMatchObject({ phase: 'blocked', reason: 'feature-unknown' });
    // A registry refresh proves availability, not the earlier write's outcome.
    f.service.refresh({ context, feature: 'botgrant' });
    f.ingress(':irc.example 371 LabNick :BOTGRANT access=oper params>=1');
    f.ingress(':irc.example 374 LabNick :End of COMMANDS');
    expect(f.service.execute({ context, action: add }).view).toMatchObject({ phase: 'blocked', reason: 'feature-unknown' });
    expect(f.sent.filter(line => line.startsWith('BOTGRANT ADD'))).toHaveLength(1);

    expect(f.service.execute({ context, action: { type: 'botgrant-list', account: null } }).view.phase).toBe('pending');
    f.ingress(':irc.example NOTICE LabNick :BOTGRANT: bot speak #room expires=1800000060');
    f.ingress(':irc.example NOTICE LabNick :BOTGRANT: none');
    expect(f.emitted.at(-1)?.view.phase).toBe('accepted');
    expect(f.service.execute({ context, action: add }).view.phase).toBe('pending');
    expect(f.sent.filter(line => line.startsWith('BOTGRANT ADD'))).toHaveLength(2);
    f.service.dispose();
  });

  it('blocks a repeated UNFURL opt-in after an unknown outcome while still allowing the safe opt-out', () => {
    vi.useFakeTimers();
    const f = fixture({ labels: false });
    f.service.refresh({ context, feature: 'unfurl' });
    f.ingress(':irc.example 371 LabNick :UNFURL params>=1');
    f.ingress(':irc.example 374 LabNick :End of COMMANDS');
    expect(f.service.execute({ context, action: { type: 'unfurl-on' } }).view).toMatchObject({ phase: 'blocked', reason: 'feature-unknown' });
    expect(f.service.execute({ context, action: { type: 'unfurl-off' } }).view.phase).toBe('pending');
    f.ingress(':irc.example NOTICE LabNick :UNFURL: client refused');
    expect(f.emitted.at(-1)?.view).toMatchObject({ phase: 'accepted', effectiveFeature: 'enabled' });

    expect(f.service.execute({ context, action: { type: 'unfurl-on' } }).view.phase).toBe('pending');
    vi.advanceTimersByTime(15_000);
    expect(f.emitted.at(-1)?.view).toMatchObject({ phase: 'unknown', reason: 'response-timeout' });
    const onLines = () => f.sent.filter(line => line === 'UNFURL ON').length;
    expect(onLines()).toBe(1);
    expect(f.service.execute({ context, action: { type: 'unfurl-on' } }).view).toMatchObject({ phase: 'blocked', reason: 'feature-unknown' });
    expect(f.service.execute({ context, action: { type: 'unfurl-preview', url: 'https://example.com/a' } }).view.phase).toBe('blocked');
    expect(onLines()).toBe(1);
    expect(f.sent.some(line => line.startsWith('UNFURL https://'))).toBe(false);
    expect(f.service.execute({ context, action: { type: 'unfurl-off' } }).view.phase).toBe('pending');
    f.service.dispose();
  });
});
