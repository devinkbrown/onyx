// SPDX-License-Identifier: AGPL-3.0-or-later
import { createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { FormField } from './FormField';
import { Popover } from './Popover';
import { Tabs } from './Tabs';
import { Tooltip } from './Tooltip';
import { Toaster, clearToasts, toast, toasts } from './Toast';

afterEach(() => {
  cleanup();
  clearToasts();
  vi.useRealTimers();
});

beforeEach(clearToasts);

describe('Button boundary behavior', () => {
  it('does not call click handlers for a disabled native button', () => {
    const onClick = vi.fn();
    render(() => (
      <Button disabled onClick={onClick}>
        Cannot send
      </Button>
    ));

    const button = screen.getByRole('button', { name: 'Cannot send' }) as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: ' ' });

    expect(button.disabled).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('lets consumer keyboard handlers cancel synthetic activation', () => {
    const onClick = vi.fn();
    const onKeyDown = vi.fn((event: KeyboardEvent) => event.preventDefault());
    render(() => (
      <Button onClick={onClick} onKeyDown={onKeyDown}>
        Guarded action
      </Button>
    ));

    const button = screen.getByRole('button', { name: 'Guarded action' });
    fireEvent.keyDown(button, { key: 'Enter' });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('FormField aria boundaries', () => {
  it('omits descriptive aria when description and error are empty', () => {
    render(() => <FormField id="invite" label="Invite code" value="" />);

    const input = screen.getByRole('textbox', { name: 'Invite code' });

    expect(input.getAttribute('aria-describedby')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('preserves disabled control semantics while keeping the label association', () => {
    render(() => <FormField id="locked-nick" label="Locked nick" disabled value="root" />);

    const input = screen.getByRole('textbox', { name: 'Locked nick' }) as HTMLInputElement;

    expect(input.disabled).toBe(true);
    expect(input.value).toBe('root');
  });
});

describe('Popover controlled and empty states', () => {
  it('requests a controlled open change without showing content until the prop changes', () => {
    const onOpenChange = vi.fn();
    render(() => (
      <Popover trigger="Actions" open={false} onOpenChange={onOpenChange} panelLabel="Room actions">
        <button type="button">Invite</button>
      </Popover>
    ));

    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(trigger);

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull();
  });

  it('keeps dialog labelling and hidden state in sync when a parent controls it', () => {
    function Harness() {
      const [open, setOpen] = createSignal(false);
      return (
        <Popover trigger="Details" open={open()} onOpenChange={setOpen} panelLabel="Channel details">
          Empty state
        </Popover>
      );
    }

    render(() => <Harness />);

    const trigger = screen.getByRole('button', { name: 'Details' });
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Channel details' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(dialog.id);
    expect(dialog.hidden).toBe(false);
    expect(dialog.textContent).toContain('Empty state');
  });
});

describe('Tabs controlled and keyboard boundaries', () => {
  it('uses controlled value without mutating selection on click', () => {
    const onValueChange = vi.fn();
    render(() => (
      <Tabs value="overview" onValueChange={onValueChange}>
        <Tabs.List>
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="members">Members</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="overview">Overview panel</Tabs.Content>
        <Tabs.Content value="members">Members panel</Tabs.Content>
      </Tabs>
    ));

    const overview = screen.getByRole('tab', { name: 'Overview' });
    const members = screen.getByRole('tab', { name: 'Members' });
    fireEvent.click(members);

    expect(onValueChange).toHaveBeenCalledWith('members');
    expect(overview.getAttribute('aria-selected')).toBe('true');
    expect(members.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tabpanel', { name: 'Overview' }).hidden).toBe(false);
  });

  it('uses vertical arrow keys and skips disabled tabs', () => {
    render(() => (
      <Tabs defaultValue="overview" orientation="vertical">
        <Tabs.List>
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="locked" disabled>
            Locked
          </Tabs.Trigger>
          <Tabs.Trigger value="members">Members</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="overview">Overview panel</Tabs.Content>
        <Tabs.Content value="locked">Locked panel</Tabs.Content>
        <Tabs.Content value="members">Members panel</Tabs.Content>
      </Tabs>
    ));

    const tablist = screen.getByRole('tablist');
    const overview = screen.getByRole('tab', { name: 'Overview' });
    const locked = screen.getByRole('tab', { name: 'Locked' }) as HTMLButtonElement;
    const members = screen.getByRole('tab', { name: 'Members' });

    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowDown' });

    expect(tablist.getAttribute('aria-orientation')).toBe('vertical');
    expect(locked.disabled).toBe(true);
    expect(document.activeElement).toBe(members);
    expect(members.getAttribute('aria-selected')).toBe('true');
  });
});

describe('Tooltip timing and dismissal boundaries', () => {
  it('cancels the pending tooltip when focus leaves before the delay', () => {
    vi.useFakeTimers();
    render(() => (
      <Tooltip content="Copied to clipboard" openDelay={100}>
        <button type="button">Copy</button>
      </Tooltip>
    ));

    const trigger = screen.getByRole('button', { name: 'Copy' });
    fireEvent.focusIn(trigger);
    vi.advanceTimersByTime(80);
    fireEvent.focusOut(trigger);
    vi.advanceTimersByTime(100);

    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
  });

  it('removes aria-describedby when Escape hides an open tooltip', () => {
    vi.useFakeTimers();
    render(() => (
      <Tooltip content="Mute this room" openDelay={1}>
        <button type="button">Mute</button>
      </Tooltip>
    ));

    const trigger = screen.getByRole('button', { name: 'Mute' });
    fireEvent.focusIn(trigger);
    vi.advanceTimersByTime(1);
    expect(screen.getByRole('tooltip').textContent).toBe('Mute this room');

    fireEvent.keyDown(trigger, { key: 'Escape' });

    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
  });
});

describe('Toast store boundaries', () => {
  it('stores default metadata and leaves zero-duration toasts until dismissed', () => {
    vi.useFakeTimers();
    render(() => <Toaster />);

    const id = toast({ title: 'Manual notice', duration: 0 });
    vi.advanceTimersByTime(10_000);

    const status = screen.getByRole('status');
    const stored = toasts()[0];
    expect(status.classList.contains('onyx-toast--info')).toBe(true);
    expect(status.textContent).toContain('Manual notice');
    expect(toasts()).toHaveLength(1);
    expect(stored?.id).toBe(id);
    expect(stored?.title).toBe('Manual notice');
    expect(stored?.intent).toBe('info');
    expect(stored?.duration).toBe(0);
  });

  it('renders multiple non-danger toasts as status items in insertion order', () => {
    render(() => <Toaster />);
    toast({ title: 'First', intent: 'success', duration: Number.POSITIVE_INFINITY });
    toast({ title: 'Second', intent: 'warning', duration: Number.POSITIVE_INFINITY });

    const statuses = screen.getAllByRole('status');

    // textContent includes the trailing dismiss-control glyph; assert the title prefix.
    expect(statuses[0]?.textContent?.startsWith('First')).toBe(true);
    expect(statuses[1]?.textContent?.startsWith('Second')).toBe(true);
    expect(statuses[0]?.classList.contains('onyx-toast--success')).toBe(true);
    expect(statuses[1]?.classList.contains('onyx-toast--warning')).toBe(true);
  });
});
