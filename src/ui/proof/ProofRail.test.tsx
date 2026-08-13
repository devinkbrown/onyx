// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { PROOF_STATE_COPY, ProofRail, ProofReceipt, TRUTH_STATES, type TruthState } from './index';

afterEach(cleanup);

const sourceFiles = ['types.ts', 'copy.ts', 'ProofRail.tsx', 'ProofReceipt.tsx', 'proof-rail.css'] as const;
const source = sourceFiles.map((file) => readFileSync(join(process.cwd(), 'src/ui/proof', file), 'utf8')).join('\n');
const stylesheet = readFileSync(join(process.cwd(), 'src/ui/proof/proof-rail.css'), 'utf8');

describe('Proof Rail truth receipts', () => {
  it('renders the exact six states with visible copy and a redundant shape', () => {
    for (const state of TRUTH_STATES) {
      cleanup();
      const { container } = render(() => (
        <ProofRail
          state={state}
          label={`Room history: ${state}`}
          evidenceType="history source"
        />
      ));

      const rail = container.querySelector('[data-ui="proof-rail"]');
      const receipt = container.querySelector('[data-ui="proof-receipt"]');
      expect(rail).toHaveAttribute('data-ui-truth', state);
      expect(receipt).toHaveAttribute('data-ui-truth', state);
      expect(screen.getByText(PROOF_STATE_COPY[state].label)).toBeVisible();
      expect(screen.getByText(PROOF_STATE_COPY[state].detail)).toBeVisible();
      expect(screen.getByText(`Room history: ${state}`)).toBeVisible();
      expect(receipt?.querySelector('[aria-hidden="true"]')).toHaveTextContent(
        PROOF_STATE_COPY[state].glyph,
      );
      expect(screen.getByText('Evidence type')).toBeVisible();
      expect(screen.getByText('history source')).toBeVisible();
    }
  });

  it('keeps the state text in the accessibility tree and names the rail landmark', () => {
    render(() => (
      <ProofRail state="unknown" label="Room history" ariaLabel="Current room proof" />
    ));

    const rail = screen.getByRole('region', { name: 'Current room proof' });
    const status = screen.getByRole('status');
    expect(rail).toHaveAttribute('data-ui-truth', 'unknown');
    expect(status).toHaveTextContent('Unknown');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).not.toHaveAttribute('aria-hidden');
    expect(screen.getByText('No claim can be made from the available information.')).toBeVisible();
  });

  it('keeps unavailable visibly unavailable instead of making it look safe', () => {
    render(() => <ProofReceipt state="unavailable" label="Room history" />);

    expect(screen.getByRole('status')).toHaveTextContent('Unavailable');
    expect(screen.getByText('The source could not be reached.')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Room history' })).toHaveAttribute(
      'data-ui-truth',
      'unavailable',
    );
  });

  it('renders a caller-owned action without creating a control contract', () => {
    let clicks = 0;
    render(() => (
      <ProofRail
        state="partial"
        label="Room history"
        action={<button type="button" onClick={() => (clicks += 1)}>Review range</button>}
      />
    ));

    const action = screen.getByRole('button', { name: 'Review range' });
    expect(action).toBeVisible();
    fireEvent.click(action);
    expect(clicks).toBe(1);
  });

  it('accepts an action factory and an ordinary child for existing primitives', () => {
    render(() => (
      <ProofRail
        state="local"
        label="Room history"
        action={() => <a href="/details">Read detail</a>}
      />
    ));

    expect(screen.getByRole('link', { name: 'Read detail' })).toHaveAttribute('href', '/details');

    cleanup();
    render(() => (
      <ProofRail state="local" label="Room history">
        <button type="button">Open receipt</button>
      </ProofRail>
    ));

    expect(screen.getByRole('button', { name: 'Open receipt' })).toBeVisible();
  });

  it('reacts when supplied state and label values change', () => {
    const [state, setState] = createSignal<TruthState>('unknown');
    const [label, setLabel] = createSignal('Room history');
    const { container } = render(() => (
      <ProofRail state={state()} label={label()} />
    ));

    expect(screen.getByRole('status')).toHaveTextContent('Unknown');
    expect(screen.getByText('Room history')).toBeVisible();

    setState('verified');
    setLabel('Room messages');

    expect(container.querySelector('[data-ui="proof-rail"]')).toHaveAttribute(
      'data-ui-truth',
      'verified',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Verified');
    expect(screen.getByText('Room messages')).toBeVisible();
    expect(screen.queryByText('Room history')).toBeNull();
  });
});

describe('Proof Rail boundaries', () => {
  it('uses semantic UI variables and all required accessibility media hooks', () => {
    expect(stylesheet).toContain('--ui-');
    expect(stylesheet).toContain('44px');
    expect(stylesheet).toContain(':focus-visible');
    expect(stylesheet).toContain('forced-colors: active');
    expect(stylesheet).toContain('prefers-contrast: more');
    expect(stylesheet).toContain('prefers-reduced-motion: reduce');
    expect(stylesheet).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('has no application reads or value-shaped evidence props', () => {
    expect(source).not.toMatch(/\b(?:store|network|crypto|route|router|fetch|WebSocket)\b/i);
    expect(source).not.toMatch(/(?:secret|cipher|hash|fingerprint|privateKey|publicKey|token)\s*[?:]/i);
    expect(source).not.toMatch(/padlock|protected|encrypted|secure/i);
  });
});
