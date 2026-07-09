import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { MessageText } from './MessageText';

describe('MessageText Block-Kit-lite', () => {
  it('renders structured webhook controls and hides the protocol payload line', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(() => (
      <MessageText
        text={[
          'Deployment ready',
          '[onyx:block] {"title":"Release gate","text":"Review before publish","fields":[{"label":"Service","value":"Onyx"}],"selects":[{"label":"Environment","options":[{"label":"Production","value":"prod"},{"label":"Staging","value":"staging"}]}],"buttons":[{"label":"Open build","url":"https://example.test/build"},{"label":"Approve","value":"approve"}]}',
        ].join('\n')}
      />
    ));

    expect(screen.getByText('Deployment ready')).toBeInTheDocument();
    expect(screen.queryByText(/\[onyx:block\]/)).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Release gate' })).toBeInTheDocument();
    expect(screen.getByText('Review before publish')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Onyx')).toBeInTheDocument();
    expect(screen.getByLabelText('Environment')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open build' })).toHaveAttribute('href', 'https://example.test/build');
    expect(screen.getByText('Safe controls only: links open, values copy, commands do not run.')).toBeInTheDocument();

    const approve = screen.getByRole('button', { name: 'Copy value for Approve' });
    expect(approve).not.toBeDisabled();

    fireEvent.click(approve);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('approve'));
    expect(screen.getByRole('button', { name: 'Copy value for Approve' })).toHaveTextContent('Copied');
  });
});
