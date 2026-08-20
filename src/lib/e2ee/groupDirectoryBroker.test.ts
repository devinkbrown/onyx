import { describe, expect, it, vi } from 'vitest';
import { GroupDirectoryBroker, GROUP_DIRECTORY_MAX_WAITERS_PER_ACCOUNT, groupDirectoryListParameters } from './groupDirectoryBroker';

function line(account: string, id = 'x'): string { return `E2EEKEY DEVICE account=${account} id=${id} alg=old key=x`; }
describe('group directory broker', () => {
  it('formats only the exact LIST parameters; IRC framing remains outside this seam', () => {
    expect(groupDirectoryListParameters(' Alice ')).toEqual(['LIST', 'alice']);
    expect(groupDirectoryListParameters('bad space')).toBeNull();
  });
  it('serializes requests and resolves only a complete authenticated snapshot', async () => {
    const sent: string[] = []; const broker = new GroupDirectoryBroker({ sendList: (a) => { sent.push(a); } });
    const first = broker.request('Alice'); const second = broker.request('Bob');
    expect(sent).toEqual(['alice']); expect(broker.observeServerReply(0, line('alice'))).toBe(true);
    expect(broker.observeServerReply(0, 'E2EEKEY END account=alice devices=1')).toBe(true);
    expect((await first).ok).toBe(true); expect(sent).toEqual(['alice', 'bob']);
    broker.observeServerReply(0, line('bob')); broker.observeServerReply(0, 'E2EEKEY END account=bob devices=1');
    expect((await second).ok).toBe(true);
  });
  it('rejects user-authored NOTICE framing and stale generations', async () => {
    const broker = new GroupDirectoryBroker({ sendList: () => undefined }); const wait = broker.request('alice');
    expect(broker.observeServerReply(0, ':user NOTICE me :E2EEKEY DEVICE account=alice id=x alg=old key=x')).toBe(false);
    broker.resetGeneration(); expect((await wait).ok && 'bad').toBe(false);
  });
  it('times out and respects abort', async () => {
    const timers: (() => void)[] = []; const broker = new GroupDirectoryBroker({ sendList: () => undefined, setTimer: (fn) => { timers.push(fn); return 1 as unknown as ReturnType<typeof setTimeout>; }, clearTimer: () => undefined });
    const pending = broker.request('alice'); timers[0]!(); await expect(pending).resolves.toMatchObject({ ok: false, reason: 'timeout' });
    const controller = new AbortController(); const aborted = broker.request('bob', controller.signal); controller.abort(); await expect(aborted).resolves.toMatchObject({ ok: false, reason: 'aborted' });
  });
  it('resolves an already-aborted request immediately without allocating a wire slot', async () => {
    const send = vi.fn(); const broker = new GroupDirectoryBroker({ sendList: send }); const controller = new AbortController(); controller.abort();
    await expect(broker.request('alice', controller.signal)).resolves.toEqual({ ok: false, reason: 'aborted' }); expect(send).not.toHaveBeenCalled();
  });
  it('bounds same-account waiters without resolver recursion and aborts each independently', async () => {
    const send = vi.fn(); const broker = new GroupDirectoryBroker({ sendList: send });
    const root = broker.request('alice'); const controllers = Array.from({ length: GROUP_DIRECTORY_MAX_WAITERS_PER_ACCOUNT - 1 }, () => new AbortController());
    const waiters = controllers.map((controller) => broker.request('alice', controller.signal));
    const overflow = broker.request('alice');
    controllers[0]!.abort(); await expect(waiters[0]).resolves.toEqual({ ok: false, reason: 'aborted' });
    expect(send).toHaveBeenCalledTimes(1); expect(await overflow).toEqual({ ok: false, reason: 'capacity' });
    broker.observeServerReply(0, line('alice')); broker.observeServerReply(0, 'E2EEKEY END account=alice devices=1');
    await expect(root).resolves.toMatchObject({ ok: true }); await expect(Promise.all(waiters.slice(1))).resolves.toHaveLength(GROUP_DIRECTORY_MAX_WAITERS_PER_ACCOUNT - 2);
  });
  it('drains a cancelled active wire slot before allowing same-account replacement', async () => {
    const send = vi.fn(() => undefined); const broker = new GroupDirectoryBroker({ sendList: send });
    const firstAbort = new AbortController(); const first = broker.request('alice', firstAbort.signal); firstAbort.abort();
    await expect(first).resolves.toEqual({ ok: false, reason: 'aborted' });
    const replacement = broker.request('alice'); expect(send).toHaveBeenCalledTimes(1);
    // These are the old request; they release the drain but cannot resolve the replacement.
    expect(broker.observeServerReply(0, line('alice', 'old'))).toBe(true);
    expect(broker.observeServerReply(0, 'E2EEKEY END account=alice devices=1')).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    broker.observeServerReply(0, line('alice', 'new')); broker.observeServerReply(0, 'E2EEKEY END account=alice devices=1');
    await expect(replacement).resolves.toMatchObject({ ok: true });
  });
  it('does not let a delayed old transport rejection delete a replacement', async () => {
    let rejectOld!: (reason?: unknown) => void; const send = vi.fn(() => send.mock.calls.length === 1 ? new Promise<void>((_resolve, reject) => { rejectOld = reject; }) : undefined);
    const broker = new GroupDirectoryBroker({ sendList: send }); const abort = new AbortController(); const old = broker.request('alice', abort.signal); abort.abort(); await old;
    const replacement = broker.request('alice'); broker.observeServerReply(0, line('alice')); broker.observeServerReply(0, 'E2EEKEY END account=alice devices=1');
    expect(send).toHaveBeenCalledTimes(2); rejectOld(new Error('late'));
    broker.observeServerReply(0, line('alice')); broker.observeServerReply(0, 'E2EEKEY END account=alice devices=1'); await expect(replacement).resolves.toMatchObject({ ok: true });
  });
  it('generation-desyncs queued replacement when a cancelled active slot never reaches END', async () => {
    const timers: (() => void)[] = []; const send = vi.fn(); const broker = new GroupDirectoryBroker({ sendList: send, setTimer: (fn) => { timers.push(fn); return timers.length as unknown as ReturnType<typeof setTimeout>; }, clearTimer: () => undefined });
    const cancel = new AbortController(); const old = broker.request('alice', cancel.signal); cancel.abort(); await old;
    const replacement = broker.request('alice'); timers[0]!();
    await expect(replacement).resolves.toEqual({ ok: false, reason: 'stale-generation' }); expect(send).toHaveBeenCalledTimes(1);
  });
  it('skips a cancelled queued replacement and starts the following request', async () => {
    const sent: string[] = []; const broker = new GroupDirectoryBroker({ sendList: (account) => { sent.push(account); } }); const first = broker.request('alice');
    const cancel = new AbortController(); const cancelled = broker.request('bob', cancel.signal); const after = broker.request('carol'); cancel.abort();
    await expect(cancelled).resolves.toEqual({ ok: false, reason: 'aborted' }); broker.observeServerReply(0, line('alice')); broker.observeServerReply(0, 'E2EEKEY END account=alice devices=1'); await first;
    expect(sent).toEqual(['alice', 'carol']); broker.observeServerReply(0, line('carol')); broker.observeServerReply(0, 'E2EEKEY END account=carol devices=1'); await expect(after).resolves.toMatchObject({ ok: true });
  });
  it('retires the whole old queue before reset can admit another wire request', async () => {
    const sent: string[] = []; const broker = new GroupDirectoryBroker({ sendList: (account) => { sent.push(account); } });
    const alice = broker.request('alice'); const bob = broker.request('bob');
    expect(sent).toEqual(['alice']); broker.resetGeneration();
    await expect(alice).resolves.toEqual({ ok: false, reason: 'stale-generation' }); await expect(bob).resolves.toEqual({ ok: false, reason: 'stale-generation' });
    expect(sent).toEqual(['alice']);
    const fresh = broker.request('bob'); expect(sent).toEqual(['alice', 'bob']);
    // An authenticated reply from generation zero must not complete fresh bob.
    expect(broker.observeServerReply(0, line('bob', 'old'))).toBe(false); expect(broker.observeServerReply(0, 'E2EEKEY END account=bob devices=1')).toBe(false);
    broker.observeServerReply(1, line('bob', 'fresh')); broker.observeServerReply(1, 'E2EEKEY END account=bob devices=1'); await expect(fresh).resolves.toMatchObject({ ok: true });
  });
  it('retire-desyncs the entire queued set on active timeout without sending it', async () => {
    const timers: (() => void)[] = []; const sent: string[] = [];
    const broker = new GroupDirectoryBroker({ sendList: (account) => { sent.push(account); }, setTimer: (callback) => { timers.push(callback); return timers.length as unknown as ReturnType<typeof setTimeout>; }, clearTimer: () => undefined });
    const alice = broker.request('alice'); const bob = broker.request('bob'); expect(sent).toEqual(['alice']); timers[0]!();
    await expect(alice).resolves.toEqual({ ok: false, reason: 'timeout' }); await expect(bob).resolves.toEqual({ ok: false, reason: 'stale-generation' }); expect(sent).toEqual(['alice']);
    const fresh = broker.request('bob'); expect(broker.observeServerReply(0, line('bob'))).toBe(false); expect(sent).toEqual(['alice', 'bob']); broker.observeServerReply(1, line('bob')); broker.observeServerReply(1, 'E2EEKEY END account=bob devices=1'); await expect(fresh).resolves.toMatchObject({ ok: true });
  });
  it('shares cache only for a short TTL and keeps one wire request', async () => {
    let now = 0; const send = vi.fn(); const broker = new GroupDirectoryBroker({ sendList: send, now: () => now }); const first = broker.request('alice'); broker.observeServerReply(0, line('alice')); broker.observeServerReply(0, 'E2EEKEY END account=alice devices=1'); await first; await broker.request('ALICE'); expect(send).toHaveBeenCalledTimes(1); now = 31_000; const later = broker.request('alice'); expect(send).toHaveBeenCalledTimes(2); broker.observeServerReply(0, line('alice')); broker.observeServerReply(0, 'E2EEKEY END account=alice devices=1'); await later;
  });
});
