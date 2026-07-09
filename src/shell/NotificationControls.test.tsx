import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { store } from '@/lib/store/store';
import { NotificationControls } from './NotificationControls';

const initialState = store.getInitialState();

describe('NotificationControls accessibility', () => {
  beforeEach(() => {
    store.setState({
      ...initialState,
      soundEnabled: true,
      dndEnabled: false,
      dndUntil: null,
      pushNotificationsEnabled: false,
    }, true);
  });

  afterEach(() => {
    cleanup();
    store.setState(initialState, true);
  });

  it('exposes the compact controls as a labelled stateful group', () => {
    render(() => <NotificationControls />);

    expect(screen.getByRole('group', {
      name: 'Notification controls',
      description: /Desktop notifications unsupported; notification sound on; do not disturb off/i,
    })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Desktop notifications are not supported/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Mute notification sound/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Turn on do not disturb/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps sound and do-not-disturb state reflected in accessible labels', () => {
    render(() => <NotificationControls />);

    fireEvent.click(screen.getByRole('button', { name: /Mute notification sound/i }));
    fireEvent.click(screen.getByRole('button', { name: /Turn on do not disturb/i }));

    expect(screen.getByRole('button', { name: /Enable notification sound/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Turn off do not disturb/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', {
      name: 'Notification controls',
      description: /notification sound off; do not disturb on/i,
    })).toBeInTheDocument();
  });
});
