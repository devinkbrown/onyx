// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * BoostBar.tsx — quiet boost pill row for pre-aggregated reaction groups.
 */

import { createMemo, For, Show, type JSX } from 'solid-js';
import type { BoostGroup } from '@/lib/reactions/quietBoosts';
import { summarizeReactions, type ReactionDensity } from '@/lib/reactions/density';
import { preferences } from '@/lib/prefs/preferences';
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
  /** Override preference; defaults to preferences().reactionDensity */
  density?: ReactionDensity;
}): JSX.Element {
  const density = createMemo(
    () => props.density ?? (preferences().reactionDensity as ReactionDensity),
  );

  const summary = createMemo(() =>
    summarizeReactions(
      props.boosts.map((g) => ({
        emoji: g.emoji,
        count: g.count,
        mine: g.youBoosted,
      })),
      density(),
    ),
  );

  return (
    <Show when={!summary().hidden && (summary().chips.length > 0 || props.onAdd || props.boosts.length > 0)}>
      <div class="boost-bar" aria-label="Boosts" data-density={density()}>
        <Show
          when={density() === 'counts-only'}
          fallback={
            <For each={density() === 'full' ? props.boosts : props.boosts.slice(0, 4)}>
              {(group) => (
                <button
                  type="button"
                  class="boost-pill"
                  classList={{ you: group.youBoosted }}
                  aria-pressed={group.youBoosted}
                  aria-label={`${group.youBoosted ? 'Remove' : 'Add'} ${group.emoji} boost, ${group.count} total`}
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
          }
        >
          <Show when={summary().chips[0]}>
            {(chip) => (
              <span class="boost-pill boost-pill--summary" aria-label={`${chip().count} total boosts`}>
                <span class="boost-emoji" aria-hidden="true">💬</span>
                <span class="boost-count">{chip().count}</span>
              </span>
            )}
          </Show>
        </Show>
        <Show when={density() === 'compact' && summary().overflow > 0}>
          <span class="boost-pill boost-pill--more" aria-label={`${summary().overflow} more reaction types`}>
            +{summary().overflow}
          </span>
        </Show>
        <Show when={props.onAdd && density() !== 'counts-only'}>
          <button type="button" class="boost-pill boost-add" aria-label="Add a boost" onClick={() => props.onAdd?.()}>
            ＋
          </button>
        </Show>
      </div>
    </Show>
  );
}
