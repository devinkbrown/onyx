'use client';

import { parseIRCMessage, formatIRCLine, parsePREFIX } from './parser';
import type { IRCMessage, ISupport } from './types';

export type IRCEventHandler = (msg: IRCMessage) => void;
export type RawHandler = (line: string, direction: 'in' | 'out') => void;

export interface IRCClientOptions {
  url: string;           // e.g. wss://eshmaki.me:8080
  nick: string;
  realname?: string;
  username?: string;
  password?: string;     // SASL PLAIN password
  /** called for every parsed message */
  onMessage: IRCEventHandler;
  onRaw?: RawHandler;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onError?: (err: string) => void;
  onNickChanged?: (newNick: string) => void;
}

const RECONNECT_BASE = 2000;
const RECONNECT_MAX = 60000;

export class IRCClient {
  private ws: WebSocket | null = null;
  private opts: IRCClientOptions;
  /**
   * The nick passed to the constructor — never mutated even when the server
   * sends 433 and we fall back to kain_.  Used as the SASL authcid so that
   * SESSION-TOKEN (and PLAIN) always identify against the original nick/account.
   */
  private _authNick: string;
  private reconnectDelay = RECONNECT_BASE;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;
  private _registered = false;
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
  private _saslMech: 'SCRAM-SHA-256' | 'PLAIN' | 'SESSION-TOKEN' | null = null;
  /** SCRAM state between challenge/response steps */
  private _scramState: { clientFirstMsgBare: string; nonce: string } | null = null;
  /** How many times we've appended _ to nick during registration */
  private _nickRetries = 0;
  /** SASL auth timeout guard */
  private _saslTimer: ReturnType<typeof setTimeout> | null = null;

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

  isupport: ISupport = {
    PREFIX: { q: '.', o: '@', v: '+' },
    CHANMODES: [],
    CHANTYPES: '#&',
    NETWORK: 'IRCXNet',
    CASEMAPPING: 'rfc1459',
    MODES: 4,
    MAXCHANNELS: 20,
    NICKLEN: 30,
    TOPICLEN: 307,
    IRCX: false,
    MAXDATA: 512,
    COMICCHAT: '',
    LADONMEDIA: '',
    MAXMEDIA: 2048,
    MEDIAUMODES: '',
    MEDIAMUTE: '',
    MEDIAFRAME: '',      // MEDIAFRAME=VOICE_JOIN,VIDEO_JOIN,... — supported subtypes
    MEDIACHUNK: 0,       // MEDIACHUNK=160 — max base64 chars per MCHUNK chunk
    SILENCE: 0,          // SILENCE=20 — max entries in server-side silence list
  };

  /** Map prefix char → mode letter, e.g. '@' → 'o' */
  prefixToMode: Record<string, string> = { '~': 'q', '.': 'q', '@': 'o', '+': 'v' };
  /** Map mode letter → prefix char (used for display) */
  modeToPrefix: Record<string, string> = { q: '.', o: '@', v: '+' };

  constructor(opts: IRCClientOptions) {
    this.opts = opts;
    // Save before any nick mutations (433 collision appends '_')
    this._authNick = opts.nick;
  }

  connect() {
    if (this._destroyed) return;
    this._registered = false;
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
    if (this._saslTimer) { clearTimeout(this._saslTimer); this._saslTimer = null; }

    try {
      this.ws = new WebSocket(this.opts.url);
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
    this.ws?.close();
    this.ws = null;
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

  // ── Public IRC command helpers ──────────────────────────────────────────

  join(channel: string, key?: string) {
    this.sendRaw('JOIN', channel, ...(key ? [key] : []));
  }

  tagmsg(target: string, tags: Record<string, string>) {
    const tagStr = Object.entries(tags).map(([k, v]) => v ? `${k}=${v}` : k).join(';');
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
    const data = typeof ev.data === 'string' ? ev.data : '';
    // Some servers may batch lines
    this._buffer += data;
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '');
      if (!line) continue;
      this.opts.onRaw?.(line, 'in');
      const msg = parseIRCMessage(line);
      this._handleMessage(msg);
    }
  }

  private _onClose(ev: CloseEvent) {
    this._clearPingTimers();
    const reason = ev.reason || `code ${ev.code}`;
    console.error('[nexus] ws closed — code:', ev.code, 'reason:', ev.reason || '(none)', 'wasClean:', ev.wasClean);
    this.opts.onDisconnected?.(reason);
    if (!this._destroyed) {
      this._scheduleReconnect();
    }
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
            if (caps.includes('sasl') && this.opts.password) {
              this._saslPending = true;
              // Prefer SESSION-TOKEN when the caller supplied a stored token
              // (identified by the sst_ prefix written by lib/credentials.ts).
              // Fall back to PLAIN for normal password auth.
              const isToken = (this.opts.password ?? '').startsWith('sst_');
              if (isToken && this._saslMechs.includes('SESSION-TOKEN')) {
                this._saslMech = 'SESSION-TOKEN';
                this.sendRaw('AUTHENTICATE', 'SESSION-TOKEN');
              } else if (this._saslMechs.includes('PLAIN')) {
                this._saslMech = 'PLAIN';
                this.sendRaw('AUTHENTICATE', 'PLAIN');
              } else if (this._saslMechs.includes('SCRAM-SHA-256')) {
                this._saslMech = 'SCRAM-SHA-256';
                this.sendRaw('AUTHENTICATE', 'SCRAM-SHA-256');
              } else {
                this._saslMech = 'PLAIN';
                this.sendRaw('AUTHENTICATE', 'PLAIN');
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
        if (this._saslMech === 'SESSION-TOKEN') {
          if (param === '+') {
            // Wire: base64(authcid NUL token)
            // Use _authNick (original nick) — opts.nick may have been mutated
            // to 'kain_' by the 433 handler before AUTHENTICATE fires.
            const authcid = this._authNick;
            const token   = this.opts.password ?? '';
            this.sendRaw('AUTHENTICATE', btoa(`${authcid}\0${token}`));
          }
        } else if (this._saslMech === 'PLAIN') {
          if (param === '+') {
            // Use _authNick for the same reason — post-433, opts.nick is the alias.
            const nick = this._authNick;
            const pass = this.opts.password ?? '';
            const plain = btoa(`\0${nick}\0${pass}`);
            this.sendRaw('AUTHENTICATE', plain);
          }
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

      case '903': // SASL success
        if (this._saslTimer) { clearTimeout(this._saslTimer); this._saslTimer = null; }
        this._saslPending = false;
        this._saslMech = null;
        this._scramState = null;
        this._finishCapIfReady();
        break;

      case '904': // SASL fail
      case '905':
        if (this._saslTimer) { clearTimeout(this._saslTimer); this._saslTimer = null; }
        this._saslPending = false;
        this._saslMech = null;
        this._scramState = null;
        // Purge any stored session token — the server rejected it; next connect falls back to password
        import('@/lib/credentials').then(({ clearSessionToken }) => clearSessionToken()).catch(() => {});
        this._finishCapIfReady();
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

      case '001':
        this._registered = true;
        // Send IRCX before notifying the store (which will trigger JOIN)
        this.sendRaw('IRCX');
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
      // SASL: only request when we have credentials to send.
      if (cap === 'sasl') return Boolean(this.opts.password);
      // no-implicit-names: Ocean relies on the automatic 353 NAMREPLY on
      // JOIN to populate the member list; opting in would suppress it.
      if (cap === 'no-implicit-names') return false;

      // ── Unimplemented protocol caps ───────────────────────────────────────
      // draft/multiline: Ocean splits newlines into separate PRIVMSGs; the
      // BATCH-based multiline protocol is not implemented.
      if (cap === 'draft/multiline') return false;
      // draft/search: searchMessages() filters locally loaded messages;
      // the server-side SEARCH command is not used.
      if (cap === 'draft/search') return false;
      // labeled-response: no @label= request/response correlation in Ocean.
      if (cap === 'labeled-response') return false;
      // draft/channel-rename: no RENAME command handler.
      if (cap === 'draft/channel-rename') return false;
      // draft/file-upload: Ocean uses HTTP POST to a media server;
      // the IRC-level file-upload protocol is not implemented.
      if (cap === 'draft/file-upload') return false;
      // bot: Ocean is a human client, not a bot.
      if (cap === 'bot') return false;

      return true;
    });
  }

  private _scramClientFirst() {
    const arr = new Uint8Array(18);
    crypto.getRandomValues(arr);
    const nonce = btoa(String.fromCharCode(...arr)).replace(/[+/=]/g, c =>
      c === '+' ? '-' : c === '/' ? '_' : ''
    );
    const clientFirstMsgBare = `n=${this._authNick},r=${nonce}`;
    this._scramState = { clientFirstMsgBare, nonce };
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
      parts[p[0]] = p.slice(2);
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

    // SaltedPassword = PBKDF2(password, salt, iterations, SHA-256)
    const rawKey = await crypto.subtle.importKey(
      'raw', enc.encode(this.opts.password ?? ''),
      'PBKDF2', false, ['deriveBits']
    );
    const saltedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      rawKey, 256
    );
    const saltedPass = new Uint8Array(saltedBits);

    const hmac = async (keyData: Uint8Array, data: Uint8Array) => {
      const k = await crypto.subtle.importKey(
        'raw', keyData.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      return new Uint8Array(await crypto.subtle.sign('HMAC', k, data.buffer as ArrayBuffer));
    };

    const clientKey = await hmac(saltedPass, enc.encode('Client Key'));
    const storedKeyBuf = await crypto.subtle.digest('SHA-256', clientKey);
    const storedKey = new Uint8Array(storedKeyBuf);

    // c=biws is base64("n,,") — channel binding not supported
    const clientFinalWithoutProof = `c=biws,r=${serverNonce}`;
    const authMessage = `${state.clientFirstMsgBare},${serverFirst},${clientFinalWithoutProof}`;

    const clientSig = await hmac(storedKey, enc.encode(authMessage));
    const clientProof = clientKey.map((b, i) => b ^ clientSig[i]);

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
          // ophion displays owner as '.' but may advertise '~' in PREFIX.
          // Keep the server's prefix char in prefixToMode so NAMES parsing works,
          // but override the display char to '.' so the nicklist shows '.' for owners.
          if ('q' in modeToPrefix) {
            modeToPrefix['q'] = '.';      // display as '.'
            prefixToMode['.'] = 'q';      // also accept '.' from NAMES
            // original '~' → 'q' remains in prefixToMode for servers that send '~'
          }
          this.modeToPrefix = modeToPrefix;
          this.prefixToMode = prefixToMode;
          this.isupport.PREFIX = modeToPrefix;
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
        case 'MAXCHANNELS':
        case 'CHANLIMIT':
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
        case 'MAXDATA':
          this.isupport.MAXDATA = parseInt(val, 10) || 512;
          break;
        case 'COMICCHAT':
          this.isupport.COMICCHAT = val;
          break;
        case 'LADONMEDIA':
          this.isupport.LADONMEDIA = val || 'MEDIA';
          break;
        case 'MAXMEDIA':
          this.isupport.MAXMEDIA = parseInt(val, 10) || 2048;
          break;
        case 'MEDIAUMODES':
          this.isupport.MEDIAUMODES = val;
          break;
        case 'MEDIAMUTE':
          this.isupport.MEDIAMUTE = val;
          break;
        case 'MEDIAFRAME':
          this.isupport.MEDIAFRAME = val;
          break;
        case 'MEDIACHUNK':
          this.isupport.MEDIACHUNK = parseInt(val, 10) || 160;
          break;
        case 'SILENCE':
          this.isupport.SILENCE = parseInt(val, 10) || 20;
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
    if (this.pingTimer) clearTimeout(this.pingTimer);
    this._clearPongTimeout();
  }

  private _clearPongTimeout() {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  // ── Reconnect ──────────────────────────────────────────────────────────

  private _scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX);
      this.connect();
    }, this.reconnectDelay);
  }

  private _clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this._saslTimer) { clearTimeout(this._saslTimer); this._saslTimer = null; }
    this._clearPingTimers();
  }
}
