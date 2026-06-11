'use client';

import { useOnyxStore } from '@/lib/store';
import ModalShell from './ModalShell';

// ── Key chip helpers ──────────────────────────────────────────────────────────

function Keys({ children }: { children: React.ReactNode }) {
  return <div className="ks-keys">{children}</div>;
}

function K({ children }: { children: React.ReactNode }) {
  return <kbd className="ks-kbd">{children}</kbd>;
}

function Sep() {
  return <span className="ks-sep">+</span>;
}

function Combo({ parts }: { parts: string[] }) {
  return (
    <Keys>
      {parts.map((p, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <Sep />}
          <K>{p}</K>
        </span>
      ))}
    </Keys>
  );
}

function Alt() {
  return <K>Alt</K>;
}

// ── Row ───────────────────────────────────────────────────────────────────────

interface RowProps {
  keys: React.ReactNode;
  desc: string;
}

function Row({ keys, desc }: RowProps) {
  return (
    <div className="ks-row">
      {keys}
      <div className="ks-desc">{desc}</div>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="ks-section">
      <h3 className="ks-section-title">{title}</h3>
      {children}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export default function KeyboardShortcutsModal() {
  const closeKeyboardShortcuts = useOnyxStore(s => s.closeKeyboardShortcuts);

  return (
    <ModalShell
      onClose={closeKeyboardShortcuts}
      title="Keyboard Shortcuts"
      kicker="Reference"
      titleId="ks-modal-title"
      size="lg"
    >
      {/* Two-column grid: left = Navigation + Voice, right = Messaging + App */}
      <div className="ks-grid">

        {/* LEFT COLUMN */}
        <div className="ks-col">
          <Section title="Navigation">
            <Row
              keys={<Combo parts={['Ctrl', 'K']} />}
              desc="Open search"
            />
            <Row
              keys={<Keys><Alt /><Sep /><K>↑</K></Keys>}
              desc="Previous channel"
            />
            <Row
              keys={<Keys><Alt /><Sep /><K>↓</K></Keys>}
              desc="Next channel"
            />
            <Row
              keys={<Keys><Alt /><Sep /><K>Shift</K><Sep /><K>↑</K></Keys>}
              desc="Prev unread channel"
            />
            <Row
              keys={<Keys><Alt /><Sep /><K>Shift</K><Sep /><K>↓</K></Keys>}
              desc="Next unread channel"
            />
            <Row
              keys={<Combo parts={['Ctrl', 'B']} />}
              desc="Toggle member list"
            />
            <Row
              keys={<Combo parts={['Ctrl', 'Shift', 'F']} />}
              desc="Toggle focus mode"
            />
            <Row
              keys={<Combo parts={['Ctrl', 'L']} />}
              desc="Scroll to bottom"
            />
            <Row
              keys={<Keys><K>Esc</K></Keys>}
              desc="Close panel / cancel"
            />
          </Section>

          <Section title="Voice">
            <Row
              keys={<Keys><K>M</K></Keys>}
              desc="Toggle mute (in call)"
            />
            <Row
              keys={<Keys><K>D</K></Keys>}
              desc="Toggle deafen (in call)"
            />
            <Row
              keys={<Keys><K>PTT key</K></Keys>}
              desc="Push to talk (when enabled)"
            />
          </Section>
        </div>

        {/* RIGHT COLUMN */}
        <div className="ks-col">
          <Section title="Messaging">
            <Row
              keys={<Keys><K>Enter</K></Keys>}
              desc="Send message"
            />
            <Row
              keys={<Combo parts={['Shift', 'Enter']} />}
              desc="New line"
            />
            <Row
              keys={<Keys><K>↑</K></Keys>}
              desc="Edit last message"
            />
            <Row
              keys={<Combo parts={['Ctrl', 'B']} />}
              desc="Bold"
            />
            <Row
              keys={<Combo parts={['Ctrl', 'I']} />}
              desc="Italic"
            />
            <Row
              keys={<Combo parts={['Ctrl', '`']} />}
              desc="Inline code"
            />
            <Row
              keys={<Keys><K>Tab</K></Keys>}
              desc="Autocomplete"
            />
            <Row
              keys={<Keys><K>@nick</K></Keys>}
              desc="Mention user"
            />
            <Row
              keys={<Keys><K>#channel</K></Keys>}
              desc="Link channel"
            />
            <Row
              keys={<Keys><K>:emoji:</K></Keys>}
              desc="Insert emoji"
            />
          </Section>

          <Section title="App">
            <Row
              keys={<Combo parts={['Ctrl', ',']} />}
              desc="Open settings"
            />
            <Row
              keys={<Keys><Combo parts={['Ctrl', '/']} /><span className="ks-or">or</span><K>?</K></Keys>}
              desc="This screen"
            />
            <Row
              keys={<Keys><K>F</K><span className="ks-or">or</span><Combo parts={['Ctrl', 'F']} /></Keys>}
              desc="Search in channel"
            />
            <Row
              keys={<Combo parts={['Ctrl', 'Shift', 'M']} />}
              desc="Mark all as read"
            />
          </Section>
        </div>

      </div>

      {/* Footer hint */}
      <p className="ks-footer">
        Press <kbd className="ks-kbd">Esc</kbd> or click outside to close
      </p>

      <style>{`
        .ks-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0 36px;
        }

        .ks-col {
          display: flex;
          flex-direction: column;
        }

        .ks-section {
          margin-bottom: var(--sp-1, 4px);
        }

        .ks-section-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--accent, #0ea5e9);
          opacity: 0.7;
          padding: 14px 0 7px;
          border-bottom: 1px solid var(--border-subtle, rgba(14,165,233,0.08));
          margin-bottom: 2px;
        }

        .ks-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 5px 6px;
          gap: 10px;
          border-radius: var(--r-sm, 6px);
          transition: background var(--t-micro, 90ms);
          margin: 0 -6px;
        }
        .ks-row:hover {
          background: rgba(14,165,233,0.04);
        }

        .ks-keys {
          display: flex;
          align-items: center;
          gap: 3px;
          flex-shrink: 0;
        }

        /* Raised keycap styling — subtle 3D lift */
        .ks-kbd {
          font-family: var(--font-mono, ui-monospace, 'Cascadia Code', monospace);
          background: linear-gradient(180deg,
            var(--bg-float, #1a2c40) 0%,
            var(--bg-elevated, #132131) 100%);
          border: 1px solid var(--border-normal, rgba(14,165,233,0.15));
          border-bottom: 2.5px solid rgba(14,165,233,0.25);
          border-radius: var(--r-sm, 6px);
          padding: 2px 7px;
          font-size: 10.5px;
          color: var(--text-secondary, #7aa8c4);
          white-space: nowrap;
          line-height: 1.7;
          box-shadow:
            0 1px 0 rgba(0,0,0,0.5),
            0 0 0 1px rgba(255,255,255,0.02) inset;
          min-width: 22px;
          text-align: center;
          letter-spacing: 0.02em;
        }

        .ks-sep {
          font-size: 9px;
          color: var(--text-muted, #3d6480);
          margin: 0 1px;
          user-select: none;
          font-weight: 700;
          opacity: 0.6;
        }

        .ks-or {
          font-size: 10.5px;
          color: var(--text-muted, #3d6480);
          margin: 0 4px;
          font-style: italic;
          user-select: none;
        }

        .ks-desc {
          font-size: var(--text-xs, 12px);
          color: var(--text-secondary, #7aa8c4);
          text-align: right;
          flex: 1;
          min-width: 0;
          line-height: 1.4;
        }

        .ks-footer {
          margin-top: 22px;
          padding-top: 14px;
          border-top: 1px solid var(--border-subtle, rgba(14,165,233,0.08));
          font-size: var(--text-xs, 12px);
          color: var(--text-muted, #3d6480);
          text-align: center;
        }

        @media (max-width: 560px) {
          .ks-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </ModalShell>
  );
}
