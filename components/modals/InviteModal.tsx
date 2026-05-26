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
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(6px);
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
    box-shadow: var(--shadow-xl, 0 24px 64px rgba(0,0,0,0.5)), 0 0 0 1px var(--accent-border);
    overflow: hidden;
    animation: inv-scale-in 180ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
  }

  @keyframes inv-scale-in {
    from { opacity: 0; transform: scale(0.95) translateY(6px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);   }
  }

  .inv-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
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
    width: 30px;
    height: 30px;
    border-radius: var(--r-md, 8px);
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
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  /* ── Section dividers ── */
  .inv-field {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .inv-field-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .inv-copy-row {
    display: flex;
    align-items: stretch;
    background: var(--bg-void, #0d0f14);
    border: 1px solid var(--border-normal);
    border-radius: var(--r-md, 8px);
    overflow: hidden;
    transition: border-color var(--t-fast);
  }
  .inv-copy-row:hover {
    border-color: var(--accent-border);
  }

  .inv-pre {
    flex: 1;
    margin: 0;
    padding: 10px 13px;
    font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace);
    font-size: 12px;
    line-height: 1.65;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-all;
    background: transparent;
    overflow: hidden;
    letter-spacing: 0.01em;
  }

  .inv-copy-btn {
    flex-shrink: 0;
    align-self: stretch;
    padding: 0 16px;
    border: none;
    border-left: 1px solid var(--border-subtle);
    background: var(--bg-elevated, rgba(255,255,255,0.04));
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: background var(--t-fast, 150ms), color var(--t-fast, 150ms);
    font-family: inherit;
    min-width: 82px;
    text-align: center;
    letter-spacing: 0.02em;
  }
  .inv-copy-btn:hover {
    background: var(--bg-float, rgba(255,255,255,0.08));
    color: var(--text-primary);
  }
  .inv-copy-btn--copied {
    color: var(--status-online, #3dd68c);
    background: rgba(52, 211, 153, 0.08);
  }
  .inv-copy-btn--copied:hover {
    color: var(--status-online, #3dd68c);
    background: rgba(52, 211, 153, 0.13);
  }

  .inv-key-warning {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    background: var(--gold-subtle);
    border: 1px solid color-mix(in srgb, var(--gold) 30%, transparent);
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
    font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace);
    background: var(--bg-elevated, rgba(255,255,255,0.06));
    padding: 1px 6px;
    border-radius: var(--r-xs);
    border: 1px solid var(--border-subtle);
    font-size: 12px;
    color: var(--text-primary);
  }

  /* ── Invite link with expiry ── */
  .inv-link-box {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .inv-expiry-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--accent-subtle);
    border-radius: var(--r-sm);
    border: 1px solid var(--accent-border);
  }
  .inv-expiry-row--expired {
    background: var(--danger-subtle);
    border-color: rgba(248,113,113,0.25);
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
    font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace);
    margin-left: auto;
    letter-spacing: 0.03em;
  }
  .inv-regen-btn {
    margin-left: auto;
    padding: 2px 8px;
    border-radius: var(--r-xs);
    border: 1px solid var(--border-normal);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: 11.5px;
    cursor: pointer;
    font-family: inherit;
    transition: background var(--t-fast), color var(--t-fast);
  }
  .inv-regen-btn:hover { background: var(--bg-float); color: var(--text-primary); }

  .inv-gen-row {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .inv-expiry-select {
    display: flex;
    gap: 6px;
  }
  .inv-expiry-btn {
    flex: 1;
    padding: 5px 8px;
    border-radius: var(--r-full);
    border: 1px solid var(--border-normal);
    background: var(--bg-elevated);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
  }
  .inv-expiry-btn:hover { border-color: var(--accent-border); color: var(--text-secondary); background: var(--bg-float); }
  .inv-expiry-btn--active {
    border-color: var(--accent);
    background: var(--accent-subtle);
    color: var(--accent);
  }
  .inv-gen-btn {
    align-self: flex-start;
    padding: 8px 18px;
    border-radius: var(--r-md);
    border: none;
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    transition: background var(--t-fast);
    letter-spacing: 0.01em;
  }
  .inv-gen-btn:hover { background: var(--accent-hover); }
`;
