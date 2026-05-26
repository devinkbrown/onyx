import Link from 'next/link';
import type { CSSProperties } from 'react';

export default function AboutPage() {
  return (
    <main className="about-root">
      {/* Atmospheric depth background */}
      <div className="about-depth" aria-hidden>
        <div className="about-depth-ray about-depth-ray-1" />
        <div className="about-depth-ray about-depth-ray-2" />
      </div>

      {/* Nav */}
      <nav className="about-nav">
        <Link href="/" className="about-nav-logo">
          <OceanLogo />
          <span className="about-nav-wordmark">Ocean</span>
        </Link>
        <div className="about-nav-links">
          <Link href="/" className="about-nav-link">Home</Link>
          <Link href="/login" className="about-nav-cta">
            Open Ocean
            <ArrowRight size={13} />
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="about-hero">
        <div className="about-hero-orb" aria-hidden />
        <div className="about-container">
          <div className="about-badge">
            <span className="about-badge-dot" />
            About
          </div>
          <h1 className="about-h1">The eshmaki.me<br />community</h1>
          <p className="about-lead">
            An independent network for people who care about open protocols,
            real conversations, and building things together.
          </p>
          <div className="about-hero-meta" aria-hidden>
            <div className="about-stat">
              <span className="about-stat-val">#root</span>
              <span className="about-stat-label">main channel</span>
            </div>
            <div className="about-stat-divider" />
            <div className="about-stat">
              <span className="about-stat-val">6697</span>
              <span className="about-stat-label">TLS port</span>
            </div>
            <div className="about-stat-divider" />
            <div className="about-stat">
              <span className="about-stat-val">P-256</span>
              <span className="about-stat-label">VEIL encryption</span>
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
            <span>What is Ocean?</span>
          </div>
          <h2 className="about-h2">Built on IRC. Beyond IRC.</h2>
          <div className="about-prose">
            <p>
              Ocean is the modern web client for the eshmaki.me IRC network. It
              brings the communication features you expect from modern platforms —
              voice, reactions, rich media, threads — while staying faithful to the
              open IRC protocol underneath.
            </p>
            <p>
              Everything runs on <strong>Ophion</strong>, a custom IRC server built
              from the ground up to support modern clients without abandoning IRC
              compatibility. Any standard IRC client can still connect. Ocean is
              just the best way to experience the network.
            </p>
          </div>
        </section>

        {/* Tech cards */}
        <section className="about-section">
          <div className="about-section-label">
            <span className="about-section-label-line" />
            <span>The Technology</span>
          </div>
          <h2 className="about-h2">Four layers, one network.</h2>
          <div className="about-tech-grid">
            <TechCard
              name="Ophion"
              tag="IRC Server"
              accentColor="#0ea5e9"
              desc="A custom IRC server built for performance and modern protocol extensions. Supports IRCv3, IRCX, CHATHISTORY, and full SASL auth including session tokens."
              href="https://github.com/devinkbrown/ophion"
              detail="irc.eshmaki.me:6697"
            />
            <TechCard
              name="LADON"
              tag="Media Protocol"
              accentColor="#67e8f9"
              desc="Proprietary voice and video protocol built over IRC messaging. No WebRTC, no STUN/TURN servers — spatial audio and video delivered through the Ophion network."
              detail="No WebRTC · No relay"
            />
            <TechCard
              name="VEIL"
              tag="Encryption"
              accentColor="#a78bfa"
              desc="P-256 ECDH key exchange with AES-256-GCM encryption for every LADON session. Group session keys derived with forward secrecy — no plaintext voice leaves your device."
              detail="P-256 ECDH · AES-256-GCM"
            />
            <TechCard
              name="Ocean"
              tag="Web Client"
              accentColor="#38bdf8"
              desc="Next.js static export with Zustand state management. Dark luxury design system, bento layouts, and a full-featured IRC client under the hood."
              detail="open source"
            />
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
                body: 'IRC is 35+ years old for good reason. Federated, simple, and proven. We extend it — we don\'t replace it.',
              },
              {
                n: '02',
                title: 'No third parties',
                body: 'Voice goes through Ophion, not Google, not Amazon. Your conversations don\'t pass through infrastructure you don\'t control.',
              },
              {
                n: '03',
                title: 'Privacy by design',
                body: 'Session tokens replace stored passwords. VEIL encrypts voice before it leaves your device. No analytics, no tracking.',
              },
              {
                n: '04',
                title: 'Actually good software',
                body: 'Not "good for IRC". Just good. Spatial audio, live reactions, collaborative whiteboard, rich embeds — done right.',
              },
            ].map(p => (
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
            <a href="https://github.com/devinkbrown/ophion" target="_blank" rel="noopener noreferrer" className="about-link-card">
              <div className="about-link-icon">
                <GithubIcon />
              </div>
              <div className="about-link-text">
                <div className="about-link-title">Ophion on GitHub</div>
                <div className="about-link-sub">github.com/devinkbrown/ophion</div>
              </div>
              <span className="about-link-arrow">↗</span>
            </a>
            <div className="about-link-card">
              <div className="about-link-icon about-link-icon-irc">
                <IrcConnectIcon />
              </div>
              <div className="about-link-text">
                <div className="about-link-title">IRC Direct</div>
                <div className="about-link-sub">irc.eshmaki.me · port 6697 (TLS)</div>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="about-cta-box">
            <div className="about-cta-box-bg" aria-hidden />
            <div className="about-cta-inner">
              <h3 className="about-cta-h3">Ready to dive in?</h3>
              <p className="about-cta-p">Join us in <code className="about-cta-code">#root</code> — the main channel on eshmaki.me.</p>
              <div className="about-cta-actions">
                <Link href="/login" className="about-btn-primary">
                  Open Ocean
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
          <Link href="/login" className="about-footer-link">Sign In</Link>
          <a href="https://github.com/devinkbrown/ophion" target="_blank" rel="noopener noreferrer" className="about-footer-link">Ophion ↗</a>
        </nav>
        <p className="about-footer-copy">© {new Date().getFullYear()} eshmaki.me</p>
      </footer>

      <style>{`
        /* ════════════════════════════════════════════════════════════
           OCEAN ABOUT PAGE
           ════════════════════════════════════════════════════════════ */

        .about-root {
          background: var(--bg-void);
          color: var(--text-primary);
          min-height: 100dvh;
          overflow-x: hidden;
          font-family: 'Inter', system-ui, sans-serif;
        }

        /* ── Atmospheric depth rays ── */
        .about-depth {
          position: fixed; inset: 0; pointer-events: none; z-index: 0;
          overflow: hidden;
        }
        .about-depth-ray {
          position: absolute; width: 1px; top: 0; bottom: 0;
          background: linear-gradient(to bottom,
            transparent 0%,
            color-mix(in srgb, var(--accent) 70%, transparent) 20%,
            color-mix(in srgb, var(--accent) 20%, transparent) 60%,
            transparent 100%
          );
          transform-origin: top center;
        }
        .about-depth-ray-1 { left: 20%; opacity: 0.05; transform: rotate(-3deg) scaleX(70); animation: ray-drift 14s ease-in-out infinite; }
        .about-depth-ray-2 { left: 80%; opacity: 0.04; transform: rotate(3deg)  scaleX(90); animation: ray-drift 18s ease-in-out infinite reverse; }
        @keyframes ray-drift {
          0%, 100% { opacity: 0.04; }
          50%       { opacity: 0.08; }
        }
        @media (prefers-reduced-motion: reduce) {
          .about-depth-ray, .about-badge-dot, .about-cta-box-bg { animation: none !important; }
        }

        /* ── Nav ── */
        .about-nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 200;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 clamp(20px, 5vw, 80px); height: 60px;
          background: color-mix(in srgb, var(--bg-void) 72%, transparent);
          backdrop-filter: blur(24px) saturate(1.5);
          border-bottom: 1px solid var(--border-subtle);
        }
        .about-nav-logo {
          display: flex; align-items: center; gap: 9px; text-decoration: none;
        }
        .about-nav-wordmark {
          font-size: 16px; font-weight: 700; letter-spacing: -0.3px; color: var(--text-primary);
        }
        .about-nav-links { display: flex; align-items: center; gap: 20px; }
        .about-nav-link {
          font-size: 14px; font-weight: 500; color: var(--text-secondary);
          text-decoration: none; transition: color 0.2s;
        }
        .about-nav-link:hover { color: var(--text-primary); }
        .about-nav-cta {
          display: flex; align-items: center; gap: 6px;
          font-size: 13px; font-weight: 600; color: var(--bg-void);
          background: linear-gradient(135deg, var(--accent), var(--accent-hover));
          text-decoration: none; padding: 7px 16px; border-radius: 20px;
          transition: opacity 0.2s, transform 0.15s;
          box-shadow: 0 0 16px var(--accent-glow);
        }
        .about-nav-cta:hover { opacity: 0.9; transform: translateY(-1px); text-decoration: none; }

        /* ── Hero ── */
        .about-hero {
          position: relative; z-index: 1;
          padding-top: 60px;
          overflow: hidden;
          border-bottom: 1px solid var(--border-subtle);
        }
        .about-hero-orb {
          position: absolute; width: 700px; height: 700px;
          border-radius: 50%; filter: blur(120px);
          background: radial-gradient(circle, var(--accent) 0%, transparent 65%);
          top: -280px; right: -120px; opacity: 0.08; pointer-events: none;
        }

        /* ── Container ── */
        .about-container {
          position: relative; z-index: 1;
          max-width: 880px; margin: 0 auto;
          padding: clamp(48px, 6vw, 80px) clamp(20px, 5vw, 64px);
        }

        /* ── Badge ── */
        .about-badge {
          display: inline-flex; align-items: center; gap: 8px;
          font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--accent);
          padding: 5px 12px; border-radius: 20px;
          background: var(--accent-subtle); border: 1px solid var(--accent-border);
          margin-bottom: 24px; width: fit-content;
        }
        .about-badge-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--accent); flex-shrink: 0;
          box-shadow: 0 0 6px var(--accent-glow);
          animation: dot-pulse 2s ease-in-out infinite;
        }
        @keyframes dot-pulse {
          0%, 100% { box-shadow: 0 0 4px var(--accent-glow); }
          50%       { box-shadow: 0 0 10px var(--accent); }
        }

        .about-h1 {
          font-size: clamp(2.4rem, 5.5vw, 4.2rem); font-weight: 900;
          letter-spacing: -0.04em; line-height: 1.05; margin: 0 0 20px;
          color: var(--text-primary);
        }
        .about-lead {
          font-size: clamp(1rem, 1.6vw, 1.2rem); line-height: 1.72;
          color: var(--text-secondary); max-width: 560px; margin: 0 0 36px;
        }

        /* Hero meta stats */
        .about-hero-meta {
          display: flex; align-items: center; gap: 24px; flex-wrap: wrap;
          padding: 20px 24px;
          background: color-mix(in srgb, var(--bg-elevated) 60%, transparent);
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          width: fit-content;
          backdrop-filter: blur(8px);
        }
        .about-stat { display: flex; flex-direction: column; gap: 3px; }
        .about-stat-val {
          font-family: var(--font-mono); font-size: 14px; font-weight: 700;
          color: var(--accent); letter-spacing: 0.02em;
        }
        .about-stat-label {
          font-size: 10px; font-weight: 600; letter-spacing: 0.07em;
          text-transform: uppercase; color: var(--text-muted);
        }
        .about-stat-divider {
          width: 1px; height: 32px; background: var(--border-subtle); flex-shrink: 0;
        }

        /* ── Body ── */
        .about-body { padding-top: 0; }
        .about-section { margin-bottom: 80px; }

        /* Section label */
        .about-section-label {
          display: flex; align-items: center; gap: 12px;
          font-size: 10px; font-weight: 800; letter-spacing: 0.12em;
          text-transform: uppercase; color: var(--text-muted);
          margin-bottom: 14px;
        }
        .about-section-label-line {
          display: block; width: 24px; height: 1px; background: var(--accent-border); flex-shrink: 0;
        }

        .about-h2 {
          font-size: clamp(1.5rem, 2.8vw, 2.2rem); font-weight: 800;
          letter-spacing: -0.03em; color: var(--text-primary); margin: 0 0 32px;
          line-height: 1.15;
        }

        /* Prose */
        .about-prose { display: flex; flex-direction: column; gap: 16px; }
        .about-prose p {
          font-size: clamp(0.95rem, 1.3vw, 1.05rem); line-height: 1.78;
          color: var(--text-secondary); margin: 0;
        }
        .about-prose strong { color: var(--text-primary); font-weight: 600; }

        /* Tech grid */
        .about-tech-grid {
          display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px;
        }
        @media (max-width: 600px) { .about-tech-grid { grid-template-columns: 1fr; } }

        /* Principles */
        .about-principles { display: flex; flex-direction: column; gap: 12px; }
        .about-principle {
          display: flex; align-items: flex-start; gap: 24px;
          padding: 22px 24px;
          background: color-mix(in srgb, var(--bg-deep) 90%, transparent);
          border: 1px solid var(--border-subtle); border-radius: 14px;
          transition: border-color 0.25s var(--ease-out), transform 0.2s var(--ease-out), box-shadow 0.25s var(--ease-out);
        }
        .about-principle:hover {
          border-color: var(--accent-border);
          transform: translateX(4px);
          box-shadow: 0 0 24px var(--accent-glow);
        }
        .about-principle-n {
          font-size: 11px; font-weight: 800; font-family: var(--font-mono);
          color: var(--accent); opacity: 0.65; flex-shrink: 0; margin-top: 3px;
          letter-spacing: 0.05em;
        }
        .about-principle-title { font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px; }
        .about-principle-body { font-size: 14px; line-height: 1.65; color: var(--text-secondary); }

        /* Connect */
        .about-connect-grid { display: flex; flex-direction: column; gap: 12px; margin-bottom: 32px; }
        .about-link-card {
          display: flex; align-items: center; gap: 16px;
          padding: 18px 24px;
          background: color-mix(in srgb, var(--bg-deep) 90%, transparent);
          border: 1px solid var(--border-normal); border-radius: 14px;
          text-decoration: none;
          transition: border-color 0.25s var(--ease-out), transform 0.2s var(--ease-out), box-shadow 0.25s var(--ease-out);
        }
        .about-link-card:hover {
          border-color: var(--accent-border); transform: translateX(4px);
          box-shadow: 0 0 20px var(--accent-glow);
          text-decoration: none;
        }
        .about-link-icon { flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
        .about-link-icon-irc { opacity: 0.85; }
        .about-link-text { flex: 1; }
        .about-link-title { font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; }
        .about-link-sub { font-size: 12px; color: var(--text-muted); font-family: var(--font-mono); }
        .about-link-arrow { font-size: 18px; color: var(--text-muted); flex-shrink: 0; transition: color 0.2s, transform 0.2s; }
        .about-link-card:hover .about-link-arrow { color: var(--accent); transform: translate(2px, -2px); }

        /* CTA box */
        .about-cta-box {
          position: relative; overflow: hidden;
          border-radius: 20px;
          border: 1px solid var(--border-normal);
          background: linear-gradient(145deg, var(--bg-elevated) 0%, var(--bg-deep) 100%);
          box-shadow: inset 0 1px 0 var(--accent-border), 0 16px 48px rgba(0,0,0,0.4);
        }
        .about-cta-box-bg {
          position: absolute; inset: 0;
          background: radial-gradient(ellipse at 70% 50%, var(--accent-subtle) 0%, transparent 65%);
          animation: cta-shimmer 6s ease-in-out infinite;
        }
        @keyframes cta-shimmer {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50%       { opacity: 1; transform: scale(1.05); }
        }
        .about-cta-inner {
          position: relative; z-index: 1;
          padding: clamp(32px, 5vw, 56px) clamp(24px, 4vw, 48px);
          display: flex; flex-direction: column; gap: 16px;
        }
        .about-cta-h3 {
          font-size: clamp(1.4rem, 2.5vw, 1.9rem); font-weight: 800;
          letter-spacing: -0.03em; color: var(--text-primary); margin: 0;
        }
        .about-cta-p {
          font-size: clamp(0.95rem, 1.3vw, 1.05rem); color: var(--text-secondary);
          line-height: 1.65; margin: 0;
        }
        .about-cta-code {
          font-family: var(--font-mono); font-size: 0.9em;
          color: var(--accent); background: var(--accent-subtle);
          padding: 1px 6px; border-radius: 4px;
          border: 1px solid var(--accent-border);
        }
        .about-cta-actions {
          display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
          margin-top: 8px;
        }
        .about-btn-primary {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 13px 26px; border-radius: var(--r-md);
          font-size: 14px; font-weight: 700; color: var(--bg-void);
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%);
          text-decoration: none;
          box-shadow: 0 4px 20px var(--accent-glow), 0 0 0 1px var(--accent-border);
          transition: transform 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out);
        }
        .about-btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 32px var(--accent-glow), 0 0 0 1px var(--accent);
          text-decoration: none; color: var(--bg-void);
        }
        .about-btn-ghost {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 13px 22px; border-radius: var(--r-md);
          font-size: 14px; font-weight: 500;
          color: var(--text-secondary); text-decoration: none;
          border: 1px solid var(--border-normal); background: var(--accent-subtle);
          transition: color 0.2s, border-color 0.2s, transform 0.2s var(--ease-out);
        }
        .about-btn-ghost:hover {
          color: var(--text-primary); border-color: var(--accent-border);
          transform: translateY(-1px); text-decoration: none;
        }

        /* ── Footer ── */
        .about-footer {
          position: relative; z-index: 1;
          display: grid; grid-template-columns: 1fr auto auto;
          align-items: center; gap: 24px 40px;
          padding: 40px clamp(20px, 5vw, 80px);
          border-top: 1px solid var(--border-subtle);
          margin-top: 20px;
        }
        .about-footer-logo { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: var(--text-primary); }
        .about-footer-links { display: flex; align-items: center; gap: 20px; }
        .about-footer-link { font-size: 13px; color: var(--text-muted); text-decoration: none; transition: color 0.2s; }
        .about-footer-link:hover { color: var(--text-secondary); text-decoration: none; }
        .about-footer-copy { font-size: 12px; color: var(--text-muted); margin: 0; white-space: nowrap; }

        /* ── Mobile ── */
        @media (max-width: 640px) {
          .about-nav { height: 52px; padding: 0 16px; }
          .about-nav-link { display: none; }
          .about-nav-wordmark { font-size: 15px; }
          .about-nav-cta { font-size: 12px; padding: 6px 14px; }

          .about-container { padding: 36px 16px; }
          .about-h1 { font-size: clamp(2.1rem, 8vw, 2.8rem); }
          .about-hero-meta { gap: 16px; padding: 16px 18px; }
          .about-stat-val { font-size: 13px; }

          .about-section { margin-bottom: 56px; }
          .about-h2 { font-size: 1.4rem; }
          .about-principle { flex-direction: column; gap: 10px; padding: 18px; }
          .about-principle:hover { transform: translateX(0) translateY(-2px); }

          .about-link-card { padding: 14px 16px; }
          .about-cta-inner { padding: 28px 20px; }
          .about-cta-actions { flex-direction: column; align-items: stretch; }
          .about-btn-primary, .about-btn-ghost { justify-content: center; text-align: center; }

          .about-footer { grid-template-columns: 1fr; text-align: center; padding: 28px 16px; gap: 16px; }
          .about-footer-links { justify-content: center; flex-wrap: wrap; }
        }

        /* ── Tech cards ── */
        .tech-card {
          padding: 24px; background: color-mix(in srgb, var(--bg-deep) 90%, transparent);
          border: 1px solid var(--border-normal); border-radius: 16px;
          display: flex; flex-direction: column; gap: 12px;
          transition: border-color 0.25s var(--ease-out), transform 0.2s var(--ease-out), box-shadow 0.25s var(--ease-out);
          position: relative; overflow: hidden; height: 100%;
        }
        .tech-card::before {
          content: '';
          position: absolute; top: 0; left: 20px; right: 20px; height: 1px;
          background: linear-gradient(90deg, transparent, var(--card-accent, var(--accent)), transparent);
          opacity: 0.3; transition: opacity 0.25s;
        }
        a:hover .tech-card {
          border-color: color-mix(in srgb, var(--card-accent, var(--accent)) 40%, transparent);
          transform: translateY(-3px);
          box-shadow: 0 12px 36px rgba(0,0,0,0.45), 0 0 24px color-mix(in srgb, var(--card-accent, var(--accent)) 15%, transparent);
        }
        a:hover .tech-card::before { opacity: 0.7; }
        .tech-card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .tech-tag {
          font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 3px 10px; border-radius: 100px;
          color: var(--card-accent, var(--accent));
          background: color-mix(in srgb, var(--card-accent, var(--accent)) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--card-accent, var(--accent)) 28%, transparent);
        }
        .tech-detail {
          font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
          color: var(--text-muted); font-family: var(--font-mono);
        }
        .tech-name {
          font-size: clamp(1.6rem, 3vw, 2rem); font-weight: 900; letter-spacing: -0.04em;
          color: var(--card-accent, var(--accent));
          line-height: 1;
        }
        .tech-desc { font-size: 13.5px; line-height: 1.65; color: var(--text-secondary); flex: 1; }
        .tech-link-hint {
          font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
          color: var(--card-accent, var(--accent)); opacity: 0.7;
          margin-top: 4px; display: block;
        }
      `}</style>
    </main>
  );
}

// ── SVG Components ─────────────────────────────────────────────────────────

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

function GithubIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" fill="var(--text-secondary)"/>
    </svg>
  );
}

function IrcConnectIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="var(--accent-subtle)"/>
      <path d="M8 11h16M8 16h12M8 21h8" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="24" cy="21" r="4" fill="var(--accent-subtle)" stroke="var(--accent)" strokeWidth="1.2"/>
      <path d="M22.5 21l1 1 2-2" stroke="var(--accent)" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function TechCard({ name, tag, accentColor, desc, href, detail }: {
  name: string;
  tag: string;
  accentColor: string;
  desc: string;
  href?: string;
  detail?: string;
}) {
  const card = (
    <div className="tech-card" style={{'--card-accent': accentColor} as unknown as CSSProperties}>
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
      <a href={href} target="_blank" rel="noopener noreferrer" style={{textDecoration:'none', display:'block'}}>
        {card}
      </a>
    );
  }
  return card;
}

