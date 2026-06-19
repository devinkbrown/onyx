import { createSignal, onCleanup, type Accessor } from 'solid-js';

import { store, type State } from './store';

export type EqualityFn<T> = (a: T, b: T) => boolean;

export function useStore<T>(
  selector: (s: State) => T,
  equals?: EqualityFn<T>,
): Accessor<T> {
  const [value, setValue] = createSignal(selector(store.getState()), { equals });

  const unsubscribe = store.subscribe(
    selector,
    (next) => {
      setValue(() => next);
    },
    { equalityFn: equals },
  );

  onCleanup(unsubscribe);

  return value;
}

export { store } from './store';

export const getState = store.getState;
export const setState = store.setState;
export const subscribe = store.subscribe;
