// SPDX-License-Identifier: AGPL-3.0-or-later
// css-inert-scan.mjs — a small CSS scanner that keeps source offsets/lines (used by css-inert.mjs).
// Minimal CSS scanner with source offsets, for text-level surgery.
export function parseCss(src) {
  let i = 0;
  const n = src.length;
  const lineOf = (off) => { let l = 1; for (let k = 0; k < off; k += 1) if (src.charCodeAt(k) === 10) l += 1; return l; };
  // faster line lookup
  const nl = []; for (let k = 0; k < n; k += 1) if (src.charCodeAt(k) === 10) nl.push(k);
  const line = (off) => { let lo = 0; let hi = nl.length; while (lo < hi) { const m = (lo + hi) >> 1; if (nl[m] < off) lo = m + 1; else hi = m; } return lo + 1; };
  function skipComment() { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; }
  function skipString(q) { i += 1; while (i < n && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1; } i += 1; }
  /** scan from i until one of stop chars at paren-depth 0; returns index of stop char (not consumed) */
  function scanUntil(stops) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '*') { skipComment(); continue; }
      if (c === '"' || c === "'") { skipString(c); continue; }
      if (c === '(' || c === '[') depth += 1;
      else if (c === ')' || c === ']') depth -= 1;
      else if (depth <= 0 && stops.includes(c)) return i;
      i += 1;
    }
    return i;
  }
  function parseDecls(bodyStart, bodyEnd) {
    const decls = []; let p = bodyStart;
    const saved = i;
    while (p < bodyEnd) {
      // skip ws/comments
      while (p < bodyEnd && /\s/.test(src[p])) p += 1;
      if (src[p] === '/' && src[p + 1] === '*') { const e = src.indexOf('*/', p + 2); p = e < 0 ? bodyEnd : e + 2; continue; }
      if (p >= bodyEnd) break;
      i = p; const stop = scanUntil([';']); const endAt = Math.min(stop, bodyEnd);
      const text = src.slice(p, endAt);
      const colon = text.indexOf(':');
      if (colon > 0) {
        const prop = text.slice(0, colon).trim(); let value = text.slice(colon + 1).trim();
        const important = /!\s*important\s*$/i.test(value);
        decls.push({ prop, value, important, start: p, end: stop < bodyEnd ? stop + 1 : endAt, line: line(p) });
      }
      p = stop + 1;
    }
    i = saved;
    return decls;
  }
  function parseBlock(endChar) {
    const nodes = [];
    while (i < n) {
      // skip ws + comments
      while (i < n && /\s/.test(src[i])) i += 1;
      if (src[i] === '/' && src[i + 1] === '*') { skipComment(); continue; }
      if (i >= n) break;
      if (src[i] === '}') { if (endChar === '}') return nodes; i += 1; continue; }
      const start = i;
      const stop = scanUntil(['{', ';', '}']);
      if (src[stop] === ';' || stop >= n || src[stop] === '}') { // statement at-rule (@import/@charset) or junk
        const text = src.slice(start, stop).trim();
        if (src[stop] === ';') i = stop + 1;
        nodes.push({ kind: 'stmt', start, end: i, text, line: line(start) });
        continue;
      }
      const head = src.slice(start, stop).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      const open = stop; i = open + 1;
      if (head.startsWith('@')) {
        const name = /^@([\w-]+)/.exec(head)[1];
        if (/^(media|supports|container|layer|scope|starting-style|document)$/.test(name)) {
          const children = parseBlock('}');
          const close = i; i += 1;
          nodes.push({ kind: 'at', name, prelude: head, start, openAt: open, closeAt: close, end: i, line: line(start), children });
        } else { // keyframes, font-face, page...: opaque body
          const bs = i; scanUntilBalanced(); const close = i; i += 1;
          nodes.push({ kind: 'opaque', name, prelude: head, start, openAt: open, closeAt: close, end: i, line: line(start), bodyStart: bs, children: [] });
        }
      } else {
        const bs = i; scanUntilBalanced(); const close = i; i += 1;
        nodes.push({ kind: 'rule', selector: head, selStart: start, openAt: open, closeAt: close, start, end: i, line: line(start), decls: parseDecls(bs, close) });
      }
    }
    return nodes;
  }
  function scanUntilBalanced() { // consume until the matching '}' (not consumed); nested {} allowed (e.g. nesting)
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '*') { skipComment(); continue; }
      if (c === '"' || c === "'") { skipString(c); continue; }
      if (c === '{') depth += 1;
      else if (c === '}') { if (depth === 0) return; depth -= 1; }
      i += 1;
    }
  }
  const nodes = parseBlock('');
  return { nodes, line };
}

export function* walk(nodes, ctx = []) {
  for (const nd of nodes) {
    if (nd.kind === 'rule') yield { node: nd, ctx };
    else if (nd.kind === 'at') { yield { node: nd, ctx }; yield* walk(nd.children, [...ctx, nd.prelude.replace(/\s+/g, ' ')]); }
    else yield { node: nd, ctx };
  }
}

/** Remove [start,end) ranges (non-overlapping) from src. A range alone on its line(s) takes the whole line(s)
    (and one neighbouring blank line if that would leave two in a row); an inline range also takes the spaces after it. */
export function cut(src, ranges) {
  const rs = [...ranges].sort((a, b) => b[0] - a[0]);
  let out = src;
  for (let [s, e] of rs) {
    let ls = s; while (ls > 0 && (out[ls - 1] === ' ' || out[ls - 1] === '\t')) ls -= 1;
    const atLineStart = ls === 0 || out[ls - 1] === '\n';
    let le = e; while (le < out.length && (out[le] === ' ' || out[le] === '\t')) le += 1;
    const atLineEnd = le >= out.length || out[le] === '\n';
    if (atLineStart && atLineEnd) {
      s = ls; e = le < out.length ? le + 1 : le;
      // blank line before AND after the removed block -> drop one of them
      const prevBlank = s >= 2 && out[s - 1] === '\n' && out[s - 2] === '\n';
      const nextBlank = out[e] === '\n';
      if (prevBlank && nextBlank) e += 1;
      else if (s === 0 && nextBlank) e += 1;
    } else {
      // inline: swallow the spaces that followed it so "a;  b" does not appear
      e = le;
      if (!(out[e] === '}' ) && ls < s) { /* keep one separating space when something follows on the line */ }
    }
    out = out.slice(0, s) + out.slice(e);
  }
  return out;
}
