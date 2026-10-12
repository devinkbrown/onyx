// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundVariant } from '../engine';
import { composeSignature } from './layers';
import { drawPyriteFlecks, strokeGoldVein } from './utils';

/**
 * Gold Veins — the default background, now routed through the shared "Ink on
 * Living Paper" signature pipeline (capped ground → ink layer → paper grain →
 * vignette → the single vermilion seal). Its ink layer is the gold gold
 * vein tracery + pyrite flecks; the ground, grain, vignette, and the one hot
 * vermilion accent are contributed by the shared pipeline.
 */
export const goldVeins = {
  id: 'gold-veins',
  label: 'Gold Veins',
  kind: 'animated',
  init(_ctx) {},
  frame(ctx, time) {
    composeSignature(ctx, time, (theme, t) => {
      const veinCount = Math.max(4, Math.floor(9 * ctx.qualityScale));
      for (let i = 0; i < veinCount; i += 1) {
        strokeGoldVein(ctx, theme, i + 1, t, i < 3 ? 1 : 0.58);
      }
      drawPyriteFlecks(ctx, theme, t, 110);
    });
  },
  dispose() {},
} satisfies BackgroundVariant;
