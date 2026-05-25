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
          background: rgba(3, 8, 16, 0.7);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(2px);
        }
        .cjm-modal {
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xl);
          padding: 24px;
          width: 360px;
          box-shadow: var(--shadow-xl);
          animation: cjmScaleIn 150ms var(--ease-out) both;
        }
        @keyframes cjmScaleIn {
          from { opacity: 0; transform: scale(0.94); }
          to   { opacity: 1; transform: scale(1); }
        }
        .cjm-title {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 4px;
        }
        .cjm-error {
          font-size: 13px;
          color: var(--danger);
          margin-bottom: 12px;
          margin-top: 4px;
        }
        .cjm-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 6px;
        }
        .cjm-input {
          width: 100%;
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          padding: 8px 12px;
          color: var(--text-primary);
          font-size: 14px;
          box-sizing: border-box;
        }
        .cjm-input:focus {
          outline: none;
          border-color: var(--accent);
        }
        .cjm-actions {
          display: flex;
          gap: 8px;
          margin-top: 16px;
          justify-content: flex-end;
        }
        .cjm-btn {
          border: none;
          border-radius: var(--r-sm);
          padding: 8px 16px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: background 120ms ease;
        }
        .cjm-btn--primary {
          background: var(--accent);
          color: #fff;
        }
        .cjm-btn--primary:hover:not(:disabled) {
          background: var(--accent-hover);
        }
        .cjm-btn--primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .cjm-btn--secondary {
          background: var(--bg-float);
          color: var(--text-secondary);
        }
        .cjm-btn--secondary:hover {
          background: var(--bg-overlay);
        }
      `}</style>
    </div>
  );
}
