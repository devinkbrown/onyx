// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';

import type { GroupControlRuntimeState } from '@/lib/e2ee/groupControlRuntime';

import { SessionTruthBar } from './SessionTruthBar';
import type { SessionTruthInput } from './sessionTruth';

const appliedRuntime: GroupControlRuntimeState = {
  generation: 1,
  lifecycle: 'ready',
  activation: 'hold',
  identity: { clientId: null, endpoint: null, account: null, deviceId: null },
  rooms: [{ room: '#lobby', status: 'control-applied', provisioned: true }],
  counters: {
    accepted: 0,
    processed: 0,
    queued: 0,
    applied: 1,
    locked: 0,
    rejected: 0,
    ignored: 0,
    coalesced: 0,
    evicted: 0,
    expired: 0,
  },
  queueDepth: 0,
  sessionCount: 1,
};

const input = (overrides: Partial<SessionTruthInput> = {}): SessionTruthInput => ({
  transport: 'connected',
  authenticatedAccount: null,
  rememberedIdentityAccess: 'resume',
  sessionContinuity: 'none',
  room: '#lobby',
  groupControl: appliedRuntime,
  dmProtection: 'not-active',
  callState: 'in_call',
  callStartedAt: 1_700_000_000_000,
  ...overrides,
});

afterEach(cleanup);

describe('SessionTruthBar', () => {
  it('renders eight independently labelled, passive facts', () => {
    render(() => <SessionTruthBar input={input()} />);

    const region = screen.getByRole('region', { name: 'Session truth' });
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'false');
    expect(within(region).getAllByRole('listitem')).toHaveLength(8);
    expect(region.querySelector('button, a, input, select, textarea')).toBeNull();
    expect(region.querySelector('[tabindex]')).toBeNull();

    for (const label of [
      'Transport',
      'Identity',
      'Session continuity',
      'Group control',
      'Group message protection',
      'DM protection',
      'Call establishment',
      'Call media protection',
    ]) {
      expect(within(region).getByText(label)).toBeInTheDocument();
    }
  });

  it('shows connected, remembered, applied, and established states without over-claiming', () => {
    render(() => <SessionTruthBar input={input()} />);
    const region = screen.getByTestId('session-truth-bar');

    expect(within(region).getByText('Connected')).toBeInTheDocument();
    expect(within(region).getByText('Not authenticated')).toBeInTheDocument();
    expect(within(region).getByText('Resume remembered')).toBeInTheDocument();
    expect(within(region).getByText('Signed out')).toBeInTheDocument();
    expect(within(region).getByText('Established')).toBeInTheDocument();
    expect(within(region).getByText('Server-link only')).toBeInTheDocument();

    const groupProtection = region.querySelector('[data-dimension="group-message-protection"]');
    expect(groupProtection).toHaveTextContent('Not active');
    expect(groupProtection).toHaveTextContent('do not currently protect group messages');
    expect(region.textContent?.toLowerCase()).not.toMatch(/\bsecure\b/);
  });

  it('keeps applied controls and established calls visibly separate from protection', () => {
    render(() => <SessionTruthBar input={input({ authenticatedAccount: 'alice' })} />);
    const region = screen.getByTestId('session-truth-bar');

    expect(region.querySelector('[data-dimension="group-control"]')).toHaveTextContent('Applied');
    expect(region.querySelector('[data-dimension="group-message-protection"]')).toHaveTextContent('Not active');
    expect(region.querySelector('[data-dimension="call-establishment"]')).toHaveTextContent('Established');
    expect(region.querySelector('[data-dimension="call-media-protection"]')).toHaveTextContent('Server-link only');
  });

  it('supports a caller-supplied accessible region label', () => {
    render(() => <SessionTruthBar label="Current session facts" input={input()} />);
    expect(screen.getByRole('region', { name: 'Current session facts' })).toBeInTheDocument();
  });

  it('includes forced-colors and reduced-motion safeguards', () => {
    const sessionTruthBarCss = readFileSync(
      resolve(process.cwd(), 'src/shell/session/session-truth-bar.css'),
      'utf8',
    );
    expect(sessionTruthBarCss).toContain('@media (forced-colors: active)');
    expect(sessionTruthBarCss).toContain('forced-color-adjust: auto');
    expect(sessionTruthBarCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(sessionTruthBarCss).toContain('animation: none !important');
    expect(sessionTruthBarCss).toContain('transition: none !important');
  });
});
