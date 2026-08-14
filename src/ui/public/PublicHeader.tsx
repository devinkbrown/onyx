// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSX } from 'solid-js';
import { normalisePublicRoutePath } from '@/ui/navigation/publicRouteManifest';
import { PublicNav, type PublicNavItem } from './PublicNav';

export function PublicHeader(props: { currentPath?: string; navItems?: readonly PublicNavItem[] }): JSX.Element {
  const brandIsCurrent = () => normalisePublicRoutePath(props.currentPath) === '/';
  return (
    <header class="public-frame__header">
      <div class="public-frame__header-inner">
        <a
          class="public-frame__brand"
          href="/"
          aria-label="Onyx home"
          aria-current={brandIsCurrent() ? 'page' : undefined}
        >
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M5 22c5-8 8 5 14-5 2-3 4-4 8-6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
            <circle cx="27" cy="10" r="2.5" fill="currentColor" />
          </svg>
          <span>Onyx</span>
        </a>
        <PublicNav currentPath={props.currentPath} items={props.navItems} />
      </div>
    </header>
  );
}
