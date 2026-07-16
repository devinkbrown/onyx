// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pickScreenColor, supportsEyeDropper } from './eyeDropper';

describe('EyeDropper capability helper', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unsupported without constructing or opening anything', async () => {
    vi.stubGlobal('EyeDropper', undefined);

    expect(supportsEyeDropper()).toBe(false);
    await expect(pickScreenColor()).resolves.toMatchObject({ state: 'unsupported' });
  });

  it('feature-detects without prompting and opens only when explicitly invoked', async () => {
    const open = vi.fn().mockResolvedValue({ sRGBHex: '#12aBcD' });
    let constructions = 0;
    class EyeDropperMock {
      constructor() {
        constructions += 1;
      }

      open = open;
    }
    vi.stubGlobal('EyeDropper', EyeDropperMock);

    expect(supportsEyeDropper()).toBe(true);
    expect(constructions).toBe(0);
    expect(open).not.toHaveBeenCalled();

    await expect(pickScreenColor()).resolves.toEqual({
      state: 'selected',
      sRGBHex: '#12aBcD',
    });
    expect(constructions).toBe(1);
    expect(open).toHaveBeenCalledOnce();
  });

  it('returns malformed API output for validation at the existing colour boundary', async () => {
    class EyeDropperMock {
      open = vi.fn().mockResolvedValue({ sRGBHex: 'not-a-colour' });
    }
    vi.stubGlobal('EyeDropper', EyeDropperMock);

    await expect(pickScreenColor()).resolves.toEqual({
      state: 'selected',
      sRGBHex: 'not-a-colour',
    });
  });

  it('treats user cancellation as a neutral result', async () => {
    class EyeDropperMock {
      open = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    }
    vi.stubGlobal('EyeDropper', EyeDropperMock);

    await expect(pickScreenColor()).resolves.toMatchObject({ state: 'cancelled' });
  });

  it('reports non-cancellation rejection without throwing', async () => {
    class EyeDropperMock {
      open = vi.fn().mockRejectedValue(new DOMException('permission denied', 'NotAllowedError'));
    }
    vi.stubGlobal('EyeDropper', EyeDropperMock);

    await expect(pickScreenColor()).resolves.toMatchObject({ state: 'failed' });
  });
});
