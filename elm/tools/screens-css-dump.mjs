// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-css-dump.mjs — scenario wrapper for `css-inert.mjs verify`.
 * After each scenario (all of screens-*.mjs, as `inert__<name>__<file>` keys) the page's
 * computed style is fingerprinted: for every element, a 32-bit hash of ALL its computed
 * properties, plus its tag / class for the report. One JSON per page goes to $CSS_DUMP_OUT.
 * Two builds that differ only in dead CSS dump identical files.
 */
/* global getComputedStyle */
import { mkdirSync, writeFileSync } from 'node:fs';
import { RAW } from './screens-css-inert.mjs';

const outDir = process.env.CSS_DUMP_OUT;
if (outDir) mkdirSync(outDir, { recursive: true });

function dump() {
  const rows = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    let h = 2166136261;
    for (let k = 0; k < cs.length; k += 1) {
      const p = cs[k];
      if (p.startsWith('--')) continue; // custom properties enumerate in an unstable order; their effect shows in the real properties
      const s = `${p}:${cs.getPropertyValue(p)};`;
      for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    rows.push([`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`, h >>> 0]);
  }
  return rows;
}

const scenarios = {};
for (const [key, fn] of Object.entries(RAW)) {
  scenarios[key.replace(/^inert__/, 'dump__')] = async (page, h) => {
    await fn(page, h);
    await h.settle(page, 250);
    const rows = await page.evaluate(dump);
    if (outDir) {
      const { width, height } = page.viewportSize();
      writeFileSync(`${outDir}/${key.replace(/^inert__/, '')}--${width}x${height}.json`, JSON.stringify(rows));
    }
  };
}
export default scenarios;
export const NAMES = Object.keys(scenarios);
