// SPDX-License-Identifier: AGPL-3.0-or-later
import type { DesktopNotificationPermission } from './decision';

export interface DesktopNotificationPayload {
  title: string;
  body: string;
  tag: string;
  onClick: () => void;
}

export interface DesktopNotificationHandle {
  close(): void;
}

let audioContext: AudioContext | null = null;

export function getDesktopNotificationPermission(): DesktopNotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission;
}

export async function requestDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return await window.Notification.requestPermission();
}

export function showDesktopNotification(payload: DesktopNotificationPayload): DesktopNotificationHandle | null {
  if (getDesktopNotificationPermission() !== 'granted') return null;

  const notification = new window.Notification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    silent: true,
  });

  notification.onclick = () => {
    payload.onClick();
    notification.close();
  };

  return { close: () => notification.close() };
}

export function playNotificationBeep(volume: number): void {
  if (typeof window === 'undefined') return;
  const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextCtor) return;

  audioContext ??= new AudioContextCtor();
  const ctx = audioContext;
  const safeVolume = Math.max(0, Math.min(1, volume));
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(660, now + 0.12);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, safeVolume * 0.16), now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.18);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
