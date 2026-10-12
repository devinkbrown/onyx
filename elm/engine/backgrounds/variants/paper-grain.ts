// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundFrameContext, BackgroundVariant } from '../engine';
import { composeSignature } from './layers';
import type { BackgroundTheme } from './utils';
import { rgba, seeded } from './utils';

/**
 * Paper Grain — the ink-on-paper still, routed through the shared signature
 * pipeline. Its old light-paper wash is retired (a bright ground fought the
 * legibility contract); the ground now comes from the shared luminance-capped
 * tokens, and the ink layer is the drifting gold paper fibres. Solid: one frame.
 */
export const paperGrain = {
  id: 'paper-grain',
  label: 'Paper grain',
  kind: 'solid',
  init(_ctx) {},
  frame(ctx) {
    composeSignature(ctx, 0, (theme) => {
      drawFibres(ctx, theme);
    });
  },
  dispose() {},
} satisfies BackgroundVariant;

function drawFibres(ctx: BackgroundFrameContext, theme: BackgroundTheme): void {
  const c = ctx.context;
  c.save();
  c.strokeStyle = rgba(theme.goldDeep, 0.24);
  c.lineWidth = 0.8;
  for (let i = 0; i < Math.floor(24 * ctx.qualityScale); i += 1) {
    const y = seeded(i + 650) * ctx.height;
    c.globalAlpha = 0.14 + seeded(i + 651) * 0.18;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(ctx.width, y + (seeded(i + 652) - 0.5) * 24);
    c.stroke();
  }
  c.restore();
}
