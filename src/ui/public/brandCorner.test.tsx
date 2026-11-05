// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { PublicHeader } from './PublicHeader';
import { ServerRail } from '@/shell/ServerRail';

const publicFrameCss = readFileSync(resolve(__dirname, 'public-frame.css'), 'utf8');
const commercialCss = readFileSync(resolve(__dirname, '../../shell/commercial-navigation.css'), 'utf8');

afterEach(cleanup);

function rule(css: string, selector: string): string {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\}`));
  return match?.[0] ?? '';
}

describe('top-left brand', () => {
  it('shows one stone tile beside the word Onyx in the public header and the shell', () => {
    const header = render(() => <PublicHeader currentPath="/" />);
    const brand = header.container.querySelector('.public-frame__brand');
    expect(brand).toBeTruthy();
    expect(brand).toHaveTextContent('Onyx');
    expect(brand!.querySelectorAll('img.public-frame__mark')).toHaveLength(1);
    expect(brand!.querySelectorAll('svg')).toHaveLength(0);
    const clipped = rule(publicFrameCss, '.public-frame__lockup,\n.public-frame__wordmark');
    expect(clipped).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(rule(publicFrameCss, '.public-frame__mark')).not.toMatch(/border-radius:\s*50%/);
    expect(rule(publicFrameCss, '.public-frame__mark')).toMatch(/background:\s*transparent/);
    header.unmount();

    const rail = render(() => <ServerRail />);
    const shellBrand = rail.container.querySelector('.commercial-onyx-brand');
    expect(shellBrand).toBeTruthy();
    expect(shellBrand).toHaveTextContent('Onyx');
    expect(shellBrand!.querySelectorAll('svg')).toHaveLength(1);
    expect(shellBrand!.querySelectorAll('rect')).toHaveLength(1);
    expect(shellBrand!.querySelectorAll('circle')).toHaveLength(2);
    expect(shellBrand!.innerHTML).not.toContain('12.5 12.5');
    expect(shellBrand!.querySelector('.commercial-network-mark')).toBeNull();
    expect(rail.container.querySelector('.commercial-network-mark')).toBeNull();
    expect(rule(commercialCss, '.commercial-network-mark')).toMatch(/display:\s*none/);
    expect(rule(commercialCss, '.commercial-network-mark')).not.toMatch(/border-radius:\s*50%/);
  });
});
