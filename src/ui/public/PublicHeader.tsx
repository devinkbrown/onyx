// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSX } from 'solid-js';
import { normalisePublicRoutePath } from '@/ui/navigation/publicRouteManifest';
import { BrandMark } from './BrandMark';
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
          <span class="public-frame__brand-visual" aria-hidden="true">
            <img
              class="public-frame__lockup"
              src="/brand/lockup.png"
              width="200"
              height="78"
              alt=""
              decoding="async"
            />
            <BrandMark size={40} />
            <img
              class="public-frame__wordmark"
              src="/brand/wordmark.png"
              width="86"
              height="37"
              alt=""
              decoding="async"
            />
          </span>
        </a>
        <PublicNav currentPath={props.currentPath} items={props.navItems} />
      </div>
    </header>
  );
}
