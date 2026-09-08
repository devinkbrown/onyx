// SPDX-License-Identifier: AGPL-3.0-or-later
import { For, type JSX } from 'solid-js';
import { publicRouteById } from '@/ui/navigation/publicRouteManifest';

const FOOTER_LINKS = [
  { href: '/guidelines/', label: 'House rules' },
  { href: '/privacy/', label: 'Privacy' },
  { href: '/contact/', label: 'Contact' },
  { href: '/status/', label: 'Status' },
  { href: '/guides/', label: 'Guides' },
] as const;

export function PublicFooter(): JSX.Element {
  return (
    <footer class="public-frame__footer">
      <div class="public-frame__footer-inner">
        <div class="public-frame__footer-identity">
          <a class="public-frame__footer-brand" href={publicRouteById('home').href}>
            <img class="public-frame__mark" src="/brand/mark.png" width="28" height="28" alt="" />
            <span>Onyx</span>
          </a>
          <p>Rooms, messages, and calls for friends, clubs, and creators.</p>
        </div>
        <nav aria-label="Footer navigation">
          <p class="public-frame__footer-title">Explore Onyx</p>
          <div class="public-frame__footer-links">
            <For each={FOOTER_LINKS}>
              {(link) => <a href={link.href}>{link.label}</a>}
            </For>
          </div>
        </nav>
      </div>
    </footer>
  );
}
