import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';

import { AccessibilityStatement } from './AccessibilityStatement';

describe('AccessibilityStatement', () => {
  afterEach(cleanup);

  it('publishes current dense-client audit evidence', () => {
    render(() => <AccessibilityStatement />);

    expect(screen.getByRole('heading', { name: 'Current client audit' })).toBeInTheDocument();
    expect(screen.getByText(/Channel settings uses a labelled Sheet/i)).toBeInTheDocument();
    expect(screen.getByText(/Voice controls use a toolbar/i)).toBeInTheDocument();
    expect(screen.getByText(/Appearance uses radio groups/i)).toBeInTheDocument();
    expect(screen.getByText(/Home catch-up exposes recaps/i)).toBeInTheDocument();
    expect(screen.getByText(/Message search uses a search landmark/i)).toBeInTheDocument();
    expect(screen.getByText(/Notification center uses a named inbox dialog/i)).toBeInTheDocument();
    expect(screen.getByText(/Channel browser uses a Sheet dialog/i)).toBeInTheDocument();
    expect(screen.getByText(/Account panel groups account management/i)).toBeInTheDocument();
    expect(screen.getByText(/Channel sidebar uses a complementary navigation landmark/i)).toBeInTheDocument();
    expect(screen.getByText(/Keyboard shortcuts uses a named Sheet dialog/i)).toBeInTheDocument();
    expect(screen.getByText(/Pinned messages uses a named Sheet dialog/i)).toBeInTheDocument();
    expect(screen.getByText(/Theme import uses a named Sheet dialog/i)).toBeInTheDocument();
  });
});
