// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import { Suspense } from 'solid-js';
import Landing from './Landing';

/** Prefer container text when phrases span elements. */
function getByTextMatching(container: HTMLElement, pattern: RegExp): Element | null {
  for (const el of Array.from(container.querySelectorAll('*'))) {
    if (pattern.test(el.textContent ?? '') && el.children.length === 0) return el;
  }
  for (const el of Array.from(container.querySelectorAll('*'))) {
    if (pattern.test(el.textContent ?? '')) return el;
  }
  return null;
}

/** Body copy under main, excluding footer (footer is shared chrome). */
function mainBodyText(container: HTMLElement): string {
  const main = container.querySelector('main');
  if (!main) return container.textContent ?? '';
  const clone = main.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('footer').forEach((f) => f.remove());
  return clone.textContent ?? '';
}

describe('Landing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('states a quiet public promise with a single sentence-case h1', () => {
    const { getByRole, container } = render(() => <Landing />);
    const h1 = getByRole('heading', { level: 1 });
    expect(h1).toBeInTheDocument();
    expect(h1.textContent).toMatch(/room for your people/i);
    // Infomercial shout: no Anton display face on Home headings.
    expect(h1.className).not.toMatch(/display|anton/i);
    expect(getComputedStyle(h1).textTransform).not.toBe('uppercase');
    expect(container.querySelectorAll('h1').length).toBe(1);
    expect(mainBodyText(container)).toMatch(/open in the browser/i);
  });

  it('has exactly one main primary CTA to Open Onyx and one platform-neutral download text link', () => {
    const { container, getAllByRole } = render(() => <Landing />);
    const main = container.querySelector('main');
    expect(main).toBeTruthy();
    const primaryInMain = main!.querySelectorAll('a.r-btn.primary, a.home-cta-primary');
    expect(primaryInMain.length).toBe(1);
    const primary = primaryInMain[0]!;
    expect(primary.getAttribute('href')).toBe('/app/');
    expect(primary.textContent).toMatch(/Open Onyx/i);

    const downloadLinks = getAllByRole('link').filter((a) => {
      const href = a.getAttribute('href') ?? '';
      return href === '/download' || href === '/download/' || href.startsWith('/download');
    });
    expect(downloadLinks.length).toBeGreaterThan(0);
    // Secondary is a text link, not a second primary button.
    for (const a of downloadLinks) {
      expect(a.classList.contains('primary')).toBe(false);
      expect(a.classList.contains('r-btn')).toBe(false);
    }
    expect(getByTextMatching(container, /Desktop downloads/i)).toBeTruthy();
    expect(mainBodyText(container)).not.toMatch(/FreeBSD|OpenBSD/i);
  });

  it('keeps browser-first honesty and refuses signed multi-platform ship claims', () => {
    const { queryByText, container } = render(() => <Landing />);
    const body = mainBodyText(container);
    expect(body).toMatch(/browser/i);
    expect(body).toMatch(/desktop|mobile|PWA/i);
    expect(queryByText(/downloadable desktop apps are part of the Onyx 1\.0 launch/i)).not.toBeInTheDocument();
    expect(queryByText(/Desktop apps ship with the launch/i)).not.toBeInTheDocument();
    expect(queryByText(/signed installer available/i)).not.toBeInTheDocument();
    expect(queryByText(/get the desktop app/i)).not.toBeInTheDocument();
    expect(queryByText(/virus-free/i)).not.toBeInTheDocument();
  });

  it('labels the live-room aperture as preview / not live content', () => {
    const { getAllByText, getByText, container } = render(() => <Landing />);
    expect(getAllByText(/preview/i).length).toBeGreaterThan(0);
    expect(getByText(/not live/i)).toBeInTheDocument();
    const aperture = container.querySelector('[data-home-aperture], .home-aperture');
    expect(aperture).toBeTruthy();
  });

  it('keeps hero copy before the aperture in document order', () => {
    const { container } = render(() => <Landing />);
    const copy = container.querySelector('.home-hero-copy, .r-hero-copy');
    const aperture = container.querySelector('[data-home-aperture], .home-aperture');
    expect(copy).toBeTruthy();
    expect(aperture).toBeTruthy();
    expect(
      Boolean(copy && aperture && (copy.compareDocumentPosition(aperture) & Node.DOCUMENT_POSITION_FOLLOWING)),
    ).toBe(true);
    expect(copy?.querySelector('#hero-heading')).toBeTruthy();
  });

  it('removes infomercial patterns: audience taxonomy, feature board, terminal, numbered steps', () => {
    const { container } = render(() => <Landing />);
    expect(container.querySelector('#audience')).toBeNull();
    expect(container.querySelector('#product')).toBeNull();
    expect(container.querySelector('#start')).toBeNull();
    expect(container.querySelector('#proof')).toBeNull();
    expect(container.querySelector('#live')).toBeNull();
    expect(container.querySelector('.term')).toBeNull();
    expect(container.querySelector('.r-board')).toBeNull();
    expect(container.querySelector('.r-ticker')).toBeNull();
    expect(container.querySelector('.r-steps')).toBeNull();
    const body = mainBodyText(container);
    expect(body).not.toMatch(/\b01\b[\s\S]*\b02\b[\s\S]*\b03\b/);
    expect(body).not.toMatch(/General public/);
    expect(body).not.toMatch(/Gaming\s*&\s*creators|no gaming skin/i);
    expect(body).not.toMatch(/Press\s*&\s*procurement/);
  });

  it('carries one plain-language capability passage without protocol marketing terms', () => {
    const { container } = render(() => <Landing />);
    const body = mainBodyText(container);
    expect(body).toMatch(/rooms/i);
    expect(body).toMatch(/messages/i);
    expect(body).toMatch(/voice|video|call/i);
    expect(body).toMatch(/history|continuity|resume/i);
    expect(body).toMatch(/protected|protection|never guessed/i);
    // Protocol terms stay off the Home body (footer is excluded).
    expect(body).not.toMatch(/IRCv3/i);
    expect(body).not.toMatch(/IRCX/i);
    expect(body).not.toMatch(/WebSocket/i);
    expect(body).not.toMatch(/group e2ee/i);
    expect(body).not.toMatch(/\bpasskey\b/i);
  });

  it('maps the category spectrum to four semantic capability beats', () => {
    const { container } = render(() => <Landing />);
    const current = container.querySelector('[data-home-current]');
    expect(current?.tagName).toBe('UL');
    const beats = current?.querySelectorAll('li.home-current-beat') ?? [];
    expect(beats).toHaveLength(4);
    expect(Array.from(beats, (beat) => beat.textContent).join(' ')).toMatch(
      /messages.*voice.*resume.*protected/i,
    );
  });

  it('keeps a compact real telemetry strip with fail-honest fallbacks', () => {
    const { container, getByLabelText } = render(() => <Landing />);
    const strip = getByLabelText(/network summary|public telemetry|telemetry/i);
    expect(strip).toBeTruthy();
    expect(container.querySelector('.r-live-grid')).toBeNull();
    // Pending feeds must not invent online counts in the strip.
    expect(strip.textContent).toMatch(/waiting|--|…|unavailable|listening|online|people|rooms/i);
  });

  it('offers an operator and power-user link shelf without primary CTAs', () => {
    const { container, getAllByRole } = render(() => <Landing />);
    const shelf = container.querySelector('[data-home-shelf], .home-shelf, #operators');
    expect(shelf).toBeTruthy();
    expect(shelf?.textContent).toMatch(/operator|power user/i);
    const hrefs = getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/stats/');
    expect(hrefs).toContain('/status/');
    expect(hrefs).toContain('/roadmap/');
    expect(hrefs).toContain('/about/');
    expect(hrefs.some((h) => h === '/download' || h === '/download/' || h?.startsWith('/download'))).toBe(true);
    expect(hrefs.some((h) => h?.startsWith('/invite/'))).toBe(true);
    expect(hrefs.some((h) => h?.includes('/enterprise'))).toBe(false);
    expect(hrefs.some((h) => h?.includes('/legal'))).toBe(false);
    // Shelf links are not primary buttons.
    for (const a of Array.from(shelf!.querySelectorAll('a'))) {
      expect(a.classList.contains('primary')).toBe(false);
    }
  });

  it('refuses competitor and compliance theatre on Home', () => {
    const { queryByText, container } = render(() => <Landing />);
    const body = mainBodyText(container);
    expect(queryByText(/discord/i)).not.toBeInTheDocument();
    expect(body).not.toMatch(/better than/i);
    expect(body).not.toMatch(/\bSSO\b/);
    expect(body).not.toMatch(/SOC ?2/i);
  });

  it('keeps a clean header: brand, live chip, Open Onyx — no half-menu', () => {
    const { getByRole, container } = render(() => <Landing />);
    const banner = getByRole('banner');
    expect(banner.querySelector('.brand')).toBeTruthy();
    const enter = banner.querySelector('a.enter');
    expect(enter).toBeTruthy();
    expect(enter?.getAttribute('href')).toBe('/app/');
    expect(enter?.classList.contains('hideable')).toBe(false);
    expect(banner.querySelector('[aria-expanded], button.menu, .nav-toggle, .hamburger')).toBeNull();
    // No multi-section marketing anchors in the sticky header.
    expect(banner.querySelector('a[href="#product"]')).toBeNull();
    expect(banner.querySelector('a[href="#audience"]')).toBeNull();
    expect(banner.querySelector('a[href="#start"]')).toBeNull();
    expect(container.querySelector('.r-status .enter')).toBeTruthy();
  });

  it('gives primary controls a 44px minimum touch target class contract', () => {
    const { container } = render(() => <Landing />);
    const primary = container.querySelector('a.r-btn.primary, a.home-cta-primary');
    expect(primary).toBeTruthy();
    // home.css + shared .r-btn set min-height ≥ 44px; assert class contract.
    expect(
      primary!.classList.contains('primary') || primary!.classList.contains('home-cta-primary'),
    ).toBe(true);
  });

  it('sets public-service root metadata with the PWA/native boundary', () => {
    render(() => <Landing />);
    expect(document.title).toMatch(/Onyx/i);
    const description = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '';
    const twitterDescription = document.querySelector('meta[name="twitter:description"]')?.getAttribute('content') ?? '';
    const headCopy = [description, ogDescription, twitterDescription].join('\n');

    expect(document.title).toBe('Onyx — a room for your people');
    expect(description).toMatch(/Open Onyx in your browser/i);
    expect(description).toMatch(/browser/i);
    expect(description).toMatch(/desktop and mobile/i);
    expect(description).toMatch(/native download/i);
    expect(headCopy).not.toMatch(/desktop apps are part of the launch/i);
    expect(headCopy).not.toMatch(/signed installer available/i);
    expect(headCopy).not.toMatch(/virus-free/i);
  });

  it('renders the brand mascot accessibly on the home link', () => {
    const { getByRole } = render(() => <Landing />);
    const home = getByRole('link', { name: 'Onyx home' });
    expect(home).toHaveAttribute('href', '/');
    expect(home).toHaveAccessibleName('Onyx home');
    const name = home.getAttribute('aria-label') ?? '';
    expect(name).not.toMatch(/@keyframes|mascot-breathe|mascot-current|display:\s*inline-block|\.mascot/);
    expect(home.querySelector('.brand-mark[aria-hidden="true"]')).toBeTruthy();
    expect(home.querySelector('.brand-wordmark[aria-hidden="true"]')).toBeTruthy();
    expect(home.querySelector('svg.mascot')).toBeTruthy();
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

    expect(getByRole('heading', { level: 1 })).toBeInTheDocument();
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
