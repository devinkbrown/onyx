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
  checksumFromCatalog,
  installSteps,
  isMacosDownloadLane,
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
  if (ext === 'dmg') return 'Download DMG';
  return 'Download tar.gz';
}

function signingLabel(ext: DownloadCard['archiveExt']): string {
  if (ext === 'zip') return 'none — unsigned zip';
  if (ext === 'dmg') return 'none — unsigned, unnotarized DMG';
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
            {props.card.hasInstallScript ? 'Runtime (auto via install.sh)' : 'Runtime requirement'}
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
          <Show when={isMacosDownloadLane(props.card.lane)}>
            .app bundle (Contents/MacOS/onyx + system WKWebView) inside unsigned DMG
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
              <Show when={isMacosDownloadLane(props.card.lane)}>
                {' '}
                and
                {' '}
                <strong>unnotarized</strong>
              </Show>
              . Extract or mount and run from the package tree. Onyx does not claim
              codesign, notarization, virus-free status, or GUI launch verification for this lane.
              <Show when={props.card.lane === 'macos-x86_64'}>
                {' '}
                The DMG is built only on a genuine Darwin Intel runner (x86_64).
              </Show>
              <Show when={props.card.lane === 'macos-arm64'}>
                {' '}
                The DMG is built only on a genuine Darwin Apple Silicon runner (arm64).
              </Show>
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
 * Public /download — unsigned Windows/Linux/macOS/FreeBSD/OpenBSD native packages.
 * macOS DMGs are Darwin-built only (Intel + Apple Silicon). Browser remains primary.
 */
export default function Download(): JSX.Element {
  setPageMeta(
    'Download Onyx — unsigned native packages',
    'Download unsigned Onyx v0.1.3 Windows zip, Linux/FreeBSD/OpenBSD tar.gz, and macOS Intel + Apple Silicon DMG packages with SHA-256 sidecars. Not signed or notarized. Browser and PWA remain the primary paths.',
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
        <p class="r-kicker">v{DOWNLOAD_PRODUCT_VERSION} · unsigned native packages</p>
        <h1 id="download-heading">Windows, Linux, macOS, FreeBSD &amp; OpenBSD</h1>
        <p class="sub">
          Operator packages: Windows zip, Linux tar.gz, separate macOS Intel (x86_64) and
          Apple Silicon (arm64) DMGs (system WKWebView; unsigned/unnotarized; each built on
          genuine matching-arch Darwin), and FreeBSD/OpenBSD native hosts with
          {' '}
          <code>install.sh</code>
          . Every artifact is
          {' '}
          <strong>unsigned</strong>
          , carries a SHA-256 sidecar and honesty notice, and is site-local under
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
              unsigned zip/tar.gz/DMG packages with SHA-256 sidecars and honesty notices
              (Windows Native SDK zip; Linux Native SDK tar.gz; macOS Intel + Apple Silicon
              WKWebView DMGs; FreeBSD/OpenBSD Zig-native hosts with install.sh).
            </li>
            <li>
              <strong>Is not:</strong>
              {' '}
              codesigned, notarized, virus-scanned, store-packaged, auto-updating, or a signed
              multi-platform installer suite. Not a universal macOS binary — pick Intel or
              Apple Silicon.
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
              separate unsigned/unnotarized DMGs with system WKWebView for Intel x86_64 and
              Apple Silicon arm64, each produced only on a genuine matching-arch Darwin runner
              (GitHub-hosted macos-15-intel / macos-15 or a real Mac). Never fabricated on Linux.
            </li>
            <li>
              <strong>Browser first:</strong>
              {' '}
              most people should
              {' '}
              <a href="/app/">Open Onyx</a>
              {' '}
              in a browser or install the PWA.
            </li>
          </ul>
        </div>
      </section>

      <section class="r-wrap r-section dl-grid" aria-label="Native download cards">
        <For each={[...DOWNLOAD_CARDS]}>
          {(card) => <LaneCard card={card} catalog={catalog()} />}
        </For>
      </section>

      <section class="r-wrap r-section">
        <div class="dl-verify data-card">
          <h2>Verify a download</h2>
          <pre class="dl-pre">{`# after download (example: FreeBSD)
sha256 -c onyx-${DOWNLOAD_PRODUCT_VERSION}-freebsd-x86_64-ReleaseFast-unsigned.sha256
# Linux: sha256sum -c …
# macOS Intel: shasum -a 256 -c onyx-${DOWNLOAD_PRODUCT_VERSION}-macos-x86_64-ReleaseFast-unsigned.sha256
# macOS Apple Silicon: shasum -a 256 -c onyx-${DOWNLOAD_PRODUCT_VERSION}-macos-arm64-ReleaseFast-unsigned.sha256
# Windows (PowerShell): Get-FileHash .\\onyx-…-unsigned.zip -Algorithm SHA256`}</pre>
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
