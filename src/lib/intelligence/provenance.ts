export type ProvenanceScope = 'device' | 'server' | 'external';

export interface ProvenanceLabel {
  scope: ProvenanceScope;
  label: string;
  description: string;
}

const LABELS: Record<ProvenanceScope, ProvenanceLabel> = {
  device: {
    scope: 'device',
    label: 'This device',
    description: 'Computed locally in this browser from loaded or saved Onyx data.',
  },
  server: {
    scope: 'server',
    label: 'This server',
    description: 'Computed by the connected Onyx/Orochi server from server-side history.',
  },
  external: {
    scope: 'external',
    label: 'External',
    description: 'Computed by an explicitly configured external endpoint.',
  },
};

export function provenanceLabel(scope: ProvenanceScope): ProvenanceLabel {
  return LABELS[scope];
}

export function provenanceAriaLabel(scope: ProvenanceScope, subject: string): string {
  const label = provenanceLabel(scope);
  return `${subject} provenance: ${label.label}. ${label.description}`;
}
