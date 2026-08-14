// SPDX-License-Identifier: AGPL-3.0-or-later
/** A keyboard-operable, explicitly static product preview for the public home. */
import { createSignal, For, type JSX } from 'solid-js';

type PreviewState = 'rooms' | 'continuity' | 'protection';
type PreviewPanel = { id: PreviewState; label: string; title: string; body: string; items: readonly string[] };

const PANELS: readonly PreviewPanel[] = [
  { id: 'rooms', label: 'Rooms', title: 'Keep the next conversation easy to find.', body: 'Organize conversations into rooms and direct messages without turning the page into a feed of strangers.', items: ['Room list', 'Direct messages', 'Call entry'] },
  { id: 'continuity', label: 'Continuity', title: 'Pick up on this device.', body: 'Onyx keeps local continuity features visible as product behavior, not as a promise about a particular network moment.', items: ['Local history', 'Session resume', 'Read position'] },
  { id: 'protection', label: 'Protection', title: 'See the state before you act.', body: 'Protection and connection state are labeled in the client. This illustration does not claim a live secure session.', items: ['Connection state', 'Media status', 'Device-aware controls'] },
];

export function ProductPreview(): JSX.Element {
  const [active, setActive] = createSignal<PreviewState>('rooms');
  let tablistRef: HTMLDivElement | undefined;
  const current = () => PANELS.find((panel) => panel.id === active()) ?? PANELS[0]!;
  const select = (index: number, moveFocus = false) => {
    const id = PANELS[index]?.id ?? 'rooms';
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
    <section class="product-preview" aria-labelledby="product-preview-title" data-product-preview data-preview-state={active()}>
      <div class="product-preview__head">
        <p class="product-preview__eyebrow">Static product preview</p>
        <h2 id="product-preview-title">A guided look at Onyx</h2>
        <p>This is an illustration of product areas, not live rooms, people, messages, or network activity.</p>
      </div>
      <div ref={(element) => { tablistRef = element; }} class="product-preview__tabs" role="tablist" aria-label="Preview areas" onKeyDown={onKeyDown}>
        <For each={PANELS}>{(panel) => (
          <button type="button" role="tab" aria-selected={active() === panel.id} aria-controls={`preview-panel-${panel.id}`} id={`preview-tab-${panel.id}`} tabindex={active() === panel.id ? 0 : -1} onClick={() => setActive(panel.id)}>{panel.label}</button>
        )}</For>
      </div>
      <div class="product-preview__canvas" role="tabpanel" id={`preview-panel-${current().id}`} aria-labelledby={`preview-tab-${current().id}`} tabindex="0">
        <span class="product-preview__canvas-label">Static preview · {current().label}</span>
        <div class="product-preview__window" aria-hidden="true">
          <div class="product-preview__dock"><i /><i /><i /></div>
          <div class="product-preview__rail"><span /><span /><span /></div>
          <div class="product-preview__content"><b /><b /><b /></div>
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
