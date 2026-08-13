// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SKIP_LINK_SET_LABEL,
  SkipLinkSet,
  isValidSkipTargetId,
  normalizeSkipTargetId,
  normalizeSkipTargets,
  type SkipLinkTarget,
} from './index';

afterEach(cleanup);

function sourceWithoutComments(fileName: string): string {
  const source = readFileSync(join(process.cwd(), 'src/ui/a11y', fileName), 'utf8');
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('SkipLinkSet helpers', () => {
  it('accepts unique HTML ids and strips a single leading hash', () => {
    expect(normalizeSkipTargetId('main')).toBe('main');
    expect(normalizeSkipTargetId('  #public-main  ')).toBe('public-main');
    expect(normalizeSkipTargetId('member-list')).toBe('member-list');
    expect(normalizeSkipTargetId('foo:bar')).toBe('foo:bar');
    expect(isValidSkipTargetId('composer')).toBe(true);
  });

  it('rejects empty, spaced, or href-breaking ids', () => {
    expect(normalizeSkipTargetId('')).toBeUndefined();
    expect(normalizeSkipTargetId('#')).toBeUndefined();
    expect(normalizeSkipTargetId('   ')).toBeUndefined();
    expect(normalizeSkipTargetId('main content')).toBeUndefined();
    expect(normalizeSkipTargetId('main#extra')).toBeUndefined();
    expect(normalizeSkipTargetId('main?x=1')).toBeUndefined();
    expect(normalizeSkipTargetId('a/b')).toBeUndefined();
    expect(normalizeSkipTargetId(null)).toBeUndefined();
    expect(isValidSkipTargetId('')).toBe(false);
  });

  it('keeps first-seen valid destinations in source order', () => {
    const items = normalizeSkipTargets([
      { id: 'nav', label: 'Skip to navigation' },
      { id: '#main', label: '  Skip to   main  ' },
      { id: 'nav', label: 'Duplicate nav' },
      { id: 'broken id', label: 'Broken' },
      { id: 'aside', label: '', when: true },
      { id: 'composer', label: 'Skip to composer', when: false },
      { id: 'members', label: 'Skip to members' },
    ]);

    expect(items).toEqual([
      { id: 'nav', label: 'Skip to navigation', href: '#nav' },
      { id: 'main', label: 'Skip to main', href: '#main' },
      { id: 'members', label: 'Skip to members', href: '#members' },
    ]);
  });

  it('treats a missing target list as empty', () => {
    expect(normalizeSkipTargets(undefined)).toEqual([]);
    expect(normalizeSkipTargets(null)).toEqual([]);
  });
});

describe('SkipLinkSet', () => {
  it('renders ordered skip destinations with unique hrefs', () => {
    render(() => (
      <SkipLinkSet
        class="ui-root"
        linkClass="public-frame__skip"
        targets={[
          { id: 'public-main', label: 'Skip to content' },
          { id: 'primary-nav', label: 'Skip to navigation' },
          { id: 'public-main', label: 'Duplicate' },
        ]}
      />
    ));

    const nav = screen.getByRole('navigation', { name: DEFAULT_SKIP_LINK_SET_LABEL });
    const links = screen.getAllByRole('link');
    expect(nav).toHaveAttribute('data-ui', 'skip-link-set');
    expect(nav).toHaveClass('ui-root');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAccessibleName('Skip to content');
    expect(links[0]).toHaveAttribute('href', '#public-main');
    expect(links[0]).toHaveClass('public-frame__skip');
    expect(links[1]).toHaveAccessibleName('Skip to navigation');
    expect(links[1]).toHaveAttribute('href', '#primary-nav');
    expect(new Set(links.map((link) => link.getAttribute('href'))).size).toBe(2);
  });

  it('omits conditional and invalid destinations and disappears when none remain', () => {
    const [targets, setTargets] = createSignal<SkipLinkTarget[]>([
      { id: 'main', label: 'Skip to main' },
      { id: 'nav', label: 'Skip to navigation', when: true },
    ]);

    render(() => <SkipLinkSet targets={targets()} />);
    expect(screen.getAllByRole('link')).toHaveLength(2);

    setTargets([
      { id: 'main', label: 'Skip to main' },
      { id: 'nav', label: 'Skip to navigation', when: false },
    ]);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Skip to navigation' })).toBeNull();

    setTargets([{ id: 'broken id', label: 'Broken' }]);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('updates labels, order, and the landmark name reactively', () => {
    const [label, setLabel] = createSignal('Skip');
    const [targets, setTargets] = createSignal<SkipLinkTarget[]>([
      { id: 'main', label: 'Main' },
      { id: 'nav', label: 'Nav' },
    ]);

    render(() => <SkipLinkSet label={label()} targets={targets()} />);
    expect(screen.getByRole('navigation', { name: 'Skip' })).toBeTruthy();
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Main', 'Nav']);

    setLabel('Page skips');
    setTargets([
      { id: 'nav', label: 'Navigation' },
      { id: 'main', label: 'Content' },
    ]);

    expect(screen.getByRole('navigation', { name: 'Page skips' })).toBeTruthy();
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '#nav',
      '#main',
    ]);
    expect(screen.getByRole('link', { name: 'Content' })).toHaveAttribute('href', '#main');
  });

  it('is keyboard-safe: native hash links stay in tab order without a focus manager', () => {
    render(() => (
      <>
        <SkipLinkSet
          targets={[
            { id: 'main', label: 'Skip to main' },
            { id: 'composer', label: 'Skip to composer' },
          ]}
        />
        <main id="main">Main</main>
        <div id="composer">Composer</div>
      </>
    ));

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.tagName).toBe('A');
      expect(link.getAttribute('href')?.startsWith('#')).toBe(true);
      expect(link).not.toHaveAttribute('tabindex');
      expect(link.tabIndex).toBe(0);
    }

    const first = links[0]!;
    first.focus();
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Enter' });
    fireEvent.keyDown(first, { key: ' ' });
    expect(first).toHaveAttribute('href', '#main');
    expect(first).toHaveFocus();
    expect(document.getElementById('main')).not.toHaveAttribute('tabindex');
    expect(document.getElementById('composer')).not.toHaveAttribute('tabindex');
  });

  it('does not invent global state or a focus manager', () => {
    const source = sourceWithoutComments('SkipLinkSet.tsx');
    expect(source).not.toMatch(/\bdocument\b/);
    expect(source).not.toMatch(/\bwindow\b/);
    expect(source).not.toMatch(/getElementById/);
    expect(source).not.toMatch(/\.focus\s*\(/);
    expect(source).not.toMatch(/tabindex|tabIndex/);
    expect(source).not.toMatch(/onClick|onKeyDown|addEventListener/);
    expect(source).not.toMatch(/useStore|getState|createStore|localStorage/);
    expect(source).not.toMatch(/from ['"][^'"]+\.css['"]/);
  });

  it('runs id validation without a host document', () => {
    expect(isValidSkipTargetId('public-main')).toBe(true);
    expect(normalizeSkipTargets([{ id: '#composer', label: 'Composer' }])).toEqual([
      { id: 'composer', label: 'Composer', href: '#composer' },
    ]);
  });
});
