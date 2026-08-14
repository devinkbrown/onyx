// SPDX-License-Identifier: AGPL-3.0-or-later
import { For, createMemo, createSignal } from 'solid-js';
import { PublicFrame } from '@/ui/public';
import { setPageMeta } from './pageMeta';
import './onyxos.css';

type Stage = {
  id: 'oracle' | 'implementation' | 'gate' | 'boot';
  label: string;
  signal: string;
  title: string;
  body: string;
  checks: readonly string[];
};

const stages: readonly Stage[] = [
  {
    id: 'oracle',
    label: '01 · Oracle',
    signal: 'native behavior first',
    title: 'Read the machine that already works.',
    body: 'Compatibility begins with a named Windows behavior and its exact binary evidence—not a guessed API shape. The point is to preserve contracts that programs can actually observe.',
    checks: ['Targeted function recovery', 'Binary identity recorded', 'ABI and lifecycle reviewed'],
  },
  {
    id: 'implementation',
    label: '02 · Clean room',
    signal: 'source with provenance',
    title: 'Write only what the evidence can support.',
    body: 'OnyxOS implementations stay source-owned and clean-room. Each new behavior is wired deliberately into the product graph instead of being left as a convincing but unreachable draft.',
    checks: ['One source owner', 'Meson graph wiring', 'No invented private protocol'],
  },
  {
    id: 'gate',
    label: '03 · Gate',
    signal: 'links or it is not done',
    title: 'A green report is not a shipped binary.',
    body: 'The compatibility gate is a real target link. It rejects a wave that merely looks complete on paper and keeps implementation, wiring, and exported behavior accountable to the same build.',
    checks: ['Deterministic source manifest', 'Strict target link', 'No skipped integration step'],
  },
  {
    id: 'boot',
    label: '04 · Boot',
    signal: 'the guest is the witness',
    title: 'Let the operating system answer back.',
    body: 'A real boot is the final conversation: firmware, kernel, services, logon, and applications expose the seams that static analysis cannot. Failures become the next evidence-backed slice.',
    checks: ['Instrumented boot path', 'Guest fault classification', 'Evidence feeds the next wave'],
  },
];

const sourcePreview = `NTSTATUS
NTAPI
OnyxSaferWriteEventLogEntry(
    _In_ ULONG NtStatusCode,
    _In_opt_ PCWSTR TargetPath,
    _In_opt_ const GUID *LevelGuid,
    _In_opt_ PVOID Extra)
{
    EVENT_DATA_DESCRIPTOR Data[3] = {{0}};
    PCEVENT_DESCRIPTOR Descriptor;
    ULONG Count;
    NTSTATUS Status = STATUS_SUCCESS;

    OnyxSaferEnterCs();
    if (OnyxSaferEtwRegHandle == 0)
        Status = (NTSTATUS)EtwEventRegister(&OnyxSaferEtwProviderGuid, NULL,
                                            NULL, &OnyxSaferEtwRegHandle);
    OnyxSaferLeaveCs();`;

/** Stable tabpanel id, referenced by every stage tab's `aria-controls`. */
const METHOD_PANEL_ID = 'onyxos-method-panel';
/** Stable per-tab id so the panel can name its selected tab. */
const methodTabId = (stage: Stage['id']): string => `onyxos-method-tab-${stage}`;

export default function OnyxOS() {
  setPageMeta(
    'OnyxOS + Onyx — communication at home in the system',
    'See how Onyx is becoming a first-class native OnyxOS experience while staying cross-platform, backed by evidence-led system engineering.',
    '/onyxos/',
  );

  const [selected, setSelected] = createSignal<Stage['id']>('oracle');
  const active = createMemo<Stage>(() => stages.find((stage) => stage.id === selected()) ?? stages[0]!);
  const tabs = new Map<Stage['id'], HTMLButtonElement>();

  /** Follows the tabs pattern: arrow/Home/End move selection *and* focus. */
  const selectAndFocus = (stage: Stage['id']): void => {
    setSelected(stage);
    tabs.get(stage)?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent): void => {
    const index = stages.findIndex((stage) => stage.id === selected());
    if (index < 0) return;

    let next: Stage | undefined;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = stages[(index + 1) % stages.length];
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = stages[(index - 1 + stages.length) % stages.length];
        break;
      case 'Home':
        next = stages[0];
        break;
      case 'End':
        next = stages[stages.length - 1];
        break;
      default:
        return;
    }

    if (!next) return;
    event.preventDefault();
    selectAndFocus(next.id);
  };

  return (
    <PublicFrame
      currentPath="/onyxos/"
      mainLabel="OnyxOS and Onyx"
      context={(
        <p class="public-frame__current-line">
          <span class="public-frame__current-kicker">Native work</span>
          <span aria-hidden="true">·</span>
          <span class="public-frame__current-label">Evidence-led system engineering</span>
        </p>
      )}
    >
      <div class="onyxos-page">
        <div class="onyxos-grid" aria-hidden="true" />

        <nav class="onyxos-sections" aria-label="OnyxOS sections">
          <a href="#onyx-native">Onyx</a>
          <a href="#method">Method</a>
          <a href="#source">Source</a>
          <a href="#workbench">Workbench</a>
        </nav>

        <section class="onyxos-hero" aria-labelledby="onyxos-title">
          <p class="onyxos-eyebrow">Onyx + OnyxOS · one product family</p>
          <h1 id="onyxos-title">Communication,<br /><em>at home in the system.</em></h1>
          <p class="onyxos-lede">Onyx is being designed as a first-class native experience in OnyxOS—identity, notifications, protected local history, calls, and accessibility working with the operating system instead of sitting on top of it.</p>
          <div class="onyxos-hero__actions">
            <a class="onyxos-button" href="/app/">Use Onyx in browser <span aria-hidden="true">→</span></a>
            <a class="onyxos-button" href="#onyx-native">See the native plan</a>
          </div>
          <p class="onyxos-proof" role="note"><span aria-hidden="true">◆</span> Onyx stays cross-platform. OnyxOS makes it exceptional.</p>
        </section>

        <section class="onyxos-native" id="onyx-native" aria-labelledby="onyxos-native-title">
          <div class="onyxos-section-heading">
            <p class="onyxos-eyebrow">the native communication layer</p>
            <h2 id="onyxos-native-title">The same Onyx. Deeper system roots.</h2>
            <p>Every native enhancement keeps a web fallback and an explicit permission boundary. OnyxOS is the flagship home, not a lock-in requirement.</p>
          </div>
          <div class="onyxos-native__grid">
            <article><span>01</span><h3>Identity</h3><p>System-protected credentials, device continuity, and recovery without inventing a second account.</p></article>
            <article><span>02</span><h3>Attention</h3><p>Native notifications, quiet modes, call surfaces, and catch-up that respect system focus.</p></article>
            <article><span>03</span><h3>Memory</h3><p>An OS-protected local vault, deliberate backup policy, fast search, and portable export.</p></article>
            <article><span>04</span><h3>Media</h3><p>System device routing, screen sharing, captions, and the exact protection state shown in every call.</p></article>
          </div>
        </section>

        <section class="onyxos-method" id="method" aria-labelledby="onyxos-method-title">
          <div class="onyxos-section-heading">
            <p class="onyxos-eyebrow">the method</p>
            <h2 id="onyxos-method-title">Choose a signal. Follow it all the way through.</h2>
          </div>
          <div class="onyxos-console" aria-label="OnyxOS compatibility method explorer">
            <div class="onyxos-console__tabs" role="tablist" aria-label="Compatibility stages">
              <For each={stages}>{(stage) => (
                <button
                  ref={(element) => tabs.set(stage.id, element)}
                  type="button"
                  role="tab"
                  id={methodTabId(stage.id)}
                  aria-selected={selected() === stage.id}
                  aria-controls={METHOD_PANEL_ID}
                  tabindex={selected() === stage.id ? 0 : -1}
                  classList={{ 'is-active': selected() === stage.id }}
                  onClick={() => setSelected(stage.id)}
                  onKeyDown={onTabKeyDown}
                >
                  <span>{stage.label}</span>
                  <small>{stage.signal}</small>
                </button>
              )}</For>
            </div>
            <article
              class="onyxos-console__body"
              id={METHOD_PANEL_ID}
              role="tabpanel"
              aria-labelledby={methodTabId(selected())}
              tabindex="0"
            >
              <p class="onyxos-console__signal">{active().signal}</p>
              <h3>{active().title}</h3>
              <p>{active().body}</p>
              <ul>
                <For each={active().checks}>{(check) => <li><span aria-hidden="true">↳</span>{check}</li>}</For>
              </ul>
            </article>
          </div>
        </section>

        <section class="onyxos-source" id="source" aria-labelledby="onyxos-source-title">
          <div class="onyxos-source__intro">
            <p class="onyxos-eyebrow">source specimen · advapi32</p>
            <h2 id="onyxos-source-title">This is real OnyxOS code.</h2>
            <p>The full 290-line clean-room implementation is published exactly as it builds in the working tree. It reconstructs the Windows 11 Safer event-log path, including ETW registration, descriptor selection, buffer sizing, and failure propagation.</p>
            <dl class="onyxos-source__facts">
              <div><dt>Language</dt><dd>C</dd></div>
              <div><dt>Subsystem</dt><dd>Advapi32 · Safer</dd></div>
              <div><dt>Status</dt><dd>Active integration</dd></div>
            </dl>
            <a class="onyxos-button onyxos-button--primary" href="/source/onyxos/safer_record_event_log_entry.c">Open the full source <span aria-hidden="true">→</span></a>
          </div>
          <figure class="onyxos-source__sheet">
            <figcaption><span>safer_record_event_log_entry.c</span><span>excerpt</span></figcaption>
            <pre tabindex="0"><code>{sourcePreview}</code></pre>
          </figure>
        </section>

        <section class="onyxos-workbench" id="workbench" aria-labelledby="onyxos-workbench-title">
          <div>
            <p class="onyxos-eyebrow">the public workbench</p>
            <h2 id="onyxos-workbench-title">A site should be as inspectable as the system it describes.</h2>
            <p>This page is statically delivered, route-aware, and designed to remain useful before any JavaScript loads. The local workbench keeps preview, quality gates, and production deployment separate on purpose.</p>
          </div>
          <div class="onyxos-command" aria-label="Local website commands">
            <p><span>$</span> pnpm site:workbench</p>
            <p class="onyxos-command__muted">interactive local preview · quality gates · deploy-plan inspection</p>
            <p><span>$</span> pnpm site:check</p>
            <p class="onyxos-command__muted">typecheck · lint · tests · production build to dist/</p>
          </div>
        </section>

        <section class="onyxos-close" aria-labelledby="onyxos-close-title">
          <p class="onyxos-eyebrow">one product, every platform</p>
          <h2 id="onyxos-close-title">Use Onyx now.<br />Meet its native home.</h2>
          <a class="onyxos-button onyxos-button--primary" href="/roadmap/">See the product roadmap <span aria-hidden="true">→</span></a>
        </section>
      </div>
    </PublicFrame>
  );
}
