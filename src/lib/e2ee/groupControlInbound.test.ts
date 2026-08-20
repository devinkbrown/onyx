// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { parseIRCMessage } from '@/lib/irc/parser';

import {
  parseGroupControlDelivery,
  parseGroupControlDeliveryLine,
} from './groupControlInbound';

const PAYLOAD = 'AQIDBA';

describe('group control inbound delivery parser', () => {
  it('parses all three delivery verbs with an explicit canonical sender account', () => {
    const keyPackage = parseGroupControlDeliveryLine(
      ':Alice!alice@localhost E2EE.KEYPACKAGE #Secure Alice phone :AQIDBA',
    );
    expect(keyPackage).toMatchObject({
      kind: 'key-package',
      channel: '#secure',
      fromAccount: 'alice',
      fromDevice: 'phone',
      payload: PAYLOAD,
    });

    const commit = parseGroupControlDelivery(
      parseIRCMessage(':Alice!alice@localhost E2EE.COMMIT #Secure Alice phone :AQIDBA'),
    );
    expect(commit).toMatchObject({ kind: 'commit', fromAccount: 'alice' });

    const welcome = parseGroupControlDeliveryLine(
      ':Alice!alice@localhost E2EE.WELCOME #Secure Alice phone Bob tablet :AQIDBA',
    );
    expect(welcome).toMatchObject({
      kind: 'welcome',
      toAccount: 'Bob',
      toDevice: 'tablet',
      fromAccount: 'alice',
    });
  });

  it('never infers the sender account from a spoofable prefix', () => {
    const parsed = parseGroupControlDeliveryLine(
      ':Mallory!mallory@evil E2EE.COMMIT #room Alice device :AQIDBA',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.fromAccount).toBe('alice');
    expect(parsed!.sourcePrefix).toContain('Mallory');
  });

  it('rejects missing account, wrong params, KEYTRANS, and noncanonical payloads', () => {
    expect(parseGroupControlDeliveryLine(
      ':server E2EE.COMMIT #room device :AQIDBA',
      '',
    )).toBeNull();
    expect(parseGroupControlDeliveryLine(
      ':server E2EE.COMMIT #room device :AQIDBA extra',
      'Alice',
    )).toBeNull();
    expect(parseGroupControlDeliveryLine(
      ':server E2EE.WELCOME #room Alice device Bob tablet :AQIDBA extra',
      'Alice',
    )).toBeNull();
    expect(parseGroupControlDeliveryLine(
      ':server KEYTRANS PROOF 1 :AQIDBA',
      'Alice',
    )).toBeNull();
    expect(parseGroupControlDeliveryLine(
      ':server E2EE.COMMIT #room device :not+url',
      'Alice',
    )).toBeNull();
  });

  it('marks a structurally recognized legacy OGC1 payload locked', () => {
    // OGC1 v1 envelope with one body byte and zero signer/signature bytes.
    const raw = new Uint8Array(108 + 1);
    raw.set(new TextEncoder().encode('OGC1'), 0);
    raw[4] = 1;
    raw[5] = 3;
    raw[11] = 1;
    raw[12] = 0x42;
    const b64 = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const parsed = parseGroupControlDeliveryLine(
      `:server E2EE.COMMIT #room Alice device :${b64}`,
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.locked).toBe(true);
  });
});
