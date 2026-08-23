// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, createMemo, createResource, createSignal, onCleanup, onMount, Show, untrack } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  BackgroundEngine,
  isSceneVariant,
  type BackgroundQuality,
  type BackgroundVariant,
  type SceneVariant,
} from './engine';
import { resolveBackgroundId, type BackgroundId } from './catalogue';
import { FALLBACK_BACKGROUND_VARIANT, loadBackgroundVariant } from './loader';
import { sceneMotion, type SceneMotion } from '@/lib/prefs/sceneMotion';
import {
  applyBackgroundPolicyDataset,
  applyBackgroundRuntime,
  readCoarsePointer,
  readViewportWidth,
  shouldPauseWhenUnfocused,
  type BackgroundPolicy,
} from './backgroundPolicy';
import { createAppearanceRuntime } from './appearanceRuntime';
import { ScenePolicyProvider, type ScenePolicyView } from './scenes/scenePolicy';

export interface BackgroundProps {
  id?: BackgroundId | string;
  /** Host quality ceiling — policy may still step this down (never up). */
  quality?: BackgroundQuality;
  /** Picker / studio preview: force the low/sparse/capped contract. */
  preview?: boolean;
  /** Temporary studio-only motion state; never persists the global preference. */
  motionOverride?: SceneMotion;
}

export const DEFAULT_BACKGROUND_ID: BackgroundId = 'deep-current';
export const REDUCED_MOTION_BACKGROUND_ID: BackgroundId = 'lapis-gradient';

/**
 * Resolve the id of the background to render. Reduced motion NO LONGER swaps to
 * a generic solid — the engine renders the theme's own scene as a still frame
 * (see `staticMode`), so a reduced-motion / low-power device still gets its
 * theme-coloured background, just frozen. Only an unknown id falls back. Legacy
 * ids (pre-rename prefs / signatureBg) resolve to their canonical catalogue
 * id. This is metadata-only (no render code loaded), so the picker stays light.
 */
export function selectBackgroundId(id: string | undefined, _reducedMotion: boolean): BackgroundId {
  return resolveBackgroundId(id) ?? DEFAULT_BACKGROUND_ID;
}

export function Background(props: BackgroundProps) {
  const motion = createMemo(() => props.motionOverride ?? sceneMotion());
  // Keep the FPS guard's actual tier so policy can converge to the renderer's
  // current quality. A boolean would lose whether the engine is at med or low
  // after multiple pressure steps.
  const [runtimeQuality, setRuntimeQuality] = createSignal<BackgroundQuality | undefined>();

  const appearance = createAppearanceRuntime({
    motion,
    preview: () => props.preview === true,
    runtimeQuality,
    qualityCeiling: () => props.quality,
  });
  const policy = appearance.policy;

  // Metadata (id + kind) resolves synchronously from the catalogue; the heavy
  // render module is fetched on demand so only the ACTIVE variant's chunk loads.
  // An undefined resource source is Solid's explicit "do not fetch" state.
  // Keep Off outside the lazy-loader entirely; restoring Animated/Still changes
  // this source back to an id and loads the selected renderer normally.
  //
  // Source is the concrete render id only — Auto is resolved by the host
  // (AppShell / Appearance) before it reaches here — so Auto → explicit
  // transitions always change the resource key when the user pins a different
  // scene and re-fetch the new chunk without eager-loading the catalogue.
  const activeId = createMemo(() => policy().mode === 'off'
    ? undefined
    : selectBackgroundId(props.id, policy().mode === 'still'));
  // Wrap the loader so a rejected dynamic import (stale/missing/network chunk)
  // never enters createResource's error state: reading an errored resource
  // throws and can blank the connected shell / appearance chrome, leaving only
  // wallpaper. Fail closed to "no variant" instead.
  const [variant] = createResource(activeId, async (id) => {
    try {
      return await loadBackgroundVariant(id) ?? FALLBACK_BACKGROUND_VARIANT;
    } catch {
      // Stale hashed chunk or network miss. Paint the eager ocean default so
      // fail-closed does not look like Off.
      return FALLBACK_BACKGROUND_VARIANT;
    }
  });

  // Never read variant() while pending/errored in a way that throws; track
  // state explicitly so the inert placeholder stays up and the shell remains.
  const resolvedVariant = createMemo(() => {
    const state = variant.state;
    if (state === 'pending' || state === 'refreshing' || state === 'unresolved' || state === 'errored') {
      return undefined;
    }
    return variant();
  });
  const loadFailed = createMemo(() => variant.state === 'errored' || (
    // Ready-but-empty after a caught import failure for a known active id.
    variant.state === 'ready'
    && activeId() != null
    && resolvedVariant() === undefined
  ));

  const scene = createMemo(() => {
    const active = resolvedVariant();
    return active && isSceneVariant(active) ? active : undefined;
  });
  const canvasVariant = createMemo(() => {
    const active = resolvedVariant();
    return active && !isSceneVariant(active) ? active : undefined;
  });

  createEffect((previous?: string | undefined) => {
    // A new wallpaper is a fresh budget — drop leftover FPS-guard quality
    // so the next scene is not born throttled. Policy-only changes must not
    // clear pressure or the drop would immediately undo itself.
    const key = activeId() ?? '';
    if (previous !== undefined && previous !== key) setRuntimeQuality(undefined);
    return key;
  });

  return (
    <Show
      when={policy().mode !== 'off'}
      fallback={
        policy().reason === 'reduced-data'
          ? <BackgroundPlaceholder policy={policy()} reducedData={true} preview={props.preview === true} />
          : null
      }
    >
      <Show
        when={resolvedVariant()}
        // First paint isn't blocked on the variant chunk: show a frozen themed
        // frame (matching the reduced-motion still) until it resolves — and
        // after a stale-chunk miss so the shell/interface stays usable.
        fallback={
          <BackgroundPlaceholder
            policy={policy()}
            reducedData={false}
            loadFailed={loadFailed}
            preview={props.preview === true}
          />
        }
      >
        <Show
          when={scene()}
          fallback={
            <CanvasBackground
              variant={canvasVariant()}
              policy={policy()}
              preview={props.preview === true}
              onRuntimePressure={(quality) => setRuntimeQuality(quality)}
            />
          }
        >
          {(active) => (
            <SceneBackground
              scene={active()}
              policy={policy()}
              preview={props.preview === true}
              onRuntimePressure={(quality) => setRuntimeQuality(quality)}
            />
          )}
        </Show>
      </Show>
    </Show>
  );
}

/**
 * Static themed frame shown for the one tick between mount and the active
 * variant's chunk resolving, and after a failed/stale chunk load. Matches the
 * app's base surface so there's no flash and no layout work — a fixed,
 * non-interactive, painter-only layer that never competes with the shell.
 */
function BackgroundPlaceholder(props: {
  policy: BackgroundPolicy;
  reducedData: boolean;
  preview?: boolean;
  /** Accessor so the fail flag stays reactive while Show holds the fallback. */
  loadFailed?: () => boolean;
}) {
  return (
    <div
      aria-hidden="true"
      data-background-canvas="true"
      data-background-placeholder="true"
      data-background-kind="solid"
      data-background-reduced-data={props.reducedData ? 'true' : undefined}
      data-background-load-failed={props.loadFailed?.() ? 'true' : undefined}
      data-background-mode={props.policy.mode}
      data-background-quality={props.policy.quality}
      data-background-detail={props.policy.sceneDetail}
      data-background-reason={props.policy.reason}
      data-background-policy-fps={String(props.policy.frameCapFps)}
      data-background-cadence="placeholder"
      data-background-preview={props.preview ? 'true' : undefined}
      style={{
        position: 'fixed',
        inset: '0',
        'z-index': '0',
        'pointer-events': 'none',
        background:
          'radial-gradient(120% 140% at 50% 8%, color-mix(in oklab, var(--lapis) 34%, var(--ink)) 0%, color-mix(in oklab, var(--lapis-deep, var(--lapis)) 16%, var(--ink)) 42%, var(--ink) 78%)',
      }}
    />
  );
}

export default Background;

/** Canvas-engine path: renders a <canvas> driven by BackgroundEngine. */
function CanvasBackground(props: {
  variant: BackgroundVariant | undefined;
  policy: BackgroundPolicy;
  preview: boolean;
  onRuntimePressure: (quality: BackgroundQuality) => void;
}) {
  let canvas!: HTMLCanvasElement;

  createEffect(() => {
    const variant = props.variant;
    if (!variant) return;

    const initial = untrack(() => props.policy);
    canvas.dataset.backgroundId = variant.id;
    canvas.dataset.backgroundKind = initial.mode === 'still' ? 'solid' : variant.kind;
    applyBackgroundPolicyDataset(canvas, initial, { preview: props.preview, renderer: 'canvas' });

    const engine = new BackgroundEngine({
      canvas,
      variant,
      quality: initial.quality,
      frameCapFps: initial.frameCapFps,
      dprCap: initial.dprCap,
      staticMode: initial.mode === 'still',
      live: !props.preview,
      onQualityChange: (quality) => props.onRuntimePressure(quality),
    });

    engine.start();

    createEffect(() => {
      const next = props.policy;
      canvas.dataset.backgroundId = variant.id;
      canvas.dataset.backgroundKind = next.mode === 'still' ? 'solid' : variant.kind;
      applyBackgroundPolicyDataset(canvas, next, {
        preview: props.preview,
        paused: applyBackgroundRuntime(next).paused,
        renderer: 'canvas',
      });
      engine.applyPresentation({
        quality: next.quality,
        frameCapFps: next.frameCapFps,
        dprCap: next.dprCap,
        staticMode: next.mode === 'still',
      });
    });

    onCleanup(() => engine.dispose());
  });

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      data-background-canvas="true"
      style={{
        position: 'fixed',
        inset: '0',
        width: '100%',
        height: '100%',
        'z-index': '0',
        'pointer-events': 'none',
        display: 'block',
      }}
    />
  );
}

/**
 * Scene path: renders a DOM/SVG scene component inside a fixed full-screen
 * container. The container carries `data-background-canvas` so the mobile
 * visibility filter in global.css applies to scenes exactly like canvases.
 */
function SceneBackground(props: {
  scene: SceneVariant;
  policy: BackgroundPolicy;
  preview: boolean;
  onRuntimePressure: (quality: BackgroundQuality) => void;
}) {
  const [runtimePaused, setRuntimePaused] = createSignal(false);
  const [pressurePaused, setPressurePaused] = createSignal(false);
  createEffect((previous?: string) => {
    const id = props.scene.id;
    if (previous !== undefined && previous !== id) setPressurePaused(false);
    return id;
  });
  onMount(() => {
    const pauseWhenUnfocused = (): boolean =>
      shouldPauseWhenUnfocused(readViewportWidth(), readCoarsePointer());
    const syncHostPause = (): void => {
      const hidden = typeof document !== 'undefined' && document.hidden;
      // Mobile Safari often reports !hasFocus() on a visible tab. Only treat
      // that as a hold on desktop / fine-pointer surfaces.
      const unfocused = pauseWhenUnfocused()
        && typeof document?.hasFocus === 'function'
        && !document.hasFocus();
      setRuntimePaused(hidden || unfocused);
    };
    const handleBlur = (): void => {
      if (pauseWhenUnfocused()) setRuntimePaused(true);
    };
    syncHostPause();
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', handleBlur);
      window.addEventListener('focus', syncHostPause);
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', syncHostPause);
    onCleanup(() => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('blur', handleBlur);
        window.removeEventListener('focus', syncHostPause);
      }
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', syncHostPause);
    });
  });

  // CSS/SVG scenes are display-driven, so unlike canvas they cannot promise a
  // numerical frame cap. Measure sustained long frames instead: step the
  // shared detail policy down first, then freeze only this scene if low detail
  // still causes repeated >48 ms frames. Brief loading/GC spikes decay and do
  // not trigger the guard.
  createEffect(() => {
    const next = props.policy;
    if (
      next.mode !== 'animated'
      || runtimePaused()
      || pressurePaused()
      || typeof requestAnimationFrame !== 'function'
    ) return;

    let frame = 0;
    let last = 0;
    let slowScore = 0;
    const sample = (now: number): void => {
      if (last > 0) {
        const gap = now - last;
        slowScore = gap > 48 ? slowScore + 1 : Math.max(0, slowScore - 1);
        if (slowScore >= 8) {
          if (next.quality === 'high') props.onRuntimePressure('med');
          else if (next.quality === 'med') props.onRuntimePressure('low');
          else setPressurePaused(true);
          return;
        }
      }
      last = now;
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const policyView = createMemo((): ScenePolicyView => ({
    sceneDetail: props.policy.sceneDetail,
    reducedMotion: props.policy.mode === 'still',
    paused: runtimePaused() || pressurePaused() || applyBackgroundRuntime(props.policy).paused,
  }));

  return (
    <div
      aria-hidden="true"
      data-background-canvas="true"
      data-background-id={props.scene.id}
      data-background-kind={props.policy.mode === 'still' ? 'solid' : 'scene'}
      data-background-mode={props.policy.mode}
      data-background-quality={props.policy.quality}
      data-background-detail={props.policy.sceneDetail}
      data-background-reason={props.policy.reason}
      data-background-policy-dpr-cap={String(props.policy.dprCap)}
      data-background-policy-fps={String(props.policy.frameCapFps)}
      data-background-cadence="display-driven"
      data-background-paused={policyView().paused ? 'true' : undefined}
      data-background-runtime-pressure={pressurePaused() ? 'paused' : undefined}
      data-background-preview={props.preview ? 'true' : undefined}
      style={{
        position: 'fixed',
        inset: '0',
        'z-index': '0',
        'pointer-events': 'none',
        overflow: 'hidden',
      }}
    >
      <ScenePolicyProvider value={policyView}>
        <Dynamic
          component={props.scene.component}
          reducedMotion={props.policy.mode === 'still'}
          sceneDetail={props.policy.sceneDetail}
          paused={policyView().paused}
          onRuntimePaused={setRuntimePaused}
        />
      </ScenePolicyProvider>
    </div>
  );
}
