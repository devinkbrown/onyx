// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { IRCClient } from './client';

function feed(client: IRCClient, line: string): void {
  (client as unknown as { _onMessage(event: { data: string }): void })
    ._onMessage({ data: line });
}

describe('IRCClient PREFIX capability ownership', () => {
  it('retains the last good role map when a later update is malformed', () => {
    const client = new IRCClient({
      url: 'wss://example.test',
      nick: 'onyx',
      onMessage: () => {},
    });

    feed(client, ':server 005 onyx PREFIX=(ov)@+ :are supported by this server');
    expect(client.prefixToMode).toEqual({ '@': 'o', '+': 'v' });
    expect(client.modeToPrefix).toEqual({ o: '@', v: '+' });

    feed(client, ':server 005 onyx PREFIX=(ov)@ :are supported by this server');
    expect(client.prefixToMode).toEqual({ '@': 'o', '+': 'v' });
    expect(client.modeToPrefix).toEqual({ o: '@', v: '+' });
    expect(client.isupport.PREFIX_MODES).toEqual({ '@': 'o', '+': 'v' });
    expect(client.isupport.PREFIX).toEqual({ o: '@', v: '+' });
  });
});
