// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './status.css';
import { createMemo, createResource, createSignal, onCleanup } from 'solid-js';
import {
  fetchNetworkStatus,
  publicMeshFeedState,
  type PublicMeshFeedState,
} from '@/lib/stats/status';
import { PublicFrame } from '@/ui/public';
import { setPageMeta } from './pageMeta';

type CommunityStatus = {
  label: string;
  sentence: string;
};

export function communityStatusVoice(state: PublicMeshFeedState): CommunityStatus {
  switch (state) {
    case 'loading':
      return {
        label: 'Checking',
        sentence: 'Looking for a public report. No health claim yet.',
      };
    case 'current':
      return {
        label: 'Reachable',
        sentence: 'The rooms are reachable tonight.',
      };
    case 'degraded':
      return {
        label: 'Having trouble',
        sentence: 'The rooms are having trouble — some people may not get through.',
      };
    case 'stale':
      return {
        label: 'We cannot say',
        sentence: 'The last report is too old to claim that the rooms are up.',
      };
    case 'future':
      return {
        label: 'We cannot say',
        sentence: 'The report time does not make sense, so we cannot claim health.',
      };
    case 'unknown':
      return {
        label: 'We cannot say',
        sentence: 'The report has no usable time, so we cannot claim health.',
      };
    default:
      return {
        label: 'We cannot say',
        sentence: 'There is no public report, so we cannot claim health.',
      };
  }
}

export default function StatusRoute() {
  setPageMeta(
    'Onyx status — are the rooms up?',
    'See whether Onyx rooms are reachable tonight. If the public report is missing or stale, we cannot claim health.',
    '/status/',
  );
  const [status, { refetch: refetchStatus }] = createResource(fetchNetworkStatus, { initialValue: null });
  const [nowMs, setNowMs] = createSignal(Date.now());
  const timer = setInterval(() => {
    setNowMs(Date.now());
    void refetchStatus();
  }, 30_000);
  onCleanup(() => clearInterval(timer));
  const feedState = createMemo<PublicMeshFeedState>(() => (
    status.loading ? 'loading' : publicMeshFeedState(status.latest, nowMs())
  ));
  const voice = createMemo(() => communityStatusVoice(feedState()));

  return (
    <PublicFrame
      currentPath="/status/"
      mainLabel="Onyx network status"
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">Tonight</span>
          <span aria-hidden="true">·</span>
          <span class="public-frame__current-label">Status</span>
        </p>
      )}
    >
      <div class="ui-root r status-route">
        <section class="r-wrap status-hero" aria-labelledby="status-heading">
          <p class="status-kicker">for people in the rooms</p>
          <h1 id="status-heading">Are the rooms up tonight?</h1>
          <p class="status-lede">
            One honest sentence. If we cannot say, we say so.
          </p>

          <div
            class="status-observation"
            id="status-observation"
            data-feed-state={feedState()}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span class="status-observation__marker" aria-hidden="true" />
            <span class="status-observation__label">{voice().label}</span>
            <span class="status-observation__detail">{voice().sentence}</span>
          </div>

          <div class="status-check">
            <button
              type="button"
              class="status-check__button"
              onClick={() => void refetchStatus()}
              aria-describedby="status-observation"
              aria-busy={status.loading || undefined}
              disabled={status.loading}
            >
              {status.loading ? 'Checking status…' : 'Check again'}
            </button>
          </div>
        </section>

        <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

        <section class="r-wrap status-quiet" aria-labelledby="status-next-heading">
          <h2 id="status-next-heading">What we are working on</h2>
          <p>
            Rooms, calls, catch-up, and a Home Screen on this device live on a
            quieter page. Status stays about tonight.
          </p>
          <a class="status-quiet-link" href="/roadmap/">Open the roadmap</a>
        </section>
      </div>
    </PublicFrame>
  );
}
