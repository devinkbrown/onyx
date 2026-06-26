import { describe, it, expect } from 'vitest';
import { render } from '@solidjs/testing-library';
import { ThemeProvider, THEME_IDS } from '@/theme';
import { backgroundOptions } from '@/backgrounds';
import Appearance from './Appearance';

const renderAppearance = () => render(() => (
  <ThemeProvider>
    <Appearance />
  </ThemeProvider>
));

describe('Appearance', () => {
  it('renders the customization hero', () => {
    const { getByText } = renderAppearance();
    expect(getByText(/make it/i)).toBeInTheDocument();
  });

  it('offers a chip for every theme and every background', () => {
    const { getAllByRole } = renderAppearance();
    const labels = getAllByRole('button').map((b) => b.textContent ?? '');
    // at least one chip per theme + per background (studio adds more)
    expect(getAllByRole('button').length).toBeGreaterThanOrEqual(THEME_IDS.length + backgroundOptions.length);
    expect(labels.join(' ')).toMatch(/onyx/i);
    expect(labels.join(' ')).toMatch(/gold veins/i);
  });

  it('marks the active theme chip as pressed', () => {
    const { getAllByRole } = renderAppearance();
    const pressed = getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed.length).toBeGreaterThan(0);
  });
});
