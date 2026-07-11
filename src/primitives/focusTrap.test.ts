// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import { focusFirst, trapFocus } from './focusTrap';

afterEach(() => {
  document.body.replaceChildren();
});

function tabEvent(shiftKey = false) {
  return new KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
    cancelable: true,
    shiftKey,
  });
}

describe('focusTrap pure helpers', () => {
  it('focuses the first enabled tabbable control and skips disabled controls', () => {
    const panel = document.createElement('section');
    panel.tabIndex = -1;
    const disabled = document.createElement('button');
    disabled.disabled = true;
    const first = document.createElement('button');
    first.textContent = 'First';
    panel.append(disabled, first);
    document.body.append(panel);

    focusFirst(panel);

    expect(document.activeElement).toBe(first);
  });

  it('focuses the panel itself when no tabbable controls exist', () => {
    const panel = document.createElement('section');
    panel.tabIndex = -1;
    document.body.append(panel);

    const event = tabEvent();
    trapFocus(event, panel);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(panel);
  });

  it('recaptures focus from outside the panel using tab direction', () => {
    const outside = document.createElement('button');
    const panel = document.createElement('section');
    const first = document.createElement('button');
    const last = document.createElement('button');
    panel.append(first, last);
    document.body.append(outside, panel);
    outside.focus();

    const forward = tabEvent();
    trapFocus(forward, panel);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    outside.focus();
    const backward = tabEvent(true);
    trapFocus(backward, panel);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });
});
