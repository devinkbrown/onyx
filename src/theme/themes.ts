/**
 * Onyx theming engine — curated theme definitions.
 *
 * Each theme is a typed map of CSS-custom-property overrides keyed to the
 * token names defined in src/styles/tokens.css.  A theme only needs to
 * declare the vars it wants to change; the flagship `onyx` theme declares
 * every token so it can serve as an exhaustive reference.
 *
 * Identity constraints (ALL themes must honour):
 *   - WCAG AA contrast on all text / surface pairs
 *   - No purple / indigo in any palette position
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
  | 'kohaku'
  | 'teal'
  | 'slate'
  | 'frost';

// ---------------------------------------------------------------------------
// Flagship: ocean — deep-water dark luxury (electric azure × bioluminescence ×
// champagne gold). Formalises what lives in tokens.css as the default :root.
// ---------------------------------------------------------------------------
const oceanTokens: TokenMap = {
  // Ground — abyssal trench → mid depth → near-surface crests
  '--ink':        '#02060d',
  '--ink-2':      '#04090f',
  '--stone':      '#08182a',
  '--stone-2':    '#0f2740',
  '--stone-3':    '#173550',
  '--stone-line': '#21466a',

  // Azure — electric sky-blue current + bioluminescent crest (primary)
  '--lapis':       '#2bb4f0',
  '--lapis-bright':'#7fe2ff',
  '--lapis-deep':  '#0e6aa8',

  // Glacier — icy pale azure, second accent (was champagne gold)
  '--gold':       '#6fc3e8',
  '--gold-bright':'#b9e9ff',
  '--gold-deep':  '#2e7fae',

  // Coral — the single hot accent (danger / badges)
  '--shu':        '#ff6f61',
  '--shu-bright': '#ff9484',

  // Text — sea-foam ivory over deep water
  '--washi':      '#e6f4ff',
  '--washi-dim':  '#9fc6e0',
  '--washi-mute': '#5f87a2',

  // Status
  '--ok':      '#34d399',
  '--warn':    '#f2dca0', // warnings stay WARM — decoupled from the glacier second accent
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
// lift toward the surface; more luminous crest, the gold reads as bright sand.
// Same azure-primary identity as the flagship, turned up toward daylight.
// ---------------------------------------------------------------------------
const tideTokens: TokenMap = {
  // Ground — shallows: lifted, lighter blue-grey water (still dark-scheme)
  '--ink':        '#04101e',
  '--ink-2':      '#06162a',
  '--stone':      '#0d2742',
  '--stone-2':    '#163a5e',
  '--stone-3':    '#1f4d77',
  '--stone-line': '#2e6499',

  // Azure — brighter electric current; crest pushed toward sky-white
  '--lapis':       '#46c8ff',
  '--lapis-bright':'#a6ecff',
  '--lapis-deep':  '#1684cc',

  // Champagne — bright shallow-water sand
  '--gold':       '#e4c97e',
  '--gold-bright':'#f6e6ae',
  '--gold-deep':  '#a98c46',

  // Coral — the single hot accent (danger / badges)
  '--shu':        '#ff7a6c',
  '--shu-bright': '#ffa193',

  // Text — luminous sea-foam over sunlit water
  '--washi':      '#f0faff',
  '--washi-dim':  '#b7d8ee',
  '--washi-mute': '#7aa0bc',

  // Status
  '--ok':      '#3ee0a8',
  '--warn':    '#f2dca0', // warnings stay WARM — decoupled from the glacier second accent
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
// restrained azure that glows rather than floods, high text contrast. The
// flagship's identity at maximum depth and darkness.
// ---------------------------------------------------------------------------
const abyssTokens: TokenMap = {
  // Ground — the bottom of the trench: near-pure black, faint blue undertone
  '--ink':        '#000206',
  '--ink-2':      '#01040a',
  '--stone':      '#040a14',
  '--stone-2':    '#08121f',
  '--stone-3':    '#0c1a2b',
  '--stone-line': '#142a40',

  // Azure — restrained, deep; a glow in the dark, not a flood
  '--lapis':       '#2196d6',
  '--lapis-bright':'#6fd4ff',
  '--lapis-deep':  '#0a4f80',

  // Champagne — dimmed treasure glint
  '--gold':       '#c4a558',
  '--gold-bright':'#e6cd8e',
  '--gold-deep':  '#86692c',

  // Coral — the single hot accent (danger / badges)
  '--shu':        '#f0594b',
  '--shu-bright': '#ff7c6e',

  // Text — high-contrast sea-foam ivory over the trench
  '--washi':      '#eef7ff',
  '--washi-dim':  '#a8cae2',
  '--washi-mute': '#5a7d96',

  // Status
  '--ok':      '#2fcf93',
  '--warn':    '#f2dca0', // warnings stay WARM — decoupled from the glacier second accent
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
// Azure stays the primary current, but the second accent is CORAL — the warmth
// of the reef itself, not gold — a touch more colour, still elegant.
// ---------------------------------------------------------------------------
const reefTokens: TokenMap = {
  // Ground — deep water with the faintest warm coral undertone in the strata
  '--ink':        '#03070e',
  '--ink-2':      '#060b12',
  '--stone':      '#0a1a2a',
  '--stone-2':    '#122c3f',
  '--stone-3':    '#1b3c50',
  '--stone-line': '#2a5470',

  // Azure — still the primary current (kept close to the flagship)
  '--lapis':       '#2bb4f0',
  '--lapis-bright':'#83e4ff',
  '--lapis-deep':  '#0e6aa8',

  // Coral — the reef's own warmth as the second accent (not gold)
  '--gold':       '#ff9f7a',
  '--gold-bright':'#ffc4a6',
  '--gold-deep':  '#c85f3f',

  // Coral — promoted from rare danger accent to a visible warm secondary
  '--shu':        '#ff6f5e',
  '--shu-bright': '#ff9a86',

  // Text — sea-foam ivory, faintly warmed
  '--washi':      '#eef6ff',
  '--washi-dim':  '#a7cbe2',
  '--washi-mute': '#6890a8',

  // Status
  '--ok':      '#34d399',
  '--warn':    '#f2dca0', // warnings stay WARM — decoupled from the glacier second accent
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
// onyx — Onyx: black banded stone × gold inlay × terminal (dark)
// The older flagship cut, kept selectable.
// ---------------------------------------------------------------------------
const onyxTokens: TokenMap = {
  // Ground — onyx black → graphite strata
  '--ink':        '#050507',
  '--ink-2':      '#08080c',
  '--stone':      '#0f0f15',
  '--stone-2':    '#16161e',
  '--stone-3':    '#20202a',
  '--stone-line': '#2c2c39',

  // Moonstone — cold silver-blue sheen
  '--lapis':       '#5a7fb8',
  '--lapis-bright':'#a8c8ee',
  '--lapis-deep':  '#34507e',

  // Gold — champagne brass inlay
  '--gold':       '#c9a24a',
  '--gold-bright':'#f1d489',
  '--gold-deep':  '#8c6c2c',

  // Garnet accent (theme token: --shu)
  '--shu':        '#d8412c',
  '--shu-bright': '#ff5d44',

  // Text — bone / ivory over black
  '--washi':      '#ece8e0',
  '--washi-dim':  '#a6a299',
  '--washi-mute': '#6a6b78',

  // Status
  '--ok':      '#57b98a',
  '--warn':    '#f2dca0', // warnings stay WARM — decoupled from the glacier second accent
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
// ---------------------------------------------------------------------------
const obsidianTokens: TokenMap = {
  '--ink':        '#000000',
  '--ink-2':      '#040406',
  '--stone':      '#0a0a0e',
  '--stone-2':    '#101016',
  '--stone-3':    '#17171f',
  '--stone-line': '#212129',

  // Steel — cool, restrained primary sheen on the black glass
  '--lapis':        '#7c93b8',
  '--lapis-bright': '#b9cbe6',
  '--lapis-deep':   '#43597e',

  // Pale steel — the second accent stays in the same cold family (NOT gold)
  '--gold':        '#8a9bb0',
  '--gold-bright': '#c2cfdd',
  '--gold-deep':   '#55647a',

  '--shu':        '#cc3a22',
  '--shu-bright': '#f04828',

  '--washi':      '#e8e3da',
  '--washi-dim':  '#9e9a90',
  '--washi-mute': '#5c5d68',

  '--ok':   '#4ea87a',
  '--warn': '#f2dca0', // warnings stay WARM — decoupled from the steel second accent
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
// pearl — light; warm washi-paper ground, ink text, lapis + gold accents
// color-scheme: light is set in ThemeProvider via the scheme field.
// ---------------------------------------------------------------------------
const pearlTokens: TokenMap = {
  // Ground (reversed — light surfaces)
  '--ink':        '#f7f2e8',
  '--ink-2':      '#ede7d6',
  '--stone':      '#e4dccc',
  '--stone-2':    '#d8cebc',
  '--stone-3':    '#ccc1ac',
  '--stone-line': '#b8ae9c',

  // Lapis — must stay readable on light ground (darkened for contrast)
  '--lapis':        '#1a3db8',
  '--lapis-bright': '#2a54d8',
  '--lapis-deep':   '#0e267a',

  // Gold — deepened for WCAG AA on paper
  '--gold':        '#8a6418',
  '--gold-bright': '#a87c20',
  '--gold-deep':   '#6a4c10',

  // Vermilion stays as-is; deepened slightly for contrast on paper
  '--shu':        '#c83418',
  '--shu-bright': '#e04028',

  // Text — near-ink on paper
  '--washi':      '#1a1610',
  '--washi-dim':  '#3e3828',
  '--washi-mute': '#6e6854',

  '--ok':      '#2a7a4c',
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
// ---------------------------------------------------------------------------
const sumiTokens: TokenMap = {
  '--ink':        '#05060a',
  '--ink-2':      '#060810',
  '--stone':      '#090c18',
  '--stone-2':    '#0c1020',
  '--stone-3':    '#101528',
  '--stone-line': '#141a2e',

  // Bone — warm near-white as the "primary accent"; ink has no colour
  '--lapis':        '#c9c4ba',
  '--lapis-bright': '#ece8e0',
  '--lapis-deep':   '#8a867c',

  // Greyscale second accent — NO gold in the ink story
  '--gold':        '#b8b3a8',
  '--gold-bright': '#dcd7cc',
  '--gold-deep':   '#7c786f',

  // The seal — the single red, the only colour on the page
  '--shu':        '#d8412c',
  '--shu-bright': '#ff5d44',

  // High-contrast: near-pure washi
  '--washi':      '#f4ede0',
  '--washi-dim':  '#c8c0a8',
  '--washi-mute': '#807a68',

  '--ok':      '#68d098',
  '--warn':    '#f2dca0', // warnings stay WARM — decoupled from the greyscale second accent
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
// ---------------------------------------------------------------------------
const shuTokens: TokenMap = {
  // Ground — warm-dark, maroon-leaning strata
  '--ink':        '#0e0806',
  '--ink-2':      '#120a07',
  '--stone':      '#1c0e0a',
  '--stone-2':    '#281410',
  '--stone-3':    '#341a14',
  '--stone-line': '#3c2018',

  // Garnet — crimson IS the primary (the theme's namesake leads)
  '--lapis':        '#e0413a',
  '--lapis-bright': '#ff6f61',
  '--lapis-deep':   '#a02620',

  // Ember — glowing orange second accent (not gold)
  '--gold':        '#ff7a45',
  '--gold-bright': '#ffa06e',
  '--gold-deep':   '#c2531f',

  // Shu — the hot/danger accent stays vermilion
  '--shu':        '#e84530',
  '--shu-bright': '#ff5e44',

  '--washi':      '#ede0cc',
  '--washi-dim':  '#b0a08a',
  '--washi-mute': '#6c5e52',

  '--ok':      '#5aaa78',
  '--warn':    '#f2dca0', // warnings stay WARM — decoupled from the ember second accent
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
// ---------------------------------------------------------------------------
const hisuiTokens: TokenMap = {
  '--ink':        '#060e09',
  '--ink-2':      '#08120b',
  '--stone':      '#0b1c10',
  '--stone-2':    '#0e2414',
  '--stone-3':    '#122c18',
  '--stone-line': '#163420',

  // Jade — the primary accent (replaces lapis)
  '--lapis':        '#17a05c',
  '--lapis-bright': '#5fd497',
  '--lapis-deep':   '#0d6b3c',

  // Pale jade / mint — the mineral second accent (NO gold in the stone)
  '--gold':        '#59c7a0',
  '--gold-bright': '#9fe6cd',
  '--gold-deep':   '#2f8f70',

  // Shu accent stays (contrast on green ground)
  '--shu':        '#e04030',
  '--shu-bright': '#f85840',

  '--washi':      '#e8e0cc',
  '--washi-dim':  '#a8a08a',
  '--washi-mute': '#607054',

  '--ok':      '#3cb87a',
  '--warn':    '#f2dca0', // warnings stay WARM — decoupled from the pale-jade second accent
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
// kohaku — AMBER resin: amber is the primary (warmer and more orange than the
// onyx gold), honey the second. Legitimately warm, but distinct from onyx.
// ---------------------------------------------------------------------------
const kohakuTokens: TokenMap = {
  '--ink':        '#0e0a04',
  '--ink-2':      '#140e06',
  '--stone':      '#1e1408',
  '--stone-2':    '#281a0a',
  '--stone-3':    '#32200c',
  '--stone-line': '#3a2610',

  // Amber — the primary accent (replaces lapis)
  '--lapis':        '#e0912a',
  '--lapis-bright': '#ffb95a',
  '--lapis-deep':   '#a5641a',

  // Honey — lighter, sweeter second accent
  '--gold':        '#f0b34e',
  '--gold-bright': '#ffd98a',
  '--gold-deep':   '#b8842c',

  '--shu':        '#dc3c28',
  '--shu-bright': '#f85040',

  '--washi':      '#f0e4cc',
  '--washi-dim':  '#c0aa88',
  '--washi-mute': '#806858',

  '--ok':      '#5aac78',
  '--warn':    '#f2dca0', // warnings stay WARM — in-family with the honey second accent
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
// teal — deep teal cut; cyan-green ground, mint primary, seafoam second.
// One cool water-green story — no brass, no gold.
// ---------------------------------------------------------------------------
const tealTokens: TokenMap = {
  // Ground — deep cyan-green waterstone strata
  '--ink':        '#021412',
  '--ink-2':      '#061c19',
  '--stone':      '#0b2a24',
  '--stone-2':    '#123b33',
  '--stone-3':    '#194c42',
  '--stone-line': '#236457',

  // Mint — clear teal current as the primary accent
  '--lapis':       '#2fc6a4',
  '--lapis-bright':'#7fe6cf',
  '--lapis-deep':  '#12876e',

  // Seafoam — paler water-green second accent (NOT gold)
  '--gold':       '#79d9c0',
  '--gold-bright':'#b6efe1',
  '--gold-deep':  '#3f9f88',

  // Coral — restrained hot accent for danger
  '--shu':        '#dc654f',
  '--shu-bright': '#ff8f79',

  // Text — pale seafoam over deep teal
  '--washi':      '#eafff8',
  '--washi-dim':  '#a8d7c9',
  '--washi-mute': '#6f9e91',

  // Status
  '--ok':      '#42d69a',
  '--warn':    '#f2dca0', // warnings stay WARM — decoupled from the glacier second accent
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
// ---------------------------------------------------------------------------
const slateTokens: TokenMap = {
  // Ground — warm graphite and charcoal strata
  '--ink':        '#090807',
  '--ink-2':      '#100f0d',
  '--stone':      '#1a1815',
  '--stone-2':    '#24211d',
  '--stone-3':    '#302c26',
  '--stone-line': '#423b32',

  // Stone-sage — muted mineral primary without a blue cast
  '--lapis':       '#9aa28f',
  '--lapis-bright':'#c4ccbc',
  '--lapis-deep':  '#6a7160',

  // Muted bronze — restrained warm second accent (dimmer than gold)
  '--gold':       '#a87a44',
  '--gold-bright':'#c99a63',
  '--gold-deep':  '#7a5730',

  // Fired clay — danger accent
  '--shu':        '#c95a3e',
  '--shu-bright': '#e77a58',

  // Text — chalk ivory over warm graphite
  '--washi':      '#f0ede4',
  '--washi-dim':  '#b7b0a4',
  '--washi-mute': '#7d756b',

  // Status
  '--ok':      '#70b77b',
  '--warn':    '#f2dca0', // warnings stay WARM — decoupled from the glacier second accent
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
// ---------------------------------------------------------------------------
const frostTokens: TokenMap = {
  // Ground (reversed — cool light surfaces)
  '--ink':        '#f4f8f8',
  '--ink-2':      '#e8f0f0',
  '--stone':      '#dce7e8',
  '--stone-2':    '#cedbdd',
  '--stone-3':    '#bdcccf',
  '--stone-line': '#a9bcc1',

  // Steel-blue — cool primary, dark enough for light paper
  '--lapis':       '#2f6f8f',
  '--lapis-bright':'#5b93b0',
  '--lapis-deep':  '#1d4c66',

  // Pale steel — the second accent stays in the cold family (NOT brass).
  // Base darkened from the spec's #6f97ad to keep >=3:1 on the light grounds.
  '--gold':       '#5d8298',
  '--gold-bright':'#9bbccd',
  '--gold-deep':  '#4a6f85',

  // Brick red — danger accent with AA contrast on paper
  '--shu':        '#b94432',
  '--shu-bright': '#d75843',

  // Text — deep slate ink on frost paper
  '--washi':      '#172126',
  '--washi-dim':  '#33444b',
  '--washi-mute': '#62737b',

  // Status
  '--ok':      '#2e7d5b',
  '--warn':    '#8a6418', // warnings stay WARM — a deep amber that reads on light paper
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
    description: 'Shallow sunlit water — lifted azure surfaces, a more luminous crest, bright sand gold.',
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
  kohaku: {
    id: 'kohaku',
    label: 'Amber',
    description: 'Amber resin. Warm amber current, honey second.',
    scheme: 'dark',
    signatureBg: 'resin',
    tokens: kohakuTokens,
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
