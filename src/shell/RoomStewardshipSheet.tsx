// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Quiet harbor Room care sheet for 3–30 person rooms.
 * One owner, two helpers, accept-to-take, owner close/delete.
 * Leave uses the existing harbor confirm — this sheet does not grow
 * Mute / Hide / Leave.
 */
import './room-stewardship.css';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { useStore } from '@/lib/store';
import {
  STEWARDSHIP_COPY,
  actorIsOwner,
  canAddCoAdmin,
  canCompleteTransfer,
  canDeleteRoom,
  isConsumerStewardshipRoom,
  lastMemberLeaveDissolves,
  listCoAdmins,
  listOwners,
  memberCount,
  membersCanInvite,
  typedNameMatchesRoom,
  type StewardMember,
} from '@/lib/rooms/roomStewardship';
import {
  acceptRoomOwnership,
  addRoomCoAdmin,
  closeConsumerRoom,
  declineRoomOwnership,
  deleteConsumerRoom,
  grantRoomOwnership,
  offerRoomOwnership,
  removeRoomCoAdmin,
  snapshotStewardMembers,
} from '@/lib/rooms/roomStewardshipActions';
import { subscribeRoomTransfers, transferFor } from '@/lib/rooms/roomTransferMemory';
import { Button } from '@/primitives/index';
import { createDialogFocus } from '@/primitives/focusTrap';
import { openRoomInviteShare } from './roomInviteShareState';
import { openLeaveRoomConfirm } from './roomVerbConfirm';
import {
  closeRoomStewardship,
  roomStewardshipTarget,
} from './roomStewardshipState';

function membersFromStore(channel: string, tick: number): StewardMember[] {
  void tick;
  return snapshotStewardMembers(channel);
}

export function RoomStewardshipHost() {
  const target = createMemo(() => roomStewardshipTarget());
  const channels = useStore((s) => s.channels);
  const ourNick = useStore((s) => s.ourNick);
  const connectionStatus = useStore((s) => s.connectionStatus);
  const [offerTick, setOfferTick] = createSignal(0);
  const [helper, setHelper] = createSignal('');
  const [successor, setSuccessor] = createSignal('');
  const [typedName, setTypedName] = createSignal('');
  const [status, setStatus] = createSignal('');
  const [closing, setClosing] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  let panelRef: HTMLElement | undefined;

  createDialogFocus({
    isOpen: () => target() !== null,
    getPanel: () => panelRef,
    onEscape: () => closeRoomStewardship(),
  });

  createEffect(() => {
    const unsub = subscribeRoomTransfers(() => setOfferTick((n) => n + 1));
    onCleanup(unsub);
  });

  createEffect(() => {
    void target()?.channel;
    setHelper('');
    setSuccessor('');
    setTypedName('');
    setStatus('');
    setClosing(false);
    setDeleting(false);
  });

  const channelName = createMemo(() => target()?.channel ?? '');
  const liveMembers = createMemo(() => {
    void channels();
    void offerTick();
    const name = channelName();
    if (!name) return [] as StewardMember[];
    return membersFromStore(name, offerTick());
  });
  const count = createMemo(() => memberCount(liveMembers()));
  const owners = createMemo(() => listOwners(liveMembers()));
  const helpers = createMemo(() => listCoAdmins(liveMembers()));
  const isOwner = createMemo(() => actorIsOwner(liveMembers(), ourNick()));
  const offer = createMemo(() => {
    void offerTick();
    const name = channelName();
    return name ? transferFor(name) : null;
  });
  const offeredToUs = createMemo(() => {
    const current = offer();
    return !!current && current.to.toLowerCase() === ourNick().trim().toLowerCase();
  });
  const helperCandidates = createMemo(() =>
    liveMembers().filter((member) => {
      const key = member.nick.trim().toLowerCase();
      if (owners().some((name) => name.toLowerCase() === key)) return false;
      if (helpers().some((name) => name.toLowerCase() === key)) return false;
      return true;
    }),
  );
  const transferCandidates = createMemo(() =>
    liveMembers().filter((member) => member.nick.trim().toLowerCase() !== ourNick().trim().toLowerCase()),
  );
  const connected = createMemo(() => connectionStatus() === 'connected');

  function note(result: { ok: true } | { ok: false; reason: string }): void {
    setStatus(result.ok ? '' : result.reason);
  }

  return (
    <Show when={target()}>
      {(current) => (
        <Portal>
          <div class="harbor-steward" role="presentation" data-testid="harbor-steward">
            <div
              class="harbor-steward__backdrop"
              aria-hidden="true"
              onClick={() => closeRoomStewardship()}
            />
            <section
              ref={panelRef}
              class="harbor-steward__panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="harbor-steward-title"
              aria-describedby="harbor-steward-body"
              tabindex="-1"
              data-room={current().channel}
            >
              <Show
                when={offeredToUs() && !offer()?.accepted}
                fallback={
                  <>
                    <h2 id="harbor-steward-title" class="harbor-steward__title">
                      {STEWARDSHIP_COPY.title}
                    </h2>
                    <p id="harbor-steward-body" class="harbor-steward__body">
                      {STEWARDSHIP_COPY.blurb}
                    </p>

                    <section class="harbor-steward__section" aria-labelledby="harbor-steward-owner">
                      <h3 id="harbor-steward-owner" class="harbor-steward__label">Owner</h3>
                      <p class="harbor-steward__name" data-testid="harbor-steward-owner">
                        {owners()[0] ?? 'This room does not have an owner yet.'}
                      </p>
                    </section>

                    <section class="harbor-steward__section" aria-labelledby="harbor-steward-helpers">
                      <h3 id="harbor-steward-helpers" class="harbor-steward__label">
                        People who can help
                      </h3>
                      <Show
                        when={helpers().length > 0}
                        fallback={<p class="harbor-steward__body">None yet. Up to two.</p>}
                      >
                        <ul class="harbor-steward__list">
                          <For each={helpers()}>
                            {(name) => (
                              <li class="harbor-steward__row">
                                <span class="harbor-steward__name">{name}</span>
                                <Show when={isOwner()}>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    data-testid={`harbor-steward-remove-${name.toLowerCase()}`}
                                    onClick={() => note(removeRoomCoAdmin(current().channel, name))}
                                  >
                                    Remove
                                  </Button>
                                </Show>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                      <Show when={isOwner() && isConsumerStewardshipRoom(count())}>
                        <Show
                          when={canAddCoAdmin(helpers())}
                          fallback={
                            <p class="harbor-steward__status" data-testid="harbor-steward-helper-cap">
                              {STEWARDSHIP_COPY.thirdCoAdmin}
                            </p>
                          }
                        >
                          <label class="harbor-steward__label" for="harbor-steward-helper">
                            Add someone who can help
                          </label>
                          <select
                            id="harbor-steward-helper"
                            class="harbor-steward__field"
                            data-testid="harbor-steward-helper"
                            value={helper()}
                            onChange={(event) => setHelper(event.currentTarget.value)}
                          >
                            <option value="">Choose a person</option>
                            <For each={helperCandidates()}>
                              {(member) => <option value={member.nick}>{member.nick}</option>}
                            </For>
                          </select>
                          <div class="harbor-steward__actions">
                            <Button
                              type="button"
                              variant="primary"
                              size="md"
                              data-testid="harbor-steward-add-helper"
                              disabled={!connected() || !helper()}
                              onClick={() => note(addRoomCoAdmin(current().channel, helper()))}
                            >
                              Add
                            </Button>
                          </div>
                        </Show>
                      </Show>
                    </section>

                    <Show when={membersCanInvite(count())}>
                      <section class="harbor-steward__section">
                        <p class="harbor-steward__body">{STEWARDSHIP_COPY.inviteHint}</p>
                        <div class="harbor-steward__actions">
                          <Button
                            type="button"
                            variant="ghost"
                            size="md"
                            data-testid="harbor-steward-invite"
                            onClick={() => {
                              const room = current().channel;
                              closeRoomStewardship();
                              openRoomInviteShare(room);
                            }}
                          >
                            Invite friends
                          </Button>
                        </div>
                      </section>
                    </Show>

                    <Show when={isOwner()}>
                      <p class="harbor-steward__room-context"><span>Managing</span> {current().channel} · Community room</p>
                      <section class="harbor-steward__section" aria-labelledby="harbor-steward-hand">
                        <h3 id="harbor-steward-hand" class="harbor-steward__label">
                          Hand the room to someone
                        </h3>
                        <p class="harbor-steward__body">{STEWARDSHIP_COPY.transferNoTake}</p>
                        <Show
                          when={offer()}
                          fallback={
                            <>
                              <label class="harbor-steward__label" for="harbor-steward-successor">
                                Who should take it
                              </label>
                              <select
                                id="harbor-steward-successor"
                                class="harbor-steward__field"
                                data-testid="harbor-steward-successor"
                                value={successor()}
                                onChange={(event) => setSuccessor(event.currentTarget.value)}
                              >
                                <option value="">Choose a person</option>
                                <For each={transferCandidates()}>
                                  {(member) => <option value={member.nick}>{member.nick}</option>}
                                </For>
                              </select>
                              <div class="harbor-steward__actions">
                                <Button
                                  type="button"
                                  variant="primary"
                                  size="md"
                                  data-testid="harbor-steward-offer"
                                  disabled={!connected() || !successor()}
                                  onClick={() => note(offerRoomOwnership(current().channel, successor()))}
                                >
                                  Offer
                                </Button>
                              </div>
                            </>
                          }
                        >
                          {(pending) => (
                            <>
                              <p class="harbor-steward__status" data-testid="harbor-steward-transfer-wait">
                                {pending().accepted
                                  ? STEWARDSHIP_COPY.transferGrant
                                  : `${STEWARDSHIP_COPY.transferWait} Waiting for ${pending().to}.`}
                              </p>
                              <div class="harbor-steward__actions">
                                <Button
                                  type="button"
                                  variant="primary"
                                  size="md"
                                  data-testid="harbor-steward-grant"
                                  disabled={!connected() || !canCompleteTransfer(pending())}
                                  onClick={() => note(grantRoomOwnership(current().channel))}
                                >
                                  Hand it over
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="md"
                                  data-testid="harbor-steward-cancel-offer"
                                  onClick={() => note(declineRoomOwnership(current().channel))}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </>
                          )}
                        </Show>
                      </section>

                      <section class="harbor-steward__section" aria-labelledby="harbor-steward-close">
                        <h3 id="harbor-steward-close" class="harbor-steward__label">Close this room</h3>
                        <Show
                          when={closing()}
                          fallback={
                            <>
                              <p class="harbor-steward__body">{STEWARDSHIP_COPY.closeBody}</p>
                              <div class="harbor-steward__actions">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="md"
                                  data-testid="harbor-steward-close"
                                  disabled={!connected()}
                                  onClick={() => setClosing(true)}
                                >
                                  Close room
                                </Button>
                              </div>
                            </>
                          }
                        >
                          <p class="harbor-steward__body">{STEWARDSHIP_COPY.closeTitle(current().channel)}</p>
                          <div class="harbor-steward__actions">
                            <Button
                              type="button"
                              variant="ghost"
                              size="md"
                              onClick={() => setClosing(false)}
                            >
                              Keep it open
                            </Button>
                            <Button
                              type="button"
                              variant="danger"
                              size="md"
                              data-testid="harbor-steward-close-confirm"
                              disabled={!connected()}
                              onClick={() => {
                                note(closeConsumerRoom(current().channel));
                                setClosing(false);
                              }}
                            >
                              {STEWARDSHIP_COPY.closeConfirm}
                            </Button>
                          </div>
                        </Show>
                      </section>

                      <section class="harbor-steward__section" aria-labelledby="harbor-steward-delete">
                        <h3 id="harbor-steward-delete" class="harbor-steward__label">Delete this room</h3>
                        <p class="harbor-steward__body">{STEWARDSHIP_COPY.deleteBody}</p>
                        <Show when={deleting()}>
                          <p class="harbor-steward__status" role="alert">This permanently removes the room for everyone. To continue, type the exact room name.</p>
                          <label class="harbor-steward__label" for="harbor-steward-delete-name">Type {current().channel} to delete</label>
                          <input id="harbor-steward-delete-name" class="harbor-steward__field" data-testid="harbor-steward-delete-name" value={typedName()} autocomplete="off" onInput={(event) => setTypedName(event.currentTarget.value)} />
                        </Show>
                        <div class="harbor-steward__actions">
                          <Button
                            type="button"
                            variant={deleting() ? 'danger' : 'ghost'}
                            size="md"
                            data-testid="harbor-steward-delete"
                            disabled={deleting() && (
                              !connected()
                              || !canDeleteRoom({
                                actorIsOwner: true,
                                typedName: typedName(),
                                room: current().channel,
                              })
                            )}
                            onClick={() => {
                              if (!deleting()) { setDeleting(true); return; }
                              const room = current().channel;
                              const result = deleteConsumerRoom(room, typedName());
                              note(result);
                              if (result.ok) closeRoomStewardship();
                            }}
                          >
                            {deleting() ? STEWARDSHIP_COPY.deleteConfirm : 'Review deletion'}
                          </Button>
                        </div>
                      </section>
                    </Show>

                    <Show when={lastMemberLeaveDissolves(count())}>
                      <section class="harbor-steward__section">
                        <p class="harbor-steward__body" data-testid="harbor-steward-last-member">
                          {STEWARDSHIP_COPY.lastMember}
                        </p>
                        <div class="harbor-steward__actions">
                          <Button
                            type="button"
                            variant="danger"
                            size="md"
                            data-testid="harbor-steward-leave"
                            onClick={() => {
                              const room = current().channel;
                              closeRoomStewardship();
                              openLeaveRoomConfirm(room);
                            }}
                          >
                            Leave room
                          </Button>
                        </div>
                      </section>
                    </Show>

                    <Show when={!typedNameMatchesRoom(typedName(), current().channel) && typedName().trim() !== '' && isOwner()}>
                      <p class="harbor-steward__status">Type the room name to delete it.</p>
                    </Show>
                    <Show when={status()}>
                      <p class="harbor-steward__status" role="status">{status()}</p>
                    </Show>
                    <div class="harbor-steward__actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="md"
                        data-testid="harbor-steward-dismiss"
                        onClick={() => closeRoomStewardship()}
                      >
                        Done
                      </Button>
                    </div>
                  </>
                }
              >
                <h2 id="harbor-steward-title" class="harbor-steward__title">
                  Take {current().channel}?
                </h2>
                <p id="harbor-steward-body" class="harbor-steward__body">
                  {offer()?.from} wants you to take this room. Nothing changes until you accept.
                </p>
                <div class="harbor-steward__actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    data-testid="harbor-steward-decline"
                    onClick={() => {
                      note(declineRoomOwnership(current().channel));
                      closeRoomStewardship();
                    }}
                  >
                    Not now
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    data-testid="harbor-steward-accept"
                    onClick={() => note(acceptRoomOwnership(current().channel))}
                  >
                    Accept
                  </Button>
                </div>
              </Show>
            </section>
          </div>
        </Portal>
      )}
    </Show>
  );
}
