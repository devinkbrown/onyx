// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import type { SinceDigest } from '@/lib/notifications/sinceDigest';
import { SinceDigestCard } from './SinceDigestCard';

describe('SinceDigestCard', () => {
  afterEach(() => cleanup());

  it('labels locally derived catch-up digest provenance', () => {
    const digest: SinceDigest = {
      since: new Date('2026-07-09T08:00:00.000Z'),
      totalMessages: 2,
      totalMentions: 1,
      activeChannels: 1,
      channels: [
        {
          channel: '#root',
          count: 2,
          mentions: 1,
          participants: ['kain'],
          recallTerms: ['launch', 'storage'],
          firstAt: new Date('2026-07-09T08:01:00.000Z'),
          lastAt: new Date('2026-07-09T08:02:00.000Z'),
        },
      ],
    };

    render(() => <SinceDigestCard digest={digest} />);

    expect(screen.getByLabelText(/Since-you-left digest provenance: This device/i)).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByLabelText('Local recall terms for #root: launch, storage')).toBeInTheDocument();
    expect(screen.getByText('launch')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open public channel ledger' })).toHaveAttribute('href', '/stats/');
    expect(screen.getByRole('link', { name: 'Channel ledger for #root' })).toHaveAttribute(
      'href',
      '/stats/?room=%23root',
    );
  });
});
