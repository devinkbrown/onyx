// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSignal } from 'solid-js';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Cluster,
  Frame,
  ScrollRegion,
  Split,
  Stack,
  type LayoutAs,
  type LayoutSpace,
  type SplitCollapse,
  type SplitRatio,
} from './index';

afterEach(cleanup);

const layoutCss = readFileSync(join(process.cwd(), 'src/ui/layout/layout.css'), 'utf8');

describe('layout primitives', () => {
  describe('semantic elements', () => {
    it('renders Frame, Stack, Cluster, and Split as the requested landmarks', () => {
      const { container } = render(() => (
        <Frame as="section" pad="4">
          <Stack as="nav" gap="3">
            <Cluster as="ul" gap="2">
              <li>one</li>
            </Cluster>
          </Stack>
          <Split as="aside">
            <article>start</article>
            <article>end</article>
          </Split>
        </Frame>
      ));

      expect(container.querySelector('[data-ui="frame"]')?.tagName).toBe('SECTION');
      expect(container.querySelector('[data-ui="stack"]')?.tagName).toBe('NAV');
      expect(container.querySelector('[data-ui="cluster"]')?.tagName).toBe('UL');
      expect(container.querySelector('[data-ui="split"]')?.tagName).toBe('ASIDE');
      expect(screen.getByRole('navigation').tagName).toBe('NAV');
      expect(screen.getByRole('list').tagName).toBe('UL');
      expect(screen.getAllByRole('article')).toHaveLength(2);
    });

    it('defaults each primitive to a generic div', () => {
      const { container } = render(() => (
        <>
          <Frame>frame</Frame>
          <Stack>stack</Stack>
          <Cluster>cluster</Cluster>
          <Split>split</Split>
          <ScrollRegion>scroll</ScrollRegion>
        </>
      ));

      expect(container.querySelector('[data-ui="frame"]')?.tagName).toBe('DIV');
      expect(container.querySelector('[data-ui="stack"]')?.tagName).toBe('DIV');
      expect(container.querySelector('[data-ui="cluster"]')?.tagName).toBe('DIV');
      expect(container.querySelector('[data-ui="split"]')?.tagName).toBe('DIV');
      expect(container.querySelector('[data-ui="scroll"]')?.tagName).toBe('DIV');
    });

    it('names a generic ScrollRegion only when a label is present', () => {
      render(() => <ScrollRegion label="Transcript">line</ScrollRegion>);

      const named = screen.getByRole('region', { name: 'Transcript' });
      expect(named.tagName).toBe('DIV');
      expect(named.tabIndex).toBe(0);
      expect(named.getAttribute('aria-label')).toBe('Transcript');
    });

    it('names a landmark ScrollRegion via labelledBy without adding role=region', () => {
      const { container } = render(() => (
        <ScrollRegion as="section" labelledBy="scroll-heading">line</ScrollRegion>
      ));

      const landmark = container.querySelector('[data-ui="scroll"]') as HTMLElement;
      expect(landmark.tagName).toBe('SECTION');
      expect(landmark.getAttribute('aria-labelledby')).toBe('scroll-heading');
      expect(landmark.getAttribute('role')).toBeNull();
      expect(landmark.tabIndex).toBe(0);
    });

    it('keeps an unlabeled ScrollRegion out of the tab order and landmark tree', () => {
      const { container } = render(() => <ScrollRegion>quiet</ScrollRegion>);
      const region = container.querySelector('[data-ui="scroll"]') as HTMLElement;

      expect(screen.queryByRole('region')).toBeNull();
      expect(region.getAttribute('role')).toBeNull();
      expect(region.getAttribute('aria-label')).toBeNull();
      expect(region.getAttribute('tabindex')).toBeNull();
      expect(region.tabIndex).toBe(-1);
    });
  });

  describe('reactive prop updates', () => {
    it('updates spacing, alignment, and the host element when props change', () => {
      const [as, setAs] = createSignal<LayoutAs>('div');
      const [gap, setGap] = createSignal<LayoutSpace>('2');
      const [align, setAlign] = createSignal<'start' | 'end'>('start');

      const { container } = render(() => (
        <Stack as={as()} gap={gap()} align={align()} class="live">
          item
        </Stack>
      ));

      let host = container.querySelector('[data-ui="stack"]') as HTMLElement;
      expect(host.tagName).toBe('DIV');
      expect(host.dataset.gap).toBe('2');
      expect(host.dataset.align).toBe('start');

      setAs('section');
      setGap('6');
      setAlign('end');

      host = container.querySelector('[data-ui="stack"]') as HTMLElement;
      expect(host.tagName).toBe('SECTION');
      expect(host.dataset.gap).toBe('6');
      expect(host.dataset.align).toBe('end');
      expect(host.classList.contains('live')).toBe(true);
    });

    it('adds and removes ScrollRegion naming as the label signal changes', () => {
      const [label, setLabel] = createSignal<string | undefined>(undefined);

      const { container } = render(() => (
        <ScrollRegion label={label()}>body</ScrollRegion>
      ));

      let host = container.querySelector('[data-ui="scroll"]') as HTMLElement;
      expect(host.getAttribute('role')).toBeNull();
      expect(host.getAttribute('tabindex')).toBeNull();

      setLabel('History');
      host = container.querySelector('[data-ui="scroll"]') as HTMLElement;
      expect(host.getAttribute('role')).toBe('region');
      expect(host.getAttribute('aria-label')).toBe('History');
      expect(host.tabIndex).toBe(0);

      setLabel('   ');
      host = container.querySelector('[data-ui="scroll"]') as HTMLElement;
      expect(host.getAttribute('role')).toBeNull();
      expect(host.getAttribute('aria-label')).toBeNull();
      expect(host.getAttribute('tabindex')).toBeNull();
    });
  });

  describe('arbitrary child composition', () => {
    it('nests primitives and preserves mixed children', () => {
      render(() => (
        <Frame as="main" pad="3" class="outer">
          <Stack gap="4">
            <Cluster as="ul">
              <li>alpha</li>
              <li>beta</li>
            </Cluster>
            <Split ratio="start">
              <p>pane-a</p>
              <p>pane-b</p>
              <p>pane-c</p>
            </Split>
            <ScrollRegion as="section" label="Overflow">
              <span>wide-child</span>
            </ScrollRegion>
          </Stack>
        </Frame>
      ));

      expect(screen.getByRole('main')).toContainElement(screen.getByRole('list'));
      expect(screen.getByText('alpha').tagName).toBe('LI');
      expect(screen.getByText('pane-c').tagName).toBe('P');
      expect(screen.getByRole('region', { name: 'Overflow' }).textContent).toBe('wide-child');
    });
  });

  describe('class merging', () => {
    it('keeps primitive classes while appending caller classes', () => {
      const { container } = render(() => (
        <>
          <Frame class="frame-extra">f</Frame>
          <Stack class="stack-a stack-b">s</Stack>
          <Cluster class="cluster-extra">c</Cluster>
          <Split class="split-extra">p</Split>
          <ScrollRegion class="scroll-extra">r</ScrollRegion>
        </>
      ));

      const frame = container.querySelector('[data-ui="frame"]') as HTMLElement;
      const stack = container.querySelector('[data-ui="stack"]') as HTMLElement;
      const cluster = container.querySelector('[data-ui="cluster"]') as HTMLElement;
      const split = container.querySelector('[data-ui="split"]') as HTMLElement;
      const scroll = container.querySelector('[data-ui="scroll"]') as HTMLElement;

      expect(frame.className.split(/\s+/)).toEqual(['ui-layout', 'ui-frame', 'frame-extra']);
      expect(stack.classList.contains('ui-stack')).toBe(true);
      expect(stack.classList.contains('stack-a')).toBe(true);
      expect(stack.classList.contains('stack-b')).toBe(true);
      expect(cluster.className).toContain('cluster-extra');
      expect(split.className).toContain('split-extra');
      expect(scroll.className).toContain('scroll-extra');
    });

    it('does not inject spacing through the style attribute', () => {
      const { container } = render(() => (
        <Stack gap="5" align="center" justify="between">
          child
        </Stack>
      ));

      const host = container.querySelector('[data-ui="stack"]') as HTMLElement;
      expect(host.getAttribute('style')).toBeNull();
      expect(host.dataset.gap).toBe('5');
      expect(host.dataset.align).toBe('center');
      expect(host.dataset.justify).toBe('between');
    });
  });

  describe('overflow', () => {
    it('keeps ScrollRegion from creating horizontal page overflow', () => {
      const { container } = render(() => (
        <ScrollRegion label="Feed">
          <span style={{ width: '2400px', display: 'block' }}>wide</span>
        </ScrollRegion>
      ));

      const host = container.querySelector('[data-ui="scroll"]') as HTMLElement;
      const styles = getComputedStyle(host);

      expect(host.classList.contains('ui-scroll')).toBe(true);
      expect(styles.overflowX === 'hidden' || layoutCss.includes('overflow-x: hidden')).toBe(true);
      expect(layoutCss).toMatch(/\.ui-scroll\s*\{[^}]*overflow-x:\s*hidden/);
      expect(layoutCss).toMatch(/min-width:\s*0/);
      expect(layoutCss).toMatch(/max-width:\s*100%/);
      expect(layoutCss).not.toMatch(/overflow-x:\s*visible/);
    });

    it('encodes Split collapse as a flex-basis switch, not a style string', () => {
      const { container } = render(() => (
        <Split collapse="lg" ratio="end">
          <div>left</div>
          <div>right</div>
        </Split>
      ));

      const host = container.querySelector('[data-ui="split"]') as HTMLElement;
      expect(host.dataset.collapse).toBe('lg');
      expect(host.dataset.ratio).toBe('end');
      expect(host.getAttribute('style')).toBeNull();
      expect(layoutCss).toContain('flex-basis: calc((var(--ui-split-min, 32rem) - 100%) * 999)');
      expect(layoutCss).toContain('--ui-split-lg, 42rem');
    });
  });

  describe('invalid and edge values', () => {
    it('falls unsafe as values back to div', () => {
      const { container } = render(() => (
        <Frame as={'script' as LayoutAs} pad={'12px' as LayoutSpace}>
          safe
        </Frame>
      ));

      const host = container.querySelector('[data-ui="frame"]') as HTMLElement;
      expect(host.tagName).toBe('DIV');
      expect(host.dataset.pad).toBe('0');
      expect(container.querySelector('script')).toBeNull();
    });

    it('ignores unknown spacing, alignment, ratio, and collapse tokens', () => {
      const { container } = render(() => (
        <>
          <Stack gap={'99' as LayoutSpace} align={'top' as 'start'}>
            stack
          </Stack>
          <Split ratio={'3/1' as SplitRatio} collapse={'xl' as SplitCollapse}>
            split
          </Split>
        </>
      ));

      const stack = container.querySelector('[data-ui="stack"]') as HTMLElement;
      const split = container.querySelector('[data-ui="split"]') as HTMLElement;

      expect(stack.dataset.gap).toBe('3');
      expect(stack.getAttribute('data-align')).toBeNull();
      expect(split.dataset.ratio).toBe('equal');
      expect(split.dataset.collapse).toBe('md');
    });

    it('accepts integer space tokens and treats blank ScrollRegion names as absent', () => {
      const { container } = render(() => (
        <>
          <Cluster gap={4 as unknown as LayoutSpace}>cluster</Cluster>
          <ScrollRegion label="" labelledBy="   ">
            empty
          </ScrollRegion>
        </>
      ));

      const cluster = container.querySelector('[data-ui="cluster"]') as HTMLElement;
      const scroll = container.querySelector('[data-ui="scroll"]') as HTMLElement;

      expect(cluster.dataset.gap).toBe('4');
      expect(scroll.getAttribute('role')).toBeNull();
      expect(scroll.getAttribute('aria-label')).toBeNull();
      expect(scroll.getAttribute('aria-labelledby')).toBeNull();
      expect(scroll.getAttribute('tabindex')).toBeNull();
    });

    it('preserves a caller role and tabIndex on ScrollRegion', () => {
      render(() => (
        <ScrollRegion label="Log" role="log" tabIndex={-1}>
          entry
        </ScrollRegion>
      ));

      const log = screen.getByRole('log', { name: 'Log' });
      expect(log.tabIndex).toBe(-1);
      expect(log.getAttribute('role')).toBe('log');
    });
  });

  describe('token and motion contract', () => {
    it('uses semantic variables with existing-token fallbacks and no brand hex', () => {
      expect(layoutCss).toMatch(/var\(--ui-space-3, var\(--space-3, 0\.75rem\)\)/);
      expect(layoutCss).toMatch(/var\(--ui-measure-shell, var\(--shell-measure, 100%\)\)/);
      expect(layoutCss).toMatch(/prefers-reduced-motion:\s*reduce/);
      expect(layoutCss).toMatch(/forced-colors:\s*active/);
      expect(layoutCss).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(layoutCss).not.toMatch(/44px/);
      expect(layoutCss).not.toMatch(/--lapis|--ink|--gold|--shu/);
    });
  });
});
