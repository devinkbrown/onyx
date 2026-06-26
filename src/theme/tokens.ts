/**
 * Editable token groups for the Theme Studio.
 *
 * Each `StudioToken` describes one CSS custom property that the live editor
 * can present as an interactive control.  Tokens are grouped by concern so
 * the Studio can render them in logical sections.
 */

export type StudioTokenType =
  | 'color'     // colour picker
  | 'radius'    // range slider (px, visible as border-radius preview)
  | 'duration'  // range slider (ms, controls transition speed)
  | 'font'      // font-family select / free-text
  | 'easing';   // CSS easing string (cubic-bezier text)

export type StudioToken = {
  /** The CSS custom property name (e.g. `--gold`). */
  property: string;
  /** Human-readable label for the control. */
  label: string;
  /** Brief tooltip / hint text. */
  hint: string;
  /** Control type the Studio should render. */
  type: StudioTokenType;
  /**
   * Optional step value for sliders.
   * For `radius` and `duration` tokens this is in their respective units.
   */
  step?: number;
  /** Minimum for numeric sliders. */
  min?: number;
  /** Maximum for numeric sliders. */
  max?: number;
};

export type StudioGroup = {
  id: string;
  label: string;
  tokens: StudioToken[];
};

// ---------------------------------------------------------------------------
// Ground / surfaces
// ---------------------------------------------------------------------------

const surfaceGroup: StudioGroup = {
  id: 'surfaces',
  label: 'Surfaces',
  tokens: [
    {
      property: '--ink',
      label: 'Ink (base ground)',
      hint: 'The darkest / deepest background layer.',
      type: 'color',
    },
    {
      property: '--ink-2',
      label: 'Ink-2',
      hint: 'Second deepest ground layer.',
      type: 'color',
    },
    {
      property: '--stone',
      label: 'Stone',
      hint: 'First visible surface (cards, panels).',
      type: 'color',
    },
    {
      property: '--stone-2',
      label: 'Stone-2',
      hint: 'Raised surface (selected / hover states).',
      type: 'color',
    },
    {
      property: '--stone-3',
      label: 'Stone-3',
      hint: 'Highest surface (floating elements).',
      type: 'color',
    },
  ],
};

// ---------------------------------------------------------------------------
// Accent colours
// ---------------------------------------------------------------------------

const accentGroup: StudioGroup = {
  id: 'accents',
  label: 'Accents',
  tokens: [
    {
      property: '--lapis',
      label: 'Lapis (primary accent)',
      hint: 'Deep ultramarine — the dominant cool accent.',
      type: 'color',
    },
    {
      property: '--lapis-bright',
      label: 'Lapis bright',
      hint: 'Elevated lapis for interactive focus and highlights.',
      type: 'color',
    },
    {
      property: '--lapis-deep',
      label: 'Lapis deep',
      hint: 'Shadowed lapis for backgrounds behind accent elements.',
      type: 'color',
    },
    {
      property: '--gold',
      label: 'Gold (kintsugi seams)',
      hint: 'Pyrite / kintsugi warm gold — labels, seam lines, dividers.',
      type: 'color',
    },
    {
      property: '--gold-bright',
      label: 'Gold bright',
      hint: 'Elevated gold for interactive highlights and primary buttons.',
      type: 'color',
    },
    {
      property: '--gold-deep',
      label: 'Gold deep',
      hint: 'Shadowed gold for drop-shadows beneath gold elements.',
      type: 'color',
    },
    {
      property: '--shu',
      label: 'Vermilion',
      hint: 'Single hot accent — use very sparingly (danger, badges).',
      type: 'color',
    },
    {
      property: '--shu-bright',
      label: 'Shu bright',
      hint: 'Elevated vermilion for interactive shu states.',
      type: 'color',
    },
  ],
};

// ---------------------------------------------------------------------------
// Text colours
// ---------------------------------------------------------------------------

const textGroup: StudioGroup = {
  id: 'text',
  label: 'Text',
  tokens: [
    {
      property: '--washi',
      label: 'Washi (primary text)',
      hint: 'Warm washi-paper tone. Must pass WCAG AA on --ink.',
      type: 'color',
    },
    {
      property: '--washi-dim',
      label: 'Washi dim (secondary text)',
      hint: 'Dimmed washi for body copy and supporting text.',
      type: 'color',
    },
    {
      property: '--washi-mute',
      label: 'Washi mute (tertiary text)',
      hint: 'Least prominent text — timestamps, metadata.',
      type: 'color',
    },
    {
      property: '--ok',
      label: 'Status: OK',
      hint: 'Success / online / positive status colour.',
      type: 'color',
    },
  ],
};

// ---------------------------------------------------------------------------
// Seams + structure
// ---------------------------------------------------------------------------

const seamGroup: StudioGroup = {
  id: 'seams',
  label: 'Seams',
  tokens: [
    {
      property: '--stone-line',
      label: 'Stone line',
      hint: 'Subtle divider for adjacent stone surfaces.',
      type: 'color',
    },
  ],
};

// ---------------------------------------------------------------------------
// Shape / radius
// ---------------------------------------------------------------------------

const radiusGroup: StudioGroup = {
  id: 'radius',
  label: 'Radius',
  tokens: [
    {
      property: '--r-0',
      label: 'Sharp (r-0)',
      hint: 'Base radius — 0 px keeps the brutalist identity.',
      type: 'radius',
      min: 0,
      max: 12,
      step: 1,
    },
    {
      property: '--r-sm',
      label: 'Small (r-sm)',
      hint: 'Chips and small badges.',
      type: 'radius',
      min: 0,
      max: 12,
      step: 1,
    },
    {
      property: '--r-md',
      label: 'Medium (r-md)',
      hint: 'Cards and panels.',
      type: 'radius',
      min: 0,
      max: 16,
      step: 1,
    },
  ],
};

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

const motionGroup: StudioGroup = {
  id: 'motion',
  label: 'Motion',
  tokens: [
    {
      property: '--dur',
      label: 'Duration',
      hint: 'Base transition duration in milliseconds.',
      type: 'duration',
      min: 0,
      max: 600,
      step: 20,
    },
    {
      property: '--ease',
      label: 'Easing',
      hint: 'CSS cubic-bezier easing function.',
      type: 'easing',
    },
  ],
};

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

const fontGroup: StudioGroup = {
  id: 'fonts',
  label: 'Fonts',
  tokens: [
    {
      property: '--font-mono',
      label: 'Mono stack',
      hint: 'Monospace font — terminal labels, code, controls.',
      type: 'font',
    },
    {
      property: '--font-display',
      label: 'Display stack',
      hint: 'Headline / display font — brutalist editorial.',
      type: 'font',
    },
    {
      property: '--font-sans',
      label: 'Sans stack',
      hint: 'Body sans-serif for prose and UI copy.',
      type: 'font',
    },
    {
      property: '--font-serif',
      label: 'Serif stack',
      hint: 'Humanist serif for editorial and supporting text.',
      type: 'font',
    },
  ],
};

// ---------------------------------------------------------------------------
// Exported registry
// ---------------------------------------------------------------------------

export const STUDIO_GROUPS: StudioGroup[] = [
  surfaceGroup,
  accentGroup,
  textGroup,
  seamGroup,
  radiusGroup,
  motionGroup,
  fontGroup,
];

/** Flat list of all editable tokens (useful for validation and import/export). */
export const ALL_STUDIO_TOKENS: StudioToken[] = STUDIO_GROUPS.flatMap(
  (group) => group.tokens,
);

/** Set of all editable property names. */
export const EDITABLE_PROPERTIES: ReadonlySet<string> = new Set(
  ALL_STUDIO_TOKENS.map((t) => t.property),
);
