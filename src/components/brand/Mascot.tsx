// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Mascot — the Onyx network mark.
 *
 * A sleek, coiled serpent-dragon with a smooth onyx body, an azure underglow, a
 * bioluminescent dorsal line, and a single champagne-gold eye. Calm and refined,
 * not fierce — the face of the network. (Historical engine codename: Onyx Server.)
 *
 * Pure inline SVG, no external assets. It themes itself from the Onyx CSS
 * custom properties (--ink, --lapis, --lapis-bright, --gold-bright, --washi),
 * so it follows whatever theme the document is set to. Crisp at any size and
 * accessible (role="img" + <title>).
 *
 * Variants:
 *   - mark  ≈ 1em compact emblem (nav / footer brand, inline with text)
 *   - hero  = larger, expressive pose for the hero
 *   - full  = same expressive drawing, default sizing for standalone use
 */

interface MascotProps {
  variant?: 'mark' | 'hero' | 'full';
  class?: string;
  'aria-label'?: string;
}

/* Co-located, self-contained styling so the mascot works on any page that
   imports it. Sizing follows the variant; motion is gentle and freezes under
   prefers-reduced-motion. */
const MASCOT_CSS = `
.mascot { display: inline-block; overflow: visible; color: var(--lapis-bright); }
.mascot--mark { width: 1em; height: 1em; vertical-align: -0.16em; }
.mascot--hero { width: clamp(140px, 26vw, 280px); height: auto; }
.mascot--full { width: clamp(96px, 18vw, 180px); height: auto; }

.mascot .mascot-underglow { transform-origin: 32px 40px; animation: mascot-breathe 6.5s var(--ease, ease-in-out) infinite; }
.mascot .mascot-dorsal { stroke-dasharray: 2.6 7; animation: mascot-current 7s linear infinite; filter: drop-shadow(0 0 2px var(--lapis-bright)); }
.mascot .mascot-motes circle { animation: mascot-drift 5.5s var(--ease, ease-in-out) infinite; }
.mascot .mascot-motes circle:nth-child(2) { animation-delay: 0.9s; }
.mascot .mascot-motes circle:nth-child(3) { animation-delay: 1.8s; }
.mascot .mascot-eye { filter: drop-shadow(0 0 1.4px var(--gold-bright)); }

@keyframes mascot-breathe { 0%, 100% { opacity: 0.62; transform: scale(0.97); } 50% { opacity: 1; transform: scale(1.04); } }
@keyframes mascot-current { to { stroke-dashoffset: -19.2; } }
@keyframes mascot-drift { 0%, 100% { opacity: 0.4; transform: translate(0, 0); } 50% { opacity: 1; transform: translate(-2px, -3px); } }

@media (prefers-reduced-motion: reduce) {
  .mascot .mascot-underglow,
  .mascot .mascot-dorsal,
  .mascot .mascot-motes circle { animation: none !important; }
}
`;

export function Mascot(props: MascotProps) {
  const variant = (): 'mark' | 'hero' | 'full' => props.variant ?? 'mark';
  const label = (): string =>
    props['aria-label'] ?? 'The Onyx water-dragon mascot';

  // Stable per-instance gradient ids so multiple mascots can coexist on a page
  // without clobbering one another's <defs>.
  const uid = Math.random().toString(36).slice(2, 8);
  const bodyId = `m-body-${uid}`;
  const glowId = `m-glow-${uid}`;
  const dorsalId = `m-dorsal-${uid}`;

  const sizeClass = (): string => {
    switch (variant()) {
      case 'mark':
        return 'mascot mascot--mark';
      case 'hero':
        return 'mascot mascot--hero';
      default:
        return 'mascot mascot--full';
    }
  };

  return (
    <svg
      class={`${sizeClass()}${props.class ? ` ${props.class}` : ''}`}
      viewBox="0 0 64 64"
      role="img"
      aria-label={label()}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{label()}</title>
      <style>{MASCOT_CSS}</style>
      <defs>
        {/* Smooth onyx body with a cool azure sheen down its length. */}
        <linearGradient id={bodyId} x1="14%" y1="12%" x2="82%" y2="92%">
          <stop offset="0%" stop-color="var(--stone-3, #173550)" />
          <stop offset="46%" stop-color="var(--stone, #08182a)" />
          <stop offset="100%" stop-color="var(--ink, #02060d)" />
        </linearGradient>
        {/* Bioluminescent underglow that pools beneath the coil. */}
        <radialGradient id={glowId} cx="50%" cy="58%" r="55%">
          <stop offset="0%" stop-color="var(--lapis-bright, #7fe2ff)" stop-opacity="0.55" />
          <stop offset="55%" stop-color="var(--lapis, #2bb4f0)" stop-opacity="0.22" />
          <stop offset="100%" stop-color="var(--lapis, #2bb4f0)" stop-opacity="0" />
        </radialGradient>
        {/* The glowing dorsal line that runs the spine. */}
        <linearGradient id={dorsalId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="var(--lapis, #2bb4f0)" />
          <stop offset="60%" stop-color="var(--lapis-bright, #7fe2ff)" />
          <stop offset="100%" stop-color="var(--lapis-bright, #7fe2ff)" />
        </linearGradient>
      </defs>

      {/* Azure underglow — the bioluminescence the body sits in. */}
      <ellipse
        class="mascot-underglow"
        cx="32"
        cy="40"
        rx="25"
        ry="20"
        fill={`url(#${glowId})`}
      />

      {/* ── The coiled water-dragon ──
         A single sleek body: it sweeps up the right, arcs over into a calm head
         at the upper-left, and its tail curls back through the centre — a relaxed
         spiral, suggesting water and a creature at ease. */}
      <g class="mascot-creature">
        {/* Body — a smooth coiled ribbon. */}
        <path
          fill={`url(#${bodyId})`}
          stroke="var(--lapis-deep, #0e6aa8)"
          stroke-width="0.6"
          stroke-opacity="0.5"
          d="M20 17
             C 13 20, 11 28, 16 33
             C 21 38, 31 37, 35 31
             C 38 26, 35 22, 31 23
             C 28 24, 27 27, 29 29
             C 24 31, 21 27, 23 23
             C 25 18, 32 16, 38 19
             C 47 24, 49 36, 42 45
             C 35 53, 22 53, 15 47
             C 13 45, 12 43, 11 41
             C 13 47, 18 53, 26 55
             C 40 58, 53 48, 53 35
             C 53 22, 42 12, 30 13
             C 26 13, 22 15, 20 17 Z"
        />

        {/* Bioluminescent dorsal line tracing the outer back of the coil. */}
        <path
          class="mascot-dorsal"
          fill="none"
          stroke={`url(#${dorsalId})`}
          stroke-width="1.7"
          stroke-linecap="round"
          d="M30 13
             C 42 12, 53 22, 53 35
             C 53 48, 40 58, 26 55
             C 18 53, 13 47, 11 41"
        />

        {/* A trio of soft dorsal fins / crest ridges along the spine. */}
        <g
          class="mascot-fins"
          fill="none"
          stroke="var(--lapis-bright, #7fe2ff)"
          stroke-width="1.1"
          stroke-linecap="round"
          stroke-opacity="0.85"
        >
          <path d="M50 24 q 3 -2.5 5 -1" />
          <path d="M53.5 34 q 3.4 -0.6 5 1" />
          <path d="M50 44 q 3.2 1.4 4.4 3.4" />
        </g>

        {/* Head — calm and rounded, set at the upper-left where the body rises. */}
        <path
          fill={`url(#${bodyId})`}
          stroke="var(--lapis-deep, #0e6aa8)"
          stroke-width="0.6"
          stroke-opacity="0.5"
          d="M20 17
             C 15 18, 13 22, 15 26
             C 17 30, 23 31, 27 28
             C 31 25, 31 19, 27 16
             C 25 15, 22 16, 20 17 Z"
        />

        {/* A pair of trailing whiskers — water-dragon barbels, soft and curved. */}
        <g
          class="mascot-whiskers"
          fill="none"
          stroke="var(--lapis-bright, #7fe2ff)"
          stroke-width="0.9"
          stroke-linecap="round"
          stroke-opacity="0.75"
        >
          <path d="M14 24 C 9 25, 6 27, 4 31" />
          <path d="M15 27 C 11 29, 9 32, 8 36" />
        </g>

        {/* Single champagne-gold eye — the one warm accent. */}
        <circle class="mascot-eye" cx="21.5" cy="22.5" r="2.1" fill="var(--gold-bright, #f2dca0)" />
        <circle cx="22.2" cy="21.9" r="0.7" fill="var(--ink, #02060d)" />

        {/* Tiny bioluminescent motes drifting off the tail. */}
        <g class="mascot-motes" fill="var(--lapis-bright, #7fe2ff)">
          <circle cx="9" cy="44" r="1" />
          <circle cx="6" cy="40" r="0.7" opacity="0.7" />
          <circle cx="11" cy="38" r="0.6" opacity="0.5" />
        </g>
      </g>
    </svg>
  );
}

export default Mascot;
