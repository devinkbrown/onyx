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
import { store, type Server } from '@/lib/store/store';
import { followed, isFollowed, unfollow } from '@/lib/notifications/followed';
import * as messageSearch from '@/shell/search/useMessageSearch';
import { SHORTCUTS, type ShortcutGroup } from './useKeyboardShortcuts';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const ALL_GROUPS: ShortcutGroup[] = ['Navigation', 'Chat', 'View', 'Voice & Video', 'Palette'];
const initialState = store.getInitialState();
const MEMORY_OWNER = { serverUrl: 'wss://shortcuts.test', identity: 'me' } as const;
const memoryServer: Server = {
  id: 'keyboard-shortcuts',
  name: 'Shortcuts',
  network: 'Shortcuts',
  url: MEMORY_OWNER.serverUrl,
  icon: '',
  nick: MEMORY_OWNER.identity,
  account: MEMORY_OWNER.identity,
  connected: true,
};

function mountKeyboardHarness(): () => void {
  let disposeRoot: (() => void) | null = null;
  createRoot((dispose) => {
    disposeRoot = dispose;
    useKeyboardShortcuts();
  });
  return () => disposeRoot?.();
}

function appendModalButton(): { dialog: HTMLDivElement; button: HTMLButtonElement } {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const button = document.createElement('button');
  button.type = 'button';
  dialog.append(button);
  document.body.append(dialog);
  button.focus();
  return { dialog, button };
}

describe('SHORTCUTS descriptor', () => {
  beforeEach(() => {
    store.setState({ ...initialState, server: memoryServer, ourNick: MEMORY_OWNER.identity }, true);
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
    expect(SHORTCUTS.find((s) => s.keys === 'G then D')?.description).toBe('Open jump-to-date');
  });

  it('includes U for following the current conversation', () => {
    const found = SHORTCUTS.find((s) => s.keys === 'U');
    expect(found).toBeDefined();
    expect(found!.group).toBe('Chat');
  });

  it('includes Cmd/Ctrl+B for starring the current room', () => {
    const found = SHORTCUTS.find((s) => s.keys.includes('Ctrl+B'));
    expect(found).toBeDefined();
    expect(found!.description).toBe('Star / unstar room');
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

  it('includes Cmd/Ctrl+Shift+L for schedule send later', () => {
    const found = SHORTCUTS.find((s) => s.keys.includes('Ctrl+Shift+L'));
    expect(found).toBeDefined();
    expect(found!.description).toBe('Schedule message to send later');
    expect(found!.group).toBe('Chat');
  });

  it('includes Esc shortcut', () => {
    const found = SHORTCUTS.find((s) => s.keys.includes('Esc'));
    expect(found).toBeDefined();
  });

  it('includes registry-backed chords wired through the live hook', () => {
    expect(SHORTCUTS.find((s) => s.keys.includes('Ctrl+F'))?.description).toBe('Search messages');
    expect(SHORTCUTS.find((s) => s.keys.includes('Ctrl+Shift+A'))?.description).toBe('Open account');
    expect(SHORTCUTS.find((s) => s.keys.includes('Ctrl+Shift+E'))?.description).toBe('Mark conversation read');
    expect(SHORTCUTS.find((s) => s.keys.includes('Ctrl+B'))?.description).toBe('Star / unstar room');
    expect(SHORTCUTS.find((s) => s.keys.includes('Ctrl+Shift+D'))?.description).toBe('Toggle do not disturb');
    expect(SHORTCUTS.find((s) => s.keys.includes('Alt+S'))?.description).toBe('Focus room sidebar');
    expect(SHORTCUTS.find((s) => s.keys.includes('Ctrl+Shift+U'))?.description).toBe('Attach a file');
    expect(SHORTCUTS.find((s) => s.keys.includes('Ctrl+Shift+L'))?.description).toBe(
      'Schedule message to send later',
    );
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

  it('leaves app-global shortcuts inert while an IME owns the keyboard', () => {
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
      activeView: { kind: 'channel', channel: '#general' },
    });
    closePreferences();

    fireEvent.keyDown(window, { key: 'n', isComposing: true });
    fireEvent.keyDown(window, { key: ',', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(window, { key: 'r', ctrlKey: true, shiftKey: true, isComposing: true });

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });
    expect(isPreferencesOpen()).toBe(false);
    expect(preferences().readerMode).toBe(false);
    dispose();
  });

  it('cancels a pending G sequence when IME composition starts', () => {
    const dispose = mountKeyboardHarness();
    store.setState({ activeView: { kind: 'channel', channel: '#general' } });

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'h', isComposing: true });
    fireEvent.keyDown(window, { key: 'h' });

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });
    dispose();
  });

  it('suppresses app-global shortcuts while a modal button owns focus, then resumes after removal', () => {
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
      activeView: { kind: 'channel', channel: '#general' },
    });
    closePreferences();
    const { dialog, button } = appendModalButton();

    fireEvent.keyDown(button, { key: 'n' });
    fireEvent.keyDown(button, { key: ',', ctrlKey: true });
    fireEvent.keyDown(button, { key: ',', metaKey: true });
    fireEvent.keyDown(button, { key: 'r', ctrlKey: true, shiftKey: true });

    expect(document.activeElement).toBe(button);
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });
    expect(isPreferencesOpen()).toBe(false);
    expect(preferences().readerMode).toBe(false);

    dialog.remove();
    fireEvent.keyDown(window, { key: 'n' });
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#alerts' });

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

  it('lands on the authoritative first unread message when N changes conversations', () => {
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
        ['#alerts', channel('#alerts', 2)],
      ]),
      activeView: { kind: 'channel', channel: '#general' },
      firstUnreadId: new Map([['#alerts', 'alert-first']]),
    });

    fireEvent.keyDown(window, { key: 'n' });

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#alerts' });
    expect(store.getState().timeTravelLandingId).toBe('alert-first');
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
    expect(isFollowed('#general', null, MEMORY_OWNER)).toBe(true);
    fireEvent.keyDown(window, { key: 'u' });
    expect(isFollowed('#general', null, MEMORY_OWNER)).toBe(false);
    dispose();
  });

  it('toggles starring the active channel with Ctrl+B', () => {
    const dispose = mountKeyboardHarness();
    store.setState({
      activeView: { kind: 'channel', channel: '#general' },
      starredChannels: new Set(),
    });

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(store.getState().starredChannels.has('#general')).toBe(true);

    fireEvent.keyDown(window, { key: 'B', metaKey: true });
    expect(store.getState().starredChannels.has('#general')).toBe(false);
    dispose();
  });

  it('does not star from Ctrl+B on home or DM views', () => {
    const dispose = mountKeyboardHarness();
    store.setState({
      activeView: { kind: 'home' },
      starredChannels: new Set(),
    });

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(store.getState().starredChannels.size).toBe(0);

    store.setState({ activeView: { kind: 'dm', nick: 'trev' } });
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(store.getState().starredChannels.size).toBe(0);
    dispose();
  });

  it('does not star from Ctrl+B inside editable targets', () => {
    const dispose = mountKeyboardHarness();
    const input = document.createElement('input');
    document.body.append(input);
    store.setState({
      activeView: { kind: 'channel', channel: '#general' },
      starredChannels: new Set(),
    });

    fireEvent.keyDown(input, { key: 'b', ctrlKey: true });
    expect(store.getState().starredChannels.size).toBe(0);
    input.remove();
    dispose();
  });

  it('toggles the selected named conversation with U instead of the whole room', () => {
    const dispose = mountKeyboardHarness();
    store.setState({
      activeView: { kind: 'channel', channel: '#general' },
      activeChannelTopics: new Map([['#general', 'roadmap']]),
    });

    fireEvent.keyDown(window, { key: 'u' });
    expect(isFollowed('#general', 'roadmap', MEMORY_OWNER)).toBe(true);
    expect(isFollowed('#general', null, MEMORY_OWNER)).toBe(false);
    fireEvent.keyDown(window, { key: 'u' });
    expect(isFollowed('#general', 'roadmap', MEMORY_OWNER)).toBe(false);
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

  it('clears a pending G sequence when a modal takes keyboard ownership', () => {
    const dispose = mountKeyboardHarness();
    store.setState({ activeView: { kind: 'channel', channel: '#general' } });

    fireEvent.keyDown(window, { key: 'g' });
    const { dialog, button } = appendModalButton();
    fireEvent.keyDown(button, { key: 'h' });
    expect(document.activeElement).toBe(button);
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });

    dialog.remove();
    fireEvent.keyDown(window, { key: 'h' });
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });

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

  it('cancels a pending G sequence when a modified key intervenes', () => {
    const dispose = mountKeyboardHarness();
    store.setState({ activeView: { kind: 'channel', channel: '#general' } });

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'h', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'h' });

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });
    dispose();
  });

  it('cancels a pending G sequence when a Meta-modified continuation key intervenes', () => {
    const dispose = mountKeyboardHarness();
    store.setState({ activeView: { kind: 'channel', channel: '#general' } });

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'h', metaKey: true });
    fireEvent.keyDown(window, { key: 'h' });

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });
    dispose();
  });

  it('clears a pending G sequence when a global preference chord runs', () => {
    const dispose = mountKeyboardHarness();
    store.setState({ activeView: { kind: 'channel', channel: '#general' } });
    closePreferences();

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'h' });

    expect(isPreferencesOpen()).toBe(true);
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });
    closePreferences();
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

  it('does not arm G sequences from editable targets', () => {
    const dispose = mountKeyboardHarness();
    const input = document.createElement('input');
    document.body.append(input);
    store.setState({ activeView: { kind: 'channel', channel: '#general' } });

    fireEvent.keyDown(input, { key: 'g' });
    fireEvent.keyDown(window, { key: 'h' });

    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#general' });
    input.remove();
    dispose();
  });

  it('opens jump-to-date and focuses the scrubber date with G then D', () => {
    const dispose = mountKeyboardHarness();
    const input = document.createElement('input');
    input.setAttribute('data-time-scrubber-date', '');
    document.body.append(input);

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'd' });

    expect(store.getState().showJumpToDate).toBe(true);
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

  it('does not steal Enter from controls that advertise aria-controls', () => {
    const dispose = mountKeyboardHarness();
    const trigger = document.createElement('div');
    trigger.tabIndex = 0;
    trigger.setAttribute('aria-controls', 'menu');
    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-composer-input', '');
    document.body.append(trigger, textarea);
    trigger.focus();

    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
    textarea.remove();
    dispose();
  });

  it('opens message search with Ctrl+F', () => {
    const dispose = mountKeyboardHarness();
    const openSpy = vi.spyOn(messageSearch, 'openMessageSearch');

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });

    expect(openSpy).toHaveBeenCalledTimes(1);
    openSpy.mockRestore();
    dispose();
  });

  it('opens account with Ctrl+Shift+A', () => {
    const dispose = mountKeyboardHarness();
    store.setState({ showAccount: false });

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true, shiftKey: true });

    expect(store.getState().showAccount).toBe(true);
    store.getState().closeAccount();
    dispose();
  });

  it('marks the active channel read with Ctrl+Shift+E', () => {
    const dispose = mountKeyboardHarness();
    const channel: Channel = {
      name: '#general',
      topic: '',
      topicSetBy: '',
      topicSetAt: null,
      modes: '',
      users: new Map(),
      unread: 4,
      highlights: 1,
      createdAt: null,
      messages: [],
    };
    store.setState({
      channels: new Map([['#general', channel]]),
      activeView: { kind: 'channel', channel: '#general' },
      channelUnread: { '#general': 4 },
      channelMentions: { '#general': 1 },
    });

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true, shiftKey: true });

    expect(store.getState().channels.get('#general')?.unread).toBe(0);
    expect(store.getState().channels.get('#general')?.highlights).toBe(0);
    expect(store.getState().channelUnread['#general']).toBe(0);
    dispose();
  });

  it('toggles do-not-disturb with Ctrl+Shift+D', () => {
    const dispose = mountKeyboardHarness();
    store.setState({ dndEnabled: false });

    fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true });
    expect(store.getState().dndEnabled).toBe(true);

    fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true });
    expect(store.getState().dndEnabled).toBe(false);
    dispose();
  });

  it('focuses the room sidebar with Alt+S', () => {
    const dispose = mountKeyboardHarness();
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('data-sidebar-item', '');
    item.setAttribute('aria-current', 'page');
    document.body.append(item);

    fireEvent.keyDown(window, { key: 's', altKey: true });

    expect(document.activeElement).toBe(item);
    item.remove();
    dispose();
  });

  it('clicks the attach tool with Ctrl+Shift+U', () => {
    const dispose = mountKeyboardHarness();
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', 'Attach files');
    const click = vi.fn();
    button.addEventListener('click', click);
    document.body.append(button);

    fireEvent.keyDown(window, { key: 'u', ctrlKey: true, shiftKey: true });

    expect(click).toHaveBeenCalledTimes(1);
    button.remove();
    dispose();
  });

  it('opens the schedule picker with Ctrl+Shift+L from the composer', () => {
    const dispose = mountKeyboardHarness();
    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-composer-input', '');
    const scheduleBtn = document.createElement('button');
    scheduleBtn.type = 'button';
    scheduleBtn.setAttribute('data-composer-schedule', '');
    const click = vi.fn();
    scheduleBtn.addEventListener('click', click);
    document.body.append(textarea, scheduleBtn);
    textarea.focus();

    fireEvent.keyDown(textarea, { key: 'l', ctrlKey: true, shiftKey: true });

    expect(click).toHaveBeenCalledTimes(1);
    textarea.remove();
    scheduleBtn.remove();
    dispose();
  });

  it('opens the schedule picker with Ctrl+Shift+L outside editable targets', () => {
    const dispose = mountKeyboardHarness();
    const scheduleBtn = document.createElement('button');
    scheduleBtn.type = 'button';
    scheduleBtn.setAttribute('data-composer-schedule', '');
    const click = vi.fn();
    scheduleBtn.addEventListener('click', click);
    document.body.append(scheduleBtn);

    fireEvent.keyDown(window, { key: 'L', ctrlKey: true, shiftKey: true });

    expect(click).toHaveBeenCalledTimes(1);
    scheduleBtn.remove();
    dispose();
  });

  it('does not open schedule with Ctrl+Shift+L from non-composer editables', () => {
    const dispose = mountKeyboardHarness();
    const input = document.createElement('input');
    const scheduleBtn = document.createElement('button');
    scheduleBtn.type = 'button';
    scheduleBtn.setAttribute('data-composer-schedule', '');
    const click = vi.fn();
    scheduleBtn.addEventListener('click', click);
    document.body.append(input, scheduleBtn);
    input.focus();

    fireEvent.keyDown(input, { key: 'l', ctrlKey: true, shiftKey: true });

    expect(click).not.toHaveBeenCalled();
    input.remove();
    scheduleBtn.remove();
    dispose();
  });

  it('does not click a disabled schedule control', () => {
    const dispose = mountKeyboardHarness();
    const scheduleBtn = document.createElement('button');
    scheduleBtn.type = 'button';
    scheduleBtn.disabled = true;
    scheduleBtn.setAttribute('data-composer-schedule', '');
    const click = vi.fn();
    scheduleBtn.addEventListener('click', click);
    document.body.append(scheduleBtn);

    fireEvent.keyDown(window, { key: 'l', ctrlKey: true, shiftKey: true });

    expect(click).not.toHaveBeenCalled();
    scheduleBtn.remove();
    dispose();
  });

  it('stars and unstars the active channel with Ctrl+B', () => {
    const dispose = mountKeyboardHarness();
    store.setState({ activeView: { kind: 'channel', channel: '#general' } });

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(store.getState().starredChannels.has('#general')).toBe(true);

    fireEvent.keyDown(window, { key: 'B', metaKey: true });
    expect(store.getState().starredChannels.has('#general')).toBe(false);
    dispose();
  });

  it('does not star channels from home or DM views', () => {
    const dispose = mountKeyboardHarness();
    store.setState({ activeView: { kind: 'home' } });

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(store.getState().starredChannels.size).toBe(0);

    store.setState({ activeView: { kind: 'dm', nick: 'trev' } });
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(store.getState().starredChannels.size).toBe(0);
    dispose();
  });

  it('does not star a channel from editable targets', () => {
    const dispose = mountKeyboardHarness();
    const input = document.createElement('input');
    document.body.append(input);
    store.setState({ activeView: { kind: 'channel', channel: '#general' } });

    fireEvent.keyDown(input, { key: 'b', ctrlKey: true });
    expect(store.getState().starredChannels.has('#general')).toBe(false);
    input.remove();
    dispose();
  });
});
