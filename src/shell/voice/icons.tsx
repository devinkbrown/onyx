/**
 * icons.tsx — shared inline SVG icons for the voice/video controls.
 *
 * One consistent 24×24, currentColor, stroke-based set so the call bar, PIP and
 * stage read as one system instead of a mix of glyphs and ASCII placeholders.
 * Every icon is decorative (aria-hidden); the surrounding button carries the
 * aria-label.
 */

import type { JSX } from 'solid-js';

type IconProps = { class?: string };

function Svg(props: { class?: string; children: JSX.Element }): JSX.Element {
  return (
    <svg
      class={props.class ?? 'voice-call-icon'}
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

export function MicIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" opacity="0.18" />
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" />
    </Svg>
  );
}

export function MicOffIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <path d="M9 9V6a3 3 0 0 1 6 0v5" />
      <path d="M15 12.5a3 3 0 0 1-4.6 1.9" />
      <path d="M5 11a7 7 0 0 0 10.3 6.2M19 11a7 7 0 0 1-.3 2" />
      <path d="M12 18v3M8.5 21h7" />
      <path d="M4 4l16 16" stroke-width="2.2" />
    </Svg>
  );
}

export function DeafenIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <rect x="3" y="13" width="4" height="7" rx="1.4" fill="currentColor" opacity="0.18" />
      <rect x="3" y="13" width="4" height="7" rx="1.4" />
      <rect x="17" y="13" width="4" height="7" rx="1.4" fill="currentColor" opacity="0.18" />
      <rect x="17" y="13" width="4" height="7" rx="1.4" />
    </Svg>
  );
}

export function DeafenOffIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <path d="M4 13v-1a8 8 0 0 1 13.6-5.7M20 12v1" />
      <rect x="3" y="13" width="4" height="7" rx="1.4" />
      <rect x="17" y="13" width="4" height="7" rx="1.4" />
      <path d="M4 4l16 16" stroke-width="2.2" />
    </Svg>
  );
}

export function CameraIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <rect x="3" y="6" width="13" height="12" rx="2.5" fill="currentColor" opacity="0.16" />
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="M16 10l5-3v10l-5-3z" />
    </Svg>
  );
}

export function CameraOffIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <path d="M16 10l5-3v10l-4-2.4" />
      <path d="M14 6H6.5A2.5 2.5 0 0 0 4 8.5V16a2.5 2.5 0 0 0 2.5 2.5H14a2 2 0 0 0 2-2v-3" />
      <path d="M4 4l16 16" stroke-width="2.2" />
    </Svg>
  );
}

export function ScreenShareIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <rect x="3" y="4" width="18" height="12" rx="2" fill="currentColor" opacity="0.16" />
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M12 7.5v5M9.6 9.6 12 7.2l2.4 2.4M8 20h8" />
    </Svg>
  );
}

export function ScreenShareStopIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8" />
      <path d="M5 4l14 12" stroke-width="2.2" />
    </Svg>
  );
}

export function CaptionsIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" fill="currentColor" opacity="0.16" />
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M10 10.5a2 2 0 0 0-3 1.7v.6a2 2 0 0 0 3 1.7M17 10.5a2 2 0 0 0-3 1.7v.6a2 2 0 0 0 3 1.7" />
    </Svg>
  );
}

export function HandIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10" />
      <path d="M11 10V4.5a1.5 1.5 0 0 1 3 0V10" />
      <path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.3-1.8L4 14.6a1.6 1.6 0 0 1 2.3-2.2L8 14" />
    </Svg>
  );
}

export function ReactionIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.14" />
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4 4 0 0 0 7 0" />
      <path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.4" />
    </Svg>
  );
}

export function GridIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <rect x="3" y="3" width="8" height="8" rx="1.6" />
      <rect x="13" y="3" width="8" height="8" rx="1.6" />
      <rect x="3" y="13" width="8" height="8" rx="1.6" />
      <rect x="13" y="13" width="8" height="8" rx="1.6" />
    </Svg>
  );
}

export function SpotlightIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <rect x="3" y="3" width="18" height="14" rx="2" fill="currentColor" opacity="0.16" />
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <rect x="6" y="19" width="3" height="2" rx="1" />
      <rect x="10.5" y="19" width="3" height="2" rx="1" />
      <rect x="15" y="19" width="3" height="2" rx="1" />
    </Svg>
  );
}

export function SettingsIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5l1.4 2.2 2.6-.5.4 2.6 2.4 1-.9 2.5.9 2.5-2.4 1-.4 2.6-2.6-.5L12 21.5l-1.4-2.2-2.6.5-.4-2.6-2.4-1 .9-2.5-.9-2.5 2.4-1 .4-2.6 2.6.5z" />
    </Svg>
  );
}

export function HangupIcon(props: IconProps): JSX.Element {
  return (
    <Svg class={props.class}>
      <path d="M4.5 14.5c4-3.4 11-3.4 15 0l1.2-1.6c.5-.7.3-1.7-.5-2.1A16 16 0 0 0 3.8 10.8c-.8.4-1 1.4-.5 2.1z" fill="currentColor" opacity="0.2" />
      <path d="M4.5 14.5c4-3.4 11-3.4 15 0l1.2-1.6c.5-.7.3-1.7-.5-2.1A16 16 0 0 0 3.8 10.8c-.8.4-1 1.4-.5 2.1z" />
      <path d="M8.6 13.2l-.5 2.6M15.4 13.2l.5 2.6" />
    </Svg>
  );
}
