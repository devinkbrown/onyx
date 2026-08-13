// SPDX-License-Identifier: AGPL-3.0-or-later
import { Show, createMemo, type JSX } from 'solid-js';
import '../tokens/index.css';
import './proof-rail.css';
import { getProofStateCopy } from './copy';
import type { ProofAction, ProofReceiptProps } from './types';

function materializeAction(action: ProofAction | undefined): JSX.Element | undefined {
  if (typeof action === 'function') return action();
  return action;
}

export function ProofReceipt(props: ProofReceiptProps): JSX.Element {
  const copy = createMemo(() => getProofStateCopy(props.state));
  const detail = createMemo(() => props.detail?.trim() || copy().detail);
  const action = createMemo(() => materializeAction(props.action ?? props.children));

  return (
    <div
      class={['ui-proof-receipt', props.class].filter(Boolean).join(' ')}
      data-ui="proof-receipt"
      data-ui-truth={props.state}
      role="group"
      aria-label={props.label}
    >
      <div class="ui-proof-receipt__state-wrap">
        <span
          class="ui-proof-receipt__state"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span class="ui-proof-receipt__glyph" aria-hidden="true">
            {copy().glyph}
          </span>
          <span class="ui-proof-receipt__state-label">{copy().label}</span>
        </span>
      </div>

      <div class="ui-proof-receipt__content">
        <p class="ui-proof-receipt__label">{props.label}</p>
        <p class="ui-proof-receipt__detail">{detail()}</p>
        <Show when={props.evidenceType?.trim()}>
          <div class="ui-proof-receipt__evidence" aria-label="Evidence type">
            <span class="ui-proof-receipt__evidence-label">Evidence type</span>
            <span class="ui-proof-receipt__evidence-type">{props.evidenceType}</span>
          </div>
        </Show>
      </div>

      <Show when={action()}>
        {(suppliedAction) => <div class="ui-proof-receipt__action">{suppliedAction()}</div>}
      </Show>
    </div>
  );
}
