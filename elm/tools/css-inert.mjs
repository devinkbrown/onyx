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
 *        [--vp phone,fold-open,tablet-land,desktop,laptop-short] [--jobs 6] [--only substr] [--resume]
 *   node elm/tools/css-inert.mjs report DIR [--file app] [--min-pages 4] [--min-ratio 0.8] [--json out.json]
 *   node elm/tools/css-inert.mjs verify --a DIST_A --b DIST_B --out DIR [--vp phone,tablet-land,desktop] [--jobs N]
 *        fingerprints every element's computed style in every scenario for two builds and compares
 *        (the check that deleting the inert declarations changed nothing the browser computes)
 *
 * Two declarations that say the same thing in two files (a v1 rule and its
 * re-cut) are each "inert" next to the other, so deleting both is a bug the
 * probe cannot see. Therefore: delete from ONE probe run at a time, rebuild,
 * and run `verify` (below) before trusting the result or probing another file.
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
  const resume = rest.includes('--resume'); // keep the pages already probed; skip the scenarios that have all theirs
  if (!resume) rmSync(out, { recursive: true, force: true });
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
  // the source declaration texts of every style rule, in rule order: the page maps shorthands to longhands with them
  const { parseCss, walk } = await import('./css-inert-scan.mjs');
  const srcMap = {};
  for (const stem of files) {
    const dirp = stem === 'app' ? probeDist : join(probeDist, 'css');
    const hit = readdirSync(dirp).find((n) => new RegExp(`^${stem}\\.[0-9a-f]{12}\\.css$`).test(n));
    if (!hit) { console.error(`no ${stem}.css in ${dirp}`); process.exit(2); }
    const list = [];
    for (const { node } of walk(parseCss(readFileSync(join(dirp, hit), 'utf8')).nodes)) if (node.kind === 'rule') list.push(node.decls.map((d) => `${d.prop}: ${d.value}`));
    srcMap[stem] = list;
  }
  writeFileSync(`${out}-src.json`, JSON.stringify(srcMap));
  const { NAMES } = await import(join(here, 'screens-css-inert.mjs'));
  const names = NAMES.filter((n) => !only || n.includes(only));
  const VP = { se: '320x568', phone: '390x844', promax: '430x932', 'phone-land': '844x390', fold: '344x882', 'fold-open': '673x841', tablet: '820x1180', 'tablet-land': '1180x820', 'ipad-pro-land': '1366x1024', laptop: '1280x720', 'laptop-short': '1366x600', desktop: '1440x900', fhd: '1920x1080', ultrawide: '2560x1080', 'ultrawide-qhd': '3440x1440' };
  const have = new Set(readdirSync(out));
  const doneName = (n) => vps.every((v) => have.has(`${n.replace(/^inert__/, '')}--${VP[v]}.json`));
  const todo = resume ? names.filter((n) => !doneName(n)) : names;
  const chunks = [];
  for (let i = 0; i < todo.length; i += 4) chunks.push(todo.slice(i, i + 4));
  const queue = chunks.map((c) => c);
  let done = 0; const problems = [];
  const run = (chunk) => new Promise((res) => {
    const args = ['-n', '19', process.execPath, join(here, 'screens.mjs'), '--dist', probeDist, '--out', `${out}/shots`, '--extra', join(here, 'screens-css-inert.mjs'),
      '--only', chunk.join(','), '--vp', vps.join(','), '--freeze', FREEZE, '--stable'];
    const p = spawn('nice', args, { cwd: repo, env: { ...process.env, TZ: 'UTC', CSS_INERT_OUT: out, CSS_INERT_FILES: files.join(','), CSS_INERT_SRC: `${out}-src.json` } });
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
  const minRatio = Number(flag('--min-ratio', 0.8)); // overridden on at least this share of the pages that match it
  const { parseCss, walk } = await import('./css-inert-scan.mjs');
  const rel = file === 'app' ? 'app.css' : `css/${file}.css`;
  // the sources the probe ran against (its dist copy), not whatever the worktree holds now
  const pd = `${dir}-dist`; const pdir = file === 'app' ? pd : join(pd, 'css');
  const hit = readdirSync(pdir).find((n) => new RegExp(`^${file}\\.[0-9a-f]{12}\\.css$`).test(n));
  const src = readFileSync(hit ? join(pdir, hit) : join(repo, 'elm', rel), 'utf8');
  const rules = []; for (const { node } of walk(parseCss(src).nodes)) if (node.kind === 'rule') rules.push(node);
  const agg = new Map(); // `${i}|${j}` -> {pages, eff, ovr, scen:Set}
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const scen = f.split('--')[0];
    for (const r of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
      if (r.f !== file) continue;
      for (const [dj, e, o] of r.d) {
        const k = `${r.i}|${dj}`; const a = agg.get(k) || { pages: 0, eff: 0, ovr: 0, scen: new Set() };
        a.pages += 1; a.scen.add(scen); a.eff += e; a.ovr += o;
        agg.set(k, a);
      }
    }
  }
  // inert = used on no page (never effective) and OVERRIDDEN with a different value on at least one
  const inert = []; const used = []; let seenDecls = 0;
  for (const [k, a] of agg) {
    seenDecls += 1;
    const [i, dj] = k.split('|').map(Number); const rule = rules[i]; const decl = rule && rule.decls[dj];
    if (!decl) continue;
    const row = { file: rel, line: decl.line, rule: rule.line, sel: rule.selector.replace(/\s+/g, ' ').slice(0, 80), prop: decl.prop, value: decl.value.slice(0, 40), pages: a.pages, overridden: a.ovr, scenarios: a.scen.size };
    if (a.eff === 0 && a.ovr >= 1 && a.ovr / a.pages >= minRatio && a.pages >= minPages && a.scen.size >= 2) inert.push(row); else used.push(row);
  }
  console.log(`${file}: ${rules.length} rules; ${seenDecls} declarations observed; ${inert.length} inert (never used on >= ${minPages} pages in >= 2 scenarios, overridden by a different value on >= ${Math.round(minRatio * 100)}% of the pages that match it)`);
  const j = flag('--json', '');
  if (j) writeFileSync(j, JSON.stringify(inert, null, 1));
  for (const r of inert.slice(0, Number(flag('--show', 40)))) console.log(`  ${r.file}:${r.line}  ${r.sel}  { ${r.prop}: ${r.value} }  (${r.overridden}/${r.pages} pages overridden, ${r.scenarios} scenarios)`);
} else if (cmd === 'verify') {
  // verify --a DIST_A --b DIST_B --out DIR: every element's computed style, in every scenario, must
  // be identical in the two builds (e.g. before / after deleting inert declarations).
  const out = resolve(flag('--out', ''));
  if (!flag('--out', '') || !flag('--a', '') || !flag('--b', '')) { console.error('verify needs --a DIST --b DIST --out DIR'); process.exit(2); }
  const vps = flag('--vp', 'phone,tablet-land,desktop').split(',');
  const only = flag('--only', '');
  const jobs = Number(flag('--jobs', Math.max(2, Math.floor(cpus().length / 2))));
  rmSync(out, { recursive: true, force: true });
  const { NAMES } = await import(join(here, 'screens-css-dump.mjs'));
  const names = NAMES.filter((n) => !only || n.includes(only));
  const queue = [];
  for (const side of ['a', 'b']) for (let i = 0; i < names.length; i += 4) queue.push({ side, chunk: names.slice(i, i + 4) });
  let done = 0;
  const run = ({ side, chunk }) => new Promise((res) => {
    const dist = resolve(repo, flag(`--${side}`, ''));
    const args = ['-n', '10', process.execPath, join(here, 'screens.mjs'), '--dist', dist, '--out', `${out}/${side}-shots`, '--extra', join(here, 'screens-css-dump.mjs'),
      '--only', chunk.join(','), '--vp', vps.join(','), '--freeze', FREEZE, '--stable'];
    const p = spawn('nice', args, { cwd: repo, env: { ...process.env, TZ: 'UTC', CSS_DUMP_OUT: `${out}/${side}` } });
    p.stdout.on('data', () => {}); p.stderr.on('data', () => {});
    p.on('close', () => { done += 1; process.stderr.write(`\r${done}/${queue.length} jobs`); res(); });
  });
  const work = [...queue];
  await Promise.all(Array.from({ length: jobs }, async () => { while (work.length) await run(work.shift()); }));
  process.stderr.write('\n');
  rmSync(`${out}/a-shots`, { recursive: true, force: true }); rmSync(`${out}/b-shots`, { recursive: true, force: true });
  const fa = readdirSync(`${out}/a`).filter((f) => f.endsWith('.json')); const fb = new Set(readdirSync(`${out}/b`).filter((f) => f.endsWith('.json')));
  let same = 0; const structural = []; const differing = []; let missing = 0;
  for (const f of fa) {
    if (!fb.has(f)) { missing += 1; continue; }
    const A = JSON.parse(readFileSync(`${out}/a/${f}`, 'utf8')); const B = JSON.parse(readFileSync(`${out}/b/${f}`, 'utf8'));
    if (A.length !== B.length) { structural.push(`${f}: ${A.length} vs ${B.length} elements`); continue; }
    const bad = []; A.forEach((row, i) => { if (row[1] !== B[i][1] || row[0] !== B[i][0]) bad.push(`#${i} ${row[0]}`); });
    if (bad.length) differing.push(`${f}: ${bad.length} element(s) differ, e.g. ${bad.slice(0, 4).join(', ')}`); else same += 1;
  }
  console.log(`verify: ${fa.length} pages; identical ${same}; computed style differs ${differing.length}; DOM differs (flake?) ${structural.length}; missing in b ${missing}`);
  for (const l of differing.slice(0, 40)) console.log('  DIFF ' + l);
  for (const l of structural.slice(0, 20)) console.log('  DOM  ' + l);
  process.exit(differing.length ? 1 : 0);
} else {
  console.error('usage: css-inert.mjs probe|report|verify   (see the README comment at the top of this file)');
  process.exit(2);
}
