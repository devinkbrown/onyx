// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';

import {
  CANONICAL_ROADMAP_PATH,
  RoadmapBridge,
  redirectToCanonicalRoadmap,
} from './Roadmap';

describe('RoadmapRoute', () => {
  it('contains no duplicate roadmap catalogue and links to the canonical page', () => {
    render(() => <RoadmapBridge />);

    expect(screen.getByRole('heading', { name: /opening the onyx roadmap/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open roadmap/i })).toHaveAttribute(
      'href',
      CANONICAL_ROADMAP_PATH,
    );
    expect(screen.queryByText(/Phase 1/i)).not.toBeInTheDocument();
  });

  it('uses a hard document navigation so the SPA cannot render a second roadmap', () => {
    const replace = vi.fn();
    redirectToCanonicalRoadmap(replace);
    expect(replace).toHaveBeenCalledWith(CANONICAL_ROADMAP_PATH);
  });
});
