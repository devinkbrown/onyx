// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MemberList.a11y.test.tsx — accessibility semantics of the channel roster.
 *
 * These assert the load-bearing a11y contract, not markup shape:
 *  - the member count is NOT a live region (no bare-integer join/leave spam)
 *    but still carries an accessible name for on-demand reading (SC 4.1.3);
 *  - a member's role/prefix is exposed to assistive tech in text — announced
 *    exactly once, never doubled, and never by glyph/colour alone (SC 1.4.1,
 *    4.1.2);
 *  - each row is a real keyboard-operable control that opens a dialog and
 *    closes on Escape (SC 2.1.1, 2.1.2).
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseIRCMessage } from '@/lib/irc/parser';
import { _beginNamesBurstForTests, _resetNamesBurstsForTests, store } from '@/lib/store/store';
import type { Channel, ChannelUser } from '@/lib/irc/types';
import { MemberList } from './MemberList';

const initialState = store.getInitialState();
const initialRootFontSize = document.documentElement.style.fontSize;

/** jsdom has no layout: deliver explicit border boxes through the same observer
 * and animation-frame path the browser uses. Never measure unmounted members. */
function mockRosterLayout() {
  const geometry = { width: 260, member: 54, group: 38, long: 118 };
  const targets = new Set<Element>();
  const callbacks = new Set<ResizeObserverCallback>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { callbacks.add(callback); }
    observe(target: Element) { targets.add(target); }
    unobserve(target: Element) { targets.delete(target); }
    disconnect() { targets.clear(); callbacks.clear(); }
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.matches('.shell-members-scroll') ? geometry.width : 0;
  });
  const height = (element: HTMLElement) => {
    const key = element.dataset.memberMeasureKey;
    if (!key || element.style.display === 'none') return 0;
    return key.startsWith('group:') ? geometry.group
      : key.includes('-long-name') ? geometry.long : geometry.member;
  };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, geometry.width, height(this));
  });
  const flush = () => {
    for (let attempt = 0; frames.size && attempt < 10; attempt += 1) {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    }
    expect(frames.size).toBe(0);
  };
  return {
    geometry, targets, frames, flush,
    resize() {
      for (const callback of callbacks) callback([], {} as ResizeObserver);
      flush();
    },
    topWithinScroll(scroll: HTMLElement, nick: string) {
      let top = parseFloat(scroll.style.paddingTop) || 0;
      top += parseFloat(scroll.querySelector<HTMLElement>('.shell-members-window-pad')!.style.height);
      for (const row of scroll.querySelectorAll<HTMLElement>('[data-member-measure-key]')) {
        if (row.dataset.memberFocusKey === nick) return top - scroll.scrollTop;
        top += height(row);
      }
      throw new Error(`Member ${nick} is not mounted`);
    },
  };
}

function makeClient() {
  return {
    sendRaw: vi.fn(),
    isupport: { CHANTYPES: '#&', CHANMODES: ['beIZ', 'k', 'lfj', 'imnstCTNMSgWOA'] },
    negotiatedCaps: new Set<string>(),
    modeToPrefix: { Y: '*', Q: '!', q: '~', a: '&', o: '@', h: '%', v: '+' } as Record<string, string>,
    prefixToMode: { '*': 'Y', '!': 'Q', '.': 'q', '~': 'q', '&': 'a', '@': 'o', '%': 'h', '+': 'v' } as Record<string, string>,
  };
}

function makeUser(nick: string, modes: string[] = [], extra: Partial<ChannelUser> = {}): ChannelUser {
  return { nick, modes: new Set(modes), ...extra };
}

function makeChannel(name: string, users: ChannelUser[]): Channel {
  const usersMap = new Map<string, ChannelUser>();
  for (const u of users) usersMap.set(u.nick.toLowerCase(), u);
  return {
    name,
    topic: 'Welcome',
    topicSetBy: 'server',
    topicSetAt: null,
    modes: '',
    users: usersMap,
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function seedChannel(users: ChannelUser[], ourNick = 'me') {
  const client = makeClient();
  const channels = new Map<string, Channel>();
  channels.set('#general', makeChannel('#general', users));
  store.setState({
    ...initialState,
    client: client as never,
    channels,
    ourNick,
    activeView: { kind: 'channel', channel: '#general' },
    connectionStatus: 'connected',
  }, true);
  return client;
}

beforeEach(() => {
  store.setState(initialState, true);
  _resetNamesBurstsForTests();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.fontSize = initialRootFontSize;
});

describe('MemberList accessibility', () => {
  it('names roster presence as here or away without relying on color', () => {
    seedChannel([makeUser('me'), makeUser('away-user', [], { away: true })]);

    render(() => <MemberList />);

    expect(screen.getByRole('button', { name: /away-user.*away/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /me.*here/i })).toBeInTheDocument();
  });

  it('links to the room ledger for public room channels', () => {
    seedChannel([makeUser('me', ['o']), makeUser('bob', ['v'])]);

    render(() => <MemberList />);

    expect(screen.getByTestId('members-channel-ledger')).toHaveAttribute(
      'href',
      '/stats/?room=%23general',
    );
    expect(screen.getByRole('link', { name: 'Room ledger for #general' })).toHaveTextContent('Ledger');
  });

  it('omits the room ledger link outside # and & rooms', () => {
    const client = makeClient();
    store.setState({
      ...initialState,
      client: client as never,
      ourNick: 'alice',
      activeView: { kind: 'dm', nick: 'bob' },
      connectionStatus: 'connected',
    }, true);

    render(() => <MemberList />);

    expect(screen.queryByTestId('members-channel-ledger')).toBeNull();
  });

  it('provides an operable close control only when the roster is an open modal', () => {
    seedChannel([makeUser('me', ['o']), makeUser('bob', ['v'])]);
    const onClose = vi.fn();
    const { unmount } = render(() => <MemberList modal onClose={onClose} />);

    const closeButton = screen.getByRole('button', { name: 'Close member list' });
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledOnce();

    unmount();
    render(() => <MemberList onClose={onClose} />);
    expect(screen.queryByRole('button', { name: 'Close member list' })).toBeNull();
  });

  it('makes a hidden roster inert and removes its member controls from keyboard access', () => {
    seedChannel([makeUser('me', ['o']), makeUser('bob', ['v'])]);

    const { container } = render(() => <MemberList hidden />);

    const memberList = container.querySelector<HTMLElement>('.shell-members');
    expect(memberList).not.toBeNull();
    expect(memberList).toHaveAttribute('aria-hidden', 'true');
    expect(memberList).toHaveAttribute('inert');
    expect(screen.queryByRole('region', { name: 'People in #general' })).toBeNull();

    const triggers = container.querySelectorAll<HTMLButtonElement>('.shell-members .onyx-popover__trigger');
    expect(triggers).toHaveLength(2);
    for (const trigger of triggers) expect(trigger).toBeDisabled();
  });

  it('closes an open member card when the owning roster becomes hidden', () => {
    seedChannel([makeUser('me', ['o']), makeUser('bob', ['v'])]);
    const [hidden, setHidden] = createSignal(false);

    render(() => <MemberList hidden={hidden()} />);

    const bob = screen.getByRole('button', { name: /Open member details for bob, Voice/ });
    fireEvent.click(bob);
    expect(screen.getByRole('dialog', { name: 'Member details for bob' })).toBeInTheDocument();

    setHidden(true);
    expect(screen.queryByRole('dialog', { name: 'Member details for bob' })).toBeNull();
    expect(bob).toBeDisabled();
    expect(bob.closest('.shell-members')).toHaveAttribute('inert');

    setHidden(false);
    expect(bob).not.toBeDisabled();
    expect(bob.closest('.shell-members')).not.toHaveAttribute('inert');
  });

  it('exposes the member count with an accessible name but NOT as a live region', () => {
    // A polite live region here re-announces a bare integer on every join/leave,
    // history replay, and ?at= time-travel — spam. It must be readable on demand
    // without shouting on each membership change.
    seedChannel([makeUser('me', ['o']), makeUser('bob', ['v'])]);

    render(() => <MemberList />);

    const count = screen.getByLabelText('2 members');
    expect(count).toHaveTextContent('2');
    expect(count).not.toHaveAttribute('aria-live');
    expect(count).not.toHaveAttribute('aria-atomic');
  });

  it('names the complementary landmark and roster region for local & rooms', () => {
    // Dense a11y: local CHANTYPES (`&`) rooms must keep the same channel-scoped
    // landmark contract as `#` rooms so cross-room handoffs into &ops are named.
    const client = makeClient();
    const channels = new Map<string, Channel>();
    channels.set('&ops', makeChannel('&ops', [makeUser('me', ['o']), makeUser('bob', ['v'])]));
    store.setState({
      ...initialState,
      client: client as never,
      channels,
      ourNick: 'me',
      activeView: { kind: 'channel', channel: '&ops' },
      connectionStatus: 'connected',
    }, true);

    render(() => <MemberList />);

    expect(screen.getByRole('complementary', { name: 'Member list for &ops' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'People in &ops' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open member details for bob, Voice/ })).toBeInTheDocument();
  });

  it('singularises the accessible count name', () => {
    seedChannel([makeUser('me', ['o'])]);

    render(() => <MemberList />);

    expect(screen.getByLabelText('1 member')).toBeInTheDocument();
  });

  it('resolves a mixed-case active channel against the lowercase channel map', () => {
    seedChannel([makeUser('me', ['o']), makeUser('Alice', ['v'])]);
    store.setState({ activeView: { kind: 'channel', channel: '#General' } });

    render(() => <MemberList />);

    expect(screen.getByLabelText('2 members')).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: /Open member details for Alice, Voice/ })).toBeInTheDocument();
  });

  it('keeps the current roster visible and labels it while a resume refresh is pending', () => {
    seedChannel([makeUser('me', ['o']), makeUser('departed', ['v'])]);
    store.setState({ rosterSyncing: new Set(['#general']) });

    render(() => <MemberList />);

    expect(screen.getByRole('status', { name: 'Refreshing members' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open member details for departed/ })).toBeInTheDocument();
    expect(screen.getByLabelText('2 members')).toHaveTextContent('2');

    store.setState({ rosterSyncing: new Set() });

    expect(screen.queryByRole('status', { name: 'Refreshing members' })).toBeNull();
    expect(screen.getByRole('button', { name: /Open member details for departed/ })).toBeInTheDocument();
  });

  it('announces a member role in text exactly once, not doubled by the badge glyph', () => {
    // The row already states the role in its sr-only summary; the coloured glyph
    // badge must be decorative so screen readers do not read the role twice.
    seedChannel([makeUser('me', ['o']), makeUser('opal', ['o'])]);

    render(() => <MemberList />);

    const trigger = screen.getByRole('button', { name: /Open member details for opal, Op/ });

    // The visible role badge is present but marked decorative (glyph only).
    const badge = trigger.querySelector('.shell-role-badge');
    expect(badge).not.toBeNull();
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(badge).not.toHaveAttribute('aria-label');

    // "Op" appears once in the accessible name, not twice.
    const occurrences = (trigger.getAttribute('aria-label') ?? trigger.textContent ?? '')
      .match(/\bOp\b/g)?.length ?? 0;
    // textContent-derived name (jsdom) counts the visible glyph-free summary once.
    expect(occurrences).toBeLessThanOrEqual(1);
  });

  it('conveys away status in text, not colour/opacity alone', () => {
    seedChannel([makeUser('me', ['o']), makeUser('bob', [], { away: true })]);

    render(() => <MemberList />);

    expect(screen.getByRole('button', { name: /Open member details for bob, Member, away/ })).toBeInTheDocument();
  });

  it('announces a long nick, role, and away state exactly once', () => {
    const nick = 'vickysomething-with-a-very-long-name';
    seedChannel([makeUser('me', ['o']), makeUser(nick, ['v'], { away: true })]);

    render(() => <MemberList />);

    const accessibleName = `Open member details for ${nick}, Voice, away`;
    const trigger = screen.getByRole('button', { name: accessibleName });
    expect(trigger).toHaveAccessibleName(accessibleName);
    expect(trigger.querySelector('.shell-member-nick')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps an away member visibly away when NAMES refreshes their role', () => {
    seedChannel([
      makeUser('me'),
      makeUser('bob', ['v'], { away: true, account: 'bob-account' }),
      makeUser('ghost'),
    ]);
    render(() => <MemberList />);

    _beginNamesBurstForTests('#general');
    store.getState()._handleMessage(parseIRCMessage(':irc 353 me = #general :me @bob alice'));
    store.getState()._handleMessage(parseIRCMessage(':irc 366 me #general :End of /NAMES list.'));

    expect(screen.getByLabelText('3 members')).toHaveTextContent('3');
    expect(screen.queryByRole('button', { name: /Open member details for ghost/ })).toBeNull();
    const bob = screen.getByRole('button', { name: /Open member details for bob, Op, away/ });
    expect(bob.querySelector('.shell-member-row')).toHaveClass('shell-member-row--away');

    fireEvent.click(bob);
    fireEvent.click(screen.getByTestId('people-profile-advanced-toggle'));
    expect(screen.getByText('Account bob-account')).toBeInTheDocument();
  });

  it('keeps the member-card avatar decorative so the nick is announced once', () => {
    seedChannel([makeUser('me', ['o']), makeUser('bob', ['v'])]);
    render(() => <MemberList />);

    fireEvent.click(screen.getByRole('button', { name: /Open member details for bob, Voice/ }));
    const card = screen.getByRole('region', { name: 'bob' });
    const avatar = card.querySelector('.onyx-avatar');
    expect(avatar).not.toBeNull();
    expect(avatar).toHaveAttribute('aria-hidden', 'true');
    expect(card).not.toHaveAccessibleDescription(/Voice in #general/);
  });

  it('opens a member dialog from a keyboard-operable button and closes on Escape', () => {
    seedChannel([makeUser('me', ['o']), makeUser('bob', ['v'])]);

    render(() => <MemberList />);

    const trigger = screen.getByRole('button', { name: /Open member details for bob, Voice/ });
    // A real button — reachable and activatable by keyboard (SC 2.1.1).
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Member details for bob' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Escape dismisses the overlay (SC 2.1.2 — no keyboard trap).
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Member details for bob' })).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('settles focus on the roster trigger before opening the WHOIS sheet', () => {
    seedChannel([makeUser('me', ['o']), makeUser('bob', ['v'])]);

    render(() => <MemberList />);

    const trigger = screen.getByRole('button', { name: /Open member details for bob, Voice/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('people-profile-advanced-toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'View profile of bob' }));

    expect(screen.queryByRole('dialog', { name: 'Member details for bob' })).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    expect(store.getState().showWhois).toBe(true);
    expect(store.getState().whoisNick).toBe('bob');
  });

  it('keeps focus on a member when a role update moves their row to another group', async () => {
    seedChannel([makeUser('me', ['o']), makeUser('bob', ['v'])]);
    render(() => <MemberList />);

    const voiceTrigger = screen.getByRole('button', { name: /Open member details for bob, Voice/ });
    voiceTrigger.focus();
    store.getState()._handleMessage(parseIRCMessage(':irc MODE #general +o bob'));

    const opTrigger = await screen.findByRole('button', { name: /Open member details for bob, Op/ });
    await waitFor(() => expect(opTrigger).toHaveFocus());
  });

  it('windows a large roster instead of mounting every member row', () => {
    const users = Array.from({ length: 220 }, (_, i) => (
      i === 0 ? makeUser('me', ['o']) : makeUser(`nick${i}`)
    ));
    seedChannel(users);
    render(() => <MemberList />);

    const triggers = screen.getAllByRole('button', { name: /Open member details/ });
    expect(triggers.length).toBeGreaterThan(20);
    expect(triggers.length).toBeLessThan(160);
    expect(screen.getByLabelText('220 members')).toHaveTextContent('220');
    expect(screen.getByRole('heading', { name: /Members — 219/ })).toBeInTheDocument();
  });

  it.each([false, true])('anchors wrapped 3k rows through measurement, width and text changes (modal=%s)', (modal) => {
    const layout = mockRosterLayout();
    if (modal) Object.assign(layout.geometry, { width: 350, member: 56, group: 32 });
    const users = Array.from({ length: 3000 }, (_, i) => makeUser(
      `nick${String(i).padStart(4, '0')}${i === 115 ? '-long-name-that-wraps-across-lines' : ''}`,
    ));
    seedChannel(users);
    const { container, unmount } = render(() => <MemberList modal={modal} />);
    const scroll = screen.getByRole('region', { name: 'People in #general' });
    scroll.style.paddingTop = '8px';
    layout.flush();

    const initialOffset = 8 + layout.geometry.group + 120 * layout.geometry.member + 9;
    scroll.scrollTop = initialOffset;
    fireEvent.scroll(scroll);
    const trigger = screen.getByRole('button', { name: /Open member details for nick0120,/ });
    trigger.focus();
    layout.flush();
    expect(scroll.scrollTop).toBe(initialOffset + layout.geometry.long - layout.geometry.member);
    expect(layout.topWithinScroll(scroll, 'nick0120')).toBe(-9);
    expect(trigger).toHaveFocus();
    expect(container.querySelector('.shell-member-nick')?.textContent).toBeTruthy();
    expect(screen.getByText('nick0115-long-name-that-wraps-across-lines')).toBeInTheDocument();
    expect(scroll.querySelector('.shell-members-group-label')).toHaveStyle({ display: 'none' });
    expect(screen.getByRole('list', { name: 'Members — 3000' })).toBeInTheDocument();

    // One row of forward and reverse scrolling retains the same DOM control.
    scroll.scrollTop += layout.geometry.member;
    fireEvent.scroll(scroll);
    layout.flush();
    expect(screen.getByRole('button', { name: /Open member details for nick0120,/ })).toBe(trigger);
    expect(trigger).toHaveFocus();
    scroll.scrollTop -= layout.geometry.member;
    fireEvent.scroll(scroll);
    layout.flush();
    expect(layout.topWithinScroll(scroll, 'nick0120')).toBe(-9);

    Object.assign(layout.geometry, { width: 190, member: 64, long: 156 });
    layout.resize();
    expect(layout.topWithinScroll(scroll, 'nick0120')).toBe(-9);
    document.documentElement.style.fontSize = '32px';
    Object.assign(layout.geometry, { member: 128, group: 76, long: 312 });
    layout.resize();
    expect(layout.topWithinScroll(scroll, 'nick0120')).toBe(-9);
    expect(trigger).toHaveFocus();
    const settledOffset = scroll.scrollTop;
    layout.resize();
    expect(scroll.scrollTop).toBe(settledOffset);
    expect(scroll.querySelectorAll('.shell-members-group-item').length).toBeLessThanOrEqual(96);
    expect(layout.targets.size).toBeLessThanOrEqual(100);

    // Presence/roster reconciliation must not reset the scroll position.
    store.getState()._handleMessage(parseIRCMessage(':nick0125!user@example AWAY :Back soon'));
    layout.flush();
    expect(screen.getByRole('button', { name: /nick0125, Member, away/ })).toBeInTheDocument();
    expect(scroll.scrollTop).toBe(settledOffset);
    expect(trigger).toHaveFocus();
    unmount();
    expect(layout.targets.size).toBe(0);
    expect(layout.frames.size).toBe(0);
  });

  it('ignores zero-sized hidden drawers and remeasures on reopening without losing position', () => {
    const layout = mockRosterLayout();
    seedChannel(Array.from({ length: 3000 }, (_, i) => makeUser(`nick${String(i).padStart(4, '0')}`)));
    const [hidden, setHidden] = createSignal(false);
    render(() => <MemberList modal hidden={hidden()} />);
    const scroll = screen.getByRole('region', { name: 'People in #general' });
    layout.flush();
    scroll.scrollTop = 38 + 120 * 54 + 7;
    fireEvent.scroll(scroll);
    layout.flush();
    const offset = scroll.scrollTop;
    setHidden(true);
    layout.geometry.width = 0;
    layout.resize();
    expect(scroll.scrollTop).toBe(offset);
    expect(screen.queryByRole('region', { name: 'People in #general' })).toBeNull();
    Object.assign(layout.geometry, { width: 300, member: 80 });
    setHidden(false);
    layout.resize();
    expect(layout.topWithinScroll(scroll, 'nick0120')).toBe(-7);
    expect(scroll.querySelectorAll('.shell-members-group-item').length).toBeLessThanOrEqual(96);
  });

  it('keeps visited heights when the first window row changes between away italic and normal', () => {
    const layout = mockRosterLayout();
    const computedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = computedStyle(element, pseudo);
      if (!element.matches('.shell-member-nick')) return style;
      return new Proxy(style, {
        get(target, property) {
          if (property === 'font') return `${element.classList.contains('shell-member-nick--away') ? 'italic ' : ''}600 13px sans-serif`;
          return Reflect.get(target, property, target);
        },
      });
    });
    seedChannel(Array.from({ length: 3000 }, (_, i) => makeUser(
      `nick${String(i).padStart(4, '0')}${i === 20 || i === 115 ? '-long-name' : ''}`,
      [], { away: i % 5 === 0 },
    )));
    render(() => <MemberList />);
    const scroll = screen.getByRole('region', { name: 'People in #general' });
    const totalHeight = () => Array.from(scroll.querySelectorAll<HTMLElement>(
      '[data-member-measure-key], .shell-members-window-pad',
    )).reduce((sum, element) => sum + (element.classList.contains('shell-members-window-pad')
      ? parseFloat(element.style.height) : element.getBoundingClientRect().height), 0);
    layout.flush();
    const initialHeight = totalHeight();
    const newWrappedHeight = layout.geometry.long - layout.geometry.member;
    scroll.scrollTop = 38 + 120 * 54 + newWrappedHeight + 7;
    fireEvent.scroll(scroll);
    layout.flush();
    // Discovering nick0115 adds one long row; nick0020 remains in the cache
    // even though it is no longer mounted and the first row is no longer away.
    expect(totalHeight()).toBe(initialHeight + newWrappedHeight);
    for (const delta of [54, 54, -54, -54]) {
      scroll.scrollTop += delta;
      fireEvent.scroll(scroll);
      layout.flush();
      expect(totalHeight()).toBe(initialHeight + newWrappedHeight);
    }
    expect(layout.topWithinScroll(scroll, 'nick0120')).toBe(-7);
    expect(layout.targets.size).toBeLessThanOrEqual(100);
  });

  it('measures group boundaries without adding continuation height and reaches the tail', () => {
    const layout = mockRosterLayout();
    seedChannel(Array.from({ length: 3000 }, (_, i) => makeUser(
      `nick${String(i).padStart(4, '0')}`, i < 1500 ? ['o'] : [],
    )));
    render(() => <MemberList />);
    const scroll = screen.getByRole('region', { name: 'People in #general' });
    layout.flush();
    for (const index of [1495, 1500, 2990, 50]) {
      scroll.scrollTop = (index < 1500 ? 38 : 76) + index * 54 + 7;
      fireEvent.scroll(scroll);
      layout.flush();
      expect(layout.topWithinScroll(scroll, `nick${String(index).padStart(4, '0')}`)).toBe(-7);
      expect(scroll.querySelectorAll('.shell-members-group-item').length).toBeLessThanOrEqual(96);
    }
  });

  it('returns focus to the stable roster when the focused member leaves', async () => {
    seedChannel([makeUser('me', ['o']), makeUser('bob', ['v'])]);
    render(() => <MemberList />);

    const trigger = screen.getByRole('button', { name: /Open member details for bob, Voice/ });
    trigger.focus();
    store.getState()._handleMessage(parseIRCMessage(':bob!user@example PART #general :Leaving'));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Open member details for bob/ })).toBeNull();
      expect(screen.getByRole('complementary', { name: 'Member list for #general' })).toHaveFocus();
    });
  });
});
