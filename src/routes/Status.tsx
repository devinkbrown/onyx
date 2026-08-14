// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import './status.css';
import { createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js';
import { fetchBackupManifest } from '@/lib/stats/backups';
import { relTime } from '@/lib/stats/networkIndex';
import {
  fetchNetworkStatus,
  formatDuration,
  publicMeshFeedLabel,
  publicMeshFeedState,
  type PublicMeshFeedState,
} from '@/lib/stats/status';
import { PublicFrame } from '@/ui/public';
import { setPageMeta } from './pageMeta';

type StatusTone = 'up' | 'degraded' | 'unknown';

function topologyPresentation(state: PublicMeshFeedState): { label: string; tone: StatusTone } {
  if (state === 'current') return { label: 'operational', tone: 'up' };
  if (state === 'degraded') return { label: 'degraded', tone: 'degraded' };
  return { label: publicMeshFeedLabel(state), tone: 'unknown' };
}

function feedDetail(state: PublicMeshFeedState): string {
  switch (state) {
    case 'loading': return 'Requesting the public export. No health claim yet.';
    case 'current': return 'A fresh, complete report observes quorum with no partition.';
    case 'degraded': return 'The current report observes missing quorum, a partition, or incomplete peer data.';
    case 'stale': return 'The last report is too old to support a current health claim.';
    case 'future': return 'The report timestamp is in the future, so it cannot support a current health claim.';
    case 'unknown': return 'The report has no usable timestamp, so freshness cannot be established.';
    default: return 'No public status export is available. No health claim is being made.';
  }
}

export default function StatusRoute() {
  setPageMeta(
    'Onyx status — mesh health',
    'Public Onyx mesh health, node uptime, peer latency, users online, and backup readiness.',
    '/status/',
  );
  const [status, { refetch: refetchStatus }] = createResource(fetchNetworkStatus, { initialValue: null });
  const [backups, { refetch: refetchBackups }] = createResource(fetchBackupManifest, { initialValue: null });
  const [nowMs, setNowMs] = createSignal(Date.now());
  const timer = setInterval(() => {
    setNowMs(Date.now());
    void refetchStatus();
    void refetchBackups();
  }, 30_000);
  onCleanup(() => clearInterval(timer));
  const feedState = createMemo<PublicMeshFeedState>(() => (
    status.loading ? 'loading' : publicMeshFeedState(status.latest, nowMs())
  ));
  const topology = createMemo(() => topologyPresentation(feedState()));

  return (
    <PublicFrame
      currentPath="/status/"
      mainLabel="Onyx network status"
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">Ledger</span>
          <span aria-hidden="true">·</span>
          <span class="public-frame__current-label">Status</span>
        </p>
      )}
    >
      <div class="ui-root r data-page status-route">
        <section class="r-wrap data-hero status-hero" aria-labelledby="status-heading">
          <p class="r-kicker">network status</p>
          <h1 id="status-heading">Mesh health,<br /><span class="status-title-accent">in public</span></h1>
          <p class="sub">
            Node uptime, quorum, peer links, and latency from the exported public
            observation — including when that observation cannot support a health claim.
          </p>

          <div
            class="status-observation"
            data-feed-state={feedState()}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span class="status-observation__marker" aria-hidden="true" />
            <span class="status-observation__label">{publicMeshFeedLabel(feedState())}</span>
            <span class="status-observation__detail">{feedDetail(feedState())}</span>
          </div>

          <Show when={status.latest}>
            {(data) => {
              const upPeers = () => data().peers.filter((peer) => peer.up).length;
              return (
                <div class="data-summary status-summary" aria-label="Status summary">
                  <div class="data-metric">
                    <span class="label">observed state</span>
                    <span class="status-pill" data-state={topology().tone}>{topology().label}</span>
                    <span class="note">report generated {relTime(data().generated_at, nowMs())}</span>
                  </div>
                  <div class="data-metric">
                    <span class="label">users online</span>
                    <span class="value">{data().users_online.toLocaleString('en-US')}</span>
                    <span class="note">reported mesh-wide presence</span>
                  </div>
                  <div class="data-metric">
                    <span class="label">peer links</span>
                    <span class="value">{upPeers()}/{data().peers.length}</span>
                    <span class="note">
                      {data().peers_complete ? 'complete peer observation' : 'incomplete peer observation'}
                    </span>
                  </div>
                  <div class="data-metric">
                    <span class="label">node uptime</span>
                    <span class="value">{formatDuration(data().uptime_seconds)}</span>
                    <span class="note">{data().node || data().network || 'unnamed reported node'}</span>
                  </div>
                </div>
              );
            }}
          </Show>
        </section>

        <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

        <section class="r-wrap r-section data-grid" aria-label="Mesh detail">
          <article class="data-card">
            <span class="label">quorum observation</span>
            <Show when={status.latest} fallback={<h2>No report available</h2>}>
              {(data) => (
                <>
                  <h2>{data().mesh.quorum ? 'Majority side' : 'Minority side'}</h2>
                  <p>
                    {data().mesh.partitioned
                      ? `The report contains ${data().mesh.components} visible components. It does not establish whole-mesh availability.`
                      : 'The report contains one component. Freshness and peer completeness still determine whether it supports a current health claim.'}
                  </p>
                </>
              )}
            </Show>
          </article>

          <aside class="data-card">
            <span class="label">backup publication</span>
            <h3>Vault backups</h3>
            <p>
              <Show
                when={backups.latest}
                fallback={backups.loading
                  ? 'Checking the public backup manifest.'
                  : 'No public backup manifest is available.'}
              >
                {(manifest) => manifest().files.length === 0
                  ? 'The backup manifest is present, but no snapshot files are listed.'
                  : `${manifest().files.length} snapshot file${manifest().files.length === 1 ? '' : 's'} published ${relTime(manifest().generated_at, nowMs())}.`}
              </Show>
            </p>
            <Show when={backups.latest?.files.length}>
              <div class="data-list data-list--compact" aria-label="Published backup files">
                <For each={backups.latest?.files ?? []}>
                  {(file) => (
                    <div class="data-row">
                      <div>
                        <strong>{file.kind}</strong>
                        <span>{file.name}</span>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </aside>
        </section>

        <section class="r-wrap r-section data-grid" aria-label="Related public surfaces">
          <article class="data-card">
            <span class="label">activity</span>
            <h2>Rooms and graph history</h2>
            <p>Move from node health into public room activity, daily message bars, and room handoff links.</p>
            <div class="r-cta"><a class="r-btn ghost" href="/stats/">Open stats &rarr;</a></div>
          </article>
          <aside class="data-card">
            <span class="label">plan</span>
            <h3>Roadmap context</h3>
            <p>See how status, stats, and backup readiness fit into the operations phase.</p>
            <div class="r-cta"><a class="r-btn ghost" href="/roadmap/">Open roadmap &rarr;</a></div>
          </aside>
        </section>

        <section class="r-wrap r-section status-peers" aria-labelledby="peers-heading">
          <span class="r-eyebrow">peer observations</span>
          <h2 class="r-title" id="peers-heading">Links between<br />the shores</h2>
          <Show
            when={status.latest?.peers.length}
            fallback={<div class="data-empty">No peer links are present in the current public report.</div>}
          >
            <table class="peer-table">
              <caption>Peer link observations from the current public report</caption>
              <thead>
                <tr>
                  <th scope="col">Peer</th>
                  <th scope="col">State</th>
                  <th scope="col">RTT</th>
                  <th scope="col">Since</th>
                </tr>
              </thead>
              <tbody>
                <For each={status.latest?.peers ?? []}>
                  {(peer) => (
                    <tr>
                      <th scope="row" data-label="Peer">{peer.name}</th>
                      <td data-label="State"><span class="status-pill" data-state={peer.up ? 'up' : 'down'}>{peer.state}</span></td>
                      <td data-label="RTT">{peer.rtt_ms === null ? 'no sample' : `${Math.round(peer.rtt_ms)}ms`}</td>
                      <td data-label="Since">{formatDuration(peer.since_seconds)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        </section>
      </div>
    </PublicFrame>
  );
}
