import { describe, expect, it } from 'vitest';
import { parseVaultExport } from '@/lib/vault/historyVault';
import { normalizeIrcChannelTarget, parseIrcLog } from './ircLogImport';

describe('normalizeIrcChannelTarget', () => {
  it('prefixes with # and lowercases', () => {
    expect(normalizeIrcChannelTarget('Dev')).toBe('#dev');
  });

  it('strips leading hashes and illegal characters', () => {
    expect(normalizeIrcChannelTarget('##Ops Room!')).toBe('#ops-room');
  });

  it('collapses whitespace and repeated dashes', () => {
    expect(normalizeIrcChannelTarget('  Build   Logs  ')).toBe('#build-logs');
  });

  it('returns an empty target for a missing name', () => {
    expect(normalizeIrcChannelTarget('   ')).toBe('');
  });
});

describe('parseIrcLog — supported formats', () => {
  it('parses WeeChat tab-separated full-date messages', () => {
    const result = parseIrcLog('2025-01-02 14:05:33\t<alice>\thello', { channel: '#Dev' });
    expect(result).not.toBeNull();
    const msg = result!.snapshot.targets[0]!.messages[0]!;
    expect(msg).toMatchObject({ from: 'alice', text: 'hello', type: 'msg', target: '#dev' });
    expect(msg.time.toISOString()).toBe('2025-01-02T14:05:33.000Z');
  });

  it('parses WeeChat pipe full-date messages', () => {
    const result = parseIrcLog('2025-01-02 14:05:33  bob | hello there', { channel: 'Dev' });
    const msg = result!.snapshot.targets[0]!.messages[0]!;
    expect(msg.from).toBe('bob');
    expect(msg.text).toBe('hello there');
    expect(result!.summary.oldest).toBe('2025-01-02T14:05:33.000Z');
  });

  it('parses irssi time-only chat with a supplied base date', () => {
    const result = parseIrcLog('14:05 <@carol> hi', { channel: '#dev', baseDate: '2025-01-02T00:00:00Z' });
    const msg = result!.snapshot.targets[0]!.messages[0]!;
    expect(msg.from).toBe('carol');
    expect(msg.time.toISOString()).toBe('2025-01-02T14:05:00.000Z');
  });

  it('parses mIRC bracketed messages', () => {
    const result = parseIrcLog('[14:05:33] <dave> mIRC line', { channel: '#dev', baseDate: '2025-01-02' });
    const msg = result!.snapshot.targets[0]!.messages[0]!;
    expect(msg.from).toBe('dave');
    expect(msg.text).toBe('mIRC line');
    expect(msg.time.toISOString()).toBe('2025-01-02T14:05:33.000Z');
  });

  it('parses generic HH:MM:SS chat messages', () => {
    const result = parseIrcLog('14:05:09 <erin> generic', { channel: '#dev', baseDate: '2025-01-02' });
    const msg = result!.snapshot.targets[0]!.messages[0]!;
    expect(msg.from).toBe('erin');
    expect(msg.text).toBe('generic');
    expect(msg.time.toISOString()).toBe('2025-01-02T14:05:09.000Z');
  });
});

describe('parseIrcLog — action and system mapping', () => {
  it('maps generic star actions to action messages', () => {
    const result = parseIrcLog('14:05 * alice waves', { channel: '#dev', baseDate: '2025-01-02' });
    const msg = result!.snapshot.targets[0]!.messages[0]!;
    expect(msg).toMatchObject({ from: 'alice', text: 'waves', type: 'action' });
  });

  it('maps bare mIRC actions using the running timestamp', () => {
    const result = parseIrcLog('[14:05:33] <alice> hi\n* bob waves', { channel: '#dev', baseDate: '2025-01-02' });
    const msgs = result!.snapshot.targets[0]!.messages;
    expect(msgs[1]).toMatchObject({ from: 'bob', text: 'waves', type: 'action' });
    expect(msgs[1]!.time.toISOString()).toBe('2025-01-02T14:05:33.001Z');
  });

  it('maps CTCP ACTION payloads to action messages', () => {
    const result = parseIrcLog('14:05 <alice> \x01ACTION dances\x01', { channel: '#dev', baseDate: '2025-01-02' });
    const msg = result!.snapshot.targets[0]!.messages[0]!;
    expect(msg).toMatchObject({ from: 'alice', text: 'dances', type: 'action' });
  });

  it('skips join notices by default', () => {
    const result = parseIrcLog('14:05 -!- alice has joined #dev', { channel: '#dev', baseDate: '2025-01-02' });
    expect(result!.summary.messages).toBe(0);
    expect(result!.summary.skipped).toBe(1);
    expect(result!.snapshot.targets).toHaveLength(0);
  });

  it('includes join notices when includeSystem is set', () => {
    const result = parseIrcLog('14:05 -!- alice has joined #dev', {
      channel: '#dev',
      baseDate: '2025-01-02',
      includeSystem: true,
    });
    const msg = result!.snapshot.targets[0]!.messages[0]!;
    expect(msg).toMatchObject({ from: 'alice', type: 'join', text: 'alice has joined #dev' });
  });

  it('maps part, quit, nick, mode, and topic notices when included', () => {
    const result = parseIrcLog(
      [
        '14:05 -!- alice has left #dev',
        '14:06 -!- bob has quit [Quit: bye]',
        '14:07 -!- carol is now known as caroline',
        '14:08 -!- mode/#dev [+o alice] by oper',
        '14:09 -!- Topic for #dev: Ship it',
      ].join('\n'),
      { channel: '#dev', baseDate: '2025-01-02', includeSystem: true },
    );
    expect(result!.snapshot.targets[0]!.messages.map((m) => m.type)).toEqual(['part', 'quit', 'nick', 'mode', 'topic']);
    expect(result!.summary.skipped).toBe(0);
  });

  it('strips common IRC status prefixes from nicks', () => {
    const result = parseIrcLog('14:05 <~&@%+alice> prefixed', { channel: '#dev', baseDate: '2025-01-02' });
    expect(result!.snapshot.targets[0]!.messages[0]!.from).toBe('alice');
  });
});

describe('parseIrcLog — date handling', () => {
  it('uses full-date lines to set the running date for following time-only lines', () => {
    const result = parseIrcLog('2025-01-02 23:59:59\t<alice>\tlate\n00:00 <bob> next day', { channel: '#dev' });
    const msgs = result!.snapshot.targets[0]!.messages;
    expect(msgs[0]!.time.toISOString()).toBe('2025-01-02T23:59:59.000Z');
    expect(msgs[1]!.time.toISOString()).toBe('2025-01-03T00:00:00.000Z');
  });

  it('advances the day on midnight rollover in time-only logs', () => {
    const result = parseIrcLog('23:59 <alice> late\n00:01 <bob> early', { channel: '#dev', baseDate: '2025-01-02' });
    const msgs = result!.snapshot.targets[0]!.messages;
    expect(msgs[0]!.time.toISOString()).toBe('2025-01-02T23:59:00.000Z');
    expect(msgs[1]!.time.toISOString()).toBe('2025-01-03T00:01:00.000Z');
  });

  it('falls back to a synthetic date when no baseDate is supplied for time-only logs', () => {
    const result = parseIrcLog('14:05 <alice> old export', { channel: '#dev' });
    expect(result!.snapshot.targets[0]!.messages[0]!.time.toISOString()).toBe('2000-01-01T14:05:00.000Z');
  });

  it('ignores an invalid baseDate and uses the synthetic date', () => {
    const result = parseIrcLog('14:05 <alice> old export', { channel: '#dev', baseDate: 'not-a-date' });
    expect(result!.snapshot.targets[0]!.messages[0]!.time.toISOString()).toBe('2000-01-01T14:05:00.000Z');
  });
});

describe('parseIrcLog — filtering and bounds', () => {
  it('filters messages older than sinceDays relative to now', () => {
    const recent = new Date();
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const raw = [
      `${old.toISOString().slice(0, 10)} 00:00:00\t<alice>\told`,
      `${recent.toISOString().slice(0, 10)} 00:00:00\t<bob>\tfresh`,
    ].join('\n');
    const result = parseIrcLog(raw, { channel: '#dev', sinceDays: 7 });
    expect(result!.summary.messages).toBe(1);
    expect(result!.summary.skipped).toBe(1);
    expect(result!.snapshot.targets[0]!.messages[0]!.text).toBe('fresh');
  });

  it('caps per-channel messages to keepPerChannel, keeping the newest', () => {
    const raw = Array.from({ length: 5 }, (_, i) => `00:0${i} <alice> msg ${i}`).join('\n');
    const result = parseIrcLog(raw, { channel: '#dev', baseDate: '2025-01-02', keepPerChannel: 2 });
    const kept = result!.snapshot.targets[0]!.messages;
    expect(kept.map((m) => m.text)).toEqual(['msg 3', 'msg 4']);
    expect(result!.summary.droppedOverCap).toBe(3);
  });

  it('caps keepPerChannel at the vault maximum', () => {
    const raw = Array.from({ length: 405 }, (_, i) => `00:${String(i % 60).padStart(2, '0')} <alice> m${i}`).join('\n');
    const result = parseIrcLog(raw, { channel: '#dev', baseDate: '2025-01-02', keepPerChannel: 10_000 });
    expect(result!.snapshot.targets[0]!.messages).toHaveLength(400);
    expect(result!.summary.droppedOverCap).toBe(5);
  });

  it('falls back to the default cap for non-finite keepPerChannel', () => {
    const result = parseIrcLog('14:05 <alice> kept', { channel: '#dev', baseDate: '2025-01-02', keepPerChannel: Number.NaN });
    expect(result!.summary.messages).toBe(1);
    expect(result!.summary.droppedOverCap).toBe(0);
  });

  it('ignores non-finite sinceDays instead of filtering everything', () => {
    const result = parseIrcLog('2025-01-02 14:05:33\t<alice>\tkept', { channel: '#dev', sinceDays: Infinity });
    expect(result!.summary.messages).toBe(1);
  });

  it('counts unparseable lines as skipped', () => {
    const result = parseIrcLog('not a log line\n14:05 <alice> ok', { channel: '#dev', baseDate: '2025-01-02' });
    expect(result!.summary.messages).toBe(1);
    expect(result!.summary.skipped).toBe(1);
  });
});

describe('parseIrcLog — robustness and vault interop', () => {
  it('returns null for empty input or a missing channel', () => {
    expect(parseIrcLog('', { channel: '#dev' })).toBeNull();
    expect(parseIrcLog('   ', { channel: '#dev' })).toBeNull();
    expect(parseIrcLog('14:05 <alice> hi', { channel: '' })).toBeNull();
    expect(parseIrcLog('14:05 <alice> hi', { channel: '!!!' })).toBeNull();
  });

  it('produces collision-safe irclog ids', () => {
    const result = parseIrcLog('14:05 <alice> one\n14:05 <alice> two', { channel: '#dev', baseDate: '2025-01-02' });
    const ids = result!.snapshot.targets[0]!.messages.map((m) => m.id);
    expect(ids.every((id) => id.startsWith('irclog:'))).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });

  it('sorts messages chronologically after compaction', () => {
    const result = parseIrcLog('2025-01-02 14:06:00\t<alice>\tlater\n2025-01-02 14:05:00\t<bob>\tearlier', { channel: '#dev' });
    expect(result!.snapshot.targets[0]!.messages.map((m) => m.text)).toEqual(['earlier', 'later']);
  });

  it('produces a snapshot that survives the vault validator round-trip', () => {
    const result = parseIrcLog('2025-01-02 14:05:33\t<alice>\t<img src=x onerror=alert(1)>', { channel: '#Dev' });
    const revived = parseVaultExport(result!.snapshot);
    expect(revived).not.toBeNull();
    expect(revived!.targets[0]!.target).toBe('#dev');
    expect(revived!.targets[0]!.messages[0]!.text).toBe('<img src=x onerror=alert(1)>');
  });
});
