// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Facepile.tsx — overlapping avatar stack for the conversation ribbon.
 *
 * "Presence-as-place": a small, prioritized stack of the people in the room,
 * with a "+M" overflow chip when there are more than the cap. Selection is done
 * by the pure {@link buildFacepile} — this component only renders it.
 *
 * Each face opens the consumer people card (display name, avatar, Message /
 * Mention / Ignore). Network details stay under Advanced on that card.
 *
 * SOLID IDIOMS: never destructure props; splitProps; createMemo; For/Show;
 * component body runs once.
 */

import { createMemo, createSignal, For, Show, splitProps, type JSX } from 'solid-js';
import { getState, selectIsChannelOp, useStore } from '@/lib/store';
import type { ModerationActionDraft } from '@/lib/moderation/actionModel';
import { applyMemberModeration } from '@/lib/moderation/applyMemberModeration';
import { Avatar, Popover } from '@/primitives/index';
import { buildFacepile, type FacepileMemberInput } from './facepile';
import { PeopleProfileCard } from './PeopleProfileCard';
import { ModerationActionReview } from './moderation/ModerationActionReview';

export type FacepileProps = {
  /** Members to consider — reactive accessor so the pile tracks the roster. */
  members: () => Iterable<FacepileMemberInput>;
  /** Maximum avatars before overflow. Defaults to the module default. */
  cap?: number;
  onOpenDm?: (nick: string) => void;
  onOpenWhois?: (nick: string, returnFocus: HTMLElement) => void;
};

export function Facepile(props: FacepileProps): JSX.Element {
  const [local] = splitProps(props, ['members', 'cap', 'onOpenDm', 'onOpenWhois']);
  const [pendingModeration, setPendingModeration] = createSignal<{
    draft: ModerationActionDraft;
    returnFocus: HTMLElement | null;
  } | null>(null);

  const pile = createMemo(() =>
    buildFacepile(local.members(), local.cap === undefined ? {} : { cap: local.cap }),
  );
  const total = createMemo(() => pile().total);
  const overflow = createMemo(() => pile().overflow);
  const activeView = useStore((s) => s.activeView);
  const ourNick = useStore((s) => s.ourNick);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const serverConnected = useStore((s) => !!s.server?.connected);
  const isOper = useStore((s) => s.isOper);
  const channels = useStore((s) => s.channels);
  const channel = createMemo(() => {
    const view = activeView();
    return view.kind === 'channel' ? view.channel : '';
  });
  const canModeratePending = createMemo(() => {
    const room = pendingModeration()?.draft.channel;
    if (!room) return false;
    void isOper();
    void channels();
    void ourNick();
    return selectIsChannelOp(room)(getState());
  });

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
              <Popover
                panelLabel={`Profile for ${entry.nick}`}
                trigger={
                  <span
                    class="shell-facepile-face-hit"
                    title={entry.away ? `${entry.nick} — away` : entry.nick}
                  >
                    <Avatar
                      name={entry.nick}
                      size="sm"
                      owner={entry.owner}
                      class={entry.away ? 'shell-facepile-avatar shell-facepile-avatar--away' : 'shell-facepile-avatar'}
                      aria-hidden="true"
                    />
                    <span class="sr-only">
                      Open profile for {entry.nick}{entry.away ? ', away' : ''}
                    </span>
                  </span>
                }
              >
                <PeopleProfileCard
                  nick={entry.nick}
                  channel={channel()}
                  onOpenDm={local.onOpenDm}
                  onOpenWhois={local.onOpenWhois}
                  onRequestModeration={(draft, returnFocus) => {
                    setPendingModeration({ draft, returnFocus });
                  }}
                />
              </Popover>
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
        <ModerationActionReview
          open={pendingModeration() !== null}
          draft={pendingModeration()?.draft ?? null}
          actorNick={ourNick()}
          connected={connectionStatus() === 'connected' && serverConnected()}
          canModerate={canModeratePending()}
          returnFocus={pendingModeration()?.returnFocus ?? null}
          onConfirm={(action) => {
            applyMemberModeration(action);
            setPendingModeration(null);
          }}
          onCancel={() => setPendingModeration(null)}
        />
      </div>
    </Show>
  );
}
