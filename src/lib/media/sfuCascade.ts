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

export type SfuCascadeViewInput = {
  localSfu?: boolean;
  remoteForwarders?: number;
  packetLoss?: number;
  known?: boolean;
};

/**
 * Live metrics available from the Cadence media engine + room STATS surface.
 * All topology fields are optional: absent means "not advertised" — never
 * invent cascade hops from unrelated mesh link counts.
 */
export type SfuCascadeLiveMetrics = {
  /** True while the call lifecycle is active (in-call or ringing). */
  inCall: boolean;
  /** Engine is mounted and has produced at least one network sample. */
  engineReady?: boolean;
  /** Engine loss rate in [0, 1] when sampled. */
  packetLoss?: number | null;
  /**
   * Remote SFU forwarders from media-plane advertisement (room STATS).
   * null/undefined = not advertised yet.
   */
  remoteForwarders?: number | null;
  /**
   * Explicit local-SFU advertisement from the media plane.
   * null/undefined = not advertised.
   */
  localSfu?: boolean | null;
  /** True when room STATS (or topology subtype) arrived for this call channel. */
  roomStatsSeen?: boolean;
};

function finiteNonNegative(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Map live engine / room metrics onto `sfuCascadeView` inputs without inventing
 * cascade hops. Prefer `known: false` until the media plane is sampling or has
 * advertised topology.
 */
export function sfuCascadeLiveInput(metrics: SfuCascadeLiveMetrics): SfuCascadeViewInput {
  if (!metrics.inCall) {
    return { known: false };
  }

  const lossRaw = finiteNonNegative(metrics.packetLoss ?? null);
  const loss = lossRaw === null ? undefined : Math.min(1, lossRaw);
  const forwardersRaw = finiteNonNegative(metrics.remoteForwarders ?? null);

  if (forwardersRaw !== null) {
    const remoteForwarders = Math.floor(forwardersRaw);
    return {
      known: true,
      localSfu: remoteForwarders === 0,
      remoteForwarders,
      packetLoss: loss ?? 0,
    };
  }

  if (metrics.localSfu === true) {
    return {
      known: true,
      localSfu: true,
      remoteForwarders: 0,
      packetLoss: loss ?? 0,
    };
  }

  // In-call with engine samples or room STATS but no cascade advertisement:
  // honest local SFU path (single-node fanout). Do not invent remote hops.
  if (metrics.engineReady || metrics.roomStatsSeen) {
    return {
      known: true,
      localSfu: true,
      remoteForwarders: 0,
      packetLoss: loss ?? 0,
    };
  }

  return { known: false };
}

/** Convenience: live metrics → cascade view in one step. */
export function sfuCascadeFromLive(metrics: SfuCascadeLiveMetrics): SfuCascadeView {
  return sfuCascadeView(sfuCascadeLiveInput(metrics));
}

export function sfuCascadeView(input: SfuCascadeViewInput): SfuCascadeView {
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
      label: `Network relay · ${forwarders + 1} hops`,
      detail: `Relayed through ${forwarders} remote SFU forwarder(s).`,
    };
  }
  if (input.localSfu) {
    return {
      mode: 'local',
      hops: 1,
      label: 'Local SFU',
      detail: 'All media stays on this network node.',
    };
  }
  return {
    mode: 'unknown',
    hops: 0,
    label: 'SFU path unknown',
    detail: 'No SFU topology advertised yet.',
  };
}
