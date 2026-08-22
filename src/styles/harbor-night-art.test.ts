// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Source locks for the quiet-harbor night cut: mineral tokens, one ribbon,
 * conversation as the brightest plane, no glass / shouty kickers on the
 * default path.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`));
  expect(match, selector).toBeTruthy();
  return match?.[1] ?? '';
}

describe('Harbor-night tokens', () => {
  const tokens = read('src/styles/tokens.css');

  it('keeps the ocean identity and reading measure', () => {
    expect(tokens).toMatch(/--ink:\s*#05070a/);
    expect(tokens).toMatch(/--stone:\s*#0c1016/);
    expect(tokens).toMatch(/--lapis:\s*#5ba3c9/);
    expect(tokens).toMatch(/--paper:\s*#e6e8ec/);
    expect(tokens).toMatch(/--paper-mute:\s*#848c96/);
    expect(tokens).toMatch(/--text-2xs:\s*0\.75rem/);
    expect(tokens).toMatch(/--text-md:\s*0\.9375rem/);
    expect(tokens).toMatch(/--leading-body:\s*1\.5/);
    expect(tokens).toMatch(/--tracking-kicker:\s*0\.06em/);
    expect(tokens).toMatch(/--line:\s*color-mix\(in oklab, var\(--paper\) 40%/);
    expect(tokens).toMatch(/--target-min:\s*44px/);
    expect(tokens).toMatch(/--composer-radius:\s*var\(--r-lg\)/);
    expect(tokens).toMatch(/--focus-ring:\s*1px solid var\(--lapis\)/);
    expect(tokens).toMatch(/--focus-offset:\s*-1px/);
    expect(tokens).toMatch(/--signal-text:\s*var\(--lapis-bright\)/);
    expect(tokens).toMatch(/--dur-micro:\s*100ms/);
    expect(tokens).toMatch(/--dur-fast:\s*160ms/);
    expect(tokens).toMatch(/--dur-base:\s*220ms/);
  });
});

describe('Harbor-night default chrome', () => {
  const shell = read('src/shell/shell.css');
  const globalCss = read('src/styles/global.css');
  const messages = read('src/shell/MessageView.tsx');
  const connect = read('src/app/connect.css');
  const home = read('src/routes/home.css');
  const typography = read('src/ui/tokens/typography.css');

  it('uses an inset lapis hairline with no bloom', () => {
    expect(rule(globalCss, ':focus-visible')).toMatch(/outline-offset:\s*var\(--focus-offset/);
    expect(rule(globalCss, ':focus-visible')).toMatch(/box-shadow:\s*none/);
    expect(rule(shell, '.shell-composer-inner')).toMatch(/border-radius:\s*var\(--composer-radius/);
    expect(rule(shell, '.shell-msg-group')).toMatch(/margin-top:\s*var\(--space-4\)/);
    expect(rule(shell, '.shell-msg-cont')).toMatch(/padding:\s*2px var\(--space-5\)/);
    expect(rule(shell, '.shell-msg-text')).toMatch(/font-size:\s*var\(--text-md\)/);
    expect(rule(shell, '.shell-msg-text')).toMatch(/line-height:\s*var\(--leading-body\)/);
    expect(rule(shell, '.shell-msg-ts')).toMatch(/font-size:\s*var\(--text-2xs\)/);
    expect(rule(shell, '.shell-msg-ts')).toMatch(/color:\s*var\(--paper-dim\)/);
    expect(rule(shell, '.shell-rail-entry')).toMatch(/min-height:\s*var\(--target-min, 44px\)/);
    expect(rule(shell, '.shell-ribbon-iconbtn')).toMatch(/min-height:\s*var\(--target-min, 44px\)/);
    expect(rule(shell, '.shell-notify-btn')).toMatch(/min-height:\s*var\(--target-min, 44px\)/);
    expect(rule(shell, '.shell-channel-star')).toMatch(/min-height:\s*var\(--target-min, 44px\)/);
    expect(rule(shell, '.shell-topic-card-unread')).toMatch(/color:\s*var\(--paper\)/);
    expect(rule(shell, '.shell-topic-card-unread')).toMatch(/font-weight:\s*600/);
    expect(shell).not.toMatch(/translate3d\(0,\s*-1px/);
  });

  it('keeps Appearance matte and empty rooms free of ledger chrome', () => {
    expect(rule(shell, '.onyx-sheet:has(.ap-panel) .onyx-sheet__panel')).toMatch(/background:\s*var\(--stone\)/);
    expect(rule(shell, '.onyx-sheet:has(.ap-panel) .onyx-sheet__panel')).toMatch(/backdrop-filter:\s*none/);
    expect(messages).not.toMatch(/feed-empty-channel-ledger/);
    expect(messages).toMatch(/feed-empty-invite/);
    expect(messages).toMatch(/Still waters here/);
    expect(messages).toMatch(/Say the first thing in \{activeTarget\(\)\}/);
  });

  it('quiets first-run and landing kickers', () => {
    expect(rule(connect, '.conn-eyebrow')).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(rule(connect, '.conn-eyebrow')).toMatch(/text-transform:\s*none/);
    expect(connect).toMatch(/\.conn \.onyx-field__label[\s\S]*?text-transform:\s*none/);
    expect(rule(connect, '.conn .onyx-button')).toMatch(/text-transform:\s*none/);
    expect(rule(home, '.r-landing.home .home-kicker')).toMatch(/font-family:\s*var\(--mn-sans\)/);
    expect(rule(home, '.r-landing.home .home-kicker')).toMatch(/text-transform:\s*none/);
    expect(typography).toMatch(/--ui-tracking-kicker:\s*var\(--tracking-kicker, 0\.06em\)/);
  });
});
