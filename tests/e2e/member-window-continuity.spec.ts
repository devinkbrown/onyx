import { expect, test, type Page } from '@playwright/test';

type RuntimeStore = {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
};

const CHANNEL = '#qa-member-continuity';
const ROSTER = '.shell-members-scroll';
const MEMBER = '[data-member-focus-key]';

/** Production AppShell/runtime fixture, not hand-written markup, dev hooks or
 * network evidence. Mixed roles and deliberately unequal nick lengths prevent
 * a fixed-height implementation from passing by rendering uniform rows. */
async function seedRoster(page: Page): Promise<void> {
  await page.goto('/app/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => (
    /\/assets\/runtime-[^/]+\.js$/.test(new URL(entry.name).pathname)
  )));
  await page.evaluate(async (channel) => {
    const entry = performance.getEntriesByType('resource').find((candidate) => (
      /\/assets\/runtime-[^/]+\.js$/.test(new URL(candidate.name).pathname)
    ));
    if (!entry) throw new Error('Production runtime bundle was not loaded');
    const runtime = await import(entry.name) as Record<string, unknown>;
    const store = Object.values(runtime).find((value): value is RuntimeStore => (
      typeof value === 'object' && value !== null
      && typeof (value as RuntimeStore).getState === 'function'
      && typeof (value as RuntimeStore).setState === 'function'
    ));
    if (!store) throw new Error('Production runtime store export was not found');
    const users = new Map(Array.from({ length: 3000 }, (_, index) => {
      const nick = `qa-${String(index).padStart(4, '0')}${index % 7 === 0
        ? '-LongUnbrokenNicknameForWrappingAndTextEnlargement'.repeat(2) : ''}`;
      return [nick.toLowerCase(), {
        nick, modes: new Set(index < 1000 ? ['o'] : index < 2000 ? ['v'] : []),
        away: index % 5 === 0,
      }];
    }));
    document.documentElement.style.fontSize = '16px';
    store.setState({
      status: 'connected', connectionStatus: 'connected', autoReconnect: false,
      ourNick: 'qa-observer', networkName: 'Onyx QA continuity fixture',
      server: {
        id: 'qa-continuity', name: 'Onyx QA continuity fixture', network: 'QA fixture',
        url: 'wss://qa-continuity.invalid', icon: '', nick: 'qa-observer', connected: true,
      },
      activeView: { kind: 'channel', channel },
      channels: new Map([[channel, {
        name: channel, topic: 'QA fixture: 3000 variable-height members',
        topicSetBy: 'qa-fixture', topicSetAt: null, modes: '', users,
        unread: 0, highlights: 0, createdAt: null, messages: [],
      }]]),
      dms: new Map(), channelProps: new Map(), userProps: new Map(),
    });
    await document.fonts.ready;
  }, CHANNEL);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  const toggle = page.getByTestId('ribbon-members');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.getByRole('region', { name: `People in ${CHANNEL}` })).toBeVisible();
  await expect(page.getByLabel('3000 members', { exact: true })).toBeVisible();
  await settle(page);
}

/** Wait for real layout/observer work to stop changing, not an arbitrary sleep. */
async function settle(page: Page): Promise<void> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([page.locator(ROSTER).evaluate((scroll) => new Promise<void>((resolve, reject) => {
      let previous = '';
      let stable = 0;
      let attempts = 0;
      const sample = () => {
        const signature = [scroll.scrollTop, scroll.scrollHeight, scroll.clientWidth,
          ...Array.from(scroll.querySelectorAll<HTMLElement>('[data-member-measure-key], .shell-members-window-pad'))
            .flatMap((row) => [row.dataset.memberMeasureKey ?? '', row.getBoundingClientRect().height]),
        ].join('|');
        stable = signature === previous ? stable + 1 : 0;
        previous = signature;
        if (stable >= 4) resolve();
        else if (++attempts >= 180) reject(new Error(`Roster geometry did not settle within 180 frames: ${signature}`));
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    })), new Promise<never>((_, reject) => {
      // A renderer stuck doing synchronous layout may never deliver another
      // animation frame. Keep the diagnostic deadline in the test process.
      deadline = setTimeout(() => reject(new Error('Roster renderer did not settle within 10 seconds')), 10_000);
    })]);
  } finally {
    clearTimeout(deadline);
  }
}

async function assertGeometry(page: Page): Promise<void> {
  const geometry = await page.locator(ROSTER).evaluate((scroll) => {
    const bounds = scroll.getBoundingClientRect();
    const rows = Array.from(scroll.querySelectorAll<HTMLElement>('[data-member-measure-key]'))
      .map((row) => ({ element: row, rect: row.getBoundingClientRect() }))
      .filter(({ rect }) => rect.height > 0);
    const members = rows.filter(({ element }) => element.dataset.memberFocusKey);
    const gaps = rows.slice(1).map(({ rect }, index) => rect.top - rows[index]!.rect.bottom);
    const visible = rows.filter(({ rect }) => rect.bottom > bounds.top && rect.top < bounds.bottom);
    return {
      count: members.length,
      heights: [...new Set(members.map(({ rect }) => Math.round(rect.height)))],
      gaps,
      clientHeight: scroll.clientHeight,
      coveredTop: (visible[0]?.rect.top ?? Infinity) - bounds.top,
      coveredBottom: bounds.bottom - (visible.at(-1)?.rect.bottom ?? -Infinity),
      horizontalOverflow: scroll.scrollWidth - scroll.clientWidth,
      clipped: members.flatMap(({ element, rect }) => {
        const nick = element.querySelector<HTMLElement>('.shell-member-nick')!;
        const meta = element.querySelector<HTMLElement>('.shell-member-meta')!;
        const range = document.createRange();
        range.selectNodeContents(nick);
        const textBounds = range.getBoundingClientRect();
        const metaBounds = meta.getBoundingClientRect();
        return nick.scrollHeight > nick.clientHeight + 1 || nick.scrollWidth > nick.clientWidth + 1
          || textBounds.bottom > rect.bottom + 1 || textBounds.top < rect.top - 1
          || metaBounds.bottom > rect.bottom + 1
          ? [{
            key: element.dataset.memberFocusKey,
            row: rect.toJSON(), nick: nick.getBoundingClientRect().toJSON(),
            text: textBounds.toJSON(), meta: metaBounds.toJSON(),
            nickSize: [nick.clientWidth, nick.scrollWidth, nick.clientHeight, nick.scrollHeight],
          }] : [];
      }),
    };
  });
  expect(geometry.count).toBeGreaterThan(0);
  expect(geometry.count).toBeLessThanOrEqual(96);
  expect(geometry.heights.length, 'fixture must exercise genuinely unequal row heights').toBeGreaterThan(1);
  expect(geometry.clientHeight).toBeGreaterThan(0);
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(geometry.clipped, 'full nick and role metadata fit their measured row').toEqual([]);
  expect(geometry.gaps.every((gap) => Math.abs(gap) < 1), 'no inter-row overlap or phantom heading gap').toBe(true);
  // Allow the real scrollport padding at the top/bottom, but never a blank page.
  expect(geometry.coveredTop).toBeLessThanOrEqual(40);
  expect(geometry.coveredBottom).toBeLessThanOrEqual(40);
}

/** Seek by observed fixture identity, never import the virtualizer's own math. */
async function seek(page: Page, index: number): Promise<void> {
  console.info('[member-window] seek', index, await page.locator(ROSTER).evaluate((scroll) => ({
    rootSize: getComputedStyle(document.documentElement).fontSize,
    width: scroll.clientWidth, top: scroll.scrollTop, total: scroll.scrollHeight,
    first: scroll.querySelector<HTMLElement>('[data-member-focus-key]')?.dataset.memberFocusKey,
  })));
  const target = page.locator(`${MEMBER}[data-member-focus-key^="qa-${String(index).padStart(4, '0')}"]`);
  for (let attempt = 0; attempt < 12 && await target.count() === 0; attempt += 1) {
    console.info('[member-window] seek attempt', index, attempt + 1);
    await page.locator(ROSTER).evaluate((scroll, destination) => {
      scroll.closest<HTMLElement>('.shell-members')!.focus({ preventScroll: true });
      const members = Array.from(scroll.querySelectorAll<HTMLElement>('[data-member-focus-key]'));
      const first = Number(members[0]!.dataset.memberFocusKey!.slice(3, 7));
      const average = members.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0) / members.length;
      scroll.scrollTop += (destination - first - 12) * average;
    }, index);
    await settle(page);
  }
  await expect(target).toHaveCount(1);
  await target.evaluate((row) => {
    const scroll = row.closest<HTMLElement>('.shell-members-scroll')!;
    scroll.scrollTop += row.getBoundingClientRect().top - scroll.getBoundingClientRect().top + 7;
  });
  await settle(page);
}

async function rememberAnchor(page: Page): Promise<{ key: string; top: number }> {
  return page.locator(ROSTER).evaluate((scroll) => {
    const top = scroll.getBoundingClientRect().top;
    const row = Array.from(scroll.querySelectorAll<HTMLElement>('[data-member-focus-key]'))
      .find((candidate) => candidate.getBoundingClientRect().bottom > top + 1)!;
    scroll.querySelectorAll('[data-qa-continuity-anchor]').forEach((element) => element.removeAttribute('data-qa-continuity-anchor'));
    row.setAttribute('data-qa-continuity-anchor', '');
    row.querySelector<HTMLButtonElement>('button')!.focus({ preventScroll: true });
    return { key: row.dataset.memberFocusKey!, top: row.getBoundingClientRect().top - top };
  });
}

async function assertAnchor(page: Page, anchor: { key: string; top: number }, delta = 0): Promise<void> {
  const row = page.locator('[data-qa-continuity-anchor]');
  await expect(row).toHaveCount(1); // Same DOM node, not a replacement with the same label.
  await expect(row).toHaveAttribute('data-member-focus-key', anchor.key);
  await expect(row.locator('button')).toBeFocused();
  const top = await row.evaluate((element) => element.getBoundingClientRect().top
    - element.closest('.shell-members-scroll')!.getBoundingClientRect().top);
  expect(Math.abs(top - (anchor.top - delta)), 'visible identity does not jump as estimates resolve').toBeLessThanOrEqual(2);
}

for (const viewport of [
  { name: 'desktop', width: 1440, resizedWidth: 1024, height: 900 },
  { name: 'mobile', width: 390, resizedWidth: 320, height: 844 },
]) {
  test(`3k ${viewport.name} roster keeps variable-height continuity at root 16/32, resize and far end`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedRoster(page);
    await assertGeometry(page);

    for (const rootSize of [16, 32]) {
      // Anchor a partially visible row before changing text size. Adjacent
      // long names and role groups must keep their individual natural heights.
      await seek(page, 995);
      const anchor = await rememberAnchor(page);
      await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, rootSize);
      await settle(page);
      await assertAnchor(page, anchor);
      await assertGeometry(page);

      // Pixel-continuous forward/reverse scrolls cross the Op/Voice boundary.
      for (const delta of [100, 100, 100, -100, -100, -100]) {
        const current = await rememberAnchor(page);
        await page.locator(ROSTER).evaluate((scroll, step) => { scroll.scrollTop += step; }, delta);
        await settle(page);
        await assertAnchor(page, current, delta);
        await assertGeometry(page);
      }
      await seek(page, 1995);
      await assertGeometry(page);
    }

    await seek(page, 2200);
    const resizedAnchor = await rememberAnchor(page);
    await page.setViewportSize({ width: viewport.resizedWidth, height: viewport.height });
    await settle(page);
    await assertAnchor(page, resizedAnchor);
    await assertGeometry(page);

    await seek(page, 2980);
    await page.locator(ROSTER).evaluate((scroll) => {
      scroll.closest<HTMLElement>('.shell-members')!.focus({ preventScroll: true });
      scroll.scrollTop = scroll.scrollHeight;
    });
    await settle(page);
    await assertGeometry(page);
    const last = page.locator(`${MEMBER}[data-member-focus-key="qa-2999"]`);
    await expect(last).toBeVisible();
    const tailGap = await last.evaluate((row) => {
      const scroll = row.closest<HTMLElement>('.shell-members-scroll')!;
      return scroll.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom;
    });
    expect(tailGap).toBeGreaterThanOrEqual(-1);
    expect(tailGap).toBeLessThanOrEqual(40);
    await seek(page, 50);
    await assertGeometry(page);
  });
}
