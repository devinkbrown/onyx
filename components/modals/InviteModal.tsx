'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';

// ── Invite link with expiry ───────────────────────────────────────────────────

type ExpiryOption = { label: string; seconds: number };

const EXPIRY_OPTIONS: ExpiryOption[] = [
  { label: '1 hour',  seconds: 3600 },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days',  seconds: 604800 },
];

function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'Expired';
  if (secondsLeft < 60)  return `${secondsLeft}s`;
  if (secondsLeft < 3600) {
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    return `${m}m ${s}s`;
  }
  const h = Math.floor(secondsLeft / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  return `${h}h ${m}m`;
}

interface InviteLinkBoxProps {
  value: string;
  expiresAt: number | null;
  onReset: () => void;
}

function InviteLinkBox({ value, expiresAt, onReset }: InviteLinkBoxProps) {
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(() =>
    expiresAt ? Math.max(0, Math.round((expiresAt - Date.now()) / 1000)) : 0
  );
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    const update = () => setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    update();
    countdownRef.current = setInterval(update, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [expiresAt]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  }, [value]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const expired = expiresAt !== null && secondsLeft <= 0;

  return (
    <div className="inv-link-box">
      <div className="inv-copy-row">
        <pre className="inv-pre">{expired ? '(Invite link expired)' : value}</pre>
        {!expired && (
          <button
            className={`inv-copy-btn ${copied ? 'inv-copy-btn--copied' : ''}`}
            onClick={handleCopy}
            aria-label="Copy invite link"
          >
            {copied ? '✓ Copied!' : 'Copy'}
          </button>
        )}
      </div>
      {expiresAt !== null && (
        <div className={`inv-expiry-row ${expired ? 'inv-expiry-row--expired' : ''}`}>
          {expired ? (
            <>
              <span className="inv-expiry-label">Link expired</span>
              <button className="inv-regen-btn" onClick={onReset}>Generate new</button>
            </>
          ) : (
            <>
              <span className="inv-expiry-label">Expires in</span>
              <span className="inv-countdown">{formatCountdown(secondsLeft)}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CopyableBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently degrade
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="inv-field">
      <span className="inv-field-label">{label}</span>
      <div className="inv-copy-row">
        <pre className="inv-pre">{value}</pre>
        <button
          className={`inv-copy-btn ${copied ? 'inv-copy-btn--copied' : ''}`}
          onClick={handleCopy}
          aria-label={`Copy ${label}`}
        >
          {copied ? '✓ Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export default function InviteModal() {
  const closeInviteModal = useOnyxStore(s => s.closeInviteModal);
  const activeView       = useOnyxStore(s => s.activeView);
  const channels         = useOnyxStore(s => s.channels);
  const channelProps     = useOnyxStore(s => s.channelProps);

  const channelName = activeView.kind === 'channel' ? activeView.channel : '';
  const channel     = channels.get(channelName.toLowerCase());
  const props       = channelProps.get(channelName.toLowerCase()) ?? {};

  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'ocean.chat';

  const hasKey  = channel?.modes?.includes('k') ?? false;
  const keyValue = props['KEY'] ?? props['key'] ?? null;

  const shareText = [
    `Join me in ${channelName} on Ocean`,
    `Server: ${hostname}`,
    `Channel: ${channelName}`,
  ].join('\n');

  const ircCommand = `/server ${hostname} then /join ${channelName}`;

  // ── Expiry link state ────────────────────────────────────────────────────────
  const [expiryIdx,    setExpiryIdx]    = useState(0);
  const [inviteLink,   setInviteLink]   = useState<string | null>(null);
  const [expiresAt,    setExpiresAt]    = useState<number | null>(null);

  const generateLink = useCallback(() => {
    const token = Math.random().toString(36).slice(2, 10).toUpperCase();
    const link = `${typeof window !== 'undefined' ? window.location.origin : 'https://ocean.chat'}/join/${encodeURIComponent(channelName)}?t=${token}`;
    const ttl = EXPIRY_OPTIONS[expiryIdx].seconds * 1000;
    setInviteLink(link);
    setExpiresAt(Date.now() + ttl);
  }, [channelName, expiryIdx]);

  const resetLink = useCallback(() => {
    setInviteLink(null);
    setExpiresAt(null);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeInviteModal();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeInviteModal]);

  if (!channelName) return null;

  return (
    <div className="inv-overlay" role="dialog" aria-modal aria-label={`Invite to ${channelName}`}>
      <div className="inv-modal">
        {/* Header */}
        <div className="inv-header">
          <div className="inv-title-row">
            <LinkIcon />
            <h2 className="inv-title">Invite to {channelName}</h2>
          </div>
          <button
            className="inv-close"
            onClick={closeInviteModal}
            aria-label="Close invite modal"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="inv-body">
          <CopyableBox label="Share text" value={shareText} />
          <CopyableBox label="IRC command" value={ircCommand} />

          {/* ── Invite link with expiry ── */}
          <div className="inv-field">
            <span className="inv-field-label">Invite link</span>
            {inviteLink ? (
              <InviteLinkBox value={inviteLink} expiresAt={expiresAt} onReset={resetLink} />
            ) : (
              <div className="inv-gen-row">
                <div className="inv-expiry-select">
                  {EXPIRY_OPTIONS.map((opt, i) => (
                    <button
                      key={opt.label}
                      className={`inv-expiry-btn ${expiryIdx === i ? 'inv-expiry-btn--active' : ''}`}
                      onClick={() => setExpiryIdx(i)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <button className="inv-gen-btn" onClick={generateLink}>
                  Generate link
                </button>
              </div>
            )}
          </div>

          {hasKey && (
            <div className="inv-key-warning">
              <KeyIcon />
              <div className="inv-key-text">
                <span className="inv-key-title">This channel requires a password (invite key)</span>
                {keyValue && (
                  <span className="inv-key-value">Key: <code>{keyValue}</code></span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const LinkIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/>
    <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243L6.586 4.672z"/>
  </svg>
);

const KeyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M0 8a4 4 0 0 1 7.465-2H14a.5.5 0 0 1 .354.146l1.5 1.5a.5.5 0 0 1 0 .708l-1.5 1.5a.5.5 0 0 1-.708 0L13 9.207l-.646.647a.5.5 0 0 1-.708 0L11 9.207l-.646.647a.5.5 0 0 1-.708 0L9 9.207l-.646.647A.5.5 0 0 1 8 10h-.535A4 4 0 0 1 0 8zm4-3a3 3 0 1 0 2.712 4.285A.5.5 0 0 1 7.163 9h.63l.853-.854a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.793-.793-1-1h-6.63a.5.5 0 0 1-.451-.285A3 3 0 0 0 4 5z"/>
    <path d="M4 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
  </svg>
);

const styles = `
  .inv-overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(3px);
    animation: inv-fade-in 150ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
  }

  @keyframes inv-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .inv-modal {
    width: 440px;
    max-width: calc(100vw - 32px);
    background: var(--bg-deep);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-xl, 16px);
    box-shadow: var(--shadow-xl, 0 24px 64px rgba(0,0,0,0.5));
    overflow: hidden;
    animation: inv-scale-in 160ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
  }

  @keyframes inv-scale-in {
    from { opacity: 0; transform: scale(0.95) translateY(4px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);   }
  }

  .inv-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 14px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .inv-title-row {
    display: flex;
    align-items: center;
    gap: 9px;
    color: var(--accent);
  }

  .inv-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
    line-height: 1.2;
  }

  .inv-close {
    width: 28px;
    height: 28px;
    border-radius: var(--r-sm, 6px);
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    transition: background var(--t-fast, 150ms), color var(--t-fast, 150ms);
    flex-shrink: 0;
  }
  .inv-close:hover {
    background: var(--ch-hover-bg, rgba(255,255,255,0.06));
    color: var(--text-primary);
  }

  .inv-body {
    padding: 18px 20px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .inv-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .inv-field-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .inv-copy-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: var(--bg-void, #0d0f14);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-md, 8px);
    overflow: hidden;
  }

  .inv-pre {
    flex: 1;
    margin: 0;
    padding: 10px 12px;
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-all;
    background: transparent;
    overflow: hidden;
  }

  .inv-copy-btn {
    flex-shrink: 0;
    align-self: stretch;
    padding: 0 14px;
    border: none;
    border-left: 1px solid var(--border-subtle);
    background: var(--bg-elevated, rgba(255,255,255,0.04));
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--t-fast, 150ms), color var(--t-fast, 150ms);
    font-family: inherit;
    min-width: 80px;
    text-align: center;
  }
  .inv-copy-btn:hover {
    background: var(--bg-float, rgba(255,255,255,0.08));
    color: var(--text-primary);
  }
  .inv-copy-btn--copied {
    color: var(--status-online, #3dd68c);
    background: rgba(61, 214, 140, 0.08);
  }
  .inv-copy-btn--copied:hover {
    color: var(--status-online, #3dd68c);
    background: rgba(61, 214, 140, 0.12);
  }

  .inv-key-warning {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    background: rgba(232, 184, 75, 0.08);
    border: 1px solid rgba(232, 184, 75, 0.25);
    border-radius: var(--r-md, 8px);
    color: var(--gold, #e8b84b);
  }

  .inv-key-warning svg {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .inv-key-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .inv-key-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--gold, #e8b84b);
  }

  .inv-key-value {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .inv-key-value code {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    background: var(--bg-elevated, rgba(255,255,255,0.06));
    padding: 1px 5px;
    border-radius: 4px;
    border: 1px solid var(--border-subtle);
    font-size: 12px;
    color: var(--text-primary);
  }

  /* ── Invite link with expiry ── */
  .inv-link-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .inv-expiry-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    background: rgba(124,90,245,0.07);
    border-radius: 6px;
    border: 1px solid var(--accent-border, rgba(124,90,245,0.3));
  }
  .inv-expiry-row--expired {
    background: rgba(240,71,71,0.07);
    border-color: rgba(240,71,71,0.3);
  }
  .inv-expiry-label {
    font-size: 11.5px;
    color: var(--text-muted);
    font-weight: 500;
  }
  .inv-countdown {
    font-size: 12px;
    font-weight: 700;
    color: var(--accent);
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    margin-left: auto;
  }
  .inv-regen-btn {
    margin-left: auto;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--border-normal);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: 11.5px;
    cursor: pointer;
    font-family: inherit;
    transition: background 150ms, color 150ms;
  }
  .inv-regen-btn:hover { background: var(--bg-float); color: var(--text-primary); }

  .inv-gen-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .inv-expiry-select {
    display: flex;
    gap: 5px;
  }
  .inv-expiry-btn {
    flex: 1;
    padding: 5px 8px;
    border-radius: 20px;
    border: 1px solid var(--border-normal);
    background: var(--bg-elevated);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: background 150ms, border-color 150ms, color 150ms;
  }
  .inv-expiry-btn:hover { border-color: var(--accent-border); color: var(--text-secondary); }
  .inv-expiry-btn--active {
    border-color: var(--accent);
    background: var(--accent-subtle);
    color: var(--accent);
    font-weight: 600;
  }
  .inv-gen-btn {
    align-self: flex-start;
    padding: 7px 14px;
    border-radius: 8px;
    border: none;
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: opacity 150ms;
  }
  .inv-gen-btn:hover { opacity: 0.85; }
`;
