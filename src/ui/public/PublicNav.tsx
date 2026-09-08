// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createSignal, For, onCleanup, type JSX } from 'solid-js';
import { normalisePublicRoutePath, publicNavigationRoutes } from '@/ui/navigation/publicRouteManifest';
export type PublicNavItem = Readonly<{ label: string; href: string }>;

/** Shared runtime items, derived from the canonical public-route manifest. */
export const PUBLIC_NAV_ITEMS: readonly PublicNavItem[] = publicNavigationRoutes();

export function PublicNav(props: { currentPath?: string; items?: readonly PublicNavItem[] }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let toggleRef: HTMLButtonElement | undefined;
  let navRef: HTMLElement | undefined;
  let clusterRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!open()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        toggleRef!.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      if (!toggleRef!.offsetParent) return setOpen(false);
      const first = navRef!.querySelector<HTMLAnchorElement>('a[href]');
      const last = clusterRef!.querySelector<HTMLAnchorElement>('.public-frame__open');
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        toggleRef!.focus();
      } else if (!event.shiftKey && document.activeElement === toggleRef) {
        event.preventDefault();
        first.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        toggleRef!.focus();
      } else if (event.shiftKey && document.activeElement === toggleRef) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  const onToggle = () => {
    const next = !open();
    setOpen(next);
    if (next) navRef!.querySelector<HTMLAnchorElement>('a[href]')?.focus();
  };

  return (
    <div ref={clusterRef} class="public-frame__nav-cluster">
      <div class="public-frame__nav-links">
        <nav
          ref={navRef}
          id="public-primary-navigation"
          class="public-frame__nav"
          classList={{ 'is-open': open() }}
          aria-label="Primary navigation"
        >
          <For each={props.items ?? PUBLIC_NAV_ITEMS}>
            {(item) => (
              <a href={item.href} aria-current={normalisePublicRoutePath(item.href) === normalisePublicRoutePath(props.currentPath) ? 'page' : undefined} onClick={() => setOpen(false)}>
                {item.label}
              </a>
            )}
          </For>
        </nav>
      </div>
      <div class="public-frame__nav-actions">
        <a class="public-frame__open" href="/app/">Open Onyx</a>
        <button
          ref={toggleRef}
          class="public-frame__menu-toggle"
          type="button"
          aria-expanded={open()}
          aria-controls="public-primary-navigation"
          aria-label={open() ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={onToggle}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
