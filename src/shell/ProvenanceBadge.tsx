import type { JSX } from 'solid-js';
import {
  provenanceAriaLabel,
  provenanceLabel,
  type ProvenanceScope,
} from '@/lib/intelligence/provenance';
import './ProvenanceBadge.css';

export function ProvenanceBadge(props: {
  scope: ProvenanceScope;
  subject: string;
  class?: string;
}): JSX.Element {
  const label = () => provenanceLabel(props.scope);
  return (
    <span
      class={['provenance-badge', props.class].filter(Boolean).join(' ')}
      data-scope={props.scope}
      aria-label={provenanceAriaLabel(props.scope, props.subject)}
      title={label().description}
    >
      {label().label}
    </span>
  );
}
