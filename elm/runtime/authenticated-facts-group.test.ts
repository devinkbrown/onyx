import { describe, expect, it } from 'vitest';
import { createAuthenticatedFacts } from './authenticated-facts';
import { makeAccountGeneration, makeAccountId, makeConnectionGeneration, makeLocalPhysicalEpoch, makeNetworkId, makeOwnerRef, type OwnerSnapshot, type Transport } from './contracts';
import { deriveGroupDeviceId, encodeGroupDeviceDirectoryEntry } from '../../src/lib/e2ee/groupDeviceDirectory';

const S = ':irc.facts.test';
function harness() {
  const owner: OwnerSnapshot = {
    networkId: makeNetworkId('custom:wss://facts.test/ws')!, accountId: makeAccountId('alice')!,
    accountGeneration: makeAccountGeneration(1)!, connectionGeneration: makeConnectionGeneration(1)!,
    physicalRef: makeLocalPhysicalEpoch('0123456789abcdef0123456789abcdef')!, ownerRef: makeOwnerRef('abcdefghijklmnopqrstuv')!,
  };
  const sent: string[] = [];
  const transport = {
    isCurrent: (candidate: OwnerSnapshot) => candidate.ownerRef === owner.ownerRef, ownerSnapshot: () => owner,
    sendLine: ({ line }: { line: string }) => { sent.push(line); return { kind: 'transport-admitted' } as const; },
    sendLineGroup: ({ lines }: { lines: readonly string[] }) => { sent.push(...lines); return lines.map(() => ({ kind: 'transport-admitted' } as const)); },
    sendBinary: () => ({ kind: 'blocked', reason: 'policy' } as const), onPrivateIngress: () => ({ dispose() {} }),
    onAuthenticatedServerEvent: () => ({ dispose() {} }), onBinary: () => ({ dispose() {} }), dispose() {},
  } as unknown as Transport;
  const service = createAuthenticatedFacts({ ownerSnapshot: () => owner, isCurrent: () => true, transport, currentServerPrefix: () => 'irc.facts.test', currentNick: () => 'Alice' });
  const server = (line: string) => service.ingest({ physicalContext: owner, sourceKind: 'server', line: `${S} ${line}` });
  const user = (line: string) => service.ingest({ physicalContext: owner, sourceKind: 'user', line });
  return { owner, sent, service, server, user };
}

/** Answer the collector's outstanding MODE/PROP/NAMES/WHO queries for a founder-only room. */
async function completeSnapshot(h: ReturnType<typeof harness>, room: string, props: string[], extraNames = '') {
  const who = [...h.sent].reverse().find(line => line.startsWith(`WHO ${room} `))?.match(/%tcnfa,([0-9]+)/u)?.[1];
  await h.server(`324 Alice ${room} +nt`);
  for (const prop of props) await h.server(`818 Alice ${room} ${prop}`);
  await h.server(`819 Alice ${room} :end`);
  await h.server(`353 Alice = ${room} :~Alice${extraNames}`);
  await h.server(`366 Alice ${room} :end`);
  if (who) await h.server(`354 Alice ${who} ${room} Alice ~ alice`);
  await h.server(`315 Alice ${room} :end`);
}

describe('authenticated facts against real Onyx Server wire shapes', () => {
  it('collects an E2EEKEY LIST snapshot whose notices carry the E2EEKEY prefix (fix A)', async () => {
    const h = harness();
    await h.server('005 Alice CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ WHOX :supported');
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const wire = encodeGroupDeviceDirectoryEntry({ signerPub: new Uint8Array(32).fill(5), encryptionPub: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) })!;
    const id = (await deriveGroupDeviceId(wire))!;
    const pending = h.service.authenticatedDirectory(h.owner, makeAccountId('alice')!);
    expect(h.sent).toContain('E2EEKEY LIST alice');
    // Server folds the id (ASCII-lowercase); fix B keeps the key-derived spelling.
    await h.server(`NOTICE Alice :E2EEKEY DEVICE account=alice id=${id.toLowerCase()} alg=onyx-ogc1-v1 key=${wire}`);
    await h.server('NOTICE Alice :E2EEKEY END account=alice devices=1');
    const fact = await pending;
    expect(fact?.snapshot.devices.map(row => [row.deviceId, row.trusted])).toEqual([[id, true]]);
  });

  it('treats an unrequested, changed 818 as a policy change and ignores an equal one (fix C)', async () => {
    const h = harness();
    await h.server('005 Alice CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ WHOX :supported');
    await h.user(':Alice!a@h JOIN #room');
    await completeSnapshot(h, '#room', []);
    expect(h.service.policySnapshot(h.owner, '#room')).toMatchObject({ encryption: 'off', complete: true });
    const propQueries = () => h.sent.filter(line => line === 'PROP #room').length;
    const before = propQueries();
    // The setter's own PROP write is answered with 818/819 only.
    await h.server('818 Alice #room encryption-policy required');
    expect(propQueries()).toBe(before + 1);
    await h.server('818 Alice #room encryption-policy required');
    await h.server('819 Alice #room :end');
    expect(h.service.policySnapshot(h.owner, '#room')).toMatchObject({ encryption: 'required', complete: true });
    // An unrequested 818 carrying the value we already know does not refresh again.
    await h.server('818 Alice #room encryption-policy required');
    expect(propQueries()).toBe(before + 1);
  });

  it('records CREATE <oid> before the snapshot and offers genesis only for a founder-only required room (fix D)', async () => {
    const h = harness();
    await h.server('005 Alice CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ WHOX :supported');
    const op = h.service.noteCreateIntent({ context: { owner: h.owner }, target: '#fresh', label: 'create-1' });
    h.service.observeCreateAdmission(op!, { kind: 'transport-admitted' });
    // Real server order: JOIN, then the creator-only CREATE reply, then snapshot replies.
    await h.user(':Alice!a@h JOIN #fresh');
    await h.server('CREATE #fresh 0abcdef12');
    expect(h.service.freshCreateFact(h.owner, '#fresh')).toBeNull(); // snapshot incomplete
    await completeSnapshot(h, '#fresh', []);
    expect(h.service.freshCreateFact(h.owner, '#fresh')).toBeNull(); // policy not yet required
    await h.server('818 Alice #fresh encryption-policy required');
    await completeSnapshot(h, '#fresh', ['encryption-policy required']);
    const fact = h.service.freshCreateFact(h.owner, '#fresh');
    expect(fact?.objectId).toBe('0abcdef12');
    // Routine refreshes bump counters but must not invalidate the proof.
    await h.user(':Alice!a@h JOIN #fresh');
    await completeSnapshot(h, '#fresh', ['encryption-policy required']);
    expect(fact && h.service.validateFreshCreateFact(fact)).toBe(true);
    // Any other member drops it for good, even after they leave.
    await h.user(':Bob!b@h JOIN #fresh');
    expect(h.service.freshCreateFact(h.owner, '#fresh')).toBeNull();
    expect(fact && h.service.validateFreshCreateFact(fact)).toBe(false);
    await h.user(':Bob!b@h PART #fresh');
    await completeSnapshot(h, '#fresh', ['encryption-policy required']);
    expect(h.service.freshCreateFact(h.owner, '#fresh')).toBeNull();
  });

  it('accepts the Onyx Server IRCX founder mode Q (fix D)', async () => {
    const h = harness();
    await h.server('005 Alice CASEMAPPING=rfc1459 PREFIX=(Qqov).~@+ WHOX :supported');
    const op = h.service.noteCreateIntent({ context: { owner: h.owner }, target: '#fresh', label: 'create-1' });
    h.service.observeCreateAdmission(op!, { kind: 'transport-admitted' });
    await h.user(':Alice!a@h JOIN #fresh');
    await h.server('CREATE #fresh 0abcdef12');
    const who = [...h.sent].reverse().find(line => line.startsWith('WHO #fresh '))?.match(/%tcnfa,([0-9]+)/u)?.[1];
    await h.server('324 Alice #fresh +nt'); await h.server('818 Alice #fresh encryption-policy required'); await h.server('819 Alice #fresh :end');
    await h.server('353 Alice = #fresh :.Alice'); await h.server('366 Alice #fresh :end');
    if (who) await h.server(`354 Alice ${who} #fresh Alice . alice`); await h.server('315 Alice #fresh :end');
    expect(h.service.freshCreateFact(h.owner, '#fresh')?.objectId).toBe('0abcdef12');
  });

  it('fails closed when the founder mode is missing or NAMES lists another member (fix D)', async () => {
    for (const variant of ['no-founder', 'names-member'] as const) {
      const h = harness();
      await h.server('005 Alice CASEMAPPING=rfc1459 PREFIX=(qaohv)~&@%+ WHOX :supported');
      const op = h.service.noteCreateIntent({ context: { owner: h.owner }, target: '#fresh', label: 'create-1' });
      h.service.observeCreateAdmission(op!, { kind: 'transport-admitted' });
      await h.user(':Alice!a@h JOIN #fresh');
      await h.server('CREATE #fresh 0abcdef12');
      if (variant === 'no-founder') {
        const who = [...h.sent].reverse().find(line => line.startsWith('WHO #fresh '))?.match(/%tcnfa,([0-9]+)/u)?.[1];
        await h.server('324 Alice #fresh +nt'); await h.server('818 Alice #fresh encryption-policy required'); await h.server('819 Alice #fresh :end');
        await h.server('353 Alice = #fresh :Alice'); await h.server('366 Alice #fresh :end');
        if (who) await h.server(`354 Alice ${who} #fresh Alice ~ alice`); await h.server('315 Alice #fresh :end');
      } else {
        await completeSnapshot(h, '#fresh', ['encryption-policy required'], ' Bob');
      }
      expect(h.service.freshCreateFact(h.owner, '#fresh')).toBeNull();
    }
  });
});
