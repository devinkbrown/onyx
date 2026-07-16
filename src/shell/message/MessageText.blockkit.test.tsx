// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Confused-deputy guard for Block-Kit actions.
 *
 * extractBlockKitLite runs on EVERY message body, so any channel participant can
 * post `[onyx:block]{...}` that renders interactive controls. A control's action
 * carries an attacker-chosen `target`; on click the client would otherwise send
 * attacker-chosen text to that target AS THE VIEWER. The render sink must instead
 * force the action to speak only into the conversation the block was rendered in
 * (`origin`) and refuse any mismatched target — closing the identity-borrow hole.
 */
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMessage = vi.fn();
vi.mock('@/lib/store', () => ({
  getState: () => ({ sendMessage }),
}));

// Imported AFTER the mock is registered so MessageText binds the stubbed store.
const { MessageText } = await import('./MessageText');

function blockLine(payload: unknown): string {
  return `[onyx:block] ${JSON.stringify(payload)}`;
}

const tick = () => new Promise((resolve) => window.setTimeout(resolve, 0));

describe('MessageText Block-Kit confused-deputy guard', () => {
  beforeEach(() => sendMessage.mockClear());

  it('keeps an origin-mismatched action inert without opening confirmation', () => {
    render(() => (
      <MessageText
        origin="#public"
        text={blockLine({
          buttons: [
            { label: 'Load more', action: { type: 'send', target: '#victim', value: 'phishing text' } },
          ],
        })}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Send message from structured control?' })).toBeNull();
  });

  it('previews the exact normalized target and plaintext, then confirms exactly once', () => {
    render(() => (
      <MessageText
        origin="#public"
        text={blockLine({
          buttons: [
            { label: 'Ack', action: { type: 'send', target: '#public', value: 'ack' } },
          ],
        })}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Ack' }));
    expect(sendMessage).not.toHaveBeenCalled();

    const confirmation = screen.getByRole('dialog', { name: 'Send message from structured control?' });
    expect(confirmation).toHaveTextContent('Target');
    expect(confirmation).toHaveTextContent('#public');
    expect(confirmation).toHaveTextContent('Message');
    expect(confirmation).toHaveTextContent('ack');

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('#public', 'ack');
    expect(screen.queryByRole('dialog', { name: 'Send message from structured control?' })).toBeNull();
  });

  it('cancels a staged send without dispatching', () => {
    render(() => (
      <MessageText
        origin="#public"
        text={blockLine({
          buttons: [
            { label: 'Ack', action: { type: 'send', target: '#public', value: 'ack' } },
          ],
        })}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Ack' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Send message from structured control?' })).toBeNull();
  });

  it('fails closed and dispatches nothing when no origin is supplied', () => {
    render(() => (
      <MessageText
        text={blockLine({
          buttons: [
            { label: 'Go', action: { type: 'send', target: '#public', value: 'x' } },
          ],
        })}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Send message from structured control?' })).toBeNull();
  });

  it('resets a staged select so cancel can restore focus and the same option can be retried', async () => {
    render(() => (
      <MessageText
        origin="#public"
        text={blockLine({
          selects: [
            {
              label: 'Environment',
              action: { type: 'select-notify', target: '#public', value: 'environment' },
              options: [{ label: 'Production', value: 'prod' }],
            },
          ],
        })}
      />
    ));

    const select = screen.getByLabelText('Environment') as HTMLSelectElement;
    select.focus();
    select.value = 'prod';
    fireEvent.change(select);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(select.value).toBe('');
    expect(screen.getByRole('dialog', { name: 'Send message from structured control?' }))
      .toHaveTextContent('environment: prod');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await tick();
    expect(document.activeElement).toBe(select);

    select.value = 'prod';
    fireEvent.change(select);
    expect(select.value).toBe('');
    expect(screen.getByRole('dialog', { name: 'Send message from structured control?' }))
      .toHaveTextContent('environment: prod');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('keeps an origin-mismatched select inert and resets it without a dialog', () => {
    render(() => (
      <MessageText
        origin="#public"
        text={blockLine({
          selects: [
            {
              label: 'Environment',
              action: { type: 'select-notify', target: '#victim', value: null },
              options: [{ label: 'Production', value: 'prod' }],
            },
          ],
        })}
      />
    ));

    const select = screen.getByLabelText('Environment') as HTMLSelectElement;
    select.value = 'prod';
    fireEvent.change(select);

    expect(select.value).toBe('');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Send message from structured control?' })).toBeNull();
  });

  it('uses the same prepare-confirm gate for controls inside a Block-Kit modal', () => {
    render(() => (
      <MessageText
        origin="#ops"
        text={blockLine({
          type: 'modal',
          title: 'Release details',
          triggerLabel: 'Review release',
          buttons: [
            { label: 'Approve', action: { type: 'send', target: '#ops', value: 'approved' } },
          ],
        })}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Review release' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(sendMessage).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('dialog', { name: 'Send message from structured control?' });
    expect(confirmation).toHaveTextContent('#ops');
    expect(confirmation).toHaveTextContent('approved');

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('#ops', 'approved');
    expect(screen.getByRole('dialog', { name: 'Release details' })).toBeInTheDocument();
  });

  it('moves focus into confirmation and returns it to the originating button on cancel', async () => {
    render(() => (
      <MessageText
        origin="#public"
        text={blockLine({
          buttons: [
            { label: 'Ack', action: { type: 'send', target: '#public', value: 'ack' } },
          ],
        })}
      />
    ));

    const originButton = screen.getByRole('button', { name: 'Ack' });
    originButton.focus();
    fireEvent.click(originButton);
    await tick();

    const confirmation = screen.getByRole('dialog', { name: 'Send message from structured control?' });
    expect(confirmation.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await tick();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(originButton);
  });
});
