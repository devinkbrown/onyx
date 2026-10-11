// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * screens-css-inert.mjs — scenario wrapper for elm/tools/css-inert.mjs.
 * Exports every scenario of the other screens-*.mjs files as `inert__<name>__<file>`;
 * after the scenario ran, the page is probed: for each style rule of the sheets
 * named in $CSS_INERT_FILES (comma list of file stems, e.g. `app,pol-shell`) the rule is
 * removed from the CSSOM, the computed style of the elements it matches is compared with
 * and without it, and the rule is put back. One JSON per page goes to $CSS_INERT_OUT.
 */
/* global CSS, getComputedStyle */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import appearance from './screens-appearance.mjs';
import calls from './screens-calls.mjs';
import convo from './screens-convo.mjs';
import gapAccount from './screens-gap-account.mjs';
import gapAuth from './screens-gap-auth.mjs';
import gapChanserv from './screens-gap-chanserv.mjs';
import gapClaim from './screens-gap-claim.mjs';
import gapCommands from './screens-gap-commands.mjs';
import gapConvo from './screens-gap-convo.mjs';
import gapImport from './screens-gap-import.mjs';
import gapOper from './screens-gap-oper.mjs';
import gapPeople from './screens-gap-people.mjs';
import gapShell from './screens-gap-shell.mjs';
import gapUsermodes from './screens-gap-usermodes.mjs';
import messages from './screens-messages.mjs';
import organize from './screens-organize.mjs';
import rx from './screens-rx.mjs';
import rxPublic from './screens-rx-public.mjs';
import rxSheets from './screens-rx-sheets.mjs';
import shell from './screens-shell.mjs';
import uiSheets from './screens-ui-sheets.mjs';
import watch from './screens-watch.mjs';

const FILES = { ap: appearance, calls, cv: convo, ga: gapAccount, gauth: gapAuth, cs: gapChanserv, gcl: gapClaim, gcmd: gapCommands, gcv: gapConvo, gi: gapImport, oper: gapOper, gp: gapPeople, gs: gapShell, um: gapUsermodes, msg: messages, org: organize, rx, rxp: rxPublic, rxs: rxSheets, shell, uis: uiSheets, watch };
const SKIP = /^(ap-(assert|audit|scene)|rx-probe$)/;

/** In-page: for each style rule of the chosen sheets that matches something, one record
    {f, i, n, d:[[j, e, o], ...]} where j is the index of the declaration in the SOURCE rule,
    e = removing the rule changes a property that declaration sets, o = the declaration's value
    loses to a different one (a stronger rule wins). `srcMap[file][ordinal]` lists the source
    declaration texts, so shorthands map to the longhands the browser expands them to. */
function probe(arg) {
  const { stems, srcMap } = arg;
  const out = [];
  const tmp = document.createElement('div').style;
  let ordinal = -1;
  const active = (rule) => {
    for (let p = rule.parentRule; p; p = p.parentRule) {
      const t = p.constructor.name;
      if (t === 'CSSMediaRule') { if (!window.matchMedia(p.conditionText || p.media.mediaText).matches) return false; }
      else if (t === 'CSSSupportsRule') { if (!CSS.supports(p.conditionText)) return false; }
      else if (t === 'CSSContainerRule' || t === 'CSSScopeRule') return null; // unknown: skip
    }
    return true;
  };
  const visit = (rules, file) => {
    for (const r of rules) {
      const t = r.constructor.name;
      if (t === 'CSSStyleRule') {
        ordinal += 1;
        const idx = ordinal;
        if (active(r) !== true) continue;
        const texts = (srcMap[file] || [])[idx];
        if (!texts || !texts.length) continue;
        let els;
        try { els = [...document.querySelectorAll(r.selectorText)]; } catch { continue; }
        if (!els.length) continue;
        if (els.length > 48) { const step = els.length / 48; els = Array.from({ length: 48 }, (_, k) => els[Math.floor(k * step)]); }
        const groups = texts.map((txt) => { tmp.cssText = ''; tmp.cssText = txt; return [...tmp].filter((p) => !p.startsWith('--')); });
        const props = [...new Set(groups.flat())];
        if (!props.length) continue;
        const read = () => els.map((el) => { const cs = getComputedStyle(el); return props.map((p) => cs.getPropertyValue(p)); });
        const before = read();
        const saved = r.style.cssText;
        r.style.cssText = '';
        const after = read();
        // same declarations, every one !important: a property that changes now is one the
        // rule normally LOSES (a stronger rule wins with a different value)
        r.style.cssText = texts.map((d) => (/!\s*important\s*$/i.test(d) ? d : `${d} !important`)).join(';');
        const imp = read();
        r.style.cssText = saved;
        const eff = new Set(); const ovr = new Set();
        props.forEach((p, pi) => {
          if (before.some((row, ei) => row[pi] !== after[ei][pi])) eff.add(p);
          else if (before.some((row, ei) => row[pi] !== imp[ei][pi])) ovr.add(p);
        });
        const d = [];
        groups.forEach((g, j) => { if (g.length) d.push([j, g.some((p) => eff.has(p)) ? 1 : 0, !g.some((p) => eff.has(p)) && g.some((p) => ovr.has(p)) ? 1 : 0]); });
        out.push({ f: file, i: idx, n: els.length, d });
      } else if (r.cssRules && t !== 'CSSKeyframesRule') visit(r.cssRules, file);
    }
  };
  for (const sheet of document.styleSheets) {
    const href = sheet.href || '';
    const m = /\/(?:css\/)?([a-z0-9-]+)(?:\.[0-9a-f]{12})?\.css(?:$|\?)/.exec(href);
    if (!m || !stems.includes(m[1])) continue;
    ordinal = -1;
    try { visit(sheet.cssRules, m[1]); } catch { /* cross-origin */ }
  }
  return out;
}

const stems = (process.env.CSS_INERT_FILES || 'app').split(',');
const outDir = process.env.CSS_INERT_OUT;
const srcMap = process.env.CSS_INERT_SRC ? JSON.parse(readFileSync(process.env.CSS_INERT_SRC, 'utf8')) : {};
if (outDir) mkdirSync(outDir, { recursive: true });

const wrap = (fn) => async (page, h) => {
  await fn(page, h);
  await h.settle(page, 250);
  const rows = await page.evaluate(probe, { stems, srcMap });
  return rows;
};

export const RAW = {}; // every scenario, unwrapped: inert__<name>__<file> -> fn(page, h)
const scenarios = {};
const seenFns = new Set();
for (const [file, src] of Object.entries(FILES)) {
  for (const [name, fn] of Object.entries(src)) {
    if (SKIP.test(name) || seenFns.has(fn)) continue;
    seenFns.add(fn);
    const key = `inert__${name}__${file}`;
    if (scenarios[key]) continue;
    RAW[key] = fn;
    scenarios[key] = async (page, h) => {
      const rows = await wrap(fn)(page, h);
      if (outDir) {
        const { width, height } = page.viewportSize();
        writeFileSync(`${outDir}/${name}__${file}--${width}x${height}.json`, JSON.stringify(rows));
      }
    };
  }
}
// built-ins of screens.mjs are not reachable from here; the shell/rx files re-export the interesting ones.
export default scenarios;
export const NAMES = Object.keys(scenarios);
