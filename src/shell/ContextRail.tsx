// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ContextRail — optional room context, deliberately closed until requested.
 *
 * It projects the selected room and public aggregate insights only; message,
 * member, and transport state continue to live in their existing surfaces.
 */
import { createEffect, createMemo, Show, splitProps, type JSX } from 'solid-js';
import { useStore } from '@/lib/store';
import { statsRoomHref } from '@/lib/stats/channelDetail';
import { RoomInsightsStrip } from './RoomInsightsStrip';
import { ModerationCockpit } from './ModerationCockpit';
import { OperEventConsole } from './OperEventConsole';
import { preferences } from '@/lib/prefs/preferences';

export type ContextRailProps = {
  open: boolean;
  onClose: () => void;
};

export function ContextRail(props: ContextRailProps): JSX.Element {
  const [local] = splitProps(props, ['open', 'onClose']);
  let railRef: HTMLElement | undefined;
  const activeView = useStore((s) => s.activeView);
  const isOper = useStore((s) => s.isOper);
  const experienceMode = () => preferences().experienceMode;
  const title = createMemo(() => {
    const view = activeView();
    if (view.kind === 'channel') return view.channel;
    if (view.kind === 'dm') return view.nick;
    return 'Room';
  });
  const channelLedger = createMemo(() => {
    const view = activeView();
    if (view.kind !== 'channel') return null;
    const name = view.channel.trim();
    if (!/^[#&]/.test(name)) return null;
    return { channel: name, href: statsRoomHref(name) };
  });
  createEffect(() => {
    if (!local.open) return;
    queueMicrotask(() => railRef?.querySelector<HTMLElement>('.shell-context-rail__close')?.focus());
  });

  // Mirrors MemberList's inert-toggle precedent: Solid's DOM property table
  // predates `HTMLElement.inert` in some supported runtimes, so assigning a
  // boolean JSX property can become an inert expando instead of a real DOM
  // attribute. toggleAttribute guarantees a real boolean attribute so every
  // browser activates native inertness from it, while aria-hidden below
  // covers assistive tech independently.
  createEffect(() => {
    railRef?.toggleAttribute('inert', !local.open);
  });

  return (
    <aside
      ref={(element) => { railRef = element; }}
      class="shell-context-rail"
      id="shell-context-rail"
      aria-label="Room context"
      aria-hidden={local.open ? undefined : 'true'}
      data-open={local.open ? 'true' : 'false'}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        local.onClose();
      }}
    >
      <div class="shell-context-rail__head">
        <div>
          <p class="shell-context-rail__eyebrow">Context</p>
          <h2>{title()}</h2>
          <Show when={channelLedger()}>
            {(ledger) => (
              <a
                class="shell-context-rail__ledger shell-ribbon-stats"
                href={ledger().href}
                aria-label={`Room ledger for ${ledger().channel}`}
                data-testid="context-rail-channel-ledger"
              >
                Room ledger
              </a>
            )}
          </Show>
        </div>
        <button type="button" class="shell-context-rail__close" title="Close room context" onClick={() => local.onClose()}>
          <span aria-hidden="true">×</span><span class="sr-only">Close room context</span>
        </button>
      </div>
      <Show when={activeView().kind === 'channel'} fallback={<p class="shell-context-rail__empty">Select a room to see its shared context.</p>}>
        <>
          <RoomInsightsStrip />
          <Show when={experienceMode() !== 'standard'}>
            <>
              <ModerationCockpit channel={(activeView() as { channel: string }).channel} />
              <Show when={experienceMode() === 'irc-ops' && isOper()}>
                <OperEventConsole />
              </Show>
              <Show when={experienceMode() === 'irc-ops' && !isOper()}>
                <p class="shell-context-rail__empty" role="status">Operator tools appear here after this account is granted access.</p>
              </Show>
            </>
          </Show>
        </>
      </Show>
    </aside>
  );
}
