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
  | 'ruri'
  | 'obsidian'
  | 'pearl'
  | 'sumi'
  | 'shu'
  | 'hisui'
  | 'kohaku';

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
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const DEFAULT_THEME_ID: ThemeId = 'ocean';
