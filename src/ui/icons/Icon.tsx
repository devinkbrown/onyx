// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Icon.tsx — accessible, reactive icon component wrapper.
 *
 * Props:
 * - symbol: which icon to render (none of: MenuIcon, CloseIcon, etc.)
 * - label?: visible or aria-label text for meaningful icons
 * - size?: sm (16), md (24, default), lg (32), xl (48) — affects viewBox scale
 * - class?: additional CSS classes (currentColor + forced-colors-safe)
 *
 * Reactive props are never destructured; SolidJS maintains fine-grained reactivity.
 *
 * Decorative icons (e.g., inline next to a button label) default aria-hidden=true.
 * Meaningful icons (action icons not paired with text) require a label prop.
 *
 * No interaction/click handling — mount on a <button> or similar to be interactive.
 */

import { createMemo } from 'solid-js';
import type { Component, JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { IconSymbolProps } from './symbols';
import {
  ArrowIcon,
  CheckIcon,
  CloseIcon,
  ExternalIcon,
  InfoIcon,
  LocalIcon,
  MenuIcon,
  ReconnectIcon,
  UnknownIcon,
  WarningIcon,
} from './symbols';

export type IconSymbol = 'menu' | 'close' | 'arrow' | 'external' | 'check' | 'warning' | 'info' | 'reconnect' | 'local' | 'unknown';

export type IconSize = 'sm' | 'md' | 'lg' | 'xl';

export type IconProps = {
  /** Which icon symbol to render. */
  symbol: IconSymbol;
  /** Label text (aria-label) for meaningful icons, or visible label paired with decorative icon. */
  label?: string;
  /** Icon size: sm=16, md=24 (default), lg=32, xl=48. */
  size?: IconSize;
  /** Additional CSS class names. */
  class?: string;
};

/**
 * Get the numeric size in pixels for a given size token.
 * Used to set width/height on the wrapper so SVG scales proportionally.
 */
function sizeToPixels(size?: IconSize): number {
  const sizeMap: Record<IconSize, number> = {
    sm: 16,
    md: 24,
    lg: 32,
    xl: 48,
  };
  return sizeMap[size ?? 'md'];
}

/**
 * Map symbol name to SVG component.
 */
function getSymbolComponent(symbol: IconSymbol): Component<IconSymbolProps> {
  const symbolMap: Record<IconSymbol, Component<IconSymbolProps>> = {
    menu: MenuIcon,
    close: CloseIcon,
    arrow: ArrowIcon,
    external: ExternalIcon,
    check: CheckIcon,
    warning: WarningIcon,
    info: InfoIcon,
    reconnect: ReconnectIcon,
    local: LocalIcon,
    unknown: UnknownIcon,
  };
  return symbolMap[symbol];
}

/**
 * Icon component — renders a symbol with optional label and forced-colors support.
 *
 * Contract:
 * - Decorative (no label): aria-hidden=true, no aria-label, no role
 * - Meaningful (with label): aria-hidden=false, aria-label set, role=img
 *
 * Never destructure props — keep fine-grained SolidJS reactivity intact.
 * createMemo ensures aria-hidden reacts to label prop changes.
 */
export function Icon(props: IconProps): JSX.Element {
  const pixelSize = createMemo(() => sizeToPixels(props.size));
  const symbolComponent = createMemo(() => getSymbolComponent(props.symbol));

  // Derived state: aria-hidden should be false (hidden from AT) when label is absent
  const isHidden = createMemo(() => !props.label);

  return (
    <span
      class={`icon icon-${props.symbol} icon-size-${props.size ?? 'md'} ${props.class ?? ''}`}
      style={{
        display: 'inline-flex',
        'align-items': 'center',
        'justify-content': 'center',
        width: `${pixelSize()}px`,
        height: `${pixelSize()}px`,
        'flex-shrink': 0,
        color: 'currentColor',
      }}
    >
      <Dynamic
        component={symbolComponent()}
        class="icon-svg"
        aria-label={props.label}
        aria-hidden={isHidden()}
      />
    </span>
  );
}
