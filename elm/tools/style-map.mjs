#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * style-map.mjs — exhaustive, machine-generated map of the Elm client's
 * visual system: every stylesheet (in index.html load order), every rule,
 * custom property (CSS + theme maps + runtime writers), var() use, hard-coded
 * value, duplicate / conflicting selector, !important, dead rule, z-index,
 * breakpoint, transition / animation, accent use, and the type / spacing /
 * radius / elevation scales actually in use.
 *
 *   node elm/tools/style-map.mjs                       # writes both outputs
 *   node elm/tools/style-map.mjs --json OUT.json       # override JSON path
 *   node elm/tools/style-map.mjs --md OUT.md           # override MD path
 *   node elm/tools/style-map.mjs --no-md               # JSON only
 *
 * Outputs (defaults):
 *   elm/design/style-map.json   — the full machine-readable map
 *   elm/design/STYLE_MAP.md     — the generated inventory is written between
 *       <!-- BEGIN GENERATED STYLE INVENTORY --> / <!-- END GENERATED ... -->
 *       markers; hand-written analysis outside the markers is preserved.
 *
 * Read-only over the app: parses app.css + css/*.css (dependency-free CSS
 * tokenizer; no nesting is used in this codebase), src/**\/*.elm string
 * literals (classes, data-* attributes, inline styles), ports.js (runtime
 * custom properties, root data-* attributes) and src/ThemeTokens.elm (the 18
 * built-in theme token maps committed inline onto <html> by appearanceApply).
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const jsonOut = opt('--json', join(root, 'design/style-map.json'));
const mdOut = args.includes('--no-md') ? null : opt('--md', join(root, 'design/STYLE_MAP.md'));
const rel = (p) => relative(root, p);

// ───────────────────────────── 1. sources ──────────────────────────────

const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const linkOrder = [...indexHtml.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
const cssOnDisk = ['app.css', ...readdirSync(join(root, 'css')).filter((f) => f.endsWith('.css')).map((f) => `css/${f}`)];
const notLinked = cssOnDisk.filter((f) => !linkOrder.includes(f));
const missingOnDisk = linkOrder.filter((f) => !cssOnDisk.includes(f));
const cssFiles = [...linkOrder.filter((f) => cssOnDisk.includes(f)), ...notLinked];
const orderOf = new Map(cssFiles.map((f, i) => [f, i]));

function walk(dir, ext) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (n.endsWith(ext)) out.push(p);
  }
  return out.sort();
}
const elmFiles = walk(join(root, 'src'), '.elm');
const portsJs = readFileSync(join(root, 'ports.js'), 'utf8');
const mediaTs = existsSync(join(root, 'media')) ? walk(join(root, 'media'), '.ts').map((f) => readFileSync(f, 'utf8')).join('\n') : '';

// ───────────────────────────── 2. CSS parser ───────────────────────────

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (off) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

/** Blank out comments (newlines kept, so offsets and lines survive). */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const comments = [];
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      comments.push({ start: i, text: src.slice(i, stop) });
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return { text: out, comments };
}

/** Scan from i to the first stop char at paren/bracket depth 0, skipping strings. */
function scanUntil(src, i, end, stops) {
  let depth = 0;
  while (i < end) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < end && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      i = j + 1;
      continue;
    }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && stops.includes(c)) return { pos: i, ch: c };
    i++;
  }
  return { pos: end, ch: null };
}

function matchBrace(src, open, end) {
  let depth = 0;
  for (let i = open; i < end; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < end && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      i = j;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return end;
}

/** Split on a char at depth 0 (parens, brackets, strings respected). */
function splitTop(s, sep) {
  const parts = [];
  let depth = 0, cur = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i] ?? ''; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function parseDecls(src, start, end, lineOf) {
  const decls = [];
  let i = start;
  while (i < end) {
    const { pos } = scanUntil(src, i, end, [';']);
    const chunk = src.slice(i, pos);
    const colon = chunk.indexOf(':');
    if (colon > 0) {
      const lead = chunk.length - chunk.trimStart().length;
      const prop = chunk.slice(0, colon).trim();
      let value = chunk.slice(colon + 1).trim().replace(/\s+/g, ' ');
      let important = false;
      const imp = value.match(/\s*!\s*important\s*$/i);
      if (imp) { important = true; value = value.slice(0, imp.index).trim(); }
      if (prop && /^[-a-zA-Z]/.test(prop)) decls.push({ prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value, important, line: lineOf(i + lead) });
    }
    i = pos + 1;
  }
  return decls;
}

function parseCss(file) {
  const raw = readFileSync(join(root, file), 'utf8');
  const { text: src, comments } = stripComments(raw);
  const lineOf = lineIndex(src);
  const rules = [];
  const atrules = [];
  const keyframes = [];
  function block(start, end, ctx) {
    let i = start;
    while (i < end) {
      while (i < end && /\s/.test(src[i])) i++;
      if (i >= end) break;
      if (src[i] === '}') { i++; continue; }
      if (src[i] === '@') {
        const { pos, ch } = scanUntil(src, i, end, ['{', ';']);
        const prelude = src.slice(i, pos).trim().replace(/\s+/g, ' ');
        const name = (prelude.match(/^@([\w-]+)/) || [, ''])[1].toLowerCase();
        if (ch !== '{') { atrules.push({ file, line: lineOf(i), name, prelude, ctx: [...ctx], statement: true }); i = pos + 1; continue; }
        const close = matchBrace(src, pos, end);
        atrules.push({ file, line: lineOf(i), name, prelude, ctx: [...ctx] });
        if (/keyframes$/.test(name)) {
          const kname = prelude.replace(/^@[\w-]+\s+/, '').trim();
          const frames = [];
          let j = pos + 1;
          while (j < close) {
            const r = scanUntil(src, j, close, ['{']);
            if (r.ch !== '{') break;
            const sel = src.slice(j, r.pos).trim();
            const c2 = matchBrace(src, r.pos, close);
            frames.push({ selector: sel, line: lineOf(j), decls: parseDecls(src, r.pos + 1, c2, lineOf) });
            j = c2 + 1;
          }
          keyframes.push({ file, line: lineOf(i), name: kname, ctx: [...ctx], frames });
        } else if (['media', 'supports', 'container', 'layer', 'document', 'scope', 'starting-style'].includes(name)) {
          block(pos + 1, close, [...ctx, prelude]);
        } else {
          rules.push({ file, line: lineOf(i), selector: prelude, ctx: [...ctx], decls: parseDecls(src, pos + 1, close, lineOf), atBlock: name });
        }
        i = close + 1;
        continue;
      }
      const { pos, ch } = scanUntil(src, i, end, ['{', ';', '}']);
      if (ch !== '{') { i = pos + 1; continue; }
      const selector = src.slice(i, pos).trim().replace(/\s+/g, ' ');
      const close = matchBrace(src, pos, end);
      rules.push({ file, line: lineOf(i), endLine: lineOf(close), selector, ctx: [...ctx], decls: parseDecls(src, pos + 1, close, lineOf) });
      i = close + 1;
    }
  }
  block(0, src.length, []);
  const header = (comments[0] && comments[0].start < 120 ? comments[0].text : '')
    .replace(/^\/\*\s*|\s*\*\/$/g, '').replace(/SPDX[^\n]*\n?/, '').trim();
  const header2 = (!header && comments[1] && comments[1].start < 200 ? comments[1].text : '').replace(/^\/\*\s*|\s*\*\/$/g, '').trim();
  return { file, raw, bytes: Buffer.byteLength(raw), lines: raw.split('\n').length, rules, atrules, keyframes, header: header || header2, comments, lineOf };
}

const sheets = cssFiles.map(parseCss);
const allRules = [];
for (const s of sheets) for (const r of s.rules) { r.order = orderOf.get(s.file); allRules.push(r); }
allRules.forEach((r, i) => { r.id = i; });
const ctxKey = (ctx) => ctx.join(' && ');
const ruleAt = new Map(allRules.map((r) => [`${r.file}:${r.line}`, r]));

// ───────────────────────────── 3. selector analysis ────────────────────

/** Remove quoted strings (attribute values) so dots/brackets inside cannot confuse class scans. */
const unquote = (s) => s.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');

/** Find the matching ')' for an index just after '('. */
function closeParen(s, i) {
  let d = 1;
  for (; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')') { d--; if (d === 0) return i; } }
  return s.length;
}

function cmpSpec(x, y) { return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; }
function specificity(sel) {
  let a = 0, b = 0, c = 0;
  const s = unquote(sel);
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '#') { a++; i++; while (i < s.length && /[\w-]/.test(s[i])) i++; continue; }
    if (ch === '.') { b++; i++; while (i < s.length && /[\w-]/.test(s[i])) i++; continue; }
    if (ch === '[') { b++; i = s.indexOf(']', i) + 1 || s.length; continue; }
    if (ch === ':') {
      const isEl = s[i + 1] === ':';
      i += isEl ? 2 : 1;
      let name = '';
      while (i < s.length && /[\w-]/.test(s[i])) name += s[i++];
      name = name.toLowerCase();
      if (s[i] === '(') {
        const end = closeParen(s, i + 1);
        const inner = s.slice(i + 1, end);
        i = end + 1;
        if (name === 'where') continue;
        if (['is', 'not', 'has', 'matches', '-webkit-any'].includes(name)) {
          let best = [0, 0, 0];
          for (const part of splitTop(inner, ',')) { const sp = specificity(part); if (cmpSpec(sp, best) > 0) best = sp; }
          a += best[0]; b += best[1]; c += best[2];
          continue;
        }
        if (/^nth-/.test(name) && / of /.test(inner)) {
          let best = [0, 0, 0];
          for (const part of splitTop(inner.split(/ of /)[1], ',')) { const sp = specificity(part); if (cmpSpec(sp, best) > 0) best = sp; }
          a += best[0]; b += best[1] + 1; c += best[2];
          continue;
        }
        if (isEl) c++; else b++;
        continue;
      }
      if (isEl || ['before', 'after', 'first-line', 'first-letter'].includes(name)) c++; else b++;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) { c++; while (i < s.length && /[\w-]/.test(s[i])) i++; continue; }
    i++;
  }
  return [a, b, c];
}

/** Classes / ids outside :not(), plus :is/:where/:has alternative groups. */
function selectorParts(sel) {
  const s = unquote(sel);
  const out = { classes: [], ids: [], groups: [], negated: [] };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '.' && /[-_a-zA-Z]/.test(s[i + 1] || '')) {
      let j = i + 1; while (j < s.length && /[\w-]/.test(s[j])) j++;
      out.classes.push(s.slice(i + 1, j)); i = j; continue;
    }
    if (ch === '#' && /[-_a-zA-Z]/.test(s[i + 1] || '')) {
      let j = i + 1; while (j < s.length && /[\w-]/.test(s[j])) j++;
      out.ids.push(s.slice(i + 1, j)); i = j; continue;
    }
    if (ch === '[') { i = s.indexOf(']', i) + 1 || s.length; continue; }
    if (ch === ':') {
      i += s[i + 1] === ':' ? 2 : 1;
      let name = '';
      while (i < s.length && /[\w-]/.test(s[i])) name += s[i++];
      if (s[i] === '(') {
        const end = closeParen(s, i + 1);
        const inner = s.slice(i + 1, end);
        i = end + 1;
        if (name === 'not') { out.negated.push(inner); continue; }
        if (['is', 'where', 'has', 'matches'].includes(name)) out.groups.push(splitTop(inner, ',').map((p) => p.trim()));
      }
      continue;
    }
    i++;
  }
  return out;
}

function attrList(sel) {
  const res = [];
  for (const m of sel.matchAll(/\[\s*([\w:-]+)\s*(?:([~|^$*]?=)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\]\s]+)\s*(?:[is])?)?\s*\]/g)) {
    res.push({ name: m[1].toLowerCase(), op: m[2] || null, value: m[3] ? m[3].replace(/^["']|["']$/g, '') : null });
  }
  return res;
}

/** The rightmost compound selector (the element the rule paints). */
function keyCompound(sel) {
  let s = unquote(sel);
  // drop functional pseudo contents so their spaces don't split compounds
  s = s.replace(/:(not|is|where|has|nth-[\w-]+)\((?:[^()]|\([^()]*\))*\)/g, ':$1()');
  const parts = splitTop(s.replace(/\s*([>+~])\s*/g, ' '), ' ').filter(Boolean);
  return parts[parts.length - 1] || '';
}
function keyClasses(sel) {
  return [...keyCompound(sel).matchAll(/\.([-_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
}

// ───────────────────────────── 4. Elm / ports literals ────────────────

/** Elm string literals with their line numbers (comments / chars skipped). */
function elmLiterals(src) {
  const lits = [];
  const lineOf = lineIndex(src);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '-' && src[i + 1] === '-') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '{' && src[i + 1] === '-') {
      let d = 1; i += 2;
      while (i < n && d > 0) {
        if (src[i] === '{' && src[i + 1] === '-') { d++; i += 2; continue; }
        if (src[i] === '-' && src[i + 1] === '}') { d--; i += 2; continue; }
        i++;
      }
      continue;
    }
    if (c === "'") {
      if (src[i + 1] === '\\') { const e = src.indexOf("'", i + 2); i = e < 0 ? n : e + 1; } else i += 3;
      continue;
    }
    if (c === '"') {
      if (src.startsWith('"""', i)) {
        const e = src.indexOf('"""', i + 3);
        lits.push({ value: src.slice(i + 3, e), line: lineOf(i), off: i, end: e + 3 });
        i = e + 3;
        continue;
      }
      let j = i + 1, v = '';
      while (j < n && src[j] !== '"') { if (src[j] === '\\') { v += src[j + 1]; j += 2; continue; } v += src[j]; j++; }
      lits.push({ value: v, line: lineOf(i), off: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    i++;
  }
  return lits;
}

const literalTokens = new Map(); // token -> first {file,line}
const literalSet = new Set();
const dynamicPrefixes = new Map(); // prefix -> first {file,line}
const classAttrUse = new Map(); // class -> [{file,line}] used in class/classList context
const elmInlineStyles = [];
const elmDataAttrs = new Map(); // data-x -> Set(values)
const tokenRe = /^-?[_a-zA-Z][\w-]*$/;

for (const f of elmFiles) {
  const src = readFileSync(f, 'utf8');
  const lits = elmLiterals(src);
  const file = rel(f);
  for (let k = 0; k < lits.length; k++) {
    const L = lits[k];
    for (const tok of L.value.split(/\s+/).filter(Boolean)) {
      if (!tokenRe.test(tok)) continue;
      literalSet.add(tok);
      if (!literalTokens.has(tok)) literalTokens.set(tok, { file, line: L.line });
    }
    const before = src.slice(Math.max(0, L.off - 60), L.off);
    const isClassCtx = /\bclass\s*$/.test(before) || /\bclass\s*\(\s*$/.test(before) || /\bclass\s*\((?:[^()\n]|\([^()\n]*\))*$/.test(before)
      || (/\(\s*$/.test(before) && /\bclassList\s*\[[^\]]*$/.test(src.slice(Math.max(0, L.off - 600), L.off))) || /\bjoin\s*$/.test(before);
    // Dynamic class prefixes: a literal ending in "-"/"_" concatenated with `++`, in a
    // class expression or a binding whose name says class (generic "onyx-" needs a class expression).
    const lastTok = L.value.split(/\s+/).filter(Boolean).pop() || '';
    if (/[-_]$/.test(lastTok) && tokenRe.test(lastTok) && lastTok.length > 2 && /^\s*\+\+/.test(src.slice(L.end, L.end + 8))) {
      const near = src.slice(Math.max(0, L.off - 300), L.off);
      if (isClassCtx || (lastTok.length > 6 && /[cC]lass\w*\s*(?:\w+\s*)*=\s*(?:\n\s*)?(?:[^=\n]*)$/.test(near))) {
        if (!dynamicPrefixes.has(lastTok)) dynamicPrefixes.set(lastTok, { file, line: L.line });
      }
    }
    if (isClassCtx) {
      for (const tok of L.value.split(/\s+/).filter((t) => tokenRe.test(t))) {
        if (!classAttrUse.has(tok)) classAttrUse.set(tok, []);
        classAttrUse.get(tok).push({ file, line: L.line });
      }
    }
    if (/\bstyle\s*$/.test(before) && /^[-a-z]+$/.test(L.value)) {
      const next = lits[k + 1];
      const gap = next ? src.slice(L.end, next.off) : '';
      let expr = src.slice(L.end, L.end + 200).split('\n')[0].trim();
      { let d = 0, k2 = 0; for (; k2 < expr.length; k2++) { const ch = expr[k2]; if (ch === '(' || ch === '[') d++; else if (ch === ')' || ch === ']') { if (d === 0) break; d--; } else if (ch === ',' && d === 0) break; } expr = expr.slice(0, k2).trim(); }
      const lit = next && /^\s*$/.test(gap) ? JSON.stringify(next.value) : expr;
      elmInlineStyles.push({ file, line: L.line, prop: L.value, value: lit });
    }
    if (/^data-[\w-]+$/.test(L.value) && /attribute\s*$/.test(before)) {
      if (!elmDataAttrs.has(L.value)) elmDataAttrs.set(L.value, new Set());
      const next = lits[k + 1];
      if (next && /^\s*$/.test(src.slice(L.end, next.off))) elmDataAttrs.get(L.value).add(next.value);
    }
  }
}
// ports.js / media literals and DOM writes
const jsLits = new Set();
for (const m of (portsJs + '\n' + mediaTs).matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)) {
  for (const tok of (m[1] ?? m[2] ?? '').split(/\s+/)) if (tokenRe.test(tok)) jsLits.add(tok);
}
const jsDataset = new Set([...portsJs.matchAll(/\.dataset\.([a-zA-Z]+)\s*=/g)].map((m) => 'data-' + m[1].replace(/[A-Z]/g, (x) => '-' + x.toLowerCase())));
for (const m of portsJs.matchAll(/setAttribute\(\s*"(data-[\w-]+)"/g)) jsDataset.add(m[1]);
const jsRuntimeProps = new Map();
for (const m of portsJs.matchAll(/setProperty\(\s*("--[\w-]+"|prop)/g)) {
  const line = portsJs.slice(0, m.index).split('\n').length;
  const name = m[1] === 'prop' ? '(theme token map)' : m[1].slice(1, -1);
  if (!jsRuntimeProps.has(name)) jsRuntimeProps.set(name, []);
  jsRuntimeProps.get(name).push({ file: 'ports.js', line });
}

const isClassLive = (c) => {
  if (literalSet.has(c) || jsLits.has(c)) return 'literal';
  for (const p of dynamicPrefixes.keys()) if (c.startsWith(p) && c.length > p.length) return 'dynamic:' + p;
  return null;
};

const STD_DATA = new Set(['data-kb', 'data-theme']);
const isAttrLive = (a) => {
  if (!a.name.startsWith('data-')) return true;
  if (elmDataAttrs.has(a.name) || jsDataset.has(a.name) || literalSet.has(a.name) || jsLits.has(a.name) || STD_DATA.has(a.name)) {
    if (a.value === null) return true;
    if (/^\d+(\.\d+)?$/.test(a.value)) return true;
    if (literalSet.has(a.value) || jsLits.has(a.value)) return true;
    return /^(true|false|open|closed)$/.test(a.value) ? true : 'value';
  }
  return false;
};

function selDeadReason(sel) {
  const p = selectorParts(sel);
  const dead = [];
  for (const c of p.classes) if (!isClassLive(c)) dead.push('.' + c);
  for (const id of p.ids) if (!literalSet.has(id) && !jsLits.has(id) && id !== 'app') dead.push('#' + id);
  for (const g of p.groups) {
    const reasons = g.map((alt) => selDeadReason(alt));
    if (reasons.every((r) => r.dead.length)) dead.push(`:is(${reasons.map((r) => r.dead.join('')).join('|')})`);
  }
  const attrDead = [];
  for (const a of attrList(sel.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, ''))) {
    const live = isAttrLive(a);
    if (live === false) dead.push(`[${a.name}]`);
    else if (live === 'value') attrDead.push(`[${a.name}="${a.value}"]`);
  }
  return { dead, attrDead };
}

// ───────────────────────────── 5. theme token maps ─────────────────────

const themeSrc = readFileSync(join(root, 'src/ThemeTokens.elm'), 'utf8');
const themeMaps = {};
for (const m of themeSrc.matchAll(/^ {8}"([\w-]+)" ->\s*\n\s*Dict\.fromList\s*\n([\s\S]*?)\n\s*\]/gm)) {
  themeMaps[m[1]] = {};
  for (const t of m[2].matchAll(/\(\s*"(--[\w-]+)",\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) themeMaps[m[1]][t[1]] = t[2];
}
const themeTokenNames = new Set(Object.values(themeMaps).flatMap((o) => Object.keys(o)));
const themeLookSrc = readFileSync(join(root, 'src/ThemeLook.elm'), 'utf8');
const themeSchemes = Object.fromEntries([...themeLookSrc.matchAll(/id = "([\w-]+)", label = "([^"]*)",[^}]*?scheme = "(\w+)"/g)].map((m) => [m[1], { label: m[2], scheme: m[3] }]));
const studioSrc = readFileSync(join(root, 'src/Studio.elm'), 'utf8');
const studioEditable = [...new Set([...studioSrc.matchAll(/(?:colorToken|property =)\s*"(--[\w-]+)"/g)].map((m) => m[1]))];

// ───────────────────────────── 6. value scanners ───────────────────────

const NAMED = 'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen canvas canvastext linktext visitedtext activetext buttonface buttontext buttonborder field fieldtext highlight highlighttext selecteditem selecteditemtext mark marktext graytext accentcolor accentcolortext'.split(' ');
const NAMED_RE = new RegExp(`(?<![\\w-])(${NAMED.join('|')})(?![\\w-])`, 'gi');
const COLOR_PROPS = /^(--|color$|background|border|outline|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|text-decoration|column-rule|filter|scrollbar-color|-webkit-tap-highlight-color|-webkit-text-fill-color|text-emphasis-color|flood-color|stop-color|lighting-color)/;

const stripUrls = (v) => v.replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/g, 'url()');

/** Replace each var(...) by VAR, returning {stripped, vars:[{name,fallback}]}. */
function extractVars(v) {
  const vars = [];
  let out = '';
  let i = 0;
  while (i < v.length) {
    if (v.startsWith('var(', i) && !/[\w-]/.test(v[i - 1] || '')) {
      const end = closeParen(v, i + 4);
      const inner = v.slice(i + 4, end);
      const comma = splitTop(inner, ',');
      const name = comma[0].trim();
      const fallback = comma.length > 1 ? comma.slice(1).join(',').trim() : null;
      vars.push({ name, fallback });
      if (fallback) for (const nv of extractVars(fallback).vars) vars.push({ ...nv, nested: true });
      out += 'VAR';
      i = end + 1;
      continue;
    }
    out += v[i++];
  }
  return { stripped: out, vars };
}

function findColors(v) {
  const res = [];
  for (const m of v.matchAll(/#[0-9a-fA-F]{3,8}(?![\w-])/g)) res.push(m[0].toLowerCase());
  for (const m of v.matchAll(/(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi)) {
    const end = closeParen(v, m.index + m[0].length);
    res.push(v.slice(m.index, end + 1).replace(/\s+/g, ' '));
  }
  // named colours, excluding the "in oklab" colour-space keyword of color-mix()
  for (const m of v.replace(/\bin (oklab|oklch|srgb|lab|lch|hsl|hwb|xyz)\b/g, '').matchAll(NAMED_RE)) res.push(m[1].toLowerCase());
  return res;
}

const REM = 16;
function toPx(len) {
  const m = String(len).trim().match(/^(-?\d*\.?\d+)(px|rem)$/);
  if (!m) return null;
  return +(m[2] === 'rem' ? parseFloat(m[1]) * REM : parseFloat(m[1])).toFixed(2);
}

// ───────────────────────────── 7. token defs / uses ────────────────────

const tokenDefs = new Map(); // name -> [{file,line,selector,ctx,value}]
const tokenUses = new Map(); // name -> [{file,line,selector,prop,fallback}]
const declRows = []; // flattened declarations for every inventory
for (const r of allRules) {
  for (const d of r.decls) {
    const row = { file: r.file, line: d.line, selector: r.selector, ctx: ctxKey(r.ctx), prop: d.prop, value: d.value, important: d.important, rule: r.id, order: r.order };
    declRows.push(row);
    if (d.prop.startsWith('--')) {
      if (!tokenDefs.has(d.prop)) tokenDefs.set(d.prop, []);
      tokenDefs.get(d.prop).push({ file: r.file, line: d.line, selector: r.selector, ctx: ctxKey(r.ctx), value: d.value });
    }
    for (const v of extractVars(d.value).vars) {
      if (!tokenUses.has(v.name)) tokenUses.set(v.name, []);
      tokenUses.get(v.name).push({ file: r.file, line: d.line, selector: r.selector, prop: d.prop, fallback: v.fallback, nested: !!v.nested });
    }
  }
}
for (const k of sheets.flatMap((s) => s.keyframes)) for (const fr of k.frames) for (const d of fr.decls) {
  for (const v of extractVars(d.value).vars) {
    if (!tokenUses.has(v.name)) tokenUses.set(v.name, []);
    tokenUses.get(v.name).push({ file: k.file, line: d.line, selector: `@keyframes ${k.name} ${fr.selector}`, prop: d.prop, fallback: v.fallback });
  }
}
const elmTokenWrites = elmInlineStyles.filter((s) => s.prop.startsWith('--'));
for (const s of elmInlineStyles) for (const v of (/^"/.test(s.value) ? extractVars(JSON.parse(s.value)).vars : [])) {
  if (!tokenUses.has(v.name)) tokenUses.set(v.name, []);
  tokenUses.get(v.name).push({ file: s.file, line: s.line, selector: '(Elm inline style)', prop: s.prop, fallback: v.fallback });
}
const runtimeTokens = new Map();
for (const s of elmTokenWrites) { if (!runtimeTokens.has(s.prop)) runtimeTokens.set(s.prop, []); runtimeTokens.get(s.prop).push({ file: s.file, line: s.line, by: 'Elm inline style', value: s.value }); }
for (const [name, locs] of jsRuntimeProps) if (name.startsWith('--')) for (const l of locs) { if (!runtimeTokens.has(name)) runtimeTokens.set(name, []); runtimeTokens.get(name).push({ ...l, by: 'ports.js setProperty' }); }

const allTokenNames = [...new Set([...tokenDefs.keys(), ...tokenUses.keys(), ...themeTokenNames, ...runtimeTokens.keys()])].sort();
const tokens = allTokenNames.map((name) => {
  const defs = tokenDefs.get(name) || [];
  const uses = tokenUses.get(name) || [];
  const themes = Object.fromEntries(Object.entries(themeMaps).filter(([, m]) => name in m).map(([id, m]) => [id, m[name]]));
  const runtime = runtimeTokens.get(name) || [];
  let status = 'ok';
  if (!defs.length && !Object.keys(themes).length && !runtime.length) status = uses.some((u) => !u.fallback) ? 'UNDEFINED' : 'undefined-with-fallback';
  else if (!defs.length && Object.keys(themes).length) status = uses.length ? 'theme-only' : 'theme-only, unused';
  else if (!uses.length) status = Object.keys(themes).length ? 'theme-overridden, unused' : 'unused';
  else if (Object.keys(themes).length) status = 'theme-overridden';
  else if (runtime.length) status = 'runtime-written';
  return { name, status, defs, themes, runtime, useCount: uses.length, uses };
});

// ───────────────────────────── 8. hard-coded inventories ───────────────

const hard = { color: [], colorFallback: [], colorMix: [], fontSize: [], lineHeight: [], fontWeight: [], fontFamily: [], radius: [], shadow: [], zIndex: [], duration: [], easing: [], spacing: [], dimension: [], opacity: [] };
const ROOT_TOKEN_SCOPE = /^(:root|html)\b/;
const spaceProps = /^(padding|margin|gap|row-gap|column-gap|grid-gap|padding-[\w-]+|margin-[\w-]+|scroll-padding[\w-]*|scroll-margin[\w-]*|inset|inset-[\w-]+)$/;
const dimProps = /^(width|height|min-width|min-height|max-width|max-height|inline-size|block-size|min-inline-size|max-inline-size|min-block-size|max-block-size|flex-basis|top|right|bottom|left|border-width|border-[\w-]+-width|outline-width|outline-offset|letter-spacing|grid-template-columns|grid-template-rows|grid-auto-rows|grid-auto-columns)$/;
const rawNum = /(?<![\w.-])-?\d*\.?\d+(px|rem|em|%|vh|vw|dvh|svh|lvh|ch|ex|pt)?(?![\w-])/;

for (const row of declRows) {
  const vNoUrl = stripUrls(row.value);
  const { stripped, vars } = extractVars(vNoUrl);
  const where = { file: row.file, line: row.line, selector: row.selector, prop: row.prop, ctx: row.ctx };
  const p = row.prop;
  if (COLOR_PROPS.test(p)) {
    for (const c of findColors(stripped)) hard.color.push({ ...where, value: c, tokenDef: p.startsWith('--'), rootToken: p.startsWith('--') && ROOT_TOKEN_SCOPE.test(row.selector) });
    for (const v of vars) if (v.fallback) for (const c of findColors(extractVars(v.fallback).stripped)) hard.colorFallback.push({ ...where, token: v.name, value: c });
  }
  if (p === 'font-size' || p === 'font') {
    if (!(p === 'font' && /^(inherit|initial|unset)$/.test(row.value))) hard.fontSize.push({ ...where, value: row.value, tokenized: /var\(--text-/.test(row.value) && !rawNum.test(stripped.replace(/\d+(\.\d+)?(?=\s*\/)/, '')) || /^(inherit|1em|100%)$/.test(row.value) });
  }
  if (p === 'line-height') hard.lineHeight.push({ ...where, value: row.value, tokenized: /var\(--leading-/.test(row.value) || /^(inherit|normal|1)$/.test(row.value) });
  if (p === 'font-weight') hard.fontWeight.push({ ...where, value: row.value });
  if (p === 'font-family') hard.fontFamily.push({ ...where, value: row.value, tokenized: /var\(--font/.test(row.value) || row.value === 'inherit' });
  if (/^border(-[a-z]+)*-radius$/.test(p)) hard.radius.push({ ...where, value: row.value, tokenized: /VAR/.test(stripped) && !rawNum.test(stripped.replace(/(?<![\w.])0(?![\w.])/g, '')) || /^(0|inherit)$/.test(row.value) });
  if (p === 'box-shadow' || p === 'text-shadow' || (p === 'filter' && /drop-shadow/.test(row.value)) || /^--elev/.test(p)) hard.shadow.push({ ...where, value: row.value, tokenized: /^var\(--elev-\d\)$/.test(row.value.trim()) || /^(none|inherit)$/.test(row.value) });
  if (p === 'z-index') hard.zIndex.push({ ...where, value: row.value });
  if (/^(transition|animation)/.test(p) && !/^(transition|animation)-(property|name|fill-mode|iteration-count|direction|play-state|timeline|range|behavior|composition)/.test(p)) {
    const durs = [...stripped.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)(?![\w-])/g)].map((m) => m[0]);
    hard.duration.push({ ...where, value: row.value, hardDurations: durs, tokenDurations: vars.filter((v) => /^--dur/.test(v.name)).map((v) => v.name) });
    const eas = [...stripped.matchAll(/cubic-bezier\([^)]*\)|steps\([^)]*\)|\b(ease-in-out|ease-in|ease-out|ease|linear)\b/g)].map((m) => m[0]);
    if (eas.length) hard.easing.push({ ...where, value: eas.join(', ') });
  }
  if (spaceProps.test(p)) {
    const parts = splitTop(stripped, ' ').filter(Boolean);
    const raw = parts.filter((x) => rawNum.test(x) && !/^-?0+(\.0+)?(px|rem|em|%)?$/.test(x));
    hard.spacing.push({ ...where, value: row.value, raw, tokenized: raw.length === 0 });
  }
  if (dimProps.test(p)) {
    const nums = [...stripped.matchAll(/(?<![\w.-])-?\d*\.?\d+(px|rem)(?![\w-])/g)].map((m) => m[0]).filter((x) => !/^-?0+(\.0+)?(px|rem)$/.test(x));
    if (nums.length) hard.dimension.push({ ...where, value: row.value, raw: nums });
  }
  if (p === 'opacity') hard.opacity.push({ ...where, value: row.value });
  for (const mm of vNoUrl.matchAll(/color-mix\(/g)) {
    const endm = closeParen(vNoUrl, mm.index + 10);
    const expr = vNoUrl.slice(mm.index, endm + 1).replace(/\s+/g, ' ');
    hard.colorMix.push({ ...where, value: expr });
  }
}
const elmInlineBypass = elmInlineStyles.filter((s) => !s.prop.startsWith('--')).map((s) => ({ ...s, colors: findColors(stripUrls(s.value)) }));

// ───────────────────────────── 9. breakpoints / motion ─────────────────

const breakpoints = [];
for (const s of sheets) for (const a of s.atrules) {
  if (!['media', 'container', 'supports'].includes(a.name)) continue;
  const feats = [...a.prelude.matchAll(/\(\s*((?:min|max)-(?:width|height)|width|height|inline-size)\s*(:|[<>]=?)\s*([\d.]+)(px|em|rem)\s*\)/g)].map((m) => ({ feature: m[1], op: m[2], px: m[4] === 'px' ? +m[3] : +m[3] * 16 }));
  const kinds = [...a.prelude.matchAll(/\(\s*(prefers-reduced-motion|prefers-color-scheme|prefers-contrast|forced-colors|hover|pointer|any-hover|any-pointer|display-mode|orientation|prefers-reduced-transparency)\s*:\s*([\w-]+)\s*\)/g)].map((m) => `${m[1]}: ${m[2]}`);
  const rulesInside = allRules.filter((r) => r.file === a.file && r.ctx[r.ctx.length - 1] === a.prelude && r.line >= a.line).length;
  breakpoints.push({ file: a.file, line: a.line, type: a.name, prelude: a.prelude, widths: feats, features: kinds, rules: rulesInside, nestedIn: a.ctx });
}

const keyframes = sheets.flatMap((s) => s.keyframes.map((k) => ({ name: k.name, file: k.file, line: k.line, ctx: ctxKey(k.ctx), frames: k.frames.map((f) => f.selector), props: [...new Set(k.frames.flatMap((f) => f.decls.map((d) => d.prop)))] })));
const KW = /^(ease|ease-in|ease-out|ease-in-out|linear|infinite|alternate|alternate-reverse|both|forwards|backwards|none|normal|reverse|paused|running|step-start|step-end|initial|inherit|unset)$/;
const animationUses = [];
for (const row of declRows) {
  if (row.prop === 'animation' || row.prop === 'animation-name') {
    const names = row.value.split(',').map((part) => part.trim().split(/\s+/).find((t) => !KW.test(t) && !/^[\d.]/.test(t) && !/^(var|cubic-bezier|steps)\(/.test(t) && /^[a-z_-][\w-]*$/i.test(t)) || null).filter(Boolean);
    animationUses.push({ file: row.file, line: row.line, selector: row.selector, ctx: row.ctx, value: row.value, important: row.important, names, infinite: /\binfinite\b/.test(row.value) });
  }
}
const transitions = declRows.filter((r) => /^transition/.test(r.prop)).map((r) => ({ file: r.file, line: r.line, selector: r.selector, ctx: r.ctx, prop: r.prop, value: r.value, important: r.important }));
const reducedMotionBlocks = breakpoints.filter((b) => b.features.some((f) => f.startsWith('prefers-reduced-motion')));
const reduceMotionAttrRules = allRules.filter((r) => /data-reduce-motion/.test(r.selector)).map((r) => ({ file: r.file, line: r.line, selector: r.selector, decls: r.decls.map((d) => `${d.prop}: ${d.value}${d.important ? ' !important' : ''}`) }));
const globalRM = allRules.filter((r) => r.ctx.some((c) => /prefers-reduced-motion:\s*reduce/.test(c)) && /(^|,\s*)\*(\s*,|$|::)/.test(r.selector) && r.decls.some((d) => /^animation/.test(d.prop) && d.important));
const scrollSmooth = declRows.filter((r) => r.prop === 'scroll-behavior').map((r) => ({ file: r.file, line: r.line, selector: r.selector, value: r.value, ctx: r.ctx }));
const jsMotion = [...portsJs.matchAll(/behavior:\s*["']smooth["']|\.animate\(|requestAnimationFrame\(/g)].map((m) => ({ file: 'ports.js', line: portsJs.slice(0, m.index).split('\n').length, what: m[0] }));

// ───────────────────────────── 10. duplicates / conflicts ──────────────

const normSel = (part) => part.trim().replace(/\s+/g, ' ').replace(/\s*([>+~])\s*/g, ' $1 ');
const bySel = new Map();
for (const r of allRules) {
  if (r.atBlock) continue;
  for (const part of splitTop(r.selector, ',')) {
    const s = normSel(part);
    const key = s + ' @@ ' + ctxKey(r.ctx);
    if (!bySel.has(key)) bySel.set(key, { selector: s, ctx: ctxKey(r.ctx), occ: [] });
    if (!bySel.get(key).occ.includes(r)) bySel.get(key).occ.push(r);
  }
}
const cascadeCmp = (x, y) => x.order - y.order || x.line - y.line;
const duplicates = [];
const shadowed = [];
for (const { selector, ctx, occ } of bySel.values()) {
  if (occ.length < 2) continue;
  const files = [...new Set(occ.map((r) => r.file))];
  const props = new Map();
  for (const r of occ) for (const d of r.decls) {
    if (!props.has(d.prop)) props.set(d.prop, []);
    props.get(d.prop).push({ file: r.file, line: d.line, value: d.value, important: d.important, order: r.order });
  }
  const conflicts = [];
  for (const [prop, vals] of props) {
    if (vals.length < 2) continue;
    vals.sort(cascadeCmp);
    const winner = [...vals].sort((x, y) => (x.important - y.important) || cascadeCmp(x, y)).pop();
    const distinct = new Set(vals.map((v) => v.value + (v.important ? '!' : '')));
    if (distinct.size > 1) conflicts.push({ prop, values: vals.map(({ order, ...v }) => v), winner: `${winner.file}:${winner.line}` });
    for (const v of vals) if (v !== winner) shadowed.push({ selector, ctx, prop, file: v.file, line: v.line, value: v.value, winner: `${winner.file}:${winner.line}`, winnerValue: winner.value, sameValue: v.value === winner.value });
  }
  duplicates.push({ selector, ctx, crossFile: files.length > 1, files, occurrences: occ.map((r) => `${r.file}:${r.line}`), conflicts });
}

// Rules whose every declaration loses to a later rule with the identical selector + context.
const shadowKey = new Set(shadowed.map((x) => `${x.selector}|${x.ctx}|${x.file}:${x.line}:${x.prop}`));
const fullyShadowed = allRules.filter((r) => !r.atBlock && r.decls.length && splitTop(r.selector, ',').every((part) => r.decls.every((d) => shadowKey.has(`${normSel(part)}|${ctxKey(r.ctx)}|${r.file}:${d.line}:${d.prop}`))))
  .map((r) => ({ file: r.file, line: r.line, selector: r.selector, ctx: ctxKey(r.ctx), decls: r.decls.length }));

const classDefs = new Map(); // class -> [{file,line,selector,ctx,specificity}]
const classMentions = new Map(); // class -> Set(file)
for (const r of allRules) {
  if (r.atBlock) continue;
  for (const part of splitTop(r.selector, ',')) {
    const sel = part.trim();
    const spec = specificity(sel);
    for (const c of selectorParts(sel).classes) { if (!classMentions.has(c)) classMentions.set(c, new Set()); classMentions.get(c).add(r.file); }
    for (const g of selectorParts(sel).groups) for (const alt of g) for (const c of selectorParts(alt).classes) { if (!classMentions.has(c)) classMentions.set(c, new Set()); classMentions.get(c).add(r.file); }
    for (const neg of selectorParts(sel).negated) for (const mm of unquote(neg).matchAll(/\.([-_a-zA-Z][\w-]*)/g)) { if (!classMentions.has(mm[1])) classMentions.set(mm[1], new Set()); classMentions.get(mm[1]).add(r.file); }
    for (const c of new Set(keyClasses(sel))) {
      if (!classDefs.has(c)) classDefs.set(c, []);
      classDefs.get(c).push({ file: r.file, line: r.line, selector: sel, ctx: ctxKey(r.ctx), specificity: spec.join(','), rule: r });
    }
  }
}
const multiFileClasses = [...classDefs].map(([c, defs]) => ({ class: c, files: [...new Set(defs.map((d) => d.file))], defs })).filter((x) => x.files.length > 1).sort((a, b) => b.files.length - a.files.length || b.defs.length - a.defs.length);

// Cross-file property fights on one key class, restricted to selectors that
// target the same state (same pseudo-classes / attribute states / modifiers on the key compound).
const stateSig = (sel, c) => {
  const comp = keyCompound(sel);
  return comp.replace(new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '(?![\\w-])'), '').replace(/^[a-z]+/, '') || '(base)';
};
const fights = [];
for (const [c, defs] of classDefs) {
  const byKey = new Map();
  for (const d of defs) {
    for (const decl of d.rule.decls) {
      if (decl.prop.startsWith('--')) continue;
      const k = d.ctx + ' :: ' + stateSig(d.selector, c) + ' :: ' + decl.prop;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push({ file: d.file, line: decl.line, selector: d.selector, value: decl.value, important: decl.important, specificity: d.specificity, order: orderOf.get(d.file) });
    }
  }
  for (const [k, vals] of byKey) {
    const files = new Set(vals.map((v) => v.file));
    const values = new Set(vals.map((v) => v.value));
    if (files.size > 1 && values.size > 1) {
      const [ctx, state, prop] = k.split(' :: ');
      vals.sort((x, y) => x.order - y.order || x.line - y.line);
      const sp0 = vals[0].specificity.split(',').map(Number);
      const escal = vals.some((v) => v.file !== vals[0].file && cmpSpec(v.specificity.split(',').map(Number), sp0) > 0);
      // Wrapping files in @layer (in link order) would flip the winner wherever an earlier file's
      // rule out-specifies a later file's rule for the same class/state/prop.
      const layerFlip = vals.some((v, i) => vals.slice(0, i).some((e) => e.file !== v.file && e.value !== v.value && cmpSpec(e.specificity.split(',').map(Number), v.specificity.split(',').map(Number)) > 0));
      fights.push({ class: c, state, ctx, prop, escalates: escal, layerFlip, values: vals.map(({ order, ...v }) => v) });
    }
  }
}
fights.sort((a, b) => a.class.localeCompare(b.class) || a.prop.localeCompare(b.prop));

const important = declRows.filter((r) => r.important).map((r) => ({ file: r.file, line: r.line, selector: r.selector, ctx: r.ctx, prop: r.prop, value: r.value }));

const specRows = [];
for (const r of allRules) {
  if (r.atBlock) continue;
  for (const part of splitTop(r.selector, ',')) {
    const sel = part.trim();
    const sp = specificity(sel);
    const compounds = splitTop(unquote(sel).replace(/:(not|is|where|has|nth-[\w-]+)\((?:[^()]|\([^()]*\))*\)/g, ':$1()').replace(/\s*([>+~])\s*/g, ' '), ' ').filter(Boolean).length;
    specRows.push({ file: r.file, line: r.line, selector: sel, specificity: sp, depth: compounds });
  }
}
const specHist = {};
for (const s of specRows) { const k = s.specificity.join(','); specHist[k] = (specHist[k] || 0) + 1; }
const highSpec = specRows.filter((s) => s.specificity[0] > 0 || s.specificity[1] >= 4 || s.depth >= 4).sort((a, b) => cmpSpec(b.specificity, a.specificity));

// ───────────────────────────── 11. dead rules / unstyled classes ───────

const deadRules = [];
const attrSuspect = [];
for (const r of allRules) {
  if (r.atBlock) continue;
  const parts = splitTop(r.selector, ',').map((p) => p.trim());
  const reasons = parts.map((p) => ({ sel: p, ...selDeadReason(p) }));
  const deadParts = reasons.filter((x) => x.dead.length);
  if (deadParts.length && deadParts.length === parts.length) deadRules.push({ file: r.file, line: r.line, selector: r.selector, ctx: ctxKey(r.ctx), decls: r.decls.length, missing: [...new Set(deadParts.flatMap((x) => x.dead))] });
  else if (deadParts.length) deadRules.push({ file: r.file, line: r.line, selector: r.selector, ctx: ctxKey(r.ctx), decls: r.decls.length, partial: true, deadSelectors: deadParts.map((x) => x.sel), missing: [...new Set(deadParts.flatMap((x) => x.dead))] });
  const attrOnly = reasons.filter((x) => !x.dead.length && x.attrDead.length);
  if (attrOnly.length) attrSuspect.push({ file: r.file, line: r.line, selector: r.selector, unseen: [...new Set(attrOnly.flatMap((x) => x.attrDead))] });
}
const unstyled = [...classAttrUse].filter(([c]) => !classMentions.has(c) && !/[-_]$/.test(c) && c.length > 1).map(([c, locs]) => ({ class: c, uses: locs.slice(0, 6).map((l) => `${l.file}:${l.line}`), count: locs.length }));
const deadClasses = [...classMentions.keys()].filter((c) => !isClassLive(c)).sort().map((c) => ({ class: c, files: [...classMentions.get(c)] }));

// ───────────────────────────── 12. accent audit ────────────────────────

const ACCENT_BASE = ['--onyx-accent', '--onyx-accent-ink', '--lapis', '--lapis-bright', '--lapis-deep', '--brand-action', '--accent', '--seam', '--seam-faint'];
const accentTokens = new Set(ACCENT_BASE);
let grew = true;
while (grew) {
  grew = false;
  for (const t of tokens) {
    if (accentTokens.has(t.name) || /^--focus/.test(t.name)) continue;
    if (t.defs.some((d) => extractVars(d.value).vars.some((v) => accentTokens.has(v.name)))) { accentTokens.add(t.name); grew = true; }
  }
}
function accentCategory(sel, ctx, prop, token) {
  const s = (sel + ' ' + ctx).toLowerCase();
  if (token === '--focus-ring' || /:focus|focus-within|focus-visible/.test(s)) return 'focus';
  if (/mention|highlight|\bhl\b|--hl|self-ping/.test(s)) return 'mention';
  if (/progress|meter|scrub|-fill\b|accent-color/.test(s) || /accent-color|caret-color/.test(prop)) return 'control fill / data-viz';
  if (/speaking|talk|onair|on-air|call-pip|calls-pip|voice-pip|call-ring|breathe|tile-talk/.test(s)) return 'live-audio (calls)';
  if (/\blive\b|-live|live-/.test(s)) return 'status (success / online)';
  if (/aria-current|current|is-here|--here|rail-active|nav[\w-]*-active|-tab[\w-]*\.is-active|tab\[aria-selected/.test(s)) return 'current location';
  if (/toggle-open|toggle-set|-on\b|--on\b|\.on\b|aria-pressed|aria-checked|:checked|data-on|is-on|data-state|is-open|aria-expanded|--set\b|is-set|aria-selected|selected|is-active|--active|\.active\b|data-active/.test(s)) return 'selection / toggle state';
  if (/primary|\bcta\b|--cta|submit|-send\b|send-|--send|apply|confirm|--go\b|-join|join-|--accent\b|-save\b|--save|--start|-start\b|-open\b|__open|signin|sign-in|__keep|-keep\b|-accept\b|__jump|-reply\b|composer button|__undo/.test(s)) return 'primary action';
  if (/success|online|-ok\b|passkey-ok|strength|verified|healthy|member-dot|presence/.test(s)) return 'status (success / online)';
  if (/unread|badge|(^|[-_.\s])count\b|-dot\b|\bdot\b|--new\b|\bnew-|pill|ledger/.test(s)) return 'unread / count / badge / pill';
  if (/(^|[\s>(,])a(\b|:|\[|\.)|link|href|:visited|anchor|nav__item|-action\b/.test(s)) return 'link / nav text';
  if (/progress|range|slider|track|thumb|-bar\b|\bbar\b|-fill|meter|::selection|scrub|heat|spark|chart|graph/.test(s) || /accent-color|caret-color/.test(prop)) return 'control fill / data-viz';
  if (/ts-pv|ts-preview|background-picker|sketch-avatar|swatch/.test(s)) return 'theme preview (intended theme accent)';
  if (/^--/.test(prop)) return 'token alias';
  return 'other (outside the budget)';
}
const accentUses = [];
for (const row of declRows) {
  const { vars } = extractVars(row.value);
  for (const h of vars.filter((v) => accentTokens.has(v.name) || v.name === '--focus-ring')) {
    accentUses.push({ file: row.file, line: row.line, selector: row.selector, ctx: row.ctx, prop: row.prop, token: h.name, category: accentCategory(row.selector, row.ctx, row.prop, h.name) });
  }
}
const accentLiterals = hard.color.filter((c) => /^#(46c08a|06281a)/.test(c.value) && !c.rootToken);

// ───────────────────────────── 13. typography / spacing / radius ───────

const tokVal = (t) => ((tokenDefs.get(t) || [{}])[0].value || '').trim();
const TEXT = Object.fromEntries(['--text-2xs', '--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl', '--text-2xl'].map((t) => [t, toPx(tokVal(t))]));
const SPACE = Object.fromEntries(['--space-0', '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7', '--space-8'].map((t) => [t, t === '--space-0' ? 0 : toPx(tokVal(t))]));
const LEADING = Object.fromEntries(['--leading-tight', '--leading-snug', '--leading-body'].map((t) => [t, tokVal(t)]));
function normFont(v) {
  const t = v.match(/^var\((--text-[\w-]+)\)$/);
  if (t) return `${TEXT[t[1]] ?? '?'}px (${t[1]})`;
  const px = toPx(v);
  if (px !== null) return `${px}px`;
  return v;
}
const combos = new Map();
for (const r of allRules) {
  const fs = r.decls.filter((d) => d.prop === 'font-size').pop();
  if (!fs) continue;
  const lh = r.decls.filter((d) => d.prop === 'line-height').pop();
  const fw = r.decls.filter((d) => d.prop === 'font-weight').pop();
  const key = `${normFont(fs.value)} | ${lh ? lh.value : '—'} | ${fw ? fw.value : '—'}`;
  if (!combos.has(key)) combos.set(key, { size: normFont(fs.value), lineHeight: lh ? lh.value : null, weight: fw ? fw.value : null, count: 0, at: [] });
  const c = combos.get(key); c.count++; c.at.push(`${r.file}:${fs.line}`);
}
const dist = (arr, keyFn) => { const o = {}; for (const f of arr) { const k = keyFn(f); o[k] = o[k] || { count: 0, at: [] }; o[k].count++; o[k].at.push(`${f.file}:${f.line}`); } return o; };
const fontSizeDist = dist(hard.fontSize.filter((f) => f.prop === 'font-size'), (f) => normFont(f.value));
const weightDist = dist(hard.fontWeight, (f) => f.value);
const lhDist = dist(hard.lineHeight, (f) => f.value);
const SPACE_PX = new Set(Object.values(SPACE));
const spaceDist = {};
for (const s of hard.spacing) for (const part of splitTop(s.value, ' ').filter(Boolean)) {
  const t = part.match(/^var\((--space-\d)\)$/);
  const px = toPx(part);
  const k = t ? `${SPACE[t[1]]}px (${t[1]})` : px !== null ? `${px}px` : part;
  spaceDist[k] = spaceDist[k] || { count: 0, onScale: t ? true : px !== null ? SPACE_PX.has(px) : /^(0|auto|inherit)$/.test(part) ? true : false, tokenized: !!t || /^var\(/.test(part), at: [] };
  spaceDist[k].count++; spaceDist[k].at.push(`${s.file}:${s.line}`);
}
const radiusDist = dist(hard.radius, (r) => r.value);

// ───────────────────────────── 14. component families ──────────────────

const FAMILIES = [
  ['sheet / dialog / popover', /sheet|dialog|modal|popover|drawer|overlay|backdrop|lightbox|-layer\b|veil|scrim/],
  ['menu / palette / dropdown', /menu|dropdown|palette|spotlight|switcher|combobox|listbox|suggest|picker|popup/],
  ['toast / banner / notice', /toast|snackbar|banner|notice|-alert|callout|-strip\b|-strip-/],
  ['icon button', /icon-btn|iconbtn|ibtn|cbtn|-close\b|close-btn|icon-button|-ico-btn|-tool\b|-tool-|-tool$|-glyph-btn|-x-btn/],
  ['button', /(^|-|_)(btn|button|cta|action|actions|submit)(s?)($|-|_)|-send\b|-primary\b|-secondary\b|-ghost\b|-danger\b|-link-btn/],
  ['segmented control', /segment|(^|-)seg($|-)|segmented|radio-row|toggle-group|-choice/],
  ['switch / toggle', /switch|toggle|checkbox|-check\b/],
  ['tabs', /(^|-|_)tabs?($|-|_)|tablist/],
  ['chip', /chip/],
  ['pill', /pill/],
  ['badge / count / dot', /badge|(^|-|_)count($|-|s$)|unread|-dot\b|-dot-|dot$|(^|-)pip($|-)|kbd|(^|-)tag($|-)/],
  ['input / textarea / field', /input|textarea|(^|-)field($|-|s)|search-box|(^|-)query($|-)|composer-text/],
  ['select', /(^|-)select($|-)/],
  ['avatar / facepile', /avatar|facepile|(^|-)face($|-)|portrait|initials/],
  ['card', /card|(^|-)tile($|-|s)/],
  ['list / row / item', /(^|-|_)(row|rows|item|items|list|entry|entries|cell)($|-|_)/],
  ['divider', /divider|separator|(^|-)rule($|-)|(^|-)hr($|-)|seam/],
  ['empty state', /empty|blank|placeholder|(^|-)zero($|-)|nothing/],
  ['skeleton / loading', /skeleton|shimmer|loading|spinner|loader|pending|progress/],
  ['heading / kicker / label', /kicker|eyebrow|title|heading|label|caption|lede|subtitle|(^|-)sub($|-)|hint|(^|-)meta($|-)/],
];
function baseProps(c) {
  const out = {};
  for (const d of (classDefs.get(c) || []).slice().sort((x, y) => cascadeCmp(x.rule, y.rule))) {
    if (d.ctx) continue;
    if (d.selector.trim() !== '.' + c) continue;
    for (const decl of d.rule.decls) out[decl.prop] = { value: decl.value, at: `${d.file}:${decl.line}` };
  }
  return out;
}
const familyOf = (c) => { for (const [name, re] of FAMILIES) if (re.test(c)) return name; return null; };
const components = {};
for (const [c, defs] of classDefs) {
  let fam = familyOf(c);
  if (!fam) {
    const bp = baseProps(c);
    if (bp.cursor && bp.cursor.value === 'pointer' && (bp.padding || bp['min-height'] || bp.height) && (bp.border || bp.background)) fam = 'button-like by declarations (per-instance class name)';
  }
  if (!fam) continue;
  (components[fam] = components[fam] || []).push({ class: c, files: [...new Set(defs.map((d) => d.file))], defs: defs.length, at: defs.slice(0, 8).map((d) => `${d.file}:${d.line}`), live: !!isClassLive(c) });
}
for (const k of Object.keys(components)) components[k].sort((a, b) => a.class.localeCompare(b.class));

const MATRIX_PROPS = ['min-height', 'height', 'padding', 'font-size', 'font-weight', 'border-radius', 'border', 'background', 'color'];
const componentMatrix = {};
for (const fam of ['button', 'button-like by declarations (per-instance class name)', 'icon button', 'chip', 'pill', 'input / textarea / field', 'select', 'badge / count / dot', 'card', 'tabs', 'segmented control', 'switch / toggle', 'toast / banner / notice', 'avatar / facepile']) {
  componentMatrix[fam] = (components[fam] || []).filter((x) => !/(__|--)/.test(x.class) && x.live).map((x) => ({ class: x.class, files: x.files, props: Object.fromEntries(Object.entries(baseProps(x.class)).filter(([p]) => MATRIX_PROPS.includes(p))) })).filter((x) => Object.keys(x.props).length >= 2);
}

// ───────────────────────────── 15. per-file ownership ──────────────────

const prefixOf = (c) => { const m = c.match(/^([a-z0-9]+(?:-[a-z0-9]+)?)/i); return m ? m[1] : c; };
const fileSummary = sheets.map((s) => {
  const rules = allRules.filter((r) => r.file === s.file);
  const prefixes = {};
  const owned = new Set();
  for (const r of rules) for (const part of splitTop(r.selector, ',')) for (const c of keyClasses(part)) { owned.add(c); }
  for (const c of owned) { const p = prefixOf(c); prefixes[p] = (prefixes[p] || 0) + 1; }
  const viewsUsing = {};
  for (const c of owned) { const uses = classAttrUse.get(c); const lt = uses ? uses[0] : literalTokens.get(c); if (lt) viewsUsing[lt.file] = (viewsUsing[lt.file] || 0) + 1; }
  return {
    file: s.file, order: orderOf.get(s.file), linked: linkOrder.includes(s.file), bytes: s.bytes, lines: s.lines,
    rules: rules.length, selectors: rules.reduce((n, r) => n + splitTop(r.selector, ',').length, 0), decls: rules.reduce((n, r) => n + r.decls.length, 0),
    important: rules.reduce((n, r) => n + r.decls.filter((d) => d.important).length, 0),
    media: s.atrules.filter((a) => a.name === 'media').length, container: s.atrules.filter((a) => a.name === 'container').length,
    keyframes: s.keyframes.map((k) => k.name), tokensDefined: rules.reduce((n, r) => n + r.decls.filter((d) => d.prop.startsWith('--')).length, 0),
    classes: owned.size, topPrefixes: Object.entries(prefixes).sort((a, b) => b[1] - a[1]).slice(0, 10), views: Object.entries(viewsUsing).sort((a, b) => b[1] - a[1]).slice(0, 8),
    header: s.header.split('\n').map((l) => l.trim()).join(' ').slice(0, 700),
    deadRules: deadRules.filter((d) => d.file === s.file && !d.partial).length,
    shadowedDecls: shadowed.filter((x) => x.file === s.file).length,
    fullyShadowedRules: fullyShadowed.filter((x) => x.file === s.file).length,
    deadDecls: deadRules.filter((d) => d.file === s.file && !d.partial).reduce((n, d) => n + d.decls, 0),
  };
});

// ───────────────────────────── 16. assemble JSON ───────────────────────

const map = {
  generator: 'elm/tools/style-map.mjs',
  sources: { cssFiles, linkOrder, notLinked, missingOnDisk, elmFiles: elmFiles.length, themes: Object.keys(themeMaps) },
  totals: {
    bytes: sheets.reduce((n, s) => n + s.bytes, 0), lines: sheets.reduce((n, s) => n + s.lines, 0), rules: allRules.length,
    selectors: specRows.length, decls: declRows.length, important: important.length, tokensDefined: tokenDefs.size,
    tokensUsed: tokenUses.size, classesStyled: classMentions.size, classesUsedInElm: classAttrUse.size,
  },
  files: fileSummary,
  tokens: { list: tokens, themeMaps, themeSchemes, studioEditable, runtimeWriters: Object.fromEntries(runtimeTokens), rootDataAttrs: [...jsDataset].sort() },
  hardcoded: hard,
  elmInlineStyles: elmInlineBypass.concat(elmTokenWrites),
  duplicates, shadowed, fullyShadowed, fights,
  multiFileClasses: multiFileClasses.map((m) => ({ class: m.class, files: m.files, defs: m.defs.map((d) => `${d.file}:${d.line} ${d.selector}${d.ctx ? ' @ ' + d.ctx : ''}`) })),
  important, specificity: { histogram: specHist, outliers: highSpec },
  deadRules, deadClasses, attrSuspect, unstyled, dynamicPrefixes: [...dynamicPrefixes].map(([p, l]) => `${p} (${l.file}:${l.line})`),
  breakpoints,
  motion: { keyframes, animationUses, transitions, reducedMotionBlocks, reduceMotionAttrRules, globalReducedMotion: globalRM.map((r) => `${r.file}:${r.line}`), scrollSmooth, jsMotion },
  zIndex: hard.zIndex.slice().sort((a, b) => (parseFloat(a.value) || 0) - (parseFloat(b.value) || 0)),
  accent: { tokens: [...accentTokens], uses: accentUses, literals: accentLiterals },
  typography: { textScale: TEXT, leading: LEADING, combos: [...combos.values()].sort((a, b) => b.count - a.count), fontSizes: fontSizeDist, weights: weightDist, lineHeights: lhDist, families: hard.fontFamily },
  spacing: { scale: SPACE, distribution: spaceDist },
  radius: radiusDist, shadows: hard.shadow,
  components, componentMatrix,
};
/** Serialized form: {file,line} pairs fold into "at": "file:line", selectors trim, empty ctx drops. */
function compactNode(v) {
  if (Array.isArray(v)) return v.map(compactNode);
  if (!v || typeof v !== 'object') return v;
  const o = {};
  if (typeof v.file === 'string' && typeof v.line === 'number') o.at = `${v.file}:${v.line}`;
  for (const [k, x] of Object.entries(v)) {
    if (o.at && (k === 'file' || k === 'line')) continue;
    if (k === 'ctx' && (x === '' || (Array.isArray(x) && !x.length))) continue;
    if (k === 'nested' && !x) continue;
    if (k === 'fallback' && x == null) continue;
    if (k === 'important' && x === false) continue;
    if (k === 'selector' && typeof x === 'string' && x.length > 140) { o[k] = x.slice(0, 140) + '…'; continue; }
    o[k] = compactNode(x);
  }
  return o;
}
const serial = {
  ...map,
  tokens: { ...map.tokens, list: map.tokens.list.map((t) => ({ ...t, uses: t.uses.map((u) => `${u.file}:${u.line} ${u.prop}${u.fallback ? ' fallback=' + u.fallback : ''}`) })) },
  // Tokenized declarations live in the distributions; the hard-coded lists keep only bypasses.
  hardcoded: Object.fromEntries(Object.entries(map.hardcoded).map(([k, arr]) => [k, arr.filter((x) => x.tokenized !== true && !(k === 'duration' && !x.hardDurations.length))])),
};
writeFileSync(jsonOut, JSON.stringify(compactNode(serial)) + '\n');
console.log(`style-map: ${rel(jsonOut)} (${(Buffer.byteLength(readFileSync(jsonOut)) / 1024).toFixed(0)} KiB)`);

// ───────────────────────────── 17. generated markdown ──────────────────

if (mdOut) {
  const md = renderMarkdown(map);
  const BEGIN = '<!-- BEGIN GENERATED STYLE INVENTORY (elm/tools/style-map.mjs) -->';
  const END = '<!-- END GENERATED STYLE INVENTORY -->';
  let doc = existsSync(mdOut) ? readFileSync(mdOut, 'utf8') : `# Onyx Elm — style map\n\n${BEGIN}\n${END}\n`;
  if (!doc.includes(BEGIN)) doc += `\n${BEGIN}\n${END}\n`;
  doc = doc.slice(0, doc.indexOf(BEGIN) + BEGIN.length) + '\n' + md + '\n' + doc.slice(doc.indexOf(END));
  writeFileSync(mdOut, doc);
  console.log(`style-map: ${rel(mdOut)} generated section ${(Buffer.byteLength(md) / 1024).toFixed(0)} KiB`);
}

function renderMarkdown(m) {
  const L = [];
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/</g, '&lt;');
  const code = (s) => '`' + String(s).replace(/`/g, "'").replace(/\|/g, '\\|') + '`';
  const short = (f) => String(f).replace(/^css\//, '');
  const locs = (arr) => {
    const g = new Map();
    for (const a of arr) { const i = a.search(/:\d/); const f = short(a.slice(0, i)); const l = a.slice(i + 1).split(' ')[0]; if (!g.has(f)) g.set(f, []); g.get(f).push(l); }
    return [...g].map(([f, ls]) => `${f}:${ls.join(',')}`).join(' · ');
  };
  const groupBy = (arr, key) => { const g = new Map(); for (const a of arr) { const k = key(a); if (!g.has(k)) g.set(k, []); g.get(k).push(a); } return g; };
  const h = (n, t) => L.push('', '#'.repeat(n) + ' ' + t, '');
  const byCount = (g) => [...g].sort((a, b) => b[1].length - a[1].length);

  L.push('', '> Everything below this marker is regenerated by `node elm/tools/style-map.mjs`; edit the analysis above it, never this part. Locations are `file:line[,line…]` with `css/` dropped; `app.css` is the root sheet. The full machine-readable map (every selector, declaration and use) is `elm/design/style-map.json`.');

  h(2, 'G0. Totals');
  const t = m.totals;
  L.push('| bytes | lines | rules | selectors | declarations | !important | custom props defined | custom props referenced | classes styled | classes in Elm class attrs |', '|---|---|---|---|---|---|---|---|---|---|');
  L.push(`| ${t.bytes} | ${t.lines} | ${t.rules} | ${t.selectors} | ${t.decls} | ${t.important} | ${t.tokensDefined} | ${t.tokensUsed} | ${t.classesStyled} | ${t.classesUsedInElm} |`);

  h(2, 'G1. Stylesheets in cascade order (index.html)');
  L.push('| # | file | KiB | lines | rules | selectors | decls | !imp | @media | @container | tokens defined | key classes | dead rules (decls) | decls shadowed by a later identical selector | rules fully shadowed | top class prefixes | views emitting its classes |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const f of m.files) L.push(`| ${f.order + 1}${f.linked ? '' : ' NOT LINKED'} | ${code(f.file)} | ${(f.bytes / 1024).toFixed(1)} | ${f.lines} | ${f.rules} | ${f.selectors} | ${f.decls} | ${f.important} | ${f.media} | ${f.container} | ${f.tokensDefined} | ${f.classes} | ${f.deadRules} (${f.deadDecls}) | ${f.shadowedDecls} | ${f.fullyShadowedRules} | ${f.topPrefixes.map(([p, n]) => `${p} ${n}`).join(', ')} | ${f.views.map(([v, n]) => `${v.replace(/^src\//, '')} ${n}`).join(', ')} |`);
  L.push('', 'Each file\'s own header comment (its declared ownership):', '');
  for (const f of m.files) L.push(`- **${f.file}** — ${esc(f.header) || '(no header comment)'}`);
  if (m.sources.notLinked.length) L.push('', `Not linked from index.html: ${m.sources.notLinked.join(', ')}`);

  h(2, 'G2. Custom properties — every definition, theme value, runtime writer and use');
  const st = groupBy(m.tokens.list, (x) => x.status);
  L.push(`Status counts: ${[...st].map(([k, v]) => `**${k}** ${v.length}`).join(' · ')}.`, '');
  L.push('Status legend: `ok` defined in CSS and used; `theme-overridden` defined in CSS **and** re-written inline on `<html>` by every theme commit (the inline value wins); `theme-only` used but defined only by the theme maps (undefined until the first appearanceApply); `runtime-written` set by Elm inline style or ports.js; `unused` defined, never read; `UNDEFINED` read without a fallback and defined nowhere; `undefined-with-fallback` read only with a fallback.', '');
  L.push('| token | status | defined at | first value | theme values (inline on <html>) | runtime writer | uses | used at |', '|---|---|---|---|---|---|---|---|');
  for (const tk of m.tokens.list) {
    const defs = tk.defs.length > 3
      ? `${tk.defs.length} definitions: ${locs(tk.defs.map((d) => `${d.file}:${d.line}`))} (selectors in style-map.json)`
      : tk.defs.map((d) => `${short(d.file)}:${d.line}${d.selector === ':root' ? '' : ' ' + code(d.selector.slice(0, 50))}${d.ctx ? ' @' + esc(d.ctx.slice(0, 40)) : ''}`).join('<br>');
    const tv = Object.keys(tk.themes).length ? [...groupBy(Object.entries(tk.themes), ([, v]) => v)].map(([v, ids]) => `${code(v.length > 36 ? v.slice(0, 36) + '…' : v)} ${ids.length === Object.keys(m.tokens.themeMaps).length ? 'all' : ids.map(([id]) => id).join(',')}`).join('<br>') : '';
    const rt = tk.runtime.map((r) => `${r.by} ${String(r.file).replace(/^src\//, '')}:${r.line}`).join('<br>');
    const first = tk.defs[0] ? code(tk.defs[0].value.length > 50 ? tk.defs[0].value.slice(0, 50) + '…' : tk.defs[0].value) : '';
    const perFile = () => [...groupBy(tk.uses, (u) => short(u.file))].map(([f, a]) => `${f}×${a.length}`).join(' · ');
    L.push(`| ${code(tk.name)} | ${tk.status} | ${defs} | ${first} | ${tv} | ${rt} | ${tk.useCount} | ${tk.useCount > 30 ? perFile() : locs(tk.uses.map((u) => `${u.file}:${u.line}`))} |`);
  }
  L.push('', `Root data-* attributes written by ports.js on <html>: ${m.tokens.rootDataAttrs.map(code).join(', ')}.`);
  L.push('', `Theme Studio-editable tokens (src/Studio.elm): ${m.tokens.studioEditable.map(code).join(', ')}.`);

  h(3, 'G2.1 Theme token matrix (src/ThemeTokens.elm — committed inline on <html> by every appearanceApply)');
  const themeIds = Object.keys(m.tokens.themeMaps);
  const tnames = [...new Set(themeIds.flatMap((id) => Object.keys(m.tokens.themeMaps[id])))];
  L.push(`| token | ${themeIds.map((id) => `${id} (${(m.tokens.themeSchemes[id] || {}).scheme || '?'})`).join(' | ')} |`, `|---|${themeIds.map(() => '---').join('|')}|`);
  for (const n of tnames) L.push(`| ${code(n)} | ${themeIds.map((id) => esc(String(m.tokens.themeMaps[id][n] ?? '—').replace('color-mix(in oklab, ', 'mix(').replace(', transparent)', ')'))).join(' | ')} |`);

  h(2, 'G3. Hard-coded values that bypass tokens (every one, file:line)');
  const colorsComp = m.hardcoded.color.filter((c) => !c.rootToken);
  const colorsRoot = m.hardcoded.color.filter((c) => c.rootToken);
  h(3, `G3.1 Colour literals in component rules and component-scoped custom properties (${colorsComp.length})`);
  L.push('| colour | count | where |', '|---|---|---|');
  for (const [v, arr] of byCount(groupBy(colorsComp, (c) => c.value))) L.push(`| ${code(v)} | ${arr.length} | ${locs(arr.map((a) => `${a.file}:${a.line}`))} |`);
  h(3, `G3.2 Colour literals that are :root token definitions (${colorsRoot.length})`);
  L.push(colorsRoot.map((c) => `${code(c.prop)} ${code(c.value)} ${short(c.file)}:${c.line}`).join(' · '));
  h(3, `G3.3 Colour literals inside var() fallbacks (${m.hardcoded.colorFallback.length})`);
  L.push('| token → fallback | count | where |', '|---|---|---|');
  for (const [k, arr] of byCount(groupBy(m.hardcoded.colorFallback, (c) => `${c.token} → ${c.value}`))) L.push(`| ${code(k)} | ${arr.length} | ${locs(arr.map((a) => `${a.file}:${a.line}`))} |`);
  h(3, `G3.3b Ad-hoc tints: every color-mix() (${m.hardcoded.colorMix.length} uses, ${new Set(m.hardcoded.colorMix.map((c) => c.value)).size} distinct)`);
  L.push('| color-mix expression | count | where |', '|---|---|---|');
  for (const [v, arr] of byCount(groupBy(m.hardcoded.colorMix, (c) => c.value))) L.push(`| ${code(v.slice(0, 110))} | ${arr.length} | ${locs(arr.map((a) => `${a.file}:${a.line}`))} |`);
  h(3, `G3.4 Elm inline styles (bypass every stylesheet) (${m.elmInlineStyles.length})`);
  L.push('| file:line | property | value expression | literal colours |', '|---|---|---|---|');
  for (const s of m.elmInlineStyles) L.push(`| ${s.file}:${s.line} | ${code(s.prop)} | ${code(String(s.value).slice(0, 90))} | ${(s.colors || []).join(', ')} |`);
  const table = (title, arr, keyFn) => {
    h(3, title);
    L.push('| value | count | where |', '|---|---|---|');
    for (const [v, a] of byCount(groupBy(arr, keyFn))) L.push(`| ${code(v)} | ${a.length} | ${locs(a.map((x) => `${x.file}:${x.line}`))} |`);
  };
  const rawFont = m.hardcoded.fontSize.filter((f) => !f.tokenized);
  table(`G3.5 Font sizes off the --text-* ladder (${rawFont.length} of ${m.hardcoded.fontSize.length})`, rawFont, (f) => (f.prop === 'font' ? 'font: ' : '') + f.value);
  const rawLh = m.hardcoded.lineHeight.filter((f) => !f.tokenized);
  table(`G3.6 Line heights off --leading-* (${rawLh.length} of ${m.hardcoded.lineHeight.length})`, rawLh, (f) => f.value);
  const rawW = m.hardcoded.fontWeight;
  table(`G3.7 Font weights (no weight tokens exist) (${rawW.length})`, rawW, (f) => f.value);
  const rawRad = m.hardcoded.radius.filter((f) => !f.tokenized);
  table(`G3.8 Radii off a token (${rawRad.length} of ${m.hardcoded.radius.length})`, rawRad, (f) => f.value);
  const rawSh = m.hardcoded.shadow.filter((f) => !f.tokenized);
  h(3, `G3.9 Shadows off --elev-* (${rawSh.length} of ${m.hardcoded.shadow.length})`);
  L.push('| file:line | selector | property | value |', '|---|---|---|---|');
  for (const s of rawSh) L.push(`| ${short(s.file)}:${s.line} | ${code(s.selector.slice(0, 70))} | ${s.prop} | ${code(s.value.slice(0, 120))} |`);
  const rawDur = m.hardcoded.duration.filter((d) => d.hardDurations.length);
  table(`G3.10 Hard-coded durations in transition / animation (${rawDur.length} of ${m.hardcoded.duration.length} declarations)`, rawDur, (d) => d.hardDurations.join(' '));
  table(`G3.11 Easing keywords / curves written literally (${m.hardcoded.easing.length})`, m.hardcoded.easing, (d) => d.value);
  const rawSp = m.hardcoded.spacing.filter((s) => !s.tokenized);
  table(`G3.12 Spacing (padding / margin / gap / inset / scroll-padding) with raw lengths (${rawSp.length} of ${m.hardcoded.spacing.length} declarations)`, rawSp.flatMap((s) => s.raw.map((r) => ({ ...s, one: r }))), (s) => s.one);
  table(`G3.13 Raw dimensions — width / height / min / max / offsets / border widths / tracking (${m.hardcoded.dimension.length} declarations)`, m.hardcoded.dimension.flatMap((s) => s.raw.map((r) => ({ ...s, one: r }))), (s) => s.one);
  table(`G3.14 Opacity values (${m.hardcoded.opacity.length})`, m.hardcoded.opacity, (s) => s.value);

  h(2, 'G4. z-index ladder (every declaration, low → high)');
  L.push('| z | count | where (file:line selector) |', '|---|---|---|');
  for (const [v, arr] of [...groupBy(m.zIndex, (z) => z.value)].sort((a, b) => (parseFloat(a[0]) || 0) - (parseFloat(b[0]) || 0))) L.push(`| ${code(v)} | ${arr.length} | ${arr.map((a) => `${short(a.file)}:${a.line} ${code(a.selector.slice(0, 60))}${a.ctx ? ' @' + esc(a.ctx.slice(0, 30)) : ''}`).join('<br>')} |`);

  h(2, 'G5. Breakpoints and conditional blocks (every @media / @container / @supports)');
  const bpW = m.breakpoints.filter((b) => b.widths.length);
  L.push('| condition | blocks | where (file:line (rules inside)) |', '|---|---|---|');
  for (const [v, arr] of [...groupBy(bpW, (b) => b.prelude)].sort((a, b) => a[1][0].widths[0].px - b[1][0].widths[0].px)) L.push(`| ${code(v)} | ${arr.length} | ${arr.map((a) => `${short(a.file)}:${a.line} (${a.rules})`).join(' · ')} |`);
  L.push('', 'Non-width conditions:', '', '| condition | where |', '|---|---|');
  for (const [v, arr] of groupBy(m.breakpoints.filter((b) => !b.widths.length), (b) => b.prelude)) L.push(`| ${code(v)} | ${arr.map((a) => `${short(a.file)}:${a.line} (${a.rules})`).join(' · ')} |`);
  const pxs = {};
  for (const b of bpW) for (const w of b.widths) { const k = `${w.feature} ${w.px}px`; pxs[k] = (pxs[k] || 0) + 1; }
  L.push('', `Distinct width thresholds (feature value × blocks): ${Object.entries(pxs).sort((a, b) => parseFloat(a[0].split(' ')[1]) - parseFloat(b[0].split(' ')[1])).map(([k, n]) => `${code(k)}×${n}`).join(' · ')}`);

  h(2, 'G6. Motion inventory');
  L.push(`Global reduced-motion kill switches (\`*\` with !important): ${m.motion.globalReducedMotion.map(short).join(', ') || 'none'}; \`data-reduce-motion\` rules: ${m.motion.reduceMotionAttrRules.map((r) => `${short(r.file)}:${r.line} {${r.decls.join('; ')}}`).join(' · ')}.`);
  L.push('', `Every prefers-reduced-motion block: ${m.motion.reducedMotionBlocks.map((b) => `${short(b.file)}:${b.line} (${b.prelude.replace('@media ', '')}, ${b.rules} rules)`).join(' · ')}.`);
  L.push('', '| @keyframes | defined | used by | loops? |', '|---|---|---|---|');
  for (const k of m.motion.keyframes) {
    const users = m.motion.animationUses.filter((a) => a.names.includes(k.name));
    L.push(`| ${code(k.name)} | ${short(k.file)}:${k.line}${k.ctx ? ' @' + esc(k.ctx) : ''} | ${users.map((u) => `${short(u.file)}:${u.line}`).join(', ') || '**unused**'} | ${users.some((u) => u.infinite) ? '**infinite**' : ''} |`);
  }
  const missingKf = m.motion.animationUses.filter((a) => a.names.some((n) => !m.motion.keyframes.some((k) => k.name === n)));
  if (missingKf.length) L.push('', `Animation declarations naming an undefined @keyframes: ${missingKf.map((a) => `${short(a.file)}:${a.line} ${code(a.value)}`).join(' · ')}`);
  L.push('', `Every animation declaration (${m.motion.animationUses.length}):`, '', '| file:line | selector | value | context |', '|---|---|---|---|');
  for (const a of m.motion.animationUses) L.push(`| ${short(a.file)}:${a.line} | ${code(a.selector.slice(0, 70))} | ${code(a.value.slice(0, 90))}${a.important ? ' !important' : ''} | ${esc(a.ctx.slice(0, 50))} |`);
  L.push('', `Every transition declaration (${m.motion.transitions.length}):`, '', '| file:line | selector | value | context |', '|---|---|---|---|');
  for (const a of m.motion.transitions) L.push(`| ${short(a.file)}:${a.line} | ${code(a.selector.slice(0, 70))} | ${code(a.prop === 'transition' ? a.value.slice(0, 100) : a.prop + ': ' + a.value.slice(0, 80))}${a.important ? ' !important' : ''} | ${esc(a.ctx.slice(0, 50))} |`);
  L.push('', `scroll-behavior declarations: ${m.motion.scrollSmooth.map((s) => `${short(s.file)}:${s.line} ${s.value}${s.ctx ? ' @' + s.ctx : ''}`).join(' · ')}`);
  L.push('', `Script-driven motion in ports.js: ${m.motion.jsMotion.map((j) => `${j.line} ${code(j.what)}`).join(' · ') || 'none'}`);

  h(2, 'G7. Accent audit (every declaration painting with the accent or an alias of it)');
  L.push(`Accent tokens and their derived aliases: ${m.accent.tokens.map(code).join(', ')}. \`--focus-ring\` uses are listed as focus.`, '');
  const cats = groupBy(m.accent.uses, (u) => u.category);
  L.push('| category (classified from selector + property) | declarations |', '|---|---|');
  for (const [k, arr] of byCount(cats)) L.push(`| ${k} | ${arr.length} |`);
  for (const [k, arr] of byCount(cats)) {
    h(3, `G7 · ${k} (${arr.length})`);
    L.push('| file:line | selector | property | token |', '|---|---|---|---|');
    for (const u of arr) L.push(`| ${short(u.file)}:${u.line} | ${code(u.selector.slice(0, 90))}${u.ctx ? ' @' + esc(u.ctx.slice(0, 30)) : ''} | ${u.prop} | ${u.token} |`);
  }
  if (m.accent.literals.length) L.push('', `Accent hex written literally outside :root: ${m.accent.literals.map((c) => `${short(c.file)}:${c.line} ${c.value}`).join(' · ')}`);

  h(2, 'G8. Typography in use');
  L.push(`Ladder: ${Object.entries(m.typography.textScale).map(([k, v]) => `${code(k)}=${v}px`).join(' · ')}; leading ${Object.entries(m.typography.leading).map(([k, v]) => `${code(k)}=${v}`).join(' · ')}.`, '');
  L.push('Font-size distribution (px at a 16px root):', '', '| size | count | where |', '|---|---|---|');
  for (const [k, v] of Object.entries(m.typography.fontSizes).sort((a, b) => b[1].count - a[1].count)) L.push(`| ${code(k)} | ${v.count} | ${v.count > 80 ? `(${v.count} sites — style-map.json typography.fontSizes)` : locs(v.at)} |`);
  L.push('', 'Font-weight distribution:', '', '| weight | count |', '|---|---|');
  for (const [k, v] of Object.entries(m.typography.weights).sort((a, b) => b[1].count - a[1].count)) L.push(`| ${code(k)} | ${v.count} |`);
  L.push('', 'Line-height distribution:', '', '| line-height | count |', '|---|---|');
  for (const [k, v] of Object.entries(m.typography.lineHeights).sort((a, b) => b[1].count - a[1].count)) L.push(`| ${code(k)} | ${v.count} |`);
  L.push('', `Size × line-height × weight set together in one rule (${m.typography.combos.length} distinct combinations):`, '', '| size | line-height | weight | rules | where |', '|---|---|---|---|---|');
  for (const c of m.typography.combos) L.push(`| ${code(c.size)} | ${code(c.lineHeight ?? '—')} | ${code(c.weight ?? '—')} | ${c.count} | ${c.count > 40 ? `(${c.count} rules)` : locs(c.at)} |`);
  L.push('', 'font-family declarations:', '', '| value | where |', '|---|---|');
  for (const [v, arr] of groupBy(m.typography.families, (f) => f.value)) L.push(`| ${code(v.slice(0, 100))} | ${locs(arr.map((a) => `${a.file}:${a.line}`))} |`);

  h(2, 'G9. Spacing in use (padding / margin / gap / inset components)');
  L.push(`Scale: ${Object.entries(m.spacing.scale).map(([k, v]) => `${code(k)}=${v}px`).join(' · ')}.`, '', '| component value | on the 4px scale? | count | where |', '|---|---|---|---|');
  for (const [k, v] of Object.entries(m.spacing.distribution).sort((a, b) => b[1].count - a[1].count)) L.push(`| ${code(k)} | ${v.tokenized ? 'token' : v.onScale ? 'raw, on scale' : '**off scale**'} | ${v.count} | ${v.tokenized || v.count > 60 ? `(${v.count} sites — style-map.json spacing.distribution)` : locs(v.at)} |`);

  h(2, 'G10. Radius values in use');
  L.push('| value | count | where |', '|---|---|---|');
  for (const [k, v] of Object.entries(m.radius).sort((a, b) => b[1].count - a[1].count)) L.push(`| ${code(k)} | ${v.count} | ${/^var\(--(radius|r-pill)\)$/.test(k) ? `(${v.count} sites — style-map.json radius)` : locs(v.at)} |`);

  h(2, 'G11. Elevation / shadows (every declaration)');
  L.push('| file:line | selector | property | value |', '|---|---|---|---|');
  for (const s of m.shadows) L.push(`| ${short(s.file)}:${s.line} | ${code(s.selector.slice(0, 70))} | ${s.prop} | ${code(s.value.slice(0, 120))} |`);

  h(2, 'G12. !important (every use)');
  L.push('| file:line | selector | declaration | context |', '|---|---|---|---|');
  for (const i of m.important) L.push(`| ${short(i.file)}:${i.line} | ${code(i.selector.slice(0, 80))} | ${code(i.prop + ': ' + i.value.slice(0, 60))} | ${esc(i.ctx.slice(0, 40))} |`);

  h(2, 'G13. Same selector declared more than once in the same context');
  const cross = m.duplicates.filter((d) => d.crossFile);
  const same = m.duplicates.filter((d) => !d.crossFile);
  L.push(`${m.duplicates.length} selectors are declared in more than one rule; ${cross.length} across files. Property conflicts: ${m.duplicates.reduce((n, d) => n + d.conflicts.length, 0)}. Declarations shadowed by a later identical selector: ${m.shadowed.length} (${m.shadowed.filter((s) => s.sameValue).length} merely restate the winning value).`);
  h(3, `G13.0 Rules fully overridden by a later identical selector (${m.fullyShadowed.length} rules, ${m.fullyShadowed.reduce((n, r) => n + r.decls, 0)} declarations — deletable without visual change)`);
  L.push('| file:line | selector | decls | context |', '|---|---|---|---|');
  for (const r of m.fullyShadowed) L.push(`| ${short(r.file)}:${r.line} | ${code(r.selector.slice(0, 90))} | ${r.decls} | ${esc(r.ctx.slice(0, 30))} |`);
  h(3, 'G13.1 Cross-file duplicates with conflicting values');
  L.push('| selector | context | property | values in cascade order | winner |', '|---|---|---|---|---|');
  for (const d of cross) for (const c of d.conflicts) L.push(`| ${code(d.selector.slice(0, 80))} | ${esc(d.ctx.slice(0, 30))} | ${c.prop} | ${c.values.map((v) => `${short(v.file)}:${v.line} ${code(v.value.slice(0, 50))}${v.important ? ' !imp' : ''}`).join('<br>')} | ${short(c.winner)} |`);
  h(3, 'G13.2 Cross-file duplicates (all)');
  L.push('| selector | context | occurrences |', '|---|---|---|');
  for (const d of cross) L.push(`| ${code(d.selector.slice(0, 90))} | ${esc(d.ctx.slice(0, 30))} | ${d.occurrences.map(short).join(', ')} |`);
  h(3, 'G13.3 Same-file duplicates');
  L.push('| selector | context | occurrences | conflicting props |', '|---|---|---|---|');
  for (const d of same) L.push(`| ${code(d.selector.slice(0, 90))} | ${esc(d.ctx.slice(0, 30))} | ${d.occurrences.map(short).join(', ')} | ${d.conflicts.map((c) => c.prop).join(', ')} |`);

  h(2, 'G14. Classes painted by more than one file');
  L.push(`${m.multiFileClasses.length} classes are the key (rightmost) element of rules in two or more files (rule count in parentheses; every rule location is in style-map.json \`multiFileClasses\`).`, '', '| files | classes |', '|---|---|');
  for (const [files, cs] of [...groupBy(m.multiFileClasses, (c) => c.files.map(short).join(' + '))].sort((a, b) => b[1].length - a[1].length)) L.push(`| ${files} | ${cs.map((c) => `${code('.' + c.class)} (${c.defs.length})`).join(' ')} |`);
  h(3, `G14.1 Cross-file property fights (${m.fights.length}): one class, same state, same context, same property, different values in different files`);
  L.push(`Full selectors for every value are in style-map.json \`fights\`. ${m.fights.filter((f) => f.escalates).length} fights are won by a later file raising specificity (marked ↑); ${m.fights.filter((f) => f.layerFlip).length} would change winner if the files were wrapped in @layer in link order (marked **flip**: an earlier file out-specifies a later one). Each value is \`file:line(specificity abc) value\`, in cascade order.`, '', '| class | state | context | property: values in cascade order |', '|---|---|---|---|');
  for (const [k, fs] of groupBy(m.fights, (f) => `${f.class}\u0000${f.state}\u0000${f.ctx}`)) {
    const [cls, state, ctx] = k.split('\u0000');
    const cells = fs.map((f) => `**${f.prop}**${f.escalates ? ' ↑' : ''}${f.layerFlip ? ' **flip**' : ''}: ${f.values.map((v) => `${short(v.file)}:${v.line}(${v.specificity.replace(/,/g, '')}) ${code(v.value.slice(0, 24))}${v.important ? '!' : ''}`).join(' → ')}`);
    L.push(`| ${code('.' + cls)} | ${code(state)} | ${esc(ctx.slice(0, 30))} | ${cells.join('<br>')} |`);
  }

  h(2, 'G15. Specificity');
  L.push(`Histogram (a,b,c → selectors): ${Object.entries(m.specificity.histogram).sort((a, b) => cmpSpec(a[0].split(',').map(Number), b[0].split(',').map(Number))).map(([k, v]) => `${k}→${v}`).join(' · ')}`, '');
  L.push(`Outliers (${m.specificity.outliers.length}: ids, ≥4 class-level parts, or ≥4 compounds deep):`, '', '| file:line | selector | specificity | compounds |', '|---|---|---|---|');
  for (const s of m.specificity.outliers) L.push(`| ${short(s.file)}:${s.line} | ${code(s.selector.slice(0, 110))} | ${s.specificity.join(',')} | ${s.depth} |`);

  h(2, 'G16. Dead rules (selectors matching nothing the Elm views render)');
  const full = m.deadRules.filter((d) => !d.partial);
  const part = m.deadRules.filter((d) => d.partial);
  L.push(`Method: a class is live when it appears as a whitespace-separated token in any Elm string literal under src/ (comments excluded), in a ports.js / media/*.ts string, or extends a literal dynamic prefix (a literal ending in "-"/"_" followed by \`++\`). Everything else is dead. Data-attribute selectors are dead when the attribute is never written. ${full.length} rules (${full.reduce((n, d) => n + d.decls, 0)} declarations) are fully dead; ${part.length} rules carry dead selector-list members; ${m.deadClasses.length} distinct styled classes are never emitted.`, '');
  L.push(`Dynamic prefixes honoured: ${m.dynamicPrefixes.map(code).join(', ')}.`);
  h(3, 'G16.1 Fully dead rules');
  L.push('| file:line | selector | decls | never emitted |', '|---|---|---|---|');
  for (const d of full) L.push(`| ${short(d.file)}:${d.line} | ${code(d.selector.slice(0, 100))}${d.ctx ? ' @' + esc(d.ctx.slice(0, 25)) : ''} | ${d.decls} | ${d.missing.slice(0, 4).map(code).join(' ')} |`);
  h(3, 'G16.2 Rules with dead selector-list members');
  L.push('| file:line | dead members |', '|---|---|');
  for (const d of part) L.push(`| ${short(d.file)}:${d.line} | ${d.deadSelectors.map((s) => code(s.slice(0, 70))).join('<br>')} |`);
  h(3, 'G16.3 Never-emitted classes');
  L.push(m.deadClasses.map((c) => `${code('.' + c.class)} (${c.files.map(short).join(',')})`).join(' · '));
  h(3, 'G16.4 Attribute values never seen as literals (lower confidence: the value may be computed)');
  L.push('| file:line | selector | unseen |', '|---|---|---|');
  for (const a of m.attrSuspect) L.push(`| ${short(a.file)}:${a.line} | ${code(a.selector.slice(0, 90))} | ${a.unseen.map(code).join(' ')} |`);
  h(3, `G16.5 Classes the views emit in class / classList that no stylesheet mentions (${m.unstyled.length})`);
  L.push(m.unstyled.map((u) => `${code(u.class)} (${u.uses[0]}${u.count > 1 ? ' +' + (u.count - 1) : ''})`).join(' · '));

  h(2, 'G17. Component families (classes by naming pattern, where each is defined)');
  for (const [fam, arr] of Object.entries(m.components)) {
    h(3, `${fam} (${arr.length} classes, ${arr.filter((c) => c.files.length > 1).length} multi-file, ${arr.filter((c) => !c.live).length} dead)`);
    const byFiles = groupBy(arr, (c) => c.files.map(short).join(' + '));
    L.push('| defined in | classes |', '|---|---|');
    for (const [files, cs] of [...byFiles].sort((a, b) => b[1].length - a[1].length)) L.push(`| ${files} | ${cs.map((c) => `${code('.' + c.class)}${c.live ? '' : ' **dead**'}`).join(' ')} |`);
  }
  h(3, 'G17.1 Base-class property matrix (live classes; unconditional `.class { }` rules only, last declaration in cascade order)');
  for (const [fam, arr] of Object.entries(m.componentMatrix)) {
    if (!arr.length) continue;
    L.push('', `**${fam}** — ${arr.length} parallel implementations`, '', `| class | files | ${MATRIX_PROPS.join(' | ')} |`, `|---|---|${MATRIX_PROPS.map(() => '---').join('|')}|`);
    for (const x of arr) L.push(`| ${code('.' + x.class)} | ${x.files.map(short).join(', ')} | ${MATRIX_PROPS.map((p) => (x.props[p] ? code(x.props[p].value.slice(0, 40)) : '')).join(' | ')} |`);
  }
  return L.join('\n');
}
