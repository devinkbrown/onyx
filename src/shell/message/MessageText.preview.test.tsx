// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MessageText.preview.test.tsx — the link-preview card is a render sink for a
 * URL the browser did not choose: the same-origin /linkpreview endpoint extracts
 * it from the (untrusted) target page's OpenGraph metadata. These tests pin the
 * defense-in-depth guard in MessageText: a preview whose canonical URL is not
 * http(s) is dropped (fail closed) so a javascript:/data: scheme can never reach
 * the card's <a href> or <img src>.
 */

import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkPreview } from '@/lib/preview/linkPreview';

const fetchLinkPreview = vi.fn<(url: string) => Promise<LinkPreview | null>>();

// Deterministic preview plumbing: always offer the first href to the card and
// return whatever the test stages, bypassing the real network/SSRF fetcher.
vi.mock('@/lib/preview/linkPreview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/preview/linkPreview')>();
  return {
    ...actual,
    pickPreviewUrl: (hrefs: string[]): string | null => hrefs[0] ?? null,
    fetchLinkPreview: (url: string) => fetchLinkPreview(url),
  };
});

import { MessageText } from './MessageText';

function preview(overrides: Partial<LinkPreview>): LinkPreview {
  return {
    url: 'https://example.test/article',
    title: 'A title',
    description: 'A description',
    image: '',
    site: 'example.test',
    ...overrides,
  };
}

describe('MessageText link-preview scheme guard', () => {
  beforeEach(() => fetchLinkPreview.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('keeps message content mounted while an optional preview is pending', async () => {
    let resolvePreview!: (value: LinkPreview | null) => void;
    const pendingPreview = new Promise<LinkPreview | null>((resolve) => {
      resolvePreview = resolve;
    });
    fetchLinkPreview.mockReturnValue(pendingPreview);

    render(() => (
      <Suspense fallback={<p data-testid="message-suspended">Loading conversation</p>}>
        <p>Stable transcript</p>
        <MessageText text="look at https://ok.example/page please" />
      </Suspense>
    ));

    expect(screen.queryByTestId('message-suspended')).not.toBeInTheDocument();
    expect(screen.getByText('Stable transcript')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://ok.example/page' })).toBeInTheDocument();

    resolvePreview(null);
    await pendingPreview;
  });

  it('drops a preview whose canonical URL is a javascript: scheme (no card)', async () => {
    fetchLinkPreview.mockResolvedValue(preview({ url: 'javascript:alert(1)', title: 'evil' }));

    const { container } = render(() => (
      <MessageText text="look at https://ok.example/page please" />
    ));

    await waitFor(() => expect(fetchLinkPreview).toHaveBeenCalled());
    // The inline link for the real https URL is fine; the poisoned CARD is not.
    expect(container.querySelector('.shell-msg-preview')).toBeNull();
    // No anchor anywhere carries the dangerous scheme.
    for (const a of Array.from(container.querySelectorAll('a'))) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
    }
  });

  it('renders a card for an http(s) preview but suppresses a dangerous image src', async () => {
    fetchLinkPreview.mockResolvedValue(
      preview({ url: 'https://ok.example/page', title: 'Safe', image: 'javascript:alert(1)' }),
    );

    const { container } = render(() => (
      <MessageText text="look at https://ok.example/page please" />
    ));

    await waitFor(() => expect(screen.getByText('Safe')).toBeInTheDocument());
    const card = container.querySelector('a.shell-msg-preview-link');
    expect(card).not.toBeNull();
    // The card renders, but the javascript: image never reaches an <img src>.
    expect(card?.querySelector('img.shell-msg-preview-thumb')).toBeNull();
  });

  it('drops a credential-bearing canonical URL instead of seating it in a card', async () => {
    fetchLinkPreview.mockResolvedValue(
      preview({ url: 'https://alice:secret@ok.example/page', title: 'Credential bait' }),
    );

    const { container } = render(() => (
      <MessageText text="look at https://ok.example/page please" />
    ));

    await waitFor(() => expect(fetchLinkPreview).toHaveBeenCalled());
    expect(container.querySelector('.shell-msg-preview')).toBeNull();
    expect(container.querySelector('[href*="alice:secret"]')).toBeNull();
  });

  it('suppresses a credential-bearing preview thumbnail subresource', async () => {
    fetchLinkPreview.mockResolvedValue(
      preview({
        url: 'https://ok.example/page',
        title: 'Safe card',
        image: 'https://alice:secret@cdn.example/i.png',
      }),
    );

    const { container } = render(() => (
      <MessageText text="look at https://ok.example/page please" />
    ));

    await waitFor(() => expect(screen.getByText('Safe card')).toBeInTheDocument());
    expect(container.querySelector('a.shell-msg-preview-link')).not.toBeNull();
    expect(container.querySelector('img.shell-msg-preview-thumb')).toBeNull();
  });

  it('drops an internal canonical URL instead of seating it in a card', async () => {
    fetchLinkPreview.mockResolvedValue(
      preview({ url: 'http://127.0.0.1/admin', title: 'Local service' }),
    );

    const { container } = render(() => (
      <MessageText text="look at https://ok.example/page please" />
    ));

    await waitFor(() => expect(fetchLinkPreview).toHaveBeenCalled());
    expect(container.querySelector('.shell-msg-preview')).toBeNull();
    expect(container.querySelector('[href*="127.0.0.1"]')).toBeNull();
  });

  it('suppresses an internal preview thumbnail subresource', async () => {
    fetchLinkPreview.mockResolvedValue(
      preview({
        url: 'https://ok.example/page',
        title: 'Safe card',
        image: 'http://192.168.1.1/internal.png',
      }),
    );

    const { container } = render(() => (
      <MessageText text="look at https://ok.example/page please" />
    ));

    await waitFor(() => expect(screen.getByText('Safe card')).toBeInTheDocument());
    expect(container.querySelector('a.shell-msg-preview-link')).not.toBeNull();
    expect(container.querySelector('img.shell-msg-preview-thumb')).toBeNull();
  });

  it('waits for consent before creating an external preview thumbnail resource', async () => {
    fetchLinkPreview.mockResolvedValue(
      preview({ url: 'https://ok.example/page', title: 'Good', image: 'https://cdn.example/i.png' }),
    );

    const { container } = render(() => (
      <MessageText text="look at https://ok.example/page please" />
    ));

    await waitFor(() => expect(screen.getByText('Good')).toBeInTheDocument());
    expect(container.querySelector('img.shell-msg-preview-thumb')).toBeNull();
    fireEvent.click(screen.getByRole('button', {
      name: 'Load external preview image from cdn.example',
    }));

    const thumb = container.querySelector('img.shell-msg-preview-thumb');
    expect(thumb).not.toBeNull();
    expect(thumb?.getAttribute('src')).toBe('https://cdn.example/i.png');
    expect(thumb).toHaveAttribute('width', '72');
    expect(thumb).toHaveAttribute('height', '72');
    expect(thumb).toHaveAttribute('loading', 'lazy');
    expect(thumb).toHaveAttribute('decoding', 'async');
    expect(thumb).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(thumb).not.toHaveAttribute('crossorigin');

    fireEvent.error(thumb!);

    expect(container.querySelector('img.shell-msg-preview-thumb')).toBeNull();
    expect(container.querySelector('a.shell-msg-preview-link')).not.toBeNull();
    expect(screen.getByText('Good')).toBeInTheDocument();
  });

  it('preserves automatic same-origin preview thumbnails', async () => {
    const image = new URL('/uploads/preview.png', window.location.href).toString();
    fetchLinkPreview.mockResolvedValue(
      preview({ url: 'https://ok.example/page', title: 'Local image', image }),
    );

    const { container } = render(() => (
      <MessageText text="look at https://ok.example/page please" />
    ));

    await waitFor(() => expect(screen.getByText('Local image')).toBeInTheDocument());
    expect(container.querySelector('img.shell-msg-preview-thumb')).toHaveAttribute('src', image);
    expect(container.querySelector('.shell-msg-preview-consent')).toBeNull();
  });
});
