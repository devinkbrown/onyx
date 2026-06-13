import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Button from '@/components/ui/Button';
import Tooltip from '@/components/ui/Tooltip';
import ConnectionBanner from '@/components/ui/ConnectionBanner';
import useReducedMotionGuard from '@/hooks/useReducedMotionGuard';
import { useOnyxStore } from '@/lib/store';

describe('Package H primitive motion contract', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps primary buttons solid and pressable without gradients or glow shadows', () => {
    const { container } = render(<Button variant="primary">Send</Button>);
    const styleText = container.querySelector('style')?.textContent ?? '';

    expect(screen.getByRole('button', { name: 'Send' })).toHaveClass('btn--primary');
    expect(styleText).not.toContain('linear-gradient');
    expect(styleText).not.toContain('accent-glow');
    expect(styleText).toContain('color-mix(in srgb, var(--accent, #0ea5e9) 94%, #000 6%)');
    expect(styleText).toContain('outline-offset: var(--focus-ring-offset');
    expect(styleText).toContain('translateY(0.5px)');
  });

  it('shows tooltips after the 300ms delay with the 90ms rise token', () => {
    vi.useFakeTimers();
    render(
      <Tooltip text="Mute">
        <button type="button">Mic</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByText('Mic'));
    act(() => vi.advanceTimersByTime(299));
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveAttribute('aria-hidden', 'true');

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('tooltip')).toHaveAttribute('aria-hidden', 'false');
    expect(document.querySelector('style')?.textContent).toContain('var(--t-micro, 90ms)');
  });

  it('derives a restored connection state and auto-dismisses it after three seconds', () => {
    vi.useFakeTimers();
    act(() => {
      useOnyxStore.setState({
        connectionStatus: 'reconnecting',
        reconnectIn: 1,
        server: null,
      });
    });

    render(<ConnectionBanner />);
    expect(screen.getByTestId('connection-banner')).toHaveTextContent('Connection lost. Reconnecting in 1s');

    act(() => {
      useOnyxStore.setState({ connectionStatus: 'connected' });
    });
    expect(screen.getByTestId('connection-banner')).toHaveTextContent('Connection restored.');

    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByTestId('connection-banner')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('connection-banner')).not.toBeInTheDocument();
  });

  it('exposes a reduced-motion guard for JS-driven spring values', () => {
    const listeners = new Set<() => void>();
    let matches = true;
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() {
        return matches;
      },
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: (_event: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_event: string, cb: () => void) => listeners.delete(cb),
    })));

    const { result } = renderHook(() => useReducedMotionGuard());
    expect(result.current.reducedMotion).toBe(true);
    expect(result.current.guardSpring('spring', 'static')).toBe('static');

    act(() => {
      matches = false;
      listeners.forEach(listener => listener());
    });

    expect(result.current.reducedMotion).toBe(false);
    expect(result.current.guardSpring('spring', 'static')).toBe('spring');
  });
});
