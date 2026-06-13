import Link from 'next/link';
import type { CSSProperties } from 'react';
import ChanstatsPreview from '@/components/site/ChanstatsPreview';

export default function LandingPage() {
  return (
    <main className="land-root">

      {/* ── Skip link ── */}
      <a href="#land-main" className="land-skip-link">Skip to main content</a>

      {/* ── Depth layers ─────────────────────────────────────────────── */}
      <div className="land-depth" aria-hidden>
        <div className="land-depth-ray land-depth-ray-1" />
        <div className="land-depth-ray land-depth-ray-2" />
        <div className="land-depth-ray land-depth-ray-3" />
        <div className="land-depth-particles" />
      </div>

      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <nav className="land-nav">
        <div className="land-nav-logo">
          <OceanLogo />
          <span className="land-nav-wordmark">Ocean</span>
        </div>
        <div className="land-nav-links">
          <a href="#features" className="land-nav-link">Features</a>
          <a href="#preview" className="land-nav-link">Preview</a>
          <a href="#activity" className="land-nav-link">Activity</a>
          <a href="#connect" className="land-nav-link">Connect</a>
          <Link href="/about" className="land-nav-link">About</Link>
          <Link href="/login" className="land-nav-cta">
            Dive in <ArrowRight size={13} />
          </Link>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section id="land-main" className="land-hero">
        <div className="land-hero-body">
          <div className="land-hero-copy">
            <div className="land-badge">
              <span className="land-badge-sonar" />
              <span className="land-badge-dot" />
              eshmaki.me · live
            </div>

            <h1 className="land-h1">
              Ocean for<br />
              eshmaki.me
            </h1>

            <p className="land-lead">
              Open-protocol community chat with SUIMYAKU media and TSUMUGI encryption
              carried through Orochi. Start in <span className="land-inline-channel">#root</span>.
            </p>

            <div className="land-hero-actions">
              <Link href="/login" className="land-btn-primary">
                Enter Ocean
                <ArrowRight size={14} />
              </Link>
              <Link href="/about" className="land-btn-ghost">What is this?</Link>
            </div>

            {/* Depth meter — desktop only */}
            <div className="land-depth-meter" aria-hidden>
              <div className="land-dm-track">
                <div className="land-dm-fill" />
              </div>
              <div className="land-dm-labels">
                <span>surface</span>
                <span className="land-dm-depth">4 000 m</span>
              </div>
            </div>
          </div>

          <div className="land-hero-visual" aria-hidden>
            <OceanDepthVis />
          </div>
        </div>
      </section>

      {/* ── Depth lines (section separator) ─────────────────────────── */}
      <div className="land-sonar-line" aria-hidden>
        <div className="land-sonar-ping" />
        <div className="land-sonar-text">depth: 2 500 m · features ahead</div>
      </div>

      {/* ── Features bento ──────────────────────────────────────────── */}
      <section id="features" className="land-features">

        {/* Row 1 — Voice + Sessions */}
        <div className="land-bento-row land-bento-row-1">
          <div className="land-card land-card-voice">
            <div className="land-card-glow land-card-glow-voice" />
            <div className="land-card-inner">
              <div className="land-card-eyebrow land-eyebrow-voice">
                <span className="land-eyebrow-pip" />
                <VoiceIcon />
                <span>SUIMYAKU</span>
              </div>
              <h3 className="land-card-h3">Voice without borders</h3>
              <p className="land-card-p">
                Spatial audio and encrypted voice over Orochi IRC. Native
                protocol transport — no relay servers, no third-party
                infrastructure. Your voice travels the same path as your
                messages.
              </p>
              <div className="land-voice-vis" aria-hidden>
                <WaveformVis />
              </div>
            </div>
          </div>

          <div className="land-card land-card-session">
            <div className="land-card-glow land-card-glow-session" />
            <div className="land-card-inner">
              <div className="land-card-eyebrow land-eyebrow-gold">
                <span className="land-eyebrow-pip land-eyebrow-pip-gold" />
                <TokenIcon />
                <span>SESSION</span>
              </div>
              <h3 className="land-card-h3">Stay signed in</h3>
              <p className="land-card-p">
                Cryptographic session tokens keep you authenticated across
                reconnects. No password stored. No re-entry.
              </p>
              <div className="land-token-display" aria-hidden>
                <div className="land-token-row">
                  <span className="land-token-prefix">sst_</span>
                  <span className="land-token-body">4f8a2e…c1b9</span>
                </div>
                <div className="land-token-status">
                  <span className="land-token-dot" />
                  valid · 29 days remaining
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2 — TSUMUGI (wide) */}
        <div className="land-bento-row land-bento-row-2">
          <div className="land-card land-card-tsumugi">
            <div className="land-card-glow land-card-glow-tsumugi" />
            <div className="land-card-inner land-card-inner-split">
              <div className="land-card-text">
                <div className="land-card-eyebrow land-eyebrow-tsumugi">
                  <span className="land-eyebrow-pip land-eyebrow-pip-tsumugi" />
                  <TsumugiIcon />
                  <span>TSUMUGI</span>
                </div>
                <h3 className="land-card-h3">End-to-end, always</h3>
                <p className="land-card-p">
                  P-256 ECDH key exchange and AES-256-GCM encryption for every
                  voice and video session. Forward secrecy built into the protocol
                  — not bolted on.
                </p>
                <div className="land-tsumugi-badges" aria-hidden>
                  <span className="land-tsumugi-badge">P-256 ECDH</span>
                  <span className="land-tsumugi-badge">AES-256-GCM</span>
                  <span className="land-tsumugi-badge">Forward Secrecy</span>
                </div>
              </div>
              <div className="land-tsumugi-diagram" aria-hidden>
                <TsumugiKeyVis />
              </div>
            </div>
          </div>
        </div>

        {/* Row 3 — small cards */}
        <div className="land-bento-row land-bento-row-3">
          <div className="land-card land-card-sm land-card-irc">
            <div className="land-card-glow land-card-glow-irc" />
            <div className="land-card-inner">
              <div className="land-card-eyebrow land-eyebrow-dim">
                <span className="land-eyebrow-pip land-eyebrow-pip-dim" />
                <IrcIcon />
                <span>PROTOCOL</span>
              </div>
              <h3 className="land-card-h3">Open IRC</h3>
              <p className="land-card-p">
                Standard IRCv3. Connect with any client. Ocean is just the
                surface.
              </p>
              <div className="land-irc-tag" aria-hidden>
                <span className="land-irc-tag-text">eshmaki.me:6697</span>
              </div>
            </div>
          </div>

          <div className="land-card land-card-sm land-card-wb">
            <div className="land-card-glow land-card-glow-wb" />
            <div className="land-card-inner">
              <div className="land-card-eyebrow land-eyebrow-dim">
                <span className="land-eyebrow-pip land-eyebrow-pip-dim" />
                <WbIcon />
                <span>COLLABORATE</span>
              </div>
              <h3 className="land-card-h3">Whiteboard</h3>
              <p className="land-card-p">
                Shared drawing surfaces built into every channel. No extra app.
              </p>
            </div>
          </div>

          <div className="land-card land-card-sm land-card-msg">
            <div className="land-card-glow land-card-glow-msg" />
            <div className="land-card-inner">
              <div className="land-card-eyebrow land-eyebrow-dim">
                <span className="land-eyebrow-pip land-eyebrow-pip-dim" />
                <MsgIcon />
                <span>MESSAGING</span>
              </div>
              <h3 className="land-card-h3">Rich messages</h3>
              <p className="land-card-p">
                Reactions, edits, threads, embeds — over standard IRC
                extensions.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Product preview ────────────────────────────────────────── */}
      <section id="preview" className="land-preview">
        <div className="land-section-heading">
          <span className="land-section-kicker">Ocean app</span>
          <h2 className="land-section-title">Everything has a predictable place.</h2>
          <p className="land-section-copy">
            Ocean keeps the familiar server, channel, chat, and member layout,
            then layers in IRC-native identity, voice, session handoff, media,
            and moderation tools where people already expect them.
          </p>
        </div>

        <div className="land-app-preview elev-2" aria-label="Ocean app interface preview">
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
                <p>Session reclaimed cleanly. Phone and desktop are both attached.</p>
              </div>
            </div>
            <div className="land-preview-message">
              <div className="land-preview-avatar land-preview-avatar-gold">o</div>
              <div>
                <div className="land-preview-name">ocean <span>live</span></div>
                <p>SUIMYAKU voice is encrypted, linked to the channel, and ready.</p>
                <div className="land-preview-pill-row">
                  <span>TSUMUGI active</span>
                  <span>2 clients</span>
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
              <span>Synced links, active sessions, no relay dependency.</span>
            </div>
          </div>
        </div>
      </section>

      <ChanstatsPreview />

      {/* ── Capabilities ───────────────────────────────────────────── */}
      <section className="land-capabilities" aria-label="Ocean capabilities">
        <div className="land-section-heading land-section-heading-compact">
          <span className="land-section-kicker">Feature map</span>
          <h2 className="land-section-title">Built for real communities, not a demo room.</h2>
        </div>
        <div className="land-cap-grid">
          {([
            ['Chat', ['Threaded replies', 'Reactions and edits', 'Pins, search, history', 'Embeds and media cards']],
            ['Voice and media', ['SUIMYAKU channel voice', 'Encrypted sessions', 'Media gallery', 'Whiteboard collaboration']],
            ['Identity', ['SASL login', 'Session reclaim', 'Multi-client nick support', 'Token-based resume']],
            ['Operations', ['Services awareness', 'Moderation tools', 'Channel browser', 'Network status views']],
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

      {/* ── Connect ───────────────────────────────────────────────── */}
      <section id="connect" className="land-connect">
        <div className="land-section-heading">
          <span className="land-section-kicker">Connect</span>
          <h2 className="land-section-title">Use the web app or bring your own IRC client.</h2>
          <p className="land-section-copy">
            The website is the front door, Ocean is the rich client, and the
            network remains open enough for standard IRC tooling.
          </p>
        </div>
        <div className="land-connect-grid">
          <div className="land-connect-card land-connect-card-primary">
            <span className="land-connect-label">Recommended</span>
            <h3>Ocean web app</h3>
            <p>Full chat, voice, media, settings, session resume, and community tooling in the browser.</p>
            <Link href="/login" className="land-connect-action">
              Open Ocean <ArrowRight size={13} />
            </Link>
          </div>
          <div className="land-connect-card">
            <span className="land-connect-label">IRC</span>
            <h3>TLS client access</h3>
            <p>Use any IRCv3 client with TLS and SASL for a direct protocol connection.</p>
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
            ['Do I need Ocean?', 'No. Ocean is the polished web client, but the network speaks IRCv3 so native clients can connect too.'],
            ['Can I stay connected from multiple devices?', 'Yes. Session reclaim is designed for multiple clients on the same nick without kicking out the others.'],
            ['Is voice part of IRC?', 'Voice uses SUIMYAKU over Orochi so channel voice belongs to the same open network instead of a separate relay stack.'],
            ['Where should I start?', 'Open Ocean, sign in, and join #root. The app exposes channels, members, voice, search, and settings in the main workspace.'],
          ] as Array<[string, string]>).map(([question, answer]) => (
            <article key={question} className="land-faq-item">
              <h3>{question}</h3>
              <p>{answer}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Community ───────────────────────────────────────────────── */}
      <section className="land-community">
        <div className="land-community-bg" aria-hidden>
          <NetworkVis />
        </div>
        <div className="land-community-inner">
          <div className="land-community-label">
            <span className="land-community-label-dot" />
            eshmaki.me
          </div>
          <h2 className="land-community-h2">
            One network.<br />Many depths.
          </h2>
          <p className="land-community-p">
            Start at the surface in{' '}
            <span className="land-channel-pill">#root</span> — the main
            gathering place. Descend into voice channels, project rooms, and
            late-night conversations.
          </p>
          <div className="land-channels" aria-hidden>
            <div className="land-ch land-ch-active">
              <span className="land-ch-hash">#</span>
              <span>root</span>
              <span className="land-ch-live">LIVE</span>
            </div>
            <div className="land-ch land-ch-enter" style={{'--ch-delay':'80ms'} as ChDelayCSSProps}>
              <span className="land-ch-hash">#</span>
              <span>dev</span>
            </div>
            <div className="land-ch land-ch-enter" style={{'--ch-delay':'160ms'} as ChDelayCSSProps}>
              <span className="land-ch-hash">#</span>
              <span>art</span>
            </div>
            <div className="land-ch land-ch-enter" style={{'--ch-delay':'240ms'} as ChDelayCSSProps}>
              <span className="land-ch-hash">#</span>
              <span>lounge</span>
            </div>
            <div className="land-ch land-ch-voice land-ch-enter" style={{'--ch-delay':'320ms'} as ChDelayCSSProps}>
              <VoiceSmIcon />
              <span>voice-1</span>
            </div>
          </div>
          <div className="land-community-cta-group">
            <Link href="/login" className="land-btn-primary land-btn-lg">
              Join the community
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
          <p className="land-footer-tagline">Built on Orochi IRC · eshmaki.me</p>
        </div>
        <nav className="land-footer-links" aria-label="Footer navigation">
          <Link href="/about" className="land-footer-link">About</Link>
          <Link href="/login" className="land-footer-link">Sign In</Link>
          <a
            href="https://github.com/devinkbrown/orochi"
            target="_blank"
            rel="noopener noreferrer"
            className="land-footer-link"
          >
            Orochi ↗
          </a>
        </nav>
        <p className="land-footer-copy">© 2026 eshmaki.me</p>
      </footer>

      <style>{`
        /* ════════════════════════════════════════════════════════════
           OCEAN LANDING — DEPTH AESTHETIC
           ════════════════════════════════════════════════════════════ */

        /* Override the app shell's global overflow: hidden so this page scrolls */
        html, body { overflow: auto; overflow-x: hidden; }

        /* ── Skip link ── */
        .land-skip-link {
          position: absolute;
          top: -40px;
          left: 0;
          background: var(--accent);
          color: #fff;
          padding: 8px 16px;
          text-decoration: none;
          z-index: 9999;
          border-radius: 0 0 6px 0;
          transition: top 150ms;
          font-size: 14px;
          font-weight: 600;
        }
        .land-skip-link:focus { top: 0; }

        .land-root {
          background: var(--bg-void);
          color: var(--text-primary);
          min-height: 100dvh;
          /* clip instead of hidden — doesn't create a spurious scroll container */
          overflow-x: clip;
          font-family: 'Inter', system-ui, sans-serif;
        }

        /* ── Depth atmospheric rays ── */
        .land-depth {
          position: fixed; inset: 0; pointer-events: none; z-index: 0;
          overflow: hidden;
        }
        .land-depth-ray {
          position: absolute;
          width: 1px;
          top: 0; bottom: 0;
          opacity: 0.06;
          background: linear-gradient(to bottom,
            transparent 0%,
            color-mix(in srgb, var(--accent) 80%, transparent) 20%,
            color-mix(in srgb, var(--accent) 30%, transparent) 60%,
            transparent 100%
          );
          transform-origin: top center;
        }
        .land-depth-ray-1 { left: 25%; transform: rotate(-4deg) scaleX(80); animation: ray-drift 12s ease-in-out infinite; }
        .land-depth-ray-2 { left: 50%; transform: rotate(0deg)  scaleX(60); animation: ray-drift 15s ease-in-out infinite reverse; }
        .land-depth-ray-3 { left: 75%; transform: rotate(3deg)  scaleX(90); animation: ray-drift 18s ease-in-out infinite; }
        @keyframes ray-drift {
          0%, 100% { opacity: 0.04; transform: rotate(-4deg) scaleX(80) translateX(0); }
          50%       { opacity: 0.08; transform: rotate(-2deg) scaleX(80) translateX(20px); }
        }
        .land-depth-particles {
          position: absolute; inset: 0;
          background-image:
            radial-gradient(1px 1px at 20% 30%, var(--accent-subtle) 0%, transparent 100%),
            radial-gradient(1px 1px at 40% 70%, var(--gold-subtle) 0%, transparent 100%),
            radial-gradient(1px 1px at 60% 20%, var(--accent-subtle) 0%, transparent 100%),
            radial-gradient(1px 1px at 80% 55%, var(--gold-subtle) 0%, transparent 100%),
            radial-gradient(1px 1px at 15% 60%, var(--accent-subtle) 0%, transparent 100%),
            radial-gradient(1px 1px at 90% 40%, var(--gold-subtle) 0%, transparent 100%);
          animation: particles-drift 30s linear infinite;
        }
        @keyframes particles-drift {
          0%   { transform: translateY(0); }
          100% { transform: translateY(-40px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .land-depth-ray, .land-depth-particles,
          .land-badge-sonar, .land-badge-dot,
          .land-h1-underwave, .land-dm-fill,
          .land-sonar-ping, .land-token-dot,
          .land-ch-enter { animation: none !important; }
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
          padding: env(safe-area-inset-top, 0px) clamp(20px, 5vw, 80px) 0;
          height: calc(60px + env(safe-area-inset-top, 0px));
          background: color-mix(in srgb, var(--bg-void) 72%, transparent);
          backdrop-filter: blur(24px) saturate(1.5);
          border-bottom: 1px solid var(--border-subtle);
        }
        .land-nav-logo {
          display: flex; align-items: center; gap: 9px;
          text-decoration: none;
        }
        .land-nav-wordmark {
          font-size: 16px; font-weight: 700; letter-spacing: -0.3px;
          color: var(--text-primary);
        }
        .land-nav-links { display: flex; align-items: center; gap: 20px; }
        .land-nav-link {
          font-size: 14px; font-weight: 500;
          color: var(--text-secondary); text-decoration: none;
          transition: color 0.2s;
        }
        .land-nav-link:hover { color: var(--text-primary); text-decoration: none; }
        .land-nav-cta {
          display: flex; align-items: center; gap: 6px;
          font-size: 13px; font-weight: 600; color: var(--bg-void);
          background: linear-gradient(135deg, var(--accent), var(--accent-hover));
          text-decoration: none;
          padding: 7px 16px; border-radius: 20px;
          transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
          box-shadow: 0 0 16px var(--accent-glow);
        }
        .land-nav-cta:hover { opacity: 0.92; transform: translateY(-1px); text-decoration: none; }

        /* ── Hero ── */
        .land-hero {
          position: relative; z-index: 1;
          padding: calc(160px + env(safe-area-inset-top, 0px)) clamp(20px,5vw,80px) 100px;
          min-height: 100dvh;
          display: flex; align-items: center;
        }
        .land-hero-body {
          width: 100%; max-width: 1240px; margin: 0 auto;
          display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 80px;
          align-items: center;
        }
        @media (max-width: 768px) {
          .land-hero-body { grid-template-columns: 1fr; }
          .land-hero-visual { display: none; }
        }

        .land-hero-copy { display: flex; flex-direction: column; gap: 32px; }

        /* Badge */
        .land-badge {
          display: inline-flex; align-items: center; gap: 8px;
          font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--accent);
          padding: 5px 12px; border-radius: 20px;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          width: fit-content;
          position: relative; overflow: hidden;
        }
        .land-badge-sonar {
          position: absolute; inset: 0; border-radius: 20px;
          background: var(--accent-subtle);
          animation: sonar-pulse 3s ease-out infinite;
        }
        .land-badge-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--accent);
          box-shadow: 0 0 6px var(--accent-glow);
          flex-shrink: 0;
          animation: dot-pulse 2s ease-in-out infinite;
        }
        @keyframes sonar-pulse {
          0% { transform: scale(0.9); opacity: 0.5; }
          70% { transform: scale(1.4); opacity: 0; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        @keyframes dot-pulse {
          0%, 100% { box-shadow: 0 0 4px var(--accent-glow); }
          50%       { box-shadow: 0 0 10px var(--accent); }
        }

        /* Heading */
        .land-h1 {
          font-family: var(--font-display);
          font-size: var(--text-hero);
          font-weight: 800;
          letter-spacing: 0;
          line-height: 1.0;
          color: var(--text-primary);
          margin: 0;
        }
        .land-h1-deep {
          position: relative; display: inline-block;
          color: var(--accent);
        }
        .land-h1-word { position: relative; z-index: 1; }
        .land-h1-underwave {
          position: absolute; bottom: -4px; left: 0; right: 0; height: 4px;
          background: linear-gradient(90deg, var(--accent), var(--gold), var(--accent));
          border-radius: 2px;
          animation: wave-shimmer 2s ease-in-out infinite;
        }
        @keyframes wave-shimmer {
          0%, 100% { opacity: 0.7; transform: scaleX(1); }
          50%       { opacity: 1;   transform: scaleX(1.02); }
        }

        /* Lead */
        .land-lead {
          font-size: clamp(1.05rem, 1.6vw, 1.2rem);
          line-height: 1.7; color: var(--text-secondary); margin: 0;
        }
        .land-inline-channel {
          font-family: var(--font-mono); font-size: 0.9em;
          color: var(--accent); background: var(--accent-subtle);
          padding: 1px 6px; border-radius: 4px;
          border: 1px solid var(--accent-border);
        }

        /* CTA buttons */
        .land-hero-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        .land-btn-primary {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 13px 26px; border-radius: var(--r-md);
          font-size: 14px; font-weight: 700; color: var(--bg-void);
          background: color-mix(in srgb, var(--accent) 88%, black 12%);
          text-decoration: none;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 16px 28px rgba(0,0,0,.28);
          transition: transform 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out);
          letter-spacing: 0.01em;
        }
        .land-btn-primary:hover {
          transform: translateY(-2px);
          filter: brightness(1.06);
          text-decoration: none; color: var(--bg-void);
        }
        .land-btn-ghost {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 13px 22px; border-radius: var(--r-md);
          font-size: 14px; font-weight: 500;
          color: var(--text-secondary); text-decoration: none;
          border: 1px solid var(--border-normal);
          background: var(--accent-subtle);
          transition: color 0.2s, background 0.2s, border-color 0.2s, transform 0.2s var(--ease-out);
        }
        .land-btn-ghost:hover {
          color: var(--text-primary); background: color-mix(in srgb, var(--accent-subtle) 200%, transparent);
          border-color: var(--accent-border); text-decoration: none;
          transform: translateY(-1px);
        }
        .land-btn-lg { padding: 15px 32px; font-size: 15px; }
        .land-btn-ghost-lg { padding: 14px 26px; font-size: 15px; }

        /* Depth meter — desktop */
        .land-depth-meter {
          display: flex; flex-direction: column; gap: 6px;
          padding-top: 4px;
        }
        .land-dm-track {
          height: 2px; background: var(--border-subtle);
          border-radius: 2px; overflow: hidden; position: relative;
        }
        .land-dm-fill {
          position: absolute; top: 0; left: 0; bottom: 0;
          width: 68%;
          background: linear-gradient(90deg, var(--accent), var(--gold));
          border-radius: 2px;
          animation: fill-pulse 4s ease-in-out infinite;
        }
        @keyframes fill-pulse {
          0%, 100% { width: 65%; opacity: 0.8; }
          50%       { width: 72%; opacity: 1; }
        }
        .land-dm-labels {
          display: flex; justify-content: space-between;
          font-size: 11px; letter-spacing: 0.05em;
          color: var(--text-muted); font-variant-numeric: tabular-nums;
        }
        .land-dm-depth { color: var(--accent); }

        /* ── Hero visual ── */
        .land-hero-visual {
          display: flex; align-items: center; justify-content: center;
        }

        /* ── Sonar separator ── */
        .land-sonar-line {
          position: relative; z-index: 1;
          display: flex; align-items: center; gap: 16px;
          padding: 0 clamp(20px, 5vw, 80px);
          margin: 0 0 70px;
        }
        .land-sonar-line::after {
          content: '';
          flex: 1;
          height: 1px;
          background: linear-gradient(90deg, var(--border-subtle), transparent);
        }
        .land-sonar-ping {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--accent); flex-shrink: 0;
          box-shadow: 0 0 8px var(--accent-glow);
          animation: ping 2s ease-in-out infinite;
        }
        @keyframes ping {
          0%, 100% { box-shadow: 0 0 4px var(--accent-glow); }
          50%       { box-shadow: 0 0 14px var(--accent), 0 0 28px var(--accent-subtle); }
        }
        .land-sonar-text {
          font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--text-muted); font-variant-numeric: tabular-nums;
        }

        /* ── Features ── */
        .land-features {
          position: relative; z-index: 1;
          padding: 0 clamp(20px, 5vw, 80px) 100px;
          max-width: 1240px; margin: 0 auto;
          display: flex; flex-direction: column; gap: 14px;
        }

        /* ── Bento rows ── */
        .land-bento-row { display: grid; gap: 14px; }
        .land-bento-row-1 { grid-template-columns: 1fr 1fr; }
        .land-bento-row-2 { grid-template-columns: 1fr; }
        .land-bento-row-3 { grid-template-columns: repeat(3, 1fr); }
        @media (max-width: 768px) {
          .land-bento-row-1 { grid-template-columns: 1fr; }
          .land-bento-row-3 { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 480px) {
          .land-bento-row-3 { grid-template-columns: 1fr; }
        }

        /* ── Cards ── */
        .land-card {
          position: relative; overflow: hidden;
          background: color-mix(in srgb, var(--bg-base) 85%, transparent);
          border: 1px solid var(--border-subtle);
          border-radius: 16px;
          backdrop-filter: blur(12px);
          transition: border-color 0.3s var(--ease-out), transform 0.25s var(--ease-out), box-shadow 0.3s var(--ease-out);
        }
        .land-card:hover {
          border-color: var(--accent-border);
          transform: translateY(-3px);
          box-shadow: 0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px var(--border-normal), 0 0 32px var(--accent-glow);
        }
        .land-card-glow {
          position: absolute; inset: 0; pointer-events: none;
          border-radius: 16px; opacity: 0;
          transition: opacity 0.4s var(--ease-out);
        }
        .land-card:hover .land-card-glow { opacity: 1; }
        .land-card-glow-voice  { background: radial-gradient(circle at 25% 50%, var(--accent-subtle) 0%, transparent 65%); }
        .land-card-glow-session { background: radial-gradient(circle at 80% 20%, var(--gold-subtle) 0%, transparent 60%); }
        .land-card-glow-tsumugi   { background: radial-gradient(circle at 50% 100%, rgba(14,165,233,0.08) 0%, transparent 60%); }
        .land-card-glow-irc    { background: radial-gradient(circle at 30% 30%, var(--accent-subtle) 0%, transparent 70%); }
        .land-card-glow-wb     { background: radial-gradient(circle at 70% 70%, var(--gold-subtle) 0%, transparent 70%); }
        .land-card-glow-msg    { background: radial-gradient(circle at 50% 20%, var(--accent-subtle) 0%, transparent 70%); }

        /* Top inner shimmer */
        .land-card::before {
          content: '';
          position: absolute;
          top: 0; left: 20px; right: 20px;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--accent-border), transparent);
          border-radius: 0 0 99px 99px;
          opacity: 0.6;
          transition: opacity 0.3s;
        }
        .land-card:hover::before { opacity: 1; }

        .land-card-inner {
          padding: 32px 28px; display: flex; flex-direction: column; gap: 14px;
        }
        .land-card-inner-split {
          flex-direction: row; gap: 48px; align-items: center;
        }
        @media (max-width: 768px) {
          .land-card-inner-split { flex-direction: column; }
        }
        .land-card-text { flex: 1; display: flex; flex-direction: column; gap: 14px; }

        /* Eyebrows — more visually distinct */
        .land-card-eyebrow {
          display: inline-flex; align-items: center; gap: 7px;
          font-size: 10px; font-weight: 800; letter-spacing: 0.12em;
          text-transform: uppercase;
          padding: 4px 10px 4px 8px;
          border-radius: 6px;
          width: fit-content;
        }
        .land-eyebrow-voice {
          color: var(--accent);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
        }
        .land-eyebrow-gold {
          color: var(--gold);
          background: var(--gold-subtle);
          border: 1px solid rgba(103,232,249,0.25);
        }
        .land-eyebrow-tsumugi {
          color: #0ea5e9;
          background: rgba(14,165,233,0.1);
          border: 1px solid rgba(14,165,233,0.25);
        }
        .land-eyebrow-dim {
          color: var(--text-muted);
          background: color-mix(in srgb, var(--bg-base) 80%, transparent);
          border: 1px solid var(--border-subtle);
        }
        .land-eyebrow-dim:hover { color: var(--accent); }
        .land-card-eyebrow svg { opacity: 0.9; flex-shrink: 0; }

        /* Eyebrow status pip */
        .land-eyebrow-pip {
          width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0;
          background: currentColor; opacity: 0.8;
        }
        .land-eyebrow-pip-gold { background: var(--gold); }
        .land-eyebrow-pip-tsumugi { background: #0ea5e9; }
        .land-eyebrow-pip-dim  { background: var(--text-muted); }

        .land-card-h3 {
          font-size: 1.2rem; font-weight: 700; letter-spacing: -0.02em;
          color: var(--text-primary); margin: 0; line-height: 1.3;
        }
        .land-card-p {
          font-size: 0.875rem; line-height: 1.65;
          color: var(--text-secondary); margin: 0;
        }

        /* Voice waveform */
        .land-voice-vis {
          margin-top: 8px; height: 60px;
          display: flex; align-items: center;
        }

        /* Token display */
        .land-token-display {
          margin-top: 8px; display: flex; flex-direction: column; gap: 6px;
        }
        .land-token-row {
          font-family: var(--font-mono); font-size: 13px;
          padding: 8px 12px; border-radius: 8px;
          background: rgba(0,0,0,0.4); border: 1px solid var(--border-normal);
          display: flex; align-items: center; gap: 2px;
        }
        .land-token-prefix { color: var(--text-muted); }
        .land-token-body   { color: var(--gold); }
        .land-token-status {
          display: flex; align-items: center; gap: 7px;
          font-size: 12px; color: var(--status-online);
        }
        .land-token-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--status-online); flex-shrink: 0;
          box-shadow: 0 0 6px rgba(52,211,153,0.7);
          animation: dot-pulse 2s ease-in-out infinite;
        }

        /* TSUMUGI badges */
        .land-tsumugi-badges {
          display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px;
        }
        .land-tsumugi-badge {
          font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
          text-transform: uppercase;
          padding: 3px 8px; border-radius: 4px;
          color: #0ea5e9; background: rgba(14,165,233,0.1);
          border: 1px solid rgba(14,165,233,0.25);
        }

        /* TSUMUGI diagram area */
        .land-tsumugi-diagram { flex-shrink: 0; align-self: flex-start; }

        /* IRC server tag */
        .land-irc-tag {
          margin-top: 8px; display: inline-flex;
        }
        .land-irc-tag-text {
          font-family: var(--font-mono); font-size: 11px;
          color: var(--accent); background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          padding: 4px 10px; border-radius: 6px;
          letter-spacing: 0.02em;
        }

        /* ── Shared section headings ── */
        .land-section-heading {
          position: relative; z-index: 1;
          max-width: 740px;
          margin: 0 auto 28px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .land-section-heading-compact { margin-bottom: 22px; }
        .land-section-kicker {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          padding: 5px 10px;
          border-radius: 999px;
          border: 1px solid var(--accent-border);
          background: var(--accent-subtle);
          color: var(--accent);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .land-section-title {
          margin: 0;
          color: var(--text-primary);
          font-size: clamp(2rem, 4vw, 3rem);
          font-weight: 850;
          line-height: 1.08;
          letter-spacing: -0.03em;
        }
        .land-section-copy {
          margin: 0;
          color: var(--text-secondary);
          font-size: clamp(0.98rem, 1.4vw, 1.08rem);
          line-height: 1.65;
        }

        /* ── Product preview ── */
        .land-preview {
          position: relative; z-index: 1;
          padding: 10px clamp(20px, 5vw, 80px) 90px;
          max-width: 1240px;
          margin: 0 auto;
        }
        .land-app-preview {
          display: grid;
          grid-template-columns: 72px 220px minmax(0, 1fr) 190px;
          min-height: 430px;
          overflow: hidden;
          border-radius: var(--r-2xl, 20px) var(--r-md, 8px) var(--r-lg, 12px) var(--r-sm, 6px);
          border: 0;
          background:
            linear-gradient(180deg, rgba(14,165,233,0.07), transparent 34%),
            color-mix(in srgb, var(--bg-base) 92%, transparent);
        }
        .land-preview-rail,
        .land-preview-sidebar,
        .land-preview-chat,
        .land-preview-members {
          min-width: 0;
          border-right: 1px solid var(--border-subtle);
        }
        .land-preview-rail {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 18px 0;
          background: rgba(0,0,0,0.28);
        }
        .land-preview-orb {
          width: 42px; height: 42px;
          border-radius: 14px;
          display: grid; place-items: center;
          color: var(--text-muted);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          font-size: 13px;
          font-weight: 800;
        }
        .land-preview-orb-active {
          color: var(--bg-void);
          background: linear-gradient(135deg, var(--accent), var(--gold));
          box-shadow: 0 0 24px var(--accent-glow);
        }
        .land-preview-sidebar {
          padding: 18px 14px;
          background: rgba(0,0,0,0.16);
        }
        .land-preview-server {
          color: var(--text-primary);
          font-size: 14px;
          font-weight: 800;
          margin-bottom: 18px;
        }
        .land-preview-group {
          color: var(--text-muted);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin: 16px 0 8px;
        }
        .land-preview-channel,
        .land-preview-member {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 34px;
          padding: 0 10px;
          border-radius: 8px;
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 600;
        }
        .land-preview-channel span {
          color: var(--text-muted);
          font-family: var(--font-mono);
        }
        .land-preview-channel-active {
          color: var(--accent);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
        }
        .land-preview-voice {
          color: var(--status-online);
          background: rgba(52,211,153,0.08);
          border: 1px solid rgba(52,211,153,0.18);
        }
        .land-preview-voice svg { width: 12px; height: 12px; }
        .land-preview-chat {
          display: flex;
          flex-direction: column;
          background: rgba(2,6,23,0.22);
        }
        .land-preview-chat-head {
          min-height: 58px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 0 20px;
          border-bottom: 1px solid var(--border-subtle);
          color: var(--text-primary);
          font-size: 15px;
          font-weight: 800;
        }
        .land-preview-chat-head span { color: var(--text-muted); margin-right: 4px; }
        .land-preview-tools {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .land-preview-tools span,
        .land-preview-pill-row span {
          margin: 0;
          padding: 4px 8px;
          border-radius: 999px;
          color: var(--text-secondary);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          font-size: 11px;
          font-weight: 700;
        }
        .land-preview-message {
          display: grid;
          grid-template-columns: 38px minmax(0, 1fr);
          gap: 12px;
          padding: 20px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .land-preview-avatar {
          width: 38px; height: 38px;
          border-radius: 12px;
          display: grid; place-items: center;
          color: var(--bg-void);
          background: var(--accent);
          font-size: 14px;
          font-weight: 900;
        }
        .land-preview-avatar-gold { background: var(--gold); }
        .land-preview-name {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 800;
          margin-bottom: 4px;
        }
        .land-preview-name span {
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 600;
        }
        .land-preview-message p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.55;
        }
        .land-preview-pill-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 10px;
        }
        .land-preview-composer {
          margin: auto 20px 20px;
          min-height: 44px;
          display: flex;
          align-items: center;
          padding: 0 14px;
          border-radius: 12px;
          color: var(--text-muted);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          font-size: 13px;
        }
        .land-preview-members {
          border-right: 0;
          padding: 18px 14px;
          background: rgba(0,0,0,0.12);
        }
        .land-preview-presence {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: var(--status-online);
          box-shadow: 0 0 8px rgba(52,211,153,0.55);
        }
        .land-preview-status {
          margin-top: 22px;
          padding: 14px;
          border-radius: 12px;
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .land-preview-status strong {
          color: var(--accent);
          font-size: 12px;
        }
        .land-preview-status span {
          color: var(--text-secondary);
          font-size: 12px;
          line-height: 1.45;
        }

        /* ── Capabilities ── */
        .land-capabilities {
          position: relative; z-index: 1;
          max-width: 1240px;
          margin: 0 auto;
          padding: 0 clamp(20px, 5vw, 80px) 90px;
        }
        .land-cap-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }
        .land-cap-card {
          border: 1px solid var(--border-subtle);
          border-radius: 16px;
          padding: 22px;
          background: color-mix(in srgb, var(--bg-base) 86%, transparent);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
        }
        .land-cap-card h3 {
          margin: 0 0 14px;
          color: var(--text-primary);
          font-size: 1rem;
          letter-spacing: -0.01em;
        }
        .land-cap-card ul {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 11px;
        }
        .land-cap-card li {
          display: flex;
          align-items: center;
          gap: 9px;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.35;
        }
        .land-cap-check {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: var(--accent);
          box-shadow: 0 0 8px var(--accent-glow);
          flex-shrink: 0;
        }

        /* ── Connect ── */
        .land-connect {
          position: relative; z-index: 1;
          max-width: 1240px;
          margin: 0 auto;
          padding: 0 clamp(20px, 5vw, 80px) 90px;
        }
        .land-connect-grid {
          display: grid;
          grid-template-columns: 1.2fr 1fr 1fr;
          gap: 14px;
        }
        .land-connect-card {
          min-height: 230px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 12px;
          padding: 26px;
          border-radius: 18px;
          border: 1px solid var(--border-subtle);
          background: color-mix(in srgb, var(--bg-base) 88%, transparent);
        }
        .land-connect-card-primary {
          background:
            radial-gradient(circle at 20% 20%, var(--accent-subtle), transparent 58%),
            color-mix(in srgb, var(--bg-elevated) 88%, transparent);
          border-color: var(--accent-border);
        }
        .land-connect-label {
          color: var(--accent);
          background: var(--accent-subtle);
          border: 1px solid var(--accent-border);
          border-radius: 999px;
          padding: 4px 9px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .land-connect-card h3 {
          margin: 0;
          color: var(--text-primary);
          font-size: 1.15rem;
          letter-spacing: -0.02em;
        }
        .land-connect-card p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 0.9rem;
          line-height: 1.6;
        }
        .land-connect-card code {
          margin-top: auto;
          color: var(--gold);
          background: rgba(0,0,0,0.36);
          border: 1px solid var(--border-normal);
          border-radius: 8px;
          padding: 8px 10px;
          font-family: var(--font-mono);
          font-size: 12px;
        }
        .land-connect-action {
          margin-top: auto;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--bg-void);
          background: linear-gradient(135deg, var(--accent), var(--accent-hover));
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 13px;
          font-weight: 800;
          text-decoration: none;
        }
        .land-connect-action:hover { text-decoration: none; color: var(--bg-void); }
        @media (max-width: 980px) {
          .land-connect-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }

        /* ── FAQ ── */
        .land-faq {
          position: relative; z-index: 1;
          max-width: 1120px;
          margin: 0 auto;
          padding: 0 clamp(20px, 5vw, 80px) 80px;
        }
        .land-faq-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .land-faq-item {
          border: 1px solid var(--border-subtle);
          border-radius: 16px;
          background: color-mix(in srgb, var(--bg-base) 84%, transparent);
          padding: 22px;
        }
        .land-faq-item h3 {
          margin: 0 0 8px;
          color: var(--text-primary);
          font-size: 0.98rem;
          letter-spacing: -0.01em;
        }
        .land-faq-item p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 0.88rem;
          line-height: 1.6;
        }

        /* ── Community ── */
        .land-community {
          position: relative; z-index: 1;
          overflow: hidden;
          margin: 20px clamp(20px, 5vw, 80px);
          border-radius: 28px;
          background: linear-gradient(
            155deg,
            color-mix(in srgb, var(--bg-elevated) 80%, transparent) 0%,
            color-mix(in srgb, var(--bg-deep) 90%, transparent) 100%
          );
          border: 1px solid var(--border-normal);
          padding: clamp(70px, 9vw, 110px) clamp(32px, 5vw, 80px);
          text-align: center;
          box-shadow: inset 0 1px 0 var(--accent-border), 0 32px 80px rgba(0,0,0,0.4);
        }
        .land-community::before {
          content: '';
          position: absolute;
          top: 0; left: 10%; right: 10%;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--accent-border), transparent);
        }
        /* Subtle bottom glow */
        .land-community::after {
          content: '';
          position: absolute;
          bottom: -60px; left: 20%; right: 20%;
          height: 120px;
          background: radial-gradient(ellipse, var(--accent-glow) 0%, transparent 70%);
          pointer-events: none;
        }
        .land-community-bg {
          position: absolute; inset: 0; pointer-events: none; opacity: 0.15;
          display: flex; align-items: center; justify-content: center;
        }
        .land-community-inner {
          position: relative; z-index: 1;
          display: flex; flex-direction: column;
          align-items: center; gap: 28px;
          max-width: 680px; margin: 0 auto;
        }
        .land-community-label {
          display: inline-flex; align-items: center; gap: 8px;
          font-size: 11px; font-weight: 800; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--text-muted);
        }
        .land-community-label-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--status-online);
          box-shadow: 0 0 8px rgba(52,211,153,0.6);
          flex-shrink: 0;
          animation: dot-pulse 2s ease-in-out infinite;
        }
        .land-community-h2 {
          font-size: clamp(2.2rem, 4.5vw, 3.5rem); font-weight: 800;
          letter-spacing: -0.03em; line-height: 1.1; color: var(--text-primary); margin: 0;
        }
        .land-community-p {
          font-size: clamp(1rem, 1.4vw, 1.1rem); line-height: 1.7;
          color: var(--text-secondary); margin: 0;
        }
        .land-channel-pill {
          font-family: var(--font-mono); font-size: 0.92em;
          color: var(--accent); background: var(--accent-subtle);
          padding: 1px 6px; border-radius: 4px;
          border: 1px solid var(--accent-border);
        }

        /* Channel list preview */
        .land-channels {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          justify-content: center;
          padding: 16px 20px;
          background: var(--bg-void);
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          width: 100%;
          max-width: 480px;
          box-shadow: inset 0 1px 0 var(--border-subtle);
        }
        /* Channel staggered entrance */
        .land-ch-enter {
          animation: ch-slide-in 0.5s var(--ease-out) both;
          animation-delay: var(--ch-delay, 0ms);
        }
        @keyframes ch-slide-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .land-ch {
          display: flex; align-items: center; gap: 5px;
          font-size: 13px; font-family: var(--font-mono);
          padding: 6px 14px; border-radius: 20px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          transition: border-color 0.25s, color 0.25s, background 0.25s, transform 0.2s var(--ease-out);
          cursor: default;
        }
        .land-ch:hover {
          border-color: var(--border-normal);
          color: var(--text-primary);
          transform: translateY(-1px);
        }
        .land-ch-hash { color: var(--text-muted); font-size: 12px; }
        .land-ch-active {
          background: var(--accent-subtle);
          border-color: var(--accent-border);
          color: var(--accent);
          box-shadow: 0 0 12px var(--accent-subtle);
        }
        .land-ch-live {
          font-size: 9px; font-weight: 800; letter-spacing: 0.06em;
          color: var(--bg-void); background: var(--accent);
          padding: 2px 6px; border-radius: 4px; margin-left: 2px;
        }
        .land-ch-voice {
          border-color: rgba(52,211,153,0.25);
          color: var(--status-online);
        }
        .land-ch-voice:hover { border-color: rgba(52,211,153,0.45); }
        .land-ch-voice svg { width: 11px; height: 11px; opacity: 0.9; }

        /* Community CTA group */
        .land-community-cta-group {
          display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
          justify-content: center;
        }

        /* ── Footer ── */
        .land-footer {
          position: relative; z-index: 1;
          display: grid;
          grid-template-columns: 1fr auto auto;
          align-items: center;
          gap: 24px 40px;
          padding: 40px clamp(20px, 5vw, 80px) max(40px, env(safe-area-inset-bottom, 0px));
          border-top: 1px solid var(--border-subtle);
          margin-top: 20px;
        }
        .land-footer-left { display: flex; flex-direction: column; gap: 5px; }
        .land-footer-logo {
          display: flex; align-items: center; gap: 8px;
          font-size: 15px; font-weight: 700; color: var(--text-primary);
        }
        .land-footer-tagline { font-size: 12px; color: var(--text-muted); }
        .land-footer-links { display: flex; align-items: center; gap: 20px; }
        .land-footer-link {
          font-size: 13px; color: var(--text-muted); text-decoration: none;
          transition: color 0.2s;
        }
        .land-footer-link:hover { color: var(--text-secondary); text-decoration: none; }
        .land-footer-copy { font-size: 12px; color: var(--text-muted); margin: 0; white-space: nowrap; }

        /* ── Mobile — 640px and below ── */
        @media (max-width: 640px) {
          .land-nav {
            height: calc(52px + env(safe-area-inset-top, 0px));
            padding: env(safe-area-inset-top, 0px) 16px 0;
          }
          .land-nav-link { display: none; }
          .land-nav-wordmark { font-size: 15px; }
          .land-nav-cta { font-size: 12px; padding: 6px 14px; }

          .land-hero { padding: calc(80px + env(safe-area-inset-top, 0px)) 16px 64px; min-height: auto; }
          .land-hero-body { gap: 32px; }
          .land-hero-copy { gap: 20px; }
          .land-h1 { font-size: clamp(2.6rem, 9vw, 3.4rem); letter-spacing: -0.03em; }
          .land-lead { font-size: 0.97rem; line-height: 1.65; }

          .land-hero-actions { flex-direction: column; align-items: stretch; gap: 10px; }
          .land-btn-primary, .land-btn-ghost { justify-content: center; padding: 15px 20px; font-size: 15px; text-align: center; }

          .land-depth-meter { display: none; }

          .land-sonar-line { margin-bottom: 40px; padding: 0 16px; }
          .land-sonar-text { font-size: 12px; letter-spacing: 0.05em; }

          .land-features { padding: 0 12px 64px; }
          .land-bento-row { gap: 10px; }
          .land-bento-row-1, .land-bento-row-2, .land-bento-row-3 { grid-template-columns: 1fr; }

          .land-card-inner { padding: 22px 18px; gap: 10px; }
          .land-card-inner-split { flex-direction: column; gap: 20px; }
          .land-tsumugi-diagram { align-self: center; }
          .land-card-h3 { font-size: 1.05rem; }
          .land-card-p { font-size: 0.85rem; }

          .land-section-heading { margin-bottom: 20px; align-items: flex-start; text-align: left; }
          .land-section-title { font-size: clamp(1.75rem, 8vw, 2.25rem); }
          .land-preview, .land-capabilities, .land-connect, .land-faq {
            padding-left: 12px;
            padding-right: 12px;
            padding-bottom: 64px;
          }
          .land-app-preview {
            grid-template-columns: 56px minmax(0, 1fr);
            min-height: auto;
            border-radius: 18px;
          }
          .land-preview-rail { grid-row: 1 / span 3; }
          .land-preview-sidebar { border-right: 0; }
          .land-preview-chat {
            grid-column: 2;
            border-top: 1px solid var(--border-subtle);
            border-right: 0;
          }
          .land-preview-chat-head { align-items: flex-start; flex-direction: column; padding: 14px; gap: 10px; }
          .land-preview-tools { justify-content: flex-start; }
          .land-preview-message { padding: 16px 14px; }
          .land-preview-composer { margin: 10px 14px 14px; }
          .land-preview-members {
            grid-column: 2;
            border-top: 1px solid var(--border-subtle);
            padding: 14px;
          }
          .land-cap-grid,
          .land-connect-grid,
          .land-faq-grid { grid-template-columns: 1fr; }
          .land-connect-card { min-height: 0; padding: 22px; }

          .land-community { margin: 10px 12px; padding: 44px 20px; border-radius: 20px; }
          .land-community-h2 { font-size: clamp(1.8rem, 8vw, 2.4rem); }
          .land-community-p { font-size: 0.95rem; }
          .land-channels { padding: 14px 14px; gap: 7px; }
          .land-ch { font-size: 12px; padding: 5px 11px; }
          .land-community-cta-group { flex-direction: column; align-items: stretch; gap: 10px; }
          .land-btn-lg, .land-btn-ghost-lg { text-align: center; justify-content: center; }

          .land-footer {
            grid-template-columns: 1fr;
            text-align: center;
            padding: 28px 16px max(28px, env(safe-area-inset-bottom, 0px));
            gap: 16px;
          }
          .land-footer-links { flex-wrap: wrap; justify-content: center; gap: 14px; }
          .land-footer-left { align-items: center; }
          .land-footer-copy { order: 3; }
        }

        /* ── Mobile — 375px and below ── */
        @media (max-width: 375px) {
          .land-h1 { font-size: 2.4rem; }
          .land-card-inner { padding: 18px 14px; }
          .land-community { margin: 10px 8px; padding: 36px 16px; }
          .land-features { padding: 0 8px 56px; }
          .land-preview, .land-capabilities, .land-connect, .land-faq {
            padding-left: 8px;
            padding-right: 8px;
          }
          .land-preview-message {
            grid-template-columns: 32px minmax(0, 1fr);
            gap: 10px;
          }
          .land-preview-avatar { width: 32px; height: 32px; border-radius: 10px; }
          .land-hero { padding: calc(72px + env(safe-area-inset-top, 0px)) 12px 56px; }
          .land-nav { padding: env(safe-area-inset-top, 0px) 12px 0; }
        }
      `}</style>
    </main>
  );
}

// ── Custom CSS property type ──────────────────────────────────────────────
type ChDelayCSSProps = CSSProperties & { '--ch-delay'?: string };

// ── SVG Components ─────────────────────────────────────────────────────────────

function OceanLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <circle cx="14" cy="14" r="12" stroke="var(--accent)" strokeWidth="1.5" fill="var(--accent-subtle)" />
      <path d="M4 14c3-4 6-4 6 0s3 4 6 0 3-4 6 0" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M4 17c3-3 6-3 6 0s3 3 6 0 3-3 6 0" stroke="var(--gold)" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.5" />
    </svg>
  );
}

function ArrowRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 7h9M8 3.5L11.5 7 8 10.5" />
    </svg>
  );
}

function VoiceIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M7.5 1a2 2 0 0 0-2 2v4.5a2 2 0 0 0 4 0V3a2 2 0 0 0-2-2z" />
      <path d="M3.5 6.5a4 4 0 0 0 8 0" strokeLinecap="round" />
      <path d="M7.5 10.5v3" strokeLinecap="round" />
    </svg>
  );
}

function TokenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="4" width="11" height="7.5" rx="1.5" />
      <path d="M5 7.5h5M5 9.5h3" strokeLinecap="round" />
      <circle cx="11" cy="4" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TsumugiIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M7.5 1L2 4v5c0 3.5 2.5 6.5 5.5 7.5C10.5 15.5 13 12.5 13 9V4L7.5 1z" strokeLinejoin="round" />
      <path d="M5.5 7.5l1.5 1.5 3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IrcIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 3a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V3z" strokeLinejoin="round" />
      <path d="M5 6h5M5 8.5h3" strokeLinecap="round" />
    </svg>
  );
}

function WbIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="1.5" width="12" height="10" rx="1.5" />
      <path d="M4 9l2-2 1.5 1.5L10 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 12.5h7" strokeLinecap="round" />
    </svg>
  );
}

function MsgIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M13 1.5H2A1.5 1.5 0 0 0 .5 3v7A1.5 1.5 0 0 0 2 11.5h2.5L7.5 14l3-2.5H13a1.5 1.5 0 0 0 1.5-1.5V3A1.5 1.5 0 0 0 13 1.5z" />
      <path d="M4.5 5.5h6M4.5 8h4" strokeLinecap="round" />
    </svg>
  );
}

function VoiceSmIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M6 1a1.5 1.5 0 0 0-1.5 1.5v3a1.5 1.5 0 0 0 3 0V2.5A1.5 1.5 0 0 0 6 1z" />
      <path d="M2.5 5a3.5 3.5 0 0 0 7 0M6 8.5V11" strokeLinecap="round" />
    </svg>
  );
}

// ── Ocean depth visualization (right side hero) ────────────────────────────

function OceanDepthVis() {
  return (
    <svg width="420" height="500" viewBox="0 0 420 500" fill="none" role="img" aria-label="Ocean depth visualization showing connected community channels">
      <defs>
        <linearGradient id="ocean-depth" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.15" />
          <stop offset="40%" stopColor="#0284c7" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#020b18" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="glow-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0" />
          <stop offset="50%" stopColor="#0ea5e9" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
        </linearGradient>
        <filter id="blur-glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="node-glow">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="bio-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#67e8f9" stopOpacity="0" />
        </radialGradient>
        {/* Animated wave path */}
        <linearGradient id="wave-grad-1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.05" />
          <stop offset="50%" stopColor="#0ea5e9" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* Ocean water fill */}
      <rect width="420" height="500" fill="url(#ocean-depth)" rx="20" />

      {/* Wave layers at top — animated */}
      <g opacity="0.6">
        <path d="M0 60 Q52 45 105 60 Q157 75 210 60 Q262 45 315 60 Q367 75 420 60 L420 80 Q367 95 315 80 Q262 65 210 80 Q157 95 105 80 Q52 65 0 80Z"
          fill="url(#wave-grad-1)">
          <animateTransform attributeName="transform" type="translate" values="0,0;-105,0;0,0" dur="8s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" />
        </path>
        <path d="M0 80 Q70 65 140 80 Q210 95 280 80 Q350 65 420 80 L420 95 Q350 110 280 95 Q210 80 140 95 Q70 110 0 95Z"
          fill="url(#wave-grad-1)" opacity="0.5">
          <animateTransform attributeName="transform" type="translate" values="0,0;105,0;0,0" dur="11s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" />
        </path>
      </g>

      {/* Depth level lines */}
      {[120, 200, 280, 360, 440].map((y, i) => (
        <g key={y}>
          <line x1="20" y1={y} x2="400" y2={y} stroke="rgba(14,165,233,0.06)" strokeWidth="1" />
          <text x="24" y={y - 5} fill="rgba(14,165,233,0.25)" fontSize="8.5" fontFamily="monospace">
            {`${[200,500,1000,2000,4000][i]}m`}
          </text>
        </g>
      ))}

      {/* Sunlight rays from top */}
      {[80, 160, 240, 330].map((x, i) => (
        <line
          key={x}
          x1={x} y1={0}
          x2={x + (i % 2 === 0 ? -24 : 24)} y2={260}
          stroke="url(#glow-line)"
          strokeWidth={i === 1 ? 2 : 1}
          opacity={0.45 - i * 0.08}
        />
      ))}

      {/* Connecting lines between nodes */}
      {[
        [120, 100, 300, 80],
        [120, 100, 200, 200],
        [300, 80,  200, 200],
        [200, 200, 80,  265],
        [200, 200, 340, 305],
        [80,  265, 340, 305],
      ].map(([x1,y1,x2,y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="rgba(14,165,233,0.1)" strokeWidth="1"
          strokeDasharray={i > 3 ? "4 4" : "none"}
        />
      ))}

      {/* Animated chat-bubble/message nodes */}
      {[
        { cx: 120, cy: 100, r: 32, label: '#root', active: true, voice: false },
        { cx: 300, cy: 80,  r: 23, label: '#dev',  active: false, voice: false },
        { cx: 200, cy: 200, r: 28, label: 'voice', active: false, voice: true },
        { cx: 80,  cy: 265, r: 19, label: '#art',  active: false, voice: false },
        { cx: 340, cy: 305, r: 21, label: '#lounge', active: false, voice: false },
      ].map(({ cx, cy, r, label, active, voice }) => (
        <g key={label} filter={active ? "url(#node-glow)" : "url(#blur-glow)"}>
          <circle
            cx={cx} cy={cy} r={r}
            fill={active ? 'rgba(14,165,233,0.22)' : voice ? 'rgba(52,211,153,0.14)' : 'rgba(14,165,233,0.08)'}
            stroke={active ? 'rgba(14,165,233,0.8)' : voice ? 'rgba(52,211,153,0.45)' : 'rgba(14,165,233,0.22)'}
            strokeWidth={active ? 1.5 : 1}
          />
          {active && (
            <>
              <circle cx={cx} cy={cy} r={r + 7} fill="none"
                stroke="rgba(14,165,233,0.18)" strokeWidth="1"
                strokeDasharray="3 3">
                <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="20s" repeatCount="indefinite" />
              </circle>
              <circle cx={cx} cy={cy} r={r + 14} fill="none"
                stroke="rgba(14,165,233,0.07)" strokeWidth="1">
                <animate attributeName="r" values={`${r+12};${r+18};${r+12}`} dur="3s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0;0.4" dur="3s" repeatCount="indefinite" />
              </circle>
            </>
          )}
          <text x={cx} y={cy + 4} textAnchor="middle"
            fill={active ? '#0ea5e9' : voice ? '#34d399' : 'rgba(14,165,233,0.55)'}
            fontSize={label.length > 6 ? 7.5 : 8.5}
            fontFamily="monospace" fontWeight={active ? '700' : '400'}
          >
            {voice ? '♪' : '#'}{label.replace('#', '')}
          </text>
        </g>
      ))}

      {/* Bioluminescent particles — deep zone */}
      {[
        [160, 355, 0.55], [250, 385, 0.4], [90, 425, 0.5], [320, 415, 0.35],
        [185, 465, 0.6],  [280, 445, 0.4], [60,  345, 0.3], [375, 365, 0.45],
        [130, 410, 0.35], [305, 475, 0.5],
      ].map(([cx, cy, op], i) => (
        <circle key={i} cx={cx} cy={cy} r={1.5}
          fill="#67e8f9"
          opacity={op}>
          <animate attributeName="opacity" values={`${op};${(op as number) * 0.3};${op}`} dur={`${3 + (i % 4)}s`} repeatCount="indefinite" begin={`${i * 0.4}s`} />
        </circle>
      ))}

      {/* Depth vessel (Ocean app icon) near bottom */}
      <g transform="translate(183, 425)">
        <ellipse cx="27" cy="16" rx="24" ry="13"
          fill="rgba(14,165,233,0.12)"
          stroke="rgba(14,165,233,0.55)"
          strokeWidth="1.5"
        />
        {/* Vessel glow */}
        <ellipse cx="27" cy="16" rx="24" ry="13"
          fill="none"
          stroke="rgba(14,165,233,0.2)"
          strokeWidth="6"
          filter="url(#blur-glow)"
        />
        <text x="27" y="20" textAnchor="middle"
          fill="#0ea5e9" fontSize="9.5" fontFamily="monospace" fontWeight="600"
        >
          Ocean
        </text>
        <circle cx="13" cy="16" r="3.5" fill="rgba(14,165,233,0.15)" stroke="rgba(14,165,233,0.4)" strokeWidth="1" />
        <circle cx="27" cy="16" r="3.5" fill="rgba(14,165,233,0.15)" stroke="rgba(14,165,233,0.4)" strokeWidth="1" />
        <circle cx="41" cy="16" r="3.5" fill="rgba(14,165,233,0.15)" stroke="rgba(14,165,233,0.4)" strokeWidth="1" />
      </g>
    </svg>
  );
}

// ── Waveform visualization ──────────────────────────────────────────────────

function WaveformVis() {
  const bars = [0.3, 0.5, 0.8, 1.0, 0.7, 0.9, 0.6, 0.4, 0.8, 0.7, 0.5, 0.9, 1.0, 0.6, 0.3, 0.7, 0.9, 0.5, 0.4, 0.8];
  return (
    <svg width="100%" height="60" viewBox="0 0 200 60" preserveAspectRatio="none" role="img" aria-label="Audio waveform">
      <defs>
        <linearGradient id="waveform-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.3" />
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
            opacity={0.55 + h * 0.45}>
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

// ── TSUMUGI key exchange visualization ───────────────────────────────────────

function TsumugiKeyVis() {
  return (
    <svg width="220" height="170" viewBox="0 0 220 170" fill="none" role="img" aria-label="TSUMUGI key exchange diagram">
      <defs>
        <radialGradient id="tsumugi-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="shared-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#67e8f9" stopOpacity="0" />
        </radialGradient>
        <filter id="tsumugi-blur">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Left node — client A */}
      <circle cx="42" cy="85" r="30" fill="rgba(14,165,233,0.12)" stroke="rgba(14,165,233,0.45)" strokeWidth="1.5" />
      <circle cx="42" cy="85" r="30" fill="url(#tsumugi-glow)" filter="url(#tsumugi-blur)" opacity="0.5" />
      {/* Key icon */}
      <g transform="translate(28, 71)">
        <circle cx="9" cy="9" r="7" stroke="rgba(14,165,233,0.9)" strokeWidth="1.4" fill="none" />
        <rect x="14" y="7" width="10" height="4" rx="1" stroke="rgba(14,165,233,0.9)" strokeWidth="1.2" fill="none" />
        <rect x="21" y="11" width="3" height="3" rx="0.5" fill="rgba(14,165,233,0.9)" />
      </g>
      <text x="42" y="126" textAnchor="middle" fill="rgba(14,165,233,0.7)" fontSize="8.5" fontFamily="monospace" fontWeight="600">P-256</text>

      {/* Right node — client B */}
      <circle cx="178" cy="85" r="30" fill="rgba(14,165,233,0.12)" stroke="rgba(14,165,233,0.45)" strokeWidth="1.5" />
      <circle cx="178" cy="85" r="30" fill="none" stroke="rgba(14,165,233,0.15)" strokeWidth="8" filter="url(#tsumugi-blur)" />
      {/* Lock icon */}
      <g transform="translate(163, 71)">
        <rect x="1" y="8" width="13" height="11" rx="2" stroke="rgba(14,165,233,0.9)" strokeWidth="1.4" fill="rgba(14,165,233,0.1)" />
        <path d="M4 8V5.5a3.5 3.5 0 0 1 7 0V8" stroke="rgba(14,165,233,0.9)" strokeWidth="1.4" fill="none" />
        <circle cx="7.5" cy="13" r="1.5" fill="rgba(14,165,233,0.9)" />
      </g>
      <text x="178" y="126" textAnchor="middle" fill="rgba(14,165,233,0.7)" fontSize="8.5" fontFamily="monospace" fontWeight="600">ECDH</text>

      {/* Center shared secret */}
      <circle cx="110" cy="85" r="22" fill="url(#shared-glow)" />
      <circle cx="110" cy="85" r="22" fill="rgba(103,232,249,0.1)" stroke="rgba(103,232,249,0.55)" strokeWidth="1.5">
        <animate attributeName="stroke-opacity" values="0.55;0.85;0.55" dur="2.5s" repeatCount="indefinite" />
      </circle>
      {/* Check mark */}
      <path d="M100 85l7 7 13-13" stroke="#67e8f9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="110" y="118" textAnchor="middle" fill="rgba(103,232,249,0.75)" fontSize="8.5" fontFamily="monospace" fontWeight="600">AES-GCM</text>

      {/* Exchange arc — top (A→B) */}
      <path d="M70 72 Q110 42 150 72" stroke="rgba(14,165,233,0.5)" strokeWidth="1.5" fill="none" strokeDasharray="5 4">
        <animate attributeName="stroke-dashoffset" values="0;-18" dur="1.5s" repeatCount="indefinite" />
      </path>
      {/* Arrow tip */}
      <polygon points="148,70 155,73 147,76" fill="rgba(14,165,233,0.6)" />

      {/* Exchange arc — bottom (B→A) */}
      <path d="M150 98 Q110 128 70 98" stroke="rgba(14,165,233,0.5)" strokeWidth="1.5" fill="none" strokeDasharray="5 4">
        <animate attributeName="stroke-dashoffset" values="0;-18" dur="1.5s" repeatCount="indefinite" />
      </path>
      <polygon points="72,96 65,99 73,102" fill="rgba(14,165,233,0.6)" />
    </svg>
  );
}

// ── Network visualization ──────────────────────────────────────────────────

function NetworkVis() {
  const nodes = [
    [50, 50], [150, 30], [250, 60], [340, 40], [420, 70],
    [80,  150], [200, 130], [300, 160], [380, 140],
    [60,  230], [170, 200], [270, 220], [360, 200], [440, 230],
    [100, 300], [230, 280], [320, 300], [410, 280],
  ];
  const edges = [
    [0,1],[1,2],[2,3],[3,4],[0,5],[1,6],[2,6],[3,7],[4,8],
    [5,6],[6,7],[7,8],[5,9],[6,10],[7,11],[8,12],[9,10],
    [10,11],[11,12],[9,13],[10,14],[11,15],[12,16],
  ];
  return (
    <svg width="480" height="340" viewBox="0 0 480 340" fill="none" aria-hidden>
      {edges.map(([a, b], i) => (
        <line key={i}
          x1={nodes[a][0]} y1={nodes[a][1]}
          x2={nodes[b][0]} y2={nodes[b][1]}
          stroke="var(--accent-border)" strokeWidth="1"
        />
      ))}
      {nodes.map(([cx, cy], i) => (
        <circle key={i}
          cx={cx} cy={cy} r={i < 4 ? 5 : 3}
          fill={i < 4 ? 'var(--accent-subtle)' : 'var(--gold-subtle)'}
          stroke={i < 4 ? 'var(--accent)' : 'var(--gold)'}
          strokeWidth="1"
          opacity={i < 4 ? 0.8 : 0.5}
        />
      ))}
    </svg>
  );
}
