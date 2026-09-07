import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { BlockKitActionConfirmationContent } from './BlockKitActionConfirmation';

describe('BlockKitActionConfirmationContent', () => {
  it('makes the exact destination and user identity boundary explicit', () => {
    render(() => (
      <BlockKitActionConfirmationContent
        prepared={{ target: '#ops', text: 'approved' }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    ));

    expect(screen.getByText('Action review')).toBeInTheDocument();
    expect(screen.getByLabelText('Destination #ops')).toHaveTextContent('#ops');
    expect(screen.getByText('This message will be sent as you.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for your confirmation.');
  });

  it('keeps confirmation inert until the explicit send control is pressed', () => {
    const onConfirm = vi.fn();
    render(() => (
      <BlockKitActionConfirmationContent
        prepared={{ target: '#ops', text: 'approved' }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    ));

    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
