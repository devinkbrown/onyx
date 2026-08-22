// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  CALL_JOIN_FAILED_COPY,
  callJoinCopyLeaksProtocol,
  callJoinFailedToast,
} from './callJoinCopy';

describe('callJoinCopy', () => {
  it('uses the same consumer sentence for every join failure', () => {
    const toast = callJoinFailedToast(new Error('need onyx.irc-media.v1 UNENROLLED'));
    expect(toast.title).toBe(CALL_JOIN_FAILED_COPY);
    expect(toast.description).toBe("Couldn't join. Try again.");
    expect(callJoinCopyLeaksProtocol(toast.title)).toBe(false);
    expect(callJoinCopyLeaksProtocol(toast.description)).toBe(false);
  });

  it('flags protocol tokens that must not reach the join surface', () => {
    expect(callJoinCopyLeaksProtocol('need onyx.irc-media.v1')).toBe(true);
    expect(callJoinCopyLeaksProtocol(CALL_JOIN_FAILED_COPY)).toBe(false);
  });
});
