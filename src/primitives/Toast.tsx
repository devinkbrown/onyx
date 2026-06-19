import { For, Show, splitProps, type JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Portal } from 'solid-js/web';

export type ToastIntent = 'info' | 'success' | 'warning' | 'danger';

export type ToastRecord = {
  id: string;
  title: string;
  description?: string;
  intent: ToastIntent;
  duration: number;
};

export type ToastInput = {
  title: string;
  description?: string;
  intent?: ToastIntent;
  duration?: number;
};

export type ToasterProps = JSX.HTMLAttributes<HTMLOListElement>;

const [toastStore, setToastStore] = createStore<{ items: ToastRecord[] }>({ items: [] });
let toastId = 0;

export const toasts = () => toastStore.items;

export function dismissToast(id: string) {
  setToastStore('items', (items) => items.filter((item) => item.id !== id));
}

export function clearToasts() {
  setToastStore('items', []);
}

export function toast(input: ToastInput) {
  const id = `ruri-toast-${++toastId}`;
  const item: ToastRecord = {
    id,
    title: input.title,
    description: input.description,
    intent: input.intent ?? 'info',
    duration: input.duration ?? 4000,
  };

  setToastStore('items', (items) => [...items, item]);

  if (Number.isFinite(item.duration) && item.duration > 0) {
    window.setTimeout(() => dismissToast(id), item.duration);
  }

  return id;
}

export function Toaster(props: ToasterProps) {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <Portal>
      <ol {...rest} class={['ruri-toaster', local.class].filter(Boolean).join(' ')} aria-live="polite" aria-label="Notifications">
        <For each={toastStore.items}>
          {(item) => (
            <li class={`ruri-toast ruri-toast--${item.intent}`} role={item.intent === 'danger' ? 'alert' : 'status'}>
              <div class="ruri-toast__body">
                <strong>{item.title}</strong>
                <Show when={item.description}>
                  <p>{item.description}</p>
                </Show>
              </div>
              <button type="button" aria-label={`Dismiss ${item.title}`} onClick={() => dismissToast(item.id)}>×</button>
            </li>
          )}
        </For>
      </ol>
    </Portal>
  );
}
