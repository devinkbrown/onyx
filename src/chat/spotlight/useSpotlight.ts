// SPDX-License-Identifier: AGPL-3.0-or-later
import { children, createSignal, onCleanup, onMount, type Accessor, type JSX, type ParentProps } from 'solid-js';

const [isSpotlightOpen, setSpotlightOpen] = createSignal(false);
const [spotlightInitialQuery, setSpotlightInitialQuery] = createSignal('');

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-spotlight-ignore]')) return true;

  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable ||
    target.getAttribute('role') === 'textbox'
  );
}

function handleGlobalKeyDown(event: KeyboardEvent): void {
  // Browser integrations and input methods get first refusal. In particular,
  // a composing `k` or `/` must never tear open a modal over the candidate
  // window, and an earlier listener's preventDefault is an explicit claim.
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;

  const key = event.key.toLowerCase();
  const isLauncherCombo = key === 'k'
    && (event.metaKey || event.ctrlKey)
    && !event.shiftKey
    && !event.altKey;
  const isSlashLauncher = event.key === '/'
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
    && !isEditableTarget(event.target);

  if (!isLauncherCombo && !isSlashLauncher) return;

  event.preventDefault();
  openSpotlight();
}

export function openSpotlight(query = ''): void {
  setSpotlightInitialQuery(query);
  setSpotlightOpen(true);
}

export function closeSpotlight(): void {
  setSpotlightOpen(false);
  setSpotlightInitialQuery('');
}

export function toggleSpotlight(): void {
  setSpotlightOpen((open) => !open);
}

export function useSpotlight(): {
  isOpen: Accessor<boolean>;
  initialQuery: Accessor<string>;
  open: (query?: string) => void;
  close: () => void;
  toggle: () => void;
} {
  return {
    isOpen: isSpotlightOpen,
    initialQuery: spotlightInitialQuery,
    open: openSpotlight,
    close: closeSpotlight,
    toggle: toggleSpotlight,
  };
}

export function useSpotlightHotkeys(): void {
  onMount(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleGlobalKeyDown));
  });
}

export function SpotlightProvider(props: ParentProps): JSX.Element {
  useSpotlightHotkeys();
  const resolved = children(() => props.children);
  // A children() accessor is a valid Solid JSX child at runtime; the TS JSX
  // typing just doesn't admit the accessor type in a .ts file.
  return resolved as unknown as JSX.Element;
}
