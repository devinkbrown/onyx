export type WatchTogetherState = 'playing' | 'paused' | 'seeking' | 'handoff' | 'idle';

export type WatchTogetherActivity = {
  title: string;
  url: string | null;
  host: string | null;
  state: WatchTogetherState;
  positionSeconds: number | null;
  durationSeconds: number | null;
  participants: string[];
  handoffTo: string | null;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function parseSeconds(value: string | null | undefined): number | null {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function parseState(value: string | null | undefined): WatchTogetherState {
  const normalized = clean(value)?.toLowerCase();
  if (normalized === 'playing' || normalized === 'paused' || normalized === 'seeking' || normalized === 'handoff') {
    return normalized;
  }
  return 'idle';
}

export function formatWatchClock(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function watchTogetherStateLabel(activity: WatchTogetherActivity): string {
  const at = activity.positionSeconds === null ? '' : ` ${formatWatchClock(activity.positionSeconds)}`;
  if (activity.state === 'playing') return `Playing${at}`;
  if (activity.state === 'paused') return `Paused${at}`;
  if (activity.state === 'seeking') return `Seeking${at}`;
  if (activity.state === 'handoff') {
    return activity.handoffTo ? `Handoff to ${activity.handoffTo}` : 'Handoff ready';
  }
  return activity.positionSeconds === null ? 'Ready' : `Ready ${formatWatchClock(activity.positionSeconds)}`;
}

export function parseWatchTogetherProp(raw: string | null | undefined): WatchTogetherActivity | null {
  const source = clean(raw);
  if (!source) return null;

  const params = new URLSearchParams(source.replace(/;/g, '&'));
  const title = clean(params.get('title'));
  const url = clean(params.get('url'));
  if (!title && !url) return null;

  const participants = (params.get('participants') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    title: title ?? url ?? 'Watch together',
    url,
    host: clean(params.get('host')),
    state: parseState(params.get('state')),
    positionSeconds: parseSeconds(params.get('position')),
    durationSeconds: parseSeconds(params.get('duration')),
    participants,
    handoffTo: clean(params.get('handoff')),
  };
}
