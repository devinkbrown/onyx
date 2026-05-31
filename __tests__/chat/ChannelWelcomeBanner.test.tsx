import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChannelWelcomeBanner from '@/components/chat/ChannelWelcomeBanner';

describe('ChannelWelcomeBanner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not restart its dismiss timer when the parent rerenders', () => {
    vi.useFakeTimers();

    const firstDismiss = vi.fn();
    const secondDismiss = vi.fn();
    const { rerender } = render(
      <ChannelWelcomeBanner
        channel="#root"
        topic="Initial topic"
        memberCount={3}
        onDismiss={firstDismiss}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(4_000);
    });

    rerender(
      <ChannelWelcomeBanner
        channel="#root"
        topic="Updated topic"
        memberCount={4}
        onDismiss={secondDismiss}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(4_100);
    });

    expect(firstDismiss).not.toHaveBeenCalled();
    expect(secondDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
