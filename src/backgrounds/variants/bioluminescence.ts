// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackgroundVariant } from '../engine';
import { clearCanvas, drawGrain, mix, readBackgroundTheme, rgba, seeded } from './utils';

/**
 * Bioluminescence — a slow field of glowing motes drifting up through deep
 * water. Azure crests with the occasional champagne spark; each mote twinkles
 * on its own phase. Deterministic seeding keeps it stable across frames, and a
 * soft two-ring glow avoids per-particle shadowBlur cost.
 */
export const bioluminescence = {
  id: 'bioluminescence',
  label: 'Bioluminescence',
  kind: 'animated',
  init(ctx) {
    this.frame(ctx, 0);
  },
  frame(ctx, time) {
    const theme = readBackgroundTheme(ctx.canvas);
    const c = ctx.context;

    const ground = c.createLinearGradient(0, 0, 0, ctx.height);
    ground.addColorStop(0, mix(theme.stone2, theme.ink, 0.55));
    ground.addColorStop(0.5, theme.ink);
    ground.addColorStop(1, theme.ink2);

    clearCanvas(ctx);
    c.fillStyle = ground;
    c.fillRect(0, 0, ctx.width, ctx.height);

    c.save();
    c.globalCompositeOperation = 'screen';

    const count = Math.max(36, Math.floor(150 * ctx.qualityScale));
    for (let i = 0; i < count; i += 1) {
      const sx = seeded(i * 2 + 1);
      const sy = seeded(i * 2 + 2);
      // Slow upward drift, wrapped; horizontal sway on its own phase.
      const drift = (sy + time * 0.000013 * (0.4 + sx)) % 1;
      const x = sx * ctx.width + Math.sin(time * 0.00018 + i * 1.3) * 10;
      const y = (1 - drift) * ctx.height;
      const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(time * 0.0009 + i * 1.7));
      const r = (0.6 + sx * 1.7) * (0.7 + twinkle);
      const colour = i % 9 === 0 ? theme.goldBright : i % 3 === 0 ? theme.lapisBright : theme.lapis;

      // Soft halo, then bright core.
      c.beginPath();
      c.arc(x, y, r * 3.4, 0, Math.PI * 2);
      c.fillStyle = rgba(colour, 0.05 * twinkle);
      c.fill();

      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fillStyle = rgba(colour, 0.35 + twinkle * 0.45);
      c.fill();
    }

    c.restore();
    drawGrain(ctx, theme, 0.5);
  },
  dispose() {},
} satisfies BackgroundVariant;
