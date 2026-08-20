// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductPreview } from './ProductPreview';

afterEach(cleanup);

describe('ProductPreview', () => {
  it('switches its three static states and moves keyboard focus without claiming live content', async () => {
    const { container } = render(() => <ProductPreview />);
    const preview = container.querySelector('[data-product-preview]')!;
    const rooms = screen.getByRole('tab', { name: 'Rooms' });
    fireEvent.keyDown(rooms, { key: 'End' });
    expect(preview).toHaveAttribute('data-preview-state', 'protection');
    expect(screen.getByRole('tab', { name: 'Protection' })).toHaveAttribute('aria-selected', 'true');
    await Promise.resolve();
    expect(screen.getByRole('tab', { name: 'Protection' })).toHaveFocus();
    expect(preview).toHaveTextContent(/not live rooms, people, messages/i);
  });

  it('renders a mineral-night mini-shell with rooms rail and proof, not grey skeleton bars', () => {
    const { container } = render(() => <ProductPreview />);
    const window = container.querySelector('.product-preview__window')!;
    expect(window.querySelector('.product-preview__rail')?.textContent).toMatch(/Home|Design room/);
    expect(window.querySelector('.product-preview__msg')).toBeTruthy();
    expect(window.querySelector('.product-preview__proof')).toBeTruthy();
    expect(window.querySelector('.product-preview__stage')).toBeTruthy();
    expect(container.querySelector('[data-product-preview]')!.textContent).not.toMatch(/mira|Room is open/i);
  });
});
