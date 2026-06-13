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
}

export type UserMode = 'q' | 'o' | 'v' | '';

export interface ChannelUser {
  nick: string;
  /** highest mode: q > o > v */
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
  MAXDATA: number;
  COMICCHAT: string;   // e.g. 'DATA' — method used for comic chat signalling
  /** Deprecated compatibility field. Orochi media is gated by caps/NOTE MEDIA, not SUIMYAKUMEDIA. */
  SUIMYAKUMEDIA: string;
  MAXMEDIA: number;
  MEDIAUMODES: string;
  MEDIAMUTE: string;
  /** Deprecated compatibility field. Orochi does not use IRC MEDIAFRAME. */
  MEDIAFRAME: string;
  MEDIACHUNK: number;  // max base64 chars per MCHUNK chunk (0 = not supported)
  SILENCE: number;     // max silence list entries (0 = not supported)
}
