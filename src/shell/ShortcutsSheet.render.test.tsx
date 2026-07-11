// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShortcutsSheet } from './ShortcutsSheet';

describe('ShortcutsSheet accessibility', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders as a named dialog with named shortcut groups', () => {
    render(() => <ShortcutsSheet open={true} onClose={() => undefined} />);

    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Palette shortcuts' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Navigation shortcuts' })).toBeInTheDocument();
    expect(screen.getByText('Open command palette')).toBeInTheDocument();
    expect(screen.getByLabelText('⌘ K / Ctrl K')).toBeInTheDocument();
  });

  it('exposes a labelled close action', () => {
    const onClose = vi.fn();
    render(() => <ShortcutsSheet open={true} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close shortcuts' }));

    expect(onClose).toHaveBeenCalled();
  });
});
