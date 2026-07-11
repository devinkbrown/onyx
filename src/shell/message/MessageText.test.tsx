// SPDX-License-Identifier: AGPL-3.0-or-later
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

describe('MessageText emoji rendering (live parseMessage → emoji token → lookupEmoji path)', () => {
  it('renders a known :shortcode: as an inert role="img" emoji node labelled by its shortcode', () => {
    const { container } = render(() => <MessageText text="ship it :rocket: now :fire:" />);

    const rocket = screen.getByRole('img', { name: 'rocket' });
    expect(rocket).toHaveTextContent('🚀');
    const fire = screen.getByRole('img', { name: 'fire' });
    expect(fire).toHaveTextContent('🔥');

    // Surrounding text survives around the emoji tokens.
    expect(container.textContent).toContain('ship it');
    expect(container.textContent).toContain('now');
    // Safe-by-construction: an emoji token never becomes markup.
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders an unknown shortcode literally as :code: with no emoji node', () => {
    render(() => <MessageText text="mystery :definitely_not_a_real_code: end" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    // The unknown code falls back to its literal colon-wrapped form.
    expect(screen.getByText(/:definitely_not_a_real_code:/)).toBeInTheDocument();
  });

  // --- adversarial: a colon-wrapped HTML injection must stay inert through the sink ---
  it('keeps a colon-wrapped HTML injection payload inert (no emoji token, no element)', () => {
    const hostile = ':<img src=x onerror=alert(1)>:';
    const { container } = render(() => <MessageText text={hostile} />);

    // No emoji token was produced for the hostile "name", so no role="img" node.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    // NEVER an <img>: the payload reaches the DOM only as literal text.
    expect(container.querySelector('img')).toBeNull();
    // The raw payload characters are preserved verbatim as text.
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('does not autolink a script-tag bait payload into an anchor', () => {
    const hostile = 'x :</span><script>alert(1)</script>: y';
    const { container } = render(() => <MessageText text={hostile} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
});
