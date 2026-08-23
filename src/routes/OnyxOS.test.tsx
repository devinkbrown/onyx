// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import OnyxOS from './OnyxOS';

vi.mock('@/backgrounds/SceneAtmosphere', () => ({
  SceneAtmosphere: () => <div data-background-canvas="true" data-background-id="deep-current" />,
}));

const onyxosCss = readFileSync(resolve(__dirname, 'onyxos.css'), 'utf8');

/** Manifest order for the shared primary navigation. */
const PRIMARY_LINKS = [
  ['About', '/about/'],
  ['Download', '/download/'],
] as const;

const STAGE_TABS = ['01 · Oracle', '02 · Clean room', '03 · Gate', '04 · Boot'] as const;

function tabs(): HTMLElement[] {
  return within(screen.getByRole('tablist', { name: 'Compatibility stages' })).getAllByRole('tab');
}

describe('OnyxOS route', () => {
  it('uses PublicFrame as its only document frame', () => {
    const { container } = render(() => <OnyxOS />);

    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('footer')).toHaveLength(1);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'OnyxOS and Onyx' })).toHaveAttribute('id', 'public-main');
    expect(container.querySelector('.public-frame__context')).toHaveTextContent(/Native work\s*·\s*Evidence-led system engineering/);
    expect(container.querySelectorAll('main#public-main')).toHaveLength(1);
    expect(container.querySelector('main main, main header, main footer')).toBeNull();

    const skip = screen.getAllByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveLength(1);
    expect(skip[0]).toHaveAttribute('href', '#public-main');

    const disclosure = screen.getAllByRole('button', { name: 'Open navigation menu' });
    expect(disclosure).toHaveLength(1);
    expect(disclosure[0]).toHaveAttribute('aria-controls', 'public-primary-navigation');
  });

  it('renders the route body as a non-landmark region inside the shared main', () => {
    const { container } = render(() => <OnyxOS />);

    const page = container.querySelector('.onyxos-page');
    expect(page).toBeTruthy();
    expect(page!.tagName).toBe('DIV');
    expect(page!.closest('main#public-main')).toBeTruthy();
    expect(page!.querySelector('.onyxos-wordmark, .onyxos-nav')).toBeNull();
  });

  it('keeps the unlisted /onyxos/ route out of public chrome', () => {
    const { container } = render(() => <OnyxOS />);
    const primary = screen.getByRole('navigation', { name: 'Primary navigation' });
    const links = within(primary).getAllByRole('link');

    expect(links.map((link) => [link.textContent, link.getAttribute('href')]))
      .toEqual(PRIMARY_LINKS.map(([label, href]) => [label, href]));
    expect(links.filter((link) => link.getAttribute('aria-current') === 'page'))
      .toHaveLength(0);
    expect(within(primary).queryByRole('link', { name: 'OnyxOS' })).toBeNull();
    expect(container.querySelector('header a[href="/onyxos/"], footer a[href="/onyxos/"]')).toBeNull();

    for (const label of ['Accessibility', 'Glossary', 'Integrations', 'Agent safety', 'Stats', 'Appearance', 'Status', 'Roadmap']) {
      expect(within(primary).queryByRole('link', { name: label })).toBeNull();
    }
  });

  it('owns exactly the four in-page section anchors and no duplicate site links', () => {
    render(() => <OnyxOS />);
    const sections = screen.getByRole('navigation', { name: 'OnyxOS sections' });
    const links = within(sections).getAllByRole('link');

    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Onyx', '#onyx-native'],
      ['Method', '#method'],
      ['Source', '#source'],
      ['Workbench', '#workbench'],
    ]);

    // Every anchor resolves to a real section on this page.
    for (const link of links) {
      expect(document.querySelector(`${link.getAttribute('href')}`)).toBeTruthy();
    }

    // The frame owns the single primary Open Onyx affordance; route actions stay descriptive.
    const openOnyx = screen.getAllByRole('link', { name: 'Open Onyx' });
    expect(openOnyx).toHaveLength(1);
    expect(openOnyx[0]?.closest('.onyxos-page')).toBeNull();
    expect(screen.getByRole('link', { name: /use Onyx in browser/i })).toHaveAttribute('href', '/app/');
  });

  it('positions Onyx as a first-class cross-platform part of OnyxOS', () => {
    const { getByText, getByRole } = render(() => <OnyxOS />);

    expect(getByRole('heading', { name: /communication,\s*at home in the system/i })).toBeInTheDocument();
    expect(getByText(/first-class native experience in OnyxOS/i)).toBeInTheDocument();
    expect(getByText(/Onyx stays cross-platform/i)).toBeInTheDocument();
    expect(getByRole('link', { name: /use Onyx in browser/i })).toHaveAttribute('href', '/app/');
    expect(getByRole('link', { name: /see the native plan/i })).toHaveAttribute('href', '#onyx-native');
    expect(getByRole('link', { name: /see the product roadmap/i })).toHaveAttribute('href', '/roadmap/');
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

  it('publishes a major OnyxOS source specimen', () => {
    const { getByRole, getByText, container } = render(() => <OnyxOS />);

    expect(getByRole('heading', { name: /this is real OnyxOS code/i })).toBeInTheDocument();
    expect(getByText(/full 290-line clean-room implementation/i)).toBeInTheDocument();
    expect(getByRole('link', { name: /open the full source/i })).toHaveAttribute(
      'href',
      '/source/onyxos/safer_record_event_log_entry.c',
    );
    expect(getByText('safer_record_event_log_entry.c')).toBeInTheDocument();

    const specimen = container.querySelector('.onyxos-source__sheet pre');
    expect(specimen).toBeTruthy();
    // The excerpt stays byte-for-byte: it is published as evidence, not prose.
    expect(specimen!.textContent).toContain('OnyxSaferWriteEventLogEntry(');
    expect(specimen!.textContent).toContain('    OnyxSaferEnterCs();');
    expect(specimen!.textContent).toContain('&OnyxSaferEtwProviderGuid');
    // Its scroll must be reachable without a pointer.
    expect(specimen).toHaveAttribute('tabindex', '0');
  });

  it('stamps the canonical OnyxOS metadata', () => {
    render(() => <OnyxOS />);

    expect(document.title).toBe('OnyxOS + Onyx — communication at home in the system');
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${window.location.origin}/onyxos/`,
    );
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      'content',
      'See how Onyx is becoming a first-class native OnyxOS experience while staying cross-platform, backed by evidence-led system engineering.',
    );
  });
});

describe('OnyxOS compatibility-stage tabs', () => {
  it('exposes the tabs/panel relationship with one roving tab stop', () => {
    render(() => <OnyxOS />);
    const stageTabs = tabs();
    const panel = screen.getByRole('tabpanel');

    expect(stageTabs.map((tab) => tab.textContent)).toEqual(
      STAGE_TABS.map((label, index) => `${label}${['native behavior first', 'source with provenance', 'links or it is not done', 'the guest is the witness'][index]}`),
    );
    expect(panel).toHaveAttribute('id', 'onyxos-method-panel');

    for (const [index, tab] of stageTabs.entries()) {
      expect(tab).toHaveAttribute('id', `onyxos-method-tab-${['oracle', 'implementation', 'gate', 'boot'][index]}`);
      expect(tab).toHaveAttribute('aria-controls', 'onyxos-method-panel');
      expect(tab).toHaveAttribute('type', 'button');
    }

    // Exactly one tab stop; the rest are reached with arrow keys.
    expect(stageTabs.filter((tab) => tab.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(stageTabs[0]).toHaveAttribute('tabindex', '0');
    expect(stageTabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(panel).toHaveAttribute('aria-labelledby', 'onyxos-method-tab-oracle');
  });

  it('moves selection and focus with both arrow axes, wrapping at each end', () => {
    render(() => <OnyxOS />);
    const stageTabs = tabs();

    stageTabs[0]!.focus();
    fireEvent.keyDown(stageTabs[0]!, { key: 'ArrowRight' });
    expect(stageTabs[1]).toHaveFocus();
    expect(stageTabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(stageTabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(stageTabs[0]).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'onyxos-method-tab-implementation');

    fireEvent.keyDown(stageTabs[1]!, { key: 'ArrowDown' });
    expect(stageTabs[2]).toHaveFocus();
    expect(stageTabs[2]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(stageTabs[2]!, { key: 'ArrowLeft' });
    expect(stageTabs[1]).toHaveFocus();

    fireEvent.keyDown(stageTabs[1]!, { key: 'ArrowUp' });
    expect(stageTabs[0]).toHaveFocus();

    // Wrap backwards from the first tab, then forwards from the last.
    fireEvent.keyDown(stageTabs[0]!, { key: 'ArrowLeft' });
    expect(stageTabs[3]).toHaveFocus();
    expect(stageTabs[3]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(stageTabs[3]!, { key: 'ArrowRight' });
    expect(stageTabs[0]).toHaveFocus();
    expect(stageTabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('jumps to the first and last stage with Home and End', () => {
    render(() => <OnyxOS />);
    const stageTabs = tabs();

    stageTabs[0]!.focus();
    fireEvent.keyDown(stageTabs[0]!, { key: 'End' });
    expect(stageTabs[3]).toHaveFocus();
    expect(stageTabs[3]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/let the operating system answer back/i);

    fireEvent.keyDown(stageTabs[3]!, { key: 'Home' });
    expect(stageTabs[0]).toHaveFocus();
    expect(stageTabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/read the machine that already works/i);
  });

  it('leaves unrelated keys to the browser', () => {
    render(() => <OnyxOS />);
    const stageTabs = tabs();

    stageTabs[0]!.focus();
    fireEvent.keyDown(stageTabs[0]!, { key: 'Tab' });
    expect(stageTabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(stageTabs[0]).toHaveFocus();
  });

  it('still selects a stage by pointer', async () => {
    render(() => <OnyxOS />);
    const stageTabs = tabs();

    await fireEvent.click(stageTabs[2]!);
    expect(stageTabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(stageTabs[2]).toHaveAttribute('tabindex', '0');
    expect(stageTabs[0]).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'onyxos-method-tab-gate');
  });
});

describe('OnyxOS route CSS contracts', () => {
  it('namespaces route tokens so they cannot collide with PublicFrame --ink/--line', () => {
    const withoutComments = onyxosCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments).toMatch(/--onyxos-ink:/);
    expect(withoutComments).toMatch(/--onyxos-line:/);
    expect(withoutComments).not.toMatch(/(?:^|[^-])--ink:/);
    expect(withoutComments).not.toMatch(/(?:^|[^-])--line:/);
    expect(withoutComments).not.toMatch(/(?:^|[^-])--panel:/);
    expect(withoutComments).not.toMatch(/var\(--signal\)/);
    expect(withoutComments).not.toMatch(/var\(--paper\)/);
  });

  it('keeps decorative button arrows from shrinking under the shared zoom min-width rule', () => {
    expect(onyxosCss).toMatch(
      /\.onyxos-page \.onyxos-button > span\[aria-hidden='true'\][\s\S]*?min-width:\s*max-content/,
    );
    expect(onyxosCss).toMatch(
      /\.onyxos-page \.onyxos-button > span\[aria-hidden='true'\][\s\S]*?max-width:\s*none/,
    );
  });

  it('does not hide document overflow on the route root', () => {
    expect(onyxosCss).not.toMatch(/\.onyxos-page\s*\{[^}]*overflow(?:-x)?:\s*hidden/);
  });

  it('freezes motion and keeps a non-colour selected-tab cue', () => {
    expect(onyxosCss).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(onyxosCss).toMatch(/forced-colors:\s*active/);
    expect(onyxosCss).toMatch(/button\[aria-selected='true'\] > span[\s\S]*text-decoration:\s*underline/);
  });
});
