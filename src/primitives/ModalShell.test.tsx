// SPDX-License-Identifier: AGPL-3.0-or-later
import { createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ModalShell } from './ModalShell';

const tick = () => new Promise((resolve) => window.setTimeout(resolve, 0));

afterEach(cleanup);

describe('ModalShell', () => {
  it('renders an accessible modal dialog with layered Onyx structure', () => {
    render(() => (
      <ModalShell open title="Confirm disconnect" description="Leave the current room" onOpenChange={() => undefined}>
        <button type="button">Stay connected</button>
      </ModalShell>
    ));

    const dialog = screen.getByRole('dialog', { name: 'Confirm disconnect' });

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.classList.contains('onyx-modal__dialog')).toBe(true);
    expect(dialog.textContent).toContain('Leave the current room');
  });

  it('closes from Escape through the controlled open signal', async () => {
    function Harness() {
      const [open, setOpen] = createSignal(true);
      return (
        <ModalShell open={open()} title="Settings" onOpenChange={setOpen}>
          <button type="button">Save</button>
        </ModalShell>
      );
    }

    render(() => <Harness />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await tick();

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes from the inert backdrop click target', async () => {
    function Harness() {
      const [open, setOpen] = createSignal(true);
      return (
        <ModalShell open={open()} title="Settings" onOpenChange={setOpen}>
          <button type="button">Save</button>
        </ModalShell>
      );
    }

    render(() => <Harness />);
    const backdrop = document.querySelector<HTMLElement>('.onyx-modal__backdrop');
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(backdrop!);
    await tick();

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('wraps focus from the last focusable control back to the close button', async () => {
    render(() => (
      <ModalShell open title="Keyboard trap" onOpenChange={() => undefined}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </ModalShell>
    ));
    await tick();

    const close = screen.getByRole('button', { name: 'Close dialog' });
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    fireEvent.keyDown(document.body, { key: 'Tab' });

    expect(document.activeElement).toBe(close);
  });

  it('wraps focus backward from the close button to the last control on Shift+Tab', async () => {
    render(() => (
      <ModalShell open title="Keyboard trap" onOpenChange={() => undefined}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </ModalShell>
    ));
    await tick();

    const close = screen.getByRole('button', { name: 'Close dialog' });
    const last = screen.getByRole('button', { name: 'Last' });
    close.focus();
    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(last);
  });

  it('restores focus to the triggering element when the dialog closes', async () => {
    function Harness() {
      const [open, setOpen] = createSignal(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open settings
          </button>
          <ModalShell open={open()} title="Settings" onOpenChange={setOpen}>
            <button type="button">Save</button>
          </ModalShell>
        </>
      );
    }

    render(() => <Harness />);
    const trigger = screen.getByRole('button', { name: 'Open settings' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    await tick();
    // Focus moved into the dialog on open.
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await tick();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('recaptures focus that has drifted outside the dialog on Tab', async () => {
    // A control inside a modal that is later removed/disabled leaves the browser
    // with focus on <body> (or a background element). A Tab from there must be
    // pulled back into the dialog, never allowed to traverse the page. (SC 2.4.3)
    const stray = document.createElement('button');
    stray.textContent = 'Background';
    document.body.appendChild(stray);

    render(() => (
      <ModalShell open title="Escape trap" onOpenChange={() => undefined}>
        <button type="button">Inside</button>
      </ModalShell>
    ));
    await tick();

    stray.focus();
    expect(document.activeElement).toBe(stray);

    fireEvent.keyDown(document.body, { key: 'Tab' });

    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);

    stray.remove();
  });
});
