// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/lib/irc/types';
import { recordReviewHistory } from '@/lib/notifications/reviewHistory';
import { setState } from '@/lib/store';
import { store } from '@/lib/store/store';
import { Spotlight, SpotlightProvider } from './index';

const initialState = store.getInitialState();
const MEMORY_OWNER = { serverUrl: 'wss://spotlight.example/ws', identity: 'kain' } as const;

function channel(name: string): Channel {
  return {
    name,
    topic: `${name} room`,
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function renderSpotlight() {
  return render(() => (
    <SpotlightProvider>
      <button type="button">Before palette</button>
      <Spotlight />
    </SpotlightProvider>
  ));
}

describe('Spotlight', () => {
  beforeEach(() => {
    store.setState(initialState, true);
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-onyx-background');
  });

  it('opens on Cmd/Ctrl+K and traps focus in the palette', async () => {
    renderSpotlight();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const input = screen.getByRole('combobox', { name: 'Command search' });
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Use command example mute 1h' })).toHaveFocus();
  });

  it('excludes responsive CSS-hidden controls from the focus loop', async () => {
    renderSpotlight();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    const input = screen.getByRole('combobox', { name: 'Command search' });
    const close = screen.getByRole('button', { name: 'Close spotlight' });
    await waitFor(() => expect(input).toHaveFocus());

    const renderedRects = { length: 1, item: () => null } as unknown as DOMRectList;
    const hiddenRects = { length: 0, item: () => null } as unknown as DOMRectList;
    vi.spyOn(dialog, 'getClientRects').mockReturnValue(renderedRects);
    vi.spyOn(input, 'getClientRects').mockReturnValue(renderedRects);
    vi.spyOn(close, 'getClientRects').mockReturnValue(renderedRects);
    for (const example of screen.getAllByRole('button', { name: /Use command example/ })) {
      vi.spyOn(example, 'getClientRects').mockReturnValue(hiddenRects);
    }

    close.focus();
    fireEvent.keyDown(close, { key: 'Tab' });

    expect(input).toHaveFocus();
  });

  it('opens on slash when the user is not typing in a field', () => {
    renderSpotlight();

    fireEvent.keyDown(window, { key: '/' });

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('teaches command grammar with focusable examples', () => {
    renderSpotlight();

    fireEvent.keyDown(window, { key: '/' });
    fireEvent.click(screen.getByRole('button', { name: 'Use command example goto #root at yesterday 9pm' }));

    expect(screen.getByRole('combobox', { name: 'Command search' })).toHaveValue('goto #root at yesterday 9pm');
    expect(screen.getByText('Time grammar')).toBeInTheDocument();
  });

  it('surfaces the grammar command produced by a clicked teaching example', async () => {
    renderSpotlight();

    fireEvent.keyDown(window, { key: '/' });
    fireEvent.click(screen.getByRole('button', { name: 'Use command example goto #root at yesterday 9pm' }));

    // Clicking a teaching chip must do more than fill the input box: the command
    // layer parses the query it sees into a grammar command, so populating the
    // input has to reach that layer (via a real input event). Otherwise the
    // taught command never appears and the chip teaches a dead end.
    await waitFor(() => {
      expect(screen.getByRole('listbox').textContent).toContain('Go to #root');
    });
  });

  it('does not open on slash from an input', () => {
    render(() => (
      <SpotlightProvider>
        <input aria-label="message input" />
        <Spotlight />
      </SpotlightProvider>
    ));

    const messageInput = screen.getByLabelText('message input');
    messageInput.focus();
    fireEvent.keyDown(messageInput, { key: '/' });

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('does not open from composed, claimed, or extra-modifier launcher keys', () => {
    renderSpotlight();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: '/', altKey: true });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();

    const claimed = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    claimed.preventDefault();
    window.dispatchEvent(claimed);
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('keeps launcher keys with an existing modal, then resumes after it closes', () => {
    renderSpotlight();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const modalButton = document.createElement('button');
    modalButton.textContent = 'Modal action';
    dialog.append(modalButton);
    document.body.append(dialog);
    modalButton.focus();

    fireEvent.keyDown(modalButton, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(modalButton, { key: '/' });

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(modalButton).toHaveFocus();

    dialog.remove();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('filters as you type and moves the active item with arrow keys', () => {
    setState({
      channels: new Map([
        ['#forge', channel('#forge')],
        ['#lapis', channel('#lapis')],
      ]),
    });
    renderSpotlight();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox', { name: 'Command search' });
    const firstActive = input.getAttribute('aria-activedescendant');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).not.toBe(firstActive);

    fireEvent.input(input, { target: { value: 'forge' } });

    expect(screen.getByText('Go to #forge')).toBeInTheDocument();
    expect(screen.queryByText('Go to #lapis')).not.toBeInTheDocument();
  });

  it('leaves candidate navigation, confirmation, and dismissal to an active IME', () => {
    const joinChannel = vi.fn();
    const navigate = vi.fn();
    setState({
      channels: new Map([
        ['#forge', channel('#forge')],
        ['#lapis', channel('#lapis')],
      ]),
      joinChannel,
      navigate,
    });
    renderSpotlight();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox', { name: 'Command search' });
    fireEvent.input(input, { target: { value: 'forge' } });
    const firstActive = input.getAttribute('aria-activedescendant');

    fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });

    expect(input).toHaveAttribute('aria-activedescendant', firstActive);
    expect(joinChannel).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('defers result and live-region updates until composition ends', () => {
    setState({
      channels: new Map([
        ['#forge', channel('#forge')],
        ['#lapis', channel('#lapis')],
      ]),
    });
    renderSpotlight();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox', { name: 'Command search' });
    const status = screen.getByRole('status');
    const initialAnnouncement = status.textContent;

    fireEvent.input(input, { target: { value: 'forge' }, isComposing: true });

    expect(screen.getByText('Go to #forge')).toBeInTheDocument();
    expect(screen.getByText('Go to #lapis')).toBeInTheDocument();
    expect(status.textContent).toBe(initialAnnouncement);

    fireEvent.compositionEnd(input, { data: 'forge' });

    expect(screen.getByText('Go to #forge')).toBeInTheDocument();
    expect(screen.queryByText('Go to #lapis')).not.toBeInTheDocument();
    expect(status.textContent).not.toBe(initialAnnouncement);
  });

  it('honors a command-input key claimed by an earlier integration', () => {
    setState({
      channels: new Map([
        ['#forge', channel('#forge')],
        ['#lapis', channel('#lapis')],
      ]),
    });
    renderSpotlight();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox', { name: 'Command search' });
    const firstActive = input.getAttribute('aria-activedescendant');
    const claimed = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    claimed.preventDefault();
    input.dispatchEvent(claimed);

    expect(input).toHaveAttribute('aria-activedescendant', firstActive);
  });

  it('keeps the Arrow-key-selected option visible without moving combobox focus', async () => {
    setState({
      channels: new Map([
        ['#forge', channel('#forge')],
        ['#lapis', channel('#lapis')],
      ]),
    });
    renderSpotlight();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox', { name: 'Command search' });
    await waitFor(() => expect(input).toHaveFocus());
    const nextOption = screen.getAllByRole('option')[1];
    if (!nextOption) throw new Error('Expected at least two Spotlight options');
    const scrollIntoView = vi.fn();
    Object.defineProperty(nextOption, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(input).toHaveAttribute('aria-activedescendant', nextOption.id);
    expect(input).toHaveFocus();
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    });
  });

  it('finds a reviewed anchor by preview and runs exact-id recall', async () => {
    setState({
      server: {
        id: 'spotlight',
        name: 'Spotlight test',
        network: 'spotlight',
        url: MEMORY_OWNER.serverUrl,
        icon: 'S',
        nick: 'kain',
        account: MEMORY_OWNER.identity,
        connected: true,
      } as never,
    });
    recordReviewHistory({
      target: '#forge',
      name: '#forge',
      kind: 'channel',
      firstMessageId: 'reviewed-exact-id',
      firstAt: '2026-07-09T08:15:00.000Z',
      reviewedAt: '2026-07-09T09:00:00.000Z',
      messageCount: 3,
      mentionCount: 1,
      preview: 'handoff packet approved',
    }, MEMORY_OWNER);
    const openVaultResult = vi.fn();
    const travelTo = vi.fn();
    setState({ openVaultResult, travelTo });
    renderSpotlight();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox', { name: 'Command search' });
    fireEvent.input(input, { target: { value: 'handoff approved' } });

    const recall = await screen.findByRole('option', { name: /Reopen reviewed #forge/ });
    fireEvent.click(recall);

    expect(openVaultResult).toHaveBeenCalledWith('#forge', 'reviewed-exact-id');
    expect(travelTo).toHaveBeenCalledWith(
      '#forge',
      new Date('2026-07-09T08:15:00.000Z'),
      'reviewed-exact-id',
    );
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('runs the active command on Enter and closes on Escape', () => {
    const joinChannel = vi.fn();
    const navigate = vi.fn();
    setState({
      channels: new Map([['#forge', channel('#forge')]]),
      joinChannel,
      navigate,
    });
    renderSpotlight();

    fireEvent.keyDown(window, { key: '/' });
    const input = screen.getByRole('combobox', { name: 'Command search' });
    fireEvent.input(input, { target: { value: 'forge' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(joinChannel).toHaveBeenCalledWith('#forge');
    expect(navigate).toHaveBeenCalledWith({ kind: 'channel', channel: '#forge' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Command search' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('restores focus to the launcher when closed', async () => {
    renderSpotlight();
    const launcher = screen.getByRole('button', { name: 'Before palette' });
    launcher.focus();
    expect(launcher).toHaveFocus();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = screen.getByRole('combobox', { name: 'Command search' });
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(launcher).toHaveFocus());
  });

  it('announces the result count without re-announcing the active option on navigation', () => {
    setState({
      channels: new Map([
        ['#forge', channel('#forge')],
        ['#lapis', channel('#lapis')],
      ]),
    });
    renderSpotlight();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox', { name: 'Command search' });
    const status = screen.getByRole('status');
    const announced = status.textContent;

    // The results status reflects the filtered set, not the active option.
    expect(announced).toMatch(/command/i);

    const firstActive = input.getAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    // Arrow navigation moves activedescendant (SR announces the option there)…
    expect(input.getAttribute('aria-activedescendant')).not.toBe(firstActive);
    // …but the live region must NOT change, or the option is announced twice.
    expect(status.textContent).toBe(announced);
  });

  it('can run a theme command from filtered results', () => {
    renderSpotlight();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = screen.getByRole('combobox', { name: 'Command search' });
    // Search by the theme's visible name (the 'shu' theme is labelled "Garnet").
    fireEvent.input(input, { target: { value: 'garnet' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(document.documentElement.getAttribute('data-theme')).toBe('shu');
  });
});
