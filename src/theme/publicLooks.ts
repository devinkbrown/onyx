// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Default-path appearance faces. Theme Studio and the full catalogue stay off
 * this list — callers render those under Advanced.
 */
import { THEMES, PUBLIC_THEME_IDS, PUBLIC_THEME_LABELS, type ThemeId } from './themes';
import { customThemeTokens, getCustomTheme, type CustomTheme } from './customThemes';

export type PublicLookEntry = {
  id: string;
  label: string;
  title: string;
  swatch: string[];
  extra: boolean;
};

export function swatchFromTokens(tokens: Record<string, string>): string[] {
  return [
    tokens['--lapis'] ?? tokens['--accent'] ?? '#2bb4f0',
    tokens['--gold'] ?? '#d8b96a',
    tokens['--stone-2'] ?? tokens['--bg-raised'] ?? '#0f2740',
  ];
}

function builtinLook(id: ThemeId, extra: boolean): PublicLookEntry {
  const meta = THEMES[id];
  return {
    id,
    label: extra ? meta.label : PUBLIC_THEME_LABELS[id as keyof typeof PUBLIC_THEME_LABELS] ?? meta.label,
    title: meta.description,
    swatch: swatchFromTokens(meta.tokens as Record<string, string>),
    extra,
  };
}

/** Ocean / Pearl, plus the active look when it is outside that public set. */
export function buildDefaultLookEntries(
  activeId: string,
  customThemes: readonly CustomTheme[] = [],
): PublicLookEntry[] {
  const looks: PublicLookEntry[] = PUBLIC_THEME_IDS.map((id) => builtinLook(id, false));
  if (looks.some((entry) => entry.id === activeId)) return looks;

  const builtin = THEMES[activeId as ThemeId];
  if (builtin) {
    looks.push(builtinLook(builtin.id, true));
    return looks;
  }

  const custom = customThemes.find((theme) => theme.id === activeId) ?? getCustomTheme(activeId);
  if (custom) {
    looks.push({
      id: custom.id,
      label: custom.name,
      title: `Saved look based on ${THEMES[custom.base]?.label ?? custom.base}`,
      swatch: swatchFromTokens(customThemeTokens(custom)),
      extra: true,
    });
  }
  return looks;
}

export function moveRadioGroup(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const current = event.currentTarget as HTMLButtonElement | null;
  if (!current) return;
  const group = current.closest<HTMLElement>('[role="radiogroup"]');
  const radios = group ? [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')] : [];
  const index = radios.indexOf(current);
  if (index < 0 || radios.length === 0) return;
  event.preventDefault();
  const targetIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? radios.length - 1
      : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + radios.length) % radios.length;
  const target = radios[targetIndex];
  target?.focus();
  target?.click();
}
