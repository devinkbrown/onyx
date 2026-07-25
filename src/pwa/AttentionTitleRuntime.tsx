// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * AttentionTitleRuntime — put mention/DM attention into document.title.
 *
 * Complements AppBadgeRuntime (OS icon badge). Only interrupt-worthy counts
 * (totalUnreadMentions) update the title so ordinary channel chatter stays calm.
 */
import { createEffect, onCleanup, type JSX } from 'solid-js';

import { useStore } from '@/lib/store';

const BASE_TITLE = 'Onyx';

function formatTitle(mentions: number): string {
  if (!Number.isFinite(mentions) || mentions <= 0) return BASE_TITLE;
  const n = Math.min(Math.trunc(mentions), 999);
  return `(${n}) ${BASE_TITLE}`;
}

export function AttentionTitleRuntime(): JSX.Element {
  const mentions = useStore((s) => s.totalUnreadMentions);

  createEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = formatTitle(mentions());
  });

  onCleanup(() => {
    if (typeof document === 'undefined') return;
    // Leaving /app must not leave a parenthetical badge in the tab title.
    if (document.title === formatTitle(mentions()) || /^\(\d+\) Onyx$/.test(document.title)) {
      document.title = BASE_TITLE;
    }
  });

  return null;
}

export { formatTitle as formatAttentionTitle };
