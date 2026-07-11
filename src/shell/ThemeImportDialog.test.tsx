// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
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

describe('ThemeImportDialog accessibility', () => {
  afterEach(() => {
    cleanup();
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
});
