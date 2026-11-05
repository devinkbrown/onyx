export interface PrivateWebhookReply {
  readonly room: string;
  readonly url: string;
}

/** Source-bound parser for the one-time WEBHOOK CREATE NOTICE. */
export function isWebhookCreationReply(body: string): boolean {
  return /^WEBHOOK:\s+created\s+for\b/u.test(body);
}

export function parseWebhookCreationReply(body: string): PrivateWebhookReply | null {
  if (new TextEncoder().encode(body).byteLength > 8192 || /[\u0000-\u001f\u007f]/u.test(body)) return null;
  const match = /^WEBHOOK:\s+created\s+for\s+(\S+)\s+—\s+POST\s+Discord webhook JSON to\s+(https:\/\/[^\s]+)$/u.exec(body);
  if (!match?.[1] || !match[2] || match[2].length > 4096) return null;
  let url: URL;
  try { url = new URL(match[2]); } catch { return null; }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) return null;
  return { room: match[1], url: match[2] };
}
