// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { ErrorBoundary, lazy, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { lazyRouteFallback, StaleChunkRecovery } from './StaleChunkRecovery';

afterEach(() => {
  cleanup();
});

describe('StaleChunkRecovery', () => {
  it('renders a professional reload / back-home recovery surface', () => {
    const onReload = vi.fn();
    render(() => (
      <StaleChunkRecovery onReload={onReload} homeHref="/" />
    ));

    expect(screen.getByTestId('stale-chunk-recovery')).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/fresh load/i);
    expect(screen.getByTestId('stale-chunk-home')).toHaveAttribute('href', '/');

    fireEvent.click(screen.getByTestId('stale-chunk-reload'));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('does not auto-reload on mount', () => {
    const onReload = vi.fn();
    render(() => <StaleChunkRecovery onReload={onReload} />);
    expect(onReload).not.toHaveBeenCalled();
  });

  it('shows recovery UI when a lazy route chunk rejects (no blank wallpaper-only output)', async () => {
    const Broken = lazy(async () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    const onReload = vi.fn();

    render(() => (
      <ErrorBoundary
        fallback={(err, reset) => (
          <StaleChunkRecovery
            onReload={onReload}
            secondaryLabel="Try again"
            onSecondary={reset}
          />
        )}
      >
        <Suspense fallback={<p data-testid="lazy-pending">Loading</p>}>
          <Broken />
        </Suspense>
      </ErrorBoundary>
    ));

    const recovery = await screen.findByTestId('stale-chunk-recovery');
    expect(recovery).toBeInTheDocument();
    expect(screen.queryByTestId('lazy-pending')).toBeNull();
    expect(onReload).not.toHaveBeenCalled();
    expect(screen.getByTestId('stale-chunk-home')).toBeInTheDocument();
  });

  it('lazyRouteFallback wires ErrorBoundary reset without auto-reload', () => {
    const reset = vi.fn();
    render(() => lazyRouteFallback(new Error('chunk'), reset));

    expect(screen.getByTestId('stale-chunk-recovery')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('stale-chunk-secondary'));
    expect(reset).toHaveBeenCalledOnce();
  });
});
