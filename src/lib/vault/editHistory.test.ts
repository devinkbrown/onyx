// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { recordEdit, revisionsFor } from './editHistory';

describe('editHistory', () => {
  it('records prior bodies', () => {
    let h = recordEdit({}, 'm1', 'first', 1);
    h = recordEdit(h, 'm1', 'second', 2);
    expect(revisionsFor(h, 'm1').map((r) => r.body)).toEqual(['first', 'second']);
  });
});
