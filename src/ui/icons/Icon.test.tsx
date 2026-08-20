// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Icon.test.tsx — accessibility, rendering, and symbol existence tests.
 *
 * Tests:
 * - Decorative icon (no label) has aria-hidden=true
 * - Meaningful icon (with label) has aria-label and aria-hidden=false
 * - Size classes and pixel dimensions
 * - All symbol types render without error
 * - No emoji in rendered output
 * - CSS classes are applied correctly
 */

import { createSignal, For } from "solid-js";
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Icon, type IconSize, type IconSymbol } from './Icon';

afterEach(() => {
  cleanup();
});

const ICON_SYMBOLS: IconSymbol[] = [
  'menu',
  'close',
  'arrow',
  'external',
  'check',
  'warning',
  'info',
  'reconnect',
  'local',
  'unknown',
];

const ICON_SIZES: IconSize[] = ['sm', 'md', 'lg', 'xl'];

const SIZE_PIXELS: Record<IconSize, number> = {
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
};

describe('Icon', () => {
  describe('accessibility', () => {
    it('renders decorative icon (no label) with aria-hidden=true', () => {
      const { container } = render(() => <Icon symbol="menu" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).not.toHaveAttribute('aria-label');
    });

    it('renders meaningful icon (with label) with aria-label and aria-hidden=false', () => {
      render(() => <Icon symbol="menu" label="Navigation" />);

      const svg = screen.getByRole('img', { hidden: false });
      expect(svg).toHaveAttribute('aria-label', 'Navigation');
      expect(svg).toHaveAttribute('aria-hidden', 'false');
    });

    it('aria-label updates reactively when prop changes', () => {
      const [label, setLabel] = createSignal<string | undefined>(undefined);

      const { container } = render(() => <Icon symbol="close" label={label()} />);

      const decorativeSvg = container.querySelector('svg');
      expect(decorativeSvg).toHaveAttribute('aria-hidden', 'true');

      setLabel('Dismiss');
      const meaningfulSvg = screen.getByRole('img');
      expect(meaningfulSvg).toHaveAttribute('aria-label', 'Dismiss');
    });
  });

  describe('sizes', () => {
    ICON_SIZES.forEach((size) => {
      it(`renders ${size} size (${SIZE_PIXELS[size]}px)`, () => {
        const { container } = render(() => <Icon symbol="menu" size={size} />);

        const wrapper = container.querySelector('.icon');
        expect(wrapper).toHaveStyle({
          width: `${SIZE_PIXELS[size]}px`,
          height: `${SIZE_PIXELS[size]}px`,
        });
        expect(wrapper).toHaveClass(`icon-size-${size}`);
      });
    });

    it('defaults to md size (24px) when no size prop', () => {
      const { container } = render(() => <Icon symbol="menu" />);

      const wrapper = container.querySelector('.icon');
      expect(wrapper).toHaveStyle({
        width: '24px',
        height: '24px',
      });
      expect(wrapper).toHaveClass('icon-size-md');
    });
  });

  describe('symbol rendering', () => {
    ICON_SYMBOLS.forEach((symbol) => {
      it(`renders ${symbol} symbol without error`, () => {
        const { container } = render(() => <Icon symbol={symbol} />);

        const wrapper = container.querySelector('.icon');
        expect(wrapper).toHaveClass(`icon-${symbol}`);

        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();
      });
    });
  });

  describe('CSS classes', () => {
    it('applies symbol class', () => {
      const { container } = render(() => <Icon symbol="check" />);

      const wrapper = container.querySelector('.icon');
      expect(wrapper).toHaveClass('icon-check');
    });

    it('applies size class', () => {
      const { container } = render(() => <Icon symbol="check" size="lg" />);

      const wrapper = container.querySelector('.icon');
      expect(wrapper).toHaveClass('icon-size-lg');
    });

    it('applies custom class prop', () => {
      const { container } = render(() => <Icon symbol="check" class="my-custom-class" />);

      const wrapper = container.querySelector('.icon');
      expect(wrapper).toHaveClass('my-custom-class');
    });

    it('combines symbol, size, and custom classes', () => {
      const { container } = render(() => <Icon symbol="arrow" size="sm" class="text-accent" />);

      const wrapper = container.querySelector('.icon');
      expect(wrapper).toHaveClass('icon-arrow');
      expect(wrapper).toHaveClass('icon-size-sm');
      expect(wrapper).toHaveClass('text-accent');
    });
  });

  describe('content', () => {
    it('contains no emoji characters', () => {
      const { container } = render(() => (
        <>
          <For each={ICON_SYMBOLS}>{(symbol) => (
            <Icon symbol={symbol} />
          )}</For>
        </>
      ));

      const text = container.textContent ?? '';
      // Icons should contain no text content (only SVG paths)
      expect(text.trim()).toBe('');
    });

    it('SVG renders with proper stroke and fill attributes', () => {
      const { container } = render(() => <Icon symbol="check" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('stroke', 'currentColor');
      expect(svg).toHaveAttribute('fill', 'none');
      expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    });
  });

  describe('styling', () => {
    it('applies inline styles for sizing and color', () => {
      const { container } = render(() => <Icon symbol="menu" />);

      const wrapper = container.querySelector('.icon') as HTMLElement;
      expect(wrapper.style.display).toBe('inline-flex');
      expect(wrapper.style.alignItems).toBe('center');
      expect(wrapper.style.justifyContent).toBe('center');
      expect(wrapper.style.color).toBe('currentcolor');
      expect(wrapper.style.flexShrink).toBe('0');
    });
  });
});
