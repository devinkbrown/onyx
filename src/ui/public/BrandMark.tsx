// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSX } from 'solid-js';

/** Locked public mark: stone squircle (room) + circle (person) + one lapis gleam. */
export function BrandMark(props: { class?: string; size?: number }): JSX.Element {
  const size = () => props.size ?? 32;
  return (
    <img
      class={props.class ?? 'public-frame__mark'}
      src="/brand/mark.png"
      width={size()}
      height={size()}
      alt=""
      decoding="async"
    />
  );
}
