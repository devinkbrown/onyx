'use client';

import { useState, useMemo, useRef } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ForumPost } from '@/lib/store';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import OfflineMessagesBanner from '@/components/ui/OfflineMessagesBanner';
import SkeletonMessage from './SkeletonMessage';

// ── Forum tag helpers (stored in topic as [tags:tag1,tag2,tag3]) ──────────────

function parseTagsFromTopic(topic: string): string[] {
  const match = topic.match(/\[tags:([^\]]*)\]/);
  if (!match) return [];
  return match[1].split(',').map(t => t.trim()).filter(Boolean);
}

function buildTopicWithTags(baseTopic: string, tags: string[]): string {
  const base = baseTopic.replace(/\s*\[tags:[^\]]*\]\s*/g, '').trimEnd();
  if (tags.length === 0) return base;
  return `${base} [tags:${tags.join(',')}]`.trimStart();
}

// ── Deterministic tag color from string ───────────────────────────────────────

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

// ── Relative time format ──────────────────────────────────────────────────────

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ── Sort options ──────────────────────────────────────────────────────────────

type SortOrder = 'activity' | 'creation' | 'replies';

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'activity', label: 'Latest Activity' },
  { value: 'creation', label: 'Creation Date' },
  { value: 'replies',  label: 'Most Replies'   },
];

// ── Tag pill ──────────────────────────────────────────────────────────────────

function TagPill({ tag, active, onClick }: { tag: string; active?: boolean; onClick?: () => void }) {
  const c = tagColor(tag);
  return (
    <button
      className={`forum-tag${active ? ' forum-tag--active' : ''}`}
      style={{
        background: active ? c.text : c.bg,
        color: active ? '#0d0d12' : c.text,
        border: `1px solid ${active ? c.text : c.border}`,
      }}
      onClick={onClick}
      type="button"
    >
      {tag}
    </button>
  );
}

// ── Post card ─────────────────────────────────────────────────────────────────

function PostCard({ post, onClick }: { post: ForumPost; onClick: () => void }) {
  return (
    <article className={`forum-card${post.pinned ? ' forum-card--pinned' : ''}`} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      {/* Tags row */}
      {post.tags.length > 0 && (
        <div className="forum-card-tags">
          {post.pinned && <span className="forum-card-pinned-badge">📌 Pinned</span>}
          {post.tags.map(tag => (
            <TagPill key={tag} tag={tag} />
          ))}
        </div>
      )}
      {post.pinned && post.tags.length === 0 && (
        <div className="forum-card-tags">
          <span className="forum-card-pinned-badge">📌 Pinned</span>
        </div>
      )}

      {/* Title */}
      <h3 className="forum-card-title">{post.title}</h3>

      {/* Content preview */}
      {post.content && (
        <p className="forum-card-preview">{post.content}</p>
      )}

      {/* Footer */}
      <footer className="forum-card-footer">
        <span className="forum-card-author">
          <Avatar nick={post.authorNick} size={18} />
          <span className="forum-card-nick">{post.authorNick}</span>
        </span>
        <span className="forum-card-meta">
          <span className="forum-card-replies">
            <ReplyIcon />
            {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
          </span>
          {post.lastReply ? (
            <span className="forum-card-activity">
              Last reply by <strong>{post.lastReply.nick}</strong> · {relativeTime(post.lastReply.time)}
            </span>
          ) : (
            <span className="forum-card-activity">{relativeTime(post.time)}</span>
          )}
        </span>
      </footer>
    </article>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ForumView() {
  const activeView      = useOnyxStore(s => s.activeView);
  const forumPosts      = useOnyxStore(s => s.forumPosts);
  const openForumCreate = useOnyxStore(s => s.openForumCreate);
  const openThread      = useOnyxStore(s => s.openThread);
  const channels        = useOnyxStore(s => s.channels);
  const client          = useOnyxStore(s => s.client);
  const ourNick         = useOnyxStore(s => s.ourNick);
  const status          = useOnyxStore(s => s.status);
  const connectionStatus = useOnyxStore(s => s.connectionStatus);
  const reconnectNow    = useOnyxStore(s => s.reconnectNow);

  const [sortOrder, setSortOrder]           = useState<SortOrder>('activity');
  const [activeTags, setActiveTags]         = useState<Set<string>>(new Set());
  const [showSortMenu, setShowSortMenu]     = useState(false);
  const [showManageTags, setShowManageTags] = useState(false);
  const [newTagInput, setNewTagInput]       = useState('');
  const newTagInputRef                      = useRef<HTMLInputElement>(null);

  const channelName = activeView.kind === 'channel' ? activeView.channel : '';
  const rawPosts    = forumPosts[channelName.toLowerCase()] ?? [];
  const forumLoading = (connectionStatus === 'connecting' || connectionStatus === 'reconnecting') && rawPosts.length === 0;
  const forumError = status === 'error';

  // Derive op status and topic from channel
  const channel = channels.get(channelName.toLowerCase());
  const topic   = channel?.topic ?? '';
  const ourEntry = channel?.users.get(ourNick.toLowerCase());
  const isOp     = ourEntry?.modes.has('q') || ourEntry?.modes.has('o') || false;

  // Tags in topic
  const topicTags = useMemo(() => parseTagsFromTopic(topic), [topic]);

  const handleAddTopicTag = () => {
    const tag = newTagInput.trim().replace(/[,[\]]/g, '');
    if (!tag || topicTags.includes(tag)) { setNewTagInput(''); return; }
    const next = [...topicTags, tag];
    client?.sendRaw('TOPIC', channelName, buildTopicWithTags(topic, next));
    setNewTagInput('');
  };

  const handleRemoveTopicTag = (tag: string) => {
    const next = topicTags.filter(t => t !== tag);
    client?.sendRaw('TOPIC', channelName, buildTopicWithTags(topic, next));
  };

  // Collect all tags across all posts + topic-defined tags
  const allTags = useMemo(() => {
    const set = new Set<string>();
    topicTags.forEach(t => set.add(t));
    for (const p of rawPosts) p.tags.forEach(t => set.add(t));
    return [...set];
  }, [rawPosts, topicTags]);

  // Filter by active tags
  const filtered = useMemo(() => {
    if (activeTags.size === 0) return rawPosts;
    return rawPosts.filter(p => p.tags.some(t => activeTags.has(t)));
  }, [rawPosts, activeTags]);

  // Sort
  const sorted = useMemo(() => {
    const posts = [...filtered];
    // Pinned always float first
    const pinned = posts.filter(p => p.pinned);
    const rest   = posts.filter(p => !p.pinned);

    const sortFn = (a: ForumPost, b: ForumPost): number => {
      if (sortOrder === 'activity') {
        const aTime = a.lastReply?.time ?? a.time;
        const bTime = b.lastReply?.time ?? b.time;
        return bTime.getTime() - aTime.getTime();
      }
      if (sortOrder === 'creation') return b.time.getTime() - a.time.getTime();
      return b.replyCount - a.replyCount;
    };

    return [...pinned.sort(sortFn), ...rest.sort(sortFn)];
  }, [filtered, sortOrder]);

  function toggleTag(tag: string) {
    setActiveTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  const currentSortLabel = SORT_OPTIONS.find(o => o.value === sortOrder)?.label ?? 'Sort';

  return (
    <div className="forum-view">
      <OfflineMessagesBanner channel={channelName} />

      {/* Header */}
      <header className="forum-header">
        <div className="forum-header-left">
          <span className="forum-header-icon" aria-hidden>📋</span>
          <span className="forum-header-title">{channelName}</span>
        </div>

        <div className="forum-header-controls">
          {/* Tag filters */}
          {allTags.length > 0 && (
            <div className="forum-tag-filters" role="group" aria-label="Filter by tag">
              {allTags.map(tag => (
                <TagPill
                  key={tag}
                  tag={tag}
                  active={activeTags.has(tag)}
                  onClick={() => toggleTag(tag)}
                />
              ))}
            </div>
          )}

          {/* Sort dropdown */}
          <div className="forum-sort-wrap">
            <button
              className="forum-sort-btn"
              onClick={() => setShowSortMenu(s => !s)}
              aria-haspopup="listbox"
              aria-expanded={showSortMenu}
            >
              <SortIcon />
              <span>{currentSortLabel}</span>
              <ChevronIcon open={showSortMenu} />
            </button>
            {showSortMenu && (
              <>
                <div className="forum-sort-backdrop" onClick={() => setShowSortMenu(false)} />
                <ul className="forum-sort-menu" role="listbox" aria-label="Sort order">
                  {SORT_OPTIONS.map(opt => (
                    <li key={opt.value} role="option" aria-selected={sortOrder === opt.value}>
                      <button
                        className={`forum-sort-item${sortOrder === opt.value ? ' forum-sort-item--active' : ''}`}
                        onClick={() => { setSortOrder(opt.value); setShowSortMenu(false); }}
                      >
                        {opt.label}
                        {sortOrder === opt.value && <CheckIcon />}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* Manage tags (op only) */}
          {isOp && (
            <button
              className={`forum-manage-tags-btn${showManageTags ? ' forum-manage-tags-btn--active' : ''}`}
              onClick={() => setShowManageTags(v => !v)}
              aria-label="Manage channel tags"
              aria-expanded={showManageTags}
            >
              <TagsIcon />
              Tags
            </button>
          )}

          {/* New post */}
          <button className="forum-new-btn" onClick={openForumCreate} aria-label="Create new post">
            <PlusIcon />
            New Post
          </button>
        </div>
      </header>

      {/* Tag management panel (op only) */}
      {isOp && showManageTags && (
        <div className="forum-tag-manager">
          <div className="forum-tag-manager-header">
            <span className="forum-tag-manager-title">Available Tags</span>
            <span className="forum-tag-manager-hint">Tags are stored in the channel topic.</span>
          </div>
          <div className="forum-tag-manager-chips">
            {topicTags.length === 0 && (
              <span className="forum-tag-manager-empty">No tags yet. Add one below.</span>
            )}
            {topicTags.map(tag => {
              const c = tagColor(tag);
              return (
                <span
                  key={tag}
                  className="forum-tag-chip"
                  style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
                >
                  {tag}
                  <button
                    className="forum-tag-chip-remove"
                    onClick={() => handleRemoveTopicTag(tag)}
                    aria-label={`Remove tag ${tag}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
          <div className="forum-tag-add-row">
            <input
              ref={newTagInputRef}
              className="forum-tag-add-input"
              type="text"
              placeholder="New tag name…"
              value={newTagInput}
              onChange={e => setNewTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddTopicTag(); if (e.key === 'Escape') setShowManageTags(false); }}
              maxLength={32}
            />
            <button
              className="forum-tag-add-btn"
              onClick={handleAddTopicTag}
              disabled={!newTagInput.trim()}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Post feed */}
      <div className="forum-feed" role="feed">
        {forumError ? (
          <ErrorState
            title="Forum posts are unavailable"
            message="Ocean could not refresh this channel's forum posts from the current connection."
            details={`ForumView failed for ${channelName || 'unknown channel'} while connection status was ${connectionStatus}.`}
            onRetry={reconnectNow}
          />
        ) : forumLoading ? (
          <SkeletonMessage count={5} />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon="[]"
            title={activeTags.size > 0 ? 'No matching posts' : 'No posts yet'}
            description={activeTags.size > 0 ? 'No posts match the selected tags.' : 'Be the first to start a discussion.'}
            action={activeTags.size === 0 ? { label: 'Create Post', onClick: openForumCreate } : undefined}
            size="md"
          />
        ) : (
          sorted.map(post => (
            <PostCard
              key={post.id}
              post={post}
              onClick={() => openThread(post.id)}
            />
          ))
        )}
      </div>

      <style>{`
        .forum-view {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
          background: var(--bg-deep);
        }

        /* ── Header ── */
        .forum-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          padding: 12px 20px;
          border-bottom: 1px solid var(--border-subtle);
          background: var(--bg-elevated, #132131);
          flex-shrink: 0;
          min-height: 56px;
        }

        .forum-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .forum-header-icon {
          font-size: 18px;
          line-height: 1;
          opacity: 0.8;
        }

        .forum-header-title {
          font-size: 16px;
          font-weight: 800;
          color: var(--text-primary);
          letter-spacing: -0.3px;
        }

        .forum-header-controls {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        /* ── Tag filter pills ── */
        .forum-tag-filters {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-wrap: wrap;
        }

        .forum-tag {
          padding: 3px 10px;
          border-radius: 99px;
          font-size: 11px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: background var(--t-fast), color var(--t-fast), border-color var(--t-fast);
          letter-spacing: 0.02em;
          white-space: nowrap;
        }
        .forum-tag:hover {
          filter: brightness(1.15);
        }

        /* ── Sort dropdown ── */
        .forum-sort-wrap {
          position: relative;
        }

        .forum-sort-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          background: var(--bg-overlay);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm);
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
          font-family: inherit;
          cursor: pointer;
          transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
          white-space: nowrap;
        }
        .forum-sort-btn:hover {
          background: var(--bg-float);
          color: var(--text-primary);
          border-color: var(--border-normal);
        }

        .forum-sort-backdrop {
          position: fixed;
          inset: 0;
          z-index: 49;
        }

        .forum-sort-menu {
          position: absolute;
          top: calc(100% + 4px);
          right: 0;
          z-index: 50;
          background: var(--bg-float);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-md);
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          padding: 4px;
          min-width: 160px;
          list-style: none;
          margin: 0;
          animation: forum-pop 0.1s ease both;
        }

        @keyframes forum-pop {
          from { opacity: 0; transform: translateY(-4px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)  scale(1);    }
        }

        .forum-sort-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          width: 100%;
          padding: 7px 10px;
          font-size: 13px;
          font-family: inherit;
          color: var(--text-primary);
          background: none;
          border: none;
          cursor: pointer;
          border-radius: var(--r-sm);
          text-align: left;
          transition: background var(--t-fast);
        }
        .forum-sort-item:hover { background: var(--bg-overlay); }
        .forum-sort-item--active { color: var(--accent); font-weight: 600; }

        /* ── Manage tags button ── */
        .forum-manage-tags-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          background: var(--bg-overlay);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-sm);
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
          font-family: inherit;
          cursor: pointer;
          transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
          white-space: nowrap;
        }
        .forum-manage-tags-btn:hover {
          background: var(--bg-float);
          color: var(--text-primary);
          border-color: var(--border-normal);
        }
        .forum-manage-tags-btn--active {
          border-color: var(--accent-border);
          color: var(--accent);
          background: var(--accent-subtle);
        }

        /* ── Tag manager panel ── */
        .forum-tag-manager {
          padding: 12px 20px;
          border-bottom: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          display: flex;
          flex-direction: column;
          gap: 10px;
          flex-shrink: 0;
        }
        .forum-tag-manager-header {
          display: flex;
          align-items: baseline;
          gap: 10px;
        }
        .forum-tag-manager-title {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .forum-tag-manager-hint {
          font-size: 11px;
          color: var(--text-muted);
        }
        .forum-tag-manager-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
        }
        .forum-tag-manager-empty {
          font-size: 12px;
          color: var(--text-muted);
          font-style: italic;
        }
        .forum-tag-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 8px 3px 10px;
          border-radius: 99px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .forum-tag-chip-remove {
          background: none;
          border: none;
          cursor: pointer;
          color: inherit;
          opacity: 0.6;
          font-size: 14px;
          line-height: 1;
          padding: 0;
          transition: opacity var(--t-fast);
          font-family: inherit;
        }
        .forum-tag-chip-remove:hover { opacity: 1; }
        .forum-tag-add-row {
          display: flex;
          align-items: center;
          gap: 8px;
          max-width: 320px;
        }
        .forum-tag-add-input {
          flex: 1;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: var(--r-xs);
          color: var(--text-primary);
          font-size: 13px;
          font-family: inherit;
          padding: 5px 10px;
          outline: none;
          transition: border-color var(--t-fast);
        }
        .forum-tag-add-input:focus { border-color: var(--accent); }
        .forum-tag-add-input::placeholder { color: var(--text-muted); }
        .forum-tag-add-btn {
          padding: 5px 14px;
          background: var(--accent);
          border: none;
          border-radius: var(--r-xs);
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          color: #fff;
          cursor: pointer;
          transition: opacity var(--t-fast);
          white-space: nowrap;
        }
        .forum-tag-add-btn:hover { opacity: 0.85; }
        .forum-tag-add-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* ── New post button ── */
        .forum-new-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 16px;
          background: var(--accent);
          border: none;
          border-radius: var(--r-sm);
          font-size: 13px;
          font-weight: 700;
          font-family: inherit;
          color: #fff;
          cursor: pointer;
          transition: opacity var(--t-fast), box-shadow var(--t-fast), transform 120ms;
          white-space: nowrap;
          flex-shrink: 0;
          box-shadow: 0 2px 10px var(--accent-glow, rgba(14,165,233,0.35));
        }
        .forum-new-btn:hover {
          opacity: 0.9;
          box-shadow: 0 4px 16px var(--accent-glow, rgba(14,165,233,0.45));
          transform: translateY(-1px);
        }
        .forum-new-btn:active {
          transform: scale(0.97);
          opacity: 1;
        }

        /* ── Feed ── */
        .forum-feed {
          flex: 1;
          overflow-y: auto;
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        /* ── Post card ── */
        .forum-card {
          background: var(--bg-elevated, #132131);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg, 12px);
          padding: 16px 20px;
          cursor: pointer;
          transition:
            background var(--t-fast),
            border-color var(--t-fast),
            box-shadow var(--t-normal, 260ms),
            transform 150ms var(--ease-out, cubic-bezier(0.16,1,0.3,1));
          outline: none;
        }
        .forum-card:hover {
          background: var(--bg-float, #1a2c40);
          border-color: var(--accent-border);
          box-shadow: 0 4px 20px rgba(0,0,0,0.3), 0 1px 4px rgba(0,0,0,0.2);
          transform: translateY(-1px);
        }
        .forum-card:focus-visible {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-subtle);
        }
        .forum-card--pinned {
          border-left: 3px solid var(--gold, #e8b84b);
          background: linear-gradient(135deg,
            rgba(232,184,75,0.04) 0%,
            var(--bg-elevated, #132131) 40%);
        }

        .forum-card-tags {
          display: flex;
          align-items: center;
          gap: 5px;
          flex-wrap: wrap;
          margin-bottom: 9px;
        }

        .forum-card-pinned-badge {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--gold, #e8b84b);
          background: rgba(232,184,75,0.1);
          border: 1px solid rgba(232,184,75,0.25);
          border-radius: var(--r-xs, 3px);
          padding: 2px 7px;
        }

        .forum-card-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0 0 7px;
          line-height: 1.35;
          letter-spacing: -0.15px;
          transition: color var(--t-fast);
        }
        .forum-card:hover .forum-card-title {
          color: var(--accent);
        }

        .forum-card-preview {
          font-size: 13px;
          color: var(--text-muted);
          margin: 0 0 10px;
          line-height: 1.55;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .forum-card-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 12px;
          padding-top: 11px;
          border-top: 1px solid var(--border-subtle);
        }

        .forum-card-author {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }

        .forum-card-nick {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .forum-card-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }

        .forum-card-replies {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          background: var(--bg-float, rgba(26,44,64,0.6));
          padding: 3px 8px;
          border-radius: var(--r-full, 9999px);
          border: 1px solid var(--border-subtle);
        }

        .forum-card-activity {
          font-size: 11px;
          color: var(--text-muted);
        }
        .forum-card-activity strong {
          color: var(--text-secondary);
          font-weight: 600;
        }

        /* ── Empty state ── */
        .forum-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 80px 20px;
          text-align: center;
        }

        .forum-empty-icon {
          font-size: 52px;
          line-height: 1;
          opacity: 0.35;
        }

        .forum-empty-title {
          font-size: 18px;
          font-weight: 800;
          color: var(--text-primary);
          margin: 0;
          letter-spacing: -0.2px;
        }

        .forum-empty-sub {
          font-size: 14px;
          color: var(--text-muted);
          margin: 0;
          max-width: 280px;
          line-height: 1.55;
        }

        .forum-empty-cta {
          margin-top: 8px;
          padding: 9px 22px;
          background: var(--accent);
          border: none;
          border-radius: var(--r-sm);
          font-size: 14px;
          font-weight: 700;
          font-family: inherit;
          color: #fff;
          cursor: pointer;
          transition: opacity var(--t-fast), box-shadow var(--t-fast);
          box-shadow: 0 2px 12px var(--accent-glow, rgba(14,165,233,0.35));
        }
        .forum-empty-cta:hover {
          opacity: 0.88;
          box-shadow: 0 4px 18px var(--accent-glow, rgba(14,165,233,0.45));
        }
      `}</style>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M7 2v10M2 7h10" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M1 3h11M3 6.5h7M5 10h3" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 4h7a3 3 0 0 1 0 6H7" />
      <path d="M3 2L1 4l2 2" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 150ms' }}
    >
      <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6l3 3 5-5" />
    </svg>
  );
}

function TagsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 7l5-5h4a1 1 0 0 1 1 1v4l-5 5z" />
      <circle cx="9.5" cy="3.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}
