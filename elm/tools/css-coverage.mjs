#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * css-coverage.mjs — list CSS classes the Elm views use that NO stylesheet
 * styles (app.css + css/*.css), optionally only for given view files.
 *
 *   node tools/css-coverage.mjs                 # all views, summary
 *   node tools/css-coverage.mjs src/View/Inbox.elm --list
 *
 * Also reports var(--x) references in the Elm CSS whose custom property
 * is never defined (a silently-broken rule). Exit 1 if --strict and any
 * class or var is missing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const list = args.includes('--list');
const strict = args.includes('--strict');
const files = args.filter((a) => !a.startsWith('--'));
const views = files.length
  ? files.map((f) => join(root, f))
  : [join(root, 'src/View.elm'), ...readdirSync(join(root, 'src/View')).filter((f) => f.endsWith('.elm')).map((f) => join(root, 'src/View', f))];

const css = [join(root, 'app.css'), ...readdirSync(join(root, 'css')).filter((f) => f.endsWith('.css')).map((f) => join(root, 'css', f))]
  .map((f) => readFileSync(f, 'utf8')).join('\n');
const styled = new Set();
for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) styled.add(m[1]);

const used = new Map();
for (const f of views) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/class(?:List)? "([^"]*)"|\( "([a-zA-Z][\w -]*)", (?:True|False|[a-z])/g)) {
    for (const c of (m[1] ?? m[2] ?? '').split(/\s+/).filter(Boolean)) {
      if (!used.has(c)) used.set(c, f.replace(root, ''));
    }
  }
}
const missing = [...used].filter(([c]) => !styled.has(c));
const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const undefinedVars = [...new Set([...css.matchAll(/var\((--[\w-]+)\s*\)/g)].map((m) => m[1]))].filter((v) => !defined.has(v));

console.log(`classes used: ${used.size}, unstyled: ${missing.length}, undefined vars (no fallback): ${undefinedVars.length}`);
if (list) {
  for (const [c, f] of missing) console.log(`  .${c}\t${f}`);
  for (const v of undefinedVars) console.log(`  var(${v}) undefined`);
}
if (strict && (missing.length || undefinedVars.length)) process.exit(1);
