// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';

import { setPreference } from '@/lib/prefs/preferences';
import { clearVault, importVault, loadRecent, parseVaultExport } from '@/lib/vault/historyVault';
import { MessageText } from './MessageText';

describe('MessageText external media hardening', () => {
  afterEach(async () => {
    cleanup();
    setPreference('linkPreviews', true);
    setPreference('httpsOnly', true);
    setPreference('blockedHosts', []);
    await clearVault();
  });

  it('waits for explicit consent before creating an external image resource', () => {
    const href = 'https://cdn.example.test/photos/harbour.png?size=large';
    const { container } = render(() => (
      <MessageText text={href} />
    ));

    expect(container.querySelector('img, video, audio')).toBeNull();
    fireEvent.click(screen.getByRole('button', {
      name: 'Load external image from cdn.example.test',
    }));

    const image = container.querySelector('img.shell-msg-media-img');
    expect(image).toHaveAttribute('src', href);
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('decoding', 'async');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(image).not.toHaveAttribute('crossorigin');
    expect(image?.closest('a')).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('preserves automatic same-origin image previews', () => {
    const href = new URL('/uploads/local.png', window.location.href).toString();
    const { container } = render(() => <MessageText text={href} />);

    expect(container.querySelector('img.shell-msg-media-img')).toHaveAttribute('src', href);
    expect(container.querySelector('.shell-msg-media-consent')).toBeNull();
  });

  it('preserves same-origin video and audio while deferring their data', () => {
    const videoHref = new URL('/uploads/clip.mp4', window.location.href).toString();
    const audioHref = new URL('/uploads/voice.ogg', window.location.href).toString();
    const { container } = render(() => (
      <MessageText text={`${videoHref} ${audioHref}`} />
    ));

    const video = container.querySelector('video.shell-msg-media-video');
    const audio = container.querySelector('audio.shell-msg-media-audio');
    expect(video).toHaveAttribute('src', videoHref);
    expect(video).toHaveAttribute('loading', 'lazy');
    expect(video).toHaveAttribute('preload', 'none');
    expect(video).toHaveAttribute('controls');
    expect(video).not.toHaveAttribute('crossorigin');
    expect(audio).toHaveAttribute('src', audioHref);
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
    expect(container.querySelector('img, video, audio')).toBeNull();
    fireEvent.click(screen.getByRole('button', {
      name: `Load external ${kind} from media.example.test`,
    }));
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

  it('creates no media resource or consent nodes when previews are disabled', () => {
    setPreference('linkPreviews', false);
    const imageHref = new URL('/uploads/local.png', window.location.href).toString();
    const videoHref = new URL('/uploads/local.mp4', window.location.href).toString();
    const { container } = render(() => (
      <MessageText text={`${imageHref} ${videoHref} https://cdn.example.test/external.png https://cdn.example.test/page`} />
    ));

    expect(container.querySelector('img, video, audio')).toBeNull();
    expect(container.querySelector('.shell-msg-media-consent')).toBeNull();
    expect(container.querySelector('.shell-msg-preview')).toBeNull();
  });

  it('does not unfurl external media on a blocked host', () => {
    setPreference('blockedHosts', ['cdn.example.test']);
    const { container } = render(() => (
      <MessageText text="https://cdn.example.test/photos/harbour.png" />
    ));
    expect(container.querySelector('img, video, audio')).toBeNull();
    expect(container.querySelector('.shell-msg-media-consent')).toBeNull();
  });

  it('does not unfurl plain http media when httpsOnly is on', () => {
    setPreference('httpsOnly', true);
    const { container } = render(() => (
      <MessageText text="http://cdn.example.test/photos/harbour.png" />
    ));
    expect(container.querySelector('img, video, audio')).toBeNull();
    expect(container.querySelector('.shell-msg-media-consent')).toBeNull();
  });

  it('keeps imported vault image URLs inert until the viewer consents', async () => {
    const href = 'https://tracker.example.test/imported.png';
    const target = '#external-media-import';
    const snapshot = parseVaultExport({
      kind: 'onyx-vault',
      version: 1,
      exportedAt: '2026-07-16T00:00:00.000Z',
      targets: [{
        target,
        messages: [{
          id: 'imported-image-1',
          time: '2026-07-16T00:00:00.000Z',
          from: 'attacker',
          text: href,
          type: 'msg',
          target,
        }],
      }],
    });
    expect(snapshot).not.toBeNull();
    expect(await importVault(snapshot!)).toEqual({ targets: 1, messages: 1 });
    const [imported] = await loadRecent(target);
    expect(imported?.text).toBe(href);

    const { container } = render(() => <MessageText text={imported?.text ?? ''} />);
    expect(container.querySelector('img, video, audio')).toBeNull();

    fireEvent.click(screen.getByRole('button', {
      name: 'Load external image from tracker.example.test',
    }));
    expect(container.querySelector('img.shell-msg-media-img')).toHaveAttribute('src', href);
  });

  it('never auto-loads a credential-bearing URL as a message subresource', () => {
    const href = 'https://alice:secret@media.example.test/private.png';
    const { container } = render(() => <MessageText text={href} />);

    expect(container.querySelector('.shell-msg-media')).toBeNull();
    expect(container.querySelector('img, video, audio')).toBeNull();
    const explicitLink = screen.getByRole('link', { name: href });
    expect(explicitLink).toHaveAttribute('href', href);
  });

  it.each([
    'http://127.0.0.1/private.png',
    'http://localhost/private.mp4',
    'http://192.168.1.1/private.wav',
    'http://[::1]/private.webp',
  ])('never auto-loads an internal URL as a message subresource: %s', (href) => {
    const { container } = render(() => <MessageText text={href} />);

    expect(container.querySelector('.shell-msg-media')).toBeNull();
    expect(container.querySelector('img, video, audio')).toBeNull();
    const explicitLink = screen.getByRole('link', { name: href });
    expect(explicitLink).toHaveAttribute('href', href);
  });
});
