// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LEGACY_KEY = 'onyx:custom-css';
const RESOURCE_BEARING_CSS = [
  '@import url("https://tracker.example/import.css");',
  '.profile { background-image: url("https://tracker.example/pixel.png"); }',
].join('\n');

function installLegacyPayload(): void {
  localStorage.setItem(LEGACY_KEY, RESOURCE_BEARING_CSS);
  const style = document.createElement('style');
  style.id = LEGACY_KEY;
  style.textContent = RESOURCE_BEARING_CSS;
  document.head.appendChild(style);
}

describe('retired custom CSS', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.getElementById(LEGACY_KEY)?.remove();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.getElementById(LEGACY_KEY)?.remove();
  });

  it('deletes persisted resource-bearing CSS at module initialization', async () => {
    installLegacyPayload();

    await import('@/lib/customCssRemoval');

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(document.getElementById(LEGACY_KEY)).toBeNull();
  });

  it('does not expose custom CSS state or an injection action', async () => {
    installLegacyPayload();

    const { store } = await import('./store');
    const state: object = store.getState();

    expect('customCss' in state).toBe(false);
    expect('setCustomCss' in state).toBe(false);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(document.getElementById(LEGACY_KEY)).toBeNull();
  });

  it('fails soft when browser storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      removeItem: vi.fn(() => {
        throw new DOMException('blocked', 'SecurityError');
      }),
    });

    await expect(import('@/lib/customCssRemoval')).resolves.toHaveProperty('purgeLegacyCustomCss');
  });
});
