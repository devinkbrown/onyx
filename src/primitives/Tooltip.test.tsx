// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from './Tooltip';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Tooltip', () => {
  it('shows tooltip content on focus after the configured delay', () => {
    vi.useFakeTimers();
    render(() => (
      <Tooltip content="Shows channel details" openDelay={50}>
        <button type="button">Details</button>
      </Tooltip>
    ));

    const trigger = screen.getByRole('button', { name: 'Details' });
    fireEvent.focusIn(trigger);
    vi.advanceTimersByTime(50);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe('Shows channel details');
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('hides on Escape and does not render when disabled', () => {
    vi.useFakeTimers();
    render(() => (
      <Tooltip content="Hidden detail" disabled>
        <button type="button">Hidden</button>
      </Tooltip>
    ));

    const trigger = screen.getByRole('button', { name: 'Hidden' });
    fireEvent.focusIn(trigger);
    vi.advanceTimersByTime(120);
    fireEvent.keyDown(trigger, { key: 'Escape' });

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('stays open until both pointer hover and keyboard focus leave', () => {
    vi.useFakeTimers();
    render(() => (
      <Tooltip content="Mixed-input help" openDelay={20}>
        <button type="button">Mixed input</button>
      </Tooltip>
    ));
    const trigger = screen.getByRole('button', { name: 'Mixed input' });
    const root = trigger.closest('.onyx-tooltip');
    expect(root).not.toBeNull();

    fireEvent.pointerEnter(root!, { pointerType: 'mouse' });
    fireEvent.focusIn(trigger);
    vi.advanceTimersByTime(20);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.pointerLeave(root!, { pointerType: 'mouse' });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.focusOut(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not let a pending timer outlive a reactive disabled state', () => {
    vi.useFakeTimers();
    let setDisabled!: (disabled: boolean) => void;
    function Harness() {
      const [disabled, setDisabledSignal] = createSignal(false);
      setDisabled = setDisabledSignal;
      return (
        <Tooltip content="Reactive help" openDelay={100} disabled={disabled()}>
          <button type="button">Reactive trigger</button>
        </Tooltip>
      );
    }
    render(() => <Harness />);
    const trigger = screen.getByRole('button', { name: 'Reactive trigger' });

    fireEvent.focusIn(trigger);
    vi.advanceTimersByTime(50);
    setDisabled(true);
    vi.advanceTimersByTime(100);
    expect(screen.queryByRole('tooltip')).toBeNull();

    setDisabled(false);
    vi.advanceTimersByTime(100);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    setDisabled(true);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });

  it('drops a pending tooltip when its interactive trigger is detached', () => {
    vi.useFakeTimers();
    let removeTrigger!: () => void;
    function Harness() {
      const [present, setPresent] = createSignal(true);
      removeTrigger = () => setPresent(false);
      return (
        <Tooltip content="Detached help" openDelay={100}>
          <Show when={present()}>
            <button type="button">Temporary trigger</button>
          </Show>
        </Tooltip>
      );
    }
    render(() => <Harness />);
    const trigger = screen.getByRole('button', { name: 'Temporary trigger' });
    fireEvent.focusIn(trigger);

    removeTrigger();
    vi.advanceTimersByTime(100);

    expect(trigger.isConnected).toBe(false);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('dismisses a hovered tooltip from document Escape until interaction ends', () => {
    vi.useFakeTimers();
    render(() => (
      <Tooltip content="Hover help" openDelay={0}>
        <button type="button">Hover trigger</button>
      </Tooltip>
    ));
    const trigger = screen.getByRole('button', { name: 'Hover trigger' });
    const root = trigger.closest('.onyx-tooltip');
    expect(root).not.toBeNull();
    fireEvent.pointerEnter(root!, { pointerType: 'mouse' });
    vi.runAllTimers();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    vi.runAllTimers();
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.pointerLeave(root!, { pointerType: 'mouse' });
    fireEvent.pointerEnter(root!, { pointerType: 'mouse' });
    vi.runAllTimers();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('stays open when an input method or earlier handler owns Escape', () => {
    vi.useFakeTimers();
    render(() => (
      <Tooltip content="Owned help" openDelay={0}>
        <button type="button">Owned trigger</button>
      </Tooltip>
    ));
    const trigger = screen.getByRole('button', { name: 'Owned trigger' });
    fireEvent.focusIn(trigger);
    vi.runAllTimers();

    fireEvent.keyDown(trigger, { key: 'Escape', isComposing: true });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    const claimed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    claimed.preventDefault();
    trigger.dispatchEvent(claimed);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('ignores touch hover and describes a nested interactive trigger', () => {
    vi.useFakeTimers();
    render(() => (
      <Tooltip content="Nested help" openDelay={10}>
        <span><button type="button">Nested trigger</button></span>
      </Tooltip>
    ));
    const trigger = screen.getByRole('button', { name: 'Nested trigger' });
    const root = trigger.closest('.onyx-tooltip');
    expect(root).not.toBeNull();

    fireEvent.pointerEnter(root!, { pointerType: 'touch' });
    vi.advanceTimersByTime(20);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focusIn(trigger);
    vi.advanceTimersByTime(10);
    const tooltip = screen.getByRole('tooltip');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
  });
});
