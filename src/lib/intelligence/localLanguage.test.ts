import { afterEach, describe, expect, it, vi } from 'vitest';

import { localTranslationReadiness, preferredTranslationTarget } from './localLanguage';

describe('local language tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects preferred translation target from the browser locale', () => {
    vi.stubGlobal('navigator', { language: 'de-DE', languages: ['de-DE'] });

    expect(preferredTranslationTarget()).toBe('de');
  });

  it('labels browser-local translator availability without external endpoints', () => {
    vi.stubGlobal('Translator', { availability: vi.fn() });

    expect(localTranslationReadiness('ja')).toEqual({
      state: 'available',
      label: 'Browser local translator available',
      detail: "Onyx can hand selected text to this browser's on-device translator for ja.",
    });
  });

  it('falls back to explicit no-external translation copy', () => {
    expect(localTranslationReadiness('en')).toMatchObject({
      state: 'unavailable',
      label: 'No browser local translator detected',
      detail: expect.stringContaining('will not send message text to an external translation endpoint'),
    });
  });
});
