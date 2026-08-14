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
});
