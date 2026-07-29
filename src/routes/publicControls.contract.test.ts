// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Narrow CSS contract: shared public controls (About / Status / Stats /
 * Download / Invite / PublicInfo / Roadmap) match Home's mineral-night
 * language — flat quiet-cyan signal, dark on-accent ink, matte seams,
 * no electric blue gradients or coral glow blooms.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const landing = readFileSync(resolve(__dirname, 'landing.css'), 'utf8');
const dataPages = readFileSync(resolve(__dirname, 'data-pages.css'), 'utf8');
const tokens = readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf8');

function ruleBlock(css: string, selector: string): string {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\n\\}`,
    'm',
  );
  const m = css.match(re);
  expect(m, `missing rule block for ${selector}`).toBeTruthy();
  return m![1] ?? '';
}

describe('public shared controls — mineral-night contract', () => {
  it('tokens pin quiet cyan signal and dark on-accent ink', () => {
    expect(tokens).toMatch(/--lapis:\s*#5ba3c9/i);
    expect(tokens).toMatch(/--on-accent:\s*#061018/i);
    expect(tokens).toMatch(/--target-min:\s*44px/);
  });

  it('shared .r-btn.primary is flat quiet-cyan with on-accent ink (no electric gradient)', () => {
    const primary = ruleBlock(landing, '.r-btn.primary');
    expect(primary).toMatch(/color:\s*var\(--on-accent\)/);
    expect(primary).toMatch(/background:\s*var\(--lapis\)/);
    expect(primary).not.toMatch(/linear-gradient/);
    expect(primary).not.toMatch(/--shu/);
    expect(primary).not.toMatch(/0\s+0\s+28px/);
  });

  it('shared .r-btn enforces 44px target floor via tokens', () => {
    const btn = ruleBlock(landing, '.r-btn');
    expect(btn).toMatch(/min-height:\s*var\(--target-min,\s*44px\)/);
  });

  it('header .enter matches the same flat mineral primary language', () => {
    const enter = ruleBlock(landing, '.r-status .enter');
    expect(enter).toMatch(/color:\s*var\(--on-accent\)/);
    expect(enter).toMatch(/background:\s*var\(--lapis\)/);
    expect(enter).not.toMatch(/linear-gradient/);
    expect(enter).toMatch(/min-height:\s*var\(--target-min,\s*44px\)/);
  });

  it('ghost buttons stay matte (no glass blur / no bright electric hover fill)', () => {
    const ghost = ruleBlock(landing, '.r-btn.ghost');
    expect(ghost).not.toMatch(/backdrop-filter/);
    expect(ghost).not.toMatch(/linear-gradient/);
    const ghostHover = ruleBlock(landing, '.r-btn.ghost:hover,\n.r-btn.ghost:focus-visible');
    // Hover may be multi-selector; fall back to source scan if block shape differs.
    const hoverSrc =
      ghostHover ||
      (landing.includes('.r-btn.ghost:hover')
        ? landing.slice(landing.indexOf('.r-btn.ghost:hover'), landing.indexOf('.r-btn.ghost:hover') + 280)
        : '');
    expect(hoverSrc).not.toMatch(/linear-gradient\(135deg,\s*var\(--lapis/);
  });

  it('data-page pressed actions use on-accent ink on quiet-cyan fill', () => {
    const pressed = ruleBlock(dataPages, ".data-action--inspect[aria-pressed='true']");
    expect(pressed).toMatch(/color:\s*var\(--on-accent\)/);
    expect(pressed).toMatch(/background:\s*var\(--lapis\)/);
  });

  it('status semantic pips keep --ok/--warn/--danger and drop electric bloom', () => {
    expect(dataPages).toMatch(/\.status-pill::before[\s\S]*?box-shadow:\s*0 0 0 1px/);
    expect(dataPages).toMatch(/\.status-pill\[data-state='degraded'\][\s\S]*?color:\s*var\(--warn\)/);
    expect(dataPages).toMatch(/\.status-pill\[data-state='down'\][\s\S]*?color:\s*var\(--danger\)/);
    expect(dataPages).not.toMatch(/\.status-pill::before[\s\S]*?box-shadow:\s*0 0 12px currentColor/);
  });
});
