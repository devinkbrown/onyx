// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Declarative information architecture for the authenticated shell.
 *
 * This deliberately receives only presentation navigation state. Connection,
 * account, permission, encryption, and call state remain outside this model;
 * a navigation label must not imply any of those facts.
 */

export type ShellNavigationId = 'home' | 'rooms' | 'messages' | 'calls' | 'you';
export type ShellLocationId = Exclude<ShellNavigationId, 'you'>;
export type ShellCollectionId = Extract<ShellNavigationId, 'rooms' | 'messages'>;
export type ShellNavigationVariant = 'desktop' | 'mobile';

export type ShellNavigationInput = {
  variant: ShellNavigationVariant;
  current?: ShellLocationId | null;
  selectedCollection?: ShellCollectionId | null;
  expandedCollection?: ShellCollectionId | null;
  youDialogOpen?: boolean;
};

export type ShellNavigationItem = {
  id: ShellNavigationId;
  label: 'Home' | 'Rooms' | 'Messages' | 'Calls' | 'You';
  landmarkLabel: 'Primary' | 'Mobile navigation';
  actionLabel: string;
  current: boolean;
  selected: boolean;
  expanded?: boolean;
  hasPopup?: 'dialog';
};

const SHELL_NAVIGATION = [
  { id: 'home', label: 'Home' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'messages', label: 'Messages' },
  { id: 'calls', label: 'Calls' },
  { id: 'you', label: 'You' },
] as const;

function isCollection(id: ShellNavigationId): id is ShellCollectionId {
  return id === 'rooms' || id === 'messages';
}

/** Builds one responsive navigation model without mutating or reading global state. */
export function createShellNavigationModel(input: ShellNavigationInput): readonly ShellNavigationItem[] {
  const landmarkLabel = input.variant === 'mobile' ? 'Mobile navigation' : 'Primary';

  return SHELL_NAVIGATION.map((definition): ShellNavigationItem => {
    const collection = isCollection(definition.id);
    const item: ShellNavigationItem = {
      id: definition.id,
      label: definition.label,
      landmarkLabel,
      actionLabel: input.variant === 'mobile' ? `Open ${definition.label}` : definition.label,
      current: input.current === definition.id,
      selected: collection && input.selectedCollection === definition.id,
    };

    if (collection && input.expandedCollection !== undefined) {
      item.expanded = input.expandedCollection === definition.id;
    }
    if (definition.id === 'you') {
      if (input.youDialogOpen !== undefined) item.expanded = input.youDialogOpen;
      item.hasPopup = 'dialog';
    }
    return item;
  });
}
