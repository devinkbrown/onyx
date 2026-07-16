// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * translateMessage.ts — on-device, provenance-tagged translation surface.
 *
 * The browser Translator API (probed in localLanguage.ts) is hidden behind a tiny
 * `Translator` interface so the surrounding logic is model-independent and unit-testable
 * without a real model. Two pure helpers — `buildTranslationRequest` and
 * `applyTranslationResult` — do all the request/result shaping; `NoopTranslator` is an
 * identity implementation for tests, and `BrowserTranslatorAdapter` is the gated real
 * adapter (NOT unit-tested against the live API).
 *
 * Provenance: on-device translation is always tagged `'device'` scope — Onyx never hands
 * text to a hidden external endpoint. For an E2EE DM the decrypted `plaintext` is the only
 * translatable text; the result lives in transient signals and is NEVER persisted.
 *
 * SOLID IDIOMS: pure helpers stay pure; module-level createSignal for the target store;
 * never mutate — return new objects; setters return void.
 */

import { createSignal } from 'solid-js';

import type { ProvenanceScope } from '@/lib/intelligence/provenance';

/** On-device translation is computed locally, so its provenance is always the device scope. */
export const TRANSLATION_PROVENANCE: ProvenanceScope = 'device';

/** Keep local model requests and transient results within a predictable memory budget. */
export const MAX_TRANSLATION_SOURCE_LENGTH = 4_096;
export const MAX_TRANSLATION_RESULT_LENGTH = 8_192;

// ── the interface (model-independent) ────────────────────────────────────────

/** A translator hands one piece of text to a model and resolves the translated text. */
export interface Translator {
  translate(text: string, targetLang: string): Promise<string>;
}

/** Minimal translatable view record — model-independent by design. */
export interface TranslatableMessage {
  /** The display text to translate. For an E2EE DM pass the decrypted plaintext,
   *  never the ciphertext envelope. */
  text: string;
  /** Optional BCP-47-ish source language (e.g. `en`, `pt-BR`); enables passthrough. */
  lang?: string;
  /** Attached on-device translation, if any. */
  translation?: MessageTranslation;
}

/** A model-independent request describing what to translate. */
export interface TranslationRequest {
  sourceText: string;
  targetLang: string;
  /** true when translation is a no-op (empty text, or source language === target). */
  passthrough: boolean;
}

/** The translated text plus its provenance scope. */
export interface TranslationResult {
  translated: string;
  targetLang: string;
  provenance: ProvenanceScope;
}

/** Translation attached to a message — always device-scoped for on-device models. */
export type MessageTranslation = TranslationResult;

// ── language normalisation ───────────────────────────────────────────────────

/** Lowercase + reduce a locale tag to its primary subtag (`pt-BR` → `pt`). */
export function normalizeLang(lang: string): string {
  const primary = lang.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return primary;
}

/** Resolve the effective on-device target: a stored preference, else the browser fallback. */
export function resolveTranslationTarget(stored: string, fallback: string): string {
  const normalized = normalizeLang(stored);
  return normalized || normalizeLang(fallback) || 'en';
}

// ── pure request/result helpers ──────────────────────────────────────────────

/**
 * Build a model-independent translation request. Passthrough is flagged when the text is
 * empty/whitespace, or when a known source language already matches the target.
 */
export function buildTranslationRequest(
  message: TranslatableMessage,
  targetLang: string,
): TranslationRequest {
  const normalizedTarget = normalizeLang(targetLang);
  const sourceText = message.text.slice(0, MAX_TRANSLATION_SOURCE_LENGTH);
  const sourceLang = message.lang ? normalizeLang(message.lang) : undefined;
  const passthrough =
    sourceText.trim().length === 0 ||
    normalizedTarget.length === 0 ||
    (sourceLang !== undefined && sourceLang === normalizedTarget);
  return { sourceText, targetLang: normalizedTarget, passthrough };
}

/**
 * Return a NEW message with the translation attached (immutable). Provenance is forced to
 * the device scope — this helper only ever describes on-device output.
 */
export function applyTranslationResult(
  message: TranslatableMessage,
  translated: string,
  targetLang: string,
): TranslatableMessage {
  return {
    ...message,
    translation: {
      translated: translated.slice(0, MAX_TRANSLATION_RESULT_LENGTH),
      targetLang: normalizeLang(targetLang),
      provenance: TRANSLATION_PROVENANCE,
    },
  };
}

/**
 * Orchestrate a single translation through any `Translator`: build the request, short-circuit
 * on passthrough (returning the message unchanged), otherwise translate + apply. Model- and
 * transport-independent, so it is fully testable with `NoopTranslator` / fixed-string adapters.
 */
export async function translateMessage(
  translator: Translator,
  message: TranslatableMessage,
  targetLang: string,
): Promise<TranslatableMessage> {
  const request = buildTranslationRequest(message, targetLang);
  if (request.passthrough) return message;
  const translated = await translator.translate(request.sourceText, request.targetLang);
  return applyTranslationResult(message, translated, request.targetLang);
}

// ── translator implementations ───────────────────────────────────────────────

/** Identity translator — returns the source text unchanged. Used by tests and as a safe default. */
export class NoopTranslator implements Translator {
  translate(text: string): Promise<string> {
    return Promise.resolve(text);
  }
}

/** Shape of the (gated) browser Translator API instance produced by `Translator.create`. */
interface BrowserTranslatorInstance {
  translate(text: string): Promise<string> | string;
}

type TranslatorGlobal = typeof globalThis & {
  Translator?: {
    create?: (options: {
      sourceLanguage?: string;
      targetLanguage: string;
    }) => Promise<BrowserTranslatorInstance> | BrowserTranslatorInstance;
  };
};

/**
 * Gated adapter over the browser's on-device Translator API. Not unit-tested against the live
 * model; construction is cheap and `translate` throws a typed error when the API is absent so
 * callers can surface a clear "unavailable" state instead of silently failing.
 */
export class BrowserTranslatorAdapter implements Translator {
  private readonly sourceLanguage: string | undefined;

  constructor(options?: { sourceLanguage?: string }) {
    this.sourceLanguage = options?.sourceLanguage;
  }

  async translate(text: string, targetLang: string): Promise<string> {
    const api = (globalThis as TranslatorGlobal).Translator;
    if (!api?.create) {
      throw new Error('No on-device Translator API available in this browser.');
    }
    const instance = await api.create({
      sourceLanguage: this.sourceLanguage,
      targetLanguage: normalizeLang(targetLang),
    });
    const translated = await instance.translate(text.slice(0, MAX_TRANSLATION_SOURCE_LENGTH));
    return translated.slice(0, MAX_TRANSLATION_RESULT_LENGTH);
  }
}

/** Construct the default on-device translator used by the UI surfaces. */
export function createBrowserTranslator(options?: { sourceLanguage?: string }): Translator {
  return new BrowserTranslatorAdapter(options);
}

// ── target-language preference (module-level signal + localStorage) ───────────

/** Curated set of on-device translation targets surfaced in Preferences. */
export const TRANSLATION_TARGETS = [
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'it',
  'nl',
  'ja',
  'zh',
  'ko',
  'ru',
  'ar',
  'hi',
] as const;

export type TranslationTarget = (typeof TRANSLATION_TARGETS)[number];

const TARGET_LABELS: Record<TranslationTarget, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  nl: 'Dutch',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
} as const;

function isTranslationTarget(value: string): value is TranslationTarget {
  return (TRANSLATION_TARGETS as readonly string[]).includes(value);
}

/** Human-readable label for a target subtag, falling back to the uppercased code. */
export function languageLabel(code: string): string {
  const normalized = normalizeLang(code);
  return isTranslationTarget(normalized) ? TARGET_LABELS[normalized] : normalized.toUpperCase();
}

const TARGET_STORAGE_KEY = 'onyx:translation-target';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

/** Read the stored target (normalised). Empty string means "not chosen → use browser fallback". */
export function loadTranslationTarget(): string {
  if (!hasStorage()) return '';
  try {
    return normalizeLang(localStorage.getItem(TARGET_STORAGE_KEY) ?? '');
  } catch {
    return '';
  }
}

const [translationTarget, setTranslationTargetSignal] = createSignal<string>(loadTranslationTarget());

/** Accessor for the stored on-device translation target (empty = browser fallback). */
export { translationTarget };

/** Persist + set the target language (normalised to its primary subtag). */
export function setTranslationTarget(lang: string): void {
  const next = normalizeLang(lang);
  setTranslationTargetSignal(next);
  if (!hasStorage()) return;
  try {
    localStorage.setItem(TARGET_STORAGE_KEY, next);
  } catch {
    /* storage unavailable / quota — non-fatal */
  }
}
