import { chromium } from '@playwright/test';
const browser = await chromium.launch();
for (const w of [360, 390, 768, 1024, 1280, 1440]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: 900 } })).newPage();
  await page.goto('https://eshmaki.me/', { waitUntil: 'networkidle' });
  const r = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    let widest = null;
    if (overflow > 0) {
      for (const el of document.querySelectorAll('body *')) {
        const rect = el.getBoundingClientRect();
        if (rect.right > window.innerWidth + 1 || rect.left < -1) {
          widest = `${el.tagName}.${(el.className||'').toString().split(' ')[0]} right=${Math.round(rect.right)} left=${Math.round(rect.left)}`;
          break;
        }
      }
    }
    return { overflow, widest };
  });
  console.log(w, JSON.stringify(r));
  await page.context().close();
}
await browser.close();
