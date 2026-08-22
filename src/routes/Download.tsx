// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './data-pages.css';
import './download.css';
import { For, Show, createResource, createSignal, type JSX } from 'solid-js';
import { PublicFrame } from '@/ui/public';
import { setPageMeta } from './pageMeta';
import {
  DOWNLOAD_CARDS,
  DOWNLOAD_CATALOG_URL,
  DOWNLOAD_PRODUCT_VERSION,
  MACOS_COMING_SOON,
  checksumFromCatalog,
  downloadAvailability,
  installSteps,
  parseSha256SumText,
  type DownloadCard,
  type DownloadCatalog,
  type DownloadCatalogLoadState,
  type DownloadLane,
} from './downloadMeta';

async function loadCatalog(): Promise<DownloadCatalog> {
  const res = await fetch(DOWNLOAD_CATALOG_URL, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Download catalog request failed (${res.status})`);

  const value: unknown = await res.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Download catalog has an invalid JSON shape');
  }
  const catalog = value as DownloadCatalog;
  if (catalog.lanes !== undefined && !Array.isArray(catalog.lanes)) {
    throw new Error('Download catalog lanes are invalid');
  }
  return catalog;
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
      aria-live="polite"
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
  catalog: () => DownloadCatalog | undefined;
  catalogState: () => DownloadCatalogLoadState;
}): JSX.Element {
  const availability = () => downloadAvailability(
    props.catalog(),
    props.catalogState(),
    props.card.lane,
  );
  const [shaFromFile] = createResource(
    () => availability() === 'available' ? props.card.sha256Url : undefined,
    (url) => loadSha256(url),
  );
  const hash = () =>
    shaFromFile() ?? checksumFromCatalog(props.catalog() ?? null, props.card.lane) ?? null;
  const steps = () => installSteps(props.card.lane).join('\n');
  const availabilityLabel = () => {
    switch (availability()) {
      case 'loading': return 'Checking availability';
      case 'available': return 'Available';
      case 'unavailable': return 'Unavailable';
      case 'unknown': return 'Availability unknown';
    }
  };

  return (
    <article
      class="dl-card data-card"
      data-testid={`dl-card-${props.card.lane}`}
      data-state={availability()}
    >
      <div class="dl-card-head">
        <span class="label">{props.card.osLabel}</span>
        <span
          class="dl-status"
          data-testid={`dl-status-${props.card.lane}`}
          data-state={availability()}
          role="status"
        >
          {availabilityLabel()}
        </span>
      </div>
      <h3>{props.card.title}</h3>
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
        <Show
          when={availability() === 'available'}
          fallback={(
            <p class="dl-checksum-missing" role="status">
              {availability() === 'loading'
                ? 'Checking the staged catalog before showing download controls.'
                : availability() === 'unavailable'
                  ? 'This native artifact is not published for this lane. Archive, notice, and checksum links are withheld.'
                  : 'Artifact availability could not be confirmed. Download controls are withheld until the catalog is available.'}
            </p>
          )}
        >
          <a
            class="r-btn primary"
            data-testid={`dl-download-${props.card.lane}`}
            href={props.card.archiveUrl}
            download={props.card.archiveName}
          >
            {archiveButtonLabel(props.card.archiveExt)}
          </a>
          <a
            class="r-btn ghost"
            data-testid={`dl-notice-${props.card.lane}`}
            href={props.card.noticeUrl}
          >
            Honesty notice
          </a>
          <a
            class="r-btn ghost"
            data-testid={`dl-sha256-${props.card.lane}`}
            href={props.card.sha256Url}
          >
            SHA-256 file
          </a>
        </Show>
      </div>
      <div class="dl-checksum" data-testid={`dl-checksum-${props.card.lane}`}>
        <span class="dl-checksum-label">SHA-256</span>
        <Show when={availability() === 'available'} fallback={(
          <p class="dl-checksum-missing">
            {availability() === 'loading'
              ? 'Checksum will be checked after artifact availability is resolved.'
              : availability() === 'unavailable'
                ? 'No checksum is published because this artifact is unavailable.'
                : 'Checksum is unavailable because artifact availability could not be confirmed.'}
          </p>
        )}>
          <Show
            when={hash()}
            fallback={(
              <p class="dl-checksum-missing">
                {shaFromFile.state === 'pending' || shaFromFile.state === 'refreshing'
                  ? 'Loading the published SHA-256 sidecar.'
                  : 'The archive is published, but its SHA-256 sidecar is not currently available.'}
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
        </Show>
      </div>
      <div class="dl-install">
        <h4>
          {props.card.hasInstallScript
            ? `Install on ${props.card.osLabel}`
            : `Use on ${props.card.osLabel}`}
        </h4>
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
      <h3>{mac.title}</h3>
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
      <ul class="dl-soon-arches" data-testid="dl-macos-arches" aria-label="Planned macOS architectures">
        <For each={[...mac.arches]}>
          {(arch) => (
            <li class="dl-soon-arch" data-testid={`dl-macos-arch-${arch.arch}`}>
              <strong>{arch.label}</strong>
              <span>{arch.note}</span>
            </li>
          )}
        </For>
      </ul>
      <div class="dl-actions">
        <a
          class="r-btn ghost"
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
 * Public /download — browser and PWA first; unsigned native packages below.
 * macOS Intel + Apple Silicon: combined coming-soon (no fake DMG controls).
 */
export default function Download(): JSX.Element {
  const installGuide = typeof window !== 'undefined'
    && /^\/install(?:\/|$)/.test(window.location.pathname);
  setPageMeta(
    installGuide
      ? 'Install Onyx on this device — browser first'
      : 'Get Onyx on this device — browser first',
    installGuide
      ? 'Install Onyx in your browser, or keep it on this device. Desktop packages are optional and unsigned. macOS native packages are coming soon.'
      : 'Get Onyx on this device in your browser. Keep it here from a supporting browser. Desktop packages are optional and unsigned. macOS native packages are coming soon.',
    installGuide ? '/install/' : '/download/',
  );

  const [catalog] = createResource(loadCatalog);
  const catalogValue = () => catalog.state === 'ready' ? catalog() : undefined;
  const catalogState = (): DownloadCatalogLoadState => {
    if (catalog.state === 'errored') return 'errored';
    if (catalog.state === 'ready') return 'ready';
    return 'loading';
  };
  const catalogReceipt = () => {
    switch (catalogState()) {
      case 'ready': return 'Catalog read. Each lane still has to report a published artifact before controls appear.';
      case 'errored': return 'Catalog unavailable. Archive, notice, and checksum controls are withheld.';
      default: return 'Checking the staged catalog. Download controls remain withheld.';
    }
  };

  return (
    <PublicFrame
      currentPath="/download/"
      mainLabel="Get Onyx"
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">This device</span>
          <span aria-hidden="true">·</span>
          <span class="public-frame__current-label">Browser first</span>
        </p>
      )}
    >
      <div class="ui-root r data-page dl-page" data-testid="download-page">
        <div class="r-ground" aria-hidden="true" />
        <div class="r-grain" aria-hidden="true" />

        <section class="r-wrap data-hero dl-hero" aria-labelledby="download-heading">
          <p class="dl-kicker">{installGuide ? 'Install guide' : 'This device'}</p>
          <h1 id="download-heading">
            {installGuide ? 'Install Onyx on this device' : 'Get Onyx on this device'}
          </h1>
          <p class="serif-pull">Open it in the browser. That is the main door.</p>
          <p class="sub">
            Supporting browsers can keep Onyx here as an installed app — same rooms,
            messages, and calls. Desktop packages exist if you want them. They stay
            further down this page, unsigned and honest.
          </p>
          <div class="dl-cta">
            <a class="r-btn primary" href="/app/" data-testid="dl-open-browser">
              Open Onyx in the browser
            </a>
            <a class="r-btn ghost" href="#keep-here">
              Keep it on this device
            </a>
          </div>
        </section>

        <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

        <section id="keep-here" class="r-wrap r-section" aria-labelledby="browser-heading">
          <h2 id="browser-heading" class="dl-section-title">Keep Onyx on this device</h2>
          <div class="dl-browser data-card">
            <p>
              Open Onyx, then use your browser&apos;s
              {' '}
              <strong>Install app</strong>
              {' '}
              or
              {' '}
              <strong>Add to Home Screen</strong>
              {' '}
              control. You get the same rooms, people, and calls — no store badge required.
            </p>
            <p>
              Safari on iPhone uses Add to Home Screen. Chrome, Edge, and other
              supporting browsers offer an install prompt once the app is open.
            </p>
            <a class="r-btn primary" href="/app/">Join in the browser</a>
          </div>
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
                <a href="/app/">open the browser app</a>
                {' '}
                or install the PWA — including on Mac today.
              </li>
            </ul>
          </div>
        </section>

        <section class="r-wrap r-section" aria-labelledby="download-lanes-heading">
          <h2 id="download-lanes-heading" class="dl-section-title">Desktop packages</h2>
          <p class="dl-below-fold">
            Optional native builds for Windows, Linux, FreeBSD, and OpenBSD.
            Every published artifact is unsigned. macOS Intel and Apple Silicon
            packages are coming soon — built on real Macs only, never fabricated here.
          </p>
          <div
            class="dl-catalog-receipt"
            data-catalog-state={catalogState()}
            role="status"
            aria-label="Download catalog status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span class="dl-catalog-receipt__marker" aria-hidden="true" />
            <span>{catalogReceipt()}</span>
          </div>
          <div class="dl-grid" aria-label="Native download cards">
            <For each={[...DOWNLOAD_CARDS]}>
              {(card) => (
                <LaneCard card={card} catalog={catalogValue} catalogState={catalogState} />
              )}
            </For>
            <MacosComingSoonCard />
          </div>
        </section>

        <section class="r-wrap r-section" aria-labelledby="verify-heading">
          <div class="dl-verify data-card">
            <h2 id="verify-heading">Verify a download</h2>
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
      </div>
    </PublicFrame>
  );
}

export type { DownloadLane };
