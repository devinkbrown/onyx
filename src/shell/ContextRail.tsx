// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ContextRail — optional room context, deliberately closed until requested.
 *
 * It projects the selected room and public aggregate insights only; message,
 * member, and transport state continue to live in their existing surfaces.
 */
import { createEffect, createMemo, Show, splitProps, type JSX } from 'solid-js';
import { useStore } from '@/lib/store';
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
    return 'Workspace';
  });
  createEffect(() => {
    if (!local.open) return;
    queueMicrotask(() => railRef?.querySelector<HTMLElement>('.shell-context-rail__close')?.focus());
  });

  return (
    <aside
      ref={(element) => { railRef = element; }}
      class="shell-context-rail"
      id="shell-context-rail"
      aria-label="Room context"
      aria-hidden={!local.open}
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
                <p class="shell-context-rail__empty" role="status">IRC Ops tools appear here after this account is granted operator access.</p>
              </Show>
            </>
          </Show>
        </>
      </Show>
    </aside>
  );
}
