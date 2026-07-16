// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeTheme } from '@/lib/theme/themeShare';
import type { CustomTheme } from '@/theme';
import { ThemeImportDialog } from './ThemeImportDialog';

const sharedTheme: CustomTheme = {
  id: 'custom:shared',
  name: 'Shared Theme',
  base: 'ocean',
  overrides: { '--lapis': '#33ccff' },
};

function deferredVoid(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ThemeImportDialog accessibility', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders import guidance and a target-specific import action', () => {
    render(() => (
      <ThemeImportDialog
        open={true}
        onClose={() => undefined}
        onImport={() => undefined}
        shareTheme={sharedTheme}
      />
    ));

    const input = screen.getByLabelText('Theme code or link');
    expect(screen.getByRole('dialog', { name: 'Share & import a theme' })).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription('Paste a shared Onyx theme code or a link that contains one.');

    fireEvent.input(input, { target: { value: encodeTheme(sharedTheme) } });

    expect(screen.getByRole('button', { name: 'Import theme Shared Theme' })).toBeInTheDocument();
  });

  it('announces invalid theme codes through the import field description', () => {
    render(() => (
      <ThemeImportDialog
        open={true}
        onClose={() => undefined}
        onImport={() => undefined}
      />
    ));

    const input = screen.getByLabelText('Theme code or link');
    fireEvent.input(input, { target: { value: 'not-a-theme' } });

    expect(input).toHaveAccessibleDescription(
      "Paste a shared Onyx theme code or a link that contains one. That doesn't look like a valid theme code.",
    );
  });

  it('uses the shared theme name for the copy action', () => {
    render(() => (
      <ThemeImportDialog
        open={true}
        onClose={() => undefined}
        onImport={vi.fn()}
        shareTheme={sharedTheme}
      />
    ));

    expect(screen.getByRole('button', { name: 'Copy share link for Shared Theme' })).toBeInTheDocument();
  });

  it('reports a successful clipboard write without changing the share semantics', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(() => (
      <ThemeImportDialog
        open={true}
        onClose={() => undefined}
        onImport={vi.fn()}
        shareTheme={sharedTheme}
      />
    ));

    const button = screen.getByRole('button', { name: 'Copy share link for Shared Theme' });
    fireEvent.click(button);

    const status = await screen.findByText('Share link copied for Shared Theme.');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(button).toHaveTextContent('Copied');
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('?theme='));
  });

  it('ignores a clipboard success that resolves after close', async () => {
    const pending = deferredVoid();
    const writeText = vi.fn(() => pending.promise);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const [open, setOpen] = createSignal(true);
    render(() => (
      <ThemeImportDialog
        open={open()}
        onClose={() => setOpen(false)}
        onImport={vi.fn()}
        shareTheme={sharedTheme}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Copy share link for Shared Theme' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    pending.resolve();
    await flushMicrotasks();
    setOpen(true);

    expect(screen.getByRole('button', { name: 'Copy share link for Shared Theme' })).toHaveTextContent('Copy link');
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('reports a rejected clipboard write and never claims it copied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(() => (
      <ThemeImportDialog
        open={true}
        onClose={() => undefined}
        onImport={vi.fn()}
        shareTheme={sharedTheme}
      />
    ));

    const button = screen.getByRole('button', { name: 'Copy share link for Shared Theme' });
    fireEvent.click(button);

    const status = await screen.findByText(/Could not copy the share link for Shared Theme\./);
    expect(status).toHaveAttribute('role', 'status');
    expect(button).toHaveTextContent('Copy failed');
    expect(button).not.toHaveTextContent('Copied');
  });

  it('ignores a clipboard failure that resolves after close', async () => {
    const pending = deferredVoid();
    const writeText = vi.fn(() => pending.promise);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const [open, setOpen] = createSignal(true);
    render(() => (
      <ThemeImportDialog
        open={open()}
        onClose={() => setOpen(false)}
        onImport={vi.fn()}
        shareTheme={sharedTheme}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Copy share link for Shared Theme' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    pending.reject(new Error('denied'));
    await flushMicrotasks();
    setOpen(true);

    expect(screen.getByRole('button', { name: 'Copy share link for Shared Theme' })).toHaveTextContent('Copy link');
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('keeps the copy action available and reports failure when the Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    render(() => (
      <ThemeImportDialog
        open={true}
        onClose={() => undefined}
        onImport={vi.fn()}
        shareTheme={sharedTheme}
      />
    ));

    const button = screen.getByRole('button', { name: 'Copy share link for Shared Theme' });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await screen.findByText(/Could not copy the share link for Shared Theme\./);
    expect(button).toHaveTextContent('Copy failed');
    expect(button).not.toHaveTextContent('Copied');
  });
});
