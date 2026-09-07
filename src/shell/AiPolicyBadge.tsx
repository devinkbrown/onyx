// SPDX-License-Identifier: AGPL-3.0-or-later
import { createMemo, Show, type JSX } from 'solid-js';
import type { AiPolicy } from '@/lib/irc/aiPolicyProp';
import './ProvenanceBadge.css';

export function aiPolicyBadgeText(policy: AiPolicy): { label: string; description: string; scope: 'server' | 'external' } {
  if (policy === 'open') {
    return {
      label: 'AI allowed',
      description: 'AI features are allowed in this room. Check each feature for its destination and permissions.',
      scope: 'server',
    };
  }
  if (policy === 'no-ai') {
    return {
      label: 'No AI',
      description: 'AI features are disabled in this room. Nothing is sent to an AI service from this room.',
      scope: 'external',
    };
  }
  return {
    label: 'Local only',
    description: 'Only AI that runs on this device is allowed in this room. External AI services are not allowed.',
    scope: 'server',
  };
}

export function AiPolicyBadge(props: {
  policy: AiPolicy;
  channel: string;
  class?: string;
}): JSX.Element {
  const meta = createMemo(() => aiPolicyBadgeText(props.policy));

  return (
    <Show when={props.policy !== 'open'}>
      <span
        class={['provenance-badge', props.class].filter(Boolean).join(' ')}
        data-scope={meta().scope}
        aria-label={`AI policy for ${props.channel}: ${meta().description}`}
        title={meta().description}
      >
        {meta().label}
      </span>
    </Show>
  );
}
