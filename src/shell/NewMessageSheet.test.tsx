import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Show, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewMessageSheet } from './NewMessageSheet';

afterEach(cleanup);

describe('NewMessageSheet', () => {
  it('starts a conversation only for a valid recipient', () => {
    const onStart = vi.fn();
    render(() => <NewMessageSheet connectionStatus="connected" onClose={vi.fn()} onStart={onStart} />);
    const input = screen.getByLabelText('Who do you want to message?');
    fireEvent.input(input, { target: { value: '  River_7  ' } });
    fireEvent.submit(input.closest('form')!);
    expect(onStart).toHaveBeenCalledWith('River_7');
  });

  it.each(['_alice', '[alice', `a${'b'.repeat(32)}`, 'a'.repeat(64)])(
    'accepts shared-contract recipient %s',
    (name) => {
      const onStart = vi.fn();
      render(() => <NewMessageSheet connectionStatus="connected" onClose={vi.fn()} onStart={onStart} />);
      const input = screen.getByLabelText('Who do you want to message?');
      fireEvent.input(input, { target: { value: name } });
      fireEvent.submit(input.closest('form')!);
      expect(onStart).toHaveBeenCalledWith(name);
    },
  );

  it.each(['33alice', 'alice smith'])('shows an error and does not start for invalid recipient %s', (name) => {
    const onStart = vi.fn();
    render(() => <NewMessageSheet connectionStatus="connected" onClose={vi.fn()} onStart={onStart} />);
    const input = screen.getByLabelText('Who do you want to message?');
    fireEvent.input(input, { target: { value: name } });
    fireEvent.submit(input.closest('form')!);
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Name');
  });

  it('explains offline state and prevents submission', () => {
    const onStart = vi.fn();
    render(() => <NewMessageSheet connectionStatus="disconnected" onClose={vi.fn()} onStart={onStart} />);
    expect(screen.getByRole('status')).toHaveTextContent('offline');
    expect(screen.getByRole('button', { name: 'Waiting for connection' })).toBeDisabled();
  });

  it('gives a clear empty state and accessible input guidance', () => {
    render(() => <NewMessageSheet connectionStatus="connected" onClose={vi.fn()} onStart={vi.fn()} />);
    expect(screen.getByText('No person selected yet.')).toBeInTheDocument();
    expect(screen.getByText(/Enter their nickname exactly/)).toBeInTheDocument();
    expect(screen.getByLabelText('Who do you want to message?')).toHaveAttribute('aria-describedby', 'new-message-recipient-hint new-message-recipient-error');
  });

  it('announces connecting and keeps the action busy', () => {
    render(() => <NewMessageSheet connectionStatus="connecting" onClose={vi.fn()} onStart={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to Onyx');
    expect(screen.getByRole('button', { name: 'Waiting for connection' })).toBeDisabled();
  });

  it('closes on Escape and traps Tab focus inside the sheet', async () => {
    const onClose = vi.fn();
    render(() => <NewMessageSheet connectionStatus="connected" onClose={onClose} onStart={vi.fn()} />);
    const close = screen.getByRole('button', { name: 'Close new conversation' });
    const start = screen.getByRole('button', { name: 'Start conversation' });
    start.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close new conversation' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(close).toBeInTheDocument();
  });

  it('restores focus to the trigger when the sheet unmounts', async () => {
    const [open, setOpen] = createSignal(true);
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = 'New message';
    document.body.append(trigger);
    trigger.focus();
    render(() => <Show when={open()}><NewMessageSheet connectionStatus="connected" onClose={() => setOpen(false)} onStart={vi.fn()} /></Show>);
    await Promise.resolve();
    fireEvent.keyDown(document, { key: 'Escape' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
