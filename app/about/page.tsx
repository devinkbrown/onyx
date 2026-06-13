import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

export default function AboutPage() {
  return (
    <main className="about-root">
      {/* ── Skip link ── */}
      <a href="#about-main" className="about-skip-link">Skip to main content</a>

      {/* Atmosphere */}
      <div className="about-atmos" aria-hidden>
        <div className="about-atmos-halo" />
        <div className="about-atmos-grid" />
      </div>

      {/* Nav */}
      <nav className="about-nav">
        <Link href="/" className="about-nav-logo">
          <OceanLogo />
          <span className="about-nav-wordmark">Ocean</span>
          <span className="about-nav-sep" aria-hidden>/</span>
          <span className="about-nav-engine">Orochi</span>
        </Link>
        <div className="about-nav-links">
          <Link href="/" className="about-nav-link">Home</Link>
          <Link href="/login" className="about-nav-cta">
            Launch Ocean
            <ArrowRight size={13} />
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <div id="about-main" className="about-hero">
        <div className="about-container">
          <div className="about-badge">
            <span className="about-badge-dot" />
            <span>About</span>
          </div>
          <h1 className="about-h1">
            A chat network that
            <span className="about-h1-em"> owes nothing</span> to anyone.
          </h1>
          <p className="about-lead">
            Ocean is the client. Orochi is the engine. Together they are an
            independent network for people who care about open protocols, real
            conversations, and software that isn&rsquo;t quietly renting your
            community back to you.
          </p>
          <div className="about-hero-meta" aria-hidden>
            <div className="about-stat">
              <span className="about-stat-val">#root</span>
              <span className="about-stat-label">main channel</span>
            </div>
            <div className="about-stat-divider" />
            <div className="about-stat">
              <span className="about-stat-val">:6697</span>
              <span className="about-stat-label">TLS port</span>
            </div>
            <div className="about-stat-divider" />
            <div className="about-stat">
              <span className="about-stat-val">ML-KEM-768</span>
              <span className="about-stat-label">post-quantum links</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="about-container about-body">

        {/* What is Ocean */}
        <section className="about-section">
          <div className="about-section-label">
            <span className="about-section-label-line" />
            <span>What is this?</span>
          </div>
          <h2 className="about-h2">A modern client. A purpose-built engine.</h2>
          <div className="about-prose">
            <p>
              <strong>Ocean</strong> is a modern browser chat client. It has the
              things you expect from any serious chat app — servers, channels,
              DMs, voice and video, threads, reactions, search, and rich media —
              presented as a single, considered workspace rather than a pile of
              add-ons.
            </p>
            <p>
              Underneath, everything runs on <strong>Orochi</strong>: a
              clean-room engine written in pure Zig. It speaks open protocol, so
              any modern IRCv3 client can connect over TLS and SASL — but it was
              designed for the way people actually talk now, with real accounts,
              persistent sessions, post-quantum links, and native media baked
              into the protocol instead of bolted on after.
            </p>
          </div>
        </section>

        {/* Tech cards */}
        <section className="about-section">
          <div className="about-section-label">
            <span className="about-section-label-line" />
            <span>The technology</span>
          </div>
          <h2 className="about-h2">Four layers, one network.</h2>
          <div className="about-tech-grid">
            <TechCard
              name="Orochi"
              tag="Engine"
              accentVar="var(--lux)"
              desc="A clean-room IRC engine in pure Zig. Multithreaded sharded reactors, an IRCv3 + IRCX surface, SASL with SCRAM-SHA-256, EXTERNAL, and PLAIN, persistent session resume, and built-in account services — no NickServ bot, just real server commands."
              detail="eshmaki.me:6697"
            />
            <TechCard
              name="SUIMYAKU"
              tag="Mesh & media"
              accentVar="var(--accent)"
              desc="A multi-master CRDT state mesh with gossip and Merkle / rateless anti-entropy, so servers always converge and a partition never means lost history. It is also the transport for native voice and video — no STUN, no TURN, no relay."
              detail="CRDT mesh · native media"
            />
            <TechCard
              name="TSUMUGI"
              tag="Encryption"
              accentVar="var(--lux)"
              desc="Forward-secret server links and media sessions over an X25519 + ML-KEM-768 post-quantum hybrid handshake and ratchet. No plaintext crosses the wire — encryption is part of the protocol, not an optional mode."
              detail="X25519 + ML-KEM-768"
            />
            <TechCard
              name="Ocean"
              tag="Client"
              accentVar="var(--accent)"
              desc="A Next.js static export with Zustand state management and a dark-luxury design system. A full IRCv3 client under the hood, with voice, media, sessions, and moderation surfaced where you reach for them."
              detail="the eshmaki.me web app"
            />
          </div>
        </section>

        {/* Engineering */}
        <section className="about-section">
          <div className="about-section-label">
            <span className="about-section-label-line" />
            <span>How it holds up</span>
          </div>
          <h2 className="about-h2">Designed to survive bad days.</h2>
          <div className="about-eng">
            {([
              {
                k: 'Convergent state',
                v: 'The CRDT mesh means divergent servers reconcile instead of fighting. A network partition is a delay, not data loss — there are no netsplits that throw away your history.',
              },
              {
                k: 'No relays in the path',
                v: 'Voice and video ride the mesh itself. There is no third-party media server to fail, throttle, or eavesdrop on a call between people in the same channel.',
              },
              {
                k: 'Live upgrades',
                v: 'Helix swaps the running server in place and migrates live sessions across the upgrade. Fixes ship without a reconnect storm or a wiped backlog.',
              },
              {
                k: 'Multithreaded core',
                v: 'Connections spread across sharded reactors and a worker pool, so throughput scales with cores on modern 64-bit hardware instead of choking a single event loop.',
              },
            ] as Array<{ k: string; v: string }>).map((row) => (
              <div key={row.k} className="about-eng-row">
                <div className="about-eng-k">{row.k}</div>
                <div className="about-eng-v">{row.v}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Principles */}
        <section className="about-section">
          <div className="about-section-label">
            <span className="about-section-label-line" />
            <span>Principles</span>
          </div>
          <h2 className="about-h2">Why we built this.</h2>
          <div className="about-principles">
            {[
              {
                n: '01',
                title: 'Open protocol',
                body: 'IRC has outlived almost everything for a reason: it is simple, federated, and proven. We extend it with modern capabilities — we do not replace it or lock it shut.',
              },
              {
                n: '02',
                title: 'No third parties',
                body: 'Voice goes through Orochi, not a rented media cloud. Your conversations do not pass through infrastructure you cannot inspect, audit, or own.',
              },
              {
                n: '03',
                title: 'Secure by default',
                body: 'SCRAM keeps passwords off the wire, session tokens replace stored secrets, and TSUMUGI encrypts links and media with post-quantum keys. There is no insecure mode to fall back into. No analytics, no tracking.',
              },
              {
                n: '04',
                title: 'Actually good software',
                body: 'Not "good for IRC" — just good. Native voice and video, live reactions, threads, collaborative whiteboard, and rich embeds, designed as a coherent whole.',
              },
            ].map((p) => (
              <div key={p.n} className="about-principle">
                <div className="about-principle-n">{p.n}</div>
                <div>
                  <div className="about-principle-title">{p.title}</div>
                  <div className="about-principle-body">{p.body}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Connect */}
        <section className="about-section about-connect-section">
          <div className="about-section-label">
            <span className="about-section-label-line" />
            <span>Connect</span>
          </div>
          <h2 className="about-h2">Join the network.</h2>
          <div className="about-connect-grid">
            <Link href="/login" className="about-link-card">
              <div className="about-link-icon">
                <ArrowRight size={18} />
              </div>
              <div className="about-link-text">
                <div className="about-link-title">Launch Ocean</div>
                <div className="about-link-sub">Open the web client in your browser</div>
              </div>
              <span className="about-link-arrow">↗</span>
            </Link>
            <div className="about-link-card">
              <div className="about-link-icon about-link-icon-irc">
                <IrcConnectIcon />
              </div>
              <div className="about-link-text">
                <div className="about-link-title">IRC direct</div>
                <div className="about-link-sub">eshmaki.me · port 6697 (TLS + SASL)</div>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="about-cta-box">
            <div className="about-cta-box-bg" aria-hidden />
            <div className="about-cta-inner">
              <h3 className="about-cta-h3">Ready to dive in?</h3>
              <p className="about-cta-p">Launch Ocean and join us in <code className="about-cta-code">#root</code> — the main channel on eshmaki.me.</p>
              <div className="about-cta-actions">
                <Link href="/login" className="about-btn-primary">
                  Launch Ocean
                  <ArrowRight size={14} />
                </Link>
                <Link href="/" className="about-btn-ghost">Back to home</Link>
              </div>
            </div>
          </div>
        </section>

      </div>

      {/* Footer */}
      <footer className="about-footer">
        <div className="about-footer-logo">
          <OceanLogo size={20} />
          <span>Ocean</span>
        </div>
        <nav className="about-footer-links" aria-label="Footer">
          <Link href="/" className="about-footer-link">Home</Link>
          <Link href="/login" className="about-footer-link">Sign in</Link>
        </nav>
        <p className="about-footer-copy">© 2026 eshmaki.me</p>
      </footer>

      <style>{ABOUT_CSS}</style>
    </main>
  );
}

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

function IrcConnectIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent-subtle)" />
      <path d="M8 11h16M8 16h12M8 21h8" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="24" cy="21" r="4" fill="var(--accent-subtle)" stroke="var(--accent)" strokeWidth="1.2" />
      <path d="M22.5 21l1 1 2-2" stroke="var(--accent)" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface TechCardProps {
  name: string;
  tag: string;
  accentVar: string;
  desc: string;
  href?: string;
  detail?: string;
}

function TechCard({ name, tag, accentVar, desc, href, detail }: TechCardProps) {
  const card: ReactNode = (
    <div className="tech-card" style={{ '--card-accent': accentVar } as CSSProperties}>
      <div className="tech-card-header">
        <span className="tech-tag">{tag}</span>
        {detail && <span className="tech-detail">{detail}</span>}
      </div>
      <div className="tech-name">{name}</div>
      <div className="tech-desc">{desc}</div>
      {href && <span className="tech-link-hint">View source ↗</span>}
    </div>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'block' }}>
        {card}
      </a>
    );
  }
  return card;
}

// ── Styles ─────────────────────────────────────────────────────────────────
const ABOUT_CSS = `
  /* ════════════════════════════════════════════════════════════
     OCEAN ABOUT — DARK LACQUER / EDITORIAL
     ════════════════════════════════════════════════════════════ */

  html, body { overflow: auto; overflow-x: hidden; }

  .about-skip-link {
    position: absolute; top: -48px; left: 0;
    background: var(--lux); color: var(--bg-void);
    padding: 8px 16px; text-decoration: none; z-index: 9999;
    border-radius: 0 0 8px 0; transition: top 150ms var(--ease-out);
    font-size: 14px; font-weight: 700;
  }
  .about-skip-link:focus { top: 0; }

  .about-root {
    background: var(--bg-void); color: var(--text-primary);
    min-height: 100dvh; overflow-x: clip; font-family: var(--font-ui);
  }

  /* Atmosphere */
  .about-atmos { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
  .about-atmos-halo {
    position: absolute; top: -24vh; right: -10vw; width: 60vw; height: 60vh; border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--lux) 8%, transparent) 0%, transparent 62%);
  }
  .about-atmos-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(var(--border-subtle) 1px, transparent 1px),
      linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
    background-size: 64px 64px;
    -webkit-mask-image: radial-gradient(ellipse 70% 50% at 70% 0%, black, transparent 72%);
    mask-image: radial-gradient(ellipse 70% 50% at 70% 0%, black, transparent 72%);
    opacity: 0.4;
  }
  @media (prefers-reduced-motion: reduce) {
    .about-badge-dot, .about-cta-box-bg { animation: none !important; }
    *, *::before, *::after { transition-duration: 0.001ms !important; animation-duration: 0.001ms !important; }
  }

  /* Nav */
  .about-nav {
    position: fixed; top: 0; left: 0; right: 0; z-index: 200;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 clamp(20px, 5vw, 80px); height: 62px;
    background: color-mix(in srgb, var(--bg-void) 74%, transparent);
    backdrop-filter: blur(24px) saturate(1.4); border-bottom: 1px solid var(--border-subtle);
  }
  .about-nav-logo { display: flex; align-items: center; gap: 9px; text-decoration: none; }
  .about-nav-wordmark { font-family: var(--font-display); font-size: 18px; font-weight: 600; letter-spacing: -0.01em; color: var(--text-primary); }
  .about-nav-sep { color: var(--border-normal); font-weight: 300; }
  .about-nav-engine { font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--lux); }
  .about-nav-links { display: flex; align-items: center; gap: 22px; }
  .about-nav-link { font-size: 13.5px; font-weight: 500; color: var(--text-secondary); text-decoration: none; transition: color 0.2s; }
  .about-nav-link:hover { color: var(--text-primary); text-decoration: none; }
  .about-nav-cta {
    display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700;
    color: var(--bg-void); background: var(--lux); text-decoration: none;
    padding: 8px 16px; border-radius: var(--r-full);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--lux) 40%, transparent), 0 8px 22px rgba(0,0,0,0.4);
    transition: transform 0.18s var(--ease-out), filter 0.2s var(--ease-out);
  }
  .about-nav-cta:hover { transform: translateY(-1px); filter: brightness(1.06); text-decoration: none; color: var(--bg-void); }

  /* Hero */
  .about-hero { position: relative; z-index: 1; padding-top: 62px; overflow: hidden; border-bottom: 1px solid var(--border-subtle); }

  .about-container { position: relative; z-index: 1; max-width: 920px; margin: 0 auto; padding: clamp(48px, 6vw, 88px) clamp(20px, 5vw, 64px); }

  .about-badge {
    display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-mono);
    font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-secondary);
    padding: 6px 13px; border-radius: var(--r-full);
    background: color-mix(in srgb, var(--bg-elevated) 70%, transparent); border: 1px solid var(--border-normal);
    margin-bottom: 26px; width: fit-content;
  }
  .about-badge-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--lux); flex-shrink: 0; box-shadow: 0 0 8px var(--lux); animation: about-dot 2.4s ease-in-out infinite; }
  @keyframes about-dot { 0%, 100% { box-shadow: 0 0 4px color-mix(in srgb, var(--lux) 60%, transparent); } 50% { box-shadow: 0 0 12px var(--lux); } }

  .about-h1 {
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 1.5rem + 3.4vw, 4.2rem); font-weight: 600;
    letter-spacing: -0.025em; line-height: 1.05; margin: 0 0 22px; color: var(--text-primary); text-wrap: balance;
  }
  .about-h1-em { color: var(--lux); font-style: italic; font-weight: 500; }
  .about-lead { font-size: clamp(1rem, 0.9rem + 0.5vw, 1.2rem); line-height: 1.74; color: var(--text-secondary); max-width: 60ch; margin: 0 0 38px; }
  .about-lead strong { color: var(--text-primary); font-weight: 600; }

  .about-hero-meta {
    display: flex; align-items: center; gap: 24px; flex-wrap: wrap; padding: 20px 24px;
    background: color-mix(in srgb, var(--bg-elevated) 56%, transparent);
    border: 1px solid var(--border-subtle); border-radius: var(--r-lg); width: fit-content; backdrop-filter: blur(8px);
  }
  .about-stat { display: flex; flex-direction: column; gap: 3px; }
  .about-stat-val { font-family: var(--font-mono); font-size: 14px; font-weight: 700; color: var(--lux); letter-spacing: 0.02em; }
  .about-stat-label { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
  .about-stat-divider { width: 1px; height: 32px; background: var(--border-normal); flex-shrink: 0; }

  /* Body */
  .about-body { padding-top: 8px; }
  .about-section { margin-bottom: 84px; }

  .about-section-label { display: flex; align-items: center; gap: 12px; font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 16px; }
  .about-section-label-line { display: block; width: 26px; height: 1px; background: var(--lux); flex-shrink: 0; }

  .about-h2 { font-family: var(--font-display); font-size: clamp(1.6rem, 1.2rem + 1.8vw, 2.4rem); font-weight: 600; letter-spacing: -0.02em; color: var(--text-primary); margin: 0 0 32px; line-height: 1.12; text-wrap: balance; }

  .about-prose { display: flex; flex-direction: column; gap: 18px; }
  .about-prose p { font-size: clamp(0.96rem, 0.92rem + 0.3vw, 1.08rem); line-height: 1.8; color: var(--text-secondary); margin: 0; }
  .about-prose strong { color: var(--text-primary); font-weight: 600; }

  /* Tech grid */
  .about-tech-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
  @media (max-width: 600px) { .about-tech-grid { grid-template-columns: 1fr; } }

  /* Engineering rows */
  .about-eng { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
  @media (max-width: 600px) { .about-eng { grid-template-columns: 1fr; } }
  .about-eng-row {
    padding: 22px 24px; border: 1px solid var(--border-subtle); border-radius: var(--r-lg);
    background: color-mix(in srgb, var(--bg-base) 80%, transparent);
    transition: border-color 0.25s var(--ease-out), transform 0.2s var(--ease-out);
  }
  .about-eng-row:hover { border-color: var(--border-normal); transform: translateY(-2px); }
  .about-eng-k { font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--lux); margin-bottom: 10px; }
  .about-eng-v { font-size: 14px; line-height: 1.66; color: var(--text-secondary); }

  /* Principles */
  .about-principles { display: flex; flex-direction: column; gap: 12px; }
  .about-principle {
    display: flex; align-items: flex-start; gap: 24px; padding: 24px;
    background: color-mix(in srgb, var(--bg-base) 80%, transparent);
    border: 1px solid var(--border-subtle); border-radius: var(--r-lg);
    transition: border-color 0.25s var(--ease-out), transform 0.2s var(--ease-out), box-shadow 0.25s var(--ease-out);
  }
  .about-principle:hover { border-color: var(--border-normal); transform: translateX(4px); box-shadow: var(--elev-shadow-1); }
  .about-principle-n { font-family: var(--font-display); font-size: 1.4rem; font-weight: 500; color: var(--lux); flex-shrink: 0; line-height: 1; margin-top: 2px; }
  .about-principle-title { font-family: var(--font-display); font-size: 1.08rem; font-weight: 600; color: var(--text-primary); margin-bottom: 8px; letter-spacing: -0.01em; }
  .about-principle-body { font-size: 14px; line-height: 1.66; color: var(--text-secondary); }

  /* Connect */
  .about-connect-grid { display: flex; flex-direction: column; gap: 12px; margin-bottom: 32px; }
  .about-link-card {
    display: flex; align-items: center; gap: 16px; padding: 18px 24px;
    background: color-mix(in srgb, var(--bg-base) 80%, transparent);
    border: 1px solid var(--border-normal); border-radius: var(--r-lg); text-decoration: none;
    transition: border-color 0.25s var(--ease-out), transform 0.2s var(--ease-out), box-shadow 0.25s var(--ease-out);
  }
  .about-link-card:hover { border-color: color-mix(in srgb, var(--lux) 30%, transparent); transform: translateX(4px); box-shadow: var(--elev-shadow-1); text-decoration: none; }
  .about-link-icon { flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .about-link-icon-irc { opacity: 0.9; }
  .about-link-text { flex: 1; }
  .about-link-title { font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; }
  .about-link-sub { font-size: 12px; color: var(--text-muted); font-family: var(--font-mono); }
  .about-link-arrow { font-size: 18px; color: var(--text-muted); flex-shrink: 0; transition: color 0.2s, transform 0.2s; }
  .about-link-card:hover .about-link-arrow { color: var(--lux); transform: translate(2px, -2px); }

  /* CTA box */
  .about-cta-box {
    position: relative; overflow: hidden; border-radius: var(--r-2xl);
    border: 1px solid var(--border-normal);
    background: linear-gradient(150deg, color-mix(in srgb, var(--bg-elevated) 90%, transparent) 0%, color-mix(in srgb, var(--bg-deep) 94%, transparent) 100%);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--lux) 16%, transparent), var(--elev-shadow-2);
  }
  .about-cta-box-bg { position: absolute; inset: 0; background: radial-gradient(ellipse at 75% 40%, var(--lux-subtle) 0%, transparent 62%); animation: about-shimmer 7s ease-in-out infinite; }
  @keyframes about-shimmer { 0%, 100% { opacity: 0.65; transform: scale(1); } 50% { opacity: 1; transform: scale(1.05); } }
  .about-cta-inner { position: relative; z-index: 1; padding: clamp(32px, 5vw, 56px) clamp(24px, 4vw, 48px); display: flex; flex-direction: column; gap: 16px; }
  .about-cta-h3 { font-family: var(--font-display); font-size: clamp(1.4rem, 1.1rem + 1.4vw, 2rem); font-weight: 600; letter-spacing: -0.02em; color: var(--text-primary); margin: 0; }
  .about-cta-p { font-size: clamp(0.95rem, 0.9rem + 0.3vw, 1.05rem); color: var(--text-secondary); line-height: 1.65; margin: 0; }
  .about-cta-code { font-family: var(--font-mono); font-size: 0.9em; color: var(--lux); background: var(--lux-subtle); padding: 1px 7px; border-radius: var(--r-xs); border: 1px solid color-mix(in srgb, var(--lux) 26%, transparent); }
  .about-cta-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 8px; }

  .about-btn-primary {
    display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; border-radius: var(--r-md);
    font-size: 14px; font-weight: 700; color: var(--bg-void); background: var(--lux); text-decoration: none;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.2), 0 12px 28px rgba(0,0,0,0.4);
    transition: transform 0.2s var(--ease-out), filter 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out);
  }
  .about-btn-primary:hover { transform: translateY(-2px); filter: brightness(1.07); text-decoration: none; color: var(--bg-void); box-shadow: inset 0 1px 0 rgba(255,255,255,.2), var(--glow), 0 16px 34px rgba(0,0,0,0.5); }
  .about-btn-primary:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 3px; }
  .about-btn-ghost {
    display: inline-flex; align-items: center; gap: 6px; padding: 14px 24px; border-radius: var(--r-md);
    font-size: 14px; font-weight: 600; color: var(--text-secondary); text-decoration: none;
    border: 1px solid var(--border-normal); background: color-mix(in srgb, var(--bg-elevated) 50%, transparent);
    transition: color 0.2s, border-color 0.2s, transform 0.2s var(--ease-out);
  }
  .about-btn-ghost:hover { color: var(--text-primary); border-color: var(--lux); transform: translateY(-1px); text-decoration: none; }
  .about-btn-ghost:focus-visible { outline: 2px solid var(--lux); outline-offset: 3px; }

  /* Footer */
  .about-footer {
    position: relative; z-index: 1; display: grid; grid-template-columns: 1fr auto auto;
    align-items: center; gap: 24px 40px; padding: 44px clamp(20px, 5vw, 80px);
    border-top: 1px solid var(--border-subtle); margin-top: 20px;
  }
  .about-footer-logo { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--text-primary); }
  .about-footer-links { display: flex; align-items: center; gap: 22px; }
  .about-footer-link { font-size: 13px; color: var(--text-muted); text-decoration: none; transition: color 0.2s; }
  .about-footer-link:hover { color: var(--text-primary); text-decoration: none; }
  .about-footer-copy { font-size: 12px; color: var(--text-muted); margin: 0; white-space: nowrap; }

  /* Tech cards */
  .tech-card {
    padding: 26px; background: color-mix(in srgb, var(--bg-base) 80%, transparent);
    border: 1px solid var(--border-normal); border-radius: var(--r-xl);
    display: flex; flex-direction: column; gap: 14px; position: relative; overflow: hidden; height: 100%;
    transition: border-color 0.25s var(--ease-out), transform 0.2s var(--ease-out), box-shadow 0.25s var(--ease-out);
  }
  .tech-card::before {
    content: ''; position: absolute; top: 0; left: 22px; right: 22px; height: 1px;
    background: linear-gradient(90deg, transparent, var(--card-accent, var(--lux)), transparent);
    opacity: 0.3; transition: opacity 0.25s;
  }
  a:hover .tech-card { border-color: color-mix(in srgb, var(--card-accent, var(--lux)) 42%, transparent); transform: translateY(-3px); box-shadow: var(--elev-shadow-2); }
  a:hover .tech-card::before { opacity: 0.8; }
  .tech-card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .tech-tag {
    font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
    padding: 4px 10px; border-radius: var(--r-full); color: var(--card-accent, var(--lux));
    background: color-mix(in srgb, var(--card-accent, var(--lux)) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--card-accent, var(--lux)) 28%, transparent);
  }
  .tech-detail { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; color: var(--text-muted); }
  .tech-name { font-family: var(--font-display); font-size: clamp(1.6rem, 1rem + 1.6vw, 2rem); font-weight: 600; letter-spacing: -0.02em; color: var(--card-accent, var(--lux)); line-height: 1; }
  .tech-desc { font-size: 13.5px; line-height: 1.7; color: var(--text-secondary); flex: 1; }
  .tech-link-hint { font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: var(--card-accent, var(--lux)); opacity: 0.75; margin-top: 4px; display: block; }

  /* Mobile */
  @media (max-width: 640px) {
    .about-nav { height: 54px; padding: 0 16px; }
    .about-nav-link, .about-nav-sep, .about-nav-engine { display: none; }
    .about-nav-cta { font-size: 12px; padding: 7px 14px; }
    .about-container { padding: 40px 16px; }
    .about-hero-meta { gap: 16px; padding: 16px 18px; }
    .about-stat-val { font-size: 13px; }
    .about-section { margin-bottom: 60px; }
    .about-principle { flex-direction: column; gap: 12px; padding: 20px; }
    .about-principle:hover { transform: translateY(-2px); }
    .about-link-card { padding: 14px 16px; }
    .about-cta-inner { padding: 28px 20px; }
    .about-cta-actions { flex-direction: column; align-items: stretch; }
    .about-btn-primary, .about-btn-ghost { justify-content: center; text-align: center; }
    .about-footer { grid-template-columns: 1fr; text-align: center; padding: 30px 16px; gap: 16px; }
    .about-footer-links { justify-content: center; flex-wrap: wrap; }
  }
`;
