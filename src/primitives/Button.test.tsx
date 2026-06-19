import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

afterEach(cleanup);

describe('Button', () => {
  it('renders the primary medium button by default', () => {
    render(() => <Button>Enter mesh</Button>);

    const button = screen.getByRole('button', { name: 'Enter mesh' });

    expect(button.classList.contains('ruri-button--primary')).toBe(true);
    expect(button.classList.contains('ruri-button--md')).toBe(true);
  });

  it('renders a polymorphic anchor when href is provided', () => {
    render(() => <Button href="/app" variant="ghost" size="sm">Open Ruri</Button>);

    const link = screen.getByRole('link', { name: 'Open Ruri' });

    expect(link.getAttribute('href')).toBe('/app');
    expect(link.classList.contains('ruri-button--ghost')).toBe(true);
    expect(link.classList.contains('ruri-button--sm')).toBe(true);
  });

  it('activates from Enter and Space key presses', () => {
    const onClick = vi.fn();
    render(() => <Button variant="danger" onClick={onClick}>Disconnect</Button>);

    const button = screen.getByRole('button', { name: 'Disconnect' });
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: ' ' });

    expect(button.classList.contains('ruri-button--danger')).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('marks disabled anchor buttons as unavailable', () => {
    render(() => <Button href="/danger" disabled>Disabled link</Button>);

    const link = screen.getByText('Disabled link');

    expect(link.getAttribute('aria-disabled')).toBe('true');
    expect(link.getAttribute('href')).toBeNull();
    expect(link.getAttribute('tabindex')).toBe('-1');
  });
});
