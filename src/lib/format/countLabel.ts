/**
 * countLabel — pluralize a counted noun for human-facing status text.
 * `countLabel(1, 'message') === '1 message'`, `countLabel(3, 'message') === '3 messages'`.
 */
export function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}
