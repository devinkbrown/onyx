// SPDX-License-Identifier: AGPL-3.0-or-later
/** Static, keyboard-operable community preview — a labeled room, not live data. */
import { createSignal, For, type JSX } from 'solid-js';

type PreviewState = 'room' | 'home' | 'messages';
type RoomChip = { name: string; kind: 'room' | 'person'; active?: boolean; unread?: boolean };
type PreviewMessage = { nick: string; initial: string; text: string; time: string; you?: boolean };
type PreviewPanel = {
  id: PreviewState;
  label: string;
  title: string;
  body: string;
  items: readonly string[];
  roomTitle: string;
  roomTopic: string;
  rooms: readonly RoomChip[];
  messages: readonly PreviewMessage[];
  stage?: { title: string; detail: string } | null;
  composer: string;
};

const PANELS: readonly PreviewPanel[] = [
  {
    id: 'room',
    label: 'Room',
    title: 'Friends in a room that stays open.',
    body: 'A labeled look at a room.',
    items: ['A shared room', 'People you invited', 'A call when you want one'],
    roomTitle: 'Weekend plans',
    roomTopic: 'Saturday dinner and a porch call',
    rooms: [
      { name: 'Home', kind: 'room' },
      { name: 'Weekend plans', kind: 'room', active: true },
      { name: 'Studio hours', kind: 'room', unread: true },
      { name: '@mika', kind: 'person' },
    ],
    messages: [
      { nick: 'mika', initial: 'M', text: 'dinner’s at 7:30 if that still works', time: '19:42' },
      { nick: 'you', initial: 'Y', text: 'perfect — I’ll grab bread on the way', time: '19:43', you: true },
      { nick: 'jun', initial: 'J', text: 'joining the porch call after the dishes', time: '19:44' },
    ],
    stage: { title: 'Porch call', detail: 'Hop in when you are ready' },
    composer: 'Message Weekend plans',
  },
  {
    id: 'home',
    label: 'Home',
    title: 'Catch up when you get back.',
    body: 'Home is a quiet list of rooms you already share.',
    items: ['What you missed', 'Saved on this device', 'Pick up mid-conversation'],
    roomTitle: 'Home',
    roomTopic: 'Come back whenever you like',
    rooms: [
      { name: 'Home', kind: 'room', active: true },
      { name: 'Weekend plans', kind: 'room' },
      { name: 'Studio hours', kind: 'room', unread: true },
      { name: '@mika', kind: 'person' },
    ],
    messages: [
      { nick: 'Weekend plans', initial: 'W', text: 'jun replied about the porch call', time: 'today' },
      { nick: 'Studio hours', initial: 'S', text: 'Two notes waiting since last time', time: 'today' },
      { nick: '@mika', initial: 'M', text: 'Your draft is still here', time: 'local' },
    ],
    stage: null,
    composer: 'Jump to a room',
  },
  {
    id: 'messages',
    label: 'Messages',
    title: 'A quiet side conversation.',
    body: 'Direct messages sit next to rooms.',
    items: ['Same people', 'A side chat', 'Shown as a DM, not a room'],
    roomTitle: '@mika',
    roomTopic: 'Just the two of you',
    rooms: [
      { name: 'Home', kind: 'room' },
      { name: 'Weekend plans', kind: 'room' },
      { name: '@mika', kind: 'person', active: true },
      { name: '@jun', kind: 'person' },
    ],
    messages: [
      { nick: 'mika', initial: 'M', text: 'can you send the address again?', time: '19:40' },
      { nick: 'you', initial: 'Y', text: 'on my way — I’ll drop it here', time: '19:41', you: true },
    ],
    stage: null,
    composer: 'Message @mika',
  },
];

export function ProductPreview(): JSX.Element {
  const [active, setActive] = createSignal<PreviewState>('room');
  let tablistRef: HTMLDivElement | undefined;
  const current = () => PANELS.find((panel) => panel.id === active()) ?? PANELS[0]!;
  const select = (index: number, moveFocus = false) => {
    const id = PANELS[index]?.id ?? 'room';
    setActive(id);
    if (moveFocus) queueMicrotask(() => tablistRef?.querySelector<HTMLElement>(`#preview-tab-${id}`)?.focus());
  };

  function onKeyDown(event: KeyboardEvent): void {
    const index = PANELS.findIndex((panel) => panel.id === active());
    if (event.key === 'ArrowRight') { event.preventDefault(); select((index + 1) % PANELS.length, true); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); select((index - 1 + PANELS.length) % PANELS.length, true); }
    if (event.key === 'Home') { event.preventDefault(); select(0, true); }
    if (event.key === 'End') { event.preventDefault(); select(PANELS.length - 1, true); }
  }

  return (
    <section class="product-preview" id="community" aria-labelledby="product-preview-title" data-product-preview data-preview-state={active()}>
      <div class="product-preview__head">
        <p class="product-preview__eyebrow">Preview</p>
        <h2 id="product-preview-title">A look inside a room</h2>
        <p>Weekend plans — a labeled conversation, not a live room.</p>
      </div>
      <div ref={(element) => { tablistRef = element; }} class="product-preview__tabs" role="tablist" aria-label="Preview areas" onKeyDown={onKeyDown}>
        <For each={PANELS}>{(panel) => (
          <button type="button" role="tab" aria-selected={active() === panel.id} aria-controls={`preview-panel-${panel.id}`} id={`preview-tab-${panel.id}`} tabindex={active() === panel.id ? 0 : -1} onClick={() => setActive(panel.id)}>{panel.label}</button>
        )}</For>
      </div>
      <div class="product-preview__canvas" role="tabpanel" id={`preview-panel-${current().id}`} aria-labelledby={`preview-tab-${current().id}`} tabindex="0">
        <span class="product-preview__canvas-label">Preview · {current().label}</span>
        <div class="product-preview__window" aria-hidden="true">
          <div class="product-preview__rail">
            <For each={current().rooms}>{(room) => (
              <span classList={{ 'is-active': !!room.active, 'is-unread': !!room.unread, 'is-person': room.kind === 'person', 'is-room': room.kind === 'room' }}>{room.name}</span>
            )}</For>
          </div>
          <div class="product-preview__content">
            <div class="product-preview__roombar">
              <strong>{current().roomTitle}</strong>
              <small>{current().roomTopic}</small>
            </div>
            {current().stage ? (
              <div class="product-preview__stage">
                <strong>{current().stage!.title}</strong>
                <small>{current().stage!.detail}</small>
                <em>Call</em>
              </div>
            ) : null}
            <div class="product-preview__thread">
              <For each={current().messages}>{(msg) => (
                <div class="product-preview__msg" classList={{ 'is-you': !!msg.you }}>
                  <span class="product-preview__face" data-you={msg.you ? 'true' : undefined}>{msg.initial}</span>
                  <p><b>{msg.nick}</b> {msg.text}</p>
                  <time>{msg.time}</time>
                </div>
              )}</For>
            </div>
            <div class="product-preview__composer">{current().composer}</div>
          </div>
        </div>
        <div class="product-preview__copy">
          <h3>{current().title}</h3>
          <p>{current().body}</p>
          <ul><For each={current().items}>{(item) => <li>{item}</li>}</For></ul>
        </div>
      </div>
    </section>
  );
}
