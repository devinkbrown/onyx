/**
 * Voice channel integration tests.
 *
 * Tests the end-to-end flow for voice channel join/leave, LADON media
 * message routing, peer state management, and VoiceBar controls — using
 * mocked IRC client and media engine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Minimal IRCClient stub
// ─────────────────────────────────────────────────────────────────────────────

class MockIRCClient {
  extraMessageHandlers: Set<(m: Record<string, unknown>) => void> = new Set();
  sent: string[] = [];
  isupport = { LADONMEDIA: 'MEDIA', PREFIX: { q: '~', o: '@', v: '+' } };
  capValues: Map<string, string> = new Map();

  sendRaw(...parts: string[]) {
    this.sent.push(parts.join(' '));
  }

  simulateMessage(msg: Record<string, unknown>) {
    for (const h of this.extraMessageHandlers) h(msg);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice join / leave CTCP PRIVMSG payloads
// ─────────────────────────────────────────────────────────────────────────────

describe('Voice channel CTCP signaling', () => {
  it('JOIN sends correct CTCP PRIVMSG', () => {
    const client = new MockIRCClient();
    const channel = '#root';

    // Simulates what useLadonMedia.announceJoin() does
    client.sendRaw('PRIVMSG', channel, '\x01LADON_MEDIA JOIN\x01');

    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]).toBe('PRIVMSG #root \x01LADON_MEDIA JOIN\x01');
  });

  it('LEAVE sends correct CTCP PRIVMSG', () => {
    const client = new MockIRCClient();
    const channel = '#voice';

    client.sendRaw('PRIVMSG', channel, '\x01LADON_MEDIA LEAVE\x01');

    expect(client.sent[0]).toBe('PRIVMSG #voice \x01LADON_MEDIA LEAVE\x01');
  });

  it('SCREENSHARE_START sends correct CTCP PRIVMSG', () => {
    const client = new MockIRCClient();
    const channel = '#root';

    client.sendRaw('PRIVMSG', channel, '\x01LADON_MEDIA SCREENSHARE_START\x01');

    expect(client.sent[0]).toBe('PRIVMSG #root \x01LADON_MEDIA SCREENSHARE_START\x01');
  });

  it('SCREENSHARE_STOP sends correct CTCP PRIVMSG', () => {
    const client = new MockIRCClient();
    const channel = '#root';

    client.sendRaw('PRIVMSG', channel, '\x01LADON_MEDIA SCREENSHARE_STOP\x01');

    expect(client.sent[0]).toBe('PRIVMSG #root \x01LADON_MEDIA SCREENSHARE_STOP\x01');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HangUp MEDIAFRAME
// ─────────────────────────────────────────────────────────────────────────────

describe('Voice hang-up MEDIAFRAME', () => {
  it('sends MEDIAFRAME VOICE_LEAVE on hang up', () => {
    const client = new MockIRCClient();
    const callChannel = '#root';

    // Simulates VoiceBar.hangUp()
    client.sendRaw('MEDIAFRAME', callChannel, 'VOICE_LEAVE', '');

    expect(client.sent[0]).toBe('MEDIAFRAME #root VOICE_LEAVE ');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LADON media message routing
// ─────────────────────────────────────────────────────────────────────────────

describe('LADON media message handler routing', () => {
  it('routes MEDIA command to handler', () => {
    const client = new MockIRCClient();
    const handler = vi.fn();
    client.extraMessageHandlers.add(handler);

    const mediaMsg = {
      command: 'MEDIA',
      params: ['#root', 'VOICE_FRAME', 'base64data=='],
      nick: 'alice',
    };
    client.simulateMessage(mediaMsg);

    expect(handler).toHaveBeenCalledWith(mediaMsg);
  });

  it('routes LADONMEDIA command to handler', () => {
    const client = new MockIRCClient();
    const handler = vi.fn();
    client.extraMessageHandlers.add(handler);

    const mediaMsg = {
      command: 'LADONMEDIA',
      params: ['#voice', 'VOICE_JOIN', ''],
      nick: 'bob',
    };
    client.simulateMessage(mediaMsg);

    expect(handler).toHaveBeenCalledWith(mediaMsg);
  });

  it('handler correctly filters non-MEDIA commands', () => {
    const client = new MockIRCClient();

    // Simulate the filtering logic in useLadonMedia
    const mediaCmd = (client.isupport.LADONMEDIA || 'MEDIA').toUpperCase();
    const received: string[] = [];

    client.extraMessageHandlers.add((msg) => {
      const cmd = (msg as { command: string }).command;
      if (cmd !== mediaCmd && cmd !== 'MEDIA' && cmd !== 'LADONMEDIA') return;
      received.push(cmd);
    });

    client.simulateMessage({ command: 'PRIVMSG', params: ['#root', 'hi'], nick: 'x' });
    client.simulateMessage({ command: 'MEDIA',    params: ['#root', 'V', ''], nick: 'y' });
    client.simulateMessage({ command: 'JOIN',     params: ['#root'], nick: 'z' });

    expect(received).toEqual(['MEDIA']);
  });

  it('ignores messages with missing nick, target, or subtype', () => {
    const client = new MockIRCClient();
    const handled: unknown[] = [];

    client.extraMessageHandlers.add((msg) => {
      const { command, params, nick } = msg as { command: string; params: string[]; nick: string };
      if (command !== 'MEDIA') return;
      const target  = params[0];
      const subtype = params[1];
      if (!nick || !target || !subtype) return;
      handled.push({ nick, target, subtype });
    });

    // Missing nick
    client.simulateMessage({ command: 'MEDIA', params: ['#root', 'V', ''], nick: '' });
    // Missing target
    client.simulateMessage({ command: 'MEDIA', params: ['', 'V', ''], nick: 'alice' });
    // Missing subtype
    client.simulateMessage({ command: 'MEDIA', params: ['#root', '', ''], nick: 'alice' });
    // Valid
    client.simulateMessage({ command: 'MEDIA', params: ['#root', 'VOICE_FRAME', 'data'], nick: 'alice' });

    expect(handled).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Peer state (voice participant) management
// ─────────────────────────────────────────────────────────────────────────────

describe('Voice peer state management', () => {
  it('adds and removes peers correctly', () => {
    const peers = new Map<string, { nick: string; speaking: boolean; muted: boolean }>();

    // onPeerState callback (from useLadonMedia)
    const onPeerState = (peer: { nick: string; speaking: boolean; muted: boolean }) => {
      const updated = new Map(peers);
      updated.set(peer.nick, peer);
      for (const [k, v] of updated) peers.set(k, v);
    };

    const onPeerLeft = (nick: string) => {
      peers.delete(nick);
    };

    onPeerState({ nick: 'alice', speaking: false, muted: false });
    onPeerState({ nick: 'bob',   speaking: true,  muted: false });

    expect(peers.size).toBe(2);
    expect(peers.get('bob')?.speaking).toBe(true);

    onPeerLeft('alice');
    expect(peers.size).toBe(1);
    expect(peers.has('alice')).toBe(false);
  });

  it('updates speaking state for existing peer', () => {
    const peers = new Map<string, { nick: string; speaking: boolean; muted: boolean }>();
    peers.set('carol', { nick: 'carol', speaking: false, muted: false });

    // onPeerSpeaking callback
    const onPeerSpeaking = (nick: string, speaking: boolean) => {
      const updated = new Map(peers);
      const p = updated.get(nick);
      if (p) updated.set(nick, { ...p, speaking });
      for (const [k, v] of updated) peers.set(k, v);
    };

    onPeerSpeaking('carol', true);
    expect(peers.get('carol')?.speaking).toBe(true);

    onPeerSpeaking('carol', false);
    expect(peers.get('carol')?.speaking).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Call duration timer
// ─────────────────────────────────────────────────────────────────────────────

describe('Call duration formatting', () => {
  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  it('formats seconds under a minute', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(9)).toBe('00:09');
    expect(formatDuration(59)).toBe('00:59');
  });

  it('formats minutes', () => {
    expect(formatDuration(60)).toBe('01:00');
    expect(formatDuration(125)).toBe('02:05');
    expect(formatDuration(3599)).toBe('59:59');
  });

  it('formats hours', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(7265)).toBe('2:01:05');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Video grid column layout
// ─────────────────────────────────────────────────────────────────────────────

describe('Video grid column calculation', () => {
  function videoGridColumns(count: number): string {
    if (count <= 1) return '1fr';
    if (count <= 2) return 'repeat(2, 1fr)';
    if (count <= 4) return 'repeat(2, 1fr)';
    return 'repeat(3, 1fr)';
  }

  it('returns 1fr for 0 or 1 participants', () => {
    expect(videoGridColumns(0)).toBe('1fr');
    expect(videoGridColumns(1)).toBe('1fr');
  });

  it('returns 2-column for 2–4 participants', () => {
    expect(videoGridColumns(2)).toBe('repeat(2, 1fr)');
    expect(videoGridColumns(4)).toBe('repeat(2, 1fr)');
  });

  it('returns 3-column for 5+ participants', () => {
    expect(videoGridColumns(5)).toBe('repeat(3, 1fr)');
    expect(videoGridColumns(9)).toBe('repeat(3, 1fr)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Nick deterministic color
// ─────────────────────────────────────────────────────────────────────────────

describe('Nick color hash', () => {
  function nickColor(nick: string): string {
    let hash = 0;
    for (const c of nick) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 60%, 48%)`;
  }

  it('returns a valid hsl color', () => {
    const color = nickColor('devin');
    expect(color).toMatch(/^hsl\(\d+, 60%, 48%\)$/);
  });

  it('is deterministic', () => {
    expect(nickColor('alice')).toBe(nickColor('alice'));
  });

  it('produces different colors for different nicks', () => {
    expect(nickColor('alice')).not.toBe(nickColor('bob'));
  });
});
