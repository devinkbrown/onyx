import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto('http://localhost:3000/app', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window).__onyx);
await page.evaluate(() => {
  const store = window.__onyx.store;
  store.setState({ ...store.getInitialState(), activeView: { kind: 'home' }, connectionStatus: 'connected', ourNick: 'kain', networkName: 'IRCXNet', channels: new Map(), channelList: [{ name: '#root', count: 14, topic: 'hi' }], channelListLoading: false }, true);
});
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Browse all channels' }).click();
await page.waitForTimeout(900);
const info = await page.evaluate(() => {
  const sheet = document.querySelector('.onyx-sheet');
  const panel = document.querySelector('.onyx-sheet__panel');
  const out = { sheetExists: !!sheet, panelExists: !!panel };
  if (panel) {
    const r = panel.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    Object.assign(out, { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, display: cs.display, opacity: cs.opacity, transform: cs.transform, visibility: cs.visibility, zIndex: cs.zIndex });
    out.bodyHTMLLen = panel.querySelector('.onyx-sheet__body')?.innerHTML.length ?? -1;
  }
  if (sheet) { const rs = sheet.getBoundingClientRect(); out.sheetRect = { w: rs.width, h: rs.height }; out.sheetChildren = sheet.children.length; }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
