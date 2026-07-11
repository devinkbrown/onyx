// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setCalmPreset } from '@/lib/notifications/calmMode';
import { store } from '@/lib/store/store';
import { NotificationControls } from './NotificationControls';

const initialState = store.getInitialState();

describe('NotificationControls accessibility', () => {
  beforeEach(() => {
    localStorage.clear();
    setCalmPreset('regular');
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
    setCalmPreset('regular');
    localStorage.clear();
  });

  it('exposes the compact controls as a labelled stateful group', () => {
    render(() => <NotificationControls />);

    expect(screen.getByRole('group', {
      name: 'Notification controls',
      description: /Desktop notifications unsupported; notification mode Regular; notification sound on; do not disturb off/i,
    })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Desktop notifications are not supported/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Notification mode Regular/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Mute notification sound/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Turn on do not disturb/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps calm, sound and do-not-disturb state reflected in accessible labels', () => {
    render(() => <NotificationControls />);

    fireEvent.click(screen.getByRole('button', { name: /Notification mode Regular/i }));
    fireEvent.click(screen.getByRole('button', { name: /Mute notification sound/i }));
    fireEvent.click(screen.getByRole('button', { name: /Turn on do not disturb/i }));

    expect(screen.getByRole('button', { name: /Notification mode Power/i })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('onyx:calm')).toBe('power');
    expect(screen.getByRole('button', { name: /Enable notification sound/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Turn off do not disturb/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', {
      name: 'Notification controls',
      description: /notification mode Power; notification sound off; do not disturb on/i,
    })).toBeInTheDocument();
  });

  it('cycles compact calm presets through the same persisted mode as preferences', () => {
    render(() => <NotificationControls />);

    fireEvent.click(screen.getByRole('button', { name: /Notification mode Regular/i }));
    expect(screen.getByRole('button', { name: /Notification mode Power/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Notification mode Power/i }));
    expect(screen.getByRole('button', { name: /Notification mode Calm/i })).toBeInTheDocument();
    expect(localStorage.getItem('onyx:calm')).toBe('calm');

    fireEvent.click(screen.getByRole('button', { name: /Notification mode Calm/i }));
    expect(screen.getByRole('button', { name: /Notification mode Regular/i })).toHaveAttribute('aria-pressed', 'false');
  });
});
