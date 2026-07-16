// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
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

  it('stays open when an input method or earlier handler owns Escape', () => {
    render(() => (
      <Popover trigger="Status" defaultOpen>
        Mesh online
      </Popover>
    ));

    fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const claimed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    claimed.preventDefault();
    document.body.dispatchEvent(claimed);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('restores the trigger after Escape even when the opener was not browser-focused', async () => {
    render(() => (
      <Popover trigger="Open actions">
        <button type="button">Inside action</button>
      </Popover>
    ));
    const trigger = screen.getByRole('button', { name: 'Open actions' });
    fireEvent.click(trigger);
    const inside = screen.getByRole('button', { name: 'Inside action' });
    inside.focus();

    fireEvent.keyDown(inside, { key: 'Escape' });

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('syncs native light-dismiss, restores focus, and reopens on the next click', async () => {
    const onOpenChange = vi.fn();
    render(() => (
      <Popover trigger="Actions" onOpenChange={onOpenChange}>
        <button type="button">Room actions</button>
      </Popover>
    ));

    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    screen.getByRole('button', { name: 'Room actions' }).focus();
    const toggle = new Event('toggle');
    Object.defineProperty(toggle, 'newState', { value: 'closed' });
    dialog.dispatchEvent(toggle);

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog').textContent).toContain('Room actions');
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it('restores focus after fallback outside-pointer dismissal', async () => {
    render(() => (
      <div>
        <button type="button">Outside target</button>
        <Popover trigger="Open menu">
          <button type="button">Inside target</button>
        </Popover>
      </div>
    ));
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    screen.getByRole('button', { name: 'Inside target' }).focus();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside target' }));

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('captures an external opener for a controlled close', async () => {
    function Harness() {
      const [open, setOpen] = createSignal(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>External opener</button>
          <Popover trigger="Internal trigger" open={open()} onOpenChange={setOpen}>
            <button type="button" onClick={() => setOpen(false)}>Controlled close</button>
          </Popover>
        </>
      );
    }
    render(() => <Harness />);
    const external = screen.getByRole('button', { name: 'External opener' });
    external.focus();
    fireEvent.click(external);
    const close = screen.getByRole('button', { name: 'Controlled close' });
    close.focus();

    fireEvent.click(close);

    await waitFor(() => expect(external).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Internal trigger' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes only the top nested popover per Escape and restores each opener', async () => {
    render(() => (
      <Popover trigger="Outer trigger">
        <Popover trigger="Inner trigger">
          <button type="button">Inner action</button>
        </Popover>
      </Popover>
    ));
    const outer = screen.getByRole('button', { name: 'Outer trigger' });
    fireEvent.click(outer);
    const inner = screen.getByRole('button', { name: 'Inner trigger' });
    fireEvent.click(inner);
    const action = screen.getByRole('button', { name: 'Inner action' });
    action.focus();

    fireEvent.keyDown(action, { key: 'Escape' });

    await waitFor(() => expect(inner).toHaveFocus());
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(outer).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(inner, { key: 'Escape' });
    await waitFor(() => expect(outer).toHaveFocus());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not focus a captured opener after that opener is unmounted', async () => {
    let closeControlled!: () => void;
    let removeOpener!: () => void;
    function Harness() {
      const [open, setOpen] = createSignal(false);
      const [showOpener, setShowOpener] = createSignal(true);
      closeControlled = () => setOpen(false);
      removeOpener = () => setShowOpener(false);
      return (
        <>
          <Show when={showOpener()}>
            <button type="button" onClick={() => setOpen(true)}>Temporary opener</button>
          </Show>
          <Popover trigger="Internal trigger" open={open()}>
            Popover body
          </Popover>
        </>
      );
    }
    render(() => <Harness />);
    const temporary = screen.getByRole('button', { name: 'Temporary opener' });
    temporary.focus();
    fireEvent.click(temporary);
    const focus = vi.spyOn(temporary, 'focus');
    focus.mockClear();

    removeOpener();
    closeControlled();
    await Promise.resolve();

    expect(temporary.isConnected).toBe(false);
    expect(focus).not.toHaveBeenCalled();
  });

  it('restores focus at most once when native close follows Escape', async () => {
    render(() => (
      <Popover trigger="Open once">
        <button type="button">Inside once</button>
      </Popover>
    ));
    const trigger = screen.getByRole('button', { name: 'Open once' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    screen.getByRole('button', { name: 'Inside once' }).focus();
    const focus = vi.spyOn(trigger, 'focus');

    fireEvent.keyDown(document.body, { key: 'Escape' });
    const toggle = new Event('toggle');
    Object.defineProperty(toggle, 'newState', { value: 'closed' });
    dialog.dispatchEvent(toggle);

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(focus).toHaveBeenCalledTimes(1);
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
