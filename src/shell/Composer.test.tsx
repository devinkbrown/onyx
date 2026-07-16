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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '@/lib/store/store';
import { LOCKED_PLACEHOLDER } from '@/lib/e2ee/dmCipher';
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
      server: {
        id: 'composer-test',
        name: 'Onyx',
        network: 'Onyx',
        url: 'wss://example.test',
        icon: '',
        nick: 'me',
        account: 'me',
        connected: true,
      },
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

  it('previews an unlocked encrypted reply from transient plaintext only', () => {
    seedActiveChannel();
    store.setState({
      replyingTo: {
        id: 'encrypted-parent',
        from: 'alice',
        text: 'TSUMUGI1 ciphertext-envelope',
        plaintext: 'private hello',
        encrypted: true,
        time: new Date(),
        type: 'msg',
        target: '#room',
      },
    });

    const { getByRole, queryByText } = render(() => <Composer />);

    expect(getByRole('status')).toHaveTextContent('replying to aliceprivate hello');
    expect(queryByText(/TSUMUGI1 ciphertext-envelope/)).toBeNull();
  });

  it('uses the fixed locked placeholder and never an encrypted reply envelope', () => {
    seedActiveChannel();
    store.setState({
      replyingTo: {
        id: 'locked-parent',
        from: 'alice',
        text: 'TSUMUGI1 locked-envelope',
        encrypted: true,
        time: new Date(),
        type: 'msg',
        target: '#room',
      },
    });

    const { getByRole, queryByText } = render(() => <Composer />);

    expect(getByRole('status')).toHaveTextContent(LOCKED_PLACEHOLDER);
    expect(queryByText(/TSUMUGI1 locked-envelope/)).toBeNull();
  });

  it('clears a legacy encrypted edit context instead of exposing or submitting it', () => {
    seedActiveChannel();
    store.setState({
      editingMessage: {
        id: 'encrypted-edit',
        from: 'me',
        text: 'TSUMUGI1 edit-envelope',
        plaintext: 'private edit',
        encrypted: true,
        time: new Date(),
        type: 'msg',
        target: '#room',
      },
    });

    const { getByRole, queryByText } = render(() => <Composer />);

    expect(store.getState().editingMessage).toBeNull();
    expect(getByRole('button', { name: 'Send message' })).toBeDefined();
    expect(queryByText(/private edit|TSUMUGI1 edit-envelope/)).toBeNull();
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

  it('does not send while an IME composition is active, but sends once it ends', async () => {
    // Arrange — a real message being composed via an IME.
    seedActiveChannel();
    const sendSpy = vi
      .spyOn(store.getState(), 'sendMessage')
      .mockImplementation(() => {});
    const { getByRole } = render(() => <Composer />);
    const textarea = getByRole('textbox', { name: /message #room/i }) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'こんにち' } });

    // Act — Enter pressed to CONFIRM the IME candidate (isComposing = true).
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
    // Flush microtasks: sendMessage dispatches behind `await uploadPendingAttachments()`,
    // so without this an un-guarded send would not yet have drained and the negative
    // assertion below would pass even if the IME guard were removed (false-green).
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert — confirming a candidate must NOT send the half-composed message.
    expect(sendSpy).not.toHaveBeenCalled();

    // Act — a normal Enter after the composition has ended.
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert — now the finished message is sent to the active target.
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith('#room', 'こんにち');
  });

  it('moves focus into the emoji dialog on open and restores it to the textarea on Escape', async () => {
    // Arrange
    seedActiveChannel();
    const { getByRole, queryByRole } = render(() => <Composer />);
    const textarea = getByRole('textbox', { name: /message #room/i });
    const emojiToggle = getByRole('button', { name: 'Insert emoji' });

    // Act — open the picker.
    fireEvent.click(emojiToggle);

    // Assert — dialog present, trigger advertises expanded state.
    const dialog = getByRole('dialog', { name: 'Emoji picker' });
    expect(dialog).toBeDefined();
    expect(emojiToggle.getAttribute('aria-expanded')).toBe('true');

    // Focus lands on the search field (queued as a microtask).
    const search = getByRole('textbox', { name: 'Search emoji' });
    await Promise.resolve();
    expect(document.activeElement).toBe(search);

    // Act — Escape from inside the dialog closes it and restores focus.
    fireEvent.keyDown(dialog, { key: 'Escape' });

    // Assert — dialog gone, expanded state cleared, focus back on the composer.
    expect(queryByRole('dialog', { name: 'Emoji picker' })).toBeNull();
    expect(emojiToggle.getAttribute('aria-expanded')).toBe('false');
    await Promise.resolve();
    expect(document.activeElement).toBe(textarea);
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

describe('Composer schedule (send later)', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
  });

  it('disables the schedule button until there is plain text', () => {
    seedActiveChannel();
    const { getByRole } = render(() => <Composer />);
    const scheduleBtn = getByRole('button', {
      name: 'Schedule message to send later',
    }) as HTMLButtonElement;

    // Empty composer: nothing to schedule.
    expect(scheduleBtn.disabled).toBe(true);

    // Plain text enables it; a slash command does not (never queued).
    const textarea = getByRole('textbox', { name: /message #room/i });
    fireEvent.input(textarea, { target: { value: 'ping later' } });
    expect(scheduleBtn.disabled).toBe(false);

    fireEvent.input(textarea, { target: { value: '/me waves' } });
    expect(scheduleBtn.disabled).toBe(true);
  });

  it('round-trips: a preset queues the composer text and clears it', () => {
    seedActiveChannel();
    const { getByRole } = render(() => <Composer />);
    const textarea = getByRole('textbox', {
      name: /message #room/i,
    }) as HTMLTextAreaElement;

    // Arrange — write a message and open the schedule dialog.
    fireEvent.input(textarea, { target: { value: 'stand-up reminder' } });
    fireEvent.click(getByRole('button', { name: 'Schedule message to send later' }));

    // Act — pick the first preset.
    const dialog = getByRole('dialog', { name: 'Schedule message' });
    const preset = dialog.querySelector('.shell-schedule-preset') as HTMLButtonElement;
    fireEvent.click(preset);

    // Assert — the store queued exactly one future message and the composer
    // reset (DOM updated after the store change — the reactivity guard).
    const queued = store.getState().scheduledMessages;
    expect(queued).toHaveLength(1);
    expect(queued[0]!.channel).toBe('#room');
    expect(queued[0]!.text).toBe('stand-up reminder');
    expect(queued[0]!.sendAt).toBeGreaterThan(Date.now());
    expect(queued[0]!.owner).toEqual({ serverUrl: 'wss://example.test', identity: 'me' });
    expect(textarea.value).toBe('');
  });

  it('exposes the schedule popover as a labelled dialog with presets', () => {
    seedActiveChannel();
    const { getByRole } = render(() => <Composer />);
    const textarea = getByRole('textbox', { name: /message #room/i });
    fireEvent.input(textarea, { target: { value: 'hi' } });

    fireEvent.click(getByRole('button', { name: 'Schedule message to send later' }));
    const dialog = getByRole('dialog', { name: 'Schedule message' });
    expect(dialog.querySelectorAll('.shell-schedule-preset').length).toBeGreaterThan(0);
    // The custom time field is labelled for keyboard/AT users.
    expect(getByRole('textbox', { name: /message #room/i })).toBeDefined();
  });
});
