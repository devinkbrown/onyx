// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as clipboard from '@/lib/clipboard/writeClipboardText';
import { addCustomTheme } from './customThemes';
import { ThemeProvider } from './ThemeProvider';
import { SEED_EXPORT_KIND } from './seedTransfer';
import { ThemeStudio } from './ThemeStudio';
import { persistThemeId } from './themeStorage';

function mountStudio() {
  return render(() => (
    <ThemeProvider>
      <ThemeStudio />
    </ThemeProvider>
  ));
}

describe('Theme Studio clipboard actions', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('waits for theme export completion and guards rapid repeated clicks', async () => {
    let resolveCopy: (copied: boolean) => void = () => {};
    const pending = new Promise<boolean>((resolve) => {
      resolveCopy = resolve;
    });
    const write = vi.spyOn(clipboard, 'writeClipboardText').mockReturnValue(pending);
    mountStudio();

    const button = screen.getByTestId('ts-export-btn') as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);

    expect(write).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('[copying…]');
    expect(screen.queryByText('[copied!]')).not.toBeInTheDocument();

    resolveCopy(true);

    expect(await screen.findByText('[copied!]')).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(screen.queryByTestId('ts-copy-error')).not.toBeInTheDocument();

    const payload = JSON.parse(write.mock.calls[0]?.[0] ?? '{}') as Record<string, unknown>;
    expect(payload.__onyx_theme_export__).toBe(true);
  });

  it('keeps the export action truthful when clipboard copying fails', async () => {
    vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(false);
    mountStudio();

    fireEvent.click(screen.getByTestId('ts-export-btn'));

    expect(await screen.findByTestId('ts-copy-error')).toHaveTextContent('Theme export copy failed');
    expect(screen.getByTestId('ts-export-btn')).toHaveTextContent('[export]');
    expect(screen.queryByText('[copied!]')).not.toBeInTheDocument();
  });

  it('reports portable seed success only after the shared writer resolves', async () => {
    const write = vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(true);
    mountStudio();

    fireEvent.click(screen.getByTestId('ts-export-seed'));

    expect(await screen.findByText('[✓ seed copied]')).toBeInTheDocument();
    expect(screen.queryByTestId('ts-seed-copy-error')).not.toBeInTheDocument();
    const payload = JSON.parse(write.mock.calls[0]?.[0] ?? '{}') as Record<string, unknown>;
    expect(payload.kind).toBe(SEED_EXPORT_KIND);
  });

  it('copies a custom-theme share link through the same truthful pathway', async () => {
    const custom = addCustomTheme('Clipboard Test', 'onyx', { '--lapis': '#00aacc' });
    persistThemeId(custom.id);
    const write = vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(true);
    mountStudio();

    fireEvent.click(screen.getByTestId('ts-share-btn'));

    expect(await screen.findByText('[copied!]')).toBeInTheDocument();
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toContain('?theme=');
  });

  it('ignores a pending clipboard completion after the studio unmounts', async () => {
    let resolveCopy: (copied: boolean) => void = () => {};
    vi.spyOn(clipboard, 'writeClipboardText').mockReturnValue(new Promise((resolve) => {
      resolveCopy = resolve;
    }));
    const view = mountStudio();

    fireEvent.click(screen.getByTestId('ts-export-btn'));
    view.unmount();
    resolveCopy(true);
    await Promise.resolve();

    expect(screen.queryByText('[copied!]')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ts-copy-error')).not.toBeInTheDocument();
  });
});
