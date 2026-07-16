// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import { createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js';
import { Mascot } from '@/components/brand/Mascot';
import { fetchBackupManifest } from '@/lib/stats/backups';
import { relTime } from '@/lib/stats/networkIndex';
import { fetchNetworkStatus, formatDuration } from '@/lib/stats/status';
import { publicFeedFreshness } from '@/lib/stats/feedBounds';
import { setPageMeta } from './pageMeta';

function statusState(quorum: boolean, partitioned: boolean): 'up' | 'degraded' {
  return quorum && !partitioned ? 'up' : 'degraded';
}

export default function StatusRoute() {
  setPageMeta(
    'Onyx status — mesh health',
    'Public Onyx mesh health, node uptime, peer latency, users online, and backup readiness.',
    '/status',
  );
  const [status, { refetch: refetchStatus }] = createResource(fetchNetworkStatus);
  const [backups, { refetch: refetchBackups }] = createResource(fetchBackupManifest);
  const [nowMs, setNowMs] = createSignal(Date.now());
  const timer = setInterval(() => {
    setNowMs(Date.now());
    void refetchStatus();
    void refetchBackups();
  }, 30_000);
  onCleanup(() => clearInterval(timer));
  const feedState = createMemo(() => {
    const data = status();
    if (!data) return 'unavailable';
    const freshness = publicFeedFreshness(data.generated_at, nowMs());
    if (freshness !== 'current') return freshness;
    return statusState(data.mesh.quorum, data.mesh.partitioned) === 'up' ? 'current' : 'degraded';
  });
  const feedLabel = createMemo(() => {
    switch (feedState()) {
      case 'current': return 'mesh online';
      case 'degraded': return 'mesh degraded';
      case 'stale': return 'status stale';
      case 'future': return 'status time mismatch';
      case 'unknown': return 'status undated';
      default: return 'status unavailable';
    }
  });

  return (
    <main class="r data-page">
      <div class="r-ground" aria-hidden="true" />
      <div class="r-flecks" aria-hidden="true" />
      <svg class="r-veins" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
        <path class="flow" d="M-40 150 C 280 70, 470 280, 760 230 S 1160 120, 1500 250" />
        <path class="flow" d="M-40 560 C 330 650, 560 430, 870 530 S 1240 660, 1520 570" />
        <path d="M-40 790 C 360 720, 700 860, 1040 760 S 1320 720, 1520 820" />
        <circle class="node" cx="760" cy="230" r="3" />
        <circle class="node" cx="870" cy="530" r="3" />
      </svg>
      <div class="r-grain" aria-hidden="true" />

      <header class="r-status" role="banner">
        <a class="brand" href="/" aria-label="Onyx home">
          <Mascot variant="mark" />ONYX
        </a>
        <nav aria-label="Primary">
          <a class="hideable" href="/">Home</a>
          <a class="hideable" href="/stats">Stats</a>
          <a class="hideable" href="/status" aria-current="page">Status</a>
          <a class="hideable" href="/roadmap">Roadmap</a>
          <a class="hideable" href="/about">About</a>
          <span class="live hideable" data-feed-state={feedState()}><i aria-hidden="true" />{feedLabel()}</span>
          <a class="enter" href="/app">Open Onyx</a>
        </nav>
      </header>

      <section class="r-wrap data-hero" aria-labelledby="status-heading">
        <p class="r-kicker">network status</p>
        <h1 id="status-heading">Mesh health,<br /><span class="gold">in public</span></h1>
        <p class="sub">
          Node uptime, quorum, peer links, and latency from the same exported health
          feed operators use to see whether the network is whole.
        </p>
        <Show when={status()} fallback={<div class="data-empty">Status is waiting for the next exported feed.</div>}>
          {(data) => {
            const state = () => statusState(data().mesh.quorum, data().mesh.partitioned);
            const upPeers = () => data().peers.filter((p) => p.up).length;
            return (
              <div class="data-summary" aria-label="Status summary">
                <div class="data-metric">
                  <span class="label">state</span>
                  <span class="status-pill" data-state={state()}>{state() === 'up' ? 'operational' : 'degraded'}</span>
                  <span class="note">updated {relTime(data().generated_at, nowMs())}</span>
                </div>
                <div class="data-metric">
                  <span class="label">users online</span>
                  <span class="value">{data().users_online.toLocaleString('en-US')}</span>
                  <span class="note">mesh-wide presence</span>
                </div>
                <div class="data-metric">
                  <span class="label">peer links</span>
                  <span class="value">{upPeers()}/{data().peers.length}</span>
                  <span class="note">currently established</span>
                </div>
                <div class="data-metric">
                  <span class="label">uptime</span>
                  <span class="value">{formatDuration(data().uptime_seconds)}</span>
                  <span class="note">{data().node || data().network || 'current node'}</span>
                </div>
              </div>
            );
          }}
        </Show>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      <section class="r-wrap r-section data-grid" aria-label="Mesh detail">
        <article class="data-card">
          <span class="label">quorum</span>
          <Show when={status()} fallback={<h2>No feed yet</h2>}>
            {(data) => (
              <>
                <h2>{data().mesh.quorum ? 'Majority side' : 'Minority side'}</h2>
                <p>
                  {data().mesh.partitioned
                    ? `The mesh reports ${data().mesh.components} visible components. Traffic keeps flowing where links remain established.`
                    : 'The mesh reports one healthy component. Peer links are sharing one view of the network.'}
                </p>
              </>
            )}
          </Show>
        </article>

        <aside class="data-card">
          <span class="label">backups</span>
          <h3>Vault backups</h3>
          <p>
            <Show when={backups()} fallback="Waiting for the public backup manifest.">
              {(manifest) => manifest().files.length === 0
                ? 'The backup manifest is present, but no snapshot files are listed.'
                : `${manifest().files.length} snapshot file${manifest().files.length === 1 ? '' : 's'} published ${relTime(manifest().generated_at, nowMs())}.`}
            </Show>
          </p>
          <Show when={backups()?.files.length}>
            <div class="data-list data-list--compact">
              <For each={backups()?.files ?? []}>
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
          <div class="r-cta"><a class="r-btn ghost" href="/stats">Open stats &rarr;</a></div>
        </article>
        <aside class="data-card">
          <span class="label">plan</span>
          <h3>Roadmap context</h3>
          <p>See how status, stats, and backup readiness fit into the operations phase.</p>
          <div class="r-cta"><a class="r-btn ghost" href="/roadmap">Open roadmap &rarr;</a></div>
        </aside>
      </section>

      <section class="r-wrap r-section" aria-labelledby="peers-heading">
        <span class="r-eyebrow">peers</span>
        <h2 class="r-title" id="peers-heading">Links between<br />the shores</h2>
        <Show when={status()?.peers.length} fallback={<div class="data-empty">No peer links are present in the current feed.</div>}>
          <table class="peer-table">
            <thead>
              <tr>
                <th>Peer</th>
                <th>State</th>
                <th>RTT</th>
                <th>Since</th>
              </tr>
            </thead>
            <tbody>
              <For each={status()?.peers ?? []}>
                {(peer) => (
                  <tr>
                    <td>{peer.name}</td>
                    <td><span class="status-pill" data-state={peer.up ? 'up' : 'down'}>{peer.state}</span></td>
                    <td>{peer.rtt_ms === null ? 'no sample' : `${Math.round(peer.rtt_ms)}ms`}</td>
                    <td>{formatDuration(peer.since_seconds)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </section>
    </main>
  );
}
