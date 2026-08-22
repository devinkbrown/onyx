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
 *   5. Offline / outbox status chrome is visible (never silent queue/fail).
 *
 * AAA pattern; descriptive names.
 */

import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { IDBFactory } from 'fake-indexeddb';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardShortcuts } from '@/lib/keyboard/useKeyboardShortcuts';
import { store } from '@/lib/store/store';
import { LOCKED_PLACEHOLDER } from '@/lib/e2ee/dmCipher';
import { _resetVaultForTests, queueOutbox } from '@/lib/vault/historyVault';
import { Composer } from './Composer';
import {
  isFirstHourSeen,
  recordFirstHourHandoff,
  resetFirstHourForTests,
} from '@/lib/firstHour/firstHour';

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
    resetFirstHourForTests();
  });

  afterEach(() => {
    cleanup();
    resetFirstHourForTests();
  });

  it('gives the textarea an accessible name and labels the tool buttons', () => {
    // Arrange
    seedActiveChannel();

    // Act
    const { getByRole, queryByRole } = render(() => <Composer />);

    // Assert — Standard primary: Attach · message · Emoji · More · Send
    const message = getByRole('textbox', { name: /message #room/i }) as HTMLTextAreaElement;
    expect(message).toBeDefined();
    expect(message.placeholder).toBe('Message');
    expect(message.placeholder).not.toMatch(/\/search|\/mute|\/export|\/help/);
    expect(getByRole('button', { name: 'Attach files' })).toBeDefined();
    expect(getByRole('button', { name: 'Insert emoji' })).toBeDefined();
    expect(getByRole('button', { name: 'More tools' })).toBeDefined();
    expect(getByRole('button', { name: 'Send message' })).toBeDefined();
    // Advanced controls stay out of the primary row until More opens.
    expect(queryByRole('button', { name: 'Jump to date in conversation history' })).toBeNull();
    expect(queryByRole('button', { name: 'Schedule message to send later' })).toBeNull();
    expect(queryByRole('button', { name: /export|format/i })).toBeNull();
    expect(screen.getByRole('note', { name: 'Current compose context' })).toHaveTextContent('To #roomReady to send');
  });

  it('locks Standard primary control order: attach, message, emoji, more, send', () => {
    seedActiveChannel();
    const { container } = render(() => <Composer />);
    const row = container.querySelector('[data-composer-primary-row]') as HTMLElement;
    expect(row).toBeTruthy();
    const primaries = Array.from(row.querySelectorAll('[data-composer-primary]')).map(
      (el) => el.getAttribute('data-composer-primary'),
    );
    expect(primaries).toEqual(['attach', 'message', 'emoji', 'more', 'send']);
  });

  it('opens More tools with aria state and restores focus on Escape', async () => {
    seedActiveChannel();
    const { getByRole, getByTestId, queryByTestId } = render(() => <Composer />);
    const more = getByRole('button', { name: 'More tools' }) as HTMLButtonElement;

    expect(more.getAttribute('aria-expanded')).toBe('false');
    // The panel is not mounted while collapsed — the IDREF must not dangle.
    expect(more.hasAttribute('aria-controls')).toBe(false);
    fireEvent.click(more);

    const tray = getByTestId('composer-tools-tray');
    expect(tray.getAttribute('role')).toBe('dialog');
    expect(tray.getAttribute('aria-modal')).toBe('false');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(more.getAttribute('aria-controls')).toBe('shell-composer-tools');
    // The referenced id must actually resolve to a mounted element.
    expect(document.getElementById('shell-composer-tools')).toBeInstanceOf(HTMLElement);
    // Advanced controls appear only after More.
    expect(getByRole('button', { name: 'Schedule message to send later' })).toBeDefined();
    expect(getByRole('button', { name: 'Jump to date in conversation history' })).toBeDefined();
    expect(getByRole('link', { name: 'Room ledger for #room' })).toHaveAttribute(
      'href',
      '/stats/?room=%23room',
    );
    expect(getByRole('button', { name: 'Insert /' })).toBeDefined();
    // No invented formatting/export chrome.
    expect(queryByTestId('composer-tools-tray')!.textContent).not.toMatch(/\bExport\b|\bFormat\b/);

    fireEvent.keyDown(tray, { key: 'Escape' });
    expect(queryByTestId('composer-tools-tray')).toBeNull();
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.hasAttribute('aria-controls')).toBe(false);
    await Promise.resolve();
    expect(document.activeElement).toBe(more);
  });

  it('opens the jump-to-date sheet from More tools and closes the tray', () => {
    seedActiveChannel();
    const { getByRole, queryByTestId } = render(() => <Composer />);

    fireEvent.click(getByRole('button', { name: 'More tools' }));
    fireEvent.click(getByRole('button', { name: 'Jump to date in conversation history' }));

    expect(store.getState().showJumpToDate).toBe(true);
    expect(queryByTestId('composer-tools-tray')).toBeNull();
  });

  it('Insert / only focuses and inserts a slash without sending a command', async () => {
    seedActiveChannel();
    const sendSpy = vi.spyOn(store.getState(), 'sendMessage').mockImplementation(() => {});
    const { getByRole } = render(() => <Composer />);
    const textarea = getByRole('textbox', { name: /message #room/i }) as HTMLTextAreaElement;

    fireEvent.click(getByRole('button', { name: 'More tools' }));
    fireEvent.click(getByRole('button', { name: 'Insert /' }));

    await Promise.resolve();
    expect(textarea.value).toBe('/');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('releases a local attachment preview when the account owner changes', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:alice-private');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    seedActiveChannel();
    const { getByLabelText, getByText, queryByText } = render(() => <Composer />);
    const input = getByLabelText('Choose files to attach') as HTMLInputElement;
    const file = new File(['private'], 'alice-private.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    expect(getByText('alice-private.png')).toBeDefined();
    expect(createObjectURL).toHaveBeenCalledWith(file);

    const current = store.getState().server;
    store.setState({
      ourNick: 'bob',
      server: current ? { ...current, nick: 'bob', account: 'bob' } : null,
    });

    await waitFor(() => expect(queryByText('alice-private.png')).toBeNull());
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:alice-private');
  });

  it('previews an unlocked encrypted reply from transient plaintext only', () => {
    seedActiveChannel();
    store.setState({
      replyingTo: {
        id: 'encrypted-parent',
        from: 'alice',
        text: 'ONYXDM1 ciphertext-envelope',
        plaintext: 'private hello',
        encrypted: true,
        time: new Date(),
        type: 'msg',
        target: '#room',
      },
    });

    const { getByRole, queryByText } = render(() => <Composer />);

    expect(getByRole('status')).toHaveTextContent('Replying to aliceprivate hello');
    expect(queryByText(/ONYXDM1 ciphertext-envelope/)).toBeNull();
  });

  it('uses the fixed locked placeholder and never an encrypted reply envelope', () => {
    seedActiveChannel();
    store.setState({
      replyingTo: {
        id: 'locked-parent',
        from: 'alice',
        text: 'ONYXDM1 locked-envelope',
        encrypted: true,
        time: new Date(),
        type: 'msg',
        target: '#room',
      },
    });

    const { getByRole, queryByText } = render(() => <Composer />);

    expect(getByRole('status')).toHaveTextContent(LOCKED_PLACEHOLDER);
    expect(queryByText(/ONYXDM1 locked-envelope/)).toBeNull();
  });

  it('clears a legacy encrypted edit context instead of exposing or submitting it', () => {
    seedActiveChannel();
    store.setState({
      editingMessage: {
        id: 'encrypted-edit',
        from: 'me',
        text: 'ONYXDM1 edit-envelope',
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
    expect(queryByText(/private edit|ONYXDM1 edit-envelope/)).toBeNull();
  });

  it('hides a reply banner when the armed parent belongs to another target', () => {
    seedActiveChannel();
    store.setState({
      replyingTo: {
        id: 'other-parent',
        from: 'alice',
        text: 'from #ops',
        time: new Date(),
        type: 'msg',
        target: '#ops',
      },
    });

    const { queryByText, queryByRole } = render(() => <Composer />);

    expect(queryByText(/replying to alice/i)).toBeNull();
    expect(queryByRole('button', { name: 'Cancel reply' })).toBeNull();
    // Store keeps the reply armed so returning to #ops can still use it.
    expect(store.getState().replyingTo).toMatchObject({ id: 'other-parent', target: '#ops' });
  });

  it('shows a matching reply banner and cancels it with Escape', () => {
    seedActiveChannel();
    store.setState({
      replyingTo: {
        id: 'room-parent',
        from: 'alice',
        text: 'parent body',
        time: new Date(),
        type: 'msg',
        target: '#room',
      },
    });

    const { getByRole, getByText, queryByText } = render(() => <Composer />);
    expect(getByText(/replying to alice/i)).toBeDefined();
    expect(getByText('parent body')).toBeDefined();

    const textarea = getByRole('textbox', { name: /message #room/i });
    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(store.getState().replyingTo).toBeNull();
    expect(queryByText(/replying to alice/i)).toBeNull();
  });

  it('cancels an edit with Escape and restores the room draft', () => {
    seedActiveChannel();
    store.getState().setComposerDraft('#room', 'saved draft');
    store.setState({
      editingMessage: {
        id: 'edit-me',
        from: 'me',
        text: 'original message',
        time: new Date(),
        type: 'msg',
        target: '#room',
      },
    });

    const { getByRole, getByText, queryByText } = render(() => <Composer />);
    // While editing, the textarea's accessible name is "Edit message".
    const textarea = getByRole('textbox', { name: 'Edit message' }) as HTMLTextAreaElement;

    expect(getByText(/^editing$/i)).toBeDefined();
    expect(textarea.value).toBe('original message');
    expect(getByRole('button', { name: 'Save edit' })).toBeDefined();

    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(store.getState().editingMessage).toBeNull();
    expect(queryByText(/^editing$/i)).toBeNull();
    expect(textarea.value).toBe('saved draft');
    // After cancel, the accessible name returns to the room placeholder.
    expect(getByRole('textbox', { name: /message #room/i })).toBeDefined();
  });

  it('drops the reply banner when an edit is armed (mutual exclusivity)', () => {
    seedActiveChannel();
    store.setState({
      replyingTo: {
        id: 'room-parent',
        from: 'alice',
        text: 'parent body',
        time: new Date(),
        type: 'msg',
        target: '#room',
      },
    });

    const { getByText, queryByText, getByRole } = render(() => <Composer />);
    expect(getByText(/replying to alice/i)).toBeDefined();

    store.getState().setComposerEditingMessage({
      id: 'edit-me',
      from: 'me',
      text: 'mine',
      time: new Date(),
      type: 'msg',
      target: '#room',
    });

    expect(queryByText(/replying to alice/i)).toBeNull();
    expect(getByText(/^editing$/i)).toBeDefined();
    expect(getByRole('button', { name: 'Save edit' })).toBeDefined();
    expect(store.getState().replyingTo).toBeNull();
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

    // Some engines expose the terminal composition key only as legacy 229.
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendSpy).not.toHaveBeenCalled();

    // Act — a normal Enter after the composition has ended.
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert — now the finished message is sent to the active target.
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith('#room', 'こんにち');
  });

  it('keeps the draft when an encrypted-room send is refused asynchronously', async () => {
    seedActiveChannel();
    const sendSpy = vi
      .spyOn(store.getState(), 'sendMessage')
      .mockImplementation(async () => false);
    const { getByRole, findByText } = render(() => <Composer />);
    const textarea = getByRole('textbox', { name: /message #room/i }) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'keep this private draft' } });

    fireEvent.keyDown(textarea, { key: 'Enter' });

    await findByText('Message was not sent. Your draft is still here.');
    expect(sendSpy).toHaveBeenCalledWith('#room', 'keep this private draft');
    expect(textarea.value).toBe('keep this private draft');
    expect(document.activeElement).toBe(textarea);
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

    // Candidate-window Escape belongs to the input method and must not dismiss
    // the picker from under an in-progress emoji search.
    fireEvent.keyDown(search, { key: 'Escape', keyCode: 229, isComposing: true });
    expect(getByRole('dialog', { name: 'Emoji picker' })).toBeDefined();

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

  function openScheduleFromMore(
    getByRole: ReturnType<typeof render>['getByRole'],
  ): void {
    fireEvent.click(getByRole('button', { name: 'More tools' }));
    fireEvent.click(getByRole('button', { name: 'Schedule message to send later' }));
  }

  it('disables the schedule control until there is plain text (truthful in More)', () => {
    seedActiveChannel();
    const { getByRole, queryByRole } = render(() => <Composer />);
    // Schedule is not a primary control.
    expect(queryByRole('button', { name: 'Schedule message to send later' })).toBeNull();

    fireEvent.click(getByRole('button', { name: 'More tools' }));
    const scheduleBtn = getByRole('button', {
      name: 'Schedule message to send later',
    }) as HTMLButtonElement;

    // Empty composer: nothing to schedule.
    expect(scheduleBtn.disabled).toBe(true);
    expect(scheduleBtn.textContent).toMatch(/Type a message before scheduling/i);

    // Plain text enables it; a slash command does not (never queued).
    const textarea = getByRole('textbox', { name: /message #room/i });
    fireEvent.input(textarea, { target: { value: 'ping later' } });
    expect(scheduleBtn.disabled).toBe(false);
    expect(scheduleBtn.textContent).toMatch(/Schedule this message for a time you pick/i);

    fireEvent.input(textarea, { target: { value: '/me waves' } });
    expect(scheduleBtn.disabled).toBe(true);
    expect(scheduleBtn.textContent).toMatch(/Slash commands cannot be scheduled/i);
  });

  it('round-trips: More → schedule preset queues the composer text and clears it', () => {
    seedActiveChannel();
    const { getByRole, queryByTestId } = render(() => <Composer />);
    const textarea = getByRole('textbox', {
      name: /message #room/i,
    }) as HTMLTextAreaElement;

    // Arrange — write a message and open schedule through More tools.
    fireEvent.input(textarea, { target: { value: 'stand-up reminder' } });
    openScheduleFromMore(getByRole);
    // Opening schedule closes the tools tray.
    expect(queryByTestId('composer-tools-tray')).toBeNull();

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

  it('counts only scheduled messages owned by the current account', () => {
    seedActiveChannel();
    store.getState().scheduleMessage('#room', 'Alice only', Date.now() + 3_600_000);
    const aliceServer = store.getState().server!;
    store.setState({
      ourNick: 'bob',
      server: { ...aliceServer, id: 'composer-bob', nick: 'bob', account: 'bob' },
    });

    const { getByRole, queryByRole } = render(() => <Composer />);
    fireEvent.input(getByRole('textbox', { name: /message #room/i }), {
      target: { value: 'Bob draft' },
    });
    openScheduleFromMore(getByRole);

    expect(queryByRole('button', { name: 'View 1 scheduled' })).toBeNull();

    store.setState({ ourNick: 'me', server: aliceServer });
    expect(getByRole('button', { name: 'View 1 scheduled' })).toBeDefined();
  });

  it('exposes the schedule popover as a labelled dialog with presets', () => {
    seedActiveChannel();
    const { getByRole } = render(() => <Composer />);
    const textarea = getByRole('textbox', { name: /message #room/i });
    fireEvent.input(textarea, { target: { value: 'hi' } });

    openScheduleFromMore(getByRole);
    const dialog = getByRole('dialog', { name: 'Schedule message' });
    expect(dialog.querySelectorAll('.shell-schedule-preset').length).toBeGreaterThan(0);
    // The custom time field is labelled for keyboard/AT users.
    expect(getByRole('textbox', { name: /message #room/i })).toBeDefined();
  });

  it('opens schedule via the always-mounted data-composer-schedule bridge while More is closed', async () => {
    seedActiveChannel();
    let disposeKb: (() => void) | undefined;
    createRoot((dispose) => {
      disposeKb = dispose;
      useKeyboardShortcuts();
    });
    const { getByRole, queryByRole, container } = render(() => <Composer />);
    const textarea = getByRole('textbox', { name: /message #room/i }) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: 'send me later' } });

    // No accessible Schedule control in the primary row / AT tree while More is closed.
    expect(queryByRole('button', { name: 'Schedule message to send later' })).toBeNull();
    const primaryRow = container.querySelector('[data-composer-primary-row]');
    expect(primaryRow?.querySelector('[aria-label="Schedule message to send later"]')).toBeNull();
    expect(queryByRole('dialog', { name: 'More composer tools' })).toBeNull();

    // Bridge is always mounted, uniquely owns data-composer-schedule, truthful disabled.
    const bridges = document.querySelectorAll<HTMLButtonElement>('[data-composer-schedule]');
    expect(bridges).toHaveLength(1);
    const bridge = bridges[0]!;
    expect(bridge.disabled).toBe(false);
    expect(bridge.getAttribute('aria-hidden')).toBe('true');
    expect(bridge.hasAttribute('hidden')).toBe(true);

    // Invoke the real registered chord (composer.schedule → clickComposerControl).
    textarea.focus();
    fireEvent.keyDown(textarea, { key: 'l', ctrlKey: true, shiftKey: true });

    const dialog = getByRole('dialog', { name: 'Schedule message' });
    expect(dialog).toBeDefined();
    // Still a single accessible Schedule name path (none) — dialog is Schedule message, not a button.
    expect(queryByRole('button', { name: 'Schedule message to send later' })).toBeNull();

    await waitFor(() => {
      const firstPreset = dialog.querySelector('.shell-schedule-preset');
      expect(firstPreset).toBeTruthy();
      expect(document.activeElement).toBe(firstPreset);
    });

    disposeKb?.();
  });

  it('bridge stays disabled when the composer cannot schedule (More still closed)', () => {
    seedActiveChannel();
    const { queryByRole } = render(() => <Composer />);
    // Empty text → cannot schedule; bridge mirrors canSchedule.
    const bridge = document.querySelector<HTMLButtonElement>('[data-composer-schedule]');
    expect(bridge).toBeTruthy();
    expect(bridge!.disabled).toBe(true);
    expect(queryByRole('button', { name: 'Schedule message to send later' })).toBeNull();
  });
});

describe('Composer outbox status chrome', () => {
  const owner = { serverUrl: 'wss://example.test', identity: 'me' } as const;

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    _resetVaultForTests();
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows empty-offline honesty when disconnected with nothing queued', () => {
    seedActiveChannel();
    store.setState({ connectionStatus: 'disconnected' });
    render(() => <Composer />);

    expect(screen.getByText(/Offline · Messages queue on this device/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try sending now' })).not.toBeInTheDocument();
  });

  it('shows Queued (N) · Will send on reconnect for owned outbox rows', async () => {
    seedActiveChannel();
    store.setState({ connectionStatus: 'disconnected' });
    await queueOutbox('#room', 'body stays out of chrome', owner);
    render(() => <Composer />);

    expect(await screen.findByText(/Queued \(1\) · Will send on reconnect/i)).toBeInTheDocument();
    expect(screen.queryByText('body stays out of chrome')).not.toBeInTheDocument();
  });

  it('offers Try sending now when connected with a stuck queue', async () => {
    seedActiveChannel();
    await queueOutbox('#room', 'retry me', owner);
    store.setState({ outboxDeliveryFailed: true });
    const flushSpy = vi.spyOn(store.getState(), 'flushOutbox').mockImplementation(() => {});
    render(() => <Composer />);

    expect(await screen.findByText(/Couldn't send/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try sending now' }));
    expect(flushSpy).toHaveBeenCalledOnce();
  });

  it('shows Queued (N) · Waiting to send when online with a remaining queue', async () => {
    seedActiveChannel();
    await queueOutbox('#room', 'waiting body stays private', owner);
    // Connected + remaining queue, auto-retry not yet exhausted → waiting chrome.
    render(() => <Composer />);

    expect(await screen.findByText(/Queued \(1\) · Waiting to send/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try sending now' })).toBeInTheDocument();
    expect(screen.queryByText('waiting body stays private')).not.toBeInTheDocument();
  });

  it('hides outbox chrome when online and the queue is empty', () => {
    seedActiveChannel();
    render(() => <Composer />);
    expect(screen.queryByText(/Queued \(/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Messages queue on this device/i)).not.toBeInTheDocument();
  });

  it('quotes a reply fragment above the field and keeps the primary Send action', () => {
    seedActiveChannel();
    store.setState({
      replyingTo: {
        id: 'quote-parent',
        from: 'alice',
        text: 'a short fragment to quote',
        time: new Date(),
        type: 'msg',
        target: '#room',
      },
    });

    const { getByRole, getByText } = render(() => <Composer />);

    expect(getByText('Replying to alice')).toBeInTheDocument();
    expect(getByText('a short fragment to quote')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Cancel reply' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Send message' })).toBeInTheDocument();
  });
});

describe('Composer first-hour room landing', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    resetFirstHourForTests();
  });

  afterEach(() => {
    cleanup();
    resetFirstHourForTests();
  });

  it('focuses the composer and shows a dismissible say-hi hint', async () => {
    recordFirstHourHandoff({ landing: 'room', channel: '#room', guest: true });
    seedActiveChannel();
    render(() => <Composer />);

    const message = screen.getByRole('textbox', { name: /message #room/i });
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(screen.getByTestId('first-hour-coach')).toHaveTextContent('Say hi');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss tip' }));
    expect(isFirstHourSeen()).toBe(true);
    expect(screen.queryByTestId('first-hour-coach')).not.toBeInTheDocument();
  });
});
