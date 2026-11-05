import { parseIRCMessage, formatIRCLine } from '../../src/lib/irc/parser';
import type { OwnerSnapshot, PrivateIngressEvent, RequestContext, RequestId, SendAdmission } from './contracts';

export type CommunitySection = 'autojoin' | 'nick-group';
export type CommunityOperation = 'list' | 'add' | 'remove' | 'primary';
export type CommunityReason = null | 'invalid-request' | 'owner-changed' | 'account-proof-required' | 'busy'
  | 'offline' | 'backpressure' | 'transport-error' | 'response-timeout' | 'invalid-response' | 'server-rejected' | 'unsupported';
export type CommunityStatus = 'idle' | 'pending' | 'ready' | 'unknown' | 'rejected' | 'unsupported';
export interface GroupRow { readonly nick: string; readonly primary: boolean }
export interface CommunityView {
  readonly kind: 'account-community';
  readonly requestId: RequestId;
  readonly section: CommunitySection;
  readonly status: CommunityStatus;
  readonly operation: CommunityOperation;
  readonly autojoinRows: readonly string[];
  readonly groupRows: readonly GroupRow[];
  readonly reason: CommunityReason;
}
export interface CommunityResult {
  readonly context: RequestContext;
  readonly status: 'pending' | 'accepted' | 'blocked' | 'unknown' | 'rejected';
  readonly reason: CommunityReason;
  readonly view: CommunityView;
}
export interface AccountCommunityDependencies {
  readonly currentOwner: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly currentNick: () => string | null;
  readonly currentServerPrefix: () => string | null;
  readonly sendLine: (input: { readonly context: RequestContext; readonly line: string }) => SendAdmission;
  readonly now: () => number;
  readonly randomRef: () => string;
  readonly emit: (result: CommunityResult) => void;
  readonly timeoutMs?: number;
}

type Pending = {
  context: RequestContext; owner: OwnerSnapshot; nick: string; prefix: string; section: CommunitySection;
  operation: CommunityOperation; phase: 'ack' | 'list'; command: string; target: string | null;
  acknowledged: boolean; admitting: boolean; buffered: PrivateIngressEvent[]; finalResult: CommunityResult | null; timer: ReturnType<typeof setTimeout>; stagedAutojoin: string[]; stagedGroup: GroupRow[];
};

const MAX_AUTOJOIN = 64;
const MAX_CHANNEL_BYTES = 128;
const MAX_GROUP_NICKS = 16;
const MAX_NICK_BYTES = 64;
const DEFAULT_TIMEOUT = 10_000;
const encoder = new TextEncoder();
const channelChars = /^[^\s,\u0000-\u001f\u007f:]+$/u;
const nickChars = /^[^\s,\u0000-\u001f\u007f:]+$/u;

function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.accountId === b.accountId
    && a.accountGeneration === b.accountGeneration && a.connectionGeneration === b.connectionGeneration
    && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
}
function ownerKey(owner: OwnerSnapshot): string {
  return JSON.stringify([owner.networkId, owner.accountId, owner.accountGeneration, owner.connectionGeneration, owner.physicalRef, owner.ownerRef]);
}
function validChannel(value: string): boolean {
  return encoder.encode(value).byteLength <= MAX_CHANNEL_BYTES && value.startsWith('#') && channelChars.test(value);
}
function validNick(value: string): boolean {
  return encoder.encode(value).byteLength <= MAX_NICK_BYTES && nickChars.test(value);
}
function asciiFold(value: string): string { return value.replace(/[A-Z]/gu, (letter) => letter.toLowerCase()); }
function groupEqual(a: string, b: string): boolean { return a === b; }

export function createAccountCommunityService(deps: AccountCommunityDependencies) {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT;
  const active = new Map<CommunitySection, Pending>();
  const mutationUnknown = new Set<string>();
  const rows = new Map<string, { autojoin: readonly string[]; group: readonly GroupRow[] }>();
  let disposed = false;

  function makeView(context: RequestContext, section: CommunitySection, status: CommunityStatus, operation: CommunityOperation, reason: CommunityReason,
    nextRows?: { autojoin: readonly string[]; group: readonly GroupRow[] }): CommunityView {
    const saved = nextRows ?? rows.get(JSON.stringify([ownerKey(context.owner), section])) ?? { autojoin: [], group: [] };
    return Object.freeze({ kind: 'account-community', requestId: context.requestId, section, status, operation,
      autojoinRows: Object.freeze([...saved.autojoin]), groupRows: Object.freeze(saved.group.map((row) => Object.freeze({ ...row }))), reason });
  }
  function publish(context: RequestContext, section: CommunitySection, operation: CommunityOperation, status: CommunityResult['status'], reason: CommunityReason,
    viewStatus: CommunityStatus, nextRows?: { autojoin: readonly string[]; group: readonly GroupRow[] }): CommunityResult {
    const result = Object.freeze({ context, status, reason, view: makeView(context, section, viewStatus, operation, reason, nextRows) });
    if (!disposed) deps.emit(result);
    return result;
  }
  function activeNow(entry: Pending): boolean {
    return !disposed && active.get(entry.section) === entry && deps.isCurrent(entry.owner)
      && sameOwner(entry.owner, deps.currentOwner()) && entry.owner.accountId !== null
      && deps.currentNick() === entry.nick && deps.currentServerPrefix() === entry.prefix;
  }
  function operationLabel(section: CommunitySection): string { return section === 'autojoin' ? 'AUTOJOIN' : 'GROUP'; }
  function listLine(section: CommunitySection): string { return section === 'autojoin' ? formatIRCLine('AUTOJOIN', 'LIST').trimEnd() : formatIRCLine('GROUP', 'LIST').trimEnd(); }
  function clear(entry: Pending): void { clearTimeout(entry.timer); if (active.get(entry.section) === entry) active.delete(entry.section); }
  function reasonFromAdmission(admission: Extract<SendAdmission, { readonly kind: 'blocked' }>): CommunityReason {
    if (admission.reason === 'owner-changed') return 'owner-changed';
    if (admission.reason === 'offline') return 'offline';
    if (admission.reason === 'backpressure') return 'backpressure';
    return 'invalid-request';
  }
  function fail(entry: Pending, status: 'blocked' | 'unknown' | 'rejected', reason: CommunityReason): CommunityResult {
    clear(entry);
    if (status === 'unknown' && entry.operation !== 'list') mutationUnknown.add(JSON.stringify([ownerKey(entry.owner), entry.section]));
    entry.finalResult = publish(entry.context, entry.section, entry.operation, status, reason,
      status === 'unknown' ? 'unknown' : status === 'rejected' ? 'rejected' : 'unsupported');
    return entry.finalResult;
  }
  function start(context: RequestContext, section: CommunitySection, operation: CommunityOperation, command: string, target: string | null): CommunityResult {
    const owner = Object.freeze({ ...context.owner });
    const nick = deps.currentNick();
    const prefix = deps.currentServerPrefix();
    if (disposed || context.schemaVersion !== 1 || !context.requestId || !deps.isCurrent(owner) || !sameOwner(owner, deps.currentOwner()))
      return publish(context, section, operation, 'blocked', 'owner-changed', 'unsupported');
    if (owner.accountId === null) return publish(context, section, operation, 'blocked', 'account-proof-required', 'unsupported');
    if (!nick || !validNick(nick) || !prefix || prefix.length > 512 || /[\s\u0000-\u001f\u007f]/u.test(prefix))
      return publish(context, section, operation, 'blocked', 'offline', 'unsupported');
    const currentEntry = active.get(section);
    if (currentEntry && !activeNow(currentEntry)) clear(currentEntry);
    if (active.has(section)) return publish(context, section, operation, 'blocked', 'busy', 'unsupported');
    const mutationKey = JSON.stringify([ownerKey(owner), section]);
    if (operation !== 'list' && mutationUnknown.has(mutationKey)) return publish(context, section, operation, 'blocked', 'invalid-request', 'unknown');
    if (section === 'autojoin' && target !== null && !validChannel(target) || section === 'nick-group' && target !== null && !validNick(target))
      return publish(context, section, operation, 'blocked', 'invalid-request', 'unsupported');
    const line = command;
    const entry: Pending = { context: Object.freeze({ ...context, owner }), owner, nick, prefix, section, operation,
      phase: operation === 'list' ? 'list' : 'ack', command: section === 'autojoin' ? 'AUTOJOIN' : 'GROUP', target,
      acknowledged: false, admitting: true, buffered: [], finalResult: null, timer: setTimeout(() => timeout(entry), timeoutMs), stagedAutojoin: [], stagedGroup: [] };
    active.set(section, entry);
    let admission: SendAdmission;
    try { admission = deps.sendLine({ context: entry.context, line }); }
    catch { admission = { kind: 'unknown', reason: 'transport-error' }; }
    entry.admitting = false;
    const buffered = entry.buffered.splice(0);
    if (admission.kind === 'blocked') { entry.buffered.length = 0; return fail(entry, 'blocked', reasonFromAdmission(admission)); }
    for (const event of buffered) consumePrivateIngress(event);
    if (active.get(section) !== entry) return entry.finalResult ?? resultForResolved(entry);
    if (admission.kind === 'unknown') return fail(entry, 'unknown', 'transport-error');
    return publish(entry.context, section, operation, 'pending', null, 'pending');
  }
  function resultForResolved(entry: Pending): CommunityResult {
    const saved = rows.get(JSON.stringify([ownerKey(entry.owner), entry.section]));
    return publish(entry.context, entry.section, entry.operation, 'accepted', null, 'ready', saved);
  }
  function timeout(entry: Pending): void {
    if (!activeNow(entry)) { clear(entry); return; }
    fail(entry, 'unknown', 'response-timeout');
  }
  function beginReconcile(entry: Pending): void {
    if (!activeNow(entry)) { fail(entry, 'unknown', 'owner-changed'); return; }
    entry.phase = 'list'; entry.stagedAutojoin = []; entry.stagedGroup = []; entry.admitting = true;
    let admission: SendAdmission;
    try { admission = deps.sendLine({ context: entry.context, line: listLine(entry.section) }); }
    catch { admission = { kind: 'unknown', reason: 'transport-error' }; }
    entry.admitting = false;
    const buffered = entry.buffered.splice(0);
    if (admission.kind === 'blocked') { entry.buffered.length = 0; fail(entry, 'unknown', reasonFromAdmission(admission)); return; }
    for (const event of buffered) consumePrivateIngress(event);
    if (admission.kind === 'unknown' && active.get(entry.section) === entry) fail(entry, 'unknown', 'transport-error');
  }
  function desiredStateMatches(entry: Pending, autojoin: readonly string[], group: readonly GroupRow[]): boolean {
    if (entry.operation === 'list' || entry.target === null) return true;
    if (entry.section === 'autojoin') {
      const found = autojoin.some((value) => asciiFold(value) === asciiFold(entry.target!));
      return entry.operation === 'add' ? found : !found;
    }
    const found = group.find((value) => groupEqual(value.nick, entry.target!));
    if (entry.operation === 'add') return !!found;
    if (entry.operation === 'remove') return !found;
    return !!found?.primary;
  }
  function completeList(entry: Pending): void {
    if (!activeNow(entry)) { fail(entry, 'unknown', 'owner-changed'); return; }
    const next = { autojoin: [...entry.stagedAutojoin], group: [...entry.stagedGroup] };
    if (!desiredStateMatches(entry, next.autojoin, next.group)) { fail(entry, 'unknown', 'invalid-response'); return; }
    rows.set(JSON.stringify([ownerKey(entry.owner), entry.section]), next);
    clear(entry);
    if (entry.operation === 'list') mutationUnknown.delete(JSON.stringify([ownerKey(entry.owner), entry.section]));
    const status = entry.operation === 'list' || entry.acknowledged ? 'accepted' : 'unknown';
    if (status === 'unknown') mutationUnknown.add(JSON.stringify([ownerKey(entry.owner), entry.section]));
    entry.finalResult = publish(entry.context, entry.section, entry.operation, status, status === 'accepted' ? null : 'invalid-response', status === 'accepted' ? 'ready' : 'unknown', next);
  }
  function parseNotice(entry: Pending, text: string): 'consumed' | 'ignored' | 'invalid' | 'rejected' {
    const label = operationLabel(entry.section);
    if (entry.phase === 'list') {
      if (entry.section === 'autojoin') {
        if (text === 'AUTOJOIN: end of list') { completeList(entry); return 'consumed'; }
        const match = /^AUTOJOIN (#[^\s,\u0000-\u001f\u007f:]+)$/u.exec(text);
        if (!match) return text.startsWith('AUTOJOIN') ? 'invalid' : 'ignored';
        const channel = match[1] ?? '';
        if (!validChannel(channel) || entry.stagedAutojoin.length >= MAX_AUTOJOIN || entry.stagedAutojoin.some((item) => asciiFold(item) === asciiFold(channel))) return 'invalid';
        entry.stagedAutojoin.push(channel); return 'consumed';
      }
      if (text === 'GROUP: end of list') { completeList(entry); return 'consumed'; }
      const match = /^GROUP ([^\s,\u0000-\u001f\u007f:]+)( \(primary\))?$/u.exec(text);
      if (!match) return text.startsWith('GROUP') ? 'invalid' : 'ignored';
      const nick = match[1] ?? '';
      if (!validNick(nick) || entry.stagedGroup.length >= MAX_GROUP_NICKS || entry.stagedGroup.some((row) => row.nick === nick)) return 'invalid';
      entry.stagedGroup.push({ nick, primary: match[2] !== undefined }); return 'consumed';
    }
    const expected = entry.section === 'autojoin'
      ? entry.operation === 'add' ? 'AUTOJOIN added' : 'AUTOJOIN removed'
      : entry.operation === 'add' ? 'GROUP nick added' : entry.operation === 'remove' ? 'GROUP nick removed' : 'GROUP primary set';
    if (text === expected) { entry.acknowledged = true; beginReconcile(entry); return 'consumed'; }
    const expectedFailure = entry.section === 'autojoin'
      ? entry.operation === 'add' && text === 'AUTOJOIN: could not add (invalid channel, duplicate, or limit)'
        || entry.operation === 'remove' && text === 'AUTOJOIN: no such entry'
      : entry.operation === 'add' && text === 'GROUP: could not add (invalid, duplicate, or limit)'
        || entry.operation === 'remove' && text === 'GROUP: no such grouped nick'
        || entry.operation === 'primary' && text === 'GROUP: nick must be in your group first';
    if (expectedFailure) return 'rejected';
    if (text.startsWith(`${label}:`) || text.startsWith(`${label} `)) return 'invalid';
    return 'ignored';
  }
  function relevantPrivateNotice(text: string): boolean { return /^(?:AUTOJOIN(?:\s|:)|GROUP(?:\s|:))/u.test(text); }

  function consumePrivateIngress(event: PrivateIngressEvent): boolean {
    if (disposed || (event.sourceKind !== 'server' && event.sourceKind !== 'prefixless-protocol')) return false;
    if (event.line.length > 8191 || /[\r\n\u0000]/u.test(event.line)) return false;
    const prefix = deps.currentServerPrefix(); const nick = deps.currentNick();
    if (!prefix || !nick) return false;
    const parsed = parseIRCMessage(event.line);
    const own = active.values().next().value as Pending | undefined;
    if (own && !sameOwner(own.owner, event.owner)) return false;
    if (event.sourceKind === 'server' && parsed.command === 'NOTICE' && parsed.prefix === prefix && parsed.params[0] === nick) {
      const text = parsed.params[1] ?? '';
      if (!relevantPrivateNotice(text)) return false;
      const entries = [...active.values()].filter((entry) => sameOwner(entry.owner, event.owner) && entry.nick === nick && entry.prefix === prefix);
      const matching = entries.find((entry) => entry.section === 'autojoin' ? text.startsWith('AUTOJOIN') : text.startsWith('GROUP'));
      if (!matching) return true;
      if (matching.admitting) {
        if (matching.buffered.length >= 128) { fail(matching, 'unknown', 'invalid-response'); return true; }
        matching.buffered.push(event);
        return true;
      }
      const outcome = parseNotice(matching, text);
      if (outcome === 'invalid') fail(matching, matching.operation === 'list' || matching.acknowledged ? 'unknown' : 'rejected', 'invalid-response');
      if (outcome === 'rejected') fail(matching, 'rejected', 'server-rejected');
      return true;
    }
    if (parsed.command === 'FAIL' && event.sourceKind === 'prefixless-protocol'
      && (parsed.params[0] === 'AUTOJOIN' || parsed.params[0] === 'GROUP') && parsed.params[1] === 'ACCOUNT_REQUIRED') {
      const section: CommunitySection = parsed.params[0] === 'AUTOJOIN' ? 'autojoin' : 'nick-group';
      const pending = active.get(section);
      if (pending && sameOwner(pending.owner, event.owner) && pending.nick === nick && pending.prefix === prefix) fail(pending, 'rejected', 'account-proof-required');
      return true;
    }
    return false;
  }

  return {
    listAutojoin(context: RequestContext): CommunityResult { return start(context, 'autojoin', 'list', listLine('autojoin'), null); },
    addAutojoin(input: { context: RequestContext; channel: string }): CommunityResult { return start(input.context, 'autojoin', 'add', formatIRCLine('AUTOJOIN', 'ADD', input.channel).trimEnd(), input.channel); },
    removeAutojoin(input: { context: RequestContext; channel: string }): CommunityResult { return start(input.context, 'autojoin', 'remove', formatIRCLine('AUTOJOIN', 'DEL', input.channel).trimEnd(), input.channel); },
    listGroup(context: RequestContext): CommunityResult { return start(context, 'nick-group', 'list', listLine('nick-group'), null); },
    addGroup(input: { context: RequestContext; nick: string }): CommunityResult { return start(input.context, 'nick-group', 'add', formatIRCLine('GROUP', 'ADD', input.nick).trimEnd(), input.nick); },
    removeGroup(input: { context: RequestContext; nick: string }): CommunityResult { return start(input.context, 'nick-group', 'remove', formatIRCLine('GROUP', 'DEL', input.nick).trimEnd(), input.nick); },
    setPrimary(input: { context: RequestContext; nick: string }): CommunityResult { return start(input.context, 'nick-group', 'primary', formatIRCLine('GROUP', 'PRIMARY', input.nick).trimEnd(), input.nick); },
    consumePrivateIngress,
    retire(owner: OwnerSnapshot): void {
      const key = ownerKey(owner);
      for (const section of ['autojoin', 'nick-group'] as const) {
        const pending = active.get(section);
        if (pending && sameOwner(pending.owner, owner)) fail(pending, 'unknown', 'owner-changed');
        rows.delete(JSON.stringify([key, section]));
        mutationUnknown.delete(JSON.stringify([key, section]));
      }
    },
    dispose(): void { disposed = true; for (const entry of active.values()) clearTimeout(entry.timer); active.clear(); mutationUnknown.clear(); rows.clear(); },
  };
}
