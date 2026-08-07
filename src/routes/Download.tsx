// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import { For, Show, createResource, createSignal, type JSX } from 'solid-js';
import { Mascot } from '@/components/brand/Mascot';
import { PublicFooter } from './PublicFooter';
import { setPageMeta } from './pageMeta';
import {
  DOWNLOAD_CARDS,
  DOWNLOAD_CATALOG_URL,
  DOWNLOAD_PRODUCT_VERSION,
  MACOS_COMING_SOON,
  checksumFromCatalog,
  installSteps,
  parseSha256SumText,
  type DownloadCard,
  type DownloadCatalog,
  type DownloadLane,
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

function archiveButtonLabel(ext: DownloadCard['archiveExt']): string {
  if (ext === 'zip') return 'Download zip';
  return 'Download tar.gz';
}

function signingLabel(ext: DownloadCard['archiveExt']): string {
  if (ext === 'zip') return 'none — unsigned zip';
  return 'none — unsigned tarball';
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
  card: DownloadCard;
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
          <strong>
            {props.card.runtimeIncluded
              ? 'Runtime included'
              : props.card.hasInstallScript
                ? 'Runtime (auto via install.sh)'
                : 'Runtime requirement'}
          </strong>
          {' '}
          {props.card.primaryPackages.join(' + ')}
        </li>
        <li>
          <strong>Layout</strong>
          {' '}
          <Show when={props.card.lane === 'windows'}>
            package root bin/onyx.exe + WebView2Loader.dll + resources
          </Show>
          <Show when={props.card.lane === 'linux'}>
            package root bin/onyx + resources/dist
          </Show>
          <Show when={props.card.hasInstallScript}>
            PREFIX/bin/onyx + PREFIX/resources (default PREFIX=/usr/local)
          </Show>
        </li>
        <li>
          <strong>Signing</strong>
          {' '}
          {signingLabel(props.card.archiveExt)}
        </li>
      </ul>
      <div class="dl-actions">
        <a
          class="r-btn primary"
          data-testid={`dl-download-${props.card.lane}`}
          href={props.card.archiveUrl}
          download={props.card.archiveName}
        >
          {archiveButtonLabel(props.card.archiveExt)}
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
        <h3>
          {props.card.hasInstallScript
            ? `Install on ${props.card.osLabel}`
            : `Use on ${props.card.osLabel}`}
        </h3>
        <pre class="dl-pre" data-testid={`dl-install-${props.card.lane}`}>{steps()}</pre>
        <CopyButton
          label={props.card.hasInstallScript ? 'Copy install steps' : 'Copy steps'}
          value={steps()}
          testId={`dl-copy-install-${props.card.lane}`}
        />
        <Show
          when={props.card.hasInstallScript}
          fallback={(
            <p class="dl-note">
              This package is
              {' '}
              <strong>unsigned</strong>
              . Extract and run from the package tree. Onyx does not claim
              codesign, notarization, virus-free status, or GUI launch verification for this lane.
            </p>
          )}
        >
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
        </Show>
      </div>
    </article>
  );
}

/**
 * Combined macOS Intel + Apple Silicon card: polished coming-soon, no dead downloads.
 * Uniform mineral controls — primary path is browser / PWA.
 */
function MacosComingSoonCard(): JSX.Element {
  const mac = MACOS_COMING_SOON;
  return (
    <article
      class="dl-card data-card dl-card--soon"
      data-testid="dl-card-macos"
      data-state="coming-soon"
    >
      <div class="dl-card-head">
        <span class="label">{mac.osLabel}</span>
        <span class="dl-status" data-testid="dl-macos-status">{mac.statusLabel}</span>
      </div>
      <h2>{mac.title}</h2>
      <p>{mac.summary}</p>
      <ul class="dl-facts">
        <li>
          <strong>Runtime (planned)</strong>
          {' '}
          {mac.runtime}
        </li>
        <li>
          <strong>Package (planned)</strong>
          {' '}
          {mac.plannedPackage}
        </li>
        <li>
          <strong>Status</strong>
          {' '}
          No public DMG, SHA-256 sidecar, or honesty notice is linked until genuine Darwin builds ship.
        </li>
      </ul>
      <div class="dl-soon-arches" data-testid="dl-macos-arches" aria-label="Planned macOS architectures">
        <For each={[...mac.arches]}>
          {(arch) => (
            <div class="dl-soon-arch" data-testid={`dl-macos-arch-${arch.arch}`}>
              <strong>{arch.label}</strong>
              <span>{arch.note}</span>
            </div>
          )}
        </For>
      </div>
      <div class="dl-actions">
        <a
          class="r-btn primary"
          data-testid="dl-macos-open-app"
          href="/app/"
        >
          Open Onyx in browser
        </a>
      </div>
      <p class="dl-note" data-testid="dl-macos-honesty">
        {mac.honesty}
        {' '}
        Supporting browsers can install Onyx as a PWA from the app shell — same rooms, messages, and calls without a native package.
      </p>
    </article>
  );
}

/**
 * Public /download — unsigned Windows/Linux/FreeBSD/OpenBSD native packages.
 * macOS Intel + Apple Silicon: combined coming-soon (no fake DMG controls). Browser remains primary.
 */
export default function Download(): JSX.Element {
  const installGuide = typeof window !== 'undefined'
    && /^\/install(?:\/|$)/.test(window.location.pathname);
  setPageMeta(
    installGuide
      ? 'Install Onyx — native packages and browser app'
      : 'Download Onyx — unsigned native packages',
    installGuide
      ? 'Install Onyx from the browser or use unsigned Windows, Linux, FreeBSD, and OpenBSD packages with runtimes, install steps, and SHA-256 verification.'
      : 'Download unsigned Onyx v0.1.3 Windows zip and Linux/FreeBSD/OpenBSD tar.gz packages with SHA-256 sidecars. macOS Intel and Apple Silicon native packages are coming soon. Not signed or notarized. Browser and PWA remain the primary paths.',
    installGuide ? '/install/' : '/download/',
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
        <p class="r-kicker">
          {installGuide ? 'Install guide' : `v${DOWNLOAD_PRODUCT_VERSION} · unsigned native packages`}
        </p>
        <h1 id="download-heading">
          {installGuide ? 'Install Onyx' : 'Windows, Linux, FreeBSD & OpenBSD'}
        </h1>
        <p class="sub">
          Operator packages now: Windows zip, Linux tar.gz, and FreeBSD/OpenBSD hosts with
          {' '}
          <code>install.sh</code>
          . Every published artifact is
          {' '}
          <strong>unsigned</strong>
          , carries a SHA-256 sidecar and honesty notice, and is site-local under
          {' '}
          <code>/downloads/v{DOWNLOAD_PRODUCT_VERSION}/</code>
          .
          {' '}
          <strong>macOS</strong>
          {' '}
          Intel and Apple Silicon native packages are
          {' '}
          <strong>coming soon</strong>
          {' '}
          (built on real Macs only — never fabricated here). Until then, use the browser or PWA.
        </p>
      </section>

      <section class="r-wrap r-section" aria-labelledby="honesty-heading">
        <h2 id="honesty-heading" class="dl-section-title">What this is — and is not</h2>
        <div class="dl-honesty data-card">
          <ul>
            <li>
              <strong>Is:</strong>
              {' '}
              unsigned zip/tar.gz packages with SHA-256 sidecars and honesty notices
              (Windows Native SDK zip; Linux Native SDK tar.gz; FreeBSD/OpenBSD Zig-native hosts
              with install.sh).
            </li>
            <li>
              <strong>Is not:</strong>
              {' '}
              codesigned, notarized, virus-scanned, store-packaged, auto-updating, or a signed
              multi-platform installer suite. macOS DMGs are not published yet — no fake download
              buttons.
            </li>
            <li>
              <strong>Runtime / GUI launch</strong>
              {' '}
              is not claimed from the Linux release host — package layout and checksums only.
              Windows runtime is not verified on real Windows here.
            </li>
            <li>
              <strong>macOS:</strong>
              {' '}
              Intel x86_64 and Apple Silicon arm64 native WKWebView packages are planned as separate
              arch lanes, produced only on genuine matching-arch Darwin. Until they ship, there is
              no DMG, sidecar, or install path on this page.
            </li>
            <li>
              <strong>Browser first:</strong>
              {' '}
              most people should
              {' '}
              <a href="/app/">Open Onyx</a>
              {' '}
              in a browser or install the PWA — including on Mac today.
            </li>
          </ul>
        </div>
      </section>

      <section class="r-wrap r-section dl-grid" aria-label="Native download cards">
        <For each={[...DOWNLOAD_CARDS]}>
          {(card) => <LaneCard card={card} catalog={catalog()} />}
        </For>
        <MacosComingSoonCard />
      </section>

      <section class="r-wrap r-section">
        <div class="dl-verify data-card">
          <h2>Verify a download</h2>
          <pre class="dl-pre">{`# after download (example: FreeBSD)
sha256 -c onyx-${DOWNLOAD_PRODUCT_VERSION}-freebsd-x86_64-ReleaseFast-unsigned.sha256
# Linux: sha256sum -c …
# Windows (PowerShell): Get-FileHash .\\onyx-…-unsigned.zip -Algorithm SHA256
# macOS native packages: not published yet — no .sha256 sidecar to check`}</pre>
          <p class="dl-note">
            Compare the hash on this page (when staged) with the
            {' '}
            <code>.sha256</code>
            {' '}
            file next to the archive. Onyx does not claim third-party virus-free status or code
            signing for these artifacts.
          </p>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

export type { DownloadLane };
