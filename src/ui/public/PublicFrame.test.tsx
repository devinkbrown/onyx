// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicFrame } from './PublicFrame';
import { PublicSkipLink } from './PublicSkipLink';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PublicFrame', () => {
  it('provides one semantic document frame and focuses its skip target', () => {
    const { container } = render(() => <PublicFrame currentPath="/status/"><h1>Status</h1></PublicFrame>);
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    const main = screen.getByRole('main');
    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('footer')).toHaveLength(1);
    expect(skip).toHaveAttribute('href', '#public-main');
    expect(main).toHaveAttribute('id', 'public-main');
    expect(main).toHaveAttribute('tabindex', '-1');
    fireEvent.click(skip);
    expect(main).toHaveFocus();
  });

  it('removes temporary target focusability after focus leaves', () => {
    render(() => (
      <>
        <PublicSkipLink targetId="temporary-target" />
        <div id="temporary-target">Target</div>
        <button type="button">After target</button>
      </>
    ));
    const target = document.getElementById('temporary-target');
    const after = screen.getByRole('button', { name: 'After target' });
    expect(target).not.toHaveAttribute('tabindex');
    fireEvent.click(screen.getByRole('link', { name: 'Skip to content' }));
    expect(target).toHaveFocus();
    expect(target).toHaveAttribute('tabindex', '-1');
    after.focus();
    expect(target).not.toHaveAttribute('tabindex');
  });

  it('uses existing public routes, labels both navigations, and has one primary handoff', () => {
    for (const currentPath of ['/status', '/status/', '/status/?source=header#network'] as const) {
      const view = render(() => <PublicFrame currentPath={currentPath}>Content</PublicFrame>);
      const primary = screen.getByRole('navigation', { name: 'Primary navigation' });
      expect(primary).toContainElement(within(primary).getByRole('link', { name: 'About' }));
      expect(within(primary).getByRole('link', { name: 'OnyxOS' })).toHaveAttribute('href', '/onyxos/');
      expect(within(primary).getByRole('link', { name: 'Status' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: 'Open Onyx' })).toHaveAttribute('href', '/app/');
      expect(screen.getAllByRole('navigation', { name: /navigation/i })).toHaveLength(2);
      const footer = screen.getByRole('navigation', { name: 'Footer navigation' });
      expect([...footer.querySelectorAll('a')].map((link) => ({
        label: link.textContent,
        href: link.getAttribute('href'),
      }))).toEqual([
        { label: 'About', href: '/about/' },
        { label: 'OnyxOS', href: '/onyxos/' },
        { label: 'Roadmap', href: '/roadmap/' },
        { label: 'Status', href: '/status/' },
        { label: 'Downloads', href: '/download/' },
        { label: 'Accessibility', href: '/accessibility/' },
      ]);
      view.unmount();
    }
  });

  it('opens the mobile disclosure, moves focus, traps its endpoints, and restores focus on Escape', async () => {
    render(() => <PublicFrame>Content</PublicFrame>);
    const primary = screen.getByRole('navigation', { name: 'Primary navigation' });
    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
    Object.defineProperty(toggle, 'offsetParent', { configurable: true, value: document.body });
    fireEvent.click(toggle);
    await Promise.resolve();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(within(primary).getByRole('link', { name: 'About' }));

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(toggle);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(within(primary).getByRole('link', { name: 'About' }));

    const openOnyx = screen.getByRole('link', { name: 'Open Onyx' });
    openOnyx.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(toggle);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(openOnyx);

    fireEvent.keyDown(document, { key: 'Escape' });
    await Promise.resolve();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(toggle);
  });

  it('closes and disarms the mobile disclosure when the desktop breakpoint takes over', async () => {
    const { unmount } = render(() => <PublicFrame>Content</PublicFrame>);
    const primary = screen.getByRole('navigation', { name: 'Primary navigation' });
    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
    Object.defineProperty(toggle, 'offsetParent', { configurable: true, value: document.body });
    fireEvent.click(toggle);
    await Promise.resolve();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(within(primary).getByRole('link', { name: 'About' }));

    Object.defineProperty(toggle, 'offsetParent', { configurable: true, value: null });
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).not.toBe(toggle);
    unmount();
  });
});
