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
    <div className="form-field">
      <label className="form-label">
        {label}
        {required && <span className="form-required">*</span>}
      </label>
      {children}
      {hint && !error && <p className="form-hint">{hint}</p>}
      {error && <p className="form-error">{error}</p>}

      <style>{`
        .form-field { display: flex; flex-direction: column; gap: 6px; }
        .form-label {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-secondary);
          user-select: none;
        }
        .form-required { color: var(--danger); margin-left: 3px; }
        .form-hint { font-size: 12px; color: var(--text-muted); }
        .form-error { font-size: 12px; color: var(--danger); }
      `}</style>
    </div>
  );
}
