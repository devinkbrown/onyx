import Link from 'next/link';

export default function AboutPage() {
  return (
    <main className="about-root">
      {/* Nav */}
      <nav className="land-nav">
        <Link href="/" className="land-nav-logo-link">
          <OceanLogo />
          <span className="land-nav-wordmark">Ocean</span>
        </Link>
        <div className="land-nav-links">
          <Link href="/" className="land-nav-link">Home</Link>
          <Link href="/login" className="land-nav-cta">Open Ocean</Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="about-hero">
        <div className="about-hero-orb" />
        <div className="about-container">
          <div className="about-badge">About</div>
          <h1 className="about-h1">The eshmaki.me community</h1>
          <p className="about-lead">
            An independent network for people who care about open protocols,
            real conversations, and building things together.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="about-container about-body">

        {/* What is Ocean */}
        <section className="about-section">
          <h2 className="about-h2">What is Ocean?</h2>
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
          <h2 className="about-h2">The technology</h2>
          <div className="about-tech-grid">
            <TechCard
              name="Ophion"
              tag="IRC Server"
              color="#0ea5e9"
              desc="A custom IRC server built for performance and modern protocol extensions. Supports IRCv3, IRCX, CHATHISTORY, and full SASL auth including session tokens."
              href="https://github.com/devinkbrown/ophion"
            />
            <TechCard
              name="LADON"
              tag="Media Protocol"
              color="#67e8f9"
              desc="Proprietary voice and video protocol built over IRC messaging. No WebRTC, no STUN/TURN servers — spatial audio and video delivered peer-to-peer through the Ophion network."
            />
            <TechCard
              name="VEIL"
              tag="Encryption Layer"
              color="#a78bfa"
              desc="P-256 ECDH key exchange with AES-256-GCM encryption for every LADON session. Group session keys derived with forward secrecy — no plaintext voice ever leaves your device unencrypted."
            />
            <TechCard
              name="Ocean"
              tag="Web Client"
              color="#38bdf8"
              desc="Next.js static export with Zustand state management. Dark luxury design system, bento layouts, and a full-featured IRC client under the hood."
            />
          </div>
        </section>

        {/* Principles */}
        <section className="about-section">
          <h2 className="about-h2">Principles</h2>
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
        <section className="about-section about-connect">
          <h2 className="about-h2">Connect</h2>
          <div className="about-connect-grid">
            <a href="https://github.com/devinkbrown/ophion" target="_blank" rel="noopener noreferrer" className="about-link-card">
              <GithubIcon />
              <div>
                <div className="about-link-title">GitHub — Ophion</div>
                <div className="about-link-sub">github.com/devinkbrown/ophion</div>
              </div>
            </a>
            <div className="about-link-card about-link-card-irc">
              <IrcConnectIcon />
              <div>
                <div className="about-link-title">IRC Direct</div>
                <div className="about-link-sub">irc.eshmaki.me · port 6697 (TLS)</div>
              </div>
            </div>
          </div>
        </section>

      </div>

      {/* Footer */}
      <footer className="land-footer">
        <div className="land-footer-logo">
          <OceanLogo size={22} />
          <span>Ocean</span>
        </div>
        <div className="land-footer-links">
          <Link href="/" className="land-footer-link">Home</Link>
          <Link href="/login" className="land-footer-link">Sign In</Link>
          <a href="https://github.com/devinkbrown/ophion" target="_blank" rel="noopener noreferrer" className="land-footer-link">Ophion</a>
        </div>
        <p className="land-footer-copy">© {new Date().getFullYear()} eshmaki.me</p>
      </footer>

      <style>{`
        .about-root {
          background: var(--bg-void);
          color: var(--text-primary);
          min-height: 100dvh;
        }

        /* Reuse landing nav styles */
        .land-nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 100;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 clamp(20px,5vw,80px); height: 64px;
          background: rgba(3,8,16,0.8); backdrop-filter: blur(20px) saturate(1.4);
          border-bottom: 1px solid rgba(14,165,233,0.08);
        }
        .land-nav-logo-link { display: flex; align-items: center; gap: 10px; text-decoration: none; }
        .land-nav-wordmark { font-size: 17px; font-weight: 700; letter-spacing: -0.4px; color: var(--text-primary); }
        .land-nav-links { display: flex; align-items: center; gap: 24px; }
        .land-nav-link { font-size: 14px; font-weight: 500; color: var(--text-secondary); text-decoration: none; transition: color 0.2s; }
        .land-nav-link:hover { color: var(--text-primary); }
        .land-nav-cta {
          font-size: 14px; font-weight: 600; color: white; background: var(--accent);
          text-decoration: none; padding: 8px 18px; border-radius: var(--r-md);
          transition: opacity 0.2s, transform 0.2s; box-shadow: 0 0 20px rgba(14,165,233,0.3);
        }
        .land-nav-cta:hover { opacity: 0.88; transform: translateY(-1px); }

        /* Hero */
        .about-hero {
          position: relative; padding-top: 64px;
          overflow: hidden; border-bottom: 1px solid rgba(14,165,233,0.08);
        }
        .about-hero-orb {
          position: absolute; width: 600px; height: 600px;
          border-radius: 50%; filter: blur(100px);
          background: radial-gradient(circle,#0ea5e9 0%,transparent 65%);
          top: -200px; right: -100px; opacity: 0.1; pointer-events: none;
        }

        /* Container */
        .about-container {
          max-width: 860px; margin: 0 auto;
          padding: clamp(48px,6vw,80px) clamp(20px,5vw,60px);
        }

        .about-badge {
          display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--accent);
          padding: 4px 12px; background: rgba(14,165,233,0.1);
          border: 1px solid rgba(14,165,233,0.2); border-radius: 100px; margin-bottom: 20px;
        }

        .about-h1 {
          font-size: clamp(2.2rem,5vw,4rem); font-weight: 800; letter-spacing: -0.04em;
          line-height: 1.08; margin: 0 0 20px; color: var(--text-primary);
        }

        .about-lead {
          font-size: clamp(1rem,1.6vw,1.2rem); line-height: 1.7;
          color: var(--text-secondary); max-width: 560px; margin: 0;
        }

        /* Body */
        .about-body { padding-top: 0; }
        .about-section { margin-bottom: 72px; }

        .about-h2 {
          font-size: clamp(1.4rem,2.5vw,2rem); font-weight: 700;
          letter-spacing: -0.03em; color: var(--text-primary); margin: 0 0 28px;
        }

        /* Prose */
        .about-prose { display: flex; flex-direction: column; gap: 16px; }
        .about-prose p {
          font-size: clamp(0.95rem,1.3vw,1.05rem); line-height: 1.75;
          color: var(--text-secondary); margin: 0;
        }
        .about-prose strong { color: var(--text-primary); font-weight: 600; }

        /* Tech grid */
        .about-tech-grid {
          display: grid; grid-template-columns: repeat(2,1fr); gap: 16px;
        }
        @media (max-width: 600px) { .about-tech-grid { grid-template-columns: 1fr; } }

        /* Principles */
        .about-principles { display: flex; flex-direction: column; gap: 20px; }
        .about-principle {
          display: flex; align-items: flex-start; gap: 24px;
          padding: 24px; background: var(--bg-deep);
          border: 1px solid var(--border-subtle); border-radius: 14px;
          transition: border-color 0.25s;
        }
        .about-principle:hover { border-color: rgba(14,165,233,0.25); }
        .about-principle-n {
          font-size: 12px; font-weight: 700; font-family: ui-monospace,monospace;
          color: var(--accent); opacity: 0.7; flex-shrink: 0; margin-top: 2px;
        }
        .about-principle-title { font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; }
        .about-principle-body { font-size: 14px; line-height: 1.65; color: var(--text-secondary); }

        /* Connect */
        .about-connect-grid { display: flex; flex-direction: column; gap: 12px; }
        .about-link-card {
          display: flex; align-items: center; gap: 16px;
          padding: 20px 24px; background: var(--bg-deep);
          border: 1px solid var(--border-normal); border-radius: 14px;
          text-decoration: none; transition: border-color 0.25s, transform 0.2s;
        }
        .about-link-card:hover { border-color: rgba(14,165,233,0.35); transform: translateX(4px); }
        .about-link-title { font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 3px; }
        .about-link-sub { font-size: 13px; color: var(--text-muted); font-family: ui-monospace,monospace; }

        /* Footer (shared) */
        .land-footer {
          padding: 40px clamp(20px,5vw,80px);
          display: flex; align-items: center; justify-content: space-between;
          flex-wrap: wrap; gap: 20px; border-top: 1px solid var(--border-subtle);
        }
        .land-footer-logo { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; color: var(--text-primary); }
        .land-footer-links { display: flex; align-items: center; gap: 24px; }
        .land-footer-link { font-size: 14px; color: var(--text-muted); text-decoration: none; transition: color 0.2s; }
        .land-footer-link:hover { color: var(--text-primary); }
        .land-footer-copy { font-size: 13px; color: var(--text-muted); margin: 0; }
      `}</style>
    </main>
  );
}

function OceanLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <rect width="36" height="36" rx="9" fill="url(#ab-grad)" />
      <path d="M18 8L28 14V22L18 28L8 22V14L18 8Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" fill="rgba(255,255,255,0.08)"/>
      <circle cx="18" cy="18" r="4" fill="white" fillOpacity="0.9" />
      <defs>
        <linearGradient id="ab-grad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#0369a1" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{flexShrink:0}}>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" fill="var(--text-secondary)"/>
    </svg>
  );
}

function IrcConnectIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" style={{flexShrink:0}}>
      <rect width="32" height="32" rx="8" fill="rgba(14,165,233,0.1)"/>
      <path d="M8 11h16M8 16h12M8 21h8" stroke="#0ea5e9" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="24" cy="21" r="4" fill="rgba(14,165,233,0.15)" stroke="#0ea5e9" strokeWidth="1.2"/>
      <path d="M22.5 21l1 1 2-2" stroke="#0ea5e9" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function TechCard({ name, tag, color, desc, href }: {
  name: string; tag: string; color: string; desc: string; href?: string;
}) {
  const inner = (
    <div className="tech-card">
      <div className="tech-card-top">
        <div className="tech-tag" style={{background:`${color}18`,color,borderColor:`${color}33`}}>{tag}</div>
      </div>
      <div className="tech-name" style={{color}}>{name}</div>
      <div className="tech-desc">{desc}</div>
      <style>{`
        .tech-card {
          padding: 24px; background: var(--bg-deep);
          border: 1px solid var(--border-normal); border-radius: 16px;
          display: flex; flex-direction: column; gap: 12px;
          transition: border-color 0.25s, transform 0.2s;
          text-decoration: none;
        }
        .tech-card:hover { border-color: rgba(14,165,233,0.3); transform: translateY(-2px); }
        .tech-card-top { display: flex; align-items: center; justify-content: space-between; }
        .tech-tag {
          font-size: 11px; font-weight: 600; letter-spacing: 0.05em;
          text-transform: uppercase; padding: 3px 10px;
          border-radius: 100px; border: 1px solid;
        }
        .tech-name { font-size: 24px; font-weight: 800; letter-spacing: -0.04em; }
        .tech-desc { font-size: 14px; line-height: 1.65; color: var(--text-secondary); }
      `}</style>
    </div>
  );
  if (href) {
    return <a href={href} target="_blank" rel="noopener noreferrer" style={{textDecoration:'none'}}>{inner}</a>;
  }
  return inner;
}
