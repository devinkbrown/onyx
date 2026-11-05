import type { OwnerSnapshot, RequestContext } from './contracts';
import type { LocalNamespaceTicket } from './local-workspace-owner';
import { canonicalTupleKey } from './contracts';
import { OWNED_SETTINGS, openVaultV5, transactionPromise } from './migrations';

export type SettingValue = string | boolean | number;
export type SettingsScope = 'installation' | 'network' | 'account' | 'conversation';
export interface SettingsBundle { readonly schemaVersion: 1; readonly scope: 'installation'; readonly values: Readonly<Record<string, SettingValue>> }
export interface SettingsDependencies {
  readonly indexedDB?: IDBFactory;
  readonly ownerSnapshot: () => OwnerSnapshot;
  readonly isCurrent: (owner: OwnerSnapshot) => boolean;
  readonly namespaceForRequest: (request: RequestContext) => LocalNamespaceTicket | null;
  readonly isNamespaceCurrent: (ticket: LocalNamespaceTicket, request: RequestContext) => boolean;
  readonly installationId: string;
  readonly canonicalConversationKey?: (owner: OwnerSnapshot, target: string, ticket: LocalNamespaceTicket) => string | null;
}
interface SettingsRow { readonly id: string; readonly installationKey?: string; readonly ownerKey: string; readonly scope: SettingsScope; readonly targetKey: string; readonly values: Readonly<Record<string, SettingValue>>; readonly revision: number; readonly updatedAt: number }
const ALLOWED: Readonly<Record<string, (value: unknown) => value is SettingValue>> = {
  theme: (v): v is string => typeof v === 'string' && v.length <= 64 && /^[a-z0-9_-]+$/iu.test(v),
  motion: (v): v is string => v === 'system' || v === 'reduce' || v === 'full',
  language: (v): v is string => typeof v === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/u.test(v),
  layout: (v): v is string => v === 'compact' || v === 'comfortable',
  showTimestamps: (v): v is boolean => typeof v === 'boolean',
  showJoinPart: (v): v is boolean => typeof v === 'boolean',
  linkPreviews: (v): v is boolean => typeof v === 'boolean',
  notificationPreviews: (v): v is boolean => typeof v === 'boolean',
};
const OPT_INS = new Set(['linkPreviews', 'notificationPreviews']);
function sanitize(values: Record<string, unknown>): Record<string, SettingValue> | null {
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 32) return null;
  const result: Record<string, SettingValue> = {};
  for (const [key, value] of Object.entries(values)) { if (!Object.hasOwn(ALLOWED, key)) return null; const validate = ALLOWED[key]; if (!validate || !validate(value)) return null; result[key] = value; }
  return result;
}

/** Known-key settings persistence. Import preview is inert; applying privacy
 * opt-ins requires a separate explicit confirmation input. */
export function createSettingsStore(deps: SettingsDependencies) {
  const idb = deps.indexedDB ?? globalThis.indexedDB;
  let db: IDBDatabase | null = null; let disposed = false; let opening: Promise<boolean> | null = null;
  const active = new Set<IDBTransaction>();
  const revisions = new Map<string, number>();
  const current = (request: RequestContext, ticket: LocalNamespaceTicket): boolean => !disposed && deps.isNamespaceCurrent(ticket, request);
  const open = async (): Promise<boolean> => { if (db) return true; if (!idb || disposed) return false; opening ??= openVaultV5({ indexedDB: idb, onVersionChange: () => { db?.close(); db = null; } }).then((r) => { if (r.kind !== 'ready' || disposed) { if (r.kind === 'ready') r.database.close(); return false; } db = r.database; return true; }).finally(() => { opening = null; }); return opening; };
  const tx = (mode: IDBTransactionMode): IDBTransaction | null => { if (!db || disposed) return null; try { const t = db.transaction(OWNED_SETTINGS, mode); active.add(t); const drop = () => active.delete(t); t.addEventListener('complete', drop, { once: true }); t.addEventListener('abort', drop, { once: true }); return t; } catch { return null; } };
  const installationKey = `install:${deps.installationId}`;
  const scopeKey = (owner: OwnerSnapshot, ticket: LocalNamespaceTicket, scope: SettingsScope, target: string): string | null => {
    if (scope === 'installation') return installationKey;
    if (scope === 'network') return canonicalTupleKey([installationKey, 'network', owner.networkId]);
    if (scope === 'account') return canonicalTupleKey([installationKey, 'account', ticket.ownerKey]);
    const canonical = deps.canonicalConversationKey?.(owner, target, ticket);
    return canonical ? canonicalTupleKey([installationKey, 'conversation', ticket.ownerKey, canonical]) : null;
  };
  const idFor = (owner: OwnerSnapshot, ticket: LocalNamespaceTicket, scope: SettingsScope, target: string): string | null => {
    const scoped = scopeKey(owner, ticket, scope, target);
    return scoped ? JSON.stringify([installationKey, scope, scoped]) : null;
  };
  async function saveSettings(request: RequestContext, ticket: LocalNamespaceTicket, scope: SettingsScope, target: string, raw: Record<string, unknown>, revision: number): Promise<boolean> {
    const owner = request.owner;
    if (!current(request, ticket) || !Number.isSafeInteger(revision) || revision < 0 || (scope !== 'installation' && !target)) return false;
    if (ticket.scope.kind === 'guest' && scope !== 'installation') return false;
    const id = idFor(owner, ticket, scope, target);
    if (!id) return false;
    if (revision < (revisions.get(id) ?? -1)) return false;
    revisions.set(id, revision);
    const startedAt = Date.now();
    const values = sanitize(raw); if (!values) return false;
    const opened = await open();
    if (!current(request, ticket) || revisions.get(id) !== revision || !opened) return false;
    const transaction = tx('readwrite'); if (!transaction) return false; const done = transactionPromise(transaction);
    if (!current(request, ticket) || revisions.get(id) !== revision) { transaction.abort(); await done.catch(() => undefined); return false; }
    const store = transaction.objectStore(OWNED_SETTINGS);
    const get = store.get(id);
    get.onsuccess = () => {
      const previous = get.result as SettingsRow | undefined;
      if (!current(request, ticket) || revisions.get(id) !== revision || (previous && (previous.updatedAt > startedAt || (previous.updatedAt === startedAt && previous.revision > revision)))) { transaction.abort(); return; }
      const row: SettingsRow = { id, ...(scope === 'installation' ? { installationKey } : {}), ownerKey: ticket.ownerKey, scope, targetKey: target, values, revision, updatedAt: startedAt };
      store.put(row);
    };
    try { await done; return current(request, ticket); } catch { return false; }
  }
  async function getSettings(request: RequestContext, ticket: LocalNamespaceTicket, scope: SettingsScope, target: string): Promise<Readonly<Record<string, SettingValue>> | null> {
    const owner = request.owner;
    if (!current(request, ticket)) return null;
    const opened = await open();
    if (!current(request, ticket) || !opened || (ticket.scope.kind === 'guest' && scope !== 'installation')) return null;
    const transaction = tx('readonly'); if (!transaction) return null; const done = transactionPromise(transaction);
    const id = idFor(owner, ticket, scope, target);
    if (!id) { transaction.abort(); await done.catch(() => undefined); return null; }
    const req = scope === 'installation' ? transaction.objectStore(OWNED_SETTINGS).index('by-installation').get(installationKey) : transaction.objectStore(OWNED_SETTINGS).get(id);
    let row: SettingsRow | undefined;
    try { row = await new Promise<SettingsRow | undefined>((resolve, reject) => { req.onsuccess = () => resolve(req.result as SettingsRow | undefined); req.onerror = () => reject(req.error); }); await done; }
    catch { await done.catch(() => undefined); return null; }
    return current(request, ticket) && row?.scope === scope ? sanitize(row.values as Record<string, unknown>) : null;
  }
  function previewImport(input: unknown): { readonly accepted: boolean; readonly diff: Readonly<Record<string, SettingValue>>; readonly requiresOptInConfirmation: readonly string[] } {
    if (!input || typeof input !== 'object') return { accepted: false, diff: {}, requiresOptInConfirmation: [] };
    const bundle = input as Partial<SettingsBundle>;
    if (bundle.schemaVersion !== 1 || bundle.scope !== 'installation' || !bundle.values) return { accepted: false, diff: {}, requiresOptInConfirmation: [] };
    const diff = sanitize(bundle.values as Record<string, unknown>);
    if (!diff) return { accepted: false, diff: {}, requiresOptInConfirmation: [] };
    return { accepted: true, diff, requiresOptInConfirmation: Object.keys(diff).filter((key) => OPT_INS.has(key) && diff[key] === true) };
  }
  return {
    async get(request: RequestContext, scope: SettingsScope = 'installation', target = ''): Promise<Readonly<Record<string, SettingValue>> | null> {
      const ticket = deps.namespaceForRequest(request); return ticket ? getSettings(request, ticket, scope, target) : null;
    },
    async save(request: RequestContext, scope: SettingsScope, target: string, raw: Record<string, unknown>, revision: number): Promise<boolean> {
      const ticket = deps.namespaceForRequest(request); return ticket ? saveSettings(request, ticket, scope, target, raw, revision) : false;
    },
    previewImport,
    async applyImport(request: RequestContext, preview: ReturnType<typeof previewImport>, confirmOptIns: boolean): Promise<boolean> {
      const ticket = deps.namespaceForRequest(request); if (!ticket || !current(request, ticket) || !preview || preview.accepted !== true) return false;
      const cleanDiff = sanitize(preview.diff as Record<string, unknown>);
      if (!cleanDiff) return false;
      const needsConsent = Object.entries(cleanDiff).some(([key, value]) => OPT_INS.has(key) && value === true);
      if (!confirmOptIns && needsConsent) return false;
      return saveSettings(request, ticket, 'installation', '', cleanDiff, Date.now());
    },
    async exportInstallation(request: RequestContext): Promise<SettingsBundle | null> {
      const ticket = deps.namespaceForRequest(request); if (!ticket) return null;
      const values = await getSettings(request, ticket, 'installation', ''); return values ? { schemaVersion: 1, scope: 'installation', values } : null;
    },
    dispose(): void { disposed = true; revisions.clear(); for (const transaction of active) { try { transaction.abort(); } catch { /* ended */ } } active.clear(); db?.close(); db = null; },
  };
}
