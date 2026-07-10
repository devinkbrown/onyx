import { createMemo, Show, type JSX } from 'solid-js';
import type { AiPolicy } from '@/lib/irc/aiPolicyProp';
import './ProvenanceBadge.css';

export function aiPolicyBadgeText(policy: AiPolicy): { label: string; description: string; scope: 'server' | 'external' } {
  if (policy === 'open') {
    return {
      label: 'AI open',
      description: 'AI surfaces are allowed for this room.',
      scope: 'server',
    };
  }
  if (policy === 'no-ai') {
    return {
      label: 'No AI',
      description: 'AI surfaces are disabled for this room.',
      scope: 'external',
    };
  }
  return {
    label: 'Local only',
    description: 'Only local AI surfaces are allowed for this room.',
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
