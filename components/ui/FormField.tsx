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
      {error && <p className="form-error" role="alert">{error}</p>}

      <style>{`
        .form-field {
          display: flex;
          flex-direction: column;
          gap: var(--sp-2, 8px);
        }

        .form-label {
          font-size: var(--text-xs, 0.75rem);
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-secondary);
          user-select: none;
          line-height: 1.4;
        }

        .form-required {
          color: var(--lux, var(--accent));
          margin-left: 3px;
          font-weight: 700;
        }

        .form-field > input,
        .form-field > select,
        .form-field > textarea,
        .form-field > .form-control {
          height: 36px;
          padding: 0 var(--sp-3, 12px);
          background: var(--elev-tint-1, var(--bg-deep));
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm, 6px) var(--r-md, 8px) var(--r-sm, 6px) var(--r-lg, 12px);
          color: var(--text-primary);
          font-size: var(--text-sm, 0.8125rem);
          font-family: var(--font-ui, inherit);
          box-sizing: border-box;
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
          transition:
            background var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
            border-color var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
            box-shadow var(--t-control, 150ms) var(--ease-out, cubic-bezier(.16,1,.3,1)),
            transform var(--t-micro, 90ms) var(--ease-out, cubic-bezier(.16,1,.3,1));
          outline: none;
          width: 100%;
        }
        .form-field > input:hover,
        .form-field > select:hover,
        .form-field > textarea:hover,
        .form-field > .form-control:hover {
          background: color-mix(in srgb, var(--elev-tint-1, var(--bg-deep)) 92%, var(--text-primary, #fff) 8%);
          border-color: var(--border-normal);
        }
        .form-field > input:active,
        .form-field > select:active,
        .form-field > textarea:active,
        .form-field > .form-control:active {
          transform: translateY(0.5px);
        }
        .form-field > textarea,
        .form-field > textarea.form-control {
          height: auto;
          padding: var(--sp-2, 8px) var(--sp-3, 12px);
        }
        .form-field > select {
          appearance: none;
          -webkit-appearance: none;
          cursor: pointer;
        }

        .form-field > input:focus-visible,
        .form-field > select:focus-visible,
        .form-field > textarea:focus-visible,
        .form-field > .form-control:focus-visible {
          border-color: var(--accent);
          outline: var(--focus-ring-width, 2px) solid var(--focus-ring, var(--accent));
          outline-offset: var(--focus-ring-offset, 2px);
        }

        .form-field.form-field--error > input,
        .form-field.form-field--error > select,
        .form-field.form-field--error > textarea,
        .form-field.form-field--error > .form-control {
          border-color: var(--danger);
        }
        .form-field.form-field--error > input:focus-visible,
        .form-field.form-field--error > select:focus-visible,
        .form-field.form-field--error > textarea:focus-visible,
        .form-field.form-field--error > .form-control:focus-visible {
          outline-color: var(--danger);
        }

        /* 12px muted helper text */
        .form-hint {
          font-size: var(--text-xs, 0.75rem);
          color: var(--text-muted);
          line-height: 1.45;
          margin: 0;
        }

        /* 12px red error text */
        .form-error {
          font-size: var(--text-xs, 0.75rem);
          color: var(--danger);
          line-height: 1.45;
          margin: 0;
        }
        @media (prefers-reduced-motion: reduce) {
          .form-field > input,
          .form-field > select,
          .form-field > textarea,
          .form-field > .form-control {
            transition-duration: 1ms;
          }
          .form-field > input:active,
          .form-field > select:active,
          .form-field > textarea:active,
          .form-field > .form-control:active {
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
