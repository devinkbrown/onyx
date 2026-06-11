'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

interface ProfileMetadataEditorProps {
  nick: string;
  initialDisplayName?: string;
  initialPronouns?: string;
  initialBio?: string;
  initialAccentColor?: string;
  initialLinks?: string[];
  onSave?: (draft: ProfileMetadataDraft) => void;
  onCancel?: () => void;
}

export interface ProfileMetadataDraft {
  displayName: string;
  pronouns: string;
  bio: string;
  accentColor: string;
  links: string[];
}

const DEFAULT_ACCENT = '#d8b96a';

function normalizeLinks(value: string): string[] {
  return value
    .split('\n')
    .map(link => link.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function dispatchMetadata(key: keyof ProfileMetadataDraft, value: string | string[]) {
  // OCEAN-INTEGRATION: serial protocol wiring listens here and sends METADATA key/value updates.
  window.dispatchEvent(new CustomEvent('ocean:metadata-set', { detail: { key, value } }));
}

export default function ProfileMetadataEditor({
  nick,
  initialDisplayName = '',
  initialPronouns = '',
  initialBio = '',
  initialAccentColor = DEFAULT_ACCENT,
  initialLinks = [],
  onSave,
  onCancel,
}: ProfileMetadataEditorProps) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [pronouns, setPronouns] = useState(initialPronouns);
  const [bio, setBio] = useState(initialBio);
  const [accentColor, setAccentColor] = useState(initialAccentColor || DEFAULT_ACCENT);
  const [linksText, setLinksText] = useState(initialLinks.join('\n'));

  useEffect(() => {
    setDisplayName(initialDisplayName);
    setPronouns(initialPronouns);
    setBio(initialBio);
    setAccentColor(initialAccentColor || DEFAULT_ACCENT);
    setLinksText(initialLinks.join('\n'));
  }, [initialDisplayName, initialPronouns, initialBio, initialAccentColor, initialLinks]);

  const links = useMemo(() => normalizeLinks(linksText), [linksText]);
  const draft: ProfileMetadataDraft = { displayName, pronouns, bio, accentColor, links };

  const handleSave = () => {
    dispatchMetadata('displayName', displayName.trim());
    dispatchMetadata('pronouns', pronouns.trim());
    dispatchMetadata('bio', bio.trim());
    dispatchMetadata('accentColor', accentColor);
    dispatchMetadata('links', links);
    onSave?.({
      displayName: displayName.trim(),
      pronouns: pronouns.trim(),
      bio: bio.trim(),
      accentColor,
      links,
    });
  };

  return (
    <section className="pme-root" data-testid="profile-metadata-editor" style={{ '--pme-accent': accentColor } as CSSProperties}>
      <div className="pme-preview elev-2">
        <div className="pme-swatch" aria-hidden />
        <div className="pme-preview-copy">
          <div className="pme-preview-name">{displayName.trim() || nick}</div>
          {pronouns.trim() && <div className="pme-preview-pronouns">{pronouns.trim()}</div>}
        </div>
      </div>

      <div className="pme-fields">
        <label className="pme-field">
          <span className="pme-label label-caps">Display name</span>
          <input
            className="pme-input"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={nick}
            maxLength={40}
            data-testid="profile-display-name-input"
          />
        </label>

        <label className="pme-field">
          <span className="pme-label label-caps">Pronouns</span>
          <input
            className="pme-input"
            value={pronouns}
            onChange={e => setPronouns(e.target.value)}
            placeholder="they/them"
            maxLength={32}
            data-testid="profile-pronouns-input"
          />
        </label>

        <label className="pme-field">
          <span className="pme-label label-caps">
            Bio
            <span className="pme-count">{bio.length}/190</span>
          </span>
          <textarea
            className="pme-textarea"
            value={bio}
            onChange={e => setBio(e.target.value.slice(0, 190))}
            rows={5}
            maxLength={190}
            data-testid="profile-bio-input"
          />
        </label>

        <label className="pme-field">
          <span className="pme-label label-caps">Accent</span>
          <span className="pme-color-row">
            <span className="pme-color-chip" aria-hidden />
            <input
              className="pme-color-input"
              type="color"
              value={accentColor}
              onChange={e => setAccentColor(e.target.value)}
              aria-label="Profile accent color"
              data-testid="profile-accent-input"
            />
          </span>
        </label>

        <label className="pme-field">
          <span className="pme-label label-caps">Links</span>
          <textarea
            className="pme-textarea pme-textarea--links"
            value={linksText}
            onChange={e => setLinksText(e.target.value)}
            rows={4}
            placeholder="https://example.com"
            data-testid="profile-links-input"
          />
        </label>
      </div>

      <div className="pme-actions">
        <button className="pme-btn pme-btn--primary" type="button" onClick={handleSave} data-testid="profile-metadata-save">
          Save
        </button>
        {onCancel && (
          <button className="pme-btn pme-btn--ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      <style>{`
        .pme-root {
          display: flex;
          flex-direction: column;
          gap: var(--sp-4, 16px);
          padding: var(--sp-5, 20px);
          min-width: 0;
        }
        .pme-preview {
          display: flex;
          align-items: center;
          gap: var(--sp-3, 12px);
          padding: var(--sp-4, 16px);
          border-radius: var(--r-lg, 14px) var(--r-sm, 6px) var(--r-xl, 16px) var(--r-md, 10px);
          background: color-mix(in srgb, var(--elev-tint-2, var(--bg-float)) 82%, var(--pme-accent) 18%);
        }
        .pme-swatch {
          width: 42px;
          height: 42px;
          border-radius: var(--r-sm, 6px) var(--r-lg, 14px) var(--r-sm, 6px) var(--r-md, 10px);
          background: var(--pme-accent);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 8px 18px rgba(0,0,0,.24));
          flex-shrink: 0;
        }
        .pme-preview-copy {
          min-width: 0;
        }
        .pme-preview-name {
          color: var(--text-primary);
          font-family: var(--font-display), Georgia, serif;
          font-size: var(--text-xl, 1.25rem);
          line-height: 1.05;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pme-preview-pronouns {
          margin-top: var(--sp-1, 4px);
          color: var(--text-secondary);
          font-size: var(--text-sm, .8125rem);
        }
        .pme-fields {
          display: grid;
          gap: var(--sp-4, 16px);
        }
        .pme-field {
          display: grid;
          gap: var(--sp-2, 8px);
        }
        .pme-label {
          display: flex;
          justify-content: space-between;
          gap: var(--sp-2, 8px);
          color: var(--text-muted);
        }
        .pme-count {
          color: var(--text-muted);
          font-size: var(--text-2xs, .6875rem);
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .pme-input,
        .pme-textarea {
          width: 100%;
          box-sizing: border-box;
          border: 0;
          border-radius: var(--r-md, 10px) var(--r-sm, 6px) var(--r-lg, 14px) var(--r-sm, 6px);
          background: var(--elev-tint-1, color-mix(in srgb, var(--bg-deep) 94%, var(--accent) 2%));
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), inset 0 0 0 1px var(--border-subtle);
          color: var(--text-primary);
          font: inherit;
          font-size: var(--text-sm, .8125rem);
          outline: none;
        }
        .pme-input {
          height: 36px;
          padding: 0 var(--sp-3, 12px);
        }
        .pme-textarea {
          min-height: 96px;
          padding: var(--sp-3, 12px);
          line-height: 1.55;
          resize: vertical;
        }
        .pme-textarea--links {
          min-height: 76px;
          font-family: var(--font-mono), ui-monospace, monospace;
          font-size: var(--text-xs, .75rem);
        }
        .pme-input:focus,
        .pme-textarea:focus {
          box-shadow:
            var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)),
            inset 0 0 0 1px color-mix(in srgb, var(--pme-accent) 62%, transparent),
            0 0 0 2px color-mix(in srgb, var(--pme-accent) 18%, transparent);
        }
        .pme-color-row {
          display: flex;
          align-items: center;
          gap: var(--sp-3, 12px);
        }
        .pme-color-chip {
          width: 30px;
          height: 30px;
          border-radius: var(--r-xs, 4px) var(--r-md, 10px) var(--r-xs, 4px) var(--r-sm, 6px);
          background: var(--pme-accent);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 8px 18px rgba(0,0,0,.22));
        }
        .pme-color-input {
          width: 44px;
          height: 34px;
          padding: 0;
          border: 0;
          border-radius: var(--r-sm, 6px);
          background: transparent;
          cursor: pointer;
        }
        .pme-actions {
          display: flex;
          gap: var(--sp-2, 8px);
          justify-content: flex-end;
        }
        .pme-btn {
          min-height: 34px;
          padding: 0 var(--sp-4, 16px);
          border: 0;
          border-radius: var(--r-sm, 6px) var(--r-md, 10px) var(--r-sm, 6px) var(--r-lg, 14px);
          cursor: pointer;
          font: inherit;
          font-size: var(--text-sm, .8125rem);
          font-weight: 800;
          transition: transform var(--t-control, 150ms) var(--ease-out, ease), background var(--t-control, 150ms) var(--ease-out, ease);
        }
        .pme-btn:hover { transform: translateY(-1px); }
        .pme-btn:active { transform: translateY(0); }
        .pme-btn--primary {
          background: color-mix(in srgb, var(--pme-accent) 82%, #05070a);
          color: var(--text-primary);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05)), var(--elev-shadow-1, 0 8px 18px rgba(0,0,0,.22));
        }
        .pme-btn--ghost {
          background: var(--elev-tint-1, var(--bg-elevated));
          color: var(--text-secondary);
          box-shadow: var(--elev-highlight, inset 0 1px 0 rgba(255,255,255,.05));
        }
        @media (prefers-reduced-motion: reduce) {
          .pme-btn {
            transition: none;
          }
          .pme-btn:hover {
            transform: none;
          }
        }
      `}</style>
    </section>
  );
}
