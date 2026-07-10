export const AI_POLICY_PROP = 'ai-policy';

export type AiPolicy = 'open' | 'no-ai' | 'local-only';

const POLICY_VALUES: readonly AiPolicy[] = ['open', 'no-ai', 'local-only'];

function cleanPolicyValue(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

export function parseAiPolicyProp(value: string): AiPolicy {
  const clean = cleanPolicyValue(value);
  if (POLICY_VALUES.includes(clean as AiPolicy)) return clean as AiPolicy;
  if (clean === 'none' || clean === 'off' || clean === 'disabled' || clean === 'blocked') return 'no-ai';
  if (clean === 'local' || clean === 'local-ai') return 'local-only';
  return 'open';
}

export function aiPolicyAllowsLocal(policy: AiPolicy): boolean {
  return policy === 'open' || policy === 'local-only';
}

export function aiPolicyAllowsExternal(policy: AiPolicy): boolean {
  return policy === 'open';
}
