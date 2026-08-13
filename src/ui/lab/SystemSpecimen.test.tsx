// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * SystemSpecimen.test.tsx — behavioural + boundary tests for the lab surface.
 *
 * Two kinds of assertion, both load-bearing:
 *
 *   RENDERED   What a user and a screen reader actually get: landmarks, a
 *              heading hierarchy, named controls, and six truth states each
 *              carrying its meaning in TEXT and SHAPE, not only in colour.
 *
 *   SOURCE     What the module is allowed to be: no router, no store, no
 *              network, no clock, no randomness, no invented statistics. These
 *              are read off the file itself because they are properties of the
 *              module, not of one render — a store import that only fires on a
 *              branch would still pass a render test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FORBIDDEN_LAB_IMPORTS,
  FORBIDDEN_LAB_SOURCES,
  TRUTH_STATES,
  findSourceViolations,
} from '../tokens/token-contract';
import { SystemSpecimen } from './SystemSpecimen';

afterEach(cleanup);

const repoRoot = join(import.meta.dirname, '../../..');
const specimenSource = readFileSync(join(repoRoot, 'src/ui/lab/SystemSpecimen.tsx'), 'utf8');

/** Human-facing labels, in render order. Mirrors the component's TRUTH_SPECS. */
const TRUTH_LABELS: Readonly<Record<(typeof TRUTH_STATES)[number], string>> = {
  verified: 'Verified',
  partial: 'Partial',
  local: 'Local only',
  reconnecting: 'Reconnecting',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
};

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe('SystemSpecimen structure', () => {
  it('renders a labelled main landmark', () => {
    render(() => <SystemSpecimen />);
    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
    expect(main).toHaveAccessibleName('Room Current');
  });

  it('exposes exactly one level-1 heading', () => {
    render(() => <SystemSpecimen />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('gives every section a heading-derived accessible name', () => {
    render(() => <SystemSpecimen />);
    for (const name of ['Layout', 'Typography', 'Actions', 'Truth states']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
  });

  it('does not skip a heading level', () => {
    render(() => <SystemSpecimen />);
    const levels = screen
      .getAllByRole('heading')
      .map((heading) => Number(heading.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    for (let index = 1; index < levels.length; index += 1) {
      // A level may repeat or step back, but may never jump by more than one.
      expect(levels[index]! - levels[index - 1]!).toBeLessThanOrEqual(1);
    }
  });

  it('opts the surface into the token layer without pinning a scheme', () => {
    render(() => <SystemSpecimen />);
    const main = screen.getByRole('main');
    expect(main).toHaveClass('ui-root');
    // Omitting the prop must inherit the ambient theme rather than force one.
    expect(main.hasAttribute('data-ui-scheme')).toBe(false);
  });

  it('pins the colour contract when a scheme is requested', () => {
    render(() => <SystemSpecimen scheme="light" />);
    expect(screen.getByRole('main')).toHaveAttribute('data-ui-scheme', 'light');
  });

  it('merges a caller class without dropping its own', () => {
    render(() => <SystemSpecimen class="host-class" />);
    const main = screen.getByRole('main');
    expect(main).toHaveClass('ui-root');
    expect(main).toHaveClass('ui-specimen');
    expect(main).toHaveClass('host-class');
  });
});

// ---------------------------------------------------------------------------
// Truth states
// ---------------------------------------------------------------------------

describe('SystemSpecimen truth states', () => {
  it('renders all six sanctioned states and no others', () => {
    const { container } = render(() => <SystemSpecimen />);
    const chips = container.querySelectorAll('[data-ui-truth]');
    expect(chips).toHaveLength(TRUTH_STATES.length);
    const rendered = [...chips].map((chip) => chip.getAttribute('data-ui-truth'));
    expect(rendered).toEqual([...TRUTH_STATES]);
  });

  it('states its meaning in text, never in colour alone', () => {
    const { container } = render(() => <SystemSpecimen />);
    for (const state of TRUTH_STATES) {
      const chip = container.querySelector(`[data-ui-truth='${state}']`);
      expect(chip, state).not.toBeNull();
      const scope = within(chip as HTMLElement);
      // A visible, readable label — the primary carrier of the state.
      expect(scope.getByText(TRUTH_LABELS[state])).toBeInTheDocument();
      // Plus a real sentence explaining what the state asserts.
      const meaning = chip!.querySelector('.ui-specimen__truth-meaning');
      expect(meaning?.textContent?.trim().length ?? 0).toBeGreaterThan(20);
    }
  });

  it('carries a distinct non-colour glyph per state', () => {
    const { container } = render(() => <SystemSpecimen />);
    const glyphs = [...container.querySelectorAll('.ui-truth-chip__glyph')].map((glyph) =>
      glyph.textContent?.trim(),
    );
    expect(glyphs).toHaveLength(TRUTH_STATES.length);
    // Shape is the redundant channel that survives colour-blindness, greyscale,
    // and forced-colors — so no two states may share one.
    expect(new Set(glyphs).size).toBe(TRUTH_STATES.length);
    expect(glyphs.every((glyph) => Boolean(glyph))).toBe(true);
  });

  it('hides the glyph from assistive technology so the label is not doubled', () => {
    const { container } = render(() => <SystemSpecimen />);
    for (const glyph of container.querySelectorAll('.ui-truth-chip__glyph')) {
      expect(glyph).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('names the proof token backing each state', () => {
    const { container } = render(() => <SystemSpecimen />);
    for (const state of TRUTH_STATES) {
      const chip = container.querySelector(`[data-ui-truth='${state}']`);
      expect(chip?.textContent, state).toContain(`--ui-proof-${state}`);
    }
  });

  it('invents no statistics or activity', () => {
    const { container } = render(() => <SystemSpecimen />);
    const text = container.textContent ?? '';
    // A specimen that shows "1,204 messages · 3 peers online" teaches the
    // reader that numbers on a specimen mean something. Every numeral on this
    // surface must therefore be explicitly justified — not a measurement of
    // anything, real or invented.
    const justified = new Set([
      '256', // the algorithm name in the evidence sample, not a quantity
      '0000', // placeholder digits in the fingerprint sample
    ]);
    const digitRuns = text.match(/\d[\d,.]*/g) ?? [];
    for (const run of digitRuns) {
      expect(justified.has(run), `unexplained figure "${run}"`).toBe(true);
    }
    expect(text).not.toMatch(/\bonline\b|\bunread\b|\bmessages\b|\bactive\b/i);
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

describe('SystemSpecimen actions', () => {
  it('renders the action affordances with accessible names', () => {
    render(() => <SystemSpecimen />);
    for (const name of [
      'Primary action',
      'Secondary action',
      'Critical action',
      'Unavailable action',
      'Inert icon action',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('marks the unavailable action as disabled rather than merely dimmed', () => {
    render(() => <SystemSpecimen />);
    const disabled = screen.getByRole('button', { name: 'Unavailable action' });
    expect(disabled).toBeDisabled();
  });

  it('requests the 44px target floor on every pointer target', () => {
    render(() => <SystemSpecimen />);
    for (const button of screen.getAllByRole('button')) {
      expect(button.className, button.textContent ?? '').toContain('ui-target');
    }
  });

  it('gives the busy indicator a status role and a name', () => {
    render(() => <SystemSpecimen />);
    expect(screen.getByRole('status', { name: 'Specimen busy indicator' })).toBeInTheDocument();
  });

  it('uses the shipping primitives rather than a local copy', () => {
    render(() => <SystemSpecimen />);
    // The real Button/IconButton emit these class hooks; a hand-rolled <button>
    // would silently drift from the components it claims to specify.
    expect(screen.getByRole('button', { name: 'Primary action' }).className).toContain(
      'onyx-button',
    );
    expect(screen.getByRole('button', { name: 'Inert icon action' }).className).toContain(
      'onyx-icon-button',
    );
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('SystemSpecimen determinism', () => {
  it('renders byte-identical markup across mounts', () => {
    const first = render(() => <SystemSpecimen />);
    const firstHtml = first.container.innerHTML;
    cleanup();
    const second = render(() => <SystemSpecimen />);
    expect(second.container.innerHTML).toBe(firstHtml);
  });
});

// ---------------------------------------------------------------------------
// Module boundaries
// ---------------------------------------------------------------------------

describe('SystemSpecimen boundaries', () => {
  it('imports no router or application state', () => {
    // Enforced on the source, not the render: a conditional store read would
    // pass every render assertion above and still couple the lab to the app.
    expect(findSourceViolations(specimenSource, FORBIDDEN_LAB_IMPORTS)).toEqual([]);
  });

  it('contains no clock, randomness, timer, or network call', () => {
    expect(findSourceViolations(specimenSource, FORBIDDEN_LAB_SOURCES)).toEqual([]);
  });

  it('is not wired into the application route table', () => {
    // The specimen must stay unreachable from the running app.
    const entry = readFileSync(join(repoRoot, 'src/index.tsx'), 'utf8');
    expect(entry).not.toMatch(/SystemSpecimen/);
    expect(entry).not.toMatch(/ui\/lab/);
  });

  it('hardcodes no colour in the component source', () => {
    // Asserted over the whole file rather than by scanning `style={{ … }}`
    // blocks: a template literal inside the braces defeats a brace-matching
    // regex, and a test that silently matches nothing proves nothing.
    const code = specimenSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\brgba?\(|\bhsla?\(|\boklch\(|\boklab\(/);
  });

  it('routes its one inline style through a token reference', () => {
    expect(specimenSource).toMatch(/style=\{\{\s*background:\s*`var\(\$\{/);
  });
});
