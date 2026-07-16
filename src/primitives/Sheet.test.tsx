// SPDX-License-Identifier: AGPL-3.0-or-later
import { createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { focusFirst } from './focusTrap';
import { Sheet } from './Sheet';

const tick = () => new Promise((resolve) => window.setTimeout(resolve, 0));

afterEach(cleanup);

describe('Sheet', () => {
  it('renders an accessible right-side dialog with title and description', () => {
    render(() => (
      <Sheet open title="Whois" description="Inspect this user" onOpenChange={() => undefined}>
        <button type="button">Message</button>
      </Sheet>
    ));

    const dialog = screen.getByRole('dialog', { name: 'Whois' });

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('Inspect this user');
    expect(screen.getByRole('button', { name: 'Message' })).toBeTruthy();
  });

  it('moves initial focus past disabled and roving-tab controls that are out of the tab order', () => {
    const panel = document.createElement('div');
    panel.innerHTML = `
      <button type="button" disabled>Unavailable action</button>
      <button type="button" role="tab" tabindex="-1">Inactive category</button>
      <button type="button" role="tab" tabindex="0">Selected category</button>
    `;
    document.body.appendChild(panel);

    focusFirst(panel);

    expect(panel.querySelector('[role="tab"][tabindex="0"]')).toHaveFocus();
    panel.remove();
  });

  it('closes from Escape through the controlled open signal', async () => {
    function Harness() {
      const [open, setOpen] = createSignal(true);
      return (
        <Sheet open={open()} title="Thread" onOpenChange={setOpen}>
          <button type="button">Reply</button>
        </Sheet>
      );
    }

    render(() => <Harness />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await tick();

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('restores an explicit durable target when the visible opener is removed', async () => {
    const returnTarget = document.createElement('button');
    returnTarget.textContent = 'Member row';
    document.body.appendChild(returnTarget);

    function Harness() {
      const [open, setOpen] = createSignal(true);
      return (
        <Sheet open={open()} title="Profile" returnFocus={returnTarget} onOpenChange={setOpen}>
          <button type="button">Temporary action</button>
        </Sheet>
      );
    }

    render(() => <Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await tick();

    expect(returnTarget).toHaveFocus();
    returnTarget.remove();
  });

  it('uses a stable fallback when the explicit return target is removed while open', async () => {
    const returnTarget = document.createElement('button');
    const fallback = document.createElement('div');
    fallback.tabIndex = -1;
    document.body.append(returnTarget, fallback);

    function Harness() {
      const [open, setOpen] = createSignal(true);
      return (
        <Sheet
          open={open()}
          title="Profile"
          returnFocus={returnTarget}
          returnFocusFallback={fallback}
          onOpenChange={setOpen}
        >
          <button type="button">Temporary action</button>
        </Sheet>
      );
    }

    render(() => <Harness />);
    returnTarget.remove();
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await tick();

    expect(fallback).toHaveFocus();
    fallback.remove();
  });

  it('closes from the inert backdrop click target', async () => {
    function Harness() {
      const [open, setOpen] = createSignal(true);
      return (
        <Sheet open={open()} title="Thread" onOpenChange={setOpen}>
          <button type="button">Reply</button>
        </Sheet>
      );
    }

    render(() => <Harness />);
    const backdrop = document.querySelector<HTMLElement>('.onyx-sheet__backdrop');
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(backdrop!);
    await tick();

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('traps Tab focus inside the panel', async () => {
    render(() => (
      <Sheet open title="Members" onOpenChange={() => undefined}>
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </Sheet>
    ));
    await tick();

    const close = screen.getByRole('button', { name: 'Close panel' });
    const last = screen.getByRole('button', { name: 'Last action' });
    last.focus();
    fireEvent.keyDown(document.body, { key: 'Tab' });

    expect(document.activeElement).toBe(close);
  });

  it('wraps focus backward from the close button to the last control on Shift+Tab', async () => {
    render(() => (
      <Sheet open title="Members" onOpenChange={() => undefined}>
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </Sheet>
    ));
    await tick();

    const close = screen.getByRole('button', { name: 'Close panel' });
    const last = screen.getByRole('button', { name: 'Last action' });
    close.focus();
    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(last);
  });

  it('restores focus to the triggering element when the sheet closes', async () => {
    function Harness() {
      const [open, setOpen] = createSignal(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open thread
          </button>
          <Sheet open={open()} title="Thread" onOpenChange={setOpen}>
            <button type="button">Reply</button>
          </Sheet>
        </>
      );
    }

    render(() => <Harness />);
    const trigger = screen.getByRole('button', { name: 'Open thread' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    await tick();
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await tick();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('recaptures focus that has drifted outside the sheet on Tab', async () => {
    // A control inside the panel that is later removed/disabled leaves the
    // browser with focus on <body> (or a background element). A Tab from there
    // must be pulled back into the panel, never allowed to traverse the
    // background page. (SC 2.4.3)
    const stray = document.createElement('button');
    stray.textContent = 'Background';
    document.body.appendChild(stray);

    render(() => (
      <Sheet open title="Escape trap" onOpenChange={() => undefined}>
        <button type="button">Inside</button>
      </Sheet>
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
