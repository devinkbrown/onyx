// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_NOTIFICATION_ENTRIES,
  MAX_SERVER_AUX_TEXT_LENGTH,
  MAX_TOAST_ENTRIES,
  store,
} from './store';

const initialState = store.getInitialState();

beforeEach(() => {
  store.setState({ ...initialState }, true);
});

describe('transient notification bounds', () => {
  it('bounds notification content and retires read ids with their rows', () => {
    for (let index = 0; index < MAX_NOTIFICATION_ENTRIES + 8; index += 1) {
      store.getState().addNotification({
        type: 'dm',
        text: `${index}-${'x'.repeat(MAX_SERVER_AUX_TEXT_LENGTH + 8)}`,
        from: index === MAX_NOTIFICATION_ENTRIES + 7 ? 'bad nick' : `peer-${index}`,
        channel: index === MAX_NOTIFICATION_ENTRIES + 7 ? 'bad target' : '#root',
        topic: index === MAX_NOTIFICATION_ENTRIES + 7 ? '\ninvalid' : 'release',
      });
      const id = store.getState().notifications.at(-1)?.id;
      if (id) store.getState().markNotificationRead(id);
    }

    const state = store.getState();
    expect(state.notifications).toHaveLength(MAX_NOTIFICATION_ENTRIES);
    expect(state.readNotificationIds.size).toBe(MAX_NOTIFICATION_ENTRIES);
    expect(state.notifications.every((item) => item.text.length <= MAX_SERVER_AUX_TEXT_LENGTH))
      .toBe(true);
    expect(state.notifications.at(-1)?.from).toBeUndefined();
    expect(state.notifications.at(-1)?.channel).toBeUndefined();
    expect(state.notifications.at(-1)?.topic).toBeUndefined();

    store.getState().markNotificationRead('unknown');
    expect(store.getState().readNotificationIds.size).toBe(MAX_NOTIFICATION_ENTRIES);

    const dismissed = store.getState().notifications[0]?.id;
    expect(dismissed).toBeDefined();
    store.getState().dismissNotification(dismissed!);
    expect(store.getState().notifications).toHaveLength(MAX_NOTIFICATION_ENTRIES - 1);
    expect(store.getState().readNotificationIds.has(dismissed!)).toBe(false);
  });

  it('bounds toast rows, text, duration, and group keys', () => {
    for (let index = 0; index < MAX_TOAST_ENTRIES + 5; index += 1) {
      store.getState().addToast({
        variant: 'info',
        title: `${index}-${'t'.repeat(MAX_SERVER_AUX_TEXT_LENGTH + 8)}`,
        description: 'd'.repeat(MAX_SERVER_AUX_TEXT_LENGTH + 8),
        duration: Number.POSITIVE_INFINITY,
        groupKey: 'g'.repeat(MAX_SERVER_AUX_TEXT_LENGTH + 8),
      });
    }

    const state = store.getState();
    expect(state.toasts).toHaveLength(MAX_TOAST_ENTRIES);
    expect(state.toasts.every((toast) => toast.title.length <= MAX_SERVER_AUX_TEXT_LENGTH))
      .toBe(true);
    expect(state.toasts.every((toast) => toast.description?.length === MAX_SERVER_AUX_TEXT_LENGTH))
      .toBe(true);
    expect(state.toasts.every((toast) => toast.groupKey?.length === MAX_SERVER_AUX_TEXT_LENGTH))
      .toBe(true);
    expect(state.toasts.every((toast) => toast.duration === undefined)).toBe(true);
  });
});
