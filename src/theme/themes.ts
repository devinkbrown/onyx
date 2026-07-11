// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Onyx theming engine — curated theme definitions.
 *
 * Each theme is a typed map of CSS-custom-property overrides keyed to the
 * token names defined in src/styles/tokens.css.  A theme only needs to
 * declare the vars it wants to change; the flagship `onyx` theme declares
 * every token so it can serve as an exhaustive reference.
 *
 * Palette method (2026 refinement): every colour story below was produced by
 * the OKLCH engine in paletteFactory.ts — `generatePalette(seed)` builds the
 * coherent AA-clean base (perceptual ground ramp tinted toward the primary
 * hue, accent triads on even lightness steps, text solved for the contrast
 * target), then a handful of soul tokens are overlaid per theme and the map
 * is re-run through `enforceAA`.  The seed and overlays are recorded in each
 * theme's comment so the palette can be regenerated and re-tuned.  The values
 * here are the resolved static hex output — no runtime generation.
 *
 * Identity constraints (ALL themes must honour):
 *   - WCAG AA contrast on all text / surface pairs (auditPalette passes)
 *   - No purple / indigo in any palette position (OKLCH hue 258–342 banned)
 *   - No backdrop-filter blur (glassmorphism) in token values
 *   - No Inter, no neon glow, no AI-style gradient language
 *   - Animate compositor-friendly properties only (transform, opacity, clip-path)
 */

export type TokenMap = Record<string, string>;

export type ThemeMeta = {
  /** Machine ID used in data-theme attribute and localStorage. */
  id: ThemeId;
  /** Human-readable display name. */
  label: string;
  /** Short flavour description. */
  description: string;
  /** Light or dark — written to the `color-scheme` property. */
  scheme: 'light' | 'dark';
  /**
   * The animated background variant this theme pairs with by default.
   * Kept as a plain string (a background variant id from src/backgrounds)
   * to avoid coupling the theme registry to the backgrounds module.
   */
  signatureBg: string;
  /** The CSS custom property overrides for this theme. */
  tokens: TokenMap;
};

export type ThemeId =
  | 'ocean'
  | 'tide'
  | 'abyss'
  | 'reef'
  | 'onyx'
  | 'obsidian'
  | 'pearl'
  | 'sumi'
  | 'shu'
  | 'hisui'
  | 'pine'
  | 'kohaku'
  | 'terracotta'
  | 'vermillion'
  | 'teal'
  | 'slate'
  | 'frost';

// ---------------------------------------------------------------------------
// Flagship: ocean — deep-water dark luxury (electric azure × bioluminescence ×
// glacier ice). Formalises what lives in tokens.css as the default :root.
// Seed { dark, primary 232, accent 205, depth .8, vibrancy .85, warmth -.05,
// contrast 11 } + soul: electric azure triad, icy glacier triad, coral shu.
// ---------------------------------------------------------------------------
const oceanTokens: TokenMap = {
  // Ground — abyssal trench → mid depth → near-surface crests (azure-tinted ramp)
  '--ink':        '#000306',
  '--ink-2':      '#00050a',
  '--stone':      '#000e17',
  '--stone-2':    '#051821',
  '--stone-3':    '#10232c',
  '--stone-line': '#0f2d3b',

  // Azure — electric sky-blue current + bioluminescent crest (primary)
  '--lapis':       '#00ace9',
  '--lapis-bright':'#87d6ff',
  '--lapis-deep':  '#00668c',

  // Glacier — icy pale azure, second accent (was champagne gold)
  '--gold':       '#6bc8d5',
  '--gold-bright':'#a2edf7',
  '--gold-deep':  '#35818b',

  // Coral — the single hot accent (danger / badges)
  '--shu':        '#ff6f61',
  '--shu-bright': '#ff9484',

  // Text — sea-foam ivory over deep water
  '--washi':      '#d1e1e9',
  '--washi-dim':  '#8c9ba3',
  '--washi-mute': '#536771',

  // Status
  '--ok':      '#5bc78e',
  '--warn':    '#e6d08c', // warnings stay WARM — decoupled from the glacier second accent
  '--danger':  'var(--shu)',

  // Seams (bioluminescent current lines) + bands (pale tide)
  '--seam':       'color-mix(in oklab, var(--lapis) 42%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 16%, transparent)',
  '--line':       'color-mix(in oklab, var(--washi) 14%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--washi) 7%, transparent)',

  // Radius — fluid, elegant
  '--r-0':    '0px',
  '--r-sm':   '5px',
  '--r-md':   '11px',
  '--r-pill': '999px',

  // Motion
  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '260ms',

  // Typography
  '--font-mono':    "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  '--font-display': "'Anton', 'Arial Narrow', 'Helvetica Neue', sans-serif",
  '--font-sans':    "'Instrument Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-serif':   "'Fraunces Variable', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
};

// ---------------------------------------------------------------------------
// tide — Ocean sub-variant: brighter, shallower water. Sunlit azure surfaces
// lift toward the surface; a more luminous crest and pale sand-cyan shallows.
// Seed { dark, primary 228, accent 200, depth .32, vibrancy .8, warmth 0,
// contrast 10 } + soul: sunlit azure triad brighter than the flagship.
// ---------------------------------------------------------------------------
const tideTokens: TokenMap = {
  // Ground — shallows: lifted, lighter blue water (still dark-scheme)
  '--ink':        '#00060b',
  '--ink-2':      '#000a11',
  '--stone':      '#051820',
  '--stone-2':    '#12262e',
  '--stone-3':    '#21343d',
  '--stone-line': '#254350',

  // Azure — brighter electric current; crest pushed toward sky-white
  '--lapis':       '#00b8ed',
  '--lapis-bright':'#9ae0ff',
  '--lapis-deep':  '#007093',

  // Sand-cyan — pale sunlit shallow-water second accent
  '--gold':       '#5dcbd1',
  '--gold-bright':'#92f1f6',
  '--gold-deep':  '#3e999d',

  // Coral — the single hot accent (danger / badges)
  '--shu':        '#ff7a6c',
  '--shu-bright': '#ffa193',

  // Text — luminous sea-foam over sunlit water
  '--washi':      '#d1e1e9',
  '--washi-dim':  '#8c9ba2',
  '--washi-mute': '#536770',

  // Status
  '--ok':      '#5bc78e',
  '--warn':    '#e6d08c', // warnings stay WARM — decoupled from the sand-cyan second accent
  '--danger':  'var(--shu)',

  // Seams (brighter current lines) + bands (pale tide)
  '--seam':       'color-mix(in oklab, var(--lapis) 50%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 20%, transparent)',
  '--line':       'color-mix(in oklab, var(--washi) 16%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--washi) 8%, transparent)',

  // Radius — fluid, elegant
  '--r-0':    '0px',
  '--r-sm':   '6px',
  '--r-md':   '12px',
  '--r-pill': '999px',

  // Motion
  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '260ms',

  // Typography
  '--font-mono':    "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  '--font-display': "'Anton', 'Arial Narrow', 'Helvetica Neue', sans-serif",
  '--font-sans':    "'Instrument Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-serif':   "'Fraunces Variable', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
};

// ---------------------------------------------------------------------------
// abyss — Ocean sub-variant: near-AMOLED deep trench. Almost pure black water,
// restrained azure that glows rather than floods, high text contrast.
// Seed { dark, primary 236, accent 210, depth 1, vibrancy .5, warmth -.1,
// contrast 13 } + soul: hand-ramped near-black grounds, restrained cyan second.
// ---------------------------------------------------------------------------
const abyssTokens: TokenMap = {
  // Ground — the bottom of the trench: near-pure black, faint blue undertone
  '--ink':        '#000102',
  '--ink-2':      '#000103',
  '--stone':      '#010508',
  '--stone-2':    '#050c10',
  '--stone-3':    '#0c1418',
  '--stone-line': '#101c22',

  // Azure — restrained, deep; a glow in the dark, not a flood
  '--lapis':       '#0091cb',
  '--lapis-bright':'#58c4ff',
  '--lapis-deep':  '#005477',

  // Deep-water cyan — restrained second accent, no treasure glint down here
  '--gold':       '#51a0ad',
  '--gold-bright':'#88cedb',
  '--gold-deep':  '#236671',

  // Coral — the single hot accent (danger / badges)
  '--shu':        '#f0594b',
  '--shu-bright': '#ff7c6e',

  // Text — high-contrast sea-foam ivory over the trench
  '--washi':      '#d4e0e8',
  '--washi-dim':  '#8f9aa1',
  '--washi-mute': '#56666f',

  // Status
  '--ok':      '#5bc78e',
  '--warn':    '#e6d08c', // warnings stay WARM — decoupled from the cyan second accent
  '--danger':  'var(--shu)',

  // Seams (restrained current lines) + bands (faint tide)
  '--seam':       'color-mix(in oklab, var(--lapis) 36%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 13%, transparent)',
  '--line':       'color-mix(in oklab, var(--washi) 11%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--washi) 5%, transparent)',

  // Radius — taut, deep
  '--r-0':    '0px',
  '--r-sm':   '3px',
  '--r-md':   '8px',
  '--r-pill': '999px',

  // Motion
  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '240ms',

  // Typography
  '--font-mono':    "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  '--font-display': "'Anton', 'Arial Narrow', 'Helvetica Neue', sans-serif",
  '--font-sans':    "'Instrument Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-serif':   "'Fraunces Variable', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
};

// ---------------------------------------------------------------------------
// reef — Ocean sub-variant: the base deep water with a living-coral lean.
// Azure stays the primary current; the second accent is CORAL — the warmth of
// the reef itself. Seed { dark, primary 226, accent 38, depth .75,
// vibrancy .7, warmth .1, contrast 10 } + soul: peach-coral second, hot coral shu.
// ---------------------------------------------------------------------------
const reefTokens: TokenMap = {
  // Ground — deep water, faintly warmed strata (a step shallower than the flagship)
  '--ink':        '#000407',
  '--ink-2':      '#00060a',
  '--stone':      '#010f16',
  '--stone-2':    '#081a21',
  '--stone-3':    '#13252c',
  '--stone-line': '#142f3b',

  // Azure — still the primary current (kept close to the flagship)
  '--lapis':       '#0094bc',
  '--lapis-bright':'#0bc9ff',
  '--lapis-deep':  '#00556e',

  // Coral — the reef's own warmth as the second accent (not gold)
  '--gold':       '#f19173',
  '--gold-bright':'#ffc0ac',
  '--gold-deep':  '#a9573d',

  // Coral — promoted from rare danger accent to a visible warm secondary
  '--shu':        '#ff6f5e',
  '--shu-bright': '#ff9a86',

  // Text — sea-foam ivory, faintly warmed
  '--washi':      '#d2e1e8',
  '--washi-dim':  '#8d9ba2',
  '--washi-mute': '#54676f',

  // Status
  '--ok':      '#5bc78e',
  '--warn':    '#e6d08c', // warnings stay WARM — in-family with the coral second accent
  '--danger':  'var(--shu)',

  // Seams — azure current lines (primary hue), coral kept to accents
  '--seam':       'color-mix(in oklab, var(--lapis) 40%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 16%, transparent)',
  '--line':       'color-mix(in oklab, var(--washi) 14%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--gold) 12%, transparent)',

  // Radius — fluid, elegant
  '--r-0':    '0px',
  '--r-sm':   '5px',
  '--r-md':   '11px',
  '--r-pill': '999px',

  // Motion
  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '260ms',

  // Typography
  '--font-mono':    "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  '--font-display': "'Anton', 'Arial Narrow', 'Helvetica Neue', sans-serif",
  '--font-sans':    "'Instrument Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-serif':   "'Fraunces Variable', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
};

// ---------------------------------------------------------------------------
// onyx — Onyx: black banded stone × gold inlay × terminal (dark).
// Seed { dark, primary 250, accent 85, depth .9, vibrancy .35, warmth 0,
// contrast 10 } + soul: near-neutral hand-ramped black stone, silvery
// moonstone triad, the REAL gold triad (#c9a24a family), warm bone text.
// ---------------------------------------------------------------------------
const onyxTokens: TokenMap = {
  // Ground — onyx black → graphite strata (near-neutral, faintest cool cast)
  '--ink':        '#000101',
  '--ink-2':      '#010203',
  '--stone':      '#050709',
  '--stone-2':    '#0d0f12',
  '--stone-3':    '#16191c',
  '--stone-line': '#1e2226',

  // Moonstone — cold silver-blue sheen
  '--lapis':       '#6996c5',
  '--lapis-bright':'#9cc2ea',
  '--lapis-deep':  '#385b7e',

  // Gold — champagne brass inlay (the one gold theme)
  '--gold':       '#c9a24a',
  '--gold-bright':'#f1d489',
  '--gold-deep':  '#8c6c2c',

  // Garnet accent (theme token: --shu)
  '--shu':        '#e95145',
  '--shu-bright': '#ff7f71',

  // Text — bone / ivory over black
  '--washi':      '#eae8e0',
  '--washi-dim':  '#a4a19a',
  '--washi-mute': '#6e6c63',

  // Status
  '--ok':      '#5bc78e',
  '--warn':    '#e6d08c', // warnings stay WARM — in-family with the gold inlay
  '--danger':  'var(--shu)',

  // Seams (gold inlay) + bands (pale strata)
  '--seam':       'color-mix(in oklab, var(--gold) 40%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--gold) 15%, transparent)',
  '--line':       'color-mix(in oklab, var(--washi) 13%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--washi) 6%, transparent)',

  // Radius
  '--r-0':    '0px',
  '--r-sm':   '2px',
  '--r-md':   '4px',
  '--r-pill': '999px',

  // Motion
  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '240ms',

  // Typography
  '--font-mono':    "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  '--font-display': "'Anton', 'Arial Narrow', 'Helvetica Neue', sans-serif",
  '--font-sans':    "'Instrument Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-serif':   "'Fraunces Variable', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
};

// ---------------------------------------------------------------------------
// obsidian — pure AMOLED; volcanic black ground, cool steel accents, minimal.
// No gold anywhere — the second accent is steel, the seams are steel.
// Seed { dark, primary 245, accent 230, depth 1, vibrancy .22, warmth -.1,
// contrast 11 } + soul: hand-ramped pure-black glass, restrained steel triads.
// ---------------------------------------------------------------------------
const obsidianTokens: TokenMap = {
  '--ink':        '#000001',
  '--ink-2':      '#000101',
  '--stone':      '#020304',
  '--stone-2':    '#07090a',
  '--stone-3':    '#0f1112',
  '--stone-line': '#15181b',

  // Steel — cool, restrained primary sheen on the black glass
  '--lapis':        '#6a9eca',
  '--lapis-bright': '#9ecdf6',
  '--lapis-deep':   '#3c6588',

  // Pale steel — the second accent stays in the same cold family (NOT gold)
  '--gold':        '#7fa5b8',
  '--gold-bright': '#add1e3',
  '--gold-deep':   '#516f7e',

  '--shu':        '#e95047',
  '--shu-bright': '#ff7f72',

  '--washi':      '#d6dfe7',
  '--washi-dim':  '#9199a1',
  '--washi-mute': '#5a656e',

  '--ok':   '#5bc78e',
  '--warn': '#e6d08c', // warnings stay WARM — decoupled from the steel second accent
  '--danger': 'var(--shu)',

  '--seam':       'color-mix(in oklab, var(--lapis) 30%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 12%, transparent)',
  '--line':       'color-mix(in oklab, var(--washi) 12%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--washi) 5%, transparent)',

  '--r-0':    '0px',
  '--r-sm':   '1px',
  '--r-md':   '3px',
  '--r-pill': '999px',

  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '220ms',
};

// ---------------------------------------------------------------------------
// pearl — light; warm washi-paper ground, ink text, lapis + gold accents.
// Seed { light, primary 250, accent 80, depth .4, vibrancy .5, warmth .7,
// contrast 8 } + soul: hand-ramped warm paper grounds, warm near-ink text.
// color-scheme: light is set in ThemeProvider via the scheme field.
// ---------------------------------------------------------------------------
const pearlTokens: TokenMap = {
  // Ground (reversed — light warm-paper surfaces)
  '--ink':        '#f5f0e5',
  '--ink-2':      '#f1ebe1',
  '--stone':      '#e5e0d6',
  '--stone-2':    '#dbd6cc',
  '--stone-3':    '#d0cbc1',
  '--stone-line': '#c9c2b5',

  // Lapis — ink-blue, deep enough for AA on light ground
  '--lapis':        '#0065b0',
  '--lapis-bright': '#318adb',
  '--lapis-deep':   '#003e70',

  // Gold — restrained warm inlay, deepened for WCAG AA on paper
  '--gold':        '#896100',
  '--gold-bright': '#ad7c0a',
  '--gold-deep':   '#5f4200',

  // Vermilion — deepened for contrast on paper
  '--shu':        '#c83319',
  '--shu-bright': '#e5462b',

  // Text — warm near-ink on paper
  '--washi':      '#251e15',
  '--washi-dim':  '#494136',
  '--washi-mute': '#71675a',

  '--ok':      '#15915c',
  '--warn':    'var(--gold)',
  '--danger':  'var(--shu)',

  '--seam':       'color-mix(in oklab, var(--gold) 55%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--gold) 24%, transparent)',
  '--line':       'color-mix(in oklab, var(--lapis) 28%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--lapis) 12%, transparent)',

  '--r-0':    '0px',
  '--r-sm':   '2px',
  '--r-md':   '4px',
  '--r-pill': '999px',

  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '200ms',
};

// ---------------------------------------------------------------------------
// sumi — INK: monochrome brushwork. Bone-white on deepest black, greyscale
// accents, and a single red — the artist's seal — as the only colour.
// Seed { dark, primary 60, accent 60, depth .95, vibrancy .05, warmth .05,
// contrast 15 } + soul: hand-ramped inky grounds, near-zero-chroma bone
// triads, bone-white text, the seal red untouched.
// ---------------------------------------------------------------------------
const sumiTokens: TokenMap = {
  '--ink':        '#000001',
  '--ink-2':      '#010102',
  '--stone':      '#030405',
  '--stone-2':    '#08090c',
  '--stone-3':    '#0f1113',
  '--stone-line': '#15181c',

  // Bone — warm near-white as the "primary accent"; ink has no colour
  '--lapis':        '#c9c3bc',
  '--lapis-bright': '#ece7e0',
  '--lapis-deep':   '#9d9892',

  // Greyscale second accent — NO gold in the ink story
  '--gold':        '#bbb7b1',
  '--gold-bright': '#dedad5',
  '--gold-deep':   '#908c88',

  // The seal — the single red, the only colour on the page
  '--shu':        '#d8412c',
  '--shu-bright': '#ff5d44',

  // High-contrast: near-pure washi
  '--washi':      '#f0eae2',
  '--washi-dim':  '#a9a49c',
  '--washi-mute': '#706b63',

  '--ok':      '#5bc78e',
  '--warn':    '#e6d08c', // warnings stay WARM — decoupled from the greyscale second accent
  '--danger':  'var(--shu)',

  '--seam':       'color-mix(in oklab, var(--washi) 16%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--washi) 7%, transparent)',
  '--line':       'color-mix(in oklab, var(--lapis) 25%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--lapis) 10%, transparent)',

  '--r-0':    '0px',
  '--r-sm':   '0px',
  '--r-md':   '2px',
  '--r-pill': '999px',

  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '180ms',
};

// ---------------------------------------------------------------------------
// shu — GARNET: crimson is the PRIMARY accent over a warm maroon-black ground,
// with ember orange as the second. No blue, no gold — one red-hot story.
// Seed { dark, primary 25, accent 42, depth .82, vibrancy .75, warmth .55,
// contrast 10 } — pure engine output; the seed IS the soul here.
// ---------------------------------------------------------------------------
const shuTokens: TokenMap = {
  // Ground — warm-dark, maroon-leaning strata
  '--ink':        '#080100',
  '--ink-2':      '#0b0201',
  '--stone':      '#160705',
  '--stone-2':    '#21100d',
  '--stone-3':    '#2c1a17',
  '--stone-line': '#3a211c',

  // Garnet — crimson IS the primary (the theme's namesake leads)
  '--lapis':        '#e74142',
  '--lapis-bright': '#ff958d',
  '--lapis-deep':   '#940014',

  // Ember — glowing orange second accent (not gold)
  '--gold':        '#f4733c',
  '--gold-bright': '#ffb294',
  '--gold-deep':   '#a43e08',

  // Shu — the hot/danger accent stays vermilion
  '--shu':        '#e9523b',
  '--shu-bright': '#ff806a',

  '--washi':      '#ebdad5',
  '--washi-dim':  '#a49490',
  '--washi-mute': '#725e59',

  '--ok':      '#5bc78e',
  '--warn':    '#e6d08c', // warnings stay WARM — decoupled from the ember second accent
  '--danger':  'var(--shu)',

  '--seam':       'color-mix(in oklab, var(--lapis) 40%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 16%, transparent)',
  '--line':       'color-mix(in oklab, var(--shu) 18%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--shu) 8%, transparent)',

  '--r-0':    '0px',
  '--r-sm':   '2px',
  '--r-md':   '4px',
  '--r-pill': '999px',

  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '240ms',
};

// ---------------------------------------------------------------------------
// hisui — JADE: green-black forest ground, jade primary, pale-jade mineral
// second. One green story from the deepest stratum to the brightest vein.
// Seed { dark, primary 150, accent 164, depth .82, vibrancy .62, warmth -.05,
// contrast 10 } + soul: paler mint mineral second accent.
// ---------------------------------------------------------------------------
const hisuiTokens: TokenMap = {
  '--ink':        '#000401',
  '--ink-2':      '#000601',
  '--stone':      '#040f06',
  '--stone-2':    '#0c190f',
  '--stone-3':    '#162319',
  '--stone-line': '#1b2e1f',

  // Jade — the primary accent (replaces lapis)
  '--lapis':        '#00a149',
  '--lapis-bright': '#5bd47d',
  '--lapis-deep':   '#005e28',

  // Pale jade / mint — the mineral second accent (NO gold in the stone)
  '--gold':        '#70c5a0',
  '--gold-bright': '#a5e9c9',
  '--gold-deep':   '#3e8165',

  // Shu accent stays (contrast on green ground)
  '--shu':        '#e95146',
  '--shu-bright': '#ff7f71',

  '--washi':      '#d6e2d8',
  '--washi-dim':  '#919c92',
  '--washi-mute': '#5a685b',

  '--ok':      '#5bc78e',
  '--warn':    '#e6d08c', // warnings stay WARM — decoupled from the pale-jade second accent
  '--danger':  'var(--shu)',

  '--seam':       'color-mix(in oklab, var(--lapis) 38%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 15%, transparent)',
  '--line':       'color-mix(in oklab, var(--lapis) 22%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--lapis) 9%, transparent)',

  '--r-0':    '0px',
  '--r-sm':   '2px',
  '--r-md':   '4px',
  '--r-pill': '999px',

  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '240ms',
};

// ---------------------------------------------------------------------------
// pine — EVERGREEN: deep old-growth forest. A cool pine-green canopy leads over
// an umber-black forest-floor ground, with a mossy lichen chartreuse as the
// analogous second — a distinct, deeper, more coniferous green than the jade
// (hisui) cut. No brass, no gold, no blue.
// Seed { dark, primary 142, accent 110, depth .85, vibrancy .55, warmth -.1,
// contrast 10 } — pure engine output (the seed IS the soul; only the chrome
// tokens below — seams/radii/motion/fonts — are hand-set), re-run through enforceAA.
// ---------------------------------------------------------------------------
const pineTokens: TokenMap = {
  // Ground — forest-floor strata: umber-black → deep pine shadow
  '--ink':        '#000300',
  '--ink-2':      '#010501',
  '--stone':      '#060e05',
  '--stone-2':    '#0e170d',
  '--stone-3':    '#182116',
  '--stone-line': '#1e2c1b',

  // Pine — cool coniferous green primary (the namesake canopy leads)
  '--lapis':        '#3b9f32',
  '--lapis-bright': '#79d070',
  '--lapis-deep':   '#065f00',

  // Lichen — mossy chartreuse analogous second accent (NOT gold)
  '--gold':        '#a5a51a',
  '--gold-bright': '#cdcf62',
  '--gold-deep':   '#686800',

  // Shu — the hot/danger accent stays vermilion
  '--shu':        '#e95047',
  '--shu-bright': '#ff7f72',

  // Text — pale sage over the forest floor
  '--washi':      '#d8e1d6',
  '--washi-dim':  '#939b91',
  '--washi-mute': '#5c675a',

  // Status
  '--ok':      '#5bc78e',
  '--warn':    '#e6d08c', // warnings stay WARM — decoupled from the lichen second accent
  '--danger':  'var(--shu)',

  // Seams follow the pine PRIMARY (never a hard-coded gold) + lichen bands
  '--seam':       'color-mix(in oklab, var(--lapis) 38%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 15%, transparent)',
  '--line':       'color-mix(in oklab, var(--washi) 14%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--gold) 11%, transparent)',

  // Radius — organic, softly rounded
  '--r-0':    '0px',
  '--r-sm':   '3px',
  '--r-md':   '7px',
  '--r-pill': '999px',

  // Motion
  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '250ms',

  // Typography
  '--font-mono':    "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  '--font-display': "'Anton', 'Arial Narrow', 'Helvetica Neue', sans-serif",
  '--font-sans':    "'Instrument Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-serif':   "'Fraunces Variable', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
};

// ---------------------------------------------------------------------------
// kohaku — AMBER resin: amber is the primary (warmer and more orange than the
// onyx gold), honey the second. Legitimately warm, but distinct from onyx.
// Seed { dark, primary 70, accent 62, depth .78, vibrancy .72, warmth .85,
// contrast 10 } + soul: glowing amber triad, lighter sweet honey triad.
// ---------------------------------------------------------------------------
const kohakuTokens: TokenMap = {
  '--ink':        '#050200',
  '--ink-2':      '#080300',
  '--stone':      '#130b01',
  '--stone-2':    '#1d1507',
  '--stone-3':    '#281f11',
  '--stone-line': '#342812',

  // Amber — the primary accent (replaces lapis)
  '--lapis':        '#d98b09',
  '--lapis-bright': '#ffb75d',
  '--lapis-deep':   '#8a5600',

  // Honey — lighter, sweeter second accent
  '--gold':        '#eea563',
  '--gold-bright': '#ffcca1',
  '--gold-deep':   '#a46c36',

  '--shu':        '#e85336',
  '--shu-bright': '#ff8066',

  '--washi':      '#e4ddd0',
  '--washi-dim':  '#9e988b',
  '--washi-mute': '#6a6252',

  '--ok':      '#5bc78e',
  '--warn':    '#e6d08c', // warnings stay WARM — in-family with the honey second accent
  '--danger':  'var(--shu)',

  '--seam':       'color-mix(in oklab, var(--lapis) 36%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 15%, transparent)',
  '--line':       'color-mix(in oklab, var(--lapis) 28%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--lapis) 12%, transparent)',

  '--r-0':    '0px',
  '--r-sm':   '2px',
  '--r-md':   '4px',
  '--r-pill': '999px',

  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '240ms',
};

// ---------------------------------------------------------------------------
// terracotta — CLAY: warm editorial earthenware. Burnt-clay orange leads over a
// deep umber ground, with a dusty blush-rose as the complementary warm second —
// a fired-clay-and-plaster pairing, not another glowing amber. No blue, no gold.
// Seed { dark, primary 42, accent 20, depth .8, vibrancy .5, warmth .6,
// contrast 10 } — pure engine output (the seed IS the soul; only the chrome
// tokens below — seams/radii/motion/fonts — are hand-set), re-run through enforceAA.
// ---------------------------------------------------------------------------
const terracottaTokens: TokenMap = {
  // Ground — fired-earth strata: umber-black → warm clay shadow
  '--ink':        '#060100',
  '--ink-2':      '#0a0200',
  '--stone':      '#140904',
  '--stone-2':    '#1f130c',
  '--stone-3':    '#2a1d16',
  '--stone-line': '#37241a',

  // Terracotta clay — burnt-orange primary (the namesake leads)
  '--lapis':        '#d55c27',
  '--lapis-bright': '#ff9970',
  '--lapis-deep':   '#832e00',

  // Blush-rose — the dusty plaster second accent (complementary warm, NOT gold)
  '--gold':        '#e8777a',
  '--gold-bright': '#ffafae',
  '--gold-deep':   '#9c4346',

  // Shu — the hot/danger accent stays vermilion
  '--shu':        '#e8523b',
  '--shu-bright': '#ff8069',

  // Text — warm bone / plaster over fired earth
  '--washi':      '#e8dbd4',
  '--washi-dim':  '#a1968f',
  '--washi-mute': '#6f6057',

  // Status
  '--ok':      '#5bc78e',
  '--warn':    '#e6d08c', // warnings stay WARM — in-family with the clay story
  '--danger':  'var(--shu)',

  // Seams follow the clay PRIMARY (never a hard-coded gold) + blush bands
  '--seam':       'color-mix(in oklab, var(--lapis) 40%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 16%, transparent)',
  '--line':       'color-mix(in oklab, var(--washi) 14%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--gold) 12%, transparent)',

  // Radius — editorial, softly rounded earthenware
  '--r-0':    '0px',
  '--r-sm':   '4px',
  '--r-md':   '9px',
  '--r-pill': '999px',

  // Motion
  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '240ms',

  // Typography
  '--font-mono':    "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  '--font-display': "'Anton', 'Arial Narrow', 'Helvetica Neue', sans-serif",
  '--font-sans':    "'Instrument Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-serif':   "'Fraunces Variable', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
};

// ---------------------------------------------------------------------------
// vermillion — INK & VERMILLION: the Onyx house identity. A single vermillion
// seal leads as the PRIMARY accent over the deepest warm-ink ground, with a
// blush-red analogous second — the eshmaki.me "Ink & Vermillion / Deep Current"
// signature made a first-class, user-selectable theme. Distinct from Garnet
// (crimson jewel over maroon) and Terracotta (clay orange): here the accent is
// true vermillion (OKLCH ~33°) and the ink is pushed to its darkest reserve.
// Seed { dark, primary 33, accent 18, depth .9, vibrancy .62, warmth .08,
// contrast 11 } — pure engine output (the seed IS the soul; only the chrome
// tokens below — seams/radii/motion/fonts — are hand-set), re-run through enforceAA.
// ---------------------------------------------------------------------------
const vermillionTokens: TokenMap = {
  // Ground — deepest warm-ink strata: near-black sumi warmed by the seal
  '--ink':        '#060100',
  '--ink-2':      '#0a0101',
  '--stone':      '#140604',
  '--stone-2':    '#1d0f0b',
  '--stone-3':    '#281814',
  '--stone-line': '#351e19',

  // Vermillion — the house seal leads as the PRIMARY accent (replaces lapis)
  '--lapis':        '#de5034',
  '--lapis-bright': '#ff9781',
  '--lapis-deep':   '#8e1900',

  // Blush-red — the analogous, softer second accent (NOT gold)
  '--gold':        '#ef7179',
  '--gold-bright': '#ffafb0',
  '--gold-deep':   '#a13d46',

  // Shu — the hot/danger accent stays vermilion, in-family with the seal
  '--shu':        '#e95144',
  '--shu-bright': '#ff7f70',

  // Text — warm bone / rice-paper over the ink
  '--washi':      '#eadad6',
  '--washi-dim':  '#a39591',
  '--washi-mute': '#715e5a',

  // Status
  '--ok':      '#5bc78e',
  '--warn':    '#e6d08c', // warnings stay WARM — in-family with the vermillion seal
  '--danger':  'var(--shu)',

  // Seams follow the vermillion PRIMARY (the seal's own colour) + blush bands
  '--seam':       'color-mix(in oklab, var(--lapis) 40%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 16%, transparent)',
  '--line':       'color-mix(in oklab, var(--washi) 14%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--gold) 12%, transparent)',

  // Radius — taut, editorial ink
  '--r-0':    '0px',
  '--r-sm':   '3px',
  '--r-md':   '6px',
  '--r-pill': '999px',

  // Motion
  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '240ms',

  // Typography
  '--font-mono':    "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  '--font-display': "'Anton', 'Arial Narrow', 'Helvetica Neue', sans-serif",
  '--font-sans':    "'Instrument Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-serif':   "'Fraunces Variable', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
};

// ---------------------------------------------------------------------------
// teal — deep teal cut; cyan-green ground, mint primary, seafoam second.
// One cool water-green story — no brass, no gold.
// Seed { dark, primary 175, accent 168, depth .82, vibrancy .65, warmth -.25,
// contrast 10 } + soul: paler seafoam second accent.
// ---------------------------------------------------------------------------
const tealTokens: TokenMap = {
  // Ground — deep cyan-green waterstone strata
  '--ink':        '#000302',
  '--ink-2':      '#000603',
  '--stone':      '#010f0a',
  '--stone-2':    '#071914',
  '--stone-3':    '#11241e',
  '--stone-line': '#122f26',

  // Mint — clear teal current as the primary accent
  '--lapis':       '#009d82',
  '--lapis-bright':'#00d5b2',
  '--lapis-deep':  '#005b4b',

  // Seafoam — paler water-green second accent (NOT gold)
  '--gold':       '#72ccab',
  '--gold-bright':'#9feacd',
  '--gold-deep':  '#42876e',

  // Coral — restrained hot accent for danger
  '--shu':        '#e95049',
  '--shu-bright': '#ff7f74',

  // Text — pale seafoam over deep teal
  '--washi':      '#d3e2dc',
  '--washi-dim':  '#8e9c97',
  '--washi-mute': '#556861',

  // Status
  '--ok':      '#5bc78e',
  '--warn':    '#e6d08c', // warnings stay WARM — decoupled from the seafoam second accent
  '--danger':  'var(--shu)',

  // Seams (mint current) + bands (seafoam wash)
  '--seam':       'color-mix(in oklab, var(--lapis) 36%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 15%, transparent)',
  '--line':       'color-mix(in oklab, var(--washi) 14%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--gold) 11%, transparent)',

  // Radius — fluid, elegant
  '--r-0':    '0px',
  '--r-sm':   '6px',
  '--r-md':   '13px',
  '--r-pill': '999px',

  // Motion
  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '260ms',

  // Typography
  '--font-mono':    "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  '--font-display': "'Anton', 'Arial Narrow', 'Helvetica Neue', sans-serif",
  '--font-sans':    "'Instrument Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-serif':   "'Fraunces Variable', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
};

// ---------------------------------------------------------------------------
// slate — warm neutral graphite; mineral sage primary, MUTED bronze second,
// mineral seams. Quiet and stone-like — the bronze is a whisper, not gold.
// Seed { dark, primary 120, accent 55, depth .72, vibrancy .25, warmth .5,
// contrast 9.5 } + soul: hand-ramped warm graphite grounds, low-chroma sage
// triad, bronze whisper triad, chalk text.
// ---------------------------------------------------------------------------
const slateTokens: TokenMap = {
  // Ground — warm graphite and charcoal strata
  '--ink':        '#040301',
  '--ink-2':      '#060503',
  '--stone':      '#110e0a',
  '--stone-2':    '#1c1a15',
  '--stone-3':    '#282521',
  '--stone-line': '#343029',

  // Stone-sage — muted mineral primary without a blue cast
  '--lapis':       '#949d7b',
  '--lapis-bright':'#bdc6a5',
  '--lapis-deep':  '#656c51',

  // Muted bronze — restrained warm second accent (dimmer than gold)
  '--gold':       '#ae7853',
  '--gold-bright':'#d8a582',
  '--gold-deep':  '#73492b',

  // Fired clay — danger accent
  '--shu':        '#e9523c',
  '--shu-bright': '#ff806a',

  // Text — chalk ivory over warm graphite
  '--washi':      '#eae7e2',
  '--washi-dim':  '#a7a49e',
  '--washi-mute': '#716e68',

  // Status
  '--ok':      '#5bc78e',
  '--warn':    '#e6d08c', // warnings stay WARM — decoupled from the bronze second accent
  '--danger':  'var(--shu)',

  // Seams (mineral, NOT bronze) + bands (chalk strata)
  '--seam':       'color-mix(in oklab, var(--lapis) 28%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 12%, transparent)',
  '--line':       'color-mix(in oklab, var(--washi) 13%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--lapis) 10%, transparent)',

  // Radius — fluid, restrained
  '--r-0':    '0px',
  '--r-sm':   '4px',
  '--r-md':   '9px',
  '--r-pill': '999px',

  // Motion
  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '240ms',

  // Typography
  '--font-mono':    "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  '--font-display': "'Anton', 'Arial Narrow', 'Helvetica Neue', sans-serif",
  '--font-sans':    "'Instrument Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-serif':   "'Fraunces Variable', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
};

// ---------------------------------------------------------------------------
// frost — light; cool frost paper, deep slate ink, steel-blue primary and a
// pale-steel second. One cold story — no brass on the ice.
// Seed { light, primary 225, accent 215, depth .35, vibrancy .45, warmth -.55,
// contrast 8.5 } + soul: restrained steel-blue triad, deep-amber warn.
// ---------------------------------------------------------------------------
const frostTokens: TokenMap = {
  // Ground (reversed — cool frost-paper surfaces)
  '--ink':        '#e3f7fe',
  '--ink-2':      '#def2f8',
  '--stone':      '#d0e4ea',
  '--stone-2':    '#c3d7dd',
  '--stone-3':    '#b6cad0',
  '--stone-line': '#a4c0c8',

  // Steel-blue — cool primary, dark enough for light paper
  '--lapis':       '#036884',
  '--lapis-bright':'#448aa5',
  '--lapis-deep':  '#003c4d',

  // Pale steel — the second accent stays in the cold family (NOT brass)
  '--gold':       '#00768a',
  '--gold-bright':'#0096af',
  '--gold-deep':  '#00515f',

  // Brick red — danger accent with AA contrast on paper
  '--shu':        '#c92f34',
  '--shu-bright': '#e64344',

  // Text — deep slate ink on frost paper
  '--washi':      '#202b2e',
  '--washi-dim':  '#546063',
  '--washi-mute': '#7a8d92',

  // Status
  '--ok':      '#15915c',
  '--warn':    '#8a6e1f', // warnings stay WARM — a deep amber that reads on light paper
  '--danger':  'var(--shu)',

  // Seams (steel-blue linework) + bands (pale steel)
  '--seam':       'color-mix(in oklab, var(--lapis) 34%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 14%, transparent)',
  '--line':       'color-mix(in oklab, var(--washi) 18%, transparent)',
  '--line-faint': 'color-mix(in oklab, var(--gold) 14%, transparent)',

  // Radius — fluid, precise
  '--r-0':    '0px',
  '--r-sm':   '5px',
  '--r-md':   '10px',
  '--r-pill': '999px',

  // Motion
  '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--dur':  '220ms',

  // Typography
  '--font-mono':    "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  '--font-display': "'Anton', 'Arial Narrow', 'Helvetica Neue', sans-serif",
  '--font-sans':    "'Instrument Sans Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-serif':   "'Fraunces Variable', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const THEMES: Record<ThemeId, ThemeMeta> = {
  ocean: {
    id: 'ocean',
    label: 'Ocean',
    description: 'The flagship — deep water, electric azure current, bioluminescent crests, glacier ice.',
    scheme: 'dark',
    signatureBg: 'deep-current',
    tokens: oceanTokens,
  },
  tide: {
    id: 'tide',
    label: 'Ocean · Tide',
    description: 'Shallow sunlit water — lifted azure surfaces, a more luminous crest, pale sand-cyan shallows.',
    scheme: 'dark',
    signatureBg: 'caustics',
    tokens: tideTokens,
  },
  abyss: {
    id: 'abyss',
    label: 'Ocean · Abyss',
    description: 'The deep trench — near-black water, restrained azure that glows, high-contrast sea-foam.',
    scheme: 'dark',
    signatureBg: 'bioluminescence',
    tokens: abyssTokens,
  },
  reef: {
    id: 'reef',
    label: 'Ocean · Reef',
    description: 'Living reef — azure current warmed by living coral. A touch more colour.',
    scheme: 'dark',
    signatureBg: 'caustics',
    tokens: reefTokens,
  },
  onyx: {
    id: 'onyx',
    label: 'Onyx',
    description: 'Black banded stone, gold inlay, moonstone sheen — the older cut.',
    scheme: 'dark',
    signatureBg: 'kintsugi-veins',
    tokens: onyxTokens,
  },
  obsidian: {
    id: 'obsidian',
    label: 'Obsidian',
    description: 'Pure AMOLED black, cool steel sheen. The deepest cut of the stone.',
    scheme: 'dark',
    signatureBg: 'bioluminescence',
    tokens: obsidianTokens,
  },
  pearl: {
    id: 'pearl',
    label: 'Pearl',
    description: 'The light cut — warm paper, ink text, gold inlay.',
    scheme: 'light',
    signatureBg: 'washi',
    tokens: pearlTokens,
  },
  sumi: {
    id: 'sumi',
    label: 'Ink',
    description: 'Monochrome brushwork — bone-white on the deepest black, one red seal.',
    scheme: 'dark',
    signatureBg: 'sumi-e',
    tokens: sumiTokens,
  },
  shu: {
    id: 'shu',
    label: 'Garnet',
    description: 'Garnet-forward dark — crimson current over warm maroon ground, ember second.',
    scheme: 'dark',
    signatureBg: 'ember',
    tokens: shuTokens,
  },
  hisui: {
    id: 'hisui',
    label: 'Jade',
    description: 'Jade green. Deep forest ground, pale-jade mineral second.',
    scheme: 'dark',
    signatureBg: 'forest',
    tokens: hisuiTokens,
  },
  pine: {
    id: 'pine',
    label: 'Pine',
    description: 'Deep old-growth pine — cool coniferous canopy over umber forest floor, mossy lichen second.',
    scheme: 'dark',
    signatureBg: 'mist',
    tokens: pineTokens,
  },
  kohaku: {
    id: 'kohaku',
    label: 'Amber',
    description: 'Amber resin. Warm amber current, honey second.',
    scheme: 'dark',
    signatureBg: 'resin',
    tokens: kohakuTokens,
  },
  terracotta: {
    id: 'terracotta',
    label: 'Terracotta',
    description: 'Warm editorial earthenware — burnt-clay orange over fired umber, dusty blush second.',
    scheme: 'dark',
    signatureBg: 'volcanic',
    tokens: terracottaTokens,
  },
  vermillion: {
    id: 'vermillion',
    label: 'Vermillion',
    description: 'Ink & Vermillion — the house seal: a single vermillion accent over the deepest warm ink.',
    scheme: 'dark',
    signatureBg: 'ember',
    tokens: vermillionTokens,
  },
  teal: {
    id: 'teal',
    label: 'Teal',
    description: 'Deep teal ground, seafoam text, mint current, and seafoam marks.',
    scheme: 'dark',
    signatureBg: 'deep-current',
    tokens: tealTokens,
  },
  slate: {
    id: 'slate',
    label: 'Slate',
    description: 'Warm graphite, chalk text, quiet mineral seams, and muted bronze marks.',
    scheme: 'dark',
    signatureBg: 'mist',
    tokens: slateTokens,
  },
  frost: {
    id: 'frost',
    label: 'Frost',
    description: 'Cool frost paper, deep slate ink, steel-blue current, and pale steel linework.',
    scheme: 'light',
    signatureBg: 'frost',
    tokens: frostTokens,
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const DEFAULT_THEME_ID: ThemeId = 'ocean';
