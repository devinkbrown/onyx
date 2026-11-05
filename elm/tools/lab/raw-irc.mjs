// SPDX-License-Identifier: AGPL-3.0-or-later
import { connect as tlsConnect } from 'node:tls';

const MAX_LINE = 8192;
const MAX_WIRE = 4 * 1024 * 1024;
const DIAGNOSTIC_PHASES = new Set(['account-A-register', 'account-B-register', 'account-C-register', 'origin-login', 'origin-join', 'origin-token-local', 'origin-token-mesh', 'near-login', 'near-local-resume', 'middle-login', 'middle-mesh-resume', 'far-login', 'far-mesh-resume', 'fifth-login', 'fifth-mesh-resume', 'channel-canary', 'dm-peer-login', 'dm-canary', 'origin-names-end', 'physical-pings', 'busy-login', 'busy-exact-resume', 'missing-aid-login', 'missing-aid-resume', 'invalid-token-login', 'invalid-token-resume', 'origin-detach', 'detached-login', 'detached-restore', 'local-list-end', 'drop-current-denied', 'drop-other-accepted', 'stale-drop-denied', 'mesh-link-cut', 'mesh-link-reconnect', 'mesh-owner-resume-offline', 'mesh-owner-resume-restored']);
const DIAGNOSTIC_ACTORS = new Set(['A-origin', 'A-near', 'B-middle', 'C-far', 'C-fifth', 'A-busy', 'A-missing-aid', 'A-invalid-token', 'A-detached', 'registrar-A', 'registrar-B', 'registrar-C', 'dm-peer', 'B-mesh-admin']);
const DIAGNOSTIC_COMMANDS = new Set(['CAP_LS', 'CAP_REQ', 'SASL_START', 'SASL_PAYLOAD', 'REGISTER', 'REGISTRATION', 'JOIN', 'SESSION_TOKEN_LOCAL', 'SESSION_TOKEN_MESH', 'SESSION_RESUME', 'SESSION_LIST', 'SESSION_DROP', 'PRIVMSG_CANARY', 'NAMES', 'PING', 'SQUIT', 'CONNECT']);
const DIAGNOSTIC_CODES = new Set(['TEMPORARILY_UNAVAILABLE', 'ORIGIN_UNREACHABLE', 'ATTACHMENT_IN_USE', 'NO_ATTACHMENT', 'INVALID_TOKEN', 'NO_SESSION', 'SESSION_REVOKED', 'RESUME_CREDENTIAL_PRESERVED', 'PRIVMSG_TEMPORARILY_UNAVAILABLE', 'PRIVMSG_CTCP_BLOCKED', 'PRIVMSG_E2EE_REQUIRED', 'PRIVMSG_INPUT_TOO_LONG', 'PRIVMSG_OTHER_FAILURE', 'PRIVMSG_OTHER_WARNING', 'IRC_401', 'IRC_404', 'IRC_477', 'IRC_482', 'IRC_716', 'IRC_OTHER_4XX']);
const RESPONSE_FAMILIES = ['numeric', 'CAP', 'AUTHENTICATE', 'NOTICE_SESSION', 'FAIL_SESSION', 'WARN_SESSION', 'PRIVMSG_CANARY', 'PRIVMSG_FAIL', 'PRIVMSG_WARN', 'PRIVMSG_REFUSAL', 'NAMES_END', 'PONG'];
const PRIVMSG_CODES = new Map([
  ['TEMPORARILY_UNAVAILABLE', 'PRIVMSG_TEMPORARILY_UNAVAILABLE'],
  ['CTCP_BLOCKED', 'PRIVMSG_CTCP_BLOCKED'],
  ['E2EE_REQUIRED', 'PRIVMSG_E2EE_REQUIRED'],
  ['INPUT_TOO_LONG', 'PRIVMSG_INPUT_TOO_LONG'],
]);
const IRC_REFUSALS = new Map([['401', 'IRC_401'], ['404', 'IRC_404'], ['477', 'IRC_477'], ['482', 'IRC_482'], ['716', 'IRC_716']]);
const CAPS = 'message-tags server-time echo-message onyx/session-sync sasl';
export const DEFAULT_GUEST_CAPABILITIES = 'message-tags server-time echo-message';

export function parseIrcLine(raw) {
  let rest = raw.replace(/\r?\n$/u, '');
  const tags = Object.create(null);
  let prefix = null;
  if (rest.startsWith('@')) {
    const end = rest.indexOf(' ');
    if (end < 0) return { tags, prefix, nick: null, command: '', params: [] };
    for (const tag of rest.slice(1, end).split(';')) {
      if (!tag) continue;
      const equal = tag.indexOf('=');
      const key = equal < 0 ? tag : tag.slice(0, equal);
      Object.defineProperty(tags, key, { value: equal < 0 ? '' : tag.slice(equal + 1), enumerable: true });
    }
    rest = rest.slice(end + 1);
  }
  if (rest.startsWith(':')) {
    const end = rest.indexOf(' ');
    if (end < 0) return { tags, prefix, nick: null, command: '', params: [] };
    prefix = rest.slice(1, end);
    rest = rest.slice(end + 1);
  }
  const commandEnd = rest.indexOf(' ');
  const command = (commandEnd < 0 ? rest : rest.slice(0, commandEnd)).toUpperCase();
  rest = commandEnd < 0 ? '' : rest.slice(commandEnd + 1);
  const params = [];
  while (rest.length > 0) {
    while (rest.startsWith(' ')) rest = rest.slice(1);
    if (!rest) break;
    if (rest.startsWith(':')) { params.push(rest.slice(1)); break; }
    const end = rest.indexOf(' ');
    if (end < 0) { params.push(rest); break; }
    params.push(rest.slice(0, end));
    rest = rest.slice(end + 1);
  }
  const nick = prefix === null ? null : prefix.split(/[!@]/u, 1)[0] || null;
  return { tags, prefix, nick, command, params };
}

export class RawIrcClient {
  #socket;
  #buffer = '';
  #lines = [];
  #waiters = [];
  #bytes = 0;
  #failure = null;
  #diagnostic = { phase: null, actorRole: null, node: null, commandClass: null, startedAt: 0, lastCompletedPhase: null, responseFamiliesObserved: Object.fromEntries(RESPONSE_FAMILIES.map((name) => [name, 0])) };
  #serverName = null;
  #diagnosticTarget = null;
  #diagnosticTargetStartLine = null;

  constructor(port, label) {
    this.label = label;
    this.#socket = tlsConnect({ host: '127.0.0.1', port, servername: 'localhost', rejectUnauthorized: false, minVersion: 'TLSv1.3' });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#socket.destroy(); reject(new Error('tls_connect_deadline')); }, 5000);
      this.#socket.once('secureConnect', () => { clearTimeout(timer); resolve(); });
      this.#socket.once('error', () => { clearTimeout(timer); reject(new Error('tls_socket_io')); });
    });
    this.#socket.setEncoding('utf8');
    this.#socket.on('data', (chunk) => this.#read(chunk));
    this.#socket.on('error', () => this.#fail('tls_socket_io'));
    this.#socket.on('close', () => this.#fail('tls_socket_closed'));
  }

  get seen() { return this.#lines.slice(); }
  close() { this.#socket.destroy(); }
  setDiagnosticContext({ phase, actorRole, node, lastCompletedPhase = null }) {
    this.#diagnostic = { phase: DIAGNOSTIC_PHASES.has(phase) ? phase : null,
      actorRole: DIAGNOSTIC_ACTORS.has(actorRole) ? actorRole : null,
      node: ['A', 'B', 'C'].includes(node) ? node : null, commandClass: null, startedAt: Date.now(),
      lastCompletedPhase: DIAGNOSTIC_PHASES.has(lastCompletedPhase) ? lastCompletedPhase : null,
      responseFamiliesObserved: Object.fromEntries(RESPONSE_FAMILIES.map((name) => [name, 0])) };
    this.#diagnosticTarget = null;
    this.#diagnosticTargetStartLine = null;
  }
  markDiagnosticPhaseComplete() {
    if (this.#diagnostic.phase) this.#diagnostic.lastCompletedPhase = this.#diagnostic.phase;
    this.#diagnosticTarget = null;
    this.#diagnosticTargetStartLine = null;
  }
  setPrivmsgTargetForLab(target) {
    const canaryPhase = this.#diagnostic.phase === 'channel-canary' || this.#diagnostic.phase === 'dm-canary';
    this.#diagnosticTarget = canaryPhase && typeof target === 'string' && target.length > 0 && target.length <= 128
      && !/[\s,:\u0000-\u001f\u007f]/u.test(target) ? target : null;
    this.#diagnosticTargetStartLine = null;
  }
  privmsgFailureForLab(line, target) {
    const start = this.#diagnosticTargetStartLine;
    if (start === null || target !== this.#diagnosticTarget) return null;
    const lineIndex = this.#lines.indexOf(line, start);
    return lineIndex < start ? null : this.#privmsgFailure(line, target, lineIndex);
  }
  diagnostic(outcome, sourceCode = null) {
    const row = this.#diagnostic;
    return { schemaVersion: 1, phase: row.phase, actorRole: row.actorRole, node: row.node,
      commandClass: DIAGNOSTIC_COMMANDS.has(row.commandClass) ? row.commandClass : null, outcome, sourceCode: DIAGNOSTIC_CODES.has(sourceCode) ? sourceCode : null,
      elapsedMs: Math.min(600_000, Math.max(0, Date.now() - row.startedAt)),
      lastCompletedPhase: row.lastCompletedPhase,
      responseFamiliesObserved: { ...row.responseFamiliesObserved } };
  }

  #setCommandClass(line) {
    const untagged = line.startsWith('@') ? line.slice(line.indexOf(' ') + 1) : line;
    const [verb = '', sub = '', third = ''] = untagged.split(/\s+/u);
    const command = verb.toUpperCase(); const arg = sub.toUpperCase(); const detail = third.toUpperCase();
    let commandClass = null;
    if (command === 'CAP' && arg === 'LS') commandClass = 'CAP_LS';
    else if (command === 'CAP' && arg === 'REQ') commandClass = 'CAP_REQ';
    else if (command === 'AUTHENTICATE') commandClass = arg === 'PLAIN' || arg === 'SCRAM-SHA-256' || arg === 'EXTERNAL' ? 'SASL_START' : 'SASL_PAYLOAD';
    else if (command === 'REGISTER') commandClass = 'REGISTER';
    else if (command === 'NICK' || command === 'USER' || command === 'CAP') commandClass = 'REGISTRATION';
    else if (command === 'JOIN') commandClass = 'JOIN';
    else if (command === 'SESSION' && arg === 'TOKEN') commandClass = this.#diagnostic.phase === 'origin-token-mesh' ? 'SESSION_TOKEN_MESH' : 'SESSION_TOKEN_LOCAL';
    else if (command === 'SESSION' && arg === 'RESUME') commandClass = 'SESSION_RESUME';
    else if (command === 'SESSION' && arg === 'LIST') commandClass = 'SESSION_LIST';
    else if (command === 'SESSION' && arg === 'DROP') commandClass = 'SESSION_DROP';
    else if (command === 'PRIVMSG') commandClass = 'PRIVMSG_CANARY';
    else if (command === 'NAMES') commandClass = 'NAMES';
    else if (command === 'PING') commandClass = 'PING';
    else if (command === 'SQUIT') commandClass = 'SQUIT';
    else if (command === 'CONNECT') commandClass = 'CONNECT';
    this.#diagnostic.commandClass = commandClass;
  }

  #fail(code) {
    if (this.#failure) return;
    this.#failure = code;
    for (const waiter of this.#waiters.splice(0)) {
      const error = new Error(code); error.diagnostic = this.diagnostic('socket-closed'); waiter.reject(error);
    }
    this.#socket.destroy();
  }

  #read(chunk) {
    this.#bytes += Buffer.byteLength(chunk);
    if (this.#bytes > MAX_WIRE) { this.#fail('irc_wire_limit'); return; }
    this.#buffer += chunk;
    if (this.#buffer.length > MAX_LINE && !this.#buffer.includes('\r\n')) { this.#fail('irc_line_limit'); return; }
    for (;;) {
      const split = this.#buffer.indexOf('\r\n');
      if (split < 0) break;
      const line = this.#buffer.slice(0, split);
      this.#buffer = this.#buffer.slice(split + 2);
      if (Buffer.byteLength(line) > MAX_LINE) { this.#fail('irc_line_limit'); return; }
      if (line.startsWith('PING ')) this.send(`PONG ${line.slice(5)}`);
      const message = parseIrcLine(line);
      if (message.command === '001' && message.prefix) this.#serverName = message.prefix;
      this.#lines.push(line);
      const lineIndex = this.#lines.length - 1;
      const body = message.params.at(-1) || '';
      const privmsgIssue = this.#diagnosticTarget && this.#diagnosticTargetStartLine !== null
        ? this.#privmsgFailure(line, this.#diagnosticTarget, lineIndex) : null;
      const family = privmsgIssue?.family || (message.command === '366' ? 'NAMES_END'
        : /^\d{3}$/u.test(message.command) ? 'numeric'
        : message.command === 'CAP' ? 'CAP' : message.command === 'AUTHENTICATE' ? 'AUTHENTICATE'
          : message.command === 'NOTICE' && /^(?:SESSION|(?:FAIL|WARN) SESSION)\b/u.test(body) ? 'NOTICE_SESSION'
            : message.command === 'FAIL' && message.params[0] === 'SESSION' ? 'FAIL_SESSION'
              : message.command === 'WARN' && message.params[0] === 'SESSION' ? 'WARN_SESSION'
                : message.command === 'PRIVMSG' ? 'PRIVMSG_CANARY'
                  : message.command === 'PONG' ? 'PONG' : null);
      if (family && this.#diagnostic.responseFamiliesObserved[family] < 1000) this.#diagnostic.responseFamiliesObserved[family] += 1;
      const newNick = message.params[0];
      if (message.command === 'NICK' && this.nick && message.nick
        && message.nick.toLowerCase() === this.nick.toLowerCase() && newNick) this.nick = newNick;
      for (const waiter of [...this.#waiters]) {
        if (lineIndex >= waiter.start && waiter.predicate(line)) {
          this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
          waiter.resolve(line);
        }
      }
    }
  }

  #privmsgFailure(line, target, lineIndex) {
    if (!target || target.length > 128 || target !== this.#diagnosticTarget
      || !['channel-canary', 'dm-canary'].includes(this.#diagnostic.phase)
      || !this.#serverName || !this.nick || this.#diagnosticTargetStartLine === null
      || lineIndex < this.#diagnosticTargetStartLine) return null;
    const message = parseIrcLine(line);
    const codeFor = (code, warning = false) => PRIVMSG_CODES.get(code)
      || (warning ? 'PRIVMSG_OTHER_WARNING' : 'PRIVMSG_OTHER_FAILURE');
    if ((message.command === 'FAIL' || message.command === 'WARN') && message.prefix === null
      && message.params[0] === 'PRIVMSG' && message.params.length >= 3 && message.params[2] === target) {
      const warning = message.command === 'WARN';
      return { family: warning ? 'PRIVMSG_WARN' : 'PRIVMSG_FAIL', outcome: warning ? 'source-warn' : 'source-fail', sourceCode: codeFor(message.params[1] || '', warning) };
    }
    if (message.command === 'NOTICE' && message.prefix === this.#serverName && message.params.length === 2
      && message.params[0]?.toLowerCase() === this.nick?.toLowerCase()) {
      const body = message.params.at(-1) || '';
      const notice = body.match(/^(FAIL|WARN) PRIVMSG ([A-Z0-9_]+) ([^\s:]+):/u);
      if (notice && notice[3] === target) {
        const warning = notice[1] === 'WARN';
        return { family: warning ? 'PRIVMSG_WARN' : 'PRIVMSG_FAIL', outcome: warning ? 'source-warn' : 'source-fail', sourceCode: codeFor(notice[2] || '', warning) };
      }
    }
    if ((IRC_REFUSALS.has(message.command) || /^4\d\d$/u.test(message.command))
      && message.prefix === this.#serverName && message.params[0]?.toLowerCase() === this.nick.toLowerCase()
      && message.params[1] === target) {
      return { family: 'PRIVMSG_REFUSAL', outcome: 'source-fail', sourceCode: IRC_REFUSALS.get(message.command) || 'IRC_OTHER_4XX' };
    }
    return null;
  }

  send(line) {
    if (!line || line.length > MAX_LINE || /[\r\n\0]/.test(line)) throw new Error('invalid_irc_outbound');
    if (this.#failure) throw new Error(this.#failure);
    this.#setCommandClass(line);
    if (this.#diagnosticTarget !== null) {
      const outgoing = parseIrcLine(line);
      if (outgoing.command === 'PRIVMSG' && outgoing.params[0] === this.#diagnosticTarget) {
        this.#diagnosticTargetStartLine = this.#lines.length;
      } else if (outgoing.command === 'PRIVMSG') {
        this.#diagnosticTarget = null;
        this.#diagnosticTargetStartLine = null;
      }
    }
    this.#socket.write(`${line}\r\n`);
  }

  waitFor(predicate, timeoutMs = 12_000, start = 0) {
    let found;
    for (let index = start; index < this.#lines.length; index += 1) {
      const line = this.#lines[index];
      if (line !== undefined && predicate(line)) { found = line; break; }
    }
    if (found) return Promise.resolve(found);
    if (this.#failure) { const error = new Error(this.#failure); error.diagnostic = this.diagnostic('socket-closed'); return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, start };
      this.#waiters.push(waiter);
      const timer = setTimeout(() => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        const error = new Error('irc_response_deadline'); error.diagnostic = this.diagnostic('deadline'); reject(error);
      }, timeoutMs);
      waiter.resolve = (line) => { clearTimeout(timer); resolve(line); };
      waiter.reject = (error) => { clearTimeout(timer); reject(error); };
    });
  }

  async command(line, predicate, timeoutMs = 12_000) {
    const start = this.#lines.length;
    this.send(line);
      return this.waitFor(predicate, timeoutMs, start);
  }

  async guest(nick, capabilities = DEFAULT_GUEST_CAPABILITIES) {
    await this.ready;
    const start = this.#lines.length;
    this.send('CAP LS 302');
    await this.waitFor((line) => line.includes(' CAP ') && line.includes(' LS '), 12_000, start);
    this.send(`CAP REQ :${capabilities}`);
    const ack = await this.waitFor((line) => line.includes(' CAP ') && (line.includes(' ACK ') || line.includes(' NAK ')));
    const accepted = ack.includes(' ACK ')
      ? ack.slice(ack.indexOf(' ACK ') + 5).replace(/^:/u, '').split(/\s+/u)
      : [];
    if (!ack.includes(' ACK ') || capabilities.split(/\s+/u).some((capability) => !accepted.includes(capability))) {
      throw new Error('required_capabilities_refused');
    }
    this.send('CAP END'); this.send(`NICK ${nick}`); this.send('USER fixture 0 * :Local Onyx acceptance');
    await this.waitFor((line) => line.includes(' 001 '));
    this.nick = nick;
    return this;
  }

  async registerAccount(account, password) {
    const line = await this.command(`REGISTER ${account} * ${password}`, (row) => row.includes('REGISTER SUCCESS') || row.includes('FAIL REGISTER'), 20_000);
    if (!line.includes('REGISTER SUCCESS')) { const error = new Error('account_registration_refused'); error.diagnostic = this.diagnostic('source-fail'); throw error; }
  }

  async login(account, password, nick, capabilities = CAPS, { requireOper = false } = {}) {
    await this.ready;
    let start = this.#lines.length;
    this.send('CAP LS 302');
    await this.waitFor((line) => line.includes(' CAP ') && line.includes(' LS '), 12_000, start);
    const requested = [...new Set([...CAPS.split(' '), ...capabilities.split(' ')])].join(' ');
    this.send(`CAP REQ :${requested}`);
    const ack = await this.waitFor((line) => line.includes(' CAP ') && (line.includes(' ACK ') || line.includes(' NAK ')));
    if (!ack.includes(' ACK ') || requested.split(' ').some((cap) => !ack.includes(cap))) throw new Error('required_capabilities_refused');
    this.send('AUTHENTICATE PLAIN');
    await this.waitFor((line) => line.includes('AUTHENTICATE +'));
    const payload = Buffer.from(`\0${account}\0${password}`).toString('base64');
    start = this.#lines.length;
    this.send(`AUTHENTICATE ${payload}`);
    const auth = await this.waitFor((line) => / [0-9]{3} /.test(line) && / 90[3-7] /.test(line), 12_000, start);
    if (!auth.includes(' 903 ')) { const error = new Error('sasl_login_refused'); error.diagnostic = this.diagnostic('source-fail'); throw error; }
    start = this.#lines.length;
    this.send('CAP END'); this.send(`NICK ${nick}`); this.send('USER fixture 0 * :Local Onyx acceptance');
    await this.waitFor((line) => line.includes(' 001 '), 12_000, start);
    this.nick = nick;
    if (requireOper) {
      const operLine = await this.waitFor((line) => {
        const message = parseIrcLine(line);
        return message.command === '381' && message.params[0]?.toLowerCase() === nick.toLowerCase();
      }, 12_000, start);
      if (!operLine.includes(' 381 ')) throw new Error('oper_elevation_not_confirmed');
    }
    return this;
  }

  async tokens() {
    const start = this.#lines.length;
    this.send('SESSION TOKEN');
    this.#diagnostic.phase = 'origin-token-local'; this.#diagnostic.commandClass = 'SESSION_TOKEN_LOCAL';
    const local = await this.waitFor((line) => this.#isSessionTokenNotice(line, 'SESSION TOKEN') || this.#sessionIssueFailure(line), 12_000, start);
    const localIssue = this.#sessionIssueFailure(local);
    if (localIssue) throw this.#sessionIssueError(localIssue);
    this.markDiagnosticPhaseComplete();
    this.#diagnostic.phase = 'origin-token-mesh'; this.#diagnostic.commandClass = 'SESSION_TOKEN_MESH'; this.#diagnostic.startedAt = Date.now();
    const portable = await this.waitFor((line) => this.#isSessionTokenNotice(line, 'SESSION MTOKEN') || this.#sessionIssueFailure(line), 12_000, start);
    const portableIssue = this.#sessionIssueFailure(portable);
    if (portableIssue) throw this.#sessionIssueError(portableIssue);
    const localToken = local.split(' :SESSION TOKEN ')[1]?.split(' ')[0];
    const meshToken = portable.split(' :SESSION MTOKEN ')[1]?.split(' ')[0];
    if (!localToken || !meshToken) { const error = new Error('session_credentials_absent'); error.diagnostic = this.diagnostic('local-rejection'); throw error; }
    this.markDiagnosticPhaseComplete();
    return { localToken, meshToken };
  }

  #isSessionTokenNotice(line, text) {
    const message = parseIrcLine(line);
    return message.command === 'NOTICE' && message.prefix === this.#serverName
      && message.params[0]?.toLowerCase() === this.nick?.toLowerCase()
      && (message.params.at(-1) || '').startsWith(`${text} `);
  }
  #sessionIssueFailure(line) {
    const message = parseIrcLine(line);
    if ((message.command === 'FAIL' || message.command === 'WARN') && message.params[0] === 'SESSION') {
      return { outcome: message.command === 'FAIL' ? 'source-fail' : 'source-warn', sourceCode: message.params[1] || null };
    }
    const body = message.params.at(-1) || '';
    const notice = body.match(/^(FAIL|WARN) SESSION ([A-Z0-9_]+):/u);
    if (message.command === 'NOTICE' && message.prefix === this.#serverName
      && message.params[0]?.toLowerCase() === this.nick?.toLowerCase() && notice) {
      return { outcome: notice[1] === 'FAIL' ? 'source-fail' : 'source-warn', sourceCode: notice[2] || null };
    }
    return null;
  }
  sessionIssueFailureForLab(line) { return this.#sessionIssueFailure(line); }
  #sessionIssueError(issue) {
    const error = new Error(issue.outcome === 'source-fail' ? 'session_token_source_fail' : 'session_token_source_warn');
    const sourceCode = issue.sourceCode && DIAGNOSTIC_CODES.has(issue.sourceCode) ? issue.sourceCode : null;
    error.diagnostic = this.diagnostic(issue.outcome, sourceCode);
    return error;
  }

  async resume(token, timeoutMs = 20_000) {
    const start = this.#lines.length;
    this.send(`SESSION RESUME ${token}`);
    const successNotices = new Set([
      'SESSION RESUME: already attached to this exact session',
      'SESSION RESUME: exact session restored',
      'SESSION RESUME: exact session reclaimed',
      'SESSION RESUME: exact session restored (cross-server)',
      'SESSION RESUME: exact session reclaimed (cross-server)',
      'SESSION RESUME: already attached to this session',
      'SESSION RESUME: attached to live session',
      'SESSION RESUME: attached to replicated mesh session',
      'SESSION RESUME: legacy session state cloned into a new attachment',
      'SESSION RESUME: legacy session attached as a new attachment',
      'SESSION RESUME: already attached to this mesh session',
      'SESSION RESUME: attached to live mesh session',
      'SESSION RESUME: session restored (cross-server)',
      'SESSION RESUME: session reclaimed (cross-server)',
    ]);
    const response = await this.waitFor((line) => {
      const message = parseIrcLine(line);
      return this.#sessionIssueFailure(line) !== null
        || message.command === 'NOTICE' && message.prefix === this.#serverName
          && message.params[0]?.toLowerCase() === this.nick?.toLowerCase()
          && /^SESSION (?:RESUME|REDIRECT):/u.test(message.params.at(-1) || '');
    }, timeoutMs, start);
    const issue = this.#sessionIssueFailure(response);
    if (issue) {
      const error = new Error('session_resume_refused');
      const sourceCode = issue.sourceCode && DIAGNOSTIC_CODES.has(issue.sourceCode) ? issue.sourceCode : null;
      error.diagnostic = this.diagnostic(issue.outcome, sourceCode);
      throw error;
    }
    const message = parseIrcLine(response);
    const notice = message.params.at(-1) || '';
    if (notice.startsWith('SESSION REDIRECT:')) {
      const error = new Error('session_redirect_needs_routing'); error.diagnostic = this.diagnostic('source-redirect'); throw error;
    }
    if (!successNotices.has(notice)) {
      const error = new Error('session_resume_refused'); error.diagnostic = this.diagnostic('local-rejection'); throw error;
    }
    return notice;
  }

  async join(channel) {
    await this.command(`JOIN ${channel}`, (line) => line.includes(` 366 `) && line.includes(channel));
  }

  async ping(marker) {
    const start = this.#lines.length;
    this.send(`PING :${marker}`);
    await this.waitFor((line) => line.includes('PONG ') && line.includes(marker), 12_000, start);
  }
}

export function safeIdentity(line) {
  const tags = parseIrcLine(line).tags;
  return { msgid: tags.msgid || null, time: tags.time || null };
}
