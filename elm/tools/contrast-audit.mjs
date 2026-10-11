// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * contrast-audit.mjs — measure the REAL rendered contrast of every visible
 * text node on a Playwright page (v3/gap-appearance).
 *
 * ShellPalette's unit tests prove the derived palette clears AA on its own
 * surfaces; this proves the CSS actually paints with it. Every text node is
 * resolved to (colour, effective ground) by compositing the ancestors'
 * backgrounds on a 1x1 canvas (so `color-mix()`, `oklab()` and alpha all
 * resolve exactly as the browser paints them), then scored with WCAG 2.x.
 * A ground that cannot be resolved (gradients, images, transparency down to
 * the canvas) is skipped, never guessed.
 *
 *   import { auditContrast, assertContrast } from './contrast-audit.mjs';
 *   assertContrast('room', await auditContrast(page, { min: 3 }));
 */

/** Runs in the page. Returns { checked, skipped, failures[] } (worst first). */
function pageAudit({ min, scope }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const root = document.documentElement;

  const paint = (base, layers) => {
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = base;
    g.fillRect(0, 0, 1, 1);
    for (const layer of layers) {
      g.fillStyle = '#000';
      g.fillStyle = layer;
      g.fillRect(0, 0, 1, 1);
    }
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const near = (a, b) => Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2 && Math.abs(a[2] - b[2]) <= 2;

  /** The ground behind `el`: ancestors' backgrounds, outermost first. */
  const ground = (el) => {
    const layers = [];
    let opacity = 1;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      layers.push(cs.backgroundColor);
      opacity *= Number(cs.opacity);
    }
    layers.reverse();
    const onBlack = paint('#000', layers);
    const onWhite = paint('#fff', layers);
    if (!near(onBlack, onWhite)) return null;
    return { rgb: onBlack, layers, opacity };
  };

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    const rects = el.getClientRects();
    if (!rects.length) return false;
    const r = rects[0];
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    return true;
  };

  const label = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return `${el.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ''}`;
  };

  const results = [];
  let checked = 0;
  let skipped = 0;
  /** Alpha of a CSS colour (0 = invisible text: hover-revealed, sr-only). */
  const alphaOf = (css) => {
    g.globalCompositeOperation = 'copy';
    g.fillStyle = 'rgba(0,0,0,0)';
    g.fillRect(0, 0, 1, 1);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = css;
    g.fillRect(0, 0, 1, 1);
    return g.getImageData(0, 0, 1, 1).data[3] / 255;
  };
  const scoreEl = (el, fgCss, text) => {
    if (alphaOf(fgCss) < 0.1) return;
    // WCAG 1.4.3 exempts inactive controls.
    if (el.closest(':disabled, [aria-disabled="true"]')) return;
    const g0 = ground(el);
    if (!g0) {
      skipped += 1;
      return;
    }
    if (g0.opacity < 0.1) return;
    let withText = paint('#000', [...g0.layers, fgCss]);
    // `filter: brightness(x)` on the element or an ancestor re-tints the text
    // (computed `color` does not reflect it): apply the factor to the text.
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const m = /brightness\(([0-9.]+)\)/.exec(getComputedStyle(node).filter || '');
      if (m) {
        const k = Number(m[1]);
        withText = withText.map((v) => Math.min(255, Math.round(v * k)));
      }
    }
    const bg = g0.rgb;
    const fg = g0.opacity < 1
      ? withText.map((v, i) => Math.round(v * g0.opacity + bg[i] * (1 - g0.opacity)))
      : withText;
    checked += 1;
    const r = ratio(fg, bg);
    if (r + 0.005 < min) {
      results.push({ el: label(el), text: text.slice(0, 40), ratio: Math.round(r * 100) / 100, fg: `rgb(${fg})`, bg: `rgb(${bg})` });
    }
  };

  const top = scope ? document.querySelector(scope) || document.body : document.body;
  const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.replace(/\s+/g, ' ').trim();
    const parent = node.parentElement;
    if (!text || !parent) continue;
    if (/^(SCRIPT|STYLE|NOSCRIPT|CANVAS)$/.test(parent.tagName)) continue;
    if (!visible(parent)) continue;
    scoreEl(parent, getComputedStyle(parent).color, text);
  }
  for (const el of top.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea')) {
    if (!visible(el)) continue;
    scoreEl(el, getComputedStyle(el).color, `[input] ${el.value || ''}`);
    if (el.placeholder) scoreEl(el, getComputedStyle(el, '::placeholder').color, `[placeholder] ${el.placeholder}`);
  }
  results.sort((a, b) => a.ratio - b.ratio);
  return {
    checked,
    skipped,
    scheme: root.getAttribute('data-shell-scheme'),
    theme: root.getAttribute('data-theme'),
    failures: results,
  };
}

/**
 * @param {import('playwright-core').Page} page
 * @param {{ min?: number, scope?: string }} [options]
 */
export async function auditContrast(page, options = {}) {
  return page.evaluate(pageAudit, { min: options.min ?? 3, scope: options.scope ?? '' });
}

/** Throw a one-paragraph error when the audit found failures. */
export function assertContrast(label, result, { max = 0 } = {}) {
  if (result.failures.length <= max) return result;
  const worst = result.failures
    .slice(0, 6)
    .map((f) => `${f.el} "${f.text}" ${f.ratio}:1 (${f.fg} on ${f.bg})`)
    .join('; ');
  throw new Error(`${label}: ${result.failures.length}/${result.checked} text nodes below target — ${worst}`);
}
