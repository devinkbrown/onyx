// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { CALL_JOIN_FAILED_COPY } from '@/lib/media/callJoinCopy';
import { CallJoinBanner } from './CallJoinBanner';

describe('CallJoinBanner', () => {
  it('shows consumer copy and retries without protocol text', () => {
    const onRetry = vi.fn();
    render(() => <CallJoinBanner onRetry={onRetry} />);
    expect(screen.getByTestId('call-join-banner')).toHaveTextContent(CALL_JOIN_FAILED_COPY);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('call-join-retry'));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
