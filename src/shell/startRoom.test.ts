// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  focusJoinRoomInput,
  registerStartRoomHandler,
  requestStartRoom,
  resetStartRoomHandlerForTests,
} from './startRoom';

afterEach(() => {
  resetStartRoomHandlerForTests();
  vi.restoreAllMocks();
});

describe('requestStartRoom', () => {
  it('calls the registered AppShell/sidebar handler', () => {
    const handler = vi.fn();
    const dispose = registerStartRoomHandler(handler);
    requestStartRoom();
    expect(handler).toHaveBeenCalledOnce();
    dispose();
    requestStartRoom();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('focuses the existing join field when no handler is registered', () => {
    const input = document.createElement('input');
    input.id = 'shell-join-input';
    document.body.append(input);
    const focus = vi.spyOn(input, 'focus');
    expect(focusJoinRoomInput()).toBe(true);
    expect(focus).toHaveBeenCalledOnce();
    input.remove();
  });
});
