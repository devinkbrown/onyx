// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/lib/irc/types';
import { LOCKED_PLACEHOLDER, toB64url } from './dmCipher';
import {
  DM_EMPTY_BODY,
  DM_EMPTY_TITLE,
  DM_KEY_CHANGE_BODY,
  DM_PRIVATE_CHIP,
  DM_PRIVATE_CHIP_LABEL,
  DM_SEALED_LIST_PREVIEW,
  DM_VERIFY_ACTION,
  dmHasPendingKeyChange,
  dmKeyChangeAlert,
  dmKeyChangeTitle,
  dmListPreviewText,
  dmPeerKeyPresent,
  dmSealReady,
  latestDmListPreview,
  showDmPrivateChip,
  type DmPrivacyChromeState,
} from './dmPrivacyChrome';

function validPeerKey(fill = 1): string {
  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.fill(fill, 1);
  return toB64url(raw);
}

function emptyState(): DmPrivacyChromeState {
  return {
    peerDmKeys: new Map(),
    peerDmDeviceKeys: new Map(),
    peerKeyChanges: new Map(),
  };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    time: new Date('2026-08-22T00:00:00.000Z'),
    from: 'trev',
    text: 'hello',
    type: 'msg',
    target: 'trev',
    ...overrides,
  };
}

const FORBIDDEN_CHROME = [
  /fully encrypted/i,
  /encrypted room/i,
  /group e2ee/i,
  /cloud sync/i,
  /\btofu\b/i,
  /\bmitm\b/i,
  /trust on first use/i,
  /first-use trust/i,
  /passkey/i,
  /🔒/,
];

describe('dmPrivacyChrome copy', () => {
  it('uses the 2026 trust-brief empty-state and list preview', () => {
    expect(DM_EMPTY_TITLE).toBe('A private conversation');
    expect(DM_EMPTY_BODY).toBe(
      'Only the two of you can read these messages. They stay on this device.',
    );
    expect(DM_SEALED_LIST_PREVIEW).toBe('Encrypted message');
    expect(DM_SEALED_LIST_PREVIEW).not.toMatch(/🔒|lock/i);
    expect(DM_PRIVATE_CHIP).toBe('Private');
    expect(DM_PRIVATE_CHIP_LABEL).toMatch(/only the two of you/i);
    expect(DM_PRIVATE_CHIP_LABEL).toMatch(/this device/i);
    expect(DM_VERIFY_ACTION).toBe('Verify');
  });

  it('rewrites key-change chrome without a MITM lecture', () => {
    expect(dmKeyChangeAlert('Trev')).toBe(
      "Trev's device key changed. Compare the new safety number before you continue.",
    );
    expect(dmKeyChangeTitle('Trev')).toBe("Trev's device key changed");
    expect(DM_KEY_CHANGE_BODY).toBe(
      'This usually means they reinstalled Onyx or added a device. Messages stay locked until you review it.',
    );
  });

  it('keeps forbidden over-claims out of chrome copy', () => {
    const chrome = [
      DM_EMPTY_TITLE,
      DM_EMPTY_BODY,
      DM_SEALED_LIST_PREVIEW,
      DM_PRIVATE_CHIP,
      DM_PRIVATE_CHIP_LABEL,
      DM_VERIFY_ACTION,
      DM_KEY_CHANGE_BODY,
      dmKeyChangeAlert('Trev'),
      dmKeyChangeTitle('Trev'),
    ].join('\n');
    for (const banned of FORBIDDEN_CHROME) {
      expect(chrome).not.toMatch(banned);
    }
  });
});

describe('dmPrivacyChrome seal gates', () => {
  it('requires a peer key and a sealable key before the Private chip', () => {
    const ready: DmPrivacyChromeState = {
      ...emptyState(),
      peerDmKeys: new Map([['trev', validPeerKey()]]),
    };
    expect(dmPeerKeyPresent(ready, 'Trev')).toBe(true);
    expect(dmSealReady(ready, 'Trev')).toBe(true);
    expect(showDmPrivateChip(ready, 'Trev')).toBe(true);
    expect(showDmPrivateChip(emptyState(), 'Trev')).toBe(false);
  });

  it('fails closed while a key-change is pending', () => {
    const pending: DmPrivacyChromeState = {
      peerDmKeys: new Map([['trev', validPeerKey()]]),
      peerDmDeviceKeys: new Map(),
      peerKeyChanges: new Map([['trev', { pinnedKey: 'old', newKey: 'new' }]]),
    };
    expect(dmPeerKeyPresent(pending, 'Trev')).toBe(true);
    expect(dmSealReady(pending, 'Trev')).toBe(false);
    expect(showDmPrivateChip(pending, 'Trev')).toBe(false);
    expect(dmHasPendingKeyChange(pending, 'Trev')).toBe(true);
  });

  it('does not treat a garbage published key as seal-ready', () => {
    const garbage: DmPrivacyChromeState = {
      ...emptyState(),
      peerDmKeys: new Map([['trev', 'not-a-sec1-point']]),
    };
    expect(dmPeerKeyPresent(garbage, 'Trev')).toBe(true);
    expect(dmSealReady(garbage, 'Trev')).toBe(false);
    expect(showDmPrivateChip(garbage, 'Trev')).toBe(false);
  });
});

describe('dmPrivacyChrome list preview', () => {
  it('uses Encrypted message for sealed bodies and locked placeholders', () => {
    expect(dmListPreviewText(message({
      encrypted: true,
      text: 'ONYXDM1 opaque-ciphertext',
    }))).toBe('Encrypted message');
    expect(dmListPreviewText(message({
      text: 'ONYXDM1 opaque-ciphertext',
    }))).toBe('Encrypted message');
    expect(dmListPreviewText(message({
      encrypted: true,
      text: 'ONYXDM1 opaque-ciphertext',
      plaintext: undefined,
    }))).not.toMatch(/🔒|ONYXDM1|opaque/);
    expect(dmListPreviewText(message({ text: LOCKED_PLACEHOLDER }))).toBe('Encrypted message');
  });

  it('previews opened plaintext on this device and skips system rows', () => {
    expect(dmListPreviewText(message({
      encrypted: true,
      text: 'ONYXDM1 opaque-ciphertext',
      plaintext: 'see you at eight',
    }))).toBe('see you at eight');
    expect(latestDmListPreview([
      message({ type: 'join', text: 'trev joined' }),
      message({ encrypted: true, text: 'ONYXDM1 later' }),
    ])).toBe('Encrypted message');
  });
});
