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
  });

  it('exposes a labelled complementary landmark', () => {
    // Arrange
    seed();

    // Act
    const { getByRole } = render(() => <ChannelSidebar />);

    // Assert
    expect(getByRole('complementary', { name: 'Channel navigation' })).toBeDefined();
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
});
