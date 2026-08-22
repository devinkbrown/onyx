// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Source locks for consumer chat-app density and default chrome voice.
 * Fail closed if rows, ribbon, or composer shrink back to terminal sizing,
 * or if default-path kickers return to mono uppercase posters.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const shellCss = readFileSync(join(here, 'shell.css'), 'utf8');
const homeCss = readFileSync(join(here, 'home-view.css'), 'utf8');
const homeView = readFileSync(join(here, 'home/HomeBriefingView.tsx'), 'utf8');
const sidebar = readFileSync(join(here, 'ChannelSidebar.tsx'), 'utf8');
const settings = readFileSync(join(here, 'ChannelSettings.tsx'), 'utf8');

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`));
  expect(match, selector).toBeTruthy();
  return match?.[1] ?? '';
}

describe('Consumer shell density', () => {
  it('keeps conversation rows, ribbon, rail, and composer at consumer sizes', () => {
    expect(rule(shellCss, '.shell-channel-item')).toMatch(/min-height:\s*44px/);
    expect(rule(shellCss, '.shell-channel-item')).toMatch(/contain-intrinsic-size:\s*auto 44px/);
    expect(rule(shellCss, '.shell-ribbon')).toMatch(/height:\s*56px/);
    expect(rule(shellCss, '.shell-rail-entry')).toMatch(/min-height:\s*var\(--target-min, 44px\)/);
    expect(rule(shellCss, '.shell-composer-tool')).toMatch(/min-height:\s*var\(--target-min, 44px\)/);
    expect(rule(shellCss, '.shell-composer-send')).toMatch(/min-height:\s*var\(--target-min, 44px\)/);
    expect(rule(shellCss, '.shell-sidebar-browse')).toMatch(/min-height:\s*44px/);
  });

  it('keeps default section labels in sans, not mono uppercase posters', () => {
    expect(rule(shellCss, '.shell-sidebar-section-label')).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(rule(shellCss, '.shell-sidebar-section-label')).toMatch(/text-transform:\s*none/);
    expect(rule(shellCss, '.shell-sidebar-network')).toMatch(/text-transform:\s*none/);
    expect(rule(shellCss, '.shell-ribbon-more-label')).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(rule(homeCss, '.home-kicker')).toMatch(/font-family:\s*var\(--font-sans/);
    expect(rule(homeCss, '.home-section-label')).toMatch(/text-transform:\s*none/);
  });
});

describe('Consumer shell language', () => {
  it('uses Home / rooms / messages on the default path', () => {
    expect(homeView).toMatch(/aria-label="Home"/);
    expect(homeView).toMatch(/What did you miss\?/);
    expect(homeView).not.toMatch(/Current ledger/);
    expect(sidebar).toMatch(/>\s*Rooms\s*</);
    expect(sidebar).toMatch(/>\s*Messages\s*</);
    expect(sidebar).toMatch(/Browse rooms to join one/);
    expect(sidebar).toMatch(/Open a person to start one/);
  });

  it('buries ACCESS / mode letters under Advanced in room settings', () => {
    expect(settings).toMatch(/class="shell-chset-advanced"/);
    expect(settings).toMatch(/<summary>Advanced<\/summary>/);
    expect(settings).not.toMatch(/\+\{flag\.letter\}/);
    expect(settings).not.toMatch(/Room key \(\+k\)/);
    expect(settings).not.toMatch(/User limit \(\+l\)/);
  });

  it('exposes Hide room and Leave room as distinct settings verbs', () => {
    expect(settings).toMatch(/chset-hide/);
    expect(settings).toMatch(/chset-leave/);
    expect(settings).not.toMatch(/Archive/);
  });
});
