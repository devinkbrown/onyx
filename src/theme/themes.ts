/**
 * Onyx theming engine — curated theme definitions.
 *
 * Each theme is a typed map of CSS-custom-property overrides keyed to the
 * token names defined in src/styles/tokens.css.  A theme only needs to
 * declare the vars it wants to change; the flagship `ruri` theme declares
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
  /** The CSS custom property overrides for this theme. */
  tokens: TokenMap;
};

export type ThemeId =
  | 'ocean'
  | 'tide'
  | 'abyss'
  | 'reef'
  | 'ruri'
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

  // Champagne — warm gold treasure inlay (second accent)
  '--gold':       '#d8b96a',
  '--gold-bright':'#f2dca0',
  '--gold-deep':  '#9a7c38',

  // Coral — the single hot accent (danger / badges)
  '--shu':        '#ff6f61',
  '--shu-bright': '#ff9484',

  // Text — sea-foam ivory over deep water
  '--washi':      '#e6f4ff',
  '--washi-dim':  '#9fc6e0',
  '--washi-mute': '#5f87a2',

  // Status
  '--ok':      '#34d399',
  '--warn':    'var(--gold-bright)',
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
  '--warn':    'var(--gold-bright)',
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
  '--warn':    'var(--gold-bright)',
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
// reef — Ocean sub-variant: the base deep water with a warm coral + gold lean.
// Azure stays the primary current, but the second accent shifts from champagne
// toward living coral and warm reef-gold — a touch more colour, still elegant.
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

  // Reef-gold — warmer, more saturated treasure than the flagship champagne
  '--gold':       '#e8a94e',
  '--gold-bright':'#ffcf86',
  '--gold-deep':  '#a8702a',

  // Coral — promoted from rare danger accent to a visible warm secondary
  '--shu':        '#ff6f5e',
  '--shu-bright': '#ff9a86',

  // Text — sea-foam ivory, faintly warmed
  '--washi':      '#eef6ff',
  '--washi-dim':  '#a7cbe2',
  '--washi-mute': '#6890a8',

  // Status
  '--ok':      '#34d399',
  '--warn':    'var(--gold-bright)',
  '--danger':  'var(--shu)',

  // Seams — azure current with a warm coral wash in the faint band
  '--seam':       'color-mix(in oklab, var(--lapis) 40%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--shu) 16%, transparent)',
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
// ruri — Onyx: black banded stone × gold inlay × terminal (dark)
// The older flagship cut, kept selectable.
// ---------------------------------------------------------------------------
const ruriTokens: TokenMap = {
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
  '--warn':    'var(--gold-bright)',
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
// obsidian — deeper / AMOLED; pure volcanic black ground, dimmed moonstone
// ---------------------------------------------------------------------------
const obsidianTokens: TokenMap = {
  '--ink':        '#000000',
  '--ink-2':      '#040406',
  '--stone':      '#0a0a0e',
  '--stone-2':    '#101016',
  '--stone-3':    '#17171f',
  '--stone-line': '#212129',

  '--lapis':        '#52719e',
  '--lapis-bright': '#9bbce4',
  '--lapis-deep':   '#2e466c',

  '--gold':        '#b8902e',
  '--gold-bright': '#dab85a',
  '--gold-deep':   '#8a6520',

  '--shu':        '#cc3a22',
  '--shu-bright': '#f04828',

  '--washi':      '#e8e3da',
  '--washi-dim':  '#9e9a90',
  '--washi-mute': '#5c5d68',

  '--ok':   '#4ea87a',
  '--warn': 'var(--gold-bright)',
  '--danger': 'var(--shu)',

  '--seam':       'color-mix(in oklab, var(--gold) 38%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--gold) 12%, transparent)',
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
// sumi — high-contrast ink; near-white washi on deepest sumi-black
// ---------------------------------------------------------------------------
const sumiTokens: TokenMap = {
  '--ink':        '#05060a',
  '--ink-2':      '#060810',
  '--stone':      '#090c18',
  '--stone-2':    '#0c1020',
  '--stone-3':    '#101528',
  '--stone-line': '#141a2e',

  '--lapis':        '#4a78ff',
  '--lapis-bright': '#6a94ff',
  '--lapis-deep':   '#2840c0',

  '--gold':        '#d8b050',
  '--gold-bright': '#f0cc70',
  '--gold-deep':   '#a88030',

  '--shu':        '#e84530',
  '--shu-bright': '#ff5a40',

  // High-contrast: near-pure washi
  '--washi':      '#f4ede0',
  '--washi-dim':  '#c8c0a8',
  '--washi-mute': '#807a68',

  '--ok':      '#68d098',
  '--warn':    'var(--gold-bright)',
  '--danger':  'var(--shu)',

  '--seam':       'color-mix(in oklab, var(--gold) 50%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--gold) 20%, transparent)',
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
// shu — vermilion-forward dark; shu as the primary accent colour
// ---------------------------------------------------------------------------
const shuTokens: TokenMap = {
  '--ink':        '#0e0806',
  '--ink-2':      '#120a07',
  '--stone':      '#1c0e0a',
  '--stone-2':    '#281410',
  '--stone-3':    '#341a14',
  '--stone-line': '#3c2018',

  // Lapis recedes — shu leads
  '--lapis':        '#3a6adc',
  '--lapis-bright': '#5a86f0',
  '--lapis-deep':   '#1e3e9a',

  // Gold as supporting seam (kintsugi still present)
  '--gold':        '#c09838',
  '--gold-bright': '#dcb84e',
  '--gold-deep':   '#8e7020',

  // Shu as the dominant accent
  '--shu':        '#e84530',
  '--shu-bright': '#ff5e44',

  '--washi':      '#ede0cc',
  '--washi-dim':  '#b0a08a',
  '--washi-mute': '#6c5e52',

  '--ok':      '#5aaa78',
  '--warn':    'var(--gold-bright)',
  '--danger':  'var(--shu)',

  '--seam':       'color-mix(in oklab, var(--shu) 38%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--shu) 14%, transparent)',
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
// hisui — jade-green variant; deep forest ground + jade accent
// ---------------------------------------------------------------------------
const hisuiTokens: TokenMap = {
  '--ink':        '#060e09',
  '--ink-2':      '#08120b',
  '--stone':      '#0b1c10',
  '--stone-2':    '#0e2414',
  '--stone-3':    '#122c18',
  '--stone-line': '#163420',

  // Jade as primary accent (replaces lapis)
  '--lapis':        '#1e9458',
  '--lapis-bright': '#2db86e',
  '--lapis-deep':   '#127040',

  // Gold — still present as kintsugi seams
  '--gold':        '#c0a030',
  '--gold-bright': '#dcbc48',
  '--gold-deep':   '#907820',

  // Shu accent stays (contrast on green ground)
  '--shu':        '#e04030',
  '--shu-bright': '#f85840',

  '--washi':      '#e8e0cc',
  '--washi-dim':  '#a8a08a',
  '--washi-mute': '#607054',

  '--ok':      '#3cb87a',
  '--warn':    'var(--gold-bright)',
  '--danger':  'var(--shu)',

  '--seam':       'color-mix(in oklab, var(--lapis) 40%, transparent)',
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
// kohaku — amber variant; warm amber ground + deep amber seams
// ---------------------------------------------------------------------------
const kohakuTokens: TokenMap = {
  '--ink':        '#0e0a04',
  '--ink-2':      '#140e06',
  '--stone':      '#1e1408',
  '--stone-2':    '#281a0a',
  '--stone-3':    '#32200c',
  '--stone-line': '#3a2610',

  // Amber as primary accent (replaces lapis with deep amber)
  '--lapis':        '#c07820',
  '--lapis-bright': '#e09030',
  '--lapis-deep':   '#8a5414',

  // Gold leans warm amber-gold
  '--gold':        '#d4960e',
  '--gold-bright': '#f0b020',
  '--gold-deep':   '#a07008',

  '--shu':        '#dc3c28',
  '--shu-bright': '#f85040',

  '--washi':      '#f0e4cc',
  '--washi-dim':  '#c0aa88',
  '--washi-mute': '#806858',

  '--ok':      '#5aac78',
  '--warn':    'var(--gold-bright)',
  '--danger':  'var(--shu)',

  '--seam':       'color-mix(in oklab, var(--gold) 48%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--gold) 18%, transparent)',
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
// teal — deep teal cut; cyan-green ground, mint crest, brass inlay
// ---------------------------------------------------------------------------
const tealTokens: TokenMap = {
  // Ground — deep cyan-green waterstone strata
  '--ink':        '#021412',
  '--ink-2':      '#061c19',
  '--stone':      '#0b2a24',
  '--stone-2':    '#123b33',
  '--stone-3':    '#194c42',
  '--stone-line': '#236457',

  // Mint — clear seafoam current as the primary accent
  '--lapis':       '#4bcda9',
  '--lapis-bright':'#a6f0dc',
  '--lapis-deep':  '#14765e',

  // Brass — warm inlay against the cool ground
  '--gold':       '#c5a15a',
  '--gold-bright':'#ead086',
  '--gold-deep':  '#8b6830',

  // Coral — restrained hot accent for danger
  '--shu':        '#dc654f',
  '--shu-bright': '#ff8f79',

  // Text — pale seafoam over deep teal
  '--washi':      '#eafff8',
  '--washi-dim':  '#a8d7c9',
  '--washi-mute': '#6f9e91',

  // Status
  '--ok':      '#42d69a',
  '--warn':    'var(--gold-bright)',
  '--danger':  'var(--shu)',

  // Seams (mint current) + bands (brass wash)
  '--seam':       'color-mix(in oklab, var(--lapis) 42%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 16%, transparent)',
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
// slate — warm neutral graphite; no blue cast, bronze inlay
// ---------------------------------------------------------------------------
const slateTokens: TokenMap = {
  // Ground — warm graphite and charcoal strata
  '--ink':        '#090807',
  '--ink-2':      '#100f0d',
  '--stone':      '#1a1815',
  '--stone-2':    '#24211d',
  '--stone-3':    '#302c26',
  '--stone-line': '#423b32',

  // Stone-sage — muted mineral accent without a blue cast
  '--lapis':       '#9aa28f',
  '--lapis-bright':'#c6cdb8',
  '--lapis-deep':  '#626b57',

  // Bronze — primary seam and command accent
  '--gold':       '#c28a45',
  '--gold-bright':'#e1b66f',
  '--gold-deep':  '#855a2a',

  // Fired clay — danger accent
  '--shu':        '#c95a3e',
  '--shu-bright': '#e77a58',

  // Text — chalk ivory over warm graphite
  '--washi':      '#f0ede4',
  '--washi-dim':  '#b7b0a4',
  '--washi-mute': '#7d756b',

  // Status
  '--ok':      '#70b77b',
  '--warn':    'var(--gold-bright)',
  '--danger':  'var(--shu)',

  // Seams (bronze inlay) + bands (chalk strata)
  '--seam':       'color-mix(in oklab, var(--gold) 43%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--gold) 16%, transparent)',
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
// frost — light; cool frost paper, deep slate ink, steel-blue accent
// ---------------------------------------------------------------------------
const frostTokens: TokenMap = {
  // Ground (reversed — cool light surfaces)
  '--ink':        '#f4f8f8',
  '--ink-2':      '#e8f0f0',
  '--stone':      '#dce7e8',
  '--stone-2':    '#cedbdd',
  '--stone-3':    '#bdcccf',
  '--stone-line': '#a9bcc1',

  // Steel-blue — cool accent, dark enough for light paper
  '--lapis':       '#2f6f8f',
  '--lapis-bright':'#3f88ac',
  '--lapis-deep':  '#1d4e68',

  // Pale brass — a warmer counterpoint to the frost
  '--gold':       '#8c6b2e',
  '--gold-bright':'#a7813a',
  '--gold-deep':  '#654d20',

  // Brick red — danger accent with AA contrast on paper
  '--shu':        '#b94432',
  '--shu-bright': '#d75843',

  // Text — deep slate ink on frost paper
  '--washi':      '#172126',
  '--washi-dim':  '#33444b',
  '--washi-mute': '#62737b',

  // Status
  '--ok':      '#2e7d5b',
  '--warn':    'var(--gold)',
  '--danger':  'var(--shu)',

  // Seams (steel-blue linework) + bands (pale brass)
  '--seam':       'color-mix(in oklab, var(--lapis) 44%, transparent)',
  '--seam-faint': 'color-mix(in oklab, var(--lapis) 18%, transparent)',
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
    description: 'The flagship — deep water, electric azure current, bioluminescent crests, champagne gold.',
    scheme: 'dark',
    tokens: oceanTokens,
  },
  tide: {
    id: 'tide',
    label: 'Ocean · Tide',
    description: 'Shallow sunlit water — lifted azure surfaces, a more luminous crest, bright sand gold.',
    scheme: 'dark',
    tokens: tideTokens,
  },
  abyss: {
    id: 'abyss',
    label: 'Ocean · Abyss',
    description: 'The deep trench — near-black water, restrained azure that glows, high-contrast sea-foam.',
    scheme: 'dark',
    tokens: abyssTokens,
  },
  reef: {
    id: 'reef',
    label: 'Ocean · Reef',
    description: 'Living reef — azure current with a warm coral and reef-gold lean. A touch more colour.',
    scheme: 'dark',
    tokens: reefTokens,
  },
  ruri: {
    id: 'ruri',
    label: 'Onyx',
    description: 'Black banded stone, gold inlay, moonstone sheen — the older cut.',
    scheme: 'dark',
    tokens: ruriTokens,
  },
  obsidian: {
    id: 'obsidian',
    label: 'Obsidian',
    description: 'Pure AMOLED black. The deepest cut of the stone.',
    scheme: 'dark',
    tokens: obsidianTokens,
  },
  pearl: {
    id: 'pearl',
    label: 'Pearl',
    description: 'The light cut — warm paper, ink text, gold inlay.',
    scheme: 'light',
    tokens: pearlTokens,
  },
  sumi: {
    id: 'sumi',
    label: 'Ink',
    description: 'High-contrast. Bone-white on the deepest black.',
    scheme: 'dark',
    tokens: sumiTokens,
  },
  shu: {
    id: 'shu',
    label: 'Garnet',
    description: 'Garnet-forward dark — deep red ground, gold seams.',
    scheme: 'dark',
    tokens: shuTokens,
  },
  hisui: {
    id: 'hisui',
    label: 'Jade',
    description: 'Jade green. Deep forest ground, mineral accent.',
    scheme: 'dark',
    tokens: hisuiTokens,
  },
  kohaku: {
    id: 'kohaku',
    label: 'Amber',
    description: 'Amber. Warm resin ground and seams.',
    scheme: 'dark',
    tokens: kohakuTokens,
  },
  teal: {
    id: 'teal',
    label: 'Teal',
    description: 'Deep teal ground, seafoam text, mint current, and brass seams.',
    scheme: 'dark',
    tokens: tealTokens,
  },
  slate: {
    id: 'slate',
    label: 'Slate',
    description: 'Warm graphite, chalk text, quiet mineral accents, and bronze seams.',
    scheme: 'dark',
    tokens: slateTokens,
  },
  frost: {
    id: 'frost',
    label: 'Frost',
    description: 'Cool frost paper, deep slate ink, steel-blue current, and pale brass linework.',
    scheme: 'light',
    tokens: frostTokens,
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const DEFAULT_THEME_ID: ThemeId = 'ocean';
