// SPDX-License-Identifier: AGPL-3.0-or-later
import { createMemo, For, type JSX } from 'solid-js';

import { useThemeOptional } from './ThemeProvider';
import { buildDefaultLookEntries, moveRadioGroup } from './publicLooks';

export function PublicLookPicker(props: {
  class?: string;
  groupLabel?: string;
}): JSX.Element {
  const theme = useThemeOptional();
  const entries = createMemo(() => buildDefaultLookEntries(theme.themeId(), theme.customThemes()));

  return (
    <div
      class={props.class ?? 'ap-panel-themes'}
      role="radiogroup"
      aria-label={props.groupLabel ?? 'Look'}
      style={{ 'touch-action': 'manipulation' }}
    >
      <For each={entries()}>
        {(entry) => {
          const active = () => theme.themeId() === entry.id;
          return (
            <button
              type="button"
              class="ap-theme-chip"
              classList={{ 'ap-theme-chip--on': active(), 'ap-theme-chip--custom': entry.extra }}
              role="radio"
              aria-checked={active()}
              aria-label={`${entry.label} look`}
              title={entry.title}
              tabIndex={active() ? 0 : -1}
              style={{ 'min-height': '44px', 'touch-action': 'manipulation' }}
              onKeyDown={moveRadioGroup}
              onClick={() => theme.setTheme(entry.id)}
            >
              <span class="ap-theme-swatch" aria-hidden="true">
                <For each={entry.swatch}>{(color) => <span style={{ background: color }} />}</For>
              </span>
              <span class="ap-theme-name">{entry.label}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
}
