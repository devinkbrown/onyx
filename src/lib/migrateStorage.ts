/**
 * lib/migrateStorage.ts — one-time localStorage migration: 'ocean-*' → 'onyx:*'.
 *
 * Every legacy 'ocean-'-prefixed key is COPIED to its 'onyx:'-prefixed name
 * when the new key is absent. Old keys are intentionally NOT deleted so a
 * rollback to an older build still finds its data.
 *
 * IMPORTANT: the migration runs as a top-level side effect of importing this
 * module, and this module must stay the FIRST import in src/index.tsx.
 * Several modules (store.ts initial state, theme/prefs providers) read these
 * keys during module evaluation, so an explicit function call from index.tsx's
 * body would run too late — ESM evaluates imported module bodies first.
 */

const LEGACY_PREFIX = 'ocean-';
const NEW_PREFIX = 'onyx:';

let hasRun = false;

/** Copy every 'ocean-*' localStorage key to 'onyx:*' (new key wins if present). */
export function migrateLegacyStorage(): void {
  if (hasRun) return;
  hasRun = true;
  try {
    if (typeof localStorage === 'undefined') return;

    // Snapshot keys first — writing while iterating shifts localStorage indices.
    const legacyKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LEGACY_PREFIX)) legacyKeys.push(key);
    }

    for (const key of legacyKeys) {
      const next = NEW_PREFIX + key.slice(LEGACY_PREFIX.length);
      try {
        if (localStorage.getItem(next) !== null) continue; // never clobber new data
        const value = localStorage.getItem(key);
        if (value !== null) localStorage.setItem(next, value);
      } catch {
        // Quota or security error on a single key — keep migrating the rest.
      }
    }
  } catch {
    // localStorage unavailable (privacy mode, non-browser env) — nothing to do.
  }
}

// Side effect on import — see the module doc comment above.
migrateLegacyStorage();
