// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Source locks for the 390-wide harbor phone cut: five-tab nav, conversation
 * as the bright plane, no operator leftovers on the default path.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('Harbor phone — connected client', () => {
  const phone = read('shell/harbor-phone.css');
  const shell = read('shell/AppShell.tsx');
  const nav = read('shell/PrimaryNavigation.tsx');
  const sidebar = read('shell/ChannelSidebar.tsx');
  const ribbon = read('shell/PresenceRibbon.tsx');
  const composer = read('shell/Composer.tsx');
  const connect = read('app/connect.css');

  it('is imported after the desktop shell so 390-wide chrome wins', () => {
    expect(shell).toMatch(/import '\.\/shell\.css'/);
    expect(shell).toMatch(/import '\.\/harbor-phone\.css'/);
    expect(shell.indexOf("import './shell.css'")).toBeLessThan(shell.indexOf("import './harbor-phone.css'"));
  });

  it('keeps five destinations on the phone rail, not Menu or Inbox', () => {
    expect(nav).toContain("aria-label={isMobile() ? `Open ${item.label}` : undefined}");
    expect(nav).toContain("mobileYouButtonRef");
    expect(nav).not.toMatch(/Open Menu|Open Inbox|MOBILE_SECTIONS/);
    expect(phone).toMatch(/Home \/ Rooms \/ Messages \/ Calls \/ You/);
    expect(phone).toMatch(/flex:\s*1 0 20%/);
  });

  it('reads at 17px with 44px hits and recedes chrome around the conversation', () => {
    expect(phone).toMatch(/--harbor-phone-body:\s*var\(--text-lg, 1\.0625rem\)/);
    expect(phone).toMatch(/\.shell-msg-text[\s\S]*font-size:\s*var\(--harbor-phone-body\)/);
    expect(phone).toMatch(/\.shell-composer-textarea[\s\S]*min-height:\s*44px/);
    expect(phone).toMatch(/\.shell-composer-send[\s\S]*min-width:\s*44px/);
    expect(phone).toMatch(/\.shell-conversation[\s\S]*background:\s*var\(--harbor-phone-plane\)/);
    expect(phone).toMatch(/\.shell-ribbon::after[\s\S]*display:\s*none/);
    expect(phone).toMatch(/backdrop-filter:\s*none/);
  });

  it('uses Fraunces once on the transcript and mono only for timestamps', () => {
    expect(phone).toMatch(/\.shell-day-divider-label[\s\S]*font-family:\s*var\(--font-serif\)/);
    expect(phone).toMatch(/\.shell-msg-ts[\s\S]*font-family:\s*var\(--font-mono\)/);
    expect(phone).toMatch(/\.shell-msg-text[\s\S]*font-family:\s*var\(--font-sans\)/);
    expect(phone).toMatch(/\.shell-msg-author[\s\S]*font-family:\s*var\(--font-sans\)/);
  });

  it('kills operator leftovers on the default phone path', () => {
    expect(sidebar).toContain('placeholder="Room name"');
    expect(sidebar).not.toContain('join #room');
    expect(shell).toContain('hideOperatorChips={isMobile()}');
    expect(sidebar).toMatch(/!local.hideOperatorChips && preferences\(\)\.experienceMode !== 'standard'/);
    expect(ribbon).toMatch(/contextActionsOnly[\s\S]*shell-ribbon-conn-label/);
    expect(ribbon).toContain("return 'Connecting…'");
    expect(composer).toMatch(/return `Message \$\{t\}`/);
    expect(composer).not.toContain('join #room');
    expect(phone).toMatch(/\.shell-notify-controls[\s\S]*display:\s*none/);
    expect(phone).toMatch(/\.stage-panel\[data-active='false'\][\s\S]*display:\s*none/);
    expect(phone).toMatch(/\.shell-topic-filter[\s\S]*display:\s*none/);
    expect(connect).toMatch(/\.conn-status-phase[\s\S]*text-transform:\s*none/);
    expect(connect).toMatch(/\.conn-title[\s\S]*font-family:\s*var\(--font-serif\)/);
    expect(connect).toMatch(/\.conn-sub[\s\S]*font-family:\s*var\(--font-sans\)/);
    expect(phone).toMatch(/\.onyx-modal \.onyx-modal__kicker[\s\S]*display:\s*none/);
    expect(phone).toMatch(/\.ap-panel \.ap-panel-label[\s\S]*text-transform:\s*none/);
    expect(phone).toMatch(/\.shell-members \.shell-members-group-label[\s\S]*text-transform:\s*none/);
    expect(phone).toMatch(/\.acct \.onyx-field__label[\s\S]*text-transform:\s*none/);
    expect(phone).not.toMatch(/Anton|#[456][0-5][0-9a-f]{3}ff|#5865F2/i);
  });

  it('uses lapis only when something is alive', () => {
    expect(phone).toMatch(/\.shell-composer-send:not\(:disabled\)[\s\S]*background:\s*var\(--lapis\)/);
    expect(phone).toMatch(/\.shell-mobile-nav-btn--active \.shell-mobile-nav-icon[\s\S]*background:\s*var\(--lapis\)/);
    expect(phone).not.toMatch(/linear-gradient\(135deg/);
  });
});

describe('Harbor phone — public site', () => {
  const landing = read('routes/landing.css');
  const home = read('routes/home.css');
  const about = read('routes/about.css');
  const guides = read('routes/guides.css');
  const download = read('routes/download.css');
  const frame = read('ui/public/public-frame.css');

  it('keeps public buttons sentence-case Instrument Sans at 44px', () => {
    expect(landing).toMatch(/\.r-btn\s*\{[\s\S]*font-family:\s*var\(--font-sans\)/);
    expect(landing).toMatch(/\.r-btn\s*\{[\s\S]*text-transform:\s*none/);
    expect(landing).toMatch(/\.r-btn\s*\{[\s\S]*min-height:\s*var\(--target-min,\s*44px\)/);
    expect(frame).toMatch(/--public-phone-body:\s*1\.0625rem/);
    expect(frame).toMatch(/\.public-frame__open[\s\S]*min-height:\s*44px/);
    expect(frame).toMatch(/\.public-frame__footer a:not\(\.public-frame__footer-brand\)[\s\S]*min-height:\s*44px/);
  });

  it('uses one Fraunces title per public phone screen', () => {
    expect(home).toMatch(/\.r-landing\.home \.home-h1[\s\S]*font-family:\s*var\(--mn-serif\)/);
    expect(about).toMatch(/\.ab-hero h1[\s\S]*font-family:\s*var\(--font-serif\)/);
    expect(guides).toMatch(/\.guides-page \.data-hero h1[\s\S]*font-family:\s*var\(--font-serif\)/);
    expect(download).toMatch(/\.dl-hero h1[\s\S]*font-family:\s*var\(--font-serif\)/);
  });

  it('turns the 390-wide preview into a phone shell, not a squeezed desk', () => {
    expect(home).toMatch(/@media \(max-width:\s*480px\)[\s\S]*product-preview__window[\s\S]*grid-template-columns:\s*1fr/);
    expect(home).toMatch(/@media \(max-width:\s*480px\)[\s\S]*product-preview__proof[\s\S]*display:\s*none/);
    expect(home).toMatch(/@media \(max-width:\s*480px\)[\s\S]*product-preview__rail span b[\s\S]*display:\s*inline-grid/);
    expect(home).toMatch(/\.home-cta-primary[\s\S]*min-height:\s*48px/);
  });
});
