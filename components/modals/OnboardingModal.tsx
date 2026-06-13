'use client';

import { useState, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';
import { useDialogFocus } from './useDialogFocus';

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

  const modalRef = useRef<HTMLDivElement>(null);
  useDialogFocus(modalRef);

  // Step 1 local state
  const [bio, setBio] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);

  // Step 2 local state
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [channelsJoined, setChannelsJoined] = useState(false);

  const TOTAL_STEPS = 4;

  function handleSaveProfile() {
    if (isIRCX && bio.trim()) {
      // OCEAN-INTEGRATION: Serial integration wires this event to profile metadata persistence.
      window.dispatchEvent(new CustomEvent('ocean:metadata-set', {
        detail: { bio: bio.trim() },
      }));
      client?.sendRaw('PROP', '*', 'BIO', bio.trim());
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
    <div className="onb-backdrop">
      <div className="onb-modal" ref={modalRef} role="dialog" aria-modal="true" aria-label="Welcome to Ocean">

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
            <div className="onb-hero-mark" aria-hidden="true"><OceanMark /></div>
            <h2 className="onb-title">Welcome to Ocean</h2>
            <p className="onb-subtitle">Connected to <strong>{serverUrl}</strong></p>
            <p className="onb-body">
              Ocean is a modern chat client powered by the Orochi IRC engine.
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
            <div className="onb-hero-mark onb-hero-mark--celebrate" aria-hidden="true"><CheckIcon /></div>
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
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          animation: onb-backdrop-in 220ms ease both;
        }

        .onb-modal {
          width: 100%;
          max-width: 480px;
          background:
            linear-gradient(180deg, var(--elev-tint-2, transparent), transparent 42%),
            var(--bg-2, var(--bg-elevated));
          border: 0;
          border-radius: var(--r-2xl, 20px) var(--r-md, 8px) var(--r-lg, 12px) var(--r-sm, 6px);
          box-shadow: var(--elev-highlight), var(--elev-shadow-3);
          padding: 36px 32px 32px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
          animation: onb-fade-in 180ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
        }

        /* ── Progress dots ── */
        .onb-dots {
          display: flex;
          gap: 8px;
          margin-bottom: 28px;
          align-items: center;
        }
        .onb-dot {
          width: 7px;
          height: 7px;
          border-radius: 9999px;
          background: var(--bg-overlay);
          transition: background 220ms ease, width 220ms ease, transform 220ms ease;
        }
        .onb-dot--active {
          background: var(--lux);
          width: 22px;
          transform: none;
        }
        .onb-dot--done {
          background: color-mix(in srgb, var(--lux) 45%, transparent);
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

        /* ── Hero mark ── */
        .onb-hero-mark {
          width: 68px;
          height: 68px;
          display: grid;
          place-items: center;
          border-radius: var(--r-2xl, 20px) var(--r-md, 8px) var(--r-lg, 12px) var(--r-sm, 6px);
          background:
            linear-gradient(180deg, rgba(255,255,255,.045), transparent),
            color-mix(in srgb, var(--bg-elevated) 88%, var(--lux) 12%);
          color: var(--lux);
          box-shadow: var(--elev-highlight), var(--elev-shadow-2);
          margin-bottom: 4px;
        }
        .onb-hero-mark svg {
          width: 36px;
          height: 36px;
        }
        .onb-hero-mark--celebrate {
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
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .onb-textarea {
          width: 100%;
          box-sizing: border-box;
          background: color-mix(in srgb, var(--bg-base) 94%, var(--lux) 6%);
          border: 0;
          border-radius: var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px) var(--r-lg, 12px);
          color: var(--text-primary);
          caret-color: var(--lux);
          font-size: 14px;
          font-family: inherit;
          padding: 10px 12px;
          resize: none;
          line-height: 1.5;
          transition: border-color 150ms ease, box-shadow 150ms ease;
          outline: none;
        }
        .onb-textarea:focus {
          box-shadow: inset 0 0 0 1px var(--lux);
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
          border-radius: var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px) var(--r-xs, 4px);
          background: var(--bg-deep);
          border: 0;
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
          border-color: var(--accent-border);
          color: var(--text-primary);
        }
        .onb-status-option--active {
          background: var(--accent-subtle);
          color: var(--text-primary);
          box-shadow: inset 2px 0 0 var(--lux), var(--elev-shadow-1);
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
          border-radius: var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px) var(--r-xs, 4px);
          background: var(--bg-deep);
          border: 0;
          cursor: pointer;
          transition: background 150ms ease, border-color 150ms ease;
        }
        .onb-channel-item:has(.onb-checkbox:checked) {
          background: var(--accent-subtle);
          box-shadow: inset 2px 0 0 var(--lux), var(--elev-shadow-1);
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
          background: color-mix(in srgb, var(--bg-base) 94%, var(--lux) 6%);
          border: 0;
          border-radius: var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px) var(--r-xs, 4px);
          padding: 10px 14px;
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          box-sizing: border-box;
          margin: 4px 0;
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
          height: 40px;
          background: color-mix(in srgb, var(--accent) 88%, black 12%);
          color: #fff;
          border: none;
          border-radius: var(--r-md, 8px) var(--r-lg, 12px) var(--r-sm, 6px) var(--r-md, 8px);
          font-size: 15px;
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          margin-top: 8px;
          transition: opacity 150ms ease, transform 100ms ease, filter 150ms ease;
          letter-spacing: 0.02em;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 16px 28px rgba(0,0,0,.28);
        }
        .onb-btn-primary:hover:not(:disabled) {
          filter: brightness(1.06);
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

function OceanMark() {
  return (
    <svg viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <circle cx="18" cy="18" r="13" stroke="currentColor" strokeOpacity=".42" strokeWidth="1.4" />
      <circle cx="18" cy="18" r="7" stroke="currentColor" strokeOpacity=".28" strokeWidth="1.4" />
      <path d="M18 18 26 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="18" cy="18" r="2.6" fill="currentColor" />
    </svg>
  );
}

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
