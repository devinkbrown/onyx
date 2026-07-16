// SPDX-License-Identifier: AGPL-3.0-or-later
import './landing.css';
import './about.css';
import { createMemo, createResource, createSignal, onCleanup } from 'solid-js';
import { Mascot } from '@/components/brand/Mascot';
import { fetchNetworkStatus, publicMeshFeedLabel, publicMeshFeedState } from '@/lib/stats/status';
import { AccessibilityStatement } from '@/shell/AccessibilityStatement';
import { setPageMeta } from './pageMeta';

/**
 * Onyx /about — full editorial deep-dive.
 * Deep-water dark-luxury identity; depth, azure currents,
 * bioluminescent crests. Continuous with landing.
 *
 * Technical claims grounded in:
 *   docs/planning/20-media-interop.md
 *   docs/architecture/03-media.md
 *   docs/reference/commands/media.md
 *   docs/planning/09-s2s-protocol.md
 *   docs/architecture/00-overview.md
 */
export default function About() {
  setPageMeta(
    'About Onyx — open protocol, sovereign mesh',
    'Learn how Onyx, Suimyaku media, and the open mesh work together without closed-platform lock-in.',
    '/about/',
  );
  const [status, { refetch }] = createResource(fetchNetworkStatus, { initialValue: null });
  const [nowMs, setNowMs] = createSignal(Date.now());
  const refreshTimer = setInterval(() => {
    setNowMs(Date.now());
    void refetch();
  }, 30_000);
  onCleanup(() => clearInterval(refreshTimer));
  const feedState = createMemo(() => publicMeshFeedState(status.latest, nowMs()));
  return (
    <main class="r ab-ocean">
      {/* ── Living atmosphere (shared with landing, blue-tinted here) ── */}
      <div class="r-ground" aria-hidden="true" />
      <div class="r-flecks" aria-hidden="true" />
      <svg
        class="r-veins"
        viewBox="0 0 1440 900"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path class="flow" d="M-40 140 C 300 60, 440 300, 740 240 S 1200 130, 1520 250" />
        <path class="flow" d="M-40 560 C 340 650, 580 420, 880 530 S 1260 660, 1540 570" />
        <path d="M-40 780 C 380 710, 720 870, 1060 770 S 1340 710, 1540 820" />
        <circle class="node" cx="740" cy="240" r="3" />
        <circle class="node" cx="880" cy="530" r="3" />
        <circle class="node" cx="1060" cy="770" r="2.5" />
      </svg>
      <div class="r-grain" aria-hidden="true" />

      {/* ── Top status bar ── */}
      <header class="r-status" role="banner">
        <a class="brand" href="/" aria-label="Onyx home">
          <Mascot variant="mark" aria-label="Onyx" />ONYX
        </a>
        <nav aria-label="About page navigation">
          <a class="hideable" href="/">Home</a>
          <a class="hideable" href="#protocol">Protocol</a>
          <a class="hideable" href="#media">Media</a>
          <a class="hideable" href="#mesh">Mesh</a>
          <a class="hideable" href="#accessibility">Accessibility</a>
          <span class="live hideable" data-feed-state={feedState()}>
            <i aria-hidden="true" />{publicMeshFeedLabel(feedState())}
          </span>
          <a class="enter" href="/app/">Open Onyx</a>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section class="r-wrap ab-hero" aria-labelledby="about-hero-heading">
        <p class="r-kicker">how onyx works</p>
        <h1 id="about-hero-heading">
          Open wire,<br />
          <span class="gold">no ceilings</span>
        </h1>
        <p class="serif-pull">
          A protocol you can read.<br />
          A mesh that <em>belongs to no one</em>.<br />
          A server that never sees your voice.
        </p>
        <div class="ab-seam" aria-hidden="true" />
        <p class="sub">
          Onyx is the window. The window matters — but the point is everything behind
          it. This page is the underneath: the protocol, the media model, the
          cryptography, the mesh, and what each one means for the people who live here
          and the developers who build on it.
        </p>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── 1. The Protocol ── */}
      <section id="protocol" class="r-wrap ab-section" aria-labelledby="protocol-heading">
        <span class="r-eyebrow">01 — the protocol</span>
        <h2 id="protocol-heading" class="r-title">Open wire,<br />bring any client</h2>
        <p class="r-lede">
          IRCv3 + IRCX over a plain WebSocket. No SDK required. The wire format is
          documented, interoperable, and open to any tool that speaks the protocol.
        </p>

        <div class="ab-proto-grid">
          <article class="ab-proto-item">
            <span class="label">Authentication</span>
            <h3>SASL, your way</h3>
            <p>
              Orochi advertises <b>SASL PLAIN, EXTERNAL, and SCRAM-SHA-256</b>.
              Pick whatever your client supports — SCRAM is preferred when the server
              offers it. No proprietary handshake, nothing bespoke.
            </p>
            <span class="tag">sasl · scram-sha-256 · ircv3</span>
          </article>

          <article class="ab-proto-item">
            <span class="label">Session resilience</span>
            <h3>Session-token resume</h3>
            <p>
              After authentication, request <b>SESSION TOKEN</b>. The server mints
              a token for your session. On reconnect — even from a different network
              — hand back <b>SESSION RESUME &lt;token&gt;</b> and you're back in without
              re-authentication, channel-re-join, or history gaps.
            </p>
            <span class="tag">session · resume · ircx</span>
          </article>

          <article class="ab-proto-item">
            <span class="label">Message history</span>
            <h3>CHATHISTORY</h3>
            <p>
              Standard IRCv3 CHATHISTORY. Miss a conversation? Ask the server to replay
              it — by message-id, by time window, or from where you last read.
              <b>No polling.</b> No side-channel API.
            </p>
            <span class="tag">chathistory · ircv3 · causal order</span>
          </article>

          <article class="ab-proto-item">
            <span class="label">Roles & permissions</span>
            <h3>Modes as real state</h3>
            <p>
              +q owner, +o operator, +v voice — these aren't cosmetic badges. They're
              channel state: <b>the server enforces them</b>, they survive reconnects, and
              IRCX ACCESS lets fine-grained overrides live on the channel itself.
              Your permissions are yours, on every client that speaks the protocol.
            </p>
            <span class="tag">modes · ircx access · roles</span>
          </article>
        </div>

        <div class="ab-cap-list" role="complementary" aria-label="Capabilities negotiated on connect">
          <div class="bar">
            <span class="lights">
              <i style={{ background: 'var(--shu)' }} aria-hidden="true" />
              <i style={{ background: 'var(--gold)' }} aria-hidden="true" />
              <i style={{ background: 'var(--ok)' }} aria-hidden="true" />
            </span>
            <span>CAP negotiation — what Orochi advertises on connect</span>
          </div>
          <div class="ab-cap-row">
            <span class="key">draft/sasl</span>
            <span class="val">plain · external · <b>scram-sha-256</b></span>
          </div>
          <div class="ab-cap-row">
            <span class="key">ircx</span>
            <span class="val">PROP · ACCESS · EVENT · MEDIA subcommands</span>
          </div>
          <div class="ab-cap-row">
            <span class="key">session</span>
            <span class="val">TOKEN · RESUME — persistent reconnect</span>
          </div>
          <div class="ab-cap-row">
            <span class="key">chathistory</span>
            <span class="val">server-side log replay by id / time</span>
          </div>
          <div class="ab-cap-row">
            <span class="key">message-tags</span>
            <span class="val">account · time · label · batch</span>
          </div>
          <div class="ab-cap-row">
            <span class="key">away-notify</span>
            <span class="val">account-notify · extended-join</span>
          </div>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── 2. Media model ── */}
      <section id="media" class="r-wrap ab-section" aria-labelledby="media-heading">
        <span class="r-eyebrow">02 — voice &amp; video</span>
        <h2 id="media-heading" class="r-title">Our codec,<br />every device</h2>
        <p class="r-lede">
          One codec everywhere. No per-platform divergence. The server forwards opaque
          frames it will never read.
        </p>

        <div class="ab-media-header">
          {/* Diagram — codec + SFU path */}
          <svg
            class="ab-media-diagram"
            viewBox="0 0 580 320"
            role="img"
            aria-label="Media path: clients encode with KAGURAVOX/KAGURAVIS or WASM, send opaque Kagura frames over the mesh relay to the SFU, which forwards them unchanged."
          >
            {/* SFU center */}
            <rect x="230" y="120" width="120" height="80" fill="none" stroke="var(--seam)" stroke-width="1.5" />
            <text x="290" y="152" font-family="'JetBrains Mono Variable', monospace" font-size="10" fill="var(--lapis-bright)" text-anchor="middle" letter-spacing="1">SFU</text>
            <text x="290" y="168" font-family="'JetBrains Mono Variable', monospace" font-size="8.5" fill="var(--washi-mute)" text-anchor="middle">forward only</text>
            <text x="290" y="182" font-family="'JetBrains Mono Variable', monospace" font-size="8.5" fill="var(--washi-mute)" text-anchor="middle">no encode/decode</text>

            {/* Desktop client left */}
            <rect x="30" y="60" width="100" height="50" fill="none" stroke="var(--lapis-bright)" stroke-width="1" rx="2" />
            <text x="80" y="82" font-family="'JetBrains Mono Variable', monospace" font-size="9" fill="var(--lapis-bright)" text-anchor="middle">Desktop</text>
            <text x="80" y="96" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--washi-mute)" text-anchor="middle">KAGURAVOX/KAGURAVIS</text>
            <text x="80" y="108" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--washi-mute)" text-anchor="middle">native</text>

            {/* Browser client left-lower */}
            <rect x="30" y="200" width="100" height="50" fill="none" stroke="var(--ok)" stroke-width="1" rx="2" />
            <text x="80" y="222" font-family="'JetBrains Mono Variable', monospace" font-size="9" fill="var(--ok)" text-anchor="middle">Browser</text>
            <text x="80" y="236" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--washi-mute)" text-anchor="middle">KAGURAVOX/KAGURAVIS</text>
            <text x="80" y="248" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--washi-mute)" text-anchor="middle">WASM</text>

            {/* Mobile right-upper */}
            <rect x="450" y="60" width="100" height="50" fill="none" stroke="var(--ok)" stroke-width="1" rx="2" />
            <text x="500" y="82" font-family="'JetBrains Mono Variable', monospace" font-size="9" fill="var(--ok)" text-anchor="middle">Mobile</text>
            <text x="500" y="96" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--washi-mute)" text-anchor="middle">KAGURAVOX/KAGURAVIS</text>
            <text x="500" y="108" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--washi-mute)" text-anchor="middle">WASM</text>

            {/* Desktop right-lower */}
            <rect x="450" y="200" width="100" height="50" fill="none" stroke="var(--lapis-bright)" stroke-width="1" rx="2" />
            <text x="500" y="222" font-family="'JetBrains Mono Variable', monospace" font-size="9" fill="var(--lapis-bright)" text-anchor="middle">Desktop</text>
            <text x="500" y="236" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--washi-mute)" text-anchor="middle">KAGURAVOX/KAGURAVIS</text>
            <text x="500" y="248" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--washi-mute)" text-anchor="middle">native</text>

            {/* Arrows from left clients to SFU */}
            <path d="M130 85 L228 148" fill="none" stroke="var(--lapis)" stroke-width="1.2" stroke-dasharray="3 5" />
            <path d="M130 225 L228 172" fill="none" stroke="var(--lapis)" stroke-width="1.2" stroke-dasharray="3 5" />

            {/* Arrows from SFU to right clients */}
            <path d="M352 148 L448 85" fill="none" stroke="var(--lapis)" stroke-width="1.2" stroke-dasharray="3 5" />
            <path d="M352 172 L448 225" fill="none" stroke="var(--lapis)" stroke-width="1.2" stroke-dasharray="3 5" />

            {/* Frame label */}
            <text x="175" y="122" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--lapis-bright)" text-anchor="middle">kagura frame</text>
            <text x="175" y="133" font-family="'JetBrains Mono Variable', monospace" font-size="7.5" fill="var(--washi-mute)" text-anchor="middle">(opaque, e2ee)</text>
            <text x="405" y="122" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--lapis-bright)" text-anchor="middle">kagura frame</text>
            <text x="405" y="133" font-family="'JetBrains Mono Variable', monospace" font-size="7.5" fill="var(--washi-mute)" text-anchor="middle">(identical bytes)</text>
          </svg>

          <div class="ab-media-body">
            <p>
              <b>KaguraVox</b> (audio) and <b>KaguraVis</b> (video) are Suimyaku codecs —
              not Opus, not H.264. Desktop clients run them natively. Browsers and mobile
              run the exact same codecs compiled to <b>WebAssembly</b>, with SIMD and
              threads. The media path is identical on every platform.
            </p>
            <p>
              Encoded frames travel in a <b>kagura frame</b> container — a lightweight wire
              format carrying payload length, band, stream ID, sequence, timestamp,
              keyframe flag, and codec tag. End-to-end encryption wraps the payload
              before it ever leaves the sender.
            </p>
            <p>
              The media relay is a <b>pure selective-forwarding unit</b>. It reads the
              kagura container header to know where to send the frame, then forwards the
              opaque payload byte-for-byte. It does not encode, decode, or transcode.
              Your keys stay with you; plaintext never crosses the server.
            </p>
          </div>
        </div>

        {/* Transport modes */}
        <div class="ab-transport-row" role="list" aria-label="Transport options">
          <article class="ab-transport primary" role="listitem">
            <span class="t-label">Default</span>
            <h4>Kagura frames<br />over QUIC</h4>
            <p>
              The preferred transport path. Datagram-eligible, head-of-line-blocking
              free, lower latency than TCP. Opaque media frames ride the mesh path,
              so a lost media packet never stalls channel state.
            </p>
          </article>

          <article class="ab-transport secondary" role="listitem">
            <span class="t-label">Fallback carrier</span>
            <h4>Mesh relay<br />over WebSocket</h4>
            <p>
              Where QUIC is not available, the browser keeps the same opaque Kagura
              frames moving over the WebSocket relay path. Same bytes, same codec,
              different pipe.
            </p>
          </article>

          <article class="ab-transport fallback" role="listitem">
            <span class="t-label">Portable fallback</span>
            <h4>WASM decode<br />everywhere</h4>
            <p>
              Browsers and mobile clients run the same KaguraVox/KaguraVis codecs via
              WebAssembly. The server still never transcodes; codec convergence is a
              client responsibility.
            </p>
          </article>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── 3. E2EE — Tsumugi ── */}
      <section id="e2ee" class="r-wrap ab-section" aria-labelledby="e2ee-heading">
        <span class="r-eyebrow">03 — end-to-end encryption</span>
        <h2 id="e2ee-heading" class="r-title">Tsumugi:<br />keys the server never holds</h2>
        <p class="r-lede">
          End-to-end encryption isn't a feature Orochi has; it's a constraint the
          architecture enforces. The server relays ciphertext. That's all it can do.
        </p>

        <div class="ab-e2ee-split">
          <div class="ab-e2ee-body">
            <p>
              Tsumugi is the secure channel layer. For group calls it uses
              <b>TreeKEM</b> — a tree-structured key exchange where adding or removing
              a participant generates a new group key with a single tree walk, without
              re-keying every pair. No one who leaves the call can decrypt what came after.
            </p>
            <p>
              The encryption primitive is <b>HPKE</b> (Hybrid Public-Key Encryption).
              Media payloads are wrapped in HPKE before they enter the kagura frame.
              The server receives an opaque blob, knows which channel to forward it to,
              and sends it on — no key material, no plaintext, no metadata beyond routing.
            </p>

            <div class="ab-prop-list" role="list" aria-label="Encryption properties">
              <div class="ab-prop" role="listitem">
                <span class="pk">Primitive</span>
                <span class="pv">TreeKEM group key derivation · HPKE per-frame encryption</span>
              </div>
              <div class="ab-prop" role="listitem">
                <span class="pk">Server sees</span>
                <span class="pv">Channel routing tag, opaque ciphertext, frame length — never content</span>
              </div>
              <div class="ab-prop" role="listitem">
                <span class="pk">Forward secrecy</span>
                <span class="pv">Group key rotates on every join and leave; past frames stay dark</span>
              </div>
              <div class="ab-prop" role="listitem">
                <span class="pk">Post-quantum</span>
                <span class="pv">Mesh S2S links use X25519 + ML-KEM-768 hybrid (PQ on day one)</span>
              </div>
            </div>
          </div>

          {/* E2EE diagram */}
          <svg
            class="ab-e2ee-visual"
            viewBox="0 0 440 360"
            role="img"
            aria-label="Tsumugi secure channel: TreeKEM tree on left, clients hold leaf keys, root key encrypts media, server relays opaque ciphertext on right"
          >
            {/* Tree structure */}
            <text x="220" y="28" font-family="'JetBrains Mono Variable', monospace" font-size="9" fill="var(--lapis-bright)" text-anchor="middle" letter-spacing="1.5">TSUMUGI SECURE CHANNEL</text>

            {/* Root */}
            <circle cx="220" cy="65" r="12" fill="none" stroke="var(--shu)" stroke-width="1.5" />
            <text x="220" y="69" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--shu)" text-anchor="middle">root</text>

            {/* Mid nodes */}
            <line x1="220" y1="77" x2="140" y2="118" stroke="var(--seam)" stroke-width="1" />
            <line x1="220" y1="77" x2="300" y2="118" stroke="var(--seam)" stroke-width="1" />
            <circle cx="140" cy="130" r="10" fill="none" stroke="var(--lapis)" stroke-width="1" />
            <circle cx="300" cy="130" r="10" fill="none" stroke="var(--lapis)" stroke-width="1" />

            {/* Leaf nodes */}
            <line x1="140" y1="140" x2="90" y2="178" stroke="var(--seam-faint)" stroke-width="1" />
            <line x1="140" y1="140" x2="190" y2="178" stroke="var(--seam-faint)" stroke-width="1" />
            <line x1="300" y1="140" x2="250" y2="178" stroke="var(--seam-faint)" stroke-width="1" />
            <line x1="300" y1="140" x2="350" y2="178" stroke="var(--seam-faint)" stroke-width="1" />

            <circle cx="90" cy="190" r="9" fill="none" stroke="var(--lapis-bright)" stroke-width="1" />
            <circle cx="190" cy="190" r="9" fill="none" stroke="var(--lapis-bright)" stroke-width="1" />
            <circle cx="250" cy="190" r="9" fill="none" stroke="var(--lapis-bright)" stroke-width="1" />
            <circle cx="350" cy="190" r="9" fill="none" stroke="var(--lapis-bright)" stroke-width="1" />

            <text x="90" y="194" font-family="'JetBrains Mono Variable', monospace" font-size="7" fill="var(--lapis-bright)" text-anchor="middle">A</text>
            <text x="190" y="194" font-family="'JetBrains Mono Variable', monospace" font-size="7" fill="var(--lapis-bright)" text-anchor="middle">B</text>
            <text x="250" y="194" font-family="'JetBrains Mono Variable', monospace" font-size="7" fill="var(--lapis-bright)" text-anchor="middle">C</text>
            <text x="350" y="194" font-family="'JetBrains Mono Variable', monospace" font-size="7" fill="var(--lapis-bright)" text-anchor="middle">D</text>

            {/* Labels */}
            <text x="90" y="215" font-family="'JetBrains Mono Variable', monospace" font-size="7" fill="var(--washi-mute)" text-anchor="middle">leaf key</text>
            <text x="190" y="215" font-family="'JetBrains Mono Variable', monospace" font-size="7" fill="var(--washi-mute)" text-anchor="middle">leaf key</text>
            <text x="250" y="215" font-family="'JetBrains Mono Variable', monospace" font-size="7" fill="var(--washi-mute)" text-anchor="middle">leaf key</text>
            <text x="350" y="215" font-family="'JetBrains Mono Variable', monospace" font-size="7" fill="var(--washi-mute)" text-anchor="middle">leaf key</text>

            {/* Encrypted frame flow */}
            <rect x="60" y="248" width="320" height="40" fill="none" stroke="var(--seam-faint)" rx="2" />
            <text x="220" y="263" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--lapis-bright)" text-anchor="middle">HPKE-encrypted kagura frame</text>
            <text x="220" y="279" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--washi-mute)" text-anchor="middle">opaque payload — server cannot read</text>

            {/* Arrow to server */}
            <text x="220" y="320" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--washi-mute)" text-anchor="middle">↓ SFU forwards unchanged ↓</text>
            <text x="220" y="338" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--shu)" text-anchor="middle">server never decrypts</text>
          </svg>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── 4. The mesh ── */}
      <section id="mesh" class="r-wrap ab-section" aria-labelledby="mesh-heading">
        <span class="r-eyebrow">04 — the mesh</span>
        <h2 id="mesh-heading" class="r-title">A network that<br />heals itself</h2>
        <p class="r-lede">
          A self-healing server mesh that keeps the network convergent across however
          many nodes, with no single point of failure.
        </p>

        <div class="ab-mesh-body">
          {/* Mesh diagram */}
          <svg
            class="ab-mesh-vis"
            viewBox="0 0 600 360"
            role="img"
            aria-label="Mesh diagram: eshmaki.me and ircx.us joined by azure current links; either node reaches the whole network"
          >
            {/* Currents */}
            <g fill="none" stroke="var(--lapis)" stroke-width="1.3">
              <path class="ab-vein" d="M150 180 C 250 90, 350 270, 450 180" />
              <path class="ab-vein" d="M150 180 C 260 200, 340 160, 450 180" opacity="0.6" />
              <path d="M150 180 C 230 300, 370 60, 450 180" opacity="0.35" />
            </g>
            {/* Faint outgoing edges */}
            <g stroke="var(--seam-faint)" stroke-width="1">
              <line x1="150" y1="180" x2="68" y2="88" />
              <line x1="150" y1="180" x2="58" y2="272" />
              <line x1="450" y1="180" x2="542" y2="88" />
              <line x1="450" y1="180" x2="537" y2="272" />
            </g>
            <circle cx="68" cy="88" r="3" fill="var(--washi-mute)" />
            <circle cx="58" cy="272" r="3" fill="var(--washi-mute)" />
            <circle cx="542" cy="88" r="3" fill="var(--washi-mute)" />
            <circle cx="537" cy="272" r="3" fill="var(--washi-mute)" />

            {/* eshmaki node */}
            <circle cx="150" cy="180" r="14" fill="var(--ink)" stroke="var(--lapis)" stroke-width="2" />
            <circle cx="150" cy="180" r="5" fill="var(--lapis)" />
            <text x="150" y="212" font-family="'JetBrains Mono Variable', monospace" font-size="9" fill="var(--lapis)" text-anchor="middle">eshmaki.me</text>
            <text x="150" y="225" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--washi-mute)" text-anchor="middle">:8080 wss</text>

            {/* ircx node */}
            <circle cx="450" cy="180" r="14" fill="var(--ink)" stroke="var(--lapis-bright)" stroke-width="2" />
            <circle cx="450" cy="180" r="5" fill="var(--lapis-bright)" />
            <text x="450" y="212" font-family="'JetBrains Mono Variable', monospace" font-size="9" fill="var(--lapis-bright)" text-anchor="middle">ircx.us</text>
            <text x="450" y="225" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--washi-mute)" text-anchor="middle">:8080 wss</text>

            {/* Convergence label */}
            <text x="300" y="155" font-family="'JetBrains Mono Variable', monospace" font-size="9" fill="var(--lapis-bright)" text-anchor="middle" letter-spacing="1">CRDT convergent</text>
            <text x="300" y="170" font-family="'JetBrains Mono Variable', monospace" font-size="8" fill="var(--washi-mute)" text-anchor="middle">delta-state sync</text>
          </svg>

          <div class="ab-mesh-text">
            <p>
              The client auto-routes to the nearest node — <b>eshmaki.me:8080</b> and
              <b> ircx.us:8080</b> are two entrances to the same network. The mesh keeps
              them in continuous sync using delta-state CRDTs, so a state change on one
              node reaches the other without full-state floods.
            </p>
            <p>
              Lose a node and the mesh heals: HyParView partial views maintain an active
              set of peers and a passive reserve. A failure promotes a reserve peer to
              active in a single hop. No hub, no coordinator, no single thing to take down.
            </p>
            <p>
              Every node identity is a <b>BLAKE3-160 hash of its Ed25519 signing key</b>.
              No human-assigned server IDs, no trust-because-it-came-over-the-link. Every
              state delta is signed by its origin node and verifiable by any peer — the
              relay cannot forge it.
            </p>

            <div class="ab-node-row" aria-label="Live mesh nodes">
              <div class="ab-node esh">
                <span class="dot" aria-hidden="true" />
                <span class="meta">
                  <span class="host">eshmaki.me : 8080</span>
                  <span class="role">the near harbor — where the client lands first</span>
                </span>
              </div>
              <div class="ab-node ircx">
                <span class="dot" aria-hidden="true" />
                <span class="meta">
                  <span class="host">ircx.us : 8080</span>
                  <span class="role">the far shore — the same waters, another door</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Mesh tech detail */}
        <div class="ab-crdt-row" role="list" aria-label="Mesh technology details">
          <article class="ab-crdt-item" role="listitem">
            <span class="k">δ-CRDTs</span>
            <span class="v">
              Delta-state mutators: each change is a small diff, not a full state broadcast.
              Join is associative, commutative, and idempotent — convergence regardless of
              order or duplicates.
            </span>
          </article>
          <article class="ab-crdt-item" role="listitem">
            <span class="k">RBSR</span>
            <span class="v">
              Range-based set reconciliation for anti-entropy: peers exchange range fingerprints
              and recursively identify only the mismatching deltas. Bandwidth proportional to
              the difference, not the state size.
            </span>
          </article>
          <article class="ab-crdt-item" role="listitem">
            <span class="k">HyParView</span>
            <span class="v">
              Partial views with an active set (live TCP links) and a passive reserve.
              Membership churn is O(log n). Node failure repairs in one hop.
            </span>
          </article>
          <article class="ab-crdt-item" role="listitem">
            <span class="k">Plumtree</span>
            <span class="v">
              Epidemic broadcast over the active view: eager push builds a spanning tree
              (full payload), lazy push gossips digests; a missing ID triggers a graft.
              Tree-efficient in steady state, resilient on churn.
            </span>
          </article>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── 5. Services ── */}
      <section id="services" class="r-wrap ab-section" aria-labelledby="services-heading">
        <span class="r-eyebrow">05 — services</span>
        <h2 id="services-heading" class="r-title">Real commands,<br />not bot puppets</h2>
        <p class="r-lede">
          Orochi services are built into the server. No ChanServ ghost in your DMs.
          No NickServ fiction. Just commands the server understands natively.
        </p>

        <div class="ab-nobot" role="note">
          "Results arrive as standard replies — <b>NOTE</b>, <b>FAIL</b>, <b>WARN</b> —
          not NOTICE text from a fake user. There is no bot sitting in the channel
          pretending to be a person."
        </div>

        <div class="ab-svc-grid">
          <article class="ab-svc">
            <span class="cmd">REGISTER</span>
            <h3>Account creation</h3>
            <p>
              Create an account on the network. Follow with VERIFY to complete
              registration. Supports the draft/account-registration IRCv3 capability.
            </p>
            <span class="note live">ircv3 draft · account-registration</span>
          </article>

          <article class="ab-svc">
            <span class="cmd">IDENTIFY</span>
            <h3>Authenticate</h3>
            <p>
              Log in to your account. Onyx handles this automatically on connect
              when you've saved credentials — no /msg NickServ.
            </p>
            <span class="note live">auto on connect</span>
          </article>

          <article class="ab-svc">
            <span class="cmd">GHOST</span>
            <h3>Reclaim your nick</h3>
            <p>
              Kill a stale session holding your nickname.
              <code>GHOST &lt;nick&gt;</code> — the server terminates the old
              connection immediately.
            </p>
            <span class="note">session reclaim</span>
          </article>

          <article class="ab-svc">
            <span class="cmd">CHANNEL</span>
            <h3>Channel registration</h3>
            <p>
              Register a channel to your account so ownership and access lists persist
              even when nobody's home. Ownership survives server restarts.
            </p>
            <span class="note">persistent ownership</span>
          </article>

          <article class="ab-svc">
            <span class="cmd">TEGAMI</span>
            <h3>Offline messages</h3>
            <p>
              Leave a message for someone who isn't online — it's delivered the
              moment they next connect. No third-party inbox, no bot in your DMs.
            </p>
            <span class="note">async delivery</span>
          </article>

          <article class="ab-svc">
            <span class="cmd">CERTADD</span>
            <h3>Certificate binding</h3>
            <p>
              Bind a TLS client certificate fingerprint to your account and authenticate
              with SASL EXTERNAL — no password over the wire.
            </p>
            <span class="note">certfp · sasl external</span>
          </article>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── 6. The stack ── */}
      <section id="mythos" class="r-wrap ab-section" aria-labelledby="mythos-heading">
        <span class="r-eyebrow">06 — the stack</span>
        <h2 id="mythos-heading" class="r-title">Three layers,<br />one network</h2>
        <p class="r-lede">
          The client, the gate and the engine — what you hold, where you enter,
          and what carries it. Each layer is built to refuse a single point of failure.
        </p>

        <div class="ab-mythos-grid">
          <article class="ab-myth serpent">
            <span class="ideograph" aria-hidden="true"><Mascot variant="hero" /></span>
            <span class="name">Orochi · the engine</span>
            <p>
              The daemon that <b>is</b> the network — many-noded and self-healing, with
              <b> no single head to cut off</b>, no single point of failure. Not a node,
              not a service: the network itself.
            </p>
            <p>
              Named for the water-dragon Orochi, written in Zig from scratch. Clean-room.
              Modern. No legacy IRC server code, no shared ancestry with anything that
              existed before it.
            </p>
            <span class="etym">
              orochi · the engine<br />
              clean-room zig daemon · no single point of failure
            </span>
          </article>

          <article class="ab-myth tide">
            <span class="ideograph" aria-hidden="true">≈</span>
            <span class="name">the gate · where you enter</span>
            <p>
              The network has more than one door, and any door opens onto the whole of
              it. <b>eshmaki.me</b> and <b>ircx.us</b> are entrances, not destinations —
              the client picks the nearest one and the mesh does the rest.
            </p>
            <p>
              Run your own node and you add another gate to the same waters. There is no
              front door and no back door, only the open shore — the network belongs to
              everyone who keeps a light on.
            </p>
            <span class="etym">
              the gate · where you enter<br />
              many doors · one open network
            </span>
          </article>

          <article class="ab-myth jewel">
            <span class="ideograph" aria-hidden="true">◆</span>
            <span class="name">Onyx · the client</span>
            <p>
              Onyx — black banded chalcedony, cut and worn as a seal stone since
              antiquity, prized for its depth and its hard, clean edges.
            </p>
            <p>
              That's this client: deep-water ground, azure currents, bioluminescent
              crests — the window you hold onto the network. Calm, deliberate, yours.
            </p>
            <span class="etym">
              onyx · the client<br />
              dark gemstone · the window you hold
            </span>
          </article>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── 7. Developer ── */}
      <section id="developer" class="r-wrap ab-section" aria-labelledby="developer-heading">
        <span class="r-eyebrow">07 — build on it</span>
        <h2 id="developer-heading" class="r-title">Open protocol.<br />Sovereign mesh.</h2>
        <p class="r-lede">
          The wire format is documented and usable outside Onyx. You can also run
          your own Orochi node and peer it into the mesh — full sovereignty over your
          slice of the network.
        </p>

        <div class="ab-dev-grid">
          <article class="ab-dev-card">
            <span class="idx">build a client</span>
            <h3>Any client,<br />any language</h3>
            <p>
              IRCv3 + IRCX over WebSocket. The protocol is public and interoperable.
              You don't need Onyx. Connect with a protocol-compatible tool, a custom
              bot, or a new client you build from scratch.
            </p>
            <p>
              SASL PLAIN gets you in. Add SESSION for persistent reconnect.
              Add CHATHISTORY for message replay. IRCX PROP and ACCESS give you
              extended channel and user properties. Media is opt-in via
              <b>MEDIA JOIN #channel voice</b>.
            </p>
            <div class="code-snip" aria-label="Example connection sequence">
              <div><span class="o">→ connect wss://eshmaki.me:8080</span></div>
              <div><span class="c">CAP LS 302</span></div>
              <div><span class="c">CAP REQ :</span><span class="p">sasl chathistory ircx session</span></div>
              <div><span class="c">AUTHENTICATE PLAIN</span></div>
              <div><span class="o">← AUTHENTICATE +</span></div>
              <div><span class="c">AUTHENTICATE </span><span class="p">&lt;base64 credentials&gt;</span></div>
              <div><span class="o">← 900 :you are now logged in</span></div>
              <div><span class="c">SESSION TOKEN</span></div>
              <div><span class="o">← NOTE SESSION TOKEN </span><span class="h">:&lt;token&gt;</span></div>
            </div>
            <a class="more" href="/app/">open a session in Onyx →</a>
          </article>

          <article class="ab-dev-card">
            <span class="idx">run a node</span>
            <h3>Your node,<br />your sovereignty</h3>
            <p>
              Orochi is a pure-Zig daemon. It runs on Linux x86_64 and aarch64.
              Stand it up on your own hardware, configure it, and link it into the
              mesh — your node becomes another door into the whole network.
            </p>
            <p>
              Node identity is your <b>Ed25519 signing key</b>. The NodeId is
              BLAKE3-160 of that key — no registration, no central authority.
              Peer admission uses a MeshPass: a signed capability token from the
              realm root, or a quorum-signed invite from existing operators.
            </p>
            <div class="code-snip" aria-label="Example node startup and peer configuration">
              <div><span class="o"># build from source</span></div>
              <div><span class="c">zig build -Doptimize=ReleaseFast</span></div>
              <div><span class="o"># configure orochi.conf:</span></div>
              <div><span class="p">[mesh]</span></div>
              <div><span class="h">  peer = "eshmaki.me:7000"</span></div>
              <div><span class="h">  meshpass = "&lt;signed capability&gt;"</span></div>
              <div><span class="o"># start — sessions survive USR2 upgrade</span></div>
              <div><span class="c">systemctl start orochi</span></div>
            </div>
            <a class="more" href="/app/">explore the network →</a>
          </article>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── 8. Accessibility ── */}
      <section id="accessibility" class="r-wrap ab-section" aria-labelledby="a11y-statement-title">
        <span class="r-eyebrow">08 — accessibility</span>
        <AccessibilityStatement class="ab-a11y" />
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── Footer ── */}
      <footer class="r-wrap r-footer">
        <div class="cols">
          <div class="sig">
            <div class="logo"><Mascot variant="mark" aria-label="Onyx" />ONYX</div>
            <p>
              A mesh-native client for the open network — end-to-end-encrypted
              media, real services, and a home you own. Built in the open with Claude and Codex.
            </p>
          </div>
          <div class="col">
            <h5>This page</h5>
            <a href="#protocol">Protocol</a>
            <a href="#media">Media model</a>
            <a href="#e2ee">Encryption</a>
            <a href="#mesh">Mesh</a>
            <a href="#services">Services</a>
            <a href="#mythos">Names</a>
            <a href="#developer">Build on it</a>
            <a href="#accessibility">Accessibility</a>
          </div>
          <div class="col">
            <h5>Network</h5>
            <a href="#mesh">The mesh</a>
            <a href="/app/">Auto-routing</a>
            <a href="/">Landing</a>
          </div>
          <div class="col">
            <h5>Commons</h5>
            <a href="/app/">Open Onyx</a>
            <a href="/app/">Join #root</a>
            <a href="#developer">Build a client</a>
            <a href="#developer">Run a node</a>
          </div>
        </div>
        <div class="base">
          <span><Mascot variant="mark" aria-label="Onyx" /> Onyx</span>
          <span>Orochi · the open mesh · 2026</span>
        </div>
      </footer>
    </main>
  );
}
