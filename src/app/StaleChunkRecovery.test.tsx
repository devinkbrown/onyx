// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { ErrorBoundary, lazy, Suspense } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { updateCoordinator } from '@/pwa/updateRecovery';
import { DeferredLoading, lazyRouteFallback, retryableLazy, StaleChunkRecovery } from './StaleChunkRecovery';

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

  it('gives simultaneous recovery cards unique accessible references', () => {
    render(() => (
      <>
        <StaleChunkRecovery title="First failure" detail="First details" />
        <StaleChunkRecovery title="Second failure" detail="Second details" />
      </>
    ));

    const cards = screen.getAllByTestId('stale-chunk-recovery');
    const labelledBy = cards.map((card) => card.getAttribute('aria-labelledby'));
    const describedBy = cards.map((card) => card.getAttribute('aria-describedby'));

    expect(new Set(labelledBy).size).toBe(2);
    expect(new Set(describedBy).size).toBe(2);
    for (const card of cards) {
      expect(card.querySelector(`#${card.getAttribute('aria-labelledby')}`)).toBeTruthy();
      expect(card.querySelector(`#${card.getAttribute('aria-describedby')}`)).toBeTruthy();
    }
  });

  it('uses the guarded coordinator on the default reload path', () => {
    const requestReload = vi.spyOn(updateCoordinator, 'requestReload').mockReturnValue(false);

    render(() => <StaleChunkRecovery />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload the current app' }));

    expect(requestReload).toHaveBeenCalledOnce();
    expect(requestReload).toHaveBeenCalledWith(expect.any(Function));
    requestReload.mockRestore();
  });

  it('does not throw or bypass safety when the recovery coordinator is unavailable', () => {
    const requestReload = vi.spyOn(updateCoordinator, 'requestReload').mockImplementation(() => {
      throw new Error('recovery module unavailable');
    });

    render(() => <StaleChunkRecovery />);
    expect(() => fireEvent.click(screen.getByTestId('stale-chunk-reload'))).not.toThrow();

    expect(requestReload).toHaveBeenCalledOnce();
    requestReload.mockRestore();
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

  it('does not call a generic component failure an update', () => {
    render(() => lazyRouteFallback(new Error('catalogue crashed'), vi.fn()));
    expect(screen.getByText('Unable to load')).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('could not load');
    expect(screen.queryByText('Update')).toBeNull();
  });

  it('provides a visible accessible loading state', () => {
    render(() => <DeferredLoading label="Loading spotlight…" />);
    const loading = screen.getByRole('status');
    expect(loading).toHaveTextContent('Loading spotlight…');
    expect(loading).toHaveClass('deferred-loading');
    expect(loading.querySelector('.deferred-loading__spinner')).toBeTruthy();
  });

  it('retries with a fresh loader after reject-then-resolve', async () => {
    let calls = 0;
    const Retryable = retryableLazy(async () => {
      calls += 1;
      if (calls === 1) throw new Error('first load failed');
      return { default: () => <p data-testid="recovered">Recovered</p> };
    }, 'test surface');

    render(() => <Retryable />);
    expect(await screen.findByRole('heading')).toHaveTextContent('Could not load test surface');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('recovered')).toBeInTheDocument();
    expect(calls).toBe(2);
  });
});
