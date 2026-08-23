// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SceneShell } from './SceneShell';
import { SCENE_IDLE_HOLD_MS } from './sceneRuntime';
import { ScenePolicyProvider } from './scenePolicy';

const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
const hasFocusDescriptor = Object.getOwnPropertyDescriptor(document, 'hasFocus');

beforeEach(() => {
  vi.useFakeTimers();
  setDocumentHidden(false);
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  restoreDocumentHidden();
  restoreDocumentHasFocus();
});

describe('SceneShell signature finishing layers', () => {
  it('mounts shared grain + vignette overlays for the DOM-side legibility contract', () => {
    // Canvas presets finish with applyPaperGrain + applyVignette; DOM scenes
    // get the same contract via static overlay layers so text stays legible.
    const { container } = render(() => (
      <SceneShell reducedMotion={false} base="#05070b">
        <div data-testid="ink-layer" />
      </SceneShell>
    ));
    const root = container.querySelector('.onyx-scene');
    expect(root?.getAttribute('data-scene-signature')).toBe('true');
    expect(root?.querySelector('[data-scene-layer="grain"]')).not.toBeNull();
    expect(root?.querySelector('[data-scene-layer="vignette"]')).not.toBeNull();
    expect(root?.getAttribute('data-scene-detail')).toBe('full');
  });

  it('omits the grain finishing layer when policy detail is sparse', () => {
    const { container } = render(() => (
      <ScenePolicyProvider value={() => ({ sceneDetail: 'sparse', reducedMotion: false, paused: false })}>
        <SceneShell reducedMotion={false} base="#05070b">
          <div data-testid="ink-layer" />
        </SceneShell>
      </ScenePolicyProvider>
    ));
    const root = container.querySelector('.onyx-scene');
    expect(root?.getAttribute('data-scene-detail')).toBe('sparse');
    expect(root?.querySelector('[data-scene-layer="grain"]')).toBeNull();
    expect(root?.querySelector('[data-scene-layer="vignette"]')).not.toBeNull();
  });
});

describe('SceneShell SVG timeline lifecycle', () => {
  it('pauses and resumes SMIL with visibility, focus, idle, and activity', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    const timeline = createTimelineSpies();
    const { container } = render(() => (
      <SceneShell reducedMotion={false} base="#05070b">
        <svg ref={(svg) => installTimelineSpies(svg, timeline)} />
      </SceneShell>
    ));
    const root = container.querySelector('.onyx-scene');

    // A visible animated mount has never been paused, so it must not receive a
    // gratuitous unpause call.
    expect(timeline.pauseAnimations).not.toHaveBeenCalled();
    expect(timeline.unpauseAnimations).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('blur'));
    expect(timeline.pauseAnimations).toHaveBeenCalledTimes(1);
    expect(root?.getAttribute('data-scene-runtime-paused')).toBe('true');
    expect(root?.getAttribute('data-scene-paused')).toBe('true');

    window.dispatchEvent(new Event('focus'));
    expect(timeline.unpauseAnimations).toHaveBeenCalledTimes(1);
    expect(root?.hasAttribute('data-scene-runtime-paused')).toBe(false);
    expect(root?.hasAttribute('data-scene-paused')).toBe(false);

    setDocumentHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(timeline.pauseAnimations).toHaveBeenCalledTimes(2);

    setDocumentHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(timeline.unpauseAnimations).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(SCENE_IDLE_HOLD_MS);
    expect(timeline.pauseAnimations).toHaveBeenCalledTimes(3);

    window.dispatchEvent(new Event('pointerdown'));
    expect(timeline.unpauseAnimations).toHaveBeenCalledTimes(3);
  });

  it('reacts to reduced motion without resuming while the runtime remains paused', () => {
    const timeline = createTimelineSpies();
    const [reducedMotion, setReducedMotion] = createSignal(false);
    const { container } = render(() => (
      <SceneShell reducedMotion={reducedMotion()} base="#05070b">
        <svg ref={(svg) => installTimelineSpies(svg, timeline)} />
      </SceneShell>
    ));
    const root = container.querySelector('.onyx-scene');

    setReducedMotion(true);
    expect(timeline.pauseAnimations).toHaveBeenCalledTimes(1);
    expect(root?.getAttribute('data-scene-static')).toBe('true');

    setReducedMotion(false);
    expect(timeline.unpauseAnimations).toHaveBeenCalledTimes(1);
    expect(root?.hasAttribute('data-scene-static')).toBe(false);

    window.dispatchEvent(new Event('blur'));
    expect(timeline.pauseAnimations).toHaveBeenCalledTimes(2);

    setReducedMotion(true);
    setReducedMotion(false);
    expect(timeline.pauseAnimations).toHaveBeenCalledTimes(2);
    expect(timeline.unpauseAnimations).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('focus'));
    expect(timeline.unpauseAnimations).toHaveBeenCalledTimes(2);
  });

  it('gracefully ignores SVGs with missing or partial SMIL timeline methods', () => {
    const [reducedMotion, setReducedMotion] = createSignal(false);
    const partialPause = vi.fn();
    const { container } = render(() => (
      <SceneShell reducedMotion={reducedMotion()} base="#05070b">
        <svg />
        <svg
          ref={(svg) => {
            Object.defineProperty(svg, 'pauseAnimations', {
              configurable: true,
              value: partialPause,
            });
          }}
        />
      </SceneShell>
    ));
    const root = container.querySelector('.onyx-scene');

    expect(() => {
      window.dispatchEvent(new Event('blur'));
      setReducedMotion(true);
      setReducedMotion(false);
      window.dispatchEvent(new Event('focus'));
    }).not.toThrow();
    expect(partialPause).not.toHaveBeenCalled();
    expect(root?.hasAttribute('data-scene-runtime-paused')).toBe(false);
    expect(root?.hasAttribute('data-scene-static')).toBe(false);
  });
});

interface TimelineSpies {
  pauseAnimations: ReturnType<typeof vi.fn>;
  unpauseAnimations: ReturnType<typeof vi.fn>;
}

function createTimelineSpies(): TimelineSpies {
  return {
    pauseAnimations: vi.fn(),
    unpauseAnimations: vi.fn(),
  };
}

function installTimelineSpies(svg: SVGSVGElement, timeline: TimelineSpies): void {
  Object.defineProperties(svg, {
    pauseAnimations: { configurable: true, value: timeline.pauseAnimations },
    unpauseAnimations: { configurable: true, value: timeline.unpauseAnimations },
  });
}

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
}

function restoreDocumentHidden(): void {
  if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor);
  else Reflect.deleteProperty(document, 'hidden');
}

function restoreDocumentHasFocus(): void {
  if (hasFocusDescriptor) Object.defineProperty(document, 'hasFocus', hasFocusDescriptor);
  else Reflect.deleteProperty(document, 'hasFocus');
}
