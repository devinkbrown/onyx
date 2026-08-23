// SPDX-License-Identifier: AGPL-3.0-or-later
import { Show, type JSX, type ParentProps } from 'solid-js';
import '@/ui/tokens/index.css';
import './public-frame.css';
import { SceneAtmosphere } from '@/backgrounds/SceneAtmosphere';
import { PublicFooter } from './PublicFooter';
import { PublicHeader } from './PublicHeader';
import { PublicSkipLink } from './PublicSkipLink';
import type { PublicNavItem } from './PublicNav';

/**
 * Shared semantic chrome for public client routes. It deliberately owns only
 * document framing; route content and route wiring remain with each route.
 * `context` is an optional current-line between header and main. Existing
 * calls omit it and keep the one-banner / one-main / one-footer contract.
 */
export function PublicFrame(props: ParentProps<{
  currentPath?: string;
  navItems?: readonly PublicNavItem[];
  mainLabel?: string;
  context?: JSX.Element;
}>): JSX.Element {
  return (
    <div class="public-frame">
      <div class="public-atmosphere" aria-hidden="true" data-testid="public-atmosphere">
        <SceneAtmosphere />
      </div>
      <PublicSkipLink />
      <PublicHeader currentPath={props.currentPath} navItems={props.navItems} />
      <Show when={props.context}>
        <div class="public-frame__context">{props.context}</div>
      </Show>
      <main id="public-main" class="public-frame__main" tabindex="-1" aria-label={props.mainLabel}>
        {props.children}
      </main>
      <PublicFooter />
    </div>
  );
}
