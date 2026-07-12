// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

afterEach(cleanup);

describe('Button', () => {
  it('renders the primary medium button by default', () => {
    render(() => <Button>Enter mesh</Button>);

    const button = screen.getByRole('button', { name: 'Enter mesh' });

    expect(button.classList.contains('onyx-button--primary')).toBe(true);
    expect(button.classList.contains('onyx-button--md')).toBe(true);
  });

  it('renders a polymorphic anchor when href is provided', () => {
    render(() => <Button href="/app" variant="ghost" size="sm">Open Onyx</Button>);

    const link = screen.getByRole('link', { name: 'Open Onyx' });

    expect(link.getAttribute('href')).toBe('/app');
    expect(link.classList.contains('onyx-button--ghost')).toBe(true);
    expect(link.classList.contains('onyx-button--sm')).toBe(true);
  });

  it('activates from Enter and Space key presses', () => {
    const onClick = vi.fn();
    render(() => <Button variant="danger" onClick={onClick}>Disconnect</Button>);

    const button = screen.getByRole('button', { name: 'Disconnect' });
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: ' ' });

    expect(button.classList.contains('onyx-button--danger')).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('ignores non-activation keyboard input', () => {
    const onClick = vi.fn();
    render(() => <Button onClick={onClick}>Open</Button>);

    const button = screen.getByRole('button', { name: 'Open' });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    fireEvent.keyDown(button, { key: 'Escape' });

    expect(onClick).not.toHaveBeenCalled();
  });

  it('marks disabled anchor buttons as unavailable', () => {
    render(() => <Button href="/danger" disabled>Disabled link</Button>);

    const link = screen.getByText('Disabled link');

    expect(link.getAttribute('aria-disabled')).toBe('true');
    expect(link.getAttribute('href')).toBeNull();
    expect(link.getAttribute('tabindex')).toBe('-1');
  });

  it('blocks click and keyboard activation for disabled anchor buttons', () => {
    const onClick = vi.fn();
    render(() => (
      <Button href="/danger" disabled onClick={onClick}>
        Disabled link
      </Button>
    ));

    const link = screen.getByText('Disabled link');
    fireEvent.click(link);
    fireEvent.keyDown(link, { key: 'Enter' });
    fireEvent.keyDown(link, { key: ' ' });

    expect(onClick).not.toHaveBeenCalled();
  });
});
