// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Static route metadata for the Onyx site. The Elm client is a single-page
 * application, so every public path needs a real HTML document whose <head>
 * carries that route's title, description, canonical URL and share metadata
 * (hard loads and crawlers never run the client). tools/build-site.mjs turns
 * this table into those documents.
 *
 * KEEP IN SYNC with `parser` in elm/src/Route.elm: every non-root `s "<path>"`
 * there has an entry below, and tools/site/site.test.mjs fails when they drift.
 * deploy.sh may stage allowlisted legacy support paths from /home/kain/landing,
 * but never replaces the documents generated from this table (root index,
 * robots/sitemap/favicons, route entrypoints, assets, service worker, icons).
 */

export const ORIGIN = 'https://eshmaki.me';

/** The root document (`/`). */
export const HOME_ENTRYPOINT = {
  title: 'Onyx — good company. Great nights.',
  description:
    'Good company. Great nights. Rooms, calls, and private DMs for friends and clubs. History stays on this device — about 400 messages per room. No ads.',
};

export const NOT_FOUND_ENTRYPOINT = {
  title: 'Onyx — page not found',
  description: 'This Onyx address does not exist or is no longer available.',
};

/** Share image alt text and image path, shared by every document. */
export const SHARE_IMAGE = {
  path: '/og.png',
  width: 1200,
  height: 630,
  alt: 'Onyx — a social room for game nights, messages, and calls.',
};

export const ROUTE_ENTRYPOINTS = [
  {
    route: 'app',
    title: 'Open Onyx — chat on the open network',
    description: 'Open Onyx in your browser for local-first rooms, honest media security, live network context, and an identity you control.',
  },
  {
    route: 'about',
    title: 'About Onyx — rooms for your people',
    description: 'Onyx is a community for rooms, messages, and calls. Private DMs when you want them. No ads. Open in your browser, or invite people you already know.',
  },
  {
    route: 'appearance',
    title: 'Onyx appearance — look, text size, and motion',
    description: 'Choose an Onyx look, text size, and motion. Theme Studio and extra backgrounds stay under Advanced.',
  },
  {
    route: 'stats',
    title: 'Onyx stats — live room activity',
    description: 'See public Onyx room activity, network message trends, people online, and room sparklines.',
  },
  {
    route: 'status',
    title: 'Onyx status — are the rooms up?',
    description: 'See whether Onyx rooms are reachable tonight. If the public report is missing or stale, we cannot claim health.',
  },
  {
    route: 'roadmap',
    title: 'Onyx roadmap — rooms, calls, catch-up',
    description: 'What we are working on: rooms that stay open, calls when you want them, catch-up when you come back, and a Home Screen on this device.',
  },
  {
    route: 'onyxos',
    title: 'OnyxOS + Onyx — communication at home in the system',
    description: 'See how Onyx is becoming a first-class native OnyxOS experience while staying cross-platform, backed by evidence-led system engineering.',
  },
  {
    route: 'invite',
    title: 'Join Onyx — open a room invite',
    description: 'See the room, choose a display name, and join in the browser. No account required for the first hello.',
  },
  {
    route: 'download',
    title: 'Get Onyx on this device — browser first',
    description:
      'Get Onyx on this device in your browser. Keep it here from a supporting browser. Desktop packages are optional and unsigned. macOS native packages are coming soon.',
  },
  {
    route: 'install',
    title: 'Get Onyx on this device — browser first',
    description:
      'Get Onyx on this device in your browser. Keep it here from a supporting browser. Desktop packages are optional and unsigned. macOS native packages are coming soon.',
    canonicalRoute: 'download',
  },
  {
    route: 'privacy',
    title: 'Onyx privacy — what stays here',
    description: 'Short facts about what the server stores, history on this device, and that this site does not sell ads.',
  },
  {
    route: 'guidelines',
    title: 'Onyx house rules',
    description: 'How we treat each other in the rooms, how to report harm, and that Onyx is not 911.',
  },
  {
    route: 'contact',
    title: 'Onyx contact',
    description: 'How to reach the project for ordinary questions and security reports. No invented mailbox.',
  },
  {
    route: 'accessibility',
    title: 'Onyx accessibility — access is a requirement',
    description: 'Read the public Onyx accessibility contract for keyboard use, focus recovery, motion, contrast, and status announcements.',
  },
  {
    route: 'glossary',
    title: 'Onyx glossary — names used across the network',
    description: 'A concise guide to Onyx, Onyx Server, Cadence, Mooring, Armor, and the open network.',
  },
  {
    route: 'integrations',
    title: 'Onyx integrations — constrained by design',
    description: 'Learn how Onyx renders reviewed integration content and keeps extension actions capability-scoped.',
  },
  {
    route: 'agents',
    title: 'Onyx agent safety — automation with boundaries',
    description: 'Read the public contract for labelled, reviewed, capability-scoped automation in Onyx.',
  },
  {
    route: 'guides',
    title: 'Onyx guides — join a room in the official app',
    description: 'Short how-tos for joining a room, inviting a friend, private messages, calls, and keeping Onyx on this device.',
  },
  {
    route: 'community',
    title: 'Onyx community — how to join and be here',
    description: 'How to join a room in Onyx, invite a friend, and treat each other well. The official app is the usual way in.',
  },
];
