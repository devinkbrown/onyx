// SPDX-License-Identifier: AGPL-3.0-or-later
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

  it('falls back to navigator.languages when navigator.language is empty', () => {
    vi.stubGlobal('navigator', { language: '', languages: ['pt-BR', 'en-US'] });

    expect(preferredTranslationTarget()).toBe('pt');
  });

  it('defaults preferred translation target to English when no browser locale is exposed', () => {
    vi.stubGlobal('navigator', {});

    expect(preferredTranslationTarget()).toBe('en');
  });

  it('labels browser-local translator availability without external endpoints', () => {
    vi.stubGlobal('Translator', { availability: vi.fn() });

    expect(localTranslationReadiness('ja')).toEqual({
      state: 'available',
      label: 'Browser local translator available',
      detail: "Onyx can hand selected text to this browser's on-device translator for ja.",
    });
  });

  it('treats Translator.create alone as browser-local translator availability', () => {
    vi.stubGlobal('Translator', { create: vi.fn() });

    expect(localTranslationReadiness('ko')).toMatchObject({
      state: 'available',
      detail: expect.stringContaining('for ko'),
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
