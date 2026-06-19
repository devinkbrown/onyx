import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Spinner } from './Spinner';

afterEach(cleanup);

describe('Spinner', () => {
  it('renders a labeled status spinner for loading states', () => {
    render(() => <Spinner label="Loading channels" />);

    const status = screen.getByRole('status', { name: 'Loading channels' });

    expect(status.classList.contains('ruri-spinner--md')).toBe(true);
    expect(status.textContent).toBe('Loading channels');
  });

  it('renders as decorative when no label is provided', () => {
    const { container } = render(() => <Spinner size="sm" />);
    const spinner = container.querySelector('.ruri-spinner');

    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
    expect(spinner?.classList.contains('ruri-spinner--sm')).toBe(true);
  });
});
