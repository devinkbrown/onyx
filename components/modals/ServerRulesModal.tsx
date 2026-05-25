'use client';

import { useEffect } from 'react';
import { useOnyxStore } from '@/lib/store';

export default function ServerRulesModal() {
  const serverRules        = useOnyxStore(s => s.serverRules);
  const closeServerRulesModal = useOnyxStore(s => s.closeServerRulesModal);
  const client             = useOnyxStore(s => s.client);

  // Send RULES on mount if no rules loaded yet
  useEffect(() => {
    if (serverRules.length === 0 && client) {
      client.sendRaw('RULES');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="rules-modal"
      role="dialog"
      aria-modal
      aria-labelledby="rules-modal-title"
      onClick={e => { if (e.target === e.currentTarget) closeServerRulesModal(); }}
    >
      <div className="rules-card">
        <div className="rules-header">
          <span className="rules-title" id="rules-modal-title">Server Rules</span>
          <button
            className="rules-close-btn"
            onClick={closeServerRulesModal}
            aria-label="Close server rules"
          >
            ×
          </button>
        </div>

        <div className="rules-body">
          {serverRules.length === 0 ? (
            <p className="rules-loading">Loading rules&hellip;</p>
          ) : (
            serverRules.map((rule, i) => (
              <div key={i} className="rules-item">
                <span className="rules-num">{i + 1}.</span>
                <span className="rules-text">{rule}</span>
              </div>
            ))
          )}
        </div>

        <div className="rules-footer">
          <button className="rules-btn" onClick={closeServerRulesModal}>
            I understand
          </button>
        </div>
      </div>

      <style>{`
        .rules-modal {
          position: fixed;
          inset: 0;
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
        }

        .rules-card {
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xl, 16px);
          width: 500px;
          max-width: calc(100vw - 32px);
          max-height: 70vh;
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-xl);
          animation: rules-in 160ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }

        @keyframes rules-in {
          from { opacity: 0; transform: translateY(-10px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        .rules-header {
          padding: 20px 24px 14px;
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .rules-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
          flex: 1;
        }

        .rules-close-btn {
          width: 28px;
          height: 28px;
          border-radius: var(--r-sm, 4px);
          border: none;
          background: none;
          cursor: pointer;
          color: var(--text-muted);
          font-size: 20px;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color var(--t-fast), background var(--t-fast);
          flex-shrink: 0;
        }
        .rules-close-btn:hover {
          color: var(--text-primary);
          background: var(--bg-elevated);
        }

        .rules-body {
          padding: 16px 24px;
          overflow-y: auto;
          flex: 1;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }
        .rules-body::-webkit-scrollbar { width: 6px; }
        .rules-body::-webkit-scrollbar-thumb {
          background: var(--border-normal);
          border-radius: 3px;
        }

        .rules-loading {
          font-size: 13px;
          color: var(--text-muted);
          text-align: center;
          padding: 24px 0;
          margin: 0;
        }

        .rules-item {
          padding: 10px 0;
          border-bottom: 1px solid var(--border-subtle);
          line-height: 1.6;
          font-size: 13px;
          color: var(--text-secondary);
          display: flex;
          gap: 10px;
        }
        .rules-item:last-child { border-bottom: none; }

        .rules-num {
          font-weight: 700;
          color: var(--accent);
          flex-shrink: 0;
          width: 20px;
          font-variant-numeric: tabular-nums;
        }

        .rules-text {
          flex: 1;
          word-break: break-word;
        }

        .rules-footer {
          padding: 14px 24px;
          border-top: 1px solid var(--border-subtle);
          display: flex;
          justify-content: flex-end;
          flex-shrink: 0;
        }

        .rules-btn {
          padding: 8px 20px;
          border-radius: 8px;
          background: var(--accent);
          color: white;
          border: none;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          transition: opacity var(--t-fast);
        }
        .rules-btn:hover { opacity: 0.88; }
      `}</style>
    </div>
  );
}
