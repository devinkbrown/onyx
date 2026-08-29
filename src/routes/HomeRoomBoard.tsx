// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The public home has no room-presence API. This is therefore an honest room
 * switchboard: it helps a visitor choose a known, useful way into Onyx rather
 * than implying that these are live occupancy or activity figures.
 */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { publicRouteById } from '@/ui/navigation/publicRouteManifest';

type RoomIntent = 'public-room' | 'bring-people' | 'learn';

type RoomRoute = {
  id: RoomIntent;
  tab: string;
  kicker: string;
  title: string;
  copy: string;
  action: string;
  href: string;
  note: string;
  route: readonly string[];
};

const ROOM_ROUTES: readonly RoomRoute[] = [
  {
    id: 'public-room',
    tab: 'Meet people',
    kicker: 'Known public room',
    title: 'Walk into the public room.',
    copy: 'Start with the room that is open to everyone, then decide where you want to go next.',
    action: 'Open the public room',
    href: `${publicRouteById('invite').href}?join=%23root`,
    note: 'This opens the official app with the public-room link ready.',
    route: ['Open Onyx', 'Enter the public room', 'Choose your next room'],
  },
  {
    id: 'bring-people',
    tab: 'Bring people',
    kicker: 'Start with your people',
    title: 'Make the room yours.',
    copy: 'Open Onyx first. From there, create a room or share an invite with the people you already know.',
    action: 'Open Onyx',
    href: '/app/',
    note: 'Room creation and invitations happen in the app, not on this page.',
    route: ['Open Onyx', 'Make a room', 'Share an invite'],
  },
  {
    id: 'learn',
    tab: 'Get oriented',
    kicker: 'First time here',
    title: 'Take the small first step.',
    copy: 'A short guide shows how rooms, invitations, messages, and calls fit together before you open the app.',
    action: 'Read the first-room guide',
    href: publicRouteById('guides').href,
    note: 'The guide is local reading; it does not create an account or send anything.',
    route: ['Read the guide', 'Open a room', 'Invite someone when ready'],
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
        <p class="home-room-board__eyebrow">Choose your way in</p>
        <h2 id="room-board-title">One doorway. Three good first moves.</h2>
        <p>Pick what you want to do. These are clear paths into Onyx, not a live list of who is online.</p>
      </div>

      <div ref={(element) => { tablist = element; }} class="home-room-board__tabs" role="tablist" aria-label="Choose a first-room route" onKeyDown={onKeyDown}>
        <For each={ROOM_ROUTES}>{(item) => (
          <button
            type="button"
            role="tab"
            id={`room-route-${item.id}`}
            aria-controls={`room-route-panel-${item.id}`}
            aria-selected={intent() === item.id}
            tabindex={intent() === item.id ? 0 : -1}
            onClick={() => setIntent(item.id)}
          >
            {item.tab}
          </button>
        )}</For>
      </div>

      <div class="home-room-board__panel" role="tabpanel" id={`room-route-panel-${active().id}`} aria-labelledby={`room-route-${active().id}`} tabindex="0">
        <div class="home-room-board__map" aria-hidden="true">
          <span class="home-room-board__current" />
          <span class="home-room-board__line home-room-board__line--one" />
          <span class="home-room-board__line home-room-board__line--two" />
          <span class="home-room-board__line home-room-board__line--three" />
          <span class="home-room-board__node home-room-board__node--one" />
          <span class="home-room-board__node home-room-board__node--two" />
          <span class="home-room-board__node home-room-board__node--three" />
        </div>
        <div class="home-room-board__content">
          <p class="home-room-board__kicker">{active().kicker}</p>
          <h3>{active().title}</h3>
          <p>{active().copy}</p>
          <ol aria-label="What happens next">
            <For each={active().route}>{(step, index) => <li><span>{index() + 1}</span>{step}</li>}</For>
          </ol>
          <a class="home-room-board__action" href={active().href}>{active().action}<span aria-hidden="true">→</span></a>
          <p class="home-room-board__note" aria-live="polite">{active().note}</p>
        </div>
      </div>
      <Show when={intent() === 'public-room'}>
        <p class="home-room-board__footnote">Want a quieter start? <a href={publicRouteById('guides').href}>Read the guide first</a>.</p>
      </Show>
    </section>
  );
}
