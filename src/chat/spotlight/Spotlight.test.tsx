// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/lib/irc/types';
import { recordReviewHistory } from '@/lib/notifications/reviewHistory';
import { setState } from '@/lib/store';
import { store } from '@/lib/store/store';
import { Spotlight, SpotlightProvider } from './index';

const initialState = store.getInitialState();

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

  it('opens on slash when the user is not typing in a field', () => {
    renderSpotlight();

    fireEvent.keyDown(window, { key: '/' });

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('teaches command grammar with focusable examples', () => {
    renderSpotlight();

    fireEvent.keyDown(window, { key: '/' });
    fireEvent.click(screen.getByRole('button', { name: 'Use command example goto #root at yesterday 21:00' }));

    expect(screen.getByRole('combobox', { name: 'Command search' })).toHaveValue('goto #root at yesterday 21:00');
    expect(screen.getByText('Time grammar')).toBeInTheDocument();
  });

  it('surfaces the grammar command produced by a clicked teaching example', async () => {
    renderSpotlight();

    fireEvent.keyDown(window, { key: '/' });
    fireEvent.click(screen.getByRole('button', { name: 'Use command example goto #root at yesterday 21:00' }));

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
    });
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
