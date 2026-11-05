import { formatIRCLine, parseIRCMessage } from '../../src/lib/irc/parser';
import type { OwnerSnapshot, PrivateIngressEvent, RequestContext, RequestId, SendAdmission } from './contracts';
import { validateClientLine } from './client-line-validator';

export type IntegrationFeature = 'webhook' | 'outhook' | 'botgrant' | 'botcmd' | 'defer' | 'unfurl' | 'memo';
export type IntegrationPhase = 'idle' | 'pending' | 'accepted' | 'rejected' | 'unknown' | 'unsupported' | 'blocked';
export type IntegrationReason =
  | 'invalid-request' | 'owner-changed' | 'account-proof-required' | 'feature-disabled' | 'feature-unknown'
  | 'registry-disabled' | 'busy' | 'offline' | 'backpressure' | 'transport-error' | 'response-timeout'
  | 'invalid-response' | 'permission-denied' | 'server-rejected' | 'input-expired' | 'input-invalid';
export type IntegrationAction =
  | { readonly type: 'refresh'; readonly feature: IntegrationFeature }
  | { readonly type: 'botgrant-list'; readonly account: string | null }
  | { readonly type: 'botgrant-add'; readonly account: string; readonly grant: 'speak' | 'webhook' | 'history'; readonly channel: string; readonly ttlSeconds: number }
  | { readonly type: 'botgrant-remove'; readonly account: string; readonly grant: 'speak' | 'webhook' | 'history'; readonly channel: string; readonly confirm: true }
  | { readonly type: 'botcmd-list' }
  | { readonly type: 'botcmd-add'; readonly name: string; readonly argc: number; readonly help: string }
  | { readonly type: 'botcmd-run'; readonly name: string; readonly args: readonly string[] }
  | { readonly type: 'defer-at'; readonly unixMs: number; readonly channel: string; readonly text: string }
  | { readonly type: 'defer-cron'; readonly minute: string; readonly hour: string; readonly dayOfMonth: string; readonly month: string; readonly dayOfWeek: string; readonly channel: string; readonly text: string }
  | { readonly type: 'defer-oper-at'; readonly unixMs: number; readonly channel: string; readonly mode: string }
  | { readonly type: 'defer-oper-cron'; readonly minute: string; readonly hour: string; readonly dayOfMonth: string; readonly month: string; readonly dayOfWeek: string; readonly channel: string; readonly mode: string }
  | { readonly type: 'outhook-input' }
  | { readonly type: 'outhook-add'; readonly inputRef: string }
  | { readonly type: 'outhook-list' }
  | { readonly type: 'outhook-inspect'; readonly urlRef: string }
  | { readonly type: 'outhook-remove'; readonly urlRef: string; readonly confirm: true }
  | { readonly type: 'unfurl-off' }
  | { readonly type: 'unfurl-on' }
  | { readonly type: 'unfurl-preview'; readonly url: string }
  | { readonly type: 'memo-send'; readonly account: string; readonly text: string }
  | { readonly type: 'memo-list' }
  | { readonly type: 'memo-clear'; readonly confirm: true }
  | { readonly type: 'memo-forward'; readonly account: string | null }
  | { readonly type: 'memo-ignore-list' }
  | { readonly type: 'memo-ignore-add'; readonly account: string }
  | { readonly type: 'memo-ignore-remove'; readonly account: string; readonly confirm: true };

export interface IntegrationItem {
  readonly kind: 'entry' | 'status';
  readonly label: string;
  readonly value: string | null;
  readonly ref: string | null;
}

export interface IntegrationView {
  readonly kind: 'service-integration';
  readonly requestId: RequestId;
  readonly ownerRef: string;
  readonly accountGeneration: number;
  readonly connectionGeneration: number;
  readonly feature: IntegrationFeature;
  readonly operation: string | null;
  readonly phase: IntegrationPhase;
  readonly registry: 'enabled' | 'disabled' | 'unknown';
  readonly effectiveFeature: 'enabled' | 'disabled' | 'unknown';
  readonly accountProof: 'required' | 'satisfied' | 'unknown';
  readonly authorization: 'allowed' | 'denied' | 'unknown';
  readonly reason: IntegrationReason | null;
  readonly rows: readonly IntegrationItem[];
  readonly inputRef: string | null;
}

export interface IntegrationResult {
  readonly requestId: RequestId;
  readonly owner: OwnerSnapshot;
  readonly view: IntegrationView;
}

export interface IntegrationReadiness {
  readonly allowed: boolean;
  readonly view: IntegrationView;
}

export interface PrivateOutHookInput {
  readonly url: string;
  readonly secret: string;
  readonly categories: string;
}

export interface IntegrationOperationsDependencies {
  readonly currentOwner: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly currentNick: () => string | null;
  readonly currentServerPrefix: () => string | null;
  readonly hasNegotiatedLabels: () => boolean;
  readonly sendLine: (intent: { readonly line: string; readonly owner: OwnerSnapshot; readonly requestId: RequestId }) => SendAdmission;
  readonly now: () => number;
  readonly randomRef: () => string;
  readonly emit: (result: IntegrationResult) => void;
  readonly openPrivateOutHookInput: (input: {
    readonly context: RequestContext;
    readonly onSubmit: (value: PrivateOutHookInput) => void;
    readonly onCancel: () => void;
  }) => (() => void) | null;
  readonly presentPrivateOutHook: (input: { readonly context: RequestContext; readonly url: string; readonly onClose: () => void }) => (() => void) | null;
  readonly memoAction?: (input: { readonly context: RequestContext; readonly action: Extract<IntegrationAction, { type: `memo-${string}` }> }) => IntegrationResult | null;
  readonly webhookEffectiveState?: (owner: OwnerSnapshot) => 'enabled' | 'disabled' | 'unknown';
}

interface PrivateValue {
  readonly owner: OwnerSnapshot;
  readonly url: Uint8Array;
  readonly secret: Uint8Array;
  readonly categories: string;
  readonly expiresAt: number;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PendingRequest {
  readonly context: RequestContext;
  readonly feature: IntegrationFeature;
  readonly operation: string;
  readonly label: string | null;
  batchRef: string | null;
  readonly request: IntegrationAction | null;
  readonly registryName: string | null;
  readonly items: IntegrationItem[];
  admitting: boolean;
  readonly bufferedIngress: PrivateIngressEvent[];
  sawRegistryEntry: boolean;
  registryUnavailable: boolean;
  seenMemoRows: number;
  seenIgnoreRows: number;
  sawListEvidence: boolean;
  rejected: boolean;
  finalResult: IntegrationResult | null;
}

const COMMAND: Record<IntegrationFeature, string> = {
  webhook: 'WEBHOOK', outhook: 'OUTHOOK', botgrant: 'BOTGRANT', botcmd: 'BOTCMD', defer: 'DEFER', unfurl: 'UNFURL', memo: 'MEMO',
};
const MAX_LIST_ITEMS = 128;
const MAX_PRIVATE_INPUTS = 32;
const MAX_PRIVATE_URL_REFS = 128;
const PRIVATE_INPUT_TTL_MS = 60_000;
const RESPONSE_TIMEOUT_MS = 15_000;
const enc = new TextEncoder();

function sameOwner(a: OwnerSnapshot, b: OwnerSnapshot): boolean {
  return a.networkId === b.networkId && a.accountId === b.accountId && a.accountGeneration === b.accountGeneration
    && a.connectionGeneration === b.connectionGeneration && a.physicalRef === b.physicalRef && a.ownerRef === b.ownerRef;
}

function ownerScope(owner: OwnerSnapshot): string {
  return JSON.stringify([owner.networkId, owner.accountId, owner.accountGeneration, owner.connectionGeneration, owner.physicalRef, owner.ownerRef]);
}

function safeText(value: string, maxBytes: number): boolean {
  if (!value || enc.encode(value).byteLength > maxBytes || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  try { return [...value].every(ch => !(ch.length === 1 && ch.charCodeAt(0) >= 0xd800 && ch.charCodeAt(0) <= 0xdfff)); }
  catch { return false; }
}

function safeDisplayText(value: string, maxBytes: number): boolean {
  if (enc.encode(value).byteLength > maxBytes || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  return [...value].every(ch => !(ch.length === 1 && ch.charCodeAt(0) >= 0xd800 && ch.charCodeAt(0) <= 0xdfff));
}

function canonicalField(value: string, maxBytes: number): string | null {
  const field = value.trim();
  return safeText(field, maxBytes) && !/[\s:]/u.test(field) ? field : null;
}

function formatClientLine(command: string, ...params: string[]): string | null {
  // Check original fields before the legacy formatter removes framing controls.
  // Only the formatter-owned final CRLF is stripped below; user field bytes
  // must never be normalized into a different command.
  if (/[\r\n\u0000]/u.test(command) || params.some(param => /[\r\n\u0000]/u.test(param))) return null;
  try {
    const framed = formatIRCLine(command, ...params);
    if (!framed.endsWith('\r\n')) return null;
    const line = framed.slice(0, -2);
    return validateClientLine(line).valid ? line : null;
  } catch { return null; }
}

function commandForAction(action: IntegrationAction): { feature: IntegrationFeature; operation: string; line: string; mutation: boolean } | null {
  const fields = (command: string, params: string[], trailing?: string): string | null => {
    return formatClientLine(command, ...(trailing === undefined ? params : [...params, trailing]));
  };
  switch (action.type) {
    case 'botgrant-list': return { feature: 'botgrant', operation: action.type, line: fields('BOTGRANT', ['LIST', ...(action.account ? [action.account] : [])]) ?? '', mutation: false };
    case 'botgrant-add': return { feature: 'botgrant', operation: action.type, line: fields('BOTGRANT', ['ADD', action.account, action.grant, action.channel, String(action.ttlSeconds)]) ?? '', mutation: true };
    case 'botgrant-remove': return { feature: 'botgrant', operation: action.type, line: fields('BOTGRANT', ['DEL', action.account, action.grant, action.channel]) ?? '', mutation: true };
    case 'botcmd-list': return { feature: 'botcmd', operation: action.type, line: fields('BOTCMD', ['LIST']) ?? '', mutation: false };
    case 'botcmd-add': return { feature: 'botcmd', operation: action.type, line: fields('BOTCMD', ['ADD', action.name, String(action.argc)], action.help) ?? '', mutation: true };
    case 'botcmd-run': return { feature: 'botcmd', operation: action.type, line: fields('BOTCMD', ['RUN', action.name, ...action.args]) ?? '', mutation: true };
    case 'defer-at': return { feature: 'defer', operation: action.type, line: fields('DEFER', ['AT', String(action.unixMs), action.channel], action.text) ?? '', mutation: true };
    case 'defer-cron': return { feature: 'defer', operation: action.type, line: fields('DEFER', ['CRON', action.minute, action.hour, action.dayOfMonth, action.month, action.dayOfWeek, action.channel], action.text) ?? '', mutation: true };
    case 'defer-oper-at': return { feature: 'defer', operation: action.type, line: fields('DEFER', ['AT', String(action.unixMs), 'OPER', action.channel, action.mode]) ?? '', mutation: true };
    case 'defer-oper-cron': return { feature: 'defer', operation: action.type, line: fields('DEFER', ['CRON', action.minute, action.hour, action.dayOfMonth, action.month, action.dayOfWeek, 'OPER', action.channel, action.mode]) ?? '', mutation: true };
    case 'outhook-list': return { feature: 'outhook', operation: action.type, line: fields('OUTHOOK', ['LIST']) ?? '', mutation: false };
    case 'unfurl-off': return { feature: 'unfurl', operation: action.type, line: fields('UNFURL', ['OFF']) ?? '', mutation: true };
    case 'unfurl-on': return { feature: 'unfurl', operation: action.type, line: fields('UNFURL', ['ON']) ?? '', mutation: true };
    case 'unfurl-preview': return { feature: 'unfurl', operation: action.type, line: fields('UNFURL', [action.url]) ?? '', mutation: false };
    case 'memo-list': return { feature: 'memo', operation: action.type, line: fields('MEMO', ['LIST']) ?? '', mutation: false };
    case 'memo-clear': return { feature: 'memo', operation: action.type, line: fields('MEMO', ['CLEAR']) ?? '', mutation: true };
    case 'memo-forward': return { feature: 'memo', operation: action.type, line: fields('MEMO', action.account ? ['FORWARD', action.account] : ['FORWARD', 'OFF']) ?? '', mutation: true };
    case 'memo-ignore-list': return { feature: 'memo', operation: action.type, line: fields('MEMO', ['IGNORE', 'LIST']) ?? '', mutation: false };
    case 'memo-ignore-add': return { feature: 'memo', operation: action.type, line: fields('MEMO', ['IGNORE', 'ADD', action.account]) ?? '', mutation: true };
    case 'memo-ignore-remove': return { feature: 'memo', operation: action.type, line: fields('MEMO', ['IGNORE', 'DEL', action.account]) ?? '', mutation: true };
    default: return null;
  }
}

function actionFeature(action: IntegrationAction): IntegrationFeature {
  switch (action.type) {
    case 'refresh': return action.feature;
    case 'botgrant-list': case 'botgrant-add': case 'botgrant-remove': return 'botgrant';
    case 'botcmd-list': case 'botcmd-add': case 'botcmd-run': return 'botcmd';
    case 'defer-at': case 'defer-cron': case 'defer-oper-at': case 'defer-oper-cron': return 'defer';
    case 'outhook-input': case 'outhook-add': case 'outhook-list': case 'outhook-inspect': case 'outhook-remove': return 'outhook';
    case 'unfurl-off': case 'unfurl-on': case 'unfurl-preview': return 'unfurl';
    case 'memo-send': case 'memo-list': case 'memo-clear': case 'memo-forward': case 'memo-ignore-list': case 'memo-ignore-add': case 'memo-ignore-remove': return 'memo';
  }
}

function accountRequired(action: IntegrationAction): boolean {
  return action.type.startsWith('botcmd-') || action.type.startsWith('memo-');
}

function actionValid(action: IntegrationAction): boolean {
  const account = (value: string) => /^[A-Za-z0-9_.-]{1,64}$/u.test(value) && safeText(value, 64);
  const channel = (value: string) => !!canonicalField(value, 128) && /^[#&+!]/u.test(value);
  const body = (value: string, max = 400) => safeText(value, max) && value.trim().length > 0;
  switch (action.type) {
    case 'refresh': return Object.hasOwn(COMMAND, action.feature);
    case 'botgrant-list': return action.account === null || account(action.account);
    case 'botgrant-add': return account(action.account) && channel(action.channel) && Number.isSafeInteger(action.ttlSeconds) && action.ttlSeconds > 0 && action.ttlSeconds <= 31_536_000;
    case 'botgrant-remove': return action.confirm === true && account(action.account) && channel(action.channel);
    case 'botcmd-list': return true;
    case 'botcmd-add': return /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u.test(action.name) && Number.isSafeInteger(action.argc) && action.argc >= 0 && action.argc <= 16 && body(action.help, 256);
    case 'botcmd-run': return /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u.test(action.name) && action.args.length <= 16 && action.args.every(value => !!canonicalField(value, 256));
    case 'defer-at': return Number.isSafeInteger(action.unixMs) && action.unixMs >= 0 && channel(action.channel) && body(action.text);
    case 'defer-cron': return [action.minute, action.hour, action.dayOfMonth, action.month, action.dayOfWeek].every(value => !!canonicalField(value, 64)) && channel(action.channel) && body(action.text);
    case 'defer-oper-at': return Number.isSafeInteger(action.unixMs) && action.unixMs >= 0 && channel(action.channel) && /^[A-Za-z]$/u.test(action.mode);
    case 'defer-oper-cron': return [action.minute, action.hour, action.dayOfMonth, action.month, action.dayOfWeek].every(value => !!canonicalField(value, 64)) && channel(action.channel) && /^[A-Za-z]$/u.test(action.mode);
    case 'outhook-input': case 'outhook-list': case 'memo-list': case 'memo-clear': case 'memo-ignore-list': case 'unfurl-off': case 'unfurl-on': return action.type !== 'memo-clear' || action.confirm === true;
    case 'unfurl-preview': { try { const url = new URL(action.url); return url.protocol === 'https:' && !url.username && !url.password && !url.hash && safeText(action.url, 512); } catch { return false; } }
    case 'outhook-add': return safeText(action.inputRef, 128);
    case 'outhook-inspect': return safeText(action.urlRef, 128);
    case 'outhook-remove': return action.confirm === true && safeText(action.urlRef, 128);
    case 'memo-send': return account(action.account) && body(action.text, 4096);
    case 'memo-forward': return action.account === null || account(action.account);
    case 'memo-ignore-add': return account(action.account);
    case 'memo-ignore-remove': return action.confirm === true && account(action.account);
  }
}

function listItem(line: string, feature: IntegrationFeature): IntegrationItem | null {
  if (feature === 'botgrant') {
    const m = /^BOTGRANT: ([A-Za-z0-9_.-]{1,64}) (speak|webhook|history) (\S+) expires=(\d{1,16})$/u.exec(line);
    return m && safeDisplayText(m[3]!, 128) ? { kind: 'entry', label: `${m[1]} · ${m[2]}`, value: `${m[3]} · expires ${m[4]}`, ref: null } : null;
  }
  if (feature === 'botcmd') {
    const m = /^BOTCMD ([A-Za-z][A-Za-z0-9_-]{0,31}) args=(\d{1,2}) (.{1,256})$/u.exec(line);
    return m && safeDisplayText(m[3]!, 256) ? { kind: 'entry', label: m[1]!, value: `Arguments: ${m[2]}. ${m[3]}`, ref: null } : line === 'BOTCMD none' ? { kind: 'status', label: 'Commands', value: 'None registered', ref: null } : null;
  }
  if (feature === 'outhook') {
    const m = /^OUTHOOK: (https:\/\/\S{1,512}) categories=(.{1,256})$/u.exec(line);
    if (!m?.[1] || enc.encode(m[1]).byteLength > 512 || !m[2] || !safeDisplayText(m[2], 256)) return line === 'OUTHOOK: none' ? { kind: 'status', label: 'Outbound hooks', value: 'None registered', ref: null } : null;
    try {
      new URL(m[1]);
      return { kind: 'entry', label: 'Outbound hook destination', value: m[2], ref: null };
    } catch { return null; }
  }
  return null;
}

function replyCode(message: ReturnType<typeof parseIRCMessage>): string | null {
  if (message.command !== 'FAIL') return null;
  return message.params[1]?.toUpperCase() ?? null;
}

function isListOperation(operation: string): boolean {
  return operation.endsWith('-list') || operation === 'outhook-list' || operation === 'memo-list' || operation === 'memo-ignore-list';
}

function isMutationRequest(request: PendingRequest): boolean {
  return request.request !== null && (commandForAction(request.request)?.mutation === true
    || request.request.type === 'outhook-add' || request.request.type === 'outhook-remove');
}

function operationLabel(operation: string | null): string | null {
  if (operation === null || operation === 'refresh') return null;
  if (operation.startsWith('botgrant-') || operation.startsWith('botcmd-') || operation.startsWith('outhook-')) return operation.slice(operation.indexOf('-') + 1);
  if (operation.startsWith('defer-')) return operation.slice('defer-'.length);
  if (operation.startsWith('unfurl-')) return operation.slice('unfurl-'.length);
  if (operation.startsWith('memo-')) return operation.slice('memo-'.length);
  return operation;
}

export function createIntegrationOperations(deps: IntegrationOperationsDependencies) {
  let active: PendingRequest | null = null;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unfurlStateByOwner = new Map<string, IntegrationView['effectiveFeature']>();
  const privateInputs = new Map<string, PrivateValue>();
  const urlRefs = new Map<string, { readonly owner: OwnerSnapshot; readonly url: string; readonly expiresAt: number; readonly timer: ReturnType<typeof setTimeout> }>();
  const privateForms = new Map<string, () => void>();
  const privatePresenters = new Map<string, { readonly owner: OwnerSnapshot; readonly dispose: () => void }>();
  const unknownMutations = new Set<string>();
  const unfurlOptInByOwner = new Set<string>();
  const authorizationByOwner = new Map<string, Map<IntegrationFeature, IntegrationView['authorization']>>();

  const status = (input: { context: RequestContext; feature: IntegrationFeature; operation: string | null; phase: IntegrationPhase; reason?: IntegrationReason | null; items?: readonly IntegrationItem[]; inputRef?: string | null; registry?: IntegrationView['registry']; effectiveFeature?: IntegrationView['effectiveFeature']; authorization?: IntegrationView['authorization'] }): IntegrationResult => {
    const { context, feature } = input;
    const accountProof = accountRequiredForFeature(feature) ? context.owner.accountId === null ? 'required' : 'satisfied' : 'unknown';
    const registry = input.registry ?? getRegistry(context.owner, feature);
    const scope = ownerScope(context.owner);
    const effectiveFeature = input.effectiveFeature ?? (feature === 'unfurl' ? unfurlStateByOwner.get(scope) ?? 'unknown' : feature === 'webhook' ? deps.webhookEffectiveState?.(context.owner) ?? 'unknown' : registry);
    const view: IntegrationView = {
      kind: 'service-integration', requestId: context.requestId, ownerRef: context.owner.ownerRef,
      accountGeneration: Number(context.owner.accountGeneration), connectionGeneration: Number(context.owner.connectionGeneration),
      feature, operation: operationLabel(input.operation), phase: input.phase, registry, effectiveFeature,
      accountProof, authorization: input.authorization ?? authorizationByOwner.get(scope)?.get(feature) ?? 'unknown', reason: input.reason ?? null,
      rows: (input.items ?? []).slice(0, MAX_LIST_ITEMS).map(row => ({ ...row, ref: row.ref ?? null })), inputRef: input.inputRef ?? null,
    };
    return { requestId: context.requestId, owner: context.owner, view };
  };

  function accountRequiredForFeature(feature: IntegrationFeature): boolean {
    return feature === 'botcmd' || feature === 'memo';
  }

  function readiness(input: { readonly context: RequestContext; readonly feature: IntegrationFeature }): IntegrationReadiness {
    const { context, feature } = input;
    const registry = registryState(feature, context.owner);
    const current = !disposed && deps.isCurrent(context.owner) && sameOwner(deps.currentOwner(), context.owner);
    const accountOkay = !accountRequiredForFeature(feature) || context.owner.accountId !== null;
    const authorization = authorizationByOwner.get(ownerScope(context.owner))?.get(feature) ?? (feature === 'memo' && accountOkay ? 'allowed' : 'unknown');
    let reason: IntegrationReason | null = null;
    if (!current) reason = 'owner-changed';
    else if (!accountOkay) reason = 'account-proof-required';
    else if (registry !== 'enabled') reason = registry === 'disabled' ? 'registry-disabled' : 'feature-unknown';
    else if (authorization === 'denied') reason = 'permission-denied';
    const view = status({ context, feature, operation: null, phase: reason ? 'blocked' : 'idle', reason, registry, authorization, effectiveFeature: feature === 'unfurl' ? unfurlStateByOwner.get(ownerScope(context.owner)) ?? 'unknown' : feature === 'webhook' ? deps.webhookEffectiveState?.(context.owner) ?? 'unknown' : registry });
    return { allowed: reason === null, view: view.view };
  }

  function publish(result: IntegrationResult): void {
    if (disposed || !deps.isCurrent(result.owner)) return;
    try { deps.emit(result); } catch { /* private observer isolation */ }
  }

  function clearTimer(): void { if (timer !== null) clearTimeout(timer); timer = null; }
  function wipePrivate(value: PrivateValue): void { value.url.fill(0); value.secret.fill(0); }
  function clearPrivateFor(owner: OwnerSnapshot): void {
    for (const [ref, value] of privateInputs) if (sameOwner(value.owner, owner)) { clearTimeout(value.timer); wipePrivate(value); privateInputs.delete(ref); }
    for (const [ref, value] of urlRefs) if (sameOwner(value.owner, owner)) { clearTimeout(value.timer); urlRefs.delete(ref); }
    privateForms.get(ownerScope(owner))?.();
    privateForms.delete(ownerScope(owner));
    for (const [ref, presenter] of privatePresenters) if (sameOwner(presenter.owner, owner)) { try { presenter.dispose(); } catch { /* private DOM teardown */ } privatePresenters.delete(ref); }
  }

  function finish(phase: IntegrationPhase, reason: IntegrationReason | null = null, authorization: IntegrationView['authorization'] = 'unknown'): void {
    const request = active;
    if (!request) return;
    clearTimer();
    active = null;
    if (authorization !== 'unknown') setAuthorization(request.context.owner, request.feature, authorization);
    const result = status({ context: request.context, feature: request.feature, operation: request.operation, phase, reason, authorization, items: request.items });
    request.finalResult = result;
    publish(result);
  }

  function start(context: RequestContext, feature: IntegrationFeature, operation: string, line: string, action: IntegrationAction | null, opts: { registryName?: string } = {}): IntegrationResult {
    if (disposed || !deps.isCurrent(context.owner) || !sameOwner(deps.currentOwner(), context.owner)) return status({ context, feature, operation, phase: 'blocked', reason: 'owner-changed' });
    if (active) return status({ context, feature, operation, phase: 'blocked', reason: 'busy' });
    if (action && accountRequired(action)) {
      if (context.owner.accountId === null) return status({ context, feature, operation, phase: 'blocked', reason: 'account-proof-required' });
    }
    const registry = registryState(feature, context.owner);
    if (operation !== 'refresh' && registry !== 'enabled') return status({ context, feature, operation, phase: 'blocked', reason: registry === 'disabled' ? 'registry-disabled' : 'feature-unknown', registry, effectiveFeature: registry === 'disabled' ? 'disabled' : 'unknown' });
    if (operation !== 'refresh' && authorizationByOwner.get(ownerScope(context.owner))?.get(feature) === 'denied') return status({ context, feature, operation, phase: 'blocked', reason: 'permission-denied', registry, authorization: 'denied' });
    const scope = ownerScope(context.owner);
    const effective = feature === 'unfurl' ? unfurlStateByOwner.get(scope) ?? 'unknown' : feature === 'webhook' ? deps.webhookEffectiveState?.(context.owner) ?? 'unknown' : registry;
    if (feature === 'unfurl' && operation === 'unfurl-on' && effective !== 'enabled') return status({ context, feature, operation, phase: 'blocked', reason: effective === 'disabled' ? 'feature-disabled' : 'feature-unknown', registry, effectiveFeature: effective });
    if (feature === 'unfurl' && operation !== 'unfurl-off' && effective === 'disabled') return status({ context, feature, operation, phase: 'blocked', reason: 'feature-disabled', registry, effectiveFeature: effective });
    if (feature === 'unfurl' && operation === 'unfurl-preview' && (!unfurlOptInByOwner.has(scope) || effective !== 'enabled')) return status({ context, feature, operation, phase: 'blocked', reason: 'feature-disabled', registry, effectiveFeature: effective });
    const unknownKey = `${scope}:${feature}`;
    const mutation = action ? commandForAction(action)?.mutation === true || action.type === 'outhook-add' || action.type === 'outhook-remove' : false;
    if (mutation && unknownMutations.has(unknownKey) && action?.type !== 'unfurl-off') return status({ context, feature, operation, phase: 'blocked', reason: 'feature-unknown', registry, effectiveFeature: effective });
    const requestId = context.requestId;
    const label = deps.hasNegotiatedLabels() ? `oi-${deps.randomRef().replace(/[^A-Za-z0-9._/-]/gu, '').slice(0, 48)}` : null;
    const batchRef = null;
    const wireLine = label ? `@label=${label} ${line}` : line;
    const validation = validateClientLine(wireLine);
    if (!validation.valid) return status({ context, feature, operation, phase: 'blocked', reason: 'invalid-request', registry, effectiveFeature: effective });
    const pending: PendingRequest = { context, feature, operation, label, batchRef, request: action, registryName: opts.registryName ?? null, items: [], sawRegistryEntry: false, registryUnavailable: false, seenMemoRows: 0, seenIgnoreRows: 0, sawListEvidence: false, rejected: false, admitting: true, bufferedIngress: [], finalResult: null };
    const previousUnfurlState = unfurlStateByOwner.get(scope);
    if (feature === 'unfurl' && operation === 'unfurl-off') unfurlStateByOwner.set(scope, 'unknown');
    active = pending;
    let admission: SendAdmission;
    try { admission = deps.sendLine({ line: wireLine, owner: context.owner, requestId }); }
    catch {
      pending.admitting = false;
      pending.bufferedIngress.length = 0;
      if (mutation) unknownMutations.add(unknownKey);
      active = null;
      return status({ context, feature, operation, phase: 'unknown', reason: 'transport-error', registry, effectiveFeature: effective });
    }
    if (admission.kind === 'blocked') {
      pending.bufferedIngress.length = 0;
      active = null;
      if (feature === 'unfurl' && operation === 'unfurl-off') {
        if (previousUnfurlState === undefined) unfurlStateByOwner.delete(scope); else unfurlStateByOwner.set(scope, previousUnfurlState);
      }
      return status({ context, feature, operation, phase: 'blocked', reason: admission.reason === 'offline' ? 'offline' : admission.reason === 'backpressure' ? 'backpressure' : 'owner-changed', registry, effectiveFeature: effective });
    }
    if (admission.kind === 'unknown') {
      pending.bufferedIngress.length = 0;
      if (mutation) unknownMutations.add(unknownKey);
      active = null;
      return status({ context, feature, operation, phase: 'unknown', reason: 'transport-error', registry, effectiveFeature: effective });
    }
    pending.admitting = false;
    const queuedIngress = pending.bufferedIngress.splice(0);
    for (const event of queuedIngress) consumePrivateIngress(event);
    if (active !== pending) return pending.finalResult ?? status({ context, feature, operation, phase: 'unknown', reason: 'owner-changed' });
    publish(status({ context, feature, operation, phase: 'pending', registry, effectiveFeature: effective }));
    timer = setTimeout(() => {
      if (active !== pending) return;
      if (mutation) unknownMutations.add(unknownKey);
      finish('unknown', 'response-timeout');
    }, RESPONSE_TIMEOUT_MS);
    return status({ context, feature, operation, phase: 'pending', registry, effectiveFeature: effective });
  }

  function registryState(feature: IntegrationFeature, owner: OwnerSnapshot): IntegrationView['registry'] {
    return getRegistry(owner, feature);
  }

  const registryByOwner = new Map<string, Map<IntegrationFeature, IntegrationView['registry']>>();
  function setRegistry(owner: OwnerSnapshot, feature: IntegrationFeature, value: IntegrationView['registry']): void {
    const scope = ownerScope(owner);
    let values = registryByOwner.get(scope);
    if (!values) { values = new Map(); registryByOwner.set(scope, values); }
    values.set(feature, value);
  }
  function getRegistry(owner: OwnerSnapshot, feature: IntegrationFeature): IntegrationView['registry'] { return registryByOwner.get(ownerScope(owner))?.get(feature) ?? 'unknown'; }
  function setAuthorization(owner: OwnerSnapshot, feature: IntegrationFeature, value: IntegrationView['authorization']): void {
    const scope = ownerScope(owner);
    let values = authorizationByOwner.get(scope);
    if (!values) { values = new Map(); authorizationByOwner.set(scope, values); }
    values.set(feature, value);
  }

  function isRelevantAdmittingReply(request: PendingRequest, message: ReturnType<typeof parseIRCMessage>): boolean {
    if (request.registryName) {
      if (message.command === '374') return true;
      if (message.command !== '371') return false;
      const body = message.params[1] ?? '';
      return new RegExp(`^${request.registryName}(?:\\s|$)`, 'u').test(body);
    }
    if (message.command === '481' || message.command === '464' || message.command === '451') return true;
    if (message.command !== 'NOTICE') return false;
    const body = message.params[1] ?? '';
    if (request.feature === 'unfurl') {
      if (body === 'UNFURL: disabled' || body === 'UNFURL: client refused') return true;
      if (body === 'UNFURL: previews on') return request.operation === 'unfurl-on';
      if (request.operation === 'unfurl-preview') {
        return /^UNFURL title=.{0,256} description=.{0,256} image=.{0,256}$/u.test(body) || body.startsWith('UNFURL: ');
      }
    }
    if (request.feature === 'memo' && request.operation === 'memo-list') {
      return /^MEMO: End of offline memos \(\d{1,6}\)$/u.test(body);
    }
    if (request.feature === 'memo' && request.operation === 'memo-ignore-list') {
      return /^MEMO: ignoring [A-Za-z0-9_.-]{1,64}$/u.test(body) || /^MEMO: End of ignore list \(\d{1,6}\)$/u.test(body);
    }
    if (isListOperation(request.operation)) return listItem(body, request.feature) !== null || isExplicitEmptyList(request.feature, body);
    return exactAcknowledgement(request, body) !== null;
  }


  function consumePrivateIngress(event: PrivateIngressEvent): boolean {
    const request = active;
    if (!request || !sameOwner(event.owner, request.context.owner) || !deps.isCurrent(event.owner)) return false;
    let message: ReturnType<typeof parseIRCMessage>;
    try { message = parseIRCMessage(event.line); } catch { return false; }
    const label = message.tags.label;
    const sourceMatches = event.sourceKind === 'server' && deps.currentServerPrefix() !== null && message.prefix === deps.currentServerPrefix();
    const recipientMatches = message.params[0] === deps.currentNick();
    const bufferedBatchRef = request.batchRef ?? request.bufferedIngress.reduce<string | null>((found, buffered) => {
      let parsed: ReturnType<typeof parseIRCMessage>; try { parsed = parseIRCMessage(buffered.line); } catch { return found; }
      const ref = parsed.params[0] ?? '';
      return !!request.label && parsed.command === 'BATCH' && ref.startsWith('+') && parsed.tags.label === request.label && parsed.params[1] === 'labeled-response' ? ref.slice(1) : found;
    }, null);
    const opensBatch = !!request.label && message.command === 'BATCH' && (message.params[0] ?? '').startsWith('+') && label === request.label && message.params[1] === 'labeled-response';
    // IRC BATCH control lines have no server prefix. Accept only exact
    // labeled-response framing from the private server ingress for this
    // request; ordinary replies still require the learned server prefix.
    const unprefixedBatchControl = event.sourceKind === 'prefixless-protocol' && message.prefix === null
      && message.command === 'BATCH'
      && ((message.params.length === 2 && opensBatch && Object.keys(message.tags).length === 1
          && /^\+[A-Za-z0-9._/-]{1,64}$/u.test(message.params[0] ?? ''))
        || (message.params.length === 1 && Object.keys(message.tags).length === 0
          && (message.params[0] ?? '').startsWith('-') && (message.params[0] ?? '').slice(1) === bufferedBatchRef));
    const batchFrame = message.command === 'BATCH' && (message.params[0] ?? '').slice(1) === bufferedBatchRef;
    const correlatedLabel = !!request.label && (label === request.label || message.tags.batch === bufferedBatchRef || opensBatch || batchFrame);
    const requestCorrelation = request.label
      ? correlatedLabel
      : label === undefined && message.tags.batch === undefined;
    const prefixlessFail = event.sourceKind === 'prefixless-protocol' && message.prefix === null && message.command === 'FAIL'
      && requestCorrelation
      && (message.params[0]?.toUpperCase() === request.feature.toUpperCase() || message.params[0]?.toUpperCase() === 'MEMO' && request.feature === 'memo');
    const correlatedServerReply = sourceMatches && recipientMatches && requestCorrelation;
    if (!(prefixlessFail || unprefixedBatchControl || message.command !== 'BATCH' && correlatedServerReply)) return false;
    const body = message.params[1] ?? '';
    const memoListRow = request.feature === 'memo' && request.operation === 'memo-list'
      && message.command === 'NOTICE' && /^MEMO from [^\s:]{1,64} :/u.test(body);
    const memoIgnoreRow = request.feature === 'memo' && request.operation === 'memo-ignore-list'
      && message.command === 'NOTICE' && /^MEMO: ignoring .{1,64}$/u.test(body);
    if (request.admitting) {
      if (memoListRow) {
        request.seenMemoRows += 1;
        request.sawListEvidence = true;
        return false; // The ordinary offline memo fold still owns delivery rows.
      }
      if (!prefixlessFail && !unprefixedBatchControl && !isRelevantAdmittingReply(request, message)) return false;
      request.bufferedIngress.push(event);
      const memoEnd = request.feature === 'memo' && request.operation === 'memo-list'
        && message.command === 'NOTICE' && /^MEMO: End of offline memos \((\d{1,6})\)$/u.test(message.params[1] ?? '');
      return !memoEnd;
    }
    if (memoListRow) {
      request.seenMemoRows += 1;
      request.sawListEvidence = true;
      return false; // The ordinary offline memo fold still owns delivery rows.
    }
    if (memoIgnoreRow) {
      request.seenIgnoreRows += 1;
      request.sawListEvidence = true;
    }
    if (message.command === 'BATCH') {
      const ref = message.params[0] ?? '';
      if (ref.startsWith('+') && message.params[1] === 'labeled-response' && label === request.label) request.batchRef = ref.slice(1);
      if (ref.startsWith('-') && request.batchRef === ref.slice(1)) {
        if (request.registryName) completeRegistry(request, request.sawRegistryEntry);
        else if (isListOperation(request.operation)) completeList(request);
        else {
          if (isMutationRequest(request)) unknownMutations.add(`${ownerScope(request.context.owner)}:${request.feature}`);
          finish('unknown', 'invalid-response');
        }
      }
      return true;
    }
    if (message.command === 'FAIL' && prefixlessFail) {
      const family = message.params[0]?.toUpperCase();
      if (family && (family === request.feature.toUpperCase() || family === 'MEMO' && request.feature === 'memo')) {
        const code = replyCode(message);
        const denied = code === 'ACCESS_DENIED' || code === 'PERMISSION_DENIED' || code === 'OPER_REQUIRED' || code === 'ACCOUNT_REQUIRED';
        request.rejected = true;
        finish('rejected', denied ? 'permission-denied' : 'server-rejected', denied ? 'denied' : 'unknown');
        return true;
      }
    }
    if (request.registryName) {
      if (message.command === '371' && recipientMatches) {
        const body = message.params[1] ?? '';
        const command = request.registryName;
        if (new RegExp(`^${command}(?:\\s|$)`, 'u').test(body)) {
          request.sawRegistryEntry = true;
          request.registryUnavailable = /\(unavailable\)/u.test(body);
          request.items.push({ kind: 'status', label: command, value: request.registryUnavailable ? 'Registered but unavailable to this connection' : 'Registered on this connection', ref: null });
        }
        return true;
      }
      if (message.command === '374' && recipientMatches) {
        const body = message.params[1] ?? '';
        const found = request.sawRegistryEntry;
        setRegistry(request.context.owner, request.feature, found ? 'enabled' : 'disabled');
        setAuthorization(request.context.owner, request.feature, request.registryUnavailable ? 'denied' : 'unknown');
        const effective = request.feature === 'unfurl' || request.feature === 'webhook' ? 'unknown' : found ? 'enabled' : 'disabled';
        request.items.push({ kind: 'status', label: request.registryName, value: body.includes('No such command') ? 'Not registered on this connection' : found ? 'Registered on this connection' : 'Unavailable on this connection', ref: null });
        if (request.batchRef === null) {
          const result = status({ context: request.context, feature: request.feature, operation: request.operation, phase: request.registryUnavailable ? 'blocked' : found ? 'accepted' : 'unsupported', reason: request.registryUnavailable ? 'permission-denied' : found ? null : 'registry-disabled', registry: found ? 'enabled' : 'disabled', effectiveFeature: effective, authorization: request.registryUnavailable ? 'denied' : 'unknown', items: request.items });
          clearTimer(); active = null; request.finalResult = result; publish(result);
        }
        return true;
      }
      return false;
    }
    if (message.command === '481' || message.command === '464' || message.command === '451') {
      finish('rejected', 'permission-denied', 'denied');
      return true;
    }
    if (message.command !== 'NOTICE' || !recipientMatches) return false;
    if (!request.label && request.batchRef === null && body.startsWith('BATCH')) return false;
    if (handleNotice(request, body)) return true;
    return false;
  }

  function completeRegistry(request: PendingRequest, found: boolean): void {
    setRegistry(request.context.owner, request.feature, found ? 'enabled' : 'disabled');
    setAuthorization(request.context.owner, request.feature, request.registryUnavailable ? 'denied' : 'unknown');
    finish(request.registryUnavailable ? 'blocked' : found ? 'accepted' : 'unsupported', request.registryUnavailable ? 'permission-denied' : found ? null : 'registry-disabled', request.registryUnavailable ? 'denied' : 'unknown');
  }

  function completeList(request: PendingRequest): void {
    // A labeled-response BATCH close is only a framing boundary. Require a
    // recognized row or the command's explicit empty-list reply before treating
    // the result as a completed read or using it to authorize later operations.
    if (!request.sawListEvidence) {
      finish('unknown', 'invalid-response');
      return;
    }
    unknownMutations.delete(`${ownerScope(request.context.owner)}:${request.feature}`);
    if (!request.rejected && (request.feature === 'botgrant' || request.feature === 'botcmd' || request.feature === 'outhook')) {
      setAuthorization(request.context.owner, request.feature, 'allowed');
    }
    finish(request.rejected ? 'rejected' : 'accepted', request.rejected ? 'server-rejected' : null, request.rejected ? 'denied' : 'unknown');
  }

  function handleNotice(request: PendingRequest, body: string): boolean {
    if (request.feature === 'unfurl') {
      const scope = ownerScope(request.context.owner);
      if (body === 'UNFURL: disabled') {
        unknownMutations.delete(`${scope}:unfurl`);
        unfurlStateByOwner.set(scope, 'disabled'); unfurlOptInByOwner.delete(scope);
        finish('rejected', 'feature-disabled'); return true;
      }
      if (body === 'UNFURL: client refused') {
        unfurlStateByOwner.set(scope, 'enabled'); unfurlOptInByOwner.delete(scope);
        if (request.operation === 'unfurl-off') unknownMutations.delete(`${scope}:unfurl`);
        finish(request.operation === 'unfurl-off' ? 'accepted' : 'rejected', request.operation === 'unfurl-off' ? null : 'server-rejected'); return true;
      }
      if (body === 'UNFURL: previews on') {
        if (request.operation !== 'unfurl-on') return false;
        unknownMutations.delete(`${scope}:unfurl`);
        unfurlStateByOwner.set(scope, 'enabled'); unfurlOptInByOwner.add(scope);
        finish('accepted', null, 'allowed'); return true;
      }
      if (request.operation === 'unfurl-preview') {
        const preview = /^UNFURL title=(.{0,256}) description=(.{0,256}) image=(.{0,256})$/u.exec(body);
        if (preview?.[1] !== undefined && preview[2] !== undefined && preview[3] !== undefined) {
          if (!safeDisplayText(preview[1], 512) || !safeDisplayText(preview[2], 512)) { finish('unknown', 'invalid-response'); return true; }
          request.items.push(
            { kind: 'status', label: 'Title', value: preview[1], ref: null },
            { kind: 'status', label: 'Description', value: preview[2], ref: null },
          );
          finish('accepted', null, 'allowed');
          return true;
        }
        if (body.startsWith('UNFURL: ')) { finish('rejected', 'server-rejected'); return true; }
      }
    }

    // MEMO delivery rows are ordinary account inbox content. Leave them for
    // the existing offline-memo fold even while a management request is open.
    if (request.feature === 'memo' && /^MEMO from [^\s:]{1,64} :/u.test(body)) return false;
    if (request.feature === 'memo' && request.operation === 'memo-list') {
      const end = /^MEMO: End of offline memos \((\d{1,6})\)$/u.exec(body);
      if (end) {
        if (Number(end[1]) !== request.seenMemoRows) { finish('unknown', 'invalid-response'); return false; }
        request.sawListEvidence = true;
        request.items.push({ kind: 'status', label: 'Offline memos', value: `${end[1]} message(s)`, ref: null });
        completeList(request);
      }
      return false;
    }
    if (request.feature === 'memo' && request.operation === 'memo-ignore-list') {
      const end = /^MEMO: End of ignore list \((\d{1,6})\)$/u.exec(body);
      if (end) {
        if (Number(end[1]) !== request.seenIgnoreRows) { finish('unknown', 'invalid-response'); return true; }
        request.sawListEvidence = true;
        request.items.push({ kind: 'status', label: 'Ignored senders', value: `${end[1]} sender(s)`, ref: null }); completeList(request); return true;
      }
      const ignored = /^MEMO: ignoring (.{1,64})$/u.exec(body);
      if (ignored?.[1] && /^[A-Za-z0-9_.-]{1,64}$/u.test(ignored[1])) { request.sawListEvidence = true; request.items.push({ kind: 'entry', label: ignored[1], value: 'Ignored', ref: null }); return true; }
      return false;
    }

    const item = listItem(body, request.feature);
    if (item) {
      if (request.operation.endsWith('-list') || request.operation === 'outhook-list') {
      request.sawListEvidence = true;
      if (request.feature === 'outhook' && body.startsWith('OUTHOOK: https://')) {
        const raw = /^OUTHOOK: (https:\/\/\S+) categories=/u.exec(body)?.[1];
        if (!raw) return false;
        for (const [expiredRef, entry] of urlRefs) if (entry.expiresAt <= deps.now()) {
          clearTimeout(entry.timer); urlRefs.delete(expiredRef);
          const presenter = privatePresenters.get(expiredRef);
          if (presenter) { try { presenter.dispose(); } catch { /* private DOM teardown */ } privatePresenters.delete(expiredRef); }
        }
        if (urlRefs.size < MAX_PRIVATE_URL_REFS) {
          const ref = deps.randomRef();
          if (urlRefs.has(ref)) { request.items.push(item); return true; }
          const expiresAt = deps.now() + PRIVATE_INPUT_TTL_MS;
          const timer = setTimeout(() => {
            urlRefs.delete(ref);
            const presenter = privatePresenters.get(ref);
            if (presenter) { try { presenter.dispose(); } catch { /* private DOM teardown */ } privatePresenters.delete(ref); }
          }, PRIVATE_INPUT_TTL_MS);
          urlRefs.set(ref, { owner: request.context.owner, url: raw, expiresAt, timer });
          request.items.push({ ...item, ref });
        } else request.items.push(item);
      } else request.items.push(item);
      if (request.items.length > MAX_LIST_ITEMS) request.items.length = MAX_LIST_ITEMS;
      if (isExplicitEmptyList(request.feature, body)) { request.sawListEvidence = true; completeList(request); return true; }
      return true;
      }
    }
    if (isListOperation(request.operation)) {
      if (isExplicitEmptyList(request.feature, body)) { request.sawListEvidence = true; request.items.push({ kind: 'status', label: request.feature, value: 'No entries', ref: null }); completeList(request); return true; }
      return false;
    }
    const ack = exactAcknowledgement(request, body);
    if (ack === 'accepted') { finish('accepted', null, 'allowed'); return true; }
    if (ack === 'rejected') { finish('rejected', 'server-rejected'); return true; }
    if (ack === 'denied') { finish('rejected', 'permission-denied', 'denied'); return true; }
    return false;
  }

  function exactAcknowledgement(request: PendingRequest, body: string): 'accepted' | 'rejected' | 'denied' | null {
    const action = request.request;
    if (request.feature === 'botgrant') {
      if (request.operation === 'botgrant-add') return body === 'BOTGRANT: added' ? 'accepted' : body === 'BOTGRANT: webhook refused' ? 'denied' : body.startsWith('BOTGRANT:') ? 'rejected' : null;
      if (request.operation === 'botgrant-remove') return body === 'BOTGRANT: revoked' ? 'accepted' : body.startsWith('BOTGRANT:') ? 'rejected' : null;
    }
    if (request.feature === 'botcmd') {
      if (request.operation === 'botcmd-add') return body === 'BOTCMD added' ? 'accepted' : body === 'BOTCMD denied' ? 'denied' : /^BOTCMD (?:rejected|unknown|args)$/u.test(body) ? 'rejected' : null;
      if (request.operation === 'botcmd-run' && action?.type === 'botcmd-run') {
        const escaped = action.name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        return new RegExp(`^BOTCMD ok ${escaped}(?:\\s.{1,256})?$`, 'u').test(body) ? 'accepted' : body === 'BOTCMD denied' ? 'denied' : /^BOTCMD (?:rejected|unknown|args)$/u.test(body) ? 'rejected' : null;
      }
    }
    if (request.feature === 'defer' && request.operation.startsWith('defer-')) return body === 'DEFER: scheduled' ? 'accepted' : /^DEFER: (?:invalid schedule|message is too long|already scheduled|could not schedule \(limit\)|could not store the message)$/u.test(body) ? 'rejected' : null;
    if (request.feature === 'outhook') {
      if (request.operation === 'outhook-add') return body === 'OUTHOOK: registered' || body === 'OUTHOOK: updated' ? 'accepted' : /^OUTHOOK: (?:url or secret is empty or too long|bad url|refusing private or local target|unknown category|out of memory|limit reached)$/u.test(body) ? 'rejected' : null;
      if (request.operation === 'outhook-remove') return body === 'OUTHOOK: removed' ? 'accepted' : body === 'OUTHOOK: no such url' ? 'rejected' : null;
    }
    if (request.feature === 'memo') {
      if (request.operation === 'memo-clear') return /^MEMO: Cleared \d+ message\(s\)$/u.test(body) ? 'accepted' : null;
      if (request.operation === 'memo-forward' && action?.type === 'memo-forward') {
        if (action.account === null) return body === 'MEMO: forwarding disabled' ? 'accepted' : null;
        return body === `MEMO: Forwarding your offline memos to ${action.account}` ? 'accepted' : null;
      }
      if (request.operation === 'memo-ignore-add' && action?.type === 'memo-ignore-add') return body === `MEMO: now ignoring memos from ${action.account}` || body === `MEMO: ${action.account} was already ignored` ? 'accepted' : null;
      if (request.operation === 'memo-ignore-remove' && action?.type === 'memo-ignore-remove') return body === `MEMO: no longer ignoring ${action.account}` ? 'accepted' : body === `MEMO: ${action.account} was not ignored` ? 'rejected' : null;
    }
    if (request.feature === 'webhook' && /^WEBHOOK:/u.test(body)) return 'accepted';
    return null;
  }

  function isExplicitEmptyList(feature: IntegrationFeature, body: string): boolean {
    return feature === 'botgrant' && body === 'BOTGRANT: none'
      || feature === 'botcmd' && body === 'BOTCMD none'
      || feature === 'outhook' && body === 'OUTHOOK: none'
      || feature === 'memo' && body === 'MEMO: none';
  }

  function registryCommand(feature: IntegrationFeature): string {
    return feature === 'webhook' ? 'WEBHOOK' : COMMAND[feature];
  }

  function execute(input: { readonly context: RequestContext; readonly action: IntegrationAction }): IntegrationResult {
    const { context, action } = input;
    if (!actionValid(action)) return status({ context, feature: actionFeature(action), operation: action.type, phase: 'blocked', reason: 'invalid-request' });
    const feature = actionFeature(action);
    if (action.type === 'memo-send') {
      const ready = readiness({ context, feature });
      if (!ready.allowed) return status({ context, feature, operation: action.type, phase: 'blocked', reason: ready.view.reason, registry: ready.view.registry, effectiveFeature: ready.view.effectiveFeature, authorization: ready.view.authorization });
      return deps.memoAction?.({ context, action }) ?? status({ context, feature, operation: action.type, phase: 'unsupported', reason: 'feature-unknown', registry: ready.view.registry, effectiveFeature: ready.view.effectiveFeature, authorization: ready.view.authorization });
    }
    if (action.type === 'outhook-input') {
      if (!deps.isCurrent(context.owner) || !sameOwner(deps.currentOwner(), context.owner)) return status({ context, feature, operation: action.type, phase: 'blocked', reason: 'owner-changed' });
      if (active) return status({ context, feature, operation: action.type, phase: 'blocked', reason: 'busy' });
      const scope = ownerScope(context.owner);
      privateForms.get(scope)?.();
      let rawDispose: (() => void) | null = null;
      let settled = false;
      let closeForm: () => void = () => undefined;
      const removeForm = (): void => {
        if (privateForms.get(scope) === closeForm) privateForms.delete(scope);
        try { rawDispose?.(); } catch { /* private DOM teardown */ }
      };
      closeForm = (): void => { if (!settled) settled = true; removeForm(); };
      const onSubmit = (value: PrivateOutHookInput): void => {
        if (settled) return;
        settled = true;
        removeForm();
        if (!deps.isCurrent(context.owner) || !sameOwner(deps.currentOwner(), context.owner)) return;
        const urlBytes = enc.encode(value.url); const secretBytes = enc.encode(value.secret);
        if (urlBytes.byteLength === 0 || urlBytes.byteLength > 512 || secretBytes.byteLength === 0 || secretBytes.byteLength > 128
          || /[\u0000\r\n\s]/u.test(value.url) || !/^https:\/\//u.test(value.url) || !safeText(value.secret, 128) || /\s/u.test(value.secret)
          || !safeText(value.categories, 256)) { urlBytes.fill(0); secretBytes.fill(0); publish(status({ context, feature, operation: action.type, phase: 'rejected', reason: 'input-invalid' })); return; }
        let parsedUrl: URL; try { parsedUrl = new URL(value.url); } catch { urlBytes.fill(0); secretBytes.fill(0); publish(status({ context, feature, operation: action.type, phase: 'rejected', reason: 'input-invalid' })); return; }
        const categoryList = value.categories.split(',').map(category => category.trim());
        const allowedCategories = new Set(['all', 'connect', 'disconnect', 'server_link', 'flood', 'error', 'announce', 'oper_action', 'kill', 'spam', 'debug', 'policy', 'service', 'security']);
        if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname || categoryList.length === 0 || categoryList.some(category => !allowedCategories.has(category.toLowerCase()))) {
          urlBytes.fill(0); secretBytes.fill(0); publish(status({ context, feature, operation: action.type, phase: 'rejected', reason: 'input-invalid' })); return;
        }
        const inputRef = deps.randomRef();
        for (const [oldRef, old] of privateInputs) if (old.expiresAt <= deps.now()) { clearTimeout(old.timer); wipePrivate(old); privateInputs.delete(oldRef); }
        if (privateInputs.size >= MAX_PRIVATE_INPUTS || privateInputs.has(inputRef)) { urlBytes.fill(0); secretBytes.fill(0); publish(status({ context, feature, operation: action.type, phase: 'blocked', reason: 'busy' })); return; }
        const expiresAt = deps.now() + PRIVATE_INPUT_TTL_MS;
        const privateValue = { owner: context.owner, url: urlBytes, secret: secretBytes, categories: categoryList.map(category => category.toLowerCase()).join(','), expiresAt, timer: setTimeout(() => { const stored = privateInputs.get(inputRef); if (stored) { wipePrivate(stored); privateInputs.delete(inputRef); } }, PRIVATE_INPUT_TTL_MS) };
        privateInputs.set(inputRef, privateValue);
        privateForms.get(scope)?.(); privateForms.delete(scope);
        publish(status({ context, feature, operation: action.type, phase: 'accepted', inputRef, items: [{ kind: 'status', label: 'Outbound hook', value: 'Private registration details are ready for confirmation.', ref: null }] }));
      };
      const onCancel = (): void => {
        if (settled) return;
        settled = true;
        removeForm();
        publish(status({ context, feature, operation: action.type, phase: 'rejected', reason: 'input-expired' }));
      };
      rawDispose = deps.openPrivateOutHookInput({ context, onSubmit, onCancel });
      if (!rawDispose) { settled = true; return status({ context, feature, operation: action.type, phase: 'unsupported', reason: 'feature-unknown' }); }
      privateForms.set(scope, closeForm);
      return status({ context, feature, operation: action.type, phase: 'pending' });
    }
    if (action.type === 'outhook-add') {
      const value = privateInputs.get(action.inputRef);
      privateInputs.delete(action.inputRef);
      if (value) clearTimeout(value.timer);
      if (!value || !sameOwner(value.owner, context.owner) || value.expiresAt <= deps.now()) { if (value) wipePrivate(value); return status({ context, feature, operation: action.type, phase: 'blocked', reason: 'input-expired' }); }
      try {
        const url = new TextDecoder().decode(value.url); const secret = new TextDecoder().decode(value.secret);
        const line = formatClientLine('OUTHOOK', 'ADD', url, secret, value.categories);
        if (!line) return status({ context, feature, operation: action.type, phase: 'blocked', reason: 'invalid-request' });
        return start(context, feature, action.type, line, action);
      }
      finally { wipePrivate(value); }
    }
    if (action.type === 'outhook-remove') {
      const target = urlRefs.get(action.urlRef); urlRefs.delete(action.urlRef);
      if (target) clearTimeout(target.timer);
      const presenter = privatePresenters.get(action.urlRef); if (presenter) { try { presenter.dispose(); } catch { /* private DOM teardown */ } privatePresenters.delete(action.urlRef); }
      if (!target || !sameOwner(target.owner, context.owner) || target.expiresAt <= deps.now()) return status({ context, feature, operation: action.type, phase: 'blocked', reason: 'input-expired' });
      const line = formatClientLine('OUTHOOK', 'DEL', target.url);
      if (!line) return status({ context, feature, operation: action.type, phase: 'blocked', reason: 'invalid-request' });
      return start(context, feature, action.type, line, action);
    }
    if (action.type === 'outhook-inspect') {
      const target = urlRefs.get(action.urlRef);
      if (!target || !sameOwner(target.owner, context.owner) || target.expiresAt <= deps.now() || !deps.isCurrent(context.owner)) {
        if (target && target.expiresAt <= deps.now()) {
          clearTimeout(target.timer); urlRefs.delete(action.urlRef);
          const presenter = privatePresenters.get(action.urlRef);
          if (presenter) { try { presenter.dispose(); } catch { /* private DOM teardown */ } privatePresenters.delete(action.urlRef); }
        }
        return status({ context, feature, operation: action.type, phase: 'blocked', reason: 'input-expired' });
      }
      for (const [ref, presenter] of privatePresenters) if (sameOwner(presenter.owner, context.owner)) { try { presenter.dispose(); } catch { /* private DOM teardown */ } privatePresenters.delete(ref); }
      let disposePresenter: (() => void) | null = null;
      disposePresenter = deps.presentPrivateOutHook({ context, url: target.url, onClose: () => { if (privatePresenters.get(action.urlRef)?.dispose === disposePresenter) privatePresenters.delete(action.urlRef); } });
      if (!disposePresenter) return status({ context, feature, operation: action.type, phase: 'unsupported', reason: 'feature-unknown' });
      privatePresenters.set(action.urlRef, { owner: context.owner, dispose: disposePresenter });
      return status({ context, feature, operation: action.type, phase: 'accepted' });
    }
    if (action.type === 'refresh') {
      const command = registryCommand(action.feature);
      const line = formatClientLine('COMMANDS', command);
      if (!line) return status({ context, feature, operation: action.type, phase: 'blocked', reason: 'invalid-request' });
      return start(context, action.feature, action.type, line, action, { registryName: command });
    }
    const built = commandForAction(action);
    if (!built?.line) return status({ context, feature, operation: action.type, phase: 'blocked', reason: 'invalid-request' });
    return start(context, built.feature, built.operation, built.line, action);
  }

  function refresh(input: { readonly context: RequestContext; readonly feature: IntegrationFeature }): IntegrationResult {
    return execute({ context: input.context, action: { type: 'refresh', feature: input.feature } });
  }

  function retire(owner: OwnerSnapshot): void {
    if (active && sameOwner(active.context.owner, owner)) { finish('unknown', 'owner-changed'); }
    clearPrivateFor(owner);
    const scope = ownerScope(owner);
    for (const key of unknownMutations) if (key.startsWith(`${scope}:`)) unknownMutations.delete(key);
    registryByOwner.delete(scope);
    authorizationByOwner.delete(scope);
    unfurlStateByOwner.delete(scope);
    unfurlOptInByOwner.delete(scope);
  }

  function dispose(): void {
    if (disposed) return;
    clearTimer();
    for (const value of privateInputs.values()) { clearTimeout(value.timer); wipePrivate(value); }
    for (const value of urlRefs.values()) clearTimeout(value.timer);
    for (const presenter of privatePresenters.values()) { try { presenter.dispose(); } catch { /* private DOM teardown */ } }
    for (const disposeForm of privateForms.values()) { try { disposeForm(); } catch { /* private DOM teardown */ } }
    privateForms.clear(); privateInputs.clear(); urlRefs.clear(); privatePresenters.clear(); unknownMutations.clear(); registryByOwner.clear(); authorizationByOwner.clear(); unfurlStateByOwner.clear(); unfurlOptInByOwner.clear(); active = null; disposed = true;
  }

  return { refresh, execute, readiness, consumePrivateIngress, retire, dispose };
}
