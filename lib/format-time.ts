export type TimeFormat = '12h' | '24h' | 'hidden';

const FMT_12H = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
const FMT_24H = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

export function formatMessageTime(date: Date, format: TimeFormat): string {
  if (format === 'hidden') return '';
  if (format === '12h') return FMT_12H.format(date);
  return FMT_24H.format(date);
}
