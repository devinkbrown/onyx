// SPDX-License-Identifier: AGPL-3.0-or-later
// /stats data widgets with a deterministic mocked feed: proportional bar
// charts in data order, spaced label/value pairs, filled heatmap cells, and
// no horizontal overflow at 320 / 390 / 1280.
import { expect, test, type Page } from '@playwright/test';

const DAYS = 14;
const DAY_MS = 86400000;
const now = Date.UTC(2026, 10, 5, 12, 0, 0);
const dateOf = (back: number) => new Date(now - back * DAY_MS).toISOString().slice(0, 10);
// Strictly increasing daily totals, so bar heights must increase left→right.
const networkDays = Array.from({ length: DAYS }, (_, i) => ({ date: dateOf(DAYS - 1 - i), messages: 20 + i * 15 }));
const roomDays = Array.from({ length: 60 }, (_, i) => ({ date: dateOf(59 - i), messages: 5 + i * 3 }));
const hours = Array.from({ length: 24 }, (_, h) => Math.round(10 + 90 * Math.exp(-((h - 20) ** 2) / 18)));
const heatmap = Array.from({ length: 7 }, (_, d) => hours.map(h => Math.round(h * (d === 5 || d === 6 ? 0.4 : 1))));
const spark = Array.from({ length: 14 }, (_, i) => 3 + i);

const index = {
  generated_at: Math.floor(now / 1000),
  network: 'Onyx',
  node: 'eshmaki.me',
  users_online: 7,
  network_days: networkDays,
  channels: [
    { channel: '#root', messages: 2317, active_users: 99, present: 5, last_active: Math.floor(now / 1000) - 600, topic: 'The front door', spark },
    { channel: '#lounge', messages: 410, active_users: 18, present: 2, last_active: Math.floor(now / 1000) - 7200, topic: 'Hang out, say hi', spark: spark.map(n => Math.max(1, n - 5)) },
  ],
};
const detail = {
  channel: '#root',
  generated_at: Math.floor(now / 1000),
  first_seen: Math.floor(now / 1000) - 120 * 86400,
  last_active: Math.floor(now / 1000) - 600,
  present: 5,
  last_speaker: 'trev',
  totals: { messages: 2317, words: 41500, active_users: 99, joins: 541, parts: 1, quits: 357, kicks: 0, topic_changes: 150 },
  hours,
  heatmap,
  days: roomDays,
  records: { busiest_day: { date: dateOf(3), messages: 167 }, peak_hour: 20 },
};

async function mockFeed(page: Page) {
  await page.route('**/stats/data/**', route => {
    const url = route.request().url();
    const body = url.endsWith('/index.json') ? index : detail;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const heights = (page: Page, selector: string) => page.locator(selector).evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
const isMonotonic = (xs: number[]) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);

for (const width of [320, 390, 1280]) {
  test(`STATS-${width} charts, metric grids and heatmap render from the feed without overflow`, async ({ page }, info) => {
    if (info.project.name !== (width === 1280 ? 'chromium' : width === 390 ? 'iphone-13' : 'iphone-se')) test.skip(true, 'one project per width');
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await mockFeed(page);
    await page.goto('/stats/?room=%23root');
    await expect(page.locator('#onyx-boot-splash')).toHaveCount(0);
    await expect(page.getByText('Inside #root')).toBeVisible({ timeout: 15_000 });

    // 1. Network pulse: 14 bars, proportional and in data order.
    const pulse = page.locator('figure[aria-labelledby="network-tide-caption"] .data-bar');
    await expect(pulse).toHaveCount(DAYS);
    const pulseHeights = await heights(page, 'figure[aria-labelledby="network-tide-caption"] .data-bar');
    expect(new Set(pulseHeights.map(h => Math.round(h))).size, 'bars differ in height').toBeGreaterThan(5);
    expect(isMonotonic(pulseHeights), 'bar heights follow the data (increasing series)').toBeTruthy();
    expect(Math.max(...pulseHeights), 'tallest bar fills the chart').toBeGreaterThan(100);
    const pulseWidths = await page.locator('figure[aria-labelledby="network-tide-caption"] .data-bar').evaluateAll(els => els.map(el => el.getBoundingClientRect().width));
    expect(Math.max(...pulseWidths), 'bars are columns, not full-width stripes').toBeLessThan(width / 2);
    await expect(page.locator('.stats-chart-caption').first()).toContainText(networkDays[0].date);

    // 2. When the room talks: 24 proportional bars, spaced ticks.
    const hourHeights = await heights(page, '.stats-hour-chart i');
    expect(hourHeights).toHaveLength(24);
    expect(Math.max(...hourHeights), 'hour bars are visible').toBeGreaterThan(60);
    expect(hourHeights[20], 'peak hour is the tallest').toBe(Math.max(...hourHeights));
    const ticks = await page.locator('.stats-hour-axis span').evaluateAll(els => els.map(el => el.getBoundingClientRect()));
    for (let i = 1; i < ticks.length; i += 1) expect(ticks[i].left - ticks[i - 1].right, 'tick labels are spaced apart').toBeGreaterThanOrEqual(4);

    // 3. Metric grid: label, value and hint are separate boxes with spacing.
    const metric = page.locator('.stats-inspector-metrics > div').first();
    const parts = await metric.evaluate(el => [...el.children].map(c => c.getBoundingClientRect()));
    expect(parts.length).toBe(3);
    expect(parts[1].top - parts[0].bottom, 'value sits below the label (not glued)').toBeGreaterThanOrEqual(0);
    const glued = await page.locator('.stats-inspector-metrics').evaluate(el => /present now\d|tracked\d|contributors\d/.test(el.textContent || ''));
    const spaced = await page.locator('.stats-inspector-metrics > div').first().evaluate(el => { const [a, b] = [...el.children].map(c => c.getBoundingClientRect()); return b.top >= a.bottom - 1 || b.left - a.right >= 4; });
    expect(spaced, 'label and value are visually separated').toBeTruthy();
    void glued;
    // Room movement: two-column rows.
    const flowRows = await page.locator('.stats-flow-list > div').evaluateAll(els => els.map(el => { const [dt, dd] = [...el.children].map(c => c.getBoundingClientRect()); return { sameLine: Math.abs(dt.top - dd.top) < dt.height, gap: dd.left - dt.right }; }));
    expect(flowRows.length).toBe(6);
    for (const row of flowRows) { expect(row.sameLine, 'term and value share a line').toBeTruthy(); expect(row.gap).toBeGreaterThanOrEqual(8); }
    // Directory rows: name and count apart.
    const heading = page.locator('.data-room-heading').first();
    const headingParts = await heading.evaluate(el => [...el.children].map(c => c.getBoundingClientRect()));
    expect(headingParts[1].left - headingParts[0].right >= 4 || headingParts[1].top >= headingParts[0].bottom - 1, 'room name and status separated').toBeTruthy();

    // 4. Heatmap cells carry intensity.
    const cells = await page.locator('.stats-heatmap td').evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
    expect(cells.length).toBe(7 * 24);
    expect(new Set(cells).size, 'cells have different intensities').toBeGreaterThan(5);
    const transparent = cells.filter(c => c === 'rgba(0, 0, 0, 0)').length;
    expect(transparent, 'no unpainted cells').toBe(0);

    // 5. Page never scrolls sideways; the heatmap scrolls inside its own region.
    const geometry = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: innerWidth }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
    const region = page.getByRole('region', { name: /weekly activity table/ });
    const scrollable = await region.evaluate(el => el.scrollWidth > el.clientWidth);
    if (width < 768) expect(scrollable, 'heatmap region scrolls horizontally on phones').toBeTruthy();
  });
}
