// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * shell-grid.contract.test.ts — source locks for the column-4 single-occupant
 * slot model (data-shell-aside="members" | "context" | "none").
 *
 * jsdom has no layout engine — getComputedStyle resolves neither var() nor
 * grid tracks — so these are pure string assertions over the CSS source,
 * following the precedent in mobile-phone-layout.test.ts. They exist to keep
 * the two structural invariants that make "both the roster and the rail
 * claim grid-column:4" unrepresentable from silently regressing:
 *
 *   1. Exactly one place declares the shell's grid-template-columns for a
 *      given viewport tier (desktop, mobile) — the bare `.shell` selector.
 *      No modifier-class selector may ever re-declare the track list itself
 *      (only the --shell-aside-w custom property may vary it).
 *   2. The Context rail's `display: block` reveal only ever participates at
 *      >=901px, so a desktop→phone resize can never leave a higher-specificity
 *      reveal rule beating the <=900px hide rule.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DESKTOP_MIN_WIDTH_PX, MOBILE_MAX_WIDTH_PX } from '@/lib/mobile/breakpoints';

const here = dirname(fileURLToPath(import.meta.url));
const shellCss = readFileSync(join(here, 'shell.css'), 'utf8');

/**
 * Finds the `@media` block that most tightly encloses `index`, by scanning
 * every character up to `index` with a brace-depth counter and remembering
 * the most recently opened `@media (...)` block that has not yet closed.
 * shell.css has no braces inside comments or string/content values, so a
 * plain depth counter is sufficient — no CSS tokenizer required.
 */
function enclosingMediaQuery(source: string, index: number): string | null {
  const mediaOpenerRe = /@media\s*([^{]+?)\s*\{/g;
  const stack: { query: string; depth: number }[] = [];
  let depth = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  mediaOpenerRe.lastIndex = 0;

  while (cursor < index) {
    mediaOpenerRe.lastIndex = cursor;
    match = mediaOpenerRe.exec(source);
    const nextMediaIndex = match && match.index < index ? match.index : Infinity;

    // Walk braces between `cursor` and the earlier of (next @media, index),
    // popping the stack whenever a block closes above the current @media's
    // own depth.
    const scanEnd = Math.min(nextMediaIndex, index);
    for (let i = cursor; i < scanEnd; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        while (stack.length > 0 && stack[stack.length - 1]!.depth > depth) stack.pop();
      }
    }

    if (nextMediaIndex === Infinity || nextMediaIndex >= index) break;

    // Landed exactly on an @media opener before `index`: push it and jump
    // past its `{`.
    depth += 1;
    stack.push({ query: match![1]!.trim(), depth });
    cursor = mediaOpenerRe.lastIndex;
  }

  return stack.length > 0 ? stack[stack.length - 1]!.query : null;
}

describe('shell grid contract (column-4 single-occupant slot)', () => {
  it('declares grid-template-columns exactly twice, only on the bare .shell selector', () => {
    const bareShellDeclares = shellCss.match(/\.shell\s*\{[^}]*grid-template-columns/gs) ?? [];
    expect(bareShellDeclares).toHaveLength(2);

    const allDeclareCount = (shellCss.match(/grid-template-columns:/g) ?? []).length;
    const modifierDeclares = allDeclareCount - bareShellDeclares.length;
    // Every non-.shell occurrence belongs to an unrelated component rule
    // (e.g. .shell-primary-nav-btn) — none of them may be a `.shell` MODIFIER
    // selector (.shell--no-rail, .shell[data-shell-aside=...], or any
    // multi-selector group naming `.shell`). Assert none of those modifier
    // forms ever appear paired with the property.
    expect(shellCss).not.toMatch(/\.shell--[\w-]+\s*\{[^}]*grid-template-columns/s);
    expect(shellCss).not.toMatch(/\.shell\[data-shell-aside[^\]]*\]\s*\{[^}]*grid-template-columns/s);
    expect(modifierDeclares).toBeGreaterThanOrEqual(0);
  });

  it('never declares --shell-members-w anywhere (replaced by --shell-aside-w)', () => {
    expect(shellCss).not.toContain('--shell-members-w');
  });

  it('scopes the Context rail reveal to the >=901px breakpoint only', () => {
    const revealRe = /\.shell\[data-shell-aside=['"]context['"]\]\s*\.shell-context-rail\s*\{\s*display:\s*block;?\s*\}/;
    const match = revealRe.exec(shellCss);
    expect(match, 'Context rail reveal rule').not.toBeNull();

    const query = enclosingMediaQuery(shellCss, match!.index);
    expect(query).toBe('(min-width: 901px)');
  });

  it('keeps the CSS mobile boundary in step with the matchMedia constants', () => {
    // A custom property is invalid in a media feature, so the boundary is
    // written in both CSS and TS. This is the guard that keeps the two copies
    // from drifting — the substitute for the single source CSS cannot give.
    expect(shellCss).toContain(`max-width: ${MOBILE_MAX_WIDTH_PX}px`);
    expect(shellCss).toContain(`min-width: ${DESKTOP_MIN_WIDTH_PX}px`);
    expect(DESKTOP_MIN_WIDTH_PX).toBe(MOBILE_MAX_WIDTH_PX + 1);

    // No stale neighbouring boundary: a rule at 899/902 would leave a viewport
    // tier that matches neither the phone nor the desktop layout.
    expect(shellCss).not.toMatch(/max-width: (?:899|901)px/);
    expect(shellCss).not.toMatch(/min-width: (?:900|902)px/);
  });

  it('keeps the reduced-transparency veil override after the translucent default', () => {
    // The chat veil is deliberately translucent so the page-layer Background
    // scene shows through the message column. a11y-media.css force-solids the
    // same surfaces under prefers-reduced-transparency, but at equal 0,1,0
    // specificity — and shell.css loads AFTER it, so without an override in
    // THIS file the translucent value wins on source order and silently
    // cancels the accessibility guarantee. That regression is invisible in
    // jsdom (no layout, no var() resolution) and invisible on a machine that
    // does not set the preference, so it is pinned here as source order.
    const declarations = [...shellCss.matchAll(/--shell-chat-veil:\s*([^;]+);/g)];
    expect(declarations.length).toBeGreaterThanOrEqual(2);

    const base = declarations.find((m) => enclosingMediaQuery(shellCss, m.index) === null);
    expect(base, 'unconditional --shell-chat-veil default').toBeDefined();
    expect(base![1]).toContain('transparent');

    const reduced = declarations.find(
      (m) => enclosingMediaQuery(shellCss, m.index) === '(prefers-reduced-transparency: reduce)',
    );
    expect(reduced, 'reduced-transparency --shell-chat-veil override').toBeDefined();
    expect(reduced![1]).not.toContain('transparent');

    // Source order is the entire mechanism: an override declared before the
    // default would lose to it and the guarantee would be dead again.
    expect(reduced!.index).toBeGreaterThan(base!.index);
  });

  it('opts the chrome veil and canvas wash out of transparency under the same query', () => {
    const reduceBlockRe =
      /@media\s*\(\s*prefers-reduced-transparency:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/;
    const block = reduceBlockRe.exec(shellCss);
    expect(block, 'prefers-reduced-transparency block in shell.css').not.toBeNull();

    // The ribbon/composer chrome shares the veil system, and `.shell` itself
    // carries a translucent canvas wash — both are declared in this file and
    // so both need the same source-order override, not just the message column.
    expect(block![1]).toContain('--shell-chat-chrome-veil:');
    expect(block![1]).toMatch(/background:\s*var\(--ink\)/);
    expect(block![1]).not.toContain('transparent');
  });

  it('keeps the single-occupant attribute selectors free of a literal track-list re-declaration', () => {
    // .shell[data-shell-aside='members'|'context'] may only ever set
    // --shell-aside-w — never grid-template-columns — so two occupant states
    // can never fight over a literal track list (only the custom property
    // may vary).
    expect(shellCss).not.toMatch(/\.shell\[data-shell-aside=['"]members['"]\]\s*\{[^}]*grid-template-columns/s);
    expect(shellCss).not.toMatch(/\.shell\[data-shell-aside=['"]context['"]\]\s*\{[^}]*grid-template-columns/s);
  });
});
