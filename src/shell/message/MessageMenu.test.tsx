// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MessageMenu.test.tsx — unit tests for the pure capability-gating helper that
 * decides which per-message actions (React/Reply/Copy/Edit/Delete) apply.
 *
 * AAA pattern; descriptive names. The component itself is exercised by the
 * shell integration tests and e2e; here we pin the gating rules in isolation.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createRoot, createSignal, For } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/lib/irc/types';
import { setTranslationTarget } from '@/lib/intelligence/translateMessage';
import { store } from '@/lib/store/store';
import { closeMessageSearch, useMessageSearch } from '@/shell/search/useMessageSearch';
import {
  MessageMenu,
  loadedMessageActionText,
  messageMenuCapabilities,
  suggestSearchQueryFromMessage,
  suggestTopicLabelFromMessage,
  type CapabilityInput,
} from './MessageMenu';

const initialState = store.getInitialState();

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
  store.setState(initialState, true);
  closeMessageSearch();
  setTranslationTarget('');
  localStorage.clear();
});

function localStorageValues(): string[] {
  const values: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === null) continue;
    const value = localStorage.getItem(key);
    if (value !== null) values.push(value);
  }
  return values;
}

function input(overrides: Partial<CapabilityInput> = {}): CapabilityInput {
  const { msg: msgOverride, ...rest } = overrides;
  return {
    selfNick: 'alice',
    editingEnabled: true,
    deleteSupported: true,
    channelTarget: true,
    ...rest,
    msg: {
      from: 'alice',
      text: 'hello world',
      type: 'msg',
      deleted: false,
      redacted: false,
      ...(msgOverride ?? {}),
    },
  };
}

describe('messageMenuCapabilities', () => {
  it('allows every action for the user’s own live text message', () => {
    // Arrange
    const args = input();

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps).toEqual({
      canReply: true,
      canReact: true,
      canCopy: true,
      canSearchText: true,
      canCopyMoment: true,
      canStartTopic: true,
      canEdit: true,
      canDelete: true,
    });
  });

  it('disables edit and delete on someone else’s message but keeps reply/react/copy', () => {
    // Arrange
    const args = input({ selfNick: 'bob' });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canReply).toBe(true);
    expect(caps.canReact).toBe(true);
    expect(caps.canCopy).toBe(true);
    expect(caps.canSearchText).toBe(true);
    expect(caps.canCopyMoment).toBe(true);
    expect(caps.canStartTopic).toBe(true);
    expect(caps.canEdit).toBe(false);
    expect(caps.canDelete).toBe(false);
  });

  it('disables every live-message action once a message is deleted', () => {
    // Arrange
    const args = input({ msg: { from: 'alice', text: '[deleted]', type: 'msg', deleted: true } });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canReply).toBe(false);
    expect(caps.canReact).toBe(false);
    expect(caps.canCopy).toBe(false);
    expect(caps.canSearchText).toBe(false);
    expect(caps.canCopyMoment).toBe(false);
    expect(caps.canEdit).toBe(false);
    expect(caps.canDelete).toBe(false);
  });

  it('treats a redacted message the same as a deleted one', () => {
    // Arrange
    const args = input({ msg: { from: 'alice', text: 'gone', type: 'msg', redacted: true } });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canReact).toBe(false);
    expect(caps.canCopyMoment).toBe(false);
    expect(caps.canStartTopic).toBe(false);
    expect(caps.canDelete).toBe(false);
  });

  it('forbids editing non-text messages (e.g. /me actions) even when owned', () => {
    // Arrange
    const args = input({ msg: { from: 'alice', text: 'waves', type: 'action' } });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canEdit).toBe(false);
    // ...but reply/react/copy/delete still apply to an own action line
    expect(caps.canReply).toBe(true);
    expect(caps.canDelete).toBe(true);
  });

  it('forbids editing when the server/account disables editing', () => {
    // Arrange
    const args = input({ editingEnabled: false });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canEdit).toBe(false);
    expect(caps.canDelete).toBe(true);
  });

  it('forbids editing encrypted rows even when unlocked, owned, and enabled', () => {
    const caps = messageMenuCapabilities(input({
      msg: {
        from: 'alice',
        text: 'ONYXDM1 ciphertext-envelope',
        plaintext: 'private hello',
        encrypted: true,
        type: 'msg',
      },
    }));

    expect(caps.canEdit).toBe(false);
    expect(caps.canReply).toBe(true);
    expect(caps.canCopy).toBe(true);
    expect(caps.canDelete).toBe(true);
  });

  it('fails closed on an envelope whose legacy row omitted encrypted=true', () => {
    const caps = messageMenuCapabilities(input({
      msg: {
        from: 'alice',
        text: 'ONYXDM1 legacy-envelope',
        type: 'msg',
      },
    }));

    expect(caps.canEdit).toBe(false);
    expect(caps.canCopy).toBe(false);
    expect(caps.canSearchText).toBe(false);
  });

  it('forbids deleting when the store offers no redaction action', () => {
    // Arrange
    const args = input({ deleteSupported: false });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canDelete).toBe(false);
    expect(caps.canEdit).toBe(true);
  });

  it('forbids redacting a message that is still queued locally', () => {
    const caps = messageMenuCapabilities(input({
      msg: { from: 'alice', text: 'waiting to send', type: 'msg', pending: true },
    }));

    expect(caps.canDelete).toBe(false);
    expect(caps.canEdit).toBe(true);
  });

  it('forbids copy when there is no real text (whitespace only)', () => {
    // Arrange
    const args = input({ msg: { from: 'alice', text: '   ', type: 'msg' } });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canCopy).toBe(false);
    expect(caps.canSearchText).toBe(false);
    expect(caps.canCopyMoment).toBe(true);
    // reply/react still allowed on a live message
    expect(caps.canReply).toBe(true);
  });

  it('does not offer topic starts for direct messages', () => {
    // Arrange
    const args = input({ channelTarget: false });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canStartTopic).toBe(false);
    expect(caps.canCopyMoment).toBe(false);
    expect(caps.canReply).toBe(true);
  });

  it('matches nicks case-insensitively when deciding ownership', () => {
    // Arrange
    const args = input({ msg: { from: 'Alice', text: 'hi', type: 'msg' }, selfNick: 'alice' });

    // Act
    const caps = messageMenuCapabilities(args);

    // Assert
    expect(caps.canEdit).toBe(true);
    expect(caps.canDelete).toBe(true);
  });
});

describe('suggestTopicLabelFromMessage', () => {
  it('uses the first meaningful words from a message', () => {
    expect(suggestTopicLabelFromMessage('Release blockers for mobile onboarding today')).toBe(
      'Release blockers for mobile onboarding today',
    );
  });

  it('strips markdown markers, links, and trailing punctuation', () => {
    expect(suggestTopicLabelFromMessage('## `Deploy notes`: https://example.test/build')).toBe('Deploy notes');
  });

  it('shrinks long messages to a valid topic label', () => {
    expect(suggestTopicLabelFromMessage('This is a very long incident investigation with many extra words')).toBe(
      'This is a very long incident',
    );
  });

  it('returns null when no usable label remains', () => {
    expect(suggestTopicLabelFromMessage('https://example.test')).toBeNull();
  });
});

describe('suggestSearchQueryFromMessage', () => {
  it('uses a compact readable phrase from message text', () => {
    expect(suggestSearchQueryFromMessage('Release blockers for mobile onboarding today are waiting')).toBe(
      'Release blockers for mobile onboarding today are waiting',
    );
  });

  it('strips markdown markers and links before searching', () => {
    expect(suggestSearchQueryFromMessage('## `Deploy notes`: https://example.test/build')).toBe('Deploy notes');
  });

  it('returns null when no searchable words remain', () => {
    expect(suggestSearchQueryFromMessage('https://example.test')).toBeNull();
  });
});

describe('loadedMessageActionText', () => {
  it('uses transient plaintext for a loaded E2EE row', () => {
    expect(loadedMessageActionText({
      text: 'e2ee:v1:ciphertext-envelope',
      plaintext: 'private hello',
      encrypted: true,
    })).toBe('private hello');
  });

  it('never returns ciphertext for a locked E2EE row', () => {
    expect(loadedMessageActionText({
      text: 'e2ee:v1:ciphertext-envelope',
      encrypted: true,
    })).toBeNull();
  });

  it('rejects deleted, redacted, and empty rows', () => {
    expect(loadedMessageActionText({ text: 'gone', deleted: true })).toBeNull();
    expect(loadedMessageActionText({ text: 'gone', redacted: true })).toBeNull();
    expect(loadedMessageActionText({ text: '   ' })).toBeNull();
  });

  it('keeps ordinary visible text unchanged', () => {
    expect(loadedMessageActionText({ text: 'ordinary hello' })).toBe('ordinary hello');
  });
});

describe('<MessageMenu>', () => {
  it('translates a loaded message once on this device, keeps it transient, and dismisses it', async () => {
    setTranslationTarget('fr');
    let resolveTranslation: ((value: string) => void) | undefined;
    const pendingTranslation = new Promise<string>((resolve) => {
      resolveTranslation = resolve;
    });
    const translate = vi.fn(() => pendingTranslation);
    const create = vi.fn(() => ({ translate }));
    const fetch = vi.fn();
    vi.stubGlobal('Translator', { create });
    vi.stubGlobal('fetch', fetch);
    const msg: ChatMessage = {
      id: 'm-translate',
      from: 'alice',
      text: 'Hello from the loaded row.',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };
    const original = { ...msg };

    render(() => (
      <MessageMenu msg={msg} target="#general" selfNick="bob" canEdit={false} menuOpen />
    ));
    const action = screen.getByRole('menuitem', {
      name: 'Translate message from alice on this device',
    });
    fireEvent.click(action);
    fireEvent.click(action);

    await waitFor(() => expect(translate).toHaveBeenCalledTimes(1));
    expect(action).toBeDisabled();
    expect(screen.getByText('Translating on this device…')).toHaveAttribute('role', 'status');
    resolveTranslation?.('Bonjour depuis la ligne chargée.');

    const output = await screen.findByText('Bonjour depuis la ligne chargée.');
    expect(output).toHaveAttribute('role', 'status');
    expect(screen.getByLabelText(/Translation for message from alice provenance: This device/i)).toBeInTheDocument();
    expect(create).toHaveBeenCalledWith({ targetLanguage: 'fr' });
    expect(fetch).not.toHaveBeenCalled();
    expect(msg).toEqual(original);
    expect(localStorageValues()).not.toContain('Hello from the loaded row.');
    expect(localStorageValues()).not.toContain('Bonjour depuis la ligne chargée.');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss translation for message from alice' }));
    expect(screen.queryByText('Bonjour depuis la ligne chargée.')).toBeNull();
  });

  it('gates the action with an accessible note when the browser local Translator API is unavailable', () => {
    vi.stubGlobal('Translator', undefined);
    const msg: ChatMessage = {
      id: 'm-translate-unavailable',
      from: 'alice',
      text: 'Translate me locally.',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu msg={msg} target="#general" selfNick="bob" canEdit={false} menuOpen />
    ));

    expect(screen.queryByRole('menuitem', { name: /translate message from alice/i })).toBeNull();
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('On-device translation is unavailable in this browser.');
    expect(screen.queryByText(/external/i)).toBeNull();
  });

  it('copies exactly a successful transient translation with a keyboard-accessible action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    vi.stubGlobal('Translator', {
      create: () => ({ translate: () => Promise.resolve('Exact translated output.') }),
    });
    const msg: ChatMessage = {
      id: 'm-translation-copy',
      from: 'alice',
      text: 'Original loaded text.',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu msg={msg} target="#general" selfNick="bob" canEdit={false} menuOpen />
    ));
    expect(screen.queryByRole('button', { name: /copy translated text/i })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /translate message from alice on this device/i }));
    await screen.findByText('Exact translated output.');

    const copy = screen.getByRole('button', {
      name: 'Copy translated text for message from alice',
    });
    copy.focus();
    expect(document.activeElement).toBe(copy);
    fireEvent.click(copy);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith('Exact translated output.');
    expect(writeText).not.toHaveBeenCalledWith('Original loaded text.');
    expect(await screen.findByText('Translation copied.')).toHaveAttribute('role', 'status');
    expect(localStorageValues()).not.toContain('Exact translated output.');

    setTranslationTarget('de');
    await waitFor(() => {
      expect(screen.queryByText('Exact translated output.')).toBeNull();
      expect(screen.queryByText('Translation copied.')).toBeNull();
    });
  });

  it('reports a rejected translation copy without a false success or persistence fallback', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    vi.stubGlobal('Translator', {
      create: () => ({ translate: () => Promise.resolve('Rejected-copy translation.') }),
    });
    const msg: ChatMessage = {
      id: 'm-translation-copy-rejected',
      from: 'alice',
      text: 'Original rejected-copy text.',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu msg={msg} target="#general" selfNick="bob" canEdit={false} menuOpen />
    ));
    fireEvent.click(screen.getByRole('menuitem', { name: /translate message from alice on this device/i }));
    await screen.findByText('Rejected-copy translation.');
    fireEvent.click(screen.getByRole('button', { name: /copy translated text for message from alice/i }));

    const failure = await screen.findByText(
      'Could not copy translation. Clipboard access is unavailable.',
    );
    expect(failure).toHaveAttribute('role', 'status');
    expect(screen.queryByText('Translation copied.')).toBeNull();
    expect(writeText).toHaveBeenCalledWith('Rejected-copy translation.');
    expect(localStorageValues()).not.toContain('Rejected-copy translation.');
  });

  it('reports unavailable clipboard access without claiming translation copy success', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    vi.stubGlobal('Translator', {
      create: () => ({ translate: () => Promise.resolve('Unavailable-copy translation.') }),
    });
    const msg: ChatMessage = {
      id: 'm-translation-copy-unavailable',
      from: 'alice',
      text: 'Original unavailable-copy text.',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu msg={msg} target="#general" selfNick="bob" canEdit={false} menuOpen />
    ));
    fireEvent.click(screen.getByRole('menuitem', { name: /translate message from alice on this device/i }));
    await screen.findByText('Unavailable-copy translation.');
    const copy = screen.getByRole('button', { name: /copy translated text for message from alice/i });
    expect(copy).toBeEnabled();
    fireEvent.click(copy);

    expect(await screen.findByText(
      'Could not copy translation. Clipboard access is unavailable.',
    )).toHaveAttribute('role', 'status');
    expect(screen.queryByText('Translation copied.')).toBeNull();
    expect(localStorageValues()).not.toContain('Unavailable-copy translation.');
  });

  it('bounds concurrent on-device work across loaded message rows', async () => {
    const resolvers: Array<(value: string) => void> = [];
    const translate = vi.fn(() => new Promise<string>((resolve) => {
      resolvers.push(resolve);
    }));
    vi.stubGlobal('Translator', { create: () => ({ translate }) });
    const messages: ChatMessage[] = ['aki', 'mina', 'noa', 'ren', 'sora'].map((from, index) => ({
      id: `m-concurrent-${index}`,
      from,
      text: `Loaded message ${index}`,
      time: new Date(`2026-07-08T12:00:0${index}Z`),
      type: 'msg',
      target: '#general',
    }));

    render(() => (
      <div>
        <For each={messages}>
          {(msg) => (
            <MessageMenu msg={msg} target="#general" selfNick="bob" canEdit={false} menuOpen />
          )}
        </For>
      </div>
    ));

    for (const from of ['aki', 'mina', 'noa', 'ren']) {
      fireEvent.click(screen.getByRole('menuitem', {
        name: `Translate message from ${from} on this device`,
      }));
    }
    fireEvent.click(screen.getByRole('menuitem', {
      name: 'Translate message from sora on this device',
    }));

    await waitFor(() => expect(translate).toHaveBeenCalledTimes(4));
    expect(await screen.findByText('On-device translation is busy. Retry in a moment.')).toHaveAttribute(
      'role',
      'status',
    );
    expect(screen.getByRole('button', {
      name: 'Retry translating message from sora on this device',
    })).toBeInTheDocument();

    for (const resolve of resolvers) resolve('Done locally.');
    await waitFor(() => expect(screen.getAllByText('Done locally.')).toHaveLength(4));
  });

  it('announces local model rejection and provides retry and dismiss controls', async () => {
    const translate = vi.fn()
      .mockRejectedValueOnce(new Error('model load failed'))
      .mockResolvedValueOnce('Hello after retry.');
    vi.stubGlobal('Translator', { create: () => ({ translate }) });
    const msg: ChatMessage = {
      id: 'm-translate-retry',
      from: 'alice',
      text: 'Hola después del reintento.',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu msg={msg} target="#general" selfNick="bob" canEdit={false} menuOpen />
    ));
    fireEvent.click(screen.getByRole('menuitem', { name: /translate message from alice on this device/i }));

    const error = await screen.findByText('On-device translation failed. Retry when the local model is ready.');
    expect(error).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: /dismiss translation for message from alice/i })).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry translating message from alice on this device/i });
    fireEvent.click(retry);

    expect(await screen.findByText('Hello after retry.')).toHaveAttribute('role', 'status');
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it('translates only transient plaintext for loaded E2EE rows and never mutates the message', async () => {
    const translate = vi.fn().mockResolvedValue('Private hello translated.');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    vi.stubGlobal('Translator', { create: () => ({ translate }) });
    const msg: ChatMessage = {
      id: 'm-translate-e2ee',
      from: 'alice',
      text: 'e2ee:v1:ciphertext-envelope',
      plaintext: 'private hello',
      encrypted: true,
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: 'alice',
    };
    const original = { ...msg };

    render(() => (
      <MessageMenu msg={msg} target="alice" selfNick="bob" canEdit={false} menuOpen />
    ));
    fireEvent.click(screen.getByRole('menuitem', { name: /translate message from alice on this device/i }));

    expect(await screen.findByText('Private hello translated.')).toBeInTheDocument();
    expect(translate).toHaveBeenCalledWith('private hello');
    expect(translate).not.toHaveBeenCalledWith('e2ee:v1:ciphertext-envelope');
    expect(screen.queryByText('e2ee:v1:ciphertext-envelope')).toBeNull();
    expect(msg).toEqual(original);
    fireEvent.click(screen.getByRole('button', { name: /copy translated text for message from alice/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Private hello translated.'));
    expect(writeText).not.toHaveBeenCalledWith('private hello');
    expect(writeText).not.toHaveBeenCalledWith('e2ee:v1:ciphertext-envelope');
    expect(localStorageValues()).not.toContain('private hello');
    expect(localStorageValues()).not.toContain('Private hello translated.');
  });

  it('never offers translation or shows ciphertext for a locked E2EE row', () => {
    const create = vi.fn();
    vi.stubGlobal('Translator', { create });
    const msg: ChatMessage = {
      id: 'm-translate-e2ee-locked',
      from: 'alice',
      text: 'e2ee:v1:locked-ciphertext-envelope',
      encrypted: true,
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: 'alice',
    };

    render(() => (
      <MessageMenu msg={msg} target="alice" selfNick="bob" canEdit={false} menuOpen />
    ));

    expect(screen.queryByRole('menuitem', { name: /translate message from alice/i })).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByText('e2ee:v1:locked-ciphertext-envelope')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('discards stale completion when a loaded row is replaced', async () => {
    let resolveTranslation: ((value: string) => void) | undefined;
    const pendingTranslation = new Promise<string>((resolve) => {
      resolveTranslation = resolve;
    });
    const translate = vi.fn(() => pendingTranslation);
    vi.stubGlobal('Translator', { create: () => ({ translate }) });
    const first: ChatMessage = {
      id: 'm-stale-first',
      from: 'alice',
      text: 'Old loaded text.',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };
    const replacement: ChatMessage = {
      ...first,
      id: 'm-stale-replacement',
      from: 'mina',
      text: 'Replacement loaded text.',
    };
    const [msg, setMsg] = createSignal(first);

    render(() => (
      <MessageMenu msg={msg()} target="#general" selfNick="bob" canEdit={false} menuOpen />
    ));
    fireEvent.click(screen.getByRole('menuitem', { name: /translate message from alice on this device/i }));
    await waitFor(() => expect(translate).toHaveBeenCalledTimes(1));

    setMsg(replacement);
    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Actions for message from mina' })).toBeInTheDocument();
    });
    resolveTranslation?.('Stale translated output.');
    await Promise.resolve();

    expect(screen.queryByText('Stale translated output.')).toBeNull();
    expect(screen.getByRole('menuitem', { name: /translate message from mina on this device/i })).toBeEnabled();
  });

  it('clears pending copy feedback when its successful translation row is replaced', async () => {
    let resolveClipboard: (() => void) | undefined;
    const writeText = vi.fn(() => new Promise<void>((resolve) => {
      resolveClipboard = resolve;
    }));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    vi.stubGlobal('Translator', {
      create: () => ({ translate: () => Promise.resolve('Translation awaiting copy.') }),
    });
    const first: ChatMessage = {
      id: 'm-copy-stale-first',
      from: 'alice',
      text: 'First loaded text.',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };
    const replacement: ChatMessage = {
      ...first,
      id: 'm-copy-stale-replacement',
      from: 'mina',
      text: 'Replacement loaded text.',
    };
    const [msg, setMsg] = createSignal(first);

    render(() => (
      <MessageMenu msg={msg()} target="#general" selfNick="bob" canEdit={false} menuOpen />
    ));
    fireEvent.click(screen.getByRole('menuitem', { name: /translate message from alice on this device/i }));
    await screen.findByText('Translation awaiting copy.');
    fireEvent.click(screen.getByRole('button', { name: /copy translated text for message from alice/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Translation awaiting copy.'));
    expect(screen.getByText('Copying translation…')).toHaveAttribute('role', 'status');

    setMsg(replacement);
    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Actions for message from mina' })).toBeInTheDocument();
      expect(screen.queryByText('Copying translation…')).toBeNull();
    });
    resolveClipboard?.();
    await Promise.resolve();

    expect(screen.queryByText('Translation copied.')).toBeNull();
    expect(screen.queryByRole('button', { name: /copy translated text for message from mina/i })).toBeNull();
    expect(localStorageValues()).not.toContain('Translation awaiting copy.');
  });

  it('ignores completion after the loaded row unmounts', async () => {
    let resolveTranslation: ((value: string) => void) | undefined;
    const pendingTranslation = new Promise<string>((resolve) => {
      resolveTranslation = resolve;
    });
    const translate = vi.fn(() => pendingTranslation);
    vi.stubGlobal('Translator', { create: () => ({ translate }) });
    const msg: ChatMessage = {
      id: 'm-unmount',
      from: 'alice',
      text: 'Unmount before completion.',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    const view = render(() => (
      <MessageMenu msg={msg} target="#general" selfNick="bob" canEdit={false} menuOpen />
    ));
    fireEvent.click(screen.getByRole('menuitem', { name: /translate message from alice on this device/i }));
    await waitFor(() => expect(translate).toHaveBeenCalledTimes(1));

    view.unmount();
    resolveTranslation?.('Unmounted translated output.');
    await Promise.resolve();

    expect(screen.queryByText('Unmounted translated output.')).toBeNull();
    expect(localStorageValues()).not.toContain('Unmounted translated output.');
  });

  it('copies a shareable moment link for channel messages', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    history.pushState(null, '', '/rooms?old=1#message');
    const msg: ChatMessage = {
      id: 'm-moment',
      from: 'alice',
      text: 'pin this moment',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu
        msg={msg}
        target="#general"
        selfNick="bob"
        canEdit={false}
        menuOpen
      />
    ));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy moment link for message from alice' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('/app/?join=%23general&at=2026-07-08T12%3A00%3A00.000Z'),
      );
      expect(screen.getByRole('status')).toHaveTextContent('Moment link copied.');
    });
  });

  it('reports accessible success after copying message text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const msg: ChatMessage = {
      id: 'm-copy',
      from: 'alice',
      text: 'copy this text',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu msg={msg} target="#general" selfNick="bob" canEdit={false} menuOpen />
    ));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy text from message from alice' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('copy this text');
      expect(screen.getByRole('status')).toHaveTextContent('Message text copied.');
    });
  });

  it('copies transient plaintext from an unlocked E2EE row and never its envelope', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const msg: ChatMessage = {
      id: 'm-copy-e2ee',
      from: 'alice',
      text: 'e2ee:v1:ciphertext-envelope',
      plaintext: 'private hello',
      encrypted: true,
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: 'alice',
    };

    render(() => (
      <MessageMenu msg={msg} target="alice" selfNick="bob" canEdit={false} menuOpen />
    ));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy text from message from alice' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText).toHaveBeenCalledWith('private hello');
    expect(writeText).not.toHaveBeenCalledWith('e2ee:v1:ciphertext-envelope');
  });

  it('does not expose text-derived actions or write ciphertext for a locked E2EE row', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const msg: ChatMessage = {
      id: 'm-copy-e2ee-locked',
      from: 'alice',
      text: 'e2ee:v1:locked-ciphertext-envelope',
      encrypted: true,
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: 'alice',
    };

    render(() => (
      <MessageMenu msg={msg} target="alice" selfNick="bob" canEdit={false} menuOpen />
    ));

    expect(screen.queryByRole('menuitem', { name: /Copy text from message from alice/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Search text from message from alice/i })).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('never renders Edit for an owned unlocked encrypted row', () => {
    const msg: ChatMessage = {
      id: 'm-edit-e2ee',
      from: 'alice',
      text: 'ONYXDM1 ciphertext-envelope',
      plaintext: 'private hello',
      encrypted: true,
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: 'bob',
    };

    render(() => (
      <MessageMenu msg={msg} target="bob" selfNick="alice" canEdit menuOpen />
    ));

    expect(screen.queryByRole('menuitem', { name: 'Edit message from alice' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Reply to message from alice' })).toBeInTheDocument();
  });

  it('reports rejected clipboard writes without a persistence fallback', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const msg: ChatMessage = {
      id: 'm-copy-denied',
      from: 'alice',
      text: 'do not persist this',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu msg={msg} target="#general" selfNick="bob" canEdit={false} menuOpen />
    ));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy text from message from alice' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Could not copy message text. Clipboard access is unavailable.',
      );
    });
    expect(localStorage.getItem('onyx:last-copied-moment')).toBeNull();
  });

  it('does not enqueue clipboard feedback after the message row unmounts', async () => {
    let resolveCopy: (() => void) | undefined;
    const pendingCopy = new Promise<void>((resolve) => {
      resolveCopy = resolve;
    });
    const writeText = vi.fn(() => pendingCopy);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const addToast = vi.spyOn(store.getState(), 'addToast');
    const msg: ChatMessage = {
      id: 'm-copy-unmount',
      from: 'alice',
      text: 'belongs to the departing row',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };
    const view = render(() => (
      <MessageMenu msg={msg} target="#general" selfNick="bob" canEdit={false} menuOpen />
    ));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy text from message from alice' }));
    expect(writeText).toHaveBeenCalledOnce();
    view.unmount();
    resolveCopy?.();
    await pendingCopy;
    await Promise.resolve();

    expect(addToast).not.toHaveBeenCalled();
  });

  it('reports an unavailable clipboard when copying a moment without saving it locally', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    const msg: ChatMessage = {
      id: 'm-moment-unavailable',
      from: 'alice',
      text: 'moment without clipboard',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu msg={msg} target="#general" selfNick="bob" canEdit={false} menuOpen />
    ));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy moment link for message from alice' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Could not copy moment link. Clipboard access is unavailable.',
      );
    });
    expect(localStorage.getItem('onyx:last-copied-moment')).toBeNull();
  });

  it('opens message search prefilled from a selected moment', () => {
    store.setState({
      ...initialState,
      activeView: { kind: 'channel', channel: '#general' },
    }, true);
    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      const msg: ChatMessage = {
        id: 'm-search',
        from: 'alice',
        text: 'Release blockers for mobile onboarding today',
        time: new Date('2026-07-08T12:00:00Z'),
        type: 'msg',
        target: '#general',
      };

      render(() => (
        <MessageMenu
          msg={msg}
          target="#general"
          selfNick="bob"
          canEdit={false}
          menuOpen
        />
      ));

      fireEvent.click(screen.getByRole('menuitem', { name: 'Search text from message from alice' }));

      expect(search.isOpen()).toBe(true);
      expect(search.query()).toBe('Release blockers for mobile onboarding today');
    });
    dispose();
  });

  it('searches transient plaintext from an unlocked E2EE row and never its envelope', () => {
    store.setState({
      ...initialState,
      activeView: { kind: 'dm', nick: 'alice' },
    }, true);
    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      const search = useMessageSearch();
      const msg: ChatMessage = {
        id: 'm-search-e2ee',
        from: 'alice',
        text: 'e2ee:v1:ciphertext-envelope',
        plaintext: 'private release blockers',
        encrypted: true,
        time: new Date('2026-07-08T12:00:00Z'),
        type: 'msg',
        target: 'alice',
      };

      render(() => (
        <MessageMenu msg={msg} target="alice" selfNick="bob" canEdit={false} menuOpen />
      ));

      fireEvent.click(screen.getByRole('menuitem', { name: 'Search text from message from alice' }));

      expect(search.isOpen()).toBe(true);
      expect(search.query()).toBe('private release blockers');
      expect(search.query()).not.toContain('e2ee:v1');
    });
    dispose();
  });

  it('starts a named conversation from a channel message', () => {
    const msg: ChatMessage = {
      id: 'm-topic',
      from: 'alice',
      text: 'Release blockers for mobile onboarding today',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu
        msg={msg}
        target="#general"
        selfNick="bob"
        canEdit={false}
        menuOpen
      />
    ));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Start topic from message from alice' }));

    expect(store.getState().activeChannelTopics.get('#general')).toBe('Release blockers for mobile onboarding today');
    expect(store.getState().replyingTo).toMatchObject({ id: 'm-topic', from: 'alice' });
  });

  it('moves focus into the menu (first item) when the overflow menu opens', async () => {
    const msg: ChatMessage = {
      id: 'm-focus',
      from: 'alice',
      text: 'Release blockers for mobile onboarding today',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu msg={msg} target="#general" selfNick="alice" canEdit canRedact menuOpen />
    ));

    const firstItem = screen.getByRole('menuitem', { name: 'Copy text from message from alice' });
    // Focus is moved on open (queueMicrotask), so wait for it to settle.
    await waitFor(() => expect(document.activeElement).toBe(firstItem));
    // Roving tabindex: only the focused item is in the Tab sequence.
    expect(firstItem).toHaveAttribute('tabindex', '0');
    expect(
      screen.getByRole('menuitem', { name: 'Copy moment link for message from alice' }),
    ).toHaveAttribute('tabindex', '-1');
  });

  it('navigates menu items with Arrow, Home and End keys (roving focus)', async () => {
    const msg: ChatMessage = {
      id: 'm-arrows',
      from: 'alice',
      text: 'Release blockers for mobile onboarding today',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu msg={msg} target="#general" selfNick="alice" canEdit canRedact menuOpen />
    ));

    const menu = screen.getByRole('menu', { name: 'More actions for message from alice' });
    const first = screen.getByRole('menuitem', { name: 'Copy text from message from alice' });
    const second = screen.getByRole('menuitem', { name: 'Copy moment link for message from alice' });
    const last = screen.getByRole('menuitem', { name: 'Delete message from alice for everyone' });

    await waitFor(() => expect(document.activeElement).toBe(first));

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    expect(second).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);

    // Wrap: ArrowUp from the first item lands on the last.
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(last);
  });

  it('labels repeated message controls and menus with the message author', () => {
    const msg: ChatMessage = {
      id: 'm-access',
      from: 'alice',
      text: 'Release blockers for mobile onboarding today',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu
        msg={msg}
        target="#general"
        selfNick="alice"
        canEdit
        canRedact
        menuOpen
      />
    ));

    expect(screen.getByRole('group', { name: 'Actions for message from alice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose reaction for message from alice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions for message from alice' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'More actions for message from alice' })).toBeInTheDocument();
    expect(screen.getByRole('menu', { name: 'More actions for message from alice' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy text from message from alice' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Reply to message from alice' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Edit message from alice' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete message from alice for everyone' })).toBeInTheDocument();
  });

  it('fails closed by hiding delete when REDACT was not negotiated', () => {
    const msg: ChatMessage = {
      id: 'm-no-redact',
      from: 'alice',
      text: 'This must remain visible.',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu msg={msg} target="#general" selfNick="alice" canEdit menuOpen />
    ));

    expect(screen.queryByRole('menuitem', { name: /delete message from alice/i })).toBeNull();
  });

  it('disarms an open confirmation when REDACT authority disappears', async () => {
    const remove = vi.spyOn(store.getState(), 'deleteMessage').mockImplementation(() => {});
    const [canRedact, setCanRedact] = createSignal(true);
    const msg: ChatMessage = {
      id: 'm-redact-cap-loss',
      from: 'alice',
      text: 'Authority can change during reconnect.',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu
        msg={msg}
        target="#general"
        selfNick="alice"
        canEdit
        canRedact={canRedact()}
        menuOpen
      />
    ));
    fireEvent.click(screen.getByRole('menuitem', {
      name: 'Delete message from alice for everyone',
    }));
    expect(screen.getByRole('group', {
      name: 'Confirm deleting message from alice for everyone',
    })).toBeInTheDocument();

    setCanRedact(false);

    await waitFor(() => {
      expect(screen.queryByRole('group', {
        name: 'Confirm deleting message from alice for everyone',
      })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: /delete message from alice/i })).toBeNull();
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('reviews REDACT explicitly, focuses the safe action, and restores delete focus on cancel', async () => {
    const remove = vi.spyOn(store.getState(), 'deleteMessage').mockImplementation(() => {});
    const msg: ChatMessage = {
      id: 'm-confirm-redact',
      from: 'alice',
      text: 'Delete only after review.',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };

    render(() => (
      <MessageMenu
        msg={msg}
        target="#general"
        selfNick="alice"
        canEdit
        canRedact
        menuOpen
      />
    ));

    const deleteAction = screen.getByRole('menuitem', {
      name: 'Delete message from alice for everyone',
    });
    const dialog = screen.getByRole('dialog', { name: 'More actions for message from alice' });
    dialog.scrollTop = 96;
    fireEvent.click(deleteAction);

    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu', { name: 'More actions for message from alice' })).toBeNull();
    const confirmation = screen.getByRole('group', {
      name: 'Confirm deleting message from alice for everyone',
    });
    expect(confirmation).toHaveTextContent('cannot be undone');
    const keep = screen.getByRole('button', { name: 'Keep message from alice' });
    await waitFor(() => {
      expect(document.activeElement).toBe(keep);
      expect(dialog.scrollTop).toBe(0);
    });

    fireEvent.click(keep);
    const restoredDelete = await screen.findByRole('menuitem', {
      name: 'Delete message from alice for everyone',
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(restoredDelete);
      expect(restoredDelete).toHaveAttribute('tabindex', '0');
      expect(screen.getByRole('menuitem', {
        name: 'Copy text from message from alice',
      })).toHaveAttribute('tabindex', '-1');
    });
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(restoredDelete);
    const confirm = screen.getByRole('button', {
      name: 'Confirm deleting message from alice for everyone',
    });
    fireEvent.click(confirm);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('#general', 'm-confirm-redact');
  });

  it('keeps the reaction picker open while an input method owns Escape', () => {
    const msg: ChatMessage = {
      id: 'm-reaction-ime',
      from: 'alice',
      text: 'React after composition',
      time: new Date('2026-07-08T12:00:00Z'),
      type: 'msg',
      target: '#general',
    };
    render(() => <MessageMenu msg={msg} target="#general" selfNick="alice" canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose reaction for message from alice' }));
    const search = screen.getByRole('textbox', { name: 'Search emoji' });

    fireEvent.keyDown(search, { key: 'Escape', keyCode: 229, isComposing: true });

    expect(screen.getByRole('dialog', { name: 'Choose reaction for message from alice' })).toBeInTheDocument();

    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Choose reaction for message from alice' })).toBeNull();
  });
});
