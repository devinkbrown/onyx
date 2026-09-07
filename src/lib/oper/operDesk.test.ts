// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  isOperEventCategory,
  isOperObserveAction,
  MAX_BROADCAST_LENGTH,
  MAX_KILL_REASON_LENGTH,
  OPER_EVENT_CATEGORIES,
  operEventCategoryLabel,
  parseOperSlashCommand,
  planOperAction,
  type OperDeskIntent,
} from './operDesk';

function planned(intent: OperDeskIntent) {
  const plan = planOperAction(intent);
  if (!plan.ok) throw new Error(`expected ok plan, got: ${plan.errors.join(' | ')}`);
  return plan.command;
}

function refused(intent: OperDeskIntent) {
  const plan = planOperAction(intent);
  if (plan.ok) throw new Error(`expected refusal, got: ${plan.command.command}`);
  return plan.errors;
}

describe('planOperAction — broadcast', () => {
  it('uses EVENT BROADCAST, not the absent WALLOPS verb', () => {
    // ONYX_SERVER_PROTOCOL.md §16: there is no +w user-mode WALLOPS path.
    const command = planned({ kind: 'broadcast', text: '  Maintenance at 03:00 UTC  ' });
    expect(command.command).toBe('EVENT');
    expect(command.params).toEqual(['BROADCAST', 'Maintenance at 03:00 UTC']);
    expect(command.destructive).toBe(true);
    expect(command.summary).toContain('Maintenance at 03:00 UTC');
    expect(command.summary).toContain('operators subscribed to ANNOUNCE');
    expect(command.summary).not.toMatch(/every connected member/iu);
  });

  it('refuses an empty broadcast', () => {
    expect(refused({ kind: 'broadcast', text: '   ' })).toEqual(['Write the announcement first.']);
  });

  it('refuses a broadcast carrying a smuggled second wire command', () => {
    const errors = refused({ kind: 'broadcast', text: 'hello\r\nKILL someone :bye' });
    expect(errors.join(' ')).toContain('line breaks');
  });

  it('refuses a broadcast past the length bound', () => {
    const errors = refused({ kind: 'broadcast', text: 'x'.repeat(MAX_BROADCAST_LENGTH + 1) });
    expect(errors.join(' ')).toContain(String(MAX_BROADCAST_LENGTH));
  });

  it('accepts a broadcast exactly at the bound', () => {
    const text = 'x'.repeat(MAX_BROADCAST_LENGTH);
    expect(planned({ kind: 'broadcast', text }).params[1]).toBe(text);
  });
});

describe('planOperAction — Event Spine subscriptions', () => {
  it('normalizes category case for ADD and DEL', () => {
    expect(planned({ kind: 'event-subscribe', category: 'flood' }).params).toEqual(['ADD', 'FLOOD']);
    expect(planned({ kind: 'event-unsubscribe', category: ' Kill ' }).params).toEqual(['DEL', 'KILL']);
  });

  it('accepts every documented category', () => {
    for (const category of OPER_EVENT_CATEGORIES) {
      expect(planned({ kind: 'event-subscribe', category }).params).toEqual(['ADD', category]);
    }
  });

  it('refuses a category the daemon does not publish', () => {
    expect(refused({ kind: 'event-subscribe', category: 'GOSSIP' })).toHaveLength(1);
  });

  it('lists subscriptions without arguments', () => {
    expect(planned({ kind: 'event-list' }).params).toEqual(['LIST']);
  });
});

describe('planOperAction — OBSERVE', () => {
  it('emits the mask with no filters when none are chosen', () => {
    const command = planned({ kind: 'observe', mask: 'spammer!*@*.example' });
    expect(command.params).toEqual(['OBSERVE', 'spammer!*@*.example']);
  });

  it('deduplicates filters and emits them in documented order', () => {
    const command = planned({
      kind: 'observe',
      mask: 'a!b@c',
      actions: ['oper', 'connect', 'connect', 'nick'],
    });
    expect(command.params).toEqual(['OBSERVE', 'a!b@c', 'connect', 'nick', 'oper']);
  });

  it('accepts the daemon OBSERVE action tokens including join/part/host', () => {
    const command = planned({
      kind: 'observe',
      mask: 'a!b@c',
      actions: ['join', 'part', 'host'],
    });
    expect(command.params).toEqual(['OBSERVE', 'a!b@c', 'join', 'part', 'host']);
  });

  it('refuses an unknown filter rather than dropping it silently', () => {
    expect(refused({ kind: 'observe', mask: 'a!b@c', actions: ['spy'] })).toHaveLength(1);
  });

  it('accepts a mask at the daemon 256-byte ceiling and refuses one byte over', () => {
    const at_limit = `n!u@${'x'.repeat(252)}`;
    expect(at_limit.length).toBe(256);
    expect(planned({ kind: 'observe', mask: at_limit }).params[1]).toBe(at_limit);
    expect(refused({ kind: 'observe', mask: `${at_limit}y` })).toHaveLength(1);
  });

  it('refuses an all-wildcard mask that would observe the whole network', () => {
    expect(refused({ kind: 'observe', mask: '*!*@*' })).toHaveLength(1);
  });

  it('refuses a mask containing whitespace or control bytes', () => {
    expect(refused({ kind: 'observe', mask: 'a!b@c d' })).toHaveLength(1);
    expect(refused({ kind: 'observe', mask: 'a!b@c\nJOIN #x' })).toHaveLength(1);
  });

  it('lists and clears standing masks', () => {
    expect(planned({ kind: 'observe-list' }).params).toEqual(['OBSERVE', 'LIST']);
    expect(planned({ kind: 'observe-off' }).params).toEqual(['OBSERVE', 'OFF']);
  });
});

describe('planOperAction — node controls', () => {
  it('plans a bare REHASH and marks it destructive', () => {
    const command = planned({ kind: 'rehash' });
    expect(command.command).toBe('REHASH');
    expect(command.params).toEqual([]);
    expect(command.destructive).toBe(true);
  });

  it('plans a bare PRIVS as a safe read', () => {
    const command = planned({ kind: 'privs' });
    expect(command.command).toBe('PRIVS');
    expect(command.destructive).toBe(false);
  });
});

describe('planOperAction — KILL', () => {
  it('requires both a target and a reason', () => {
    expect(refused({ kind: 'kill', target: '', reason: 'spam' })).toHaveLength(1);
    expect(refused({ kind: 'kill', target: 'someone', reason: '  ' })).toEqual([
      'A reason is required — it is recorded network-wide.',
    ]);
  });

  it('plans the disconnect with the reason as the trailing param', () => {
    const command = planned({ kind: 'kill', target: 'floodbot', reason: 'repeat flooding' });
    expect(command.command).toBe('KILL');
    expect(command.params).toEqual(['floodbot', 'repeat flooding']);
    expect(command.destructive).toBe(true);
  });

  it('refuses a target that is a mask or carries separators', () => {
    expect(refused({ kind: 'kill', target: '*!*@*', reason: 'spam' })).toHaveLength(1);
    expect(refused({ kind: 'kill', target: 'a b', reason: 'spam' })).toHaveLength(1);
  });

  it('refuses a reason past the length bound', () => {
    const errors = refused({
      kind: 'kill',
      target: 'floodbot',
      reason: 'x'.repeat(MAX_KILL_REASON_LENGTH + 1),
    });
    expect(errors.join(' ')).toContain(String(MAX_KILL_REASON_LENGTH));
  });
});

describe('parseOperSlashCommand', () => {
  it('returns null for every non-operator verb so the caller falls through', () => {
    expect(parseOperSlashCommand('join', ['#root'])).toBeNull();
    expect(parseOperSlashCommand('', [])).toBeNull();
  });

  it('maps /wallops onto the real EVENT BROADCAST intent', () => {
    expect(parseOperSlashCommand('wallops', ['node', 'restart', 'soon'])).toEqual({
      kind: 'broadcast',
      text: 'node restart soon',
    });
    expect(parseOperSlashCommand('BROADCAST', ['hi'])).toEqual({ kind: 'broadcast', text: 'hi' });
  });

  it('keeps a multi-word kill reason whole', () => {
    // The generic passthrough would split this into separate params and
    // formatIRCLine only makes the LAST one trailing, truncating the reason.
    const intent = parseOperSlashCommand('kill', ['floodbot', 'repeat', 'flooding']);
    expect(intent).toEqual({ kind: 'kill', target: 'floodbot', reason: 'repeat flooding' });
    expect(planOperAction(intent!)).toMatchObject({
      ok: true,
      command: { params: ['floodbot', 'repeat flooding'] },
    });
  });

  it('routes /events subcommands', () => {
    expect(parseOperSlashCommand('events', [])).toEqual({ kind: 'event-list' });
    expect(parseOperSlashCommand('events', ['list'])).toEqual({ kind: 'event-list' });
    expect(parseOperSlashCommand('events', ['add', 'flood'])).toEqual({
      kind: 'event-subscribe',
      category: 'flood',
    });
    expect(parseOperSlashCommand('events', ['del', 'DEBUG'])).toEqual({
      kind: 'event-unsubscribe',
      category: 'DEBUG',
    });
  });

  it('routes /observe subcommands and carries filters', () => {
    expect(parseOperSlashCommand('observe', [])).toEqual({ kind: 'observe-list' });
    expect(parseOperSlashCommand('observe', ['off'])).toEqual({ kind: 'observe-off' });
    expect(parseOperSlashCommand('observe', ['a!b@c', 'connect', 'quit'])).toEqual({
      kind: 'observe',
      mask: 'a!b@c',
      actions: ['connect', 'quit'],
    });
  });

  it('maps the bare node commands', () => {
    expect(parseOperSlashCommand('rehash', [])).toEqual({ kind: 'rehash' });
    expect(parseOperSlashCommand('privs', [])).toEqual({ kind: 'privs' });
  });
});

describe('operDesk helpers', () => {
  it('guards the category and action type predicates', () => {
    expect(isOperEventCategory('SECURITY')).toBe(true);
    expect(isOperEventCategory('security')).toBe(false);
    expect(isOperEventCategory(7)).toBe(false);
    expect(isOperObserveAction('quit')).toBe(true);
    expect(isOperObserveAction('QUIT')).toBe(false);
  });

  it('humanizes category labels', () => {
    expect(operEventCategoryLabel('SERVER_LINK')).toBe('Server link');
    expect(operEventCategoryLabel('KILL')).toBe('Kill');
  });
});
