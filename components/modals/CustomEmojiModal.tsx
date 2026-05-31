'use client';

import { useState, useRef, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import { useDialogFocus } from './useDialogFocus';

const NAME_RE = /^[a-zA-Z0-9_-]{2,32}$/;
const MAX_BASE64_LEN = 128 * 1024 * (4 / 3); // ~128KB in base64 chars

export default function CustomEmojiModal() {
  const customEmoji       = useOnyxStore(s => s.customEmoji);
  const addCustomEmoji    = useOnyxStore(s => s.addCustomEmoji);
  const removeCustomEmoji = useOnyxStore(s => s.removeCustomEmoji);
  const closeModal        = useOnyxStore(s => s.closeCustomEmojiModal);

  const [name, setName]       = useState('');
  const [url, setUrl]         = useState('');
  const [nameErr, setNameErr] = useState('');
  const [urlErr, setUrlErr]   = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const dropRef   = useRef<HTMLDivElement>(null);
  const modalRef  = useRef<HTMLDivElement>(null);
  useDialogFocus(modalRef);

  const validateName = (v: string): string => {
    if (!v) return 'Name is required';
    if (!NAME_RE.test(v)) return 'Letters, numbers, hyphens, underscores. 2–32 chars.';
    return '';
  };

  const validateUrl = (v: string): string => {
    if (!v) return 'URL or image required';
    if (v.startsWith('data:image/')) return '';
    if (!v.startsWith('https://')) return 'Must be an https:// URL';
    return '';
  };

  const handleAdd = useCallback(() => {
    const ne = validateName(name);
    const ue = validateUrl(url);
    setNameErr(ne);
    setUrlErr(ue);
    if (ne || ue) return;
    addCustomEmoji(name.trim(), url.trim());
    setName('');
    setUrl('');
  }, [name, url, addCustomEmoji]);

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setUrlErr('Only image files allowed');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const result = e.target?.result as string;
      if (result.length > MAX_BASE64_LEN) {
        setUrlErr('Image too large (max 128 KB)');
        return;
      }
      setUrl(result);
      setUrlErr('');
    };
    reader.readAsDataURL(file);
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const previewValid = url.startsWith('data:image/') ||
    (url.startsWith('https://') && url.length > 10);

  return (
    <div className="cem-backdrop" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="cem-modal" ref={modalRef} role="dialog" aria-modal aria-labelledby="cem-modal-title">
        <div className="cem-header">
          <h2 id="cem-modal-title" className="cem-title">Custom Emoji</h2>
          <button className="cem-close" onClick={closeModal} aria-label="Close"><svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg></button>
        </div>

        {/* Existing emoji grid */}
        <div className="cem-grid-section">
          {customEmoji.length === 0 ? (
            <p className="cem-empty">No custom emoji yet. Add one below.</p>
          ) : (
            <div className="cem-grid">
              {customEmoji.map(ce => (
                <div key={ce.name} className="cem-item">
                  <img src={ce.url} alt={ce.name} className="cem-thumb" />
                  <span className="cem-name">:{ce.name}:</span>
                  <button
                    className="cem-remove"
                    onClick={() => removeCustomEmoji(ce.name)}
                    aria-label={`Remove :${ce.name}:`}
                  >
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cem-divider" />

        {/* Add new emoji form */}
        <div className="cem-form">
          <h3 className="cem-form-title">Add New Emoji</h3>

          {/* Drag-drop zone */}
          <div
            ref={dropRef}
            className={`cem-dropzone${isDragOver ? ' cem-dropzone--over' : ''}`}
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={onDrop}
          >
            {previewValid && url ? (
              <img src={url} alt="preview" className="cem-preview-img" />
            ) : (
              <span className="cem-drop-hint">Drag an image here or browse below</span>
            )}
          </div>

          <label className="cem-field">
            <span className="cem-label">Image file</span>
            <input
              type="file"
              accept="image/*"
              className="cem-file-input"
              onChange={onFileChange}
            />
          </label>

          <label className="cem-field">
            <span className="cem-label">— or — Image URL (https://)</span>
            <input
              type="url"
              className={`cem-input${urlErr ? ' cem-input--err' : ''}`}
              value={url.startsWith('data:') ? '' : url}
              placeholder="https://example.com/emoji.png"
              onChange={e => { setUrl(e.target.value); setUrlErr(''); }}
            />
            {urlErr && <span className="cem-err">{urlErr}</span>}
          </label>

          <label className="cem-field">
            <span className="cem-label">Name (no colons needed)</span>
            <input
              type="text"
              className={`cem-input${nameErr ? ' cem-input--err' : ''}`}
              value={name}
              placeholder="cool_emoji"
              maxLength={32}
              onChange={e => { setName(e.target.value); setNameErr(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            />
            {nameErr && <span className="cem-err">{nameErr}</span>}
            <span className="cem-hint">Preview: :{name || 'name'}:</span>
          </label>

          <button className="cem-add-btn" onClick={handleAdd}>
            Add Emoji
          </button>
        </div>
      </div>

      <style>{`
        .cem-backdrop {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.6);
          display: flex; align-items: center; justify-content: center;
          z-index: 500;
          animation: cem-fade 120ms ease both;
        }
        @keyframes cem-fade { from { opacity: 0; } to { opacity: 1; } }

        .cem-modal {
          width: 480px;
          max-height: 80vh;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-xl);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: cem-enter 160ms var(--ease-out) both;
        }
        @keyframes cem-enter {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        .cem-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px 12px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .cem-title {
          font-size: 16px; font-weight: 700; color: var(--text-primary);
          margin: 0;
        }
        .cem-close {
          background: none; border: none; color: var(--text-muted);
          font-size: 20px; cursor: pointer; line-height: 1; padding: 2px 4px;
          border-radius: var(--r-sm);
          transition: color var(--t-fast), background var(--t-fast);
        }
        .cem-close:hover { color: var(--text-primary); background: var(--bg-overlay); }

        .cem-grid-section {
          padding: 12px 16px;
          overflow-y: auto;
          max-height: 220px;
          flex-shrink: 0;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }
        .cem-empty {
          color: var(--text-muted); font-size: 13px; text-align: center;
          padding: 12px 0;
        }
        .cem-grid {
          display: flex; flex-wrap: wrap; gap: 8px;
        }
        .cem-item {
          display: flex; flex-direction: column; align-items: center; gap: 0;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-md);
          padding: 8px 6px 6px;
          width: 68px;
          position: relative;
          transition: border-color var(--t-fast), background var(--t-fast);
          cursor: default;
        }
        .cem-item:hover {
          border-color: var(--accent-border);
          background: var(--bg-float);
        }
        .cem-thumb {
          width: 48px; height: 48px;
          object-fit: contain; border-radius: 2px;
        }
        .cem-name {
          font-size: 10px; color: var(--text-muted);
          text-overflow: ellipsis; overflow: hidden;
          white-space: nowrap; max-width: 60px;
          text-align: center;
          margin-top: 5px;
          opacity: 0;
          transition: opacity var(--t-fast);
        }
        .cem-item:hover .cem-name { opacity: 1; }
        .cem-remove {
          position: absolute; top: 3px; right: 3px;
          background: var(--bg-overlay); border: none;
          color: var(--text-muted); font-size: 13px; line-height: 1;
          cursor: pointer; border-radius: 50%;
          width: 18px; height: 18px;
          display: flex; align-items: center; justify-content: center;
          opacity: 0;
          transition: opacity var(--t-fast), color var(--t-fast), background var(--t-fast);
        }
        .cem-item:hover .cem-remove { opacity: 1; }
        .cem-remove:hover { color: var(--danger, #e04646); background: var(--danger-subtle); }

        .cem-divider {
          height: 1px; background: var(--border-subtle); flex-shrink: 0;
        }

        .cem-form {
          padding: 16px 20px;
          display: flex; flex-direction: column; gap: 12px;
          overflow-y: auto;
          flex: 1;
          scrollbar-width: thin;
          scrollbar-color: var(--border-normal) transparent;
        }
        .cem-form-title {
          font-size: 13px; font-weight: 700;
          color: var(--text-secondary);
          margin: 0;
          text-transform: uppercase;
          letter-spacing: 0.6px;
        }

        .cem-dropzone {
          border: 2px dashed var(--border-normal);
          border-radius: var(--r-md);
          height: 90px;
          display: flex; align-items: center; justify-content: center;
          transition: border-color var(--t-fast), background var(--t-fast);
          cursor: default;
        }
        .cem-dropzone--over {
          border-color: var(--accent);
          background: var(--accent-subtle);
        }
        .cem-drop-hint {
          font-size: 13px; color: var(--text-muted);
        }
        .cem-preview-img {
          height: 70px; max-width: 100%;
          object-fit: contain; border-radius: 4px;
        }

        .cem-field {
          display: flex; flex-direction: column; gap: 4px;
        }
        .cem-label {
          font-size: 12px; color: var(--text-muted); font-weight: 600;
        }
        .cem-file-input {
          font-size: 12px; color: var(--text-secondary);
        }
        .cem-input {
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          padding: 7px 10px;
          font-size: 13px;
          color: var(--text-primary);
          outline: none;
          transition: border-color var(--t-fast);
        }
        .cem-input:focus { border-color: var(--accent); }
        .cem-input--err { border-color: var(--danger, #e04646); }
        .cem-err { font-size: 11px; color: var(--danger, #e04646); }
        .cem-hint { font-size: 11px; color: var(--text-muted); }

        .cem-add-btn {
          align-self: flex-start;
          background: var(--accent);
          border: none;
          border-radius: var(--r-md);
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          padding: 9px 22px;
          cursor: pointer;
          letter-spacing: 0.01em;
          transition: background var(--t-fast), transform var(--t-fast);
          font-family: inherit;
        }
        .cem-add-btn:hover { background: var(--accent-hover, color-mix(in srgb, var(--accent) 85%, #fff)); }
        .cem-add-btn:active { transform: scale(0.97); }

        /* Category tabs row for CEM */
        .cem-tab-row {
          display: flex;
          gap: 4px;
          padding: 0 0 8px;
          overflow-x: auto;
          scrollbar-width: none;
          flex-shrink: 0;
        }
        .cem-tab-row::-webkit-scrollbar { display: none; }
        .cem-tab {
          padding: 3px 12px;
          border-radius: var(--r-full);
          font-size: 12px;
          font-weight: 600;
          border: 1px solid var(--border-subtle);
          background: none;
          color: var(--text-muted);
          cursor: pointer;
          white-space: nowrap;
          transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
          font-family: inherit;
        }
        .cem-tab:hover { color: var(--text-secondary); }
        .cem-tab.active {
          background: var(--accent-subtle);
          border-color: var(--accent-border);
          color: var(--accent);
        }
      `}</style>
    </div>
  );
}
