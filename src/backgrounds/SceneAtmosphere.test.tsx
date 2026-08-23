// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/lib/store';
import { AUTO_BACKGROUND_ID } from '@/shell/themeBackground';

vi.mock('./Background', () => ({
  Background: (props: { id?: string }) => (
    <div data-testid="scene-atmosphere" data-background-id={props.id ?? 'deep-current'} />
  ),
}));

import { SceneAtmosphere } from './SceneAtmosphere';

const initialState = store.getInitialState();

afterEach(() => {
  cleanup();
  store.setState(initialState, true);
});

describe('SceneAtmosphere', () => {
  it('resolves Auto / ocean to the Deep Current scene host', () => {
    store.setState({ ...initialState, backgroundId: AUTO_BACKGROUND_ID }, true);
    const { getByTestId } = render(() => <SceneAtmosphere />);
    expect(getByTestId('scene-atmosphere')).toHaveAttribute('data-background-id', 'deep-current');
  });

  it('keeps an explicit pinned scene', () => {
    store.setState({ ...initialState, backgroundId: 'starfield' }, true);
    const { getByTestId } = render(() => <SceneAtmosphere />);
    expect(getByTestId('scene-atmosphere')).toHaveAttribute('data-background-id', 'starfield');
  });
});
