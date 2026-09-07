import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  listener: undefined as ((state: { available: true; deferred: boolean } | null) => void) | undefined,
  approve: vi.fn(),
}));

vi.mock('./updateRecovery', () => ({
  updateCoordinator: {
    subscribe(listener: typeof harness.listener) {
      harness.listener = listener;
      harness.listener?.(null);
      return () => { harness.listener = undefined; };
    },
    approve: harness.approve,
  },
}));

import { UpdateAvailable } from './UpdateAvailable';

describe('UpdateAvailable', () => {
  afterEach(() => { cleanup(); harness.listener = undefined; harness.approve.mockClear(); });

  it('uses deferred copy while preserving coordinator semantics', () => {
    render(() => <UpdateAvailable />);
    harness.listener?.({ available: true, deferred: true });
    expect(screen.getByRole('status')).toHaveTextContent(/reload is deferred/i);
    expect(screen.getByRole('button', { name: 'Reload when safe' })).toBeInTheDocument();
  });

  it('exposes a named, described button and delegates approval', () => {
    render(() => <UpdateAvailable />);
    harness.listener?.({ available: true, deferred: false });
    const button = screen.getByRole('button', { name: 'Reload to update' });
    expect(button).toHaveAttribute('aria-describedby', 'update-available-message');
    button.click();
    expect(harness.approve).toHaveBeenCalledOnce();
  });

  it('keeps the commercial layout contracts in CSS', () => {
    const css = readFileSync(resolve(__dirname, 'update-available.css'), 'utf8');
    expect(css).toContain('env(safe-area-inset-bottom');
    expect(css).toContain('var(--shell-virtual-keyboard-inset');
    expect(css).toContain('var(--commercial-target');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
