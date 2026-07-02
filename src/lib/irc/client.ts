'use client';

import {
  buildSessionResumeLine,
  parseCHANLIMIT,
  parseIRCMessage,
  formatIRCLine,
  parsePREFIX,
  selectSaslMechanism,
  type SaslMechanism,
} from './parser';
import type { IRCMessage, ISupport } from './types';

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
  sessionToken?: string; // Orochi SESSION RESUME token (local node)
  meshToken?: string;    // Orochi mesh-sealed reclaim token (any node)
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

/** Escape a tag value per IRCv3 spec (inverse of parser's unescapeTagValue). */
function escapeTagValue(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\:')
    .replace(/ /g, '\\s')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

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
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;
  private _registered = false;
  /** True once SASL has succeeded (903). Gates the post-001 SESSION commands. */
  private _loggedIn = false;
  private _saslPending = false;
  private _capNegotiating = true;
  private _capReqPending = 0;
  private _capReqPendingNames = new Set<string>();
  private _buffer = '';
  /** Accumulated caps across multiline CAP LS responses */
  private _capAvailable: string[] = [];
  /** Available SASL mechanisms parsed from sasl cap value */
  private _saslMechs: string[] = [];
  /** Which SASL mechanism we're using */
  private _saslMech: SaslMechanism | null = null;
  /** SCRAM state between challenge/response steps */
  private _scramState: { clientFirstMsgBare: string; nonce: string; hash: 'SHA-256'; bits: number } | null = null;
  /** How many times we've appended _ to nick during registration */
  private _nickRetries = 0;
  /** SASL auth timeout guard */
  private _saslTimer: ReturnType<typeof setTimeout> | null = null;
  /** In-flight LIST collection (see list()). */
  private _listPending: {
    rows: ChannelListRow[];
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
    // Defaults mirror Orochi's ISUPPORT PREFIX=(YQqov)*!.@+ (founder Q/'!',
    // owner q/'.', op o/'@', voice v/'+', plus the render-only oper Y/'*').
    // Overwritten verbatim from 005 PREFIX on connect.
    PREFIX: { Y: '*', Q: '!', q: '.', o: '@', v: '+' },
    PREFIX_MODES: { '*': 'Y', '!': 'Q', '.': 'q', '@': 'o', '+': 'v' },
    // Orochi defaults (overwritten from 005 on connect):
    //   CHANMODES=beIZ,k,lfj,imnstCTNMSgWOA, CHANTYPES=#&, CASEMAPPING=ascii,
    //   NICKLEN=64, TOPICLEN=390, CHANLIMIT=#&:50, MONITOR=128, SILENCE=32.
    CHANMODES: ['beIZ', 'k', 'lfj', 'imnstCTNMSgWOA'],
    CHANTYPES: '#&',
    CHANLIMITS: {},
    NETWORK: 'IRCXNet',
    CASEMAPPING: 'ascii',
    MODES: 4,
    MAXCHANNELS: 50,
    NICKLEN: 64,
    TOPICLEN: 390,
    IRCX: false,
    SILENCE: 0,          // SILENCE=20 — max entries in server-side silence list
    VAPID: '',           // VAPID=<key> — Web Push server key (empty = push off)
  };

  /** Map prefix char → mode letter, e.g. '@' → 'o'. Orochi: (YQqov)*!.@+ */
  prefixToMode: Record<string, string> = { '*': 'Y', '!': 'Q', '.': 'q', '@': 'o', '+': 'v' };
  /** Map mode letter → prefix char (used for display). Orochi: (YQqov)*!.@+ */
  modeToPrefix: Record<string, string> = { Y: '*', Q: '!', q: '.', o: '@', v: '+' };

  constructor(opts: IRCClientOptions) {
    this.opts = opts;
    // Save before any nick mutations (433 collision appends '_')
    this._authNick = opts.nick;
  }

  connect() {
    if (this._destroyed) return;
    // Never run two sockets in parallel. Tear down any prior socket first, and
    // detach its handlers so its close event can't trigger another reconnect.
    if (this.ws) {
      try {
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
    this._saslPending = false;
    this._capNegotiating = true;
    this._capReqPending = 0;
    this._capReqPendingNames = new Set();
    this._buffer = '';
    this._capAvailable = [];
    this._saslMechs = [];
    this._saslMech = null;
    this._scramState = null;
    this._nickRetries = 0;
    this.negotiatedCaps = new Set();
    this.capValues = new Map();
    // Resolve any LIST left hanging by the previous connection.
    this._finishList();
    if (this._saslTimer) { clearTimeout(this._saslTimer); this._saslTimer = null; }
    // Clear ping timers from any prior connection before opening a new socket.
    // Without this, a stale pongTimeout fires on the brand-new WebSocket.
    this._clearPingTimers();

    try {
      this.ws = new WebSocket(this.opts.url);
      // Browser media datagrams ride binary frames on this same socket; deliver
      // them as ArrayBuffers (not Blobs) so onBinary gets bytes synchronously.
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = this._onOpen.bind(this);
      this.ws.onmessage = this._onMessage.bind(this);
      this.ws.onclose = this._onClose.bind(this);
      this.ws.onerror = this._onError.bind(this);
    } catch (e) {
      this.opts.onError?.(`WebSocket error: ${e}`);
    }
  }

  destroy() {
    this._destroyed = true;
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

  send(line: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.opts.onRaw?.(line.replace(/\r\n$/, ''), 'out');
      try {
        this.ws.send(line);
      } catch {
        // WebSocket state raced — let _onClose handle the disconnect
      }
    }
  }

  sendRaw(command: string, ...params: string[]) {
    this.send(formatIRCLine(command, ...params));
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

  /** Send a media datagram as a binary WebSocket frame (browser media plane). */
  sendBinary(bytes: Uint8Array) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      // Copy into a fresh ArrayBuffer-backed view so a pooled/odd-offset source
      // buffer isn't sent with stale trailing bytes.
      this.ws.send(bytes.slice());
    } catch {
      // WebSocket state raced — let _onClose handle the disconnect.
    }
  }

  // ── Public IRC command helpers ──────────────────────────────────────────

  join(channel: string, key?: string) {
    this.sendRaw('JOIN', channel, ...(key ? [key] : []));
  }

  tagmsg(target: string, tags: Record<string, string>) {
    const tagStr = Object.entries(tags).map(([k, v]) => v ? `${k}=${escapeTagValue(v)}` : k).join(';');
    this.send(`@${tagStr} TAGMSG ${target}\r\n`);
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
   * Run a server LIST and collect the reply into rows.
   *
   * Sends `LIST`, accumulates 322 RPL_LIST rows until 323 RPL_LISTEND, then
   * resolves. Orochi merges mesh-wide results server-side, so a single LIST
   * yields the whole network. A timeout guard resolves with whatever has been
   * collected if the end numeric never arrives (e.g. disconnect mid-reply).
   * Concurrent callers share the same in-flight request.
   */
  list(timeoutMs = 15_000): Promise<ChannelListRow[]> {
    if (this._listPending) return this._listPending.promise;

    let resolve!: (rows: ChannelListRow[]) => void;
    const promise = new Promise<ChannelListRow[]>((r) => { resolve = r; });
    const timer = setTimeout(() => this._finishList(), timeoutMs);
    this._listPending = { rows: [], resolve, promise, timer };
    this.sendRaw('LIST');
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
   * True when the server ACKed `orochi/session-sync`. When active, the server
   * drives session reclaim (auto JOIN + NAMES/topic + CHATHISTORY replay) on
   * (re)connect, so the client must suppress its own blind autojoin storm.
   */
  get sessionSyncActive(): boolean {
    return this.negotiatedCaps.has('orochi/session-sync');
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private _onOpen() {
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
    if (!data) return;

    // Orochi follows the IRCv3 WebSocket sub-protocol: each frame carries a
    // complete IRC message and the trailing CRLF is OPTIONAL — Orochi omits it
    // entirely (e.g. ":eshmaki.me CAP * LS :..." with no newline). The browser
    // reassembles continuation frames, so every onmessage delivers whole
    // message(s), never a partial line. We split on optional CR/LF and process
    // every non-empty segment.
    //
    // We must NOT retain a trailing remainder across frames: the previous
    // `split('\n')` + `buffer = lines.pop()` stashed the CRLF-less final line
    // forever, so CAP LS was never handled and registration hung — surfacing
    // as a "WebSocket error" that made the client appear unable to connect.
    // A single frame may still legitimately batch several CRLF-separated lines.
    this._buffer += data;
    const lines = this._buffer.split(/\r?\n/);
    this._buffer = '';

    for (const line of lines) {
      if (!line) continue;
      this.opts.onRaw?.(line, 'in');
      try {
        const msg = parseIRCMessage(line);
        this._handleMessage(msg);
      } catch (e) {
        // A malformed line must not abort processing of the rest of the frame.
        console.warn('[nexus] failed to handle IRC line:', line, e);
      }
    }
  }

  private _onClose(ev: CloseEvent) {
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
              const eqIdx = token.indexOf('=');
              const capName = eqIdx === -1 ? token : token.slice(0, eqIdx);
              const capVal = eqIdx === -1 ? '' : token.slice(eqIdx + 1);
              this._capAvailable.push(capName);
              this.capValues.set(capName, capVal);
              if (capName === 'sasl' && capVal) {
                this._saslMechs = capVal.split(',');
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
            for (const c of caps) {
              this.negotiatedCaps.add(c);
              this._capReqPendingNames.delete(c);
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
                this.opts.onError?.(`No supported SASL mechanism offered (${this._saslMechs.join(', ') || 'none'})`);
                this.ws?.close(4003, 'Unsupported SASL mechanism');
                return;
              }
              // Guard against server never responding to AUTHENTICATE
              this._saslTimer = setTimeout(() => {
                this.opts.onError?.('SASL authentication timed out');
                this._saslPending = false;
                this._saslMech = null;
                this._finishCap();
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
              const eqIdx = token.indexOf('=');
              const capName = eqIdx === -1 ? token : token.slice(0, eqIdx);
              const capVal = eqIdx === -1 ? '' : token.slice(eqIdx + 1);
              newAvailable.push(capName);
              this.capValues.set(capName, capVal);
              if (capName === 'sasl' && capVal) newSaslMechs.push(...capVal.split(','));
            }
            this._capAvailable.push(...newAvailable);
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
            const plain = btoa(`\0${nick}\0${pass}`);
            this.sendRaw('AUTHENTICATE', plain);
          }
        } else if (this._saslMech === 'EXTERNAL') {
          if (param === '+') this.sendRaw('AUTHENTICATE', '+');
        } else if (this._saslMech === 'SCRAM-SHA-256') {
          if (param === '+') {
            // Server ready — send client-first-message
            this._scramClientFirst();
          } else {
            // Server challenge — process it
            this._scramClientFinal(param).catch(e => {
              this.opts.onError?.(`SCRAM error: ${e}`);
              this._saslPending = false;
              this._finishCap();
            });
          }
        }
        break;
      }

      // NOTE: 903/904/905 are reused by Orochi's IRCX layer post-registration
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
          // Orochi's SESSION command requires a registered connection (it checks
          // session.account() and lives in the post-registration command path),
          // so it is issued after 001 (see the '001' case below). Sending it
          // during CAP/SASL would be rejected as a pre-registration command.
          this._finishCapIfReady();
        }
        break;

      case '904': // ERR_SASLFAIL (during SASL only)
      case '905':
        if (this._saslPending || this._saslMech) {
          if (this._saslTimer) { clearTimeout(this._saslTimer); this._saslTimer = null; }
          this._saslPending = false;
          this._saslMech = null;
          this._scramState = null;
          this._finishCapIfReady();
        }
        break;

      case '433': // Nickname in use
      case '432': // Erroneous nickname
      case '437': // Nick/channel unavailable
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
        if (this._listPending) this._listPending.rows = [];
        break;

      case '322': { // RPL_LIST: :server 322 me #channel <users> :<topic>
        const pending = this._listPending;
        if (pending) {
          const channel = msg.params[1] ?? '';
          const users = Number.parseInt(msg.params[2] ?? '0', 10);
          const topic = msg.params[3] ?? '';
          if (channel) {
            pending.rows.push({ channel, users: Number.isFinite(users) ? users : 0, topic });
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
        // Both are no-ops server-side unless logged in.
        //
        // Prefer the mesh-sealed token for RESUME: a reconnect may land on a
        // different mesh node, where the local 16-byte token is meaningless but
        // the mesh token still reclaims/redirects (server.zig handleMeshReclaim).
        // Fall back to the local token when no mesh token is held.
        if (this._loggedIn) {
          const resumeToken = this.opts.meshToken || this.opts.sessionToken;
          if (resumeToken) {
            this.send(buildSessionResumeLine(resumeToken));
          }
          this.sendRaw('SESSION', 'TOKEN');
        }
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

    // Always forward to store handler
    this.opts.onMessage(msg);

    // Fan out to auxiliary subscribers (feature hooks etc.)
    if (this.extraMessageHandlers.size > 0) {
      for (const h of this.extraMessageHandlers) {
        try { h(msg); } catch { /* keep other subscribers alive */ }
      }
    }
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
      // STARTTLS upgrade: Ocean already uses WSS; requesting this is wrong.
      if (cap === 'tls') return false;
      // sts (Strict Transport Security): an informational cap whose value is the
      // transport policy. It is advertised, not negotiated — Orochi NAKs a REQ
      // for it. The TLS upgrade is already implicit in the wss:// endpoint.
      if (cap === 'sts') return false;
      // SASL: only request when we have credentials to send.
      if (cap === 'sasl') return Boolean(this.opts.password || this.opts.hasClientCert);
      // no-implicit-names: Ocean relies on the automatic 353 NAMREPLY on
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
      // labeled-response: no @label= request/response correlation in Ocean.
      if (cap === 'labeled-response') return false;
      // draft/channel-rename: requested — the store handles the native
      // `:renamer RENAME #old #new [:reason]` line and migrates channel state
      // (messages, membership, unread, active view) under the new key.
      // draft/file-upload: Ocean uses HTTP POST to a media server;
      // the IRC-level file-upload protocol is not implemented.
      if (cap === 'draft/file-upload') return false;
      // bot: Ocean is a human client, not a bot.
      if (cap === 'bot') return false;

      // orochi/session-sync: server-driven session reclaim. When ACKed, the
      // server auto-pushes JOIN + NAMES/topic + CHATHISTORY replay for every
      // channel the account's session is live in, so the client must NOT run
      // its own blind autojoin storm. Always request it when offered; the
      // store gates autojoin suppression on negotiatedCaps having it.
      // (Falls through to `return true` — listed here only for documentation.)

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
    this.sendRaw('AUTHENTICATE', btoa(msg));
  }

  private async _scramClientFinal(challengeB64: string) {
    const state = this._scramState;
    if (!state) return;

    let serverFirst: string;
    try {
      serverFirst = atob(challengeB64);
    } catch {
      this.opts.onError?.('SCRAM: invalid challenge encoding');
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
      this.opts.onError?.('SCRAM: server nonce mismatch');
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

    const proofB64 = btoa(String.fromCharCode(...clientProof));
    const clientFinal = `${clientFinalWithoutProof},p=${proofB64}`;
    this.sendRaw('AUTHENTICATE', btoa(clientFinal));
    this._scramState = null;
  }

  private _parseISUPPORT(params: string[]) {
    // params[0] = ournick, params[last] = "are supported by this server" — skip both.
    for (const token of params.slice(1, -1)) {
      const eqIdx = token.indexOf('=');
      const key = eqIdx === -1 ? token : token.slice(0, eqIdx);
      const val = eqIdx === -1 ? '' : token.slice(eqIdx + 1);

      switch (key) {
        case 'PREFIX': {
          const { modeToPrefix, prefixToMode } = parsePREFIX(val);
          this.modeToPrefix = modeToPrefix;
          this.prefixToMode = prefixToMode;
          this.isupport.PREFIX = modeToPrefix;
          this.isupport.PREFIX_MODES = prefixToMode;
          break;
        }
        case 'NETWORK':
          this.isupport.NETWORK = val;
          break;
        case 'CHANTYPES':
          this.isupport.CHANTYPES = val;
          break;
        case 'CASEMAPPING':
          this.isupport.CASEMAPPING = val;
          break;
        case 'NICKLEN':
          this.isupport.NICKLEN = parseInt(val, 10);
          break;
        case 'TOPICLEN':
          this.isupport.TOPICLEN = parseInt(val, 10);
          break;
        case 'CHANLIMIT':
          this.isupport.CHANLIMITS = parseCHANLIMIT(val);
          this.isupport.MAXCHANNELS = Object.values(this.isupport.CHANLIMITS)[0] ?? this.isupport.MAXCHANNELS;
          break;
        case 'MAXCHANNELS':
          this.isupport.MAXCHANNELS = parseInt(val, 10);
          break;
        case 'MODES':
          this.isupport.MODES = parseInt(val, 10);
          break;
        case 'CHANMODES':
          this.isupport.CHANMODES = val.split(',');
          break;
        case 'IRCX':
          this.isupport.IRCX = true;
          break;
        case 'SILENCE':
          this.isupport.SILENCE = parseInt(val, 10) || 20;
          break;
        case 'VAPID':
          this.isupport.VAPID = val;
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
