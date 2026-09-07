// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PrimaryNavigation.tsx — one product-frame navigation spine.
 *
 * Desktop and mobile use the same destinations and state semantics. A
 * collection can be selected/expanded without pretending that the You dialog
 * is a location. Conversation rows own the location marker; this component
 * only marks the current top-level surface.
 *
 * Labels and current/selected/expanded state come from shellNavigationModel
 * so the IA stays single-sourced.
 */

import { For, createMemo, splitProps, type JSX } from 'solid-js';
import './commercial-navigation.css';
import {
  createShellNavigationModel,
  type ShellCollectionId,
  type ShellLocationId,
  type ShellNavigationId,
  type ShellNavigationItem,
} from './navigation/shellNavigationModel';

export type PrimarySection = ShellNavigationId;
export type PrimaryCurrentSection = ShellLocationId;
export type PrimaryCollection = ShellCollectionId;
export type PrimaryNavigationVariant = 'desktop' | 'mobile';

export type PrimaryNavigationProps = {
  variant: PrimaryNavigationVariant;
  /** Current top-level location. `you` is intentionally not representable. */
  currentSection?: PrimaryCurrentSection | null;
  /** Collection selected by the shell, independent from drawer expansion. */
  selectedCollection?: PrimaryCollection | null;
  /** `undefined` means this nav does not own an expandable collection. */
  expandedCollection?: PrimaryCollection | null;
  /** The account dialog is a transient surface, never a current location. */
  youDialogOpen?: boolean;
  /** Focus return target for the mobile Rooms drawer trigger. */
  mobileRoomsButtonRef?: (element: HTMLButtonElement) => void;
  /** Focus return target for the mobile You dialog trigger. */
  mobileYouButtonRef?: (element: HTMLButtonElement) => void;
  onSelect: (section: PrimarySection) => void;
};

const NAV_ICONS: Record<ShellNavigationId, string> = {
  home: 'M3 10.5 12 3l9 7.5v9a1 1 0 0 1-1 1h-5v-6H8v6H4a1 1 0 0 1-1-1z',
  rooms: 'M4 5.5h16v11H8l-4 3v-14Zm4 4h8m-8 3h5',
  messages: 'M4 5h16v11H8l-4 3V5Zm4 4h8m-8 3h5',
  calls: 'M7 4.5h3l1.5 4-2 1.5a11 11 0 0 0 4.5 4.5l1.5-2 4 1.5v3c0 1-1 1.5-2 1.5C10 18.5 5.5 14 5.5 6.5c0-1 0.5-2 1.5-2Z',
  you: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
};

function isCollection(section: PrimarySection): section is PrimaryCollection {
  return section === 'rooms' || section === 'messages';
}

/** Keep keyboard focus visible without moving the page or vertical ancestors. */
export function revealMobileNavigationFocus(
  rail: HTMLElement | undefined,
  control: HTMLElement | undefined,
): void {
  if (!rail?.isConnected || !control?.isConnected) return;

  const railRect = rail.getBoundingClientRect();
  const controlRect = control.getBoundingClientRect();
  const style = getComputedStyle(rail);
  const safeLeft = railRect.left + Number.parseFloat(style.paddingLeft || '0');
  const safeRight = railRect.right - Number.parseFloat(style.paddingRight || '0');
  let left = rail.scrollLeft;

  if (controlRect.left < safeLeft) {
    left += controlRect.left - safeLeft;
  } else if (controlRect.right > safeRight) {
    left += controlRect.right - safeRight;
  } else {
    return;
  }

  const maxLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
  left = Math.min(maxLeft, Math.max(0, left));
  rail.scrollLeft = left;
}

export function PrimaryNavigation(props: PrimaryNavigationProps): JSX.Element {
  const [local] = splitProps(props, [
    'variant',
    'currentSection',
    'selectedCollection',
    'expandedCollection',
    'youDialogOpen',
    'mobileRoomsButtonRef',
    'mobileYouButtonRef',
    'onSelect',
  ]);

  const isMobile = (): boolean => local.variant === 'mobile';
  const model = createMemo(() => createShellNavigationModel({
    variant: local.variant,
    current: local.currentSection,
    selectedCollection: local.selectedCollection,
    expandedCollection: local.expandedCollection,
    youDialogOpen: local.youDialogOpen,
  }));
  const items = createMemo(() => [...model()]);

  const renderItem = (item: ShellNavigationItem): JSX.Element => {
    const className = (): string => {
      const base = isMobile() ? 'shell-mobile-nav-btn' : 'shell-primary-nav-btn';
      const classes = [base];
      if (item.current) classes.push(`${base}--active`);
      if (item.selected) classes.push(`${base}--selected`);
      if (item.id === 'you' && local.youDialogOpen) classes.push(`${base}--dialog-open`);
      return classes.join(' ');
    };
    return (
      <button
        type="button"
        ref={
          item.id === 'rooms'
            ? local.mobileRoomsButtonRef
            : item.id === 'you'
              ? local.mobileYouButtonRef
              : undefined
        }
        class={className()}
        data-primary-nav-item
        data-section={item.id}
        data-selected={item.selected ? 'true' : undefined}
        data-expanded={item.expanded === true ? 'true' : item.expanded === false ? 'false' : undefined}
        aria-label={isMobile() ? `Open ${item.label}` : undefined}
        aria-current={item.current ? 'page' : undefined}
        aria-pressed={isCollection(item.id) ? item.selected : undefined}
        aria-expanded={isCollection(item.id) ? item.expanded : item.id === 'you' ? local.youDialogOpen : undefined}
        aria-haspopup={item.hasPopup}
        title={isMobile() ? `Open ${item.label}` : `Quick switch to ${item.label}`}
        data-tooltip={isMobile() ? undefined : `Quick switch to ${item.label}`}
        onFocus={(event) => {
          if (isMobile()) {
            const rail = event.currentTarget.parentElement ?? undefined;
            const control = event.currentTarget;
            // Chromium may apply its native focus scroll after the focus event.
            // Reveal on the next frame so our horizontal-only correction wins
            // without scrollIntoView moving vertical ancestors.
            // Chromium can apply native focus scrolling after one or more
            // frames at extreme zoom. A zero-delay task runs after that
            // browser work while still correcting only this horizontal rail.
            setTimeout(() => revealMobileNavigationFocus(rail, control), 0);
          }
        }}
        onClick={() => local.onSelect(item.id)}
      >
        {isMobile() ? (
          <span class="shell-mobile-nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d={NAV_ICONS[item.id]} /></svg></span>
        ) : (
          <span class="shell-primary-nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d={NAV_ICONS[item.id]} /></svg></span>
        )}
        {item.label}
      </button>
    );
  };

  return (
    <nav
      class={isMobile() ? 'shell-mobile-nav' : 'shell-primary-nav'}
      aria-label={isMobile() ? 'Mobile navigation' : 'Primary'}
      data-primary-navigation
      data-primary-navigation-variant={local.variant}
    >
      {!isMobile() && <span class="shell-primary-nav-context">Quick switch</span>}
      <For each={items()}>{renderItem}</For>
    </nav>
  );
}
