// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PrimaryNavigation.tsx — one product-frame navigation spine.
 *
 * Desktop and mobile use the same destinations and state semantics. A
 * collection can be selected/expanded without pretending that the You dialog
 * is a location. Conversation rows own the location marker; this component
 * only marks the current top-level surface.
 */

import { For, Show, splitProps, type JSX } from 'solid-js';

export type PrimarySection = 'home' | 'rooms' | 'messages' | 'calls' | 'you';
export type PrimaryCurrentSection = Exclude<PrimarySection, 'you'>;
export type PrimaryCollection = Extract<PrimarySection, 'rooms' | 'messages'>;
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
  /** Mobile keeps Calls and You in the More sheet without losing either destination. */
  moreOpen?: boolean;
  onOpenMore?: () => void;
  onSelect: (section: PrimarySection) => void;
};

type NavigationItem = {
  section: PrimarySection;
  label: string;
  glyph: string;
};

const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { section: 'home', label: 'Home', glyph: '⌂' },
  { section: 'rooms', label: 'Rooms', glyph: '#' },
  { section: 'messages', label: 'Messages', glyph: '@' },
  { section: 'calls', label: 'Calls', glyph: '◉' },
  { section: 'you', label: 'You', glyph: '◇' },
];

const MOBILE_ITEMS: readonly NavigationItem[] = [
  { section: 'home', label: 'Home', glyph: '⌂' },
  { section: 'rooms', label: 'Rooms', glyph: '#' },
  { section: 'messages', label: 'Inbox', glyph: '@' },
];

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
    'moreOpen',
    'onOpenMore',
    'onSelect',
  ]);

  const isMobile = (): boolean => local.variant === 'mobile';
  const current = (section: PrimarySection): boolean => local.currentSection === section;
  const selected = (section: PrimarySection): boolean =>
    isCollection(section) && local.selectedCollection === section;
  const expanded = (section: PrimarySection): boolean | undefined => {
    if (!isCollection(section) || local.expandedCollection === undefined) return undefined;
    return local.expandedCollection === section;
  };

  const renderItem = (item: NavigationItem): JSX.Element => {
    const itemCurrent = () => current(item.section);
    const itemSelected = () => selected(item.section);
    const itemExpanded = () => expanded(item.section);
    const className = (): string => {
      const base = isMobile() ? 'shell-mobile-nav-btn' : 'shell-primary-nav-btn';
      const classes = [base];
      if (itemCurrent()) classes.push(`${base}--active`);
      if (itemSelected()) classes.push(`${base}--selected`);
      if (item.section === 'you' && local.youDialogOpen) classes.push(`${base}--dialog-open`);
      return classes.join(' ');
    };

    return (
      <button
        type="button"
        ref={item.section === 'rooms' ? local.mobileRoomsButtonRef : undefined}
        class={className()}
        data-primary-nav-item
        data-section={item.section}
        data-selected={itemSelected() ? 'true' : undefined}
        data-expanded={itemExpanded() === true ? 'true' : itemExpanded() === false ? 'false' : undefined}
        aria-label={isMobile() ? `Open ${item.label}` : undefined}
        aria-current={itemCurrent() ? 'page' : undefined}
        aria-pressed={isCollection(item.section) ? itemSelected() : undefined}
        aria-expanded={isCollection(item.section) ? itemExpanded() : item.section === 'you' ? local.youDialogOpen : undefined}
        aria-haspopup={item.section === 'you' ? 'dialog' : undefined}
        title={isMobile() ? `Open ${item.label}` : `Quick switch to ${item.label}`}
        onClick={() => local.onSelect(item.section)}
      >
        {isMobile() ? (
          <span class="shell-mobile-nav-icon" aria-hidden="true">{item.glyph}</span>
        ) : (
          <span class="shell-primary-nav-icon" aria-hidden="true">{item.glyph}</span>
        )}
        {item.label}
      </button>
    );
  };

  const renderMore = (): JSX.Element => (
    <button
      type="button"
      class={`shell-mobile-nav-btn${local.moreOpen ? ' shell-mobile-nav-btn--dialog-open' : ''}`}
      data-primary-nav-item
      data-section="more"
      aria-label="Open More"
      aria-expanded={local.moreOpen}
      aria-haspopup="dialog"
      title="Open More"
      onClick={() => local.onOpenMore?.()}
    >
      <span class="shell-mobile-nav-icon" aria-hidden="true">•••</span>
      More
    </button>
  );

  return (
    <nav
      class={isMobile() ? 'shell-mobile-nav' : 'shell-primary-nav'}
      aria-label={isMobile() ? 'Mobile navigation' : 'Primary'}
      data-primary-navigation
      data-primary-navigation-variant={local.variant}
    >
      {!isMobile() && <span class="shell-primary-nav-context">Quick switch</span>}
      <For each={isMobile() ? MOBILE_ITEMS : NAVIGATION_ITEMS}>{renderItem}</For>
      <Show when={isMobile()}>{renderMore()}</Show>
    </nav>
  );
}
