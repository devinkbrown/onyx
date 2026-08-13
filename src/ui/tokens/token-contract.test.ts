// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * token-contract.test.ts — enforces the Onyx UI token contract against the
 * real CSS on disk.
 *
 * CSS has no type checker: a renamed token, a hex quietly inlined into a
 * component, or an unscoped `:focus-visible` all parse cleanly and ship. This
 * suite is that missing check. It reads the actual stylesheets (never a
 * fixture) so it fails when the files change, which is the only time it is
 * useful.
 *
 * The four properties it defends:
 *   1. every promised token exists in its layer
 *   2. raw colour lives ONLY on --room-* in foundation.css
 *   3. the layer cannot alter the existing app (scoping + no theme takeover)
 *   4. the accessibility media queries are all still wired
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_VISUAL_SCOPES,
  ALL_REQUIRED_TOKENS,
  LAYER_CONTRACTS,
  LAYER_ORDER,
  REQUIRED_MEDIA_QUERIES,
  ROOM_CURRENT,
  TRUTH_STATES,
  declaredCustomProperties,
  findColorLiteralViolations,
  findConsumerViolations,
  findThemeOwnedRedeclarations,
  findUnscopedVisualRules,
  parseDeclarations,
  parseRules,
  stripCssComments,
  validateLayer,
} from './token-contract';

const repoRoot = join(import.meta.dirname, '../../..');
const read = (relative: string): string => readFileSync(join(repoRoot, relative), 'utf8');

const tokensDir = 'src/ui/tokens';
const layerSource = new Map<string, string>(
  LAYER_ORDER.map((file) => [file, read(`${tokensDir}/${file}`)]),
);
const indexCss = read(`${tokensDir}/index.css`);
const specimenCss = read('src/ui/lab/system-specimen.css');

/** Concatenation of every token layer — for whole-system invariants. */
const allLayers = LAYER_ORDER.map((file) => layerSource.get(file) ?? '').join('\n');

// ---------------------------------------------------------------------------
// 1. Required tokens
// ---------------------------------------------------------------------------

describe('token layers declare their contract', () => {
  for (const contract of LAYER_CONTRACTS) {
    it(`${contract.file} declares every required token`, () => {
      const css = layerSource.get(contract.file);
      expect(css, `${contract.file} is missing from disk`).toBeDefined();
      const report = validateLayer(contract, css!);
      expect(report.missing).toEqual([]);
    });
  }

  it('exposes every promised token somewhere in the layer', () => {
    const declared = declaredCustomProperties(allLayers);
    const missing = ALL_REQUIRED_TOKENS.filter((token) => !declared.has(token));
    expect(missing).toEqual([]);
  });

  it('declares a proof token and a wash for all six truth states', () => {
    const declared = declaredCustomProperties(allLayers);
    for (const state of TRUTH_STATES) {
      expect(declared.has(`--ui-proof-${state}`), `--ui-proof-${state}`).toBe(true);
      expect(declared.has(`--ui-proof-${state}-wash`), `--ui-proof-${state}-wash`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Raw values
// ---------------------------------------------------------------------------

describe('raw colour is confined to the Room Current fallback palette', () => {
  for (const contract of LAYER_CONTRACTS) {
    it(`${contract.file} carries no unauthorised colour literal`, () => {
      const report = validateLayer(contract, layerSource.get(contract.file)!);
      expect(report.illegalLiterals).toEqual([]);
    });
  }

  it('pins the six Room Current constants to their specified values', () => {
    const declarations = parseDeclarations(layerSource.get('foundation.css')!);
    for (const [name, hex] of Object.entries(ROOM_CURRENT)) {
      const found = declarations.find((declaration) => declaration.property === `--room-${name}`);
      expect(found, `--room-${name} is not declared`).toBeDefined();
      expect(found!.value.trim().toLowerCase()).toBe(hex);
    }
  });

  it('never lets a consumer reach past the semantic layer to --room-*', () => {
    // Room Current is a FALLBACK identity. A component binding to it directly
    // would ignore the active theme, which is the exact bug the layer exists
    // to prevent.
    const consumerRefs = stripCssComments(specimenCss).match(/var\(\s*--room-/g);
    expect(consumerRefs).toBeNull();
  });

  it('resolves every semantic colour token through var(), never a literal', () => {
    const violations = findColorLiteralViolations(layerSource.get('semantic.css')!, []);
    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. The layer cannot alter the existing app
// ---------------------------------------------------------------------------

describe('the token layer ships inert', () => {
  for (const file of LAYER_ORDER) {
    it(`${file} scopes every visual rule to an opted-in surface`, () => {
      expect(findUnscopedVisualRules(layerSource.get(file)!)).toEqual([]);
    });

    it(`${file} never redeclares a theme-owned property`, () => {
      expect(findThemeOwnedRedeclarations(layerSource.get(file)!)).toEqual([]);
    });
  }

  it('never targets a theme id, so the theme registry stays authoritative', () => {
    // Matching [data-theme='x'] here would let the UI layer fork a theme's
    // palette behind the theme engine's back.
    expect(stripCssComments(allLayers)).not.toMatch(/\[data-theme=/);
  });

  it('is not imported by the application stylesheet', () => {
    // The proof that adopting this system is opt-in and the current app is
    // visually unchanged: global.css does not pull it in.
    const globalCss = read('src/styles/global.css');
    expect(globalCss).not.toMatch(/ui\/tokens/);
  });

  it('defines no unscoped :focus-visible rule', () => {
    // A bare `:focus-visible { … }` here would override the focus ring of every
    // control in the shipping app.
    const unscoped = parseRules(allLayers).filter(
      (rule) =>
        rule.selector.includes(':focus-visible') &&
        !ALLOWED_VISUAL_SCOPES.some((scope) => rule.selector.includes(scope)),
    );
    expect(unscoped).toEqual([]);
  });

  it('specifies the focus ring exactly once', () => {
    // One spec, retuned by token — not re-stated per component.
    const base = parseRules(layerSource.get('accessibility.css')!).filter(
      (rule) => rule.selector === '.ui-root :focus-visible',
    );
    // The base rule plus its forced-colors restatement, and nothing else.
    expect(base).toHaveLength(2);
    expect(base[0]!.body).toMatch(/outline:\s*var\(--ui-focus-width\)/);
  });
});

// ---------------------------------------------------------------------------
// 4. Accessibility wiring
// ---------------------------------------------------------------------------

describe('accessibility contracts are wired', () => {
  for (const required of REQUIRED_MEDIA_QUERIES) {
    it(`${required.file} handles ${required.query.source.replace(/\\s\*/g, '')}`, () => {
      expect(stripCssComments(layerSource.get(required.file)!)).toMatch(required.query);
    });
  }

  it('zeros the whole duration ladder under reduced motion', () => {
    const motion = stripCssComments(layerSource.get('motion.css')!);
    const block = motion.match(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(block).not.toBeNull();
    const body = block![1]!;
    for (const step of ['micro', 'fast', 'base', 'slow']) {
      expect(body, `--ui-dur-${step}`).toMatch(
        new RegExp(`--ui-dur-${step}:\\s*0ms\\s*!important`),
      );
    }
    // The JS-readable flag matters as much as the durations: a rAF loop or a
    // canvas scene cannot be stopped by a CSS duration token.
    expect(body).toMatch(/--ui-motion-allowed:\s*0\s*!important/);
  });

  it('holds a 44px pointer-target floor that tracks the theme value', () => {
    const foundation = stripCssComments(layerSource.get('foundation.css')!);
    expect(foundation).toMatch(/--ui-target-min:\s*var\(--target-min,\s*44px\)/);
  });

  it('drops transparency and blur under prefers-reduced-transparency', () => {
    const a11y = stripCssComments(layerSource.get('accessibility.css')!);
    const block = a11y.match(
      /@media\s*\(\s*prefers-reduced-transparency:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(block).not.toBeNull();
    const body = block![1]!;
    expect(body).toMatch(/--ui-transparency-allowed:\s*0/);
    expect(body).toMatch(/backdrop-filter:\s*none\s*!important/);
  });

  it('maps the semantic layer onto system colours under forced-colors', () => {
    const a11y = stripCssComments(layerSource.get('accessibility.css')!);
    const block = a11y.match(/@media\s*\(\s*forced-colors:\s*active\s*\)\s*\{([\s\S]*)\n\}/);
    expect(block).not.toBeNull();
    const body = block![1]!;
    expect(body).toMatch(/--ui-surface-canvas:\s*Canvas/);
    expect(body).toMatch(/--ui-text-primary:\s*CanvasText/);
    expect(body).toMatch(/--ui-focus-color:\s*Highlight/);
    // Every truth state must still resolve to a system colour rather than
    // silently keeping an authored hue the OS asked us to drop.
    for (const state of TRUTH_STATES) {
      expect(body, `--ui-proof-${state}`).toMatch(new RegExp(`--ui-proof-${state}:\\s*\\w+`));
    }
  });

  it('exposes a data-readiness hook for content we cannot vouch for', () => {
    const a11y = stripCssComments(layerSource.get('accessibility.css')!);
    for (const state of ['ready', 'partial', 'stale', 'unknown']) {
      expect(a11y, state).toMatch(new RegExp(`\\[data-ui-data='${state}'\\]`));
    }
  });

  it('boosts structural tokens under prefers-contrast: more', () => {
    const a11y = stripCssComments(layerSource.get('accessibility.css')!);
    const block = a11y.match(/@media\s*\(\s*prefers-contrast:\s*more\s*\)\s*\{([\s\S]*?)\n\}/);
    expect(block).not.toBeNull();
    expect(block![1]!).toMatch(/--ui-focus-width:\s*var\(--ui-border-heavy\)/);
  });
});

// ---------------------------------------------------------------------------
// 5. Semantic aliasing + light/dark contracts
// ---------------------------------------------------------------------------

describe('semantic tokens alias the existing theme, with Room Current as fallback', () => {
  const semantic = layerSource.get('semantic.css')!;

  const aliases: readonly [token: string, themeVar: string][] = [
    ['--ui-surface-canvas', '--ink'],
    ['--ui-surface-base', '--stone'],
    ['--ui-surface-raised', '--stone-2'],
    ['--ui-surface-edge', '--stone-3'],
    ['--ui-text-primary', '--paper'],
    ['--ui-text-secondary', '--paper-dim'],
    ['--ui-text-muted', '--paper-mute'],
    ['--ui-action-primary', '--lapis'],
    ['--ui-action-critical', '--danger'],
    ['--ui-proof-verified', '--ok'],
    ['--ui-proof-partial', '--warn'],
  ];

  for (const [token, themeVar] of aliases) {
    it(`${token} defers to ${themeVar} before any fallback`, () => {
      const declaration = parseDeclarations(semantic).find(
        (candidate) => candidate.property === token,
      );
      expect(declaration, `${token} is not declared`).toBeDefined();
      // The theme variable must be the FIRST argument of var() — that ordering
      // is what guarantees an active theme always wins over Room Current.
      expect(declaration!.value.trim()).toMatch(new RegExp(`^var\\(\\s*${themeVar}\\s*,`));
    });
  }

  it('supplies a dark and a light fallback contract', () => {
    const css = stripCssComments(semantic);
    expect(css).toMatch(/@media\s*\(\s*prefers-color-scheme:\s*light\s*\)/);
    expect(css).toMatch(/\[data-ui-scheme='light'\]/);
    expect(css).toMatch(/\[data-ui-scheme='dark'\]/);
  });

  it('gates the OS light contract behind :root:not([data-theme])', () => {
    // ThemeProvider always writes data-theme, so a real Onyx theme — including
    // the light cuts (pearl, frost) — is never second-guessed by a media query.
    const css = stripCssComments(semantic);
    const block = css.match(
      /@media\s*\(\s*prefers-color-scheme:\s*light\s*\)\s*\{\s*([^{]+)\{/,
    );
    expect(block).not.toBeNull();
    expect(block![1]!.trim()).toBe(':root:not([data-theme])');
  });

  it('flips only the fallback slots, never a semantic name', () => {
    // One definition per semantic token is what keeps the system greppable.
    const css = stripCssComments(semantic);
    for (const rule of parseRules(css)) {
      if (rule.selector === ':root') continue;
      const redefined = parseDeclarations(`x{${rule.body}}`).filter(
        (declaration) =>
          declaration.property.startsWith('--ui-') &&
          !declaration.property.startsWith('--ui-fallback-'),
      );
      expect(redefined.map((declaration) => declaration.property)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. index entrypoint
// ---------------------------------------------------------------------------

describe('index.css composes the layers in cascade order', () => {
  it('imports exactly the five layers, in order', () => {
    const imported = [...stripCssComments(indexCss).matchAll(/@import\s+'\.\/([^']+)'/g)].map(
      (match) => match[1]!,
    );
    expect(imported).toEqual([...LAYER_ORDER]);
  });

  it('declares nothing of its own', () => {
    expect(parseRules(stripCssComments(indexCss))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Consumer contract
// ---------------------------------------------------------------------------

describe('consumer stylesheets stay inside the system', () => {
  it('system-specimen.css hardcodes nothing the token layer owns', () => {
    expect(findConsumerViolations(specimenCss)).toEqual([]);
  });

  it('renders every truth state through its proof token', () => {
    const css = stripCssComments(specimenCss);
    for (const state of TRUTH_STATES) {
      expect(css, state).toMatch(new RegExp(`\\[data-ui-truth='${state}'\\]`));
      expect(css, `${state} wash`).toMatch(new RegExp(`var\\(--ui-proof-${state}-wash\\)`));
    }
  });
});

// ---------------------------------------------------------------------------
// 8. The contract helpers themselves
// ---------------------------------------------------------------------------

describe('contract helpers', () => {
  it('treats color-mix over tokens as a derivation, not a literal', () => {
    const css = ':root { --ui-x: color-mix(in oklab, var(--ui-text-primary) 12%, transparent); }';
    expect(findColorLiteralViolations(css, [])).toEqual([]);
  });

  it('catches a hex smuggled into a consumer declaration', () => {
    const violations = findConsumerViolations('.a { color: #ff0000; }');
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]!.reason).toMatch(/raw colour literal/);
  });

  it('catches a magic z-index in a consumer declaration', () => {
    const violations = findConsumerViolations('.a { z-index: 9999; }');
    expect(violations.some((violation) => violation.reason.includes('--ui-z-'))).toBe(true);
  });

  it('accepts system colour keywords inside a forced-colors block', () => {
    expect(findConsumerViolations('.a { color: CanvasText; }')).toEqual([]);
  });

  it('ignores hexes that appear only in prose', () => {
    const css = '/* Room Current basalt is #111718 */\n:root { --ui-a: var(--room-basalt); }';
    expect(findColorLiteralViolations(css, [])).toEqual([]);
  });

  it('reports the original line number despite stripped comments', () => {
    const css = '/* one\n   two */\n.a { color: #abcdef; }';
    const [violation] = findColorLiteralViolations(css, []);
    expect(violation!.line).toBe(3);
  });

  it('flags a visual rule that escaped the .ui-root scope', () => {
    const violations = findUnscopedVisualRules('button { color: var(--ui-text-primary); }');
    expect(violations).toHaveLength(1);
    expect(violations[0]!.reason).toMatch(/outside an opted-in scope/);
  });

  it('allows a :root block that declares only custom properties', () => {
    expect(findUnscopedVisualRules(':root { --ui-a: 1px; }')).toEqual([]);
  });

  it('flags a redeclared theme-owned property', () => {
    const violations = findThemeOwnedRedeclarations(':root { --stone: var(--room-basalt); }');
    expect(violations).toHaveLength(1);
    expect(violations[0]!.property).toBe('--stone');
  });

  it('does not mistake a namespaced token for a theme property', () => {
    // `--ui-type-md` shares a prefix with the theme-owned `--text-md` only
    // after the `--ui-` namespace is stripped — the check must not do that.
    expect(findThemeOwnedRedeclarations(':root { --ui-type-md: 1rem; }')).toEqual([]);
  });
});
