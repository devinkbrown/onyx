// SPDX-License-Identifier: AGPL-3.0-or-later

export type UpdateAvailability = { available: true; reload: () => void; deferred: boolean } | null;
type Listener = (state: UpdateAvailability) => void;

/** Shared eager-safe coordinator for reloads that must wait for active work. */
export function createUpdateCoordinator() {
  // Counts preserve protection when a stale release arrives after a newer
  // holder acquired the same logical key (for example during navigation).
  const active = new Map<string, number>();
  const listeners = new Set<Listener>();
  let pending = false;
  let reload: (() => void) | undefined;
  let controllerReady = false;
  let reloadAllowed = false;
  let reloaded = false;
  const publish = () => {
    const state = pending && reload && !reloaded
      ? { available: true as const, reload, deferred: active.size > 0 }
      : null;
    listeners.forEach((listener) => listener(state));
  };
  const attempt = () => {
    if (!pending || !controllerReady || !reloadAllowed || active.size || reloaded || !reload) return false;
    reloaded = true;
    reload();
    publish();
    return true;
  };
  return {
    requestReload(nextReload: () => void = reloadCurrentWindow) {
      if (reloaded) return false;
      pending = true;
      reload = nextReload;
      controllerReady = true;
      reloadAllowed = true;
      const attempted = attempt();
      publish();
      return attempted;
    },
    begin(id: string) {
      active.set(id, (active.get(id) ?? 0) + 1);
      publish();
    },
    end(id: string) {
      const count = active.get(id) ?? 0;
      if (count <= 1) active.delete(id);
      else active.set(id, count - 1);
      attempt();
      publish();
    },
    hold(id: string) {
      active.set(id, (active.get(id) ?? 0) + 1);
      publish();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = active.get(id) ?? 0;
        if (count <= 1) active.delete(id);
        else active.set(id, count - 1);
        attempt();
        publish();
      };
    },
    replace(nextReload: () => void, safe: boolean, ready = safe) {
      if (reloaded) return;
      pending = true;
      reload = nextReload;
      controllerReady = ready;
      reloadAllowed = safe;
      publish();
      if (safe) attempt();
    },
    markControllerReady() {
      if (reloaded) return false;
      controllerReady = true;
      const attempted = attempt();
      publish();
      return attempted;
    },
    approve() { reloadAllowed = true; return attempt(); },
    subscribe(listener: Listener) { listeners.add(listener); publish(); return () => listeners.delete(listener); },
    get hasActiveWork() { return active.size > 0; },
  };
}

export const updateCoordinator = createUpdateCoordinator();

function reloadCurrentWindow(): void {
  if (typeof window !== 'undefined') window.location.reload();
}
