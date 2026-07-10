import { createSignal } from 'solid-js';
import { fireEvent, render, screen } from '@solidjs/testing-library';
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
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'send', target: '#ops', value: 'approved' });
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
});
