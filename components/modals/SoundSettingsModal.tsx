'use client';
import { useState, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import { testSound } from '@/hooks/useAudioNotifications';
import type { SoundId } from '@/lib/sounds';
import { useDialogFocus } from './useDialogFocus';

// ── Sound catalogue ────────────────────────────────────────────────────────

interface SoundEntry {
  id: SoundId;
  label: string;
  description: string;
}

const SOUND_CATALOGUE: SoundEntry[] = [
  { id: 'message',      label: 'Message',            description: 'Incoming message in active channel' },
  { id: 'mention',      label: 'Mention',             description: '@mention or highlight word' },
  { id: 'dm',           label: 'Direct Message',      description: 'New direct message received' },
  { id: 'join',         label: 'Channel Join',        description: 'Someone joins a channel' },
  { id: 'leave',        label: 'Channel Leave',       description: 'Someone parts or quits' },
  { id: 'send',         label: 'Send',                description: 'You send a message' },
  { id: 'connect',      label: 'Connected',           description: 'Successfully connected to server' },
  { id: 'disconnect',   label: 'Disconnected',        description: 'Lost connection to server' },
  { id: 'error',        label: 'Error',               description: 'Error or failure notification' },
  { id: 'pop',          label: 'Pop',                 description: 'Soft pop for reactions and quick actions' },
  { id: 'ding',         label: 'Ding',                description: 'Gentle ding for DMs received' },
  { id: 'voice_join',   label: 'Voice Join',          description: 'Someone joins a voice channel' },
  { id: 'voice_leave',  label: 'Voice Leave',         description: 'Someone leaves a voice channel' },
  { id: 'notification', label: 'Notification',        description: 'Generic OS-style alert' },
];

// ── Component ──────────────────────────────────────────────────────────────

export default function SoundSettingsModal() {
  const soundEnabled       = useOnyxStore(s => s.soundEnabled);
  const soundVolume        = useOnyxStore(s => s.soundVolume);
  const setSoundEnabled    = useOnyxStore(s => s.setSoundEnabled);
  const setSoundVolume     = useOnyxStore(s => s.setSoundVolume);
  const closeSoundSettings = useOnyxStore(s => s.closeSoundSettings);
  const pushEnabled        = useOnyxStore(s => s.pushNotificationsEnabled);
  const setPushEnabled     = useOnyxStore(s => s.setPushNotificationsEnabled);

  const [selectedSoundId, setSelectedSoundId] = useState<SoundId>('mention');

  const selectedEntry = SOUND_CATALOGUE.find(e => e.id === selectedSoundId) ?? SOUND_CATALOGUE[1];

  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef);

  return (
    <div className="ssm-backdrop" onClick={closeSoundSettings}>
      <div className="ssm-panel" ref={panelRef} onClick={e => e.stopPropagation()} role="dialog" aria-modal aria-labelledby="ssm-modal-title">

        <header className="ssm-header">
          <h2 id="ssm-modal-title" className="ssm-title">Sound Settings</h2>
          <button className="ssm-close" onClick={closeSoundSettings} aria-label="Close"><svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg></button>
        </header>

        {/* ── Master controls ── */}
        <section className="ssm-section">
          <div className="ssm-row">
            <span className="ssm-label">Enable sounds</span>
            <button
              className={`ssm-toggle ${soundEnabled ? 'ssm-toggle--on' : ''}`}
              role="switch"
              aria-checked={soundEnabled}
              onClick={() => setSoundEnabled(!soundEnabled)}
            >
              <span className="ssm-toggle-knob" />
            </button>
          </div>

          <div className="ssm-row ssm-row--col">
            <span className="ssm-label">Volume — {Math.round(soundVolume * 100)}%</span>
            <input
              type="range"
              className="ssm-slider"
              min={0}
              max={1}
              step={0.01}
              value={soundVolume}
              disabled={!soundEnabled}
              onChange={e => setSoundVolume(parseFloat(e.target.value))}
              aria-label="Notification volume"
            />
          </div>
        </section>

        {/* ── Push notifications ── */}
        <section className="ssm-section">
          <div className="ssm-row">
            <div className="ssm-label-group">
              <span className="ssm-label">Browser notifications</span>
              <span className="ssm-sublabel">Show OS notifications for mentions and DMs when this tab is not active</span>
            </div>
            <button
              className={`ssm-toggle ${pushEnabled ? 'ssm-toggle--on' : ''}`}
              role="switch"
              aria-checked={pushEnabled}
              onClick={() => setPushEnabled(!pushEnabled)}
            >
              <span className="ssm-toggle-knob" />
            </button>
          </div>

          {typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'denied' && (
            <p className="ssm-warning">
              Notifications are blocked in your browser settings. Enable them in your browser&rsquo;s site permissions to receive alerts.
            </p>
          )}
        </section>

        {/* ── Sound previews ── */}
        <section className="ssm-section">
          <p className="ssm-section-title">Sound Previews</p>

          <div className="ssm-preview-row">
            <div className="ssm-select-wrap">
              <select
                className="ssm-select"
                value={selectedSoundId}
                disabled={!soundEnabled}
                onChange={e => setSelectedSoundId(e.target.value as SoundId)}
                aria-label="Choose sound to preview"
              >
                {SOUND_CATALOGUE.map(entry => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="ssm-test-btn"
              disabled={!soundEnabled}
              onClick={() => testSound(selectedSoundId)}
              aria-label={`Preview ${selectedEntry.label} sound`}
            >
              ▶ Test
            </button>
          </div>

          {selectedEntry && (
            <p className="ssm-preview-desc">{selectedEntry.description}</p>
          )}
        </section>

        {/* ── When to play ── */}
        <section className="ssm-section">
          <p className="ssm-section-title">When to play</p>

          {([
            { label: 'On mentions',           always: true,  defaultChecked: true  },
            { label: 'On direct messages',    always: false, defaultChecked: true  },
            { label: 'On channel join/leave', always: false, defaultChecked: true  },
            { label: 'On all messages',       always: false, defaultChecked: false },
          ] as const).map(({ label, always, defaultChecked }) => (
            <label className="ssm-check-row" key={label}>
              <input
                type="checkbox"
                className="ssm-checkbox"
                defaultChecked={defaultChecked}
                disabled={always || !soundEnabled}
              />
              <span className="ssm-check-label">{label}{always ? ' (always)' : ''}</span>
            </label>
          ))}

          <label className="ssm-check-row ssm-check-row--disabled">
            <input type="checkbox" className="ssm-checkbox" disabled />
            <span className="ssm-check-label ssm-muted">Mute during screenshare / away (coming soon)</span>
          </label>
        </section>
      </div>

      <style>{`
        .ssm-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(3,8,16,0.72);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 900;
        }

        .ssm-panel {
          background: var(--bg-deep, #06101d);
          border: 1px solid var(--border-normal, rgba(14,165,233,0.18));
          border-radius: 14px;
          width: min(440px, 94vw);
          box-shadow: 0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px var(--border-subtle, rgba(14,165,233,0.07));
          overflow: hidden;
        }

        .ssm-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 24px 16px;
          border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
        }

        .ssm-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary, #e2eaf4);
          margin: 0;
          letter-spacing: -0.01em;
        }

        .ssm-close {
          background: none;
          border: none;
          color: var(--text-muted, rgba(226,234,244,0.4));
          font-size: 16px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
          line-height: 1;
          transition: color 150ms, background 150ms;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .ssm-close:hover {
          color: var(--text-primary, #e2eaf4);
          background: rgba(255,255,255,0.07);
        }

        .ssm-section {
          padding: 16px 24px;
          border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.05));
        }
        .ssm-section:last-child { border-bottom: none; }

        .ssm-section-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-muted, rgba(226,234,244,0.4));
          margin: 0 0 12px;
        }

        .ssm-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-height: 36px;
        }
        .ssm-row--col {
          flex-direction: column;
          align-items: flex-start;
        }
        .ssm-row + .ssm-row { margin-top: 4px; }

        .ssm-label {
          font-size: 13.5px;
          color: var(--text-primary, rgba(226,234,244,0.85));
          font-weight: 500;
        }

        /* Toggle switch */
        .ssm-toggle {
          position: relative;
          width: 44px;
          height: 24px;
          border-radius: 12px;
          background: var(--border-normal, rgba(255,255,255,0.12));
          border: none;
          cursor: pointer;
          transition: background 200ms;
          flex-shrink: 0;
          padding: 0;
        }
        .ssm-toggle--on { background: var(--accent, #0ea5e9); }
        .ssm-toggle-knob {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
          transition: transform 200ms cubic-bezier(0.16,1,0.3,1);
        }
        .ssm-toggle--on .ssm-toggle-knob { transform: translateX(20px); }

        /* Slider */
        .ssm-slider {
          width: 100%;
          accent-color: var(--accent, #0ea5e9);
          margin-top: 8px;
          cursor: pointer;
          height: 4px;
        }
        .ssm-slider:disabled { opacity: 0.35; cursor: not-allowed; }

        /* Sound preview row */
        .ssm-preview-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .ssm-select-wrap {
          flex: 1;
          min-width: 0;
          position: relative;
        }

        .ssm-select {
          width: 100%;
          appearance: none;
          background: var(--bg-elevated, rgba(255,255,255,0.06));
          border: 1px solid var(--border-normal, rgba(255,255,255,0.12));
          border-radius: 7px;
          color: var(--text-primary, rgba(226,234,244,0.9));
          font-size: 13px;
          padding: 7px 30px 7px 10px;
          cursor: pointer;
          outline: none;
          transition: border-color 150ms, background 150ms;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='rgba(226,234,244,0.45)' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
          font-family: inherit;
        }
        .ssm-select:focus {
          border-color: var(--accent-border, rgba(14,165,233,0.4));
          box-shadow: 0 0 0 2px var(--accent-subtle, rgba(14,165,233,0.1));
        }
        .ssm-select:disabled { opacity: 0.35; cursor: not-allowed; }
        .ssm-select option { background: var(--bg-deep, #0d1b2a); color: var(--text-primary, #e2eaf4); }

        .ssm-preview-desc {
          margin: 8px 0 0;
          font-size: 11px;
          color: var(--text-muted, rgba(226,234,244,0.4));
          font-style: italic;
          line-height: 1.4;
        }

        /* Test button */
        .ssm-test-btn {
          background: var(--accent-subtle, rgba(14,165,233,0.1));
          border: 1px solid var(--accent-border, rgba(14,165,233,0.28));
          color: var(--accent, #0ea5e9);
          font-size: 12.5px;
          font-weight: 700;
          padding: 7px 14px;
          border-radius: 7px;
          cursor: pointer;
          transition: background 150ms, border-color 150ms, box-shadow 150ms;
          white-space: nowrap;
          flex-shrink: 0;
          letter-spacing: 0.01em;
        }
        .ssm-test-btn:hover:not(:disabled) {
          background: var(--accent-glow, rgba(14,165,233,0.18));
          border-color: var(--accent, #0ea5e9);
          box-shadow: 0 0 12px var(--accent-glow, rgba(14,165,233,0.2));
        }
        .ssm-test-btn:disabled { opacity: 0.35; cursor: not-allowed; }

        /* Checkboxes */
        .ssm-check-row {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 32px;
          cursor: pointer;
          padding: 2px 4px;
          border-radius: var(--r-xs, 3px);
          transition: background 80ms;
        }
        .ssm-check-row:not(.ssm-check-row--disabled):hover {
          background: rgba(255,255,255,0.03);
        }
        .ssm-check-row--disabled { cursor: default; }
        .ssm-check-row + .ssm-check-row { margin-top: 1px; }

        .ssm-checkbox {
          width: 16px;
          height: 16px;
          accent-color: var(--accent, #0ea5e9);
          flex-shrink: 0;
          cursor: inherit;
        }
        .ssm-checkbox:disabled { cursor: not-allowed; opacity: 0.4; }

        .ssm-check-label {
          font-size: 13px;
          color: var(--text-secondary, rgba(226,234,244,0.8));
        }
        .ssm-muted { color: var(--text-muted, rgba(226,234,244,0.35)); font-style: italic; }

        /* Label group (label + subtitle stacked) */
        .ssm-label-group {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }

        .ssm-sublabel {
          font-size: 11px;
          color: rgba(226,234,244,0.45);
          line-height: 1.4;
        }

        /* Blocked-permission warning */
        .ssm-warning {
          margin: 8px 0 0;
          padding: 8px 10px;
          border-radius: 6px;
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.25);
          font-size: 12px;
          color: rgba(239,68,68,0.9);
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
}
