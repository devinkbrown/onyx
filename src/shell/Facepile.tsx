// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Facepile.tsx — overlapping avatar stack for the conversation ribbon.
 *
 * "Presence-as-place": a small, prioritized stack of the people in the room,
 * with a "+M" overflow chip when there are more than the cap. Selection is done
 * by the pure {@link buildFacepile} — this component only renders it.
 *
 * SOLID IDIOMS: never destructure props; splitProps; createMemo; For/Show;
 * component body runs once.
 */

import { createMemo, For, Show, splitProps, type JSX } from 'solid-js';
import { Avatar } from '@/primitives/index';
import { buildFacepile, type FacepileMemberInput } from './facepile';

export type FacepileProps = {
  /** Members to consider — reactive accessor so the pile tracks the roster. */
  members: () => Iterable<FacepileMemberInput>;
  /** Maximum avatars before overflow. Defaults to the module default. */
  cap?: number;
};

export function Facepile(props: FacepileProps): JSX.Element {
  const [local] = splitProps(props, ['members', 'cap']);

  const pile = createMemo(() =>
    buildFacepile(local.members(), local.cap === undefined ? {} : { cap: local.cap }),
  );

  const total = createMemo(() => pile().total);
  const overflow = createMemo(() => pile().overflow);

  const groupLabel = createMemo(() => {
    const count = total();
    return `${count} ${count === 1 ? 'person' : 'people'} here`;
  });

  return (
    <Show when={total() > 0}>
      <div
        class="shell-facepile"
        role="group"
        aria-label={groupLabel()}
        style={{ display: 'inline-flex', 'align-items': 'center', 'padding-left': 'var(--space-1)' }}
      >
        <For each={pile().entries}>
          {(entry, index) => (
            <span
              class="shell-facepile-face"
              title={entry.away ? `${entry.nick} — away` : entry.nick}
              style={{
                display: 'inline-flex',
                'border-radius': '50%',
                'box-shadow': '0 0 0 2px var(--stone-2)',
                'margin-left': index() === 0 ? '0' : '-0.55rem',
                opacity: entry.away ? '0.55' : '1',
              }}
            >
              <Avatar
                name={entry.nick}
                size="sm"
                owner={entry.owner}
                class={entry.away ? 'shell-facepile-avatar shell-facepile-avatar--away' : 'shell-facepile-avatar'}
                aria-hidden="true"
              />
            </span>
          )}
        </For>
        <Show when={overflow() > 0}>
          <span
            class="shell-facepile-overflow"
            title={`${overflow()} more`}
            aria-hidden="true"
            style={{
              'margin-left': 'var(--space-1)',
              padding: '0 var(--space-2)',
              height: '2rem',
              display: 'inline-flex',
              'align-items': 'center',
              'border-radius': 'var(--space-5)',
              'box-shadow': '0 0 0 2px var(--stone-2)',
              background: 'var(--stone-3)',
              color: 'var(--paper-dim)',
              'font-family': 'var(--font-mono)',
              'font-size': '0.72rem',
              'font-weight': '600',
            }}
          >
            +{overflow()}
          </span>
        </Show>
      </div>
    </Show>
  );
}
