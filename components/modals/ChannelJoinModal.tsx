'use client';

import { useState, useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import ModalShell from './ModalShell';

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
    <ModalShell
      onClose={clearPrompt}
      title={isRetry ? `Join ${prompt.channel}` : 'Join a channel'}
      kicker="Channels"
      titleId="cjm-title"
      size="sm"
      footer={
        <>
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
        </>
      }
    >
      <div className="cjm-form">
        {errorText && <div className="cjm-error">{errorText}</div>}

        {!isRetry && (
          <div className="cjm-row">
            <div className="label-caps cjm-label">Channel name</div>
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

        <div className="cjm-row">
          <div className="label-caps cjm-label">
            Password {!isRetry && <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span>}
          </div>
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
      </div>

      <style>{`
        .cjm-form {
          display: flex;
          flex-direction: column;
          gap: var(--sp-4, 16px);
        }
        .cjm-error {
          font-size: var(--text-sm, 13px);
          color: var(--danger);
          background: var(--danger-subtle);
          border: 1px solid rgba(248,113,113,0.2);
          border-radius: var(--r-sm);
          padding: var(--sp-2, 8px) var(--sp-3, 12px);
        }
        .cjm-label {
          margin-bottom: var(--sp-2, 8px);
        }
        .cjm-input {
          width: 100%;
          height: 38px;
          background: var(--bg-void);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          padding: 0 var(--sp-3, 12px);
          color: var(--text-primary);
          font-size: var(--text-base, 14px);
          font-family: inherit;
          box-sizing: border-box;
          transition: border-color var(--t-control, 150ms), box-shadow var(--t-control, 150ms);
        }
        .cjm-input:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 2px var(--accent-glow);
        }
        .cjm-btn {
          border: none;
          border-radius: var(--r-md);
          padding: 9px 18px;
          font-size: var(--text-base, 14px);
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: background var(--t-control, 150ms), opacity var(--t-control, 150ms);
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
    </ModalShell>
  );
}
