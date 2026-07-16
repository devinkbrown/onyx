// SPDX-License-Identifier: AGPL-3.0-or-later
import { onCleanup, onMount } from 'solid-js';

import { getState } from '@/lib/store';

import {
  MAX_TOPIC_READ_ENTRIES,
  readTopicReadLedger,
  subscribeTopicReadLedger,
  type TopicReadMarker,
} from './topicReadLedger';

function markerKey(marker: TopicReadMarker): string {
  return `${marker.channel}\u0000${marker.topic}`;
}

function markerValue(marker: TopicReadMarker): string {
  return `${marker.lastReadAt}\u0000${marker.lastReadMessageId}`;
}

function indexMarkers(markers: readonly TopicReadMarker[]): Map<string, string> {
  const indexed = new Map<string, string>();
  for (const marker of markers.slice(0, MAX_TOPIC_READ_ENTRIES)) {
    indexed.set(markerKey(marker), markerValue(marker));
  }
  return indexed;
}

/**
 * Return only channels whose topic cursor was added, removed, or advanced.
 * Both inputs are ledger-bounded, and a Set ensures one reconciliation even
 * when several topic markers in the same room change together.
 */
export function changedTopicReadChannels(
  previous: readonly TopicReadMarker[],
  next: readonly TopicReadMarker[],
): ReadonlySet<string> {
  const before = indexMarkers(previous);
  const after = indexMarkers(next);
  const changed = new Set<string>();

  for (const marker of previous.slice(0, MAX_TOPIC_READ_ENTRIES)) {
    if (after.get(markerKey(marker)) !== markerValue(marker)) changed.add(marker.channel);
  }
  for (const marker of next.slice(0, MAX_TOPIC_READ_ENTRIES)) {
    if (before.get(markerKey(marker)) !== markerValue(marker)) changed.add(marker.channel);
  }
  return changed;
}

/**
 * Keep sidebar and inbox aggregates aligned with device/cross-tab topic reads.
 * The subscriber diffs the bounded marker ledger and touches only affected
 * rooms that are currently loaded in the store; it never scans every channel.
 */
export function startTopicReadReconciliation(): () => void {
  let previous = readTopicReadLedger();
  return subscribeTopicReadLedger((markers) => {
    const changedChannels = changedTopicReadChannels(previous, markers);
    previous = markers.map((marker) => ({ ...marker }));
    if (changedChannels.size === 0) return;

    const state = getState();
    for (const channel of changedChannels) {
      if (state.channels.has(channel)) state.reconcileChannelTopicUnread(channel);
    }
  });
}

/** App-lifetime owner for the device-local topic-read reconciliation bridge. */
export function TopicReadRuntime(): null {
  onMount(() => {
    const stop = startTopicReadReconciliation();
    onCleanup(stop);
  });
  return null;
}
