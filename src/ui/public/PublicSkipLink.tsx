// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSX } from 'solid-js';

function focusTarget(targetId: string): void {
  const target = document.getElementById(targetId);
  if (!(target instanceof HTMLElement)) return;

  const suppliedTabindex = target.hasAttribute('tabindex');
  if (!suppliedTabindex) target.setAttribute('tabindex', '-1');

  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }

  if (!suppliedTabindex) {
    target.addEventListener('blur', () => {
      if (target.getAttribute('tabindex') === '-1') target.removeAttribute('tabindex');
    }, { once: true });
  }
}

/**
 * First tab stop for public pages. PublicFrame supplies the matching main id.
 * Kept separate so a route can place the same tested skip affordance in an
 * otherwise custom public document without copying focus styling.
 */
export function PublicSkipLink(props: { targetId?: string; children?: JSX.Element }): JSX.Element {
  const targetId = () => props.targetId ?? 'public-main';
  return (
    <a
      class="public-frame__skip"
      href={`#${targetId()}`}
      onClick={() => focusTarget(targetId())}
    >
      {props.children ?? 'Skip to content'}
    </a>
  );
}
