#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * css-inert.mjs — find CSS declarations the browser never uses.
 *
 * README
 * ------
 * css-regress.mjs proves a refactor changed nothing; this tool finds what a
 * refactor may remove. For every style rule of the chosen stylesheets it
 * asks Chromium, on a live page (every screens-*.mjs scenario x a few
 * viewports): "if this rule did not exist, would the computed style of any
 * element it matches change?" A declaration that is matched on many elements,
 * in many scenarios, and never changes a computed value is INERT: something
 * later in the cascade always overrides it (the v1 `app.css` layer is full of
 * them). Rules inside media queries that do not apply at the viewport are not
 * counted, and :hover / ::before style rules only count where the page shows
 * that state, so "never observed" is not "inert".
 *
 *   node elm/tools/css-inert.mjs probe --out DIR [--dist elm/dist-elm] [--files app,pol-shell]
 *        [--vp phone,fold-open,tablet-land,desktop,laptop-short] [--jobs 6] [--only substr]
 *   node elm/tools/css-inert.mjs report DIR [--file app] [--min-pages 4] [--json out.json]
 *
 * `probe` copies the built dist, swaps in the UNMINIFIED sources of the
 * worktree under the same hashed names (rule order = source order), and runs
 * `nice`d screens.mjs jobs. `report` lists, per declaration, how many pages
 * matched it and how many used it; --json writes the inert list as
 * {file, line, prop} for a pruning pass.
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const repo = resolve(here, '../..');
const [cmd, ...rest] = process.argv.slice(2);
const flag = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const FREEZE = '2026-03-14T15:00:10.000Z';

if (cmd === 'probe') {
  const out = resolve(flag('--out', ''));
  if (!flag('--out', '')) { console.error('probe needs --out DIR'); process.exit(2); }
  const dist = resolve(repo, flag('--dist', 'elm/dist-elm'));
  const files = flag('--files', 'app').split(',');
  const vps = flag('--vp', 'phone,fold-open,tablet-land,desktop,laptop-short').split(',');
  const only = flag('--only', '');
  const jobs = Number(flag('--jobs', Math.max(2, Math.floor(cpus().length / 5))));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // dist copy with raw css under the hashed names
  const probeDist = `${out}-dist`;
  rmSync(probeDist, { recursive: true, force: true });
  cpSync(dist, probeDist, { recursive: true });
  const html = readFileSync(join(probeDist, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<link\b[^>]*\bhref="([^"]+\.css)"/g)) {
    const logical = m[1].replace(/\.[0-9a-f]{12}\.css$/, '.css');
    copyFileSync(join(repo, 'elm', logical), join(probeDist, m[1]));
  }
  const { NAMES } = await import(join(here, 'screens-css-inert.mjs'));
  const names = NAMES.filter((n) => !only || n.includes(only));
  const chunks = [];
  for (let i = 0; i < names.length; i += 4) chunks.push(names.slice(i, i + 4));
  const queue = chunks.map((c) => c);
  let done = 0; const problems = [];
  const run = (chunk) => new Promise((res) => {
    const args = ['-n', '19', process.execPath, join(here, 'screens.mjs'), '--dist', probeDist, '--out', `${out}/shots`, '--extra', join(here, 'screens-css-inert.mjs'),
      '--only', chunk.join(','), '--vp', vps.join(','), '--freeze', FREEZE, '--stable'];
    const p = spawn('nice', args, { cwd: repo, env: { ...process.env, TZ: 'UTC', CSS_INERT_OUT: out, CSS_INERT_FILES: files.join(',') } });
    let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
    p.on('close', () => { done += 1; for (const l of log.split('\n')) if (l.startsWith('PROBLEM') && !/horizontal overflow/.test(l)) problems.push(l); process.stderr.write(`\r${done}/${chunks.length} jobs`); res(); });
  });
  await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) await run(queue.shift()); }));
  process.stderr.write('\n');
  rmSync(`${out}/shots`, { recursive: true, force: true });
  console.log(`probed ${readdirSync(out).filter((f) => f.endsWith('.json')).length} pages -> ${out}; ${problems.length} problem lines`);
  for (const p of problems.slice(0, 15)) console.log('  ' + p);
} else if (cmd === 'report') {
  const dir = resolve(rest.find((x) => !x.startsWith('--')) || '');
  const file = flag('--file', 'app');
  const minPages = Number(flag('--min-pages', 4));
  const { parseCss, walk } = await import('./css-inert-scan.mjs');
  const rel = file === 'app' ? 'app.css' : `css/${file}.css`;
  // the sources the probe ran against (its dist copy), not whatever the worktree holds now
  const pd = `${dir}-dist`; const pdir = file === 'app' ? pd : join(pd, 'css');
  const hit = readdirSync(pdir).find((n) => new RegExp(`^${file}\\.[0-9a-f]{12}\\.css$`).test(n));
  const src = readFileSync(hit ? join(pdir, hit) : join(repo, 'elm', rel), 'utf8');
  const rules = []; for (const { node } of walk(parseCss(src).nodes)) if (node.kind === 'rule') rules.push(node);
  const agg = new Map(); // `${i}|${prop}` -> {pages, eff, ovr, scen:Set}
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const scen = f.split('--')[0];
    for (const r of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
      if (r.f !== file) continue;
      for (const p of r.seen) {
        const k = `${r.i}|${p}`; const a = agg.get(k) || { pages: 0, eff: 0, ovr: 0, scen: new Set() };
        a.pages += 1; a.scen.add(scen);
        if (r.eff.includes(p)) a.eff += 1; else if ((r.ovr || []).includes(p)) a.ovr += 1;
        agg.set(k, a);
      }
    }
  }
  // inert = used on no page (never effective) and OVERRIDDEN with a different value on at least one
  const inert = []; let seenDecls = 0;
  for (const [k, a] of agg) {
    seenDecls += 1;
    if (a.eff === 0 && a.ovr >= 1 && a.pages >= minPages && a.scen.size >= 2) {
      const [i, prop] = k.split('|'); const rule = rules[Number(i)]; if (!rule) continue;
      const decl = rule.decls.find((d) => d.prop === prop || prop.startsWith(d.prop + '-'));
      inert.push({ file: rel, line: decl ? decl.line : rule.line, rule: rule.line, sel: rule.selector.replace(/\s+/g, ' ').slice(0, 80), prop, declProp: decl ? decl.prop : prop, pages: a.pages, overridden: a.ovr, scenarios: a.scen.size });
    }
  }
  // whole rules: matched on enough pages, never effective for ANY property, overridden for at least one
  const byRule = new Map();
  for (const [k, a] of agg) { const i = Number(k.split('|')[0]); const r = byRule.get(i) || { pages: 0, eff: 0, ovr: 0, scen: new Set(), props: 0 }; r.pages = Math.max(r.pages, a.pages); r.eff += a.eff; r.ovr += a.ovr; for (const s of a.scen) r.scen.add(s); r.props += 1; byRule.set(i, r); }
  const wholeRules = [];
  for (const [i, r] of byRule) if (r.eff === 0 && r.ovr >= 1 && r.pages >= minPages && r.scen.size >= 2 && rules[i]) wholeRules.push({ file: rel, line: rules[i].line, sel: rules[i].selector.replace(/\s+/g, ' ').slice(0, 90), decls: rules[i].decls.length, pages: r.pages, scenarios: r.scen.size });
  console.log(`${file}: ${wholeRules.length} whole rules inert (${wholeRules.reduce((n, r) => n + r.decls, 0)} declarations)`);
  const wj = flag('--whole-json', ''); if (wj) writeFileSync(wj, JSON.stringify(wholeRules, null, 1));
  console.log(`${file}: ${rules.length} rules; ${seenDecls} (rule,property) pairs observed; ${inert.length} inert (>= ${minPages} pages, >= 2 scenarios)`);
  const j = flag('--json', '');
  if (j) writeFileSync(j, JSON.stringify(inert, null, 1));
  for (const r of inert.slice(0, Number(flag('--show', 40)))) console.log(`  ${r.file}:${r.line}  ${r.sel}  { ${r.prop} }  (${r.overridden}/${r.pages} pages overridden, ${r.scenarios} scenarios)`);
} else {
  console.error('usage: css-inert.mjs probe|report   (see the README comment at the top of this file)');
  process.exit(2);
}
