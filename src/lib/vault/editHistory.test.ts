// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  MAX_EDIT_BODY_LEN,
  MAX_EDIT_HISTORY_MESSAGES,
  MAX_EDIT_REVISIONS_PER_MESSAGE,
  recordEdit,
  revisionsFor,
} from './editHistory';

describe('editHistory', () => {
  it('records prior bodies', () => {
    let h = recordEdit({}, 'm1', 'first', 1);
    h = recordEdit(h, 'm1', 'second', 2);
    expect(revisionsFor(h, 'm1').map((r) => r.body)).toEqual(['first', 'second']);
  });

  it('ignores empty ids and bodies', () => {
    expect(recordEdit({}, '  ', 'body', 1)).toEqual({});
    expect(recordEdit({}, 'm1', '', 1)).toEqual({});
    expect(revisionsFor({}, 'm1')).toEqual([]);
  });

  it('trims message ids and caps body length', () => {
    const long = 'x'.repeat(MAX_EDIT_BODY_LEN + 40);
    const h = recordEdit({}, '  m9  ', long, 10);
    const revs = revisionsFor(h, 'm9');
    expect(revs).toHaveLength(1);
    expect(revs[0]!.body).toHaveLength(MAX_EDIT_BODY_LEN);
    expect(revs[0]!.editedAt).toBe(10);
  });

  it('keeps only the newest revisions per message', () => {
    let h = {};
    for (let i = 0; i < MAX_EDIT_REVISIONS_PER_MESSAGE + 3; i += 1) {
      h = recordEdit(h, 'm1', `body-${i}`, i + 1);
    }
    const revs = revisionsFor(h, 'm1');
    expect(revs).toHaveLength(MAX_EDIT_REVISIONS_PER_MESSAGE);
    expect(revs[0]!.body).toBe('body-3');
    expect(revs.at(-1)!.body).toBe(`body-${MAX_EDIT_REVISIONS_PER_MESSAGE + 2}`);
  });

  it('prunes oldest message keys when the map grows too large', () => {
    let h = {};
    for (let i = 0; i < MAX_EDIT_HISTORY_MESSAGES + 2; i += 1) {
      h = recordEdit(h, `m-${i}`, `prior-${i}`, i + 1);
    }
    expect(Object.keys(h)).toHaveLength(MAX_EDIT_HISTORY_MESSAGES);
    expect(revisionsFor(h, 'm-0')).toEqual([]);
    expect(revisionsFor(h, 'm-1')).toEqual([]);
    expect(revisionsFor(h, `m-${MAX_EDIT_HISTORY_MESSAGES + 1}`).map((r) => r.body)).toEqual([
      `prior-${MAX_EDIT_HISTORY_MESSAGES + 1}`,
    ]);
  });

  it('returns a new object (immutable update)', () => {
    const prev = {};
    const next = recordEdit(prev, 'm1', 'hello', 1);
    expect(next).not.toBe(prev);
    expect(prev).toEqual({});
    expect(revisionsFor(next, 'm1')[0]!.body).toBe('hello');
  });
});
