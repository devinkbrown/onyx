// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { webhookPayloadToMessage } from './webhookBlockKit';

describe('webhookBlockKit', () => {
  it('flattens blocks and embeds to IRC-safe text', () => {
    const text = webhookPayloadToMessage({
      username: 'Deploy Bot',
      content: 'Ship it',
      blocks: [
        { type: 'header', text: 'Release' },
        { type: 'divider' },
        { type: 'section', text: 'v1.2.3' },
      ],
      embeds: [{ title: 'Notes', description: 'fast path', fields: [{ name: 'sha', value: 'abc' }] }],
    });
    expect(text).toContain('Deploy Bot');
    expect(text).toContain('## Release');
    expect(text).toContain('sha: abc');
    // Newlines join lines; reject other C0 controls.
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/);
  });
});
