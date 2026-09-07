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

  it('does not move focus for claimed or composing Tab events', () => {
    const outside = document.createElement('button');
    const panel = document.createElement('section');
    const inside = document.createElement('button');
    panel.append(inside);
    document.body.append(outside, panel);
    outside.focus();

    const claimed = tabEvent();
    claimed.preventDefault();
    trapFocus(claimed, panel);
    expect(document.activeElement).toBe(outside);

    const composing = tabEvent();
    Object.defineProperty(composing, 'isComposing', { value: true });
    trapFocus(composing, panel);
    expect(document.activeElement).toBe(outside);
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

  it('wraps keyboard focus at the first and last tabbable controls', () => {
    const panel = document.createElement('section');
    const first = document.createElement('button');
    const middle = document.createElement('button');
    const last = document.createElement('button');
    panel.append(first, middle, last);
    document.body.append(panel);

    last.focus();
    const forward = tabEvent();
    trapFocus(forward, panel);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    first.focus();
    const backward = tabEvent(true);
    trapFocus(backward, panel);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('skips disabled controls and tabindex -1 elements when wrapping', () => {
    const panel = document.createElement('section');
    const skippedByTabIndex = document.createElement('button');
    skippedByTabIndex.tabIndex = -1;
    const first = document.createElement('button');
    const disabled = document.createElement('button');
    disabled.disabled = true;
    const last = document.createElement('button');
    panel.append(skippedByTabIndex, first, disabled, last);
    document.body.append(panel);

    last.focus();
    const event = tabEvent();
    trapFocus(event, panel);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('wraps in both directions without counting controls in hidden or inert subtrees', () => {
    const panel = document.createElement('section');
    const first = document.createElement('button');
    first.textContent = 'First visible';
    const last = document.createElement('button');
    last.textContent = 'Last visible';
    const hiddenGroup = document.createElement('section');
    hiddenGroup.hidden = true;
    hiddenGroup.append(document.createElement('button'));
    const inertGroup = document.createElement('section');
    inertGroup.setAttribute('inert', '');
    inertGroup.append(document.createElement('button'));
    panel.append(first, last, hiddenGroup, inertGroup);
    document.body.append(panel);

    last.focus();
    const forward = tabEvent();
    trapFocus(forward, panel);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    const backward = tabEvent(true);
    trapFocus(backward, panel);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('does not focus controls inside aria-hidden subtrees', () => {
    const panel = document.createElement('section');
    panel.tabIndex = -1;
    const hidden = document.createElement('div');
    hidden.setAttribute('aria-hidden', 'true');
    const hiddenButton = document.createElement('button');
    hidden.append(hiddenButton);
    const visible = document.createElement('button');
    panel.append(hidden, visible);
    document.body.append(panel);

    focusFirst(panel);

    expect(document.activeElement).toBe(visible);
  });

  it('skips a focusable candidate whose ancestor is CSS-hidden', () => {
    const panel = document.createElement('section');
    panel.tabIndex = -1;
    const hiddenGroup = document.createElement('div');
    hiddenGroup.style.visibility = 'hidden';
    hiddenGroup.append(document.createElement('button'));
    const visible = document.createElement('button');
    panel.append(hiddenGroup, visible);
    document.body.append(panel);

    focusFirst(panel);

    expect(document.activeElement).toBe(visible);
  });

  it('skips closed details, disabled fieldsets, and CSS-hidden candidates', () => {
    const panel = document.createElement('section');
    panel.tabIndex = -1;
    const closed = document.createElement('details');
    closed.append(document.createElement('button'));
    const fieldset = document.createElement('fieldset');
    fieldset.disabled = true;
    fieldset.append(document.createElement('button'));
    const cssHidden = document.createElement('button');
    cssHidden.style.display = 'none';
    const visible = document.createElement('button');
    panel.append(closed, fieldset, cssHidden, visible);
    document.body.append(panel);

    focusFirst(panel);

    expect(document.activeElement).toBe(visible);
  });

  it('lets Tab leave an open details summary for the next control', () => {
    const panel = document.createElement('section');
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    const next = document.createElement('button');
    details.append(summary);
    panel.append(details, next);
    document.body.append(panel);

    summary.focus();
    const event = tabEvent();
    trapFocus(event, panel);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('lets Shift+Tab move from the control after an open details summary back to it', () => {
    const panel = document.createElement('section');
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    const next = document.createElement('button');
    details.append(summary);
    panel.append(details, next);
    document.body.append(panel);

    next.focus();
    const event = tabEvent(true);
    trapFocus(event, panel);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(next);
  });

  it('keeps controls inside closed details out of both traversal boundaries', () => {
    const panel = document.createElement('section');
    const closed = document.createElement('details');
    const summary = document.createElement('summary');
    const hiddenControl = document.createElement('button');
    closed.append(summary, hiddenControl);
    const visible = document.createElement('button');
    panel.append(closed, visible);
    document.body.append(panel);

    visible.focus();
    const forward = tabEvent();
    trapFocus(forward, panel);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(summary);

    summary.focus();
    const backward = tabEvent(true);
    trapFocus(backward, panel);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(visible);
  });
});
