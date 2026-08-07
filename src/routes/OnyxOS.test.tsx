// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@solidjs/testing-library';
import OnyxOS from './OnyxOS';

describe('OnyxOS route', () => {
  it('positions Onyx as a first-class cross-platform part of OnyxOS', () => {
    const { getByText, getByRole } = render(() => <OnyxOS />);

    expect(getByRole('heading', { name: /communication,\s*at home in the system/i })).toBeInTheDocument();
    expect(getByText(/first-class native experience in OnyxOS/i)).toBeInTheDocument();
    expect(getByText(/Onyx stays cross-platform/i)).toBeInTheDocument();
    expect(getByRole('link', { name: /open Onyx now/i })).toHaveAttribute('href', '/app/');
  });

  it('states the native integration areas and fallback boundary', () => {
    const { getByText, getByRole } = render(() => <OnyxOS />);

    expect(getByRole('heading', { name: /the same Onyx. Deeper system roots/i })).toBeInTheDocument();
    expect(getByText(/keeps a web fallback and an explicit permission boundary/i)).toBeInTheDocument();
    expect(getByRole('heading', { name: 'Identity' })).toBeInTheDocument();
    expect(getByRole('heading', { name: 'Attention' })).toBeInTheDocument();
    expect(getByRole('heading', { name: 'Memory' })).toBeInTheDocument();
    expect(getByRole('heading', { name: 'Media' })).toBeInTheDocument();
  });

  it('lets visitors inspect each compatibility stage', async () => {
    const { getByRole, findByText } = render(() => <OnyxOS />);
    const gate = getByRole('tab', { name: /03 · gate/i });

    await fireEvent.click(gate);

    expect(gate).toHaveAttribute('aria-selected', 'true');
    expect(await findByText(/a green report is not a shipped binary/i)).toBeInTheDocument();
    expect(getByRole('tabpanel')).toHaveTextContent(/strict target link/i);
  });

  it('documents the safe interactive site workbench', () => {
    const { getByText } = render(() => <OnyxOS />);

    expect(getByText('pnpm site:workbench')).toBeInTheDocument();
    expect(getByText(/interactive local preview/i)).toBeInTheDocument();
    expect(getByText('pnpm site:check')).toBeInTheDocument();
  });
});
