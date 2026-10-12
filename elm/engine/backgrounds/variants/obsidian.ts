// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundVariant } from '../engine';
import { composeSignature } from './layers';

/**
 * Obsidian — the pure AMOLED still of the Paper Still family. Its old single
 * `--ink` fill is retired for the full signature stack (luminance-capped ground
 * → empty ink → paper grain → vignette → vermilion edge seal). The empty ink
 * layer is intentional: this preset *is* the paper alone, and doubles as the
 * reduced-motion/battery rendering of every theme when a scene is frozen to
 * its calmest form. Solid: one frame.
 */
export const obsidian = {
  id: 'obsidian',
  label: 'Obsidian',
  kind: 'solid',
  init(_ctx) {},
  frame(ctx) {
    composeSignature(ctx, 0, () => {
      // No ink — ground + grain + vignette + seal carry the still.
    });
  },
  dispose() {},
} satisfies BackgroundVariant;
