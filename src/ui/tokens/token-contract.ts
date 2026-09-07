// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * token-contract.ts — the machine-readable contract for the Onyx UI token layer.
 *
 * The CSS in this directory is a public interface: components bind to token
 * NAMES, and a rename or a quiet deletion breaks every consumer at once with no
 * type error to catch it. This module is the type checker CSS does not have.
 *
 * It declares three things and provides the pure functions to check them:
 *
 *   1. WHICH tokens each layer must define      (REQUIRED_* + LAYER_CONTRACTS)
 *   2. WHERE a raw value is legal               (only `--room-*` in foundation)
 *   3. WHAT a consumer may never hardcode       (colour literals, magic z-index)
 *
 * Everything here is a pure string function over CSS/TS source text. There are
 * no imports — no framework, no store, no routing, no DOM — so the contract can
 * be evaluated from a test, a lint rule, or a build step interchangeably.
 */

// ---------------------------------------------------------------------------
// Room Current — the fallback identity
// ---------------------------------------------------------------------------

/**
 * The six Room Current constants, lowercased exactly as authored in
 * foundation.css. These are FALLBACKS: they apply only where the active Onyx
 * theme does not define a value. Consumers must never reference them directly.
 */
export const ROOM_CURRENT = {
  'current-void': '#070a0b',
  basalt: '#111718',
  edge: '#2a3637',
  paper: '#e9ece6',
  signal: '#68aaa6',
  ember: '#ee7b5c',
} as const;

export type RoomCurrentName = keyof typeof ROOM_CURRENT;

// ---------------------------------------------------------------------------
// Truth states
// ---------------------------------------------------------------------------

/**
 * The only sanctioned truth states. Onyx renders history it cannot always
 * vouch for, and each of these is an honest answer to "how sure are we?".
 *
 * Every one MUST be conveyed by text and shape in addition to colour: colour
 * alone fails WCAG 1.4.1, and under forced-colors these six collapse to three
 * system keywords, so colour cannot carry the distinction even in principle.
 */
export const TRUTH_STATES = [
  'verified',
  'partial',
  'local',
  'reconnecting',
  'unavailable',
  'unknown',
] as const;

export type TruthState = (typeof TRUTH_STATES)[number];

// ---------------------------------------------------------------------------
// Required tokens, by layer
// ---------------------------------------------------------------------------

export const REQUIRED_FOUNDATION_TOKENS = [
  // Room Current palette
  '--room-current-void',
  '--room-basalt',
  '--room-edge',
  '--room-paper',
  '--room-signal',
  '--room-ember',
  // Space
  '--ui-space-0',
  '--ui-space-1',
  '--ui-space-2',
  '--ui-space-3',
  '--ui-space-4',
  '--ui-space-5',
  '--ui-space-6',
  '--ui-space-7',
  '--ui-space-8',
  // Intent spacing
  '--ui-gap-tight',
  '--ui-gap-row',
  '--ui-gap-group',
  '--ui-gap-section',
  '--ui-pad-control',
  '--ui-pad-panel',
  '--ui-pad-region',
  // Radius
  '--ui-radius-0',
  '--ui-radius-sm',
  '--ui-radius-md',
  '--ui-radius-lg',
  '--ui-radius-pill',
  // Border
  '--ui-border-hairline',
  '--ui-border-emphasis',
  '--ui-border-heavy',
  // Measure
  '--ui-measure-compact',
  '--ui-measure-prose',
  '--ui-measure-wide',
  '--ui-measure-shell',
  // Target size
  '--ui-target-min',
  '--ui-target-comfortable',
  '--ui-target-inline-min',
  // Layers
  '--ui-z-base',
  '--ui-z-raised',
  '--ui-z-sticky',
  '--ui-z-nav',
  '--ui-z-overlay',
  '--ui-z-sheet',
  '--ui-z-modal',
  '--ui-z-toast',
  '--ui-z-tooltip',
  '--ui-z-top',
  // Elevation
  '--ui-elev-0',
  '--ui-elev-1',
  '--ui-elev-2',
  '--ui-elev-3',
  '--ui-elev-press',
] as const;

// Typed as a plain readonly string[] rather than `as const`: the proof entries
// below are produced by spreading a mapped array, and a const assertion over a
// spread buys a variadic tuple type that nothing here consumes.
export const REQUIRED_SEMANTIC_TOKENS: readonly string[] = [
  // Surface
  '--ui-surface-canvas',
  '--ui-surface-sunken',
  '--ui-surface-base',
  '--ui-surface-raised',
  '--ui-surface-edge',
  '--ui-surface-line',
  '--ui-surface-line-faint',
  '--ui-surface-seam',
  '--ui-surface-seam-faint',
  '--ui-surface-overlay',
  '--ui-surface-selected',
  '--ui-surface-hover',
  // Structure
  '--ui-border-subtle',
  '--ui-border-default',
  '--ui-border-strong',
  '--ui-border-focus',
  // Text
  '--ui-text-primary',
  '--ui-text-secondary',
  '--ui-text-muted',
  '--ui-text-accent',
  '--ui-text-on-action',
  '--ui-text-on-critical',
  '--ui-text-link',
  // Present-tense product status; provenance stays in --ui-proof-*.
  '--ui-status-info',
  '--ui-status-success',
  '--ui-status-warning',
  '--ui-status-danger',
  // Action
  '--ui-action-primary',
  '--ui-action-primary-hover',
  '--ui-action-primary-pressed',
  '--ui-action-secondary',
  '--ui-action-secondary-hover',
  '--ui-action-critical',
  '--ui-action-critical-hover',
  '--ui-action-quiet',
  '--ui-action-quiet-hover',
  '--ui-action-disabled',
  // Proof
  ...TRUTH_STATES.map((state) => `--ui-proof-${state}`),
  ...TRUTH_STATES.map((state) => `--ui-proof-${state}-wash`),
];

export const REQUIRED_TYPOGRAPHY_TOKENS = [
  '--ui-font-display',
  '--ui-font-interface',
  '--ui-font-body',
  '--ui-font-evidence',
  '--ui-type-2xs',
  '--ui-type-xs',
  '--ui-type-sm',
  '--ui-type-md',
  '--ui-type-lg',
  '--ui-type-xl',
  '--ui-type-2xl',
  '--ui-display-sm',
  '--ui-display-md',
  '--ui-display-lg',
  '--ui-weight-regular',
  '--ui-weight-medium',
  '--ui-weight-semibold',
  '--ui-weight-display',
  '--ui-leading-tight',
  '--ui-leading-snug',
  '--ui-leading-body',
  '--ui-leading-evidence',
  '--ui-tracking-kicker',
  '--ui-tracking-title',
  '--ui-tracking-normal',
  '--ui-tracking-evidence',
] as const;

export const REQUIRED_MOTION_TOKENS = [
  '--ui-dur-instant',
  '--ui-dur-micro',
  '--ui-dur-fast',
  '--ui-dur-base',
  '--ui-dur-slow',
  '--ui-ease',
  '--ui-ease-out',
  '--ui-ease-in-out',
  '--ui-ease-linear',
  '--ui-transition-control',
  '--ui-transition-press',
  '--ui-transition-enter',
  '--ui-transition-surface',
  '--ui-motion-allowed',
  '--ui-motion-scale',
] as const;

export const REQUIRED_ACCESSIBILITY_TOKENS = [
  '--ui-focus-width',
  '--ui-focus-offset',
  '--ui-focus-color',
  '--ui-focus-halo',
  '--ui-focus-halo-width',
  '--ui-transparency-allowed',
  '--ui-blur-panel',
  '--ui-blur-scrim',
] as const;

/** Every token the layer guarantees, flattened. */
export const ALL_REQUIRED_TOKENS: readonly string[] = [
  ...REQUIRED_FOUNDATION_TOKENS,
  ...REQUIRED_SEMANTIC_TOKENS,
  ...REQUIRED_TYPOGRAPHY_TOKENS,
  ...REQUIRED_MOTION_TOKENS,
  ...REQUIRED_ACCESSIBILITY_TOKENS,
];

// ---------------------------------------------------------------------------
// Layer contracts
// ---------------------------------------------------------------------------

export type LayerContract = {
  /** File name inside src/ui/tokens/. */
  readonly file: string;
  /** Tokens this layer must declare. */
  readonly required: readonly string[];
  /**
   * Custom-property prefixes allowed to carry a raw literal value in this
   * layer. Empty means the layer must resolve everything through `var()`.
   */
  readonly literalsAllowedOn: readonly string[];
};

/**
 * Only foundation may hold raw colour, and only on `--room-*`. Every other
 * layer resolves through `var()`, which is what keeps a theme able to win.
 */
export const LAYER_CONTRACTS: readonly LayerContract[] = [
  {
    file: 'foundation.css',
    required: REQUIRED_FOUNDATION_TOKENS,
    literalsAllowedOn: ['--room-'],
  },
  { file: 'semantic.css', required: REQUIRED_SEMANTIC_TOKENS, literalsAllowedOn: [] },
  { file: 'typography.css', required: REQUIRED_TYPOGRAPHY_TOKENS, literalsAllowedOn: [] },
  { file: 'motion.css', required: REQUIRED_MOTION_TOKENS, literalsAllowedOn: [] },
  { file: 'accessibility.css', required: REQUIRED_ACCESSIBILITY_TOKENS, literalsAllowedOn: [] },
];

/** Layer files in cascade order; index.css must import exactly these, in order. */
export const LAYER_ORDER: readonly string[] = LAYER_CONTRACTS.map((layer) => layer.file);

/**
 * Media queries the layer must handle. Dropping any one of these is a silent
 * accessibility regression — the CSS still parses and the app still renders.
 */
export const REQUIRED_MEDIA_QUERIES: readonly { readonly file: string; readonly query: RegExp }[] = [
  { file: 'semantic.css', query: /@media\s*\(\s*prefers-color-scheme:\s*light\s*\)/ },
  { file: 'motion.css', query: /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/ },
  {
    file: 'accessibility.css',
    query: /@media\s*\(\s*prefers-reduced-transparency:\s*reduce\s*\)/,
  },
  { file: 'accessibility.css', query: /@media\s*\(\s*prefers-contrast:\s*more\s*\)/ },
  { file: 'accessibility.css', query: /@media\s*\(\s*forced-colors:\s*active\s*\)/ },
];

// ---------------------------------------------------------------------------
// CSS text helpers
// ---------------------------------------------------------------------------

/** Remove `/* … *\/` comments so prose mentioning a hex is not read as code. */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

export type Declaration = {
  /** Property name, e.g. `--ui-surface-base` or `color`. */
  readonly property: string;
  /** Raw value text with surrounding whitespace trimmed. */
  readonly value: string;
  /** 1-indexed line in the ORIGINAL source (comments included). */
  readonly line: number;
};

const DECLARATION_RE = /(--[\w-]+|[a-zA-Z-]+)\s*:\s*([^;{}]+?)\s*(?=[;}])/g;

/**
 * Parse declarations out of a stylesheet.
 *
 * Deliberately a scanner, not a parser: it needs to be dependency-free and to
 * fail toward reporting MORE candidates rather than fewer, so a real violation
 * is never skipped because the grammar surprised it. Comments are stripped in
 * place (replaced by equivalent-length blanks) so reported line numbers still
 * point at the original file.
 */
export function parseDeclarations(css: string): Declaration[] {
  const blanked = css.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, ' '),
  );

  const declarations: Declaration[] = [];
  for (const match of blanked.matchAll(DECLARATION_RE)) {
    const property = match[1];
    const value = match[2];
    if (property === undefined || value === undefined) continue;
    // Skip at-rule preludes and selectors that the scanner may catch.
    if (value.includes('{')) continue;
    const index = match.index ?? 0;
    const line = blanked.slice(0, index).split('\n').length;
    declarations.push({ property, value, line });
  }
  return declarations;
}

/** The set of custom properties a stylesheet DECLARES (not merely references). */
export function declaredCustomProperties(css: string): Set<string> {
  const declared = new Set<string>();
  for (const declaration of parseDeclarations(css)) {
    if (declaration.property.startsWith('--')) declared.add(declaration.property);
  }
  return declared;
}

/**
 * Raw colour literals: hex, and the colour-producing functional notations.
 *
 * `color-mix(in oklab, …)` is intentionally NOT a literal — it is a derivation
 * over tokens and is the sanctioned way to build a wash or a hairline. The
 * pattern requires a `(` directly after the function name, so neither the
 * `oklab` colour-space keyword nor `color-mix` itself is caught.
 */
const COLOR_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;

export type ContractViolation = {
  readonly property: string;
  readonly value: string;
  readonly line: number;
  readonly reason: string;
};

/**
 * Find raw colour literals that are not permitted at their location.
 *
 * @param css              stylesheet text
 * @param literalsAllowedOn custom-property prefixes exempt from the rule
 */
export function findColorLiteralViolations(
  css: string,
  literalsAllowedOn: readonly string[] = [],
): ContractViolation[] {
  const violations: ContractViolation[] = [];
  for (const declaration of parseDeclarations(css)) {
    if (!COLOR_LITERAL_RE.test(declaration.value)) continue;
    const exempt = literalsAllowedOn.some((prefix) => declaration.property.startsWith(prefix));
    if (exempt) continue;
    violations.push({
      ...declaration,
      reason: 'raw colour literal — resolve through a --ui-* token instead',
    });
  }
  return violations;
}

/**
 * Properties a CONSUMER stylesheet must express through tokens rather than
 * literals. Each entry pairs the property with the token family that owns it,
 * so a failure message tells the author what to use instead.
 */
const CONSUMER_TOKEN_PROPERTIES: readonly {
  readonly property: RegExp;
  readonly requiredToken: string;
  readonly hint: string;
}[] = [
  { property: /^z-index$/, requiredToken: '--ui-z-', hint: 'use a named layer (--ui-z-*)' },
  {
    property: /^(?:color|background|background-color|fill|stroke|border-color|outline-color)$/,
    requiredToken: '--ui-',
    hint: 'use a --ui-surface / text / action / proof token',
  },
  {
    property: /^(?:transition-duration|animation-duration)$/,
    requiredToken: '--ui-dur-',
    hint: 'use the motion ladder (--ui-dur-*)',
  },
];

/** Values that are inert regardless of property — no token needed. */
const INERT_VALUES = new Set([
  'none',
  'inherit',
  'initial',
  'unset',
  'revert',
  'transparent',
  'currentColor',
  'currentcolor',
  'auto',
  '0',
]);

/**
 * Validate a CONSUMER stylesheet (a component's own CSS, not a token layer).
 *
 * Enforces two things:
 *   · no raw colour literals anywhere
 *   · colour / layer / duration properties resolve through the owning token
 *     family, so a component can never pin itself outside the system
 *
 * System colour keywords (Canvas, ButtonText, …) are accepted because a
 * forced-colors block is REQUIRED to use them.
 */
export function findConsumerViolations(css: string): ContractViolation[] {
  const violations: ContractViolation[] = [...findColorLiteralViolations(css, [])];

  for (const declaration of parseDeclarations(css)) {
    if (declaration.property.startsWith('--')) continue;
    const value = declaration.value.trim();
    if (INERT_VALUES.has(value)) continue;
    if (isSystemColorKeyword(value)) continue;

    for (const rule of CONSUMER_TOKEN_PROPERTIES) {
      if (!rule.property.test(declaration.property)) continue;
      if (value.includes(`var(${rule.requiredToken}`)) continue;
      // A value composed entirely of other var() references is fine.
      if (/^var\(--ui-/.test(value)) continue;
      violations.push({
        ...declaration,
        reason: `hardcoded value on "${declaration.property}" — ${rule.hint}`,
      });
    }
  }

  return violations;
}

const SYSTEM_COLOR_KEYWORDS = new Set([
  'Canvas',
  'CanvasText',
  'LinkText',
  'VisitedText',
  'ActiveText',
  'ButtonFace',
  'ButtonText',
  'ButtonBorder',
  'Field',
  'FieldText',
  'Highlight',
  'HighlightText',
  'SelectedItem',
  'SelectedItemText',
  'Mark',
  'MarkText',
  'GrayText',
  'AccentColor',
  'AccentColorText',
]);

export function isSystemColorKeyword(value: string): boolean {
  return SYSTEM_COLOR_KEYWORDS.has(value.trim());
}

// ---------------------------------------------------------------------------
// Scoping — the "cannot change the existing app" invariant
// ---------------------------------------------------------------------------

export type CssRule = {
  readonly selector: string;
  readonly body: string;
  readonly line: number;
};

/**
 * Split a stylesheet into innermost `selector { … }` rules.
 *
 * Because the pattern forbids braces inside both halves, a match always lands
 * on the innermost rule — rules nested inside an `@media` block are returned
 * with their own selector, and the at-rule prelude is never mistaken for one.
 */
export function parseRules(css: string): CssRule[] {
  const blanked = css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
  const rules: CssRule[] = [];
  for (const match of blanked.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]?.trim();
    const body = match[2];
    if (!selector || body === undefined) continue;
    if (selector.startsWith('@')) continue;
    const index = match.index ?? 0;
    rules.push({ selector, body, line: blanked.slice(0, index).split('\n').length });
  }
  return rules;
}

/**
 * Selectors permitted to carry a VISUAL (non-custom-property) declaration.
 *
 * This is what lets the token layer ship inert. Declaring custom properties on
 * `:root` costs nothing and changes nothing until something reads them, so
 * those blocks are unrestricted — but any rule that actually paints must be
 * scoped to a surface that opted in by carrying `.ui-root`, to the standalone
 * `.ui-visually-hidden` utility, or to an explicit `[data-ui-*]` opt-in
 * attribute. An unscoped `:focus-visible` or `button { … }` in this layer would
 * restyle the entire existing application the moment anyone imported it.
 */
export const ALLOWED_VISUAL_SCOPES: readonly string[] = [
  '.ui-root',
  '.ui-visually-hidden',
  '[data-ui-scheme=',
  '[data-ui-motion=',
  '[data-ui-transparency=',
];

/** Rules in a token layer that would paint outside an opted-in surface. */
export function findUnscopedVisualRules(css: string): ContractViolation[] {
  const violations: ContractViolation[] = [];
  for (const rule of parseRules(css)) {
    const visual = parseDeclarations(`x{${rule.body}}`).filter(
      (declaration) => !declaration.property.startsWith('--'),
    );
    if (visual.length === 0) continue;
    const scoped = ALLOWED_VISUAL_SCOPES.some((scope) => rule.selector.includes(scope));
    if (scoped) continue;
    violations.push({
      property: visual.map((declaration) => declaration.property).join(', '),
      value: rule.selector,
      line: rule.line,
      reason: 'visual declaration outside an opted-in scope — would restyle the existing app',
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Theme ownership — the token layer aliases, it never replaces
// ---------------------------------------------------------------------------

/**
 * Custom properties owned by the Onyx theme engine (src/styles/tokens.css +
 * src/theme/themes.ts). The UI layer may READ these through `var()` but must
 * never DECLARE one: redeclaring `--stone` here would silently override every
 * theme in the registry, and a theme switch would stop working with no error.
 */
export const THEME_OWNED_PREFIXES: readonly string[] = [
  '--ink',
  '--stone',
  '--paper',
  '--lapis',
  '--gold',
  '--shu',
  '--ok',
  '--warn',
  '--danger',
  '--seam',
  '--line',
  '--on-accent',
  '--on-danger',
  '--r-',
  '--space-',
  '--gap-',
  '--pad-',
  '--text-',
  '--leading-',
  '--tracking-',
  '--surface-',
  '--elev-',
  '--dur',
  '--ease',
  '--font-',
  '--target-min',
  '--focus-ring',
  '--focus-offset',
  '--shell-measure',
];

/** Theme-owned properties illegally declared by a UI-layer stylesheet. */
export function findThemeOwnedRedeclarations(css: string): ContractViolation[] {
  const violations: ContractViolation[] = [];
  for (const declaration of parseDeclarations(css)) {
    if (!declaration.property.startsWith('--')) continue;
    // Everything the UI layer owns is namespaced; those can never collide.
    if (declaration.property.startsWith('--ui-') || declaration.property.startsWith('--room-')) {
      continue;
    }
    const owned = THEME_OWNED_PREFIXES.some((prefix) => declaration.property.startsWith(prefix));
    if (!owned) continue;
    violations.push({
      ...declaration,
      reason: 'redeclares a theme-owned property — the UI layer aliases, it never replaces',
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Layer validation
// ---------------------------------------------------------------------------

export type LayerReport = {
  readonly file: string;
  /** Required tokens the layer failed to declare. */
  readonly missing: readonly string[];
  /** Illegal raw literals found in the layer. */
  readonly illegalLiterals: readonly ContractViolation[];
};

/** Check one token layer's CSS text against its contract. */
export function validateLayer(contract: LayerContract, css: string): LayerReport {
  const declared = declaredCustomProperties(css);
  const missing = contract.required.filter((token) => !declared.has(token));
  const illegalLiterals = findColorLiteralViolations(css, contract.literalsAllowedOn);
  return { file: contract.file, missing, illegalLiterals };
}

// ---------------------------------------------------------------------------
// Boundary rules for the lab
// ---------------------------------------------------------------------------

/**
 * Imports a token-layer or lab module may never reach for.
 *
 * The token layer and the specimen must stay renderable in isolation — no
 * store, no router, no network, no IRC client. If the specimen needed app
 * state to render, it would be a screenshot of the app rather than a test of
 * the system, and it could not fail independently of the app.
 */
export const FORBIDDEN_LAB_IMPORTS: readonly { readonly pattern: RegExp; readonly reason: string }[] =
  [
    { pattern: /@solidjs\/router/, reason: 'router import — the lab must not be routed' },
    { pattern: /from\s+['"][^'"]*\/store\/store['"]/, reason: 'store import' },
    { pattern: /from\s+['"][^'"]*\/store\/useStore['"]/, reason: 'store bridge import' },
    { pattern: /\buseStore\b/, reason: 'store bridge usage' },
    { pattern: /\bgetState\s*\(/, reason: 'store snapshot read' },
    { pattern: /from\s+['"]@\/lib\/store/, reason: 'store module import' },
    { pattern: /from\s+['"]@\/routes/, reason: 'route module import' },
    { pattern: /from\s+['"]@\/lib\/irc/, reason: 'IRC client import' },
    { pattern: /from\s+['"]@\/theme\/ThemeProvider['"]/, reason: 'theme provider import' },
  ];

/**
 * Non-determinism a deterministic specimen may never contain. A lab surface
 * that renders a random number or a live clock cannot be diffed, cannot be
 * screenshot-compared, and quietly teaches the reader that the numbers on
 * screen mean something.
 */
export const FORBIDDEN_LAB_SOURCES: readonly { readonly pattern: RegExp; readonly reason: string }[] =
  [
    { pattern: /Math\.random\s*\(/, reason: 'random value — specimen must be deterministic' },
    { pattern: /Date\.now\s*\(/, reason: 'clock read — specimen must be deterministic' },
    { pattern: /new\s+Date\s*\(\s*\)/, reason: 'clock read — specimen must be deterministic' },
    { pattern: /\bsetInterval\s*\(/, reason: 'live ticker — specimen must be static' },
    { pattern: /\bfetch\s*\(/, reason: 'network call — specimen must render offline' },
  ];

export type SourceViolation = { readonly reason: string; readonly line: number };

/** Scan TS/TSX source text for any of the supplied forbidden patterns. */
export function findSourceViolations(
  source: string,
  rules: readonly { readonly pattern: RegExp; readonly reason: string }[],
): SourceViolation[] {
  const lines = source.split('\n');
  const violations: SourceViolation[] = [];
  lines.forEach((text, index) => {
    // Ignore comment-only lines so prose explaining a rule is not a violation.
    const trimmed = text.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
    for (const rule of rules) {
      if (rule.pattern.test(text)) violations.push({ reason: rule.reason, line: index + 1 });
    }
  });
  return violations;
}
