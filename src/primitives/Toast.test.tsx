// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster, clearToasts, toast, toasts } from './Toast';

afterEach(() => {
  cleanup();
  clearToasts();
  vi.useRealTimers();
});

beforeEach(clearToasts);

describe('Toast', () => {
  it('renders signal-store notifications in the toaster host', () => {
    render(() => <Toaster />);

    const id = toast({ title: 'Saved', description: 'Thread settings updated', intent: 'success', duration: Number.POSITIVE_INFINITY });
    const status = screen.getByRole('status');

    expect(status.textContent).toContain('Saved');
    expect(status.textContent).toContain('Thread settings updated');
    expect(toasts().some((item) => item.id === id)).toBe(true);
  });

  it('uses alert semantics for danger toasts and dismisses from the close button', () => {
    render(() => <Toaster />);
    toast({ title: 'Disconnected', intent: 'danger', duration: Number.POSITIVE_INFINITY });

    const alert = screen.getByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Disconnected' }));

    expect(alert.classList.contains('onyx-toast--danger')).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('auto-dismisses toasts after their duration', () => {
    vi.useFakeTimers();
    render(() => <Toaster />);
    toast({ title: 'Queued', duration: 100 });

    expect(screen.getByRole('status').textContent).toContain('Queued');
    vi.advanceTimersByTime(100);

    expect(screen.queryByRole('status')).toBeNull();
  });
});
