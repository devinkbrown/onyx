// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Source locks for the commercial transcript + composer surface.
 * Fail closed if grouping chrome, unread type, or the 5-line composer cap regress.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const shellCss = readFileSync(join(here, 'shell.css'), 'utf8');
const menuCss = readFileSync(join(here, 'message/message-menu.css'), 'utf8');
const gestureCss = readFileSync(join(here, 'message/row-gesture.css'), 'utf8');

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('Transcript and composer commercial chrome', () => {
  const css = stripComments(shellCss);

  it('caps the composer at five lines then scrolls internally', () => {
    expect(css).toMatch(/--composer-max-lines:\s*5/);
    expect(css).toMatch(
      /\.shell-composer-textarea\s*\{[^}]*max-height:\s*calc\(\s*var\(--composer-line-box\)\s*\*\s*var\(--composer-max-lines\)/s,
    );
    expect(css).toMatch(/\.shell-composer-textarea\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).not.toMatch(/\.shell-composer-textarea\s*\{[^}]*max-height:\s*200px/s);
  });

  it('uses quiet Instrument Sans row type — author 600, body 15px, timestamp 12px paper-dim mono', () => {
    expect(css).toMatch(/\.shell-unread-divider\s*\{[^}]*font-family:\s*var\(--font-sans\)/s);
    expect(css).toMatch(/\.shell-unread-divider\s*\{[^}]*text-transform:\s*none/s);
    expect(css).toMatch(/\.shell-day-divider-label\s*\{[^}]*font-family:\s*var\(--font-sans\)/s);
    expect(css).toMatch(/\.shell-day-divider-label\s*\{[^}]*text-transform:\s*none/s);
    expect(css).toMatch(/\.shell-msg-author\s*\{[^}]*font-weight:\s*600/s);
    expect(css).toMatch(/\.shell-msg-text\s*\{[^}]*font-size:\s*var\(--text-md\)/s);
    expect(css).toMatch(/\.shell-msg-text\s*\{[^}]*line-height:\s*var\(--leading-body\)/s);
    expect(css).toMatch(/\.shell-msg-ts\s*\{[^}]*font-family:\s*var\(--font-mono\)/s);
    expect(css).toMatch(/\.shell-msg-ts\s*\{[^}]*font-size:\s*var\(--text-2xs\)/s);
    expect(css).toMatch(/\.shell-msg-ts\s*\{[^}]*color:\s*var\(--paper-dim\)/s);
    expect(css).not.toMatch(/\.shell-msg-ts\s*\{[^}]*color:\s*var\(--paper-mute\)/s);
    expect(css).toMatch(/\.shell-jump-latest\s*\{[^}]*font-family:\s*var\(--font-sans\)/s);
    expect(css).toMatch(/\.shell-jump-latest\s*\{[^}]*border-radius:\s*var\(--r-pill\)/s);
  });

  it('keeps people circular and the composer a 48px vessel with 44px tools', () => {
    expect(css).toMatch(/\.shell-msg-avatar\s+\.onyx-avatar\s*\{[^}]*border-radius:\s*var\(--r-pill\)/s);
    expect(css).toMatch(/\.shell-composer-inner\s*\{[^}]*min-height:\s*48px/s);
    expect(css).toMatch(/\.shell-composer-inner\s*\{[^}]*border-radius:\s*var\(--composer-radius, var\(--r-lg\)\)/s);
    expect(css).toMatch(/\.shell-composer-inner\s*\{[^}]*box-shadow:\s*none/s);
    expect(css).toMatch(/\.shell-composer-tool\s*\{[^}]*width:\s*var\(--target-min, 44px\)/s);
    expect(css).toMatch(/\.shell-composer-send\s*\{[^}]*width:\s*var\(--target-min, 44px\)/s);
    expect(css).toMatch(/\.shell-composer-send:not\(:disabled\)\s*\{[^}]*background:\s*var\(--lapis\)/s);
    expect(css).toMatch(/\.shell-composer-context\s*\{[^}]*border-left:\s*3px\s+solid\s+var\(--lapis\)/s);
    expect(css).toMatch(/\.shell-msg-pending-mark\s*\{/s);
  });

  it('hides in-flow action chips and styles reaction pills without glow', () => {
    expect(css).toMatch(/\.shell-msg-actions\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/\.shell-reaction\s*\{[^}]*border:\s*1px\s+solid\s+var\(--seam\)/s);
    expect(css).toMatch(/\.shell-reaction\s*\{[^}]*border-radius:\s*var\(--r-pill\)/s);
    expect(css).toMatch(/\.shell-reaction--mine\s*\{[^}]*lapis\) 12%/s);
    expect(css).toMatch(/\.shell-reaction--mine\s*\{[^}]*box-shadow:\s*none/s);
    expect(css).toMatch(/\.shell-room-current\s*\{[^}]*display:\s*none/s);
  });

  it('keeps phone composer primaries at 44px and above the virtual keyboard', () => {
    const mobileStart = shellCss.indexOf('/* ── Mobile layout ── */');
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    const mobile = shellCss.slice(mobileStart);
    expect(mobile).toMatch(/\.shell-composer-tool\s*\{[^}]*min-height:\s*44px/s);
    expect(mobile).toMatch(/\.shell-composer-send\s*\{[^}]*min-height:\s*44px/s);
    expect(mobile).toMatch(/--shell-virtual-keyboard-inset/);
  });

  it('fades the hover toolbar in 100ms and keeps coarse overflow at 44px', () => {
    const menu = stripComments(menuCss);
    expect(menu).toMatch(/\.msg-menu-bar\s*\{/s);
    expect(menu).toMatch(/opacity\s+var\(--dur-micro,\s*100ms\)/s);
    expect(menu).toMatch(/width:\s*32px/);
    expect(menu).toMatch(/min-width:\s*44px/);
    expect(menu).not.toMatch(/\.msg-menu-btn--danger/s);
  });

  it('keeps swipe chrome matte and the row a grid line — no bubble or liquid glass', () => {
    const gesture = stripComments(gestureCss);
    expect(css).toMatch(/\.shell-msg-group\s*\{[^}]*display:\s*grid/s);
    expect(css).toMatch(/\.shell-msg-group\s*\{[^}]*grid-template-columns:\s*40px 1fr/s);
    expect(gesture).toMatch(/\.shell-msg--swiping\s*\{[^}]*touch-action:\s*none/s);
    expect(gesture).toMatch(/transform:\s*translateX\(var\(--row-swipe-x/);
    expect(gesture).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(gesture).not.toMatch(/backdrop-filter/);
    expect(gesture).not.toMatch(/-webkit-backdrop-filter/);
    expect(gesture).not.toMatch(/\.shell-msg-bubble/);
    expect(gesture).not.toMatch(/border-radius:\s*(1[6-9]|[2-9]\d)px/);
  });
});
