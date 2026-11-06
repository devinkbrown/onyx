// SPDX-License-Identifier: AGPL-3.0-or-later
/* global CSS, document, getComputedStyle, innerWidth, innerHeight, Node */
// In-page audit helpers shared by the exploration harness and the specs.
// `auditPage` is serialised into the page with page.evaluate, so it must be
// self-contained (no closures over module scope).

export const PUBLIC_ROUTES = [
  '/', '/about/', '/download/', '/guides/', '/community/', '/invite/', '/invite/?join=%23root', '/status/', '/stats/', '/roadmap/',
  '/privacy/', '/guidelines/', '/contact/', '/accessibility/', '/glossary/', '/integrations/', '/agents/', '/onyxos/', '/appearance/',
  '/this-page-does-not-exist/', '/app/this-does-not-exist/',
];

export function auditPage(phone) {
  const out = { overflow: null, overflowers: [], smallTargets: [], a11y: [], contrast: [], landmarks: {}, headings: [] };
  const doc = document.documentElement;
  const path = el => {
    const bits = [];
    let node = el;
    while (node && node.nodeType === 1 && bits.length < 4) {
      let bit = node.tagName.toLowerCase();
      if (node.id) bit += '#' + node.id;
      else if (node.classList.length) bit += '.' + [...node.classList].slice(0, 2).join('.');
      bits.unshift(bit);
      node = node.parentElement;
    }
    return bits.join(' > ');
  };
  const visible = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom >= 0 && r.top <= innerHeight;
  };
  const name = el => (el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && [...el.getAttribute('aria-labelledby').split(/\s+/)].map(id => document.getElementById(id)?.textContent || '').join(' ')) || el.getAttribute('title') || el.textContent || (el.tagName === 'IMG' ? el.alt : '') || '').trim().replace(/\s+/g, ' ');

  // Horizontal overflow and who causes it.
  if (doc.scrollWidth > innerWidth) out.overflow = `${doc.scrollWidth}>${innerWidth}`;
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed' && out.overflowers.length < 8) out.overflowers.push(`${path(el)} right=${Math.round(r.right)}`);
  }

  // Touch targets on phones (visible interactive controls outside running text).
  const interactive = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=menuitem], [role=option], [role=tab], [tabindex="0"]';
  if (phone) {
    for (const el of document.querySelectorAll(interactive)) {
      if (!visible(el)) continue;
      if (el.closest('p, .onyx-body, .onyx-message, .onyx-msg-body, .site-prose')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) out.smallTargets.push(`${Math.round(r.width)}x${Math.round(r.height)} ${path(el)} "${name(el).slice(0, 40)}"`);
    }
  }

  // Landmarks + headings.
  out.landmarks = {
    main: document.querySelectorAll('main, [role=main]').length,
    nav: document.querySelectorAll('nav, [role=navigation]').length,
    h1: document.querySelectorAll('h1').length,
    dialogs: document.querySelectorAll('[role=dialog], dialog[open]').length,
    live: document.querySelectorAll('[aria-live], [role=status], [role=alert], [role=log]').length,
    skipLink: !!document.querySelector('a[href="#main"], a[href^="#"][class*="skip"], .skip-link, a.site-skip'),
    lang: doc.getAttribute('lang') || '',
    title: document.title,
  };
  out.headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map(h => `${h.tagName.toLowerCase()}:${name(h).slice(0, 50)}`);

  // Lightweight axe-like checks.
  const push = (rule, el, extra = '') => { if (out.a11y.length < 80) out.a11y.push(`${rule} ${path(el)}${extra ? ' ' + extra : ''}`); };
  if (out.landmarks.main === 0) out.a11y.push('no-main-landmark');
  if (out.landmarks.main > 1) out.a11y.push(`multiple-main (${out.landmarks.main})`);
  if (out.landmarks.h1 === 0) out.a11y.push('no-h1');
  if (out.landmarks.h1 > 1) out.a11y.push(`multiple-h1 (${out.landmarks.h1})`);
  for (const el of document.querySelectorAll('button, [role=button], [role=menuitem], a[href]')) {
    if (!visible(el)) continue;
    if (!name(el)) push('control-without-name', el);
  }
  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    if (!visible(el)) continue;
    const id = el.id;
    const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest('label') || el.getAttribute('title');
    if (!labelled) push('input-without-label', el, `placeholder="${el.placeholder || ''}"`);
  }
  for (const el of document.querySelectorAll('img')) if (visible(el) && !el.hasAttribute('alt')) push('img-without-alt', el);
  for (const el of document.querySelectorAll('[role=dialog]')) {
    if (!visible(el)) continue;
    if (el.getAttribute('aria-modal') !== 'true') push('dialog-without-aria-modal', el, `"${name(el).slice(0, 30)}"`);
    if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) push('dialog-without-name', el);
  }
  for (const el of document.querySelectorAll('[tabindex]')) if (Number(el.getAttribute('tabindex')) > 0) push('positive-tabindex', el);
  for (const el of document.querySelectorAll('[aria-hidden="true"]')) {
    if (el.matches(interactive) || el.querySelector(interactive)) {
      if (visible(el)) push('aria-hidden-contains-focusable', el);
    }
  }
  for (const el of document.querySelectorAll('button button, button a[href], a[href] button, a[href] a[href], [role=button] button')) if (visible(el)) push('nested-interactive', el);
  const ids = new Map();
  for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) || 0) + 1);
  for (const [id, n] of ids) if (n > 1 && out.a11y.length < 80) out.a11y.push(`duplicate-id #${id} x${n}`);
  let lastLevel = 0;
  for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    if (!visible(h)) continue;
    const level = Number(h.tagName[1]);
    if (lastLevel && level > lastLevel + 1) push('heading-skip', h, `h${lastLevel}->h${level}`);
    lastLevel = level;
  }
  for (const el of document.querySelectorAll('[aria-expanded]')) if (!['true', 'false'].includes(el.getAttribute('aria-expanded'))) push('bad-aria-expanded', el);
  for (const el of document.querySelectorAll('[aria-controls]')) {
    for (const id of el.getAttribute('aria-controls').split(/\s+/)) if (id && !document.getElementById(id)) push('aria-controls-dangling', el, `#${id}`);
  }
  for (const el of document.querySelectorAll('[aria-labelledby], [aria-describedby]')) {
    for (const attr of ['aria-labelledby', 'aria-describedby']) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      for (const id of v.split(/\s+/)) if (id && !document.getElementById(id)) push(`${attr}-dangling`, el, `#${id}`);
    }
  }
  // role=status/alert elements that are empty are fine; but role=region without a name is not.
  for (const el of document.querySelectorAll('[role=region], section[aria-label], section[aria-labelledby]')) {
    if (el.getAttribute('role') === 'region' && !name(el)) push('region-without-name', el);
  }

  // Contrast (approximate WCAG 2.x). Composites translucent backgrounds up the tree.
  const parse = c => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const bgOf = el => {
    let node = el; let acc = null; let hasImage = false;
    while (node && node.nodeType === 1) {
      const s = getComputedStyle(node);
      if (s.backgroundImage && s.backgroundImage !== 'none') hasImage = true;
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) {
        acc = acc ? blend(acc, c) : c;
        if (acc.a >= 0.999 && c.a >= 0.999) return { color: acc, hasImage };
      }
      node = node.parentElement;
    }
    const body = parse(getComputedStyle(document.body).backgroundColor);
    const base = body && body.a > 0 ? body : { r: 255, g: 255, b: 255, a: 1 };
    return { color: acc ? blend(acc, base) : base, hasImage };
  };
  const ratio = (a, b) => { const l1 = lum(a); const l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (out.contrast.length >= 60) break;
    if (!visible(el)) continue;
    const textNodes = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (!textNodes.length) continue;
    const s = getComputedStyle(el);
    if (s.opacity === '0' || s.fontSize === '0px') continue;
    const fg0 = parse(s.color);
    if (!fg0) continue;
    const { color: bg, hasImage } = bgOf(el);
    if (hasImage) continue;
    const fg = fg0.a < 1 ? blend(fg0, bg) : fg0;
    const size = parseFloat(s.fontSize);
    const bold = Number(s.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg);
    const txt = textNodes.map(n => n.textContent.trim()).join(' ').slice(0, 40);
    const key = `${path(el)}|${Math.round(r * 10)}`;
    if (r < need && !seen.has(key)) {
      seen.add(key);
      out.contrast.push(`${r.toFixed(2)}:1 (need ${need}) ${Math.round(size)}px ${path(el)} "${txt}" fg=${s.color} bg=rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`);
    }
  }
  return out;
}

// Focus-visible check for the currently focused element: returns a description
// including whether the UA/author draws a visible ring (outline or box-shadow).
export function describeFocus() {
  const el = document.activeElement;
  if (!el || el === document.body) return { tag: 'body', name: '', ring: false, path: 'body' };
  const s = getComputedStyle(el);
  const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
  const r = el.getBoundingClientRect();
  const path = [];
  let node = el;
  while (node && node.nodeType === 1 && path.length < 3) { path.unshift(node.tagName.toLowerCase() + (node.id ? '#' + node.id : node.className && typeof node.className === 'string' ? '.' + node.className.split(' ')[0] : '')); node = node.parentElement; }
  return {
    tag: el.tagName.toLowerCase(),
    name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 60),
    ring, path: path.join(' > '),
    inViewport: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor, boxShadow: s.boxShadow,
  };
}
