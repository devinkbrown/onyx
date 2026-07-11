// SPDX-License-Identifier: AGPL-3.0-or-later
import { Show, splitProps, type JSX } from 'solid-js';

export type FormFieldProps = JSX.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string;
  description?: string;
};

export function FormField(props: FormFieldProps) {
  const [local, rest] = splitProps(props, ['id', 'label', 'error', 'description', 'class']);
  const descriptionId = () => local.description ? `${local.id}-description` : undefined;
  const errorId = () => local.error ? `${local.id}-error` : undefined;
  const describedBy = () => [descriptionId(), errorId()].filter(Boolean).join(' ') || undefined;

  return (
    <div class={['onyx-field', local.class].filter(Boolean).join(' ')}>
      <label class="onyx-field__label" for={local.id}>{local.label}</label>
      <Show when={local.description}>
        <p class="onyx-field__description" id={descriptionId()}>{local.description}</p>
      </Show>
      <input
        {...rest}
        id={local.id}
        class="onyx-field__input"
        aria-invalid={local.error ? 'true' : undefined}
        aria-describedby={describedBy()}
      />
      <Show when={local.error}>
        <p class="onyx-field__error" id={errorId()}>{local.error}</p>
      </Show>
    </div>
  );
}
