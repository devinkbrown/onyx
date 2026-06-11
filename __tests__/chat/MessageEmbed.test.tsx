import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageEmbed from '@/components/chat/MessageEmbed';
import { classifyUrl } from '@/lib/embeds';
import type { Embed } from '@/lib/embeds';

function embedFor(url: string, mediaOrigin?: string): Embed {
  const embed = classifyUrl(url, mediaOrigin ? { mediaOrigin } : undefined);
  if (!embed) throw new Error(`expected classifiable url: ${url}`);
  return embed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Image embeds
// ─────────────────────────────────────────────────────────────────────────────

describe('MessageEmbed: image', () => {
  it('renders a lazy, no-referrer image', () => {
    const { container } = render(<MessageEmbed embed={embedFor('https://x.com/a.png')} />);
    const img = container.querySelector('img.embed-image-img');
    expect(img).toBeTruthy();
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img).toHaveAttribute('src', 'https://x.com/a.png');
  });

  it('reserves a ratio box (skeleton) while loading', () => {
    render(<MessageEmbed embed={embedFor('https://x.com/a.png')} />);
    const frame = screen.getByTestId('embed-image-frame');
    expect(frame.className).toContain('embed-image-frame--loading');
    expect(frame.style.aspectRatio).not.toBe('');
  });

  it('shows the broken-media placeholder on error', () => {
    const { container } = render(<MessageEmbed embed={embedFor('https://x.com/a.png')} />);
    const img = container.querySelector('img.embed-image-img')!;
    fireEvent.error(img);
    expect(screen.getByRole('img', { name: 'image unavailable' })).toBeInTheDocument();
    expect(container.querySelector('.embed-error-ring--inner')).toBeTruthy();
  });

  it('locks aspect ratio from natural dimensions on load', () => {
    const { container } = render(<MessageEmbed embed={embedFor('https://x.com/a.png')} />);
    const img = container.querySelector('img.embed-image-img') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 800 });
    Object.defineProperty(img, 'naturalHeight', { value: 400 });
    fireEvent.load(img);
    const frame = screen.getByTestId('embed-image-frame');
    expect(frame.style.aspectRatio).toMatch(/^2( \/ 1)?$/);
    expect(frame.className).not.toContain('embed-image-frame--loading');
  });

  it('opens the lightbox on click', async () => {
    const user = userEvent.setup();
    render(<MessageEmbed embed={embedFor('https://x.com/a.png')} />);
    await user.click(screen.getByTestId('embed-image-frame'));
    expect(screen.getByRole('dialog', { name: 'Image viewer' })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Video / audio embeds
// ─────────────────────────────────────────────────────────────────────────────

describe('MessageEmbed: video', () => {
  it('renders native video controls with metadata preload', () => {
    render(<MessageEmbed embed={embedFor('https://x.com/clip.mp4')} />);
    const video = screen.getByTestId('embed-video');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(video).toHaveAttribute('src', 'https://x.com/clip.mp4');
  });

  it('shows error placeholder when the video fails', () => {
    render(<MessageEmbed embed={embedFor('https://x.com/clip.mp4')} />);
    fireEvent.error(screen.getByTestId('embed-video'));
    expect(screen.getByRole('img', { name: 'video unavailable' })).toBeInTheDocument();
  });
});

describe('MessageEmbed: audio', () => {
  it('renders native audio controls and filename', () => {
    render(<MessageEmbed embed={embedFor('https://x.com/song.flac')} />);
    expect(screen.getByTestId('embed-audio')).toHaveAttribute('controls');
    expect(screen.getByText('song.flac')).toBeInTheDocument();
  });

  it('shows error placeholder when audio fails', () => {
    render(<MessageEmbed embed={embedFor('https://x.com/song.mp3')} />);
    fireEvent.error(screen.getByTestId('embed-audio'));
    expect(screen.getByRole('img', { name: 'audio unavailable' })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// File embeds
// ─────────────────────────────────────────────────────────────────────────────

describe('MessageEmbed: file', () => {
  const ORIGIN = 'https://media.example.com';

  it('renders extension chip, filename, and size-unknown label', () => {
    render(
      <MessageEmbed embed={embedFor(`${ORIGIN}/uploads/report.pdf`, ORIGIN)} />,
    );
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('size unknown')).toBeInTheDocument();
  });

  it('opens in a new tab with safe rel', () => {
    render(
      <MessageEmbed embed={embedFor(`${ORIGIN}/uploads/data.zip`, ORIGIN)} />,
    );
    const link = screen.getByTestId('embed-file');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// YouTube / Vimeo click-to-embed
// ─────────────────────────────────────────────────────────────────────────────

describe('MessageEmbed: youtube', () => {
  const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  it('renders only a thumbnail poster before click — no iframe', () => {
    const { container } = render(<MessageEmbed embed={embedFor(URL)} />);
    expect(screen.queryByTestId('embed-player-iframe')).toBeNull();
    const thumb = container.querySelector('img.embed-player-thumb');
    expect(thumb).toHaveAttribute('src', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(thumb).toHaveAttribute('loading', 'lazy');
    expect(thumb).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('swaps to a nocookie iframe only on click', async () => {
    const user = userEvent.setup();
    render(<MessageEmbed embed={embedFor(URL)} />);
    await user.click(screen.getByTestId('embed-player-poster'));
    const iframe = screen.getByTestId('embed-player-iframe');
    expect(iframe.getAttribute('src')).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(iframe).toHaveAttribute('sandbox');
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  });
});

describe('MessageEmbed: vimeo', () => {
  const URL = 'https://vimeo.com/123456789';

  it('renders a poster without any third-party request before click', () => {
    const { container } = render(<MessageEmbed embed={embedFor(URL)} />);
    expect(screen.queryByTestId('embed-player-iframe')).toBeNull();
    // Privacy: no thumbnail fetch for vimeo at all.
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Vimeo')).toBeInTheDocument();
  });

  it('swaps to a dnt iframe on click', async () => {
    const user = userEvent.setup();
    render(<MessageEmbed embed={embedFor(URL)} />);
    await user.click(screen.getByTestId('embed-player-poster'));
    expect(screen.getByTestId('embed-player-iframe').getAttribute('src')).toBe(
      'https://player.vimeo.com/video/123456789?dnt=1&autoplay=1',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generic links render nothing
// ─────────────────────────────────────────────────────────────────────────────

describe('MessageEmbed: link kind', () => {
  it('renders nothing for generic links', () => {
    const { container } = render(
      <MessageEmbed embed={{ kind: 'link', url: 'https://example.com/' }} />,
    );
    expect(container.querySelector('[data-testid="msg-embed"]')).toBeNull();
  });
});
