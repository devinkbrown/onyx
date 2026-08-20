// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';

import { AccessibilityStatement } from './AccessibilityStatement';

describe('AccessibilityStatement', () => {
  afterEach(cleanup);

  it('publishes current dense-client audit evidence', () => {
    render(() => <AccessibilityStatement />);

    expect(screen.getByRole('heading', { level: 2, name: 'Accessibility statement' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Conformance posture' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Standard' })).toBeInTheDocument();
    expect(document.querySelector('h1')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Current client audit' })).toBeInTheDocument();
    expect(screen.getByText(/Room settings uses a labelled Sheet/i)).toBeInTheDocument();
    expect(screen.getByText(/Voice controls use a toolbar/i)).toBeInTheDocument();
    expect(screen.getByText(/Appearance uses radio groups/i)).toBeInTheDocument();
    expect(screen.getByText(/Home catch-up exposes recaps/i)).toBeInTheDocument();
    expect(screen.getByText(/Message search uses a search landmark/i)).toBeInTheDocument();
    expect(screen.getByText(/Notification center uses a named inbox dialog/i)).toBeInTheDocument();
    expect(screen.getByText(/Room browser uses a Sheet dialog/i)).toBeInTheDocument();
    expect(screen.getByText(/Account panel groups account management/i)).toBeInTheDocument();
    expect(screen.getByText(/Room sidebar uses a complementary navigation landmark/i)).toBeInTheDocument();
    expect(screen.getByText(/Keyboard shortcuts uses a named Sheet dialog/i)).toBeInTheDocument();
    expect(screen.getByText(/Command palette uses a named dialog/i)).toBeInTheDocument();
    expect(screen.getByText(/Pinned messages uses a named Sheet dialog/i)).toBeInTheDocument();
    expect(screen.getByText(/Theme import uses a named Sheet dialog/i)).toBeInTheDocument();
    expect(screen.getByText(/Thread panel uses a named Sheet dialog/i)).toBeInTheDocument();
    expect(screen.getByText(/Voice settings uses a named Sheet dialog/i)).toBeInTheDocument();
    expect(screen.getByText(/Call overlays use named incoming\/outgoing dialogs/i)).toBeInTheDocument();
    expect(screen.getByText(/Message actions use per-row action groups/i)).toBeInTheDocument();
    expect(screen.getByText(/Member list uses a room-scoped complementary landmark/i)).toBeInTheDocument();
    expect(screen.getByText(/Notification controls use a labelled compact control group/i)).toBeInTheDocument();
    expect(screen.getByText(/Time scrubber uses a room-scoped region/i)).toBeInTheDocument();
    expect(screen.getByText(/Jump to date uses a named Sheet dialog/i)).toBeInTheDocument();
    expect(screen.getByText(/Reader memory uses a named device-memory region/i)).toBeInTheDocument();
    expect(screen.getByText(/Preferences dense rows use segmented radio groups/i)).toBeInTheDocument();
    expect(screen.getByText(/Message transcript uses a named live log/i)).toBeInTheDocument();
    expect(screen.getByText(/without exposing E2EE ciphertext/i)).toBeInTheDocument();
    expect(screen.getByText(/mention states/i)).toBeInTheDocument();
    expect(screen.getByText(/thread-panel body parity/i)).toBeInTheDocument();
    expect(screen.getByText(/focus retention across MODE\/PART/i)).toBeInTheDocument();
  });
});
