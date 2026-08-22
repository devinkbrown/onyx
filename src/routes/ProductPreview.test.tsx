// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ProductPreview } from './ProductPreview';

afterEach(cleanup);

describe('ProductPreview', () => {
  it('switches its three static states and moves keyboard focus without claiming live content', async () => {
    const { container } = render(() => <ProductPreview />);
    const preview = container.querySelector('[data-product-preview]')!;
    const room = screen.getByRole('tab', { name: 'Room' });
    fireEvent.keyDown(room, { key: 'End' });
    expect(preview).toHaveAttribute('data-preview-state', 'messages');
    expect(screen.getByRole('tab', { name: 'Messages' })).toHaveAttribute('aria-selected', 'true');
    await Promise.resolve();
    expect(screen.getByRole('tab', { name: 'Messages' })).toHaveFocus();
    expect(preview).toHaveTextContent(/not live rooms, people, messages/i);
  });

  it('renders a mineral-night mini-shell with a room conversation, not grey skeleton bars', () => {
    const { container } = render(() => <ProductPreview />);
    const window = container.querySelector('.product-preview__window')!;
    expect(window.querySelector('.product-preview__rail')?.textContent).toMatch(/Weekend plans|Studio hours/);
    expect(window.querySelector('.product-preview__roombar')?.textContent).toMatch(/Weekend plans/);
    expect(window.querySelector('.product-preview__msg')).toBeTruthy();
    expect(window.querySelector('.product-preview__composer')).toBeTruthy();
    expect(window.querySelector('.product-preview__stage')).toBeTruthy();
    expect(container.querySelector('[data-product-preview]')!.textContent).not.toMatch(/mira|Room is open|CONNECT|Join a room/i);
  });
});
