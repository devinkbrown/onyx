// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * WhoisSheet — the network identity returned by IRC WHOIS.
 *
 * MemberList already opens the store's WHOIS state and the IRC parser fills it
 * incrementally. This sheet is deliberately a thin reactive view over that
 * existing state; Sheet supplies the modal semantics, focus trap, Escape close,
 * and focus restoration to the member-card Profile button.
 */
import { createMemo, For, Show, splitProps, type JSX } from 'solid-js';
import { getState, useStore } from '@/lib/store';
import { Avatar, Sheet } from '@/primitives';
import './whois-sheet.css';

type WhoisFieldProps = {
  label: string;
  children: JSX.Element;
};

function WhoisField(props: WhoisFieldProps): JSX.Element {
  const [local] = splitProps(props, ['label', 'children']);
  return (
    <div class="shell-whois-field">
      <dt>{local.label}</dt>
      <dd>{local.children}</dd>
    </div>
  );
}

function formatIdle(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return safe === 0 ? 'Active now' : `${safe} seconds`;
  if (safe < 3600) return `${Math.floor(safe / 60)} minutes`;
  if (safe < 86400) return `${Math.floor(safe / 3600)} hours`;
  return `${Math.floor(safe / 86400)} days`;
}

export type WhoisSheetProps = {
  returnFocus?: HTMLElement | null;
  returnFocusFallback?: HTMLElement | null;
  onClose?: () => void;
};

export function WhoisSheet(props: WhoisSheetProps): JSX.Element {
  const open = useStore((s) => s.showWhois);
  const nick = useStore((s) => s.whoisNick);
  const info = useStore((s) => {
    const selected = s.whoisNick;
    return selected ? s.whoisData.get(selected.toLowerCase()) ?? null : null;
  });

  const identity = createMemo(() => {
    const current = info();
    if (!current?.username && !current?.host) return null;
    if (current.username && current.host) return `${current.username}@${current.host}`;
    return current.username ?? current.host ?? null;
  });
  const signedOn = createMemo(() => {
    const seconds = info()?.signOnTs;
    if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null;
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  });
  const hasDetails = createMemo(() => {
    const current = info();
    return Boolean(current && (
      current.account
      || current.realname
      || current.username
      || current.host
      || current.realHost
      || current.server
      || current.serverInfo
      || current.isOper
      || current.idleSecs !== undefined
      || current.signOnTs !== undefined
      || current.channels?.length
      || current.special
    ));
  });

  return (
    <Sheet
      open={open()}
      title={`Profile: ${nick() ?? 'member'}`}
      description="Live network identity and presence details from WHOIS."
      closeLabel="Close member profile"
      returnFocus={props.returnFocus}
      returnFocusFallback={props.returnFocusFallback}
      onOpenChange={(next) => {
        if (!next) {
          getState().closeWhois();
          props.onClose?.();
        }
      }}
    >
      <div class="shell-whois">
        <div class="shell-whois-summary">
          <Avatar name={nick() ?? '?'} size="md" />
          <div>
            <p class="shell-whois-nick">{nick() ?? 'Unknown member'}</p>
            <Show when={info()?.account}>
              {(account) => <p class="shell-whois-account">~{account()}</p>}
            </Show>
          </div>
        </div>

        <Show when={info()?.loading}>
          <p class="shell-whois-status" role="status">Asking the network for profile details…</p>
        </Show>
        <Show when={info()?.error}>
          {(error) => <p class="shell-whois-error" role="alert">{error()}</p>}
        </Show>

        <Show
          when={hasDetails()}
          fallback={
            <Show when={!info()?.loading && !info()?.error}>
              <p class="shell-whois-empty">The network returned no additional profile details.</p>
            </Show>
          }
        >
          <dl class="shell-whois-details">
            <Show when={info()?.account}>
              {(account) => <WhoisField label="Account">{account()}</WhoisField>}
            </Show>
            <Show when={info()?.realname}>
              {(realname) => <WhoisField label="Name">{realname()}</WhoisField>}
            </Show>
            <Show when={identity()}>
              {(value) => <WhoisField label="Identity">{value()}</WhoisField>}
            </Show>
            <Show when={info()?.realHost}>
              {(host) => <WhoisField label="Actual host">{host()}</WhoisField>}
            </Show>
            <Show when={info()?.server || info()?.serverInfo}>
              <WhoisField label="Server">
                <span>{info()?.server ?? 'Unknown server'}</span>
                <Show when={info()?.serverInfo}>
                  {(serverInfo) => <small>{serverInfo()}</small>}
                </Show>
              </WhoisField>
            </Show>
            <Show when={info()?.isOper}>
              <WhoisField label="Role"><span class="shell-whois-oper">Network operator</span></WhoisField>
            </Show>
            <Show when={info()?.idleSecs !== undefined}>
              <WhoisField label="Idle">{formatIdle(info()?.idleSecs ?? 0)}</WhoisField>
            </Show>
            <Show when={signedOn()}>
              {(date) => (
                <WhoisField label="Signed on">
                  <time datetime={date().toISOString()}>{date().toLocaleString()}</time>
                </WhoisField>
              )}
            </Show>
            <Show when={(info()?.channels?.length ?? 0) > 0}>
              <WhoisField label="Channels">
                <ul class="shell-whois-channels" aria-label={`Channels shared with ${nick() ?? 'member'}`}>
                  <For each={info()?.channels ?? []}>{(channel) => <li>{channel}</li>}</For>
                </ul>
              </WhoisField>
            </Show>
            <Show when={info()?.special}>
              {(special) => <WhoisField label="Network note">{special()}</WhoisField>}
            </Show>
          </dl>
        </Show>
      </div>
    </Sheet>
  );
}
