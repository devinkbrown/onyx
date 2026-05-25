'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import type { ActiveView } from '@/lib/store';

// ── Types ──────────────────────────────────────────────────────────────────────

type ResultGroup = 'channel' | 'people' | 'message' | 'command';

interface ChannelResult {
  group: 'channel';
  id: string;
  name: string;
  memberCount: number;
}

interface PeopleResult {
  group: 'people';
  id: string;
  nick: string;
  status: 'online' | 'away' | 'offline';
}

interface MessageResult {
  group: 'message';
  id: string;
  channel: string;
  nick: string;
  text: string;
  time: Date;
  view: ActiveView;
}

interface CommandResult {
  group: 'command';
  id: string;
  command: string;
  description: string;
  action: () => void;
}

type SpotlightResult = ChannelResult | PeopleResult | MessageResult | CommandResult;

// ── Built-in commands ──────────────────────────────────────────────────────────

function buildCommands(store: ReturnType<typeof useOnyxStore.getState>): CommandResult[] {
  return [
    {
      group: 'command', id: 'cmd-settings', command: '/settings',
      description: 'Open settings',
      action: () => store.openSettings(),
    },
    {
      group: 'command', id: 'cmd-theme', command: '/theme',
      description: 'Change theme / appearance',
      action: () => store.openThemeModal(),
    },
    {
      group: 'command', id: 'cmd-friends', command: '/friends',
      description: 'Open friends panel',
      action: () => store.openFriendsPanel(),
    },
    {
      group: 'command', id: 'cmd-channels', command: '/channels',
      description: 'Browse all channels',
      action: () => store.openChannelBrowser(),
    },
    {
      group: 'command', id: 'cmd-keyboard', command: '/keyboard',
      description: 'Show keyboard shortcuts',
      action: () => store.openKeyboardShortcuts(),
    },
    {
      group: 'command', id: 'cmd-bookmarks', command: '/bookmarks',
      description: 'Open bookmarks',
      action: () => store.openBookmarks(),
    },
    {
      group: 'command', id: 'cmd-services', command: '/services',
      description: 'Open NickServ / ChanServ services',
      action: () => store.openServices(),
    },
    {
      group: 'command', id: 'cmd-notifications', command: '/notifications',
      description: 'Open notification center',
      action: () => store.openNotificationCenter(),
    },
  ];
}

// ── Highlight helper ───────────────────────────────────────────────────────────

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Relative time ──────────────────────────────────────────────────────────────

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

// ── Debounce ───────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="8" r="5" />
      <path d="M15 15l-3.5-3.5" />
    </svg>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function SpotlightSearch() {
  const channels      = useOnyxStore(s => s.channels);
  const dms           = useOnyxStore(s => s.dms);
  const awayNicks     = useOnyxStore(s => s.awayNicks);
  const navigate      = useOnyxStore(s => s.navigate);
  const closeSpotlight = useOnyxStore(s => s.closeSpotlight);

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const debouncedQuery = useDebounce(query.trim(), 120);

  const inputRef  = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  // Build all results
  const results = useMemo<SpotlightResult[]>(() => {
    const q = debouncedQuery.toLowerCase();
    const allCommands = buildCommands(useOnyxStore.getState());

    // ── Channels ──
    const channelResults: ChannelResult[] = [];
    for (const ch of channels.values()) {
      if (!q || ch.name.toLowerCase().includes(q) || ch.topic.toLowerCase().includes(q)) {
        channelResults.push({
          group: 'channel',
          id: `ch-${ch.name}`,
          name: ch.name,
          memberCount: ch.users.size,
        });
        if (channelResults.length >= (q ? 12 : 5)) break;
      }
    }

    // ── People (from all channel member lists + DM list) ──
    const seenNicks = new Set<string>();
    const peopleResults: PeopleResult[] = [];

    // DMs first (most relevant)
    for (const dm of dms.values()) {
      if (seenNicks.has(dm.nick.toLowerCase())) continue;
      if (!q || dm.nick.toLowerCase().includes(q) || dm.account?.toLowerCase().includes(q)) {
        seenNicks.add(dm.nick.toLowerCase());
        const isAway = awayNicks.has(dm.nick.toLowerCase());
        peopleResults.push({
          group: 'people',
          id: `people-dm-${dm.nick}`,
          nick: dm.nick,
          status: isAway ? 'away' : 'online',
        });
      }
    }

    // Then channel members
    if (q) {
      for (const ch of channels.values()) {
        for (const user of ch.users.values()) {
          if (seenNicks.has(user.nick.toLowerCase())) continue;
          if (user.nick.toLowerCase().includes(q)) {
            seenNicks.add(user.nick.toLowerCase());
            const isAway = awayNicks.has(user.nick.toLowerCase()) || user.away === true;
            peopleResults.push({
              group: 'people',
              id: `people-${user.nick}`,
              nick: user.nick,
              status: isAway ? 'away' : 'online',
            });
          }
          if (peopleResults.length >= 10) break;
        }
        if (peopleResults.length >= 10) break;
      }
    }

    // ── Messages (last 1000 across channels, 200 per DM) ──
    const messageResults: MessageResult[] = [];
    if (q) {
      // Channel messages — last 1000 total across all channels
      let msgCount = 0;
      outer: for (const ch of channels.values()) {
        const msgs = ch.messages.slice(-Math.ceil(1000 / Math.max(channels.size, 1)));
        for (let i = msgs.length - 1; i >= 0; i--) {
          const msg = msgs[i];
          if (msg.type !== 'msg' && msg.type !== 'action') continue;
          if (msg.text.toLowerCase().includes(q)) {
            messageResults.push({
              group: 'message',
              id: `msg-${ch.name}-${msg.id}`,
              channel: ch.name,
              nick: msg.from,
              text: msg.text,
              time: msg.time,
              view: { kind: 'channel', channel: ch.name },
            });
            msgCount++;
            if (messageResults.length >= 8) break outer;
          }
          msgCount++;
          if (msgCount >= 1000) break outer;
        }
      }

      // DM messages
      for (const dm of dms.values()) {
        if (messageResults.length >= 10) break;
        const msgs = dm.messages.slice(-200);
        for (let i = msgs.length - 1; i >= 0; i--) {
          const msg = msgs[i];
          if (msg.type !== 'msg' && msg.type !== 'action') continue;
          if (msg.text.toLowerCase().includes(q)) {
            messageResults.push({
              group: 'message',
              id: `msg-dm-${dm.nick}-${msg.id}`,
              channel: `DM:${dm.nick}`,
              nick: msg.from,
              text: msg.text,
              time: msg.time,
              view: { kind: 'dm', nick: dm.nick },
            });
            if (messageResults.length >= 10) break;
          }
        }
      }
    }

    // ── Commands ──
    const commandResults: CommandResult[] = q
      ? allCommands.filter(c => c.command.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
      : allCommands.slice(0, 4);

    return [...channelResults, ...peopleResults, ...messageResults, ...commandResults];
  }, [debouncedQuery, channels, dms, awayNicks]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIdx(0);
  }, [results]);

  // Scroll active item into view
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const activate = useCallback((result: SpotlightResult) => {
    if (result.group === 'channel') {
      navigate({ kind: 'channel', channel: result.name });
    } else if (result.group === 'people') {
      navigate({ kind: 'dm', nick: result.nick });
    } else if (result.group === 'message') {
      navigate(result.view);
    } else {
      result.action();
    }
    closeSpotlight();
  }, [navigate, closeSpotlight]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      // Cycle through group boundaries
      const groups: ResultGroup[] = ['channel', 'people', 'message', 'command'];
      const currentGroup = results[activeIdx]?.group;
      if (!currentGroup) return;
      const groupIdx = groups.indexOf(currentGroup);
      const nextGroup = groups[(groupIdx + 1) % groups.length];
      const nextGroupIdx = results.findIndex(r => r.group === nextGroup);
      if (nextGroupIdx >= 0) setActiveIdx(nextGroupIdx);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const result = results[activeIdx];
      if (result) activate(result);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSpotlight();
    }
  }, [results, activeIdx, activate, closeSpotlight]);

  // Group results for section headers
  const groups = useMemo(() => {
    const channelGroup = results.filter((r): r is ChannelResult => r.group === 'channel');
    const peopleGroup  = results.filter((r): r is PeopleResult  => r.group === 'people');
    const messageGroup = results.filter((r): r is MessageResult => r.group === 'message');
    const commandGroup = results.filter((r): r is CommandResult => r.group === 'command');
    return { channelGroup, peopleGroup, messageGroup, commandGroup };
  }, [results]);

  // Build a flat index → result lookup for keyboard nav offset tracking
  const flatIdx = useCallback((result: SpotlightResult) => results.indexOf(result), [results]);

  const q = debouncedQuery;

  return (
    <div className="sl-backdrop" onClick={closeSpotlight} role="dialog" aria-modal aria-label="Spotlight search">
      <div className="sl-modal" onClick={e => e.stopPropagation()}>

        {/* Search input */}
        <div className="sl-input-row">
          <span className="sl-search-icon" aria-hidden><SearchIcon /></span>
          <input
            ref={inputRef}
            className="sl-input"
            type="text"
            placeholder="Search channels, people, messages, commands…"
            value={query}
            onChange={e => { setQuery(e.target.value); }}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
            aria-label="Spotlight search"
            aria-autocomplete="list"
          />
          <kbd className="sl-esc-hint">esc</kbd>
        </div>

        {/* Results */}
        <div className="sl-results">
          {results.length === 0 ? (
            <div className="sl-empty">
              <span className="sl-empty-text">
                No results for <strong>&ldquo;{query}&rdquo;</strong>
              </span>
            </div>
          ) : (
            <>
              {/* Channels */}
              {groups.channelGroup.length > 0 && (
                <div className="sl-group">
                  <div className="sl-group-label">Channels</div>
                  {groups.channelGroup.map(result => {
                    const idx = flatIdx(result);
                    const isSelected = idx === activeIdx;
                    return (
                      <div
                        key={result.id}
                        ref={isSelected ? activeRef : null}
                        className={`sl-result-row${isSelected ? ' sl-selected' : ''}`}
                        onClick={() => activate(result)}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <span className="sl-result-icon sl-icon-channel">#</span>
                        <span className="sl-result-name">
                          <HighlightText text={result.name} query={q} />
                        </span>
                        <span className="sl-result-meta">{result.memberCount} members</span>
                        <span className="sl-result-action">Jump to →</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* People */}
              {groups.peopleGroup.length > 0 && (
                <div className="sl-group">
                  <div className="sl-group-label">People</div>
                  {groups.peopleGroup.map(result => {
                    const idx = flatIdx(result);
                    const isSelected = idx === activeIdx;
                    return (
                      <div
                        key={result.id}
                        ref={isSelected ? activeRef : null}
                        className={`sl-result-row${isSelected ? ' sl-selected' : ''}`}
                        onClick={() => activate(result)}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <span className="sl-people-avatar" aria-hidden>
                          {result.nick.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="sl-result-name">
                          <HighlightText text={result.nick} query={q} />
                        </span>
                        <span className="sl-status-dot" data-status={result.status} aria-label={result.status} />
                        <span className="sl-result-action">Message →</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Messages */}
              {groups.messageGroup.length > 0 && (
                <div className="sl-group">
                  <div className="sl-group-label">Messages</div>
                  {groups.messageGroup.map(result => {
                    const idx = flatIdx(result);
                    const isSelected = idx === activeIdx;
                    const isDirectMessage = result.channel.startsWith('DM:');
                    const displayChannel = isDirectMessage ? result.channel.slice(3) : result.channel;
                    return (
                      <div
                        key={result.id}
                        ref={isSelected ? activeRef : null}
                        className={`sl-result-row sl-msg-row${isSelected ? ' sl-selected' : ''}`}
                        onClick={() => activate(result)}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <span className={`sl-msg-channel${isDirectMessage ? ' sl-msg-dm' : ''}`}>
                          {isDirectMessage ? displayChannel : `#${displayChannel}`}
                        </span>
                        <span className="sl-msg-nick">{result.nick}:</span>
                        <span className="sl-msg-text">
                          <HighlightText text={result.text.slice(0, 120)} query={q} />
                        </span>
                        <span className="sl-msg-time">{relativeTime(result.time)}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Commands */}
              {groups.commandGroup.length > 0 && (
                <div className="sl-group">
                  <div className="sl-group-label">Commands</div>
                  {groups.commandGroup.map(result => {
                    const idx = flatIdx(result);
                    const isSelected = idx === activeIdx;
                    return (
                      <div
                        key={result.id}
                        ref={isSelected ? activeRef : null}
                        className={`sl-result-row${isSelected ? ' sl-selected' : ''}`}
                        onClick={() => activate(result)}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <span className="sl-result-icon sl-icon-command">/</span>
                        <span className="sl-result-name">
                          <HighlightText text={result.command} query={q} />
                        </span>
                        <span className="sl-result-meta">
                          <HighlightText text={result.description} query={q} />
                        </span>
                        <span className="sl-result-action">Run →</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sl-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>tab</kbd> next group</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>

      <style>{`
        .sl-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          z-index: 10000;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          padding-top: 15vh;
          animation: sl-fade-in 150ms ease both;
        }

        @keyframes sl-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        .sl-modal {
          width: 580px;
          max-width: 95vw;
          background: var(--bg-elevated);
          border: 1px solid var(--border-normal);
          border-radius: 14px;
          box-shadow: 0 24px 72px rgba(0, 0, 0, 0.7), 0 0 0 1px var(--accent-border);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          animation: sl-slide-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        @keyframes sl-slide-in {
          from { opacity: 0; transform: scale(0.96) translateY(-8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* Input row */
        .sl-input-row {
          display: flex;
          align-items: center;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-normal);
          gap: 10px;
          flex-shrink: 0;
          background: var(--bg-float);
        }

        .sl-search-icon {
          color: var(--text-muted);
          display: flex;
          flex-shrink: 0;
        }

        .sl-input {
          flex: 1;
          background: none;
          border: none;
          font-size: 18px;
          color: var(--text-normal, var(--text-primary));
          outline: none;
          font-family: inherit;
          caret-color: var(--accent);
          min-width: 0;
        }

        .sl-input::placeholder {
          color: var(--text-muted);
          font-size: 15px;
        }

        .sl-esc-hint {
          font-size: 11px;
          font-family: inherit;
          color: var(--text-muted);
          background: var(--bg-overlay, var(--bg-base));
          border: 1px solid var(--border-subtle);
          border-radius: 3px;
          padding: 1px 6px;
          flex-shrink: 0;
        }

        /* Results scroll area */
        .sl-results {
          max-height: 400px;
          overflow-y: auto;
          padding: 8px 0;
        }

        /* Empty state */
        .sl-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 24px;
          color: var(--text-muted);
        }

        .sl-empty-text {
          font-size: 14px;
        }

        .sl-empty-text strong {
          color: var(--text-secondary);
          font-weight: 600;
        }

        /* Groups */
        .sl-group {
          margin-bottom: 4px;
        }

        .sl-group-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          text-transform: uppercase;
          padding: 8px 16px 4px;
        }

        /* Result rows */
        .sl-result-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 16px;
          cursor: pointer;
          transition: background 0.1s;
          font-size: 14px;
          min-height: 40px;
        }

        .sl-result-row:hover,
        .sl-result-row.sl-selected {
          background: var(--ch-hover-bg, rgba(255, 255, 255, 0.06));
        }

        .sl-result-row.sl-selected {
          background: var(--accent-subtle);
        }

        .sl-result-icon {
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          flex-shrink: 0;
          font-weight: 700;
          font-size: 14px;
        }

        .sl-icon-channel {
          background: rgba(14, 165, 233, 0.12);
          color: var(--accent, #7c5af5);
        }

        .sl-icon-command {
          background: rgba(168, 85, 247, 0.12);
          color: #a855f7;
        }

        .sl-result-name {
          flex: 1;
          font-weight: 500;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }

        .sl-result-meta {
          font-size: 12px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 180px;
        }

        .sl-result-action {
          font-size: 11px;
          color: var(--text-muted);
          opacity: 0;
          white-space: nowrap;
          flex-shrink: 0;
          transition: opacity 0.1s;
        }

        .sl-result-row:hover .sl-result-action,
        .sl-result-row.sl-selected .sl-result-action {
          opacity: 1;
        }

        /* People row */
        .sl-people-avatar {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: var(--accent, #7c5af5);
          opacity: 0.8;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          color: #fff;
          flex-shrink: 0;
        }

        .sl-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .sl-status-dot[data-status="online"]  { background: #22c55e; }
        .sl-status-dot[data-status="away"]    { background: #f59e0b; }
        .sl-status-dot[data-status="offline"] { background: var(--text-muted); }

        /* Message rows */
        .sl-msg-row {
          gap: 6px;
          flex-wrap: nowrap;
          overflow: hidden;
        }

        .sl-msg-channel {
          font-size: 11px;
          font-weight: 700;
          color: var(--accent, #7c5af5);
          white-space: nowrap;
          flex-shrink: 0;
        }

        .sl-msg-dm {
          color: #a855f7;
        }

        .sl-msg-nick {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          white-space: nowrap;
          flex-shrink: 0;
        }

        .sl-msg-text {
          font-size: 13px;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
          min-width: 0;
        }

        .sl-msg-time {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          flex-shrink: 0;
        }

        /* Footer */
        .sl-footer {
          display: flex;
          gap: 16px;
          padding: 8px 16px;
          border-top: 1px solid var(--border-subtle);
          font-size: 11px;
          color: var(--text-muted);
          flex-shrink: 0;
          flex-wrap: wrap;
        }

        .sl-footer kbd {
          background: var(--bg-overlay, var(--bg-base));
          border: 1px solid var(--border-subtle);
          border-radius: 3px;
          padding: 1px 4px;
          font-family: monospace;
          font-size: 10px;
          margin-right: 2px;
        }

        /* Highlight matches — uses accent token so themes apply */
        mark {
          background: var(--accent-subtle);
          color: var(--accent);
          border-radius: 2px;
          padding: 0 2px;
          font-weight: 600;
        }

        @media (max-width: 640px) {
          .sl-footer { display: none; }
          .sl-modal { border-radius: 12px 12px 0 0; }
          .sl-backdrop { align-items: flex-end; padding-top: 0; }
        }
      `}</style>
    </div>
  );
}
