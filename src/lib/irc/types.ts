// IRC protocol types

export interface IRCMessage {
  tags: Record<string, string>;
  prefix: string | null;
  nick: string | null;     // extracted from prefix
  host: string | null;     // extracted from prefix
  command: string;
  params: string[];
  raw: string;
}

export type StandardReplyKind = 'NOTE' | 'FAIL' | 'WARN';

export interface StandardReply {
  kind: StandardReplyKind;
  command: string;
  code: string;
  context: string[];
  description: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type MessageType =
  | 'msg'
  | 'action'
  | 'notice'
  | 'join'
  | 'part'
  | 'quit'
  | 'kick'
  | 'mode'
  | 'topic'
  | 'nick'
  | 'system'
  | 'error'
  | 'whisper';

export interface MessageReaction {
  emoji: string;
  /** nicks who reacted */
  users: string[];
}

export interface ChatMessage {
  id: string;
  time: Date;
  from: string;
  text: string;
  type: MessageType;
  /** true when the message mentions our nick */
  highlight?: boolean;
  /** raw target (channel or nick) */
  target: string;
  /** emoji reactions on this message */
  reactions?: MessageReaction[];
  /** message being replied to */
  replyTo?: { id: string; from: string; text: string };
  /** true if the message was edited */
  edited?: boolean;
  /** true if the message was deleted */
  deleted?: boolean;
  /** true if the message was redacted via IRCv3 REDACT */
  redacted?: boolean;
  /** true while the message sits in the offline outbox (not yet sent) */
  pending?: boolean;
  /** true for an end-to-end-encrypted DM: `text` ALWAYS holds the Tsumugi
   *  ciphertext envelope (so the wire, CHATHISTORY and the vault only ever
   *  carry ciphertext). The decrypted view text lives in `plaintext`. */
  encrypted?: boolean;
  /** Decrypted body of an `encrypted` DM — transient, view-only, NEVER
   *  persisted (the vault strips it). Absent = not yet / can't decrypt. */
  plaintext?: string;
}

/**
 * Channel member status mode letters, per Orochi's
 * `ISUPPORT PREFIX=(YQqov)*!.@+`:
 *   Y → '*' network-operator (server-derived, render-only; never set via MODE)
 *   Q → '!' founder   (channel creator; ops/owners cannot strip)
 *   q → '.' owner
 *   o → '@' op
 *   v → '+' voice
 * Empty string represents no status. The wire prefix map is server-driven
 * (parsed from 005 PREFIX); these letters are the authoritative defaults.
 */
export type UserMode = 'Y' | 'Q' | 'q' | 'o' | 'v' | '';

export interface ChannelUser {
  nick: string;
  /** status modes held (e.g. {'Q'}, {'o','v'}); highest: Y > Q > q > o > v */
  modes: Set<string>;
  away?: boolean;
  account?: string;
}

export interface Channel {
  name: string;
  topic: string;
  topicSetBy: string;
  topicSetAt: Date | null;
  modes: string;
  users: Map<string, ChannelUser>;
  /** number of unread messages */
  unread: number;
  /** unread highlights */
  highlights: number;
  /** channel creation time from 329 */
  createdAt: Date | null;
  /** message history (Onyx-specific) */
  messages: ChatMessage[];
  /** IRCX PROP values */
  props?: Record<string, string>;
}

export interface ISupport {
  PREFIX: Record<string, string>;   // mode → prefix char, e.g. { q:'~', o:'@', v:'+' }
  PREFIX_MODES: Record<string, string>; // prefix char → mode letter, e.g. { '@':'o' }
  CHANMODES: string[];
  CHANTYPES: string;
  CHANLIMITS: Record<string, number>;
  NETWORK: string;
  CASEMAPPING: string;
  MODES: number;
  MAXCHANNELS: number;
  NICKLEN: number;
  TOPICLEN: number;
  IRCX: boolean;
  /**
   * Deprecated compatibility field — Orochi advertises NO media ISUPPORT token.
   * Voice/video availability is gated by the store's `mediaAvailable` selector
   * (set on 001 / NOTE MEDIA), not a 005 token. Retained only because a
   * non-media feature badge in HomeView still reads it; never set from 005.
   */
  SILENCE: number;     // max silence list entries (0 = not supported)
  /** base64url Web Push VAPID public key (ISUPPORT `VAPID=`); '' = no push */
  VAPID: string;
}
