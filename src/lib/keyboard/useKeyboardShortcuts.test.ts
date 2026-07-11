// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * src/lib/keyboard/useKeyboardShortcuts.test.ts
 *
 * Unit tests for the SHORTCUTS descriptor list and the pure helper logic
 * (group membership, keys coverage), plus focused DOM checks for shortcuts that
 * only live in the global hook.
 */
import { fireEvent } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/lib/irc/types';
import { closePreferences, isPreferencesOpen, preferences, resetPreferences } from '@/lib/prefs/preferences';
import { store } from '@/lib/store/store';
import { followed, isFollowed, unfollow } from '@/lib/notifications/followed';
import { SHORTCUTS, type ShortcutGroup } from './useKeyboardShortcuts';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const ALL_GROUPS: ShortcutGroup[] = ['Navigation', 'Chat', 'View', 'Voice & Video', 'Palette'];
const initialState = store.getInitialState();

function mountKeyboardHarness(): () => void {
  let disposeRoot: (() => void) | null = null;
  createRoot((dispose) => {
    disposeRoot = dispose;
    useKeyboardShortcuts();
  });
  return () => disposeRoot?.();
}

describe('SHORTCUTS descriptor', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    for (const key of followed()) unfollow(key);
    localStorage.clear();
    resetPreferences();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetPreferences();
  });

  it('is a non-empty array', () => {
    expect(SHORTCUTS.length).toBeGreaterThan(0);
  });

  it('every entry has a non-empty keys and description string', () => {
    for (const s of SHORTCUTS) {
      expect(s.keys.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it('every entry belongs to a valid group', () => {
    for (const s of SHORTCUTS) {
      expect(ALL_GROUPS).toContain(s.group);
    }
  });

  it('includes Cmd/Ctrl+K palette shortcut', () => {
    const found = SHORTCUTS.find((s) => s.keys.includes('⌘K'));
    expect(found).toBeDefined();
    expect(found!.group).toBe('Palette');
  });

  it('includes "?" shortcut for help overlay', () => {
    const found = SHORTCUTS.find((s) => s.keys === '?');
    expect(found).toBeDefined();
  });

  it('includes Alt+↑ and Alt+↓ for navigation', () => {
    const up = SHORTCUTS.find((s) => s.keys.includes('Alt+↑'));
    const down = SHORTCUTS.find((s) => s.keys.includes('Alt+↓'));
    expect(up).toBeDefined();
    expect(down).toBeDefined();
    expect(up!.group).toBe('Navigation');
    expect(down!.group).toBe('Navigation');
  });

  it('includes Alt+M for member list toggle', () => {
    const found = SHORTCUTS.find((s) => s.keys.includes('Alt+M'));
    expect(found).toBeDefined();
    expect(found!.group).toBe('View');
  });

  it('includes N for unread navigation', () => {
    const found = SHORTCUTS.find((s) => s.keys === 'N');
    expect(found).toBeDefined();
    expect(found!.group).toBe('Navigation');
  });

  it('includes J/K for message navigation', () => {
    expect(SHORTCUTS.find((s) => s.keys === 'J')?.description).toBe('Move to next message');
    expect(SHORTCUTS.find((s) => s.keys === 'K')?.description).toBe('Move to previous message');
  });

  it('includes G sequences for Home and date navigation', () => {
    expect(SHORTCUTS.find((s) => s.keys === 'G then H')?.description).toBe('Go to Home');
    expect(SHORTCUTS.find((s) => s.keys === 'G then D')?.description).toBe('Focus jump date');
  });

  it('includes U for following the current conversation', () => {
    const found = SHORTCUTS.find((s) => s.keys === 'U');
    expect(found).toBeDefined();
    expect(found!.group).toBe('Chat');
  });

  it('includes Cmd/Ctrl+Shift+R for reader mode', () => {
    const found = SHORTCUTS.find((s) => s.keys.includes('Ctrl+Shift+R'));
    expect(found).toBeDefined();
    expect(found!.group).toBe('View');
  });

  it('includes Cmd/Ctrl+, for preferences', () => {
    const found = SHORTCUTS.find((s) => s.keys.includes('Ctrl+,'));
    expect(found).toBeDefined();
    expect(found!.group).toBe('View');
  });

  it('includes Enter for composer focus', () => {
    const found = SHORTCUTS.find((s) => s.keys.includes('Enter') && s.description === 'Focus message composer');
    expect(found).toBeDefined();
    expect(found!.group).toBe('Chat');
  });

  it('includes Esc shortcut', () => {
    const found = SHORTCUTS.find((s) => s.keys.includes('Esc'));
    expect(found).toBeDefined();
  });

  it('has no duplicate keys strings', () => {
    const keysSet = new Set(SHORTCUTS.map((s) => s.keys));
    expect(keysSet.size).toBe(SHORTCUTS.length);
  });

  it('toggles reader mode with Ctrl+Shift+R outside editable targets', () => {
    const dispose = mountKeyboardHarness();

    expect(preferences().readerMode).toBe(false);
    fireEvent.keyDown(window, { key: 'r', ctrlKey: true, shiftKey: true });
    expect(preferences().readerMode).toBe(true);
    fireEvent.keyDown(window, { key: 'R', ctrlKey: true, shiftKey: true });
    expect(preferences().readerMode).toBe(false);
    dispose();
  });

  it('opens preferences with Ctrl+comma even from editable targets', () => {
    const dispose = mountKeyboardHarness();
    const input = document.createElement('input');
    document.body.append(input);
    closePreferences();

    fireEvent.keyDown(input, { key: ',', ctrlKey: true });

    expect(isPreferencesOpen()).toBe(true);
    input.remove();
    closePreferences();
    dispose();
  });

  it('does not toggle reader mode from editable targets', () => {
    const dispose = mountKeyboardHarness();
    const input = document.createElement('input');
    document.body.append(input);

    fireEvent.keyDown(input, { key: 'r', ctrlKey: true, shiftKey: true });
    expect(preferences().readerMode).toBe(false);
    input.remove();
    dispose();
  });

  it('jumps to the next unread conversation with N', () => {
    const dispose = mountKeyboardHarness();
    const channel = (name: string, unread: number): Channel => ({
      name,
      topic: '',
      topicSetBy: '',
      topicSetAt: null,
      modes: '',
      users: new Map(),
      unread,
      highlights: 0,
      createdAt: null,
      messages: [],
    });
    store.setState({
      channels: new Map([
        ['#general', channel('#general', 0)],
        ['#alerts', channel('#alerts', 3)],
      ]),
      dms: new Map([
        ['trev', { nick: 'trev', account: null, unread: 1, highlights: 0, messages: [] }],
      ]),
      activeView: { kind: 'channel', channel: '#general' },
    });

    fireEvent.keyDown(window, { key: 'n' });
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#alerts' });

    fireEvent.keyDown(window, { key: 'n' });
    expect(store.getState().activeView).toEqual({ kind: 'dm', nick: 'trev' });
    dispose();
  });

  it('moves through transcript messages with J and K', () => {
    const dispose = mountKeyboardHarness();
    const feed = document.createElement('div');
    feed.className = 'shell-feed';
    const first = document.createElement('article');
    const second = document.createElement('article');
    const third = document.createElement('article');
    for (const [node, id] of [[first, 'm1'], [second, 'm2'], [third, 'm3']] as const) {
      node.tabIndex = 0;
      node.dataset.messageSearchId = id;
      feed.append(node);
    }
    document.body.append(feed);

    fireEvent.keyDown(window, { key: 'j' });
    expect(document.activeElement).toBe(first);
    expect(store.getState().timeTravelLandingId).toBe('m1');

    fireEvent.keyDown(window, { key: 'j' });
    expect(document.activeElement).toBe(second);
    expect(store.getState().timeTravelLandingId).toBe('m2');

    fireEvent.keyDown(window, { key: 'k' });
    expect(document.activeElement).toBe(first);
    expect(store.getState().timeTravelLandingId).toBe('m1');

    store.getState().clearTimeTravelLanding();
    first.blur();
    fireEvent.keyDown(window, { key: 'k' });
    expect(document.activeElement).toBe(third);
    expect(store.getState().timeTravelLandingId).toBe('m3');

    feed.remove();
    dispose();
  });

  it('does not steal J/K from focused interactive controls', () => {
    const dispose = mountKeyboardHarness();
    const button = document.createElement('button');
    button.type = 'button';
    const row = document.createElement('article');
    row.tabIndex = 0;
    row.dataset.messageSearchId = 'm1';
    document.body.append(button, row);
    button.focus();

    fireEvent.keyDown(button, { key: 'j' });

    expect(document.activeElement).toBe(button);
    expect(store.getState().timeTravelLandingId).toBeNull();
    button.remove();
    row.remove();
    dispose();
  });

  it('toggles following the current conversation with U', () => {
    const dispose = mountKeyboardHarness();
    store.setState({ activeView: { kind: 'channel', channel: '#general' } });

    fireEvent.keyDown(window, { key: 'u' });
    expect(isFollowed('#general')).toBe(true);
    fireEvent.keyDown(window, { key: 'u' });
    expect(isFollowed('#general')).toBe(false);
    dispose();
  });

  it('navigates home with the G then H sequence', () => {
    const dispose = mountKeyboardHarness();
    store.setState({ activeView: { kind: 'channel', channel: '#general' } });

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'h' });

    expect(store.getState().activeView).toEqual({ kind: 'home' });
    dispose();
  });

  it('cancels a pending G sequence when the next key is not part of the sequence', () => {
    const dispose = mountKeyboardHarness();
    store.setState({ activeView: { kind: 'channel', channel: '#general' } });

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'x' });
    fireEvent.keyDown(window, { key: 'h' });

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });
    dispose();
  });

  it('expires a pending G sequence before accepting the second chord', () => {
    vi.useFakeTimers();
    const dispose = mountKeyboardHarness();
    store.setState({ activeView: { kind: 'channel', channel: '#general' } });

    fireEvent.keyDown(window, { key: 'g' });
    vi.advanceTimersByTime(1201);
    fireEvent.keyDown(window, { key: 'h' });

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });
    dispose();
  });

  it('clears a pending G sequence when focus moves into an editable target', () => {
    const dispose = mountKeyboardHarness();
    const input = document.createElement('input');
    document.body.append(input);
    store.setState({ activeView: { kind: 'channel', channel: '#general' } });

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(input, { key: 'a' });
    fireEvent.keyDown(window, { key: 'h' });

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });
    input.remove();
    dispose();
  });

  it('focuses the time scrubber date input with the G then D sequence', () => {
    const dispose = mountKeyboardHarness();
    const input = document.createElement('input');
    input.setAttribute('data-time-scrubber-date', '');
    document.body.append(input);

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'd' });

    expect(document.activeElement).toBe(input);
    input.remove();
    dispose();
  });

  it('focuses the composer with plain Enter outside editable targets', () => {
    const dispose = mountKeyboardHarness();
    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-composer-input', '');
    document.body.append(textarea);

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(document.activeElement).toBe(textarea);
    textarea.remove();
    dispose();
  });

  it('keeps Alt+Enter as a composer focus shortcut', () => {
    const dispose = mountKeyboardHarness();
    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-composer-input', '');
    document.body.append(textarea);

    fireEvent.keyDown(window, { key: 'Enter', altKey: true });

    expect(document.activeElement).toBe(textarea);
    textarea.remove();
    dispose();
  });

  it('does not steal Enter from editable targets', () => {
    const dispose = mountKeyboardHarness();
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-composer-input', '');
    document.body.append(input, textarea);
    input.focus();

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(document.activeElement).toBe(input);
    input.remove();
    textarea.remove();
    dispose();
  });

  it('does not steal Enter from focused buttons', () => {
    const dispose = mountKeyboardHarness();
    const button = document.createElement('button');
    button.type = 'button';
    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-composer-input', '');
    document.body.append(button, textarea);
    button.focus();

    fireEvent.keyDown(button, { key: 'Enter' });

    expect(document.activeElement).toBe(button);
    button.remove();
    textarea.remove();
    dispose();
  });
});
