// SPDX-License-Identifier: AGPL-3.0-or-later
/** Static, keyboard-operable community preview — a fictional game-night room. */
import { createSignal, For, type JSX } from 'solid-js';

type PreviewState = 'room' | 'home' | 'messages';
type PreviewPerson = { name: string; initial: string; kind: 'person' | 'room' };
type PreviewMessage = { nick: string; initial: string; text: string; time: string; you?: boolean };
type PreviewPanel = {
  id: PreviewState;
  label: string;
  title: string;
  body: string;
  roomTitle: string;
  roomTopic: string;
  people: readonly PreviewPerson[];
  messages: readonly PreviewMessage[];
};

const PANELS: readonly PreviewPanel[] = [
  {
    id: 'room',
    label: 'Room',
    title: 'A room with room to stay awhile.',
    body: 'A fictional game-night room, shown as a static example.',
    roomTitle: 'Friday co-op',
    roomTopic: 'Co-op tonight; voice when we need it.',
    people: [
      { name: 'mika', initial: 'M', kind: 'person' },
      { name: 'jun', initial: 'J', kind: 'person' },
      { name: 'you', initial: 'Y', kind: 'person' },
    ],
    messages: [
      { nick: 'mika', initial: 'M', text: 'One more round?', time: '19:42' },
      { nick: 'jun', initial: 'J', text: 'Give me five minutes.', time: '19:43' },
      { nick: 'you', initial: 'Y', text: 'I’ll meet you in voice.', time: '19:44', you: true },
    ],
  },
  {
    id: 'home',
    label: 'Home',
    title: 'Pick up where you left off.',
    body: 'A fictional Home view showing a few places to return to.',
    roomTitle: 'Home',
    roomTopic: 'Rooms you already share',
    people: [
      { name: 'Friday co-op', initial: 'F', kind: 'room' },
      { name: 'Studio hours', initial: 'S', kind: 'room' },
      { name: '@mika', initial: 'M', kind: 'person' },
    ],
    messages: [
      { nick: 'Friday co-op', initial: 'F', text: 'One more round?', time: 'last time' },
      { nick: 'Studio hours', initial: 'S', text: 'Give me five minutes.', time: 'on device' },
      { nick: '@mika', initial: 'M', text: 'I’ll meet you in voice.', time: 'saved here' },
    ],
  },
  {
    id: 'messages',
    label: 'Messages',
    title: 'A quieter side conversation.',
    body: 'A fictional DM shape: a direct conversation beside your rooms.',
    roomTitle: '@mika',
    roomTopic: 'Just the two of you',
    people: [
      { name: 'mika', initial: 'M', kind: 'person' },
      { name: 'you', initial: 'Y', kind: 'person' },
    ],
    messages: [
      { nick: 'mika', initial: 'M', text: 'One more round?', time: '19:42' },
      { nick: 'you', initial: 'Y', text: 'I’ll meet you in voice.', time: '19:43', you: true },
    ],
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
        <div>
          <p class="product-preview__label">Fictional game-night preview</p>
          <h2 id="product-preview-title">Friday co-op</h2>
        </div>
        <p class="product-preview__disclaimer">Not a live room. The controls below only change this example.</p>
      </div>

      <div ref={(element) => { tablistRef = element; }} class="product-preview__tabs" role="tablist" aria-label="Preview areas" aria-describedby="preview-tabs-help" onKeyDown={onKeyDown}>
        <For each={PANELS}>{(panel) => (
          <button
            type="button"
            role="tab"
            aria-selected={active() === panel.id}
            aria-controls={`preview-panel-${panel.id}`}
            id={`preview-tab-${panel.id}`}
            tabIndex={active() === panel.id ? 0 : -1}
            onClick={() => setActive(panel.id)}
          >
            {panel.label}
          </button>
        )}</For>
      </div>
      <span id="preview-tabs-help" class="product-preview__a11y-note">Use the arrow keys to move between preview areas.</span>

      <div class="product-preview__canvas" role="tabpanel" id={`preview-panel-${current().id}`} aria-labelledby={`preview-tab-${current().id}`} tabIndex="0">
        <div class="product-preview__scene" data-preview-scene>
          <div class="product-preview__scene-topline">
            <div class="product-preview__scene-brand"><span aria-hidden="true" /> <strong>Onyx</strong></div>
            <span class="product-preview__scene-state">Static example</span>
            <div class="home-mascot-scene" aria-hidden="true">
              <img class="home-mascot" src="/brand/mascot-transparent.png" width="132" height="132" alt="" decoding="async" />
            </div>
          </div>

          <div class="product-preview__scene-layout">
            <div class="product-preview__room-context">
              <p class="product-preview__scene-label">Room</p>
              <div class="product-preview__room-title">
                <span class="product-preview__room-glyph" aria-hidden="true">{current().roomTitle.slice(0, 1)}</span>
                <div>
                  <h3>{current().roomTitle}</h3>
                  <p>{current().roomTopic}</p>
                </div>
              </div>
              <ul class="product-preview__people" aria-label="People in this fictional scene">
                <For each={current().people}>{(person) => (
                  <li>
                    <span classList={{ 'is-room': person.kind === 'room' }} aria-hidden="true">{person.initial}</span>
                    <strong>{person.name}</strong>
                  </li>
                )}</For>
              </ul>
            </div>

            <div class="product-preview__conversation">
              <div class="product-preview__conversation-head">
                <span>Conversation</span>
                <strong>{current().roomTitle}</strong>
              </div>
              <div class="product-preview__messages">
                <For each={current().messages}>{(message) => (
                  <article class="product-preview__message" classList={{ 'is-you': !!message.you }}>
                    <span class="product-preview__face" aria-hidden="true">{message.initial}</span>
                    <div>
                      <p class="product-preview__message-meta"><strong>{message.nick}</strong><time>{message.time}</time></p>
                      <p class="product-preview__message-text">{message.text}</p>
                    </div>
                  </article>
                )}</For>
              </div>
            </div>
          </div>

        </div>

        <div class="product-preview__caption">
          <h3>{current().title}</h3>
          <p>{current().body}</p>
        </div>
      </div>
    </section>
  );
}
