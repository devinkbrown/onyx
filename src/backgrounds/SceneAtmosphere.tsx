// SPDX-License-Identifier: AGPL-3.0-or-later
import { createMemo, type JSX } from 'solid-js';
import { useStore } from '@/lib/store';
import { resolveBackgroundId } from '@/shell/themeBackground';
import { useThemeOptional } from '@/theme';
import { Background } from './Background';

/**
 * Shared scene host for Connect and public company pages.
 * Resolves the store preference against the active theme so Adaptive / Auto
 * still paint that theme's signature (ocean → deep-current), not a generic void.
 */
export function SceneAtmosphere(): JSX.Element {
  const backgroundId = useStore((s) => s.backgroundId);
  const theme = useThemeOptional();
  const sceneId = createMemo(() => resolveBackgroundId(backgroundId(), theme.themeId()));
  return <Background id={sceneId()} />;
}
