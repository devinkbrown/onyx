// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * AccessibilityStatement - static accessibility conformance posture.
 */
import './AccessibilityStatement.css';
import { For, type JSX } from 'solid-js';

type AccessibilityTopic = {
  readonly id: string;
  readonly heading: string;
  readonly summary: string;
  readonly points: readonly string[];
};

const ACCESSIBILITY_TOPICS: readonly AccessibilityTopic[] = [
  {
    id: 'keyboard',
    heading: 'Keyboard',
    summary:
      'Onyx supports full keyboard traversal for the main chat, navigation, settings, and command surfaces.',
    points: [
      'The command palette opens with Cmd-K or Ctrl-K.',
      'Focusable controls keep visible focus indicators.',
      'Keyboard order follows the visual reading order of the current surface.',
    ],
  },
  {
    id: 'motion',
    heading: 'Motion',
    summary: 'Onyx honors reduced-motion preferences and gives scene motion an explicit control.',
    points: [
      'System reduced-motion settings are respected.',
      'Scene presentation supports Animated, Still, and Off modes; Still renders a static frame, while Off skips the background renderer.',
      'Decorative motion is treated as optional and never required for understanding content.',
    ],
  },
  {
    id: 'contrast-color',
    heading: 'Contrast and color',
    summary:
      'Onyx uses an OKLCH theme system with mechanically-derived high-contrast variants.',
    points: [
      'The interface honors prefers-contrast: more.',
      'Transparency-sensitive surfaces honor prefers-reduced-transparency where supported.',
      'Windows forced-colors mode receives system-color fallbacks instead of theme-only colors.',
    ],
  },
  {
    id: 'screen-readers',
    heading: 'Screen readers',
    summary: 'Onyx exposes chat activity and controls with semantic labels where the UI is interactive.',
    points: [
      'The message log is an aria-live region for new chat activity.',
      'Reconnect feedback uses polite phase-only announcements while keeping the changing countdown visual, then briefly confirms Back online.',
      'Icon-only and compact controls are labeled for assistive technology.',
      'Headings, landmarks, lists, and button elements are used before custom roles.',
    ],
  },
  {
    id: 'client-surfaces',
    heading: 'Current client audit',
    summary:
      'Dense app panels are tracked inside Preferences and mirrored here as pass evidence lands.',
    points: [
      'Room settings uses a labelled Sheet, labelled forms, switch-mode flags, and read-only non-op fallbacks.',
      'Voice controls use a toolbar, grouped labelled controls, aria-pressed media state, and a live call timer.',
      'The mini voice view renders at most five avatars while its participant, hidden, and speaking counts reflect the full case-insensitive room roster.',
      'Appearance uses radio groups for themes and backgrounds with labelled swatches and modal focus handling.',
      'Home catch-up exposes recaps, reviewed ranges, and the room directory as labelled card lists with direct action buttons.',
      'Message search uses a search landmark, labelled match navigation, and named archived/device-memory result lists.',
      'Notification center uses a named inbox dialog, labelled notification list, and row-specific open/dismiss actions.',
      'Room browser uses a Sheet dialog, named directory search, labelled public-room list, and target-specific Join/Open actions.',
      'Account panel groups account management into named regions with alert/status feedback and target-specific persona actions.',
      'Room sidebar uses a complementary navigation landmark, roving room and DM rows, unread/mention names, and a target-specific join action.',
      'Keyboard shortcuts uses a named Sheet dialog, labelled close action, grouped shortcut lists generated from the live keymap, and J/K transcript navigation.',
      'Command palette uses a named dialog, described grammar examples, live selected-command status, and literal goto/search/time/reader/mute actions.',
      'Pinned messages uses a named Sheet dialog, room-specific pins list, target-specific jump buttons, and real unpin controls.',
      'Theme import uses a named Sheet dialog, described theme-code input, target-specific import and copy actions, and invalid-code feedback.',
      'Thread panel uses a named Sheet dialog, labelled parent and reply articles, and a reply log scoped to the source message.',
      'Voice settings uses a named Sheet dialog, labelled device/processing/push-to-talk regions, described selects, and target-specific push-to-talk key actions.',
      'Call overlays use named incoming/outgoing dialogs with target-specific accept, decline, and cancel actions.',
      'Message actions use per-row action groups, named reaction and overflow triggers, labelled menus, and row-specific action names.',
      'Member list uses a channel-scoped complementary landmark, labelled role groups, named member-detail dialogs, target-specific member actions, decorative avatars, and focus retention across MODE/PART.',
      'Notification controls use a labelled compact control group, described calm-mode radios, and pressed-state desktop, sound, push, and do-not-disturb toggles.',
      'Time scrubber uses a channel-scoped region, labelled UTC-hour jump buttons, a date jump input, and a target-specific moment-copy action.',
      'Jump to date uses a named Sheet dialog, UTC date/time fields, quick-date presets, target-specific jump and moment-copy actions, and ribbon/composer openers.',
      'Watch together uses named review and host-control groups, a bounded participant list, polite atomic outcome status, and focus restoration after successful or stale confirmations.',
      'Reader memory uses a named device-memory region, reviewed-span and context-trail groups, labelled transcript jumps, and cross-room peer-review handoffs with focus-visible dense rows.',
      'Preferences dense rows use segmented radio groups and switch controls with concise names, descriptions, keyboard roving, focus-visible outlines, forced-colors selected states, and dense-zoom reflow of category tabs.',
      'Message transcript uses a named live log, focusable articles, and state-aware accessible names that surface queued, edited, deleted, locked, and mention states without exposing E2EE ciphertext, with decorative avatars and thread-panel body parity.',
    ],
  },
];

export function AccessibilityStatement(props: { class?: string }): JSX.Element {
  const rootClass = (): string =>
    props.class ? `a11y-statement ${props.class}` : 'a11y-statement';

  return (
    <div class={rootClass()}>
      <article class="a11y-document">
        <header class="a11y-header">
          <p class="a11y-kicker">Accessibility conformance</p>
          <h2 id="a11y-statement-title">Accessibility statement</h2>
          <p class="a11y-lede">
            Onyx aims to make time-native chat usable without requiring a mouse,
            animation, perfect color perception, or a specific display mode.
          </p>
        </header>

        <section class="a11y-section" aria-labelledby="a11y-posture-title">
          <h3 id="a11y-posture-title">Conformance posture</h3>
          <section class="a11y-standard" aria-labelledby="a11y-standard-title">
            <h4 id="a11y-standard-title">Standard</h4>
            <p>
              Onyx targets <strong>WCAG 2.2 Level AA</strong> and uses{' '}
              <strong>EN 301 549</strong> as the accessibility reference for EU
              Accessibility Act readiness.
            </p>
            <ul class="a11y-list">
              <li>Onyx treats conformance as an active product requirement.</li>
              <li>
                This statement describes the Onyx client interface and its built-in
                interaction patterns.
              </li>
            </ul>
          </section>
        </section>

        <section class="a11y-section" aria-labelledby="a11y-support-title">
          <h3 id="a11y-support-title">Supported accessibility features</h3>
          <div class="a11y-topic-list">
            <For each={ACCESSIBILITY_TOPICS}>
              {(topic) => (
                <section class="a11y-topic" aria-labelledby={`a11y-${topic.id}-title`}>
                  <h4 id={`a11y-${topic.id}-title`}>{topic.heading}</h4>
                  <p>{topic.summary}</p>
                  <ul class="a11y-list">
                    <For each={topic.points}>{(point) => <li>{point}</li>}</For>
                  </ul>
                </section>
              )}
            </For>
          </div>
        </section>

        <section class="a11y-section" aria-labelledby="a11y-feedback-title">
          <h3 id="a11y-feedback-title">Feedback</h3>
          <section class="a11y-feedback" aria-labelledby="a11y-reporting-title">
            <h4 id="a11y-reporting-title">Reporting accessibility bugs</h4>
            <p>
              Onyx welcomes accessibility bug reports through your community&apos;s
              admin or an <code>#accessibility</code> channel so issues can be
              reproduced and prioritized.
            </p>
          </section>
        </section>
      </article>
    </div>
  );
}
