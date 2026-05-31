'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ForumPost } from '@/lib/store';
import { useDialogFocus } from './useDialogFocus';

const MAX_TITLE   = 100;
const MAX_TAGS    = 5;
const MAX_CONTENT = 4000;

// ── Deterministic tag color (same palette as ForumView) ───────────────────────

const TAG_PALETTE = [
  { bg: 'rgba(14,165,233,0.12)', text: 'var(--accent)', border: 'rgba(14,165,233,0.25)' },
  { bg: 'rgba(14,165,233,0.12)', text: '#38bdf8', border: 'rgba(14,165,233,0.25)' },
  { bg: 'rgba(34,197,94,0.12)',  text: '#4ade80', border: 'rgba(34,197,94,0.25)'  },
  { bg: 'rgba(232,184,75,0.12)', text: '#f0c95c', border: 'rgba(232,184,75,0.25)' },
  { bg: 'rgba(248,113,113,0.12)',text: '#f87171', border: 'rgba(248,113,113,0.25)'},
  { bg: 'rgba(251,146,60,0.12)', text: '#fb923c', border: 'rgba(251,146,60,0.25)' },
  { bg: 'rgba(192,132,252,0.12)',text: '#c084fc', border: 'rgba(192,132,252,0.25)'},
];

function tagColor(tag: string) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xffffffff;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

// ── UID helper ────────────────────────────────────────────────────────────────

let _uidCounter = 0;
function uid() {
  return `forum-${Date.now()}-${++_uidCounter}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ForumCreateModal() {
  const closeForumCreate = useOnyxStore(s => s.closeForumCreate);
  const activeView       = useOnyxStore(s => s.activeView);
  const forumPosts       = useOnyxStore(s => s.forumPosts);
  const addForumPost     = useOnyxStore(s => s.addForumPost);
  const client           = useOnyxStore(s => s.client);
  const ourNick          = useOnyxStore(s => s.ourNick);

  const [title,      setTitle]      = useState('');
  const [content,    setContent]    = useState('');
  const [tags,       setTags]       = useState<string[]>([]);
  const [tagInput,   setTagInput]   = useState('');
  const [titleError, setTitleError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const titleRef   = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef   = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef);

  const channelName = activeView.kind === 'channel' ? activeView.channel : '';

  // Collect existing tags from channel's posts for suggestions
  const existingTags: string[] = (() => {
    const posts = forumPosts[channelName.toLowerCase()] ?? [];
    const set = new Set<string>();
    for (const p of posts) p.tags.forEach(t => set.add(t));
    return [...set];
  })();

  const suggestions = existingTags.filter(t =>
    tagInput.trim().length > 0 &&
    t.toLowerCase().includes(tagInput.toLowerCase()) &&
    !tags.includes(t)
  );

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') closeForumCreate();
  }, [closeForumCreate]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  function addTag(tag: string) {
    const clean = tag.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 24);
    if (!clean || tags.includes(clean) || tags.length >= MAX_TAGS) return;
    setTags(prev => [...prev, clean]);
    setTagInput('');
  }

  function removeTag(tag: string) {
    setTags(prev => prev.filter(t => t !== tag));
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(prev => prev.slice(0, -1));
    }
  }

  function validate(): boolean {
    if (!title.trim()) {
      setTitleError('Title is required.');
      titleRef.current?.focus();
      return false;
    }
    setTitleError('');
    return true;
  }

  function handleSubmit() {
    if (!validate()) return;
    if (!client || !channelName) return;
    if (submitting) return;

    setSubmitting(true);

    const postId  = uid();
    const postMeta = JSON.stringify({
      id: postId,
      title: title.trim(),
      tags,
      content: content.trim(),
    });

    // Send the FORUM-encoded CTCP-like message
    client.sendRaw('PRIVMSG', channelName, `\x01FORUM ${postMeta}\x01`);

    // Optimistically add to local store
    const newPost: ForumPost = {
      id: postId,
      title: title.trim(),
      tags,
      authorNick: ourNick,
      content: content.trim(),
      time: new Date(),
      replyCount: 0,
    };
    addForumPost(channelName, newPost);

    closeForumCreate();
  }

  const canSubmit = title.trim().length > 0 && !submitting;

  return (
    <div
      className="fcm-overlay"
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) closeForumCreate(); }}
    >
      <div className="fcm-panel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="fcm-modal-title">
        {/* Header */}
        <header className="fcm-header">
          <span className="fcm-header-icon" aria-hidden>📋</span>
          <h2 id="fcm-modal-title" className="fcm-title">New Post</h2>
          <button className="fcm-close" onClick={closeForumCreate} aria-label="Close">
            <CloseIcon />
          </button>
        </header>

        <div className="fcm-body">
          {/* Title */}
          <div className="fcm-field">
            <label className="fcm-label" htmlFor="fcm-title">
              Title <span className="fcm-required">*</span>
            </label>
            <div className="fcm-input-wrap">
              <input
                id="fcm-title"
                ref={titleRef}
                type="text"
                className={`fcm-input${titleError ? ' fcm-input--error' : ''}`}
                placeholder="What's your post about?"
                value={title}
                maxLength={MAX_TITLE}
                onChange={e => { setTitle(e.target.value); if (titleError) setTitleError(''); }}
                aria-describedby={titleError ? 'fcm-title-error' : undefined}
              />
              <span className={`fcm-char-counter${title.length >= MAX_TITLE - 10 ? ' fcm-char-counter--warn' : ''}`}>
                {title.length}/{MAX_TITLE}
              </span>
            </div>
            {titleError && (
              <span id="fcm-title-error" className="fcm-error-msg" role="alert">{titleError}</span>
            )}
          </div>

          {/* Tags */}
          <div className="fcm-field">
            <label className="fcm-label" htmlFor="fcm-tag-input">
              Tags
              <span className="fcm-label-hint">
                {tags.length}/{MAX_TAGS} — press Enter or , to add
              </span>
            </label>
            <div className={`fcm-tag-box${tags.length >= MAX_TAGS ? ' fcm-tag-box--full' : ''}`}>
              {tags.map(tag => {
                const c = tagColor(tag);
                return (
                  <span
                    key={tag}
                    className="fcm-tag-chip"
                    style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
                  >
                    {tag}
                    <button
                      type="button"
                      className="fcm-tag-remove"
                      onClick={() => removeTag(tag)}
                      aria-label={`Remove tag ${tag}`}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              {tags.length < MAX_TAGS && (
                <div className="fcm-tag-input-wrap">
                  <input
                    id="fcm-tag-input"
                    type="text"
                    className="fcm-tag-input"
                    placeholder={tags.length === 0 ? 'Add tags…' : ''}
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    aria-label="New tag"
                  />
                  {suggestions.length > 0 && (
                    <ul className="fcm-tag-suggestions" role="listbox">
                      {suggestions.slice(0, 5).map(s => (
                        <li key={s} role="option">
                          <button
                            type="button"
                            className="fcm-tag-suggestion-item"
                            onMouseDown={e => { e.preventDefault(); addTag(s); }}
                          >
                            {s}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="fcm-field fcm-field--grow">
            <label className="fcm-label" htmlFor="fcm-content">
              Content
              <span className="fcm-label-hint">{content.length}/{MAX_CONTENT}</span>
            </label>
            <textarea
              id="fcm-content"
              className="fcm-textarea"
              rows={6}
              placeholder="Share more details about your post…"
              value={content}
              maxLength={MAX_CONTENT}
              onChange={e => setContent(e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <footer className="fcm-footer">
          <button className="fcm-btn-cancel" onClick={closeForumCreate} type="button">
            Cancel
          </button>
          <button
            className="fcm-btn-post"
            onClick={handleSubmit}
            type="button"
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
          >
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </footer>
      </div>

      <style>{`
        .fcm-overlay {
          position: fixed;
          inset: 0;
          z-index: 400;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          animation: fcm-fade-in 0.15s ease both;
        }

        @keyframes fcm-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        .fcm-panel {
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-lg, 12px);
          box-shadow: var(--shadow-xl, 0 24px 64px rgba(0,0,0,0.65)), 0 0 0 1px var(--border-subtle);
          width: 100%;
          max-width: 560px;
          max-height: calc(100vh - 40px);
          display: flex;
          flex-direction: column;
          animation: fcm-slide-up 0.18s cubic-bezier(0.16,1,0.3,1) both;
          overflow: hidden;
        }

        @keyframes fcm-slide-up {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }

        /* ── Header ── */
        .fcm-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 16px 20px 14px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .fcm-header-icon {
          font-size: 18px;
          line-height: 1;
        }

        .fcm-title {
          flex: 1;
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
          letter-spacing: -0.1px;
        }

        .fcm-close {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          border-radius: var(--r-sm);
          transition: background var(--t-fast), color var(--t-fast);
          flex-shrink: 0;
        }
        .fcm-close:hover {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }

        /* ── Body ── */
        .fcm-body {
          flex: 1;
          overflow-y: auto;
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          min-height: 0;
        }

        /* ── Field ── */
        .fcm-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .fcm-field--grow {
          flex: 1;
        }

        .fcm-label {
          display: flex;
          align-items: baseline;
          gap: 6px;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-secondary);
        }

        .fcm-required {
          color: var(--danger, #f04747);
        }

        .fcm-label-hint {
          font-size: 11px;
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          color: var(--text-muted);
          margin-left: auto;
        }

        /* ── Title input ── */
        .fcm-input-wrap {
          position: relative;
        }

        .fcm-input {
          width: 100%;
          padding: 10px 52px 10px 12px;
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          /* Larger, more prominent title input */
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          font-family: inherit;
          transition: border-color var(--t-fast), box-shadow var(--t-fast);
          box-sizing: border-box;
        }
        .fcm-input:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-subtle);
        }
        .fcm-input--error {
          border-color: var(--danger);
          box-shadow: 0 0 0 3px var(--danger-subtle);
        }
        .fcm-input::placeholder { color: var(--text-muted); font-weight: 400; }

        .fcm-char-counter {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 10px;
          color: var(--text-muted);
          pointer-events: none;
          font-family: var(--font-mono, monospace);
        }
        .fcm-char-counter--warn { color: var(--warning, #faa61a); }

        .fcm-error-msg {
          font-size: 12px;
          color: var(--danger, #f04747);
          margin-top: 2px;
        }

        /* ── Tag box ── */
        .fcm-tag-box {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          padding: 8px 10px;
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm);
          min-height: 40px;
          align-items: center;
          transition: border-color var(--t-fast), box-shadow var(--t-fast);
        }
        .fcm-tag-box:focus-within {
          border-color: var(--accent-border, rgba(14,165,233,0.5));
          box-shadow: 0 0 0 3px rgba(14,165,233,0.12);
        }
        .fcm-tag-box--full { opacity: 0.75; }

        .fcm-tag-chip {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 99px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }

        .fcm-tag-remove {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          padding: 0;
          color: inherit;
          opacity: 0.6;
          transition: opacity var(--t-fast);
        }
        .fcm-tag-remove:hover { opacity: 1; }

        .fcm-tag-input-wrap {
          position: relative;
          flex: 1;
          min-width: 80px;
        }

        .fcm-tag-input {
          width: 100%;
          background: none;
          border: none;
          font-size: 13px;
          font-family: inherit;
          color: var(--text-primary);
          outline: none;
          padding: 0;
        }
        .fcm-tag-input::placeholder { color: var(--text-muted); }

        .fcm-tag-suggestions {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          z-index: 10;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
          padding: 4px;
          min-width: 140px;
          list-style: none;
          margin: 0;
        }

        .fcm-tag-suggestion-item {
          display: block;
          width: 100%;
          padding: 5px 10px;
          font-size: 12px;
          font-family: inherit;
          font-weight: 500;
          color: var(--text-primary);
          background: none;
          border: none;
          cursor: pointer;
          border-radius: 4px;
          text-align: left;
          transition: background var(--t-fast);
        }
        .fcm-tag-suggestion-item:hover { background: var(--bg-overlay); }

        /* ── Textarea ── */
        .fcm-textarea {
          width: 100%;
          background: var(--bg-deep);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          padding: 12px 14px;
          font-size: 14px;
          font-family: inherit;
          color: var(--text-primary);
          resize: vertical;
          /* Good default height */
          min-height: 160px;
          line-height: 1.65;
          transition: border-color var(--t-fast), box-shadow var(--t-fast);
          box-sizing: border-box;
        }
        .fcm-textarea:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-subtle);
        }
        .fcm-textarea::placeholder { color: var(--text-muted); }

        /* ── Footer ── */
        .fcm-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          padding: 14px 20px 16px;
          border-top: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .fcm-btn-cancel {
          padding: 7px 16px;
          background: none;
          border: 1px solid var(--border-normal);
          border-radius: var(--r-sm);
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          color: var(--text-secondary);
          cursor: pointer;
          transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
        }
        .fcm-btn-cancel:hover {
          background: var(--bg-overlay);
          color: var(--text-primary);
          border-color: var(--border-normal);
        }

        .fcm-btn-post {
          padding: 8px 22px;
          background: var(--accent);
          border: none;
          border-radius: var(--r-sm);
          font-size: 13px;
          font-weight: 700;
          font-family: inherit;
          color: #fff;
          cursor: pointer;
          transition: opacity var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
        }
        .fcm-btn-post:hover:not([disabled]) {
          opacity: 0.90;
          box-shadow: 0 0 0 3px var(--accent-subtle), var(--glow, 0 0 16px var(--accent-glow));
          transform: translateY(-1px);
        }
        .fcm-btn-post:active:not([disabled]) {
          transform: translateY(0);
        }
        .fcm-btn-post[disabled] {
          opacity: 0.38;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M2 2l10 10M12 2L2 12" />
    </svg>
  );
}
