// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeClipboardText } from './writeClipboardText';

const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

function stubClipboard(writeText: unknown): void {
  const nextNavigator = Object.create(navigator) as Navigator;
  Object.defineProperty(nextNavigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  vi.stubGlobal('navigator', nextNavigator);
}

function stubExecCommand(implementation: (command: string) => boolean): ReturnType<typeof vi.fn> {
  const execCommand = vi.fn(implementation);
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: execCommand,
  });
  return execCommand;
}

describe('writeClipboardText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalExecCommand) {
      Object.defineProperty(document, 'execCommand', originalExecCommand);
    } else {
      Reflect.deleteProperty(document, 'execCommand');
    }
    document.querySelectorAll('textarea[aria-hidden="true"]').forEach((node) => node.remove());
  });

  it('reports modern Clipboard API success without creating a fallback textarea', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCommand = stubExecCommand(() => true);
    stubClipboard(writeText);

    await expect(writeClipboardText('copy me')).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith('copy me');
    expect(execCommand).not.toHaveBeenCalled();
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull();
  });

  it('uses the attached ephemeral fallback when the modern API is unavailable', async () => {
    stubClipboard(undefined);
    const focused = document.createElement('button');
    document.body.append(focused);
    focused.focus();
    let attachedDuringCopy = false;
    const execCommand = stubExecCommand(() => {
      attachedDuringCopy = document.querySelector('textarea[aria-hidden="true"]')?.isConnected === true;
      return true;
    });

    await expect(writeClipboardText('legacy value')).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(attachedDuringCopy).toBe(true);
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull();
    expect(document.activeElement).toBe(focused);
    focused.remove();
  });

  it('attempts the safe fallback after a rejected modern write', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
    const execCommand = stubExecCommand(() => true);
    stubClipboard(writeText);

    await expect(writeClipboardText('retry through legacy')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledOnce();
  });

  it('does not claim success when both pathways reject or return false', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const execCommand = stubExecCommand(() => false);
    stubClipboard(writeText);

    await expect(writeClipboardText('not copied')).resolves.toBe(false);
    expect(execCommand).toHaveBeenCalledOnce();
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull();
  });

  it('rejects a non-Promise Clipboard API result instead of reporting false success', async () => {
    const writeText = vi.fn().mockReturnValue(undefined);
    const execCommand = stubExecCommand(() => false);
    stubClipboard(writeText);

    await expect(writeClipboardText('broken API')).resolves.toBe(false);
    expect(execCommand).toHaveBeenCalledOnce();
  });

  it('does not invoke either pathway for empty text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCommand = stubExecCommand(() => true);
    stubClipboard(writeText);

    await expect(writeClipboardText('')).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });
});
