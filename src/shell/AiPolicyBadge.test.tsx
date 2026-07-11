// SPDX-License-Identifier: AGPL-3.0-or-later
import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';

import { AiPolicyBadge, aiPolicyBadgeText } from './AiPolicyBadge';

describe('AiPolicyBadge', () => {
  it('hides open policy rooms', () => {
    const { container } = render(() => <AiPolicyBadge policy="open" channel="#room" />);

    expect(container.textContent).toBe('');
  });

  it('labels no-ai rooms as disabled for AI surfaces', () => {
    render(() => <AiPolicyBadge policy="no-ai" channel="#room" />);

    expect(screen.getByText('No AI')).toHaveAccessibleName(
      'AI policy for #room: AI surfaces are disabled for this room.',
    );
  });

  it('labels local-only rooms as local AI only', () => {
    render(() => <AiPolicyBadge policy="local-only" channel="#room" />);

    expect(screen.getByText('Local only')).toHaveAccessibleName(
      'AI policy for #room: Only local AI surfaces are allowed for this room.',
    );
  });

  it('keeps badge copy centralized for the header', () => {
    expect(aiPolicyBadgeText('open')).toMatchObject({ label: 'AI open', scope: 'server' });
    expect(aiPolicyBadgeText('no-ai')).toMatchObject({ label: 'No AI', scope: 'external' });
    expect(aiPolicyBadgeText('local-only')).toMatchObject({ label: 'Local only', scope: 'server' });
  });
});
