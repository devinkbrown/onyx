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
    expect(preview).toHaveTextContent('Fictional game-night preview');
    expect(preview).toHaveTextContent('Not a live room');
    expect(preview).toHaveTextContent('A quieter side conversation.');
  });

  it('renders a readable fictional social scene instead of a miniature shell', () => {
    const { container } = render(() => <ProductPreview />);
    const preview = container.querySelector('[data-product-preview]')!;
    const scene = container.querySelector('[data-preview-scene]')!;
    expect(scene).toHaveTextContent('Friday co-op');
    expect(scene).toHaveTextContent('One more round?');
    expect(scene).toHaveTextContent('Give me five minutes.');
    expect(scene).toHaveTextContent('I’ll meet you in voice.');
    expect(scene.querySelectorAll('.product-preview__message')).toHaveLength(3);
    expect(scene.querySelectorAll('button, input, textarea, select')).toHaveLength(0);
    expect(scene.querySelector('.home-mascot-scene')).toHaveAttribute('aria-hidden', 'true');
    expect(preview).toHaveTextContent(/static example/i);
    expect(preview).not.toHaveTextContent(/CONNECT|Join a room|live count/i);
  });

  it('keeps the Home tab as a local example with readable return language', () => {
    const { container } = render(() => <ProductPreview />);
    const preview = container.querySelector('[data-product-preview]')!;
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }));
    expect(preview).toHaveAttribute('data-preview-state', 'home');
    expect(preview).toHaveTextContent('Pick up where you left off.');
    expect(preview).toHaveTextContent('Rooms you already share');
    expect(preview).toHaveTextContent('on device');
  });
});
