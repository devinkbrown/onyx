// SPDX-License-Identifier: AGPL-3.0-or-later
/** Theme-dependent aliases and readable inks for filled semantic controls. */

import { contrastRatio, parseColor, resolveCssColor, type RGB } from './contrast';
import type { TokenMap } from './themes';

const BLACK = '#000000';
const WHITE = '#ffffff';

const TOKEN_REFERENCE = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/;

function rgb(value: string | undefined, tokens: TokenMap, depth = 0): RGB | null {
  if (!value) return null;
  if (depth < 8) {
    const reference = TOKEN_REFERENCE.exec(value.trim())?.[1];
    if (reference) return rgb(tokens[reference], tokens, depth + 1);
  }
  return parseColor(value) ?? resolveCssColor(value);
}

/** Pick the candidate with the strongest worst-case contrast across all fills. */
function readableInk(tokens: TokenMap, fills: readonly (string | undefined)[]): string {
  const backgrounds = fills.map((value) => rgb(value, tokens)).filter((value): value is RGB => value !== null);
  const candidates = [tokens['--ink'], tokens['--paper'], BLACK, WHITE]
    .filter((value): value is string => typeof value === 'string');
  if (backgrounds.length === 0) return tokens['--paper'] ?? WHITE;

  let best = candidates[0] ?? WHITE;
  let bestScore = -1;
  for (const candidate of candidates) {
    const foreground = rgb(candidate, tokens);
    if (!foreground) continue;
    const score = Math.min(...backgrounds.map((background) => contrastRatio(foreground, background)));
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function semanticThemeTokens(tokens: TokenMap): TokenMap {
  const danger = tokens['--danger'] ?? tokens['--shu'];
  return {
    '--accent': tokens['--lapis'] ?? tokens['--lapis-bright'] ?? '#5ba3c9',
    '--on-accent': readableInk(tokens, [tokens['--lapis'], tokens['--lapis-bright']]),
    '--on-secondary': readableInk(tokens, [tokens['--gold-bright'] ?? tokens['--gold']]),
    '--on-danger': readableInk(tokens, [danger, tokens['--shu']]),
  };
}
