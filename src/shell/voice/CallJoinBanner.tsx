// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Empty/error surface after a failed join or a dropped call.
 * Copy is always "Couldn't join. Try again." — no protocol errors.
 */

import type { JSX } from 'solid-js';
import { CALL_JOIN_FAILED_COPY } from '@/lib/media/callJoinCopy';

export type CallJoinBannerProps = {
  onRetry: () => void;
};

export function CallJoinBanner(props: CallJoinBannerProps): JSX.Element {
  return (
    <div
      class="call-join-banner"
      role="status"
      data-testid="call-join-banner"
    >
      <p class="call-join-banner__copy">{CALL_JOIN_FAILED_COPY}</p>
      <button
        type="button"
        class="call-join-banner__retry"
        data-testid="call-join-retry"
        onClick={() => props.onRetry()}
      >
        Try again
      </button>
    </div>
  );
}
