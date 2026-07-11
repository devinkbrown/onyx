// SPDX-License-Identifier: AGPL-3.0-or-later
import { createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
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
