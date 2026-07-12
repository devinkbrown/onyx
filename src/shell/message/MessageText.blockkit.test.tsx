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

describe('MessageText Block-Kit confused-deputy guard', () => {
  beforeEach(() => sendMessage.mockClear());

  it('does NOT dispatch a send action whose target differs from the render origin', () => {
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
    // The cross-target send is refused: the deputy never speaks into #victim.
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('dispatches a matching-target send action into the origin conversation', () => {
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
    expect(sendMessage).toHaveBeenCalledTimes(1);
    // Forced to the trusted origin value, never re-routed by the block.
    expect(sendMessage).toHaveBeenCalledWith('#public', 'ack');
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
  });

  it('refuses a select-notify whose target differs from the origin', () => {
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
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
