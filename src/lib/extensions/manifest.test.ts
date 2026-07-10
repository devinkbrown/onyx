import { describe, expect, it } from 'vitest';

import {
  EXTENSION_MANIFEST_VERSION,
  EXTENSION_PERMISSION_ALLOWLIST,
  normalizeExtensionManifest,
  normalizeExtensionPermissions,
  parseExtensionManifest,
} from './manifest';

describe('extension manifest', () => {
  it('parses a valid minimal manifest with allowlisted permissions only', () => {
    const manifest = parseExtensionManifest(JSON.stringify({
      name: 'Build Helper',
      version: '1.2.3',
      permissions: ['channel:read-current', 'command:send-approved'],
      entry: 'worker.mjs',
    }));

    expect(manifest).toEqual({
      name: 'Build Helper',
      version: '1.2.3',
      manifestVersion: EXTENSION_MANIFEST_VERSION,
      permissions: ['channel:read-current', 'command:send-approved'],
      entry: 'worker.mjs',
    });
  });

  it('accepts an empty permission set by default', () => {
    expect(normalizeExtensionManifest({
      name: 'No Powers',
      version: '1',
      permissions: [],
      entry: 'extension.js',
    })).toMatchObject({
      name: 'No Powers',
      permissions: [],
    });
  });

  it('dedupes valid permissions without granting unknown capabilities', () => {
    expect(normalizeExtensionPermissions([
      'channel:read-current',
      'channel:read-current',
      'command:send-approved',
    ])).toEqual(['channel:read-current', 'command:send-approved']);
  });

  it('rejects unknown permissions', () => {
    expect(normalizeExtensionManifest({
      name: 'Too Powerful',
      version: '1.0.0',
      permissions: ['channel:read-current', 'storage:read-all'],
      entry: 'worker.mjs',
    })).toBeNull();

    expect(normalizeExtensionPermissions(['command:send-anything'])).toBeNull();
  });

  it('rejects malformed JSON and non-object manifests', () => {
    expect(parseExtensionManifest('{')).toBeNull();
    expect(parseExtensionManifest('[]')).toBeNull();
    expect(parseExtensionManifest('"manifest"')).toBeNull();
  });

  it('rejects malformed manifest fields', () => {
    const valid = {
      name: 'Build Helper',
      version: '1.0.0',
      permissions: ['channel:read-current'],
      entry: 'worker.mjs',
    };

    expect(normalizeExtensionManifest({ ...valid, name: '' })).toBeNull();
    expect(normalizeExtensionManifest({ ...valid, name: '../Bad' })).toBeNull();
    expect(normalizeExtensionManifest({ ...valid, version: 'latest' })).toBeNull();
    expect(normalizeExtensionManifest({ ...valid, permissions: 'channel:read-current' })).toBeNull();
    expect(normalizeExtensionManifest({ ...valid, entry: '../worker.mjs' })).toBeNull();
    expect(normalizeExtensionManifest({ ...valid, entry: '/worker.mjs' })).toBeNull();
    expect(normalizeExtensionManifest({ ...valid, entry: 'worker.ts' })).toBeNull();
  });

  it('exports the exact deny-by-default permission allowlist', () => {
    expect(EXTENSION_PERMISSION_ALLOWLIST).toEqual([
      'channel:read-current',
      'command:send-approved',
    ]);
  });
});
