// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddToHomeScreenRuntime } from './AddToHomeScreenRuntime';
import {
  A2HS_TITLE,
  A2HS_VISIT_KEY,
  peekCapturedInstallPrompt,
  resetAddToHomeScreenState,
} from './addToHomeScreen';

describe('AddToHomeScreenRuntime', () => {
  beforeEach(() => {
    resetAddToHomeScreenState();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    resetAddToHomeScreenState();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('captures beforeinstallprompt without painting install UI', () => {
    render(() => <AddToHomeScreenRuntime />);

    const prompt = vi.fn(async () => {});
    const event = new Event('beforeinstallprompt');
    Object.assign(event, { prompt, preventDefault: vi.fn() });
    window.dispatchEvent(event);

    expect(peekCapturedInstallPrompt()).toBe(event);
    expect(prompt).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/Add to Home Screen|install the app/i);
    expect(document.body.textContent).not.toContain(A2HS_TITLE);
    expect(localStorage.getItem(A2HS_VISIT_KEY)).toBe('1');
  });
});
