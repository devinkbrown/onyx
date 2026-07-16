// SPDX-License-Identifier: AGPL-3.0-or-later
/** Reactive browser reduced-data preference, with Network Information fallback. */
import { createMemo, createSignal, getOwner, onCleanup, type Accessor } from 'solid-js';

import { makeMediaSignal } from './mediaPrefs';

const REDUCED_DATA_QUERY = '(prefers-reduced-data: reduce)';
const STATIC_FALSE: Accessor<boolean> = () => false;

type DataConnection = {
  readonly saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
};

type DataNavigator = Navigator & { readonly connection?: DataConnection };

function connection(): DataConnection | undefined {
  if (typeof navigator === 'undefined') return undefined;
  try {
    return (navigator as DataNavigator).connection;
  } catch {
    return undefined;
  }
}

function readSaveData(value: DataConnection): boolean {
  try {
    return value.saveData === true;
  } catch {
    return false;
  }
}

export function makeSaveDataSignal(): Accessor<boolean> {
  const value = connection();
  if (!value) return STATIC_FALSE;
  const [saveData, setSaveData] = createSignal(readSaveData(value));
  const sync = (): void => {
    setSaveData(readSaveData(value));
  };
  try {
    value.addEventListener?.('change', sync);
    if (getOwner()) onCleanup(() => value.removeEventListener?.('change', sync));
  } catch {
    // Advisory capability only; retain the safely-read initial value.
  }
  return saveData;
}

/** Combines the standards media query and Chromium-style Network Information hint. */
export function makeReducedDataSignal(): Accessor<boolean> {
  const media = makeMediaSignal(REDUCED_DATA_QUERY);
  const network = makeSaveDataSignal();
  const reducedData = createMemo(() => media() || network());
  return reducedData;
}
