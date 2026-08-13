// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * SystemSpecimen — the un-routed lab surface for the Onyx UI token system.
 *
 * This is a SPECIMEN, not a page. It is not registered in src/index.tsx, it is
 * reachable only by importing it, and it exists so the token layer can be seen,
 * reviewed, and regression-tested independently of the running app.
 *
 * Three properties are load-bearing:
 *
 *   DETERMINISTIC   No clock, no randomness, no timers, no network. The same
 *                   input renders the same output forever, so a visual diff
 *                   means a real change.
 *
 *   UNWIRED         No router, no store, no IRC client, no ThemeProvider. It
 *                   renders from module constants alone. If it needed app state
 *                   it would be a screenshot of the app, not a test of the
 *                   system, and it could not fail on its own.
 *
 *   HONEST          It shows no statistics and no activity. Every number the
 *                   app displays is earned from real data; inventing a
 *                   plausible "1,204 messages · 3 peers" here would teach the
 *                   reader that the numbers on a specimen mean something, and
 *                   would quietly normalise fake data in review. The truth
 *                   states below are therefore documented by their MEANING —
 *                   what the state asserts about data we may not be sure of —
 *                   never by a fabricated sample of it.
 */

import { For, type JSX } from 'solid-js';
import { Avatar } from '@/primitives/Avatar';
import { Button } from '@/primitives/Button';
import { IconButton } from '@/primitives/IconButton';
import { Spinner } from '@/primitives/Spinner';
import '@/primitives/primitives.css';
import { TRUTH_STATES, type TruthState } from '../tokens/token-contract';
import '../tokens/index.css';
import './system-specimen.css';

// ---------------------------------------------------------------------------
// Specimen data — static module constants, never derived, never generated
// ---------------------------------------------------------------------------

type TruthSpec = {
  readonly state: TruthState;
  /** A distinct SHAPE. Redundant with the label by design: colour alone fails
   *  WCAG 1.4.1, and under forced-colors these six share three system colours,
   *  so shape + text is the only distinction that always survives. */
  readonly glyph: string;
  readonly label: string;
  /** What the state asserts. Describes the guarantee, not a sample of data. */
  readonly meaning: string;
};

const TRUTH_SPECS: readonly TruthSpec[] = [
  {
    state: 'verified',
    glyph: '✓',
    label: 'Verified',
    meaning:
      'The server confirmed this content and its ordering. Safe to treat as authoritative.',
  },
  {
    state: 'partial',
    glyph: '◐',
    label: 'Partial',
    meaning:
      'Some of the requested range arrived; the rest is still outstanding. What is shown is real, but it is not all of it.',
  },
  {
    state: 'local',
    glyph: '⌂',
    label: 'Local only',
    meaning:
      'Read from this device. It has not been confirmed against the server and may not exist elsewhere.',
  },
  {
    state: 'reconnecting',
    glyph: '↻',
    label: 'Reconnecting',
    meaning:
      'The connection dropped and is being re-established. Content may be stale until it settles.',
  },
  {
    state: 'unavailable',
    glyph: '✕',
    label: 'Unavailable',
    meaning:
      'The source could not be reached or refused the request. Nothing is being shown in its place.',
  },
  {
    state: 'unknown',
    glyph: '?',
    label: 'Unknown',
    meaning:
      'No claim can be made either way. A legitimate resting state — it is never a placeholder for a value we failed to fetch.',
  },
];

type TypeSpec = {
  readonly role: string;
  readonly className: string;
  readonly note: string;
  readonly sample: string;
};

const TYPE_SPECS: readonly TypeSpec[] = [
  {
    role: 'Display',
    className: 'ui-display ui-display--sm',
    note: 'Fraunces. Page title and one hero line — never section headers, never chrome.',
    sample: 'Room Current',
  },
  {
    role: 'Lede',
    className: 'ui-lede',
    note: 'Instrument Sans. One paragraph, capped at the prose measure.',
    sample: 'A single introductory sentence, set at the reading measure.',
  },
  {
    role: 'Heading',
    className: 'ui-heading',
    note: 'Instrument Sans. Section titles.',
    sample: 'Section title',
  },
  {
    role: 'Body',
    className: 'ui-body',
    note: 'Instrument Sans. Everything the reader reads to operate the product.',
    sample: 'Body copy sets the baseline rhythm for the rest of the interface.',
  },
  {
    role: 'Label',
    className: 'ui-label',
    note: 'Instrument Sans. Control labels and dense UI text.',
    sample: 'Control label',
  },
  {
    role: 'Kicker',
    className: 'ui-kicker',
    note: 'JetBrains Mono, tracked and uppercased. Section eyebrows.',
    sample: 'Section eyebrow',
  },
  {
    role: 'Evidence',
    className: 'ui-evidence',
    note: 'JetBrains Mono. Verbatim text only — IDs, fingerprints, protocol lines.',
    sample: 'SHA-256:0000-0000-0000-0000',
  },
];

/** The z-index ladder, documented in the order it stacks. */
const LAYER_SPECS: readonly { readonly token: string; readonly role: string }[] = [
  { token: '--ui-z-base', role: 'In-flow content' },
  { token: '--ui-z-raised', role: 'Cards lifted off the plane' },
  { token: '--ui-z-sticky', role: 'Pinned headers and rails' },
  { token: '--ui-z-nav', role: 'Persistent navigation' },
  { token: '--ui-z-overlay', role: 'Scrims behind a dismissible surface' },
  { token: '--ui-z-sheet', role: 'Drawers and side sheets' },
  { token: '--ui-z-modal', role: 'Focus-trapping dialogs' },
  { token: '--ui-z-toast', role: 'Transient confirmations' },
  { token: '--ui-z-tooltip', role: 'Pointer-anchored descriptions' },
  { token: '--ui-z-top', role: 'Escape hatch — nothing may sit above this' },
];

const SURFACE_SPECS: readonly { readonly token: string; readonly role: string }[] = [
  { token: '--ui-surface-canvas', role: 'The ground beneath everything' },
  { token: '--ui-surface-base', role: 'The working plane' },
  { token: '--ui-surface-raised', role: 'A card lifted one step' },
  { token: '--ui-surface-edge', role: 'The lit edge of a plane' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type SystemSpecimenProps = {
  /**
   * Pin the specimen to a colour contract regardless of the surrounding
   * document. Omit to inherit the active Onyx theme (or the OS preference when
   * no theme is applied).
   */
  scheme?: 'dark' | 'light';
  class?: string;
};

/** A no-op handler: the specimen demonstrates affordances, it performs nothing. */
const inert = (event: MouseEvent): void => {
  event.preventDefault();
};

export function SystemSpecimen(props: SystemSpecimenProps): JSX.Element {
  return (
    <main
      class={['ui-root', 'ui-specimen', props.class].filter(Boolean).join(' ')}
      data-ui-scheme={props.scheme}
      aria-labelledby="ui-specimen-title"
    >
      <header class="ui-specimen__masthead">
        <p class="ui-kicker">Onyx UI · system specimen</p>
        <h1 id="ui-specimen-title" class="ui-display">
          Room Current
        </h1>
        <p class="ui-lede">
          A static reference for the token layer: layout, the three typographic voices,
          action affordances, and the six truth states. Nothing here is connected to the
          application — no counts, no activity, no live data.
        </p>
      </header>

      {/* ── Layout ─────────────────────────────────────────────────────────── */}
      <section class="ui-specimen__section" aria-labelledby="ui-specimen-layout">
        <h2 id="ui-specimen-layout" class="ui-heading">
          Layout
        </h2>
        <p class="ui-body">
          Regions are composed from the spacing scale and the named layer ladder. Reading
          columns are capped at the prose measure so a line never outruns the eye.
        </p>

        <div class="ui-specimen__frame">
          <div class="ui-specimen__region ui-specimen__region--rail">
            <span class="ui-kicker">Rail</span>
          </div>
          <div class="ui-specimen__region ui-specimen__region--panel">
            <span class="ui-kicker">Panel</span>
          </div>
          <div class="ui-specimen__region ui-specimen__region--canvas">
            <span class="ui-kicker">Canvas</span>
            <p class="ui-body">
              The primary reading column. Its width is bounded by the prose measure rather
              than by the viewport.
            </p>
          </div>
          <div class="ui-specimen__region ui-specimen__region--aside">
            <span class="ui-kicker">Aside</span>
          </div>
        </div>

        <h3 class="ui-subheading">Surfaces</h3>
        <ul class="ui-specimen__swatches">
          <For each={SURFACE_SPECS}>
            {(surface) => (
              <li class="ui-specimen__swatch">
                <span
                  class="ui-specimen__swatch-chip"
                  style={{ background: `var(${surface.token})` }}
                  aria-hidden="true"
                />
                <span class="ui-evidence">{surface.token}</span>
                <span class="ui-body ui-specimen__swatch-role">{surface.role}</span>
              </li>
            )}
          </For>
        </ul>

        <h3 class="ui-subheading">Layers</h3>
        <dl class="ui-specimen__defs">
          <For each={LAYER_SPECS}>
            {(layer) => (
              <div class="ui-specimen__def">
                <dt class="ui-evidence">{layer.token}</dt>
                <dd class="ui-body">{layer.role}</dd>
              </div>
            )}
          </For>
        </dl>
      </section>

      {/* ── Typography ─────────────────────────────────────────────────────── */}
      <section class="ui-specimen__section" aria-labelledby="ui-specimen-type">
        <h2 id="ui-specimen-type" class="ui-heading">
          Typography
        </h2>
        <p class="ui-body">
          Three voices with one job each: Fraunces for restrained display, Instrument Sans
          for body and interface, JetBrains Mono for evidence only.
        </p>

        <dl class="ui-specimen__defs">
          <For each={TYPE_SPECS}>
            {(spec) => (
              <div class="ui-specimen__def ui-specimen__def--type">
                <dt class="ui-label">{spec.role}</dt>
                <dd>
                  <p class={spec.className}>{spec.sample}</p>
                  <p class="ui-body ui-specimen__type-note">{spec.note}</p>
                </dd>
              </div>
            )}
          </For>
        </dl>
      </section>

      {/* ── Actions ────────────────────────────────────────────────────────── */}
      <section class="ui-specimen__section" aria-labelledby="ui-specimen-actions">
        <h2 id="ui-specimen-actions" class="ui-heading">
          Actions
        </h2>
        <p class="ui-body">
          Rendered with the shipping Onyx primitives so the specimen exercises the real
          components, not a copy of them. Every control here is inert.
        </p>

        <div class="ui-specimen__actions">
          <Button variant="primary" class="ui-target" onClick={inert}>
            Primary action
          </Button>
          <Button variant="ghost" class="ui-target" onClick={inert}>
            Secondary action
          </Button>
          <Button variant="danger" class="ui-target" onClick={inert}>
            Critical action
          </Button>
          <Button variant="primary" class="ui-target" disabled>
            Unavailable action
          </Button>
          <IconButton label="Inert icon action" class="ui-target" onClick={inert}>
            <span aria-hidden="true">◇</span>
          </IconButton>
          <Avatar name="Specimen" />
          <Spinner label="Specimen busy indicator" />
        </div>
      </section>

      {/* ── Truth states ───────────────────────────────────────────────────── */}
      <section class="ui-specimen__section" aria-labelledby="ui-specimen-truth">
        <h2 id="ui-specimen-truth" class="ui-heading">
          Truth states
        </h2>
        <p class="ui-body">
          Onyx routinely renders content it cannot fully vouch for. These six states are
          the only sanctioned answers to “how sure are we?”, and each is carried by a
          label and a distinct shape as well as by colour — so the distinction survives
          colour-blindness, forced-colors, and a greyscale print.
        </p>

        <ul class="ui-specimen__truths">
          <For each={TRUTH_SPECS}>
            {(spec) => (
              <li class="ui-specimen__truth" data-ui-truth={spec.state}>
                <span class="ui-truth-chip">
                  <span class="ui-truth-chip__glyph" aria-hidden="true">
                    {spec.glyph}
                  </span>
                  <span class="ui-truth-chip__label">{spec.label}</span>
                </span>
                <p class="ui-body ui-specimen__truth-meaning">{spec.meaning}</p>
                <p class="ui-evidence ui-specimen__truth-token">{`--ui-proof-${spec.state}`}</p>
              </li>
            )}
          </For>
        </ul>

        <p class="ui-body ui-specimen__footnote">
          No counts, timestamps, or activity appear on this surface. A specimen that
          invents plausible data teaches the reader to trust invented data.
        </p>
      </section>
    </main>
  );
}

/** Re-exported so a consumer can iterate the states without reaching into the contract. */
export { TRUTH_STATES };
export type { TruthState };
