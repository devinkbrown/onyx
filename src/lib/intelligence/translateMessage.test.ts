// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BrowserTranslatorAdapter,
  MAX_TRANSLATION_RESULT_LENGTH,
  MAX_TRANSLATION_SOURCE_LENGTH,
  NoopTranslator,
  TRANSLATION_PROVENANCE,
  TRANSLATION_TARGETS,
  applyTranslationResult,
  buildTranslationRequest,
  createBrowserTranslator,
  languageLabel,
  loadTranslationTarget,
  normalizeLang,
  resolveTranslationTarget,
  setTranslationTarget,
  translateMessage,
  translationTarget,
  type TranslatableMessage,
  type Translator,
} from './translateMessage';

/** A fixed-string adapter — deterministic, model-free, records its inputs. */
function fixedTranslator(map: Record<string, string>): Translator & { calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    async translate(text: string, targetLang: string): Promise<string> {
      calls.push([text, targetLang]);
      return map[text] ?? `${text}::${targetLang}`;
    },
  };
}

describe('normalizeLang', () => {
  it('lowercases and reduces to the primary subtag', () => {
    expect(normalizeLang('pt-BR')).toBe('pt');
    expect(normalizeLang('EN_us')).toBe('en');
    expect(normalizeLang('  Ja  ')).toBe('ja');
  });

  it('handles separator-only and multi-part tags as fail-closed primary subtags', () => {
    expect(normalizeLang('-US')).toBe('');
    expect(normalizeLang('zh-Hant-TW')).toBe('zh');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeLang('')).toBe('');
    expect(normalizeLang('   ')).toBe('');
  });
});

describe('resolveTranslationTarget', () => {
  it('prefers the stored target', () => {
    expect(resolveTranslationTarget('fr-FR', 'de')).toBe('fr');
  });

  it('falls back to the browser value when nothing is stored', () => {
    expect(resolveTranslationTarget('', 'de-DE')).toBe('de');
  });

  it('defaults to en when neither is usable', () => {
    expect(resolveTranslationTarget('', '')).toBe('en');
  });

  it('surfaces a non-curated browser fallback verbatim (so the select can show it)', () => {
    // sv is a valid on-device target but not in the curated list; the panel adds it as an
    // extra option so the shown selection matches what captions translate to.
    const resolved = resolveTranslationTarget('', 'sv-SE');
    expect(resolved).toBe('sv');
    expect((TRANSLATION_TARGETS as readonly string[]).includes(resolved)).toBe(false);
  });
});

describe('buildTranslationRequest', () => {
  it('builds a normal request when text and target differ from source', () => {
    const request = buildTranslationRequest({ text: 'hola', lang: 'es' }, 'EN-us');
    expect(request).toEqual({ sourceText: 'hola', targetLang: 'en', passthrough: false });
  });

  it('flags passthrough for empty / whitespace text', () => {
    expect(buildTranslationRequest({ text: '' }, 'ja').passthrough).toBe(true);
    expect(buildTranslationRequest({ text: '   ' }, 'ja').passthrough).toBe(true);
  });

  it('flags passthrough for an empty target', () => {
    expect(buildTranslationRequest({ text: 'hello' }, '').passthrough).toBe(true);
  });

  it('flags passthrough when source language already matches the target', () => {
    expect(buildTranslationRequest({ text: 'hello', lang: 'en-GB' }, 'en').passthrough).toBe(true);
  });

  it('does not passthrough when source language is unknown', () => {
    expect(buildTranslationRequest({ text: 'hello' }, 'ja').passthrough).toBe(false);
  });

  it('preserves source whitespace exactly while still using trimmed text for passthrough', () => {
    const request = buildTranslationRequest({ text: '  hola  ', lang: 'es-MX' }, 'EN-US');

    expect(request).toEqual({ sourceText: '  hola  ', targetLang: 'en', passthrough: false });
  });

  it('bounds source text before it can reach the local model', () => {
    const source = 'a'.repeat(MAX_TRANSLATION_SOURCE_LENGTH + 128);

    const request = buildTranslationRequest({ text: source }, 'ja');

    expect(request.sourceText).toHaveLength(MAX_TRANSLATION_SOURCE_LENGTH);
    expect(request.sourceText).toBe(source.slice(0, MAX_TRANSLATION_SOURCE_LENGTH));
  });
});

describe('applyTranslationResult', () => {
  it('returns a new message tagged with device provenance', () => {
    const original: TranslatableMessage = { text: 'hola' };
    const next = applyTranslationResult(original, 'hello', 'EN-us');

    expect(next).not.toBe(original);
    expect(original.translation).toBeUndefined();
    expect(next.translation).toEqual({
      translated: 'hello',
      targetLang: 'en',
      provenance: TRANSLATION_PROVENANCE,
    });
    expect(TRANSLATION_PROVENANCE).toBe('device');
  });

  it('preserves the original source text and language', () => {
    const next = applyTranslationResult({ text: 'hola', lang: 'es' }, 'hello', 'en');
    expect(next.text).toBe('hola');
    expect(next.lang).toBe('es');
  });

  it('bounds transient model output without mutating the source message', () => {
    const translated = 'b'.repeat(MAX_TRANSLATION_RESULT_LENGTH + 128);
    const original: TranslatableMessage = { text: 'hola', lang: 'es' };

    const next = applyTranslationResult(original, translated, 'en');

    expect(next.translation?.translated).toHaveLength(MAX_TRANSLATION_RESULT_LENGTH);
    expect(next.translation?.translated).toBe(translated.slice(0, MAX_TRANSLATION_RESULT_LENGTH));
    expect(original.translation).toBeUndefined();
  });
});

describe('translateMessage orchestration', () => {
  it('passes source text through identity NoopTranslator and tags provenance', async () => {
    const result = await translateMessage(new NoopTranslator(), { text: 'hello' }, 'ja');
    expect(result.translation).toEqual({
      translated: 'hello',
      targetLang: 'ja',
      provenance: 'device',
    });
  });

  it('translates via a fixed-string adapter with the normalised target', async () => {
    const translator = fixedTranslator({ hola: 'hello' });
    const result = await translateMessage(translator, { text: 'hola' }, 'EN-us');

    expect(result.translation?.translated).toBe('hello');
    expect(result.translation?.targetLang).toBe('en');
    expect(translator.calls).toEqual([['hola', 'en']]);
  });

  it('bounds both the local model request and its transient result', async () => {
    const source = 'a'.repeat(MAX_TRANSLATION_SOURCE_LENGTH + 64);
    const translated = 'b'.repeat(MAX_TRANSLATION_RESULT_LENGTH + 64);
    const translator: Translator & { calls: string[] } = {
      calls: [],
      translate(text: string): Promise<string> {
        this.calls.push(text);
        return Promise.resolve(translated);
      },
    };

    const result = await translateMessage(translator, { text: source }, 'fr');

    expect(translator.calls).toEqual([source.slice(0, MAX_TRANSLATION_SOURCE_LENGTH)]);
    expect(result.translation?.translated).toBe(translated.slice(0, MAX_TRANSLATION_RESULT_LENGTH));
    expect(result.text).toBe(source);
  });

  it('returns the original message unchanged on passthrough (never calls the model)', async () => {
    const translator = fixedTranslator({});
    const original: TranslatableMessage = { text: 'hello', lang: 'en' };
    const result = await translateMessage(translator, original, 'en');

    expect(result).toBe(original);
    expect(result.translation).toBeUndefined();
    expect(translator.calls).toHaveLength(0);
  });

  it('does not persist E2EE plaintext into the source message identity', async () => {
    // The helper only reads message.text and returns a NEW object; the caller passes the
    // transient decrypted plaintext and holds the result in a signal, never the vault.
    const translator = fixedTranslator({ secret: 'translated-secret' });
    const original: TranslatableMessage = { text: 'secret' };
    const result = await translateMessage(translator, original, 'fr');

    expect(result).not.toBe(original);
    expect(original.translation).toBeUndefined();
    expect(result.translation?.translated).toBe('translated-secret');
  });
});

describe('languageLabel', () => {
  it('labels known curated targets', () => {
    expect(languageLabel('ja')).toBe('Japanese');
    expect(languageLabel('pt-BR')).toBe('Portuguese');
  });

  it('uppercases unknown codes', () => {
    expect(languageLabel('xx')).toBe('XX');
  });

  it('uses an empty fallback label for separator-only codes', () => {
    expect(languageLabel('-US')).toBe('');
  });

  it('covers every curated target', () => {
    for (const code of TRANSLATION_TARGETS) {
      expect(languageLabel(code)).not.toBe(code.toUpperCase());
    }
  });
});

describe('translation target preference store', () => {
  beforeEach(() => {
    localStorage.clear();
    setTranslationTarget('');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('persists and normalises the chosen target', () => {
    setTranslationTarget('Fr-FR');
    expect(translationTarget()).toBe('fr');
    expect(localStorage.getItem('onyx:translation-target')).toBe('fr');
    expect(loadTranslationTarget()).toBe('fr');
  });

  it('loads empty string when nothing is stored', () => {
    localStorage.clear();
    expect(loadTranslationTarget()).toBe('');
  });

  it('fails closed when localStorage reads throw', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(loadTranslationTarget()).toBe('');

    getItem.mockRestore();
  });

  it('updates the signal even when localStorage writes throw', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    setTranslationTarget('De-DE');

    expect(translationTarget()).toBe('de');

    setItem.mockRestore();
  });
});

describe('BrowserTranslatorAdapter (gated, no live model)', () => {
  afterEach(() => {
    delete (globalThis as { Translator?: unknown }).Translator;
  });

  it('throws a typed error when the Translator API is absent', async () => {
    const adapter = new BrowserTranslatorAdapter();
    await expect(adapter.translate('hello', 'ja')).rejects.toThrow(/Translator API/);
  });

  it('delegates to a stubbed Translator.create instance with the normalised target', async () => {
    const created: Array<{ sourceLanguage?: string; targetLanguage: string }> = [];
    (globalThis as { Translator?: unknown }).Translator = {
      create(options: { sourceLanguage?: string; targetLanguage: string }) {
        created.push(options);
        return { translate: (text: string) => `${text}!` };
      },
    };
    const adapter = createBrowserTranslator({ sourceLanguage: 'en' });
    const out = await adapter.translate('hello', 'JA-jp');

    expect(out).toBe('hello!');
    expect(created).toEqual([{ sourceLanguage: 'en', targetLanguage: 'ja' }]);
  });

  it('bounds direct browser-adapter requests and responses', async () => {
    const received: string[] = [];
    const source = 'a'.repeat(MAX_TRANSLATION_SOURCE_LENGTH + 32);
    const translated = 'b'.repeat(MAX_TRANSLATION_RESULT_LENGTH + 32);
    (globalThis as { Translator?: unknown }).Translator = {
      create() {
        return {
          translate(text: string) {
            received.push(text);
            return translated;
          },
        };
      },
    };

    const out = await createBrowserTranslator().translate(source, 'fr');

    expect(received).toEqual([source.slice(0, MAX_TRANSLATION_SOURCE_LENGTH)]);
    expect(out).toBe(translated.slice(0, MAX_TRANSLATION_RESULT_LENGTH));
  });
});
