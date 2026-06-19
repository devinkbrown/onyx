import './landing.css';

/** Ruri launch site — Lapis × Kintsugi × Terminal, warmed.
 *  Capability-led, mythos-rich, living kintsugi atmosphere. Claims are grounded
 *  in the Orochi implementation (docs/planning/20-media-interop.md,
 *  architecture/03-media.md). WebGPU vein-field + scroll story arrive in Phase 2. */
export default function Landing() {
  return (
    <main class="r">
      {/* ── living atmosphere ── */}
      <div class="r-ground" aria-hidden="true" />
      <div class="r-flecks" aria-hidden="true" />
      <svg class="r-veins" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
        <path class="flow" d="M-40 120 C 280 60, 420 280, 720 220 S 1180 120, 1500 240" />
        <path class="flow" d="M-40 540 C 320 640, 560 420, 860 520 S 1240 660, 1520 560" />
        <path d="M-40 760 C 360 700, 700 860, 1040 760 S 1320 700, 1520 800" />
        <circle class="node" cx="720" cy="220" r="3" />
        <circle class="node" cx="860" cy="520" r="3" />
        <circle class="node" cx="1040" cy="760" r="2.5" />
      </svg>
      <div class="r-grain" aria-hidden="true" />

      {/* ── top bar ── */}
      <header class="r-status">
        <span class="brand"><b>瑠璃</b>RURI</span>
        <nav>
          <a class="hideable" href="#difference">Difference</a>
          <a class="hideable" href="#network">Network</a>
          <a class="hideable" href="#commons">Commons</a>
          <span class="live hideable"><i />mesh online</span>
          <a class="enter" href="/app">Open Ruri</a>
        </nav>
      </header>

      {/* ── hero ── */}
      <section class="r-wrap r-hero">
        <p class="r-kicker">a mesh-native client for the Orochi network</p>
        <h1>Talk on a<br /><span class="gold">living mesh</span></h1>
        <p class="serif-sub">Named for <em>瑠璃</em> — the azure stone the serpent guards.</p>
        <p class="sub">
          Open IRCv3/IRCX over a server mesh that heals itself. End-to-end-encrypted
          voice, video and screen the server never sees — your codec on every device,
          your choice of transport. Real services, not bots. A home you actually own.
        </p>
        <div class="r-cta">
          <a class="r-btn primary" href="/app">[ enter the network → ]</a>
          <a class="r-btn ghost" href="#difference">what makes it different</a>
        </div>
        <div class="r-ticker">
          <span><b>solid + vite</b> · signal-fast</span>
          <span><b>suimyaku</b> mesh · <b>tsumugi</b> e2ee media</span>
          <span><b>theme studio</b> · living backgrounds</span>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── mythos ── */}
      <section class="r-wrap r-section r-mythos">
        <span class="r-eyebrow">the mythos</span>
        <h2 class="r-title">Three names,<br />one network</h2>
        <p class="r-lede">Every part of this thing is named for something old and a little dangerous. The lore isn't decoration — it's the architecture.</p>
        <div class="r-glyphs">
          <article class="r-glyph serpent">
            <span class="mark">大蛇</span>
            <span class="name">Orochi · the serpent</span>
            <p class="gloss">The daemon that <b>is</b> the network. Clean-room, modern, sovereign — a many-headed server that refuses to be a single point of failure.</p>
          </article>
          <article class="r-glyph devil">
            <span class="mark">ეშმაკი</span>
            <span class="name">eshmaki · the gate</span>
            <p class="gloss">Georgian for <b>devil</b>, from Aēšma — the ancient word for wrath. <b>eshmaki.me</b> is one of two doors into the mesh.</p>
          </article>
          <article class="r-glyph jewel">
            <span class="mark">瑠璃</span>
            <span class="name">Ruri · the jewel</span>
            <p class="gloss">Lapis lazuli — deep ultramarine veined in gold. This client: the azure stone the serpent keeps, and what you hold.</p>
          </article>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── offerings / the difference ── */}
      <section id="difference" class="r-wrap r-section">
        <span class="r-eyebrow">what sets it apart</span>
        <h2 class="r-title">Difference you can feel</h2>
        <p class="r-lede">Not another chat skin. The platform underneath does things the walled gardens simply can't.</p>
        <div class="r-offerings">
          <article class="r-offer">
            <div class="head"><span class="idx">01</span><h3>Your codec, every device</h3></div>
            <p>OPVOX audio and OPVIS video — <b>our</b> codec — run natively on desktop and in WASM on browser and mobile. Identical media everywhere, no per-platform divergence.</p>
            <span class="tag">opvox · opvis · wasm</span>
          </article>
          <article class="r-offer">
            <div class="head"><span class="idx">02</span><h3>The server never sees you</h3></div>
            <p>A pure selective-forwarding unit: it relays <b>opaque end-to-end-encrypted</b> frames and never encodes, decodes or transcodes. Keys are yours; plaintext never touches the wire.</p>
            <span class="tag hot">e2ee · sfu · zero-transcode</span>
          </article>
          <article class="r-offer">
            <div class="head"><span class="idx">03</span><h3>You choose the transport</h3></div>
            <p>WebTransport over QUIC by default. A <b>WebRTC</b> data channel carries the same frames where QUIC can't reach — and you can opt into standard WebRTC codecs on mobile when you want to.</p>
            <span class="tag">webtransport · quic · webrtc opt-in</span>
          </article>
          <article class="r-offer">
            <div class="head"><span class="idx">04</span><h3>A network that heals</h3></div>
            <p>The <b>Suimyaku</b> CRDT mesh keeps two nodes today — eshmaki.me and ircx.us — in sync. Either door reaches the whole graph; lose one and the mesh routes around it.</p>
            <span class="tag">suimyaku · crdt mesh</span>
          </article>
          <article class="r-offer">
            <div class="head"><span class="idx">05</span><h3>Open to the bone</h3></div>
            <p>IRCv3 + IRCX over WebSocket — SASL, session-resume, CHATHISTORY, roles and permissions as real state. Bring any client. Your account, your identity, no cage.</p>
            <span class="tag">ircv3 · ircx · wss</span>
          </article>
          <article class="r-offer">
            <div class="head"><span class="idx">06</span><h3>Services, not bots</h3></div>
            <p>REGISTER, CHANNEL, GHOST, TEGAMI are <b>real server commands</b> — not ChanServ puppets sitting in your DMs pretending to be people.</p>
            <span class="tag">services · no pseudo-users</span>
          </article>
          <article class="r-offer">
            <div class="head"><span class="idx">07</span><h3>Conferencing, loaded</h3></div>
            <p>Voice, video and screen with spatial audio, breakout rooms, live captions and transcripts, raise-hand and reactions — encrypted, and built into the protocol.</p>
            <span class="tag">rooms · spatial · captions</span>
          </article>
          <article class="r-offer">
            <div class="head"><span class="idx">08</span><h3>Yours to the bone</h3></div>
            <p>A live <b>Theme Studio</b>, per-server accents, and a background engine that runs animated or solid — all synced to your account across the mesh, on every device.</p>
            <span class="tag">theme studio · backgrounds</span>
          </article>
        </div>
      </section>

      {/* ── the mesh ── */}
      <section id="network" class="r-wrap r-section r-mesh">
        <span class="r-eyebrow">the network</span>
        <h2 class="r-title">One mesh, two doors</h2>
        <div class="grid2">
          <svg class="r-meshvis" viewBox="0 0 600 360" role="img" aria-label="The Orochi mesh: two nodes joined by golden veins">
            <g fill="none" stroke="var(--gold)" stroke-width="1.3">
              <path class="r-vein" d="M150 180 C 250 90, 350 270, 450 180" />
              <path class="r-vein" d="M150 180 C 260 200, 340 160, 450 180" opacity="0.6" />
              <path d="M150 180 C 230 300, 370 60, 450 180" opacity="0.35" />
            </g>
            <g stroke="var(--seam-faint)" stroke-width="1">
              <line x1="150" y1="180" x2="70" y2="90" /><line x1="150" y1="180" x2="60" y2="270" />
              <line x1="450" y1="180" x2="540" y2="90" /><line x1="450" y1="180" x2="535" y2="270" />
            </g>
            <circle cx="70" cy="90" r="3" fill="var(--washi-mute)" /><circle cx="60" cy="270" r="3" fill="var(--washi-mute)" />
            <circle cx="540" cy="90" r="3" fill="var(--washi-mute)" /><circle cx="535" cy="270" r="3" fill="var(--washi-mute)" />
            <circle cx="150" cy="180" r="13" fill="var(--ink)" stroke="var(--shu)" stroke-width="2" />
            <circle cx="150" cy="180" r="5" fill="var(--shu)" />
            <circle cx="450" cy="180" r="13" fill="var(--ink)" stroke="var(--lapis-bright)" stroke-width="2" />
            <circle cx="450" cy="180" r="5" fill="var(--lapis-bright)" />
          </svg>
          <div class="r-nodecard">
            <p class="r-lede" style={{ margin: '0 0 6px' }}>Connect to either node. The Suimyaku mesh keeps them convergent, so the whole network is one room with two entrances.</p>
            <div class="r-node eshmaki"><span class="dot" /><span class="meta"><span class="host">eshmaki.me : 8080</span><span class="role">the devil's gate — wrath, from Aēšma</span></span></div>
            <div class="r-node ircx"><span class="dot" /><span class="meta"><span class="host">ircx.us : 8080</span><span class="role">the far door — the open shore</span></span></div>
          </div>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── community ── */}
      <section id="commons" class="r-wrap r-section r-community">
        <span class="r-eyebrow">the commons</span>
        <h2 class="r-title">Come live<br />on the wire</h2>
        <p class="r-lede">IRC was always a place, not a product. Ruri keeps it that way — a network you join, not an account you rent.</p>
        <div class="r-board">
          <article class="r-card"><span class="k">join</span><h4>Drop into #root</h4><p>The build channel lives on IRCXNet right now. Open Ruri, pick a name, and you're on the wire in seconds.</p><a class="more" href="/app">open a session →</a></article>
          <article class="r-card"><span class="k">explore</span><h4>Channel directory</h4><p>Browse rooms across the mesh — text, voice, stages and threads — and watch live presence as people arrive.</p><a class="more" href="/app">browse channels →</a></article>
          <article class="r-card"><span class="k">build</span><h4>Write a client</h4><p>The protocol is open IRCv3/IRCX. Ruri is one client; build your own, port a bot, or wire up the announce bot.</p><a class="more" href="/about">read the spec →</a></article>
          <article class="r-card"><span class="k">run</span><h4>Stand up a node</h4><p>Sovereignty is the point. Run your own Orochi node, peer it into the Suimyaku mesh, and own your slice of the network.</p><a class="more" href="/about">node guide →</a></article>
        </div>
      </section>

      <div class="r-wrap"><div class="r-divider" aria-hidden="true" /></div>

      {/* ── connect ── */}
      <section class="r-wrap r-section r-connect">
        <span class="r-eyebrow">open a session</span>
        <h2 class="r-title">Two lines to the mesh</h2>
        <div class="term">
          <div class="bar"><span class="lights"><i style={{ background: 'var(--shu)' }} /><i style={{ background: 'var(--gold)' }} /><i style={{ background: 'var(--ok)' }} /></span><span>ruri — connection</span></div>
          <div class="body">
            <div><span class="o">$</span> <span class="c">ruri connect</span> <span class="h">wss://ircx.us:8080</span></div>
            <div><span class="o">→ negotiating</span> <span class="p">CAP · SASL · SESSION</span> <span class="o">…</span></div>
            <div><span class="o">→ joined</span> <span class="h">#root</span> <span class="o">· mesh convergent · e2ee media ready</span></div>
            <div><span class="c">welcome to IRCXNet.</span> <span class="cursor">▍</span></div>
          </div>
        </div>
        <div class="r-cta"><a class="r-btn primary" href="/app">[ open ruri → ]</a><a class="r-btn ghost" href="/about">read the spec</a></div>
      </section>

      {/* ── footer ── */}
      <footer class="r-wrap r-footer">
        <div class="cols">
          <div class="sig">
            <div class="logo"><b>瑠璃</b>RURI</div>
            <p>The azure jewel the serpent guards — a mesh-native client for the Orochi network. Built in the open with Claude + Codex.</p>
          </div>
          <div class="col"><h5>Platform</h5><a href="#difference">The difference</a><a href="/app">Open Ruri</a><a href="/about">Media &amp; codec</a><a href="/about">Theme Studio</a></div>
          <div class="col"><h5>Network</h5><a href="#network">The mesh</a><a href="/app">eshmaki.me</a><a href="/app">ircx.us</a><a href="/about">Protocol spec</a></div>
          <div class="col"><h5>Commons</h5><a href="#commons">Join #root</a><a href="/about">Build a client</a><a href="/about">Run a node</a><a href="/about">About</a></div>
        </div>
        <div class="base"><span><b>瑠璃</b> Ruri — IRCXNet</span><span>大蛇 Orochi · ეშმაკი eshmaki · 2026</span></div>
      </footer>
    </main>
  );
}
