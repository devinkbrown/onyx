#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * css-regress.mjs — pixel-regression harness for the Elm client's CSS.
 *
 * README
 * ------
 * Purpose: let a CSS refactor prove "no visual change" instead of asserting
 * it. Shoot the whole screenshot matrix from a known-good build (the
 * baseline), change CSS, rebuild, shoot again, and diff pixel-by-pixel. A
 * refactor step is accepted only when every diff is zero or an intentional,
 * reviewed fix.
 *
 *   bash elm/tools/build.sh                                 # build under test
 *   node elm/tools/css-regress.mjs shoot --out /tmp/rx/base # baseline (HEAD)
 *   ... edit CSS, rebuild ...
 *   node elm/tools/css-regress.mjs shoot --out /tmp/rx/cur
 *   node elm/tools/css-regress.mjs diff /tmp/rx/base /tmp/rx/cur --report /tmp/rx/report
 *   node elm/tools/css-regress.mjs noise --out /tmp/rx/n1   # shoot twice, diff: proves determinism
 *   node elm/tools/css-regress.mjs list                     # the matrix, with shot counts
 *
 * What gets shot (elm/tools/screens-css-regress.mjs `SET`; ~600 shots):
 *   core    every shell surface at all 15 matrix viewports (se … ultrawide-qhd)
 *   sheets  every sheet/overlay/call/gap surface at phone, phone-land, desktop
 *   public  public + connect pages, FULL PAGE, DPR 1, at se/phone/tablet/desktop/ultrawide
 *   seam    (opt-in: --tier seam) 767/768/769 px for the mobile/desktop seam
 *   Scenarios come from the screens-*.mjs files (shell, rx, rx-sheets, rx-public,
 *   appearance [ocean, pearl, hc], gap-*, organize, watch, calls, convo, …) plus
 *   keyboard-focus tours and hover states that write extra PNGs.
 *
 * Determinism (so a non-zero diff always means a CSS change): screens.mjs is
 * run with --freeze (the fake server's timestamps AND the page clock are fixed,
 * TZ=UTC, locale en-US, the node-side scenario clock frozen too, a stable
 * port per job), --stable (animations disabled, caret hidden; it
 * already emulates prefers-reduced-motion). `noise` shoots twice and diffs, so
 * flaky scenarios are visible before they can fool a refactor; flaky shots
 * can be excluded with --skip name,name (matched against file-name prefixes).
 *
 * Output: one PNG per shot (`<scenario>--<viewport>.png`, plus extra state
 * shots `css__<name>-<tag>--<W>x<H>.png`) and `shoot.log` (PROBLEM lines).
 * `diff` writes report.json + report.html with before | after | diff crops of
 * every changed region to --report, prints a summary, exits 1 if anything
 * differs. Options: --tolerance N (per-channel difference ignored, default 0),
 * --only substr (filter file names), --noise A B (two baseline runs of the
 * same build: pixels where A and B differ, dilated 3px, are ignored, so a
 * flaky shot only fails on changes OUTSIDE its own flaky regions).
 *
 * Needs: the system Chromium and playwright-core from the repo's pnpm store
 * (same lookup as screens.mjs); the PNG codec is playwright-core's bundled
 * pngjs, so nothing is installed.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const repo = resolve(here, '../..');
const [cmd, ...rest] = process.argv.slice(2);
const flag = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const has = (k) => rest.includes(k);

const FREEZE = '2026-03-14T15:00:10.000Z';

// ---- PNG codec (playwright-core's bundled pngjs) ----------------------------
function loadPng() {
  for (const d of [resolve(repo, 'node_modules/.pnpm'), resolve(repo, '../../../node_modules/.pnpm'), '/home/kain/onyx/node_modules/.pnpm']) {
    if (!existsSync(d)) continue;
    const hit = readdirSync(d).find((n) => n.startsWith('playwright-core@'));
    if (hit) return createRequire(import.meta.url)(join(d, hit, 'node_modules/playwright-core/lib/utilsBundle')).PNG;
  }
  throw new Error('playwright-core not found in node_modules/.pnpm');
}

// ---- tiers -> jobs ------------------------------------------------------------
const { SET, keyOf } = await import(join(here, 'screens-css-regress.mjs'));
const ALL_VPS = ['se', 'phone', 'promax', 'phone-land', 'fold', 'fold-open', 'tablet', 'tablet-land', 'ipad-pro-land', 'laptop', 'laptop-short', 'desktop', 'fhd', 'ultrawide', 'ultrawide-qhd'];
const tierVps = (t) => (t.vps === 'all' ? ALL_VPS : t.vps);
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

function jobsFor(tierNames) {
  const jobs = [];
  for (const name of tierNames) {
    const t = SET[name];
    if (!t) throw new Error(`unknown tier ${name}; known: ${Object.keys(SET).join(', ')}`);
    const vps = tierVps(t);
    const vpGroups = chunk(vps, name === 'core' ? 3 : 5);
    const scenarios = t.scenarios.map(keyOf);
    const per = 3; // small jobs balance best: the call / gap scenarios are the slow tail
    const slow = (k) => /focus-tour|hover-room|composer-states|^call-/.test(k); // multi-shot / call scenarios: one per job, started first
    const parts = [...scenarios.filter(slow).map((k) => [k]), ...chunk(scenarios.filter((k) => !slow(k)), per)];
    for (const sc of parts) for (const vg of vpGroups) jobs.push({ tier: name, scenarios: sc, vps: vg, full: !!t.full, dpr: t.dpr || 0, slow: sc.length === 1 && slow(sc[0]) });
  }
  jobs.sort((a, b) => Number(b.slow) - Number(a.slow));
  return jobs;
}

// Stable per-job port (a pure function of what the job shoots), so the port
// that appears in invite links is the same in every run.
const portFor = (job) => { let h = 2166136261; for (const c of job.scenarios.join(',') + '@' + job.vps.join(',')) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return 21000 + ((h >>> 0) % 20000) + Number(flag('--port-offset', 0)); };

function runJob(job, out, dist, extraArgs) {
  const args = [join(here, 'screens.mjs'), '--dist', dist, '--out', out, '--extra', join(here, 'screens-css-regress.mjs'),
    '--only', job.scenarios.join(','), '--vp', job.vps.join(','), '--freeze', FREEZE, '--stable', '--port', String(portFor(job)), ...(job.full ? ['--full'] : []), ...(job.dpr ? ['--dpr', String(job.dpr)] : []), ...extraArgs];
  return new Promise((done) => {
    const p = spawn(process.execPath, args, { cwd: repo, env: { ...process.env, TZ: 'UTC', LANG: 'en_US.UTF-8', CSS_REGRESS_OUT: out } });
    let log = '';
    p.stdout.on('data', (d) => { log += d; });
    p.stderr.on('data', (d) => { log += d; });
    p.on('close', (code) => done({ job, code, log }));
  });
}

async function shoot(out) {
  const dist = resolve(repo, flag('--dist', 'elm/dist-elm'));
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`no build at ${dist} — run elm/tools/build.sh`);
  const tiers = (flag('--tier', 'core,sheets,public')).split(',');
  const only = flag('--only', '');
  let jobs = jobsFor(tiers);
  if (only) jobs = jobs.filter((j) => j.scenarios.some((s) => s.includes(only)));
  if (only) jobs = jobs.map((j) => ({ ...j, scenarios: j.scenarios.filter((s) => s.includes(only)) }));
  const nJobs = Number(flag('--jobs', Math.max(4, Math.min(14, Math.floor(cpus().length / 3)))));
  if (!has('--keep')) rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const queue = [...jobs];
  const results = [];
  const started = Date.now();
  await Promise.all(Array.from({ length: Math.min(nJobs, queue.length) }, async () => {
    while (queue.length) {
      const r = await runJob(queue.shift(), out, dist, []);
      results.push(r);
      process.stderr.write(`\r${results.length}/${jobs.length} jobs`);
    }
  }));
  process.stderr.write('\n');
  const problems = results.flatMap((r) => (r.log.match(/^PROBLEM .*$/gm) || []));
  const failed = results.filter((r) => r.code !== 0);
  writeFileSync(join(out, 'shoot.log'), results.map((r) => `# ${r.job.tier} ${r.job.scenarios.join(',')} @ ${r.job.vps.join(',')} exit=${r.code}\n${r.log}`).join('\n'));
  const pngs = readdirSync(out).filter((f) => f.endsWith('.png')).length;
  console.log(`shot ${pngs} PNGs in ${Math.round((Date.now() - started) / 1000)}s -> ${out}; ${problems.length} PROBLEM lines; ${failed.length} failed jobs`);
  for (const p of problems.slice(0, 40)) console.log('  ' + p);
  return { pngs, problems, failed };
}

// ---- diff -------------------------------------------------------------------------
function crop(PNG, src, x, y, w, h) {
  const o = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j += 1) {
    const sy = y + j;
    if (sy < 0 || sy >= src.height) continue;
    for (let i = 0; i < w; i += 1) {
      const sx = x + i;
      if (sx < 0 || sx >= src.width) continue;
      const s = (sy * src.width + sx) * 4; const d = (j * w + i) * 4;
      o.data[d] = src.data[s]; o.data[d + 1] = src.data[s + 1]; o.data[d + 2] = src.data[s + 2]; o.data[d + 3] = src.data[s + 3];
    }
  }
  return o;
}
function shrink(PNG, src, maxW, maxH) {
  const f = Math.max(1, Math.ceil(Math.max(src.width / maxW, src.height / maxH)));
  if (f === 1) return src;
  const w = Math.max(1, Math.floor(src.width / f)); const h = Math.max(1, Math.floor(src.height / f));
  const o = new PNG({ width: w, height: h });
  for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) {
    let r = 0; let g = 0; let b = 0; let a = 0;
    for (let v = 0; v < f; v += 1) for (let u = 0; u < f; u += 1) { const s = ((j * f + v) * src.width + (i * f + u)) * 4; r += src.data[s]; g += src.data[s + 1]; b += src.data[s + 2]; a += src.data[s + 3]; }
    const d = (j * w + i) * 4; const n = f * f;
    o.data[d] = r / n; o.data[d + 1] = g / n; o.data[d + 2] = b / n; o.data[d + 3] = a / n;
  }
  return o;
}
function sideBySide(PNG, panels, gap = 8) {
  const h = Math.max(...panels.map((p) => p.height)); const w = panels.reduce((s, p) => s + p.width, 0) + gap * (panels.length - 1);
  const o = new PNG({ width: w, height: h });
  for (let i = 0; i < o.data.length; i += 4) { o.data[i] = 40; o.data[i + 1] = 40; o.data[i + 2] = 40; o.data[i + 3] = 255; }
  let ox = 0;
  for (const p of panels) {
    for (let j = 0; j < p.height; j += 1) for (let i = 0; i < p.width; i += 1) { const s = (j * p.width + i) * 4; const d = (j * w + ox + i) * 4; o.data[d] = p.data[s]; o.data[d + 1] = p.data[s + 1]; o.data[d + 2] = p.data[s + 2]; o.data[d + 3] = 255; }
    ox += p.width + gap;
  }
  return o;
}

/** Compare two PNG buffers. -> { same, sizeChanged, count, regions[] } */
function comparePngs(PNG, a, b, tol, ignore) {
  const A = PNG.sync.read(a); const B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) return { sizeChanged: [A.width, A.height, B.width, B.height], count: -1, regions: [], A, B };
  const W = A.width; const H = A.height; let count = 0;
  const CELL = 24; const cw = Math.ceil(W / CELL); const ch = Math.ceil(H / CELL);
  const cells = new Uint8Array(cw * ch);
  const mask = new PNG({ width: W, height: H });
  for (let i = 0, p = 0; p < W * H; p += 1, i += 4) {
    const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]), Math.abs(A.data[i + 3] - B.data[i + 3]));
    if (d > tol && !(ignore && ignore[p])) { count += 1; cells[Math.floor(p / W / CELL) * cw + Math.floor((p % W) / CELL)] = 1; mask.data[i] = 255; mask.data[i + 1] = 0; mask.data[i + 2] = 80; mask.data[i + 3] = 255; }
    else { mask.data[i] = A.data[i] >> 2; mask.data[i + 1] = A.data[i + 1] >> 2; mask.data[i + 2] = A.data[i + 2] >> 2; mask.data[i + 3] = 255; }
  }
  if (!count) return { same: true, count: 0, regions: [] };
  // merge flagged cells into regions (8-connected, one extra cell of reach)
  const seen = new Uint8Array(cells.length); const regions = [];
  for (let c = 0; c < cells.length; c += 1) {
    if (!cells[c] || seen[c]) continue;
    const st = [c]; seen[c] = 1; let x0 = cw; let y0 = ch; let x1 = 0; let y1 = 0;
    while (st.length) {
      const k = st.pop(); const cx = k % cw; const cy = Math.floor(k / cw);
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        const nx = cx + dx; const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const n = ny * cw + nx; if (cells[n] && !seen[n]) { seen[n] = 1; st.push(n); }
      }
    }
    regions.push({ x: x0 * CELL, y: y0 * CELL, w: Math.min(W, (x1 + 1) * CELL) - x0 * CELL, h: Math.min(H, (y1 + 1) * CELL) - y0 * CELL });
  }
  regions.sort((p, q) => q.w * q.h - p.w * p.h);
  return { same: false, count, regions, A, B, mask };
}

function diff(baseDir, curDir) {
  const PNG = loadPng();
  const tol = Number(flag('--tolerance', 0));
  const only = flag('--only', '');
  const report = flag('--report', '');
  const skip = (flag('--skip', '') || '').split(',').filter(Boolean);
  // --noise A B: two baseline runs of the SAME build. Pixels where they differ (dilated 3px)
  // are ignored: a shot only fails on changes outside its own flaky regions.
  const ni = rest.indexOf('--noise'); const noiseA = ni >= 0 ? resolve(rest[ni + 1]) : ''; const noiseB = ni >= 0 ? resolve(rest[ni + 2]) : '';
  const noiseMask = (f, W, H) => {
    if (!noiseA || !existsSync(join(noiseA, f)) || !existsSync(join(noiseB, f))) return null;
    const NA = PNG.sync.read(readFileSync(join(noiseA, f))); const NB = PNG.sync.read(readFileSync(join(noiseB, f)));
    if (NA.width !== W || NA.height !== H || NB.width !== W || NB.height !== H) return null;
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      if (NA.data[i] !== NB.data[i] || NA.data[i + 1] !== NB.data[i + 1] || NA.data[i + 2] !== NB.data[i + 2]) {
        for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) { const yy = y + dy; const xx = x + dx; if (yy >= 0 && xx >= 0 && yy < H && xx < W) m[yy * W + xx] = 1; }
      }
    }
    return m;
  };
  const list = (d) => new Set(readdirSync(d).filter((f) => f.endsWith('.png') && (!only || f.includes(only)) && !skip.some((s) => f.startsWith(s))));
  const A = list(baseDir); const B = list(curDir);
  const rows = []; let same = 0;
  if (report) { rmSync(report, { recursive: true, force: true }); mkdirSync(report, { recursive: true }); }
  for (const f of [...A].sort()) {
    if (!B.has(f)) { rows.push({ file: f, kind: 'missing-in-current' }); continue; }
    const bufA = readFileSync(join(baseDir, f)); const bufB = readFileSync(join(curDir, f));
    let r = comparePngs(PNG, bufA, bufB, tol, null);
    if (!r.same && !r.sizeChanged && noiseA) { const mk = noiseMask(f, r.A.width, r.A.height); if (mk) r = comparePngs(PNG, bufA, bufB, tol, mk); }
    if (r.same) { same += 1; continue; }
    if (r.sizeChanged) { rows.push({ file: f, kind: 'size', size: r.sizeChanged }); continue; }
    const row = { file: f, kind: 'pixels', count: r.count, regions: r.regions.slice(0, 6) };
    rows.push(row);
    if (report) {
      row.crops = [];
      r.regions.slice(0, 4).forEach((g, idx) => {
        const pad = 16; const x = Math.max(0, g.x - pad); const y = Math.max(0, g.y - pad);
        const w = Math.min(r.A.width - x, g.w + pad * 2); const h = Math.min(r.A.height - y, g.h + pad * 2);
        const cap = (p) => shrink(PNG, p, 560, 900);
        const img = sideBySide(PNG, [cap(crop(PNG, r.A, x, y, w, h)), cap(crop(PNG, r.B, x, y, w, h)), cap(crop(PNG, r.mask, x, y, w, h))]);
        const name = f.replace(/\.png$/, `.r${idx}.png`);
        writeFileSync(join(report, name), PNG.sync.write(img));
        row.crops.push({ name, x: g.x, y: g.y, w: g.w, h: g.h });
      });
    }
  }
  for (const f of [...B].sort()) if (!A.has(f)) rows.push({ file: f, kind: 'new-in-current' });
  if (report) {
    writeFileSync(join(report, 'report.json'), JSON.stringify({ same, changed: rows }, null, 1));
    writeFileSync(join(report, 'report.html'), `<!doctype html><meta charset=utf-8><title>css-regress report</title><style>body{background:#111;color:#ddd;font:13px system-ui;margin:16px}img{max-width:100%;border:1px solid #333;display:block;margin:4px 0 16px}</style><h1>${rows.length} changed, ${same} identical</h1>${rows.map((r) => `<h3>${r.file} — ${r.kind}${r.count ? ` ${r.count}px` : ''}</h3>${(r.crops || []).map((c) => `<div>${c.name} @${c.x},${c.y} ${c.w}x${c.h} (before | after | diff)</div><img src="${c.name}">`).join('')}`).join('')}`);
  }
  console.log(`identical: ${same}   changed: ${rows.length}`);
  for (const r of rows) {
    if (r.kind === 'pixels') console.log(`  DIFF ${r.file}: ${r.count}px in ${r.regions.length} region(s) e.g. ${r.regions[0].x},${r.regions[0].y} ${r.regions[0].w}x${r.regions[0].h}`);
    else if (r.kind === 'size') console.log(`  SIZE ${r.file}: ${r.size[0]}x${r.size[1]} -> ${r.size[2]}x${r.size[3]}`);
    else console.log(`  ${r.kind.toUpperCase()} ${r.file}`);
  }
  if (report) console.log(`report: ${report}/report.html`);
  return rows.length;
}

// ---- commands ---------------------------------------------------------------------------
if (cmd === 'shoot') {
  const out = resolve(flag('--out', ''));
  if (!flag('--out', '')) { console.error('shoot needs --out DIR'); process.exit(2); }
  const r = await shoot(out);
  process.exit(r.failed.length ? 1 : 0);
} else if (cmd === 'diff') {
  const valueFlags = ['--report', '--tolerance', '--only', '--skip', '--noise'];
  const positional = rest.filter((x, i) => !x.startsWith('--') && !valueFlags.includes(rest[i - 1]) && !(rest[i - 2] === '--noise'));
  const [a, b] = positional;
  if (!a || !b) { console.error('usage: css-regress.mjs diff BASE CUR [--report DIR] [--tolerance N] [--only substr] [--skip prefix,prefix] [--noise A B]'); process.exit(2); }
  process.exit(diff(resolve(a), resolve(b)) ? 1 : 0);
} else if (cmd === 'noise') {
  const out = resolve(flag('--out', '/tmp/css-regress-noise'));
  await shoot(`${out}-a`);
  await shoot(`${out}-b`);
  process.exit(diff(`${out}-a`, `${out}-b`) ? 1 : 0);
} else if (cmd === 'list') {
  let total = 0;
  for (const [name, t] of Object.entries(SET)) {
    const n = t.scenarios.length * tierVps(t).length; total += name === 'seam' ? 0 : n;
    console.log(`${name.padEnd(7)} ${String(t.scenarios.length).padStart(3)} scenarios x ${String(tierVps(t).length).padStart(2)} viewports = ${String(n).padStart(4)} shots${t.full ? ' (full page)' : ''}${name === 'seam' ? ' (opt-in)' : ''}`);
    if (has('-v')) console.log('        ' + t.scenarios.map(keyOf).join(' '));
  }
  console.log(`default run (core,sheets,public): ${total} shots (+ extra state shots)`);
} else {
  console.error('usage: css-regress.mjs shoot|diff|noise|list   (see the README comment at the top of this file)');
  process.exit(2);
}
