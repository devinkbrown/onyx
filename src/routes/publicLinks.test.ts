// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const authoredSurfaces = [
  'src/app/Appearance.tsx',
  'src/routes/About.tsx',
  'src/routes/Invite.tsx',
  'src/routes/Landing.tsx',
  'src/routes/Roadmap.tsx',
  'src/routes/Stats.tsx',
  'src/routes/Status.tsx',
  'src/shell/AppearancePanel.tsx',
  'src/shell/ServerRail.tsx',
] as const;

describe('authored public route links', () => {
  it('uses final directory URLs without changing root or fragment links', () => {
    const slashless: string[] = [];

    for (const path of authoredSurfaces) {
      const source = readFileSync(join(root, path), 'utf8');
      for (const match of source.matchAll(/href="\/(app|about|appearance|invite|roadmap|status|stats)(?=[?"#])/g)) {
        slashless.push(`${path}:${match[0]}`);
      }
    }

    expect(slashless).toEqual([]);
  });
});
