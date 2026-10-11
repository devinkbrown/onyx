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
import { mkdirSync, writeFileSync } from 'node:fs';

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

/** In-page: returns [{f, i, sel, n, seen, eff, ovr}] for the rules that match something:
    eff = removing the rule changes the property, ovr = the rule's value loses to a different one. */
function probe(stems) {
  const out = [];
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
        const act = active(r);
        if (act !== true) continue;
        let els;
        try { els = [...document.querySelectorAll(r.selectorText)]; } catch { continue; }
        if (!els.length) continue;
        if (els.length > 48) { const step = els.length / 48; els = Array.from({ length: 48 }, (_, k) => els[Math.floor(k * step)]); }
        const decls = [...r.style].filter((p) => !p.startsWith('--'));
        if (!decls.length) continue;
        const read = () => els.map((el) => { const cs = getComputedStyle(el); return decls.map((p) => cs.getPropertyValue(p)); });
        const before = read();
        const saved = r.style.cssText;
        r.style.cssText = '';
        const after = read();
        // same declarations, every one !important: a property that changes now is one the
        // rule normally LOSES (a stronger rule wins with a different value)
        const parts = []; let depth = 0; let cur = '';
        for (const ch of saved) { if (ch === '(') depth += 1; if (ch === ')') depth -= 1; if (ch === ';' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
        if (cur.trim()) parts.push(cur);
        r.style.cssText = parts.map((d) => (/!\s*important\s*$/i.test(d) ? d : d.trim() + ' !important')).join(';');
        const imp = read();
        r.style.cssText = saved;
        const eff = []; const ovr = [];
        decls.forEach((p, di) => {
          if (before.some((row, ei) => row[di] !== after[ei][di])) eff.push(p);
          else if (before.some((row, ei) => row[di] !== imp[ei][di])) ovr.push(p);
        });
        out.push({ f: file, i: idx, sel: r.selectorText, n: els.length, seen: decls, eff, ovr });
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
if (outDir) mkdirSync(outDir, { recursive: true });

const wrap = (fn) => async (page, h) => {
  await fn(page, h);
  await h.settle(page, 250);
  const rows = await page.evaluate(probe, stems);
  return rows;
};

const scenarios = {};
const seenFns = new Set();
for (const [file, src] of Object.entries(FILES)) {
  for (const [name, fn] of Object.entries(src)) {
    if (SKIP.test(name) || seenFns.has(fn)) continue;
    seenFns.add(fn);
    const key = `inert__${name}__${file}`;
    if (scenarios[key]) continue;
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
