// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import {
  IRCClient,
  MAX_CLIENT_CAP_ENTRIES,
  MAX_CLIENT_LIST_CHANNEL_LENGTH,
  MAX_CLIENT_LIST_ROWS,
  MAX_CLIENT_LIST_TOPIC_LENGTH,
  MAX_CLIENT_SASL_MECHANISMS,
} from './client';

function client(): IRCClient {
  return new IRCClient({ url: 'wss://example.test', nick: 'onyx', onMessage: () => {} });
}

function feed(target: IRCClient, line: string): void {
  (target as unknown as { _onMessage(event: { data: string }): void })._onMessage({ data: line });
}

function discoveryState(target: IRCClient): {
  _capAvailable: string[];
  _saslMechs: string[];
} {
  return target as unknown as {
    _capAvailable: string[];
    _saslMechs: string[];
  };
}

describe('IRCClient CAP discovery bounds', () => {
  it('bounds and deduplicates advertised capabilities across updates', () => {
    const target = client();
    const caps = Array.from(
      { length: MAX_CLIENT_CAP_ENTRIES + 12 },
      (_, index) => `cap-${index.toString().padStart(4, '0')}=value-${index}`,
    );
    feed(target, `:server CAP * LS :${caps.join(' ')}`);

    expect(discoveryState(target)._capAvailable).toHaveLength(MAX_CLIENT_CAP_ENTRIES);
    expect(target.capValues).toHaveProperty('size', MAX_CLIENT_CAP_ENTRIES);

    feed(target, ':server CAP * NEW :cap-0000=replacement cap-overflow=value');
    expect(discoveryState(target)._capAvailable).toHaveLength(MAX_CLIENT_CAP_ENTRIES);
    expect(target.capValues.get('cap-0000')).toBe('replacement');
    expect(target.capValues.has('cap-overflow')).toBe(false);

    feed(target, ':server CAP * DEL :cap-0001');
    feed(target, ':server CAP * NEW :cap-after-delete=value');
    expect(discoveryState(target)._capAvailable).toHaveLength(MAX_CLIENT_CAP_ENTRIES);
    expect(target.capValues.has('cap-after-delete')).toBe(true);
  });

  it('bounds SASL mechanism parsing and negotiated ACK state', () => {
    const target = client();
    const mechanisms = Array.from(
      { length: MAX_CLIENT_SASL_MECHANISMS + 10 },
      (_, index) => `MECH-${index}`,
    );
    feed(target, `:server CAP * LS :sasl=${mechanisms.join(',')},MECH-0`);
    expect(discoveryState(target)._saslMechs).toHaveLength(MAX_CLIENT_SASL_MECHANISMS);
    expect(new Set(discoveryState(target)._saslMechs)).toHaveProperty(
      'size',
      MAX_CLIENT_SASL_MECHANISMS,
    );

    const ack = Array.from(
      { length: MAX_CLIENT_CAP_ENTRIES + 20 },
      (_, index) => `ack-${index}`,
    );
    feed(target, `:server CAP * ACK :${ack.join(' ')}`);
    expect(target.negotiatedCaps).toHaveProperty('size', MAX_CLIENT_CAP_ENTRIES);
  });
});

describe('IRCClient LIST collection bounds', () => {
  it('validates, deduplicates, and caps server rows before resolving', async () => {
    const target = client();
    target.sendRaw = vi.fn(() => true);
    const resultPromise = target.list(999_999);
    feed(target, ':server 321 onyx Channel :Users Name');
    feed(
      target,
      `:server 322 onyx #room0000 7junk :${'x'.repeat(MAX_CLIENT_LIST_TOPIC_LENGTH)}\u0007tail`,
    );
    for (let index = 1; index < MAX_CLIENT_LIST_ROWS + 12; index += 1) {
      const key = index.toString().padStart(4, '0');
      feed(target, `:server 322 onyx #room${key} ${index} :topic ${index}`);
    }
    feed(target, ':server 322 onyx #ROOM0000 9 :duplicate');
    feed(
      target,
      `:server 322 onyx #${'x'.repeat(MAX_CLIENT_LIST_CHANNEL_LENGTH)} 9 :oversized`,
    );
    feed(target, ':server 322 onyx not-a-channel 9 :invalid');
    feed(target, ':server 323 onyx :End of /LIST');

    const rows = await resultPromise;
    expect(target.sendRaw).toHaveBeenCalledWith('LIST');
    expect(rows).toHaveLength(MAX_CLIENT_LIST_ROWS);
    expect(rows[0]).toEqual({
      channel: '#room0000',
      users: 0,
      topic: 'x'.repeat(MAX_CLIENT_LIST_TOPIC_LENGTH),
    });
    expect(rows.at(-1)?.channel).toBe(`#room${(MAX_CLIENT_LIST_ROWS - 1).toString().padStart(4, '0')}`);
    expect(new Set(rows.map(row => row.channel.toLowerCase()))).toHaveProperty(
      'size',
      MAX_CLIENT_LIST_ROWS,
    );
  });

  it('resolves immediately when LIST cannot be written', async () => {
    const target = client();
    target.sendRaw = vi.fn(() => false);

    await expect(target.list(Number.POSITIVE_INFINITY)).resolves.toEqual([]);
  });
});
