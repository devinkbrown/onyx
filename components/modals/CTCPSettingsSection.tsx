'use client';

import { useState } from 'react';
import { useOnyxStore } from '@/lib/store';

const VERSION_PRESETS = [
  'Ocean IRC Client',
  'mIRC 7.72',
  'HexChat 2.16',
  'Hidden',
];

export default function CTCPSettingsSection() {
  const ctcpEnabled        = useOnyxStore(s => s.ctcpEnabled);
  const ctcpVersionReply   = useOnyxStore(s => s.ctcpVersionReply);
  const ctcpTimeEnabled    = useOnyxStore(s => s.ctcpTimeEnabled);
  const ctcpPingEnabled    = useOnyxStore(s => s.ctcpPingEnabled);
  const setCTCPEnabled     = useOnyxStore(s => s.setCTCPEnabled);
  const setCTCPVersionReply = useOnyxStore(s => s.setCTCPVersionReply);
  const setCTCPTimeEnabled = useOnyxStore(s => s.setCTCPTimeEnabled);
  const setCTCPPingEnabled = useOnyxStore(s => s.setCTCPPingEnabled);

  const [versionInput, setVersionInput] = useState(ctcpVersionReply);

  const handleVersionBlur = () => {
    const trimmed = versionInput.trim().slice(0, 80);
    if (trimmed) {
      setCTCPVersionReply(trimmed);
      setVersionInput(trimmed);
    } else {
      setVersionInput(ctcpVersionReply);
    }
  };

  const handlePreset = (preset: string) => {
    setVersionInput(preset);
    setCTCPVersionReply(preset);
  };

  return (
    <div className="ctcp-section">
      {/* Section header */}
      <div className="ctcp-header">
        <div className="ctcp-header-title">
          <span className="ctcp-header-icon" aria-hidden>&#x1F527;</span>
          CTCP Settings
        </div>
        <p className="ctcp-header-sub">
          Control how Ocean responds to CTCP requests from other IRC users
        </p>
      </div>

      {/* Master toggle */}
      <div className="ctcp-row ctcp-row--master">
        <div className="ctcp-row-text">
          <div className="ctcp-row-label">Enable CTCP responses</div>
          <div className="ctcp-row-desc">
            Allow the client to respond to CTCP queries from other users
          </div>
        </div>
        <button
          role="switch"
          aria-checked={ctcpEnabled}
          className={`ctcp-toggle${ctcpEnabled ? ' ctcp-toggle--on' : ''}`}
          onClick={() => setCTCPEnabled(!ctcpEnabled)}
          aria-label="Enable CTCP responses"
        >
          <span className="ctcp-toggle-thumb" aria-hidden />
        </button>
      </div>

      {!ctcpEnabled && (
        <div className="ctcp-warning" role="alert">
          <span className="ctcp-warning-icon" aria-hidden>&#x26A0;</span>
          Other users will not receive responses to CTCP queries
        </div>
      )}

      {/* Subsection — grayed when master disabled */}
      <div className={`ctcp-subsection${!ctcpEnabled ? ' ctcp-subsection--disabled' : ''}`}>
        {/* VERSION reply */}
        <div className="ctcp-field-group">
          <label className="ctcp-field-label" htmlFor="ctcp-version-input">
            Client version string
          </label>
          <p className="ctcp-field-hint">Sent in reply to /CTCP VERSION requests</p>
          <input
            id="ctcp-version-input"
            className="ctcp-input"
            type="text"
            maxLength={80}
            placeholder="Ocean IRC Client"
            value={versionInput}
            disabled={!ctcpEnabled}
            onChange={e => setVersionInput(e.target.value)}
            onBlur={handleVersionBlur}
            aria-label="CTCP VERSION reply string"
          />
          <div className="ctcp-presets" role="group" aria-label="Version presets">
            {VERSION_PRESETS.map(preset => (
              <button
                key={preset}
                className={`ctcp-preset-btn${versionInput === preset ? ' ctcp-preset-btn--active' : ''}`}
                onClick={() => handlePreset(preset)}
                disabled={!ctcpEnabled}
                aria-pressed={versionInput === preset}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* TIME toggle */}
        <div className="ctcp-row">
          <div className="ctcp-row-text">
            <div className="ctcp-row-label">Respond to /CTCP TIME requests</div>
            <div className="ctcp-row-desc">
              Reply with your current local time when queried
            </div>
          </div>
          <button
            role="switch"
            aria-checked={ctcpTimeEnabled}
            className={`ctcp-toggle${ctcpTimeEnabled ? ' ctcp-toggle--on' : ''}`}
            onClick={() => setCTCPTimeEnabled(!ctcpTimeEnabled)}
            disabled={!ctcpEnabled}
            aria-label="Respond to CTCP TIME"
          >
            <span className="ctcp-toggle-thumb" aria-hidden />
          </button>
        </div>

        {/* PING toggle */}
        <div className="ctcp-row">
          <div className="ctcp-row-text">
            <div className="ctcp-row-label">Respond to /CTCP PING requests</div>
            <div className="ctcp-row-desc">
              Reply to PING queries — disabling this may cause some clients to
              report you as having high latency
            </div>
          </div>
          <button
            role="switch"
            aria-checked={ctcpPingEnabled}
            className={`ctcp-toggle${ctcpPingEnabled ? ' ctcp-toggle--on' : ''}`}
            onClick={() => setCTCPPingEnabled(!ctcpPingEnabled)}
            disabled={!ctcpEnabled}
            aria-label="Respond to CTCP PING"
          >
            <span className="ctcp-toggle-thumb" aria-hidden />
          </button>
        </div>
      </div>

      <style>{`
        .ctcp-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .ctcp-header {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ctcp-header-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--text-secondary);
        }
        .ctcp-header-icon {
          font-size: 13px;
        }
        .ctcp-header-sub {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .ctcp-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          background: var(--bg-elevated);
          border-radius: var(--r-md);
          border: 1px solid var(--border-normal);
        }
        .ctcp-row--master {
          border-color: var(--border-normal);
        }
        .ctcp-row-text { flex: 1; min-width: 0; }
        .ctcp-row-label {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .ctcp-row-desc {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 2px;
          line-height: 1.4;
        }

        .ctcp-toggle {
          width: 42px; height: 24px;
          border-radius: 999px; border: none;
          background: var(--bg-overlay);
          cursor: pointer; position: relative;
          transition: background 150ms; flex-shrink: 0; padding: 0;
        }
        .ctcp-toggle--on { background: var(--accent); }
        .ctcp-toggle-thumb {
          position: absolute; top: 3px; left: 3px;
          width: 18px; height: 18px; border-radius: 50%;
          background: #fff; transition: transform 150ms; display: block;
        }
        .ctcp-toggle--on .ctcp-toggle-thumb { transform: translateX(18px); }
        .ctcp-toggle:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .ctcp-warning {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: rgba(224,84,84,0.08);
          border: 1px solid rgba(224,84,84,0.25);
          border-radius: var(--r-md);
          font-size: 13px;
          color: #e05454;
        }
        .ctcp-warning-icon { font-size: 15px; flex-shrink: 0; }

        .ctcp-subsection {
          display: flex;
          flex-direction: column;
          gap: 8px;
          transition: opacity 150ms;
        }
        .ctcp-subsection--disabled {
          opacity: 0.45;
          pointer-events: none;
        }

        .ctcp-field-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 12px 14px;
          background: var(--bg-elevated);
          border-radius: var(--r-md);
          border: 1px solid var(--border-normal);
        }
        .ctcp-field-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .ctcp-field-hint {
          font-size: 12px;
          color: var(--text-muted);
          margin: 0;
        }

        .ctcp-input {
          width: 100%;
          padding: 8px 12px;
          border-radius: var(--r-md);
          background: var(--bg-void);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          box-sizing: border-box;
          transition: border-color 120ms;
        }
        .ctcp-input:focus {
          outline: none;
          border-color: var(--accent-border);
        }
        .ctcp-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .ctcp-presets {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 2px;
        }
        .ctcp-preset-btn {
          padding: 4px 12px;
          border-radius: var(--r-sm);
          border: 1px solid var(--border-subtle);
          background: var(--bg-void);
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          font-family: inherit;
          transition: border-color 100ms, background 100ms, color 100ms;
        }
        .ctcp-preset-btn:hover {
          border-color: var(--accent-border);
          color: var(--text-primary);
        }
        .ctcp-preset-btn--active {
          border-color: var(--accent);
          background: var(--accent-subtle);
          color: var(--accent);
        }
        .ctcp-preset-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
