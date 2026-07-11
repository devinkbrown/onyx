// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';

import { Facepile } from './Facepile';
import type { FacepileMemberInput } from './facepile';

afterEach(cleanup);

function member(nick: string, modes: string[] = [], away = false): FacepileMemberInput {
  return { nick, modes: new Set(modes), away };
}

describe('Facepile', () => {
  it('renders nothing when there are no members', () => {
    const { container } = render(() => <Facepile members={() => []} />);
    expect(container.querySelector('.shell-facepile')).toBeNull();
  });

  it('labels the group with the total people count', () => {
    render(() => <Facepile members={() => [member('ada'), member('bo')]} />);
    expect(screen.getByRole('group', { name: '2 people here' })).toBeTruthy();
  });

  it('uses the singular form for a single member', () => {
    render(() => <Facepile members={() => [member('solo')]} />);
    expect(screen.getByRole('group', { name: '1 person here' })).toBeTruthy();
  });

  it('renders a face per shown member with a per-nick title tooltip', () => {
    const members = [member('netop', ['Y']), member('plain'), member('voiced', ['v'])];
    const { container } = render(() => <Facepile members={() => members} />);

    const faces = Array.from(container.querySelectorAll('.shell-facepile-face'));
    expect(faces).toHaveLength(3);

    // Ordered by role precedence: netop, then voiced, then plain.
    expect(faces.map((f) => f.getAttribute('title'))).toEqual(['netop', 'voiced', 'plain']);
  });

  it('caps visible avatars and shows a +M overflow chip', () => {
    const members = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => member(n));
    const { container } = render(() => <Facepile members={() => members} cap={5} />);

    expect(container.querySelectorAll('.shell-facepile-face')).toHaveLength(5);

    const overflow = container.querySelector('.shell-facepile-overflow');
    expect(overflow?.textContent).toBe('+2');
    expect(overflow?.getAttribute('title')).toBe('2 more');

    // Group label still reflects the *total*, not just the visible faces.
    expect(screen.getByRole('group', { name: '7 people here' })).toBeTruthy();
  });

  it('omits the overflow chip when everyone fits', () => {
    const members = [member('a'), member('b')];
    const { container } = render(() => <Facepile members={() => members} cap={5} />);
    expect(container.querySelector('.shell-facepile-overflow')).toBeNull();
  });

  it('marks away members with an away class and title suffix', () => {
    const members = [member('here'), member('gone', [], true)];
    const { container } = render(() => <Facepile members={() => members} />);

    const awayFace = Array.from(container.querySelectorAll('.shell-facepile-face')).find(
      (f) => f.getAttribute('title') === 'gone — away',
    );
    expect(awayFace).toBeTruthy();
    expect(awayFace?.querySelector('.shell-facepile-avatar--away')).toBeTruthy();
  });
});
