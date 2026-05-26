'use client';

import { useState, useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';

/**
 * ChannelJoinModal — shown when:
 * 1. A 475 ERR_BADCHANNELKEY is received (channel + error pre-filled, password required)
 * 2. The user types /join with no channel argument (channel is '', both inputs shown)
 */
export default function ChannelJoinModal() {
  const prompt             = useOnyxStore(s => s.channelJoinPrompt);
  const clearPrompt        = useOnyxStore(s => s.clearChannelJoinPrompt);
  const client             = useOnyxStore(s => s.client);

  // When channel is pre-set (from 475), we only need the password.
  // When channel is empty (from /join with no args), we show both fields.
  const isRetry = !!(prompt && prompt.channel);

  const [channelInput, setChannelInput] = useState('');
  const [password, setPassword]         = useState('');

  const passwordRef = useRef<HTMLInputElement>(null);
  const channelRef  = useRef<HTMLInputElement>(null);

  // Reset inputs when the prompt changes
  useEffect(() => {
    setPassword('');
    setChannelInput('');
  }, [prompt]);

  // Auto-focus the right field
  useEffect(() => {
    if (!prompt) return;
    if (isRetry) {
      passwordRef.current?.focus();
    } else {
      channelRef.current?.focus();
    }
  }, [prompt, isRetry]);

  // Dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearPrompt();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [clearPrompt]);

  if (!prompt) return null;

  const targetChannel = isRetry
    ? prompt.channel
    : (channelInput.startsWith('#') || channelInput.startsWith('&')
        ? channelInput
        : channelInput ? `#${channelInput}` : '');

  function handleJoin() {
    if (!targetChannel) return;
    if (client) {
      if (password) {
        client.sendRaw('JOIN', targetChannel, password);
      } else {
        client.sendRaw('JOIN', targetChannel);
      }
    }
    clearPrompt();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleJoin();
  }

  const errorText = prompt.error || '';

  return (
    <div className="cjm-overlay" role="dialog" aria-modal aria-labelledby="cjm-title">
      <div className="cjm-modal">
        <div className="cjm-title" id="cjm-title">
          🔑 {isRetry ? `Join ${prompt.channel}` : 'Join a channel'}
        </div>

        {errorText && <div className="cjm-error">{errorText}</div>}

        {!isRetry && (
          <div>
            <div className="cjm-label">Channel name</div>
            <input
              ref={channelRef}
              className="cjm-input"
              type="text"
              placeholder="#channel"
              value={channelInput}
              onChange={e => setChannelInput(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        <div style={{ marginTop: !isRetry ? 12 : 0 }}>
          <div className="cjm-label">Password {!isRetry && <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span>}</div>
          <input
            ref={passwordRef}
            className="cjm-input"
            type="password"
            placeholder="Channel password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="new-password"
          />
        </div>

        <div className="cjm-actions">
          <button className="cjm-btn cjm-btn--secondary" onClick={clearPrompt}>
            Cancel
          </button>
          <button
            className="cjm-btn cjm-btn--primary"
            onClick={handleJoin}
            disabled={!targetChannel}
          >
            Join
          </button>
        </div>
      </div>

      <style>{`
        .cjm-overlay {
          position: fixed;
          inset: 0;
          background: rgba(3, 8, 16, 0.75);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(6px);
          animation: cjmFadeIn 150ms var(--ease-out) both;
        }
        @keyframes cjmFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .cjm-modal {
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xl);
          padding: 24px;
          width: 400px;
          max-width: calc(100vw - 32px);
          box-shadow: var(--shadow-xl), 0 0 0 1px var(--accent-border);
          animation: cjmScaleIn 180ms var(--ease-out) both;
        }
        @keyframes cjmScaleIn {
          from { opacity: 0; transform: scale(0.95) translateY(4px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        .cjm-title {
          font-size: 17px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 16px;
          letter-spacing: -0.2px;
        }
        .cjm-error {
          font-size: 13px;
          color: var(--danger);
          background: var(--danger-subtle);
          border: 1px solid rgba(248,113,113,0.2);
          border-radius: var(--r-sm);
          padding: 8px 12px;
          margin-bottom: 14px;
          margin-top: -4px;
        }
        .cjm-label {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.07em;
          margin-bottom: 6px;
        }
        .cjm-input {
          width: 100%;
          height: 38px;
          background: var(--bg-void);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          padding: 0 12px;
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          box-sizing: border-box;
          transition: border-color var(--t-fast), box-shadow var(--t-fast);
        }
        .cjm-input:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 2px var(--accent-glow);
        }
        .cjm-actions {
          display: flex;
          gap: 8px;
          margin-top: 20px;
          justify-content: flex-end;
        }
        .cjm-btn {
          border: none;
          border-radius: var(--r-md);
          padding: 9px 18px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: background var(--t-fast), opacity var(--t-fast);
        }
        .cjm-btn--primary {
          background: var(--accent);
          color: #fff;
        }
        .cjm-btn--primary:hover:not(:disabled) {
          background: var(--accent-hover);
        }
        .cjm-btn--primary:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .cjm-btn--secondary {
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          color: var(--text-secondary);
        }
        .cjm-btn--secondary:hover {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }
      `}</style>
    </div>
  );
}
