// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * symbols.tsx — foundational inline SVG icon definitions.
 *
 * One consistent 24×24 grid, stroke-based vocabulary:
 * - stroke-width: 2 (primary), 2.2 (strikethrough details)
 * - stroke-linecap: round, stroke-linejoin: round
 * - currentColor for full inherits from parent (button/text colour)
 * - Optional fill with opacity for secondary visual emphasis
 * - No emoji, no font glyphs, no decorative rendering
 *
 * Symbols:
 * - MenuIcon: horizontal lines (navigation toggle)
 * - CloseIcon: X (dismiss/cancel)
 * - ArrowIcon: directional single arrow (direction/link/navigation)
 * - ExternalIcon: square with arrow (external link)
 * - CheckIcon: checkmark (success/confirmation)
 * - WarningIcon: triangle with exclamation (alert/caution)
 * - InfoIcon: circle with i (information/help)
 * - ReconnectIcon: curved arrows (retry/refresh connection)
 * - LocalIcon: circle with dot (local-only/offline)
 * - UnknownIcon: question mark (uncertain/unknown state)
 */

import type { JSX } from 'solid-js';

export type IconSymbolProps = {
  class?: string;
  'aria-label'?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
};

/**
 * Internal SVG wrapper with consistent 24×24 viewport + stroke defaults.
 * All symbols use currentColor to inherit parent text colour.
 *
 * aria-hidden is passed through by the caller:
 * - decorative symbols: aria-hidden=true (default)
 * - meaningful labeled symbols: aria-hidden=false (or omitted, with aria-label)
 */
function Svg(props: {
  class?: string;
  'aria-label'?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
  children: JSX.Element;
}): JSX.Element {
  return (
    <svg
      class={props.class}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-label={props['aria-label']}
      aria-hidden={props['aria-hidden'] ?? true}
      role={props['aria-label'] ? 'img' : undefined}
    >
      {props.children}
    </svg>
  );
}

/** Horizontal lines — navigation menu toggle. */
export function MenuIcon(props: IconSymbolProps): JSX.Element {
  return (
    <Svg class={props.class} aria-label={props['aria-label']} aria-hidden={props['aria-hidden']}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

/** X shape — dismiss, close, cancel. */
export function CloseIcon(props: IconSymbolProps): JSX.Element {
  return (
    <Svg class={props.class} aria-label={props['aria-label']} aria-hidden={props['aria-hidden']}>
      <path d="M6 6l12 12M18 6l-12 12" stroke-width="2.2" />
    </Svg>
  );
}

/** Single rightward arrow — next, forward, link direction. */
export function ArrowIcon(props: IconSymbolProps): JSX.Element {
  return (
    <Svg class={props.class} aria-label={props['aria-label']} aria-hidden={props['aria-hidden']}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </Svg>
  );
}

/** Square with top-right arrow — external link, open in new tab. */
export function ExternalIcon(props: IconSymbolProps): JSX.Element {
  return (
    <Svg class={props.class} aria-label={props['aria-label']} aria-hidden={props['aria-hidden']}>
      <path d="M7 3h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2" />
      <path d="M12 8l5-5M17 3v5h-5" />
    </Svg>
  );
}

/** Checkmark — success, confirmation, completed. */
export function CheckIcon(props: IconSymbolProps): JSX.Element {
  return (
    <Svg class={props.class} aria-label={props['aria-label']} aria-hidden={props['aria-hidden']}>
      <path d="M4 12l5 5 10-10" stroke-width="2.2" />
    </Svg>
  );
}

/** Upward-pointing triangle with exclamation — warning, caution, alert. */
export function WarningIcon(props: IconSymbolProps): JSX.Element {
  return (
    <Svg class={props.class} aria-label={props['aria-label']} aria-hidden={props['aria-hidden']}>
      <path d="M12 3l9 16H3z" fill="currentColor" opacity="0.12" />
      <path d="M12 3l9 16H3z" />
      <path d="M12 10v4M12 17h.01" stroke-width="2.2" />
    </Svg>
  );
}

/** Circle with lowercase 'i' — information, help, status detail. */
export function InfoIcon(props: IconSymbolProps): JSX.Element {
  return (
    <Svg class={props.class} aria-label={props['aria-label']} aria-hidden={props['aria-hidden']}>
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.12" />
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v.01M12 12v4" stroke-width="2.2" />
    </Svg>
  );
}

/** Curved counterclockwise arrows — reconnect, retry, refresh connection. */
export function ReconnectIcon(props: IconSymbolProps): JSX.Element {
  return (
    <Svg class={props.class} aria-label={props['aria-label']} aria-hidden={props['aria-hidden']}>
      <path d="M3 7a6 6 0 1 0 6-6h.5" />
      <path d="M8.5 2l-2.5 2.5 2.5 2.5" />
    </Svg>
  );
}

/** Circle with central dot — local-only, offline, not replicated. */
export function LocalIcon(props: IconSymbolProps): JSX.Element {
  return (
    <Svg class={props.class} aria-label={props['aria-label']} aria-hidden={props['aria-hidden']}>
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.12" />
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </Svg>
  );
}

/** Question mark — unknown state, uncertain, help prompt. */
export function UnknownIcon(props: IconSymbolProps): JSX.Element {
  return (
    <Svg class={props.class} aria-label={props['aria-label']} aria-hidden={props['aria-hidden']}>
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.12" />
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0-1-1-1.5-1.5-2M12 15.5h.01" stroke-width="2.2" />
    </Svg>
  );
}
