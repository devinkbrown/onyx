// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * MessageText.preview.test.tsx — the link-preview card is a render sink for a
 * URL the browser did not choose: the same-origin /linkpreview endpoint extracts
 * it from the (untrusted) target page's OpenGraph metadata. These tests pin the
 * defense-in-depth guard in MessageText: a preview whose canonical URL is not
 * http(s) is dropped (fail closed) so a javascript:/data: scheme can never reach
 * the card's <a href> or <img src>.
 */

import { render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkPreview } from '@/lib/preview/linkPreview';

const fetchLinkPreview = vi.fn<(url: string) => Promise<LinkPreview | null>>();

// Deterministic preview plumbing: always offer the first href to the card and
// return whatever the test stages, bypassing the real network/SSRF fetcher.
vi.mock('@/lib/preview/linkPreview', () => ({
  pickPreviewUrl: (hrefs: string[]): string | null => hrefs[0] ?? null,
  fetchLinkPreview: (url: string) => fetchLinkPreview(url),
}));

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

  it('drops a preview whose canonical URL is a javascript: scheme (no card)', async () => {
    fetchLinkPreview.mockResolvedValue(preview({ url: 'javascript:alert(1)', title: 'evil' }));

    const { container } = render(() => (
      <MessageText text="look at https://ok.example/page please" />
    ));

    await waitFor(() => expect(fetchLinkPreview).toHaveBeenCalled());
    // The inline link for the real https URL is fine; the poisoned CARD is not.
    expect(container.querySelector('a.shell-msg-preview')).toBeNull();
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
    const card = container.querySelector('a.shell-msg-preview');
    expect(card).not.toBeNull();
    // The card renders, but the javascript: image never reaches an <img src>.
    expect(card?.querySelector('img.shell-msg-preview-thumb')).toBeNull();
  });

  it('renders a fully benign http(s) preview card unchanged', async () => {
    fetchLinkPreview.mockResolvedValue(
      preview({ url: 'https://ok.example/page', title: 'Good', image: 'https://cdn.example/i.png' }),
    );

    const { container } = render(() => (
      <MessageText text="look at https://ok.example/page please" />
    ));

    await waitFor(() => expect(screen.getByText('Good')).toBeInTheDocument());
    const thumb = container.querySelector('img.shell-msg-preview-thumb');
    expect(thumb).not.toBeNull();
    expect(thumb?.getAttribute('src')).toBe('https://cdn.example/i.png');
  });
});
