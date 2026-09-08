// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The public home has no room-presence API. This is therefore an honest set of
 * entry choices: it helps a visitor choose a useful way into Onyx without
 * implying that any room or person is live.
 */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { publicRouteById } from '@/ui/navigation/publicRouteManifest';

type RoomIntent = 'public-room' | 'bring-people' | 'learn';

type RoomRoute = {
  id: RoomIntent;
  tab: string;
  title: string;
  copy: string;
  action: string;
  href: string;
  note: string;
};

const PUBLIC_ROOM_HREF = `${publicRouteById('invite').href}?join=%23root`;

const ROOM_ROUTES: readonly RoomRoute[] = [
  {
    id: 'public-room',
    tab: 'Meet people',
    title: 'Walk into the public room.',
    copy: 'Start with the room that is open to everyone, then decide where you want to go next.',
    action: 'Open the public room',
    href: PUBLIC_ROOM_HREF,
    note: 'The room link opens with the public room ready; this page does not show who is online.',
  },
  {
    id: 'bring-people',
    tab: 'Bring people',
    title: 'Bring your people along.',
    copy: 'Open Onyx, make a room, then share its invite when the room is ready. Friends, clubs, and ordinary hangouts all fit here.',
    action: 'Open Onyx',
    href: '/app/',
    note: 'Room creation and invitations happen in the app, not on this page.',
  },
  {
    id: 'learn',
    tab: 'Get oriented',
    title: 'Get oriented, then join in.',
    copy: 'Read the short guide for rooms, messages, calls, and coming back later without losing the thread.',
    action: 'Read the first-room guide',
    href: publicRouteById('guides').href,
    note: 'The guide is local reading; it does not create an account or send anything.',
  },
];

export function HomeRoomBoard(): JSX.Element {
  const [intent, setIntent] = createSignal<RoomIntent>('public-room');
  const active = createMemo(() => ROOM_ROUTES.find((item) => item.id === intent()) ?? ROOM_ROUTES[0]!);
  let tablist: HTMLDivElement | undefined;

  const select = (index: number, moveFocus = false) => {
    const next = ROOM_ROUTES[index] ?? ROOM_ROUTES[0]!;
    setIntent(next.id);
    if (moveFocus) queueMicrotask(() => tablist?.querySelector<HTMLButtonElement>(`#room-route-${next.id}`)?.focus());
  };

  function onKeyDown(event: KeyboardEvent): void {
    const index = ROOM_ROUTES.findIndex((item) => item.id === intent());
    if (event.key === 'ArrowRight') { event.preventDefault(); select((index + 1) % ROOM_ROUTES.length, true); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); select((index - 1 + ROOM_ROUTES.length) % ROOM_ROUTES.length, true); }
    if (event.key === 'Home') { event.preventDefault(); select(0, true); }
    if (event.key === 'End') { event.preventDefault(); select(ROOM_ROUTES.length - 1, true); }
  }

  return (
    <section class="home-room-board" aria-labelledby="room-board-title" data-home-room-board data-room-intent={intent()}>
      <div class="home-room-board__heading">
        <h2 id="room-board-title">For the next match. And the conversation after.</h2>
        <p>Onyx gives friends, clubs, and ordinary hangouts a room to return to. Pick a useful way in; this is not a live list of who is online.</p>
      </div>

      <div ref={(element) => { tablist = element; }} class="home-room-board__tabs" role="tablist" aria-label="Choose a first-room route" onKeyDown={onKeyDown}>
        <For each={ROOM_ROUTES}>{(item) => (
          <button
            type="button"
            role="tab"
            id={`room-route-${item.id}`}
            aria-controls={`room-route-panel-${item.id}`}
            aria-selected={intent() === item.id}
            tabIndex={intent() === item.id ? 0 : -1}
            onClick={() => setIntent(item.id)}
          >
            {item.tab}
          </button>
        )}</For>
      </div>

      <div class="home-room-board__panel" role="tabpanel" id={`room-route-panel-${active().id}`} aria-labelledby={`room-route-${active().id}`} tabIndex="0">
        <div class="home-room-board__content">
          <h3>{active().title}</h3>
          <p>{active().copy}</p>
          <a class="home-room-board__action" href={active().href}>{active().action}</a>
          <p class="home-room-board__note" aria-live="polite">{active().note}</p>
        </div>
        <nav class="home-room-board__links" aria-label="Useful ways into Onyx">
          <a href={PUBLIC_ROOM_HREF}>Public room</a>
          <a href="/app/">Invite friends</a>
          <a href={publicRouteById('guides').href}>Getting started</a>
          <a href={publicRouteById('download').href}>Browser and device help</a>
        </nav>
      </div>
      <Show when={intent() === 'public-room'}>
        <p class="home-room-board__footnote">Want a quieter start? <a href={publicRouteById('guides').href}>Read the guide first</a>.</p>
      </Show>
    </section>
  );
}
