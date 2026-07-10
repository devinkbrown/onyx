export const BRIDGE_STATUS_PROP = 'ocean.bridge';

export type BridgePlatform = 'discord' | 'matrix' | 'irc' | 'unknown';
export type BridgeState = 'up' | 'down' | 'degraded';

export interface BridgeStatus {
  bridged: boolean;
  platform: BridgePlatform;
  state: BridgeState;
  lastSeen?: string;
}

const NO_BRIDGE: BridgeStatus = {
  bridged: false,
  platform: 'unknown',
  state: 'down',
};

type FieldMap = Record<string, string>;

function cleanKey(key: string): string {
  return key.trim().toLowerCase().replace(/[-_]/g, '');
}

function cleanValue(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const clean = String(value).trim();
  return clean ? clean : null;
}

function normalizePlatform(value: string | null): BridgePlatform {
  const clean = value?.trim().toLowerCase() ?? '';
  if (clean === 'discord' || clean === 'matrix' || clean === 'irc') return clean;
  return 'unknown';
}

function normalizeState(value: string | null): BridgeState {
  const clean = value?.trim().toLowerCase() ?? '';
  if (clean === 'up' || clean === 'ok' || clean === 'online' || clean === 'healthy') return 'up';
  if (clean === 'down' || clean === 'offline' || clean === 'error' || clean === 'failed') return 'down';
  if (clean === 'degraded' || clean === 'partial' || clean === 'warning' || clean === 'warn') return 'degraded';
  return 'degraded';
}

function fieldsFromJson(payload: string): FieldMap | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const fields: FieldMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const clean = cleanValue(value);
      if (clean) fields[cleanKey(key)] = clean;
    }
    return fields;
  } catch {
    return null;
  }
}

function fieldsFromTokens(payload: string): FieldMap {
  const fields: FieldMap = {};
  for (const part of payload.split(/[;,\s]+/)) {
    const token = part.trim();
    if (!token) continue;
    const separator = token.includes('=') ? '=' : token.includes(':') ? ':' : null;
    if (!separator) continue;
    const splitAt = token.indexOf(separator);
    const key = token.slice(0, splitAt);
    const value = token.slice(splitAt + 1);
    const clean = cleanValue(value);
    if (clean) fields[cleanKey(key)] = clean;
  }
  return fields;
}

function field(fields: FieldMap, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = fields[cleanKey(key)];
    if (value) return value;
  }
  return null;
}

export function parseBridgeStatus(payload: string): BridgeStatus {
  const trimmed = payload.trim();
  if (!trimmed) return { ...NO_BRIDGE };

  // Assumed server wire shape for the channel PROP:
  //   PROP #room ocean.bridge :platform=discord state=up lastSeen=2026-07-10T12:00:00Z
  // JSON with the same field names is accepted for forward compatibility.
  const fields = fieldsFromJson(trimmed) ?? fieldsFromTokens(trimmed);
  const platform = normalizePlatform(field(fields, ['platform', 'target', 'network', 'type']));
  const state = normalizeState(field(fields, ['state', 'status', 'health']));
  const lastSeen = field(fields, ['lastSeen', 'seen', 'updatedAt', 'updated']);

  return {
    bridged: true,
    platform,
    state,
    ...(lastSeen ? { lastSeen } : {}),
  };
}
