// Tiny, dependency-free accessor for the mounted media-engine singleton.
//
// This lives OUTSIDE `src/lib/suimyaku-media/` on purpose: importing the
// accessor must NOT drag the heavy `MediaEngine` class (and its OpcodecWasm /
// Tsumugi* / PeerRegistry graph) into the caller's chunk. The store reads the
// mounted engine on hot voice/call paths and is itself eager (loaded on the
// landing page via vaultSync), so it imports from here — keeping the ~160kB of
// media code out of the initial payload and in the lazy /app (`media`) chunk.
//
// The singleton MUST live on globalThis, not a module-local `let`: the store
// (getMounted…) and the useSuimyakuMedia hook (setMounted…) can be bundled into
// separate chunks with separate module instances, in which case a module-local
// leaves the store reading null forever — so joinVoiceChannel no-ops and
// voice/video never starts. globalThis also makes it safe for this tiny module
// to be duplicated across chunks.

import type { SuimyakuMediaEngine } from '@/lib/suimyaku-media/MediaEngine';

const MOUNTED_ENGINE_KEY = '__oceanMountedSuimyakuEngine';

export function setMountedSuimyakuMediaEngine(engine: SuimyakuMediaEngine | null): void {
  (globalThis as Record<string, unknown>)[MOUNTED_ENGINE_KEY] = engine;
}

export function getMountedSuimyakuMediaEngine(): SuimyakuMediaEngine | null {
  return (
    ((globalThis as Record<string, unknown>)[MOUNTED_ENGINE_KEY] as SuimyakuMediaEngine | null) ??
    null
  );
}
