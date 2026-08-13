// SPDX-License-Identifier: AGPL-3.0-or-later
import { TRUTH_STATES, type TruthState } from '../tokens/token-contract';

export type ProofStateCopy = {
  readonly label: string;
  readonly glyph: string;
  readonly detail: string;
};

/**
 * The six states are deliberately plain language. They describe the source of
 * the information, never a stronger product or protection claim.
 */
export const PROOF_STATE_COPY = {
  verified: {
    label: 'Verified',
    glyph: '✓',
    detail: 'The source confirmed this content.',
  },
  partial: {
    label: 'Partial',
    glyph: '◐',
    detail: 'Some requested information is still missing.',
  },
  local: {
    label: 'Local only',
    glyph: '⌂',
    detail: 'Read from this device; the source has not confirmed it.',
  },
  reconnecting: {
    label: 'Reconnecting',
    glyph: '↻',
    detail: 'The connection is being restored; content may be stale.',
  },
  unavailable: {
    label: 'Unavailable',
    glyph: '×',
    detail: 'The source could not be reached.',
  },
  unknown: {
    label: 'Unknown',
    glyph: '?',
    detail: 'No claim can be made from the available information.',
  },
} satisfies Record<TruthState, ProofStateCopy>;

export function getProofStateCopy(state: TruthState): ProofStateCopy {
  return PROOF_STATE_COPY[state];
}

export { TRUTH_STATES };
export type { TruthState };
