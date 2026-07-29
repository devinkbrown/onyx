// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import { For, Show, createResource, createSignal, type JSX } from 'solid-js';
import { Mascot } from '@/components/brand/Mascot';
import { PublicFooter } from './PublicFooter';
import { setPageMeta } from './pageMeta';
import {
  BSD_DOWNLOAD_CARDS,
  DOWNLOAD_CATALOG_URL,
  DOWNLOAD_PRODUCT_VERSION,
  checksumFromCatalog,
  installSteps,
  parseSha256SumText,
  type BsdDownloadCard,
  type BsdDownloadLane,
  type DownloadCatalog,
} from './downloadMeta';

async function loadCatalog(): Promise<DownloadCatalog | null> {
  try {
    const res = await fetch(DOWNLOAD_CATALOG_URL, { credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as DownloadCatalog;
  } catch {
    return null;
  }
}

async function loadSha256(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const parsed = parseSha256SumText(await res.text());
    return parsed?.hash ?? null;
  } catch {
    return null;
  }
}

function CopyButton(props: { label: string; value: string; testId: string }): JSX.Element {
  const [state, setState] = createSignal<'idle' | 'copied' | 'failed'>('idle');
  return (
    <button
      type="button"
      class="dl-copy"
      data-testid={props.testId}
      data-state={state()}
      onClick={async () => {
        try {
          if (!navigator.clipboard?.writeText) {
            setState('failed');
            return;
          }
          await navigator.clipboard.writeText(props.value);
          setState('copied');
          window.setTimeout(() => setState('idle'), 1600);
        } catch {
          setState('failed');
        }
      }}
    >
      <Show when={state() === 'idle'} fallback={null}>
        {props.label}
      </Show>
      <Show when={state() === 'copied'}>Copied</Show>
      <Show when={state() === 'failed'}>Copy failed</Show>
    </button>
  );
}

function LaneCard(props: {
  card: BsdDownloadCard;
  catalog: DownloadCatalog | null | undefined;
}): JSX.Element {
  const [shaFromFile] = createResource(
    () => props.card.sha256Url,
    (url) => loadSha256(url),
  );
  const hash = () =>
    shaFromFile() ?? checksumFromCatalog(props.catalog ?? null, props.card.lane) ?? null;
  const steps = () => installSteps(props.card.lane).join('\n');

  return (
    <article class="dl-card data-card" data-testid={`dl-card-${props.card.lane}`}>
      <span class="label">{props.card.osLabel}</span>
      <h2>{props.card.title}</h2>
      <p>{props.card.summary}</p>
      <ul class="dl-facts">
        <li>
          <strong>Runtime (auto via install.sh)</strong>
          {' '}
          {props.card.primaryPackages.join(' + ')}
        </li>
        <li>
          <strong>Layout</strong>
          {' '}
          PREFIX/bin/onyx + PREFIX/resources (default PREFIX=/usr/local)
        </li>
        <li>
          <strong>Signing</strong>
          {' '}
          none — unsigned tarball
        </li>
      </ul>
      <div class="dl-actions">
        <a
          class="r-btn primary"
          data-testid={`dl-download-${props.card.lane}`}
          href={props.card.archiveUrl}
          download={props.card.archiveName}
        >
          Download tar.gz
        </a>
        <a class="r-btn ghost" href={props.card.noticeUrl}>
          Honesty notice
        </a>
        <a class="r-btn ghost" href={props.card.sha256Url}>
          SHA-256 file
        </a>
      </div>
      <div class="dl-checksum" data-testid={`dl-checksum-${props.card.lane}`}>
        <span class="dl-checksum-label">SHA-256</span>
        <Show
          when={hash()}
          fallback={(
            <p class="dl-checksum-missing">
              Checksum appears when this artifact is staged under
              {' '}
              <code>/downloads/v{DOWNLOAD_PRODUCT_VERSION}/</code>
              {' '}
              (not committed to git).
            </p>
          )}
        >
          {(h) => (
            <div class="dl-checksum-row">
              <code class="dl-hash" data-testid={`dl-hash-${props.card.lane}`}>{h()}</code>
              <CopyButton
                label="Copy"
                value={h()}
                testId={`dl-copy-hash-${props.card.lane}`}
              />
            </div>
          )}
        </Show>
      </div>
      <div class="dl-install">
        <h3>Install on {props.card.osLabel}</h3>
        <pre class="dl-pre" data-testid={`dl-install-${props.card.lane}`}>{steps()}</pre>
        <CopyButton
          label="Copy install steps"
          value={steps()}
          testId={`dl-copy-install-${props.card.lane}`}
        />
        <p class="dl-note">
          Root and network are required only when
          {' '}
          <code>install.sh</code>
          {' '}
          auto-installs system packages via
          {' '}
          {props.card.packageManager}
          . Use
          {' '}
          <code>--prefix</code>
          {' '}
          and
          {' '}
          <code>--no-deps</code>
          {' '}
          for a non-root tree. The script never curl-pipes remote code.
        </p>
      </div>
    </article>
  );
}

/**
 * Public /download — FreeBSD/OpenBSD unsigned native host tarballs only.
 * Browser remains the primary product path; this page is honest about limits.
 */
export default function Download(): JSX.Element {
  setPageMeta(
    'Download Onyx — FreeBSD & OpenBSD native hosts',
    'Download unsigned Onyx v0.1.3 FreeBSD and OpenBSD native host tarballs with install.sh. Not signed. GUI not claimed from the Linux build host. Browser and PWA remain the primary paths.',
    '/download/',
  );

  const [catalog] = createResource(loadCatalog);

  return (
    <main class="r data-page dl-page" data-testid="download-page">
      <div class="r-ground" aria-hidden="true" />
      <div class="r-flecks" aria-hidden="true" />
      <header class="r-status" role="banner">
        <a class="brand" href="/" aria-label="Onyx home">
          <span class="brand-mark" aria-hidden="true">
            <Mascot variant="mark" />
          </span>
          <span class="brand-wordmark" aria-hidden="true">ONYX</span>
        </a>
        <nav aria-label="Primary">
          <a href="/">Home</a>
          <a href="/download/" aria-current="page">Download</a>
          <a href="/roadmap/">Roadmap</a>
          <a class="enter" href="/app/">Open Onyx</a>
        </nav>
      </header>

      <section class="r-wrap data-hero" aria-labelledby="download-heading">
        <p class="r-kicker">v{DOWNLOAD_PRODUCT_VERSION} · unsigned native BSD</p>
        <h1 id="download-heading">FreeBSD &amp; OpenBSD hosts</h1>
        <p class="sub">
          One-install native packages for operators on FreeBSD and OpenBSD x86_64.
          Each tarball includes
          {' '}
          <code>bin/onyx</code>
          ,
          {' '}
          <code>resources/dist</code>
          , and an idempotent
          {' '}
          <code>install.sh</code>
          {' '}
          that can install the primary GTK4 + WebKitGTK runtime through the OS package manager.
          Artifacts are site-local under
          {' '}
          <code>/downloads/v{DOWNLOAD_PRODUCT_VERSION}/</code>
          .
        </p>
      </section>

      <section class="r-wrap r-section" aria-labelledby="honesty-heading">
        <h2 id="honesty-heading" class="dl-section-title">What this is — and is not</h2>
        <div class="dl-honesty data-card">
          <ul>
            <li>
              <strong>Is:</strong>
              {' '}
              Zig-native desktop host (not Native SDK), unsigned tar.gz, SHA-256 sidecar, honesty notice.
            </li>
            <li>
              <strong>Is not:</strong>
              {' '}
              codesigned, notarized, virus-scanned, store-packaged, or auto-updating.
            </li>
            <li>
              <strong>GUI launch</strong>
              {' '}
              is not claimed from the Linux release host — only ELF/package layout is validated there.
            </li>
            <li>
              <strong>Browser first:</strong>
              {' '}
              most people should
              {' '}
              <a href="/app/">Open Onyx</a>
              {' '}
              in a browser or install the PWA. Windows, macOS, and Linux native installers are separate lanes and not offered here as signed downloads.
            </li>
          </ul>
        </div>
      </section>

      <section class="r-wrap r-section dl-grid" aria-label="BSD download cards">
        <For each={[...BSD_DOWNLOAD_CARDS]}>
          {(card) => <LaneCard card={card} catalog={catalog()} />}
        </For>
      </section>

      <section class="r-wrap r-section">
        <div class="dl-verify data-card">
          <h2>Verify a download</h2>
          <pre class="dl-pre">{`# after download
sha256 -c onyx-${DOWNLOAD_PRODUCT_VERSION}-freebsd-x86_64-ReleaseFast-unsigned.sha256
# or: sha256sum -c …`}</pre>
          <p class="dl-note">
            Compare the hash on this page (when staged) with the
            {' '}
            <code>.sha256</code>
            {' '}
            file next to the tarball. Onyx does not claim third-party virus-free status or code signing for these artifacts.
          </p>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

export type { BsdDownloadLane };
