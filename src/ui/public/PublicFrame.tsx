// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSX, ParentProps } from 'solid-js';
import '@/ui/tokens/index.css';
import './public-frame.css';
import { PublicFooter } from './PublicFooter';
import { PublicHeader } from './PublicHeader';
import { PublicSkipLink } from './PublicSkipLink';
import type { PublicNavItem } from './PublicNav';

/**
 * Shared semantic chrome for public client routes. It deliberately owns only
 * document framing; route content and route wiring remain with each route.
 */
export function PublicFrame(props: ParentProps<{
  currentPath?: string;
  navItems?: readonly PublicNavItem[];
  mainLabel?: string;
}>): JSX.Element {
  return (
    <div class="public-frame">
      <PublicSkipLink />
      <PublicHeader currentPath={props.currentPath} navItems={props.navItems} />
      <main id="public-main" class="public-frame__main" tabindex="-1" aria-label={props.mainLabel}>
        {props.children}
      </main>
      <PublicFooter />
    </div>
  );
}
