// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
createRequire(import.meta.url)('./ports.js');

test('WS frames register without CRLF, remain separate, and reject outbound line injection', () => {
  const previous = globalThis.WebSocket;
  const handlers = {};
  const received = [];
  const opened = [];
  const closed = [];
  let raw;
  class Socket {
    static OPEN = 1;
    static instances = [];
    readyState = 1;
    protocol = '';
    sent = [];
    listeners = {};
    constructor(url, protocols) { this.url = url; this.protocols = protocols; this.protocol = protocols?.[0] || ''; Socket.instances.push(this); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    send(line) { this.sent.push(line); }
    close(code, reason) { this.closeRequest = [code, reason]; this.listeners.close?.({ wasClean: true, reason: reason || '' }); }
  }
  globalThis.WebSocket = Socket;
  const ports = {};
  for (const name of ['wsConnect', 'wsSend', 'wsClose', 'vaultPut', 'vaultGet', 'passkeyCreate', 'passkeyGet', 'passkeySettleRequest', 'dmSealRequest', 'dmOpenRequest', 'dmPublishKey', 'roomSealRequest', 'roomOpenRequest', 'groupControlInstall', 'groupDirectoryDerive']) {
    ports[name] = { subscribe: callback => { handlers[name] = callback; } };
  }
  ports.wsOpened = { send: value => opened.push(value) };
  ports.wsClosed = { send: value => closed.push(value) };
  ports.wsLines = { send: value => received.push(value.lines) };
  try {
    globalThis.OnyxPorts.wire({ ports });
    assert.equal(globalThis.OnyxPorts.normalizeRuntimeLine('CAP LS 302\r\n'), 'CAP LS 302');
    assert.equal(globalThis.OnyxPorts.normalizeRuntimeLine('NICK guest'), 'NICK guest');
    assert.equal(globalThis.OnyxPorts.normalizeRuntimeLine('CAP LS\r\nUSER injected'), null);
    assert.equal(globalThis.OnyxPorts.normalizeRuntimeLine('bad\x00line\r\n'), null);
    handlers.wsConnect({ url: 'wss://example.test/ws' });
    raw = Socket.instances.at(-1);
    assert.deepEqual(raw.protocols, ['text.ircv3.net']);
    raw.listeners.open();
    raw.listeners.message({ data: ':server CAP guest LS :multi-prefix' });
    raw.listeners.message({ data: ':server 001 guest :Welcome' });
    raw.listeners.message({ data: ':a PRIVMSG #room :one\r\n:b PRIVMSG #room :two\r\n' });
    raw.listeners.message({ data: `FOO alice :ordinary diagnostic\r\n@time=2026-11-04T00:00:00Z :server FOO alice MEDIA MACKEY #room secret-key-material\r\nFOO alice MEDIA MACKEY #room key-${'x'.repeat(9000)}\r\n` });
    assert.deepEqual(received, [
      [':server CAP guest LS :multi-prefix'],
      [':server 001 guest :Welcome'],
      [':a PRIVMSG #room :one', ':b PRIVMSG #room :two'],
      ['FOO alice :ordinary diagnostic'],
    ]);
    handlers.wsSend('CAP LS 302\r\n');
    handlers.wsSend('NICK guest');
    handlers.wsSend('PRIVMSG #room :bad\r\nOPER injected');
    handlers.wsSend('bad\x00line');
    handlers.wsSend('');
    assert.deepEqual(raw.sent, ['CAP LS 302', 'NICK guest']);
    raw.protocol = 'text.ircv3.net';
    handlers.wsSend('PING :probe\r\n');
    assert.equal(raw.sent.at(-1), 'PING :probe');

    const retired = raw;
    handlers.wsConnect({ url: 'wss://example.test/next' });
    const current = Socket.instances.at(-1);
    const receivedBeforeRetiredEvents = received.length;
    const openedBeforeRetiredEvents = opened.length;
    const closedBeforeRetiredEvents = closed.length;
    retired.listeners.message({ data: ':old.server 900 me nick!u@h old-account :stale' });
    retired.listeners.open();
    retired.listeners.error();
    retired.listeners.close({ wasClean: true, reason: 'retired' });
    assert.equal(received.length, receivedBeforeRetiredEvents);
    assert.equal(opened.length, openedBeforeRetiredEvents);
    assert.equal(closed.length, closedBeforeRetiredEvents);
    current.listeners.open();
    assert.equal(opened.length, openedBeforeRetiredEvents + 1);
    handlers.wsConnect({ url: 'wss://example.test/unsupported' });
    const unsupported = Socket.instances.at(-1);
    unsupported.protocol = '';
    unsupported.listeners.open();
    assert.deepEqual(unsupported.closeRequest, [1002, 'Unsupported WebSocket subprotocol']);
    raw = unsupported;
    handlers.wsClose();
  } finally {
    raw?.close();
    globalThis.WebSocket = previous;
  }
});
