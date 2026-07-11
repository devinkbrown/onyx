// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Popover } from './Popover';

afterEach(cleanup);

describe('Popover', () => {
  it('opens anchored popover content from its trigger', () => {
    const onOpenChange = vi.fn();
    render(() => (
      <Popover trigger="Open menu" onOpenChange={onOpenChange}>
        <button type="button">Join #root</button>
      </Popover>
    ));

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(dialog.textContent).toContain('Join #root');
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('supports default open state and closes on Escape', () => {
    const onOpenChange = vi.fn();
    render(() => (
      <Popover trigger="Status" defaultOpen placement="top" onOpenChange={onOpenChange}>
        Mesh online
      </Popover>
    ));

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(dialog.parentElement?.getAttribute('data-placement')).toBe('top');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
