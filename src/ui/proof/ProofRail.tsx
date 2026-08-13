// SPDX-License-Identifier: AGPL-3.0-or-later
import { Show, createMemo, type JSX } from 'solid-js';
import '../tokens/index.css';
import './proof-rail.css';
import { ProofReceipt } from './ProofReceipt';
import type { ProofRailProps } from './types';

export function ProofRail(props: ProofRailProps): JSX.Element {
  const accessibleName = createMemo(() => props.ariaLabel?.trim() || 'Proof rail');

  return (
    <section
      class={['ui-root', 'ui-proof-rail', props.class].filter(Boolean).join(' ')}
      data-ui="proof-rail"
      data-ui-truth={props.state}
      role="region"
      aria-label={accessibleName()}
    >
      <Show when={props.thesis?.trim()}>
        <p class="ui-proof-rail__thesis">{props.thesis}</p>
      </Show>

      <ProofReceipt
        state={props.state}
        label={props.label}
        detail={props.detail}
        evidenceType={props.evidenceType}
        action={props.action}
        children={props.children}
      />
    </section>
  );
}
