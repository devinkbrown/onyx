import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/lib/irc/types';
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
    document.documentElement.removeAttribute('data-ruri-background');
  });

  it('opens on Cmd/Ctrl+K and traps focus in the palette', async () => {
    renderSpotlight();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const input = screen.getByRole('combobox', { name: 'Command search' });
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Close spotlight' })).toHaveFocus();
  });

  it('opens on slash when the user is not typing in a field', () => {
    renderSpotlight();

    fireEvent.keyDown(window, { key: '/' });

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
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

  it('can run a theme command from filtered results', () => {
    renderSpotlight();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = screen.getByRole('combobox', { name: 'Command search' });
    fireEvent.input(input, { target: { value: 'theme shu' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(document.documentElement.getAttribute('data-theme')).toBe('shu');
  });
});
