// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  buildSessionResumeLine,
  isValidSessionCredential,
  parseCHANLIMIT,
  parseIRCMessage,
  formatIRCLine,
  formatTaggedLine,
  parsePREFIX,
  selectSaslMechanism,
  splitWireFrame,
  type SaslMechanism,
} from './parser';
import type { IRCMessage, ISupport } from './types';
import { AccountAttribution } from './attribution';
import { serializeWatchTogetherProp } from '../media/watchTogetherController';
import type { WatchTogetherActivity } from '../media/watchTogether';

/** IRCX channel PROP key carrying the watch-together activity (wire format). */
const WATCH_PROP = 'ocean.watch';
const SASL_CHUNK_BYTES = 400;
// Browser WebSocket has no buffered-amount-low event. Keep one generous bound
// around the send queue: ordinary IRC lines are tiny, while an 8 MiB allowance
// can hold two maximum-size media messages without permitting unbounded growth.
const MAX_WEBSOCKET_BUFFERED_BYTES = 8 * 1024 * 1024;
/** IRCv3's text-only WebSocket contract for interoperable fallback servers. */
const IRC_WEBSOCKET_SUBPROTOCOL = 'text.ircv3.net';
/** Onyx multiplexes IRC text and binary Cadence media on one WebSocket. */
const ONYX_MEDIA_WEBSOCKET_SUBPROTOCOL = 'onyx.irc-media.v1';
const WEBSOCKET_SUBPROTOCOLS = [
  ONYX_MEDIA_WEBSOCKET_SUBPROTOCOL,
  IRC_WEBSOCKET_SUBPROTOCOL,
] as const;
const MAX_INBOUND_TEXT_BYTES = 1024 * 1024;
// Exact Onyx Server per-message and fragmented-aggregate media ceiling.
const MAX_BINARY_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_OUTBOUND_TEXT_BYTES = 1024 * 1024;
export const MAX_CLIENT_CAP_ENTRIES = 256;
export const MAX_CLIENT_CAP_NAME_LENGTH = 128;
export const MAX_CLIENT_CAP_VALUE_LENGTH = 4 * 1024;
export const MAX_CLIENT_SASL_MECHANISMS = 16;
const MAX_CLIENT_SASL_MECHANISM_LENGTH = 64;
export const MAX_CLIENT_LIST_ROWS = 2_048;
export const MAX_CLIENT_LIST_CHANNEL_LENGTH = 512;
export const MAX_CLIENT_LIST_TOPIC_LENGTH = 4 * 1024;
export const MAX_CLIENT_ISUPPORT_TOKENS = 256;
export const MAX_CLIENT_ISUPPORT_KEY_LENGTH = 64;
export const MAX_CLIENT_ISUPPORT_VALUE_LENGTH = 1024;
const MAX_CLIENT_ISUPPORT_NUMBER = 1_000_000;

function parseIsupportPositiveInt(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAX_CLIENT_ISUPPORT_NUMBER
    ? parsed
    : null;
}

function parseIsupportChannelTypes(value: string): string | null {
  if (
    value.length === 0
    || value.length > 16
    // Keep routing to the interoperable channel sigils Onyx supports. Letting
    // letters or nick-special characters into this set can reclassify DMs as
    // rooms throughout the client.
    || !/^[#&+!]+$/u.test(value)
    || new Set(value).size !== value.length
  ) return null;
  return value;
}

function parseIsupportChannelModes(value: string): string[] | null {
  const groups = value.split(',');
  if (
    groups.length !== 4
    || groups.some((group) => group.length > 64 || !/^[A-Za-z]*$/u.test(group))
  ) return null;
  const modes = groups.join('');
  if (new Set(modes).size !== modes.length) return null;
  return groups;
}

function parseAdvertisedCap(token: string): { name: string; value: string } | null {
  const eqIdx = token.indexOf('=');
  const name = eqIdx === -1 ? token : token.slice(0, eqIdx);
  const value = eqIdx === -1 ? '' : token.slice(eqIdx + 1);
  if (
    !name
    || name.length > MAX_CLIENT_CAP_NAME_LENGTH
    || value.length > MAX_CLIENT_CAP_VALUE_LENGTH
    || /[\u0000-\u0020\u007f,]/u.test(name)
    || /[\u0000-\u0020\u007f]/u.test(value)
  ) return null;
  return { name, value };
}

function parseSaslMechanisms(value: string): string[] {
  const mechanisms: string[] = [];
  for (const mechanism of value.split(',')) {
    if (
      mechanisms.length >= MAX_CLIENT_SASL_MECHANISMS
      || !mechanism
      || mechanism.length > MAX_CLIENT_SASL_MECHANISM_LENGTH
      || !/^[A-Za-z0-9_-]+$/u.test(mechanism)
    ) continue;
    if (!mechanisms.includes(mechanism)) mechanisms.push(mechanism);
  }
  return mechanisms;
}

function hasWebSocketSendCapacity(ws: WebSocket, payloadBytes: number): boolean {
  const bufferedBytes = ws.bufferedAmount;
  return Number.isFinite(bufferedBytes)
    && bufferedBytes >= 0
    && payloadBytes <= MAX_WEBSOCKET_BUFFERED_BYTES - bufferedBytes;
}

/**
 * SASL AUTHENTICATE payloads carry credentials: the base64 PLAIN blob decodes
 * straight back to the user's password, and the SCRAM/EXTERNAL exchange chunks
 * are auth-exchange internals. They must never reach the raw-log sink (a 500-line
 * in-memory buffer rendered in the raw-log UI) even though the real bytes still
 * go on the wire. Only the two non-secret shapes stay visible so the log remains
 * useful: the empty continuation `AUTHENTICATE +` and the bare mechanism-select
 * line (`AUTHENTICATE PLAIN` / `SCRAM-SHA-256` / `EXTERNAL`). Anything else — any
 * base64 chunk, in either direction — is redacted.
 */
function redactSensitiveLineForLog(line: string): string {
  // The parser removes NULs before command dispatch. Classify the same logical
  // spelling so a NUL-split sensitive token cannot be logged and then become a
  // valid command downstream. The original bytes still go to wire/parser.
  line = line.replaceAll('\0', '');
  const containsSensitiveToken = /(?:^|[\s:\r\n])(?:AUTHENTICATE|E2EEGROUP|E2EE\.KEYPACKAGE|E2EE\.COMMIT|E2EE\.WELCOME|E2EEKEY)(?=$|[\s:\r\n])/iu;
  let cursor = line.trimStart();
  if (cursor.startsWith('@')) {
    const end = cursor.indexOf(' ');
    if (end < 0) return /E2EE|AUTHENTICATE/iu.test(cursor) ? '<sensitive> <redacted>' : line;
    cursor = cursor.slice(end + 1).trimStart();
  }
  if (cursor.startsWith(':')) {
    const end = cursor.indexOf(' ');
    if (end < 0) return /E2EE|AUTHENTICATE/iu.test(cursor) ? '<sensitive> <redacted>' : line;
    cursor = cursor.slice(end + 1).trimStart();
  }
  const boundary = cursor.search(/\s/u);
  const command = (boundary < 0 ? cursor : cursor.slice(0, boundary)).toUpperCase();
  const rest = boundary < 0 ? '' : cursor.slice(boundary).trimStart();

  if (command === 'AUTHENTICATE') {
    const arg = rest;
  // Only the mechanisms this client can actually select are safe to expose.
  // A shape-based uppercase test leaks valid unpadded base64 such as
  // `QUJDREVGR0hJSktM`, which is indistinguishable from a made-up mechanism.
    if (arg === '+' || arg === 'PLAIN' || arg === 'SCRAM-SHA-256' || arg === 'EXTERNAL') return line;
    return 'AUTHENTICATE <redacted>';
  }

  if (command === 'E2EEGROUP' || command === 'E2EE.KEYPACKAGE'
    || command === 'E2EE.COMMIT' || command === 'E2EE.WELCOME' || command === 'E2EEKEY') {
    return `${command} <redacted>`;
  }
  if (command === 'NOTICE') {
    const trailing = rest.startsWith(':')
      ? rest.slice(1)
      : rest.includes(' :') ? rest.slice(rest.indexOf(' :') + 2) : rest.replace(/^\S+\s+:?/u, '');
    if (/^E2EEKEY(?:\s|$)/iu.test(trailing)) return 'NOTICE E2EEKEY <redacted>';
  }
  if (command === 'FAIL' || command === 'WARN' || command === 'NOTE') {
    const subject = rest.match(/^:?([^\s]+)/u)?.[1]?.toUpperCase();
    if (subject === 'E2EEGROUP' || subject === 'E2EEKEY') return `${command} ${subject} <redacted>`;
  }
  // Fail closed for malformed or multiply-prefixed sensitive-looking lines.
  // This is a log-copy policy only: parsing and wire delivery still receive
  // the original bytes.
  return containsSensitiveToken.test(line) ? '<sensitive> <redacted>' : line;
}

/** RFC 4616 SASL PLAIN fields are UTF-8; btoa itself accepts Latin-1 only. */
function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Length-independent, content-constant-time comparison of two base64 strings.
 * Used to check the SCRAM ServerSignature so a mismatch cannot be probed by
 * timing. (For a fixed-size HMAC the two sides are always the same length on a
 * genuine server, so the early length branch leaks nothing about the secret.)
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type IRCEventHandler = (msg: IRCMessage) => void;
export type RawHandler = (line: string, direction: 'in' | 'out') => void;

/** One row of a LIST reply (numeric 322). */
export interface ChannelListRow {
  channel: string;
  users: number;
  topic: string;
}

export interface IRCClientOptions {
  url: string;           // e.g. wss://eshmaki.me:8080
  nick: string;
  realname?: string;
  username?: string;
  password?: string;     // SASL PLAIN password
  sessionToken?: string; // Onyx Server SESSION RESUME token (local node)
  meshToken?: string;    // Onyx Server mesh-sealed reclaim token (any node)
  hasClientCert?: boolean;
  /** called for every parsed message */
  onMessage: IRCEventHandler;
  /** called for every inbound binary WebSocket frame (browser media datagrams) */
  onBinary?: (data: Uint8Array) => void;
  onRaw?: RawHandler;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onError?: (err: string) => void;
  onNickChanged?: (newNick: string) => void;
}

const RECONNECT_BASE = 2000;

export class IRCClient {
  private ws: WebSocket | null = null;
  private opts: IRCClientOptions;
  /**
   * The nick passed to the constructor — never mutated even when the server
   * sends 433 and we fall back to kain_. Used as the SASL authcid so PLAIN
   * and SCRAM always identify against the original nick/account.
   */
  private _authNick: string;
  private reconnectDelay = RECONNECT_BASE;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Monotonic owner for delayed work tied to one concrete WebSocket. */
  private _socketGeneration = 0;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;
  private _registered = false;
  /** True once SASL has succeeded (903). Allows a fresh session to request a resume token. */
  private _loggedIn = false;
  /** Prevent duplicate post-registration SESSION commands on one connection. */
  private _sessionCommandsSent = false;
  private _saslPending = false;
  private _capNegotiating = true;
  private _capReqPending = 0;
  private _capReqPendingNames = new Set<string>();
  /** Accumulated caps across multiline CAP LS responses */
  private _capAvailable: string[] = [];
  /** Available SASL mechanisms parsed from sasl cap value */
  private _saslMechs: string[] = [];
  /** Which SASL mechanism we're using */
  private _saslMech: SaslMechanism | null = null;
  /** SCRAM state between challenge/response steps. `expectedServerSig` is set
   *  once client-final has been sent: it is the base64 ServerSignature we expect
   *  the server to echo in its server-final `v=`, precomputed so the discrete
   *  server-final AUTHENTICATE line can be verified SYNCHRONOUSLY (no async race
   *  against the 903 that immediately follows it). */
  private _scramState:
    | { clientFirstMsgBare: string; nonce: string; hash: 'SHA-256'; bits: number; expectedServerSig?: string }
    | null = null;
  /** How many times we've appended _ to nick during registration */
  private _nickRetries = 0;
  /** SASL auth timeout guard */
  private _saslTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Account-attribution controller (enroll device signing key + publish the
   * login-time residence proof). Purely additive: it acts only when the
   * server advertises `ISUPPORT ACCOUNTRESIDENCE=` AND 900 RPL_LOGGEDIN named
   * the account; otherwise it never sends a byte (conservative UID path).
   */
  private _attribution: AccountAttribution;
  /** In-flight LIST collection (see list()). */
  private _listPending: {
    rows: ChannelListRow[];
    seen: Set<string>;
    resolve: (rows: ChannelListRow[]) => void;
    promise: Promise<ChannelListRow[]>;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  /** Caps that were ACKed by the server — readable by the store */
  public negotiatedCaps = new Set<string>();
  /** Cap values advertised via CAP LS / CAP NEW (key=value form). Empty string if no value. */
  public capValues = new Map<string, string>();
  /** Optional listener notified whenever capValues / negotiatedCaps change (CAP ACK/NEW/DEL). */
  public onCapChange: (() => void) | null = null;
  /**
   * Auxiliary message subscribers fired in addition to the primary
   * `opts.onMessage` handler. Used by feature hooks (e.g. whiteboard)
   * that need to observe inbound IRC messages without owning the
   * primary store handler.
   */
  public extraMessageHandlers: Set<IRCEventHandler> = new Set();
  /**
   * Auxiliary binary-frame subscribers, fired in addition to `opts.onBinary`.
   * The media engine registers here to receive browser media datagrams without
   * owning the primary `onBinary` option.
   */
  public binaryHandlers: Set<(data: Uint8Array) => void> = new Set();

  isupport: ISupport = {
    // Defaults mirror Onyx Server's ISUPPORT PREFIX=(YQqov)*!.@+ (founder Q/'!',
    // owner q/'.', op o/'@', voice v/'+', plus the render-only oper Y/'*').
    // The reverse map also accepts standard IRC admin/halfop prefixes so a
    // NAMES burst received before 005 still keeps &admin / %halfop status.
    // Overwritten verbatim from 005 PREFIX on connect.
    PREFIX: { Y: '*', Q: '!', q: '.', a: '&', o: '@', h: '%', v: '+' },
    PREFIX_MODES: { '*': 'Y', '!': 'Q', '.': 'q', '~': 'q', '&': 'a', '@': 'o', '%': 'h', '+': 'v' },
    // Onyx Server defaults (overwritten from 005 on connect):
    //   CHANMODES=beIZ,k,lfj,imnstCTNMSgWOA, CHANTYPES=#&, CASEMAPPING=ascii,
    //   NICKLEN=64, TOPICLEN=390, CHANLIMIT=#&:50, MONITOR=128, SILENCE=32.
    CHANMODES: ['beIZ', 'k', 'lfj', 'imnstCTNMSgWOA'],
    CHANTYPES: '#&',
    CHANLIMITS: {},
    NETWORK: 'Onyx',
    CASEMAPPING: 'ascii',
    MODES: 4,
    MAXCHANNELS: 50,
    NICKLEN: 64,
    TOPICLEN: 390,
    IRCX: false,
    SILENCE: 0,          // SILENCE=20 — max entries in server-side silence list
    VAPID: '',           // VAPID=<key> — Web Push server key (empty = push off)
  };

  /** Map prefix char → mode letter, e.g. '@' → 'o'. Onyx Server: (YQqov)*!.@+ */
  prefixToMode: Record<string, string> = {
    '*': 'Y',
    '!': 'Q',
    '.': 'q',
    '~': 'q',
    '&': 'a',
    '@': 'o',
    '%': 'h',
    '+': 'v',
  };
  /** Map mode letter → prefix char (used for display). Onyx Server: (YQqov)*!.@+ */
  modeToPrefix: Record<string, string> = { Y: '*', Q: '!', q: '.', a: '&', o: '@', h: '%', v: '+' };

  constructor(opts: IRCClientOptions) {
    // Fail-closed at construction: a caller-supplied bearer that would not
    // survive isValidSessionCredential must never sit in opts. Construction-
    // time garbage used to only be refused at SESSION RESUME send time; drop
    // it here so updateResumeTokens merges, clearResumeTokens, and any mid-
    // session inspection all see the same sanitized view.
    this.opts = {
      ...opts,
      sessionToken: isValidSessionCredential(opts.sessionToken) ? opts.sessionToken : undefined,
      meshToken: isValidSessionCredential(opts.meshToken) ? opts.meshToken : undefined,
    };
    this._attribution = new AccountAttribution(this, opts.url);
    // Save before any nick mutations (433 collision appends '_')
    this._authNick = opts.nick;
  }

  connect(): boolean {
    if (this._destroyed) return false;
    // The IRCClient instance is deliberately reused by the store on reconnect.
    // Advance the owner before tearing down the old socket so delayed work can
    // distinguish socket A from its replacement socket B.
    this._socketGeneration++;
    // Never run two sockets in parallel. Tear down any prior socket first, and
    // detach its handlers so its close event can't trigger another reconnect.
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onclose = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch { /* already closing */ }
      this.ws = null;
    }
    // Re-attempt the canonical nick on every fresh connection. A prior 433
    // fallback mutates opts.nick to an alias (e.g. "kain_"); without this reset
    // each reconnect would re-register under the alias forever and never
    // reclaim the real nick.
    this.opts.nick = this._authNick;
    this._registered = false;
    this._loggedIn = false;
    this._sessionCommandsSent = false;
    this._saslPending = false;
    this._capNegotiating = true;
    this._capReqPending = 0;
    this._capReqPendingNames = new Set();
    this._capAvailable = [];
    this._saslMechs = [];
    this._saslMech = null;
    this._scramState = null;
    this._nickRetries = 0;
    this.negotiatedCaps = new Set();
    this.capValues = new Map();
    // Fresh connection: forget the previous connection's attribution state
    // (the account and home node are re-learned from 900 + ISUPPORT).
    this._attribution.reset();
    // Resolve any LIST left hanging by the previous connection.
    this._finishList();
    if (this._saslTimer) { clearTimeout(this._saslTimer); this._saslTimer = null; }
    // Clear ping timers from any prior connection before opening a new socket.
    // Without this, a stale pongTimeout fires on the brand-new WebSocket.
    this._clearPingTimers();

    try {
      const ws = new WebSocket(this.opts.url, [...WEBSOCKET_SUBPROTOCOLS]);
      this.ws = ws;
      // Browser media datagrams ride binary frames on this same socket; deliver
      // them as ArrayBuffers (not Blobs) so onBinary gets bytes synchronously.
      ws.binaryType = 'arraybuffer';
      // Event callbacks can already be queued when reconnect replaces a
      // CONNECTING socket. Bind every callback to its originating socket so a
      // stale open/message/close/error can never act on the replacement.
      ws.onopen = () => {
        if (this.ws === ws) this._onOpen();
      };
      ws.onmessage = (event) => {
        if (this.ws === ws) this._onMessage(event);
      };
      ws.onclose = (event) => {
        if (this.ws === ws) this._onClose(event);
      };
      ws.onerror = (event) => {
        if (this.ws === ws) this._onError(event);
      };
      return true;
    } catch (e) {
      this.opts.onError?.(`WebSocket error: ${e}`);
      return false;
    }
  }

  destroy() {
    this._destroyed = true;
    this._attribution.stop();
    this._clearTimers();
    if (this.ws) {
      // Null handlers first so _onClose cannot fire onDisconnected after destroy.
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Attempt one ordered IRC frame. `true` means WebSocket.send returned while
   * the socket was still OPEN; rejected/raced sends are reported and return
   * false, never appearing in the raw log as accepted outbound traffic.
   */
  send(line: string): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.opts.onError?.('Message was not sent: the connection is not open.');
      return false;
    }

    // `text.ircv3.net` carries exactly one unterminated IRC line per text
    // message. Onyx's own protocol keeps the legacy CRLF framing because it
    // also multiplexes binary Cadence media on this socket.
    const lineBody = line.endsWith('\r\n') ? line.slice(0, -2) : line;
    if (lineBody.includes('\r') || lineBody.includes('\n')) {
      this.opts.onError?.(ws.protocol === IRC_WEBSOCKET_SUBPROTOCOL
        ? 'Message was not sent: text.ircv3.net requires exactly one IRC line per frame.'
        : 'Message was not sent: IRC WebSocket frames require exactly one IRC line.');
      return false;
    }
    const payload = ws.protocol === IRC_WEBSOCKET_SUBPROTOCOL ? lineBody : line;

    // Fast character bound avoids allocating another huge buffer just to learn
    // that a hostile/accidental line cannot be admitted.
    if (payload.length > MAX_OUTBOUND_TEXT_BYTES) {
      this.opts.onError?.('Message was not sent: the IRC frame is too large.');
      return false;
    }
    const encodedBytes = new TextEncoder().encode(payload).byteLength;
    if (encodedBytes > MAX_OUTBOUND_TEXT_BYTES) {
      this.opts.onError?.('Message was not sent: the IRC frame is too large.');
      return false;
    }

    if (!hasWebSocketSendCapacity(ws, encodedBytes)) {
      this.opts.onError?.('Message was not sent: the connection is congested. Reconnecting…');
      try { ws.close(4004, 'Send buffer congested'); } catch { /* already closing */ }
      return false;
    }

    try {
      ws.send(payload);
    } catch {
      this.opts.onError?.('Message was not sent: the connection closed during send.');
      return false;
    }

    // Browsers silently discard send() calls made after the socket begins
    // CLOSING. Catch a native state race even when send() did not throw.
    if (ws.readyState !== WebSocket.OPEN) {
      this.opts.onError?.('Message delivery could not be confirmed: the connection closed during send.');
      return false;
    }

    this.opts.onRaw?.(redactSensitiveLineForLog(line.replace(/\r\n$/, '')), 'out');
    return true;
  }

  sendRaw(command: string, ...params: string[]): boolean {
    return this.send(formatIRCLine(command, ...params));
  }

  /**
   * Force-close the socket through the NORMAL close path, so onDisconnected
   * fires and the store's reconnect machinery takes over. Used when the OS
   * reports the network gone (window 'offline') — the TCP stack can take
   * minutes to notice on its own, and messages composed in that window would
   * silently vanish instead of queueing to the offline outbox.
   */
  dropConnection(reason = 'network offline') {
    try {
      this.ws?.close(4002, reason);
    } catch {
      /* already closing/closed */
    }
  }

  /** The effective current nick (registration nick, or the post-433 alias). */
  get currentNick(): string {
    return this.opts.nick;
  }

  /** Current concrete WebSocket generation (increments on every connect call). */
  get socketGeneration(): number {
    return this._socketGeneration;
  }

  /**
   * True when this socket can carry Cadence binary media frames.
   * `text.ircv3.net` is control-only; media requires `onyx.irc-media.v1` or
   * the legacy empty-protocol path (binary-admitting).
   */
  get admitsMediaBinary(): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    return ws.protocol !== IRC_WEBSOCKET_SUBPROTOCOL;
  }

  /** Send a media datagram as a binary WebSocket frame (browser media plane). */
  sendBinary(bytes: Uint8Array): boolean {
    const ws = this.ws;
    if (
      !ws
      || ws.readyState !== WebSocket.OPEN
      || ws.protocol === IRC_WEBSOCKET_SUBPROTOCOL
      || bytes.byteLength > MAX_BINARY_FRAME_BYTES
    ) {
      return false;
    }
    if (!hasWebSocketSendCapacity(ws, bytes.byteLength)) {
      // Media is explicitly loss-tolerant. Shed this frame so media cannot
      // consume the bounded buffer reserved for ordered IRC control/messages.
      return false;
    }
    try {
      // Copy into a fresh ArrayBuffer-backed view so a pooled/odd-offset source
      // buffer isn't sent with stale trailing bytes.
      ws.send(bytes.slice());
      return ws.readyState === WebSocket.OPEN;
    } catch {
      // WebSocket state raced — let _onClose handle the disconnect.
      return false;
    }
  }

  // ── Public IRC command helpers ──────────────────────────────────────────

  join(channel: string, key?: string) {
    this.sendRaw('JOIN', channel, ...(key ? [key] : []));
  }

  tagmsg(target: string, tags: Record<string, string>) {
    this.send(formatTaggedLine(tags, 'TAGMSG', target));
  }

  part(channel: string, reason = 'Leaving') {
    this.sendRaw('PART', channel, reason);
  }

  privmsg(target: string, text: string) {
    this.sendRaw('PRIVMSG', target, text);
  }

  notice(target: string, text: string) {
    this.sendRaw('NOTICE', target, text);
  }

  nick(newNick: string) {
    this.sendRaw('NICK', newNick);
  }

  quit(reason = 'Goodbye') {
    this.sendRaw('QUIT', reason);
  }

  topic(channel: string, text?: string) {
    if (text !== undefined) {
      this.sendRaw('TOPIC', channel, text);
    } else {
      this.sendRaw('TOPIC', channel);
    }
  }

  mode(target: string, modes?: string, ...params: string[]) {
    this.sendRaw('MODE', target, ...(modes ? [modes, ...params] : []));
  }

  kick(channel: string, nick: string, reason = '') {
    this.sendRaw('KICK', channel, nick, reason);
  }

  whois(nick: string) {
    this.sendRaw('WHOIS', nick);
  }

  /**
   * Publish a watch-together activity to a channel by SETting the `ocean.watch`
   * PROP — the same IRCX PROP-set path every other channel prop uses
   * (`_writeChannelProp` in the store). Passing `null` clears the prop (an empty
   * trailing value deletes it server-side). No new wire command is introduced.
   */
  publishWatchTogether(channel: string, activity: WatchTogetherActivity | null) {
    const value = activity ? serializeWatchTogetherProp(activity) : '';
    this.sendRaw('PROP', channel, WATCH_PROP, value);
  }

  /**
   * Run a server LIST and collect the reply into rows.
   *
   * Sends `LIST`, accumulates 322 RPL_LIST rows until 323 RPL_LISTEND, then
   * resolves. Onyx Server merges mesh-wide results server-side, so a single LIST
   * yields the whole network. A timeout guard resolves with whatever has been
   * collected if the end numeric never arrives (e.g. disconnect mid-reply).
   * Concurrent callers share the same in-flight request.
   */
  list(timeoutMs = 15_000): Promise<ChannelListRow[]> {
    if (this._listPending) return this._listPending.promise;

    let resolve!: (rows: ChannelListRow[]) => void;
    const promise = new Promise<ChannelListRow[]>((r) => { resolve = r; });
    const boundedTimeout = Number.isSafeInteger(timeoutMs)
      ? Math.max(100, Math.min(60_000, timeoutMs))
      : 15_000;
    const timer = setTimeout(() => this._finishList(), boundedTimeout);
    this._listPending = { rows: [], seen: new Set(), resolve, promise, timer };
    if (!this.sendRaw('LIST')) this._finishList();
    return promise;
  }

  private _finishList() {
    const pending = this._listPending;
    if (!pending) return;
    this._listPending = null;
    clearTimeout(pending.timer);
    pending.resolve(pending.rows);
  }

  /**
   * True when the server ACKed `onyx/session-sync`. When active, the server
   * drives session reclaim (auto JOIN + NAMES/topic + CHATHISTORY replay) on
   * (re)connect, so the client must suppress its own blind autojoin storm.
   */
  get sessionSyncActive(): boolean {
    return this.negotiatedCaps.has('onyx/session-sync');
  }

  /**
   * Push freshly-issued resume tokens back into the LIVE client.
   *
   * The server hands out a new session token after every registration (arriving
   * as `NOTE SESSION TOKEN`, plus `NOTE SESSION MTOKEN` on a mesh), which the
   * store parses and persists. But auto-reconnect reuses THIS same instance
   * (`reconnectNow → connect()`), and `opts.sessionToken` / `opts.meshToken`
   * are otherwise frozen at construction. Without this, every reconnect would
   * replay the stale construction-time token — `undefined` for any session that
   * began without a saved token — so the 001 resume (`SESSION RESUME <token>`)
   * would silently fail and the session would come back as brand-new.
   *
   * Only the provided fields are merged, so a lone `TOKEN` note never clobbers a
   * held `MTOKEN` (and vice versa). Invalid values are refused fail-closed —
   * the previously held bearer for that field is left intact rather than
   * replaced with garbage that would become a multi-word / control-bearing
   * `SESSION RESUME` on the next 001. Immutable: a new opts object is assigned.
   */
  updateResumeTokens(tokens: { sessionToken?: string; meshToken?: string }): void {
    const next: { sessionToken?: string; meshToken?: string } = {};
    if (tokens.sessionToken !== undefined && isValidSessionCredential(tokens.sessionToken)) {
      next.sessionToken = tokens.sessionToken;
    }
    if (tokens.meshToken !== undefined && isValidSessionCredential(tokens.meshToken)) {
      next.meshToken = tokens.meshToken;
    }
    if (next.sessionToken === undefined && next.meshToken === undefined) return;
    this.opts = { ...this.opts, ...next };
  }

  /**
   * Forget every bearer held by this live instance after confirmed account
   * logout. Auto-reconnect reuses the IRCClient, so clearing durable storage
   * alone would still replay the in-memory token on its next 001.
   */
  clearResumeTokens(): void {
    this.opts = {
      ...this.opts,
      sessionToken: undefined,
      meshToken: undefined,
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private _onOpen() {
    const ws = this.ws;
    // A conforming browser WebSocket always exposes `protocol`. Once this
    // client offers explicit application protocols, an empty/unknown selection
    // is a downgrade: CRLF and binary semantics would otherwise fall through
    // to the legacy no-subprotocol path. Some unit-test doubles intentionally
    // omit the browser property, so only that non-browser shape is exempt.
    if (
      ws
      && 'protocol' in ws
      && ws.protocol !== ONYX_MEDIA_WEBSOCKET_SUBPROTOCOL
      && ws.protocol !== IRC_WEBSOCKET_SUBPROTOCOL
    ) {
      this.opts.onError?.('WebSocket protocol error: the server did not select a supported subprotocol.');
      try { ws.close(1002, 'WebSocket subprotocol required'); } catch { /* already closing */ }
      return;
    }

    this.reconnectDelay = RECONNECT_BASE;

    // Begin CAP negotiation
    this.sendRaw('CAP', 'LS', '302');
    // Send NICK / USER early so server knows who we are
    this.sendRaw('NICK', this.opts.nick);
    this.sendRaw('USER',
      'webchat',
      '0',
      '*',
      this.opts.realname ?? `${this.opts.nick} (webchat)`
    );

    this._schedulePing();
  }

  private _onMessage(ev: MessageEvent) {
    // Binary frames carry browser media datagrams, not IRC lines.
    if (ev.data instanceof ArrayBuffer) {
      if (this.ws?.protocol === IRC_WEBSOCKET_SUBPROTOCOL) {
        this.opts.onError?.('WebSocket protocol error: text.ircv3.net received a binary frame.');
        try { this.ws.close(1002, 'Binary frame on text.ircv3.net'); } catch { /* already closing */ }
        return;
      }
      if (ev.data.byteLength > MAX_BINARY_FRAME_BYTES) {
        this._rejectOversizedInbound('binary');
        return;
      }
      if (ev.data.byteLength) {
        const bytes = new Uint8Array(ev.data);
        this.opts.onBinary?.(bytes);
        for (const h of this.binaryHandlers) {
          try { h(bytes); } catch { /* a subscriber must not break the socket */ }
        }
      }
      return;
    }
    const data = typeof ev.data === 'string' ? ev.data : '';
    if (
      this.ws?.protocol === IRC_WEBSOCKET_SUBPROTOCOL
      && (!data || data.includes('\r') || data.includes('\n'))
    ) {
      this.opts.onError?.('WebSocket protocol error: text.ircv3.net requires exactly one non-empty IRC line per frame.');
      try { this.ws.close(1002, 'Invalid text.ircv3.net frame'); } catch { /* already closing */ }
      return;
    }
    if (!data) return;
    // As with outbound text, reject definitely-oversized strings before making
    // a second allocation, then enforce the actual UTF-8 wire-size bound. A
    // code-unit-only check would admit up to 4 MiB of astral Unicode here.
    if (
      data.length > MAX_INBOUND_TEXT_BYTES
      || new TextEncoder().encode(data).byteLength > MAX_INBOUND_TEXT_BYTES
    ) {
      this._rejectOversizedInbound('text');
      return;
    }

    // Onyx Server follows the IRCv3 WebSocket sub-protocol: each frame carries a
    // complete IRC message and the trailing CRLF is OPTIONAL — Onyx Server omits it
    // entirely (e.g. ":eshmaki.me CAP * LS :..." with no newline). The browser
    // reassembles continuation frames, so every onmessage delivers whole
    // message(s), never a partial line. The strict text.ircv3.net branch above
    // admits exactly one non-empty line. Onyx's multiplexed/legacy wire may
    // still batch CRLF-delimited IRC lines, so split those frames here.
    //
    // We must NOT retain a trailing remainder across frames: a previous
    // `split('\n')` + `buffer = lines.pop()` stashed the CRLF-less final line
    // forever, so CAP LS was never handled and registration hung — surfacing
    // as a "WebSocket error" that made the client appear unable to connect.
    // `splitWireFrame` is pure and remainder-free by construction (see its
    // doc); a single frame may still legitimately batch several CRLF-separated
    // lines, all of which it returns. No mutable buffer lives here to tempt a
    // reintroduction of the stash.
    for (const line of splitWireFrame(data)) {
      const logLine = redactSensitiveLineForLog(line);
      this.opts.onRaw?.(logLine, 'in');
      try {
        const msg = parseIRCMessage(line);
        this._handleMessage(msg);
      } catch (e) {
        // A malformed line must not abort processing of the rest of the frame.
        // Handler/parser exceptions are not a safe diagnostic channel: their
        // messages may contain the original remote control payload.
        console.warn('[nexus] failed to handle IRC line:', logLine);
      }
    }
  }

  private _rejectOversizedInbound(kind: 'text' | 'binary'): void {
    this.opts.onError?.(`WebSocket ${kind} frame exceeded the client safety limit.`);
    try { this.ws?.close(1009, 'WebSocket frame too large'); } catch { /* already closing */ }
  }

  private _recordAvailableCap(name: string, value: string): boolean {
    if (this._capAvailable.includes(name)) {
      this.capValues.set(name, value);
      return true;
    }
    if (this._capAvailable.length >= MAX_CLIENT_CAP_ENTRIES) return false;
    this._capAvailable.push(name);
    this.capValues.set(name, value);
    return true;
  }

  private _onClose(ev: CloseEvent) {
    this._attribution.stop(); // no residence refresh on a dead socket
    this._clearPingTimers();
    const reason = ev.reason || `code ${ev.code}`;
    console.error('[nexus] ws closed — code:', ev.code, 'reason:', ev.reason || '(none)', 'wasClean:', ev.wasClean);
    this.opts.onDisconnected?.(reason);
    // Reconnect is owned exclusively by the store (bounded attempts, gated on
    // autoReconnect, with the UI countdown). The client must NOT also schedule
    // its own reconnect — doing both spawned duplicate parallel connections,
    // which is what produced ghost sessions and the "nick_" fallback pile-up.
  }

  private _onError(ev: Event) {
    console.error('[nexus] ws error:', ev);
    this.opts.onError?.('WebSocket error');
  }

  private _handleMessage(msg: IRCMessage) {
    // Internal protocol handling before passing to store handler
    switch (msg.command) {
      case 'PING':
        this.sendRaw('PONG', msg.params[0] ?? '');
        break;

      case 'CAP': {
        const subCmd = (msg.params[1] ?? '').toUpperCase();
        switch (subCmd) {
          case 'LS': {
            const isMultiline = msg.params[2] === '*';
            const capsStr = isMultiline ? msg.params[3] : msg.params[2];
            // Accumulate caps; track sasl mechanisms separately
            for (const token of (capsStr ?? '').split(' ').filter(Boolean)) {
              const cap = parseAdvertisedCap(token);
              if (!cap || !this._recordAvailableCap(cap.name, cap.value)) continue;
              if (cap.name === 'sasl' && cap.value) {
                this._saslMechs = parseSaslMechanisms(cap.value);
              }
            }

            if (!isMultiline) {
              // All CAP LS data is in — now build our request
              const want = this._wantedCaps(this._capAvailable);

              if (want.length > 0) {
                this._requestCaps(want);
              } else {
                this._finishCap();
              }
            }
            break;
          }

          case 'ACK': {
            const caps = (msg.params[2] ?? '').split(' ').filter(Boolean);
            for (const token of caps) {
              const cap = parseAdvertisedCap(token);
              if (!cap) continue;
              if (
                this.negotiatedCaps.has(cap.name)
                || this.negotiatedCaps.size < MAX_CLIENT_CAP_ENTRIES
              ) this.negotiatedCaps.add(cap.name);
              this._capReqPendingNames.delete(cap.name);
            }
            if (caps.length > 0) this.onCapChange?.();
            if (this._capReqPending > 0) this._capReqPending--;
            if (caps.includes('sasl') && (this.opts.password || this.opts.hasClientCert)) {
              this._saslPending = true;
              const mech = selectSaslMechanism(this._saslMechs, {
                hasPassword: Boolean(this.opts.password),
                hasClientCert: Boolean(this.opts.hasClientCert),
              });
              if (mech) {
                this._saslMech = mech;
                this.sendRaw('AUTHENTICATE', mech);
              } else {
                this._failSasl(
                  `No supported SASL mechanism offered (${this._saslMechs.join(', ') || 'none'})`,
                  'Unsupported SASL mechanism',
                );
                return;
              }
              // Guard against server never responding to AUTHENTICATE
              this._saslTimer = setTimeout(() => {
                this._failSasl('SASL authentication timed out');
              }, 15_000);
            } else {
              this._finishCapIfReady();
            }
            break;
          }

          case 'NAK':
            for (const c of (msg.params[2] ?? '').split(' ').filter(Boolean)) {
              this._capReqPendingNames.delete(c);
            }
            if (this._capReqPending > 0) this._capReqPending--;
            this._finishCapIfReady();
            break;

          case 'NEW': {
            // Server advertises new caps — request any we want
            const newCapsStr = msg.params[2] ?? '';
            const newAvailable: string[] = [];
            const newSaslMechs: string[] = [];
            for (const token of newCapsStr.split(' ').filter(Boolean)) {
              const cap = parseAdvertisedCap(token);
              if (!cap || !this._recordAvailableCap(cap.name, cap.value)) continue;
              if (!newAvailable.includes(cap.name)) newAvailable.push(cap.name);
              if (cap.name === 'sasl' && cap.value) {
                newSaslMechs.push(...parseSaslMechanisms(cap.value));
              }
            }
            if (newAvailable.length > 0) this.onCapChange?.();
            if (newSaslMechs.length) this._saslMechs = newSaslMechs;
            const wantNew = this._wantedCaps(newAvailable);
            if (wantNew.length > 0) this._requestCaps(wantNew);
            break;
          }

          case 'DEL': {
            const delCaps = (msg.params[2] ?? '').split(' ').filter(Boolean);
            for (const c of delCaps) {
              this.negotiatedCaps.delete(c);
              this.capValues.delete(c);
              this._capAvailable = this._capAvailable.filter(name => name !== c);
            }
            if (delCaps.length > 0) this.onCapChange?.();
            break;
          }
        }
        break;
      }

      case 'AUTHENTICATE': {
        const param = msg.params[0] ?? '';
        if (this._saslMech === 'PLAIN') {
          if (param === '+') {
            // Use _authNick for the same reason — post-433, opts.nick is the alias.
            const nick = this._authNick;
            const pass = this.opts.password ?? '';
            const plain = encodeBase64Utf8(`\0${nick}\0${pass}`);
            this._sendAuthenticatePayload(plain);
          }
        } else if (this._saslMech === 'EXTERNAL') {
          if (param === '+') this.sendRaw('AUTHENTICATE', '+');
        } else if (this._saslMech === 'SCRAM-SHA-256') {
          if (param === '+') {
            // Server ready — send client-first-message
            this._scramClientFirst();
          } else if (this._scramState?.expectedServerSig !== undefined) {
            // We already sent client-final; this discrete AUTHENTICATE carries
            // the server-final (v=...). Verify mutual auth SYNCHRONOUSLY.
            this._scramVerifyServerFinal(param);
          } else {
            // Server-first challenge — process it into client-final.
            this._scramClientFinal(param).catch(e => {
              this._failSasl(`SCRAM error: ${e}`);
            });
          }
        }
        break;
      }

      // NOTE: 903/904/905 are reused by Onyx Server's IRCX layer post-registration
      // (903=ERR_BADLEVEL, 904=ERR_BADTAG, 905=ERR_BADPROPERTY). Only treat them
      // as the SASL result numerics while a SASL exchange is actually in flight
      // (pre-registration). Otherwise they must pass through to the store as
      // ordinary IRCX errors.
      case '903': // RPL_SASLSUCCESS (during SASL only)
        if (this._saslPending || this._saslMech) {
          if (this._saslTimer) { clearTimeout(this._saslTimer); this._saslTimer = null; }
          this._saslPending = false;
          this._loggedIn = true;
          this._saslMech = null;
          this._scramState = null;
          // NOTE: SESSION RESUME / SESSION TOKEN are deliberately NOT sent here.
          // Onyx Server's SESSION command requires a registered connection (it checks
          // session.account() and lives in the post-registration command path),
          // so it is issued after 001 (see the '001' case below). Sending it
          // during CAP/SASL would be rejected as a pre-registration command.
          this._finishCapIfReady();
        }
        break;

      case '900': // RPL_LOGGEDIN (SASL, passkey, IDENTIFY, or account claim)
        // Onyx Server also uses numeric 900 for a two-parameter IRCX error. Only the
        // four-parameter RPL_LOGGEDIN is account proof. SESSION is deliberately
        // account-scoped, so passwordless reconnects must wait for this proof
        // instead of replaying a bearer while they are still a guest.
        if (msg.params.length >= 4 && msg.params[2]) {
          this._loggedIn = true;
          if (this._registered) this._sendSessionCommandsAfterAuthentication();
        }
        break;

      case '904': // ERR_SASLFAIL (during SASL only)
      case '905':
        if (this._saslPending || this._saslMech) {
          // An explicit sign-in must never degrade into a guest registration.
          // CAP END would let 001 arrive and overwrite the error state with a
          // connected anonymous session, so terminate this attempt instead.
          this._failSasl('SASL authentication failed');
        }
        break;

      case '433': // Nickname in use
      case '432': // Erroneous nickname
      case '437': // Nick/channel unavailable
        if (
          msg.command === '432'
          && !this._registered
          && /nickname is registered; authenticate/i.test(msg.params.at(-1) ?? '')
        ) {
          this.opts.onError?.('That nickname is registered. Sign in as its account before using it.');
          try {
            this.ws?.close(4003, 'Registered nickname requires authentication');
          } catch {
            // The authoritative server also closes; a raced socket is harmless.
          }
          return;
        }
        if (!this._registered && this._nickRetries < 4) {
          this._nickRetries++;
          const newNick = this.opts.nick + '_';
          this.opts.nick = newNick;
          this.sendRaw('NICK', newNick);
          this.opts.onNickChanged?.(newNick);
          return; // handled internally; don't forward to store
        }
        break;

      // ── LIST collection (see list()) ─────────────────────────────────────
      case '321': // RPL_LISTSTART — reset any partial rows
        if (this._listPending) {
          this._listPending.rows = [];
          this._listPending.seen.clear();
        }
        break;

      case '322': { // RPL_LIST: :server 322 me #channel <users> :<topic>
        const pending = this._listPending;
        if (pending) {
          const channel = msg.params[1] ?? '';
          const rawUsers = msg.params[2] ?? '';
          const users = /^\d+$/u.test(rawUsers) ? Number(rawUsers) : 0;
          let topic = (msg.params[3] ?? '')
            .replace(/[\u0000-\u001f\u007f]/gu, '')
            .slice(0, MAX_CLIENT_LIST_TOPIC_LENGTH);
          const finalCodeUnit = topic.charCodeAt(topic.length - 1);
          if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) topic = topic.slice(0, -1);
          const key = channel.toLowerCase();
          if (
            pending.rows.length < MAX_CLIENT_LIST_ROWS
            && channel.length <= MAX_CLIENT_LIST_CHANNEL_LENGTH
            && /^[#&][^\u0000-\u0020\u007f,]+$/u.test(channel)
            && !pending.seen.has(key)
          ) {
            pending.seen.add(key);
            pending.rows.push({
              channel,
              users: Number.isSafeInteger(users) && users >= 0 ? users : 0,
              topic,
            });
          }
        }
        break;
      }

      case '323': // RPL_LISTEND — resolve the pending list()
        this._finishList();
        break;

      case '001':
        this._registered = true;
        // Send IRCX before notifying the store (which will trigger JOIN)
        this.sendRaw('IRCX');
        // Now that the connection is registered, the post-registration SESSION
        // command is valid. Reclaim a prior detached session if we hold a token,
        // then request a fresh token for this session (arrives as
        // NOTE SESSION TOKEN, plus NOTE SESSION MTOKEN on mesh deployments).
        // Onyx Server requires the live connection to authenticate to the owning
        // account before accepting SESSION RESUME. Password SASL has already
        // completed here; passwordless/passkey reconnects wait for their
        // post-registration 900 RPL_LOGGEDIN.
        //
        // Prefer the mesh-sealed token for RESUME: a reconnect may land on a
        // different mesh node, where the local 16-byte token is meaningless but
        // the mesh token still reclaims/redirects (server.zig handleMeshReclaim).
        // Fall back to the local token when no mesh token is held.
        // A malformed peer can send 001 more than once. Never replay a bearer
        // token or request multiple replacements on the same connection.
        this._sendSessionCommandsAfterAuthentication();
        this.opts.onConnected?.();
        break;

      case '005':
        this._parseISUPPORT(msg.params);
        break;

      case 'PONG':
        this._clearPongTimeout();
        this._schedulePing();
        break;

      case 'ERROR':
        this.opts.onError?.(msg.params[0] ?? 'Server error');
        break;
    }

    // Account attribution observes every line (900 account, IDENTITY
    // confirmations, FAIL STALE_EPOCH) — cheap switch, never throws.
    this._attribution.observe(msg);

    // Always forward to store handler
    this.opts.onMessage(msg);

    // Fan out to auxiliary subscribers (feature hooks etc.)
    if (this.extraMessageHandlers.size > 0) {
      for (const h of this.extraMessageHandlers) {
        try { h(msg); } catch { /* keep other subscribers alive */ }
      }
    }
  }

  /**
   * Resume/rotate only after this socket has account proof. A reclaim token
   * selects one logical session within an account; it does not replace account
   * authentication itself.
   */
  private _sendSessionCommandsAfterAuthentication(): void {
    if (this._sessionCommandsSent || !this._registered || !this._loggedIn) return;
    this._sessionCommandsSent = true;
    // Prefer a valid mesh token; fall through to a valid local token. Never
    // emit SESSION RESUME with an empty / whitespace / control-bearing value
    // even if construction-time opts were poisoned — formatIRCLine would only
    // strip CR/LF, not refuse the atom.
    const resumeToken = isValidSessionCredential(this.opts.meshToken)
      ? this.opts.meshToken
      : isValidSessionCredential(this.opts.sessionToken)
        ? this.opts.sessionToken
        : null;
    if (resumeToken) this.send(buildSessionResumeLine(resumeToken));
    this.sendRaw('SESSION', 'TOKEN');
  }

  private _finishCap() {
    if (this._capNegotiating) {
      this._capNegotiating = false;
      this.sendRaw('CAP', 'END');
    }
  }

  private _finishCapIfReady() {
    if (this._capReqPending === 0 && !this._saslPending) {
      this._finishCap();
    }
  }

  /** Abort an explicit SASL attempt without falling through to guest registration. */
  private _failSasl(message: string, closeReason = 'SASL authentication failed') {
    if (this._saslTimer) {
      clearTimeout(this._saslTimer);
      this._saslTimer = null;
    }
    this._saslPending = false;
    this._saslMech = null;
    this._scramState = null;
    this.opts.onError?.(message);
    try {
      this.ws?.close(4003, closeReason);
    } catch {
      // A raced CLOSED socket will still deliver/has already delivered close.
    }
  }

  /**
   * IRCv3 limits each AUTHENTICATE parameter to 400 bytes. Base64 is ASCII, so
   * string slices are byte-exact here. An exact 400-byte final chunk requires a
   * trailing `+` to distinguish "finished" from "more chunks follow".
   */
  private _sendAuthenticatePayload(payload: string): void {
    for (let offset = 0; offset < payload.length; offset += SASL_CHUNK_BYTES) {
      this.sendRaw('AUTHENTICATE', payload.slice(offset, offset + SASL_CHUNK_BYTES));
    }
    if (payload.length === 0 || payload.length % SASL_CHUNK_BYTES === 0) {
      this.sendRaw('AUTHENTICATE', '+');
    }
  }

  private _requestCaps(caps: string[]) {
    const uniqueCaps = [...new Set(caps)]
      .filter(c => !this.negotiatedCaps.has(c))
      .filter(c => !this._capReqPendingNames.has(c));
    if (uniqueCaps.length === 0) return;

    const chunks: string[][] = [];
    let current: string[] = [];
    let currentLen = 0;

    for (const cap of uniqueCaps) {
      const nextLen = currentLen + (current.length > 0 ? 1 : 0) + cap.length;
      if (current.length > 0 && nextLen > 380) {
        chunks.push(current);
        current = [];
        currentLen = 0;
      }
      current.push(cap);
      currentLen += (currentLen > 0 ? 1 : 0) + cap.length;
    }
    if (current.length > 0) chunks.push(current);

    this._capReqPending += chunks.length;
    for (const cap of uniqueCaps) this._capReqPendingNames.add(cap);
    for (const chunk of chunks) {
      this.sendRaw('CAP', 'REQ', chunk.join(' '));
    }
  }

  private _wantedCaps(caps: string[]) {
    return [...new Set(caps)].filter(cap => {
      // ── Always-off caps ──────────────────────────────────────────────────
      // STARTTLS upgrade: Onyx already uses WSS; requesting this is wrong.
      if (cap === 'tls') return false;
      // sts (Strict Transport Security): an informational cap whose value is the
      // transport policy. It is advertised, not negotiated — Onyx Server NAKs a REQ
      // for it. The TLS upgrade is already implicit in the wss:// endpoint.
      if (cap === 'sts') return false;
      // SASL: only request when we have credentials to send.
      if (cap === 'sasl') return Boolean(this.opts.password || this.opts.hasClientCert);
      // no-implicit-names: Onyx relies on the automatic 353 NAMREPLY on
      // JOIN to populate the member list; opting in would suppress it.
      if (cap === 'no-implicit-names') return false;

      // ── Unimplemented protocol caps ───────────────────────────────────────
      // draft/multiline: requested — the store sends newline-containing
      // composer text as a BATCH-based multiline message (see
      // src/lib/irc/multiline.ts) and reassembles incoming multiline batches
      // into a single ChatMessage. Falls back to per-line PRIVMSGs when the
      // cap is not ACKed.
      // draft/search: requested — the store's searchServerHistory() drives
      // the server-side SEARCH command (results replay as a chathistory-shaped
      // batch, diverted into serverSearch.results); the MessageSearch bar
      // exposes it as "Search full history".
      // labeled-response: requested — the store stamps `@label=` on chat
      // PRIVMSG / multiline BATCH (and outbox flush) and correlates the
      // server's labeled echo, ACK, FAIL, or labeled-response batch so
      // optimistic / pending rows resolve to the authoritative msgid.
      // (Falls through to `return true`.)
      // draft/channel-rename: requested — the store handles the native
      // `:renamer RENAME #old #new [:reason]` line and migrates channel state
      // (messages, membership, unread, active view) under the new key.
      // draft/file-upload: Onyx uses HTTP POST to a media server;
      // the IRC-level file-upload protocol is not implemented.
      if (cap === 'draft/file-upload') return false;
      // bot: Onyx is a human client, not a bot.
      if (cap === 'bot') return false;

      // onyx/session-sync: server-driven session reclaim. When ACKed, the
      // server auto-pushes JOIN + NAMES/topic + CHATHISTORY replay for every
      // channel the account's session is live in, so the client must NOT run
      // its own blind autojoin storm. Always request it when offered; the
      // store gates autojoin suppression on negotiatedCaps having it.
      // (Falls through to `return true` — listed here only for documentation.)
      //
      // onyx/e2ee: message-tag and channel-policy signaling. The store adds
      // +onyx/e2ee only after the browser E2EE DM path has sealed the payload,
      // and reads the channel encryption-policy PROP.
      // (Falls through to `return true`.)

      return true;
    });
  }

  private _scramClientFirst() {
    const hash = 'SHA-256';
    const bits = 256;
    const arr = new Uint8Array(18);
    crypto.getRandomValues(arr);
    const nonce = btoa(String.fromCharCode(...arr)).replace(/[+/=]/g, c =>
      c === '+' ? '-' : c === '/' ? '_' : ''
    );
    const clientFirstMsgBare = `n=${this._authNick},r=${nonce}`;
    this._scramState = { clientFirstMsgBare, nonce, hash, bits };
    const msg = `n,,${clientFirstMsgBare}`;
    this._sendAuthenticatePayload(btoa(msg));
  }

  private async _scramClientFinal(challengeB64: string) {
    const state = this._scramState;
    if (!state) return;

    let serverFirst: string;
    try {
      serverFirst = atob(challengeB64);
    } catch {
      this._failSasl('SCRAM: invalid challenge encoding');
      return;
    }

    // Parse server-first-message
    const parts: Record<string, string> = {};
    for (const p of serverFirst.split(',')) {
      parts[p[0]!] = p.slice(2);
    }
    const serverNonce = parts['r'] ?? '';
    const saltB64 = parts['s'] ?? '';
    const iterations = parseInt(parts['i'] ?? '4096', 10);

    if (!serverNonce.startsWith(state.nonce)) {
      this._failSasl('SCRAM: server nonce mismatch');
      return;
    }

    const enc = new TextEncoder();
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));

    // SaltedPassword = PBKDF2(password, salt, iterations, selected SCRAM hash)
    const rawKey = await crypto.subtle.importKey(
      'raw', enc.encode(this.opts.password ?? ''),
      'PBKDF2', false, ['deriveBits']
    );
    const saltedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: state.hash, salt, iterations },
      rawKey, state.bits
    );
    const saltedPass = new Uint8Array(saltedBits);

    const hmac = async (keyData: Uint8Array, data: Uint8Array) => {
      const k = await crypto.subtle.importKey(
        'raw', keyData.buffer as ArrayBuffer, { name: 'HMAC', hash: state.hash }, false, ['sign']
      );
      return new Uint8Array(await crypto.subtle.sign('HMAC', k, data.buffer as ArrayBuffer));
    };

    const clientKey = await hmac(saltedPass, enc.encode('Client Key'));
    const storedKeyBuf = await crypto.subtle.digest(state.hash, clientKey);
    const storedKey = new Uint8Array(storedKeyBuf);

    // c=biws is base64("n,,") — channel binding not supported
    const clientFinalWithoutProof = `c=biws,r=${serverNonce}`;
    const authMessage = `${state.clientFirstMsgBare},${serverFirst},${clientFinalWithoutProof}`;

    const clientSig = await hmac(storedKey, enc.encode(authMessage));
    const clientProof = clientKey.map((b, i) => b ^ clientSig[i]!);

    // Precompute the ServerSignature = HMAC(ServerKey, AuthMessage) the server
    // must echo in its server-final `v=`. Storing it now lets the discrete
    // server-final line be verified with a plain constant-time string compare,
    // with no async work racing the 903 that follows it.
    const serverKey = await hmac(saltedPass, enc.encode('Server Key'));
    const serverSig = await hmac(serverKey, enc.encode(authMessage));
    const expectedServerSig = btoa(String.fromCharCode(...serverSig));

    const proofB64 = btoa(String.fromCharCode(...clientProof));
    const clientFinal = `${clientFinalWithoutProof},p=${proofB64}`;
    // Retain state (do NOT null it) so _scramVerifyServerFinal can check the
    // server-final; the exchange is only fully torn down on 903/904/905.
    this._scramState = { ...state, expectedServerSig };
    this._sendAuthenticatePayload(btoa(clientFinal));
  }

  /**
   * Verify the SCRAM server-final (`v=<ServerSignature>`), completing mutual
   * authentication. Onyx Server sends this as a discrete AUTHENTICATE line and then
   * immediately emits 903 — it does NOT wait for a client ack, so on success we
   * send nothing and let the 903 finish the login. On any mismatch (or a server
   * error `e=`) we fail CLOSED: tear the exchange down and clear the SASL flags
   * so the trailing 903 can no longer flip us to logged-in.
   */
  private _scramVerifyServerFinal(challengeB64: string) {
    const expected = this._scramState?.expectedServerSig;
    if (expected === undefined) return;

    const fail = (reason: string) => {
      this._failSasl(`SASL authentication failed: ${reason}`);
    };

    let serverFinal: string;
    try {
      serverFinal = atob(challengeB64);
    } catch {
      return fail('invalid server-final encoding');
    }

    if (serverFinal.startsWith('e=')) {
      return fail(`server rejected proof (${serverFinal.slice(2)})`);
    }

    const received = /(?:^|,)v=([^,]*)/.exec(serverFinal)?.[1];
    if (received === undefined || !constantTimeEqual(received, expected)) {
      return fail('server signature mismatch');
    }
    // Verified — the server proved knowledge of the stored key. The 903 that
    // follows completes the login; nothing to send here.
  }

  private _parseISUPPORT(params: string[]) {
    // params[0] = ournick, params[last] = "are supported by this server" — skip both.
    const end = Math.min(params.length - 1, MAX_CLIENT_ISUPPORT_TOKENS + 1);
    for (let index = 1; index < end; index += 1) {
      const token = params[index]!;
      const eqIdx = token.indexOf('=');
      const key = eqIdx === -1 ? token : token.slice(0, eqIdx);
      const val = eqIdx === -1 ? '' : token.slice(eqIdx + 1);
      if (
        key.length === 0
        || key.length > MAX_CLIENT_ISUPPORT_KEY_LENGTH
        || val.length > MAX_CLIENT_ISUPPORT_VALUE_LENGTH
        || !/^[A-Z][A-Z0-9-]*$/u.test(key)
        || /[\u0000-\u0020\u007f]/u.test(val)
      ) continue;

      switch (key) {
        case 'PREFIX': {
          const { modeToPrefix, prefixToMode } = parsePREFIX(val);
          if (Object.keys(modeToPrefix).length === 0) break;
          this.modeToPrefix = modeToPrefix;
          this.prefixToMode = prefixToMode;
          this.isupport.PREFIX = modeToPrefix;
          this.isupport.PREFIX_MODES = prefixToMode;
          break;
        }
        case 'NETWORK':
          if (val && val.length <= 256) this.isupport.NETWORK = val;
          break;
        case 'CHANTYPES': {
          const parsed = parseIsupportChannelTypes(val);
          if (parsed !== null) this.isupport.CHANTYPES = parsed;
          break;
        }
        case 'CASEMAPPING': {
          const parsed = val.toLowerCase();
          if (parsed === 'ascii' || parsed === 'rfc1459' || parsed === 'strict-rfc1459') {
            this.isupport.CASEMAPPING = parsed;
          }
          break;
        }
        case 'NICKLEN': {
          const parsed = parseIsupportPositiveInt(val);
          if (parsed !== null) this.isupport.NICKLEN = parsed;
          break;
        }
        case 'TOPICLEN': {
          const parsed = parseIsupportPositiveInt(val);
          if (parsed !== null) this.isupport.TOPICLEN = parsed;
          break;
        }
        case 'CHANLIMIT': {
          const limits = parseCHANLIMIT(val);
          if (Object.keys(limits).length === 0) break;
          this.isupport.CHANLIMITS = limits;
          this.isupport.MAXCHANNELS = Object.values(limits)[0] ?? this.isupport.MAXCHANNELS;
          break;
        }
        case 'MAXCHANNELS': {
          const parsed = parseIsupportPositiveInt(val);
          if (parsed !== null) this.isupport.MAXCHANNELS = parsed;
          break;
        }
        case 'MODES': {
          const parsed = parseIsupportPositiveInt(val);
          if (parsed !== null) this.isupport.MODES = parsed;
          break;
        }
        case 'CHANMODES': {
          const parsed = parseIsupportChannelModes(val);
          if (parsed !== null) this.isupport.CHANMODES = parsed;
          break;
        }
        case 'IRCX':
          this.isupport.IRCX = true;
          break;
        case 'SILENCE': {
          const parsed = val ? parseIsupportPositiveInt(val) : 20;
          if (parsed !== null) this.isupport.SILENCE = parsed;
          break;
        }
        case 'VAPID':
          this.isupport.VAPID = val;
          break;
        case 'ACCOUNTRESIDENCE':
          // The daemon accepts IDENTITY RESIDENCE and this is the node
          // shortId a proof must bind. Absent token ⇒ the whole attribution
          // path stays off (old-server compatible, purely additive).
          this._attribution.setNode(val);
          break;
      }
    }
  }

  // ── Ping keepalive ──────────────────────────────────────────────────────

  private _schedulePing() {
    this._clearPingTimers();
    this.pingTimer = setTimeout(() => {
      this.sendRaw('PING', 'keepalive');
      this.pongTimeout = setTimeout(() => {
        this.ws?.close(4001, 'Ping timeout');
      }, 15_000);
    }, 25_000);
  }

  private _clearPingTimers() {
    if (this.pingTimer) { clearTimeout(this.pingTimer); this.pingTimer = null; }
    this._clearPongTimeout();
  }

  private _clearPongTimeout() {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  // ── Reconnect ──────────────────────────────────────────────────────────
  // Reconnect scheduling lives in the store (single owner). See _onClose.

  private _clearTimers() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this._saslTimer) { clearTimeout(this._saslTimer); this._saslTimer = null; }
    this._finishList(); // never leave a list() caller hanging
    this._clearPingTimers();
  }
}
