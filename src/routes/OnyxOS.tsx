// SPDX-License-Identifier: AGPL-3.0-or-later
import { For, createMemo, createSignal } from 'solid-js';
import { setPageMeta } from './pageMeta';
import { PublicFooter } from './PublicFooter';
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

export default function OnyxOS() {
  setPageMeta(
    'OnyxOS + Onyx — communication at home in the system',
    'See how Onyx is becoming a first-class native OnyxOS experience while staying cross-platform, backed by evidence-led system engineering.',
    '/onyxos/',
  );

  const [selected, setSelected] = createSignal<Stage['id']>('oracle');
  const active = createMemo<Stage>(() => stages.find((stage) => stage.id === selected()) ?? stages[0]!);

  return (
    <main class="onyxos-page">
      <div class="onyxos-grid" aria-hidden="true" />
      <header class="onyxos-nav">
        <a class="onyxos-wordmark" href="/" aria-label="Onyx home">ONYX<span>OS</span></a>
        <nav aria-label="OnyxOS navigation">
          <a href="#onyx-native">Onyx</a>
          <a href="#method">Method</a>
          <a href="#workbench">Workbench</a>
          <a class="onyxos-nav__open" href="/app/">Open Onyx</a>
        </nav>
      </header>

      <section class="onyxos-hero" aria-labelledby="onyxos-title">
        <p class="onyxos-eyebrow">Onyx + OnyxOS · one product family</p>
        <h1 id="onyxos-title">Communication,<br /><em>at home in the system.</em></h1>
        <p class="onyxos-lede">Onyx is being designed as a first-class native experience in OnyxOS—identity, notifications, protected local history, calls, and accessibility working with the operating system instead of sitting on top of it.</p>
        <div class="onyxos-hero__actions">
          <a class="onyxos-button onyxos-button--primary" href="/app/">Open Onyx now <span aria-hidden="true">→</span></a>
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
                type="button"
                role="tab"
                aria-selected={selected() === stage.id}
                classList={{ 'is-active': selected() === stage.id }}
                onClick={() => setSelected(stage.id)}
              >
                <span>{stage.label}</span>
                <small>{stage.signal}</small>
              </button>
            )}</For>
          </div>
          <article class="onyxos-console__body" role="tabpanel" tabindex="0">
            <p class="onyxos-console__signal">{active().signal}</p>
            <h3>{active().title}</h3>
            <p>{active().body}</p>
            <ul>
              <For each={active().checks}>{(check) => <li><span aria-hidden="true">↳</span>{check}</li>}</For>
            </ul>
          </article>
        </div>
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
      <PublicFooter />
    </main>
  );
}
