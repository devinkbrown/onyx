// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import type { NormalizedModerationAction } from '@/lib/moderation/actionModel';
import { ModerationActionReview } from './ModerationActionReview';

afterEach(cleanup);

describe('ModerationActionReview', () => {
  it('does not dispatch until the review is confirmed', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(() => (
      <ModerationActionReview
        open
        draft={{ kind: 'kick', channel: '#garden', target: 'bob' }}
        actorNick="me"
        connected
        canModerate
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    ));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Room moderator')).toBeInTheDocument();
    expect(screen.getByText('#garden')).toBeInTheDocument();
    expect(screen.getByText(/Local draft until confirmed/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('moderation-review-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const action = onConfirm.mock.calls[0]?.[0] as NormalizedModerationAction;
    expect(action).toEqual({ kind: 'kick', channel: '#garden', target: 'bob' });
  });

  it('invalidates confirm when disconnected or authority is lost', () => {
    const onConfirm = vi.fn();
    const [connected, setConnected] = createSignal(true);
    const [canModerate, setCanModerate] = createSignal(true);
    render(() => (
      <ModerationActionReview
        open
        draft={{ kind: 'ban', channel: '#garden', target: 'bob' }}
        actorNick="me"
        connected={connected()}
        canModerate={canModerate()}
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />
    ));

    setConnected(false);
    expect(screen.getByTestId('moderation-review-blocked')).toHaveTextContent(/Reconnect/);
    expect(screen.getByTestId('moderation-review-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('moderation-review-confirm'));
    expect(onConfirm).not.toHaveBeenCalled();

    setConnected(true);
    setCanModerate(false);
    expect(screen.getByTestId('moderation-review-blocked')).toHaveTextContent(/moderator permission/);
    expect(screen.getByTestId('moderation-review-confirm')).toBeDisabled();
  });

  it('restores keyboard focus to the provided return target on cancel', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open review';
    document.body.append(opener);
    opener.focus();

    function Harness() {
      const [open, setOpen] = createSignal(true);
      return (
        <ModerationActionReview
          open={open()}
          draft={{ kind: 'op', channel: '#garden', target: 'bob' }}
          actorNick="me"
          connected
          canModerate
          returnFocus={opener}
          onConfirm={() => undefined}
          onCancel={() => setOpen(false)}
        />
      );
    }

    render(() => <Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
