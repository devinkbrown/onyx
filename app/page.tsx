import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="land-root">

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
          <Link href="/about" className="land-nav-link">About</Link>
          <Link href="/login" className="land-nav-cta">
            Dive in <ArrowRight size={13} />
          </Link>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="land-hero">
        <div className="land-hero-body">
          <div className="land-hero-copy">
            <div className="land-badge">
              <span className="land-badge-sonar" />
              <span className="land-badge-dot" />
              eshmaki.me · live
            </div>

            <h1 className="land-h1">
              Go{' '}
              <span className="land-h1-deep">
                <span className="land-h1-word">deeper</span>
                <span className="land-h1-underwave" aria-hidden />
              </span>
              <br />
              than Discord.
            </h1>

            <p className="land-lead">
              Open-protocol community chat. Voice without WebRTC. Encryption
              without compromise. Start in <span className="land-inline-channel">#root</span>.
            </p>

            <div className="land-hero-actions">
              <Link href="/login" className="land-btn-primary">
                Enter Ocean
                <ArrowRight size={14} />
              </Link>
              <Link href="/about" className="land-btn-ghost">What is this?</Link>
            </div>

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
      <section className="land-features">

        {/* Row 1 — Voice + Sessions */}
        <div className="land-bento-row land-bento-row-1">
          <div className="land-card land-card-voice">
            <div className="land-card-glow land-card-glow-voice" />
            <div className="land-card-inner">
              <div className="land-card-eyebrow">
                <VoiceIcon />
                <span>LADON</span>
              </div>
              <h3 className="land-card-h3">Voice without borders</h3>
              <p className="land-card-p">
                Spatial audio and encrypted voice over Ophion IRC. No WebRTC,
                no STUN/TURN, no relay infrastructure. Your voice travels the
                same path as your messages.
              </p>
              <div className="land-voice-vis" aria-hidden>
                <WaveformVis />
              </div>
            </div>
          </div>

          <div className="land-card land-card-session">
            <div className="land-card-glow land-card-glow-session" />
            <div className="land-card-inner">
              <div className="land-card-eyebrow">
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

        {/* Row 2 — VEIL (wide) */}
        <div className="land-bento-row land-bento-row-2">
          <div className="land-card land-card-veil">
            <div className="land-card-glow land-card-glow-veil" />
            <div className="land-card-inner land-card-inner-split">
              <div className="land-card-text">
                <div className="land-card-eyebrow">
                  <VeilIcon />
                  <span>VEIL</span>
                </div>
                <h3 className="land-card-h3">End-to-end, always</h3>
                <p className="land-card-p">
                  P-256 ECDH key exchange and AES-256-GCM encryption for every
                  voice and video session. Forward secrecy built into the protocol
                  — not bolted on.
                </p>
              </div>
              <div className="land-veil-diagram" aria-hidden>
                <VeilKeyVis />
              </div>
            </div>
          </div>
        </div>

        {/* Row 3 — small cards */}
        <div className="land-bento-row land-bento-row-3">
          <div className="land-card land-card-sm">
            <div className="land-card-inner">
              <div className="land-card-eyebrow">
                <IrcIcon />
                <span>PROTOCOL</span>
              </div>
              <h3 className="land-card-h3">Open IRC</h3>
              <p className="land-card-p">
                Standard IRCv3. Connect with any client. Ocean is just the
                surface.
              </p>
            </div>
          </div>

          <div className="land-card land-card-sm">
            <div className="land-card-inner">
              <div className="land-card-eyebrow">
                <WbIcon />
                <span>COLLABORATE</span>
              </div>
              <h3 className="land-card-h3">Whiteboard</h3>
              <p className="land-card-p">
                Shared drawing surfaces built into every channel. No extra app.
              </p>
            </div>
          </div>

          <div className="land-card land-card-sm">
            <div className="land-card-inner">
              <div className="land-card-eyebrow">
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

      {/* ── Community ───────────────────────────────────────────────── */}
      <section className="land-community">
        <div className="land-community-bg" aria-hidden>
          <NetworkVis />
        </div>
        <div className="land-community-inner">
          <div className="land-community-label">eshmaki.me</div>
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
            <div className="land-ch">
              <span className="land-ch-hash">#</span>
              <span>dev</span>
            </div>
            <div className="land-ch">
              <span className="land-ch-hash">#</span>
              <span>art</span>
            </div>
            <div className="land-ch">
              <span className="land-ch-hash">#</span>
              <span>lounge</span>
            </div>
            <div className="land-ch land-ch-voice">
              <VoiceSmIcon />
              <span>voice-1</span>
            </div>
          </div>
          <Link href="/login" className="land-btn-primary land-btn-lg">
            Join the community
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="land-footer">
        <div className="land-footer-left">
          <div className="land-footer-logo">
            <OceanLogo size={20} />
            <span>Ocean</span>
          </div>
          <p className="land-footer-tagline">Built on Ophion IRC · eshmaki.me</p>
        </div>
        <div className="land-footer-links">
          <Link href="/about" className="land-footer-link">About</Link>
          <Link href="/login" className="land-footer-link">Sign In</Link>
          <a
            href="https://github.com/devinkbrown/ophion"
            target="_blank"
            rel="noopener noreferrer"
            className="land-footer-link"
          >
            Ophion ↗
          </a>
        </div>
      </footer>

      <style>{`
        /* ════════════════════════════════════════════════════════════
           OCEAN LANDING — DEPTH AESTHETIC
           ════════════════════════════════════════════════════════════ */

        .land-root {
          background: #030810;
          color: #dff0ff;
          min-height: 100dvh;
          overflow-x: hidden;
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
            rgba(14,165,233,0.8) 20%,
            rgba(14,165,233,0.3) 60%,
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
            radial-gradient(1px 1px at 20% 30%, rgba(14,165,233,0.4) 0%, transparent 100%),
            radial-gradient(1px 1px at 40% 70%, rgba(103,232,249,0.3) 0%, transparent 100%),
            radial-gradient(1px 1px at 60% 20%, rgba(14,165,233,0.3) 0%, transparent 100%),
            radial-gradient(1px 1px at 80% 55%, rgba(103,232,249,0.2) 0%, transparent 100%),
            radial-gradient(1px 1px at 15% 60%, rgba(14,165,233,0.25) 0%, transparent 100%),
            radial-gradient(1px 1px at 90% 40%, rgba(103,232,249,0.2) 0%, transparent 100%);
          animation: particles-drift 30s linear infinite;
        }
        @keyframes particles-drift {
          0%   { transform: translateY(0); }
          100% { transform: translateY(-40px); }
        }

        /* ── Nav ── */
        .land-nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 200;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 clamp(20px, 5vw, 80px);
          height: 60px;
          background: rgba(3,8,16,0.72);
          backdrop-filter: blur(24px) saturate(1.5);
          border-bottom: 1px solid rgba(14,165,233,0.07);
        }
        .land-nav-logo {
          display: flex; align-items: center; gap: 9px;
          text-decoration: none;
        }
        .land-nav-wordmark {
          font-size: 16px; font-weight: 700; letter-spacing: -0.3px;
          color: #dff0ff;
        }
        .land-nav-links { display: flex; align-items: center; gap: 20px; }
        .land-nav-link {
          font-size: 14px; font-weight: 500;
          color: #7aa8c4; text-decoration: none;
          transition: color 0.2s;
        }
        .land-nav-link:hover { color: #dff0ff; text-decoration: none; }
        .land-nav-cta {
          display: flex; align-items: center; gap: 6px;
          font-size: 13px; font-weight: 600; color: #030810;
          background: linear-gradient(135deg, #0ea5e9, #38bdf8);
          text-decoration: none;
          padding: 7px 16px; border-radius: 20px;
          transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
          box-shadow: 0 0 16px rgba(14,165,233,0.35);
        }
        .land-nav-cta:hover { opacity: 0.92; transform: translateY(-1px); text-decoration: none; }

        /* ── Hero ── */
        .land-hero {
          position: relative; z-index: 1;
          padding: 140px clamp(20px,5vw,80px) 80px;
          min-height: 100dvh;
          display: flex; align-items: center;
        }
        .land-hero-body {
          width: 100%; max-width: 1200px; margin: 0 auto;
          display: grid; grid-template-columns: 1fr 1fr; gap: 60px;
          align-items: center;
        }
        @media (max-width: 768px) {
          .land-hero-body { grid-template-columns: 1fr; }
          .land-hero-visual { display: none; }
        }

        .land-hero-copy { display: flex; flex-direction: column; gap: 28px; }

        /* Badge */
        .land-badge {
          display: inline-flex; align-items: center; gap: 8px;
          font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: #0ea5e9;
          padding: 5px 12px; border-radius: 20px;
          background: rgba(14,165,233,0.1);
          border: 1px solid rgba(14,165,233,0.22);
          width: fit-content;
          position: relative; overflow: hidden;
        }
        .land-badge-sonar {
          position: absolute; inset: 0; border-radius: 20px;
          background: rgba(14,165,233,0.08);
          animation: sonar-pulse 3s ease-out infinite;
        }
        .land-badge-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #0ea5e9;
          box-shadow: 0 0 6px rgba(14,165,233,0.8);
          flex-shrink: 0;
          animation: dot-pulse 2s ease-in-out infinite;
        }
        @keyframes sonar-pulse {
          0% { transform: scale(0.9); opacity: 0.5; }
          70% { transform: scale(1.4); opacity: 0; }
          100% { transform: scale(1.4); opacity: 0; }
        }
        @keyframes dot-pulse {
          0%, 100% { box-shadow: 0 0 4px rgba(14,165,233,0.8); }
          50%       { box-shadow: 0 0 10px rgba(14,165,233,1); }
        }

        /* Heading */
        .land-h1 {
          font-size: clamp(2.8rem, 5.5vw, 5rem);
          font-weight: 800;
          letter-spacing: -0.03em;
          line-height: 1.05;
          color: #dff0ff;
          margin: 0;
        }
        .land-h1-deep {
          position: relative; display: inline-block;
          color: #0ea5e9;
        }
        .land-h1-word { position: relative; z-index: 1; }
        .land-h1-underwave {
          position: absolute; bottom: -4px; left: 0; right: 0; height: 4px;
          background: linear-gradient(90deg, #0ea5e9, #67e8f9, #0ea5e9);
          border-radius: 2px;
          animation: wave-shimmer 2s ease-in-out infinite;
        }
        @keyframes wave-shimmer {
          0%, 100% { opacity: 0.7; transform: scaleX(1); }
          50%       { opacity: 1;   transform: scaleX(1.02); }
        }

        /* Lead */
        .land-lead {
          font-size: clamp(1rem, 1.5vw, 1.15rem);
          line-height: 1.7; color: #7aa8c4; margin: 0;
        }
        .land-inline-channel {
          font-family: 'Courier New', monospace; font-size: 0.9em;
          color: #0ea5e9; background: rgba(14,165,233,0.1);
          padding: 1px 6px; border-radius: 4px;
        }

        /* CTA buttons */
        .land-hero-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        .land-btn-primary {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 12px 22px; border-radius: var(--r-md, 8px);
          font-size: 14px; font-weight: 600; color: #030810;
          background: linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%);
          text-decoration: none;
          box-shadow: 0 4px 20px rgba(14,165,233,0.4), 0 0 0 1px rgba(14,165,233,0.3);
          transition: all 0.2s;
        }
        .land-btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 32px rgba(14,165,233,0.5), 0 0 0 1px rgba(14,165,233,0.5);
          text-decoration: none; color: #030810;
        }
        .land-btn-ghost {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 12px 20px; border-radius: var(--r-md, 8px);
          font-size: 14px; font-weight: 500;
          color: #7aa8c4; text-decoration: none;
          border: 1px solid rgba(14,165,233,0.18);
          background: rgba(14,165,233,0.04);
          transition: all 0.2s;
        }
        .land-btn-ghost:hover {
          color: #dff0ff; background: rgba(14,165,233,0.09);
          border-color: rgba(14,165,233,0.35); text-decoration: none;
        }
        .land-btn-lg { padding: 14px 28px; font-size: 15px; }

        /* Depth meter */
        .land-depth-meter {
          display: flex; flex-direction: column; gap: 6px;
          padding-top: 4px;
        }
        .land-dm-track {
          height: 2px; background: rgba(14,165,233,0.12);
          border-radius: 2px; overflow: hidden; position: relative;
        }
        .land-dm-fill {
          position: absolute; top: 0; left: 0; bottom: 0;
          width: 68%;
          background: linear-gradient(90deg, #0ea5e9, #67e8f9);
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
          color: #3d6480; font-variant-numeric: tabular-nums;
        }
        .land-dm-depth { color: #0ea5e9; }

        /* ── Hero visual ── */
        .land-hero-visual {
          display: flex; align-items: center; justify-content: center;
        }

        /* ── Sonar separator ── */
        .land-sonar-line {
          position: relative; z-index: 1;
          display: flex; align-items: center; gap: 16px;
          padding: 0 clamp(20px, 5vw, 80px);
          margin: 0 0 60px;
        }
        .land-sonar-ping {
          width: 8px; height: 8px; border-radius: 50%;
          background: #0ea5e9; flex-shrink: 0;
          box-shadow: 0 0 8px rgba(14,165,233,0.8);
          animation: ping 2s ease-in-out infinite;
        }
        @keyframes ping {
          0%, 100% { box-shadow: 0 0 4px rgba(14,165,233,0.8); }
          50%       { box-shadow: 0 0 14px rgba(14,165,233,1), 0 0 28px rgba(14,165,233,0.4); }
        }
        .land-sonar-text {
          font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
          color: #3d6480; font-variant-numeric: tabular-nums;
        }

        /* ── Features ── */
        .land-features {
          position: relative; z-index: 1;
          padding: 0 clamp(20px, 5vw, 80px) 80px;
          max-width: 1200px; margin: 0 auto;
          display: flex; flex-direction: column; gap: 16px;
        }

        /* ── Bento rows ── */
        .land-bento-row {
          display: grid; gap: 16px;
        }
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
          background: rgba(12,24,40,0.85);
          border: 1px solid rgba(14,165,233,0.12);
          border-radius: 16px;
          backdrop-filter: blur(12px);
          transition: border-color 0.3s, transform 0.2s, box-shadow 0.3s;
        }
        .land-card:hover {
          border-color: rgba(14,165,233,0.28);
          transform: translateY(-2px);
          box-shadow: 0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(14,165,233,0.15);
        }
        .land-card-glow {
          position: absolute; inset: 0; pointer-events: none;
          border-radius: 16px; opacity: 0;
          transition: opacity 0.3s;
        }
        .land-card:hover .land-card-glow { opacity: 1; }
        .land-card-glow-voice  { background: radial-gradient(circle at 30% 50%, rgba(14,165,233,0.08) 0%, transparent 70%); }
        .land-card-glow-session { background: radial-gradient(circle at 80% 20%, rgba(103,232,249,0.08) 0%, transparent 60%); }
        .land-card-glow-veil   { background: radial-gradient(circle at 50% 100%, rgba(124,90,245,0.08) 0%, transparent 60%); }

        .land-card-inner {
          padding: 28px; display: flex; flex-direction: column; gap: 12px;
        }
        .land-card-inner-split {
          flex-direction: row; gap: 40px; align-items: center;
        }
        @media (max-width: 768px) {
          .land-card-inner-split { flex-direction: column; }
        }
        .land-card-text { flex: 1; display: flex; flex-direction: column; gap: 12px; }

        .land-card-eyebrow {
          display: flex; align-items: center; gap: 7px;
          font-size: 10px; font-weight: 800; letter-spacing: 0.1em;
          text-transform: uppercase; color: #3d6480;
        }
        .land-card-eyebrow svg { opacity: 0.7; }

        .land-card-h3 {
          font-size: 1.15rem; font-weight: 700; letter-spacing: -0.02em;
          color: #dff0ff; margin: 0; line-height: 1.3;
        }
        .land-card-p {
          font-size: 0.875rem; line-height: 1.65;
          color: #7aa8c4; margin: 0;
        }

        /* Voice card visual */
        .land-voice-vis {
          margin-top: 8px; height: 60px;
          display: flex; align-items: center;
        }

        /* Token display */
        .land-token-display {
          margin-top: 8px; display: flex; flex-direction: column; gap: 6px;
        }
        .land-token-row {
          font-family: 'Courier New', monospace; font-size: 13px;
          padding: 8px 12px; border-radius: 8px;
          background: rgba(0,0,0,0.4); border: 1px solid rgba(14,165,233,0.15);
          display: flex; align-items: center; gap: 2px;
        }
        .land-token-prefix { color: #3d6480; }
        .land-token-body   { color: #0ea5e9; }
        .land-token-status {
          display: flex; align-items: center; gap: 7px;
          font-size: 12px; color: #34d399;
        }
        .land-token-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #34d399; flex-shrink: 0;
          box-shadow: 0 0 6px rgba(52,211,153,0.7);
        }

        /* VEIL diagram area */
        .land-veil-diagram { flex-shrink: 0; }

        /* ── Community ── */
        .land-community {
          position: relative; z-index: 1;
          overflow: hidden;
          margin: 20px clamp(20px, 5vw, 80px);
          border-radius: 24px;
          background: rgba(6,16,29,0.9);
          border: 1px solid rgba(14,165,233,0.12);
          padding: clamp(60px, 8vw, 100px) clamp(32px, 5vw, 80px);
          text-align: center;
        }
        .land-community-bg {
          position: absolute; inset: 0; pointer-events: none; opacity: 0.25;
          display: flex; align-items: center; justify-content: center;
        }
        .land-community-inner {
          position: relative; z-index: 1;
          display: flex; flex-direction: column;
          align-items: center; gap: 24px;
          max-width: 640px; margin: 0 auto;
        }
        .land-community-label {
          font-size: 11px; font-weight: 800; letter-spacing: 0.1em;
          text-transform: uppercase; color: #3d6480;
        }
        .land-community-h2 {
          font-size: clamp(2rem, 4vw, 3.2rem); font-weight: 800;
          letter-spacing: -0.03em; line-height: 1.1; color: #dff0ff; margin: 0;
        }
        .land-community-p {
          font-size: clamp(1rem, 1.4vw, 1.1rem); line-height: 1.7;
          color: #7aa8c4; margin: 0;
        }
        .land-channel-pill {
          font-family: 'Courier New', monospace; font-size: 0.92em;
          color: #0ea5e9; background: rgba(14,165,233,0.12);
          padding: 1px 6px; border-radius: 4px;
        }

        /* Channel list preview */
        .land-channels {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          justify-content: center;
        }
        .land-ch {
          display: flex; align-items: center; gap: 5px;
          font-size: 13px; font-family: 'Courier New', monospace;
          padding: 5px 12px; border-radius: 20px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(14,165,233,0.12);
          color: #5a88a0;
          transition: all 0.2s;
        }
        .land-ch-hash { color: #3d6480; font-size: 12px; }
        .land-ch-active {
          background: rgba(14,165,233,0.12);
          border-color: rgba(14,165,233,0.35);
          color: #0ea5e9;
        }
        .land-ch-live {
          font-size: 9px; font-weight: 800; letter-spacing: 0.06em;
          color: #030810; background: #0ea5e9;
          padding: 1px 5px; border-radius: 4px; margin-left: 2px;
        }
        .land-ch-voice {
          border-color: rgba(34,197,94,0.25);
          color: #22c55e;
        }
        .land-ch-voice svg { width: 11px; height: 11px; opacity: 0.9; }

        /* ── Footer ── */
        .land-footer {
          position: relative; z-index: 1;
          display: flex; align-items: center; justify-content: space-between;
          flex-wrap: wrap; gap: 16px;
          padding: 32px clamp(20px, 5vw, 80px);
          border-top: 1px solid rgba(14,165,233,0.07);
          margin-top: 20px;
        }
        .land-footer-left { display: flex; flex-direction: column; gap: 4px; }
        .land-footer-logo {
          display: flex; align-items: center; gap: 8px;
          font-size: 15px; font-weight: 700; color: #dff0ff;
        }
        .land-footer-tagline { font-size: 12px; color: #3d6480; }
        .land-footer-links { display: flex; align-items: center; gap: 20px; }
        .land-footer-link {
          font-size: 13px; color: #3d6480; text-decoration: none;
          transition: color 0.2s;
        }
        .land-footer-link:hover { color: #7aa8c4; text-decoration: none; }
      `}</style>
    </main>
  );
}

// ── SVG Components ─────────────────────────────────────────────────────────────

function OceanLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <circle cx="14" cy="14" r="12" stroke="#0ea5e9" strokeWidth="1.5" fill="rgba(14,165,233,0.08)" />
      <path d="M4 14c3-4 6-4 6 0s3 4 6 0 3-4 6 0" stroke="#0ea5e9" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M4 17c3-3 6-3 6 0s3 3 6 0 3-3 6 0" stroke="#67e8f9" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.5" />
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
    <svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M7.5 1a2 2 0 0 0-2 2v4.5a2 2 0 0 0 4 0V3a2 2 0 0 0-2-2z" />
      <path d="M3.5 6.5a4 4 0 0 0 8 0" strokeLinecap="round" />
      <path d="M7.5 10.5v3" strokeLinecap="round" />
    </svg>
  );
}

function TokenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="4" width="11" height="7.5" rx="1.5" />
      <path d="M5 7.5h5M5 9.5h3" strokeLinecap="round" />
      <circle cx="11" cy="4" r="2" fill="#0ea5e9" stroke="none" />
    </svg>
  );
}

function VeilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M7.5 1L2 4v5c0 3.5 2.5 6.5 5.5 7.5C10.5 15.5 13 12.5 13 9V4L7.5 1z" strokeLinejoin="round" />
      <path d="M5.5 7.5l1.5 1.5 3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IrcIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 3a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V3z" strokeLinejoin="round" />
      <path d="M5 6h5M5 8.5h3" strokeLinecap="round" />
    </svg>
  );
}

function WbIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="1.5" width="12" height="10" rx="1.5" />
      <path d="M4 9l2-2 1.5 1.5L10 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 12.5h7" strokeLinecap="round" />
    </svg>
  );
}

function MsgIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
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
    <svg width="420" height="500" viewBox="0 0 420 500" fill="none">
      {/* depth gradient background */}
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
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="bio-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#67e8f9" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ocean water fill */}
      <rect width="420" height="500" fill="url(#ocean-depth)" rx="20" />

      {/* depth level lines */}
      {[80, 160, 240, 320, 400, 460].map((y, i) => (
        <g key={y}>
          <line x1="20" y1={y} x2="400" y2={y} stroke="rgba(14,165,233,0.08)" strokeWidth="1" />
          <text x="24" y={y - 6} fill="rgba(14,165,233,0.3)" fontSize="9" fontFamily="monospace">
            {`${[0,200,500,1000,2000,3500,6000][i]}m`}
          </text>
        </g>
      ))}

      {/* sunlight rays from top */}
      {[80, 150, 220, 310].map((x, i) => (
        <line
          key={x}
          x1={x} y1={0}
          x2={x + (i % 2 === 0 ? -20 : 20)} y2={240}
          stroke="url(#glow-line)"
          strokeWidth={i === 1 ? 2 : 1}
          opacity={0.5 - i * 0.08}
        />
      ))}

      {/* animated chat-bubble/message nodes */}
      {[
        { cx: 120, cy: 100, r: 30, label: '#root', active: true },
        { cx: 300, cy: 80,  r: 22, label: '#dev',  active: false },
        { cx: 200, cy: 200, r: 26, label: 'voice', active: false, voice: true },
        { cx: 80,  cy: 260, r: 18, label: '#art',  active: false },
        { cx: 340, cy: 300, r: 20, label: '#lounge', active: false },
      ].map(({ cx, cy, r, label, active, voice }) => (
        <g key={label} filter="url(#blur-glow)">
          <circle
            cx={cx} cy={cy} r={r}
            fill={active ? 'rgba(14,165,233,0.2)' : voice ? 'rgba(34,197,94,0.12)' : 'rgba(14,165,233,0.07)'}
            stroke={active ? 'rgba(14,165,233,0.7)' : voice ? 'rgba(34,197,94,0.4)' : 'rgba(14,165,233,0.2)'}
            strokeWidth={active ? 1.5 : 1}
          />
          {active && (
            <circle cx={cx} cy={cy} r={r + 6} fill="none"
              stroke="rgba(14,165,233,0.2)" strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}
          <text x={cx} y={cy + 4} textAnchor="middle"
            fill={active ? '#0ea5e9' : voice ? '#22c55e' : 'rgba(14,165,233,0.5)'}
            fontSize={label.length > 5 ? 7 : 8}
            fontFamily="monospace" fontWeight={active ? '700' : '400'}
          >
            {voice ? '🔊' : '#'}{label.replace('#', '')}
          </text>
        </g>
      ))}

      {/* connecting lines between nodes */}
      {[
        [120, 100, 300, 80],
        [120, 100, 200, 200],
        [300, 80,  200, 200],
        [200, 200, 80,  260],
        [200, 200, 340, 300],
        [80,  260, 340, 300],
      ].map(([x1,y1,x2,y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="rgba(14,165,233,0.12)" strokeWidth="1"
        />
      ))}

      {/* bioluminescent particles */}
      {[
        [160, 350], [250, 380], [90, 420], [320, 410],
        [180, 460], [280, 440], [60, 340], [370, 360],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={1.5}
          fill="#67e8f9"
          opacity={0.4 + (i % 3) * 0.15}
        />
      ))}

      {/* depth vessel (app icon) near bottom */}
      <g transform="translate(185, 420)">
        <ellipse cx="25" cy="18" rx="22" ry="14"
          fill="rgba(14,165,233,0.12)"
          stroke="rgba(14,165,233,0.5)"
          strokeWidth="1.5"
        />
        <text x="25" y="23" textAnchor="middle"
          fill="#0ea5e9" fontSize="10" fontFamily="monospace" fontWeight="600"
        >
          Ocean
        </text>
        {/* portholes */}
        <circle cx="12" cy="18" r="3.5" fill="rgba(14,165,233,0.15)" stroke="rgba(14,165,233,0.4)" strokeWidth="1" />
        <circle cx="25" cy="18" r="3.5" fill="rgba(14,165,233,0.15)" stroke="rgba(14,165,233,0.4)" strokeWidth="1" />
        <circle cx="38" cy="18" r="3.5" fill="rgba(14,165,233,0.15)" stroke="rgba(14,165,233,0.4)" strokeWidth="1" />
      </g>
    </svg>
  );
}

// ── Waveform visualization ──────────────────────────────────────────────────

function WaveformVis() {
  const bars = [0.3, 0.5, 0.8, 1.0, 0.7, 0.9, 0.6, 0.4, 0.8, 0.7, 0.5, 0.9, 1.0, 0.6, 0.3, 0.7, 0.9, 0.5, 0.4, 0.8];
  return (
    <svg width="100%" height="60" viewBox="0 0 200 60" preserveAspectRatio="none">
      <defs>
        <linearGradient id="waveform-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {bars.map((h, i) => {
        const barH = h * 48;
        const x = i * (200 / bars.length) + 2;
        return (
          <rect key={i}
            x={x} y={(60 - barH) / 2}
            width={200 / bars.length - 4} height={barH}
            rx="2" fill="url(#waveform-grad)"
            opacity={0.6 + h * 0.4}
          />
        );
      })}
    </svg>
  );
}

// ── VEIL key exchange visualization ───────────────────────────────────────

function VeilKeyVis() {
  return (
    <svg width="200" height="160" viewBox="0 0 200 160" fill="none">
      <defs>
        <radialGradient id="veil-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#7c5af5" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#7c5af5" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Left key node */}
      <circle cx="40" cy="80" r="24" fill="rgba(124,90,245,0.1)" stroke="rgba(124,90,245,0.4)" strokeWidth="1.5" />
      <text x="40" y="85" textAnchor="middle" fill="#a78bfa" fontSize="18">🔑</text>

      {/* Right key node */}
      <circle cx="160" cy="80" r="24" fill="rgba(14,165,233,0.1)" stroke="rgba(14,165,233,0.4)" strokeWidth="1.5" />
      <text x="160" y="85" textAnchor="middle" fill="#38bdf8" fontSize="18">🔐</text>

      {/* Center shared secret */}
      <circle cx="100" cy="80" r="18" fill="url(#veil-glow)" stroke="rgba(103,232,249,0.5)" strokeWidth="1" />
      <text x="100" y="85" textAnchor="middle" fill="#67e8f9" fontSize="13">✓</text>

      {/* Exchange arrows */}
      <path d="M64 68 Q100 40 136 68" stroke="rgba(124,90,245,0.5)" strokeWidth="1.5" fill="none" strokeDasharray="4 3" markerEnd="url(#arrowhead)" />
      <path d="M136 92 Q100 120 64 92" stroke="rgba(14,165,233,0.5)" strokeWidth="1.5" fill="none" strokeDasharray="4 3" />

      {/* Labels */}
      <text x="40" y="118" textAnchor="middle" fill="rgba(124,90,245,0.7)" fontSize="9" fontFamily="monospace">P-256</text>
      <text x="160" y="118" textAnchor="middle" fill="rgba(14,165,233,0.7)" fontSize="9" fontFamily="monospace">ECDH</text>
      <text x="100" y="110" textAnchor="middle" fill="rgba(103,232,249,0.7)" fontSize="9" fontFamily="monospace">AES-GCM</text>
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
    <svg width="480" height="340" viewBox="0 0 480 340" fill="none">
      {edges.map(([a, b], i) => (
        <line key={i}
          x1={nodes[a][0]} y1={nodes[a][1]}
          x2={nodes[b][0]} y2={nodes[b][1]}
          stroke="rgba(14,165,233,0.3)" strokeWidth="1"
        />
      ))}
      {nodes.map(([cx, cy], i) => (
        <circle key={i}
          cx={cx} cy={cy} r={i < 4 ? 5 : 3}
          fill={i < 4 ? 'rgba(14,165,233,0.5)' : 'rgba(103,232,249,0.3)'}
          stroke={i < 4 ? 'rgba(14,165,233,0.8)' : 'rgba(103,232,249,0.5)'}
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}
