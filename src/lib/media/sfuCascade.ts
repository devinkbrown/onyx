// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * sfuCascade.ts — Era 3 C8 mesh SFU cascade indicator model.
 *
 * Pure UX state for "is this room local-only or cascading across mesh nodes?"
 * so the Stage/Voice chrome can show an honest hop badge without inventing
 * media plane behavior.
 */

export type SfuCascadeMode = 'local' | 'cascade' | 'degraded' | 'unknown';

export type SfuCascadeView = {
  mode: SfuCascadeMode;
  hops: number;
  label: string;
  detail: string;
};

export function sfuCascadeView(input: {
  localSfu?: boolean;
  remoteForwarders?: number;
  packetLoss?: number;
  known?: boolean;
}): SfuCascadeView {
  if (input.known === false) {
    return {
      mode: 'unknown',
      hops: 0,
      label: 'SFU path unknown',
      detail: 'Waiting for media plane topology.',
    };
  }
  const forwarders = Math.max(0, Math.floor(input.remoteForwarders ?? 0));
  const loss = input.packetLoss ?? 0;
  if (loss >= 0.15) {
    return {
      mode: 'degraded',
      hops: forwarders + 1,
      label: 'Media path degraded',
      detail: `High loss (${Math.round(loss * 100)}%) across ${forwarders + 1} hop(s).`,
    };
  }
  if (forwarders > 0) {
    return {
      mode: 'cascade',
      hops: forwarders + 1,
      label: `Mesh cascade · ${forwarders + 1} hops`,
      detail: `Relayed through ${forwarders} remote SFU forwarder(s).`,
    };
  }
  if (input.localSfu) {
    return {
      mode: 'local',
      hops: 1,
      label: 'Local SFU',
      detail: 'All media stays on this mesh node.',
    };
  }
  return {
    mode: 'unknown',
    hops: 0,
    label: 'SFU path unknown',
    detail: 'No SFU topology advertised yet.',
  };
}
