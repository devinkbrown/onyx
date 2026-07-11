// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Composer.test.tsx — accessibility semantics for the message composer.
 *
 * Asserts the a11y contract (roles / aria / live-region / keyboard), never
 * markup shape:
 *   1. The textarea has an accessible name and the tool buttons are labelled.
 *   2. Composer errors surface in a role="alert" live region.
 *   3. The slash-command autocomplete is a labelled listbox of options.
 *   4. The textarea points aria-activedescendant at the highlighted command,
 *      and ArrowDown moves that pointer — so an AT user hears the selection.
 *
 * AAA pattern; descriptive names.
 */

import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { store } from '@/lib/store/store';
import { Composer } from './Composer';

const initialState = store.getInitialState();

/** Seed one active channel on a live connection so the composer is enabled. */
function seedActiveChannel(): void {
  store.setState(
    {
      ...initialState,
      activeView: { kind: 'channel', channel: '#room' },
      connectionStatus: 'connected',
      ourNick: 'me',
    },
    true,
  );
}

describe('Composer accessibility', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
  });

  it('gives the textarea an accessible name and labels the tool buttons', () => {
    // Arrange
    seedActiveChannel();

    // Act
    const { getByRole } = render(() => <Composer />);

    // Assert
    expect(getByRole('textbox', { name: /message #room/i })).toBeDefined();
    expect(getByRole('button', { name: 'Attach files' })).toBeDefined();
    expect(getByRole('button', { name: 'Insert emoji' })).toBeDefined();
    expect(getByRole('button', { name: 'Send message' })).toBeDefined();
  });

  it('exposes the slash-command popup as a labelled listbox of options', () => {
    // Arrange
    seedActiveChannel();
    const { getByRole } = render(() => <Composer />);
    const textarea = getByRole('textbox', { name: /message #room/i });

    // Act — typing a slash command opens the suggestion list.
    fireEvent.input(textarea, { target: { value: '/me' } });

    // Assert
    const listbox = getByRole('listbox', { name: 'Slash command suggestions' });
    expect(listbox).toBeDefined();
    expect(listbox.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
  });

  it('advertises the active command via aria-activedescendant and moves it with ArrowDown', () => {
    // Arrange
    seedActiveChannel();
    const { getByRole } = render(() => <Composer />);
    const textarea = getByRole('textbox', { name: /message #room/i }) as HTMLTextAreaElement;

    // Act — open the suggestions; the first option is active.
    fireEvent.input(textarea, { target: { value: '/' } });

    // Assert — the textbox controls the listbox and points at the active option.
    expect(textarea.getAttribute('aria-controls')).toBe('shell-command-menu');
    const firstActive = textarea.getAttribute('aria-activedescendant');
    expect(firstActive).toBe('shell-command-option-0');

    const active = document.getElementById(firstActive!);
    expect(active?.getAttribute('role')).toBe('option');
    expect(active?.getAttribute('aria-selected')).toBe('true');

    // Act — ArrowDown advances the highlighted command.
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });

    // Assert — the pointer follows the selection so AT re-announces it.
    expect(textarea.getAttribute('aria-activedescendant')).toBe('shell-command-option-1');
    expect(document.getElementById('shell-command-option-1')?.getAttribute('aria-selected'))
      .toBe('true');
  });

  it('announces composer errors through a role="alert" live region', () => {
    // Arrange
    seedActiveChannel();
    const { getByRole, queryByRole, getByLabelText } = render(() => <Composer />);

    // Assert — the composer is a labelled landmark with no alert yet.
    expect(getByRole('region', { name: 'Message composer' })).toBeDefined();
    expect(queryByRole('alert')).toBeNull();

    // Act — attach an oversize file (jsdom File.size is 0, so fake it) to
    // drive the real error path.
    const fileInput = getByLabelText('Choose files to attach') as HTMLInputElement;
    const huge = new File(['x'], 'huge.bin', { type: 'application/octet-stream' });
    Object.defineProperty(huge, 'size', { value: 26 * 1024 * 1024 });
    Object.defineProperty(fileInput, 'files', { value: [huge], configurable: true });
    fireEvent.change(fileInput);

    // Assert — the failure is exposed to AT via an assertive alert.
    const alert = getByRole('alert');
    expect(alert.textContent).toMatch(/larger than/i);
  });
});
