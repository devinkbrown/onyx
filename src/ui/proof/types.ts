// SPDX-License-Identifier: AGPL-3.0-or-later
import type { JSX } from 'solid-js';
import type { TruthState } from '../tokens/token-contract';

/** A caller-owned action. The rail only places it; it never invents controls. */
export type ProofAction = JSX.Element | (() => JSX.Element);

export type ProofReceiptProps = {
  state: TruthState;
  label: string;
  detail?: string;
  evidenceType?: string;
  action?: ProofAction;
  children?: ProofAction;
  class?: string;
};

export type ProofRailProps = ProofReceiptProps & {
  /** A short editorial line for the rail. It is omitted when no thesis is supplied. */
  thesis?: string;
  /** The accessible name for the rail landmark. */
  ariaLabel?: string;
};
