import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

afterEach(cleanup);

describe('IconButton', () => {
  it('renders an icon-only button with an accessible label', () => {
    render(() => <IconButton label="Mute channel">×</IconButton>);

    const button = screen.getByRole('button', { name: 'Mute channel' });

    expect(button.getAttribute('aria-label')).toBe('Mute channel');
    expect(button.classList.contains('ruri-icon-button--ghost')).toBe(true);
  });

  it('applies variant and size classes and forwards click behavior', () => {
    const onClick = vi.fn();
    render(() => <IconButton label="Delete" variant="danger" size="sm" onClick={onClick}>!</IconButton>);

    const button = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(button);

    expect(button.classList.contains('ruri-icon-button--danger')).toBe(true);
    expect(button.classList.contains('ruri-icon-button--sm')).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('can expose a tooltip for unfamiliar icons', () => {
    vi.useFakeTimers();
    render(() => <IconButton label="Archive" tooltip="Move thread to archive">□</IconButton>);

    const button = screen.getByRole('button', { name: 'Archive' });
    fireEvent.focusIn(button);
    vi.advanceTimersByTime(90);

    expect(screen.getByRole('tooltip').textContent).toBe('Move thread to archive');
    vi.useRealTimers();
  });
});
