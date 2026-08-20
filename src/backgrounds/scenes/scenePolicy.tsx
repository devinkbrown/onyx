// SPDX-License-Identifier: AGPL-3.0-or-later
import { createContext, useContext, type Accessor, type JSX } from 'solid-js';
import type { SceneDetail } from '../backgroundPolicy';

export interface ScenePolicyView {
  sceneDetail: SceneDetail;
  reducedMotion: boolean;
  paused: boolean;
}

const DEFAULT_SCENE_POLICY: ScenePolicyView = {
  sceneDetail: 'full',
  reducedMotion: false,
  paused: false,
};

const ScenePolicyContext = createContext<Accessor<ScenePolicyView>>();

export function ScenePolicyProvider(props: {
  value: Accessor<ScenePolicyView>;
  children: JSX.Element;
}) {
  const read = (): ScenePolicyView => props.value();
  return (
    <ScenePolicyContext.Provider value={read}>
      {props.children}
    </ScenePolicyContext.Provider>
  );
}

/** Scenes and SceneShell read the active wallpaper policy without a mass rewrite. */
export function useScenePolicy(): Accessor<ScenePolicyView> {
  const ctx = useContext(ScenePolicyContext);
  return ctx ?? (() => DEFAULT_SCENE_POLICY);
}
