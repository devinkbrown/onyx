import { describe, it, expect } from 'vitest';
import { render } from '@solidjs/testing-library';
import Landing from './Landing';

describe('Landing', () => {
  it('renders the brutalist hero headline', () => {
    const { getByText } = render(() => <Landing />);
    expect(getByText(/living mesh/i)).toBeInTheDocument();
  });

  it('renders the mythos: Orochi, eshmaki and Ruri', () => {
    const { getByText } = render(() => <Landing />);
    expect(getByText(/Orochi · the serpent/i)).toBeInTheDocument();
    expect(getByText(/eshmaki · the gate/i)).toBeInTheDocument();
    expect(getByText(/Ruri · the jewel/i)).toBeInTheDocument();
  });

  it('leads on capability differentiators', () => {
    const { getByText } = render(() => <Landing />);
    expect(getByText(/Difference you can feel/i)).toBeInTheDocument();
    expect(getByText(/The server never sees you/i)).toBeInTheDocument();
    expect(getByText(/You choose the transport/i)).toBeInTheDocument();
  });

  it('surfaces both mesh nodes (eshmaki.me + ircx.us)', () => {
    const { getByText } = render(() => <Landing />);
    expect(getByText(/eshmaki\.me : 8080/i)).toBeInTheDocument();
    expect(getByText(/ircx\.us : 8080/i)).toBeInTheDocument();
  });

  it('exposes a primary entry point into the app', () => {
    const { getAllByRole } = render(() => <Landing />);
    const enter = getAllByRole('link').filter((a) => a.getAttribute('href') === '/app');
    expect(enter.length).toBeGreaterThan(0);
  });
});
