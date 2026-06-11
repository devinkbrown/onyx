import { act, fireEvent, render, screen } from '@testing-library/react';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import OfflineMessagesBanner from '@/components/ui/OfflineMessagesBanner';

describe('state primitives', () => {
  it('renders the history exhausted sea-floor variant', () => {
    render(<EmptyState variant="historyExhausted" />);

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('You have reached the sea floor')).toBeInTheDocument();
  });

  it('copies error details', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <ErrorState
        title="Forum posts are unavailable"
        message="Could not refresh posts."
        details="forum failure details"
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    });

    expect(writeText).toHaveBeenCalledWith('forum failure details');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('listens for ocean:tegami, jumps to first message, and dismisses per channel', () => {
    const onJump = vi.fn();
    const jumpListener = vi.fn();
    window.addEventListener('ocean:jump-to-message', jumpListener);

    render(<OfflineMessagesBanner channel="#ocean" onJump={onJump} />);

    act(() => {
      window.dispatchEvent(new CustomEvent('ocean:tegami', {
        detail: { channel: '#ocean', count: 3, firstMsgId: 'msg-1' },
      }));
    });

    const jumpButton = screen.getByRole('button', {
      name: /3 messages arrived while you were away/i,
    });
    fireEvent.click(jumpButton);

    expect(onJump).toHaveBeenCalledWith({ channel: '#ocean', count: 3, firstMsgId: 'msg-1' });
    expect(jumpListener).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss offline messages for #ocean' }));
    expect(screen.queryByTestId('offline-messages-banner')).not.toBeInTheDocument();

    window.removeEventListener('ocean:jump-to-message', jumpListener);
  });
});
