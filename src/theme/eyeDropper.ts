// SPDX-License-Identifier: AGPL-3.0-or-later

export type EyeDropperSelectionResult =
  | { state: 'selected'; sRGBHex: unknown }
  | { state: 'cancelled'; detail: string }
  | { state: 'unsupported'; detail: string }
  | { state: 'failed'; detail: string };

type EyeDropperInstance = {
  open: () => Promise<unknown>;
};

type EyeDropperConstructor = new () => EyeDropperInstance;

function eyeDropperConstructor(): EyeDropperConstructor | null {
  if (typeof globalThis === 'undefined') return null;
  try {
    const candidate = (globalThis as { EyeDropper?: unknown }).EyeDropper;
    return typeof candidate === 'function'
      ? candidate as EyeDropperConstructor
      : null;
  } catch {
    return null;
  }
}

/** Feature detection only: this never constructs an EyeDropper or opens a prompt. */
export function supportsEyeDropper(): boolean {
  return eyeDropperConstructor() !== null;
}

function isUserCancellation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

/**
 * Invoke directly from a user gesture. `open()` is called before the first async suspension;
 * the returned value remains untrusted so the caller can pass it through its colour boundary.
 */
export async function pickScreenColor(): Promise<EyeDropperSelectionResult> {
  const EyeDropperApi = eyeDropperConstructor();
  if (!EyeDropperApi) {
    return {
      state: 'unsupported',
      detail: 'Screen colour sampling is unavailable. Use the accent colour control instead.',
    };
  }

  let result: unknown;
  try {
    const eyeDropper = new EyeDropperApi();
    // Keep this as the first awaited operation so the browser sees the originating click.
    result = await eyeDropper.open();
  } catch (error) {
    if (isUserCancellation(error)) {
      return {
        state: 'cancelled',
        detail: 'Screen colour sampling cancelled. The accent seed was not changed.',
      };
    }
    return {
      state: 'failed',
      detail: 'Screen colour sampling failed. Use the accent colour control instead.',
    };
  }

  const sRGBHex = typeof result === 'object' && result !== null && 'sRGBHex' in result
    ? result.sRGBHex
    : undefined;
  return { state: 'selected', sRGBHex };
}
