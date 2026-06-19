export { Spotlight, default } from './Spotlight';
export type { SpotlightProps } from './Spotlight';
export {
  SpotlightProvider,
  closeSpotlight,
  openSpotlight,
  toggleSpotlight,
  useSpotlight,
  useSpotlightHotkeys,
} from './useSpotlight';
export { buildCommands, useCommands } from './commands';
export type { SpotlightCommand, SpotlightSection } from './commands';
export { fuzzyFilter, fuzzyMatch } from './fuzzy';
export type { FuzzyMatch, FuzzyResult, HighlightRange } from './fuzzy';
