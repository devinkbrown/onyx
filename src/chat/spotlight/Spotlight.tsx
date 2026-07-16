// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  splitProps,
  untrack,
  type JSX,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { fuzzyFilter, type HighlightRange } from './fuzzy';
import { useCommands, type SpotlightCommand, type SpotlightSection } from './commands';
import { closeSpotlight, useSpotlight } from './useSpotlight';
import './spotlight.css';

type MatchedCommand = {
  command: SpotlightCommand;
  ranges: HighlightRange[];
};

type CommandGroup = {
  section: SpotlightSection;
  items: Array<MatchedCommand & { index: number }>;
};

export type SpotlightProps = JSX.HTMLAttributes<HTMLDivElement>;

const SECTION_ORDER: SpotlightSection[] = ['Channels', 'DMs', 'People', 'Actions'];
const LISTBOX_ID = 'onyx-spotlight-listbox';
const INPUT_ID = 'onyx-spotlight-input';

// Token-tinted leading glyphs, one per section (CSS tints them per data-section).
const SECTION_ICON: Record<SpotlightSection, string> = {
  Channels: '#',
  DMs: '@',
  People: '◇',
  Actions: '→',
};
const GRAMMAR_EXAMPLES = [
  'goto #root',
  'goto #root at yesterday 21:00',
  'at: last friday 18:00',
  'unread #root',
  'leave #root',
  'search roadmap',
  'vault hybrid',
  'vault semantic',
  'translate spanish',
  'reader on',
  'star #root',
  'away lunch',
  'focus',
  'schedule 15m: ping the team',
  'review #root',
  'mute 1h',
] as const;

function optionId(index: number): string {
  return `onyx-spotlight-option-${index}`;
}

function keyboardEventIsClaimed(event: KeyboardEvent): boolean {
  // Candidate navigation and confirmation belong to the active input method,
  // not to Spotlight. The legacy 229 value covers engines that drop
  // `isComposing` on the final keydown. Also honor an earlier listener that
  // deliberately claimed the key before the palette sees it.
  return event.defaultPrevented || event.isComposing || event.keyCode === 229;
}

function tabbables(root: HTMLElement): HTMLElement[] {
  const selectors = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const browserHasLayout = root.getClientRects().length > 0;
  return Array.from(root.querySelectorAll<HTMLElement>(selectors))
    .filter((node) => (
      !node.hasAttribute('hidden')
      && node.getAttribute('aria-hidden') !== 'true'
      // Responsive CSS can remove controls without adding a hidden attribute.
      // Real browsers expose no client rects for those nodes; jsdom exposes no
      // layout for anything, so retain the semantic fallback used by unit tests.
      && (!browserHasLayout || node.getClientRects().length > 0)
    ));
}

function titleSegments(title: string, ranges: readonly HighlightRange[]) {
  const segments: Array<{ text: string; mark: boolean }> = [];
  let cursor = 0;

  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: title.slice(cursor, range.start), mark: false });
    segments.push({ text: title.slice(range.start, range.end), mark: true });
    cursor = range.end;
  }

  if (cursor < title.length) segments.push({ text: title.slice(cursor), mark: false });
  return segments;
}

function HighlightedTitle(props: { title: string; ranges: HighlightRange[] }) {
  const [local] = splitProps(props, ['title', 'ranges']);
  const segments = createMemo(() => titleSegments(local.title, local.ranges));

  return (
    <span class="onyx-spotlight__title">
      <For each={segments()}>
        {(segment) => (
          <Dynamic component={segment.mark ? 'mark' : 'span'}>
            {segment.text}
          </Dynamic>
        )}
      </For>
    </span>
  );
}

export function Spotlight(props: SpotlightProps) {
  const [local, rest] = splitProps(props, ['class']);
  const spotlight = useSpotlight();
  const commands = useCommands();
  const [query, setQuery] = createSignal('');
  const [activeIndex, setActiveIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;
  let panelRef: HTMLDivElement | undefined;
  let resultsRef: HTMLDivElement | undefined;
  let restoreFocusTo: HTMLElement | null = null;

  const matches = createMemo<MatchedCommand[]>(() => (
    fuzzyFilter(
      commands(),
      query(),
      (command) => command.title,
      (command) => command.keywords,
    ).map((result) => ({ command: result.item, ranges: result.ranges }))
  ));

  const groups = createMemo<CommandGroup[]>(() => {
    const bySection = new Map<SpotlightSection, Array<MatchedCommand & { index: number }>>();
    matches().forEach((item, index) => {
      const bucket = bySection.get(item.command.section) ?? [];
      bucket.push({ ...item, index });
      bySection.set(item.command.section, bucket);
    });

    return SECTION_ORDER
      .map((section) => ({ section, items: bySection.get(section) ?? [] }))
      .filter((group) => group.items.length > 0);
  });

  const activeCommand = createMemo(() => matches()[activeIndex()]?.command);
  const activeOptionId = createMemo(() => activeCommand() ? optionId(activeIndex()) : undefined);
  const activeHint = createMemo(() => {
    if (activeCommand()) return `Selected command: ${activeCommand()!.title}`;
    if (query().trim()) return 'No matching command';
    return 'Try goto, at, search, schedule, reader, density, motion, or mute commands';
  });

  // Result-set announcement for the live region. Keyed to the filtered set only
  // (never activeIndex) so arrow navigation is announced solely by
  // aria-activedescendant and never double-announced here (SC 4.1.3).
  const resultsAnnouncement = createMemo(() => {
    const count = matches().length;
    if (count === 0) return query().trim() ? 'No matching command' : '';
    return `${count} command${count === 1 ? '' : 's'} available`;
  });

  createEffect(() => {
    const count = matches().length;
    setActiveIndex((index) => {
      if (count === 0) return 0;
      return Math.min(index, count - 1);
    });
  });

  createEffect(() => {
    if (!spotlight.isOpen()) {
      setQuery('');
      setActiveIndex(0);
      restoreFocusTo?.focus?.();
      restoreFocusTo = null;
      return;
    }

    // Capture the launcher only on the open transition. If this effect re-runs
    // while already open (e.g. openSpotlight(query) with a new initial query),
    // document.activeElement is the in-dialog input — re-capturing it would
    // strand focus on close (SC 2.4.3 Focus Order).
    if (!restoreFocusTo) {
      restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setQuery(spotlight.initialQuery());
    queueMicrotask(() => inputRef?.focus());
  });

  createEffect(() => {
    const id = activeOptionId();
    if (!spotlight.isOpen() || !id) return;

    // aria-activedescendant deliberately keeps DOM focus in the combobox, so
    // the browser will not reveal an off-screen option for us as Arrow keys
    // advance through the scrollable listbox.
    queueMicrotask(() => {
      if (!untrack(spotlight.isOpen) || untrack(activeOptionId) !== id) return;
      const option = resultsRef?.querySelector<HTMLElement>(`#${id}`);
      option?.scrollIntoView?.({ block: 'nearest' });
    });
  });

  onCleanup(() => {
    if (spotlight.isOpen()) closeSpotlight();
  });

  const runActive = (): void => {
    const command = activeCommand();
    if (!command) return;

    const result = command.run();
    closeSpotlight();
    void Promise.resolve(result);
  };

  const moveActive = (delta: number): void => {
    const count = matches().length;
    if (count === 0) return;

    setActiveIndex((index) => (index + delta + count) % count);
  };

  const trapTab = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab' || !panelRef) return;

    const nodes = tabbables(panelRef);
    if (nodes.length === 0) {
      event.preventDefault();
      panelRef.focus();
      return;
    }

    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleKeyDown: JSX.EventHandlerUnion<HTMLInputElement, KeyboardEvent> = (event) => {
    if (keyboardEventIsClaimed(event)) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      runActive();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeSpotlight();
      return;
    }

    trapTab(event);
  };

  const handleRootKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (keyboardEventIsClaimed(event)) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeSpotlight();
      return;
    }

    trapTab(event);
  };

  const commitInputQuery = (value: string): void => {
    setQuery(value);
    setActiveIndex(0);
  };

  const handleInput: JSX.EventHandlerUnion<HTMLInputElement, InputEvent> = (event) => {
    // Interim composition input is not a committed search query. Re-ranking
    // the listbox and its live-region count while the candidate window is open
    // makes both the visual result set and screen-reader feedback churn.
    if (event.isComposing) return;
    commitInputQuery(event.currentTarget.value);
  };

  const handleCompositionEnd: JSX.EventHandlerUnion<HTMLInputElement, CompositionEvent> = (event) => {
    commitInputQuery(event.currentTarget.value);
  };

  return (
    <Show when={spotlight.isOpen()}>
      <div
        {...rest}
        class={['onyx-spotlight', local.class].filter(Boolean).join(' ')}
        role="presentation"
        onKeyDown={handleRootKeyDown}
      >
        <div
          ref={panelRef}
          class="onyx-spotlight__panel"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          tabIndex={-1}
        >
          <div class="onyx-spotlight__search">
            <svg
              class="onyx-spotlight__sigil"
              viewBox="0 0 16 16"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="4.25" />
              <line x1="10.4" y1="10.4" x2="13.5" y2="13.5" />
            </svg>
            <input
              ref={inputRef}
              id={INPUT_ID}
              class="onyx-spotlight__input"
              role="combobox"
              type="text"
              value={query()}
              autocomplete="off"
              spellcheck={false}
              aria-label="Command search"
              aria-describedby="onyx-spotlight-grammar-hint"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={LISTBOX_ID}
              aria-activedescendant={activeOptionId()}
              placeholder="Search channels, people, and actions"
              onInput={handleInput}
              onCompositionEnd={handleCompositionEnd}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              class="onyx-spotlight__close"
              aria-label="Close spotlight"
              onClick={() => closeSpotlight()}
            >
              <svg
                viewBox="0 0 14 14"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <line x1="3.5" y1="3.5" x2="10.5" y2="10.5" />
                <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" />
              </svg>
            </button>
          </div>

          <div class="onyx-spotlight__grammar" id="onyx-spotlight-grammar-hint">
            <span class="onyx-spotlight__grammar-label">Time grammar</span>
            <div class="onyx-spotlight__grammar-examples" role="group" aria-label="Command examples">
              <For each={GRAMMAR_EXAMPLES}>
                {(example) => (
                  <button
                    type="button"
                    class="onyx-spotlight__grammar-example"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (!inputRef) return;
                      // Drive the real input so BOTH the local mirror (onInput)
                      // and the command layer's document-level 'input' bridge see
                      // the query. Setting the signal alone leaves useCommands
                      // stale, so the grammar command the chip teaches never
                      // surfaces (the DOM input is the single source of truth).
                      inputRef.value = example;
                      inputRef.dispatchEvent(new Event('input', { bubbles: true }));
                      queueMicrotask(() => inputRef?.focus());
                    }}
                    aria-label={`Use command example ${example}`}
                  >
                    {example}
                  </button>
                )}
              </For>
            </div>
            <span class="onyx-spotlight__grammar-status">{activeHint()}</span>
          </div>

          <div
            ref={resultsRef}
            id={LISTBOX_ID}
            class="onyx-spotlight__results"
            role="listbox"
            aria-label="Commands"
          >
            <Show
              when={groups().length > 0}
              fallback={
                <div class="onyx-spotlight__empty">
                  <span class="onyx-spotlight__empty-mark" aria-hidden="true">⌕</span>
                  <span class="onyx-spotlight__empty-text">Nothing surfaces yet</span>
                  <span class="onyx-spotlight__empty-sub">Try a channel, a name, or an action</span>
                </div>
              }
            >
              <For each={groups()}>
                {(group) => (
                  <div
                    class="onyx-spotlight__group"
                    role="group"
                    aria-label={group.section}
                    data-section={group.section}
                  >
                    <span class="onyx-spotlight__section" aria-hidden="true">{group.section}</span>
                    <For each={group.items}>
                      {(item) => (
                        <div
                          id={optionId(item.index)}
                          class="onyx-spotlight__option"
                          role="option"
                          aria-selected={activeIndex() === item.index}
                          onMouseMove={() => setActiveIndex(item.index)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setActiveIndex(item.index);
                            runActive();
                          }}
                        >
                          <span class="onyx-spotlight__icon" aria-hidden="true">
                            {SECTION_ICON[group.section]}
                          </span>
                          <HighlightedTitle title={item.command.title} ranges={item.ranges} />
                          <Show when={item.command.hint}>
                            {(hint) => <span class="onyx-spotlight__hint">{hint()}</span>}
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>

          {/* Polite results summary for assistive tech. Lives outside the
              grammar-hint (aria-describedby) block and is keyed only to the
              result set, so it never doubles the aria-activedescendant
              announcement of the active option (SC 4.1.3 Status Messages). */}
          <span class="sr-only" role="status">{resultsAnnouncement()}</span>
        </div>
      </div>
    </Show>
  );
}

export default Spotlight;
