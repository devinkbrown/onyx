// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ChannelNotifyControl.test.tsx — the compact ribbon per-channel notify control.
 *
 * Pins that it (1) reflects the current stored channelNotifyMode via aria-checked,
 * (2) dispatches the EXISTING setChannelNotifyMode action on click so the store's
 * single source of truth updates, and (3) supports roving-radiogroup keyboard
 * navigation (Arrow keys move selection). AAA pattern.
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store, type Server } from '@/lib/store/store';
import type { NotifyLevel } from '@/lib/notifications/channelNotifyMode';
import { ChannelNotifyControl } from './ChannelNotifyControl';

const initialState = store.getInitialState();
const server: Server = {
  id: 'notify-test',
  name: 'Notify test',
  network: 'Notify test',
  url: 'wss://notify.test/ws',
  icon: '',
  nick: 'alice',
  account: 'alice',
  connected: true,
};

function seed(notify?: Map<string, NotifyLevel>): void {
  store.setState(
    {
      ...initialState,
      server,
      ourNick: 'alice',
      channelNotify: notify ?? new Map(),
    },
    true,
  );
}

function renderControl() {
  return render(() => <ChannelNotifyControl channel="#general" />);
}

function group(): HTMLElement {
  return screen.getByRole('radiogroup', { name: /Notifications for #general/i });
}

function radio(name: RegExp): HTMLButtonElement {
  return screen.getByRole('radio', { name }) as HTMLButtonElement;
}

beforeEach(() => {
  store.setState(initialState, true);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  store.setState(initialState, true);
});

describe('ChannelNotifyControl', () => {
  it('names the group for the channel it controls', () => {
    seed();
    renderControl();
    expect(group()).toBeInTheDocument();
  });

  it('checks the All segment by default when the channel has no entry', () => {
    seed();
    renderControl();
    expect(radio(/All messages/i)).toHaveAttribute('aria-checked', 'true');
    expect(radio(/Mentions only/i)).toHaveAttribute('aria-checked', 'false');
    expect(radio(/Mute/i)).toHaveAttribute('aria-checked', 'false');
  });

  it('reflects the stored mode (mentions) as the checked segment', () => {
    seed(new Map([['#general', 'mentions']]));
    renderControl();
    expect(radio(/Mentions only/i)).toHaveAttribute('aria-checked', 'true');
    expect(radio(/All messages/i)).toHaveAttribute('aria-checked', 'false');
  });

  it('reflects a stored mute (level "none") as the Mute segment', () => {
    seed(new Map([['#general', 'none']]));
    renderControl();
    expect(radio(/Mute/i)).toHaveAttribute('aria-checked', 'true');
  });

  it('only the selected segment is tabbable (roving tabindex)', () => {
    seed(new Map([['#general', 'mentions']]));
    renderControl();
    expect(radio(/Mentions only/i)).toHaveAttribute('tabindex', '0');
    expect(radio(/All messages/i)).toHaveAttribute('tabindex', '-1');
    expect(radio(/Mute/i)).toHaveAttribute('tabindex', '-1');
  });

  it('dispatches setChannelNotifyMode on click, updating the store', () => {
    seed();
    renderControl();
    fireEvent.click(radio(/Mute/i));
    expect(store.getState().channelNotifyMode('#general')).toBe('mute');
    expect(store.getState().channelNotify.get('#general')).toBe('none');
  });

  it('clears the entry back to default when All is chosen', () => {
    seed(new Map([['#general', 'none']]));
    renderControl();
    fireEvent.click(radio(/All messages/i));
    expect(store.getState().channelNotifyMode('#general')).toBe('all');
    expect(store.getState().channelNotify.has('#general')).toBe(false);
  });

  it('moves selection with ArrowRight (selection follows focus)', () => {
    seed();
    renderControl();
    fireEvent.keyDown(group(), { key: 'ArrowRight' });
    expect(store.getState().channelNotifyMode('#general')).toBe('mentions');
    expect(radio(/Mentions only/i)).toHaveAttribute('aria-checked', 'true');
  });

  it('centres a focused segment in the bounded ribbon action scroller', () => {
    seed();
    render(() => (
      <div class="shell-ribbon-right">
        <ChannelNotifyControl channel="#general" />
      </div>
    ));
    const scroller = document.querySelector<HTMLElement>('.shell-ribbon-right')!;
    const mute = radio(/Mute/i);
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 120 },
      scrollWidth: { configurable: true, value: 300 },
    });
    scroller.getBoundingClientRect = () => ({
      x: 10, y: 0, width: 120, height: 44, top: 0, right: 130,
      bottom: 44, left: 10, toJSON: () => ({}),
    });
    mute.getBoundingClientRect = () => ({
      x: 250, y: 0, width: 44, height: 44, top: 0, right: 294,
      bottom: 44, left: 250, toJSON: () => ({}),
    });

    fireEvent.focus(mute);

    expect(scroller.scrollLeft).toBe(180);
  });

  it('wraps with ArrowLeft from the first segment to the last', () => {
    seed();
    renderControl();
    fireEvent.keyDown(group(), { key: 'ArrowLeft' });
    expect(store.getState().channelNotifyMode('#general')).toBe('mute');
  });

  it('follows the channel prop when it changes in place (no remount)', () => {
    // #general → mentions, #ops → mute. The host swaps the prop without
    // recreating the component (as the non-keyed ribbon <Show> does).
    seed(
      new Map<string, NotifyLevel>([
        ['#general', 'mentions'],
        ['#ops', 'none'],
      ]),
    );
    const [chan, setChan] = createSignal('#general');
    render(() => <ChannelNotifyControl channel={chan()} />);

    expect(
      screen.getByRole('radio', { name: /Mentions only/i }),
    ).toHaveAttribute('aria-checked', 'true');

    setChan('#ops');

    expect(screen.getByRole('radio', { name: /Mute/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      screen.getByRole('radio', { name: /Mentions only/i }),
    ).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.getByRole('radiogroup', { name: /Notifications for #ops/i }),
    ).toBeInTheDocument();
  });

  it('ignores non-navigation keys', () => {
    seed(new Map([['#general', 'mentions']]));
    renderControl();
    fireEvent.keyDown(group(), { key: 'Enter' });
    expect(store.getState().channelNotifyMode('#general')).toBe('mentions');
  });
});
