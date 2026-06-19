import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from './Tooltip';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Tooltip', () => {
  it('shows tooltip content on focus after the configured delay', () => {
    vi.useFakeTimers();
    render(() => (
      <Tooltip content="Shows channel details" openDelay={50}>
        <button type="button">Details</button>
      </Tooltip>
    ));

    const trigger = screen.getByRole('button', { name: 'Details' });
    fireEvent.focusIn(trigger);
    vi.advanceTimersByTime(50);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe('Shows channel details');
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('hides on Escape and does not render when disabled', () => {
    vi.useFakeTimers();
    render(() => (
      <Tooltip content="Hidden detail" disabled>
        <button type="button">Hidden</button>
      </Tooltip>
    ));

    const trigger = screen.getByRole('button', { name: 'Hidden' });
    fireEvent.focusIn(trigger);
    vi.advanceTimersByTime(120);
    fireEvent.keyDown(trigger, { key: 'Escape' });

    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
