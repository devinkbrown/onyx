'use client';

import { useEffect, useRef, useCallback } from 'react';

export interface SlashCommand {
  name: string;
  usage: string;
  description: string;
  category: 'navigation' | 'messaging' | 'account' | 'channel' | 'moderation' | 'voice' | 'developer' | 'fun';
}

export interface SlashCommandMenuProps {
  query: string;
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  onClose: () => void;
  onNavigate: (delta: -1 | 1) => void;
}

// ── Full command registry ──────────────────────────────────────────────────────
export const SLASH_COMMANDS: SlashCommand[] = [
  // Navigation
  { name: 'join',    usage: '/join #channel [key]', description: 'Join a channel',              category: 'navigation' },
  { name: 'part',    usage: '/part [channel] [reason]', description: 'Leave a channel',         category: 'navigation' },
  { name: 'close',   usage: '/close',              description: 'Close current tab',            category: 'navigation' },
  { name: 'back',    usage: '/back',               description: 'Return from away',             category: 'navigation' },
  { name: 'forward', usage: '/forward',            description: 'Mark as back / go forward',    category: 'navigation' },
  // Messaging
  { name: 'me',        usage: '/me action',        description: 'Perform an action (emote)',    category: 'messaging' },
  { name: 'say',       usage: '/say text',         description: 'Send a message literally',     category: 'messaging' },
  { name: 'msg',       usage: '/msg nick text',    description: 'Send a direct message',        category: 'messaging' },
  { name: 'notice',   usage: '/notice nick text', description: 'Send a NOTICE to a nick',      category: 'messaging' },
  { name: 'reply',     usage: '/reply text',       description: 'Reply to last message',        category: 'messaging' },
  { name: 'clear',     usage: '/clear',            description: 'Clear message history locally',category: 'messaging' },
  { name: 'dm',        usage: '/dm nick',          description: 'Open a DM conversation',       category: 'messaging' },
  { name: 'schedule',  usage: '/schedule',         description: 'Schedule a message for later', category: 'messaging' },
  { name: 'shrug',     usage: '/shrug',            description: 'Insert ¯\\_(ツ)_/¯',           category: 'fun' },
  { name: 'tableflip', usage: '/tableflip',        description: 'Insert (╯°□°）╯︵ ┻━┻',       category: 'fun' },
  { name: 'unflip',   usage: '/unflip',            description: 'Insert ┬─┬ ノ( ゜-゜ノ)',      category: 'fun' },
  { name: 'spoiler',  usage: '/spoiler <text>',    description: 'Wrap text in spoiler tags',    category: 'fun' },
  // Account
  { name: 'ns',       usage: '/ns',                description: 'Open account services',        category: 'account' },
  { name: 'identify', usage: '/identify password', description: 'Identify to NickServ',         category: 'account' },
  { name: 'register', usage: '/register email password', description: 'Register your account',  category: 'account' },
  { name: 'ghost',    usage: '/ghost nick',        description: 'Disconnect a stale session',   category: 'account' },
  { name: 'recover',  usage: '/recover nick password', description: 'Recover a nick',           category: 'account' },
  { name: 'nick',     usage: '/nick newnick',      description: 'Change your nickname',         category: 'account' },
  // Channel
  { name: 'cs',      usage: '/cs',                 description: 'Open channel services',        category: 'channel' },
  { name: 'topic',   usage: '/topic text',         description: 'Set channel topic',            category: 'channel' },
  { name: 'invite',  usage: '/invite nick',        description: 'Invite a user to the channel', category: 'channel' },
  { name: 'kick',    usage: '/kick nick [reason]', description: 'Kick a user from the channel', category: 'channel' },
  { name: 'ban',     usage: '/ban mask',           description: 'Ban a hostmask',               category: 'channel' },
  { name: 'unban',   usage: '/unban mask',         description: 'Remove a ban',                 category: 'channel' },
  { name: 'op',      usage: '/op nick',            description: 'Give operator status',         category: 'channel' },
  { name: 'deop',    usage: '/deop nick',          description: 'Remove operator status',       category: 'channel' },
  { name: 'voice',   usage: '/voice nick',         description: 'Give voice (+v)',              category: 'channel' },
  { name: 'devoice', usage: '/devoice nick',       description: 'Remove voice (-v)',            category: 'channel' },
  { name: 'mode',    usage: '/mode modes',         description: 'Set channel or user modes',    category: 'channel' },
  // Moderation
  { name: 'quiet',     usage: '/quiet nick',          description: 'Quiet a user (+q mode)',        category: 'moderation' },
  { name: 'mute',       usage: '/mute nick',           description: 'Mute a user',                  category: 'moderation' },
  { name: 'silence',    usage: '/silence mask',        description: 'Silence a hostmask',           category: 'moderation' },
  { name: 'ignore',     usage: '/ignore nick',         description: 'Ignore a user locally',        category: 'moderation' },
  { name: 'unignore',   usage: '/unignore nick',       description: 'Stop ignoring a user',         category: 'moderation' },
  { name: 'ignorelist', usage: '/ignorelist',          description: 'Open the ignore list',         category: 'moderation' },
  // Voice
  { name: 'deafen',  usage: '/deafen',             description: 'Toggle deafen in voice',       category: 'voice' },
  { name: 'vhost',   usage: '/vhost request|take|off', description: 'Virtual host management',  category: 'voice' },
  { name: 'stage',   usage: '/stage [#channel]',   description: 'Start a stage channel',        category: 'voice' },
  { name: 'endstage', usage: '/endstage',          description: 'End the current stage',        category: 'voice' },
  // Messaging extras
  { name: 'highlight', usage: '/highlight',         description: 'Manage highlight words',       category: 'messaging' },
  { name: 'export',    usage: '/export',            description: 'Export channel history to file', category: 'messaging' },
  // Channel
  { name: 'rules',   usage: '/rules',               description: 'Show server rules',            category: 'channel' },
  // Developer
  { name: 'oper',    usage: '/oper [username]',     description: 'IRC operator login',           category: 'developer' },
  { name: 'raw',     usage: '/raw text',           description: 'Send a raw IRC command',       category: 'developer' },
  { name: 'debug',   usage: '/debug',              description: 'Toggle debug panel',           category: 'developer' },
  { name: 'rawlog',  usage: '/rawlog',             description: 'Toggle raw log viewer',        category: 'developer' },
  { name: 'memo',    usage: '/memo',               description: 'Open memo services',           category: 'developer' },
  { name: 'whois',   usage: '/whois nick',         description: 'Query user information',       category: 'developer' },
  { name: 'away',    usage: '/away [reason]',      description: 'Set away status',              category: 'developer' },
  { name: 'query',   usage: '/query nick',         description: 'Open DM window',               category: 'developer' },
  { name: 'ctcp',    usage: '/ctcp <nick> <type> [data]', description: 'Send a CTCP request',  category: 'developer' },
];

const CATEGORY_LABELS: Record<SlashCommand['category'], string> = {
  navigation:  'Navigation',
  messaging:   'Messaging',
  account:     'Account',
  channel:     'Channel',
  moderation:  'Moderation',
  voice:       'Voice',
  developer:   'Developer',
  fun:         'Fun',
};

const CATEGORY_ORDER: SlashCommand['category'][] = [
  'navigation', 'messaging', 'account', 'channel', 'moderation', 'voice', 'developer', 'fun',
];

// ── Filter + group commands ────────────────────────────────────────────────────
export function filterCommands(query: string): SlashCommand[] {
  if (!query) return SLASH_COMMANDS;
  const q = query.toLowerCase();
  const startsWith = SLASH_COMMANDS.filter(c => c.name.startsWith(q));
  const contains   = SLASH_COMMANDS.filter(c => !c.name.startsWith(q) && c.name.includes(q));
  return [...startsWith, ...contains];
}

function groupByCategory(cmds: SlashCommand[]): Map<SlashCommand['category'], SlashCommand[]> {
  const map = new Map<SlashCommand['category'], SlashCommand[]>();
  for (const cmd of cmds) {
    const bucket = map.get(cmd.category) ?? [];
    bucket.push(cmd);
    map.set(cmd.category, bucket);
  }
  return map;
}

// ── Highlight matched portion of command name ─────────────────────────────────
function HighlightedName({ name, query }: { name: string; query: string }) {
  if (!query) return <span className="scm-cmd-name">/{name}</span>;
  const q = query.toLowerCase();
  const idx = name.toLowerCase().indexOf(q);
  if (idx === -1) return <span className="scm-cmd-name">/{name}</span>;
  return (
    <span className="scm-cmd-name">
      /{name.slice(0, idx)}
      <mark className="scm-match">{name.slice(idx, idx + q.length)}</mark>
      {name.slice(idx + q.length)}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SlashCommandMenu({
  query,
  selectedIndex,
  onSelect,
}: SlashCommandMenuProps) {
  const filtered = filterCommands(query);
  const grouped  = groupByCategory(filtered);
  const listRef  = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Scroll selected item into view
  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleMouseDown = useCallback((e: React.MouseEvent, cmd: SlashCommand) => {
    e.preventDefault();
    onSelect(cmd);
  }, [onSelect]);

  if (filtered.length === 0) return null;

  let flatIdx = 0;
  const rows: React.ReactNode[] = [];

  for (const cat of CATEGORY_ORDER) {
    const cmds = grouped.get(cat);
    if (!cmds || cmds.length === 0) continue;

    rows.push(
      <div key={`cat-${cat}`} className="scm-category-label" role="presentation">
        {CATEGORY_LABELS[cat]}
      </div>
    );

    for (const cmd of cmds) {
      const idx = flatIdx++;
      const isSelected = idx === selectedIndex;
      rows.push(
        <button
          key={cmd.name}
          ref={el => { itemRefs.current[idx] = el; }}
          className={`scm-item${isSelected ? ' scm-item--selected' : ''}`}
          role="option"
          aria-selected={isSelected}
          onMouseDown={e => handleMouseDown(e, cmd)}
          onMouseEnter={() => {
            // Allow mouse hover to visually sync — we don't update selectedIndex
            // to avoid fighting keyboard navigation; parent tracks idx via keyboard
          }}
          tabIndex={-1}
        >
          <HighlightedName name={cmd.name} query={query} />
          <span className="scm-usage">{cmd.usage}</span>
          <span className="scm-description">{cmd.description}</span>
        </button>
      );
    }
  }

  return (
    <div
      ref={listRef}
      className="scm-popup"
      role="listbox"
      aria-label="Slash command suggestions"
    >
      <div className="scm-list">
        {rows}
      </div>
      <div className="scm-footer" aria-hidden="true">
        ↑↓ navigate · Enter select · Esc close
      </div>

      <style>{`
        .scm-popup {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 0;
          width: 320px;
          display: flex;
          flex-direction: column;
          max-height: 240px;
          background: var(--bg-deep);
          backdrop-filter: blur(16px) saturate(1.4);
          -webkit-backdrop-filter: blur(16px) saturate(1.4);
          border: 1px solid var(--border-subtle);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-xl), 0 0 0 1px var(--accent-border);
          overflow: hidden;
          z-index: 60;
          animation: scm-rise 150ms var(--ease-out) both;
        }

        @keyframes scm-rise {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }

        .scm-list {
          overflow-y: auto;
          flex: 1;
          min-height: 0;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          scrollbar-color: var(--accent-border) transparent;
        }
        .scm-list::-webkit-scrollbar { width: 3px; }
        .scm-list::-webkit-scrollbar-thumb {
          background: var(--accent-border);
          border-radius: 2px;
        }

        .scm-category-label {
          padding: 8px 12px 3px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
          pointer-events: none;
          user-select: none;
        }
        .scm-category-label:first-child {
          padding-top: 10px;
        }

        .scm-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          height: 36px;
          padding: 0 12px;
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
          transition: background var(--t-fast);
        }
        .scm-item:hover {
          background: var(--accent-subtle);
        }
        .scm-item--selected {
          background: var(--accent-subtle);
        }
        .scm-item--selected:hover {
          background: rgba(124, 90, 245, 0.14);
        }

        .scm-cmd-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--accent);
          font-family: var(--font-mono);
          flex-shrink: 0;
          min-width: 90px;
          white-space: nowrap;
        }
        .scm-item--selected .scm-cmd-name {
          color: var(--accent-hover);
        }

        .scm-match {
          background: var(--accent-subtle);
          color: inherit;
          border-radius: 2px;
          padding: 0 2px;
        }

        .scm-usage {
          display: none;
        }

        .scm-description {
          font-size: 12px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }
        .scm-item--selected .scm-description {
          color: var(--text-secondary);
        }

        .scm-footer {
          flex-shrink: 0;
          padding: 5px 12px;
          font-size: 10px;
          color: var(--text-muted);
          border-top: 1px solid var(--border-subtle);
          letter-spacing: 0.04em;
          text-align: center;
          background: var(--bg-void);
          user-select: none;
        }
      `}</style>
    </div>
  );
}
