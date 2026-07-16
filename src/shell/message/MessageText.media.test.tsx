// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';

import { MessageText } from './MessageText';

describe('MessageText external media hardening', () => {
  afterEach(() => cleanup());

  it('loads direct images lazily without a referrer or a CORS-breaking mode', () => {
    const { container } = render(() => (
      <MessageText text="https://cdn.example.test/photos/harbour.png?size=large" />
    ));

    const image = container.querySelector('img.shell-msg-media-img');
    expect(image).toHaveAttribute('src', 'https://cdn.example.test/photos/harbour.png?size=large');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('decoding', 'async');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(image).not.toHaveAttribute('crossorigin');
    expect(image?.closest('a')).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('defers direct video and audio data until viewport and user intent', () => {
    const { container } = render(() => (
      <MessageText text="https://media.example.test/clip.mp4 https://media.example.test/voice.ogg" />
    ));

    const video = container.querySelector('video.shell-msg-media-video');
    const audio = container.querySelector('audio.shell-msg-media-audio');
    expect(video).toHaveAttribute('src', 'https://media.example.test/clip.mp4');
    expect(video).toHaveAttribute('loading', 'lazy');
    expect(video).toHaveAttribute('preload', 'none');
    expect(video).toHaveAttribute('controls');
    expect(video).not.toHaveAttribute('crossorigin');
    expect(audio).toHaveAttribute('src', 'https://media.example.test/voice.ogg');
    expect(audio).toHaveAttribute('loading', 'lazy');
    expect(audio).toHaveAttribute('preload', 'none');
    expect(audio).toHaveAttribute('controls');
    expect(audio).not.toHaveAttribute('crossorigin');
  });

  it.each([
    ['image', 'https://media.example.test/broken.png', 'Image preview unavailable — open attachment'],
    ['video', 'https://media.example.test/broken.webm', 'Video preview unavailable — open attachment'],
    ['audio', 'https://media.example.test/broken.wav', 'Audio preview unavailable — open attachment'],
  ] as const)('replaces a failed %s resource with a truthful direct link', (kind, href, label) => {
    const { container } = render(() => <MessageText text={href} />);
    const resource = container.querySelector(
      kind === 'image' ? 'img.shell-msg-media-img' : `${kind}.shell-msg-media-${kind}`,
    );
    expect(resource).not.toBeNull();

    fireEvent.error(resource!);

    expect(container.querySelector(`.shell-msg-media-${kind}`)).toBeNull();
    const fallback = screen.getByRole('link', { name: label });
    expect(fallback).toHaveAttribute('href', href);
    expect(fallback).toHaveAttribute('target', '_blank');
    expect(fallback).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('never auto-loads a credential-bearing URL as a message subresource', () => {
    const href = 'https://alice:secret@media.example.test/private.png';
    const { container } = render(() => <MessageText text={href} />);

    expect(container.querySelector('.shell-msg-media')).toBeNull();
    expect(container.querySelector('img, video, audio')).toBeNull();
    const explicitLink = screen.getByRole('link', { name: href });
    expect(explicitLink).toHaveAttribute('href', href);
  });
});
