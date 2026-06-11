import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ModalShell from '@/components/modals/ModalShell';

describe('ModalShell', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders title, kicker, body, and footer slots', () => {
    render(
      <ModalShell
        onClose={() => {}}
        title="Delete Channel"
        kicker="Danger zone"
        titleId="del-title"
        footer={<button>Confirm</button>}
        danger
      >
        <p>Are you sure?</p>
      </ModalShell>,
    );

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'del-title');
    expect(screen.getByText('Delete Channel')).toBeInTheDocument();
    expect(screen.getByText('Danger zone')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByRole('dialog').className).toContain('mshell-danger');
  });

  it('closes on Escape after the exit animation delay', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <ModalShell onClose={onClose} title="T" titleId="t">
        body
      </ModalShell>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on scrim click but not on card click', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container } = render(
      <ModalShell onClose={onClose} title="T" titleId="t">
        <button>inner</button>
      </ModalShell>,
    );

    fireEvent.click(screen.getByText('inner'));
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onClose).not.toHaveBeenCalled();

    const overlay = container.querySelector('.mshell-overlay')!;
    fireEvent.click(overlay);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on scrim click when closeOnScrim is false', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container } = render(
      <ModalShell onClose={onClose} title="T" titleId="t" closeOnScrim={false}>
        body
      </ModalShell>,
    );

    fireEvent.click(container.querySelector('.mshell-overlay')!);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('only fires onClose once for repeated close requests', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <ModalShell onClose={onClose} title="T" titleId="t">
        body
      </ModalShell>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByLabelText('Close dialog'));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes immediately when reduced motion is preferred', () => {
    const onClose = vi.fn();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    render(
      <ModalShell onClose={onClose} title="T" titleId="t">
        body
      </ModalShell>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // @ts-expect-error cleanup test shim
    delete window.matchMedia;
  });

  it('applies size variant and testId to the card', () => {
    render(
      <ModalShell onClose={() => {}} title="T" titleId="t" size="lg" testId="my-modal">
        body
      </ModalShell>,
    );
    const card = screen.getByTestId('my-modal');
    expect(card.className).toContain('mshell-lg');
    expect(card).toHaveAttribute('role', 'dialog');
  });
});
