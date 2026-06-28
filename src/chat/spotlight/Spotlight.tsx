import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  splitProps,
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
const LISTBOX_ID = 'ruri-spotlight-listbox';
const INPUT_ID = 'ruri-spotlight-input';

// Token-tinted leading glyphs, one per section (CSS tints them per data-section).
const SECTION_ICON: Record<SpotlightSection, string> = {
  Channels: '#',
  DMs: '@',
  People: '◇',
  Actions: '→',
};

function optionId(index: number): string {
  return `ruri-spotlight-option-${index}`;
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

  return Array.from(root.querySelectorAll<HTMLElement>(selectors))
    .filter((node) => !node.hasAttribute('hidden') && node.getAttribute('aria-hidden') !== 'true');
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
    <span class="ruri-spotlight__title">
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

    restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => inputRef?.focus());
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
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSpotlight();
      return;
    }

    trapTab(event);
  };

  const handleInput: JSX.EventHandlerUnion<HTMLInputElement, InputEvent> = (event) => {
    setQuery((event.currentTarget as HTMLInputElement).value);
    setActiveIndex(0);
  };

  return (
    <Show when={spotlight.isOpen()}>
      <div
        {...rest}
        class={['ruri-spotlight', local.class].filter(Boolean).join(' ')}
        role="presentation"
        onKeyDown={handleRootKeyDown}
      >
        <div
          ref={panelRef}
          class="ruri-spotlight__panel"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          tabIndex={-1}
        >
          <div class="ruri-spotlight__search">
            <svg
              class="ruri-spotlight__sigil"
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
              class="ruri-spotlight__input"
              role="combobox"
              type="text"
              value={query()}
              autocomplete="off"
              spellcheck={false}
              aria-label="Command search"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={LISTBOX_ID}
              aria-activedescendant={activeOptionId()}
              placeholder="Search channels, people, and actions"
              onInput={handleInput}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              class="ruri-spotlight__close"
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

          <div id={LISTBOX_ID} class="ruri-spotlight__results" role="listbox" aria-label="Commands">
            <Show
              when={groups().length > 0}
              fallback={
                <div class="ruri-spotlight__empty">
                  <span class="ruri-spotlight__empty-mark" aria-hidden="true">⌕</span>
                  <span class="ruri-spotlight__empty-text">Nothing surfaces yet</span>
                  <span class="ruri-spotlight__empty-sub">Try a channel, a name, or an action</span>
                </div>
              }
            >
              <For each={groups()}>
                {(group) => (
                  <div
                    class="ruri-spotlight__group"
                    role="group"
                    aria-label={group.section}
                    data-section={group.section}
                  >
                    <span class="ruri-spotlight__section" aria-hidden="true">{group.section}</span>
                    <For each={group.items}>
                      {(item) => (
                        <div
                          id={optionId(item.index)}
                          class="ruri-spotlight__option"
                          role="option"
                          aria-selected={activeIndex() === item.index}
                          onMouseMove={() => setActiveIndex(item.index)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setActiveIndex(item.index);
                            runActive();
                          }}
                        >
                          <span class="ruri-spotlight__icon" aria-hidden="true">
                            {SECTION_ICON[group.section]}
                          </span>
                          <HighlightedTitle title={item.command.title} ranges={item.ranges} />
                          <Show when={item.command.hint}>
                            {(hint) => <span class="ruri-spotlight__hint">{hint()}</span>}
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}

export default Spotlight;
