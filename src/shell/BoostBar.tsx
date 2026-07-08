/**
 * BoostBar.tsx — quiet boost pill row for pre-aggregated reaction groups.
 */

import { For, Show, type JSX } from 'solid-js';
import type { BoostGroup } from '@/lib/reactions/quietBoosts';
import './BoostBar.css';

const BOOST_TITLE_REACTOR_LIMIT = 4;

function formatBoostTitle(group: BoostGroup): string {
  const visibleReactors = group.reactors.slice(0, BOOST_TITLE_REACTOR_LIMIT);
  const hiddenCount = Math.max(0, group.count - visibleReactors.length);
  const hiddenLabel = hiddenCount > 0 ? ` +${hiddenCount}` : '';

  if (visibleReactors.length === 0) {
    return `${group.count} ${group.count === 1 ? 'boost' : 'boosts'}`;
  }

  return `${visibleReactors.join(', ')}${hiddenLabel}`;
}

export function BoostBar(props: {
  boosts: readonly BoostGroup[];
  onBoost?: (emoji: string) => void;
  onAdd?: () => void;
}): JSX.Element {
  return (
    <Show when={props.boosts.length > 0 || props.onAdd}>
      <div class="boost-bar" aria-label="Boosts">
        <For each={props.boosts}>
          {(group) => (
            <button
              type="button"
              class="boost-pill"
              classList={{ you: group.youBoosted }}
              aria-pressed={group.youBoosted}
              title={formatBoostTitle(group)}
              onClick={() => props.onBoost?.(group.emoji)}
            >
              <span class="boost-emoji" aria-hidden="true">
                {group.emoji}
              </span>
              <span class="boost-count">{group.count}</span>
            </button>
          )}
        </For>
        <Show when={props.onAdd}>
          <button type="button" class="boost-pill boost-add" aria-label="Add a boost" onClick={() => props.onAdd?.()}>
            ＋
          </button>
        </Show>
      </div>
    </Show>
  );
}
