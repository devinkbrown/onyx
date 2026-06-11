import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IrcText from '@/components/chat/IrcText';

// ─────────────────────────────────────────────────────────────────────────────
// Regression: existing mIRC formatting behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('IrcText: mIRC formatting regression', () => {
  it('renders plain text unchanged', () => {
    render(<IrcText text="hello world" />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('renders bold spans for \\x02', () => {
    const { container } = render(<IrcText text={'\x02bold\x02 plain'} />);
    const bold = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === 'bold' && el.style.fontWeight === 'bold',
    );
    expect(bold).toBeTruthy();
  });

  it('renders italic spans for \\x1D', () => {
    const { container } = render(<IrcText text={'\x1Dital\x1D'} />);
    const ital = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === 'ital' && el.style.fontStyle === 'italic',
    );
    expect(ital).toBeTruthy();
  });

  it('renders colored spans for \\x03 color codes', () => {
    const { container } = render(<IrcText text={'\x0304red\x03 normal'} />);
    const colored = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === 'red' && el.style.color !== '',
    );
    expect(colored).toBeTruthy();
  });

  it('renders underline for \\x1F', () => {
    const { container } = render(<IrcText text={'\x1Funder\x1F'} />);
    const under = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === 'under' && el.style.textDecoration.includes('underline'),
    );
    expect(under).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: code fences
// ─────────────────────────────────────────────────────────────────────────────

describe('IrcText: code block regression', () => {
  it('renders fenced code with language chip and copy button', () => {
    render(<IrcText text={'```js\nconst a = 1;\n```'} />);
    expect(screen.getByText('js')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'copy' })).toBeInTheDocument();
    expect(screen.getByText('const a = 1;')).toBeInTheDocument();
  });

  it('defaults the language chip to "text"', () => {
    render(<IrcText text={'```\nplain code\n```'} />);
    expect(screen.getByText('text')).toBeInTheDocument();
  });

  it('renders text around a fence', () => {
    render(<IrcText text={'before ```\nc\n``` after'} />);
    expect(screen.getByText(/before/)).toBeInTheDocument();
    expect(screen.getByText(/after/)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inline code
// ─────────────────────────────────────────────────────────────────────────────

describe('IrcText: inline code', () => {
  it('renders single-backtick spans as <code>', () => {
    const { container } = render(<IrcText text="run `pnpm test` now" />);
    const code = container.querySelector('code.irc-inline-code');
    expect(code).toBeTruthy();
    expect(code?.textContent).toBe('pnpm test');
  });

  it('keeps surrounding text intact', () => {
    render(<IrcText text="run `x` now" />);
    expect(screen.getByText(/run/)).toBeInTheDocument();
    expect(screen.getByText(/now/)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spoilers
// ─────────────────────────────────────────────────────────────────────────────

describe('IrcText: spoilers', () => {
  it('renders ||text|| as a spoiler chip with aria-pressed=false', () => {
    render(<IrcText text="the killer is ||the butler||" />);
    const chip = screen.getByRole('button', { name: 'Reveal spoiler' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(chip.textContent).toBe('the butler');
  });

  it('reveals on click and toggles aria-pressed', async () => {
    const user = userEvent.setup();
    render(<IrcText text="||secret||" />);
    const chip = screen.getByRole('button', { name: 'Reveal spoiler' });
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip.className).toContain('irc-spoiler--revealed');
  });

  it('reveals via keyboard (Enter)', async () => {
    const user = userEvent.setup();
    render(<IrcText text="||secret||" />);
    const chip = screen.getByRole('button', { name: 'Reveal spoiler' });
    chip.focus();
    await user.keyboard('{Enter}');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('reveals via keyboard (Space)', async () => {
    const user = userEvent.setup();
    render(<IrcText text="||secret||" />);
    const chip = screen.getByRole('button', { name: 'Reveal spoiler' });
    chip.focus();
    await user.keyboard(' ');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('is focusable', () => {
    render(<IrcText text="||secret||" />);
    expect(screen.getByRole('button', { name: 'Reveal spoiler' })).toHaveAttribute('tabindex', '0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Embed integration
// ─────────────────────────────────────────────────────────────────────────────

describe('IrcText: embeds', () => {
  it('appends an embed card for a classified image URL', () => {
    render(<IrcText text="look https://x.com/a.png" />);
    const cards = screen.getAllByTestId('msg-embed');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute('data-embed-kind', 'image');
  });

  it('renders no embeds when embeds={false}', () => {
    render(<IrcText text="look https://x.com/a.png" embeds={false} />);
    expect(screen.queryByTestId('msg-embed')).toBeNull();
  });

  it('caps embeds at 3 and dedupes', () => {
    const text =
      'https://x.com/1.png https://x.com/1.png https://x.com/2.png ' +
      'https://x.com/3.png https://x.com/4.png';
    render(<IrcText text={text} />);
    expect(screen.getAllByTestId('msg-embed')).toHaveLength(3);
  });

  it('renders no embed for generic links', () => {
    render(<IrcText text="see https://example.com/page" />);
    expect(screen.queryByTestId('msg-embed')).toBeNull();
  });

  it('does not embed URLs inside code fences', () => {
    render(<IrcText text={'```\nhttps://x.com/a.png\n```'} />);
    expect(screen.queryByTestId('msg-embed')).toBeNull();
  });

  it('does not embed URLs inside spoilers', () => {
    render(<IrcText text="||https://x.com/a.png||" />);
    expect(screen.queryByTestId('msg-embed')).toBeNull();
  });

  it('is safe rendering hostile URLs as text', () => {
    expect(() =>
      render(<IrcText text={'javascript:alert(1) data:text/html,x <img src=x onerror=alert(1)>'} />),
    ).not.toThrow();
    expect(screen.queryByTestId('msg-embed')).toBeNull();
    // Rendered as text, never as markup.
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});
