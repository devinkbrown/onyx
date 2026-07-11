// SPDX-License-Identifier: AGPL-3.0-or-later
export type LocalTranslationReadiness = {
  state: 'available' | 'unavailable';
  label: string;
  detail: string;
};

type TranslationGlobal = typeof globalThis & {
  Translator?: {
    availability?: (options?: { sourceLanguage?: string; targetLanguage?: string }) => Promise<string> | string;
    create?: (options?: { sourceLanguage?: string; targetLanguage?: string }) => Promise<unknown> | unknown;
  };
};

export function preferredTranslationTarget(): string {
  const language = globalThis.navigator?.language || globalThis.navigator?.languages?.[0] || 'en';
  return language.split('-')[0]?.toLowerCase() || 'en';
}

export function localTranslationReadiness(targetLanguage = preferredTranslationTarget()): LocalTranslationReadiness {
  const translation = (globalThis as TranslationGlobal).Translator;
  if (translation?.availability || translation?.create) {
    return {
      state: 'available',
      label: 'Browser local translator available',
      detail: `Onyx can hand selected text to this browser's on-device translator for ${targetLanguage}.`,
    };
  }

  return {
    state: 'unavailable',
    label: 'No browser local translator detected',
    detail: 'Onyx will not send message text to an external translation endpoint. Copy text or transcript lines to a translator you choose.',
  };
}
