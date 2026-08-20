// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * index.ts — public exports for the icon system.
 *
 * Exports:
 * - Icon: main component
 * - IconProps, IconSymbol, IconSize: types
 * - All symbol functions: MenuIcon, CloseIcon, etc. (for direct use if needed)
 */

export { Icon, type IconProps, type IconSize, type IconSymbol } from './Icon';
export {
  ArrowIcon,
  CheckIcon,
  CloseIcon,
  ExternalIcon,
  InfoIcon,
  LocalIcon,
  MenuIcon,
  ReconnectIcon,
  UnknownIcon,
  WarningIcon,
  type IconSymbolProps,
} from './symbols';
