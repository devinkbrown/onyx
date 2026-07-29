// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';
import Landing from './Landing';

describe('Landing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('states the public service promise in plain language', () => {
    const { getByRole, getByText, getAllByText } = render(() => <Landing />);
    expect(getByRole('heading', { level: 1, name: /your rooms/i })).toBeInTheDocument();
    expect(getByText(/public place to talk, gather, and stream together/i)).toBeInTheDocument();
    expect(getByText(/communities, gaming crews, creators, organizations/i)).toBeInTheDocument();
    expect(getAllByText(/powered by Onyx Server/i).length).toBeGreaterThan(0);
  });

  it('makes Open Onyx the primary entry into the product', () => {
    const { getAllByRole, getAllByText } = render(() => <Landing />);
    expect(getAllByText(/Open Onyx/i).length).toBeGreaterThan(0);
    const enter = getAllByRole('link').filter((a) => a.getAttribute('href') === '/app/');
    expect(enter.length).toBeGreaterThan(0);
  });

  it('teaches browser-first entry, conservative PWA install, and honest BSD operator downloads', () => {
    const { getAllByText, queryByText, container, getAllByRole } = render(() => <Landing />);
    expect(getAllByText(/Browser now/i).length).toBeGreaterThan(0);
    expect(getByTextMatching(container, /no install required/i)).toBeTruthy();
    expect(getByTextMatching(container, /install Onyx as a\s*PWA/i)).toBeTruthy();
    expect(getByTextMatching(container, /supporting browser/i)).toBeTruthy();
    expect(getByTextMatching(container, /unsigned v0\.1\.3 native host tarballs/i)).toBeTruthy();
    expect(getByTextMatching(container, /install\.sh/i)).toBeTruthy();
    expect(getByTextMatching(container, /not signed/i)).toBeTruthy();
    expect(getByTextMatching(container, /Signed Windows\/macOS\/Linux installers/i)).toBeTruthy();
    const downloadLinks = getAllByRole('link').filter((a) => {
      const href = a.getAttribute('href') ?? '';
      return href === '/download' || href === '/download/' || href.startsWith('/download');
    });
    expect(downloadLinks.length).toBeGreaterThan(0);
    // Premature ship claims must stay off Home.
    expect(queryByText(/downloadable desktop apps are part of the Onyx 1\.0 launch/i)).not.toBeInTheDocument();
    expect(queryByText(/Desktop apps ship with the launch/i)).not.toBeInTheDocument();
    expect(queryByText(/Desktop with the launch/i)).not.toBeInTheDocument();
    expect(queryByText(/desktop apps are part of the launch/i)).not.toBeInTheDocument();
    expect(queryByText(/desktop apps with the launch/i)).not.toBeInTheDocument();
    expect(queryByText(/signed installer available/i)).not.toBeInTheDocument();
  });

  it('presents Rooms, Messages, Calls, and Continuity as product pillars', () => {
    const { getByRole, getAllByText } = render(() => <Landing />);
    expect(getByRole('heading', { level: 2, name: /Rooms\.\s*Messages\.\s*Calls\.\s*Continuity/i })).toBeInTheDocument();
    expect(getByRole('heading', { level: 3, name: /Text rooms that stay open/i })).toBeInTheDocument();
    expect(getByRole('heading', { level: 3, name: /Direct messages/i })).toBeInTheDocument();
    expect(getByRole('heading', { level: 3, name: /Voice, video, and screen/i })).toBeInTheDocument();
    expect(getByRole('heading', { level: 3, name: /Continuity on your device/i })).toBeInTheDocument();
    expect(getAllByText(/session resume/i).length).toBeGreaterThan(0);
    expect(getAllByText(/local history/i).length).toBeGreaterThan(0);
    expect(getAllByText(/on-device import/i).length).toBeGreaterThan(0);
  });

  it('keeps identity and visible protection as supporting proof', () => {
    const { getByText } = render(() => <Landing />);
    expect(getByText(/A name that travels/i)).toBeInTheDocument();
    expect(getByText(/Visible protection state/i)).toBeInTheDocument();
    expect(getByText(/shown, not assumed/i)).toBeInTheDocument();
    expect(getByText(/never overstated/i)).toBeInTheDocument();
  });

  it('surfaces Gaming and Organizations audience paths without sector skins', () => {
    const { getByText, getByRole, container } = render(() => <Landing />);
    expect(getByRole('heading', { level: 2, name: /One product\.\s*Many proof paths/i })).toBeInTheDocument();
    const audience = container.querySelector('#audience');
    expect(audience).toBeTruthy();
    const names = Array.from(audience?.querySelectorAll('.r-stat .n') ?? []).map((el) => el.textContent ?? '');
    expect(names).toEqual(expect.arrayContaining([
      'General public',
      'Gaming & creators',
      'Communities',
      'Organizations',
      'Developers',
      'Press & procurement',
      'Power users',
    ]));
    expect(getByText(/Persistent rooms, live calls, voice and video/i)).toBeInTheDocument();
    expect(getByText(/working groups/i)).toBeInTheDocument();
    expect(getByText(/no gaming skin, no enterprise skin/i)).toBeInTheDocument();
  });

  it('keeps truth language for telemetry and refuses premature enterprise/native/comparison claims', () => {
    const { getByText, queryByText } = render(() => <Landing />);
    expect(getByText(/Public telemetry,\s*not a marketing number/i)).toBeInTheDocument();
    expect(getByText(/no invented online counts/i)).toBeInTheDocument();
    expect(queryByText(/group e2ee/i)).not.toBeInTheDocument();
    expect(queryByText(/passkey/i)).not.toBeInTheDocument();
    expect(queryByText(/discord/i)).not.toBeInTheDocument();
    expect(queryByText(/better than/i)).not.toBeInTheDocument();
    expect(queryByText(/SSO/i)).not.toBeInTheDocument();
    expect(queryByText(/SOC ?2/i)).not.toBeInTheDocument();
    expect(queryByText(/download now/i)).not.toBeInTheDocument();
    expect(queryByText(/get the desktop app/i)).not.toBeInTheDocument();
    expect(queryByText(/signed installer available/i)).not.toBeInTheDocument();
    expect(queryByText(/virus-free/i)).not.toBeInTheDocument();
  });

  it('labels the product tableau as a preview, not live content', () => {
    const { getByText } = render(() => <Landing />);
    expect(getByText(/Product preview/i)).toBeInTheDocument();
    expect(getByText(/Not live content/i)).toBeInTheDocument();
  });

  it('keeps hero value proposition before the product tableau in document order', () => {
    const { container } = render(() => <Landing />);
    const copy = container.querySelector('.r-hero-copy');
    const tableau = container.querySelector('.r-tableau');
    expect(copy).toBeTruthy();
    expect(tableau).toBeTruthy();
    // Source order drives mobile stack (CSS must not reverse with order: -1).
    expect(
      Boolean(copy && tableau && (copy.compareDocumentPosition(tableau) & Node.DOCUMENT_POSITION_FOLLOWING)),
    ).toBe(true);
    expect(copy?.querySelector('#hero-heading')).toBeTruthy();
    expect(copy?.querySelector('.r-cta')).toBeTruthy();
  });

  it('orders product pillars before live telemetry in document order', () => {
    const { container } = render(() => <Landing />);
    const product = container.querySelector('#product');
    const live = container.querySelector('#live');
    const audience = container.querySelector('#audience');
    const proof = container.querySelector('#proof');
    expect(product && live).toBeTruthy();
    expect(
      Boolean(product && live && (product.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING)),
    ).toBe(true);
    expect(
      Boolean(live && audience && (live.compareDocumentPosition(audience) & Node.DOCUMENT_POSITION_FOLLOWING)),
    ).toBe(true);
    expect(
      Boolean(audience && proof && (audience.compareDocumentPosition(proof) & Node.DOCUMENT_POSITION_FOLLOWING)),
    ).toBe(true);
  });

  it('keeps a clean mobile header contract: brand + primary Open Onyx, secondary nav hideable', () => {
    const { container, getByRole } = render(() => <Landing />);
    const banner = getByRole('banner');
    expect(banner.querySelector('.brand')).toBeTruthy();
    const enter = banner.querySelector('a.enter');
    expect(enter).toBeTruthy();
    expect(enter?.getAttribute('href')).toBe('/app/');
    expect(enter?.classList.contains('hideable')).toBe(false);
    // Secondary chrome is marked hideable for narrow CSS; primary action is not.
    const hideable = banner.querySelectorAll('.hideable');
    expect(hideable.length).toBeGreaterThan(0);
    for (const el of Array.from(hideable)) {
      expect(el.classList.contains('enter')).toBe(false);
    }
    // No half-implemented menu control in the header.
    expect(banner.querySelector('[aria-expanded], button.menu, .nav-toggle, .hamburger')).toBeNull();
    expect(container.querySelector('.r-status .enter')).toBeTruthy();
  });

  it('keeps public routes for app, status, stats, about, roadmap, invite, and download', () => {
    const { getAllByRole } = render(() => <Landing />);
    const hrefs = getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/app/');
    expect(hrefs).toContain('/stats/');
    expect(hrefs).toContain('/status/');
    expect(hrefs).toContain('/roadmap/');
    expect(hrefs).toContain('/about/');
    expect(hrefs.some((h) => h?.startsWith('/invite/'))).toBe(true);
    expect(hrefs.some((h) => h === '/download' || h === '/download/' || h?.startsWith('/download'))).toBe(true);
    // Still-gated surfaces must not appear as real routes yet.
    expect(hrefs.some((h) => h?.includes('/enterprise'))).toBe(false);
    expect(hrefs.some((h) => h?.includes('/legal'))).toBe(false);
  });

  it('surfaces live public telemetry on the root website', () => {
    const { getByText } = render(() => <Landing />);
    expect(getByText(/Public telemetry,\s*not a marketing number/i)).toBeInTheDocument();
    expect(getByText(/Real public feeds power this page/i)).toBeInTheDocument();
  });

  it('sets public-service root metadata with the PWA/native boundary', () => {
    render(() => <Landing />);
    expect(document.title).toBe('Onyx — talk, stream, and stay with your people');
    const description = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '';
    const twitterDescription = document.querySelector('meta[name="twitter:description"]')?.getAttribute('content') ?? '';
    const headCopy = [description, ogDescription, twitterDescription].join('\n');

    expect(description).toMatch(/public communication service/i);
    expect(description).toMatch(/Open in the browser now/i);
    expect(description).toMatch(/install as a PWA from a supporting browser/i);
    expect(description).toMatch(/FreeBSD and OpenBSD operators/i);
    expect(description).toMatch(/\/download\//i);
    expect(description).toMatch(/Signed multi-platform installers remain pending/i);
    expect(ogDescription).toMatch(/public communication service|Open in the browser now/i);
    expect(twitterDescription).toMatch(/public communication service|Open in the browser now/i);

    // Client-side head must not reintroduce premature multi-platform ship promises.
    expect(headCopy).not.toMatch(/desktop apps are part of the launch/i);
    expect(headCopy).not.toMatch(/desktop apps with the launch/i);
    expect(headCopy).not.toMatch(/Desktop apps ship with the launch/i);
    expect(headCopy).not.toMatch(/Desktop with the launch/i);
    expect(headCopy).not.toMatch(/signed installer available/i);
    expect(headCopy).not.toMatch(/get the desktop app/i);
    expect(headCopy).not.toMatch(/virus-free/i);
  });

  it('renders the brand mascot accessibly', () => {
    const { getAllByRole } = render(() => <Landing />);
    const dragons = getAllByRole('img').filter((el) =>
      (el.getAttribute('aria-label') ?? '').toLowerCase().includes('water-dragon'),
    );
    expect(dragons.length).toBeGreaterThan(0);
  });

  it('gives the logo home link a concise accessible name without mascot CSS pollution', () => {
    const { getByRole } = render(() => <Landing />);
    const home = getByRole('link', { name: 'Onyx home' });
    expect(home).toHaveAttribute('href', '/');
    expect(home).toHaveAttribute('aria-label', 'Onyx home');
    expect(home).toHaveAccessibleName('Onyx home');

    // Explicit name must stay concise — not the embedded mascot stylesheet + ONYX blob.
    const name = home.getAttribute('aria-label') ?? '';
    expect(name).toBe('Onyx home');
    expect(name).not.toMatch(/@keyframes|mascot-breathe|mascot-current|display:\s*inline-block|\.mascot/);
    expect(name).not.toMatch(/ONYX.*mascot|mascot.*ONYX/i);

    // Visible branding remains for sighted users; mark is decorative under the named link.
    expect(home.textContent).toMatch(/ONYX/);
    expect(home.querySelector('.brand-mark[aria-hidden="true"]')).toBeTruthy();
    expect(home.querySelector('.brand-wordmark[aria-hidden="true"]')).toBeTruthy();
  });

  it('carries no devil / gate lore', () => {
    const { queryByText } = render(() => <Landing />);
    expect(queryByText(/devil/i)).not.toBeInTheDocument();
    expect(queryByText(/the gate/i)).not.toBeInTheDocument();
    expect(queryByText(/wrath/i)).not.toBeInTheDocument();
  });

  it('keeps the landing shell visible while public feeds are pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    const { getByRole, getByText, queryByTestId, queryByText } = render(() => (
      <Suspense fallback={<p data-testid="landing-suspended">Loading landing</p>}>
        <Landing />
      </Suspense>
    ));

    expect(getByRole('heading', { level: 1, name: /your rooms/i })).toBeInTheDocument();
    expect(getByText('status unavailable')).toHaveAttribute('data-feed-state', 'unavailable');
    expect(queryByText('network online')).not.toBeInTheDocument();
    expect(queryByText('mesh online')).not.toBeInTheDocument();
    expect(queryByTestId('landing-suspended')).not.toBeInTheDocument();
  });

  it('does not call a future-skewed public status sample online', async () => {
    const futureStatus = {
      generated_at: Math.floor((Date.now() + 10 * 60_000) / 1000),
      network: 'Onyx',
      node: 'eshmaki.me',
      uptime_seconds: 60,
      users_online: 2,
      mesh: { quorum: true, partitioned: false, components: 1 },
      peers: [],
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(
      JSON.stringify(String(input).includes('status.json') ? futureStatus : {}),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    const { findByText, queryByText } = render(() => <Landing />);

    expect(await findByText('status time mismatch')).toHaveAttribute('data-feed-state', 'future');
    expect(queryByText('network online')).not.toBeInTheDocument();
    expect(queryByText('mesh online')).not.toBeInTheDocument();
  });
});

/** Prefer container text when phrases span elements. */
function getByTextMatching(container: HTMLElement, pattern: RegExp): Element | null {
  const walk = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
  let node = walk.currentNode as HTMLElement | null;
  while (node) {
    const text = node.textContent ?? '';
    if (pattern.test(text) && node.children.length === 0) return node;
    // Prefer smallest matching element
    node = walk.nextNode() as HTMLElement | null;
  }
  // Fallback: any element whose full text matches
  for (const el of Array.from(container.querySelectorAll('*'))) {
    if (pattern.test(el.textContent ?? '')) return el;
  }
  return null;
}
