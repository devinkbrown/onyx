// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Popover } from './Popover';

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

function restoreDescriptor(target: object, key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
    return;
  }

  Reflect.deleteProperty(target, key);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreDescriptor(window, 'innerWidth', originalInnerWidth);
  restoreDescriptor(window, 'innerHeight', originalInnerHeight);
  restoreDescriptor(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
  restoreDescriptor(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
});

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

  it('clamps desktop placement to the viewport and flips away from bottom overflow', async () => {
    vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false }) as MediaQueryList));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 240 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 140 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
      if (this.classList.contains('onyx-popover__trigger')) {
        return new DOMRect(210, 80, 40, 20);
      }
      return new DOMRect(0, 0, 0, 0);
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('onyx-popover__panel') ? 120 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('onyx-popover__panel') ? 80 : 0;
      },
    });

    render(() => (
      <Popover trigger="Status" defaultOpen>
        Mesh online
      </Popover>
    ));
    await Promise.resolve();

    const dialog = screen.getByRole('dialog');
    expect(dialog.style.position).toBe('fixed');
    expect(dialog.style.left).toBe('112px');
    expect(dialog.style.top).toBe('8px');
    expect(dialog.style.transform).toBe('none');
  });
});
