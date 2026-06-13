import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import ChanstatsPreview from '@/components/site/ChanstatsPreview';

export default function LandingPage() {
  return (
    <main className="land-root">

      {/* ── Skip link ── */}
      <a href="#land-main" className="land-skip-link">Skip to main content</a>

      {/* ── Atmosphere ──────────────────────────────────────────────── */}
      <div className="land-atmos" aria-hidden>
        <div className="land-atmos-halo" />
        <div className="land-atmos-grain" />
        <div className="land-atmos-grid" />
      </div>

      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <nav className="land-nav">
        <div className="land-nav-logo">
          <OceanLogo />
          <span className="land-nav-wordmark">Ocean</span>
          <span className="land-nav-sep" aria-hidden>/</span>
          <span className="land-nav-engine">Orochi</span>
        </div>
        <div className="land-nav-links">
          <a href="#features" className="land-nav-link">Client</a>
          <a href="#engine" className="land-nav-link">Engine</a>
          <a href="#security" className="land-nav-link">Security</a>
          <a href="#activity" className="land-nav-link">Activity</a>
          <Link href="/about" className="land-nav-link">About</Link>
          <Link href="/login" className="land-nav-cta">
            Launch Ocean <ArrowRight size={13} />
          </Link>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section id="land-main" className="land-hero">
        <div className="land-hero-body">
          <div className="land-hero-copy">
            <div className="land-badge">
              <span className="land-badge-dot" />
              <span className="land-badge-text">eshmaki.me · running on Orochi</span>
            </div>

            <h1 className="land-h1">
              Chat that
              <span className="land-h1-accent"> answers to no one</span>
              <span className="land-h1-tail"> but you.</span>
            </h1>

            <p className="land-lead">
              Ocean is a modern browser client — servers, channels, DMs, voice,
              video, threads, rich messages — built on{' '}
              <strong className="land-lead-strong">Orochi</strong>, a clean-room
              pure-Zig engine. Real accounts, post-quantum links, and voice that
              never touches a relay you don&rsquo;t control.
            </p>

            <div className="land-hero-actions">
              <Link href="/login" className="land-btn-primary">
                Launch Ocean
                <ArrowRight size={14} />
              </Link>
              <Link href="/about" className="land-btn-ghost">
                How it works
              </Link>
            </div>

            <dl className="land-hero-stats" aria-label="Engine highlights">
              <div className="land-hs">
                <dt>Mesh</dt>
                <dd>SUIMYAKU CRDT</dd>
              </div>
              <span className="land-hs-rule" aria-hidden />
              <div className="land-hs">
                <dt>Links</dt>
                <dd>X25519 + ML-KEM-768</dd>
              </div>
              <span className="land-hs-rule" aria-hidden />
              <div className="land-hs">
                <dt>Runtime</dt>
                <dd>Pure Zig · 64-bit</dd>
              </div>
            </dl>
          </div>

          <div className="land-hero-visual" aria-hidden>
            <MeshVis />
          </div>
        </div>
      </section>

      {/* ── Credential rail ─────────────────────────────────────────── */}
      <section className="land-rail" aria-label="What the engine provides">
        <div className="land-rail-inner">
          {([
            ['Auth', 'SASL · SCRAM-SHA-256'],
            ['Sessions', 'Persistent SESSION RESUME'],
            ['Services', 'REGISTER · IDENTIFY · GHOST'],
            ['Protocol', 'IRCv3 + IRCX surface'],
            ['Upgrades', 'Helix hot-reload, zero drops'],
          ] as Array<[string, string]>).map(([k, v]) => (
            <div key={k} className="land-rail-item">
              <span className="land-rail-k">{k}</span>
              <span className="land-rail-v">{v}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section divider ─────────────────────────────────────────── */}
      <SectionMark label="The client" index="01" />

      {/* ── Features bento ──────────────────────────────────────────── */}
      <section id="features" className="land-features">
        <div className="land-section-heading">
          <span className="land-section-kicker">Ocean, the client</span>
          <h2 className="land-section-title">
            A familiar workspace, with nothing bolted on after the fact.
          </h2>
          <p className="land-section-copy">
            Servers, channels, DMs, members, voice, and search sit exactly where
            you expect them. Underneath, every feature is a first-class part of
            the protocol — not a plugin pretending to be one.
          </p>
        </div>

        {/* Row 1 — Voice + Sessions */}
        <div className="land-bento-row land-bento-row-1">
          <article className="land-card land-card-voice">
            <div className="land-card-glow land-card-glow-accent" />
            <div className="land-card-inner">
              <div className="land-card-eyebrow land-eyebrow-accent">
                <span className="land-eyebrow-pip" />
                <VoiceIcon />
                <span>Voice &amp; video</span>
              </div>
              <h3 className="land-card-h3">Native media, no relay servers</h3>
              <p className="land-card-p">
                Voice and video are carried over the Orochi mesh itself — the same
                encrypted path as your messages. No external relay sits between
                you and the people you&rsquo;re talking to.
              </p>
              <div className="land-voice-vis" aria-hidden>
                <WaveformVis />
              </div>
            </div>
          </article>

          <article className="land-card land-card-session">
            <div className="land-card-glow land-card-glow-lux" />
            <div className="land-card-inner">
              <div className="land-card-eyebrow land-eyebrow-lux">
                <span className="land-eyebrow-pip land-eyebrow-pip-lux" />
                <TokenIcon />
                <span>Session resume</span>
              </div>
              <h3 className="land-card-h3">Sign in once. Stay in.</h3>
              <p className="land-card-p">
                After authentication, the engine issues a session token. Reconnect
                and your identity, channels, and history return — across tabs and
                devices — without re-entering a password.
              </p>
              <div className="land-token-display" aria-hidden>
                <div className="land-token-row">
                  <span className="land-token-prefix">SESSION&nbsp;RESUME&nbsp;</span>
                  <span className="land-token-body">4f8a2e…c1b9</span>
                </div>
                <div className="land-token-status">
                  <span className="land-token-dot" />
                  resumed · 3 clients on this account
                </div>
              </div>
            </div>
          </article>
        </div>

        {/* Row 2 — TSUMUGI (wide) */}
        <div className="land-bento-row land-bento-row-2">
          <article className="land-card land-card-tsumugi">
            <div className="land-card-glow land-card-glow-accent" />
            <div className="land-card-inner land-card-inner-split">
              <div className="land-card-text">
                <div className="land-card-eyebrow land-eyebrow-accent">
                  <span className="land-eyebrow-pip" />
                  <TsumugiIcon />
                  <span>TSUMUGI links</span>
                </div>
                <h3 className="land-card-h3">Post-quantum from the first byte</h3>
                <p className="land-card-p">
                  Every server link and media session is secured by a hybrid
                  handshake — classical X25519 combined with ML-KEM-768 — and a
                  forward-secret ratchet. Encryption is part of the protocol, so
                  there is no &ldquo;encrypted mode&rdquo; to forget to turn on.
                </p>
                <div className="land-chip-row" aria-hidden>
                  <span className="land-chip">X25519</span>
                  <span className="land-chip land-chip-lux">ML-KEM-768</span>
                  <span className="land-chip">Forward secrecy</span>
                  <span className="land-chip">Hybrid ratchet</span>
                </div>
              </div>
              <div className="land-tsumugi-diagram" aria-hidden>
                <TsumugiKeyVis />
              </div>
            </div>
          </article>
        </div>

        {/* Row 3 — small cards */}
        <div className="land-bento-row land-bento-row-3">
          <article className="land-card land-card-sm">
            <div className="land-card-glow land-card-glow-accent" />
            <div className="land-card-inner">
              <div className="land-card-eyebrow land-eyebrow-dim">
                <span className="land-eyebrow-pip land-eyebrow-pip-dim" />
                <MsgIcon />
                <span>Messaging</span>
              </div>
              <h3 className="land-card-h3">Rich messages &amp; threads</h3>
              <p className="land-card-p">
                Reactions, edits, replies, threads, embeds, and media cards —
                carried over standard IRCv3 message extensions.
              </p>
            </div>
          </article>

          <article className="land-card land-card-sm">
            <div className="land-card-glow land-card-glow-accent" />
            <div className="land-card-inner">
              <div className="land-card-eyebrow land-eyebrow-dim">
                <span className="land-eyebrow-pip land-eyebrow-pip-dim" />
                <IdIcon />
                <span>Identity</span>
              </div>
              <h3 className="land-card-h3">Real accounts, no bots</h3>
              <p className="land-card-p">
                REGISTER, VERIFY, IDENTIFY, GHOST, and CERTFP are server commands,
                not a NickServ pseudo-user. Your account is part of the engine.
              </p>
            </div>
          </article>

          <article className="land-card land-card-sm">
            <div className="land-card-glow land-card-glow-accent" />
            <div className="land-card-inner">
              <div className="land-card-eyebrow land-eyebrow-dim">
                <span className="land-eyebrow-pip land-eyebrow-pip-dim" />
                <IrcIcon />
                <span>Open surface</span>
              </div>
              <h3 className="land-card-h3">IRCv3 &amp; IRCX</h3>
              <p className="land-card-p">
                Ocean is the polished surface, but the network speaks open
                protocol. Bring any modern IRCv3 client over TLS and SASL.
              </p>
              <div className="land-irc-tag" aria-hidden>
                <span className="land-irc-tag-text">eshmaki.me:6697</span>
              </div>
            </div>
          </article>
        </div>
      </section>

      {/* ── Section divider ─────────────────────────────────────────── */}
      <SectionMark label="The engine" index="02" />

      {/* ── Engine / architecture ───────────────────────────────────── */}
      <section id="engine" className="land-engine">
        <div className="land-section-heading">
          <span className="land-section-kicker">Orochi engine</span>
          <h2 className="land-section-title">
            Not a fork. A clean-room engine, written in Zig.
          </h2>
          <p className="land-section-copy">
            Orochi was built from nothing — its own mesh, its own crypto, its own
            runtime. Four layers cooperate so a chat network can survive bad
            networks, hostile clients, and live upgrades without losing a session.
          </p>
        </div>

        <div className="land-arch">
          {([
            {
              n: '01',
              kicker: 'State',
              title: 'SUIMYAKU mesh',
              body: 'A multi-master CRDT mesh. Nodes gossip changes and reconcile with Merkle and rateless anti-entropy, so divergent servers always converge. A partition is a delay, not data loss — there are no netsplits that throw history away.',
              tags: ['CRDT', 'Gossip', 'Merkle anti-entropy', 'Multi-master'],
            },
            {
              n: '02',
              kicker: 'Transport',
              title: 'TSUMUGI links',
              body: 'Server-to-server and media sessions ride a post-quantum hybrid handshake — X25519 + ML-KEM-768 — with a forward-secret ratchet. The mesh also carries native voice and video, so media needs no STUN, no TURN, and no relay.',
              tags: ['Hybrid KEM', 'Forward secrecy', 'Native media'],
            },
            {
              n: '03',
              kicker: 'Runtime',
              title: 'Sharded reactors',
              body: 'A multithreaded core spreads connections across sharded reactors and a worker pool, instead of pinning everything to a single event loop. Throughput scales with cores on modern 64-bit hardware.',
              tags: ['Multithreaded', 'Worker pool', '64-bit'],
            },
            {
              n: '04',
              kicker: 'Operations',
              title: 'Helix hot-upgrade',
              body: 'The server can swap to a new build in place. Live sessions are migrated across the upgrade, so a deploy does not kick everyone offline. Ship fixes without a reconnect storm.',
              tags: ['Zero dropped sessions', 'In-place swap', 'Live migration'],
            },
          ] as Array<{ n: string; kicker: string; title: string; body: string; tags: string[] }>).map((row, i) => (
            <article key={row.n} className="land-arch-row" style={{ '--arch-i': i } as ArchCSSProps}>
              <div className="land-arch-index">
                <span className="land-arch-n">{row.n}</span>
                <span className="land-arch-kicker">{row.kicker}</span>
              </div>
              <div className="land-arch-body">
                <h3 className="land-arch-title">{row.title}</h3>
                <p className="land-arch-p">{row.body}</p>
                <div className="land-chip-row">
                  {row.tags.map((t) => (
                    <span key={t} className="land-chip">{t}</span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── Section divider ─────────────────────────────────────────── */}
      <SectionMark label="Inside the app" index="03" />

      {/* ── Product preview ────────────────────────────────────────── */}
      <section id="preview" className="land-preview">
        <div className="land-section-heading">
          <span className="land-section-kicker">Ocean app</span>
          <h2 className="land-section-title">Everything has a predictable place.</h2>
          <p className="land-section-copy">
            The server rail, channel list, conversation, and member list stay
            where muscle memory expects them — then identity, voice, session
            handoff, and moderation tools live exactly where you reach for them.
          </p>
        </div>

        <div className="land-app-preview" aria-label="Ocean app interface preview">
          <div className="land-preview-rail" aria-hidden>
            <div className="land-preview-orb land-preview-orb-active">O</div>
            <div className="land-preview-orb">#</div>
            <div className="land-preview-orb">+</div>
          </div>
          <div className="land-preview-sidebar">
            <div className="land-preview-server">eshmaki.me</div>
            <div className="land-preview-group">Channels</div>
            {['root', 'dev', 'art', 'lounge'].map((channel, index) => (
              <div key={channel} className={`land-preview-channel ${index === 0 ? 'land-preview-channel-active' : ''}`}>
                <span>#</span>
                {channel}
              </div>
            ))}
            <div className="land-preview-group">Voice</div>
            <div className="land-preview-channel land-preview-voice">
              <VoiceSmIcon />
              voice-1
            </div>
          </div>
          <div className="land-preview-chat">
            <div className="land-preview-chat-head">
              <div>
                <span>#</span>
                root
              </div>
              <div className="land-preview-tools">
                <span>Threads</span>
                <span>Search</span>
                <span>Media</span>
              </div>
            </div>
            <div className="land-preview-message">
              <div className="land-preview-avatar">k</div>
              <div>
                <div className="land-preview-name">kain <span>today</span></div>
                <p>Session resumed cleanly. Phone and desktop are both attached to the account.</p>
              </div>
            </div>
            <div className="land-preview-message">
              <div className="land-preview-avatar land-preview-avatar-lux">o</div>
              <div>
                <div className="land-preview-name">ocean <span>live</span></div>
                <p>Voice is up over TSUMUGI, linked to the channel, no relay in the path.</p>
                <div className="land-preview-pill-row">
                  <span>TSUMUGI active</span>
                  <span>3 clients</span>
                  <span>IRCv3</span>
                </div>
              </div>
            </div>
            <div className="land-preview-composer">Message #root</div>
          </div>
          <div className="land-preview-members">
            <div className="land-preview-group">Online</div>
            {['kain', 'trev', 'services', 'ocean'].map((nick) => (
              <div key={nick} className="land-preview-member">
                <span className="land-preview-presence" />
                {nick}
              </div>
            ))}
            <div className="land-preview-status">
              <strong>Network health</strong>
              <span>Links synced, sessions active, no relay dependency.</span>
            </div>
          </div>
        </div>
      </section>

      <ChanstatsPreview />

      {/* ── Section divider ─────────────────────────────────────────── */}
      <SectionMark label="Security" index="04" />

      {/* ── Security deep-dive ──────────────────────────────────────── */}
      <section id="security" className="land-security">
        <div className="land-section-heading">
          <span className="land-section-kicker">Security model</span>
          <h2 className="land-section-title">
            Designed so the hard parts are on by default.
          </h2>
          <p className="land-section-copy">
            Authentication, transport, and operations were chosen together. The
            secure path is the only path — there is no plaintext fallback to drift
            into.
          </p>
        </div>

        <div className="land-sec-grid">
          {([
            {
              icon: <ShieldIcon />,
              title: 'Authentication',
              body: 'SASL with PLAIN, SCRAM-SHA-256, and EXTERNAL. SCRAM keeps your password off the wire; EXTERNAL binds a client certificate (CERTFP). The engine, not a bot, owns your account.',
              note: 'SCRAM-SHA-256 · CERTFP',
            },
            {
              icon: <LockIcon />,
              title: 'Transport',
              body: 'Custom clean-room TLS terminates client connections. Between servers and media peers, TSUMUGI layers a post-quantum hybrid handshake with a forward-secret ratchet on top.',
              note: 'Clean-room TLS · PQ links',
            },
            {
              icon: <MeshGlyph />,
              title: 'Resilience',
              body: 'The CRDT mesh keeps every node honest about shared state. A partitioned server rejoins and reconciles instead of dropping messages, and there is no single relay to take the network down.',
              note: 'Multi-master · No relay',
            },
            {
              icon: <KeyIcon />,
              title: 'Sessions',
              body: 'Cryptographic session tokens replace stored passwords for resume. GHOST reclaims a stale session on your nick, and multiple clients can share one account without fighting over it.',
              note: 'Token resume · GHOST',
            },
          ] as Array<{ icon: ReactNode; title: string; body: string; note: string }>).map((c) => (
            <article key={c.title} className="land-sec-card">
              <div className="land-sec-icon">{c.icon}</div>
              <h3 className="land-sec-title">{c.title}</h3>
              <p className="land-sec-body">{c.body}</p>
              <div className="land-sec-note">{c.note}</div>
            </article>
          ))}
        </div>
      </section>

      {/* ── Capability matrix ───────────────────────────────────────── */}
      <section className="land-capabilities" aria-label="Ocean capabilities">
        <div className="land-section-heading land-section-heading-compact">
          <span className="land-section-kicker">Feature map</span>
          <h2 className="land-section-title">Built for real communities, not a demo room.</h2>
        </div>
        <div className="land-cap-grid">
          {([
            ['Conversation', ['Threaded replies', 'Reactions and edits', 'Pins, search, history', 'Embeds and media cards']],
            ['Voice and media', ['Channel voice and video', 'Carried over the mesh', 'Media gallery', 'Whiteboard collaboration']],
            ['Identity', ['SASL / SCRAM-SHA-256', 'Session resume tokens', 'Multi-client accounts', 'GHOST and CERTFP']],
            ['Operations', ['Built-in services', 'Moderation tooling', 'Channel browser', 'Live network status']],
          ] as Array<[string, string[]]>).map(([title, items]) => (
            <div key={title} className="land-cap-card">
              <h3>{title}</h3>
              <ul>
                {items.map((item) => (
                  <li key={item}>
                    <span className="land-cap-check" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── Built different ─────────────────────────────────────────── */}
      <section className="land-different">
        <div className="land-different-inner">
          <div className="land-different-copy">
            <span className="land-section-kicker">Engineering</span>
            <h2 className="land-different-h2">
              Most chat is rented infrastructure.
              <span className="land-different-em"> This one isn&rsquo;t.</span>
            </h2>
            <p className="land-different-p">
              Ocean and Orochi were written together, on purpose. The mesh, the
              crypto, the runtime, and the client share one design instead of
              gluing a UI onto someone else&rsquo;s stack. That&rsquo;s why voice
              has no relay, deploys keep your session, and the network has no
              third party to answer to.
            </p>
            <Link href="/about" className="land-btn-ghost land-btn-ghost-lg">
              Read the story
              <ArrowRight size={13} />
            </Link>
          </div>
          <ul className="land-different-list">
            {([
              ['Clean-room', 'No upstream fork. The engine, mesh, and crypto are original work.'],
              ['Pure Zig', 'A single 64-bit native binary with no garbage-collected runtime.'],
              ['No relays', 'Voice and video ride the mesh — there is no rented media path.'],
              ['Hot upgrades', 'Helix swaps the running server and carries live sessions across.'],
            ] as Array<[string, string]>).map(([k, v], i) => (
              <li key={k} className="land-different-item" style={{ '--di-i': i } as DiCSSProps}>
                <span className="land-different-k">{k}</span>
                <span className="land-different-v">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Connect ───────────────────────────────────────────────── */}
      <section id="connect" className="land-connect">
        <div className="land-section-heading">
          <span className="land-section-kicker">Connect</span>
          <h2 className="land-section-title">Use the web app, or bring your own client.</h2>
          <p className="land-section-copy">
            The website is the front door, Ocean is the full client, and the
            network stays open enough for standard IRC tooling.
          </p>
        </div>
        <div className="land-connect-grid">
          <div className="land-connect-card land-connect-card-primary">
            <span className="land-connect-label">Recommended</span>
            <h3>Ocean web app</h3>
            <p>Full chat, voice, media, session resume, settings, and community tooling — right in the browser.</p>
            <Link href="/login" className="land-connect-action">
              Launch Ocean <ArrowRight size={13} />
            </Link>
          </div>
          <div className="land-connect-card">
            <span className="land-connect-label">IRC</span>
            <h3>Direct TLS access</h3>
            <p>Any IRCv3 client with TLS and SASL can connect to the same network.</p>
            <code>eshmaki.me:6697</code>
          </div>
          <div className="land-connect-card">
            <span className="land-connect-label">Start here</span>
            <h3>Main channel</h3>
            <p>Join the shared lobby, see live community state, then branch into focused rooms.</p>
            <code>#root</code>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────── */}
      <section className="land-faq">
        <div className="land-section-heading land-section-heading-compact">
          <span className="land-section-kicker">FAQ</span>
          <h2 className="land-section-title">Answers before the first login.</h2>
        </div>
        <div className="land-faq-grid">
          {([
            ['Do I need the Ocean app?', 'No. Ocean is the polished web client, but the network speaks IRCv3, so any modern client with TLS and SASL can connect too.'],
            ['Where does my voice actually go?', 'Voice and video are carried over the Orochi mesh itself. There is no STUN, TURN, or external relay sitting between the people in a call.'],
            ['Can I stay signed in across devices?', 'Yes. The engine issues a session token after authentication, so reconnects resume your identity and history — and several clients can share one account at once.'],
            ['Is this a fork of an existing server?', 'No. Orochi is a clean-room, pure-Zig engine with its own CRDT mesh, post-quantum links, and runtime. It speaks open protocol but shares no upstream code.'],
            ['What happens during an upgrade?', 'Helix swaps the running server in place and migrates live sessions across, so a deploy does not disconnect everyone or wipe history.'],
            ['Where should I start?', 'Launch Ocean, sign in, and join #root. Channels, members, voice, search, and settings all live in the main workspace.'],
          ] as Array<[string, string]>).map(([question, answer]) => (
            <article key={question} className="land-faq-item">
              <h3>{question}</h3>
              <p>{answer}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────── */}
      <section className="land-community">
        <div className="land-community-bg" aria-hidden>
          <MeshVis muted />
        </div>
        <div className="land-community-inner">
          <div className="land-community-label">
            <span className="land-community-label-dot" />
            eshmaki.me
          </div>
          <h2 className="land-community-h2">
            One network.<br />Open all the way down.
          </h2>
          <p className="land-community-p">
            Start in{' '}
            <span className="land-channel-pill">#root</span> — the main gathering
            place — then branch into voice channels, project rooms, and late-night
            conversations. No bots, no relays, no landlord.
          </p>
          <div className="land-channels" aria-hidden>
            <div className="land-ch land-ch-active">
              <span className="land-ch-hash">#</span>
              <span>root</span>
              <span className="land-ch-live">LIVE</span>
            </div>
            <div className="land-ch land-ch-enter" style={{ '--ch-delay': '80ms' } as ChDelayCSSProps}>
              <span className="land-ch-hash">#</span>
              <span>dev</span>
            </div>
            <div className="land-ch land-ch-enter" style={{ '--ch-delay': '160ms' } as ChDelayCSSProps}>
              <span className="land-ch-hash">#</span>
              <span>art</span>
            </div>
            <div className="land-ch land-ch-enter" style={{ '--ch-delay': '240ms' } as ChDelayCSSProps}>
              <span className="land-ch-hash">#</span>
              <span>lounge</span>
            </div>
            <div className="land-ch land-ch-voice land-ch-enter" style={{ '--ch-delay': '320ms' } as ChDelayCSSProps}>
              <VoiceSmIcon />
              <span>voice-1</span>
            </div>
          </div>
          <div className="land-community-cta-group">
            <Link href="/login" className="land-btn-primary land-btn-lg">
              Launch Ocean
              <ArrowRight size={14} />
            </Link>
            <Link href="/about" className="land-btn-ghost land-btn-ghost-lg">
              Learn more
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="land-footer">
        <div className="land-footer-left">
          <div className="land-footer-logo">
            <OceanLogo size={20} />
            <span>Ocean</span>
          </div>
          <p className="land-footer-tagline">Ocean client · Orochi engine · eshmaki.me</p>
        </div>
        <nav className="land-footer-links" aria-label="Footer navigation">
          <Link href="/about" className="land-footer-link">About</Link>
          <Link href="/login" className="land-footer-link">Sign in</Link>
          <Link href="/app" className="land-footer-link">Launch ↗</Link>
        </nav>
        <p className="land-footer-copy">© 2026 eshmaki.me</p>
      </footer>

      <style>{LANDING_CSS}</style>
    </main>
  );
}

/* ── Section mark (editorial divider) ───────────────────────────────── */
function SectionMark({ label, index }: { label: string; index: string }) {
  return (
    <div className="land-mark" aria-hidden>
      <span className="land-mark-index">{index}</span>
      <span className="land-mark-rule" />
      <span className="land-mark-label">{label}</span>
      <span className="land-mark-rule" />
    </div>
  );
}

// ── Custom CSS property types ───────────────────────────────────────────────
type ChDelayCSSProps = CSSProperties & { '--ch-delay'?: string };
type ArchCSSProps = CSSProperties & { '--arch-i'?: number };
type DiCSSProps = CSSProperties & { '--di-i'?: number };

// ── SVG components ─────────────────────────────────────────────────────────

function OceanLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden>
      <circle cx="14" cy="14" r="12" stroke="var(--lux)" strokeWidth="1.4" fill="var(--lux-subtle)" />
      <path d="M4 14c3-4 6-4 6 0s3 4 6 0 3-4 6 0" stroke="var(--lux)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M4 17c3-3 6-3 6 0s3 3 6 0 3-3 6 0" stroke="var(--accent)" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.6" />
    </svg>
  );
}

function ArrowRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 7h9M8 3.5L11.5 7 8 10.5" />
    </svg>
  );
}

function VoiceIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M7.5 1a2 2 0 0 0-2 2v4.5a2 2 0 0 0 4 0V3a2 2 0 0 0-2-2z" />
      <path d="M3.5 6.5a4 4 0 0 0 8 0" strokeLinecap="round" />
      <path d="M7.5 10.5v3" strokeLinecap="round" />
    </svg>
  );
}

function TokenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="2" y="4" width="11" height="7.5" rx="1.5" />
      <path d="M5 7.5h5M5 9.5h3" strokeLinecap="round" />
      <circle cx="11" cy="4" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TsumugiIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M7.5 1L2 4v5c0 3.5 2.5 6.5 5.5 7.5C10.5 15.5 13 12.5 13 9V4L7.5 1z" strokeLinejoin="round" />
      <path d="M5.5 7.5l1.5 1.5 3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IrcIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2 3a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V3z" strokeLinejoin="round" />
      <path d="M5 6h5M5 8.5h3" strokeLinecap="round" />
    </svg>
  );
}

function MsgIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M13 1.5H2A1.5 1.5 0 0 0 .5 3v7A1.5 1.5 0 0 0 2 11.5h2.5L7.5 14l3-2.5H13a1.5 1.5 0 0 0 1.5-1.5V3A1.5 1.5 0 0 0 13 1.5z" />
      <path d="M4.5 5.5h6M4.5 8h4" strokeLinecap="round" />
    </svg>
  );
}

function IdIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="1.5" y="3" width="12" height="9" rx="1.5" />
      <circle cx="5" cy="7" r="1.6" />
      <path d="M3 10.5c.4-1.2 1.1-1.6 2-1.6s1.6.4 2 1.6M9 6h3M9 8.5h2.2" strokeLinecap="round" />
    </svg>
  );
}

function VoiceSmIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M6 1a1.5 1.5 0 0 0-1.5 1.5v3a1.5 1.5 0 0 0 3 0V2.5A1.5 1.5 0 0 0 6 1z" />
      <path d="M2.5 5a3.5 3.5 0 0 0 7 0M6 8.5V11" strokeLinecap="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M10 1.5L3 4v5c0 4.5 3.2 8.3 7 9.5 3.8-1.2 7-5 7-9.5V4l-7-2.5z" strokeLinejoin="round" />
      <path d="M7 10l2 2 4-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="3.5" y="8.5" width="13" height="9" rx="2" />
      <path d="M6 8.5V6a4 4 0 0 1 8 0v2.5" strokeLinecap="round" />
      <circle cx="10" cy="13" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="6.5" cy="7" r="3.5" />
      <path d="M9 9.5l6 6M13 13.5l1.6-1.6M14.8 15.3l1.6-1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MeshGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <circle cx="10" cy="3.5" r="1.8" />
      <circle cx="4" cy="14" r="1.8" />
      <circle cx="16" cy="14" r="1.8" />
      <path d="M10 5.3L5 12.4M10 5.3l5 7.1M5.5 14h9" strokeLinecap="round" />
    </svg>
  );
}

// ── Mesh visualization (hero + CTA backdrop) ───────────────────────────────

function MeshVis({ muted = false }: { muted?: boolean }) {
  const nodes: Array<[number, number, number]> = [
    [210, 110, 1], // primary
    [110, 60, 0],
    [320, 70, 0],
    [70, 190, 0],
    [350, 200, 0],
    [200, 250, 0],
    [150, 160, 0],
    [270, 165, 0],
  ];
  const edges: Array<[number, number]> = [
    [0, 1], [0, 2], [0, 6], [0, 7], [1, 6], [2, 7],
    [6, 3], [7, 4], [6, 5], [7, 5], [3, 5], [4, 5], [1, 2],
  ];
  return (
    <svg
      width="420"
      height="320"
      viewBox="0 0 420 320"
      fill="none"
      role="img"
      aria-label="Orochi mesh: a primary node gossiping with peer servers"
      className={muted ? 'land-meshvis land-meshvis-muted' : 'land-meshvis'}
    >
      <defs>
        <radialGradient id="mesh-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--lux)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--lux)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="mesh-bg" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.10" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="420" height="320" fill="url(#mesh-bg)" />

      {/* edges */}
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a][0]} y1={nodes[a][1]}
          x2={nodes[b][0]} y2={nodes[b][1]}
          stroke="var(--accent)"
          strokeOpacity={a === 0 || b === 0 ? 0.45 : 0.22}
          strokeWidth={a === 0 || b === 0 ? 1.2 : 1}
        />
      ))}

      {/* gossip pulses along primary edges */}
      {!muted && edges.filter(([a, b]) => a === 0 || b === 0).map(([a, b], i) => {
        const [x1, y1] = nodes[a];
        const [x2, y2] = nodes[b];
        return (
          <circle key={`p${i}`} r="2.4" fill="var(--lux)">
            <animate attributeName="cx" values={`${x1};${x2};${x1}`} dur={`${3.4 + i * 0.5}s`} repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" />
            <animate attributeName="cy" values={`${y1};${y2};${y1}`} dur={`${3.4 + i * 0.5}s`} repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" />
            <animate attributeName="opacity" values="0;0.9;0" dur={`${3.4 + i * 0.5}s`} repeatCount="indefinite" />
          </circle>
        );
      })}

      {/* nodes */}
      {nodes.map(([cx, cy, primary], i) => (
        <g key={i}>
          {primary === 1 && (
            <>
              <circle cx={cx} cy={cy} r="46" fill="url(#mesh-core)" />
              {!muted && (
                <circle cx={cx} cy={cy} r="22" fill="none" stroke="var(--lux)" strokeOpacity="0.35" strokeWidth="1">
                  <animate attributeName="r" values="22;40;22" dur="3.6s" repeatCount="indefinite" />
                  <animate attributeName="stroke-opacity" values="0.4;0;0.4" dur="3.6s" repeatCount="indefinite" />
                </circle>
              )}
            </>
          )}
          <circle
            cx={cx} cy={cy}
            r={primary === 1 ? 9 : 5}
            fill={primary === 1 ? 'var(--lux)' : 'var(--bg-overlay)'}
            stroke={primary === 1 ? 'var(--lux)' : 'var(--accent)'}
            strokeOpacity={primary === 1 ? 1 : 0.7}
            strokeWidth="1.4"
          />
        </g>
      ))}
    </svg>
  );
}

// ── Waveform visualization ─────────────────────────────────────────────────

function WaveformVis() {
  const bars = [0.3, 0.5, 0.8, 1.0, 0.7, 0.9, 0.6, 0.4, 0.8, 0.7, 0.5, 0.9, 1.0, 0.6, 0.3, 0.7, 0.9, 0.5, 0.4, 0.8];
  return (
    <svg width="100%" height="60" viewBox="0 0 200 60" preserveAspectRatio="none" role="img" aria-label="Audio waveform">
      <defs>
        <linearGradient id="waveform-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      {bars.map((h, i) => {
        const barH = h * 48;
        const peakH = barH * (0.72 + (i % 6) * 0.08);
        const x = i * (200 / bars.length) + 2;
        const barW = 200 / bars.length - 4;
        return (
          <rect key={i}
            x={x} y={(60 - barH) / 2}
            width={barW} height={barH}
            rx="2" fill="url(#waveform-grad)"
            opacity={0.5 + h * 0.4}>
            <animate
              attributeName="height"
              values={`${barH};${peakH};${barH}`}
              dur={`${1.2 + (i % 5) * 0.3}s`}
              repeatCount="indefinite"
              begin={`${i * 0.08}s`}
              calcMode="spline"
              keySplines="0.45 0 0.55 1;0.45 0 0.55 1"
            />
            <animate
              attributeName="y"
              values={`${(60 - barH) / 2};${(60 - peakH) / 2};${(60 - barH) / 2}`}
              dur={`${1.2 + (i % 5) * 0.3}s`}
              repeatCount="indefinite"
              begin={`${i * 0.08}s`}
              calcMode="spline"
              keySplines="0.45 0 0.55 1;0.45 0 0.55 1"
            />
          </rect>
        );
      })}
    </svg>
  );
}

// ── TSUMUGI key exchange visualization ──────────────────────────────────────

function TsumugiKeyVis() {
  return (
    <svg width="220" height="170" viewBox="0 0 220 170" fill="none" role="img" aria-label="TSUMUGI hybrid key exchange: X25519 and ML-KEM-768 combine into a shared secret">
      <defs>
        <radialGradient id="tsumugi-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.30" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="shared-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--lux)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--lux)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Left node */}
      <circle cx="42" cy="85" r="30" fill="url(#tsumugi-glow)" />
      <circle cx="42" cy="85" r="30" fill="var(--accent-subtle)" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.4" />
      <g transform="translate(28, 71)" stroke="var(--accent)" strokeWidth="1.3" fill="none">
        <circle cx="9" cy="9" r="7" />
        <rect x="14" y="7" width="10" height="4" rx="1" />
        <rect x="21" y="11" width="3" height="3" rx="0.5" fill="var(--accent)" stroke="none" />
      </g>
      <text x="42" y="128" textAnchor="middle" fill="var(--accent)" fillOpacity="0.85" fontSize="8" fontFamily="var(--font-mono)" fontWeight="600">X25519</text>

      {/* Right node */}
      <circle cx="178" cy="85" r="30" fill="var(--accent-subtle)" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.4" />
      <g transform="translate(163, 71)" stroke="var(--accent)" strokeWidth="1.3" fill="none">
        <rect x="1" y="8" width="13" height="11" rx="2" fill="var(--accent-subtle)" />
        <path d="M4 8V5.5a3.5 3.5 0 0 1 7 0V8" />
        <circle cx="7.5" cy="13" r="1.5" fill="var(--accent)" stroke="none" />
      </g>
      <text x="178" y="128" textAnchor="middle" fill="var(--accent)" fillOpacity="0.85" fontSize="7.5" fontFamily="var(--font-mono)" fontWeight="600">ML-KEM-768</text>

      {/* Center shared secret */}
      <circle cx="110" cy="85" r="24" fill="url(#shared-glow)" />
      <circle cx="110" cy="85" r="22" fill="var(--lux-subtle)" stroke="var(--lux)" strokeOpacity="0.6" strokeWidth="1.5">
        <animate attributeName="stroke-opacity" values="0.5;0.9;0.5" dur="2.6s" repeatCount="indefinite" />
      </circle>
      <path d="M100 85l7 7 13-13" stroke="var(--lux)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="110" y="122" textAnchor="middle" fill="var(--lux)" fillOpacity="0.85" fontSize="8" fontFamily="var(--font-mono)" fontWeight="600">SHARED KEY</text>

      {/* Exchange arcs */}
      <path d="M70 72 Q110 42 150 72" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" fill="none" strokeDasharray="5 4">
        <animate attributeName="stroke-dashoffset" values="0;-18" dur="1.6s" repeatCount="indefinite" />
      </path>
      <polygon points="148,70 155,73 147,76" fill="var(--accent)" fillOpacity="0.7" />
      <path d="M150 98 Q110 128 70 98" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" fill="none" strokeDasharray="5 4">
        <animate attributeName="stroke-dashoffset" values="0;-18" dur="1.6s" repeatCount="indefinite" />
      </path>
      <polygon points="72,96 65,99 73,102" fill="var(--accent)" fillOpacity="0.7" />
    </svg>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const LANDING_CSS = `
  /* ════════════════════════════════════════════════════════════
     OCEAN LANDING — DARK LACQUER / EDITORIAL
     ════════════════════════════════════════════════════════════ */

  /* Override the app shell's global overflow so this page scrolls */
  html, body { overflow: auto; overflow-x: hidden; }

  /* ── Skip link ── */
  .land-skip-link {
    position: absolute; top: -48px; left: 0;
    background: var(--lux); color: var(--bg-void);
    padding: 8px 16px; text-decoration: none; z-index: 9999;
    border-radius: 0 0 8px 0; transition: top 150ms var(--ease-out);
    font-size: 14px; font-weight: 700;
  }
  .land-skip-link:focus { top: 0; }

  .land-root {
    background: var(--bg-void);
    color: var(--text-primary);
    min-height: 100dvh;
    overflow-x: clip;
    font-family: var(--font-ui);
    --land-gutter: clamp(20px, 5vw, 80px);
    --land-max: 1200px;
  }

  /* ── Atmosphere ── */
  .land-atmos { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
  .land-atmos-halo {
    position: absolute; top: -22vh; left: 50%; transform: translateX(-50%);
    width: min(1100px, 120vw); height: 70vh; border-radius: 50%;
    background: radial-gradient(ellipse at center,
      color-mix(in srgb, var(--lux) 9%, transparent) 0%,
      transparent 62%);
    opacity: 0.9;
  }
  .land-atmos-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(var(--border-subtle) 1px, transparent 1px),
      linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
    background-size: 64px 64px;
    -webkit-mask-image: radial-gradient(ellipse 80% 50% at 50% 0%, black, transparent 75%);
    mask-image: radial-gradient(ellipse 80% 50% at 50% 0%, black, transparent 75%);
    opacity: 0.5;
  }
  .land-atmos-grain {
    position: absolute; inset: 0; opacity: 0.04; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E");
  }

  @media (prefers-reduced-motion: reduce) {
    .land-badge-dot, .land-token-dot, .land-community-label-dot, .land-ch-enter,
    .land-meshvis * { animation: none !important; }
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      scroll-behavior: auto !important;
    }
  }

  /* ── Nav ── */
  .land-nav {
    position: fixed; top: 0; left: 0; right: 0; z-index: 200;
    display: flex; align-items: center; justify-content: space-between;
    padding: env(safe-area-inset-top, 0px) var(--land-gutter) 0;
    height: calc(62px + env(safe-area-inset-top, 0px));
    background: color-mix(in srgb, var(--bg-void) 74%, transparent);
    backdrop-filter: blur(24px) saturate(1.4);
    border-bottom: 1px solid var(--border-subtle);
  }
  .land-nav-logo { display: flex; align-items: center; gap: 9px; }
  .land-nav-wordmark {
    font-family: var(--font-display);
    font-size: 18px; font-weight: 600; letter-spacing: -0.01em;
    color: var(--text-primary);
  }
  .land-nav-sep { color: var(--border-normal); font-weight: 300; }
  .land-nav-engine {
    font-family: var(--font-mono); font-size: 11px; font-weight: 600;
    letter-spacing: 0.14em; text-transform: uppercase; color: var(--lux);
  }
  .land-nav-links { display: flex; align-items: center; gap: 22px; }
  .land-nav-link {
    font-size: 13.5px; font-weight: 500; color: var(--text-secondary);
    text-decoration: none; transition: color 0.2s var(--ease-out);
    position: relative;
  }
  .land-nav-link::after {
    content: ''; position: absolute; left: 0; right: 100%; bottom: -6px;
    height: 1px; background: var(--lux); transition: right 0.25s var(--ease-out);
  }
  .land-nav-link:hover { color: var(--text-primary); text-decoration: none; }
  .land-nav-link:hover::after { right: 0; }
  .land-nav-cta {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 13px; font-weight: 700; color: var(--bg-void);
    background: var(--lux); text-decoration: none;
    padding: 8px 16px; border-radius: var(--r-full);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--lux) 40%, transparent), 0 8px 22px rgba(0,0,0,0.4);
    transition: transform 0.18s var(--ease-out), filter 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out);
  }
  .land-nav-cta:hover {
    transform: translateY(-1px); filter: brightness(1.06);
    text-decoration: none; color: var(--bg-void);
    box-shadow: 0 0 0 1px var(--lux), var(--glow), 0 10px 26px rgba(0,0,0,0.5);
  }

  /* ── Hero ── */
  .land-hero {
    position: relative; z-index: 1;
    padding: calc(160px + env(safe-area-inset-top, 0px)) var(--land-gutter) 90px;
    min-height: 100dvh; display: flex; align-items: center;
  }
  .land-hero-body {
    width: 100%; max-width: var(--land-max); margin: 0 auto;
    display: grid; grid-template-columns: 1.08fr 0.92fr; gap: 72px; align-items: center;
  }
  @media (max-width: 860px) {
    .land-hero-body { grid-template-columns: 1fr; gap: 40px; }
    .land-hero-visual { order: -1; max-width: 420px; }
  }

  .land-hero-copy { display: flex; flex-direction: column; gap: 30px; }

  .land-badge {
    display: inline-flex; align-items: center; gap: 9px;
    font-family: var(--font-mono);
    font-size: 11px; font-weight: 600; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--text-secondary);
    padding: 6px 13px; border-radius: var(--r-full);
    background: color-mix(in srgb, var(--bg-elevated) 70%, transparent);
    border: 1px solid var(--border-normal);
    width: fit-content;
  }
  .land-badge-dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
    background: var(--lux); box-shadow: 0 0 8px var(--lux);
    animation: dot-pulse 2.4s ease-in-out infinite;
  }
  @keyframes dot-pulse {
    0%, 100% { box-shadow: 0 0 4px color-mix(in srgb, var(--lux) 60%, transparent); }
    50%       { box-shadow: 0 0 12px var(--lux); }
  }

  .land-h1 {
    font-family: var(--font-display);
    font-size: clamp(2.7rem, 1.4rem + 5.6vw, 5.4rem);
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.02;
    color: var(--text-primary);
    margin: 0;
    text-wrap: balance;
  }
  .land-h1-accent {
    color: var(--lux);
    font-style: italic;
    font-weight: 500;
  }
  .land-h1-tail { color: var(--text-primary); }

  .land-lead {
    font-size: clamp(1.02rem, 0.9rem + 0.5vw, 1.18rem);
    line-height: 1.72; color: var(--text-secondary); margin: 0; max-width: 36em;
  }
  .land-lead-strong { color: var(--text-primary); font-weight: 600; }

  .land-hero-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }

  .land-btn-primary {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 14px 28px; border-radius: var(--r-md);
    font-size: 14px; font-weight: 700; color: var(--bg-void);
    background: var(--lux);
    text-decoration: none; letter-spacing: 0.01em;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.2), 0 14px 30px rgba(0,0,0,0.4);
    transition: transform 0.2s var(--ease-out), filter 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out);
  }
  .land-btn-primary:hover {
    transform: translateY(-2px); filter: brightness(1.07);
    color: var(--bg-void); text-decoration: none;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.2), var(--glow), 0 18px 38px rgba(0,0,0,0.5);
  }
  .land-btn-primary:active { transform: translateY(0); }
  .land-btn-primary:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 3px; }

  .land-btn-ghost {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 14px 24px; border-radius: var(--r-md);
    font-size: 14px; font-weight: 600;
    color: var(--text-secondary); text-decoration: none;
    border: 1px solid var(--border-normal);
    background: color-mix(in srgb, var(--bg-elevated) 50%, transparent);
    transition: color 0.2s, border-color 0.2s, background 0.2s, transform 0.2s var(--ease-out);
  }
  .land-btn-ghost:hover {
    color: var(--text-primary); border-color: var(--lux);
    background: color-mix(in srgb, var(--bg-elevated) 80%, transparent);
    text-decoration: none; transform: translateY(-1px);
  }
  .land-btn-ghost:focus-visible { outline: 2px solid var(--lux); outline-offset: 3px; }
  .land-btn-lg { padding: 16px 34px; font-size: 15px; }
  .land-btn-ghost-lg { padding: 14px 26px; font-size: 15px; }

  /* Hero stats */
  .land-hero-stats {
    display: flex; align-items: center; gap: 22px; flex-wrap: wrap; margin: 4px 0 0;
  }
  .land-hs { display: flex; flex-direction: column; gap: 4px; }
  .land-hs dt {
    font-family: var(--font-mono); font-size: 10px; font-weight: 600;
    letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-muted);
  }
  .land-hs dd {
    margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary);
    letter-spacing: -0.01em;
  }
  .land-hs-rule { width: 1px; height: 30px; background: var(--border-normal); flex-shrink: 0; }

  /* Hero visual */
  .land-hero-visual { display: flex; align-items: center; justify-content: center; }
  .land-meshvis { width: 100%; height: auto; max-width: 460px; }

  /* ── Credential rail ── */
  .land-rail {
    position: relative; z-index: 1;
    padding: 0 var(--land-gutter) 18px;
  }
  .land-rail-inner {
    max-width: var(--land-max); margin: 0 auto;
    display: grid; grid-template-columns: repeat(5, 1fr);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-lg);
    background: color-mix(in srgb, var(--bg-base) 60%, transparent);
    overflow: hidden;
  }
  .land-rail-item {
    display: flex; flex-direction: column; gap: 5px;
    padding: 18px 20px;
    border-right: 1px solid var(--border-subtle);
  }
  .land-rail-item:last-child { border-right: 0; }
  .land-rail-k {
    font-family: var(--font-mono); font-size: 10px; font-weight: 600;
    letter-spacing: 0.16em; text-transform: uppercase; color: var(--lux);
  }
  .land-rail-v { font-size: 13px; font-weight: 600; color: var(--text-secondary); line-height: 1.3; }
  @media (max-width: 860px) {
    .land-rail-inner { grid-template-columns: repeat(2, 1fr); }
    .land-rail-item:nth-child(2n) { border-right: 0; }
    .land-rail-item { border-bottom: 1px solid var(--border-subtle); }
    .land-rail-item:nth-last-child(-n+1) { border-bottom: 0; }
  }
  @media (max-width: 480px) { .land-rail-inner { grid-template-columns: 1fr; } }

  /* ── Section mark ── */
  .land-mark {
    position: relative; z-index: 1;
    max-width: var(--land-max); margin: 70px auto 6px; padding: 0 var(--land-gutter);
    display: flex; align-items: center; gap: 16px;
  }
  .land-mark-index {
    font-family: var(--font-mono); font-size: 11px; font-weight: 700;
    letter-spacing: 0.1em; color: var(--lux);
  }
  .land-mark-label {
    font-family: var(--font-mono); font-size: 11px; font-weight: 600;
    letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-muted);
    white-space: nowrap;
  }
  .land-mark-rule { flex: 1; height: 1px; background: linear-gradient(90deg, var(--border-normal), transparent); }
  .land-mark-rule:last-child { background: linear-gradient(90deg, transparent, var(--border-subtle)); }

  /* ── Shared section headings ── */
  .land-section-heading {
    position: relative; z-index: 1; max-width: 760px; margin: 0 auto 36px;
    text-align: center; display: flex; flex-direction: column; align-items: center; gap: 14px;
  }
  .land-section-heading-compact { margin-bottom: 26px; }
  .land-section-kicker {
    display: inline-flex; align-items: center; width: fit-content;
    padding: 5px 11px; border-radius: var(--r-full);
    border: 1px solid var(--border-normal);
    background: var(--lux-subtle);
    color: var(--lux);
    font-family: var(--font-mono);
    font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
  }
  .land-section-title {
    margin: 0; color: var(--text-primary);
    font-family: var(--font-display);
    font-size: clamp(1.9rem, 1.2rem + 2.6vw, 3rem);
    font-weight: 600; line-height: 1.08; letter-spacing: -0.02em; text-wrap: balance;
  }
  .land-section-copy {
    margin: 0; color: var(--text-secondary);
    font-size: clamp(0.98rem, 0.94rem + 0.3vw, 1.1rem); line-height: 1.68; max-width: 60ch;
  }

  /* ── Features ── */
  .land-features {
    position: relative; z-index: 1;
    padding: 0 var(--land-gutter) 30px; max-width: var(--land-max); margin: 0 auto;
    display: flex; flex-direction: column; gap: 14px;
  }
  .land-features .land-section-heading { margin-bottom: 20px; }

  .land-bento-row { display: grid; gap: 14px; }
  .land-bento-row-1 { grid-template-columns: 1fr 1fr; }
  .land-bento-row-2 { grid-template-columns: 1fr; }
  .land-bento-row-3 { grid-template-columns: repeat(3, 1fr); }
  @media (max-width: 768px) {
    .land-bento-row-1 { grid-template-columns: 1fr; }
    .land-bento-row-3 { grid-template-columns: 1fr; }
  }

  /* Cards */
  .land-card {
    position: relative; overflow: hidden;
    background: color-mix(in srgb, var(--bg-base) 82%, transparent);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-xl);
    transition: border-color 0.3s var(--ease-out), transform 0.25s var(--ease-out), box-shadow 0.3s var(--ease-out);
  }
  .land-card:hover {
    border-color: var(--border-normal);
    transform: translateY(-3px);
    box-shadow: var(--elev-shadow-2), 0 0 28px rgba(0,0,0,0.4);
  }
  .land-card-glow {
    position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
    opacity: 0; transition: opacity 0.4s var(--ease-out);
  }
  .land-card:hover .land-card-glow { opacity: 1; }
  .land-card-glow-accent { background: radial-gradient(circle at 25% 0%, var(--accent-subtle) 0%, transparent 62%); }
  .land-card-glow-lux { background: radial-gradient(circle at 80% 0%, var(--lux-subtle) 0%, transparent 60%); }

  .land-card::before {
    content: ''; position: absolute; top: 0; left: 22px; right: 22px; height: 1px;
    background: linear-gradient(90deg, transparent, var(--lux), transparent);
    opacity: 0.25; transition: opacity 0.3s;
  }
  .land-card:hover::before { opacity: 0.7; }

  .land-card-inner { padding: 30px 28px; display: flex; flex-direction: column; gap: 14px; }
  .land-card-inner-split { flex-direction: row; gap: 48px; align-items: center; }
  @media (max-width: 768px) { .land-card-inner-split { flex-direction: column; gap: 26px; } }
  .land-card-text { flex: 1; display: flex; flex-direction: column; gap: 14px; }

  .land-card-eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    font-family: var(--font-mono);
    font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
    padding: 5px 11px 5px 9px; border-radius: var(--r-sm); width: fit-content;
  }
  .land-eyebrow-accent { color: var(--accent); background: var(--accent-subtle); border: 1px solid var(--accent-border); }
  .land-eyebrow-lux { color: var(--lux); background: var(--lux-subtle); border: 1px solid color-mix(in srgb, var(--lux) 30%, transparent); }
  .land-eyebrow-dim { color: var(--text-muted); background: color-mix(in srgb, var(--bg-elevated) 60%, transparent); border: 1px solid var(--border-subtle); }
  .land-card-eyebrow svg { flex-shrink: 0; }
  .land-eyebrow-pip { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; background: currentColor; }
  .land-eyebrow-pip-lux { background: var(--lux); }
  .land-eyebrow-pip-dim { background: var(--text-muted); }

  .land-card-h3 {
    font-family: var(--font-display);
    font-size: 1.32rem; font-weight: 600; letter-spacing: -0.015em;
    color: var(--text-primary); margin: 0; line-height: 1.22;
  }
  .land-card-p { font-size: 0.9rem; line-height: 1.66; color: var(--text-secondary); margin: 0; }

  .land-voice-vis { margin-top: 10px; height: 60px; display: flex; align-items: center; }

  .land-token-display { margin-top: 10px; display: flex; flex-direction: column; gap: 7px; }
  .land-token-row {
    font-family: var(--font-mono); font-size: 12px;
    padding: 9px 12px; border-radius: var(--r-md);
    background: color-mix(in srgb, var(--bg-void) 70%, transparent);
    border: 1px solid var(--border-normal);
    display: flex; align-items: center; flex-wrap: wrap;
  }
  .land-token-prefix { color: var(--text-muted); }
  .land-token-body { color: var(--lux); }
  .land-token-status { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--status-online); }
  .land-token-dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
    background: var(--status-online); box-shadow: 0 0 6px color-mix(in srgb, var(--status-online) 60%, transparent);
    animation: dot-pulse 2.4s ease-in-out infinite;
  }

  /* Chips */
  .land-chip-row { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 4px; }
  .land-chip {
    font-family: var(--font-mono);
    font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
    padding: 4px 9px; border-radius: var(--r-sm);
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--bg-elevated) 60%, transparent);
    border: 1px solid var(--border-normal);
  }
  .land-chip-lux { color: var(--lux); background: var(--lux-subtle); border-color: color-mix(in srgb, var(--lux) 30%, transparent); }

  .land-tsumugi-diagram { flex-shrink: 0; align-self: center; }
  @media (max-width: 768px) { .land-tsumugi-diagram { align-self: center; } }

  .land-irc-tag { margin-top: 8px; display: inline-flex; }
  .land-irc-tag-text {
    font-family: var(--font-mono); font-size: 11px;
    color: var(--lux); background: var(--lux-subtle);
    border: 1px solid color-mix(in srgb, var(--lux) 28%, transparent);
    padding: 5px 11px; border-radius: var(--r-sm); letter-spacing: 0.02em;
  }

  /* ── Engine / architecture ── */
  .land-engine {
    position: relative; z-index: 1;
    max-width: var(--land-max); margin: 0 auto; padding: 0 var(--land-gutter) 30px;
  }
  .land-arch { display: flex; flex-direction: column; gap: 12px; }
  .land-arch-row {
    display: grid; grid-template-columns: 180px 1fr; gap: 36px;
    padding: 30px 32px;
    border: 1px solid var(--border-subtle); border-radius: var(--r-xl);
    background: color-mix(in srgb, var(--bg-base) 76%, transparent);
    position: relative; overflow: hidden;
    transition: border-color 0.3s var(--ease-out), transform 0.25s var(--ease-out), box-shadow 0.3s var(--ease-out);
  }
  .land-arch-row::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
    background: linear-gradient(180deg, var(--lux), transparent);
    opacity: 0.4; transition: opacity 0.3s;
  }
  .land-arch-row:hover {
    border-color: var(--border-normal); transform: translateX(4px);
    box-shadow: var(--elev-shadow-1);
  }
  .land-arch-row:hover::before { opacity: 1; }
  .land-arch-index { display: flex; flex-direction: column; gap: 8px; }
  .land-arch-n {
    font-family: var(--font-display); font-size: 2.4rem; font-weight: 500;
    line-height: 1; color: var(--lux); letter-spacing: -0.02em;
  }
  .land-arch-kicker {
    font-family: var(--font-mono); font-size: 10px; font-weight: 600;
    letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-muted);
  }
  .land-arch-body { display: flex; flex-direction: column; gap: 12px; }
  .land-arch-title {
    font-family: var(--font-display);
    font-size: 1.35rem; font-weight: 600; letter-spacing: -0.015em;
    color: var(--text-primary); margin: 0;
  }
  .land-arch-p { margin: 0; font-size: 0.94rem; line-height: 1.7; color: var(--text-secondary); max-width: 62ch; }
  @media (max-width: 768px) {
    .land-arch-row { grid-template-columns: 1fr; gap: 16px; padding: 24px 20px; }
    .land-arch-index { flex-direction: row; align-items: baseline; gap: 14px; }
    .land-arch-row:hover { transform: translateY(-2px); }
  }

  /* ── Product preview ── */
  .land-preview {
    position: relative; z-index: 1;
    padding: 0 var(--land-gutter) 80px; max-width: var(--land-max); margin: 0 auto;
  }
  .land-app-preview {
    display: grid; grid-template-columns: 72px 220px minmax(0, 1fr) 200px;
    min-height: 440px; overflow: hidden;
    border-radius: var(--r-2xl);
    border: 1px solid var(--border-normal);
    background:
      linear-gradient(180deg, var(--lux-subtle), transparent 30%),
      color-mix(in srgb, var(--bg-base) 92%, transparent);
    box-shadow: var(--elev-shadow-3);
  }
  .land-preview-rail, .land-preview-sidebar, .land-preview-chat, .land-preview-members {
    min-width: 0; border-right: 1px solid var(--border-subtle);
  }
  .land-preview-rail {
    display: flex; flex-direction: column; align-items: center; gap: 12px;
    padding: 18px 0; background: color-mix(in srgb, var(--bg-void) 50%, transparent);
  }
  .land-preview-orb {
    width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center;
    color: var(--text-muted); background: var(--bg-elevated);
    border: 1px solid var(--border-subtle); font-size: 13px; font-weight: 800;
  }
  .land-preview-orb-active {
    color: var(--bg-void); background: var(--lux);
    border-color: var(--lux); box-shadow: var(--glow);
  }
  .land-preview-sidebar { padding: 18px 14px; background: color-mix(in srgb, var(--bg-void) 28%, transparent); }
  .land-preview-server { color: var(--text-primary); font-size: 14px; font-weight: 800; margin-bottom: 18px; font-family: var(--font-display); }
  .land-preview-group {
    color: var(--text-muted); font-size: 10px; font-weight: 800; font-family: var(--font-mono);
    letter-spacing: 0.12em; text-transform: uppercase; margin: 16px 0 8px;
  }
  .land-preview-channel, .land-preview-member {
    display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px;
    border-radius: var(--r-md); color: var(--text-secondary); font-size: 13px; font-weight: 600;
  }
  .land-preview-channel span { color: var(--text-muted); font-family: var(--font-mono); }
  .land-preview-channel-active {
    color: var(--lux); background: var(--lux-subtle);
    border: 1px solid color-mix(in srgb, var(--lux) 28%, transparent);
  }
  .land-preview-channel-active span { color: var(--lux); }
  .land-preview-voice {
    color: var(--status-online); background: color-mix(in srgb, var(--status-online) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--status-online) 22%, transparent);
  }
  .land-preview-voice svg { width: 12px; height: 12px; }
  .land-preview-chat { display: flex; flex-direction: column; background: color-mix(in srgb, var(--bg-void) 22%, transparent); }
  .land-preview-chat-head {
    min-height: 58px; display: flex; align-items: center; justify-content: space-between;
    gap: 16px; padding: 0 20px; border-bottom: 1px solid var(--border-subtle);
    color: var(--text-primary); font-size: 15px; font-weight: 800; font-family: var(--font-display);
  }
  .land-preview-chat-head span { color: var(--text-muted); margin-right: 4px; }
  .land-preview-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  .land-preview-tools span, .land-preview-pill-row span {
    margin: 0; padding: 4px 9px; border-radius: var(--r-full);
    color: var(--text-secondary); background: var(--bg-elevated);
    border: 1px solid var(--border-subtle); font-size: 11px; font-weight: 600; font-family: var(--font-mono);
  }
  .land-preview-message {
    display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 12px;
    padding: 20px; border-bottom: 1px solid var(--border-subtle);
  }
  .land-preview-avatar {
    width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center;
    color: var(--bg-void); background: var(--accent); font-size: 14px; font-weight: 900;
  }
  .land-preview-avatar-lux { background: var(--lux); }
  .land-preview-name {
    display: flex; align-items: center; gap: 8px; color: var(--text-primary);
    font-size: 13px; font-weight: 800; margin-bottom: 4px;
  }
  .land-preview-name span { color: var(--text-muted); font-size: 11px; font-weight: 600; }
  .land-preview-message p { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.55; }
  .land-preview-pill-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .land-preview-composer {
    margin: auto 20px 20px; min-height: 44px; display: flex; align-items: center;
    padding: 0 14px; border-radius: var(--r-lg); color: var(--text-muted);
    background: var(--bg-elevated); border: 1px solid var(--border-subtle); font-size: 13px;
  }
  .land-preview-members { border-right: 0; padding: 18px 14px; background: color-mix(in srgb, var(--bg-void) 18%, transparent); }
  .land-preview-presence {
    width: 7px; height: 7px; border-radius: 50%; background: var(--status-online);
    box-shadow: 0 0 8px color-mix(in srgb, var(--status-online) 50%, transparent);
  }
  .land-preview-status {
    margin-top: 22px; padding: 14px; border-radius: var(--r-lg);
    background: var(--lux-subtle); border: 1px solid color-mix(in srgb, var(--lux) 26%, transparent);
    display: flex; flex-direction: column; gap: 6px;
  }
  .land-preview-status strong { color: var(--lux); font-size: 12px; }
  .land-preview-status span { color: var(--text-secondary); font-size: 12px; line-height: 1.45; }

  /* ── Security ── */
  .land-security {
    position: relative; z-index: 1; max-width: var(--land-max); margin: 0 auto;
    padding: 0 var(--land-gutter) 80px;
  }
  .land-sec-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  @media (max-width: 980px) { .land-sec-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 560px) { .land-sec-grid { grid-template-columns: 1fr; } }
  .land-sec-card {
    display: flex; flex-direction: column; gap: 12px; padding: 26px 24px;
    border: 1px solid var(--border-subtle); border-radius: var(--r-xl);
    background: color-mix(in srgb, var(--bg-base) 80%, transparent);
    transition: border-color 0.3s var(--ease-out), transform 0.25s var(--ease-out), box-shadow 0.3s var(--ease-out);
  }
  .land-sec-card:hover {
    border-color: var(--border-normal); transform: translateY(-3px);
    box-shadow: var(--elev-shadow-2);
  }
  .land-sec-icon {
    width: 42px; height: 42px; border-radius: var(--r-lg);
    display: grid; place-items: center; color: var(--lux);
    background: var(--lux-subtle); border: 1px solid color-mix(in srgb, var(--lux) 24%, transparent);
  }
  .land-sec-title {
    font-family: var(--font-display); font-size: 1.12rem; font-weight: 600;
    color: var(--text-primary); margin: 0; letter-spacing: -0.01em;
  }
  .land-sec-body { margin: 0; font-size: 0.86rem; line-height: 1.62; color: var(--text-secondary); flex: 1; }
  .land-sec-note {
    font-family: var(--font-mono); font-size: 10px; font-weight: 600;
    letter-spacing: 0.06em; color: var(--lux); padding-top: 8px;
    border-top: 1px solid var(--border-subtle);
  }

  /* ── Capabilities ── */
  .land-capabilities {
    position: relative; z-index: 1; max-width: var(--land-max); margin: 0 auto;
    padding: 0 var(--land-gutter) 80px;
  }
  .land-cap-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  .land-cap-card {
    border: 1px solid var(--border-subtle); border-radius: var(--r-xl); padding: 24px;
    background: color-mix(in srgb, var(--bg-base) 82%, transparent);
    box-shadow: var(--elev-highlight);
    transition: border-color 0.3s var(--ease-out), transform 0.25s var(--ease-out);
  }
  .land-cap-card:hover { border-color: var(--border-normal); transform: translateY(-2px); }
  .land-cap-card h3 {
    margin: 0 0 16px; color: var(--text-primary); font-family: var(--font-display);
    font-size: 1.02rem; font-weight: 600; letter-spacing: -0.01em;
  }
  .land-cap-card ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 11px; }
  .land-cap-card li { display: flex; align-items: center; gap: 10px; color: var(--text-secondary); font-size: 13px; line-height: 1.35; }
  .land-cap-check {
    width: 6px; height: 6px; border-radius: 50%; background: var(--lux);
    box-shadow: 0 0 8px color-mix(in srgb, var(--lux) 50%, transparent); flex-shrink: 0;
  }
  @media (max-width: 980px) { .land-cap-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 520px) { .land-cap-grid { grid-template-columns: 1fr; } }

  /* ── Built different ── */
  .land-different {
    position: relative; z-index: 1; max-width: var(--land-max); margin: 0 auto;
    padding: 0 var(--land-gutter) 80px;
  }
  .land-different-inner {
    display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 48px; align-items: center;
    padding: clamp(34px, 5vw, 60px);
    border: 1px solid var(--border-normal); border-radius: var(--r-2xl);
    background:
      radial-gradient(circle at 0% 0%, var(--lux-subtle), transparent 52%),
      color-mix(in srgb, var(--bg-base) 86%, transparent);
    box-shadow: var(--elev-shadow-2);
  }
  @media (max-width: 860px) { .land-different-inner { grid-template-columns: 1fr; gap: 32px; } }
  .land-different-copy { display: flex; flex-direction: column; align-items: flex-start; gap: 20px; }
  .land-different-h2 {
    margin: 0; font-family: var(--font-display);
    font-size: clamp(1.7rem, 1.2rem + 1.8vw, 2.5rem); font-weight: 600;
    line-height: 1.12; letter-spacing: -0.02em; color: var(--text-primary);
  }
  .land-different-em { color: var(--lux); font-style: italic; }
  .land-different-p { margin: 0; font-size: 1rem; line-height: 1.72; color: var(--text-secondary); }
  .land-different-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0; }
  .land-different-item {
    display: flex; flex-direction: column; gap: 5px; padding: 18px 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .land-different-item:first-child { padding-top: 0; }
  .land-different-item:last-child { border-bottom: 0; padding-bottom: 0; }
  .land-different-k {
    font-family: var(--font-mono); font-size: 11px; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--lux);
  }
  .land-different-v { font-size: 14px; line-height: 1.5; color: var(--text-secondary); }

  /* ── Connect ── */
  .land-connect {
    position: relative; z-index: 1; max-width: var(--land-max); margin: 0 auto;
    padding: 0 var(--land-gutter) 80px;
  }
  .land-connect-grid { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 14px; }
  .land-connect-card {
    min-height: 230px; display: flex; flex-direction: column; align-items: flex-start; gap: 12px;
    padding: 28px; border-radius: var(--r-xl);
    border: 1px solid var(--border-subtle); background: color-mix(in srgb, var(--bg-base) 84%, transparent);
    transition: border-color 0.3s var(--ease-out), transform 0.25s var(--ease-out);
  }
  .land-connect-card:hover { border-color: var(--border-normal); transform: translateY(-2px); }
  .land-connect-card-primary {
    background:
      radial-gradient(circle at 20% 10%, var(--lux-subtle), transparent 60%),
      color-mix(in srgb, var(--bg-elevated) 86%, transparent);
    border-color: color-mix(in srgb, var(--lux) 26%, transparent);
  }
  .land-connect-label {
    font-family: var(--font-mono); color: var(--lux);
    background: var(--lux-subtle); border: 1px solid color-mix(in srgb, var(--lux) 26%, transparent);
    border-radius: var(--r-full); padding: 4px 10px;
    font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
  }
  .land-connect-card h3 {
    margin: 0; color: var(--text-primary); font-family: var(--font-display);
    font-size: 1.2rem; font-weight: 600; letter-spacing: -0.015em;
  }
  .land-connect-card p { margin: 0; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6; }
  .land-connect-card code {
    margin-top: auto; color: var(--lux);
    background: color-mix(in srgb, var(--bg-void) 60%, transparent);
    border: 1px solid var(--border-normal); border-radius: var(--r-md);
    padding: 9px 11px; font-family: var(--font-mono); font-size: 12px;
  }
  .land-connect-action {
    margin-top: auto; display: inline-flex; align-items: center; gap: 7px;
    color: var(--bg-void); background: var(--lux); border-radius: var(--r-md);
    padding: 11px 16px; font-size: 13px; font-weight: 700; text-decoration: none;
    transition: filter 0.2s var(--ease-out), transform 0.2s var(--ease-out);
  }
  .land-connect-action:hover { text-decoration: none; color: var(--bg-void); filter: brightness(1.07); transform: translateY(-1px); }
  @media (max-width: 980px) { .land-connect-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

  /* ── FAQ ── */
  .land-faq {
    position: relative; z-index: 1; max-width: 1080px; margin: 0 auto;
    padding: 0 var(--land-gutter) 70px;
  }
  .land-faq-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  .land-faq-item {
    border: 1px solid var(--border-subtle); border-radius: var(--r-xl);
    background: color-mix(in srgb, var(--bg-base) 80%, transparent); padding: 24px;
    transition: border-color 0.3s var(--ease-out);
  }
  .land-faq-item:hover { border-color: var(--border-normal); }
  .land-faq-item h3 {
    margin: 0 0 10px; color: var(--text-primary); font-family: var(--font-display);
    font-size: 1.02rem; font-weight: 600; letter-spacing: -0.01em;
  }
  .land-faq-item p { margin: 0; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.62; }
  @media (max-width: 720px) { .land-faq-grid { grid-template-columns: 1fr; } }

  /* ── Community / CTA ── */
  .land-community {
    position: relative; z-index: 1; overflow: hidden;
    margin: 20px var(--land-gutter); border-radius: var(--r-2xl);
    background:
      radial-gradient(ellipse at 50% -10%, var(--lux-subtle), transparent 55%),
      linear-gradient(160deg, color-mix(in srgb, var(--bg-elevated) 84%, transparent), color-mix(in srgb, var(--bg-deep) 92%, transparent));
    border: 1px solid var(--border-normal);
    padding: clamp(60px, 9vw, 110px) clamp(28px, 5vw, 80px); text-align: center;
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--lux) 18%, transparent), var(--elev-shadow-3);
  }
  .land-community::before {
    content: ''; position: absolute; top: 0; left: 12%; right: 12%; height: 1px;
    background: linear-gradient(90deg, transparent, var(--lux), transparent); opacity: 0.4;
  }
  .land-community-bg {
    position: absolute; inset: 0; pointer-events: none; opacity: 0.22;
    display: flex; align-items: center; justify-content: center;
  }
  .land-community-bg .land-meshvis { max-width: 620px; }
  .land-community-inner {
    position: relative; z-index: 1; display: flex; flex-direction: column;
    align-items: center; gap: 26px; max-width: 680px; margin: 0 auto;
  }
  .land-community-label {
    display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-mono);
    font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-muted);
  }
  .land-community-label-dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
    background: var(--lux); box-shadow: 0 0 8px var(--lux);
    animation: dot-pulse 2.4s ease-in-out infinite;
  }
  .land-community-h2 {
    font-family: var(--font-display);
    font-size: clamp(2.1rem, 1.4rem + 3vw, 3.4rem); font-weight: 600;
    letter-spacing: -0.025em; line-height: 1.08; color: var(--text-primary); margin: 0;
  }
  .land-community-p { font-size: clamp(1rem, 0.95rem + 0.3vw, 1.1rem); line-height: 1.7; color: var(--text-secondary); margin: 0; }
  .land-channel-pill {
    font-family: var(--font-mono); font-size: 0.9em;
    color: var(--lux); background: var(--lux-subtle);
    padding: 1px 7px; border-radius: var(--r-xs);
    border: 1px solid color-mix(in srgb, var(--lux) 26%, transparent);
  }
  .land-channels {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center;
    padding: 16px 20px; background: color-mix(in srgb, var(--bg-void) 50%, transparent);
    border: 1px solid var(--border-subtle); border-radius: var(--r-lg);
    width: 100%; max-width: 480px;
  }
  .land-ch-enter { animation: ch-slide-in 0.5s var(--ease-out) both; animation-delay: var(--ch-delay, 0ms); }
  @keyframes ch-slide-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .land-ch {
    display: flex; align-items: center; gap: 5px; font-size: 13px; font-family: var(--font-mono);
    padding: 6px 14px; border-radius: var(--r-full);
    background: var(--bg-elevated); border: 1px solid var(--border-subtle); color: var(--text-secondary);
    transition: border-color 0.25s, color 0.25s, transform 0.2s var(--ease-out); cursor: default;
  }
  .land-ch:hover { border-color: var(--border-normal); color: var(--text-primary); transform: translateY(-1px); }
  .land-ch-hash { color: var(--text-muted); font-size: 12px; }
  .land-ch-active {
    background: var(--lux-subtle); border-color: color-mix(in srgb, var(--lux) 28%, transparent);
    color: var(--lux);
  }
  .land-ch-active .land-ch-hash { color: var(--lux); }
  .land-ch-live {
    font-size: 9px; font-weight: 800; letter-spacing: 0.06em;
    color: var(--bg-void); background: var(--lux); padding: 2px 6px; border-radius: var(--r-xs); margin-left: 2px;
  }
  .land-ch-voice { border-color: color-mix(in srgb, var(--status-online) 24%, transparent); color: var(--status-online); }
  .land-ch-voice:hover { border-color: color-mix(in srgb, var(--status-online) 42%, transparent); }
  .land-ch-voice svg { width: 11px; height: 11px; }
  .land-community-cta-group { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; justify-content: center; }

  /* ── Footer ── */
  .land-footer {
    position: relative; z-index: 1; display: grid; grid-template-columns: 1fr auto auto;
    align-items: center; gap: 24px 40px;
    padding: 44px var(--land-gutter) max(40px, env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--border-subtle); margin-top: 30px;
  }
  .land-footer-left { display: flex; flex-direction: column; gap: 6px; }
  .land-footer-logo {
    display: flex; align-items: center; gap: 8px; font-family: var(--font-display);
    font-size: 16px; font-weight: 600; color: var(--text-primary);
  }
  .land-footer-tagline { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); letter-spacing: 0.02em; }
  .land-footer-links { display: flex; align-items: center; gap: 22px; }
  .land-footer-link { font-size: 13px; color: var(--text-muted); text-decoration: none; transition: color 0.2s; }
  .land-footer-link:hover { color: var(--text-primary); text-decoration: none; }
  .land-footer-copy { font-size: 12px; color: var(--text-muted); margin: 0; white-space: nowrap; }

  /* ── Mobile — 640px ── */
  @media (max-width: 640px) {
    .land-nav { height: calc(54px + env(safe-area-inset-top, 0px)); padding: env(safe-area-inset-top, 0px) 16px 0; }
    .land-nav-link, .land-nav-sep, .land-nav-engine { display: none; }
    .land-nav-cta { font-size: 12px; padding: 7px 14px; }

    .land-hero { padding: calc(96px + env(safe-area-inset-top, 0px)) 16px 60px; min-height: auto; }
    .land-hero-copy { gap: 22px; }
    .land-hero-actions { flex-direction: column; align-items: stretch; gap: 10px; }
    .land-btn-primary, .land-btn-ghost { justify-content: center; padding: 15px 20px; font-size: 15px; }
    .land-hero-stats { gap: 14px; }
    .land-hs-rule { display: none; }

    .land-mark { margin-top: 48px; padding: 0 16px; }
    .land-features, .land-engine, .land-preview, .land-security,
    .land-capabilities, .land-different, .land-connect, .land-faq {
      padding-left: 16px; padding-right: 16px; padding-bottom: 56px;
    }
    .land-section-heading { text-align: left; align-items: flex-start; margin-bottom: 24px; }
    .land-section-title { font-size: clamp(1.7rem, 7vw, 2.2rem); }
    .land-card-inner { padding: 24px 20px; }
    .land-card-h3 { font-size: 1.18rem; }

    .land-app-preview { grid-template-columns: 56px minmax(0, 1fr); min-height: auto; }
    .land-preview-rail { grid-row: 1 / span 3; }
    .land-preview-sidebar { border-right: 0; }
    .land-preview-chat { grid-column: 2; border-top: 1px solid var(--border-subtle); border-right: 0; }
    .land-preview-chat-head { align-items: flex-start; flex-direction: column; padding: 14px; gap: 10px; }
    .land-preview-tools { justify-content: flex-start; }
    .land-preview-message { padding: 16px 14px; }
    .land-preview-composer { margin: 10px 14px 14px; }
    .land-preview-members { grid-column: 2; border-top: 1px solid var(--border-subtle); padding: 14px; }

    .land-different-inner { padding: 28px 22px; }

    .land-community { margin: 10px 12px; padding: 48px 22px; }
    .land-community-cta-group { flex-direction: column; align-items: stretch; }
    .land-btn-lg, .land-btn-ghost-lg { justify-content: center; text-align: center; }

    .land-footer { grid-template-columns: 1fr; text-align: center; gap: 16px; padding: 30px 16px max(30px, env(safe-area-inset-bottom, 0px)); }
    .land-footer-left { align-items: center; }
    .land-footer-links { flex-wrap: wrap; justify-content: center; gap: 16px; }
    .land-footer-copy { order: 3; }
  }

  /* ── Mobile — 375px ── */
  @media (max-width: 375px) {
    .land-h1 { font-size: 2.5rem; }
    .land-card-inner { padding: 20px 16px; }
    .land-arch-row { padding: 20px 16px; }
    .land-community { margin: 10px 8px; padding: 40px 18px; }
    .land-preview-message { grid-template-columns: 32px minmax(0, 1fr); gap: 10px; }
    .land-preview-avatar { width: 32px; height: 32px; border-radius: 10px; }
  }
`;
