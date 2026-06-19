import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';

afterEach(cleanup);

describe('Tabs', () => {
  it('renders compound tabs with selected tab and panel semantics', () => {
    render(() => (
      <Tabs defaultValue="channels">
        <Tabs.List>
          <Tabs.Trigger value="channels">Channels</Tabs.Trigger>
          <Tabs.Trigger value="members">Members</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="channels">Channel list</Tabs.Content>
        <Tabs.Content value="members">Member list</Tabs.Content>
      </Tabs>
    ));

    const channels = screen.getByRole('tab', { name: 'Channels' });
    const channelPanel = screen.getByRole('tabpanel', { name: 'Channels' });

    expect(channels.getAttribute('aria-selected')).toBe('true');
    expect(channelPanel.textContent).toBe('Channel list');
  });

  it('changes tabs on click and reports value changes', () => {
    const onValueChange = vi.fn();
    render(() => (
      <Tabs defaultValue="channels" onValueChange={onValueChange}>
        <Tabs.List>
          <Tabs.Trigger value="channels">Channels</Tabs.Trigger>
          <Tabs.Trigger value="members">Members</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="channels">Channel list</Tabs.Content>
        <Tabs.Content value="members">Member list</Tabs.Content>
      </Tabs>
    ));

    const members = screen.getByRole('tab', { name: 'Members' });
    fireEvent.click(members);

    expect(members.getAttribute('aria-selected')).toBe('true');
    expect(onValueChange).toHaveBeenCalledWith('members');
  });

  it('supports Arrow, Home, End, Enter, and Space keyboard selection', () => {
    render(() => (
      <Tabs defaultValue="channels">
        <Tabs.List>
          <Tabs.Trigger value="channels">Channels</Tabs.Trigger>
          <Tabs.Trigger value="members">Members</Tabs.Trigger>
          <Tabs.Trigger value="threads">Threads</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="channels">Channel list</Tabs.Content>
        <Tabs.Content value="members">Member list</Tabs.Content>
        <Tabs.Content value="threads">Thread list</Tabs.Content>
      </Tabs>
    ));

    const channels = screen.getByRole('tab', { name: 'Channels' });
    const members = screen.getByRole('tab', { name: 'Members' });
    const threads = screen.getByRole('tab', { name: 'Threads' });

    channels.focus();
    fireEvent.keyDown(channels, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(members);
    expect(members.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(members, { key: 'End' });
    expect(document.activeElement).toBe(threads);

    fireEvent.keyDown(threads, { key: 'Home' });
    expect(document.activeElement).toBe(channels);

    fireEvent.keyDown(channels, { key: ' ' });
    fireEvent.keyDown(channels, { key: 'Enter' });
    expect(channels.getAttribute('aria-selected')).toBe('true');
  });
});
