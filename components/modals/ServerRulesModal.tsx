'use client';

import { useEffect } from 'react';
import { useOnyxStore } from '@/lib/store';
import ModalShell from './ModalShell';

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
    <ModalShell
      onClose={closeServerRulesModal}
      title="Server Rules"
      kicker="Conduct"
      titleId="rules-modal-title"
      size="sm"
      closeLabel="Close server rules"
      className="rules-card"
      footer={
        <button className="rules-btn" onClick={closeServerRulesModal}>
          I understand
        </button>
      }
    >
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

      <style>{`
        .rules-loading {
          font-size: var(--text-sm, 13px);
          color: var(--text-muted);
          text-align: center;
          padding: var(--sp-6, 24px) 0;
          margin: 0;
        }

        .rules-item {
          padding: var(--sp-3, 12px) 0;
          border-bottom: 1px solid var(--border-subtle);
          line-height: 1.6;
          font-size: var(--text-sm, 13px);
          color: var(--text-secondary);
          display: flex;
          gap: var(--sp-3, 12px);
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

        .rules-btn {
          padding: var(--sp-2, 8px) var(--sp-5, 20px);
          border-radius: var(--r-md, 8px);
          background: var(--accent);
          color: white;
          border: none;
          cursor: pointer;
          font-size: var(--text-sm, 13px);
          font-weight: 600;
          font-family: inherit;
          transition: opacity var(--t-control, 150ms);
        }
        .rules-btn:hover { opacity: 0.88; }
      `}</style>
    </ModalShell>
  );
}
