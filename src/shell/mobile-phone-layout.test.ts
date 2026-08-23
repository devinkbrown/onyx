// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * mobile-phone-layout.test.ts — source locks for commercial phone UX.
 * Fail closed if 44px targets, safe-area, or conn visibility regress.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const shellCss = readFileSync(join(here, 'shell.css'), 'utf8');
const homeCss = readFileSync(join(here, 'home-view.css'), 'utf8');
const callsCss = readFileSync(join(here, 'calls-hub.css'), 'utf8');
const connectCss = readFileSync(join(root, 'app/connect.css'), 'utf8');
const appearanceCss = readFileSync(join(root, 'app/appearance.css'), 'utf8');

function mobileShellBlock(): string {
  const marker = '/* ── Mobile layout ── */';
  const idx = shellCss.indexOf(marker);
  expect(idx, 'mobile layout marker').toBeGreaterThanOrEqual(0);
  // Through phone landscape + forced-colors companions that follow the 900px block.
  return shellCss.slice(idx);
}

describe('Shell phone contracts', () => {
  const mobile = mobileShellBlock();

  it('keeps connection chip present with a 44px hit target on mobile', () => {
    expect(mobile).toMatch(/\.shell-ribbon-conn\s*\{[^}]*min-height:\s*44px/s);
    expect(mobile).toMatch(/\.shell-ribbon-conn\s*\{[^}]*min-width:\s*44px/s);
    // Never hide the whole connection affordance on the phone shell.
    expect(mobile).not.toMatch(/\.shell-ribbon-conn\s*\{\s*display:\s*none/);
  });

  it('sizes Call / People / More and composer primaries to ≥44px', () => {
    expect(mobile).toMatch(/\.shell-ribbon-iconbtn[\s\S]*?min-height:\s*44px/);
    expect(mobile).toMatch(/\.shell-composer-tool\s*\{[^}]*min-height:\s*44px/s);
    expect(mobile).toMatch(/\.shell-composer-send\s*\{[^}]*min-height:\s*44px/s);
    expect(mobile).toMatch(/\.shell-composer-textarea\s*\{[^}]*min-height:\s*44px/s);
  });

  it('anchors bottom nav and shell height to safe-area + virtual keyboard', () => {
    expect(mobile).toMatch(/env\(safe-area-inset-bottom/);
    expect(mobile).toMatch(/--shell-virtual-keyboard-inset/);
    expect(mobile).toMatch(/\.shell-mobile-nav[\s\S]*?bottom:\s*var\(--shell-virtual-keyboard-inset/);
    expect(mobile).toMatch(/height:\s*calc\(\s*var\(--mnav-h\)\s*\+\s*env\(safe-area-inset-bottom/);
  });

  it('covers landscape short-height and forced-colors mobile chrome', () => {
    expect(mobile).toMatch(/orientation:\s*landscape/);
    expect(mobile).toMatch(/forced-colors:\s*active/);
    expect(mobile).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it('uses matte mobile surfaces (no multi-layer nav glow stack)', () => {
    const navStart = mobile.indexOf('.shell-mobile-nav {');
    expect(navStart).toBeGreaterThanOrEqual(0);
    const navChunk = mobile.slice(navStart, navStart + 900);
    expect(navChunk).toMatch(/background:\s*color-mix/);
    expect(navChunk).not.toMatch(/box-shadow:\s*[\s\S]*0 -22px/);
  });
});

describe('Home phone hierarchy contracts', () => {
  it('clears the fixed mobile nav under Home content', () => {
    expect(homeCss).toMatch(/calc\(var\(--mnav-h,\s*56px\)\s*\+\s*env\(safe-area-inset-bottom/);
  });

  it('prioritizes continue/search/browse with full-width 44px primary actions', () => {
    expect(homeCss).toMatch(/\.home-welcome-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(homeCss).toMatch(/\.home-cta,\s*\n\s*\.home-action\s*\{[^}]*min-height:\s*44px/s);
    expect(homeCss).toMatch(/\.home-resume-item[\s\S]*?min-height:\s*48px/);
  });

  it('includes landscape phone reflow for Home', () => {
    expect(homeCss).toMatch(/orientation:\s*landscape/);
    expect(homeCss).toMatch(/max-width:\s*390px/);
  });
});

describe('Calls / Connect / Appearance phone contracts', () => {
  it('Calls hub reserves bottom nav + safe-area and keeps truthful idle chrome', () => {
    expect(callsCss).toMatch(/var\(--mnav-h,\s*56px\)\s*\+\s*env\(safe-area-inset-bottom/);
    expect(callsCss).toMatch(/\.shell-calls-primary\s*\{[^}]*min-height:\s*44px/s);
    // Discovery-only: no accept/join affordance invented in CSS content strings.
    expect(callsCss).not.toMatch(/content:\s*['"][^'"]*(Join call|Accept|Start ringing)/i);
  });

  it('Connect front door uses 17px inputs and sticky primary on phone', () => {
    expect(connectCss).toMatch(/@media \(max-width:\s*520px\)/);
    expect(connectCss).toMatch(/\.conn \.onyx-field__input,\s*\n\s*\.conn-password-toggle,\s*\n\s*\.conn-passkey-button,\s*\n\s*\.conn-submit\s*\{[^}]*font-size:\s*17px/s);
    expect(connectCss).toMatch(/\.conn-actions\s*\{[^}]*position:\s*sticky/s);
    expect(connectCss).toMatch(/min-height:\s*48px/);
  });

  it('Appearance phone layout applies safe-area and 44px chips', () => {
    expect(appearanceCss).toMatch(/@media \(max-width:\s*42rem\)/);
    expect(appearanceCss).toMatch(/env\(safe-area-inset-top/);
    expect(appearanceCss).toMatch(/\.ap-chip\s*\{[^}]*min-height:\s*44px/s);
  });
});
