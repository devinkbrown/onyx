'use client';

interface Props {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

export default function FormField({ label, hint, error, required, children }: Props) {
  return (
    <div className={`form-field${error ? ' form-field--error' : ''}`}>
      <label className="form-label">
        {label}
        {required && <span className="form-required">*</span>}
      </label>
      {children}
      {hint && !error && <p className="form-hint">{hint}</p>}
      {error && <p className="form-error">{error}</p>}

      <style>{`
        .form-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        /* 13px semibold label per spec */
        .form-label {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.03em;
          color: var(--text-secondary);
          user-select: none;
          line-height: 1.4;
        }

        /* Accent-colored required asterisk */
        .form-required {
          color: var(--accent);
          margin-left: 3px;
          font-weight: 700;
        }

        /* Target child inputs, selects, and textareas */
        .form-field > input,
        .form-field > select,
        .form-field > textarea,
        .form-field > .form-control {
          height: 36px;
          padding: 0 12px;
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          box-sizing: border-box;
          transition: border-color var(--t-fast, 150ms) ease, box-shadow var(--t-fast, 150ms) ease;
          outline: none;
          width: 100%;
        }
        .form-field > textarea,
        .form-field > textarea.form-control {
          height: auto;
          padding: 9px 12px;
        }
        .form-field > select {
          appearance: none;
          -webkit-appearance: none;
          cursor: pointer;
        }

        /* Focus: accent border + subtle glow */
        .form-field > input:focus,
        .form-field > select:focus,
        .form-field > textarea:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-subtle);
        }

        /* Error state: red border + red glow */
        .form-field.form-field--error > input,
        .form-field.form-field--error > select,
        .form-field.form-field--error > textarea {
          border-color: var(--danger);
          box-shadow: 0 0 0 3px var(--danger-subtle);
        }

        /* 12px muted helper text */
        .form-hint {
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.45;
          margin: 0;
        }

        /* 12px red error text */
        .form-error {
          font-size: 12px;
          color: var(--danger);
          line-height: 1.45;
          margin: 0;
        }
      `}</style>
    </div>
  );
}
