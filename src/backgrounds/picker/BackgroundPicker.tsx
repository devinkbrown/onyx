// SPDX-License-Identifier: AGPL-3.0-or-later
import { createEffect, For, onCleanup, type Accessor, type JSX } from 'solid-js';
import { backgroundOptions } from '../catalogue';
import { AUTO_BACKGROUND_ID } from '@/shell/themeBackground';
import './background-picker.css';

export const BACKGROUND_PREVIEW_DELAY_MS = 160;

type PickerOption = (typeof backgroundOptions)[number] | {
  id: typeof AUTO_BACKGROUND_ID;
  label: string;
  kind: 'auto';
  character: string;
  detail: 'low';
};

const AUTO_OPTION: PickerOption = { id: AUTO_BACKGROUND_ID, label: 'Match my theme', kind: 'auto', character: 'theme signature', detail: 'low' };
const GROUPS: readonly { label: string; options: readonly PickerOption[] }[] = [
  { label: 'Match my theme', options: [AUTO_OPTION] },
  { label: 'Living ambient', options: backgroundOptions.filter((item) => item.kind === 'animated') },
  { label: 'Quiet stills', options: backgroundOptions.filter((item) => item.kind === 'solid') },
  { label: 'Featured scenes', options: backgroundOptions.filter((item) => item.kind === 'scene').slice(0, 4) },
  { label: 'More presets', options: backgroundOptions.filter((item) => item.kind === 'scene').slice(4) },
];

export interface BackgroundPickerProps {
  value: Accessor<string>;
  onSelect: (id: string) => void;
  onPreview?: (id: string | null) => void;
  immediate?: boolean;
  label?: string;
}

export function BackgroundPicker(props: BackgroundPickerProps): JSX.Element {
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let touchGesture = false;
  const cancelPreview = () => {
    if (previewTimer !== undefined) clearTimeout(previewTimer);
    previewTimer = undefined;
  };
  const schedulePreview = (id: string) => {
    cancelPreview();
    previewTimer = setTimeout(() => props.onPreview?.(id), BACKGROUND_PREVIEW_DELAY_MS);
  };
  const clearPreview = () => {
    cancelPreview();
    props.onPreview?.(null);
  };
  const moveRadio = (event: KeyboardEvent): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const current = event.currentTarget as HTMLButtonElement;
    const group = current.closest<HTMLElement>('.background-picker');
    const radios = group ? [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')] : [];
    const index = radios.indexOf(current);
    if (index < 0 || radios.length === 0) return;
    event.preventDefault();
    const targetIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? radios.length - 1
        : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + radios.length) % radios.length;
    const target = radios[targetIndex];
    target?.focus();
    target?.click();
  };
  createEffect(() => props.value());
  onCleanup(clearPreview);

  return (
    <div class="background-picker" role="radiogroup" aria-label={props.label ?? 'Background'}>
      <For each={GROUPS}>
        {(group) => (
          <section class="background-picker__group" aria-label={group.label}>
            <h3 class="background-picker__heading">{group.label}</h3>
            <div class="background-picker__grid">
              <For each={group.options}>
                {(option) => {
                  const active = () => props.value() === option.id;
                  return <button
                    type="button"
                    class="background-picker__card"
                    classList={{ 'background-picker__card--selected': active() }}
                    role="radio"
                    aria-checked={active()}
                    tabIndex={active() ? 0 : -1}
                    aria-label={option.kind === 'auto' ? 'Auto — theme-matched background' : `${option.label}, ${option.kind}, ${option.character}, ${option.detail} detail`}
                    data-background-id={option.id}
                    data-kind={option.kind}
                    data-detail={option.detail}
                    style={{ 'min-height': '44px', 'touch-action': 'manipulation' }}
                    onPointerDown={(event) => { touchGesture = event.pointerType === 'touch'; }}
                    onPointerUp={() => { touchGesture = false; }}
                    onPointerCancel={() => { touchGesture = false; clearPreview(); }}
                    onPointerEnter={(event) => { if (event.pointerType !== 'touch') schedulePreview(option.id); }}
                    onPointerLeave={() => clearPreview()}
                    onFocus={() => { if (!touchGesture) schedulePreview(option.id); }}
                    onBlur={clearPreview}
                    onKeyDown={moveRadio}
                    onClick={() => { touchGesture = false; clearPreview(); props.onSelect(option.id); }}
                  >
                    <span class="background-picker__swatch" aria-hidden="true"><i /><i /><i /></span>
                    <span class="background-picker__copy"><b>{option.label}</b><small>{option.character}</small></span>
                    <span class="background-picker__meta">{option.kind === 'auto' ? 'auto' : `${option.kind} · ${option.detail}`}</span>
                  </button>;
                }}
              </For>
            </div>
          </section>
        )}
      </For>
    </div>
  );
}
