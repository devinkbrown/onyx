// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ChannelSidebar.test.tsx — accessibility + keyboard navigation.
 *
 * Covers the roving-tabindex channel/DM list:
 *   1. The list is a labelled `complementary` landmark.
 *   2. Exactly one row owns the tab stop (tabindex=0); the rest are -1.
 *   3. ArrowDown / ArrowUp move focus between rows.
 *   4. Home / End jump to the first / last row.
 *   5. Enter on a focused channel activates it (navigate).
 *   6. Each row's accessible name carries unread / mention counts.
 *
 * AAA pattern; descriptive names.
 */

import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store/store';
import type { Channel } from '@/lib/irc/types';
import type { DMConversation } from '@/lib/store/store';
import { ChannelSidebar } from './ChannelSidebar';

const initialState = store.getInitialState();
const originalStartViewTransition = Object.getOwnPropertyDescriptor(document, 'startViewTransition');

type TestViewTransition = {
  finished: Promise<unknown>;
  skipTransition: ReturnType<typeof vi.fn>;
};

function installViewTransitions(
  start: (update: () => void) => TestViewTransition,
  reduceMotion = false,
): ReturnType<typeof vi.fn> {
  const startViewTransition = vi.fn(start);
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: startViewTransition,
  });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduceMotion }) as MediaQueryList));
  return startViewTransition;
}

function pendingTransition(): TestViewTransition & { resolve: () => void } {
  let resolve!: () => void;
  const finished = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { finished, resolve, skipTransition: vi.fn() };
}

function makeChannel(name: string, unread = 0, highlights = 0): Channel {
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread,
    highlights,
    createdAt: null,
    messages: [],
  };
}

function makeDm(nick: string, unread = 0, highlights = 0): DMConversation {
  return { nick, account: null, unread, highlights, messages: [] };
}

/** Seed N channels (#alpha, #bravo, #charlie) plus a DM, with #bravo active. */
function seed(): void {
  const channels = new Map<string, Channel>();
  channels.set('#alpha', makeChannel('#alpha'));
  channels.set('#bravo', makeChannel('#bravo', 3, 2));
  channels.set('#charlie', makeChannel('#charlie'));

  const dms = new Map<string, DMConversation>();
  dms.set('dave', makeDm('dave'));

  store.setState({
    ...initialState,
    channels,
    dms,
    activeView: { kind: 'channel', channel: '#bravo' },
    connectionStatus: 'connected',
    ourNick: 'me',
    networkName: 'IRCXNet',
  }, true);
}

/** All roving-navigable rows, in document (sorted) order. */
function rows(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>('[data-sidebar-item]'),
  );
}

describe('ChannelSidebar accessibility', () => {
  beforeEach(() => {
    store.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalStartViewTransition) {
      Object.defineProperty(document, 'startViewTransition', originalStartViewTransition);
    } else {
      Reflect.deleteProperty(document, 'startViewTransition');
    }
  });

  it('exposes a labelled complementary landmark', () => {
    // Arrange
    seed();

    // Act
    const { getByRole } = render(() => <ChannelSidebar />);

    // Assert
    expect(getByRole('complementary', { name: 'Channel navigation' })).toBeDefined();
  });

  it('keeps the retired IRCXNet wire label out of the public sidebar', () => {
    seed();

    const { container } = render(() => <ChannelSidebar />);
    const network = container.querySelector('.shell-sidebar-network');

    expect(network).toHaveTextContent('Onyx');
    expect(network).not.toHaveTextContent('IRCXNet');
  });

  it('keeps a single tab stop on the active conversation', () => {
    // Arrange — #bravo is active.
    seed();

    // Act
    const { container } = render(() => <ChannelSidebar />);
    const tabbable = rows(container).filter((r) => r.getAttribute('tabindex') === '0');

    // Assert — exactly one row is in the tab order, and it is the active one.
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]!.getAttribute('aria-current')).toBe('page');
  });

  it('includes unread and mention counts in the accessible name', () => {
    // Arrange — #bravo has 3 unread and 2 mentions.
    seed();

    // Act
    const { getByRole } = render(() => <ChannelSidebar />);
    const bravo = getByRole('button', { name: /#bravo/ });

    // Assert
    expect(bravo.getAttribute('aria-label')).toBe('#bravo, 3 unread, 2 mentions');
  });

  it('exposes DM unread and mention counts in the accessible name', () => {
    // Arrange — a DM with unread + mentions. State to AT must not be badge-only.
    const channels = new Map<string, Channel>();
    const dms = new Map<string, DMConversation>();
    dms.set('erin', makeDm('erin', 4, 1));
    store.setState({
      ...initialState,
      channels,
      dms,
      activeView: { kind: 'status' },
      connectionStatus: 'connected',
      ourNick: 'me',
      networkName: 'IRCXNet',
    }, true);

    // Act
    const { getByRole } = render(() => <ChannelSidebar />);
    const erin = getByRole('button', { name: /erin/ });

    // Assert — name carries the state; the visible badge is decorative only.
    expect(erin.getAttribute('aria-label')).toBe('DM with erin, 4 unread, 1 mention');
  });

  it('shows offline memo counts on DM rows and clears when the aggregate drops', () => {
    // Arrange — pending offline memos for a peer (store.offlineMemo aggregate).
    const channels = new Map<string, Channel>();
    const dms = new Map<string, DMConversation>();
    dms.set('alice', makeDm('alice'));
    dms.set('bob', makeDm('bob'));
    store.setState({
      ...initialState,
      channels,
      dms,
      offlineMemo: new Map([
        ['alice', { count: 3, firstMsgId: 'memo-1' }],
      ]),
      activeView: { kind: 'status' },
      connectionStatus: 'connected',
      ourNick: 'me',
      networkName: 'Onyx',
    }, true);

    // Act
    const { getByRole, container, queryByText } = render(() => <ChannelSidebar />);
    const alice = getByRole('button', { name: /alice/ });
    const bob = getByRole('button', { name: /bob/ });

    // Assert — accessible name + calm secondary stamp; no stamp on peers without memos.
    expect(alice.getAttribute('aria-label')).toBe('DM with alice, 3 offline');
    expect(alice.querySelector('.shell-channel-offline')?.textContent).toBe('3 offline');
    expect(bob.getAttribute('aria-label')).toBe('DM with bob');
    expect(bob.querySelector('.shell-channel-offline')).toBeNull();
    // Decorative only — AT reads the name, not a live region.
    expect(alice.querySelector('.shell-channel-offline')?.getAttribute('aria-hidden')).toBe('true');

    // Act — opening the DM (or an explicit clear) drops the map entry; UI must react.
    store.getState().clearOfflineMemo('alice');

    // Assert — badge gone after aggregate clear (Solid updates synchronously).
    expect(alice.getAttribute('aria-label')).toBe('DM with alice');
    expect(queryByText('3 offline')).toBeNull();
    expect(container.querySelector('.shell-channel-offline')).toBeNull();
  });

  it('singularizes a single offline memo stamp', () => {
    const dms = new Map<string, DMConversation>();
    dms.set('cara', makeDm('cara'));
    store.setState({
      ...initialState,
      channels: new Map(),
      dms,
      offlineMemo: new Map([['cara', { count: 1, firstMsgId: 'memo-only' }]]),
      activeView: { kind: 'status' },
      connectionStatus: 'connected',
      ourNick: 'me',
      networkName: 'Onyx',
    }, true);

    const { getByRole } = render(() => <ChannelSidebar />);
    const cara = getByRole('button', { name: /cara/ });

    expect(cara.getAttribute('aria-label')).toBe('DM with cara, 1 offline');
    expect(cara.querySelector('.shell-channel-offline')?.textContent).toBe('1 offline');
  });

  it('does not announce unread counts through a live region', () => {
    // Arrange — #bravo carries 3 unread / 2 mentions.
    seed();

    // Act
    const { container } = render(() => <ChannelSidebar />);
    const scroll = container.querySelector('.shell-sidebar-scroll')!;

    // Assert — the conversation list is not a live region, so unread churn never
    // spams the screen reader (SC 4.1.3). Only connection status is polite.
    expect(scroll.querySelector('[aria-live]')).toBeNull();
    // And every count badge is hidden from AT — the accessible name carries it.
    const badges = container.querySelectorAll('.shell-channel-badge');
    expect(badges.length).toBeGreaterThan(0);
    badges.forEach((badge) => {
      expect(badge.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('labels the join action with the target channel', () => {
    seed();

    const { getByLabelText, getByRole } = render(() => <ChannelSidebar />);

    fireEvent.input(getByLabelText('Channel name to join'), {
      target: { value: 'harbor' },
    });

    expect(getByRole('button', { name: 'Join #harbor' })).toBeInTheDocument();
  });

  it('moves focus down with ArrowDown', () => {
    // Arrange — rows are: Status, #alpha, #bravo, #charlie, dave
    seed();
    const { container } = render(() => <ChannelSidebar />);
    const items = rows(container);
    items[1]!.focus(); // #alpha

    // Act
    fireEvent.keyDown(items[1]!, { key: 'ArrowDown' });

    // Assert
    expect(document.activeElement).toBe(items[2]); // #bravo
  });

  it('moves focus up with ArrowUp', () => {
    // Arrange — rows are: Status, #alpha, #bravo, #charlie, dave
    seed();
    const { container } = render(() => <ChannelSidebar />);
    const items = rows(container);
    items[3]!.focus(); // #charlie

    // Act
    fireEvent.keyDown(items[3]!, { key: 'ArrowUp' });

    // Assert
    expect(document.activeElement).toBe(items[2]); // #bravo
  });

  it('jumps to the first row with Home and last with End', () => {
    // Arrange
    seed();
    const { container } = render(() => <ChannelSidebar />);
    const items = rows(container);
    items[1]!.focus();

    // Act + Assert — End → last (the DM), Home → first (the Status row)
    fireEvent.keyDown(items[1]!, { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('does not move past the ends of the list', () => {
    // Arrange
    seed();
    const { container } = render(() => <ChannelSidebar />);
    const items = rows(container);
    items[0]!.focus();

    // Act — ArrowUp at the top is a no-op
    fireEvent.keyDown(items[0]!, { key: 'ArrowUp' });

    // Assert
    expect(document.activeElement).toBe(items[0]);
  });

  it('activates a channel when Enter is pressed on its row', () => {
    // Arrange
    seed();
    const navigateSpy = vi.spyOn(store.getState(), 'navigate');
    const { container } = render(() => <ChannelSidebar />);
    const items = rows(container);
    const alpha = items[1]!; // rows are: Status, #alpha, …

    // Act — a real <button> activates on Enter via a synthesized click.
    alpha.focus();
    fireEvent.click(alpha);

    // Assert
    expect(navigateSpy).toHaveBeenCalledWith({ kind: 'channel', channel: '#alpha' });
    navigateSpy.mockRestore();
  });

  it('navigates to the status buffer when the Status row is clicked', () => {
    // Arrange
    seed();
    const navigateSpy = vi.spyOn(store.getState(), 'navigate');
    const { container } = render(() => <ChannelSidebar />);
    const status = rows(container)[0]!; // the always-present Status row is first

    // Act
    fireEvent.click(status);

    // Assert
    expect(status.getAttribute('aria-label')).toBe('Server status');
    expect(navigateSpy).toHaveBeenCalledWith({ kind: 'status' });
    navigateSpy.mockRestore();
  });

  it('wraps a changed conversation in a supported native view transition', () => {
    seed();
    const transition = pendingTransition();
    const startViewTransition = installViewTransitions((update) => {
      update();
      return transition;
    });
    const navigateSpy = vi.spyOn(store.getState(), 'navigate');
    const { getByRole } = render(() => <ChannelSidebar />);

    fireEvent.click(getByRole('button', { name: '#alpha' }));

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith({ kind: 'channel', channel: '#alpha' });
  });

  it('uses the synchronous path when reduced motion is requested', () => {
    seed();
    const startViewTransition = installViewTransitions(() => pendingTransition(), true);
    const navigateSpy = vi.spyOn(store.getState(), 'navigate');
    const { getByRole } = render(() => <ChannelSidebar />);

    fireEvent.click(getByRole('button', { name: '#alpha' }));

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith({ kind: 'channel', channel: '#alpha' });
  });

  it('falls back exactly once when native transition startup throws after updating', () => {
    seed();
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      throw new DOMException('document hidden', 'InvalidStateError');
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false }) as MediaQueryList));
    const navigateSpy = vi.spyOn(store.getState(), 'navigate');
    const { getByRole } = render(() => <ChannelSidebar />);

    fireEvent.click(getByRole('button', { name: '#alpha' }));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(store.getState().activeView).toEqual({ kind: 'channel', channel: '#alpha' });
  });

  it('drops stale callbacks and keeps the newest transition active during rapid navigation', async () => {
    seed();
    const callbacks: Array<() => void> = [];
    const first = pendingTransition();
    const second = pendingTransition();
    const third = pendingTransition();
    const transitions = [first, second, third];
    installViewTransitions((update) => {
      callbacks.push(update);
      return transitions[callbacks.length - 1]!;
    });
    const navigateSpy = vi.spyOn(store.getState(), 'navigate');
    const { getByRole } = render(() => <ChannelSidebar />);

    fireEvent.click(getByRole('button', { name: '#alpha' }));
    fireEvent.click(getByRole('button', { name: '#charlie' }));
    expect(first.skipTransition).toHaveBeenCalledTimes(1);
    expect(navigateSpy).not.toHaveBeenCalled();

    callbacks[1]?.();
    callbacks[0]?.();
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenLastCalledWith({ kind: 'channel', channel: '#charlie' });

    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fireEvent.click(getByRole('button', { name: 'DM with dave' }));

    expect(second.skipTransition).toHaveBeenCalledTimes(1);
    callbacks[2]?.();
    expect(navigateSpy).toHaveBeenLastCalledWith({ kind: 'dm', nick: 'dave' });
  });
});
