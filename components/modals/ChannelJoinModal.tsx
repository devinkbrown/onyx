'use client';

import { useState, useEffect, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import ModalShell from './ModalShell';
import Button from '@/components/ui/Button';
import FormField from '@/components/ui/FormField';

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
          <Button variant="ghost" onClick={clearPrompt}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleJoin} disabled={!targetChannel}>
            Join channel
          </Button>
        </>
      }
    >
      <div className="cjm-form">
        {errorText && (
          <div className="cjm-error" role="alert">
            <span className="cjm-error-mark" aria-hidden>!</span>
            <span>{errorText}</span>
          </div>
        )}

        {!isRetry && (
          <FormField label="Channel name" hint="Joins as a public channel unless you prefix with &.">
            <input
              ref={channelRef}
              type="text"
              placeholder="#channel"
              value={channelInput}
              onChange={e => setChannelInput(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
        )}

        <FormField
          label={isRetry ? 'Channel password' : 'Password (optional)'}
          hint={isRetry ? 'This channel is protected with a key (+k).' : undefined}
        >
          <input
            ref={passwordRef}
            type="password"
            placeholder="Channel password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="new-password"
          />
        </FormField>
      </div>

      <style>{`
        .cjm-form {
          display: flex;
          flex-direction: column;
          gap: var(--sp-4, 16px);
        }
        .cjm-error {
          display: flex;
          align-items: center;
          gap: var(--sp-2, 8px);
          font-size: var(--text-sm, 13px);
          line-height: 1.45;
          color: var(--danger);
          background: var(--danger-subtle);
          border: 1px solid color-mix(in srgb, var(--danger) 24%, transparent);
          border-radius: var(--r-sm, 6px) var(--r-md, 8px) var(--r-sm, 6px) var(--r-md, 8px);
          padding: var(--sp-2, 8px) var(--sp-3, 12px);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
        }
        .cjm-error-mark {
          flex-shrink: 0;
          width: 18px;
          height: 18px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          font-size: var(--text-xs, 12px);
          font-weight: 800;
          line-height: 1;
          color: var(--danger);
          background: color-mix(in srgb, var(--danger) 18%, transparent);
        }
      `}</style>
    </ModalShell>
  );
}
