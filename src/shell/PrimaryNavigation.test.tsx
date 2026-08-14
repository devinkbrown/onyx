// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrimaryNavigation } from './PrimaryNavigation';

const shellCss = readFileSync(join(process.cwd(), 'src/shell/shell.css'), 'utf8');

afterEach(cleanup);

describe('PrimaryNavigation', () => {
  it('shares the five product destinations and test hooks across desktop and mobile', () => {
    const onSelect = vi.fn();
    const desktop = render(() => (
      <PrimaryNavigation
        variant="desktop"
        currentSection="rooms"
        selectedCollection="rooms"
        onSelect={onSelect}
      />
    ));

    const desktopNav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(desktopNav).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '⌂Home',
      '#Rooms',
      '@Messages',
      '◉Calls',
      '◇You',
    ]);
    expect(desktopNav.querySelectorAll('[data-primary-nav-item]')).toHaveLength(5);
    expect(desktopNav).toHaveTextContent('Quick switch');
    expect(within(desktopNav).getByRole('button', { name: 'Home' })).toHaveAttribute('title', 'Quick switch to Home');
    expect(desktopNav.querySelector('.shell-primary-nav-icon')).toBeInTheDocument();
    expect(desktopNav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    desktop.unmount();

    render(() => (
      <PrimaryNavigation
        variant="mobile"
        currentSection="rooms"
        selectedCollection="rooms"
        expandedCollection={null}
        onSelect={onSelect}
      />
    ));
    const mobileNav = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(within(mobileNav).getAllByRole('button')).toHaveLength(4);
    expect(mobileNav.querySelector('.shell-mobile-nav-icon')).toBeInTheDocument();
    expect(within(mobileNav).getByRole('button', { name: 'Open Rooms' })).toHaveAttribute('aria-current', 'page');
    expect(within(mobileNav).getByRole('button', { name: 'Open Rooms' })).toHaveAttribute('title', 'Open Rooms');
    expect(mobileNav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(within(mobileNav).getByRole('button', { name: 'Open Inbox' })).toBeInTheDocument();
    expect(within(mobileNav).getByRole('button', { name: 'Open More' })).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('keeps current location separate from selected and expanded collections', () => {
    const onSelect = vi.fn();
    render(() => (
      <PrimaryNavigation
        variant="mobile"
        currentSection="rooms"
        selectedCollection="messages"
        expandedCollection="messages"
        onSelect={onSelect}
      />
    ));

    const rooms = screen.getByRole('button', { name: 'Open Rooms' });
    const messages = screen.getByRole('button', { name: 'Open Inbox' });
    expect(rooms).toHaveAttribute('aria-current', 'page');
    expect(rooms).toHaveAttribute('aria-pressed', 'false');
    expect(rooms).toHaveAttribute('aria-expanded', 'false');
    expect(messages).not.toHaveAttribute('aria-current');
    expect(messages).toHaveAttribute('data-selected', 'true');
    expect(messages).toHaveAttribute('aria-pressed', 'true');
    expect(messages).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(messages);
    expect(onSelect).toHaveBeenCalledWith('messages');
  });

  it('treats You as a transient dialog trigger rather than a current location', () => {
    const onSelect = vi.fn();
    render(() => (
      <PrimaryNavigation
        variant="desktop"
        currentSection="home"
        youDialogOpen
        onSelect={onSelect}
      />
    ));

    const you = screen.getByRole('button', { name: 'You' });
    expect(you).not.toHaveAttribute('aria-current');
    expect(you).toHaveAttribute('aria-haspopup', 'dialog');
    expect(you).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(you);
    expect(onSelect).toHaveBeenCalledWith('you');
  });

  it('keeps selected and dialog-open styling covered in forced colors', () => {
    expect(shellCss).toMatch(
      /\.shell-primary-nav-btn--active\s*\{\s*color:\s*HighlightText;\s*background:\s*Highlight;\s*border-color:\s*Highlight;/s,
    );
    expect(shellCss).toMatch(
      /\.shell-primary-nav-btn--active \.shell-primary-nav-icon\s*\{\s*color:\s*HighlightText;/s,
    );
    expect(shellCss).toContain('.shell-primary-nav-btn--selected:not(.shell-primary-nav-btn--active)');
    expect(shellCss).toContain('.shell-primary-nav-btn--dialog-open');
    expect(shellCss).toContain('.shell-mobile-nav-btn--selected:not(.shell-mobile-nav-btn--active)');
    expect(shellCss).toContain('.shell-mobile-nav-btn--dialog-open');
    expect(shellCss).toContain('@media (forced-colors: active)');
  });
});
