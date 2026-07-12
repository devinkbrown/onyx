// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundVariant } from '../engine';
import { composeSignature } from './layers';
import { drawPyriteFlecks, strokeKintsugiVein } from './utils';

/**
 * Gold Veins — the default background, now routed through the shared "Ink on
 * Living Paper" signature pipeline (capped ground → ink layer → washi grain →
 * vignette → the single vermilion seal). Its ink layer is the gold kintsugi
 * vein tracery + pyrite flecks; the ground, grain, vignette, and the one hot
 * vermilion accent are contributed by the shared pipeline.
 */
export const kintsugiVeins = {
  id: 'kintsugi-veins',
  label: 'Gold Veins',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    composeSignature(ctx, time, (theme, t) => {
      const veinCount = Math.max(4, Math.floor(9 * ctx.qualityScale));
      for (let i = 0; i < veinCount; i += 1) {
        strokeKintsugiVein(ctx, theme, i + 1, t, i < 3 ? 1 : 0.58);
      }
      drawPyriteFlecks(ctx, theme, t, 110);
    });
  },
  dispose() {},
} satisfies BackgroundVariant;
