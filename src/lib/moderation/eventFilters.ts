// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Local-only Event Spine filters. These never issue a server command.
 */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/gu;
export const MAX_EVENT_FILTER_LENGTH = 80;

export type EventReplayFilterable = {
  category: string;
  categoryCode: string;
  severity: string;
  origin: string;
  message: string;
};

export type OperEventFilters = {
  category: string;
  severity: string;
  text: string;
};

export function normalizeEventFilter(value: string, max = MAX_EVENT_FILTER_LENGTH): string {
  return value.replace(CONTROL_CHARS, '').trim().slice(0, max);
}

export function filterEventReplayRows<T extends EventReplayFilterable>(
  events: readonly T[],
  filters: OperEventFilters,
): T[] {
  const category = normalizeEventFilter(filters.category, 32).toLowerCase();
  const severity = normalizeEventFilter(filters.severity, 24).toLowerCase();
  const text = normalizeEventFilter(filters.text).toLowerCase();
  return events.filter((event) => {
    if (category && event.category.toLowerCase() !== category && event.categoryCode.toLowerCase() !== category) {
      return false;
    }
    if (severity && event.severity.toLowerCase() !== severity) return false;
    if (!text) return true;
    const haystack = `${event.category} ${event.categoryCode} ${event.severity} ${event.origin} ${event.message}`.toLowerCase();
    return haystack.includes(text);
  });
}
