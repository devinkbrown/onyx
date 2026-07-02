import { children, createSignal, onCleanup, onMount, type Accessor, type JSX, type ParentProps } from 'solid-js';

const [isSpotlightOpen, setSpotlightOpen] = createSignal(false);

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
  const key = event.key.toLowerCase();
  const isLauncherCombo = key === 'k' && (event.metaKey || event.ctrlKey);
  const isSlashLauncher = event.key === '/' && !isEditableTarget(event.target);

  if (!isLauncherCombo && !isSlashLauncher) return;

  event.preventDefault();
  openSpotlight();
}

export function openSpotlight(): void {
  setSpotlightOpen(true);
}

export function closeSpotlight(): void {
  setSpotlightOpen(false);
}

export function toggleSpotlight(): void {
  setSpotlightOpen((open) => !open);
}

export function useSpotlight(): {
  isOpen: Accessor<boolean>;
  open: () => void;
  close: () => void;
  toggle: () => void;
} {
  return {
    isOpen: isSpotlightOpen,
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
