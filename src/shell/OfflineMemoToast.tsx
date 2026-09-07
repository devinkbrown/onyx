// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * OfflineMemoToast — surface NOTE MEMO delivery as a calm toast so offline
 * catches aren't only a sidebar stamp.
 */
import { onCleanup, onMount } from 'solid-js';
import { getState } from '@/lib/store';

type OfflineMemoDetail = {
  from?: string;
  count?: number;
  target?: string;
};

export function OfflineMemoToast(): null {
  onMount(() => {
    const onMemo = (event: Event) => {
      const detail = (event as CustomEvent<OfflineMemoDetail>).detail;
      if (!detail || typeof detail !== 'object') return;
      const from = typeof detail.from === 'string'
        ? detail.from.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64)
        : '';
      const count = typeof detail.count === 'number' && Number.isFinite(detail.count)
        ? Math.max(1, Math.floor(detail.count))
        : 1;
      if (!from) return;
      getState().addToast({
        variant: 'info',
        title: count === 1 ? `Memo from ${from}` : `${count} memos from ${from}`,
        description: 'Delivered while you were offline — open the DM to catch up.',
      });
    };
    window.addEventListener('onyx:offlineMemo', onMemo as EventListener);
    onCleanup(() => {
      window.removeEventListener('onyx:offlineMemo', onMemo as EventListener);
    });
  });
  return null;
}

export default OfflineMemoToast;
