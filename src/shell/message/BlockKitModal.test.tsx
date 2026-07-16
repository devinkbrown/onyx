// SPDX-License-Identifier: AGPL-3.0-or-later
import { createSignal } from 'solid-js';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { BlockKitModal } from './BlockKitModal';
import type { BlockKitLiteModalBlock } from '@/lib/integrations/blockKitLite';

const releaseModal: BlockKitLiteModalBlock = {
  type: 'modal',
  title: 'Release details',
  triggerLabel: 'Review release',
  text: 'Check the rollout notes.',
  fields: [{ label: 'Service', value: 'Onyx' }],
  buttons: [
    {
      label: 'Approve',
      url: null,
      value: null,
      action: { type: 'send', target: '#ops', value: 'approved' },
    },
  ],
  selects: [
    {
      label: 'Environment',
      options: [{ label: 'Production', value: 'prod' }],
      action: { type: 'select-notify', target: '#ops', value: 'environment' },
    },
  ],
};

describe('BlockKitModal', () => {
  it('renders modal content and emits allowlisted actions', () => {
    const onAction = vi.fn();

    render(() => (
      <BlockKitModal
        block={releaseModal}
        open
        onOpenChange={() => undefined}
        onAction={onAction}
      />
    ));

    expect(screen.getByRole('dialog', { name: 'Release details' })).toBeInTheDocument();
    expect(screen.getByText('Check the rollout notes.')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('Onyx')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'prod' } });
    expect(onAction).toHaveBeenCalledWith(
      { type: 'select-notify', target: '#ops', value: 'environment' },
      'prod',
      expect.any(HTMLSelectElement),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onAction).toHaveBeenCalledWith(
      { type: 'send', target: '#ops', value: 'approved' },
      undefined,
      expect.any(HTMLButtonElement),
    );
  });

  it('closes through the existing modal primitive contract', () => {
    function Harness() {
      const [open, setOpen] = createSignal(true);
      return (
        <BlockKitModal
          block={releaseModal}
          open={open()}
          onOpenChange={setOpen}
        />
      );
    }

    render(() => <Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Close block details' }));

    expect(screen.queryByRole('dialog', { name: 'Release details' })).toBeNull();
  });

  it('announces clipboard failure for a modal copy control', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const copyModal: BlockKitLiteModalBlock = {
      ...releaseModal,
      buttons: [{ label: 'Copy release ID', url: null, value: 'rel-42', action: null }],
    };

    render(() => (
      <BlockKitModal
        block={copyModal}
        open
        onOpenChange={() => undefined}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy value for Copy release ID' }));

    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Copy value for Copy release ID' }),
    ).toHaveTextContent('Copy failed'));
    expect(screen.getByRole('status')).toHaveTextContent('Copy release ID value could not be copied.');
  });

  it('does not create copy feedback timers after the modal button unmounts', async () => {
    let resolveCopy: (() => void) | undefined;
    const pendingCopy = new Promise<void>((resolve) => {
      resolveCopy = resolve;
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(() => pendingCopy) },
    });
    const copyModal: BlockKitLiteModalBlock = {
      ...releaseModal,
      buttons: [{ label: 'Copy release ID', url: null, value: 'rel-42', action: null }],
    };
    const view = render(() => (
      <BlockKitModal
        block={copyModal}
        open
        onOpenChange={() => undefined}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy value for Copy release ID' }));
    view.unmount();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    resolveCopy?.();
    await pendingCopy;
    await Promise.resolve();

    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });
});
