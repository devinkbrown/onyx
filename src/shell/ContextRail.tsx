// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ContextRail — optional room context, deliberately closed until requested.
 *
 * It projects the selected room and public aggregate insights only; message,
 * member, and transport state continue to live in their existing surfaces.
 */
import { createComponent, createEffect, createMemo, createResource, createSignal, ErrorBoundary, Show, Suspense, splitProps, type Component, type JSX } from 'solid-js';
import { useStore } from '@/lib/store';
import { statsRoomHref } from '@/lib/stats/channelDetail';
type LoadedModule<P extends object = object> = { default: Component<P> };

function RetryableSurface<P extends object>(props: {
  label: string;
  loader: () => Promise<LoadedModule<P>>;
  componentProps: P;
}): JSX.Element {
  const [attempt, setAttempt] = createSignal(0);
  // The loader is intentionally stable; `attempt` is the only reactive input.
  // eslint-disable-next-line solid/reactivity
  const [loaded] = createResource(attempt, () => props.loader());
  return (
    <ErrorBoundary fallback={(_error, reset) => (
      <p class="shell-lazy-state" role="alert">
        {props.label} failed.{' '}
        <button type="button" onClick={() => { setAttempt((value) => value + 1); reset(); }}>Retry</button>{' '}
      </p>
    )}>
      <Suspense fallback={<p class="shell-lazy-state" role="status">Loading {props.label.toLowerCase()}…</p>}>
        <Show when={loaded()} keyed>{(module) => createComponent(module.default, props.componentProps)}</Show>
      </Suspense>
    </ErrorBoundary>
  );
}

const roomInsightsLoader = () => import('./RoomInsightsStrip').then((m) => ({ default: m.RoomInsightsStrip }));
const moderationLoader = () => import('./ModerationCockpit').then((m) => ({ default: m.ModerationCockpit }));
const operDeskLoader = () => import('./OperDesk').then((m) => ({ default: m.OperDesk }));
const operEventConsoleLoader = () => import('./OperEventConsole').then((m) => ({ default: m.OperEventConsole }));
import { preferences } from '@/lib/prefs/preferences';

export type ContextRailProps = {
  open: boolean;
  modal?: boolean;
  onClose: () => void;
};

export function ContextRail(props: ContextRailProps): JSX.Element {
  const [local] = splitProps(props, ['open', 'modal', 'onClose']);
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
      aria-modal={local.modal && local.open ? 'true' : undefined}
      role={local.modal ? 'dialog' : 'complementary'}
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
        <Show when={local.open}>
        <>
          <RetryableSurface label="Room insights" loader={roomInsightsLoader} componentProps={{}} />
          <Show when={experienceMode() !== 'standard'}>
            <>
              <Show when={activeView()} keyed>
                {(view) => view.kind === 'channel' ? (
                  <RetryableSurface label="Room tools" loader={moderationLoader} componentProps={{ channel: view.channel }} />
                ) : null}
              </Show>
              {/* Operator surfaces follow the grant, not the experience mode: an
                  oper who prefers the calmer advanced layout still needs the desk
                  and the event feed, and gating them behind network-ops hid the
                  only UI for the store's operAction. */}
              <Show when={isOper()}>
                <>
                  <RetryableSurface label="Operator desk" loader={operDeskLoader} componentProps={{}} />
                  <RetryableSurface label="Operator events" loader={operEventConsoleLoader} componentProps={{}} />
                </>
              </Show>
              <Show when={experienceMode() === 'network-ops' && !isOper()}>
                <p class="shell-context-rail__empty" role="status">Operator tools appear here after this account is granted access.</p>
              </Show>
            </>
          </Show>
        </>
        </Show>
      </Show>
    </aside>
  );
}
