// SPDX-License-Identifier: AGPL-3.0-or-later
export {
  DEFAULT_ROUTE_ANNOUNCER_CLASS,
  DEFAULT_ROUTE_ANNOUNCER_LABEL,
  ROUTE_ANNOUNCER_POLITENESS,
  RouteAnnouncer,
  formatRouteAnnouncement,
  isRouteTitleThenable,
  normalizeRouteTitle,
  resolveRouteAnnouncerPoliteness,
  shouldAnnounceRouteChange,
} from './RouteAnnouncer';
export type {
  RouteAnnouncerPoliteness,
  RouteAnnouncerProps,
  RouteTitleInput,
} from './RouteAnnouncer';
export {
  DEFAULT_SKIP_LINK_SET_LABEL,
  SkipLinkSet,
  isValidSkipTargetId,
  normalizeSkipTargetId,
  normalizeSkipTargets,
} from './SkipLinkSet';
export type {
  NormalizedSkipTarget,
  SkipLinkSetProps,
  SkipLinkTarget,
} from './SkipLinkSet';
export { RouteLifecycleRoot } from './RouteLifecycleRoot';
export {
  ROUTE_LIFECYCLE_APP_LABEL,
  ROUTE_LIFECYCLE_MAP,
  normalizeRouteLifecyclePath,
  resolveRouteLifecycleEntry,
  resolveRouteLifecycleIdentity,
  resolveRouteLifecycleLabel,
} from './RouteLifecycle';
export type {
  RouteLifecycleEntry,
  RouteLifecycleId,
} from './RouteLifecycle';
