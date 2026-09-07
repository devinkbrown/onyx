// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * operDesk.ts — pure action model for the network operator desk.
 *
 * WIRE TRUTH (ONYX_SERVER_PROTOCOL.md §11, §16): this network does NOT expose
 * the classic oper surface. There is **no `OPER` command** (491 says so — oper
 * status is granted from the SASL account) and there is **no `+w` user-mode
 * WALLOPS**; a network broadcast rides `EVENT BROADCAST :<text>`. Everything
 * here is therefore modelled on the Event Spine verbs the daemon actually
 * implements, never on the ircd-seven/UnrealIRCd verbs a generic client would
 * assume.
 *
 * This module is pure TypeScript with no SolidJS dependency: it turns an intent
 * plus free text into a validated `sendRaw` parameter list, or into a refusal
 * with human copy. `formatIRCLine` already strips CR/LF/NUL at the outbound
 * choke point (parser.ts:225); the validation here is the fail-closed layer in
 * front of it, so a smuggled control byte is REFUSED with an explanation rather
 * than silently truncated onto the wire.
 */

/** Event Spine categories the daemon publishes (ONYX_SERVER_PROTOCOL.md §11). */
export const OPER_EVENT_CATEGORIES = [
  'CONNECT',
  'DISCONNECT',
  'SERVER_LINK',
  'FLOOD',
  'ERROR',
  'ANNOUNCE',
  'OPER_ACTION',
  'KILL',
  'SPAM',
  'DEBUG',
  'POLICY',
  'SERVICE',
  'SECURITY',
] as const;

export type OperEventCategory = (typeof OPER_EVENT_CATEGORIES)[number];

/** OBSERVE action filters — `observe.zig` Action.token() (connect/quit/nick/join/part/host/oper). */
export const OPER_OBSERVE_ACTIONS = [
  'connect',
  'quit',
  'nick',
  'join',
  'part',
  'host',
  'oper',
] as const;

export type OperObserveAction = (typeof OPER_OBSERVE_ACTIONS)[number];

export const MAX_BROADCAST_LENGTH = 400;
/** `observe.zig` Registry.params.max_mask_bytes — longer masks are rejected there. */
export const MAX_OBSERVE_MASK_LENGTH = 256;
/** `kill_relay.max_reason_len` on the daemon — longer reasons are truncated there. */
export const MAX_KILL_REASON_LENGTH = 400;
export const MAX_OPER_NICK_LENGTH = 50;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;

/**
 * One operator intent. Kept as a discriminated union so the UI never hand-rolls
 * a wire line and every new verb has to answer the validator.
 */
export type OperDeskIntent =
  | { kind: 'broadcast'; text: string }
  | { kind: 'event-subscribe'; category: string }
  | { kind: 'event-unsubscribe'; category: string }
  | { kind: 'event-list' }
  | { kind: 'observe'; mask: string; actions?: readonly string[] }
  | { kind: 'observe-list' }
  | { kind: 'observe-off' }
  | { kind: 'rehash' }
  | { kind: 'privs' }
  | { kind: 'kill'; target: string; reason: string };

export type OperDeskIntentKind = OperDeskIntent['kind'];

/** A validated command, ready for `client.sendRaw(command, ...params)`. */
export type OperDeskCommand = {
  command: string;
  params: readonly string[];
  /** Human sentence describing what the network will do. */
  summary: string;
  /** True when the action is visible network-wide or ends someone's session. */
  destructive: boolean;
};

export type OperDeskPlan =
  | { ok: true; command: OperDeskCommand }
  | { ok: false; errors: readonly string[] };

export function isOperEventCategory(value: unknown): value is OperEventCategory {
  return typeof value === 'string'
    && (OPER_EVENT_CATEGORIES as readonly string[]).includes(value);
}

export function isOperObserveAction(value: unknown): value is OperObserveAction {
  return typeof value === 'string'
    && (OPER_OBSERVE_ACTIONS as readonly string[]).includes(value);
}

/**
 * Validate an operator intent and produce the exact wire command.
 *
 * Fail-closed: anything that cannot be expressed as a safe, single IRC line
 * returns `{ ok: false }` with copy the desk can render, and NOTHING is sent.
 */
export function planOperAction(intent: OperDeskIntent): OperDeskPlan {
  switch (intent.kind) {
    case 'broadcast': {
      const errors: string[] = [];
      const text = normalizeFreeText(intent.text, MAX_BROADCAST_LENGTH, 'broadcast', errors);
      if (!text) {
        if (errors.length === 0) errors.push('Write the announcement first.');
        return { ok: false, errors };
      }
      return {
        ok: true,
        command: {
          command: 'EVENT',
          params: ['BROADCAST', text],
          summary: `Announce to operators subscribed to ANNOUNCE: “${text}”.`,
          destructive: true,
        },
      };
    }

    case 'event-subscribe':
    case 'event-unsubscribe': {
      const category = normalizeCategory(intent.category);
      if (!category) {
        return { ok: false, errors: ['Pick a category from the Event Spine list.'] };
      }
      const subscribing = intent.kind === 'event-subscribe';
      return {
        ok: true,
        command: {
          command: 'EVENT',
          params: [subscribing ? 'ADD' : 'DEL', category],
          summary: subscribing
            ? `Receive ${category} events from every node on the network.`
            : `Stop receiving ${category} events.`,
          destructive: false,
        },
      };
    }

    case 'event-list':
      return {
        ok: true,
        command: {
          command: 'EVENT',
          params: ['LIST'],
          summary: 'List the Event Spine categories this session is subscribed to.',
          destructive: false,
        },
      };

    case 'observe': {
      const mask = normalizeMask(intent.mask);
      if (!mask) {
        return { ok: false, errors: ['Enter a nick!user@host mask, wildcards allowed.'] };
      }
      const actions = normalizeObserveActions(intent.actions);
      if (actions === null) {
        return { ok: false, errors: ['Pick from connect, quit, nick, join, part, host, or oper.'] };
      }
      return {
        ok: true,
        command: {
          command: 'EVENT',
          params: ['OBSERVE', mask, ...actions],
          summary: actions.length > 0
            ? `Watch ${mask} network-wide for ${actions.join(', ')}. Their real host is revealed to you.`
            : `Watch ${mask} network-wide. Their real host is revealed to you.`,
          destructive: false,
        },
      };
    }

    case 'observe-list':
      return {
        ok: true,
        command: {
          command: 'EVENT',
          params: ['OBSERVE', 'LIST'],
          summary: 'List the standing OBSERVE masks on this session.',
          destructive: false,
        },
      };

    case 'observe-off':
      return {
        ok: true,
        command: {
          command: 'EVENT',
          params: ['OBSERVE', 'OFF'],
          summary: 'Clear every standing OBSERVE mask on this session.',
          destructive: false,
        },
      };

    case 'rehash':
      return {
        ok: true,
        command: {
          command: 'REHASH',
          params: [],
          summary: 'Ask this node to reload its configuration (382 confirms).',
          destructive: true,
        },
      };

    case 'privs':
      return {
        ok: true,
        command: {
          command: 'PRIVS',
          params: [],
          summary: 'Show the operator privileges this session holds (270).',
          destructive: false,
        },
      };

    case 'kill': {
      const errors: string[] = [];
      const target = normalizeNick(intent.target);
      if (!target) errors.push('Enter the nickname to disconnect.');
      const reason = normalizeFreeText(intent.reason, MAX_KILL_REASON_LENGTH, 'reason', errors);
      // A KILL without a reason is unaccountable; the network log keeps it, so
      // the desk requires one rather than shipping a bare disconnect.
      if (!reason && errors.length === 0) errors.push('A reason is required — it is recorded network-wide.');
      if (!target || !reason) return { ok: false, errors };
      return {
        ok: true,
        command: {
          command: 'KILL',
          params: [target, reason],
          summary: `Disconnect ${target} from the network with the reason “${reason}”.`,
          destructive: true,
        },
      };
    }

    default: {
      const _exhaustive: never = intent;
      return { ok: false, errors: [`Unsupported operator action: ${String(_exhaustive)}`] };
    }
  }
}

/**
 * Map a composer slash command to an operator intent, or `null` when the verb
 * is not an operator command (the caller then falls through to its generic
 * handling). Pure: it only shapes the intent — `planOperAction` still owns
 * every bound and refusal, so there is one validation path for the desk UI and
 * the composer alike.
 */
export function parseOperSlashCommand(
  name: string,
  args: readonly string[],
): OperDeskIntent | null {
  const verb = typeof name === 'string' ? name.trim().toLowerCase() : '';
  const rest = args.join(' ');
  const first = (args[0] ?? '').trim().toLowerCase();

  switch (verb) {
    // `/wallops` is a familiar alias only; the wire verb is EVENT BROADCAST.
    case 'broadcast':
    case 'wallops':
      return { kind: 'broadcast', text: rest };
    case 'kill':
      return { kind: 'kill', target: args[0] ?? '', reason: args.slice(1).join(' ') };
    case 'rehash':
      return { kind: 'rehash' };
    case 'privs':
      return { kind: 'privs' };
    case 'events': {
      if (first === 'add') return { kind: 'event-subscribe', category: args[1] ?? '' };
      if (first === 'del' || first === 'remove') {
        return { kind: 'event-unsubscribe', category: args[1] ?? '' };
      }
      return { kind: 'event-list' };
    }
    case 'observe': {
      if (first === '' || first === 'list') return { kind: 'observe-list' };
      if (first === 'off' || first === 'clear') return { kind: 'observe-off' };
      return { kind: 'observe', mask: args[0] ?? '', actions: args.slice(1) };
    }
    default:
      return null;
  }
}

/** Category label suitable for a control, e.g. `SERVER_LINK` → `Server link`. */
export function operEventCategoryLabel(category: string): string {
  const words = category.replace(/_/gu, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function normalizeCategory(value: string): OperEventCategory | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return isOperEventCategory(upper) ? upper : null;
}

function normalizeObserveActions(
  value: readonly string[] | undefined,
): readonly OperObserveAction[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const seen = new Set<OperObserveAction>();
  for (const raw of value) {
    const action = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!isOperObserveAction(action)) return null;
    seen.add(action);
  }
  // Emit in the documented order so the same selection is always one wire line.
  return OPER_OBSERVE_ACTIONS.filter((action) => seen.has(action));
}

function normalizeMask(value: string): string | null {
  if (typeof value !== 'string') return null;
  const mask = value.trim();
  if (
    !mask
    || mask.length > MAX_OBSERVE_MASK_LENGTH
    || CONTROL_CHARS.test(mask)
    || /\s/u.test(mask)
    || mask.startsWith(':')
  ) return null;
  // A mask of pure wildcards observes the whole network and floods the session.
  if (mask.replace(/[*?!@.]/gu, '').length === 0) return null;
  return mask;
}

function normalizeNick(value: string): string | null {
  if (typeof value !== 'string') return null;
  const nick = value.trim();
  if (
    !nick
    || nick.length > MAX_OPER_NICK_LENGTH
    || CONTROL_CHARS.test(nick)
    || /[\s,:*?!@]/u.test(nick)
  ) return null;
  return nick;
}

function normalizeFreeText(
  value: string,
  max: number,
  label: string,
  errors: string[],
): string | null {
  if (typeof value !== 'string') return null;
  if (CONTROL_CHARS.test(value)) {
    errors.push(`The ${label} cannot include line breaks or control characters.`);
    return null;
  }
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) {
    errors.push(`Keep the ${label} under ${max} characters.`);
    return null;
  }
  return text;
}
