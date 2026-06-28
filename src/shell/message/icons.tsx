/**
 * icons.tsx — inline SVG icons for the per-message action bar / overflow menu.
 *
 * Mirrors the voice control icon system (24×24, currentColor, stroke-based) so
 * the message hover bar reads as the same family as the call controls. Every
 * icon is decorative (aria-hidden); the surrounding button carries the label.
 */

import type { JSX } from 'solid-js';

type IconProps = { class?: string };

function Svg(props: { class?: string; children: JSX.Element }): JSX.Element {
  return (
    <svg
      class={props.class ?? 'msg-menu-icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

/** Smiling face — "add reaction". */
export function ReactIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.12" />
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14a4 4 0 0 0 7 0" />
      <path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.4" />
    </Svg>
  );
}

/** Curved arrow — "reply". */
export function ReplyIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <path d="M9 7 4 12l5 5" />
      <path d="M4 12h9a6 6 0 0 1 6 6v1" />
    </Svg>
  );
}

/** Horizontal ellipsis — "more". */
export function OverflowIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Overlapping pages — "copy text". */
export function CopyIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <rect x="9" y="9" width="11" height="11" rx="2" fill="currentColor" opacity="0.12" />
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </Svg>
  );
}

/** Pencil — "edit". */
export function EditIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Svg>
  );
}

/** Trash can — "delete". */
export function TrashIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </Svg>
  );
}
