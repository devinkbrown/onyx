import { describe, expect, it } from 'vitest';
import {
  buildSessionResumeLine,
  parseIRCMessage,
  parseSessionTokenNote,
  selectSaslMechanism,
} from '@/lib/irc/parser';

describe('Orochi SASL mechanism selection', () => {
  it('prefers SCRAM-SHA-256 over PLAIN', () => {
    expect(selectSaslMechanism(['PLAIN', 'EXTERNAL', 'SCRAM-SHA-256'], { hasPassword: true }))
      .toBe('SCRAM-SHA-256');
  });

  it('falls back to PLAIN when SCRAM-SHA-256 is absent', () => {
    expect(selectSaslMechanism(['PLAIN', 'EXTERNAL'], { hasPassword: true }))
      .toBe('PLAIN');
  });

  it('does not auto-select EXTERNAL without a client certificate', () => {
    expect(selectSaslMechanism(['EXTERNAL'], { hasPassword: false }))
      .toBeNull();
  });

  it('selects EXTERNAL only when a client certificate is available', () => {
    expect(selectSaslMechanism(['EXTERNAL'], { hasPassword: false, hasClientCert: true }))
      .toBe('EXTERNAL');
  });
});

describe('Orochi SESSION TOKEN/RESUME', () => {
  it('parses NOTE SESSION TOKEN', () => {
    const msg = parseIRCMessage(':orochi.local NOTE SESSION TOKEN :012345abcdef');
    expect(parseSessionTokenNote(msg)).toBe('012345abcdef');
  });

  it('ignores non-token SESSION notes', () => {
    const msg = parseIRCMessage(':orochi.local NOTE SESSION RESUME :Session reclaimed');
    expect(parseSessionTokenNote(msg)).toBeNull();
  });

  it('formats SESSION RESUME', () => {
    expect(buildSessionResumeLine('012345abcdef')).toBe('SESSION RESUME 012345abcdef\r\n');
  });
});
