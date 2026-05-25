'use client';

import { useState } from 'react';
import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';

type UserStatus = 'online' | 'idle' | 'dnd' | 'offline';

const STATUS_LABELS: Record<UserStatus, string> = {
  online:  'Online',
  idle:    'Idle',
  dnd:     'Do Not Disturb',
  offline: 'Invisible',
};

const STATUS_COLORS: Record<UserStatus, string> = {
  online:  'var(--status-online)',
  idle:    'var(--status-idle)',
  dnd:     'var(--status-dnd)',
  offline: 'var(--status-offline)',
};

const SUGGESTED_CHANNELS = ['#general', '#random', '#help', '#music', '#gaming'];

export default function OnboardingModal() {
  const onboardingStep    = useOnyxStore(s => s.onboardingStep);
  const ourNick           = useOnyxStore(s => s.ourNick);
  const serverUrl         = useOnyxStore(s => s.server?.url ?? 'IRC Server');
  const userStatus        = useOnyxStore(s => s.userStatus);
  const isIRCX            = useOnyxStore(s => s.isIRCX);
  const nextOnboardingStep = useOnyxStore(s => s.nextOnboardingStep);
  const skipOnboarding    = useOnyxStore(s => s.skipOnboarding);
  const setUserStatus     = useOnyxStore(s => s.setUserStatus);
  const joinChannel       = useOnyxStore(s => s.joinChannel);
  const client            = useOnyxStore(s => s.client);

  // Step 1 local state
  const [bio, setBio] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);

  // Step 2 local state
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [channelsJoined, setChannelsJoined] = useState(false);

  const TOTAL_STEPS = 4;

  function handleSaveProfile() {
    // Send BIO via IRCX PROP if supported
    if (isIRCX && bio.trim() && client) {
      client.sendRaw('PROP', '*', 'BIO', bio.trim());
    }
    setProfileSaved(true);
    nextOnboardingStep();
  }

  function handleJoinChannels() {
    const chans = [...selectedChannels];
    if (chans.length > 0) {
      joinChannel(chans.join(','));
    }
    setChannelsJoined(true);
    nextOnboardingStep();
  }

  function toggleChannel(ch: string) {
    setSelectedChannels(prev => {
      const next = new Set(prev);
      if (next.has(ch)) {
        next.delete(ch);
      } else {
        next.add(ch);
      }
      return next;
    });
  }

  return (
    <div className="onb-backdrop" role="dialog" aria-modal="true" aria-label="Welcome to Ocean">
      <div className="onb-modal">

        {/* Progress dots */}
        <div className="onb-dots" aria-label={`Step ${onboardingStep + 1} of ${TOTAL_STEPS}`}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <span
              key={i}
              className={`onb-dot ${i === onboardingStep ? 'onb-dot--active' : i < onboardingStep ? 'onb-dot--done' : ''}`}
            />
          ))}
        </div>

        {/* ── Step 0: Welcome ── */}
        {onboardingStep === 0 && (
          <div className="onb-step" key="step-0">
            <div className="onb-hero-emoji" role="img" aria-label="Ocean wave">🌊</div>
            <h2 className="onb-title">Welcome to Ocean</h2>
            <p className="onb-subtitle">Connected to <strong>{serverUrl}</strong></p>
            <p className="onb-body">
              Ocean is a modern chat client powered by the Ophion IRC engine.
              Let&apos;s get you set up.
            </p>
            <button className="onb-btn-primary" onClick={nextOnboardingStep}>
              Let&apos;s go →
            </button>
          </div>
        )}

        {/* ── Step 1: Profile ── */}
        {onboardingStep === 1 && (
          <div className="onb-step" key="step-1">
            <div className="onb-avatar-preview">
              <Avatar nick={ourNick} size={64} status={userStatus} />
            </div>
            <h2 className="onb-title">Set your profile</h2>
            <p className="onb-nick-label">{ourNick}</p>

            {isIRCX && (
              <div className="onb-field">
                <label className="onb-label" htmlFor="onb-bio">About me</label>
                <textarea
                  id="onb-bio"
                  className="onb-textarea"
                  placeholder="Tell everyone a little about yourself…"
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  rows={2}
                  maxLength={200}
                />
              </div>
            )}

            <div className="onb-field">
              <div className="onb-label">Status</div>
              <div className="onb-status-grid">
                {(Object.keys(STATUS_LABELS) as UserStatus[]).map(s => (
                  <button
                    key={s}
                    className={`onb-status-option ${userStatus === s ? 'onb-status-option--active' : ''}`}
                    onClick={() => setUserStatus(s)}
                    aria-pressed={userStatus === s}
                  >
                    <span
                      className="onb-status-dot"
                      style={{ background: STATUS_COLORS[s] }}
                    />
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            <button className="onb-btn-primary" onClick={handleSaveProfile}>
              Continue →
            </button>
            <button className="onb-link" onClick={nextOnboardingStep}>
              Skip
            </button>
          </div>
        )}

        {/* ── Step 2: Join channels ── */}
        {onboardingStep === 2 && (
          <div className="onb-step" key="step-2">
            <h2 className="onb-title">Find channels to join</h2>
            <p className="onb-body">
              Pick some channels to get the conversation started.
            </p>

            <div className="onb-channel-list">
              {SUGGESTED_CHANNELS.map(ch => (
                <label key={ch} className="onb-channel-item">
                  <input
                    type="checkbox"
                    className="onb-checkbox"
                    checked={selectedChannels.has(ch)}
                    onChange={() => toggleChannel(ch)}
                  />
                  <span className="onb-channel-name">{ch}</span>
                </label>
              ))}
            </div>

            <button
              className="onb-btn-primary"
              onClick={handleJoinChannels}
              disabled={selectedChannels.size === 0}
            >
              {selectedChannels.size > 0
                ? `Join ${selectedChannels.size} channel${selectedChannels.size > 1 ? 's' : ''}`
                : 'Join selected channels'
              }
            </button>
            <button className="onb-link" onClick={nextOnboardingStep}>
              Skip
            </button>
          </div>
        )}

        {/* ── Step 3: All set ── */}
        {onboardingStep === 3 && (
          <div className="onb-step" key="step-3">
            <div className="onb-hero-emoji onb-hero-emoji--celebrate" role="img" aria-label="Party">🎉</div>
            <h2 className="onb-title">You&apos;re ready!</h2>

            <ul className="onb-checklist">
              <li className="onb-checklist-item onb-checklist-item--done">
                <CheckIcon /> Connected to server
              </li>
              <li className={`onb-checklist-item ${profileSaved ? 'onb-checklist-item--done' : 'onb-checklist-item--skip'}`}>
                {profileSaved ? <CheckIcon /> : <DashIcon />} Profile set
              </li>
              <li className={`onb-checklist-item ${channelsJoined ? 'onb-checklist-item--done' : 'onb-checklist-item--skip'}`}>
                {channelsJoined ? <CheckIcon /> : <DashIcon />} Channels joined
              </li>
            </ul>

            <p className="onb-tip">
              <span className="onb-tip-icon">💡</span>
              Tip: Press <kbd className="onb-kbd">?</kbd> anytime to see keyboard shortcuts
            </p>

            <button className="onb-btn-primary" onClick={skipOnboarding}>
              Start chatting
            </button>
          </div>
        )}

      </div>

      <style>{`
        @keyframes onb-fade-in {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes onb-backdrop-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes onb-step-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes onb-celebrate {
          0%   { transform: scale(1) rotate(0deg); }
          25%  { transform: scale(1.15) rotate(-8deg); }
          50%  { transform: scale(1.2) rotate(8deg); }
          75%  { transform: scale(1.1) rotate(-4deg); }
          100% { transform: scale(1) rotate(0deg); }
        }

        .onb-backdrop {
          position: fixed;
          inset: 0;
          z-index: 900;
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          animation: onb-backdrop-in 220ms ease both;
        }

        .onb-modal {
          width: 100%;
          max-width: 500px;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xl, 16px);
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255,255,255,0.04) inset;
          padding: 36px 32px 32px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
          animation: onb-fade-in 220ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
        }

        /* ── Progress dots ── */
        .onb-dots {
          display: flex;
          gap: 8px;
          margin-bottom: 28px;
        }
        .onb-dot {
          width: 8px;
          height: 8px;
          border-radius: 9999px;
          background: var(--bg-overlay, #3a3a4a);
          transition: background 220ms ease, transform 220ms ease;
        }
        .onb-dot--active {
          background: var(--accent);
          transform: scale(1.25);
        }
        .onb-dot--done {
          background: color-mix(in srgb, var(--accent) 50%, transparent);
        }

        /* ── Step container ── */
        .onb-step {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          animation: onb-step-in 220ms ease both;
        }

        /* ── Hero emoji ── */
        .onb-hero-emoji {
          font-size: 56px;
          line-height: 1;
          margin-bottom: 4px;
          user-select: none;
        }
        .onb-hero-emoji--celebrate {
          animation: onb-celebrate 600ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
        }

        /* ── Typography ── */
        .onb-title {
          font-size: 24px;
          font-weight: 800;
          color: var(--text-primary);
          letter-spacing: -0.02em;
          margin: 0;
          text-align: center;
        }
        .onb-subtitle {
          font-size: 14px;
          color: var(--text-muted);
          margin: 0;
          text-align: center;
        }
        .onb-subtitle strong {
          color: var(--text-secondary);
          font-weight: 600;
        }
        .onb-body {
          font-size: 14px;
          color: var(--text-secondary);
          margin: 0;
          text-align: center;
          line-height: 1.6;
          max-width: 380px;
        }
        .onb-nick-label {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 4px 0 0;
        }

        /* ── Avatar preview ── */
        .onb-avatar-preview {
          margin-bottom: 4px;
        }

        /* ── Form fields ── */
        .onb-field {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 4px;
        }
        .onb-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .onb-textarea {
          width: 100%;
          box-sizing: border-box;
          background: var(--bg-input, var(--bg-deep));
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md, 8px);
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          padding: 10px 12px;
          resize: none;
          line-height: 1.5;
          transition: border-color 150ms ease;
          outline: none;
        }
        .onb-textarea:focus {
          border-color: var(--accent-border, var(--accent));
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
        }
        .onb-textarea::placeholder {
          color: var(--text-muted);
        }

        /* ── Status grid ── */
        .onb-status-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        .onb-status-option {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-radius: var(--r-md, 8px);
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          text-align: left;
          transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
        }
        .onb-status-option:hover {
          background: var(--ch-hover-bg);
          color: var(--text-primary);
        }
        .onb-status-option--active {
          background: var(--accent-subtle, color-mix(in srgb, var(--accent) 15%, transparent));
          border-color: var(--accent-border, color-mix(in srgb, var(--accent) 40%, transparent));
          color: var(--text-primary);
        }
        .onb-status-dot {
          width: 9px;
          height: 9px;
          border-radius: 9999px;
          flex-shrink: 0;
        }

        /* ── Channel list ── */
        .onb-channel-list {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .onb-channel-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-radius: var(--r-md, 8px);
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          transition: background 150ms ease, border-color 150ms ease;
        }
        .onb-channel-item:has(.onb-checkbox:checked) {
          background: var(--accent-subtle, color-mix(in srgb, var(--accent) 15%, transparent));
          border-color: var(--accent-border, color-mix(in srgb, var(--accent) 40%, transparent));
        }
        .onb-channel-item:hover {
          background: var(--ch-hover-bg);
        }
        .onb-checkbox {
          width: 16px;
          height: 16px;
          accent-color: var(--accent);
          cursor: pointer;
          flex-shrink: 0;
        }
        .onb-channel-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }

        /* ── Checklist ── */
        .onb-checklist {
          list-style: none;
          padding: 0;
          margin: 4px 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-self: flex-start;
          width: 100%;
        }
        .onb-checklist-item {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 14px;
          color: var(--text-secondary);
          font-weight: 500;
        }
        .onb-checklist-item--done {
          color: var(--text-primary);
        }
        .onb-checklist-item--skip {
          color: var(--text-muted);
        }
        .onb-checklist-item svg {
          flex-shrink: 0;
        }

        /* ── Tip ── */
        .onb-tip {
          font-size: 13px;
          color: var(--text-muted);
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md, 8px);
          padding: 10px 14px;
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          box-sizing: border-box;
          margin: 4px 0;
        }
        .onb-tip-icon {
          flex-shrink: 0;
          font-size: 16px;
        }
        .onb-kbd {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-overlay, #2a2a3a);
          border: 1px solid var(--border-normal);
          border-radius: 4px;
          padding: 1px 6px;
          font-size: 12px;
          font-family: monospace;
          color: var(--text-primary);
          line-height: 1.5;
        }

        /* ── Primary button ── */
        .onb-btn-primary {
          width: 100%;
          height: 42px;
          background: var(--accent);
          color: #fff;
          border: none;
          border-radius: 9999px;
          font-size: 15px;
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          margin-top: 8px;
          transition: opacity 150ms ease, transform 100ms ease;
          letter-spacing: 0.01em;
        }
        .onb-btn-primary:hover:not(:disabled) {
          opacity: 0.9;
          transform: translateY(-1px);
        }
        .onb-btn-primary:active:not(:disabled) {
          transform: translateY(0);
          opacity: 1;
        }
        .onb-btn-primary:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        /* ── Skip/back link ── */
        .onb-link {
          font-size: 13px;
          color: var(--text-muted);
          background: none;
          border: none;
          cursor: pointer;
          font-family: inherit;
          padding: 4px 8px;
          border-radius: var(--r-sm);
          transition: color 150ms ease;
          margin-top: -4px;
        }
        .onb-link:hover {
          color: var(--text-secondary);
        }

        /* ── Responsive ── */
        @media (max-width: 540px) {
          .onb-modal {
            padding: 28px 20px 24px;
          }
          .onb-title {
            font-size: 20px;
          }
          .onb-status-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="9" fill="var(--status-online, #3ba55d)" opacity="0.15" />
      <path d="M5 9l3 3 5-5" stroke="var(--status-online, #3ba55d)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="9" fill="var(--text-muted, #72767d)" opacity="0.12" />
      <path d="M6 9h6" stroke="var(--text-muted, #72767d)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
