export const EXTENSION_MANIFEST_VERSION = 1;

export const EXTENSION_PERMISSION_ALLOWLIST = [
  'channel:read-current',
  'command:send-approved',
] as const;

export type ExtensionPermission = (typeof EXTENSION_PERMISSION_ALLOWLIST)[number];

export type ExtensionManifest = {
  name: string;
  version: string;
  manifestVersion: typeof EXTENSION_MANIFEST_VERSION;
  permissions: ExtensionPermission[];
  entry: string;
};

const MAX_NAME_LENGTH = 80;
const MAX_VERSION_LENGTH = 32;
const MAX_ENTRY_LENGTH = 240;
const MAX_PERMISSION_ENTRIES = 8;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;
const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,2}(?:[-+][A-Za-z0-9._-]+)?$/;
const ENTRY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/._-]*\.(?:js|mjs)$/;

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isExtensionPermission(value: unknown): value is ExtensionPermission {
  return EXTENSION_PERMISSION_ALLOWLIST.includes(value as ExtensionPermission);
}

export function normalizeExtensionPermissions(value: unknown): ExtensionPermission[] | null {
  if (!Array.isArray(value) || value.length > MAX_PERMISSION_ENTRIES) return null;

  const seen = new Set<ExtensionPermission>();
  const permissions: ExtensionPermission[] = [];

  for (const entry of value) {
    if (!isExtensionPermission(entry)) return null;
    if (seen.has(entry)) continue;
    seen.add(entry);
    permissions.push(entry);
  }

  return permissions;
}

export function normalizeExtensionManifest(raw: unknown): ExtensionManifest | null {
  if (!isRecord(raw)) return null;

  const name = cleanString(raw.name, MAX_NAME_LENGTH);
  if (!name || !NAME_PATTERN.test(name)) return null;

  const version = cleanString(raw.version, MAX_VERSION_LENGTH);
  if (!version || !VERSION_PATTERN.test(version)) return null;

  const permissions = normalizeExtensionPermissions(raw.permissions);
  if (!permissions) return null;

  const entry = cleanString(raw.entry, MAX_ENTRY_LENGTH);
  if (!entry || !ENTRY_PATTERN.test(entry) || entry.includes('..') || entry.startsWith('/')) return null;

  return {
    name,
    version,
    manifestVersion: EXTENSION_MANIFEST_VERSION,
    permissions,
    entry,
  };
}

export function parseExtensionManifest(raw: string): ExtensionManifest | null {
  try {
    return normalizeExtensionManifest(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}
