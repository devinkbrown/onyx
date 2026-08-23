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

const GLYPHS: Record<ShellNavigationId, string> = {
  home: '⌂',
  rooms: '#',
  messages: '@',
  calls: '◉',
  you: '◇',
};

function isCollection(section: PrimarySection): section is PrimaryCollection {
  return section === 'rooms' || section === 'messages';
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
        onClick={() => local.onSelect(item.id)}
      >
        {isMobile() ? (
          <span class="shell-mobile-nav-icon" aria-hidden="true">{GLYPHS[item.id]}</span>
        ) : (
          <span class="shell-primary-nav-icon" aria-hidden="true">{GLYPHS[item.id]}</span>
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
