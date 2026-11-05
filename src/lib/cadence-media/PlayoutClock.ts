// SPDX-License-Identifier: AGPL-3.0-or-later
export interface PlayoutDecision { readonly action: 'schedule' | 'drop'; readonly at: number; readonly underrun: boolean; readonly late: boolean; readonly queuedFrames: number }

/** Bounded 20ms audio playout clock; prevents unbounded future scheduling. */
export class BoundedPlayoutClock {
  private nextAt = 0;
  private queued = 0;
  private _underruns = 0;
  private _late = 0;
  private _dropped = 0;
  constructor(private readonly maxFrames = 12, private readonly targetLeadSeconds = 0.04, private readonly maxLeadSeconds = 0.24) {}
  enqueue(now: number, duration: number): PlayoutDecision {
    if (!Number.isFinite(now) || !Number.isFinite(duration) || duration <= 0) { this._dropped++; return { action: 'drop', at: now, underrun: false, late: true, queuedFrames: this.queued }; }
    if (this.queued >= this.maxFrames) { this._dropped++; return { action: 'drop', at: now, underrun: false, late: true, queuedFrames: this.queued }; }
    const underrun = this.nextAt > 0 && this.nextAt < now;
    const late = this.nextAt > 0 && now - this.nextAt > duration * 2;
    if (underrun) this._underruns++;
    if (late) this._late++;
    const at = Math.max(now + this.targetLeadSeconds, this.nextAt);
    if (at - now > this.maxLeadSeconds) { this._dropped++; return { action: 'drop', at, underrun, late, queuedFrames: this.queued }; }
    this.nextAt = at + duration;
    this.queued++;
    return { action: 'schedule', at, underrun, late, queuedFrames: this.queued };
  }
  complete(): void { this.queued = Math.max(0, this.queued - 1); }
  reset(): void { this.nextAt = 0; this.queued = 0; }
  snapshot() { return { underruns: this._underruns, late: this._late, dropped: this._dropped, queued: this.queued }; }
}
