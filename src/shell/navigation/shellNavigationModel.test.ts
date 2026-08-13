// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, render, within } from '@solidjs/testing-library';
import { createComponent } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { PrimaryNavigation } from '../PrimaryNavigation';
import { createShellNavigationModel } from './shellNavigationModel';

afterEach(cleanup);

describe('createShellNavigationModel', () => {
  it('keeps the canonical Home, Rooms, Messages, Calls, You ordering for both responsive variants', () => {
    for (const variant of ['desktop', 'mobile'] as const) {
      const model = createShellNavigationModel({ variant, current: 'home' });
      expect(model.map((item) => item.label)).toEqual(['Home', 'Rooms', 'Messages', 'Calls', 'You']);
      expect(model.map((item) => item.id)).toEqual(['home', 'rooms', 'messages', 'calls', 'you']);
      expect(model.every((item) => item.landmarkLabel === (variant === 'mobile' ? 'Mobile navigation' : 'Primary'))).toBe(true);
    }
  });

  it('uses the same destinations and state semantics on mobile and desktop', () => {
    const input = { current: 'rooms' as const, selectedCollection: 'messages' as const, expandedCollection: 'messages' as const, youDialogOpen: true };
    const desktop = createShellNavigationModel({ variant: 'desktop', ...input });
    const mobile = createShellNavigationModel({ variant: 'mobile', ...input });

    expect(mobile.map(({ actionLabel: _actionLabel, landmarkLabel: _landmarkLabel, ...item }) => item))
      .toEqual(desktop.map(({ actionLabel: _actionLabel, landmarkLabel: _landmarkLabel, ...item }) => item));
    expect(mobile.map((item) => item.actionLabel)).toEqual(['Open Home', 'Open Rooms', 'Open Messages', 'Open Calls', 'Open You']);
  });

  it('separates current location, selected collection, expanded collection, and transient You dialog', () => {
    const model = createShellNavigationModel({
      variant: 'mobile', current: 'rooms', selectedCollection: 'messages', expandedCollection: 'messages', youDialogOpen: true,
    });

    expect(model.find((item) => item.id === 'rooms')).toMatchObject({ current: true, selected: false, expanded: false });
    expect(model.find((item) => item.id === 'messages')).toMatchObject({ current: false, selected: true, expanded: true });
    expect(model.find((item) => item.id === 'you')).toMatchObject({ current: false, selected: false, expanded: true, hasPopup: 'dialog' });
  });

  it('does not infer connection, account, permission, encryption, or active-call state', () => {
    const calls = createShellNavigationModel({ variant: 'desktop', current: 'calls' }).find((item) => item.id === 'calls');
    expect(calls).toEqual({
      id: 'calls', label: 'Calls', landmarkLabel: 'Primary', actionLabel: 'Calls', current: true, selected: false,
    });
  });

  it('keeps optional disclosure state absent instead of silently converting it to false', () => {
    const model = createShellNavigationModel({ variant: 'desktop', current: 'home' });
    expect(model.find((item) => item.id === 'rooms')).not.toHaveProperty('expanded');
    expect(model.find((item) => item.id === 'you')).not.toHaveProperty('expanded');
  });

  it('matches the rendered PrimaryNavigation labels and ARIA state for both variants', () => {
    for (const variant of ['desktop', 'mobile'] as const) {
      const input = {
        variant,
        current: 'rooms' as const,
        selectedCollection: 'messages' as const,
        expandedCollection: 'messages' as const,
        youDialogOpen: true,
      };
      const model = createShellNavigationModel(input);
      const rendered = render(() => createComponent(PrimaryNavigation, {
        variant,
        currentSection: input.current,
        selectedCollection: input.selectedCollection,
        expandedCollection: input.expandedCollection,
        youDialogOpen: input.youDialogOpen,
        onSelect: () => undefined,
      }));
      const nav = within(rendered.container).getByRole('navigation', { name: model[0]?.landmarkLabel });
      const buttons = within(nav).getAllByRole('button');

      expect(buttons).toHaveLength(model.length);
      for (const [index, item] of model.entries()) {
        const button = buttons[index];
        expect(button).toBeDefined();
        expect(button).toHaveAttribute('data-section', item.id);
        expect(button).toHaveAccessibleName(item.actionLabel);
        if (item.current) expect(button).toHaveAttribute('aria-current', 'page');
        else expect(button).not.toHaveAttribute('aria-current');
        if (item.id === 'rooms' || item.id === 'messages') {
          expect(button).toHaveAttribute('aria-pressed', String(item.selected));
          expect(button).toHaveAttribute('aria-expanded', String(item.expanded));
        } else {
          expect(button).not.toHaveAttribute('aria-pressed');
        }
        if (item.id === 'you') {
          expect(button).toHaveAttribute('aria-haspopup', item.hasPopup);
          expect(button).toHaveAttribute('aria-expanded', String(item.expanded));
        }
      }
      rendered.unmount();
    }
  });
});
