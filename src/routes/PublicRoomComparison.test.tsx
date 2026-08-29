// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import type { StatsChannel } from '@/lib/stats/networkIndex';
import * as clipboard from '@/lib/clipboard/writeClipboardText';
import PublicRoomComparison, {
  parseStatsCompareQuery,
  statsCompareQuery,
} from './PublicRoomComparison';

const css = readFileSync(resolve(__dirname, 'public-room-comparison.css'), 'utf8');

function room(channel: string, messages: number, present: number, lastActive: number): StatsChannel {
  return {
    channel,
    messages,
    active_users: present,
    present,
    last_active: lastActive,
    topic: `${channel} topic`,
    spark: [1, 3, messages > 20 ? 8 : 2],
  };
}

const ROOT = room('#root', 42, 3, 1_783_500_000);
const QUIET = room('#quiet', 18, 0, 1_783_499_000);

function renderComparison(
  feedState: 'current' | 'partial' | 'stale' | 'future' | 'unknown' | 'loading' | 'unavailable',
  initialSelection: string[] = [],
  channels: StatsChannel[] = [ROOT, QUIET],
) {
  const [selected, setSelected] = createSignal(initialSelection);
  const onToggle = vi.fn((channel: string) => {
    setSelected((current) => current.includes(channel)
      ? current.filter((entry) => entry !== channel)
      : [...current, channel]);
  });
  const onClear = vi.fn(() => setSelected([]));
  render(() => (
    <PublicRoomComparison
      channels={() => channels}
      selectedChannels={selected}
      feedState={() => feedState}
      totalMessages={() => channels.reduce((sum, entry) => sum + entry.messages, 0)}
      nowMs={() => Date.now()}
      shareHref={() => `https://onyx.example/stats/?compare=${encodeURIComponent(selected().join(','))}`}
      onToggle={onToggle}
      onClear={onClear}
    />
  ));
  return { onToggle, onClear, setSelected };
}

describe('PublicRoomComparison URL state', () => {
  it('accepts two distinct valid rooms and ignores malformed or excess values', () => {
    expect(parseStatsCompareQuery('?compare=%23root,%23quiet,%23third')).toEqual(['#root', '#quiet']);
    expect(parseStatsCompareQuery('?compare=%23Root,%23root,%23bad%20room')).toEqual(['#Root']);
    expect(parseStatsCompareQuery('?compare=%23root%2C%26ops')).toEqual(['#root', '&ops']);
    expect(statsCompareQuery(['#root', '#quiet', '#third', '#root'])).toBe('#root,#quiet');
    expect(statsCompareQuery(['bad room', '#root'])).toBe('#root');
  });
});

describe('PublicRoomComparison', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders aggregate comparison values and lets keyboard users remove a room', () => {
    const { onToggle, onClear } = renderComparison('current', ['#root', '#quiet']);
    const comparison = screen.getByTestId('public-room-comparison');
    expect(comparison).toHaveAttribute('data-feed-state', 'current');
    expect(screen.getByRole('table', { name: 'Aggregate comparison of selected public rooms' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /messages tracked/i })).toHaveTextContent('42');
    expect(screen.getByRole('row', { name: /activity pulse/i })).toHaveTextContent('12');
    expect(screen.getByText(/#root leads by 24 tracked messages/i)).toBeInTheDocument();
    const chips = screen.getByRole('list', { name: 'Selected rooms' });
    const removeRoot = within(chips).getByRole('button', { name: 'Remove #root from comparison' });
    removeRoot.focus();
    expect(removeRoot).toHaveFocus();
    fireEvent.click(removeRoot);
    expect(onToggle).toHaveBeenCalledWith('#root');
    const clear = screen.getByRole('button', { name: 'Clear room comparison' });
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('copies the current comparison link only after the clipboard confirms it', async () => {
    const writeClipboardText = vi.spyOn(clipboard, 'writeClipboardText').mockResolvedValue(true);
    renderComparison('current', ['#root', '#quiet']);

    const copy = screen.getByRole('button', { name: 'Copy comparison link' });
    copy.focus();
    expect(copy).toHaveFocus();
    fireEvent.click(copy);

    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith(
      'https://onyx.example/stats/?compare=%23root%2C%23quiet',
    ));
    expect(await screen.findByText('Comparison link copied to clipboard.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Copy comparison link' })).toHaveTextContent('Link copied');
  });

  it('does not announce a copied link after its room selection changes in flight', async () => {
    let resolveCopy: (copied: boolean) => void = () => {};
    const pending = new Promise<boolean>((resolve) => {
      resolveCopy = resolve;
    });
    vi.spyOn(clipboard, 'writeClipboardText').mockReturnValue(pending);
    const { setSelected } = renderComparison('current', ['#root']);

    fireEvent.click(screen.getByRole('button', { name: 'Copy comparison link' }));
    setSelected(['#quiet']);
    resolveCopy(true);
    await pending;
    await Promise.resolve();

    expect(screen.queryByText('Comparison link copied to clipboard.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy comparison link' })).toHaveTextContent('Copy link');
  });

  it('keeps loading and unavailable feeds explicit before a room index exists', () => {
    renderComparison('loading', [], []);
    expect(screen.getByTestId('public-room-comparison')).toHaveAttribute('data-feed-state', 'loading');
    expect(screen.getByText('Room choices are loading.')).toBeInTheDocument();
    expect(screen.getByText(/waiting for the public room index/i)).toBeInTheDocument();
    cleanup();

    renderComparison('unavailable', [], []);
    expect(screen.getByTestId('public-room-comparison')).toHaveAttribute('data-feed-state', 'unavailable');
    expect(screen.getByText('Room comparison is unavailable.')).toBeInTheDocument();
    expect(screen.getByText(/until a public room index is exported/i)).toBeInTheDocument();
  });

  it('labels partial and stale comparisons as snapshots without hiding aggregate data', () => {
    renderComparison('partial', ['#root']);
    expect(screen.getByTestId('public-room-comparison')).toHaveAttribute('data-feed-state', 'partial');
    expect(screen.getByText(/export is incomplete/i)).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    cleanup();

    renderComparison('stale', ['#root', '#quiet']);
    expect(screen.getByTestId('public-room-comparison')).toHaveAttribute('data-feed-state', 'stale');
    expect(screen.getByText(/retained snapshot/i)).toBeInTheDocument();
  });

  it('keeps interaction targets and accessibility variants in the visual contract', () => {
    expect(css).toContain('min-height: var(--target-min, 44px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('overflow-x: auto');
    expect(css).toContain('public-room-comparison__share');
    expect(css).toContain('public-room-comparison__table-wrap:focus-visible');
  });
});
