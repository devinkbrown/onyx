// SPDX-License-Identifier: AGPL-3.0-or-later

import { getState } from '@/lib/store';
import type { NormalizedModerationAction } from './actionModel';

/** Dispatch a reviewed room action through the existing store commands. */
export function applyMemberModeration(action: NormalizedModerationAction): void {
  const state = getState();
  switch (action.kind) {
    case 'kick':
      state.kickMember(action.channel, action.target, action.reason);
      break;
    case 'ban':
      state.banMask(action.channel, action.mask);
      break;
    case 'unban':
      state.unbanMask(action.channel, action.mask);
      break;
    case 'op':
      state.opMember(action.channel, action.target, true);
      break;
    case 'deop':
      state.opMember(action.channel, action.target, false);
      break;
    case 'voice':
      state.voiceMember(action.channel, action.target, true);
      break;
    case 'devoice':
      state.voiceMember(action.channel, action.target, false);
      break;
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
    }
  }
}
