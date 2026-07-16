// SPDX-License-Identifier: AGPL-3.0-or-later
export type ClientExtensionCapability = 'open-url' | 'copy-text';

export type ClientExtensionAction = {
  id: string;
  title: string;
  capability: ClientExtensionCapability;
  hint?: string;
  keywords: string[];
  url?: string;
  text?: string;
};

export type ClientExtensionAuditEntry = {
  id: string;
  title: string;
  capability: ClientExtensionCapability;
  at: string;
  detail: string;
};

export type ClientExtensionActionPreview = Pick<ClientExtensionAction, 'title' | 'capability'> & {
  detail: string;
};

const STORAGE_KEY = 'onyx:client-extension-actions';
const AUDIT_STORAGE_KEY = 'onyx:client-extension-audit';
const MAX_ACTIONS = 12;
const MAX_MANIFEST_ENTRIES = MAX_ACTIONS * 4;
const MAX_KEYWORDS = 8;
const MAX_AUDIT_ENTRIES = 20;

function clean(value: unknown, max = 120): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function actionId(value: unknown): string | null {
  const id = clean(value, 48);
  return id && /^[a-z0-9][a-z0-9._:-]*$/i.test(id) ? id : null;
}

function safeUrl(value: unknown): string | null {
  const raw = clean(value, 500);
  if (!raw) return null;
  try {
    const parsed = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'https://eshmaki.me');
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function readKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_KEYWORDS)
    .flatMap((keyword) => {
      const cleaned = clean(keyword, 40);
      return cleaned ? [cleaned] : [];
    });
}

export function normalizeClientExtensionAction(raw: unknown): ClientExtensionAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const id = actionId(source.id);
  const title = clean(source.title, 80);
  const capability = source.capability;
  if (!id || !title || (capability !== 'open-url' && capability !== 'copy-text')) return null;

  if (capability === 'open-url') {
    const url = safeUrl(source.url);
    if (!url) return null;
    return {
      id,
      title,
      capability,
      url,
      hint: clean(source.hint, 80) ?? new URL(url).hostname,
      keywords: readKeywords(source.keywords),
    };
  }

  const text = clean(source.text, 500);
  if (!text) return null;
  return {
    id,
    title,
    capability,
    text,
    hint: clean(source.hint, 80) ?? 'extension action',
    keywords: readKeywords(source.keywords),
  };
}

/** Pure, bounded normalization shared by manifest review and verified commit. */
export function normalizeClientExtensionActions(
  rawActions: readonly unknown[],
): ClientExtensionAction[] {
  const seen = new Set<string>();
  const actions: ClientExtensionAction[] = [];
  for (const entry of rawActions.slice(0, MAX_MANIFEST_ENTRIES)) {
    const action = normalizeClientExtensionAction(entry);
    if (!action || seen.has(action.id)) continue;
    seen.add(action.id);
    actions.push(action);
    if (actions.length >= MAX_ACTIONS) break;
  }
  return actions;
}

/** Payload-safe detail for a reviewed action. Never includes copy text or URL path/query/userinfo. */
export function previewClientExtensionAction(
  action: ClientExtensionAction,
): ClientExtensionActionPreview {
  if (action.capability === 'open-url' && action.url) {
    return { title: action.title, capability: action.capability, detail: new URL(action.url).origin };
  }
  return {
    title: action.title,
    capability: action.capability,
    detail: `${action.text?.length ?? 0} characters`,
  };
}

export function readClientExtensionActions(): ClientExtensionAction[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const actions: ClientExtensionAction[] = [];
    for (const entry of raw.slice(0, MAX_ACTIONS)) {
      const action = normalizeClientExtensionAction(entry);
      if (!action || seen.has(action.id)) continue;
      seen.add(action.id);
      actions.push(action);
    }
    return actions;
  } catch {
    return [];
  }
}

export function saveClientExtensionActions(
  rawActions: readonly unknown[],
): ClientExtensionAction[] | null {
  const actions = normalizeClientExtensionActions(rawActions);
  if (typeof localStorage === 'undefined') return null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
  } catch {
    return null;
  }

  // A browser can accept setItem yet fail to retain/read the value (quota,
  // privacy mode, policy shims). Success means the normalized committed value is
  // byte-for-byte equivalent to what was reviewed, not merely that setItem ran.
  const committed = readClientExtensionActions();
  return JSON.stringify(committed) === JSON.stringify(actions) ? committed : null;
}

export function parseClientExtensionActionManifest(raw: string): ClientExtensionAction[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      // Intentional compatibility with the documented pre-v1 array shape.
      return normalizeClientExtensionActions(parsed);
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const manifest = parsed as { version?: unknown; actions?: unknown };
    if (manifest.version !== 1 || !Array.isArray(manifest.actions)) return null;
    return normalizeClientExtensionActions(manifest.actions);
  } catch {
    return null;
  }
}

export function exportClientExtensionActionManifest(): string {
  return JSON.stringify({ version: 1, actions: readClientExtensionActions() }, null, 2);
}

export function clearClientExtensionActions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

function auditDetail(action: ClientExtensionAction): string {
  if (action.capability === 'open-url' && action.url) {
    try {
      const url = new URL(action.url);
      return `Opened ${url.origin}`;
    } catch {
      return 'Opened URL';
    }
  }

  if (action.capability === 'copy-text' && action.text) {
    return `Copied ${action.text.length} characters`;
  }

  return 'Ran extension action';
}

function parseAuditEntry(raw: unknown): ClientExtensionAuditEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const id = actionId(source.id);
  const title = clean(source.title, 80);
  const capability = source.capability;
  const at = clean(source.at, 40);
  const detail = clean(source.detail, 120);
  if (!id || !title || !at || !detail || (capability !== 'open-url' && capability !== 'copy-text')) {
    return null;
  }
  return { id, title, capability, at, detail };
}

export function readClientExtensionAudit(): ClientExtensionAuditEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(AUDIT_STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .flatMap((entry) => {
        const parsed = parseAuditEntry(entry);
        return parsed ? [parsed] : [];
      })
      .slice(0, MAX_AUDIT_ENTRIES);
  } catch {
    return [];
  }
}

export function recordClientExtensionActionRun(action: ClientExtensionAction): void {
  if (typeof localStorage === 'undefined') return;
  const entry: ClientExtensionAuditEntry = {
    id: action.id,
    title: action.title,
    capability: action.capability,
    at: new Date().toISOString(),
    detail: auditDetail(action),
  };
  try {
    localStorage.setItem(
      AUDIT_STORAGE_KEY,
      JSON.stringify([entry, ...readClientExtensionAudit()].slice(0, MAX_AUDIT_ENTRIES)),
    );
  } catch {
    /* storage unavailable */
  }
}

export function clearClientExtensionAudit(): void {
  try {
    localStorage.removeItem(AUDIT_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function writeClientExtensionActionsForTests(actions: unknown[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
}
