import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { MessageText } from './MessageText';

describe('MessageText Block-Kit-lite', () => {
  it('renders structured webhook controls and hides the protocol payload line', () => {
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
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });
});
