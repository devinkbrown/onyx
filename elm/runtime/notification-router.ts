// SPDX-License-Identifier: AGPL-3.0-or-later
import { makeConversationId, makeNetworkId, makeOwnerRef, type AccountId, type ConversationId, type NetworkId, type OwnerRef, type OwnerSnapshot, type RuntimeFactoryContext } from './contracts';
import type { PrivateNotificationAdapter, PushPreviewPolicy } from './push-lifecycle';

export interface AllowedNotificationRoute {
  readonly schemaVersion: 1;
  readonly networkId: NetworkId;
  readonly ownerRef: OwnerRef | null;
  readonly bindingRef: string | null;
  readonly kind: 'dm' | 'mention' | 'call' | 'inbox';
  readonly conversationId: ConversationId | null;
}
export type RouteResult = 'opened' | 'authentication-required' | 'stale-owner' | 'unavailable' | 'invalid-route';
export interface NotificationPayload { readonly type: 'dm' | 'mention' | 'call'; readonly from: string; readonly text: string; readonly channel?: string }
export interface NotificationRouterDependencies extends Pick<RuntimeFactoryContext, 'ownerSnapshot' | 'isCurrent' | 'transport'> {
  readonly notifications: PrivateNotificationAdapter;
  readonly networkId: () => NetworkId | null;
  readonly applicationOrigin: string;
  readonly allowedApplicationPaths: readonly string[];
  readonly encodeApplicationRoute: (route: AllowedNotificationRoute) => string | null;
  readonly resolveBinding?: (payload: NotificationPayload) => { readonly networkId: NetworkId; readonly accountId: AccountId; readonly ownerRef: OwnerRef; readonly bindingRef: string } | null;
  readonly resolveBindingRef?: (bindingRef: string) => { readonly networkId: NetworkId; readonly accountId: AccountId } | null;
  readonly navigate?: (path: string) => Promise<boolean> | boolean;
  readonly previewPolicy?: () => PushPreviewPolicy;
  readonly hasPrivateConversation?: (owner: OwnerSnapshot, conversationId: ConversationId) => boolean;
}

const controls = /[\u0000-\u001f\u007f]/u;
function safePayload(value: unknown): NotificationPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const type = input.type;
  const required = type === 'mention' || type === 'call' ? ['channel', 'from', 'text', 'type'] : ['from', 'text', 'type'];
  if (!['dm', 'mention', 'call'].includes(String(type)) || Object.keys(input).sort().join(',') !== required.sort().join(',')) return null;
  if (typeof input.from !== 'string' || !input.from.trim() || input.from.length > 256 || new TextEncoder().encode(input.from).byteLength > 128 || controls.test(input.from)
    || typeof input.text !== 'string' || input.text.length > 640 || new TextEncoder().encode(input.text).byteLength > 240 || controls.test(input.text)) return null;
  if (typeof input.channel === 'string' && new TextEncoder().encode(input.channel).byteLength > 128) return null;
  const validTarget = (target: string, channel: boolean) => {
    const bytes = new TextEncoder().encode(target).byteLength;
    return bytes > 0 && bytes <= 128 && !controls.test(target) && !/[\s,!:]/u.test(target)
      && (channel ? target.startsWith('#') && target.length > 1 : !target.startsWith('#'));
  };
  if ((type === 'mention' || type === 'call') && (typeof input.channel !== 'string' || !validTarget(input.channel, true))) return null;
  if (type === 'dm' && !validTarget(input.from, false)) return null;
  return { type: type as NotificationPayload['type'], from: input.from, text: input.text, ...(typeof input.channel === 'string' ? { channel: input.channel } : {}) };
}

/** Decodes only the server's bounded push payload and produces in-app routes. */
export function createNotificationRouter(deps: NotificationRouterDependencies): {
  decode(payload: unknown): AllowedNotificationRoute | null;
  activate(route: AllowedNotificationRoute, owner: OwnerSnapshot): Promise<RouteResult>;
  dispose(): void;
} {
  let disposed = false;
  const decode = (value: unknown): AllowedNotificationRoute | null => {
    const payload = safePayload(value);
    if (!payload) return null;
    const binding = deps.resolveBinding?.(payload) ?? null;
    const networkId = binding?.networkId ?? deps.networkId();
    if (!networkId || !makeNetworkId(networkId)) return null;
    if (!binding || !binding.bindingRef || binding.bindingRef.length > 128) {
      return Object.freeze({ schemaVersion: 1, networkId, ownerRef: null, bindingRef: null, kind: 'inbox', conversationId: null });
    }
    const kind = payload.type;
    const target = kind === 'dm' ? payload.from : payload.channel;
    const conversationId = target ? makeConversationId(target) : null;
    if (kind !== 'dm' && !target || target && !conversationId) return null;
    const ownerRef = makeOwnerRef(binding.ownerRef);
    if (!ownerRef) return Object.freeze({ schemaVersion: 1, networkId, ownerRef: null, bindingRef: null, kind: 'inbox', conversationId: null });
    return Object.freeze({ schemaVersion: 1, networkId, ownerRef, bindingRef: binding.bindingRef, kind, conversationId });
  };
  const safeNavigationTarget = (path: string): string | null => {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || controls.test(path) || path.length > 2048) return null;
    try {
      const origin = new URL(deps.applicationOrigin).origin;
      const target = new URL(path, origin);
      if (target.origin !== origin || target.username || target.password || !deps.allowedApplicationPaths.includes(target.pathname)) return null;
      for (const key of new URLSearchParams(target.search).keys()) if (!['network', 'conversation', 'kind'].includes(key)) return null;
      return target.href;
    } catch { return null; }
  };
  const activate = async (route: AllowedNotificationRoute, owner: OwnerSnapshot): Promise<RouteResult> => {
    if (disposed) return 'unavailable';
    if (!route || route.schemaVersion !== 1 || !['dm', 'mention', 'call', 'inbox'].includes(route.kind)
      || (route.bindingRef !== null && (typeof route.bindingRef !== 'string' || route.bindingRef.length < 1 || route.bindingRef.length > 128))
      || (route.kind === 'inbox' ? route.conversationId !== null : typeof route.conversationId !== 'string')) return 'invalid-route';
    if (!deps.isCurrent(owner) || deps.ownerSnapshot().ownerRef !== owner.ownerRef) return 'stale-owner';
    const network = deps.networkId();
    const privateBinding = route.bindingRef ? deps.resolveBindingRef?.(route.bindingRef) ?? null : null;
    if (!network || network !== route.networkId || !owner.accountId || !privateBinding
      || privateBinding.networkId !== owner.networkId || privateBinding.accountId !== owner.accountId) {
      const inbox = { schemaVersion: 1 as const, networkId: network ?? route.networkId, ownerRef: null, bindingRef: null, kind: 'inbox' as const, conversationId: null };
      const path = safeNavigationTarget(deps.encodeApplicationRoute(inbox) ?? '');
      if (!path) return 'unavailable';
      const nav = deps.navigate ?? (async target => { window.location.assign(target); return true; });
      const moved = await nav(path);
      if (!deps.isCurrent(owner)) return 'stale-owner';
      return moved ? 'authentication-required' : 'unavailable';
    }
    if (!owner.accountId) return 'authentication-required';
    const target = route.conversationId;
    if (target && route.kind === 'dm' && deps.hasPrivateConversation && !deps.hasPrivateConversation(owner, target)) return 'unavailable';
    const scopedRoute = { ...route, ownerRef: owner.ownerRef, bindingRef: null };
    const path = safeNavigationTarget(deps.encodeApplicationRoute(scopedRoute) ?? '');
    if (!path) return 'invalid-route';
    const nav = deps.navigate ?? (async value => { window.location.assign(value); return true; });
    const moved = await nav(path);
    if (!deps.isCurrent(owner)) return 'stale-owner';
    return moved ? 'opened' : 'unavailable';
  };
  return { decode, activate, dispose() { disposed = true; } };
}

export function notificationCopy(payload: NotificationPayload, policy: PushPreviewPolicy): { title: string; body: string } {
  if (policy === 'private') return { title: 'Onyx notification', body: 'You have a new notification.' };
  const title = payload.type === 'call' ? `Call from ${payload.from}` : `${payload.from} sent a notification`;
  if (policy === 'sender-only' || payload.type === 'dm') return { title, body: 'Open Onyx to view it.' };
  return { title, body: payload.text.slice(0, 180) };
}
