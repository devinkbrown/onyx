import { describe, expect, it } from 'vitest';

import { BRIDGE_STATUS_PROP, parseBridgeStatus } from './bridgeStatus';

describe('parseBridgeStatus', () => {
  it('uses the assumed ocean.bridge PROP name', () => {
    expect(BRIDGE_STATUS_PROP).toBe('ocean.bridge');
  });

  it('parses the assumed key-value bridge payload', () => {
    expect(parseBridgeStatus('platform=discord state=up lastSeen=2026-07-10T12:00:00Z')).toEqual({
      bridged: true,
      platform: 'discord',
      state: 'up',
      lastSeen: '2026-07-10T12:00:00Z',
    });
  });

  it('accepts JSON with compatible field names and ignores unknown fields', () => {
    expect(parseBridgeStatus('{"platform":"matrix","health":"partial","ignored":"field"}')).toEqual({
      bridged: true,
      platform: 'matrix',
      state: 'degraded',
    });
  });

  it('normalizes IRC and down-state aliases', () => {
    expect(parseBridgeStatus('target=irc status=offline')).toEqual({
      bridged: true,
      platform: 'irc',
      state: 'down',
    });
  });

  it('fails soft for malformed non-empty payloads', () => {
    expect(parseBridgeStatus('bridge status unknown')).toEqual({
      bridged: true,
      platform: 'unknown',
      state: 'degraded',
    });
  });

  it('treats an empty payload as no advertised bridge', () => {
    expect(parseBridgeStatus('  ')).toEqual({
      bridged: false,
      platform: 'unknown',
      state: 'down',
    });
  });
});
