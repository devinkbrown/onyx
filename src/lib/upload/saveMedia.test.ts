// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import { mediaSaveName, saveMediaFromUserGesture } from './saveMedia';

describe('saveMedia', () => {
  it('names a save from the file leaf or attachment name', () => {
    expect(mediaSaveName('https://cdn.example/uploads/harbour.png')).toBe('harbour.png');
    expect(mediaSaveName('/uploads/a.jpg', 'dusk.jpg')).toBe('dusk.jpg');
  });

  it('saves only from an explicit user gesture and never auto-writes a gallery', () => {
    const clicks: string[] = [];
    const removed: string[] = [];
    const anchor = {
      href: '',
      download: '',
      rel: '',
      target: '',
      click() {
        clicks.push(this.download);
      },
      remove() {
        removed.push(this.download);
      },
    };
    const doc = {
      createElement: (tag: string) => {
        expect(tag).toBe('a');
        return anchor;
      },
      body: {
        appendChild: vi.fn(),
      },
    };

    saveMediaFromUserGesture(
      { href: 'https://cdn.example/harbour.png', name: 'harbour.png' },
      doc as unknown as Document,
    );

    expect(anchor.href).toBe('https://cdn.example/harbour.png');
    expect(anchor.download).toBe('harbour.png');
    expect(anchor.rel).toBe('noopener noreferrer');
    expect(clicks).toEqual(['harbour.png']);
    expect(removed).toEqual(['harbour.png']);
    expect(doc.body.appendChild).toHaveBeenCalledTimes(1);
  });
});
