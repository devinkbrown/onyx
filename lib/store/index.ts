'use client';

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { IRCClient } from '@/lib/irc/client';
import type { IRCMessage, Channel, ChatMessage, ConnectionStatus, MessageReaction } from '@/lib/irc/types';
import { loadCredentials } from '@/lib/credentials';
import { parseCHANLIMIT, parseMonitorNumeric, parsePREFIX, parseSessionMeshTokenNote, parseSessionTokenNote, parseStandardReply } from '@/lib/irc/parser';
import type { SuimyakuPeerState, SuimyakuRoomStats, CallState } from '@/lib/suimyaku-media/types';
import { getMountedSuimyakuMediaEngine } from '@/lib/suimyaku-media/MediaEngine';
import { parseActivity } from '@/lib/activity';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ChannelEventType = 'join' | 'part' | 'quit' | 'kick' | 'mode' | 'nick';

export interface ChannelEvent {
  type: ChannelEventType;
  nick: string;
  text: string;
  time: Date;
}

export interface Server {
  id: string;
  name: string;
  network: string;
  url: string;
  /** Icon color (CSS hsl string) or emoji */
  icon: string;
  /** nick!user@host identity we're connected as */
  nick: string;
  /** account we're logged into */
  account: string | null;
  connected: boolean;
}

export interface DMConversation {
  nick: string;
  account: string | null;
  unread: number;
  highlights: number;
  messages: ChatMessage[];
  away?: boolean;
  lastSeen?: Date;
}

export interface WhoisInfo {
  nick: string;
  username?: string;
  host?: string;
  realname?: string;
  server?: string;
  serverInfo?: string;
  isOper?: boolean;
  idleSecs?: number;
  signOnTs?: number;
  channels?: string[];
  account?: string;
  special?: string;
  realHost?: string;
  loading: boolean;
}

export interface UserProfile {
  nick: string;
  account: string | null;
  modes: Set<string>;
  away: boolean;
  awayMsg?: string;
  host?: string;
  realname?: string;
  accountSince?: Date;
  channels?: string[];
}

// ── Rich user profile (populated from WHOIS + IRCX PROP + activity) ──────────

export interface RichUserProfile {
  nick: string;
  account?: string;
  realname?: string;
  bio?: string;
  bannerColor?: string;
  bannerUrl?: string;
  pronouns?: string;
  /** Preferred display name (METADATA ocean.display-name) */
  displayName?: string;
  /** Per-user accent color (METADATA ocean.accent) */
  accentColor?: string;
  /** Profile links (METADATA ocean.links — whitespace/comma separated) */
  links?: string[];
  joinedAt?: number;
  ircOperator?: boolean;
  bot?: boolean;
  channels?: string[];
  away?: boolean;
  awayMessage?: string;
  server?: string;
  serverInfo?: string;
  idleSeconds?: number;
  signonTime?: number;
}

export interface VoiceState {
  callState: CallState;
  callWith: string;
  callChannel: string | null;
  peers: Map<string, SuimyakuPeerState>;
  muted: boolean;
  deafened: boolean;
  localStream: MediaStream | null;
  roomStats: Map<string, SuimyakuRoomStats>;

  // Audio / device settings
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  outputVolume: number;
  vadEnabled: boolean;
  vadSensitivity: 'low' | 'medium' | 'high';
  noiseSuppression: boolean;
  echoCancellation: boolean;
  pushToTalk: boolean;
  pushToTalkKey: string | null;
  cameraDeviceId: string | null;

  // Screenshare
  screenshareActive: boolean;
  /** Held in memory only — not serialized */
  screenshareStream: MediaStream | null;
  startScreenshare(): Promise<void>;
  stopScreenshare(): void;

  // Video participants: nick → MediaStream from SUIMYAKU media engine
  videoParticipants: Map<string, MediaStream>;

  // Local camera state
  cameraOn: boolean;
  cameraStream: MediaStream | null;
}

type StoredVoiceSettings = Pick<
  VoiceState,
  | 'inputDeviceId'
  | 'outputDeviceId'
  | 'outputVolume'
  | 'vadEnabled'
  | 'vadSensitivity'
  | 'noiseSuppression'
  | 'echoCancellation'
  | 'pushToTalk'
  | 'pushToTalkKey'
  | 'cameraDeviceId'
>;

const VOICE_SETTINGS_KEY = 'ocean-voice-settings';

function _loadVoiceSettings(): StoredVoiceSettings {
  const defaults: StoredVoiceSettings = {
    inputDeviceId: null,
    outputDeviceId: null,
    outputVolume: 80,
    vadEnabled: true,
    vadSensitivity: 'medium',
    noiseSuppression: true,
    echoCancellation: true,
    pushToTalk: false,
    pushToTalkKey: null,
    cameraDeviceId: null,
  };
  if (typeof window === 'undefined') return defaults;
  try {
    const saved = JSON.parse(localStorage.getItem(VOICE_SETTINGS_KEY) ?? '{}') as Partial<StoredVoiceSettings>;
    return { ...defaults, ...saved };
  } catch {
    return defaults;
  }
}

function _saveVoiceSettings(voice: VoiceState): void {
  if (typeof window === 'undefined') return;
  const saved: StoredVoiceSettings = {
    inputDeviceId: voice.inputDeviceId,
    outputDeviceId: voice.outputDeviceId,
    outputVolume: voice.outputVolume,
    vadEnabled: voice.vadEnabled,
    vadSensitivity: voice.vadSensitivity,
    noiseSuppression: voice.noiseSuppression,
    echoCancellation: voice.echoCancellation,
    pushToTalk: voice.pushToTalk,
    pushToTalkKey: voice.pushToTalkKey,
    cameraDeviceId: voice.cameraDeviceId,
  };
  try {
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(saved));
    if (voice.pushToTalkKey) localStorage.setItem('ocean-ptt-key', voice.pushToTalkKey);
  } catch {}
}

export interface Notification {
  id: string;
  type: 'mention' | 'dm' | 'system' | 'error';
  text: string;
  from?: string;
  channel?: string;
  at: Date;
}

// ── Toast system ──────────────────────────────────────────────────────────────

export type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'mention' | 'dm' | 'join' | 'undo';

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  duration?: number;
  undoAction?: () => void;
  groupKey?: string;
}

export type ActiveView =
  | { kind: 'channel'; channel: string }
  | { kind: 'dm'; nick: string }
  | { kind: 'home' };

export interface Announcement {
  id: string;
  time: Date;
  from: string;
  text: string;
  type: 'wallops' | 'global-notice' | 'server-notice';
  read: boolean;
}

export interface AuditEntry {
  id: string;
  timestamp: Date;
  type: 'kick' | 'ban' | 'unban' | 'mode' | 'topic' | 'join' | 'part' | 'nick' | 'invite';
  actor: string;
  target?: string;
  channel?: string;
  detail?: string;
}

// ── Forum channel ─────────────────────────────────────────────────────────────

export interface ForumPost {
  id: string;
  title: string;
  tags: string[];
  authorNick: string;
  content: string;
  time: Date;
  replyCount: number;
  lastReply?: { nick: string; time: Date };
  pinned?: boolean;
}

// ── Channel folder ────────────────────────────────────────────────────────────

export interface ChannelFolder {
  id: string;
  name: string;
  channels: string[];
  collapsed: boolean;
}

// ── Raw log entry ─────────────────────────────────────────────────────────────

export interface RawLogEntry {
  ts: Date;
  dir: 'in' | 'out';
  line: string;
}

export interface OnyxState {
  // ── Connection ──────────────────────────────────────────────────────
  status: ConnectionStatus;
  client: IRCClient | null;
  server: Server | null;

  /** Richer connection status including reconnecting state */
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  /** Seconds until the next reconnect attempt */
  reconnectIn: number;
  /** Whether auto-reconnect is enabled */
  autoReconnect: boolean;

  setConnectionStatus(status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting'): void;
  setReconnectIn(seconds: number): void;
  /** Trigger an immediate reconnect attempt, cancelling any countdown */
  reconnectNow(): void;

  // ── Navigation ──────────────────────────────────────────────────────
  activeView: ActiveView;
  /** Whether the member list panel is open */
  showMemberList: boolean;
  /** Whether the settings modal is open */
  showSettings: boolean;
  /** Which settings tab is active */
  settingsTab: string;

  // ── Data ────────────────────────────────────────────────────────────
  channels: Map<string, Channel>;
  dms: Map<string, DMConversation>;
  ourNick: string;

  // ── Properties (IRCX PROP) ──────────────────────────────────────────
  channelProps: Map<string, Record<string, string>>;
  userProps: Map<string, Record<string, string>>;

  // ── Channel Info Panel ───────────────────────────────────────────────
  showChannelInfo: boolean;
  channelInfoChannel: string | null;

  // ── Server Settings Panel ────────────────────────────────────────────
  showServerSettings: boolean;

  // ── Access List Panel ────────────────────────────────────────────────
  showAccessList: boolean;

  // ── Pinned Messages Panel ────────────────────────────────────────────
  showPinnedMessages: boolean;
  pinnedMessages: Map<string, ChatMessage[]>;

  // ── Voice ────────────────────────────────────────────────────────────
  voice: VoiceState;

  // ── Notifications ────────────────────────────────────────────────────
  notifications: Notification[];
  readNotificationIds: Set<string>;

  // ── Toast system ──────────────────────────────────────────────────────
  toasts: Toast[];
  addToast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: string): void;

  // ── Notification Center ───────────────────────────────────────────────
  showNotificationCenter: boolean;

  // ── ISUPPORT ─────────────────────────────────────────────────────────
  isIRCX: boolean;
  networkName: string;
  /** Parsed ISUPPORT tokens from 005 — key=token name, value=token value or '' */
  serverFeatures: Map<string, string>;
  isupportPrefixToMode: Record<string, string>;
  isupportModeToPrefix: Record<string, string>;
  chanLimits: Record<string, number>;
  caseMapping: string;
  mediaAvailable: boolean;
  /** draft/message-editing negotiated — gate the "edit" affordance */
  canEditMessages: boolean;
  /** draft/message-redaction negotiated — gate the "delete for everyone" affordance */
  canRedactMessages: boolean;
  /** draft/react negotiated — gate server-relayed reactions (else local-only) */
  canReact: boolean;

  // ── Account registration protocol ────────────────────────────────────
  registerPending: boolean;
  registerError: string | null;
  verifyRequired: boolean;
  registerAccount(account: string, email: string | undefined, password: string): void;
  verifyAccount(account: string, code: string): void;

  // ── Nick reclaim / CERTFP services (Orochi built-in, no NickServ bot) ──
  /**
   * `GHOST <nick> <password>` — disconnect a stale session occupying a nick
   * that belongs to the caller's account (password-verified server-side).
   * server.zig handleGhost: success replies as a NOTICE, failure as numerics
   * (ERR_PASSWDMISMATCH / ERR_NEEDMOREPARAMS). The password is required.
   */
  ghost(nick: string, password: string): void;
  /**
   * GHOST the stale session holding `nick`, then re-NICK to it. Used by the
   * "Reclaim" affordance when we landed on a temporary alias after a 433.
   * Resolves to true when the GHOST line was sent (a client is connected).
   */
  reclaimNick(nick: string, password: string): boolean;
  /**
   * `CERTADD` — bind the TLS client-cert fingerprint presented on this
   * connection to the logged-in account (server.zig handleCertAdd). Enables
   * future password-less SASL EXTERNAL logins.
   */
  certAdd(): void;
  /** `CERTLIST` — list bound certificate fingerprints (server.zig handleCertList). */
  certList(): void;
  /** `CERTDEL <fingerprint>` — unbind a fingerprint (server.zig handleCertDel). */
  certDel(fingerprint: string): void;

  // ── MONITOR ─────────────────────────────────────────────────────────
  /** Tracks which nicks we've added to the MONITOR list */
  monitoredNicks: Set<string>;

  // ── Friends / Contacts ───────────────────────────────────────────────
  /** Friends list persisted to localStorage 'ocean-friends' */
  friends: Map<string, { nick: string; online: boolean; note?: string }>;
  showFriendsPanel: boolean;
  addFriend(nick: string): void;
  removeFriend(nick: string): void;
  setFriendOnline(nick: string, online: boolean): void;
  openFriendsPanel(): void;
  closeFriendsPanel(): void;

  // ── Ignored users ────────────────────────────────────────────────────
  /** Nicks the local user has chosen to ignore (case-insensitive) */
  ignoredUsers: Set<string>;
  showIgnoreList: boolean;
  openIgnoreList(): void;
  closeIgnoreList(): void;

  // ── Soft ignore (client-side message hide) ───────────────────────────
  /** Nicks whose messages are hidden locally (not server-side) */
  softIgnoreList: Set<string>;
  /** Message IDs the user has clicked "Show message" to reveal */
  revealedMessages: Set<string>;
  toggleSoftIgnore(nick: string): void;
  revealMessage(msgId: string): void;

  // ── Per-channel notification prefs ──────────────────────────────────
  /** Notification level per channel (key = channel.toLowerCase()) */
  channelNotify: Map<string, 'all' | 'mentions' | 'none'>;

  // ── WHOIS panel ───────────────────────────────────────────────────────
  whoisData: Map<string, WhoisInfo>;
  showWhois: boolean;
  whoisNick: string | null;

  // ── Profile modal ─────────────────────────────────────────────────────
  showUserProfile: boolean;
  userProfileNick: string | null;

  // ── User presence status ─────────────────────────────────────────────
  /** Our own presence status (drives AWAY state on IRC) */
  userStatus: 'online' | 'idle' | 'dnd' | 'offline';

  // ── Custom status message ─────────────────────────────────────────────
  /** Custom status text, e.g. "🎵 Listening to music" */
  customStatus: string;
  /** When the custom status should auto-expire, or null for never */
  customStatusExpiry: Date | null;

  // ── Custom status modal ───────────────────────────────────────────────
  showCustomStatus: boolean;

  // ── User activities (rich presence) ──────────────────────────────────
  /** nick.toLowerCase() → parsed activity for display */
  userActivities: Record<string, { emoji: string; typeLabel: string; text: string }>;

  // ── Messaging UX ─────────────────────────────────────────────────────
  /** Message currently being replied to */
  replyingTo: ChatMessage | null;
  /** Who is typing in each target: target.toLowerCase() → (nick → expiresAt ms timestamp) */
  typingUsers: Map<string, Map<string, number>>;

  // ── Thread Panel ──────────────────────────────────────────────────────
  showThreadPanel: boolean;
  threadParentId: string | null;
  /** parentMsgId → when the user last viewed that thread */
  threadLastSeen: Record<string, Date>;

  // ── Message Forwarding ────────────────────────────────────────────────
  forwardingMessage: ChatMessage | null;

  // ── Bookmarks ─────────────────────────────────────────────────────────
  bookmarks: ChatMessage[];
  showBookmarks: boolean;

  // ── Search overlay ────────────────────────────────────────────────────
  showSearchOverlay: boolean;

  // ── Keyboard shortcuts modal ───────────────────────────────────────────
  showKeyboardShortcuts: boolean;

  // ── Unread separator ──────────────────────────────────────────────────
  /** messageId of the first unread message per target (target key = lowercased) */
  firstUnreadId: Map<string, string | null>;

  // ── Channel Browser ───────────────────────────────────────────────────
  showChannelBrowser: boolean;
  channelList: Array<{ name: string; count: number; topic: string }>;
  channelListLoading: boolean;

  // ── Onboarding ────────────────────────────────────────────────────────
  showOnboarding: boolean;
  onboardingStep: number; // 0-3

  // ── Audit Log ────────────────────────────────────────────────────────
  auditLog: AuditEntry[];

  // ── Chat History ──────────────────────────────────────────────────────
  /** target.toLowerCase() → true while a CHATHISTORY fetch is in flight */
  historyLoading: Map<string, boolean>;
  /** target.toLowerCase() → true when no more history exists */
  historyExhausted: Map<string, boolean>;

  // ── Media Gallery Panel ───────────────────────────────────────────────────
  showMediaGallery: boolean;

  // ── Services panel ───────────────────────────────────────────────────────
  showServices: boolean;
  servicesTab: 'account' | 'channel' | 'memos' | 'vhost' | 'nickserv' | 'chanserv' | 'hostserv' | 'memoserv';

  // ── Service notices (replies from Orochi built-in services: Account, Channel, Memo, etc.) ──
  serviceNotices: Array<{ source: string; text: string; time: Date }>;
  addServiceNotice(source: string, text: string): void;
  clearServiceNotices(): void;

  // ── Channel Join Prompt ───────────────────────────────────────────────────────
  channelJoinPrompt: { channel: string; error: string } | null;
  setChannelJoinPrompt(channel: string, error: string): void;
  clearChannelJoinPrompt(): void;

  // ── Raw IRC Log ───────────────────────────────────────────────────────────
  rawLogEnabled: boolean;
  rawLog: RawLogEntry[];
  showRawLog: boolean;

  // ── Message search ───────────────────────────────────────────────────
  showMessageSearch: boolean;
  messageSearchResults: ChatMessage[];
  messageSearchQuery: string;
  messageSearchLoading: boolean;
  openMessageSearch: () => void;
  closeMessageSearch: () => void;
  searchMessages: (channel: string, query: string) => void;

  // ── Whiteboard panel ─────────────────────────────────────────────────
  showWhiteboard: boolean;
  openWhiteboard: () => void;
  closeWhiteboard: () => void;

  // ── Actions ─────────────────────────────────────────────────────────

  /** Establish IRC connection */
  connect(opts: {
    url: string;
    nick: string;
    password?: string;
    realname?: string;
    /**
     * Signals that this connection presents a TLS client certificate, so SASL
     * EXTERNAL (CERTFP) may be selected when the server offers it. Forwarded to
     * the IRC client; selectSaslMechanism picks EXTERNAL when no password is set
     * but a cert is present.
     */
    hasClientCert?: boolean;
  }): void;

  /** Disconnect cleanly */
  disconnect(): void;

  /** Join a channel */
  joinChannel(channel: string, key?: string): void;

  /** Leave a channel */
  partChannel(channel: string): void;

  /** Navigate to a channel or DM */
  navigate(view: ActiveView): void;

  /** Send a message (PRIVMSG) */
  sendMessage(target: string, text: string): void;

  /** Send a raw IRC line (full formatted line including CRLF) */
  sendRaw(line: string): void;

  /** Request chat history for a channel */
  requestHistory(channel: string, limit?: number): void;

  /** Toggle member list */
  toggleMemberList(): void;

  /** Open / close settings */
  openSettings(tab?: string): void;
  closeSettings(): void;

  /** Mark channel as read */
  markRead(target: string): void;

  /** Clear all messages in a channel or DM */
  clearMessages(target: string): void;

  /** Dismiss a notification */
  dismissNotification(id: string): void;

  /** Add a notification */
  addNotification(n: Omit<Notification, 'id' | 'at'>): void;

  /** Mark a single notification as read */
  markNotificationRead(id: string): void;

  /** Mark all notifications as read */
  markAllNotificationsRead(): void;

  // notification center panel
  openNotificationCenter(): void;
  closeNotificationCenter(): void;

  // voice actions
  setVoiceCallState(s: Partial<VoiceState>): void;
  setVoiceParticipantSpeaking(nick: string, speaking: boolean): void;
  setVoiceParticipantMuted(nick: string, muted: boolean): void;

  // messaging UX actions
  setReplyingTo(msg: ChatMessage | null): void;
  addLocalReaction(target: string, messageId: string, emoji: string): void;
  /** Toggle reaction as ourNick and fire REACT to IRC */
  addReaction(target: string, messageId: string, emoji: string): void;
  /** Remove a specific nick's reaction (used for incoming REACT from others) */
  removeReaction(target: string, messageId: string, emoji: string, nick: string): void;
  editMessage(target: string, messageId: string, newText: string): void;
  deleteMessage(target: string, messageId: string): void;
  _setTyping(channel: string, nick: string, active: boolean): void;
  setTyping(target: string, nick: string, active: boolean): void;
  sendTypingStart(target: string): void;
  sendTypingStop(target: string): void;

  // channel info panel
  openChannelInfo(channel: string): void;
  closeChannelInfo(): void;

  // server settings panel
  openServerSettings(): void;
  closeServerSettings(): void;

  // access list panel
  openAccessList(): void;
  closeAccessList(): void;

  // pinned messages panel
  openPinnedMessages(): void;
  closePinnedMessages(): void;
  pinMessage(target: string, msg: ChatMessage): void;
  unpinMessage(target: string, messageId: string): void;

  // IRCX PROP requests
  requestChannelProps(channel: string): void;
  requestUserProps(nick: string): void;

  // MONITOR (presence)
  monitorAdd(nick: string): void;

  // Ignore list
  ignoreUser(nick: string): void;
  unignoreUser(nick: string): void;
  isIgnored(nick: string): boolean;

  // Collapsed nicks (per-view flood control)
  collapsedNicks: Set<string>;
  collapseNickMessages(nick: string): void;
  expandNickMessages(nick: string): void;
  toggleNickCollapse(nick: string): void;

  // User presence
  setUserStatus(status: 'online' | 'idle' | 'dnd' | 'offline'): void;

  // Custom status
  setCustomStatus(status: string): void;
  setCustomStatusExpiry(expiry: Date | null): void;
  openCustomStatus(): void;
  closeCustomStatus(): void;

  // User activities (rich presence)
  setUserActivity(nick: string, emoji: string, typeLabel: string, text: string): void;
  clearUserActivity(nick: string): void;

  // per-channel notification prefs
  setChannelNotify(target: string, level: 'all' | 'mentions' | 'none'): void;
  /** Convenience: set channel notify to 'none' */
  muteChannel(channel: string): void;
  /** Convenience: restore channel notify to 'all' */
  unmuteChannel(channel: string): void;

  // whois panel
  openWhois(nick: string): void;
  closeWhois(): void;

  // profile modal
  openUserProfile(nick: string): void;
  closeUserProfile(): void;

  // floating profile card (anchored to click position)
  profileNick: string | null;
  profileAnchor: { x: number; y: number } | null;
  openUserProfileCard(nick: string, anchor: { x: number; y: number }): void;
  closeUserProfileCard(): void;

  // thread archive state
  archivedThreads: Set<string>;
  activeThreads: Set<string>;
  threadAutoArchiveMinutes: number;
  archiveThread(parentMsgId: string): void;
  unarchiveThread(parentMsgId: string): void;
  addActiveThread(id: string): void;
  setThreadAutoArchiveMinutes(m: number): void;

  // thread panel
  openThread(messageId: string): void;
  closeThread(): void;
  markThreadSeen(parentMsgId: string): void;

  // message forwarding
  setForwardingMessage(msg: ChatMessage | null): void;

  // bookmarks
  addBookmark(msg: ChatMessage): void;
  removeBookmark(messageId: string): void;
  openBookmarks(): void;
  closeBookmarks(): void;

  // search overlay
  openSearchOverlay(): void;
  closeSearchOverlay(): void;

  // keyboard shortcuts modal
  openKeyboardShortcuts(): void;
  closeKeyboardShortcuts(): void;

  // unread separator
  markFirstUnread(target: string, messageId: string): void;
  forceMarkFirstUnread(target: string, messageId: string): void;
  clearFirstUnread(target: string): void;

  // channel browser
  openChannelBrowser(): void;
  closeChannelBrowser(): void;
  refreshChannelList(): void;

  // onboarding
  startOnboarding(): void;
  nextOnboardingStep(): void;
  skipOnboarding(): void;

  // audit log
  addAuditEntry(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void;

  // chat history
  setHistoryLoading(target: string, loading: boolean): void;
  setHistoryExhausted(target: string): void;
  /** Fetch older messages. before = msgid of the oldest currently-loaded message */
  loadHistory(target: string, before?: string | ChatMessage): void;

  // raw log
  toggleRawLog(): void;
  addRawLogEntry(dir: 'in' | 'out', line: string): void;
  setRawLogEnabled(enabled: boolean): void;
  clearRawLog(): void;

  // media gallery
  openMediaGallery(): void;
  closeMediaGallery(): void;

  // services panel
  openServices(tab?: 'account' | 'channel' | 'memos' | 'vhost' | 'nickserv' | 'chanserv' | 'hostserv' | 'memoserv'): void;
  closeServices(): void;

  // MOTD
  motd: string | null;
  showMotd: boolean;
  closeMotd(): void;

  // ── Server Rules ──────────────────────────────────────────────────────────────
  serverRules: string[];
  showServerRulesModal: boolean;
  openServerRulesModal: () => void;
  closeServerRulesModal: () => void;

  // mobile sidebar
  mobileSidebarOpen: boolean;
  openMobileSidebar(): void;
  closeMobileSidebar(): void;

  // ── Spotlight search ──────────────────────────────────────────────────
  showSpotlight: boolean;
  openSpotlight(): void;
  closeSpotlight(): void;
  toggleSpotlight(): void;

  // ── Theme ──────────────────────────────────────────────────────────────
  activeTheme: string;
  setTheme(theme: string): void;

  // ── Theme modal ────────────────────────────────────────────────────────
  showThemeModal: boolean;
  openThemeModal(): void;
  closeThemeModal(): void;

  // ── Theme & display ───────────────────────────────────────────────────
  /** New theme system: 'lacquer' | 'midnight' | 'onyx' | 'ash' | 'amoled' | 'light' | 'system' */
  theme: 'lacquer' | 'midnight' | 'onyx' | 'ash' | 'amoled' | 'light' | 'system';
  /** UI base font size in px (12 | 14 | 16 | 18 | 20) */
  fontSize: number;
  /** Set UI theme and persist to localStorage 'ocean-display-theme' */
  setDisplayTheme(theme: OnyxState['theme']): void;
  /** Set UI font size and persist to localStorage 'ocean-ui-font-size' */
  setFontSize(size: number): void;

  // ── Message density ──────────────────────────────────────────────────
  messageDensity: 'cozy' | 'compact' | 'spacious';
  setMessageDensity: (d: 'cozy' | 'compact' | 'spacious') => void;

  // ── Stage channels ───────────────────────────────────────────────────
  stageChannel: string | null;
  stageRaisedHands: string[];
  isStageHost: boolean;
  isStageSpeaker: boolean;
  stageHandRaised: boolean;
  pendingSpeakInvite: string | null;
  joinStage: (channel: string) => void;
  leaveStage: () => void;
  raiseHand: () => void;
  lowerHand: () => void;
  inviteToSpeak: (nick: string) => void;
  moveToAudience: (nick: string) => void;
  acceptSpeakInvite: () => void;
  declineSpeakInvite: () => void;
  grantSpeaker: (nick: string) => void;
  revokeSpeaker: (nick: string) => void;
  startStage: (channel: string) => void;
  endStage: () => void;
  addRaisedHand: (nick: string) => void;
  removeRaisedHand: (nick: string) => void;

  // ── Away / Custom status ─────────────────────────────────────────────
  isAway: boolean;
  awayMessage: string;
  showAwayModal: boolean;
  openAwayModal: () => void;
  closeAwayModal: () => void;
  setAway: (message: string) => void;
  unsetAway: () => void;
  /** Minutes of inactivity before auto-away kicks in. 0 = disabled. */
  idleAwayMinutes: number;
  setIdleAwayMinutes: (minutes: number) => void;

  // ── IRC Operator ────────────────────────────────────────────────────
  isOper: boolean;
  operUsername: string;
  showOperPanel: boolean;
  openOperPanel: () => void;
  closeOperPanel: () => void;
  operLogin: (username: string, password: string) => void;
  operAction: (command: string, ...args: string[]) => void;

  // ── Scheduled Messages ──────────────────────────────────────────────
  scheduledMessages: Array<{ id: string; channel: string; text: string; sendAt: number }>;
  showScheduledMessages: boolean;
  scheduleMessage: (channel: string, text: string, sendAt: number) => void;
  cancelScheduledMessage: (id: string) => void;
  openScheduledMessages: () => void;
  closeScheduledMessages: () => void;

  // internal
  _handleMessage(msg: IRCMessage): void;

  // ── Connection quality ────────────────────────────────────────────────
  latencyMs: number | null;
  setLatency: (ms: number) => void;

  // ── Server stats (LUSERS) ─────────────────────────────────────────────
  serverStats: { users: number; channels: number; servers: number; opers: number } | null;
  setServerStats: (stats: Partial<{ users: number; channels: number; servers: number; opers: number }>) => void;

  // ── Sound settings ───────────────────────────────────────────────────
  soundEnabled: boolean;
  soundVolume: number;  // 0-1
  setSoundEnabled: (v: boolean) => void;
  setSoundVolume: (v: number) => void;

  // ── Push notifications ───────────────────────────────────────────────
  pushNotificationsEnabled: boolean;
  setPushNotificationsEnabled: (enabled: boolean) => void;

  // ── Sound settings modal ─────────────────────────────────────────────
  showSoundSettings: boolean;
  openSoundSettings: () => void;
  closeSoundSettings: () => void;

  // ── Group DM modal ───────────────────────────────────────────────────
  showGroupDM: boolean;
  openGroupDM: () => void;
  closeGroupDM: () => void;

  // ── Auto-join ─────────────────────────────────────────────────────────
  autoJoinChannels: string[];
  addAutoJoin: (channel: string) => void;
  removeAutoJoin: (channel: string) => void;

  // ── Starred channels ──────────────────────────────────────────────────
  starredChannels: Set<string>;
  starChannel: (channel: string) => void;
  unstarChannel: (channel: string) => void;

  // ── Custom emoji ──────────────────────────────────────────────────────
  customEmoji: Array<{ name: string; url: string; addedBy?: string }>;
  addCustomEmoji: (name: string, url: string) => void;
  removeCustomEmoji: (name: string) => void;

  // ── Custom emoji modal ────────────────────────────────────────────────
  showCustomEmojiModal: boolean;
  openCustomEmojiModal: () => void;
  closeCustomEmojiModal: () => void;

  // ── Emoji preferences ─────────────────────────────────────────────────
  recentEmojis: string[];
  addRecentEmoji: (emoji: string) => void;
  emojiSkinTone: '' | '\u{1F3FB}' | '\u{1F3FC}' | '\u{1F3FD}' | '\u{1F3FE}' | '\u{1F3FF}';
  setEmojiSkinTone: (tone: string) => void;
  emojiUsageCounts: Record<string, number>;
  incrementEmojiUsage: (emoji: string) => void;

  // ── Moderation ────────────────────────────────────────────────────────
  showModerationPanel: boolean;
  openModerationPanel: () => void;
  closeModerationPanel: () => void;
  moderationLog: Array<{ timestamp: number; action: string; target: string; by: string; channel: string }>;
  addModerationEntry: (entry: { action: string; target: string; by: string; channel: string }) => void;
  banList: Map<string, Array<{ mask: string; setBy?: string; setAt?: number }>>;
  setBanList: (channel: string, bans: Array<{ mask: string; setBy?: string; setAt?: number }>) => void;
  fetchBanList: (channel: string) => void;
  tempBan: (channel: string, mask: string, minutes: number) => void;

  // ── Highlight words ───────────────────────────────────────────────────
  highlightWords: string[];
  addHighlightWord: (word: string) => void;
  removeHighlightWord: (word: string) => void;
  showHighlightModal: boolean;
  openHighlightModal: () => void;
  closeHighlightModal: () => void;

  // ── User notes ────────────────────────────────────────────────────────
  /** Private per-nick notes, persisted to localStorage */
  userNotes: Map<string, string>;
  setUserNote: (nick: string, note: string) => void;
  getUserNote: (nick: string) => string;
  deleteUserNote: (nick: string) => void;

  // ── Invite modal ──────────────────────────────────────────────────────
  showInviteModal: boolean;
  openInviteModal: () => void;
  closeInviteModal: () => void;

  // ── Nick color overrides ──────────────────────────────────────────────
  /** nick.toLowerCase() → CSS color string, persisted to localStorage */
  nickColorOverrides: Map<string, string>;
  setNickColorOverride: (nick: string, color: string) => void;
  clearNickColorOverride: (nick: string) => void;

  // ── CTCP configuration ────────────────────────────────────────────────
  ctcpVersionReply: string;
  ctcpTimeEnabled: boolean;
  ctcpPingEnabled: boolean;
  ctcpEnabled: boolean;
  setCTCPVersionReply: (reply: string) => void;
  setCTCPTimeEnabled: (enabled: boolean) => void;
  setCTCPPingEnabled: (enabled: boolean) => void;
  setCTCPEnabled: (enabled: boolean) => void;

  // ── Server announcements ──────────────────────────────────────────────
  announcements: Announcement[];
  showAnnouncementsPanel: boolean;
  addAnnouncement: (ann: Omit<Announcement, 'id' | 'time' | 'read'>) => void;
  markAnnouncementsRead: () => void;
  clearAnnouncements: () => void;
  openAnnouncementsPanel: () => void;
  closeAnnouncementsPanel: () => void;

  // ── Do Not Disturb ────────────────────────────────────────────────────
  dndEnabled: boolean;
  dndQuietStart: number;   // hour 0–23 (e.g. 22 = 10 PM)
  dndQuietEnd: number;     // hour 0–23 (e.g. 8 = 8 AM)
  /** Timestamp (ms) until which DND is active; null = no timed override */
  dndUntil: number | null;
  showDndModal: boolean;
  setDndEnabled: (enabled: boolean) => void;
  setDndQuietHours: (start: number, end: number) => void;
  setDndUntil: (until: number | null) => void;
  isDndActive: () => boolean;
  openDndModal: () => void;
  closeDndModal: () => void;

  // ── Time format ────────────────────────────────────────────────────────
  timeFormat: '12h' | '24h' | 'hidden';
  setTimeFormat: (format: '12h' | '24h' | 'hidden') => void;

  // ── Channel sort order ─────────────────────────────────────────────────
  channelSortOrder: 'alpha' | 'unread' | 'activity';
  setChannelSortOrder: (order: 'alpha' | 'unread' | 'activity') => void;
  channelLastActivity: Map<string, number>;
  updateChannelActivity: (channel: string) => void;

  // ── Chat export modal ─────────────────────────────────────────────────────
  showExportModal: boolean;
  openExportModal: () => void;
  closeExportModal: () => void;

  // ── DM pins (stored locally per nick) ────────────────────────────────────
  dmPinnedMessages: Map<string, ChatMessage[]>;
  pinDMMessage: (nick: string, msg: ChatMessage) => void;
  unpinDMMessage: (nick: string, msgId: string) => void;
  showDMPins: boolean;
  dmPinsNick: string | null;
  openDMPins: (nick: string) => void;
  closeDMPins: () => void;

  // ── DM mute ───────────────────────────────────────────────────────────────
  mutedDMs: Set<string>;
  muteDM: (nick: string) => void;
  unmuteDM: (nick: string) => void;
  isDMMuted: (nick: string) => boolean;

  // ── DM media panel ────────────────────────────────────────────────────────
  showDMMedia: boolean;
  openDMMedia: () => void;
  closeDMMedia: () => void;

  // ── Connection profiles modal ──────────────────────────────────────────────
  showConnectionProfiles: boolean;
  openConnectionProfiles: () => void;
  closeConnectionProfiles: () => void;

  // ── Compact sidebar ────────────────────────────────────────────────────────
  compactSidebar: boolean;
  setCompactSidebar: (compact: boolean) => void;

  // ── Channel color labels ───────────────────────────────────────────────────
  /** channelName.toLowerCase() → hex color string, persisted to localStorage */
  channelColors: Map<string, string>;
  setChannelColor: (channel: string, color: string) => void;
  clearChannelColor: (channel: string) => void;

  // ── Message font size ──────────────────────────────────────────────────────
  messageFontSize: number;
  setMessageFontSize: (size: number) => void;

  // ── Accent color ───────────────────────────────────────────────────────────
  accentColor: string;
  setAccentColor: (color: string) => void;

  // ── Reduced motion ─────────────────────────────────────────────────────────
  reducedMotion: boolean;
  setReducedMotion: (reduced: boolean) => void;

  // ── Chat background pattern ────────────────────────────────────────────────
  chatBackground: 'solid' | 'dots' | 'grid' | 'noise' | 'diagonal';
  setChatBackground: (bg: 'solid' | 'dots' | 'grid' | 'noise' | 'diagonal') => void;

  // ── UI font family ─────────────────────────────────────────────────────────
  uiFont: string;
  setUiFont: (font: string) => void;

  // ── Bubble message mode ────────────────────────────────────────────────────
  bubbleMode: boolean;
  setBubbleMode: (v: boolean) => void;

  // ── Custom CSS injection ───────────────────────────────────────────────────
  customCss: string;
  setCustomCss: (css: string) => void;

  // ── Sidebar width (drag-resizable) ────────────────────────────────────────
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;

  // ── Message max width ──────────────────────────────────────────────────────
  messageMaxWidth: 680 | 860 | 0;
  setMessageMaxWidth: (w: 680 | 860 | 0) => void;

  // ── Glass sidebar ──────────────────────────────────────────────────────────
  glassSidebar: boolean;
  setGlassSidebar: (v: boolean) => void;

  // ── Member list sort ────────────────────────────────────────────────────────
  memberListSort: 'role' | 'alpha' | 'online-first' | 'recent';
  setMemberListSort: (sort: 'role' | 'alpha' | 'online-first' | 'recent') => void;

  // ── Latency history (sparkline) ───────────────────────────────────────────
  latencyHistory: number[];
  addLatencyReading: (ms: number) => void;

  // ── Connection uptime ─────────────────────────────────────────────────────
  connectedAt: Date | null;
  setConnectedAt: (date: Date | null) => void;

  // ── Server info panel ─────────────────────────────────────────────────────
  serverVersion: string | null;
  serverCapabilities: string[];
  showServerInfo: boolean;
  openServerInfo: () => void;
  closeServerInfo: () => void;

  // ── WHO / away tracking ───────────────────────────────────────────────────
  awayNicks: Set<string>;
  setNickAway: (nick: string, away: boolean) => void;

  // ── Focus mode ────────────────────────────────────────────────────────────
  focusMode: boolean;
  toggleFocusMode: () => void;

  // ── Channel folders ───────────────────────────────────────────────────────
  channelFolders: ChannelFolder[];
  setChannelFolders: (folders: ChannelFolder[]) => void;
  addChannelToFolder: (channel: string, folderId: string) => void;
  toggleFolderCollapsed: (folderId: string) => void;
  createFolder: (name: string) => void;
  deleteFolder: (folderId: string) => void;
  renameFolder: (folderId: string, name: string) => void;

  // ── Favorite emojis ───────────────────────────────────────────────────────
  favoriteEmojis: string[];
  setFavoriteEmojis: (emojis: string[]) => void;

  // ── Poll create modal ─────────────────────────────────────────────────────
  showPollCreate: boolean;
  openPollCreate: () => void;
  closePollCreate: () => void;

  // ── Reaction summary panel ────────────────────────────────────────────────
  /** messageId whose reactions are shown, or null */
  showReactionStats: string | null;
  openReactionStats: (messageId: string) => void;
  closeReactionStats: () => void;

  // ── Topic history ─────────────────────────────────────────────────────────
  /** channel.toLowerCase() → last 10 topics (most recent first) */
  topicHistory: Record<string, string[]>;
  addTopicHistory: (channel: string, topic: string) => void;

  // ── Channel welcome banner ────────────────────────────────────────────────
  /** channels where the welcome banner has been dismissed this session */
  channelWelcomeSeen: Set<string>;
  markWelcomeSeen: (channel: string) => void;

  // ── Voice / SUIMYAKU speaking + channel tracking ─────────────────────────────
  /** Set of nicks currently speaking (updated from PeerRegistry VAD) */
  speakingNicks: Set<string>;
  setSpeakingNick: (nick: string, speaking: boolean) => void;
  /** Channel names identified as SUIMYAKU voice channels (prefix + or mode V) */
  voiceChannels: string[];
  addVoiceChannel: (channel: string) => void;
  removeVoiceChannel: (channel: string) => void;

  // ── Voice channel presence ────────────────────────────────────────────────
  /** channel.toLowerCase() → nicks currently in voice */
  voiceChannelParticipants: Map<string, Set<string>>;

  // Voice channel actions
  joinVoiceChannel(channel: string, withVideo?: boolean): Promise<void>;
  leaveVoiceChannel(): void;
  toggleCamera(): Promise<void>;
  toggleMute(): void;
  toggleDeafen(): void;

  // DM calling
  startDmCall(nick: string, withVideo?: boolean): void;
  acceptDmCall(): void;
  rejectDmCall(): void;
  endDmCall(): void;

  // ── Channel event log ─────────────────────────────────────────────────────
  channelEvents: Record<string, ChannelEvent[]>;
  addChannelEvent: (channel: string, event: ChannelEvent) => void;
  clearChannelEvents: (channel: string) => void;
  showEventLog: boolean;
  openEventLog: () => void;
  closeEventLog: () => void;
  eventLogFilters: Set<ChannelEventType>;
  toggleEventFilter: (type: ChannelEventType) => void;

  // ── Join history (session) ────────────────────────────────────────────────
  joinHistory: string[];
  addJoinHistory: (channel: string) => void;

  // ── Nick aliases (fallback nicks when primary is taken) ──────────────────
  nickAliases: string[];
  setNickAliases: (aliases: string[]) => void;
  /** True when the client is connected using a fallback nick */
  currentNickIsAlias: boolean;

  // ── ISUPPORT token store (all 005 tokens, not just known ones) ───────────
  isupportTokens: Record<string, string>;

  // ── Watch list (IRCv3 MONITOR command) ──────────────────────────────────
  watchList: Array<{ nick: string; online: boolean; lastSeen?: Date }>;
  addToWatchList: (nick: string) => void;
  removeFromWatchList: (nick: string) => void;
  setWatchOnline: (nick: string, online: boolean, time?: Date) => void;

  // ── Mobile panel navigation ───────────────────────────────────────────────
  mobilePanel: 'channels' | 'chat' | 'members' | 'settings';
  setMobilePanel: (panel: 'channels' | 'chat' | 'members' | 'settings') => void;

  // ── High contrast mode ────────────────────────────────────────────────────
  highContrastMode: boolean;
  setHighContrastMode: (v: boolean) => void;

  // ── Multi-select messages ─────────────────────────────────────────────────
  selectedMessages: Set<string>;
  isSelectMode: boolean;
  toggleMessageSelection: (id: string) => void;
  clearSelection: () => void;
  enterSelectMode: () => void;
  exitSelectMode: () => void;

  // ── Forum channels ────────────────────────────────────────────────────────
  /** channel names (lowercased) that are in forum mode */
  forumChannels: Set<string>;
  toggleForumChannel: (channel: string) => void;
  /** channel.toLowerCase() → forum posts */
  forumPosts: Record<string, ForumPost[]>;
  addForumPost: (channel: string, post: ForumPost) => void;
  showForumCreate: boolean;
  openForumCreate: () => void;
  closeForumCreate: () => void;

  // ── Embed suppression ─────────────────────────────────────────────────────
  /** message IDs where the user has chosen to hide embeds/link previews */
  suppressedEmbeds: Set<string>;
  toggleSuppressEmbed: (messageId: string) => void;

  // ── Display name overrides ────────────────────────────────────────────────
  /** nick → local-only display name override */
  displayNameOverrides: Record<string, string>;
  setDisplayNameOverride: (nick: string, displayName: string) => void;
  clearDisplayNameOverride: (nick: string) => void;
  /** Our own local display name override */
  selfDisplayName: string;
  setSelfDisplayName: (name: string) => void;

  // ── Self profile (editable by the user) ──────────────────────────────────
  selfBio: string;
  selfPronouns: string;
  selfBannerUrl: string;
  setSelfBio: (bio: string) => void;
  setSelfPronouns: (pronouns: string) => void;
  setSelfBannerUrl: (url: string) => void;

  // ── Invisible mode (+i user mode) ────────────────────────────────────────
  invisibleMode: boolean;
  setInvisibleMode: (v: boolean) => void;

  // ── Unread tracking ───────────────────────────────────────────────────────
  /** Unread message count per channel (channel key = lowercased) */
  channelUnread: Record<string, number>;
  /** Unread mention count per channel (channel key = lowercased) */
  channelMentions: Record<string, number>;
  /** Computed: sum of all channelMentions values */
  totalUnreadMentions: number;
  /** Zero out unread + mentions for a channel */
  markChannelRead: (channel: string) => void;
  /** Increment unread (and optionally mention) count for a channel */
  incrementUnread: (channel: string, isMention: boolean) => void;

  // ── Rich user profiles ────────────────────────────────────────────────────
  /** nick.toLowerCase() → rich profile data populated from WHOIS */
  userProfiles: Map<string, RichUserProfile>;
  setUserProfile: (nick: string, data: Partial<RichUserProfile>) => void;
  getUserProfile: (nick: string) => RichUserProfile | null;

  // ── Orochi integration (serial integration pass) ─────────────────────────
  /** nick.toLowerCase() → raw METADATA key/value pairs (761 RPL_KEYVALUE) */
  userMetadata: Map<string, Record<string, string>>;
  /** channel.toLowerCase() → rolling caption transcript for the live media session */
  mediaTranscripts: Map<string, Array<{ nick: string; text: string; time: Date }>>;
  /** sender.toLowerCase() → offline (TEGAMI) delivery aggregate */
  tegami: Map<string, { count: number; firstMsgId: string }>;
  /** target.toLowerCase() → server-side read marker (ISO 8601 timestamp) */
  readMarkers: Map<string, string>;
  /** Send `RENAME <channel> <newName> [:reason]` (IRCv3 draft/channel-rename). */
  renameChannel(channel: string, newName: string, reason?: string): void;
  /** Set (value) or unset (null/'') one of our own METADATA keys via `METADATA * SET`. */
  setOwnMetadata(key: string, value: string | null): void;
  /** Internal: apply an inbound METADATA key/value to userMetadata + rich profile. */
  _applyMetadata(target: string, key: string, value: string): void;
  /** Drop the TEGAMI aggregate for a sender (e.g. once the DM is opened). */
  clearTegami(target: string): void;

  // ── Developer mode ────────────────────────────────────────────────────────
  devMode: boolean;
  setDevMode: (v: boolean) => void;

  // ── Streamer mode ─────────────────────────────────────────────────────────
  streamerMode: boolean;
  streamerModeBlurLinks: boolean;
  setStreamerMode: (v: boolean) => void;
  setStreamerModeBlurLinks: (v: boolean) => void;

  // ── Accessibility extras ──────────────────────────────────────────────────
  reduceMotion: boolean;
  compactMemberList: boolean;
  setReduceMotion: (v: boolean) => void;
  setCompactMemberList: (v: boolean) => void;

  // ── Channel ordering (drag reorder) ───────────────────────────────────────
  /** Channel names in user-defined drag order */
  channelOrder: string[];
  setChannelOrder: (order: string[]) => void;

  // ── NSFW channels ─────────────────────────────────────────────────────────
  /** Channel names (lowercased) marked as NSFW */
  nsfwChannels: Set<string>;
  /** Channel names (lowercased) where user clicked "I understand" this session */
  nsfwAcknowledged: Set<string>;
  markChannelNsfw: (channel: string) => void;
  unmarkChannelNsfw: (channel: string) => void;
  acknowledgeNsfw: (channel: string) => void;

  // ── Spatial Audio ─────────────────────────────────────────────────────────
  /** Per-channel spatial positions: chanKey → (nickKey → {x,y,z,t}) */
  spatialPositions: Map<string, Map<string, { x: number; y: number; z: number; t: number }>>;
  /** Whether the SpatialPad panel is open */
  showSpatialPad: boolean;
  openSpatialPad: () => void;
  closeSpatialPad: () => void;

  // ── Breakout Rooms ────────────────────────────────────────────────────────
  /** Whether the BreakoutSidebar panel is open */
  showBreakoutSidebar: boolean;
  openBreakoutSidebar: () => void;
  closeBreakoutSidebar: () => void;

  // ── Streaming ─────────────────────────────────────────────────────────────
  streams: Map<string, StreamInfo>;
  raids: Map<string, RaidInfo>;
  streamPolls: Map<string, StreamPollInfo>;
  showGoLiveModal: boolean;
  goLiveChannel: string | null;
  openGoLiveModal: (channel: string) => void;
  closeGoLiveModal: () => void;
  startStream: (channel: string, title: string, category: string, mode: 'camera' | 'screen', key?: string, quality?: StreamQuality) => void;
  endStream: (channel: string) => void;
  raidChannel: (channel: string, target: string) => void;
  createStreamPoll: (channel: string, question: string, options: string[], durationSec?: number) => void;
  voteStreamPoll: (channel: string, optionIndex: number) => void;
  showServerStats: boolean;
  openServerStats: () => void;
  closeServerStats: () => void;
}

// ── Streaming types ───────────────────────────────────────────────────────────

export interface StreamInfo {
  channel: string;
  streamer: string;
  title: string;
  category: string;
  live: boolean;
  startedAt: number;
  viewers: number;
  mode: 'camera' | 'screen';
  quality: StreamQuality;
}

export type StreamQuality = 'auto' | '1080p60' | '4k60';

export interface RaidInfo {
  raider: string;
  from: string;
  viewers: number;
  timestamp: number;
}

export interface StreamPollInfo {
  channel: string;
  question: string;
  options: string[];
  votes: number[];      // parallel to options
  myVote: number | null;
  createdBy: string;
  endsAt: number;
  active: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _uidCounter = 0;
const uid = () => `onyx-${Date.now()}-${++_uidCounter}`;

const HISTORY_PAGE_SIZE = 50;
const SERVICE_BOTS = new Set(['nickserv', 'chanserv', 'hostserv', 'memoserv']);

function hasChatHistoryCap(client: IRCClient | null | undefined): boolean {
  return Boolean(
    client?.negotiatedCaps?.has('draft/chathistory') ||
    client?.negotiatedCaps?.has('chathistory'),
  );
}

function historyReference(before: string | ChatMessage): string {
  if (typeof before === 'string') {
    if (before.startsWith('msgid=') || before.startsWith('timestamp=')) return before;
    return before.startsWith('onyx-') ? `timestamp=${new Date().toISOString()}` : `msgid=${before}`;
  }

  if (before.id && !before.id.startsWith('onyx-')) {
    return before.id.startsWith('msgid=') ? before.id : `msgid=${before.id}`;
  }
  return `timestamp=${before.time.toISOString()}`;
}

function emptyChannel(name: string): Channel {
  return {
    name,
    topic: '',
    topicSetBy: '',
    topicSetAt: null,
    modes: '',
    users: new Map(),
    unread: 0,
    highlights: 0,
    createdAt: null,
    messages: [],
  };
}

function mentionsMe(text: string, nick: string): boolean {
  const escaped = nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function sysMsg(text: string, target: string): ChatMessage {
  return { id: uid(), time: new Date(), from: '', text, type: 'system', target };
}

function serverIcon(network: string): string {
  // Generate a deterministic hue from the network name
  let hash = 0;
  for (const c of network) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue},60%,55%)`;
}

// ── Typing rate-limit tracker (module-level, not in store) ───────────────────
/** target.toLowerCase() → timestamp of last sendTypingStart */
const _typingLastSent = new Map<string, number>();

// ── CHATHISTORY batch collectors (module-level) ───────────────────────────────
/** ref → { target, messages[] } — accumulates PRIVMSG during a BATCH */
const _batchCollectors = new Map<string, { target: string; messages: ChatMessage[] }>();
/**
 * Lowercased target → batch ref for every currently-open `chathistory` BATCH.
 * Orochi's CHATHISTORY replay does NOT stamp `@batch=<ref>` on the inner
 * PRIVMSG lines (it writes `BATCH +1 chathistory #c` then bare
 * `:nick PRIVMSG #c :…` then `BATCH -1`; see orochi src/proto/chathistory_cmd.zig
 * writeMessage and the threaded test at src/daemon/server.zig:19476). Without a
 * per-line batch tag we cannot correlate inner lines by tag, so we track the
 * open batch by target and route inner PRIVMSGs into the collector while the
 * batch is open. The `@batch` tag path is still honored when present (spec
 * compliance / future-proofing against other servers).
 */
const _openChathistoryByTarget = new Map<string, string>();

// ── MOTD buffer (module-level) ────────────────────────────────────────────────
/** Accumulates MOTD lines between RPL_MOTDSTART (375) and RPL_ENDOFMOTD (376) */
let _motdBuffer = '';

// ── Latency ping tracking (module-level) ─────────────────────────────────────
/** cookie → performance.now() timestamp when that PING was sent */
const _pingTimestamps = new Map<string, number>();

/** High-res timestamp, falls back to Date.now() in non-browser envs */
function _now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// ── Ban list accumulator (module-level) ───────────────────────────────────────
/** channel.toLowerCase() → accumulated bans while RPL_BANLIST numerics arrive */
const _banBuffer = new Map<string, Array<{ mask: string; setBy?: string; setAt?: number }>>();

// ── Temp-ban timers (module-level) ─────────────────────────────────────────────
/** channel/mask → timer; survives moderation panel unmounts and uses the current client when firing */
const _tempBanTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ── Reconnect countdown (module-level) ────────────────────────────────────────
let _reconnectAttempts = 0;

// ── Nick alias try index (module-level) ──────────────────────────────────────
/** How many aliases have been tried for the current connection attempt */
let _nickAliasTryIdx = 0;
let _reconnectCountdownTimer: ReturnType<typeof setInterval> | null = null;
let _reconnectScheduleTimer: ReturnType<typeof setTimeout> | null = null;

/** Original nick requested in the most recent connect() call.
 *  Preserved even after the IRC client appends '_' on nick collision. */
let _connectNick = '';
/** Account authenticated via SASL (set on 900 RPL_LOGGEDIN, cleared on connect/disconnect). */
let _saslAccount: string | null = null;

// ── Nick reclaim timer (module-level) ────────────────────────────────────────
/**
 * When we land on an alias nick after SASL auth, this interval
 * periodically sends NICK <desiredNick> until the zombie dies and the nick
 * is freed.  Handles ping-timeout zombies that aren't yet marked dead on
 * the server when we first attempt the reclaim.
 */
let _nickReclaimTimer: ReturnType<typeof setInterval> | null = null;

function _stopNickReclaim() {
  if (_nickReclaimTimer) {
    clearInterval(_nickReclaimTimer);
    _nickReclaimTimer = null;
  }
}

function _startNickReclaim(desiredNick: string) {
  _stopNickReclaim();
  _nickReclaimTimer = setInterval(() => {
    const s = useOnyxStore.getState();
    if (!s.currentNickIsAlias || !s.client) {
      _stopNickReclaim();
      return;
    }
    s.client.sendRaw('NICK', desiredNick);
  }, 30_000);
}

function _reconnectDelay(attempt: number): number {
  return Math.min(5 * Math.pow(2, attempt), 60);
}

function _clearReconnectCountdown() {
  if (_reconnectCountdownTimer) { clearInterval(_reconnectCountdownTimer); _reconnectCountdownTimer = null; }
  if (_reconnectScheduleTimer) { clearTimeout(_reconnectScheduleTimer); _reconnectScheduleTimer = null; }
}

type SetFn = (partial: Partial<OnyxState> | ((s: OnyxState) => Partial<OnyxState>)) => void;
type GetFn = () => OnyxState;

function _startReconnectCountdown(get: GetFn, set: SetFn) {
  _clearReconnectCountdown();

  const maxAttempts = 5;
  if (_reconnectAttempts >= maxAttempts) {
    set({ connectionStatus: "disconnected", reconnectIn: 0, autoReconnect: false });
    return;
  }

  const delaySecs = _reconnectDelay(_reconnectAttempts);
  set({ connectionStatus: "reconnecting", reconnectIn: delaySecs });

  let remaining = delaySecs;
  _reconnectCountdownTimer = setInterval(() => {
    remaining--;
    set({ reconnectIn: Math.max(0, remaining) });
    if (remaining <= 0) {
      _clearReconnectCountdown();
    }
  }, 1000);

  _reconnectScheduleTimer = setTimeout(() => {
    _clearReconnectCountdown();
    _reconnectAttempts++;
    if (!get().autoReconnect) {
      set({ connectionStatus: "disconnected", reconnectIn: 0 });
      return;
    }
    set({ connectionStatus: "connecting", reconnectIn: 0 });
    const { client } = get();
    if (client) {
      client.connect();
    }
  }, delaySecs * 1000);
}

// ── Channel color persistence helpers ────────────────────────────────────────

function _loadChannelColors(): Map<string, string> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem('ocean-channel-colors');
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch { return new Map(); }
}

function _saveChannelColors(colors: Map<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('ocean-channel-colors', JSON.stringify(Object.fromEntries(colors)));
  } catch {}
}

function _loadChannelNotify(): Map<string, 'all' | 'mentions' | 'none'> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem('ocean-channel-notify');
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, 'mentions' | 'none'>));
  } catch { return new Map(); }
}

function _saveChannelNotify(notify: Map<string, 'all' | 'mentions' | 'none'>): void {
  if (typeof window === 'undefined') return;
  try {
    const persisted = [...notify].filter(([, level]) => level !== 'all');
    localStorage.setItem('ocean-channel-notify', JSON.stringify(Object.fromEntries(persisted)));
  } catch {}
}

function _loadCompactSidebar(): boolean {
  return typeof window !== 'undefined' && localStorage.getItem('ocean-compact-sidebar') === '1';
}

function _loadIdleAwayMinutes(): number {
  if (typeof window === 'undefined') return 15;
  const parsed = Number(localStorage.getItem('ocean-idle-away-minutes'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 15;
}

function _loadDndEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('ocean-dnd-enabled') === 'true';
}

function _loadDndHour(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const parsed = Number(localStorage.getItem(key));
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : fallback;
}

function _loadDndUntil(): number | null {
  if (typeof window === 'undefined') return null;
  const parsed = Number(localStorage.getItem('ocean-dnd-until'));
  return Number.isFinite(parsed) && parsed > Date.now() ? parsed : null;
}

function _loadSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = localStorage.getItem('ocean-sound');
  if (stored !== null) return stored !== 'false';
  const legacy = localStorage.getItem('ocean-notif-sounds');
  return legacy === null ? true : legacy === 'true';
}

function _loadPushNotificationsEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = localStorage.getItem('ocean-push-notifications');
  if (stored !== null) return stored !== 'false';
  const legacy = localStorage.getItem('ocean-notif-desktop');
  return legacy === null ? true : legacy !== 'false';
}

function _loadEmojiSkinTone(): OnyxState['emojiSkinTone'] {
  if (typeof window === 'undefined') return '';
  const stored = localStorage.getItem('ocean-emoji-skin-tone');
  return stored === '\u{1F3FB}' || stored === '\u{1F3FC}' || stored === '\u{1F3FD}' ||
    stored === '\u{1F3FE}' || stored === '\u{1F3FF}' ? stored : '';
}

function _normalizeEmojiSkinTone(tone: string): OnyxState['emojiSkinTone'] {
  return tone === '\u{1F3FB}' || tone === '\u{1F3FC}' || tone === '\u{1F3FD}' ||
    tone === '\u{1F3FE}' || tone === '\u{1F3FF}' ? tone : '';
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useOnyxStore = create<OnyxState>()(
  subscribeWithSelector<OnyxState>((set, get) => ({
    status: 'disconnected',
    client: null,
    server: null,
    connectionStatus: 'disconnected',
    reconnectIn: 0,
    autoReconnect: false,
    latencyMs: null,
    serverStats: null,
    activeView: { kind: 'home' },
    showMemberList: true,
    showSettings: false,
    settingsTab: 'account',
    channels: new Map(),
    dms: new Map(),
    ourNick: '',
    channelProps: new Map(),
    userProps: new Map(),
    showChannelInfo: false,
    channelInfoChannel: null,
    showServerSettings: false,
    showAccessList: false,
    showPinnedMessages: false,
    pinnedMessages: new Map(),
    monitoredNicks: new Set(),
    friends: _loadFriends(),
    showFriendsPanel: false,
    ignoredUsers: _loadIgnoredUsers(),
    showIgnoreList: false,
    softIgnoreList: _loadSoftIgnoreList(),
    revealedMessages: new Set<string>(),
    collapsedNicks: new Set<string>(),
    channelNotify: _loadChannelNotify(),
    whoisData: new Map(),
    showWhois: false,
    whoisNick: null,
    showUserProfile: false,
    userProfileNick: null,
    profileNick: null,
    profileAnchor: null,
    userStatus: 'online',
    customStatus: _loadCustomStatus(),
    customStatusExpiry: _loadCustomStatusExpiry(),
    showCustomStatus: false,
    userActivities: {},
    isIRCX: false,
    networkName: 'Ocean',
    serverFeatures: new Map(),
    isupportPrefixToMode: { '.': 'q', '@': 'o', '+': 'v' },
    isupportModeToPrefix: { q: '.', o: '@', v: '+' },
    chanLimits: {},
    caseMapping: 'ascii',
    mediaAvailable: false,
    canEditMessages: false,
    canRedactMessages: false,
    canReact: false,
    registerPending: false,
    registerError: null,
    verifyRequired: false,
    notifications: [],
    readNotificationIds: new Set(),
    showNotificationCenter: false,
    toasts: [],
    replyingTo: null,
    typingUsers: new Map(),
    showThreadPanel: false,
    threadParentId: null,
    threadLastSeen: {},
    archivedThreads: new Set(),
    activeThreads: new Set(),
    threadAutoArchiveMinutes: 1440,
    forwardingMessage: null,
    bookmarks: _loadBookmarks(),
    showBookmarks: false,
    showSearchOverlay: false,
    showKeyboardShortcuts: false,
    firstUnreadId: new Map(),
    showChannelBrowser: false,
    channelList: [],
    channelListLoading: false,
    showOnboarding: false,
    onboardingStep: 0,
    auditLog: [],
    historyLoading: new Map(),
    historyExhausted: new Map(),
    rawLogEnabled: false,
    rawLog: [],
    showRawLog: false,
    showMessageSearch: false,
    messageSearchResults: [],
    messageSearchQuery: '',
    messageSearchLoading: false,
    showMediaGallery: false,
    showWhiteboard: false,
    showServices: false,
    servicesTab: 'account',
    serviceNotices: [],
    channelJoinPrompt: null,
    motd: null,
    showMotd: false,
    serverRules: [],
    showServerRulesModal: false,
    mobileSidebarOpen: false,
    showSpotlight: false,
    activeTheme: _loadActiveTheme(),
    showThemeModal: false,
    messageDensity: (() => {
      if (typeof window === 'undefined') return 'cozy';
      const stored = localStorage.getItem('ocean-density');
      return (stored === 'compact' || stored === 'spacious' ? stored : 'cozy') as 'cozy' | 'compact' | 'spacious';
    })(),
    voice: {
      callState: 'idle',
      callWith: '',
      callChannel: null,
      peers: new Map(),
      muted: false,
      deafened: false,
      localStream: null,
      roomStats: new Map(),
      ..._loadVoiceSettings(),
      screenshareActive: false,
      screenshareStream: null,
      videoParticipants: new Map(),
      cameraOn: false,
      cameraStream: null,
      async startScreenshare() {
        const { activeView } = get();
        const target = activeView.kind === 'channel' ? activeView.channel :
                       activeView.kind === 'dm' ? activeView.nick : get().voice.callChannel;
        if (!target) return;
        await getMountedSuimyakuMediaEngine()?.startScreenShare(target);
        const stream = getMountedSuimyakuMediaEngine()?.getLocalStream() ?? null;
        set(s => ({ voice: { ...s.voice, screenshareActive: !!stream, screenshareStream: stream } }));
        stream?.getVideoTracks()[0]?.addEventListener('ended', () => {
          get().voice.stopScreenshare();
        });
      },
      stopScreenshare() {
        const { voice } = get();
        getMountedSuimyakuMediaEngine()?.stopBroadcast(voice.callChannel ?? undefined);
        voice.screenshareStream?.getTracks().forEach(t => t.stop());
        set(s => ({ voice: { ...s.voice, screenshareActive: false, screenshareStream: null } }));
      },
    },

    // ── connect ──────────────────────────────────────────────────────────
    // ── setConnectionStatus / setReconnectIn / reconnectNow ──────────────
    setConnectionStatus(connectionStatus) {
      set({ connectionStatus });
    },
    setReconnectIn(reconnectIn) {
      set({ reconnectIn });
    },
    setLatency(ms) {
      set({ latencyMs: ms });
      get().addLatencyReading(ms);
    },
    setServerStats(stats) {
      set(s => ({ serverStats: { ...{ users: 0, channels: 0, servers: 0, opers: 0 }, ...s.serverStats, ...stats } }));
    },
    reconnectNow() {
      _clearReconnectCountdown();
      _reconnectAttempts = 0;
      const { client } = get();
      if (client) {
        set({ connectionStatus: 'connecting', reconnectIn: 0 });
        client.connect();
      }
    },

    connect({ url, nick, password, realname, hasClientCert }) {
      const prev = get().client;
      if (prev) prev.destroy();
      // Clear any in-progress reconnect countdown
      _clearReconnectCountdown();
      // Reset transient protocol buffers from any prior session so they cannot
      // leak across a (re)connect.
      _batchCollectors.clear();
      _openChathistoryByTarget.clear();
      _motdBuffer = '';

      // Remember the desired nick before the IRC client may append '_' on collision
      _stopNickReclaim();
      _connectNick = nick;
      _saslAccount = null;

      set({ status: 'connecting', connectionStatus: 'connecting', ourNick: nick, autoReconnect: false });
      _nickAliasTryIdx = 0;
      const savedCreds = loadCredentials(url, nick);

      const client = new IRCClient({
        url,
        nick,
        realname: realname ?? nick,
        username: nick,
        password,
        sessionToken: savedCreds?.sessionToken,
        meshToken: savedCreds?.meshToken,
        // EXTERNAL/CERTFP intent: only meaningful when the transport actually
        // presents a client cert. selectSaslMechanism picks EXTERNAL when a cert
        // is present and no password drives PLAIN/SCRAM.
        hasClientCert,
        onConnected() {
          _clearReconnectCountdown();
          _reconnectAttempts = 0;
          set({ status: 'connected', connectionStatus: 'connected', reconnectIn: 0, autoReconnect: true, connectedAt: new Date() });
        },
        onDisconnected(reason) {
          set(s => ({
            status: 'disconnected',
            server: s.server ? { ...s.server, connected: false } : null,
            connectedAt: null,
          }));
          get().addNotification({ type: 'system', text: `Disconnected: ${reason}` });

          // Start auto-reconnect countdown if enabled
          if (get().autoReconnect) {
            _startReconnectCountdown(get, set);
          } else {
            set({ connectionStatus: 'disconnected', reconnectIn: 0 });
          }
        },
        onError(err) {
          set({ status: 'error' });
          get().addNotification({ type: 'error', text: err });
        },
        onNickChanged(newNick) {
          set(s => ({
            ourNick: newNick,
            server: s.server ? { ...s.server, nick: newNick } : null,
          }));
        },
        onMessage(msg) {
          get()._handleMessage(msg);
        },
        onRaw(line, dir) {
          get().addRawLogEntry(dir, line);
        },
      });
      client.onCapChange = () => {
        // mediaAvailable is NOT a cap: Orochi exposes MEDIA as a plain channel
        // command for any registered member (no advertised media cap), so it is
        // set on registration (001) / first NOTE MEDIA, not here. Only mirror
        // genuinely cap-gated UI affordances off the negotiated set.
        set({
          canEditMessages: client.negotiatedCaps.has('draft/message-editing'),
          canRedactMessages: client.negotiatedCaps.has('draft/message-redaction'),
          canReact: client.negotiatedCaps.has('draft/react'),
        });
      };

      client.connect();

      // Wait for registration to build the Server object
      const unsub = useOnyxStore.subscribe(
        s => s.status,
        status => {
          if (status === 'connected') {
            const net = client.isupport.NETWORK || 'IRCNet';
            const srv: Server = {
              id: uid(),
              name: net,
              network: net,
              url,
              icon: serverIcon(net),
              nick: client['opts']?.nick ?? nick,
              account: null,
              connected: true,
            };
            const caps = client.negotiatedCaps ? Array.from(client.negotiatedCaps) : [];
            set({
              server: srv,
              isIRCX: client.isupport.IRCX,
              networkName: net,
              serverCapabilities: caps,
            });
            unsub();
          }
        },
      );

      set({ client });
    },

    // ── disconnect ───────────────────────────────────────────────────────
    disconnect() {
      _clearReconnectCountdown();
      _stopNickReclaim();
      _reconnectAttempts = 0;
      _connectNick  = '';
      _saslAccount  = null;
      // Drop any in-flight CHATHISTORY batch state so a stale open batch can't
      // swallow live messages after a fresh connect.
      _batchCollectors.clear();
      _openChathistoryByTarget.clear();
      _motdBuffer = '';
      get().client?.destroy();
      set({
        client: null,
        status: 'disconnected',
        connectionStatus: 'disconnected',
        reconnectIn: 0,
        autoReconnect: false,
        channels: new Map(),
        dms: new Map(),
        server: null,
        activeView: { kind: 'home' },
        serverRules: [],
      });
    },

    // ── joinChannel ──────────────────────────────────────────────────────
    joinChannel(channel, key) {
      get().client?.join(channel, key);
    },

    // ── partChannel ──────────────────────────────────────────────────────
    partChannel(channel) {
      get().client?.sendRaw('PART', channel, 'Goodbye');
    },

    // ── navigate ─────────────────────────────────────────────────────────
    navigate(view) {
      set({ activeView: view });
      if (view.kind === 'channel') {
        get().markRead(view.channel);
        get().markChannelRead(view.channel);
        // Clear the unread separator when switching to a channel
        get().clearFirstUnread(view.channel);
      }
      if (view.kind === 'dm') {
        get().markRead(view.nick);
        // Clear the unread separator when switching to a DM
        get().clearFirstUnread(view.nick);
        // Opening the DM consumes any pending offline-message (TEGAMI) badge
        get().clearTegami(view.nick);
        // Track presence via MONITOR
        get().monitorAdd(view.nick);
      }
    },

    // ── sendMessage ──────────────────────────────────────────────────────
    sendMessage(target, text) {
      const { client, ourNick } = get();
      if (!client) return;

      if (text.startsWith('/')) {
        const [cmd, ...args] = text.slice(1).split(' ');
        client.sendRaw(cmd.toUpperCase(), ...args);
        return;
      }

      const { replyingTo } = get();
      const waitForServerEcho = client.negotiatedCaps.has('echo-message');

      // Send multiline as separate messages, with +draft/reply tag on first line when replying
      const lines = text.split('\n').filter(l => l.trim());
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (replyingTo && i === 0) {
          client.send(`@+draft/reply=${replyingTo.id} PRIVMSG ${target} :${line}\r\n`);
        } else {
          client.sendRaw('PRIVMSG', target, line);
        }
      }

      if (!waitForServerEcho) {
        const msg: ChatMessage = {
          id: uid(),
          time: new Date(),
          from: ourNick,
          text,
          type: 'msg',
          target,
          ...(replyingTo ? { replyTo: { id: replyingTo.id, from: replyingTo.from, text: replyingTo.text } } : {}),
        };
        set(s => _addMessage(s, target, msg));
        {
          const _cp = get().client?.isupport.CHANTYPES ?? '#&';
          if (target.length > 0 && _cp.includes(target[0])) get().updateChannelActivity(target);
        }
      }
      if (replyingTo) set({ replyingTo: null });
    },

    // ── sendRaw ──────────────────────────────────────────────────────────
    sendRaw(line) {
      get().client?.send(line + '\r\n');
    },

    registerAccount(account, email, password) {
      const { client } = get();
      if (!client) return;
      set({ registerPending: true, registerError: null, verifyRequired: false });
      client.sendRaw('REGISTER', account, email?.trim() || '*', password);
      // OCEAN-UI: RegisterForm should call registerAccount() and render
      // registerPending/registerError/verifyRequired instead of parsing NOTICE text.
    },

    verifyAccount(account, code) {
      const { client } = get();
      if (!client) return;
      set({ registerPending: true, registerError: null });
      client.sendRaw('VERIFY', account, code);
      // OCEAN-UI: verification UI should call verifyAccount(account, code).
    },

    // ── Nick reclaim / CERTFP services ───────────────────────────────────
    ghost(nick, password) {
      const { client } = get();
      if (!client) return;
      // Orochi: `GHOST <nick> <password>` (password-verified). Replies arrive
      // as a server NOTICE on success or numerics on failure — both surface in
      // serviceNotices / notifications through the normal message path.
      client.sendRaw('GHOST', nick, password);
    },

    reclaimNick(nick, password) {
      const { client } = get();
      if (!client) return false;
      const target = nick.trim();
      if (!target) return false;
      // Evict the stale session, then take the nick back. The periodic reclaim
      // timer (started on 001 when on an alias) also keeps retrying NICK until
      // the zombie dies, so a single follow-up NICK here is sufficient.
      client.sendRaw('GHOST', target, password);
      client.sendRaw('NICK', target);
      return true;
    },

    certAdd() {
      const { client } = get();
      // `CERTADD` takes no params — it binds the cert presented on THIS
      // connection. Server fails (FAIL CERTADD NO_CLIENT_CERT) if none.
      client?.sendRaw('CERTADD');
    },

    certList() {
      const { client } = get();
      // Replies: `:server NOTICE <nick> :CERTLIST <fp>` per fingerprint (or a
      // single "no fingerprints bound" notice). Surfaced via serviceNotices.
      client?.sendRaw('CERTLIST');
    },

    certDel(fingerprint) {
      const { client } = get();
      const fp = fingerprint.trim();
      if (!client || !fp) return;
      client.sendRaw('CERTDEL', fp);
    },

    // ── requestHistory ───────────────────────────────────────────────────
    requestHistory(channel, limit = 50) {
      const key = channel.toLowerCase();
      const { client, historyLoading, historyExhausted } = get();
      if (historyLoading.get(key) || historyExhausted.get(key)) return;
      if (!hasChatHistoryCap(client)) {
        get().setHistoryExhausted(channel);
        return;
      }

      get().setHistoryLoading(channel, true);
      client?.sendRaw('CHATHISTORY', 'LATEST', channel, '*', String(limit));
    },

    // ── toggleMemberList ─────────────────────────────────────────────────
    toggleMemberList() {
      set(s => ({ showMemberList: !s.showMemberList }));
    },

    // ── openSettings / closeSettings ─────────────────────────────────────
    openSettings(tab = 'account') {
      set({ showSettings: true, settingsTab: tab });
    },
    closeSettings() {
      set({ showSettings: false });
    },

    // ── markRead ─────────────────────────────────────────────────────────
    markRead(target) {
      const key = target.toLowerCase();
      set(s => {
        const channels = new Map(s.channels);
        const ch = channels.get(key);
        if (ch) channels.set(key, { ...ch, unread: 0, highlights: 0 });
        const dms = new Map(s.dms);
        const dm = dms.get(key);
        if (dm) dms.set(key, { ...dm, unread: 0, highlights: 0 });
        return { channels, dms };
      });
      // IRCv3 draft/read-marker: sync read position with server so other sessions know
      const { client } = get();
      if (client?.negotiatedCaps.has('draft/read-marker')) {
        const timestamp = new Date().toISOString();
        client.sendRaw('MARKREAD', target, `timestamp=${timestamp}`);
        // Track the marker locally too, so a later CHATHISTORY replay
        // re-derives unread state from the same position without waiting
        // for the server echo.
        set(s => {
          const readMarkers = new Map(s.readMarkers);
          readMarkers.set(key, timestamp);
          return { readMarkers };
        });
      }
    },

    // ── clearMessages ─────────────────────────────────────────────────────
    clearMessages(target) {
      const key = target.toLowerCase();
      const _cp = get().client?.isupport.CHANTYPES ?? '#&';
      const isChannel = target.length > 0 && _cp.includes(target[0]);
      set(s => {
        if (isChannel) {
          const channels = new Map(s.channels);
          const ch = channels.get(key);
          if (ch) channels.set(key, { ...ch, messages: [] });
          return { channels };
        } else {
          const dms = new Map(s.dms);
          const dm = dms.get(key);
          if (dm) dms.set(key, { ...dm, messages: [] });
          return { dms };
        }
      });
    },

    // ── notifications ─────────────────────────────────────────────────────
    addNotification(n) {
      const note: Notification = { ...n, id: uid(), at: new Date() };
      set(s => ({ notifications: [...s.notifications.slice(-49), note] }));
    },
    dismissNotification(id) {
      set(s => ({ notifications: s.notifications.filter(n => n.id !== id) }));
    },
    markNotificationRead(id) {
      set(s => ({ readNotificationIds: new Set([...s.readNotificationIds, id]) }));
    },
    markAllNotificationsRead() {
      set(s => ({ readNotificationIds: new Set(s.notifications.map(n => n.id)) }));
    },
    openNotificationCenter() {
      set({ showNotificationCenter: true });
    },
    closeNotificationCenter() {
      set({ showNotificationCenter: false });
    },

    // ── toast system ──────────────────────────────────────────────────────
    addToast(t) {
      const toast: Toast = { ...t, id: uid() };
      set(s => ({ toasts: [...s.toasts.slice(-19), toast] }));
    },
    dismissToast(id) {
      set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
    },

    // ── voice ─────────────────────────────────────────────────────────────
    setVoiceCallState(s) {
      set(prev => {
        const voice = { ...prev.voice, ...s };
        _saveVoiceSettings(voice);
        return { voice };
      });
      const engine = getMountedSuimyakuMediaEngine();
      if (s.muted !== undefined) engine?.setMuted(s.muted);
      if (s.deafened !== undefined) engine?.setDeafened(s.deafened);
      if (s.outputDeviceId !== undefined || s.outputVolume !== undefined) {
        const v = get().voice;
        engine?.setOutput(v.outputDeviceId, v.outputVolume);
      }
    },
    setVoiceParticipantSpeaking(nick, speaking) {
      set(prev => {
        const peers = new Map(prev.voice.peers);
        const peer = peers.get(nick);
        if (!peer) return {};
        peers.set(nick, { ...peer, speaking });
        return { voice: { ...prev.voice, peers } };
      });
    },
    setVoiceParticipantMuted(nick, muted) {
      set(prev => {
        const peers = new Map(prev.voice.peers);
        const peer = peers.get(nick);
        if (!peer) return {};
        peers.set(nick, { ...peer, muted });
        return { voice: { ...prev.voice, peers } };
      });
    },

    // ── messaging UX ──────────────────────────────────────────────────────
    setReplyingTo(msg) {
      set({ replyingTo: msg });
    },

    addLocalReaction(target, messageId, emoji) {
      const { ourNick } = get();
      const key = target.toLowerCase();

      const toggleReaction = (messages: ChatMessage[]): ChatMessage[] =>
        messages.map(m => {
          if (m.id !== messageId) return m;
          const existing: MessageReaction[] = m.reactions ?? [];
          const rIdx = existing.findIndex(r => r.emoji === emoji);
          let reactions: MessageReaction[];
          if (rIdx >= 0) {
            const r = existing[rIdx];
            if (r.users.includes(ourNick)) {
              // Remove user
              const newUsers = r.users.filter(u => u !== ourNick);
              reactions = newUsers.length
                ? existing.map((r2, i) => i === rIdx ? { ...r2, users: newUsers } : r2)
                : existing.filter((_, i) => i !== rIdx);
            } else {
              // Add user
              reactions = existing.map((r2, i) => i === rIdx ? { ...r2, users: [...r2.users, ourNick] } : r2);
            }
          } else {
            reactions = [...existing, { emoji, users: [ourNick] }];
          }
          return { ...m, reactions };
        });

      set(s => {
        const channels = new Map(s.channels);
        const ch = channels.get(key);
        if (ch) {
          channels.set(key, { ...ch, messages: toggleReaction(ch.messages) });
          return { channels };
        }
        const dms = new Map(s.dms);
        const dm = dms.get(key);
        if (dm) {
          dms.set(key, { ...dm, messages: toggleReaction(dm.messages) });
          return { dms };
        }
        return {};
      });
    },

    addReaction(target, messageId, emoji) {
      const { client } = get();
      // IRCv3 draft/react via TAGMSG with message tags
      if (client && client.negotiatedCaps.has('draft/react')) {
        client.tagmsg(target, {
          '+draft/react': emoji,
          '+draft/reply': messageId,
        });
        // With echo-message the server echoes the TAGMSG back and the TAGMSG handler
        // applies the reaction.  Without it we apply locally as an optimistic update.
        if (!client.negotiatedCaps.has('echo-message')) {
          get().addLocalReaction(target, messageId, emoji);
        }
      } else {
        // No draft/react cap — apply locally only (fallback UX)
        get().addLocalReaction(target, messageId, emoji);
      }
    },

    removeReaction(target, messageId, emoji, reactionNick) {
      const key = target.toLowerCase();
      const applyRemove = (messages: ChatMessage[]): ChatMessage[] =>
        messages.map(m => {
          if (m.id !== messageId) return m;
          const existing: MessageReaction[] = m.reactions ?? [];
          const rIdx = existing.findIndex(r => r.emoji === emoji);
          if (rIdx < 0) return m;
          const r = existing[rIdx];
          const newUsers = r.users.filter(u => u.toLowerCase() !== reactionNick.toLowerCase());
          const reactions = newUsers.length
            ? existing.map((r2, i) => i === rIdx ? { ...r2, users: newUsers } : r2)
            : existing.filter((_, i) => i !== rIdx);
          return { ...m, reactions };
        });

      set(s => {
        const channels = new Map(s.channels);
        const ch = channels.get(key);
        if (ch) {
          channels.set(key, { ...ch, messages: applyRemove(ch.messages) });
          return { channels };
        }
        const dms = new Map(s.dms);
        const dm = dms.get(key);
        if (dm) {
          dms.set(key, { ...dm, messages: applyRemove(dm.messages) });
          return { dms };
        }
        return {};
      });
    },

    editMessage(target, messageId, newText) {
      const { client, ourNick } = get();
      if (!client?.negotiatedCaps.has('draft/message-editing')) return;
      const key = target.toLowerCase();

      // Send EDIT command to the server (draft/message-editing cap)
      client.sendRaw('EDIT', target, messageId, newText);

      // Optimistic local update — only for our own messages
      const applyEdit = (messages: ChatMessage[]): ChatMessage[] =>
        messages.map(m =>
          m.id === messageId && m.from.toLowerCase() === ourNick.toLowerCase()
            ? { ...m, text: newText, edited: true }
            : m,
        );

      set(s => {
        const channels = new Map(s.channels);
        const ch = channels.get(key);
        if (ch) {
          channels.set(key, { ...ch, messages: applyEdit(ch.messages) });
          return { channels };
        }
        const dms = new Map(s.dms);
        const dm = dms.get(key);
        if (dm) {
          dms.set(key, { ...dm, messages: applyEdit(dm.messages) });
          return { dms };
        }
        return {};
      });
    },

    deleteMessage(target, messageId) {
      const { client, ourNick } = get();
      const key = target.toLowerCase();

      // IRCv3 draft/message-redaction via REDACT — Orochi wire form is
      // `REDACT <target> <msgid> [:reason]` (formatIRCLine adds the trailing
      // colon itself; passing ':Deleted' would double it).
      if (client?.negotiatedCaps.has('draft/message-redaction')) {
        client.sendRaw('REDACT', target, messageId, 'Deleted');
      }

      const applyDelete = (messages: ChatMessage[]): ChatMessage[] =>
        messages.map(m =>
          m.id === messageId && m.from.toLowerCase() === ourNick.toLowerCase()
            ? { ...m, redacted: true, text: '[Message deleted]' }
            : m,
        );

      set(s => {
        const channels = new Map(s.channels);
        const ch = channels.get(key);
        if (ch) {
          channels.set(key, { ...ch, messages: applyDelete(ch.messages) });
          return { channels };
        }
        const dms = new Map(s.dms);
        const dm = dms.get(key);
        if (dm) {
          dms.set(key, { ...dm, messages: applyDelete(dm.messages) });
          return { dms };
        }
        return {};
      });
    },

    _setTyping(channel, nick, active) {
      get().setTyping(channel, nick, active);
    },

    setTyping(target, nick, active) {
      const key = target.toLowerCase();
      const now = Date.now();
      set(s => {
        const typingUsers = new Map(s.typingUsers);
        const nickMap = new Map(typingUsers.get(key) ?? []);
        if (active) {
          nickMap.set(nick, now + 6000);
        } else {
          nickMap.delete(nick);
        }
        // Prune expired entries
        for (const [n, expiresAt] of nickMap) {
          if (expiresAt <= now) nickMap.delete(n);
        }
        typingUsers.set(key, nickMap);
        return { typingUsers };
      });
    },

    sendTypingStart(target) {
      const { client } = get();
      if (!client) return;
      if (!client.negotiatedCaps.has('draft/typing')) return;
      const key = target.toLowerCase();
      const now = Date.now();
      const lastSent = _typingLastSent.get(key) ?? 0;
      if (now - lastSent < 4000) return; // rate limit: at most once per 4s
      _typingLastSent.set(key, now);
      // Orochi inspects the spec client tag `+typing` (cap name draft/typing).
      client.tagmsg(target, { '+typing': 'active' });
    },

    sendTypingStop(target) {
      const { client } = get();
      if (!client) return;
      if (!client.negotiatedCaps.has('draft/typing')) return;
      _typingLastSent.delete(target.toLowerCase()); // reset rate limit so next start fires immediately
      client.tagmsg(target, { '+typing': 'done' });
    },

    // ── channel info ──────────────────────────────────────────────────────
    openChannelInfo(channel) {
      set({ showChannelInfo: true, channelInfoChannel: channel });
    },
    closeChannelInfo() {
      set({ showChannelInfo: false, channelInfoChannel: null });
    },

    // ── server settings ───────────────────────────────────────────────────
    openServerSettings() {
      set({ showServerSettings: true });
    },
    closeServerSettings() {
      set({ showServerSettings: false });
    },

    // ── access list ───────────────────────────────────────────────────────
    openAccessList() {
      set({ showAccessList: true });
    },
    closeAccessList() {
      set({ showAccessList: false });
    },

    // ── pinned messages ───────────────────────────────────────────────────
    openPinnedMessages() {
      set({ showPinnedMessages: true });
    },
    closePinnedMessages() {
      set({ showPinnedMessages: false });
    },
    pinMessage(target, msg) {
      const key = target.toLowerCase();
      set(s => {
        const pinnedMessages = new Map(s.pinnedMessages);
        const existing = pinnedMessages.get(key) ?? [];
        if (existing.some(m => m.id === msg.id)) return {};
        pinnedMessages.set(key, [...existing, msg]);
        return { pinnedMessages };
      });
    },
    unpinMessage(target, messageId) {
      const key = target.toLowerCase();
      set(s => {
        const pinnedMessages = new Map(s.pinnedMessages);
        const existing = pinnedMessages.get(key) ?? [];
        pinnedMessages.set(key, existing.filter(m => m.id !== messageId));
        return { pinnedMessages };
      });
    },

    // ── IRCX PROP requests ────────────────────────────────────────────────
    requestChannelProps(channel) {
      get().client?.sendRaw('PROP', channel);
    },
    requestUserProps(nick) {
      get().client?.sendRaw('PROP', nick);
    },

    // ── MONITOR ───────────────────────────────────────────────────────────
    monitorAdd(nick) {
      const key = nick.toLowerCase();
      if (get().monitoredNicks.has(key)) return;
      set(s => ({ monitoredNicks: new Set([...s.monitoredNicks, key]) }));
      get().client?.sendRaw('MONITOR', '+', nick);
    },

    // ── Friends / Contacts ────────────────────────────────────────────────
    addFriend(nick) {
      const key = nick.toLowerCase();
      set(s => {
        const friends = new Map(s.friends);
        friends.set(key, { nick, online: false });
        _saveFriends(friends);
        return { friends };
      });
      get().monitorAdd(nick);
    },
    removeFriend(nick) {
      const key = nick.toLowerCase();
      set(s => {
        const friends = new Map(s.friends);
        friends.delete(key);
        _saveFriends(friends);
        return { friends };
      });
      get().client?.sendRaw('MONITOR', '-', nick);
    },
    setFriendOnline(nick, online) {
      const key = nick.toLowerCase();
      set(s => {
        if (!s.friends.has(key)) return {};
        const friends = new Map(s.friends);
        const f = friends.get(key)!;
        friends.set(key, { ...f, online });
        return { friends };
      });
    },
    openFriendsPanel() { set({ showFriendsPanel: true }); },
    closeFriendsPanel() { set({ showFriendsPanel: false }); },

    // ── user presence status ──────────────────────────────────────────────
    setUserStatus(status) {
      set({ userStatus: status });
      const { client } = get();
      if (!client) return;
      switch (status) {
        case 'online':
          client.sendRaw('AWAY'); // clear away
          break;
        case 'idle':
          client.sendRaw('AWAY', 'Away');
          break;
        case 'dnd':
          client.sendRaw('AWAY', 'Do Not Disturb');
          break;
        case 'offline':
          // Can't truly go "offline" without disconnecting;
          // send away message to indicate unavailable
          client.sendRaw('AWAY', 'Invisible');
          break;
      }
    },

    // ── custom status ─────────────────────────────────────────────────────
    setCustomStatus(status) {
      set({ customStatus: status });
      // Persist to localStorage
      try {
        if (typeof window !== 'undefined') {
          if (status) {
            localStorage.setItem('ocean-custom-status', status);
          } else {
            localStorage.removeItem('ocean-custom-status');
          }
        }
      } catch { /* ignore */ }
      // Update own activity locally so rich presence shows immediately
      const { client, isIRCX, userStatus, ourNick } = get();
      if (ourNick) {
        const key = ourNick.toLowerCase();
        const parsed = parseActivity(status);
        set(s => {
          const userActivities = { ...s.userActivities };
          if (parsed) {
            userActivities[key] = { emoji: parsed.emoji, typeLabel: parsed.typeLabel, text: parsed.text };
          } else {
            delete userActivities[key];
          }
          return { userActivities };
        });
      }
      // Send to IRC via IRCX PROP
      if (client && isIRCX) {
        client.sendRaw('PROP', '*', 'STATUS', status);
        // Optionally update AWAY when idle and status is set
        if (status && userStatus === 'idle') {
          client.sendRaw('AWAY', `Idle — ${status}`);
        }
      }
    },
    openCustomStatus() {
      set({ showCustomStatus: true });
    },
    closeCustomStatus() {
      set({ showCustomStatus: false });
    },
    setCustomStatusExpiry(expiry) {
      set({ customStatusExpiry: expiry });
      try {
        if (typeof window !== 'undefined') {
          if (expiry) {
            localStorage.setItem('ocean-custom-status-expiry', expiry.toISOString());
          } else {
            localStorage.removeItem('ocean-custom-status-expiry');
          }
        }
      } catch { /* ignore */ }
    },

    // ── user activities ───────────────────────────────────────────────────
    setUserActivity(nick, emoji, typeLabel, text) {
      const key = nick.toLowerCase();
      set(s => ({
        userActivities: { ...s.userActivities, [key]: { emoji, typeLabel, text } },
      }));
    },
    clearUserActivity(nick) {
      const key = nick.toLowerCase();
      set(s => {
        const next = { ...s.userActivities };
        delete next[key];
        return { userActivities: next };
      });
    },

    // ── profile modal ─────────────────────────────────────────────────────
    openWhois(nick) {
      set(s => {
        const whoisData = new Map(s.whoisData);
        whoisData.set(nick.toLowerCase(), { nick, loading: true });
        return { showWhois: true, whoisNick: nick, whoisData };
      });
      // WHOIS nick nick — double nick requests idle time (RPL_WHOISIDLE 317)
      get().client?.sendRaw('WHOIS', nick, nick);
    },
    closeWhois() {
      set({ showWhois: false, whoisNick: null });
    },

    openUserProfile(nick) {
      set({ showUserProfile: true, userProfileNick: nick });
    },
    closeUserProfile() {
      set({ showUserProfile: false, userProfileNick: null });
    },

    openUserProfileCard(nick, anchor) {
      set({ profileNick: nick, profileAnchor: anchor });
    },
    closeUserProfileCard() {
      set({ profileNick: null, profileAnchor: null });
    },

    // ── per-channel notification prefs ───────────────────────────────────
    setChannelNotify(target, level) {
      const key = target.toLowerCase();
      set(s => {
        const channelNotify = new Map(s.channelNotify);
        if (level === 'all') {
          channelNotify.delete(key); // 'all' is the default — no entry needed
        } else {
          channelNotify.set(key, level);
        }
        _saveChannelNotify(channelNotify);
        return { channelNotify };
      });
    },
    muteChannel(channel) {
      get().setChannelNotify(channel, 'none');
    },
    unmuteChannel(channel) {
      get().setChannelNotify(channel, 'all');
    },

    // ── thread panel ──────────────────────────────────────────────────────
    openThread(messageId) {
      set(s => ({
        showThreadPanel: true,
        threadParentId: messageId,
        threadLastSeen: { ...s.threadLastSeen, [messageId]: new Date() },
      }));
    },
    closeThread() {
      set({ showThreadPanel: false, threadParentId: null });
    },
    markThreadSeen(parentMsgId) {
      set(s => ({
        threadLastSeen: { ...s.threadLastSeen, [parentMsgId]: new Date() },
      }));
    },

    // ── thread archive ────────────────────────────────────────────────────
    archiveThread(parentMsgId) {
      set(s => {
        const archivedThreads = new Set(s.archivedThreads);
        archivedThreads.add(parentMsgId);
        const activeThreads = new Set(s.activeThreads);
        activeThreads.delete(parentMsgId);
        return { archivedThreads, activeThreads };
      });
    },
    unarchiveThread(parentMsgId) {
      set(s => {
        const archivedThreads = new Set(s.archivedThreads);
        archivedThreads.delete(parentMsgId);
        return { archivedThreads };
      });
    },
    addActiveThread(id) {
      set(s => {
        const activeThreads = new Set(s.activeThreads);
        activeThreads.add(id);
        return { activeThreads };
      });
    },
    setThreadAutoArchiveMinutes(m) {
      set({ threadAutoArchiveMinutes: m });
    },

    // ── message forwarding ────────────────────────────────────────────────
    setForwardingMessage(msg) {
      set({ forwardingMessage: msg });
    },

    // ── bookmarks ─────────────────────────────────────────────────────────
    addBookmark(msg) {
      set(s => {
        if (s.bookmarks.some(b => b.id === msg.id)) return {};
        const bookmarks = [...s.bookmarks, msg];
        _saveBookmarks(bookmarks);
        return { bookmarks };
      });
    },
    removeBookmark(messageId) {
      set(s => {
        const bookmarks = s.bookmarks.filter(b => b.id !== messageId);
        _saveBookmarks(bookmarks);
        return { bookmarks };
      });
    },
    openBookmarks() {
      set({ showBookmarks: true });
    },
    closeBookmarks() {
      set({ showBookmarks: false });
    },

    // ── search overlay ────────────────────────────────────────────────────
    openSearchOverlay() {
      set({ showSearchOverlay: true });
    },
    closeSearchOverlay() {
      set({ showSearchOverlay: false });
    },

    // ── keyboard shortcuts modal ──────────────────────────────────────────
    openKeyboardShortcuts() {
      set({ showKeyboardShortcuts: true });
    },
    closeKeyboardShortcuts() {
      set({ showKeyboardShortcuts: false });
    },

    // ── unread separator ──────────────────────────────────────────────────
    markFirstUnread(target, messageId) {
      const key = target.toLowerCase();
      set(s => {
        if (s.firstUnreadId.has(key)) return {};
        const firstUnreadId = new Map(s.firstUnreadId);
        firstUnreadId.set(key, messageId);
        return { firstUnreadId };
      });
    },
    forceMarkFirstUnread(target, messageId) {
      const key = target.toLowerCase();
      set(s => {
        const firstUnreadId = new Map(s.firstUnreadId);
        firstUnreadId.set(key, messageId);
        return { firstUnreadId };
      });
    },
    clearFirstUnread(target) {
      const key = target.toLowerCase();
      set(s => {
        if (!s.firstUnreadId.has(key)) return {};
        const firstUnreadId = new Map(s.firstUnreadId);
        firstUnreadId.delete(key);
        return { firstUnreadId };
      });
    },

    // ── channel browser ───────────────────────────────────────────────────
    openChannelBrowser() {
      set({ showChannelBrowser: true });
      get().refreshChannelList();
    },
    closeChannelBrowser() {
      set({ showChannelBrowser: false });
    },
    refreshChannelList() {
      set({ channelListLoading: true, channelList: [] });
      get().client?.sendRaw('LIST');
    },

    // ── onboarding ────────────────────────────────────────────────────────
    startOnboarding() {
      set({ showOnboarding: true, onboardingStep: 0 });
    },
    nextOnboardingStep() {
      const { onboardingStep } = get();
      if (onboardingStep >= 3) {
        get().skipOnboarding();
      } else {
        set({ onboardingStep: onboardingStep + 1 });
      }
    },
    skipOnboarding() {
      set({ showOnboarding: false });
      const hostname = get().server?.url ?? 'unknown';
      const key = `ocean-onboarded-${hostname}`;
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem(key, '1');
        }
      } catch { /* ignore */ }
    },

    // ── audit log ─────────────────────────────────────────────────────────
    addAuditEntry(entry) {
      const full: AuditEntry = {
        ...entry,
        id: crypto.randomUUID(),
        timestamp: new Date(),
      };
      set(s => ({ auditLog: [full, ...s.auditLog].slice(0, 500) }));
    },

    // ── chat history ──────────────────────────────────────────────────
    setHistoryLoading(target, loading) {
      const key = target.toLowerCase();
      set(s => {
        const historyLoading = new Map(s.historyLoading);
        historyLoading.set(key, loading);
        return { historyLoading };
      });
    },

    setHistoryExhausted(target) {
      const key = target.toLowerCase();
      set(s => {
        const historyExhausted = new Map(s.historyExhausted);
        historyExhausted.set(key, true);
        const historyLoading = new Map(s.historyLoading);
        historyLoading.set(key, false);
        return { historyExhausted, historyLoading };
      });
    },

    loadHistory(target, before) {
      const key = target.toLowerCase();
      const { historyLoading, historyExhausted, client } = get();
      if (historyLoading.get(key) || historyExhausted.get(key)) return;

      if (!hasChatHistoryCap(client)) {
        // Server doesn't support CHATHISTORY — mark exhausted immediately
        get().setHistoryExhausted(target);
        return;
      }

      get().setHistoryLoading(target, true);
      if (before) {
        client?.sendRaw('CHATHISTORY', 'BEFORE', target, historyReference(before), String(HISTORY_PAGE_SIZE));
      } else {
        client?.sendRaw('CHATHISTORY', 'LATEST', target, '*', String(HISTORY_PAGE_SIZE));
      }
    },

    // ── raw log ───────────────────────────────────────────────────────────
    toggleRawLog() {
      set(s => ({ showRawLog: !s.showRawLog }));
    },
    addRawLogEntry(dir, line) {
      if (!get().rawLogEnabled) return;
      const entry: RawLogEntry = { ts: new Date(), dir, line };
      set(s => ({ rawLog: [...s.rawLog.slice(-499), entry] }));
    },
    setRawLogEnabled(enabled) {
      set({ rawLogEnabled: enabled });
    },
    clearRawLog() {
      set({ rawLog: [] });
    },

    // ── Message search ────────────────────────────────────────────────────
    openMessageSearch() {
      set({ showMessageSearch: true });
    },
    closeMessageSearch() {
      set({ showMessageSearch: false, messageSearchResults: [], messageSearchQuery: '' });
    },
    searchMessages(channel, query) {
      set({ messageSearchLoading: true, messageSearchQuery: query });
      const ch = get().channels.get(channel.toLowerCase());
      const messages = ch?.messages ?? [];
      const q = query.toLowerCase();
      const results = messages.filter(m => m.text.toLowerCase().includes(q)).slice(-50).reverse();
      set({ messageSearchResults: results, messageSearchLoading: false });
    },

    // ── MOTD ─────────────────────────────────────────────────────────────
    closeMotd() {
      set({ showMotd: false });
    },

    // ── Server Rules ─────────────────────────────────────────────────────
    openServerRulesModal() {
      set({ showServerRulesModal: true });
    },
    closeServerRulesModal() {
      set({ showServerRulesModal: false });
    },

    // ── Mobile sidebar ────────────────────────────────────────────────────
    openMobileSidebar() {
      set({ mobileSidebarOpen: true });
    },
    closeMobileSidebar() {
      set({ mobileSidebarOpen: false });
    },

    // ── Spotlight search ──────────────────────────────────────────────────
    openSpotlight() {
      set({ showSpotlight: true });
    },
    closeSpotlight() {
      set({ showSpotlight: false });
    },
    toggleSpotlight() {
      set(s => ({ showSpotlight: !s.showSpotlight }));
    },

    // ── Theme ─────────────────────────────────────────────────────────────
    setTheme(theme) {
      if (typeof window !== 'undefined') localStorage.setItem('ocean-active-theme', theme);
      set({ activeTheme: theme });
    },

    // ── Theme modal ────────────────────────────────────────────────────────
    openThemeModal() {
      set({ showThemeModal: true });
    },
    closeThemeModal() {
      set({ showThemeModal: false });
    },

    // ── Message density ──────────────────────────────────────────────────
    setMessageDensity(messageDensity) {
      if (typeof window !== 'undefined') localStorage.setItem('ocean-density', messageDensity);
      set({ messageDensity });
    },

    // ── channel join prompt ───────────────────────────────────────────────
    setChannelJoinPrompt(channel, error) {
      set({ channelJoinPrompt: { channel, error } });
    },
    clearChannelJoinPrompt() {
      set({ channelJoinPrompt: null });
    },

    // ── media gallery ─────────────────────────────────────────────────────
    openMediaGallery() {
      set({ showMediaGallery: true });
    },
    closeMediaGallery() {
      set({ showMediaGallery: false });
    },

    // ── whiteboard panel ──────────────────────────────────────────────────
    openWhiteboard() {
      set({ showWhiteboard: true });
    },
    closeWhiteboard() {
      set({ showWhiteboard: false });
    },

    // ── services panel ────────────────────────────────────────────────────
    openServices(tab = 'account') {
      set({ showServices: true, servicesTab: tab });
    },
    closeServices() {
      set({ showServices: false });
    },
    addServiceNotice(source, text) {
      set(s => ({
        serviceNotices: [...s.serviceNotices, { source, text, time: new Date() }].slice(-60),
      }));
    },
    clearServiceNotices() {
      set({ serviceNotices: [] });
    },

    // ── Ignore list ───────────────────────────────────────────────────────
    ignoreUser(nick) {
      const key = nick.toLowerCase();
      set(s => {
        const ignoredUsers = new Set(s.ignoredUsers);
        ignoredUsers.add(key);
        _saveIgnoredUsers(ignoredUsers);
        return { ignoredUsers };
      });
    },
    unignoreUser(nick) {
      const key = nick.toLowerCase();
      set(s => {
        const ignoredUsers = new Set(s.ignoredUsers);
        ignoredUsers.delete(key);
        _saveIgnoredUsers(ignoredUsers);
        return { ignoredUsers };
      });
    },
    isIgnored(nick) {
      return get().ignoredUsers.has(nick.toLowerCase());
    },
    openIgnoreList() {
      set({ showIgnoreList: true });
    },
    closeIgnoreList() {
      set({ showIgnoreList: false });
    },

    // ── Soft ignore (client-side message hide) ────────────────────────────
    toggleSoftIgnore(nick) {
      set(s => {
        const n = new Set(s.softIgnoreList);
        if (n.has(nick)) {
          n.delete(nick);
        } else {
          n.add(nick);
        }
        _saveSoftIgnoreList(n);
        return { softIgnoreList: n };
      });
    },
    revealMessage(msgId) {
      set(s => ({
        revealedMessages: new Set([...s.revealedMessages, msgId]),
      }));
    },

    // ── Collapsed nicks ───────────────────────────────────────────────────
    collapseNickMessages(nick) {
      set(s => ({ collapsedNicks: new Set([...s.collapsedNicks, nick.toLowerCase()]) }));
    },
    expandNickMessages(nick) {
      set(s => {
        const next = new Set(s.collapsedNicks);
        next.delete(nick.toLowerCase());
        return { collapsedNicks: next };
      });
    },
    toggleNickCollapse(nick) {
      const key = nick.toLowerCase();
      if (get().collapsedNicks.has(key)) {
        get().expandNickMessages(nick);
      } else {
        get().collapseNickMessages(nick);
      }
    },

    // ── internal message handler ──────────────────────────────────────────
    _handleMessage(msg: IRCMessage) {
      const { command, params, nick, tags } = msg;
      const { ourNick } = get();

      // Use server-advertised CHANTYPES for channel detection; fall back to '#&'.
      const chanPfx = get().client?.isupport.CHANTYPES ?? '#&';
      const isChan = (t: string): boolean => t.length > 0 && chanPfx.includes(t[0]);
      const standard = parseStandardReply(msg);
      if (standard) {
        if (standard.kind === 'NOTE' && standard.command === 'SESSION' && standard.code === 'TOKEN') {
          const token = parseSessionTokenNote(msg);
          if (token) {
            const canonicalNick = _saslAccount ?? undefined;
            import('@/lib/credentials').then(({ storeSessionToken }) => {
              storeSessionToken(token, undefined, canonicalNick);
            }).catch(() => {});
          }
          return;
        }
        if (standard.kind === 'NOTE' && standard.command === 'SESSION' && standard.code === 'MTOKEN') {
          // Mesh-sealed reclaim token: persist it so a reconnect that lands on a
          // different mesh node can still resume via SESSION RESUME <mtoken>
          // (server.zig handleSession TOKEN → handleMeshReclaim).
          const mtoken = parseSessionMeshTokenNote(msg);
          if (mtoken) {
            import('@/lib/credentials').then(({ storeMeshToken }) => {
              storeMeshToken(mtoken);
            }).catch(() => {});
          }
          return;
        }
        if (standard.kind === 'FAIL' && standard.command === 'SESSION') {
          import('@/lib/credentials').then(({ clearSessionToken }) => {
            clearSessionToken(get().server?.url, _connectNick || get().ourNick);
          }).catch(() => {});
          get().addNotification({ type: 'error', text: standard.description || `SESSION ${standard.code}` });
          return;
        }
        if (standard.command === 'REGISTER' || standard.command === 'VERIFY') {
          if (standard.kind === 'FAIL') {
            set({ registerPending: false, registerError: standard.description || standard.code, verifyRequired: false });
          }
          return;
        }
        if (standard.kind === 'FAIL' && standard.command === 'RENAME') {
          get().addNotification({
            type: 'error',
            text: standard.description || `RENAME failed (${standard.code})`,
          });
          return;
        }
        if (standard.kind === 'NOTE' && standard.command === 'TEGAMI') {
          // Orochi deliverTegami: `:server NOTE TEGAMI :from <nick> :<text>`
          // The whole `from <nick> :<text>` arrives as one trailing param.
          const body = msg.params[1] ?? '';
          const tegamiMatch = body.match(/^from (\S+) :([\s\S]*)$/) ?? body.match(/^from (\S+) ([\s\S]*)$/);
          if (tegamiMatch) {
            const tegamiFrom = tegamiMatch[1];
            const tegamiText = tegamiMatch[2];
            const tegamiKey = tegamiFrom.toLowerCase();
            const tegamiMsg: ChatMessage = {
              id: tags['msgid'] ?? uid(),
              time: tags['time'] ? new Date(tags['time']) : new Date(),
              from: tegamiFrom,
              text: tegamiText,
              type: 'msg',
              target: tegamiFrom,
              highlight: true,
            };
            set(s => _addDMMessage(s, tegamiFrom, tegamiMsg));
            const prev = get().tegami.get(tegamiKey);
            const agg = {
              count: (prev?.count ?? 0) + 1,
              firstMsgId: prev?.firstMsgId ?? tegamiMsg.id,
            };
            set(s => ({ tegami: new Map(s.tegami).set(tegamiKey, agg) }));
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('ocean:tegami', {
                detail: { channel: tegamiFrom, count: agg.count, firstMsgId: agg.firstMsgId },
              }));
            }
          }
          return;
        }
        if (standard.kind === 'FAIL' && standard.command === 'CHATHISTORY') {
          const target = standard.context.find(p => isChan(p));
          if (target) {
            get().setHistoryLoading(target, false);
            get().setHistoryExhausted(target);
          }
          return;
        }
        if (standard.command === 'MEDIA') {
          // `NOTE MEDIA` is NOT a standard reply: it has the shape
          //   :server NOTE MEDIA <#chan> <verb> [<nick>] [extra...]
          // The standard-reply context/description split mis-attributes the
          // actor when there is no trailing kind (e.g. LEAVE), so parse the raw
          // params directly. params = ['MEDIA', '#chan', verb, nick?, ...extra].
          const mediaParams = msg.params;
          const mediaChannel = mediaParams[1] ?? '';
          const mediaVerb = (mediaParams[2] ?? '').toUpperCase();
          const mediaActor = mediaParams[3] ?? '';

          // ── Live captions / transcript replay ──────────────────────────
          // `:server NOTE MEDIA <#chan> CAPTION <nick> :<text>` (live fan-out)
          // `:server NOTE MEDIA <#chan> TRANSCRIPT <speaker> :<text>` (replay)
          if (mediaVerb === 'CAPTION' || mediaVerb === 'TRANSCRIPT') {
            const capChannel = mediaChannel;
            const capNick = mediaActor;
            const capText = mediaParams.slice(4).join(' ');
            if (capChannel && capNick && capText) {
              set(s => {
                const mediaTranscripts = new Map(s.mediaTranscripts);
                const tKey = capChannel.toLowerCase();
                const entries = [
                  ...(mediaTranscripts.get(tKey) ?? []).slice(-199),
                  { nick: capNick, text: capText, time: tags['time'] ? new Date(tags['time']) : new Date() },
                ];
                mediaTranscripts.set(tKey, entries);
                return { mediaTranscripts };
              });
              // Live captions feed the CaptionsOverlay. Orochi fans out
              // complete utterances, so each caption line is final.
              if (mediaVerb === 'CAPTION' && typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('ocean:caption', {
                  detail: { channel: capChannel, nick: capNick, text: capText, final: true },
                }));
              }
            }
            return;
          }
          const channel = mediaChannel;
          const verb = mediaVerb;
          // Presence verbs are `<verb> <nick> [kind]`; signaling verbs
          // (TRANSPORT/NATIVE/PROFILE/LAYER…) have no nick. Only treat param[3]
          // as an actor for presence; otherwise forward the whole tail.
          const isPresenceVerb = verb === 'JOIN' || verb === 'LEAVE' || verb === 'ROSTER'
            || verb === 'MUTE' || verb === 'UNMUTE' || verb === 'SPEAKING' || verb === 'HAND'
            || verb === 'REACT';
          const actor = isPresenceVerb ? (mediaActor || nick || '') : '';
          // Pass the full param tail after the verb so the media engine can parse
          // per-verb signaling payloads itself.
          const detail = mediaParams.slice(3).join(' ');

          if (channel) {
            const chKey = channel.toLowerCase();
            if ((verb === 'JOIN' || verb === 'ROSTER') && actor) {
              set(s => {
                const map = new Map(s.voiceChannelParticipants);
                const pSet = new Set(map.get(chKey) ?? []);
                pSet.add(actor);
                map.set(chKey, pSet);
                return { voiceChannelParticipants: map, mediaAvailable: true };
              });
            } else if (verb === 'LEAVE' && actor) {
              set(s => {
                const map = new Map(s.voiceChannelParticipants);
                const pSet = new Set(map.get(chKey) ?? []);
                pSet.delete(actor);
                map.set(chKey, pSet);
                return { voiceChannelParticipants: map, mediaAvailable: true };
              });
            } else {
              set({ mediaAvailable: true });
            }
            // Forward every NOTE MEDIA (presence + signaling) to the engine.
            getMountedSuimyakuMediaEngine()?.handleMediaMessage(actor, channel, verb, detail);
          } else {
            set({ mediaAvailable: true });
          }
          return;
        }
        get().addServiceNotice(standard.command, `${standard.kind} ${standard.code}${standard.description ? `: ${standard.description}` : ''}`);
        return;
      }

      switch (command) {

        // ── Registration ──────────────────────────────────────────────────
        case '001': { // RPL_WELCOME
          // Orochi exposes voice/video via the MEDIA channel command for any
          // registered member — there is no media cap to gate on, so mark it
          // available on registration. NOTE MEDIA events keep it true.
          set({ ourNick: params[0], mediaAvailable: true });
          // Show onboarding if this server hasn't been visited before
          const hostname = get().server?.url ?? 'unknown';
          const onboardKey = `ocean-onboarded-${hostname}`;
          if (typeof window !== 'undefined' && !localStorage.getItem(onboardKey)) {
            get().startOnboarding();
          }
          // Re-add all friends to MONITOR after connect
          for (const f of get().friends.values()) {
            get().monitorAdd(f.nick);
          }
          // Request server stats for HomeView widget
          get().client?.sendRaw('LUSERS');
          // Send initial latency ping
          {
            const t = _now();
            const cookie = `lat-${t|0}`;
            _pingTimestamps.set(cookie, t);
            get().client?.sendRaw('PING', cookie);
          }
          // Auto-join configured channels (fall back to #root on eshmaki.me).
          // SKIP this blind autojoin storm when the server advertised
          // `orochi/session-sync`: in that mode the server itself pushes JOIN +
          // NAMES/topic + CHATHISTORY replay for every channel the account's
          // session is live in, so reconnect reclaims the live session without
          // the client guessing from localStorage. Falls back to the old
          // behavior on servers that don't ACK the cap (backward compatible).
          {
            const sessionSync = get().client?.sessionSyncActive ?? false;
            if (!sessionSync) {
              const { autoJoinChannels } = get();
              const serverUrl = get().server?.url ?? '';
              const isDefault = serverUrl.includes('eshmaki.me');
              const channels = autoJoinChannels.length > 0
                ? autoJoinChannels
                : (isDefault ? ['#root'] : []);
              if (channels.length > 0) {
                setTimeout(() => {
                  for (const ch of channels) {
                    get().client?.sendRaw('JOIN', ch);
                  }
                }, 1000);
              }
            }
          }
          // Reset nick alias counter — we successfully registered
          _nickAliasTryIdx = 0;
          // Determine the desired nick:
          //   1. _saslAccount — canonical account name from 900 RPL_LOGGEDIN
          //                     (handles saved credentials that stored an alias nick)
          //   2. _connectNick — what was passed to connect()
          //   3. connectedNick — final fallback
          {
            const connectedNick = params[0];
            const desiredNick = (_saslAccount && _saslAccount !== '*')
              ? _saslAccount
              : (_connectNick || connectedNick);
            const isAlias = connectedNick.toLowerCase() !== desiredNick.toLowerCase();
            set({ currentNickIsAlias: isAlias });

            // If we landed on an alias after SASL auth, the server
            // already evicted the stale session in stoken_step — just reclaim
            // the nick directly. No GHOST needed.
            if (isAlias && _saslAccount) {
              get().client?.sendRaw('NICK', desiredNick);
              // Also start the periodic retry timer: if the zombie isn't dead
              // yet (ping-timeout scenario), this retries every 30 s until
              // the server kills the zombie and frees the nick.
              _startNickReclaim(desiredNick);
            }
          }
          // Send watch list to server through IRCv3 MONITOR.
          {
            const { watchList: wl } = get();
            if (wl.length > 0) {
              get().client?.sendRaw('MONITOR', '+', wl.map(w => w.nick).join(','));
            }
          }
          break;
        }

        case 'ACCOUNT': {
          const account = params[0] === '*' ? null : params[0];
          set(s => ({ server: s.server ? { ...s.server, account } : null }));
          break;
        }

        case 'REGISTER': {
          const sub = (params[0] ?? '').toUpperCase();
          if (sub === 'SUCCESS') {
            set({ registerPending: false, registerError: null, verifyRequired: false });
          } else if (sub === 'VERIFICATION_REQUIRED') {
            set({ registerPending: false, registerError: null, verifyRequired: true });
          }
          break;
        }

        case 'VERIFY': {
          const sub = (params[0] ?? '').toUpperCase();
          if (sub === 'SUCCESS') {
            set({ registerPending: false, registerError: null, verifyRequired: false });
          }
          break;
        }

        // ── Channels ──────────────────────────────────────────────────────
        case 'JOIN': {
          const ch = params[0];
          const key = ch.toLowerCase();
          const joiner = nick ?? '';
          const isSelf = joiner.toLowerCase() === ourNick.toLowerCase();
          // extended-join: params[1] = account ('*' = not logged in), params[2] = realname
          const joinAccount = params[1] && params[1] !== '*' ? params[1] : undefined;

          if (isSelf) {
            // We joined — create channel if not exists
            set(s => {
              const channels = new Map(s.channels);
              if (!channels.has(key)) channels.set(key, emptyChannel(ch));
              return { channels, activeView: { kind: 'channel', channel: ch } };
            });
            // Track session join history
            get().addJoinHistory(ch);
            // Kick off initial history fetch (CHATHISTORY LATEST #channel * 50)
            get().loadHistory(ch);
            // Fetch the stored read marker so unread/firstUnreadId can be
            // derived once the CHATHISTORY replay lands (MARKREAD GET).
            if (get().client?.negotiatedCaps.has('draft/read-marker')) {
              get().client?.sendRaw('MARKREAD', ch);
            }
            // Fetch WHO data for away status
            get().client?.sendRaw('WHO', ch);
          } else {
            // Someone else joined
            set(s => {
              const channels = new Map(s.channels);
              const c = channels.get(key);
              if (c) {
                const users = new Map(c.users);
                users.set(joiner.toLowerCase(), {
                  nick: joiner,
                  modes: new Set(),
                  away: false,
                  ...(joinAccount ? { account: joinAccount } : {}),
                });
                const msgs = [...(c.messages ?? []), sysMsg(`${joiner} joined`, ch)];
                channels.set(key, { ...c, users, messages: msgs } as Channel);
              }
              return { channels };
            });
            get().addChannelEvent(ch, { type: 'join', nick: joiner, text: `${joiner} joined`, time: new Date() });
          }
          break;
        }

        case 'PART': {
          const ch = params[0];
          const key = ch.toLowerCase();
          const parter = nick ?? '';
          const isSelf = parter.toLowerCase() === ourNick.toLowerCase();

          if (isSelf) {
            set(s => {
              const channels = new Map(s.channels);
              channels.delete(key);
              const channelFolders = s.channelFolders.map(f => ({
                ...f,
                channels: f.channels.filter(c => c.toLowerCase() !== key),
              }));
              _saveChannelFolders(channelFolders);
              const active = s.activeView;
              const next: ActiveView = active.kind === 'channel' && active.channel.toLowerCase() === key
                ? { kind: 'home' }
                : active;
              return { channels, channelFolders, activeView: next };
            });
          } else {
            const partReason = params[1] ?? '';
            set(s => {
              const channels = new Map(s.channels);
              const c = channels.get(key);
              if (c) {
                const users = new Map(c.users);
                users.delete(parter.toLowerCase());
                const reasonSuffix = partReason ? ` (${partReason})` : '';
                const msgs = [...(c.messages ?? []), sysMsg(`${parter} left${reasonSuffix}`, ch)];
                channels.set(key, { ...c, users, messages: msgs } as Channel);
              }
              return { channels };
            });
            const partText = partReason ? `${parter} left (${partReason})` : `${parter} left`;
            get().addChannelEvent(ch, { type: 'part', nick: parter, text: partText, time: new Date() });
          }
          break;
        }

        case 'QUIT': {
          const quitter = nick ?? '';
          const quitReason = params[0] ?? '';
          const quitChannels: string[] = [];
          set(s => {
            const channels = new Map(s.channels);
            for (const [chanKey, ch] of channels) {
              if (ch.users.has(quitter.toLowerCase())) {
                const users = new Map(ch.users);
                users.delete(quitter.toLowerCase());
                const msgs = [...(ch.messages ?? []), sysMsg(`${quitter} quit: ${quitReason}`, ch.name)];
                channels.set(chanKey, { ...ch, users, messages: msgs } as Channel);
                quitChannels.push(ch.name);
              }
            }
            return { channels };
          });
          for (const chanName of quitChannels) {
            const quitText = quitReason ? `${quitter} quit (${quitReason})` : `${quitter} quit`;
            get().addChannelEvent(chanName, { type: 'quit', nick: quitter, text: quitText, time: new Date() });
          }
          break;
        }

        case 'KICK': {
          const [ch, target, reason] = params;
          const key = ch.toLowerCase();
          const isSelf = target.toLowerCase() === ourNick.toLowerCase();
          set(s => {
            const channels = new Map(s.channels);
            if (isSelf) {
              channels.delete(key);
            } else {
              const c = channels.get(key);
              if (c) {
                const users = new Map(c.users);
                users.delete(target.toLowerCase());
                const kickMsg = sysMsg(`${nick} kicked ${target}: ${reason ?? ''}`, ch);
                const msgs = [...(c.messages ?? []), kickMsg];
                channels.set(key, { ...c, users, messages: msgs } as Channel);
              }
            }
            return { channels };
          });
          if (!isSelf) {
            get().addChannelEvent(ch, { type: 'kick', nick: target, text: `${target} was kicked by ${nick ?? 'server'}${reason ? ` (${reason})` : ''}`, time: new Date() });
          }
          get().addAuditEntry({
            type: 'kick',
            actor: nick ?? 'server',
            target,
            channel: ch,
            detail: reason ?? '',
          });
          get().addModerationEntry({
            action: 'KICK',
            target: target ?? '',
            by: nick ?? 'server',
            channel: ch ?? '',
          });
          break;
        }

        // ── End of names → auto-fetch PROP + history ─────────────────────
        case '366': { // RPL_ENDOFNAMES
          const ch366 = params[1];
          if (!ch366) break;
          // Fetch channel PROP data if IRCX
          if (get().isIRCX) {
            get().requestChannelProps(ch366);
          }
          // Auto-load recent history if channel is empty and server supports CHATHISTORY
          const { client: c366, channels: chans366 } = get();
          const hasHistory = c366?.negotiatedCaps?.has('draft/chathistory') || c366?.negotiatedCaps?.has('chathistory');
          const chData = chans366.get(ch366.toLowerCase());
          if (hasHistory && chData && chData.messages.length === 0) {
            get().requestHistory(ch366, 50);
          }
          break;
        }

        // ── PROP list numerics (IRCX) ─────────────────────────────────────
        case '818': { // RPL_PROPLIST
          // :server 818 ournick target propname :propvalue
          const propTarget = params[1];
          const propName   = params[2];
          const propVal    = params[3] ?? '';
          if (!propTarget || !propName) break;
          const propKey = propTarget.toLowerCase();
          set(s => {
            if (isChan(propTarget)) {
              const channelProps = new Map(s.channelProps);
              const existing = channelProps.get(propKey) ?? {};
              channelProps.set(propKey, { ...existing, [propName]: propVal });
              return { channelProps };
            } else {
              const userProps = new Map(s.userProps);
              const existing = userProps.get(propKey) ?? {};
              userProps.set(propKey, { ...existing, [propName]: propVal });
              // Parse activity from STATUS or ACTIVITY prop
              if (propName === 'STATUS' || propName === 'ACTIVITY') {
                const parsed = parseActivity(propVal);
                const userActivities = { ...s.userActivities };
                if (parsed) {
                  userActivities[propKey] = { emoji: parsed.emoji, typeLabel: parsed.typeLabel, text: parsed.text };
                } else {
                  delete userActivities[propKey];
                }
                return { userProps, userActivities };
              }
              return { userProps };
            }
          });
          break;
        }

        case '819': // RPL_PROPEND — signals list is complete; no action needed
          break;

        // ── Names list ────────────────────────────────────────────────────
        case '353': { // RPL_NAMREPLY
          // RFC 2812: 353 nick = #channel :names  (params[1] = visibility char)
          // RFC 1459: 353 nick #channel :names     (no visibility char)
          const VISIBILITY = new Set(['=', '*', '@']);
          const ch = VISIBILITY.has(params[1]) ? params[2] : params[1];
          const namesStr = VISIBILITY.has(params[1]) ? params[3] : params[2];
          if (!ch) break;
          const key = ch.toLowerCase();
          const { client } = get();
          const names = (namesStr ?? '').split(' ').filter(Boolean);
          set(s => {
            const channels = new Map(s.channels);
            const c = channels.get(key) ?? emptyChannel(ch);
            const users = new Map(c.users);
            for (const name of names) {
              const { nick: n, modes } = parseNamePrefix(name, client?.prefixToMode ?? {});
              if (n) users.set(n.toLowerCase(), { nick: n, modes: new Set(modes), away: false });
            }
            channels.set(key, { ...c, users });
            return { channels };
          });
          break;
        }

        // ── Topic ─────────────────────────────────────────────────────────
        case 'TOPIC':
        case '332': {
          const ch = command === 'TOPIC' ? params[0] : params[1];
          const topic = command === 'TOPIC' ? params[1] : params[2];
          const key = ch.toLowerCase();
          set(s => {
            const channels = new Map(s.channels);
            const c = channels.get(key);
            if (c) channels.set(key, { ...c, topic: topic ?? '' });
            return { channels };
          });
          // Record in topic history
          if (topic) get().addTopicHistory(ch, topic);
          // Only log live TOPIC changes (not 332 initial topic on join)
          if (command === 'TOPIC' && nick) {
            get().addAuditEntry({
              type: 'topic',
              actor: nick,
              channel: ch,
              detail: topic ?? '',
            });
          }
          break;
        }

        // ── Messages ──────────────────────────────────────────────────────
        case 'PRIVMSG':
        case 'NOTICE': {
          const target = params[0];
          const text = params[1] ?? '';
          const sender = nick ?? '';
          const isSelf = sender.toLowerCase() === ourNick.toLowerCase();

          // ── Intercept server-wide NOTICE (target * or $$*) ───────────────
          if (command === 'NOTICE' && (target === '*' || target === '$$*')) {
            get().addAnnouncement({
              from: sender || 'Server',
              text,
              type: 'global-notice',
            });
            break;
          }

          if (command === 'NOTICE' && !text.startsWith('\x01') && !isChan(target)) {
            const rawSource = sender || msg.prefix || '';
            const sourceUpper = rawSource.toUpperCase();
            const textUpper = text.toUpperCase();
            const serviceSource =
              (!isSelf && SERVICE_BOTS.has(sender.toLowerCase()) ? sender : undefined) ??
              ['NickServ', 'ChanServ', 'HostServ', 'MemoServ'].find(s => s.toUpperCase() === sourceUpper) ??
              (text.match(/^\[?(Account|Channel|Memo|VHost|NickServ|ChanServ|HostServ|MemoServ)\]?:?\s+/i)?.[1]) ??
              (/\b(MEMO|MEMOS)\b/.test(textUpper) ? 'Memo' : undefined) ??
              (/\bVHOST\b/.test(textUpper) ? 'VHost' : undefined) ??
              (/\b(ACCESS LIST|HOST MASK|CERTIFICATE|CERTLIST|CERTADD|CERTDEL|FINGERPRINT)\b/.test(textUpper) ? 'Account' : undefined) ??
              (/\b(ACCOUNT|IDENTIFIED|REGISTERED|PASSWORD|EMAIL|GHOST|RECOVER|GROUPED|UNGROUP)\b/.test(textUpper) ? 'Account' : undefined);

            if (serviceSource) {
              get().addServiceNotice(serviceSource, text);
              break;
            }
          }

          // ── Handle incoming CTCP SCREENSHARE from others ─────────────────
          if (text === '\x01SCREENSHARE START\x01') {
            get().addNotification({
              type: 'system',
              text: `\u{1F5A5} ${sender} is sharing their screen`,
              from: sender,
            });
            break;
          }
          if (text === '\x01SCREENSHARE STOP\x01') {
            // Dismiss any toast from this sender about screenshare by
            // adding a brief "stopped" notification that auto-dismisses
            // (the toast system auto-dismisses; no action needed beyond a notice)
            break;
          }

          // ── Handle incoming CTCP EDIT from others ────────────────────────
          const ctcpEditMatch = text.match(/^\x01EDIT ([^\s]+) ([\s\S]+)\x01$/);
          if (ctcpEditMatch) {
            const [, editMsgId, editNewText] = ctcpEditMatch;
            const editTarget = isChan(target) ? target : sender;
            const editKey = editTarget.toLowerCase();
            const applyRemoteEdit = (messages: ChatMessage[]): ChatMessage[] =>
              messages.map(m =>
                m.id === editMsgId && m.from.toLowerCase() === sender.toLowerCase()
                  ? { ...m, text: editNewText, edited: true }
                  : m,
              );
            set(s => {
              const channels = new Map(s.channels);
              const ch = channels.get(editKey);
              if (ch) {
                channels.set(editKey, { ...ch, messages: applyRemoteEdit(ch.messages) });
                return { channels };
              }
              const dms = new Map(s.dms);
              const dm = dms.get(editKey);
              if (dm) {
                dms.set(editKey, { ...dm, messages: applyRemoteEdit(dm.messages) });
                return { dms };
              }
              return {};
            });
            break;
          }

          // ── Handle incoming CTCP DELETE from others ──────────────────────
          const ctcpDeleteMatch = text.match(/^\x01DELETE ([^\s]+)\x01$/);
          if (ctcpDeleteMatch) {
            const [, delMsgId] = ctcpDeleteMatch;
            const delTarget = isChan(target) ? target : sender;
            const delKey = delTarget.toLowerCase();
            const applyRemoteDelete = (messages: ChatMessage[]): ChatMessage[] =>
              messages.map(m =>
                m.id === delMsgId && m.from.toLowerCase() === sender.toLowerCase()
                  ? { ...m, text: '', deleted: true }
                  : m,
              );
            set(s => {
              const channels = new Map(s.channels);
              const ch = channels.get(delKey);
              if (ch) {
                channels.set(delKey, { ...ch, messages: applyRemoteDelete(ch.messages) });
                return { channels };
              }
              const dms = new Map(s.dms);
              const dm = dms.get(delKey);
              if (dm) {
                dms.set(delKey, { ...dm, messages: applyRemoteDelete(dm.messages) });
                return { dms };
              }
              return {};
            });
            break;
          }

          // ── Handle incoming CTCP STAGE commands ────────────────────────
          const ctcpStageMatch = text.match(/^\x01STAGE (.+)\x01$/);
          if (ctcpStageMatch && !isSelf) {
            const stageParts = ctcpStageMatch[1].split(' ');
            const stageCmd = stageParts[0];
            const stageArg = stageParts[1] ?? '';
            const { ourNick: ourNickRef, stageChannel: myStageCh } = get();
            if (stageCmd === 'RAISE_HAND') {
              get().addRaisedHand(sender);
            } else if (stageCmd === 'LOWER_HAND') {
              get().removeRaisedHand(sender);
            } else if (stageCmd === 'INVITE_SPEAK' && stageArg.toLowerCase() === (ourNickRef ?? '').toLowerCase()) {
              set({ pendingSpeakInvite: sender });
            } else if (stageCmd === 'ACCEPT_SPEAK' && myStageCh) {
              // Remote speaker accepted — promote them via mode if we are host
              if (get().isStageHost) {
                get().client?.sendRaw('MODE', myStageCh, '+v', sender);
              }
              get().removeRaisedHand(sender);
            } else if (stageCmd === 'DECLINE_SPEAK') {
              get().removeRaisedHand(sender);
            }
            break;
          }

          // ── Handle incoming CTCP POLL_VOTE from others ───────────────────
          const ctcpPollVoteMatch = text.match(/^\x01POLL_VOTE ([^\s]+) (\d+)\x01$/);
          if (ctcpPollVoteMatch) {
            const [, pollMsgId, optionIdxStr] = ctcpPollVoteMatch;
            const optionIdx = parseInt(optionIdxStr, 10);
            const VOTE_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'] as const;
            const voteEmoji = VOTE_EMOJIS[optionIdx];
            if (voteEmoji !== undefined) {
              // Apply vote as a reaction update — find the poll message in any channel
              set(s => {
                const channels = new Map(s.channels);
                for (const [key, ch] of channels) {
                  const msgIdx = ch.messages.findIndex(m => m.id === pollMsgId);
                  if (msgIdx === -1) continue;
                  const existing: MessageReaction[] = ch.messages[msgIdx].reactions ?? [];
                  const rIdx = existing.findIndex(r => r.emoji === voteEmoji);
                  let reactions: MessageReaction[];
                  if (rIdx !== -1) {
                    // Add voter if not already present (prevent double-votes)
                    if (existing[rIdx].users.includes(sender)) return {};
                    reactions = existing.map((r, i) =>
                      i === rIdx ? { ...r, users: [...r.users, sender] } : r,
                    );
                  } else {
                    reactions = [...existing, { emoji: voteEmoji, users: [sender] }];
                  }
                  const messages = ch.messages.map((m, i) =>
                    i === msgIdx ? { ...m, reactions } : m,
                  );
                  channels.set(key, { ...ch, messages });
                  return { channels };
                }
                return {};
              });
            }
            break;
          }

          // ── Handle incoming CTCP requests (VERSION, TIME, PING, CLIENTINFO) ─
          if (!isSelf && command === 'PRIVMSG' && text.startsWith('\x01') && text.endsWith('\x01')) {
            const ctcpBody = text.slice(1, -1);
            const spaceIdx = ctcpBody.indexOf(' ');
            const ctcpCmd = spaceIdx === -1 ? ctcpBody : ctcpBody.slice(0, spaceIdx);
            const ctcpArgStr = spaceIdx === -1 ? '' : ctcpBody.slice(spaceIdx + 1);
            const ctcpArgs = ctcpArgStr ? ctcpArgStr.split(' ') : [];

            const { ctcpEnabled, ctcpVersionReply, ctcpTimeEnabled, ctcpPingEnabled, client: ircClient } = get();
            if (ctcpEnabled && ircClient) {
              if (ctcpCmd === 'VERSION') {
                ircClient.sendRaw('NOTICE', sender, `\x01VERSION ${ctcpVersionReply}\x01`);
              } else if (ctcpCmd === 'TIME' && ctcpTimeEnabled) {
                ircClient.sendRaw('NOTICE', sender, `\x01TIME ${new Date().toString()}\x01`);
              } else if (ctcpCmd === 'PING' && ctcpPingEnabled) {
                const pingArg = ctcpArgs.join(' ');
                ircClient.sendRaw('NOTICE', sender, `\x01PING${pingArg ? ' ' + pingArg : ''}\x01`);
              } else if (ctcpCmd === 'CLIENTINFO') {
                ircClient.sendRaw('NOTICE', sender, `\x01CLIENTINFO VERSION TIME PING CLIENTINFO\x01`);
              }
            }
            break;
          }

          if (isSelf && !get().client?.negotiatedCaps.has('echo-message')) break; // We already echoed our own messages

          // ── Handle FORUM post encoding ───────────────────────────────────
          const forumMatch = text.match(/^\x01FORUM ([\s\S]+)\x01$/);
          if (forumMatch && isChan(target)) {
            try {
              const meta = JSON.parse(forumMatch[1]) as {
                title?: string;
                tags?: string[];
                content?: string;
                id?: string;
              };
              const post: ForumPost = {
                id: meta.id ?? uid(),
                title: meta.title ?? '(Untitled)',
                tags: Array.isArray(meta.tags) ? meta.tags : [],
                authorNick: sender,
                content: meta.content ?? '',
                time: tags['time'] ? new Date(tags['time']) : new Date(),
                replyCount: 0,
              };
              get().addForumPost(target, post);
            } catch { /* malformed JSON — ignore */ }
            break;
          }

          // ── IRCv3 draft/message-editing (native Orochi shape) ────────────
          // Orochi emits an edit as a PRIVMSG carrying `+draft/edit=<msgid>`
          // (and `+draft/revision`), NOT a top-level EDIT command
          // (orochi src/daemon/server.zig:10788). Apply it in place against the
          // referenced message instead of appending a duplicate.
          const editRef = tags['+draft/edit'] ?? tags['draft/edit'];
          if (editRef) {
            const editTargetKey = (isChan(target) ? target : (isSelf ? target : sender)).toLowerCase();
            const editedText = (text.startsWith('\x01ACTION ') && text.endsWith('\x01'))
              ? text.slice(8, -1)
              : text;
            const applyTagEdit = (messages: ChatMessage[]): ChatMessage[] =>
              messages.map(m => m.id === editRef ? { ...m, text: editedText, edited: true } : m);
            set(s => {
              const channels = new Map(s.channels);
              const ch = channels.get(editTargetKey);
              if (ch) {
                channels.set(editTargetKey, { ...ch, messages: applyTagEdit(ch.messages) });
                return { channels };
              }
              const dms = new Map(s.dms);
              const dm = dms.get(editTargetKey);
              if (dm) {
                dms.set(editTargetKey, { ...dm, messages: applyTagEdit(dm.messages) });
                return { dms };
              }
              return {};
            });
            break;
          }

          const isChannel = isChan(target);

          // ── Parse reply reference ────────────────────────────────────────
          // IRCv3: +draft/reply tag carries the parent msgid
          // Legacy: \x01REPLY <msgId> <nick>|<preview>\x01 <actual text>
          let replyTo: { id: string; from: string; text: string } | undefined;
          let resolvedText = text;

          const draftReplyTag = tags['+draft/reply'] ?? tags['draft/reply'];
          if (draftReplyTag) {
            // Look up the referenced message to populate from/text fields
            const replyKey = isChan(target) ? target.toLowerCase() : (isSelf ? target : sender).toLowerCase();
            const replyMsgs = get().channels.get(replyKey)?.messages ?? get().dms.get(replyKey)?.messages ?? [];
            const parentMsg = replyMsgs.find(m => m.id === draftReplyTag);
            replyTo = {
              id: draftReplyTag,
              from: parentMsg?.from ?? '',
              text: parentMsg?.text ?? '',
            };
          } else {
            // Legacy CTCP REPLY fallback
            const ctcpReplyMatch = text.match(/^\x01REPLY ([^\s]+) ([^|]+)\|([^\x01]*)\x01 ([\s\S]*)$/);
            if (ctcpReplyMatch) {
              replyTo = {
                id: ctcpReplyMatch[1],
                from: ctcpReplyMatch[2],
                text: ctcpReplyMatch[3],
              };
              resolvedText = ctcpReplyMatch[4];
            }
          }

          const isAction = resolvedText.startsWith('\x01ACTION ') && resolvedText.endsWith('\x01');
          const displayText = isAction ? resolvedText.slice(8, -1) : resolvedText;
          const msgType = isAction ? 'action' : (command === 'NOTICE' ? 'notice' : 'msg');

          const highlight = !isChannel
            ? true
            : mentionsMe(resolvedText, ourNick);

          const msgTarget = isChannel ? target : (isSelf ? target : sender);
          const msgKey = msgTarget.toLowerCase();

          const time = tags['time'] ? new Date(tags['time']) : new Date();

          // Use server-provided msgid when available (e.g. from CHATHISTORY batch)
          const serverMsgId = tags['msgid'] ?? tags['draft/msgid'];
          const chatMsg: ChatMessage = {
            id: serverMsgId ?? uid(),
            time,
            from: sender,
            text: displayText,
            type: msgType as ChatMessage['type'],
            highlight,
            target: msgTarget,
            ...(replyTo ? { replyTo } : {}),
          };

          // ── If this PRIVMSG is part of a CHATHISTORY batch, collect it ────
          // Two routing paths:
          //  1. Spec-compliant servers stamp `@batch=<ref>` on each inner line.
          //  2. Orochi omits that tag on CHATHISTORY replay, so fall back to the
          //     open-batch-by-target map populated on `BATCH +ref chathistory`.
          const batchTag = tags['batch'];
          if (batchTag && _batchCollectors.has(batchTag)) {
            _batchCollectors.get(batchTag)!.messages.push(chatMsg);
            break;
          }
          const openBatchRef = _openChathistoryByTarget.get(msgKey);
          if (openBatchRef && _batchCollectors.has(openBatchRef)) {
            _batchCollectors.get(openBatchRef)!.messages.push(chatMsg);
            break;
          }

          if (isChannel) {
            const notifyLevel = get().channelNotify.get(msgKey) ?? 'all';
            // 'none' → never increment unread/highlights; store message only
            // 'mentions' → only count as unread if it mentions us or a channel-wide ping
            const isChannelWidePing = /\@(everyone|here)\b/i.test(displayText);
            const effectiveHighlight =
              isSelf ? false
              : notifyLevel === 'none' ? false
              : notifyLevel === 'mentions' ? (mentionsMe(text, ourNick) || isChannelWidePing)
              : highlight;
            const skipUnread = isSelf || notifyLevel === 'none' || (notifyLevel === 'mentions' && !mentionsMe(text, ourNick) && !isChannelWidePing);
            set(s => _addChannelMessage(s, msgKey, chatMsg, effectiveHighlight, skipUnread));
            get().updateChannelActivity(msgTarget);
            if (effectiveHighlight && notifyLevel !== 'none') {
              get().addNotification({ type: 'mention', text: displayText, from: sender, channel: msgTarget });
            }
            // Track per-channel unread for sidebar badges
            if (!skipUnread) {
              const activeTarget = get().activeView;
              const isActiveChannel = activeTarget.kind === 'channel' &&
                activeTarget.channel.toLowerCase() === msgKey;
              if (!isActiveChannel) {
                const isMention = effectiveHighlight ||
                  isChannelWidePing ||
                  get().highlightWords.some(w => displayText.toLowerCase().includes(w.toLowerCase()));
                get().incrementUnread(msgTarget, isMention);
              }
            }
          } else if (msgTarget) {
            // Guard: server-sourced NOTICE/PRIVMSG with no nick/target parses to
            // an empty target, which would create a blank-nick DM entry. Route
            // those to announcements instead. Self-echo files under msgTarget so
            // it lands in the conversation, not a DM with yourself.
            set(s => _addDMMessage(s, msgTarget, chatMsg, isSelf));
            if (!isSelf && highlight && !get().isDMMuted(sender)) {
              get().addNotification({ type: 'dm', text: displayText, from: sender });
            }
          } else {
            // Server-sourced message with no nick — show as announcement
            get().addAnnouncement({
              from: chatMsg.target || 'Server',
              text: displayText,
              type: 'global-notice',
            });
          }
          break;
        }

        // ── WALLOPS / server-wide notices ────────────────────────────────
        case 'WALLOPS': {
          get().addAnnouncement({
            from: nick ?? 'Server',
            text: params[params.length - 1] ?? '',
            type: 'wallops',
          });
          break;
        }

        // ── Nick changes ──────────────────────────────────────────────────
        case 'NICK': {
          const oldNick = nick ?? '';
          const newNick = params[0];
          const isSelf = oldNick.toLowerCase() === ourNick.toLowerCase();

          if (isSelf) {
            // Any successful self-nick-change cancels the reclaim timer:
            //   • If newNick == desiredNick  → reclaim succeeded, stop ✓
            //   • If newNick == something else → user moved on, stop ✓
            // In both cases the alias banner should clear.
            _stopNickReclaim();
            set(s => ({
              ourNick: newNick,
              currentNickIsAlias: false,
              // Keep server.nick mirrored so downstream reads see the right value.
              server: s.server ? { ...s.server, nick: newNick } : null,
            }));
          }

          set(s => {
            const channels = new Map(s.channels);
            for (const [key, ch] of channels) {
              const oldKey = oldNick.toLowerCase();
              if (ch.users.has(oldKey)) {
                const users = new Map(ch.users);
                const u = users.get(oldKey)!;
                users.delete(oldKey);
                users.set(newNick.toLowerCase(), { ...u, nick: newNick });
                const nm = sysMsg(`${oldNick} → ${newNick}`, ch.name);
                const msgs = [...(ch.messages ?? []), nm];
                channels.set(key, { ...ch, users, messages: msgs } as Channel);
              }
            }
            return { channels };
          });
          // Wire NICK events — after state update, find channels that now have newNick
          {
            const updatedChannels = get().channels;
            for (const ch of updatedChannels.values()) {
              if (ch.users.has(newNick.toLowerCase())) {
                get().addChannelEvent(ch.name, { type: 'nick', nick: oldNick, text: `${oldNick} → ${newNick}`, time: new Date() });
              }
            }
          }
          break;
        }

        // ── CHGHOST (chghost cap) ─────────────────────────────────────────
        // :nick!user@oldhost CHGHOST newuser newhost
        // ChannelUser doesn't track host; consume silently to prevent the
        // message falling through to the default unhandled-command branch.
        case 'CHGHOST':
          break;

        // ── Mode ──────────────────────────────────────────────────────────
        case 'MODE': {
          const target = params[0];
          const key = target.toLowerCase();
          if (isChan(target)) {
            const modeStr = params[1] ?? '';
            const modeArgs = params.slice(2);
            set(s => {
              const channels = new Map(s.channels);
              const c = channels.get(key);
              if (!c) return {};
              const modeText = params.slice(1).join(' ');
              const users = new Map(c.users);
              const prefixModes = new Set(Object.keys(get().client?.modeToPrefix ?? { Q: '!', q: '.', o: '@', v: '+' }));
              const chanmodes = get().client?.isupport.CHANMODES ?? [];
              let adding = true;
              let argIdx = 0;
              let changedUsers = false;

              for (const ch of modeStr) {
                if (ch === '+') { adding = true; continue; }
                if (ch === '-') { adding = false; continue; }
                const consumesArg = modeConsumesArg(ch, adding, chanmodes, prefixModes);
                const modeArg = consumesArg ? modeArgs[argIdx++] : undefined;
                if (!prefixModes.has(ch) || !modeArg) continue;
                const userKey = modeArg.toLowerCase();
                const user = users.get(userKey);
                if (!user) continue;
                const modes = new Set(user.modes);
                if (adding) modes.add(ch);
                else modes.delete(ch);
                users.set(userKey, { ...user, modes });
                changedUsers = true;
              }

              const sysm = sysMsg(`${nick ?? 'server'} set mode ${modeText}`, target);
              const msgs = [...(c.messages ?? []), sysm];
              return { channels: new Map(channels).set(key, { ...c, users: changedUsers ? users : c.users, messages: msgs } as Channel) };
            });

            // Emit audit entries for ban/unban/other mode changes
            const prefixModes = new Set(Object.keys(get().client?.modeToPrefix ?? { Q: '!', q: '.', o: '@', v: '+' }));
            const chanmodes = get().client?.isupport.CHANMODES ?? [];
            let adding = true;
            let argIdx = 0;
            let sawBan = false;
            let sawOtherMode = false;
            for (const ch of modeStr) {
              if (ch === '+') { adding = true; continue; }
              if (ch === '-') { adding = false; continue; }
              const consumesArg = modeConsumesArg(ch, adding, chanmodes, prefixModes);
              const modeArg = consumesArg ? modeArgs[argIdx++] : undefined;
              if (ch === 'b') {
                sawBan = true;
                get().addAuditEntry({
                  type: adding ? 'ban' : 'unban',
                  actor: nick ?? 'server',
                  target: modeArg,
                  channel: target,
                  detail: `${adding ? '+' : '-'}b ${modeArg ?? ''}`.trim(),
                });
                get().addModerationEntry({
                  action: adding ? 'BAN' : 'UNBAN',
                  target: modeArg ?? '',
                  by: nick ?? 'server',
                  channel: target,
                });
                if (modeArg) {
                  set(s => {
                    const banList = new Map(s.banList);
                    const existing = banList.get(key) ?? [];
                    banList.set(
                      key,
                      adding
                        ? [...existing.filter(b => b.mask !== modeArg), { mask: modeArg, setBy: nick ?? 'server', setAt: Math.floor(Date.now() / 1000) }]
                        : existing.filter(b => b.mask !== modeArg),
                    );
                    return { banList };
                  });
                }
              } else {
                sawOtherMode = true;
                const userExists = !!modeArg && !!get().channels.get(key)?.users.has(modeArg.toLowerCase());
                if (prefixModes.has(ch) && modeArg && userExists) {
                  get().addModerationEntry({
                    action: adding ? `GRANT +${ch}` : `TAKE +${ch}`,
                    target: modeArg,
                    by: nick ?? 'server',
                    channel: target,
                  });
                } else if (ch === 'z' || prefixModes.has(ch)) {
                  get().addModerationEntry({
                    action: 'MODE',
                    target: `${adding ? '+' : '-'}${ch}${modeArg ? ` ${modeArg}` : ''}`,
                    by: nick ?? 'server',
                    channel: target,
                  });
                }
              }
            }
            // Check if this is a non-ban mode change (no +b/-b)
            if (!sawBan && sawOtherMode) {
              get().addAuditEntry({
                type: 'mode',
                actor: nick ?? 'server',
                channel: target,
                detail: params.slice(1).join(' '),
              });
            } else if (sawBan && sawOtherMode) {
              // Mixed: has both ban and other chars — emit one more for the non-ban parts
              get().addAuditEntry({
                type: 'mode',
                actor: nick ?? 'server',
                channel: target,
                detail: params.slice(1).join(' '),
              });
            }
            // Emit channel event for mode change
            get().addChannelEvent(target, { type: 'mode', nick: nick ?? 'server', text: `${nick ?? 'server'} set mode ${params.slice(1).join(' ')}`, time: new Date() });
          } else if (target.toLowerCase() === get().ourNick.toLowerCase()) {
            const modeStr = params[1] ?? '';
            if (modeStr.includes('+') && modeStr.includes('o')) set({ isOper: true });
            if (modeStr.includes('-') && modeStr.includes('o')) set({ isOper: false });
          }
          break;
        }

        // ── PROP (IRCX) ───────────────────────────────────────────────────
        case 'PROP': {
          const target = params[0];
          const propName = params[1];
          const propVal = params[2] ?? '';
          const key = target.toLowerCase();
          set(s => {
            if (isChan(target)) {
              const channelProps = new Map(s.channelProps);
              const existing = channelProps.get(key) ?? {};
              channelProps.set(key, { ...existing, [propName]: propVal });
              return { channelProps };
            } else {
              const userProps = new Map(s.userProps);
              const existing = userProps.get(key) ?? {};
              userProps.set(key, { ...existing, [propName]: propVal });
              // Parse activity from STATUS or ACTIVITY prop
              if (propName === 'STATUS' || propName === 'ACTIVITY') {
                const parsed = parseActivity(propVal);
                const userActivities = { ...s.userActivities };
                if (parsed) {
                  userActivities[key] = { emoji: parsed.emoji, typeLabel: parsed.typeLabel, text: parsed.text };
                } else {
                  delete userActivities[key];
                }
                return { userProps, userActivities };
              }
              return { userProps };
            }
          });
          break;
        }

        // ── AWAY ──────────────────────────────────────────────────────────
        case 'AWAY': {
          const awayNick = nick ?? '';
          const awayMsg = params[0];
          set(s => {
            const channels = new Map(s.channels);
            for (const [key, ch] of channels) {
              const u = ch.users.get(awayNick.toLowerCase());
              if (u) {
                const users = new Map(ch.users);
                users.set(awayNick.toLowerCase(), { ...u, away: !!awayMsg });
                channels.set(key, { ...ch, users });
              }
            }
            return { channels };
          });
          break;
        }

        // ── INVITE (invite-notify cap) ────────────────────────────────────
        // :inviter!u@h INVITE <target-nick> <#channel>
        // We receive this either as the invitee (invited to a channel) or, with
        // invite-notify, as a channel member observing someone else's invite.
        case 'INVITE': {
          const invitee = params[0] ?? '';
          const inviteChannel = params[1] ?? '';
          const inviter = nick ?? 'someone';
          if (!inviteChannel) break;
          const invitedMe = invitee.toLowerCase() === ourNick.toLowerCase();
          if (invitedMe) {
            get().addNotification({
              type: 'system',
              text: `${inviter} invited you to ${inviteChannel}`,
              from: inviter,
              channel: inviteChannel,
            });
          } else {
            // invite-notify: surface as a channel system line for context.
            get().addChannelEvent(inviteChannel, {
              type: 'join',
              nick: inviter,
              text: `${inviter} invited ${invitee} to ${inviteChannel}`,
              time: new Date(),
            });
          }
          break;
        }

        // ── SETNAME (setname cap) ─────────────────────────────────────────
        // :nick!u@h SETNAME :<new realname>. ChannelUser does not track realname,
        // so update any cached WHOIS/profile realname if present; otherwise a
        // safe no-op that keeps SETNAME from hitting the default branch.
        case 'SETNAME': {
          const setnameNick = nick ?? '';
          const newRealname = params[0] ?? '';
          if (setnameNick && newRealname) {
            get().setUserProfile(setnameNick, { realname: newRealname });
          }
          break;
        }

        // ── Typing indicators + IRCv3 draft/react ─────────────────────────
        case 'TAGMSG': {
          const tagTarget = params[0] ?? '';

          // Typing indicator
          const typingVal =
            msg.tags['+draft/typing'] ??
            msg.tags['draft/typing'] ??
            msg.tags['+typing'] ??
            msg.tags['typing'];
          if (typingVal && nick) {
            const { ourNick: myNick } = get();
            // For DMs the TAGMSG target is our own nick; store under sender's nick
            // so TypingIndicator(channel=senderNick) can find it.
            const typingKey = tagTarget.toLowerCase() === myNick.toLowerCase()
              ? nick
              : tagTarget;
            const isActive = typingVal === 'active' || typingVal === 'paused';
            get().setTyping(typingKey, nick, isActive);
          }

          // Reaction via draft/react
          const reactEmoji = msg.tags['+draft/react'] ?? msg.tags['draft/react'];
          const reactMsgId = msg.tags['+draft/reply'] ?? msg.tags['draft/reply'] ?? msg.tags['+draft/react-to'];
          const reactNick  = nick ?? '';

          if (reactEmoji && reactMsgId && reactNick) {
            const reactKey = tagTarget.toLowerCase();
            const st = get();
            const channelMsgs = st.channels.get(reactKey)?.messages ?? [];
            const dmMsgs      = st.dms.get(reactKey)?.messages ?? [];
            const targetMsg   = channelMsgs.find(m => m.id === reactMsgId)
              ?? dmMsgs.find(m => m.id === reactMsgId);

            const hasReaction = targetMsg?.reactions?.some(
              r => r.emoji === reactEmoji && r.users.some(u => u.toLowerCase() === reactNick.toLowerCase()),
            ) ?? false;

            if (hasReaction) {
              get().removeReaction(tagTarget, reactMsgId, reactEmoji, reactNick);
            } else {
              const applyAdd = (messages: ChatMessage[]): ChatMessage[] =>
                messages.map(m => {
                  if (m.id !== reactMsgId) return m;
                  const existing: MessageReaction[] = m.reactions ?? [];
                  const rIdx = existing.findIndex(r => r.emoji === reactEmoji);
                  let reactions: MessageReaction[];
                  if (rIdx >= 0) {
                    const alreadyIn = existing[rIdx].users.some(
                      u => u.toLowerCase() === reactNick.toLowerCase(),
                    );
                    if (alreadyIn) return m;
                    reactions = existing.map((r2, i) =>
                      i === rIdx ? { ...r2, users: [...r2.users, reactNick] } : r2,
                    );
                  } else {
                    reactions = [...existing, { emoji: reactEmoji, users: [reactNick] }];
                  }
                  return { ...m, reactions };
                });

              set(s => {
                const channels = new Map(s.channels);
                const ch = channels.get(reactKey);
                if (ch) {
                  channels.set(reactKey, { ...ch, messages: applyAdd(ch.messages) });
                  return { channels };
                }
                const dms = new Map(s.dms);
                const dm = dms.get(reactKey);
                if (dm) {
                  dms.set(reactKey, { ...dm, messages: applyAdd(dm.messages) });
                  return { dms };
                }
                return {};
              });
            }
          }
          break;
        }

        // ── Emoji reactions ───────────────────────────────────────────────
        // :nick!u@h REACT #channel :msgid emoji
        case 'REACT': {
          const reactTarget = params[0];
          const reactBody   = params[1] ?? '';
          const spaceIdx    = reactBody.indexOf(' ');
          if (spaceIdx < 0) break;
          const reactMsgId  = reactBody.slice(0, spaceIdx);
          const reactEmoji  = reactBody.slice(spaceIdx + 1).trim();
          const reactNick   = nick ?? '';
          if (!reactTarget || !reactMsgId || !reactEmoji || !reactNick) break;

          const reactKey = reactTarget.toLowerCase();
          const st = get();
          const channelMsgs = st.channels.get(reactKey)?.messages ?? [];
          const dmMsgs      = st.dms.get(reactKey)?.messages ?? [];
          const targetMsg   = channelMsgs.find(m => m.id === reactMsgId)
            ?? dmMsgs.find(m => m.id === reactMsgId);
          const hasReaction = targetMsg?.reactions?.some(
            r => r.emoji === reactEmoji && r.users.some(u => u.toLowerCase() === reactNick.toLowerCase()),
          ) ?? false;

          if (hasReaction) {
            get().removeReaction(reactTarget, reactMsgId, reactEmoji, reactNick);
          } else {
            const applyAdd = (messages: ChatMessage[]): ChatMessage[] =>
              messages.map(m => {
                if (m.id !== reactMsgId) return m;
                const existing: MessageReaction[] = m.reactions ?? [];
                const rIdx = existing.findIndex(r => r.emoji === reactEmoji);
                let reactions: MessageReaction[];
                if (rIdx >= 0) {
                  const alreadyIn = existing[rIdx].users.some(
                    u => u.toLowerCase() === reactNick.toLowerCase(),
                  );
                  if (alreadyIn) return m;
                  reactions = existing.map((r2, i) =>
                    i === rIdx ? { ...r2, users: [...r2.users, reactNick] } : r2,
                  );
                } else {
                  reactions = [...existing, { emoji: reactEmoji, users: [reactNick] }];
                }
                return { ...m, reactions };
              });

            set(s => {
              const channels = new Map(s.channels);
              const ch = channels.get(reactKey);
              if (ch) {
                channels.set(reactKey, { ...ch, messages: applyAdd(ch.messages) });
                return { channels };
              }
              const dms = new Map(s.dms);
              const dm = dms.get(reactKey);
              if (dm) {
                dms.set(reactKey, { ...dm, messages: applyAdd(dm.messages) });
                return { dms };
              }
              return {};
            });
          }
          break;
        }

        // ── Whiteboard — handled by useWhiteboard() hook via client.extraMessageHandlers ──
        // WHITEBOARD messages are consumed directly in hooks/useWhiteboard.ts
        // using client.extraMessageHandlers; no global store state needed.

        // ── IRCv3 draft/channel-rename ────────────────────────────────────
        // :renamer!u@h RENAME <#old> <#new> [:reason]
        // The channel now lives under the new key server-side; migrate every
        // piece of channel-keyed state (messages, membership, unread, active
        // view, satellites) and drop a system line into the channel.
        case 'RENAME': {
          const oldName = params[0];
          const newName = params[1];
          const renameReason = params[2];
          if (!oldName || !newName) break;
          const oldKey = oldName.toLowerCase();
          const newKey = newName.toLowerCase();
          const renamer = nick ?? 'server';
          set(s => {
            const existing = s.channels.get(oldKey);
            if (!existing) return {};
            const channels = new Map(s.channels);
            channels.delete(oldKey);
            const renameNote = sysMsg(
              `${renamer} renamed ${oldName} → ${newName}${renameReason ? ` (${renameReason})` : ''}`,
              newName,
            );
            channels.set(newKey, {
              ...existing,
              name: newName,
              messages: [...(existing.messages ?? []), renameNote],
            });

            const moveKey = <V,>(m: Map<string, V>): Map<string, V> => {
              if (!m.has(oldKey)) return m;
              const next = new Map(m);
              const v = next.get(oldKey) as V;
              next.delete(oldKey);
              next.set(newKey, v);
              return next;
            };
            const moveRecord = <V,>(r: Record<string, V>): Record<string, V> => {
              if (!(oldKey in r)) return r;
              const next = { ...r };
              next[newKey] = next[oldKey];
              delete next[oldKey];
              return next;
            };

            const activeView =
              s.activeView.kind === 'channel' && s.activeView.channel.toLowerCase() === oldKey
                ? { kind: 'channel' as const, channel: newName }
                : s.activeView;

            return {
              channels,
              activeView,
              firstUnreadId: moveKey(s.firstUnreadId),
              channelNotify: moveKey(s.channelNotify),
              channelProps: moveKey(s.channelProps),
              pinnedMessages: moveKey(s.pinnedMessages),
              historyLoading: moveKey(s.historyLoading),
              historyExhausted: moveKey(s.historyExhausted),
              typingUsers: moveKey(s.typingUsers),
              readMarkers: moveKey(s.readMarkers),
              channelUnread: moveRecord(s.channelUnread),
              channelMentions: moveRecord(s.channelMentions),
            };
          });
          break;
        }

        // ── IRCv3 metadata-2 (761 RPL_KEYVALUE / 762 / 766) ───────────────
        // :server 761 <me> <Target> <Key> <Visibility> [:<Value>]
        case '761': {
          const mdTarget = params[1];
          const mdKey = params[2];
          const mdValue = params[4] ?? '';
          if (mdTarget && mdKey) get()._applyMetadata(mdTarget, mdKey, mdValue);
          break;
        }
        case '762': // RPL_METADATAEND — end of metadata burst
          break;
        case '766': { // ERR_KEYNOTSET — :server 766 <me> <Target> <Key> :key not set
          const mdTarget = params[1];
          const mdKey = params[2];
          if (mdTarget && mdKey) get()._applyMetadata(mdTarget, mdKey, '');
          break;
        }
        // metadata-notify forward-compat: :server METADATA <Target> <Key> <Vis> :<Value>
        case 'METADATA': {
          const mdTarget = params[0];
          const mdKey = params[1];
          const mdValue = params[3] ?? '';
          if (mdTarget && mdKey) get()._applyMetadata(mdTarget, mdKey, mdValue);
          break;
        }

        // ── IRCv3 draft/read-marker ───────────────────────────────────────
        // :server MARKREAD <target> timestamp=<ISO8601>   (set echo / GET reply)
        // :server MARKREAD <target> *                     (no marker stored)
        // Received as the echo of our own SET, a GET reply, or a relay from
        // another session of the same account.
        case 'MARKREAD': {
          const mrTarget = params[0];
          if (!mrTarget) break;
          // Only act if the sender is the server (no nick) or is our own nick;
          // ignore MARKREAD from other users (shouldn't happen, but guard it).
          const { ourNick: mrOurNick } = get();
          const fromSelf = !nick || nick.toLowerCase() === mrOurNick.toLowerCase();
          if (!fromSelf) break;
          const mrKey = mrTarget.toLowerCase();
          const mrParam = params[1] ?? '';
          if (mrParam === '*' || mrParam === '') {
            // No marker stored server-side — keep local unread state as-is.
            set(s => {
              if (!s.readMarkers.has(mrKey)) return {};
              const readMarkers = new Map(s.readMarkers);
              readMarkers.delete(mrKey);
              return { readMarkers };
            });
            break;
          }
          const mrTs = mrParam.startsWith('timestamp=') ? mrParam.slice('timestamp='.length) : mrParam;
          set(s => _applyReadMarker(s, mrKey, mrTs));
          break;
        }

        // ── IRCv3 draft/message-redaction ─────────────────────────────────
        // :nick!u@h REDACT <target> <msgid> [:<reason>]
        case 'REDACT': {
          const redactTarget = params[0];
          const redactMsgId  = params[1];
          if (!redactTarget || !redactMsgId) break;

          const redactKey = redactTarget.toLowerCase();
          const filterMsg = (msgs: ChatMessage[]): ChatMessage[] =>
            msgs.map(m => m.id === redactMsgId ? { ...m, redacted: true, text: '[Message deleted]' } : m);

          set(s => {
            const channels = new Map(s.channels);
            const ch = channels.get(redactKey);
            if (ch) {
              channels.set(redactKey, { ...ch, messages: filterMsg(ch.messages) });
              return { channels };
            }
            const dms = new Map(s.dms);
            const dm = dms.get(redactKey);
            if (dm) {
              dms.set(redactKey, { ...dm, messages: filterMsg(dm.messages) });
              return { dms };
            }
            return {};
          });
          break;
        }

        // ── draft/message-editing ─────────────────────────────────────────
        // :nick!user@host EDIT <target> <old_msgid> :<new_text>
        case 'EDIT': {
          const editTarget = params[0];
          const editOldId  = params[1];
          const editText   = params[2] ?? '';
          if (!editTarget || !editOldId) break;

          const editKey = editTarget.toLowerCase();
          const applyEdit = (msgs: ChatMessage[]): ChatMessage[] =>
            msgs.map(m => m.id === editOldId ? { ...m, text: editText, edited: true } : m);

          set(s => {
            const channels = new Map(s.channels);
            const ch = channels.get(editKey);
            if (ch) {
              channels.set(editKey, { ...ch, messages: applyEdit(ch.messages) });
              return { channels };
            }
            const dms = new Map(s.dms);
            const dm = dms.get(editKey);
            if (dm) {
              dms.set(editKey, { ...dm, messages: applyEdit(dm.messages) });
              return { dms };
            }
            return {};
          });
          break;
        }

        // ── MONITOR presence ──────────────────────────────────────────────
        case '730': { // RPL_MONONLINE :nick!user@host,...
          const parsed = parseMonitorNumeric(msg);
          const targets = parsed?.targets ?? [];
          set(s => {
            const dms = new Map(s.dms);
            for (const fullhost of targets) {
              const monNick = fullhost.split('!')[0];
              const key = monNick.toLowerCase();
              const dm = dms.get(key);
              if (dm) dms.set(key, { ...dm, away: false });
            }
            return { dms };
          });
          for (const fullhost of targets) {
            const monNick = fullhost.split('!')[0];
            get().setFriendOnline(monNick, true);
          }
          break;
        }

        case '731': { // RPL_MONOFFLINE :nick,...
          const parsed = parseMonitorNumeric(msg);
          const offTargets = parsed?.targets ?? [];
          set(s => {
            const dms = new Map(s.dms);
            for (const monNick of offTargets) {
              const key = monNick.toLowerCase();
              const dm = dms.get(key);
              if (dm) dms.set(key, { ...dm, away: true });
            }
            return { dms };
          });
          for (const monNick of offTargets) {
            get().setFriendOnline(monNick, false);
          }
          break;
        }

        case '732': // RPL_MONLIST — ignore (just a list of currently watched nicks)
        case '733': // RPL_ENDOFMONLIST
          break;

        case '734': { // ERR_MONLISTFULL — params include the configured limit.
          const parsed = parseMonitorNumeric(msg);
          get().addNotification({
            type: 'error',
            text: parsed?.limit
              ? `MONITOR list is full (${parsed.limit} targets)`
              : (parsed?.description || 'MONITOR list is full'),
          });
          break;
        }

        // ── WHISPER (IRCX in-channel DM) ─────────────────────────────────
        case 'WHISPER': {
          // :sender!u@h WHISPER #channel :text
          const whCh   = params[0];
          const whText = params[1] ?? '';
          const sender = nick ?? '';
          const isSelf = sender.toLowerCase() === ourNick.toLowerCase();
          if (isSelf) break;
          const whKey = whCh.toLowerCase();
          const whTime = tags['time'] ? new Date(tags['time']) : new Date();
          const whMsg: ChatMessage = {
            id: uid(),
            time: whTime,
            from: sender,
            text: whText,
            type: 'whisper' as ChatMessage['type'],
            target: whCh,
            highlight: true,
          };
          set(s => _addChannelMessage(s, whKey, whMsg, true));
          get().updateChannelActivity(whCh);
          break;
        }

        // ── CHATHISTORY BATCH ─────────────────────────────────────────────
        case 'BATCH': {
          const batchParam = params[0] ?? '';
          if (batchParam.startsWith('+')) {
            // BATCH +ref draft/chathistory #channel
            const batchRef = batchParam.slice(1);
            const batchType = params[1] ?? '';
            const batchTarget = params[2] ?? '';
            if (
              batchTarget &&
              (batchType === 'draft/chathistory' || batchType === 'chathistory')
            ) {
              _batchCollectors.set(batchRef, { target: batchTarget, messages: [] });
              _openChathistoryByTarget.set(batchTarget.toLowerCase(), batchRef);
            }
          } else if (batchParam.startsWith('-')) {
            // BATCH -ref — end of batch
            const batchRef = batchParam.slice(1);
            const collector = _batchCollectors.get(batchRef);
            if (collector) {
              _batchCollectors.delete(batchRef);
              const { target: batchTarget, messages: batchMsgs } = collector;
              if (_openChathistoryByTarget.get(batchTarget.toLowerCase()) === batchRef) {
                _openChathistoryByTarget.delete(batchTarget.toLowerCase());
              }
              const batchKey = batchTarget.toLowerCase();

              if (batchMsgs.length > 0) {
                set(s => {
                  // Prepend historical messages (oldest first) before existing
                  // live messages, deduped by server msgid. Without this, a
                  // session-sync reconnect would replay CHATHISTORY into a
                  // target that still holds the same messages (state survives
                  // auto-reconnect), duplicating every message. CHATHISTORY
                  // messages carry a server msgid as ChatMessage.id; locally
                  // generated ids (uid()) never collide with those.
                  const mergeHistory = (existing: ChatMessage[]): ChatMessage[] => {
                    const existingIds = new Set(existing.map(m => m.id));
                    const newHistory = batchMsgs.filter(m => !existingIds.has(m.id));
                    return [...newHistory, ...existing];
                  };
                  const channels = new Map(s.channels);
                  const c = channels.get(batchKey);
                  if (c) {
                    channels.set(batchKey, { ...c, messages: mergeHistory(c.messages) });
                    return { channels };
                  }
                  // CHATHISTORY also covers DM targets (a nick, not a #channel).
                  const dms = new Map(s.dms);
                  const dm = dms.get(batchKey);
                  if (dm) {
                    dms.set(batchKey, { ...dm, messages: mergeHistory(dm.messages) });
                    return { dms };
                  }
                  return {};
                });
              }

              // Mark loading done; mark exhausted if fewer than 50 messages came back
              set(s => {
                const historyLoading = new Map(s.historyLoading);
                historyLoading.set(batchKey, false);
                const historyExhausted = new Map(s.historyExhausted);
                if (batchMsgs.length < 50) {
                  historyExhausted.set(batchKey, true);
                }
                return { historyLoading, historyExhausted };
              });

              // Re-derive unread / firstUnreadId from the server read marker
              // now that replayed history is merged, so the UnreadDivider and
              // jump-pill stay correct across bouncer (session-sync) replay.
              {
                const storedMarker = get().readMarkers.get(batchKey);
                if (storedMarker) set(s => _applyReadMarker(s, batchKey, storedMarker));
              }
            }
          }
          break;
        }

        // ── Channel LIST ──────────────────────────────────────────────────
        case '322': { // RPL_LIST: :server 322 me #channel count :topic
          const listCh = params[1] ?? '';
          const listCount = parseInt(params[2] ?? '0', 10);
          const listTopic = params[3] ?? '';
          if (!listCh) break;
          set((s) => ({
            channelList: [
              ...s.channelList,
              { name: listCh, count: listCount, topic: listTopic },
            ],
          }));
          break;
        }

        case '323': // RPL_LISTEND
          set({ channelListLoading: false });
          break;

        // ── RULES numerics (308 RPL_RULES / 309 RPL_ENDOFRULES) ─────────
        case '308': { // RPL_RULES — one line of rules
          const ruleLine = params[params.length - 1] ?? '';
          if (ruleLine) {
            set(s => ({ serverRules: [...s.serverRules, ruleLine] }));
          }
          break;
        }

        case '309': // RPL_ENDOFRULES — rules are ready, no action needed
          break;

        // ── MOTD numerics ─────────────────────────────────────────────────
        case '375': // RPL_MOTDSTART
          _motdBuffer = '';
          break;

        case '372': { // RPL_MOTD
          const motdLine = params[1] ?? '';
          _motdBuffer += (_motdBuffer ? '\n' : '') + motdLine;
          break;
        }

        case '376': { // RPL_ENDOFMOTD
          const hostname376 = get().server?.url ?? 'unknown';
          const suppressKey = `ocean-hide-motd-${hostname376}`;
          const suppress =
            typeof window !== 'undefined' && !!localStorage.getItem(suppressKey);
          if (!suppress && _motdBuffer) {
            set({ motd: _motdBuffer, showMotd: true });
          } else {
            set({ motd: _motdBuffer });
          }
          _motdBuffer = '';
          break;
        }

        // ── 005 ISUPPORT — store parsed features in serverFeatures map ───
        case '005': {
          // params[0] = our nick, last param = ":are supported..." — skip both
          const tokens005 = params.slice(1, -1);
          set(s => {
            const serverFeatures = new Map(s.serverFeatures);
            const newIsupportTokens: Record<string, string> = {};
            let networkUpdate: string | null = null;
            let isupportPrefixToMode = s.isupportPrefixToMode;
            let isupportModeToPrefix = s.isupportModeToPrefix;
            let chanLimits = s.chanLimits;
            let caseMapping = s.caseMapping;
            for (const token of tokens005) {
              const eqIdx = token.indexOf('=');
              const key = eqIdx === -1 ? token : token.slice(0, eqIdx);
              const val = eqIdx === -1 ? '' : token.slice(eqIdx + 1);
              serverFeatures.set(key, val);
              newIsupportTokens[key] = val;
              if (key === 'NETWORK' && val) {
                networkUpdate = val;
              }
              if (key === 'PREFIX') {
                const parsed = parsePREFIX(val);
                isupportPrefixToMode = parsed.prefixToMode;
                isupportModeToPrefix = parsed.modeToPrefix;
              }
              if (key === 'CHANLIMIT') chanLimits = parseCHANLIMIT(val);
              if (key === 'CASEMAPPING' && val) caseMapping = val;
            }
            const isupportTokens = { ...s.isupportTokens, ...newIsupportTokens };
            if (networkUpdate) {
              return {
                serverFeatures,
                isupportTokens,
                isupportPrefixToMode,
                isupportModeToPrefix,
                chanLimits,
                caseMapping,
                mediaAvailable: serverFeatures.has('standard-replies'),
                networkName: networkUpdate,
                server: s.server ? { ...s.server, name: networkUpdate, network: networkUpdate } : null,
              };
            }
            return { serverFeatures, isupportTokens, isupportPrefixToMode, isupportModeToPrefix, chanLimits, caseMapping };
          });
          break;
        }

        // ── 004 RPL_MYINFO ────────────────────────────────────────────────
        case '004': {
          // params: [myNick, serverName, version, userModes, channelModes]
          const version004 = params[2] ?? null;
          if (version004) set({ serverVersion: version004 });
          break;
        }

        // ── 352 RPL_WHOREPLY ──────────────────────────────────────────────
        case '352': {
          // :server 352 yournick #channel username host server nick H/G :hopcount realname
          const ch352 = params[1];
          const nick352 = params[5] ?? '';
          const flags352 = params[6] ?? '';
          const isAway352 = flags352.startsWith('G');
          if (nick352) {
            set(s => {
              const awayNicks = new Set(s.awayNicks);
              if (isAway352) awayNicks.add(nick352.toLowerCase());
              else awayNicks.delete(nick352.toLowerCase());

              // Also update channel.users[nick].away for sort accuracy
              const nk = nick352.toLowerCase();
              const channels = new Map(s.channels);
              if (ch352) {
                const ck = ch352.toLowerCase();
                const c = channels.get(ck);
                if (c) {
                  const u = c.users.get(nk);
                  if (u) {
                    const users = new Map(c.users);
                    users.set(nk, { ...u, away: isAway352 });
                    channels.set(ck, { ...c, users });
                  }
                }
              }
              return { awayNicks, channels };
            });
          }
          break;
        }

        // ── 900 RPL_LOGGEDIN / 901 RPL_LOGGEDOUT ─────────────────────────
        case '900': {
          // :server 900 nick nick!u@h account :You are now logged in as account
          // 900 is also IRCX ERR_BADCOMMAND (`900 nick :Bad command`, 2 params).
          // Only treat it as RPL_LOGGEDIN when the account param is present
          // (RPL_LOGGEDIN carries [nick, nick!u@h, account, msg]); otherwise it
          // is an IRCX error and must not clobber the logged-in account.
          if (params.length >= 4 && params[2]) {
            const account900 = params[2];
            // Capture before server object exists (900 arrives during CAP/SASL, before 001)
            _saslAccount = account900;
            set(s => ({ server: s.server ? { ...s.server, account: account900 } : null }));
          }
          break;
        }

        case '901': {
          // :server 901 nick nick!u@h :You are now logged out
          _saslAccount = null;
          set(s => ({ server: s.server ? { ...s.server, account: null } : null }));
          break;
        }

        // ── ERR numerics ──────────────────────────────────────────────────

        case '401': { // ERR_NOSUCHNICK
          const target401 = params[1] ?? '';
          get().addNotification({ type: 'error', text: `No such nick: ${target401}` });
          break;
        }

        case '403': { // ERR_NOSUCHCHANNEL
          const channel403 = params[1] ?? '';
          get().addNotification({ type: 'error', text: `No such channel: ${channel403}` });
          break;
        }

        case '404': { // ERR_CANNOTSENDTOCHAN
          const channel404 = params[1] ?? '';
          const reason404 = params[2] ?? '';
          get().addNotification({ type: 'error', text: `Cannot send to ${channel404}: ${reason404}` });
          break;
        }

        case '405': { // ERR_TOOMANYCHANNELS
          get().addNotification({ type: 'error', text: 'Too many channels' });
          break;
        }

        case '421': { // ERR_UNKNOWNCOMMAND
          const cmd421 = params[1] ?? '';
          get().addNotification({ type: 'error', text: `Unknown command: ${cmd421}` });
          break;
        }

        case '431': { // ERR_NONICKNAMEGIVEN
          get().addNotification({ type: 'error', text: 'No nickname given' });
          break;
        }

        case '432': { // ERR_ERRONEUSNICKNAME — may be handled in client.ts during registration
          const nick432 = params[1] ?? '';
          get().addNotification({ type: 'error', text: `Erroneous nickname: ${nick432}` });
          break;
        }

        case '433': { // ERR_NICKNAMEINUSE — try nick aliases before reporting error
          const nick433 = params[1] ?? '';
          const { nickAliases, ourNick, client: client433 } = get();
          // Try the next unused alias
          const triedAliases = _nickAliasTryIdx > 0
            ? nickAliases.slice(0, _nickAliasTryIdx)
            : [];
          const nextAlias = nickAliases.find(a => !triedAliases.includes(a));
          if (nextAlias && client433) {
            _nickAliasTryIdx = nickAliases.indexOf(nextAlias) + 1;
            client433.sendRaw('NICK', nextAlias);
            // Mark as alias if we have a desired nick to compare against
            if (ourNick) set({ currentNickIsAlias: true });
          } else {
            _nickAliasTryIdx = 0;
            get().addNotification({ type: 'error', text: `Nickname in use: ${nick433}` });
          }
          break;
        }

        case '437': { // ERR_UNAVAILRESOURCE — may be handled in client.ts during registration
          get().addNotification({ type: 'error', text: 'Nick/channel temporarily unavailable' });
          break;
        }

        // ── legacy watch numerics ─────────────────────────────────────────
        case '600': { // RPL_LOGON — nick came online
          // :server 600 yournick watchedNick user host time :logged on
          const watchNick600 = params[1] ?? '';
          if (watchNick600) get().setWatchOnline(watchNick600, true);
          break;
        }

        case '601': { // RPL_LOGOFF — nick went offline
          // :server 601 yournick watchedNick user host time :logged off
          const watchNick601 = params[1] ?? '';
          if (watchNick601) get().setWatchOnline(watchNick601, false, new Date());
          break;
        }

        case '604': { // RPL_NOWON — nick is currently online
          const watchNick604 = params[1] ?? '';
          if (watchNick604) get().setWatchOnline(watchNick604, true);
          break;
        }

        case '605': { // RPL_NOWOFF — nick is currently offline
          const watchNick605 = params[1] ?? '';
          if (watchNick605) get().setWatchOnline(watchNick605, false);
          break;
        }

        case '441': { // ERR_USERNOTINCHANNEL
          const nick441 = params[1] ?? '';
          const channel441 = params[2] ?? '';
          get().addNotification({ type: 'error', text: `${nick441} is not in ${channel441}` });
          break;
        }

        case '442': { // ERR_NOTONCHANNEL
          const channel442 = params[1] ?? '';
          get().addNotification({ type: 'error', text: `You're not in ${channel442}` });
          break;
        }

        case '443': { // ERR_USERONCHANNEL
          const nick443 = params[1] ?? '';
          const channel443 = params[2] ?? '';
          get().addNotification({ type: 'error', text: `${nick443} is already in ${channel443}` });
          break;
        }

        case '451': { // ERR_NOTREGISTERED
          get().addNotification({ type: 'error', text: 'You need to register first' });
          break;
        }

        case '461': { // ERR_NEEDMOREPARAMS
          const cmd461 = params[1] ?? '';
          get().addNotification({ type: 'error', text: `Missing parameters for ${cmd461}` });
          break;
        }

        case '464': { // ERR_PASSWDMISMATCH — wrong password (GHOST/IDENTIFY/etc.)
          const text464 = params[params.length - 1] || 'Invalid account or password';
          get().addNotification({ type: 'error', text: text464 });
          get().addServiceNotice('Account', text464);
          break;
        }

        case '467': { // ERR_KEYSET
          get().addNotification({ type: 'error', text: 'Channel key already set' });
          break;
        }

        case '471': { // ERR_CHANNELISFULL
          const channel471 = params[1] ?? '';
          get().addNotification({ type: 'error', text: `${channel471} is full` });
          break;
        }

        case '473': { // ERR_INVITEONLYCHAN
          const channel473 = params[1] ?? '';
          get().addNotification({ type: 'error', text: `${channel473} is invite-only` });
          get().setChannelJoinPrompt(channel473, 'Channel is invite-only');
          break;
        }

        // ── RPL_BANLIST (367) ──────────────────────────────────────────────
        case '367': {
          // :server 367 ournick channel mask [setby setat]
          const ch367 = params[1] ?? '';
          const mask367 = params[2] ?? '';
          const setBy367 = params[3];
          const setAt367 = params[4] ? parseInt(params[4], 10) : undefined;
          const key367 = ch367.toLowerCase();
          if (!_banBuffer.has(key367)) _banBuffer.set(key367, []);
          _banBuffer.get(key367)!.push({ mask: mask367, setBy: setBy367, setAt: setAt367 });
          break;
        }

        // ── RPL_ENDOFBANLIST (368) ────────────────────────────────────────
        case '368': {
          const ch368 = params[1] ?? '';
          const key368 = ch368.toLowerCase();
          const bans368 = _banBuffer.get(key368) ?? [];
          _banBuffer.delete(key368);
          get().setBanList(ch368, bans368);
          break;
        }

        // ── IRCX access list numerics ───────────────────────────────────────
        case '775': {
          // :server 775 ournick #channel mask level
          const ch775 = params[1] ?? '';
          const mask775 = params[2] ?? '';
          const level775 = params[3] ?? '';
          if (ch775 && mask775) get().addServiceNotice('Channel', `${ch775} ACCESS ${mask775} ${level775}`.trim());
          break;
        }

        case '776': {
          const ch776 = params[1] ?? '';
          get().addServiceNotice('Channel', ch776 ? `${ch776} access list complete` : 'Access list complete');
          break;
        }

        case '474': { // ERR_BANNEDFROMCHAN
          const channel474 = params[1] ?? '';
          get().addNotification({ type: 'error', text: `You are banned from ${channel474}` });
          get().setChannelJoinPrompt(channel474, 'You are banned from this channel');
          break;
        }

        // ── ERR_BADCHANNELKEY (475) ───────────────────────────────────────
        case '475': {
          const channel475 = params[1] ?? '';
          get().setChannelJoinPrompt(channel475, 'Incorrect channel password');
          break;
        }

        // ── ERR_BADCHANMASK (476) — just notify ──────────────────────────
        case '476': {
          const channel476 = params[1] ?? '';
          get().addNotification({ type: 'error', text: `Bad channel mask: ${channel476}` });
          break;
        }

        case '482': { // ERR_CHANOPRIVSNEEDED
          const channel482 = params[1] ?? '';
          get().addNotification({ type: 'error', text: `You need operator privileges in ${channel482}` });
          break;
        }

        case '491': { // ERR_NOOPERHOST
          set({ isOper: false, operUsername: '' });
          get().addNotification({ type: 'error', text: 'OPER not authorized from your host' });
          break;
        }

        // ── WHOIS numerics ────────────────────────────────────────────────
        // 311 RPL_WHOISUSER  :server 311 me nick user host * :realname
        case '311': {
          const whoisNick311 = params[1];
          if (!whoisNick311) break;
          const key311 = whoisNick311.toLowerCase();
          set(s => {
            const whoisData = new Map(s.whoisData);
            const existing = whoisData.get(key311) ?? { nick: whoisNick311, loading: true };
            whoisData.set(key311, {
              ...existing,
              nick: whoisNick311,
              username: params[2],
              host: params[3],
              realname: params[5],
            });
            return { whoisData };
          });
          get().setUserProfile(whoisNick311, { nick: whoisNick311, realname: params[5] });
          break;
        }

        // 312 RPL_WHOISSERVER
        case '312': {
          const whoisNick312 = params[1];
          if (!whoisNick312) break;
          const key312 = whoisNick312.toLowerCase();
          set(s => {
            const whoisData = new Map(s.whoisData);
            const existing = whoisData.get(key312) ?? { nick: whoisNick312, loading: true };
            whoisData.set(key312, {
              ...existing,
              server: params[2],
              serverInfo: params[3],
            });
            return { whoisData };
          });
          get().setUserProfile(whoisNick312, { server: params[2], serverInfo: params[3] });
          break;
        }

        // 313 RPL_WHOISOPERATOR
        case '313': {
          const whoisNick313 = params[1];
          if (!whoisNick313) break;
          const key313 = whoisNick313.toLowerCase();
          set(s => {
            const whoisData = new Map(s.whoisData);
            const existing = whoisData.get(key313) ?? { nick: whoisNick313, loading: true };
            whoisData.set(key313, { ...existing, isOper: true });
            return { whoisData };
          });
          get().setUserProfile(whoisNick313, { ircOperator: true });
          break;
        }

        // 317 RPL_WHOISIDLE  :server 317 me nick idlesecs signonts :...
        case '317': {
          const whoisNick317 = params[1];
          if (!whoisNick317) break;
          const key317 = whoisNick317.toLowerCase();
          set(s => {
            const whoisData = new Map(s.whoisData);
            const existing = whoisData.get(key317) ?? { nick: whoisNick317, loading: true };
            whoisData.set(key317, {
              ...existing,
              idleSecs: parseInt(params[2] ?? '0', 10),
              signOnTs: parseInt(params[3] ?? '0', 10),
            });
            return { whoisData };
          });
          get().setUserProfile(whoisNick317, {
            idleSeconds: parseInt(params[2] ?? '0', 10),
            signonTime: parseInt(params[3] ?? '0', 10),
          });
          break;
        }

        // 318 RPL_ENDOFWHOIS — mark loading done
        case '318': {
          const whoisNick318 = params[1];
          if (!whoisNick318) break;
          const key318 = whoisNick318.toLowerCase();
          set(s => {
            const whoisData = new Map(s.whoisData);
            const existing = whoisData.get(key318);
            if (existing) {
              whoisData.set(key318, { ...existing, loading: false });
            }
            return { whoisData };
          });
          break;
        }

        // 319 RPL_WHOISCHANNELS
        case '319': {
          const whoisNick319 = params[1];
          if (!whoisNick319) break;
          const key319 = whoisNick319.toLowerCase();
          set(s => {
            const whoisData = new Map(s.whoisData);
            const existing = whoisData.get(key319) ?? { nick: whoisNick319, loading: true };
            whoisData.set(key319, {
              ...existing,
              channels: (params[2] ?? '').split(' ').filter(Boolean),
            });
            return { whoisData };
          });
          get().setUserProfile(whoisNick319, {
            channels: (params[2] ?? '').split(' ').filter(Boolean),
          });
          break;
        }

        // 320 RPL_WHOISSPECIAL
        case '320': {
          const whoisNick320 = params[1];
          if (!whoisNick320) break;
          const key320 = whoisNick320.toLowerCase();
          set(s => {
            const whoisData = new Map(s.whoisData);
            const existing = whoisData.get(key320) ?? { nick: whoisNick320, loading: true };
            whoisData.set(key320, { ...existing, special: params[2] });
            return { whoisData };
          });
          break;
        }

        // 330 RPL_WHOISACCOUNT
        case '330': {
          const whoisNick330 = params[1];
          if (!whoisNick330) break;
          const key330 = whoisNick330.toLowerCase();
          set(s => {
            const whoisData = new Map(s.whoisData);
            const existing = whoisData.get(key330) ?? { nick: whoisNick330, loading: true };
            whoisData.set(key330, { ...existing, account: params[2] });
            return { whoisData };
          });
          get().setUserProfile(whoisNick330, { account: params[2] });
          break;
        }

        // 338 RPL_WHOISACTUALLY
        case '338': {
          const whoisNick338 = params[1];
          if (!whoisNick338) break;
          const key338 = whoisNick338.toLowerCase();
          set(s => {
            const whoisData = new Map(s.whoisData);
            const existing = whoisData.get(key338) ?? { nick: whoisNick338, loading: true };
            whoisData.set(key338, { ...existing, realHost: params[2] });
            return { whoisData };
          });
          break;
        }

        // 305 RPL_UNAWAY — server confirms we are no longer away
        case '305': set({ isAway: false, awayMessage: '' }); break;

        // 306 RPL_NOWAWAY — server confirms we are now away
        case '306': set({ isAway: true }); break;

        // 381 RPL_YOUREOPER — we are now an IRC operator
        case '381': set({ isOper: true }); break;

        // ── Latency tracking ─────────────────────────────────────────────
        case 'PONG': {
          const cookie = params[1] ?? params[0] ?? '';
          if (cookie.startsWith('lat-')) {
            const sentAt = _pingTimestamps.get(cookie);
            if (sentAt !== undefined) {
              _pingTimestamps.delete(cookie);
              // Round to nearest ms for display; sub-ms RTT is noise
              get().setLatency(Math.round(_now() - sentAt));
            }
            // Schedule next latency ping in 30s
            setTimeout(() => {
              const { client, connectionStatus } = get();
              if (client && connectionStatus === 'connected') {
                const t = _now();
                const nextCookie = `lat-${t|0}`;
                _pingTimestamps.set(nextCookie, t);
                client.sendRaw('PING', nextCookie);
              }
            }, 30_000);
          }
          break;
        }

        // ── LUSERS numerics ───────────────────────────────────────────────
        case '251': { // RPL_LUSERCLIENT: "There are X users and Y invisible on Z servers"
          const text251 = params[1] ?? params[0] ?? '';
          const usersMatch251 = text251.match(/(\d+)\s+users/);
          const serversMatch251 = text251.match(/(\d+)\s+servers/);
          const update251: Partial<{ users: number; channels: number; servers: number; opers: number }> = {};
          if (usersMatch251) update251.users = parseInt(usersMatch251[1], 10);
          if (serversMatch251) update251.servers = parseInt(serversMatch251[1], 10);
          if (Object.keys(update251).length > 0) get().setServerStats(update251);
          break;
        }

        case '252': { // RPL_LUSEROP: "X :operator(s) online"
          const opers252 = parseInt(params[1] ?? '0', 10);
          if (!isNaN(opers252)) get().setServerStats({ opers: opers252 });
          break;
        }

        case '254': { // RPL_LUSERCHANNELS: "X :channels formed"
          const channels254 = parseInt(params[1] ?? '0', 10);
          if (!isNaN(channels254)) get().setServerStats({ channels: channels254 });
          break;
        }

        case '255': // RPL_LUSERME — covered by 251
          break;

        default:
          break;
      }
    },

    // ── Stage channels ───────────────────────────────────────────────────
    stageChannel: null,
    stageRaisedHands: [],
    isStageHost: false,
    isStageSpeaker: false,
    stageHandRaised: false,
    pendingSpeakInvite: null,
    joinStage: (channel) => {
      get().client?.sendRaw('JOIN', channel);
      set({ stageChannel: channel });
    },
    leaveStage: () => {
      const ch = get().stageChannel;
      if (ch) get().client?.sendRaw('PART', ch, 'Left stage');
      set({ stageChannel: null, isStageHost: false, isStageSpeaker: false, stageHandRaised: false, pendingSpeakInvite: null });
    },
    raiseHand: () => {
      const ch = get().stageChannel;
      if (ch) {
        get().client?.sendRaw('PRIVMSG', ch, '\x01STAGE RAISE_HAND\x01');
        set({ stageHandRaised: true });
      }
    },
    lowerHand: () => {
      const ch = get().stageChannel;
      if (ch) {
        get().client?.sendRaw('PRIVMSG', ch, '\x01STAGE LOWER_HAND\x01');
        set({ stageHandRaised: false });
      }
    },
    inviteToSpeak: (nick) => {
      const ch = get().stageChannel;
      if (ch) get().client?.sendRaw('PRIVMSG', ch, `\x01STAGE INVITE_SPEAK ${nick}\x01`);
    },
    moveToAudience: (nick) => {
      const ch = get().stageChannel;
      if (ch) get().client?.sendRaw('PRIVMSG', ch, `\x01STAGE MOVE_AUDIENCE ${nick}\x01`);
    },
    acceptSpeakInvite: () => {
      const ch = get().stageChannel;
      if (ch) {
        get().client?.sendRaw('PRIVMSG', ch, '\x01STAGE ACCEPT_SPEAK\x01');
        set({ isStageSpeaker: true, pendingSpeakInvite: null });
      }
    },
    declineSpeakInvite: () => {
      const ch = get().stageChannel;
      if (ch) get().client?.sendRaw('PRIVMSG', ch, '\x01STAGE DECLINE_SPEAK\x01');
      set({ pendingSpeakInvite: null });
    },
    grantSpeaker: (nick) => {
      const ch = get().stageChannel;
      if (ch) get().client?.sendRaw('MODE', ch, '+v', nick);
    },
    revokeSpeaker: (nick) => {
      const ch = get().stageChannel;
      if (ch) get().client?.sendRaw('MODE', ch, '-v', nick);
    },
    startStage: (channel) => {
      get().client?.sendRaw('MODE', channel, '+m');
      get().client?.sendRaw('PROP', channel, 'STAGE', '1');
      set({ stageChannel: channel, isStageHost: true, isStageSpeaker: true });
    },
    endStage: () => {
      const ch = get().stageChannel;
      if (ch) {
        get().client?.sendRaw('MODE', ch, '-m');
        get().client?.sendRaw('PROP', ch, 'STAGE', '0');
      }
      set({ stageChannel: null, isStageHost: false, isStageSpeaker: false, stageRaisedHands: [], stageHandRaised: false, pendingSpeakInvite: null });
    },
    addRaisedHand: (nick) => set(s => ({ stageRaisedHands: [...s.stageRaisedHands.filter(n => n !== nick), nick] })),
    removeRaisedHand: (nick) => set(s => ({ stageRaisedHands: s.stageRaisedHands.filter(n => n !== nick) })),

    // ── Away / Custom status ─────────────────────────────────────────────
    isAway: false,
    awayMessage: '',
    showAwayModal: false,
    openAwayModal: () => set({ showAwayModal: true }),
    closeAwayModal: () => set({ showAwayModal: false }),
    setAway: (message) => {
      get().client?.sendRaw('AWAY', message);
      set({ isAway: true, awayMessage: message, showAwayModal: false });
    },
    unsetAway: () => {
      get().client?.sendRaw('AWAY');
      set({ isAway: false, awayMessage: '' });
    },
    idleAwayMinutes: _loadIdleAwayMinutes(),
    setIdleAwayMinutes: (minutes) => {
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-idle-away-minutes', String(minutes)); } catch {}
      }
      set({ idleAwayMinutes: minutes });
    },

    // ── IRC Operator ────────────────────────────────────────────────────
    isOper: false,
    operUsername: '',
    showOperPanel: false,
    openOperPanel: () => set({ showOperPanel: true }),
    closeOperPanel: () => set({ showOperPanel: false }),
    operLogin: (username, password) => {
      void password;
      get().addNotification({
        type: 'system',
        text: 'Orochi grants IRC operator status from the authenticated SASL account.',
      });
      set({ operUsername: username });
    },
    operAction: (command, ...args) => {
      get().client?.sendRaw(command, ...args);
    },

    // ── Scheduled Messages ──────────────────────────────────────────────
    scheduledMessages: (() => {
      if (typeof window === 'undefined') return [];
      try { return JSON.parse(localStorage.getItem('ocean-scheduled') || '[]'); }
      catch { return []; }
    })(),
    showScheduledMessages: false,
    scheduleMessage: (channel, text, sendAt) => {
      const entry = { id: `sched-${Date.now()}-${Math.random().toString(36).slice(2)}`, channel, text, sendAt };
      set(s => {
        const next = [...s.scheduledMessages, entry].sort((a, b) => a.sendAt - b.sendAt);
        if (typeof window !== 'undefined') localStorage.setItem('ocean-scheduled', JSON.stringify(next));
        return { scheduledMessages: next };
      });
    },
    cancelScheduledMessage: (id) => {
      set(s => {
        const next = s.scheduledMessages.filter(m => m.id !== id);
        if (typeof window !== 'undefined') localStorage.setItem('ocean-scheduled', JSON.stringify(next));
        return { scheduledMessages: next };
      });
    },
    openScheduledMessages: () => set({ showScheduledMessages: true }),
    closeScheduledMessages: () => set({ showScheduledMessages: false }),

    // ── Sound settings ───────────────────────────────────────────────────
    soundEnabled: _loadSoundEnabled(),
    soundVolume: (() => {
      if (typeof window === 'undefined') return 0.5;
      return parseFloat(localStorage.getItem('ocean-sound-volume') || '0.5');
    })(),
    setSoundEnabled: (v) => {
      if (typeof window !== 'undefined') localStorage.setItem('ocean-sound', String(v));
      set({ soundEnabled: v });
    },
    setSoundVolume: (v) => {
      if (typeof window !== 'undefined') localStorage.setItem('ocean-sound-volume', String(v));
      set({ soundVolume: v });
    },

    // ── Push notifications ───────────────────────────────────────────────
    pushNotificationsEnabled: _loadPushNotificationsEnabled(),
    setPushNotificationsEnabled: (enabled) => {
      if (typeof window !== 'undefined') localStorage.setItem('ocean-push-notifications', String(enabled));
      set({ pushNotificationsEnabled: enabled });
    },

    // ── Sound settings modal ─────────────────────────────────────────────
    showSoundSettings: false,
    openSoundSettings: () => set({ showSoundSettings: true }),
    closeSoundSettings: () => set({ showSoundSettings: false }),

    // ── Group DM modal ───────────────────────────────────────────────────
    showGroupDM: false,
    openGroupDM: () => set({ showGroupDM: true }),
    closeGroupDM: () => set({ showGroupDM: false }),

    // ── Auto-join ────────────────────────────────────────────────────────
    autoJoinChannels: (() => {
      if (typeof window === 'undefined') return [];
      try { return JSON.parse(localStorage.getItem('ocean-autojoin') || '[]') as string[]; }
      catch { return []; }
    })(),
    addAutoJoin: (channel) => set(s => {
      const next = [...new Set([...s.autoJoinChannels, channel])];
      if (typeof window !== 'undefined') localStorage.setItem('ocean-autojoin', JSON.stringify(next));
      return { autoJoinChannels: next };
    }),
    removeAutoJoin: (channel) => set(s => {
      const next = s.autoJoinChannels.filter(c => c !== channel);
      if (typeof window !== 'undefined') localStorage.setItem('ocean-autojoin', JSON.stringify(next));
      return { autoJoinChannels: next };
    }),

    // ── Starred channels ──────────────────────────────────────────────────
    starredChannels: (() => {
      if (typeof window === 'undefined') return new Set<string>();
      try { return new Set<string>(JSON.parse(localStorage.getItem('ocean-starred') || '[]') as string[]); }
      catch { return new Set<string>(); }
    })(),
    starChannel: (ch) => set(s => {
      const next = new Set(s.starredChannels);
      next.add(ch);
      if (typeof window !== 'undefined') localStorage.setItem('ocean-starred', JSON.stringify([...next]));
      return { starredChannels: next };
    }),
    unstarChannel: (ch) => set(s => {
      const next = new Set(s.starredChannels);
      next.delete(ch);
      if (typeof window !== 'undefined') localStorage.setItem('ocean-starred', JSON.stringify([...next]));
      return { starredChannels: next };
    }),

    // ── Custom emoji ──────────────────────────────────────────────────────
    customEmoji: (() => {
      if (typeof window === 'undefined') return [];
      try { return JSON.parse(localStorage.getItem('ocean-custom-emoji') || '[]') as Array<{ name: string; url: string; addedBy?: string }>; }
      catch { return []; }
    })(),
    addCustomEmoji: (name, url) => set(s => {
      const next = [...s.customEmoji.filter(e => e.name !== name), { name, url }];
      if (typeof window !== 'undefined') localStorage.setItem('ocean-custom-emoji', JSON.stringify(next));
      return { customEmoji: next };
    }),
    removeCustomEmoji: (name) => set(s => {
      const next = s.customEmoji.filter(e => e.name !== name);
      if (typeof window !== 'undefined') localStorage.setItem('ocean-custom-emoji', JSON.stringify(next));
      return { customEmoji: next };
    }),

    // ── Custom emoji modal ────────────────────────────────────────────────
    showCustomEmojiModal: false,
    openCustomEmojiModal: () => set({ showCustomEmojiModal: true }),
    closeCustomEmojiModal: () => set({ showCustomEmojiModal: false }),

    // ── Emoji preferences ─────────────────────────────────────────────────
    recentEmojis: _loadRecentEmojis(),
    addRecentEmoji: (emoji) => {
      set(s => {
        const recent = [emoji, ...s.recentEmojis.filter(e => e !== emoji)].slice(0, 20);
        if (typeof window !== 'undefined') {
          try { localStorage.setItem('ocean-recent-emoji', JSON.stringify(recent)); } catch {}
        }
        return { recentEmojis: recent };
      });
    },
    emojiSkinTone: _loadEmojiSkinTone(),
    setEmojiSkinTone: (tone) => {
      const normalized = _normalizeEmojiSkinTone(tone);
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-emoji-skin-tone', normalized); } catch {}
      }
      set({ emojiSkinTone: normalized });
    },
    emojiUsageCounts: _loadEmojiUsage(),
    incrementEmojiUsage: (emoji) => {
      set(s => {
        const counts = { ...s.emojiUsageCounts, [emoji]: (s.emojiUsageCounts[emoji] ?? 0) + 1 };
        if (typeof window !== 'undefined') {
          try { localStorage.setItem('ocean-emoji-usage', JSON.stringify(counts)); } catch {}
        }
        return { emojiUsageCounts: counts };
      });
    },

    // ── Moderation ────────────────────────────────────────────────────────
    showModerationPanel: false,
    openModerationPanel: () => set({ showModerationPanel: true }),
    closeModerationPanel: () => set({ showModerationPanel: false }),
    moderationLog: [],
    addModerationEntry: (entry) => set(s => ({
      moderationLog: [{ ...entry, timestamp: Date.now() }, ...s.moderationLog].slice(0, 200),
    })),
    banList: new Map(),
    setBanList: (channel, bans) => set(s => ({
      banList: new Map(s.banList).set(channel.toLowerCase(), bans),
    })),
    fetchBanList: (channel) => {
      get().client?.sendRaw('MODE', channel, '+b');
    },
    tempBan: (channel, mask, minutes) => {
      const key = `${channel.toLowerCase()}\0${mask.toLowerCase()}`;
      const existing = _tempBanTimers.get(key);
      if (existing) clearTimeout(existing);
      get().client?.sendRaw('MODE', channel, '+b', mask);

      const fire = () => {
        const { client, connectionStatus } = get();
        if (client && connectionStatus === 'connected') {
          client.sendRaw('MODE', channel, '-b', mask);
          _tempBanTimers.delete(key);
          return;
        }
        _tempBanTimers.set(key, setTimeout(fire, 30000));
      };

      _tempBanTimers.set(key, setTimeout(fire, Math.max(1, minutes) * 60 * 1000));
    },

    // ── Highlight words ───────────────────────────────────────────────────
    highlightWords: _loadHighlightWords(),
    showHighlightModal: false,
    addHighlightWord: (word) => {
      set(s => {
        const words = [...s.highlightWords, word.trim().toLowerCase()].filter(Boolean);
        _saveHighlightWords(words);
        return { highlightWords: words };
      });
    },
    removeHighlightWord: (word) => {
      set(s => {
        const words = s.highlightWords.filter(w => w !== word.toLowerCase());
        _saveHighlightWords(words);
        return { highlightWords: words };
      });
    },
    openHighlightModal: () => set({ showHighlightModal: true }),
    closeHighlightModal: () => set({ showHighlightModal: false }),

    // ── User notes ────────────────────────────────────────────────────────
    userNotes: _loadUserNotes(),
    setUserNote: (nick, note) => {
      set(s => {
        const notes = new Map(s.userNotes);
        const key = nick.toLowerCase();
        if (note.trim()) {
          notes.set(key, note.trim());
        } else {
          notes.delete(key);
        }
        _saveUserNotes(notes);
        return { userNotes: notes };
      });
    },
    getUserNote: (nick) => {
      return get().userNotes.get(nick.toLowerCase()) ?? '';
    },
    deleteUserNote: (nick) => {
      set(s => {
        const notes = new Map(s.userNotes);
        notes.delete(nick.toLowerCase());
        _saveUserNotes(notes);
        return { userNotes: notes };
      });
    },

    // ── Invite modal ──────────────────────────────────────────────────────
    showInviteModal: false,
    openInviteModal: () => set({ showInviteModal: true }),
    closeInviteModal: () => set({ showInviteModal: false }),

    // ── Nick color overrides ──────────────────────────────────────────────
    nickColorOverrides: _loadNickColorOverrides(),
    setNickColorOverride: (nick, color) => {
      set(s => {
        const overrides = new Map(s.nickColorOverrides);
        overrides.set(nick.toLowerCase(), color);
        _saveNickColorOverrides(overrides);
        return { nickColorOverrides: overrides };
      });
    },
    clearNickColorOverride: (nick) => {
      set(s => {
        const overrides = new Map(s.nickColorOverrides);
        overrides.delete(nick.toLowerCase());
        _saveNickColorOverrides(overrides);
        return { nickColorOverrides: overrides };
      });
    },

    // ── CTCP configuration ────────────────────────────────────────────────
    ctcpVersionReply: _loadCTCPConfig().versionReply,
    ctcpTimeEnabled: _loadCTCPConfig().timeEnabled,
    ctcpPingEnabled: true,
    ctcpEnabled: true,
    setCTCPVersionReply: (reply) => {
      const cfg = { ..._loadCTCPConfig(), versionReply: reply };
      _saveCTCPConfig(cfg);
      set({ ctcpVersionReply: reply });
    },
    setCTCPTimeEnabled: (enabled) => {
      const cfg = { ..._loadCTCPConfig(), timeEnabled: enabled };
      _saveCTCPConfig(cfg);
      set({ ctcpTimeEnabled: enabled });
    },
    setCTCPPingEnabled: (enabled) => set({ ctcpPingEnabled: enabled }),
    setCTCPEnabled: (enabled) => set({ ctcpEnabled: enabled }),

    // ── Server announcements ──────────────────────────────────────────────
    announcements: [],
    showAnnouncementsPanel: false,
    addAnnouncement: (ann) => {
      const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      set(s => ({ announcements: [...s.announcements.slice(-49), { ...ann, id, time: new Date(), read: false }] }));
    },
    markAnnouncementsRead: () => {
      set(s => ({ announcements: s.announcements.map(a => ({ ...a, read: true })) }));
    },
    clearAnnouncements: () => set({ announcements: [] }),
    openAnnouncementsPanel: () => {
      set({ showAnnouncementsPanel: true });
      set(s => ({ announcements: s.announcements.map(a => ({ ...a, read: true })) }));
    },
    closeAnnouncementsPanel: () => set({ showAnnouncementsPanel: false }),

    // ── Do Not Disturb ────────────────────────────────────────────────────
    dndEnabled: _loadDndEnabled(),
    dndQuietStart: _loadDndHour('ocean-dnd-quiet-start', 22),
    dndQuietEnd: _loadDndHour('ocean-dnd-quiet-end', 8),
    dndUntil: _loadDndUntil(),
    showDndModal: false,
    setDndEnabled: (enabled) => {
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-dnd-enabled', String(enabled)); } catch {}
      }
      set({ dndEnabled: enabled });
    },
    setDndQuietHours: (start, end) => {
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('ocean-dnd-quiet-start', String(start));
          localStorage.setItem('ocean-dnd-quiet-end', String(end));
        } catch {}
      }
      set({ dndQuietStart: start, dndQuietEnd: end });
    },
    setDndUntil: (until) => {
      if (typeof window !== 'undefined') {
        try {
          if (until === null) localStorage.removeItem('ocean-dnd-until');
          else localStorage.setItem('ocean-dnd-until', String(until));
        } catch {}
      }
      set({ dndUntil: until });
    },
    isDndActive: () => {
      const { dndEnabled, dndQuietStart, dndQuietEnd, dndUntil } = get();
      // Timed override takes precedence
      if (dndUntil !== null && Date.now() < dndUntil) return true;
      if (!dndEnabled) return false;
      const hour = new Date().getHours();
      if (dndQuietStart <= dndQuietEnd) {
        return hour >= dndQuietStart && hour < dndQuietEnd;
      }
      // Overnight wrap (e.g. 22–8: active if hour >= 22 OR hour < 8)
      return hour >= dndQuietStart || hour < dndQuietEnd;
    },
    openDndModal: () => set({ showDndModal: true }),
    closeDndModal: () => set({ showDndModal: false }),

    // ── Time format ────────────────────────────────────────────────────────
    timeFormat: _loadTimeFormat(),
    setTimeFormat: (format) => {
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-time-format', format); } catch {}
      }
      set({ timeFormat: format });
    },

    // ── Channel sort order ─────────────────────────────────────────────────
    channelSortOrder: 'alpha',
    channelLastActivity: new Map(),
    setChannelSortOrder: (order) => set({ channelSortOrder: order }),
    updateChannelActivity: (channel) => {
      set(s => {
        const map = new Map(s.channelLastActivity);
        map.set(channel.toLowerCase(), Date.now());
        return { channelLastActivity: map };
      });
    },

    // ── Chat export modal ─────────────────────────────────────────────────────
    showExportModal: false,
    openExportModal: () => set({ showExportModal: true }),
    closeExportModal: () => set({ showExportModal: false }),

    // ── DM pins (stored locally per nick) ────────────────────────────────────
    dmPinnedMessages: _loadDMPins(),
    showDMPins: false,
    dmPinsNick: null,
    pinDMMessage: (nick, msg) => {
      const key = nick.toLowerCase();
      const pins = new Map(get().dmPinnedMessages);
      const existing = pins.get(key) ?? [];
      if (!existing.find(p => p.id === msg.id)) {
        const updated = [...existing, msg].slice(-20);
        pins.set(key, updated);
        _saveDMPins(pins);
        set({ dmPinnedMessages: pins });
      }
    },
    unpinDMMessage: (nick, msgId) => {
      const key = nick.toLowerCase();
      const pins = new Map(get().dmPinnedMessages);
      const existing = pins.get(key) ?? [];
      pins.set(key, existing.filter(p => p.id !== msgId));
      _saveDMPins(pins);
      set({ dmPinnedMessages: pins });
    },
    openDMPins: (nick) => set({ showDMPins: true, dmPinsNick: nick }),
    closeDMPins: () => set({ showDMPins: false, dmPinsNick: null }),

    // ── DM mute ───────────────────────────────────────────────────────────────
    mutedDMs: _loadMutedDMs(),
    muteDM: (nick) => {
      set(s => {
        const muted = new Set(s.mutedDMs);
        muted.add(nick.toLowerCase());
        _saveMutedDMs(muted);
        return { mutedDMs: muted };
      });
    },
    unmuteDM: (nick) => {
      set(s => {
        const muted = new Set(s.mutedDMs);
        muted.delete(nick.toLowerCase());
        _saveMutedDMs(muted);
        return { mutedDMs: muted };
      });
    },
    isDMMuted: (nick) => get().mutedDMs.has(nick.toLowerCase()),

    // ── DM media panel ────────────────────────────────────────────────────────
    showDMMedia: false,
    openDMMedia: () => set({ showDMMedia: true }),
    closeDMMedia: () => set({ showDMMedia: false }),

    // ── Connection profiles modal ──────────────────────────────────────────────
    showConnectionProfiles: false,
    openConnectionProfiles: () => set({ showConnectionProfiles: true }),
    closeConnectionProfiles: () => set({ showConnectionProfiles: false }),

    // ── Compact sidebar ────────────────────────────────────────────────────────
    compactSidebar: _loadCompactSidebar(),
    setCompactSidebar: (compact) => {
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-compact-sidebar', compact ? '1' : '0'); } catch {}
      }
      set({ compactSidebar: compact });
    },

    // ── Channel color labels ───────────────────────────────────────────────────
    channelColors: _loadChannelColors(),
    setChannelColor: (channel, color) => {
      const colors = new Map(get().channelColors);
      colors.set(channel.toLowerCase(), color);
      _saveChannelColors(colors);
      set({ channelColors: colors });
    },
    clearChannelColor: (channel) => {
      const colors = new Map(get().channelColors);
      colors.delete(channel.toLowerCase());
      _saveChannelColors(colors);
      set({ channelColors: colors });
    },

    // ── Message font size ──────────────────────────────────────────────────────
    messageFontSize: _loadMessageFontSize(),
    setMessageFontSize: (size) => {
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--msg-font-size', `${size}px`);
      }
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-message-font-size', String(size)); } catch {}
      }
      set({ messageFontSize: size });
    },

    // ── Accent color ───────────────────────────────────────────────────────────
    accentColor: _loadAccentColor(),
    setAccentColor: (color) => {
      _applyAccentColor(color);
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-accent-color', color); } catch {}
      }
      set({ accentColor: color });
    },

    // ── Reduced motion ─────────────────────────────────────────────────────────
    reducedMotion: _loadReducedMotion(),
    setReducedMotion: (reduced) => {
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('reduced-motion', reduced);
      }
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-reduced-motion', reduced ? '1' : '0'); } catch {}
      }
      set({ reducedMotion: reduced });
    },

    // ── Chat background pattern ────────────────────────────────────────────────
    chatBackground: _loadChatBackground(),
    setChatBackground: (bg) => {
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-bg', bg);
      }
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-chat-background', bg); } catch {}
      }
      set({ chatBackground: bg });
    },

    // ── UI font family ─────────────────────────────────────────────────────────
    uiFont: _loadUiFont(),
    setUiFont: (font) => {
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--ui-font', font);
      }
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-ui-font', font); } catch {}
      }
      set({ uiFont: font });
    },

    // ── Bubble message mode ────────────────────────────────────────────────────
    bubbleMode: _loadBubbleMode(),
    setBubbleMode: (v) => {
      if (typeof document !== 'undefined') {
        document.body.classList.toggle('bubble-mode', v);
      }
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-bubble-mode', v ? '1' : '0'); } catch {}
      }
      set({ bubbleMode: v });
    },

    // ── Custom CSS injection ───────────────────────────────────────────────────
    customCss: _loadCustomCss(),
    setCustomCss: (css) => {
      if (typeof document !== 'undefined') {
        let el = document.getElementById('ocean-custom-css') as HTMLStyleElement | null;
        if (!el) {
          el = document.createElement('style');
          el.id = 'ocean-custom-css';
          document.head.appendChild(el);
        }
        el.textContent = css;
      }
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-custom-css', css); } catch {}
      }
      set({ customCss: css });
    },

    // ── Sidebar width (drag-resizable) ────────────────────────────────────────
    sidebarWidth: _loadSidebarWidth(),
    setSidebarWidth: (w) => {
      const clamped = Math.max(180, Math.min(320, w));
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--sidebar-width', clamped + 'px');
      }
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-sidebar-width', String(clamped)); } catch {}
      }
      set({ sidebarWidth: clamped });
    },

    // ── Message max width ──────────────────────────────────────────────────────
    messageMaxWidth: _loadMessageMaxWidth(),
    setMessageMaxWidth: (w) => {
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--msg-max-width', w === 0 ? 'none' : w + 'px');
      }
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-msg-maxw', String(w)); } catch {}
      }
      set({ messageMaxWidth: w });
    },

    // ── Glass sidebar ──────────────────────────────────────────────────────────
    glassSidebar: _loadGlassSidebar(),
    setGlassSidebar: (v) => {
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('glass-sidebar', v);
      }
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-glass-sidebar', v ? '1' : '0'); } catch {}
      }
      set({ glassSidebar: v });
    },

    // ── Member list sort ────────────────────────────────────────────────────────
    memberListSort: 'role',
    setMemberListSort: (sort) => set({ memberListSort: sort }),

    // ── Latency history (sparkline) ───────────────────────────────────────────
    latencyHistory: [],
    addLatencyReading: (ms) => {
      const history = [...get().latencyHistory.slice(-59), ms];
      set({ latencyHistory: history });
    },

    // ── Connection uptime ─────────────────────────────────────────────────────
    connectedAt: null,
    setConnectedAt: (date) => set({ connectedAt: date }),

    // ── Server info panel ─────────────────────────────────────────────────────
    serverVersion: null,
    serverCapabilities: [],
    showServerInfo: false,
    openServerInfo: () => set({ showServerInfo: true }),
    closeServerInfo: () => set({ showServerInfo: false }),

    // ── WHO / away tracking ───────────────────────────────────────────────────
    awayNicks: new Set(),
    setNickAway: (nick, away) => {
      set(s => {
        const awayNicks = new Set(s.awayNicks);
        if (away) awayNicks.add(nick.toLowerCase());
        else awayNicks.delete(nick.toLowerCase());
        return { awayNicks };
      });
    },

    // ── Focus mode ────────────────────────────────────────────────────────────
    focusMode: false,
    toggleFocusMode: () => set(s => ({ focusMode: !s.focusMode })),

    // ── Channel folders ───────────────────────────────────────────────────────
    channelFolders: _loadChannelFolders(),
    setChannelFolders: (folders) => {
      set({ channelFolders: folders });
      _saveChannelFolders(folders);
    },
    addChannelToFolder: (channel, folderId) => set(s => {
      const folders = s.channelFolders.map(f => ({
        ...f,
        channels: f.channels.filter(c => c.toLowerCase() !== channel.toLowerCase()),
      }));
      const updated = folders.map(f =>
        f.id === folderId ? { ...f, channels: [...f.channels, channel] } : f
      );
      _saveChannelFolders(updated);
      return { channelFolders: updated };
    }),
    toggleFolderCollapsed: (folderId) => set(s => {
      const updated = s.channelFolders.map(f =>
        f.id === folderId ? { ...f, collapsed: !f.collapsed } : f
      );
      _saveChannelFolders(updated);
      return { channelFolders: updated };
    }),
    createFolder: (name) => set(s => {
      const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const updated = [...s.channelFolders, { id, name, channels: [], collapsed: false }];
      _saveChannelFolders(updated);
      return { channelFolders: updated };
    }),
    deleteFolder: (folderId) => set(s => {
      const toDelete = s.channelFolders.find(f => f.id === folderId);
      if (!toDelete) return {};
      const orphans = toDelete.channels;
      const updated = s.channelFolders
        .filter(f => f.id !== folderId)
        .map((f, i) => i === 0 ? { ...f, channels: [...f.channels, ...orphans] } : f);
      _saveChannelFolders(updated);
      return { channelFolders: updated };
    }),
    renameFolder: (folderId, name) => set(s => {
      const updated = s.channelFolders.map(f => f.id === folderId ? { ...f, name } : f);
      _saveChannelFolders(updated);
      return { channelFolders: updated };
    }),

    // ── Favorite emojis ───────────────────────────────────────────────────────
    favoriteEmojis: _loadFavoriteEmojis(),
    setFavoriteEmojis: (emojis) => { set({ favoriteEmojis: emojis }); _saveFavoriteEmojis(emojis); },

    // ── Poll create modal ─────────────────────────────────────────────────────
    showPollCreate: false,
    openPollCreate: () => set({ showPollCreate: true }),
    closePollCreate: () => set({ showPollCreate: false }),

    // ── Reaction summary panel ────────────────────────────────────────────────
    showReactionStats: null,
    openReactionStats: (messageId) => set({ showReactionStats: messageId }),
    closeReactionStats: () => set({ showReactionStats: null }),

    // ── Topic history ─────────────────────────────────────────────────────────
    topicHistory: _loadTopicHistory(),
    addTopicHistory: (channel, topic) => set(s => {
      if (!topic) return {};
      const key = channel.toLowerCase();
      const hist = [topic, ...(s.topicHistory[key] ?? []).filter(t => t !== topic)].slice(0, 10);
      const topicHistory = { ...s.topicHistory, [key]: hist };
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('ocean-topic-history', JSON.stringify(topicHistory));
        }
      } catch {}
      return { topicHistory };
    }),

    // ── Channel welcome banner ────────────────────────────────────────────────
    channelWelcomeSeen: new Set<string>(),
    markWelcomeSeen: (channel) => set(s => ({
      channelWelcomeSeen: new Set([...s.channelWelcomeSeen, channel.toLowerCase()]),
    })),

    // ── Voice / SUIMYAKU speaking + channel tracking ────────────────────────────
    speakingNicks: new Set<string>(),
    setSpeakingNick: (nick, speaking) => set(s => {
      const next = new Set(s.speakingNicks);
      if (speaking) {
        next.add(nick.toLowerCase());
      } else {
        next.delete(nick.toLowerCase());
      }
      return { speakingNicks: next };
    }),
    voiceChannels: [],
    addVoiceChannel: (channel) => set(s => {
      const lower = channel.toLowerCase();
      if (s.voiceChannels.includes(lower)) return {};
      return { voiceChannels: [...s.voiceChannels, lower] };
    }),
    removeVoiceChannel: (channel) => set(s => ({
      voiceChannels: s.voiceChannels.filter(c => c !== channel.toLowerCase()),
    })),

    // ── Channel event log ───────────────────────────────────────────────
    channelEvents: {},
    addChannelEvent: (channel, event) => set(s => {
      const key = channel.toLowerCase();
      const prev = s.channelEvents[key] ?? [];
      const next = [...prev, event].slice(-500);
      return { channelEvents: { ...s.channelEvents, [key]: next } };
    }),
    clearChannelEvents: (channel) => set(s => {
      const key = channel.toLowerCase();
      const channelEvents = { ...s.channelEvents };
      delete channelEvents[key];
      return { channelEvents };
    }),
    showEventLog: false,
    openEventLog: () => set({ showEventLog: true }),
    closeEventLog: () => set({ showEventLog: false }),
    eventLogFilters: new Set<ChannelEventType>(['join', 'part', 'quit', 'kick', 'mode', 'nick']),
    toggleEventFilter: (type) => set(s => {
      const next = new Set(s.eventLogFilters);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { eventLogFilters: next };
    }),

    // ── Join history ────────────────────────────────────────────────────
    joinHistory: [],
    addJoinHistory: (channel) => set(s => {
      const lower = channel.toLowerCase();
      const filtered = s.joinHistory.filter(c => c.toLowerCase() !== lower);
      return { joinHistory: [channel, ...filtered].slice(0, 20) };
    }),

    // ── Nick aliases ─────────────────────────────────────────────────────
    nickAliases: _loadNickAliases(),
    currentNickIsAlias: false,
    setNickAliases: (aliases) => {
      const clean = aliases.map(a => a.trim()).filter(Boolean);
      _saveNickAliases(clean);
      set({ nickAliases: clean });
    },

    // ── ISUPPORT token store ──────────────────────────────────────────────
    isupportTokens: {},

    // ── Watch list / MONITOR ──────────────────────────────────────────────
    watchList: _loadWatchList(),
    addToWatchList: (nick) => {
      const { watchList, client } = get();
      if (watchList.some(w => w.nick.toLowerCase() === nick.toLowerCase())) return;
      const next = [...watchList, { nick, online: false }];
      _saveWatchList(next);
      set({ watchList: next });
      client?.sendRaw('MONITOR', '+', nick);
    },
    removeFromWatchList: (nick) => {
      const { watchList, client } = get();
      const next = watchList.filter(w => w.nick.toLowerCase() !== nick.toLowerCase());
      _saveWatchList(next);
      set({ watchList: next });
      client?.sendRaw('MONITOR', '-', nick);
    },
    setWatchOnline: (nick, online, time) => set(s => ({
      watchList: s.watchList.map(w =>
        w.nick.toLowerCase() === nick.toLowerCase()
          ? { ...w, online, lastSeen: online ? w.lastSeen : (time ?? new Date()) }
          : w
      ),
    })),

    // ── Mobile panel navigation ─────────────────────────────────────────────
    mobilePanel: 'chat',
    setMobilePanel: (panel) => set({ mobilePanel: panel }),

    // ── High contrast mode ──────────────────────────────────────────────────
    highContrastMode: _loadHighContrast(),
    setHighContrastMode: (v) => {
      if (typeof window !== 'undefined') {
        if (v) localStorage.setItem('ocean-high-contrast', '1');
        else localStorage.removeItem('ocean-high-contrast');
      }
      set({ highContrastMode: v });
    },

    // ── Developer mode ────────────────────────────────────────────────────
    devMode: _loadBoolPref('ocean-devMode'),
    setDevMode: (v) => {
      if (typeof window !== 'undefined') {
        if (v) localStorage.setItem('ocean-devMode', '1');
        else localStorage.removeItem('ocean-devMode');
      }
      set({ devMode: v });
    },

    // ── Streamer mode ─────────────────────────────────────────────────────
    streamerMode: _loadBoolPref('ocean-streamerMode'),
    streamerModeBlurLinks: _loadBoolPref('ocean-streamerModeBlurLinks'),
    setStreamerMode: (v) => {
      if (typeof window !== 'undefined') {
        if (v) localStorage.setItem('ocean-streamerMode', '1');
        else localStorage.removeItem('ocean-streamerMode');
        document.documentElement.setAttribute('data-streamer-mode', v ? 'true' : 'false');
      }
      set({ streamerMode: v });
    },
    setStreamerModeBlurLinks: (v) => {
      if (typeof window !== 'undefined') {
        if (v) localStorage.setItem('ocean-streamerModeBlurLinks', '1');
        else localStorage.removeItem('ocean-streamerModeBlurLinks');
      }
      set({ streamerModeBlurLinks: v });
    },

    // ── Accessibility extras ──────────────────────────────────────────────
    reduceMotion: _loadBoolPref('ocean-reduceMotion'),
    compactMemberList: _loadBoolPref('ocean-compactMemberList'),
    setReduceMotion: (v) => {
      if (typeof window !== 'undefined') {
        if (v) localStorage.setItem('ocean-reduceMotion', '1');
        else localStorage.removeItem('ocean-reduceMotion');
        if (v) document.documentElement.setAttribute('data-reduce-motion', 'true');
        else document.documentElement.removeAttribute('data-reduce-motion');
      }
      set({ reduceMotion: v });
    },
    setCompactMemberList: (v) => {
      if (typeof window !== 'undefined') {
        if (v) localStorage.setItem('ocean-compactMemberList', '1');
        else localStorage.removeItem('ocean-compactMemberList');
      }
      set({ compactMemberList: v });
    },

    // ── Multi-select messages ─────────────────────────────────────────────
    selectedMessages: new Set<string>(),
    isSelectMode: false,
    toggleMessageSelection: (id) => set(s => {
      const next = new Set(s.selectedMessages);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedMessages: next };
    }),
    clearSelection: () => set({ selectedMessages: new Set(), isSelectMode: false }),
    enterSelectMode: () => set({ isSelectMode: true }),
    exitSelectMode: () => set({ isSelectMode: false, selectedMessages: new Set() }),

    // ── Forum channels ────────────────────────────────────────────────────
    forumChannels: _loadForumChannels(),
    toggleForumChannel: (channel) => set(s => {
      const next = new Set(s.forumChannels);
      const key = channel.toLowerCase();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('ocean-forum-channels', JSON.stringify([...next]));
        }
      } catch {}
      return { forumChannels: next };
    }),
    forumPosts: {},
    addForumPost: (channel, post) => set(s => {
      const key = channel.toLowerCase();
      const prev = s.forumPosts[key] ?? [];
      return { forumPosts: { ...s.forumPosts, [key]: [post, ...prev] } };
    }),
    showForumCreate: false,
    openForumCreate: () => set({ showForumCreate: true }),
    closeForumCreate: () => set({ showForumCreate: false }),

    // ── Embed suppression ─────────────────────────────────────────────────────
    suppressedEmbeds: new Set<string>(),
    toggleSuppressEmbed: (id) => set(s => {
      const n = new Set(s.suppressedEmbeds);
      if (n.has(id)) n.delete(id); else n.add(id);
      return { suppressedEmbeds: n };
    }),

    // ── Display name overrides ────────────────────────────────────────────────
    displayNameOverrides: _loadDisplayNameOverrides(),
    setDisplayNameOverride: (nick, displayName) => set(s => {
      const overrides = { ...s.displayNameOverrides, [nick]: displayName };
      _saveDisplayNameOverrides(overrides);
      return { displayNameOverrides: overrides };
    }),
    clearDisplayNameOverride: (nick) => set(s => {
      const displayNameOverrides = { ...s.displayNameOverrides };
      delete displayNameOverrides[nick];
      _saveDisplayNameOverrides(displayNameOverrides);
      return { displayNameOverrides };
    }),
    selfDisplayName: _loadSelfDisplayName(),
    setSelfDisplayName: (name) => {
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-self-display-name', name); } catch {}
      }
      set({ selfDisplayName: name });
    },

    // ── Self profile ──────────────────────────────────────────────────────────
    selfBio: typeof window !== 'undefined' ? (localStorage.getItem('ocean-selfBio') ?? '') : '',
    selfPronouns: typeof window !== 'undefined' ? (localStorage.getItem('ocean-selfPronouns') ?? '') : '',
    selfBannerUrl: typeof window !== 'undefined' ? (localStorage.getItem('ocean-selfBannerUrl') ?? '') : '',
    setSelfBio: (bio) => {
      if (typeof window !== 'undefined') { try { localStorage.setItem('ocean-selfBio', bio); } catch {} }
      set({ selfBio: bio });
    },
    setSelfPronouns: (pronouns) => {
      if (typeof window !== 'undefined') { try { localStorage.setItem('ocean-selfPronouns', pronouns); } catch {} }
      set({ selfPronouns: pronouns });
    },
    setSelfBannerUrl: (url) => {
      if (typeof window !== 'undefined') { try { localStorage.setItem('ocean-selfBannerUrl', url); } catch {} }
      set({ selfBannerUrl: url });
    },

    // ── Invisible mode ────────────────────────────────────────────────────────
    invisibleMode: typeof window !== 'undefined' && localStorage.getItem('ocean-invisibleMode') === '1',
    setInvisibleMode: (v) => {
      if (typeof window !== 'undefined') { try { localStorage.setItem('ocean-invisibleMode', v ? '1' : '0'); } catch {} }
      const { client, ourNick } = get();
      if (client && ourNick) {
        client.sendRaw('MODE', ourNick, v ? '+i' : '-i');
      }
      set({ invisibleMode: v });
    },

    // ── Unread tracking ───────────────────────────────────────────────────────
    channelUnread: {},
    channelMentions: {},
    totalUnreadMentions: 0,
    markChannelRead: (channel) => set(state => {
      const key = channel.toLowerCase();
      const newUnread = { ...state.channelUnread, [key]: 0 };
      const newMentions = { ...state.channelMentions, [key]: 0 };
      const totalUnreadMentions = Object.values(newMentions).reduce((a, b) => a + b, 0);
      return { channelUnread: newUnread, channelMentions: newMentions, totalUnreadMentions };
    }),
    incrementUnread: (channel, isMention) => set(state => {
      const key = channel.toLowerCase();
      const newUnread = { ...state.channelUnread, [key]: (state.channelUnread[key] || 0) + 1 };
      const newMentions = isMention
        ? { ...state.channelMentions, [key]: (state.channelMentions[key] || 0) + 1 }
        : state.channelMentions;
      const totalUnreadMentions = Object.values(newMentions).reduce((a, b) => a + b, 0);
      return { channelUnread: newUnread, channelMentions: newMentions, totalUnreadMentions };
    }),

    // ── Rich user profiles ────────────────────────────────────────────────────
    userProfiles: new Map(),
    setUserProfile: (nick, data) => set(s => {
      const profiles = new Map(s.userProfiles);
      const existing = profiles.get(nick.toLowerCase()) ?? { nick };
      profiles.set(nick.toLowerCase(), { ...existing, ...data });
      return { userProfiles: profiles };
    }),
    getUserProfile: (nick) => get().userProfiles.get(nick.toLowerCase()) ?? null,

    // ── Orochi integration (serial integration pass) ──────────────────────────
    userMetadata: new Map(),
    mediaTranscripts: new Map(),
    tegami: new Map(),
    readMarkers: new Map(),

    renameChannel(channel, newName, reason) {
      const { client } = get();
      if (!client) return;
      if (reason) {
        client.sendRaw('RENAME', channel, newName, reason);
      } else {
        client.sendRaw('RENAME', channel, newName);
      }
    },

    setOwnMetadata(key, value) {
      const { client, ourNick } = get();
      if (!client || !key) return;
      if (value === null || value === '') {
        // Orochi handleMetadata: SET with no/empty value deletes the key.
        client.sendRaw('METADATA', '*', 'SET', key);
      } else {
        client.sendRaw('METADATA', '*', 'SET', key, value);
      }
      // Optimistic local apply — the server also echoes 761 RPL_KEYVALUE.
      if (ourNick) get()._applyMetadata(ourNick, key, value ?? '');
    },

    _applyMetadata(target, key, value) {
      // Orochi echoes the literal target the client sent, so a self-SET
      // (`METADATA * SET …`) comes back as target `*`. Normalize it to our nick
      // so the metadata lands on our own profile, not a phantom `*` entry.
      const resolvedTarget = target === '*' ? (get().ourNick || target) : target;
      const nickKey = resolvedTarget.toLowerCase();
      set(s => {
        const userMetadata = new Map(s.userMetadata);
        const entry = { ...(userMetadata.get(nickKey) ?? {}) };
        if (value === '') {
          delete entry[key];
        } else {
          entry[key] = value;
        }
        userMetadata.set(nickKey, entry);
        return { userMetadata };
      });
      // Map namespaced ocean.* (and bare metadata-2 standard) keys onto the
      // rich profile so profile components can consume them via selectors.
      const norm = key.toLowerCase().replace(/^ocean\./, '');
      const profilePatch: Partial<RichUserProfile> | null =
        norm === 'display-name' || norm === 'displayname'
          ? { displayName: value || undefined }
          : norm === 'pronouns'
            ? { pronouns: value || undefined }
            : norm === 'bio'
              ? { bio: value || undefined }
              : norm === 'accent' || norm === 'accent-color' || norm === 'color'
                ? { accentColor: value || undefined }
                : norm === 'links' || norm === 'url' || norm === 'website'
                  ? { links: value ? value.split(/[\s,]+/).filter(Boolean) : undefined }
                  : norm === 'banner' || norm === 'banner-url'
                    ? { bannerUrl: value || undefined }
                    : null;
      if (profilePatch) get().setUserProfile(resolvedTarget, profilePatch);
    },

    clearTegami(target) {
      const key = target.toLowerCase();
      if (!get().tegami.has(key)) return;
      set(s => {
        const tegami = new Map(s.tegami);
        tegami.delete(key);
        return { tegami };
      });
    },

    // ── Channel ordering (drag reorder) ───────────────────────────────────────
    channelOrder: _loadChannelOrder(),
    setChannelOrder: (order) => {
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-channel-order', JSON.stringify(order)); } catch {}
      }
      set({ channelOrder: order });
    },

    // ── NSFW channels ─────────────────────────────────────────────────────────
    nsfwChannels: _loadNsfwChannels(),
    nsfwAcknowledged: new Set<string>(),
    markChannelNsfw: (channel) => set(s => {
      const next = new Set(s.nsfwChannels);
      next.add(channel.toLowerCase());
      _saveNsfwChannels(next);
      return { nsfwChannels: next };
    }),
    unmarkChannelNsfw: (channel) => set(s => {
      const next = new Set(s.nsfwChannels);
      next.delete(channel.toLowerCase());
      _saveNsfwChannels(next);
      return { nsfwChannels: next };
    }),
    acknowledgeNsfw: (channel) => set(s => {
      const next = new Set(s.nsfwAcknowledged);
      next.add(channel.toLowerCase());
      return { nsfwAcknowledged: next };
    }),

    // ── Theme & display (new system) ──────────────────────────────────────────
    theme: _loadDisplayTheme(),
    fontSize: _loadDisplayFontSize(),
    setDisplayTheme: (theme) => {
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-display-theme', theme); } catch {}
      }
      set({ theme });
    },
    setFontSize: (size) => {
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('ocean-ui-font-size', String(size)); } catch {}
      }
      if (typeof document !== 'undefined') {
        document.documentElement.style.fontSize = size + 'px';
      }
      set({ fontSize: size });
    },

    // ── Voice / Video Channel Actions ─────────────────────────────────────────
    voiceChannelParticipants: new Map(),

    async joinVoiceChannel(channel, withVideo = false) {
      const { client } = get();
      if (!client) return;
      const engine = getMountedSuimyakuMediaEngine();
      if (!engine) return;

      await (withVideo ? engine.joinVideo(channel) : engine.joinVoice(channel));
      const stream = engine.getLocalStream();
      if (!stream) {
        get().addToast({
          variant: 'error',
          title: 'Microphone Error',
          description: 'Could not access your microphone. Check permissions.',
        });
        return;
      }

      get().setVoiceCallState({
        callState: 'in_call',
        callChannel: channel,
        localStream: stream,
        cameraOn: withVideo,
        cameraStream: withVideo ? stream : null,
      });

      const { ourNick } = get();
      set(s => {
        const map = new Map(s.voiceChannelParticipants);
        const pSet = new Set(map.get(channel.toLowerCase()) ?? []);
        pSet.add(ourNick);
        map.set(channel.toLowerCase(), pSet);
        return { voiceChannelParticipants: map };
      });
    },

    leaveVoiceChannel() {
      const { client, voice } = get();
      if (voice.callState === 'idle') return;

      const ch = voice.callChannel;

      if (ch) getMountedSuimyakuMediaEngine()?.leaveRoom(ch);
      else if (voice.callWith) getMountedSuimyakuMediaEngine()?.hangup(voice.callWith);

      void client;

      get().setVoiceCallState({
        callState: 'idle',
        callChannel: null,
        callWith: '',
        localStream: null,
        cameraOn: false,
        cameraStream: null,
        peers: new Map(),
      });

      const { ourNick } = get();
      if (ch) {
        set(s => {
          const map = new Map(s.voiceChannelParticipants);
          const pSet = new Set(map.get(ch.toLowerCase()) ?? []);
          pSet.delete(ourNick);
          map.set(ch.toLowerCase(), pSet);
          return { voiceChannelParticipants: map };
        });
      }
    },

    async toggleCamera() {
      const { voice, client } = get();
      if (voice.callState !== 'in_call') return;
      const engine = getMountedSuimyakuMediaEngine();
      if (!engine) return;

      if (voice.cameraOn) {
        engine.stopCamera();
        get().setVoiceCallState({ cameraOn: false, cameraStream: null, localStream: engine.getLocalStream() });
        void client;
      } else {
        await engine.startCamera(voice.callChannel ?? voice.callWith);
        const stream = engine.getLocalStream();
        if (!stream?.getVideoTracks().length) {
          get().addToast({ variant: 'error', title: 'Camera Error', description: 'Could not access camera.' });
          return;
        }
        get().setVoiceCallState({ cameraOn: true, cameraStream: stream, localStream: stream });
        void client;
      }
    },

    toggleMute() {
      const { voice } = get();
      const newMuted = !voice.muted;
      voice.localStream?.getAudioTracks().forEach(t => { t.enabled = !newMuted; });
      get().setVoiceCallState({ muted: newMuted });
    },

    toggleDeafen() {
      const { voice } = get();
      const deafened = !voice.deafened;
      getMountedSuimyakuMediaEngine()?.setDeafened(deafened);
      get().setVoiceCallState({ deafened });
    },

    // ── DM Calling ────────────────────────────────────────────────────────────────
    startDmCall(nick, withVideo = false) {
      const { client } = get();
      if (!client) return;

      get().setVoiceCallState({ callState: 'ringing_out', callWith: nick, callChannel: null });

      void getMountedSuimyakuMediaEngine()?.startCall(nick, withVideo ? 'video' : 'voice');
      // OCEAN-UI: DM call affordances need an Orochi-backed room/channel flow;
      // do not emit legacy CTCP call messages.

      setTimeout(() => {
        if (get().voice.callState === 'ringing_out') {
          get().endDmCall();
        }
      }, 30_000);
    },

    acceptDmCall() {
      const { client, voice } = get();
      if (!client || voice.callState !== 'ringing_in') return;

      void client;
      void getMountedSuimyakuMediaEngine()?.acceptIncomingCall();
    },

    rejectDmCall() {
      const { client, voice } = get();
      void client;
      if (voice.callWith) getMountedSuimyakuMediaEngine()?.rejectCall(voice.callWith);
      get().setVoiceCallState({ callState: 'idle', callWith: '', callChannel: null });
    },

    endDmCall() {
      const { client, voice } = get();
      voice.localStream?.getTracks().forEach(t => t.stop());
      voice.cameraStream?.getTracks().forEach(t => t.stop());

      void client;
      if (voice.callWith) getMountedSuimyakuMediaEngine()?.hangup(voice.callWith);

      get().setVoiceCallState({
        callState: 'idle',
        callWith: '',
        callChannel: null,
        localStream: null,
        cameraOn: false,
        cameraStream: null,
        peers: new Map(),
      });
    },

    // ── Spatial Audio ─────────────────────────────────────────────────────────
    spatialPositions: new Map(),
    showSpatialPad: false,
    openSpatialPad:  () => set({ showSpatialPad: true }),
    closeSpatialPad: () => set({ showSpatialPad: false }),

    // ── Breakout Rooms ────────────────────────────────────────────────────────
    showBreakoutSidebar: false,
    openBreakoutSidebar:  () => set({ showBreakoutSidebar: true }),
    closeBreakoutSidebar: () => set({ showBreakoutSidebar: false }),

    // ── Streaming ─────────────────────────────────────────────────────────────
    streams: new Map(),
    raids: new Map(),
    streamPolls: new Map(),
    showGoLiveModal: false,
    goLiveChannel: null,

    openGoLiveModal: (channel) => set({ showGoLiveModal: true, goLiveChannel: channel }),
    closeGoLiveModal: () => set({ showGoLiveModal: false, goLiveChannel: null }),

    showServerStats: false,
    openServerStats: () => set({ showServerStats: true }),
    closeServerStats: () => set({ showServerStats: false }),

    startStream: (channel, title, category, mode, key, quality = '4k60') => {
      const { client, ourNick } = get();
      if (!client) return;
      const info: StreamInfo = {
        channel, streamer: ourNick, title, category, live: true,
        startedAt: Math.floor(Date.now() / 1000), viewers: 0, mode, quality,
      };
      set(s => ({ streams: new Map(s.streams).set(channel.toLowerCase(), info) }));
      // MEDIA targets the real channel and requires membership (orochi
      // src/daemon/server.zig:12473 isMember check). Join the actual channel if
      // we are not already in it — never a `%%`-prefixed phantom (CHANTYPES=#&,
      // and `%` is only a single UTF8-only modifier prefix, not `%%`).
      if (!get().channels.has(channel.toLowerCase())) {
        client.sendRaw('JOIN', channel);
      }
      const t = encodeURIComponent(title);
      const c = encodeURIComponent(category);
      void t; void c; void key;
      client.sendRaw('MEDIA', 'JOIN', channel, mode === 'screen' ? 'screen' : 'video');
      client.sendRaw('MEDIA', 'OFFER', channel, 'opvox,opvis', 'transport=webrtc');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ocean:stream-start', {
          detail: { channel, mode, quality },
        }));
      }
    },

    endStream: (channel) => {
      const { client } = get();
      if (!client) return;
      // Leave only the media call; the text channel membership is left intact
      // (the user may still want to read/chat). MEDIA LEAVE is the inverse of
      // MEDIA JOIN — no phantom `%%` channel to PART.
      client.sendRaw('MEDIA', 'LEAVE', channel);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ocean:stream-stop', {
          detail: { channel },
        }));
      }
      set(s => {
        const next = new Map(s.streams);
        next.delete(channel.toLowerCase());
        return { streams: next };
      });
    },

    raidChannel: (channel, target) => {
      const { client } = get();
      if (!client) return;
      const t = target.startsWith('#') ? target : `#${target}`;
      client.sendRaw('MEDIA', 'BREAKOUT', channel, t.replace(/^#/, ''));
    },

    createStreamPoll: (channel, question, options, durationSec = 60) => {
      const { client, ourNick } = get();
      if (!client) return;
      const poll: StreamPollInfo = {
        channel, question, options, votes: options.map(() => 0),
        myVote: null, createdBy: ourNick,
        endsAt: Date.now() + durationSec * 1000, active: true,
      };
      set(s => ({ streamPolls: new Map(s.streamPolls).set(channel.toLowerCase(), poll) }));
      void client;
      // OCEAN-UI: stream polls need a new Orochi-backed transport; no legacy CTCP.
    },

    voteStreamPoll: (channel, optionIndex) => {
      const { client } = get();
      if (!client) return;
      void client;
      // OCEAN-UI: stream poll votes need a new Orochi-backed transport; no legacy CTCP.
      set(s => {
        const key = channel.toLowerCase();
        const poll = s.streamPolls.get(key);
        if (!poll || poll.myVote !== null) return {};
        const votes = [...poll.votes];
        votes[optionIndex] = (votes[optionIndex] ?? 0) + 1;
        return { streamPolls: new Map(s.streamPolls).set(key, { ...poll, votes, myVote: optionIndex }) };
      });
    },
  }))
);

// ── OCEAN-INTEGRATION: window event bridge (UI intent → live server action) ──
// UI packages dispatch CustomEvents; the store owns the protocol side.
if (typeof window !== 'undefined') {
  window.addEventListener('ocean:channel-rename', (e: Event) => {
    const d = (e as CustomEvent<{ channel?: string; newName?: string; reason?: string }>).detail;
    if (d?.channel && d?.newName) {
      useOnyxStore.getState().renameChannel(d.channel, d.newName, d.reason);
    }
  });
  window.addEventListener('ocean:metadata-set', (e: Event) => {
    const d = (e as CustomEvent<{ key?: string; value?: string | null }>).detail;
    if (d?.key) {
      useOnyxStore.getState().setOwnMetadata(d.key, d.value ?? null);
    }
  });
}

// ── Selectors (Orochi integration) ───────────────────────────────────────────

/** Unread message count for a channel or DM target. */
export const selectUnreadCount = (target: string) => (s: OnyxState): number => {
  const key = target.toLowerCase();
  return s.channels.get(key)?.unread ?? s.dms.get(key)?.unread ?? 0;
};

/** First unread message id for the UnreadDivider / jump-pill, or null. */
export const selectFirstUnreadId = (target: string) => (s: OnyxState): string | null =>
  s.firstUnreadId.get(target.toLowerCase()) ?? null;

/** Server-side read marker (ISO timestamp) for a target, or null. */
export const selectReadMarker = (target: string) => (s: OnyxState): string | null =>
  s.readMarkers.get(target.toLowerCase()) ?? null;

/** Profile fields derived from METADATA (ocean.* namespaced keys). */
export const selectUserMetaProfile = (nick: string) => (s: OnyxState): {
  displayName?: string;
  pronouns?: string;
  bio?: string;
  accent?: string;
  links?: string[];
} | null => {
  const p = s.userProfiles.get(nick.toLowerCase());
  if (!p) return null;
  return {
    displayName: p.displayName,
    pronouns: p.pronouns,
    bio: p.bio,
    accent: p.accentColor,
    links: p.links,
  };
};

/** Raw METADATA key/value pairs for a nick. */
export const selectUserMetadata = (nick: string) => (s: OnyxState): Record<string, string> =>
  s.userMetadata.get(nick.toLowerCase()) ?? {};

/** Rolling caption transcript for a channel's live media session. */
export const selectMediaTranscript = (channel: string) => (s: OnyxState): Array<{ nick: string; text: string; time: Date }> =>
  s.mediaTranscripts.get(channel.toLowerCase()) ?? [];

/** Offline-message (TEGAMI) aggregate for a DM target, or null. */
export const selectTegami = (target: string) => (s: OnyxState): { count: number; firstMsgId: string } | null =>
  s.tegami.get(target.toLowerCase()) ?? null;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Decide whether a channel mode letter consumes an argument when applied,
 * derived from the server-advertised CHANMODES groups and the PREFIX (status)
 * modes — never a hardcoded guess.
 *
 * ISUPPORT CHANMODES = A,B,C,D (Orochi: `beIZ,k,lfj,imnstCTNMSgWOA`):
 *   A (list modes)       → always take an arg (+b / -b)
 *   B (always arg)       → take an arg when set AND unset
 *   C (arg only when set)→ take an arg only when adding
 *   D (flag, never arg)  → never
 * Status/prefix modes (Q/q/o/v) always take a nick argument.
 */
function modeConsumesArg(
  letter: string,
  adding: boolean,
  chanmodes: string[],
  prefixModes: Set<string>,
): boolean {
  if (prefixModes.has(letter)) return true;
  const [listModes = '', argModes = '', setOnlyModes = ''] = chanmodes;
  if (listModes.includes(letter)) return true;   // group A
  if (argModes.includes(letter)) return true;    // group B
  if (setOnlyModes.includes(letter)) return adding; // group C
  return false;                                  // group D (or unknown flag)
}

function parseNamePrefix(
  name: string,
  prefixToMode: Record<string, string>,
): { nick: string; modes: string[] } {
  const modes: string[] = [];
  let i = 0;
  while (i < name.length && prefixToMode[name[i]]) {
    modes.push(prefixToMode[name[i]]);
    i++;
  }
  // userhost-in-names sends nick!user@host — extract just the nick
  const nick = name.slice(i).split('!')[0];
  return { nick, modes };
}

function _addMessage(state: OnyxState, target: string, msg: ChatMessage): Partial<OnyxState> {
  const key = target.toLowerCase();
  const chanPfx = state.client?.isupport.CHANTYPES ?? '#&';
  const isChannel = target.length > 0 && chanPfx.includes(target[0]);
  if (isChannel) {
    return _addChannelMessage(state, key, msg, false);
  }
  return _addDMMessage(state, target, msg);
}

function _addChannelMessage(
  state: OnyxState,
  key: string,
  msg: ChatMessage,
  highlight: boolean,
  skipUnread = false,
): Partial<OnyxState> {
  // Drop messages from ignored users silently
  if (msg.from && state.ignoredUsers.has(msg.from.toLowerCase())) return {};
  const channels = new Map(state.channels);
  const c = channels.get(key);
  if (!c) return {};
  const isActive =
    state.activeView.kind === 'channel' &&
    state.activeView.channel.toLowerCase() === key;
  channels.set(key, {
    ...c,
    messages: [...(c.messages ?? []).slice(-499), msg],
    unread: (isActive || skipUnread) ? c.unread : c.unread + 1,
    highlights: isActive ? 0 : c.highlights + (highlight ? 1 : 0),
  });

  // Track first unread message id (only when not active and not skipUnread)
  if (!isActive && !skipUnread && !state.firstUnreadId.has(key)) {
    const firstUnreadId = new Map(state.firstUnreadId);
    firstUnreadId.set(key, msg.id);
    return { channels, firstUnreadId };
  }

  return { channels };
}

/**
 * Apply a server read-marker (MARKREAD timestamp) to a target: store the
 * marker and recompute unread count, highlights, and firstUnreadId from the
 * actual message list so the UnreadDivider / jump-pill / sidebar badges stay
 * cohesive with bouncer CHATHISTORY replay.
 */
function _applyReadMarker(state: OnyxState, key: string, iso: string): Partial<OnyxState> {
  const readMarkers = new Map(state.readMarkers);
  readMarkers.set(key, iso);
  const out: Partial<OnyxState> = { readMarkers };

  const markerMs = new Date(iso).getTime();
  if (Number.isNaN(markerMs)) return out;

  const ourLower = state.ourNick.toLowerCase();
  const countable = (m: ChatMessage): boolean =>
    (m.type === 'msg' || m.type === 'action' || m.type === 'notice' || m.type === 'whisper') &&
    m.from.toLowerCase() !== ourLower;
  const unreadAfter = (msgs: ChatMessage[]): ChatMessage[] =>
    msgs.filter(m => countable(m) && m.time.getTime() > markerMs);

  const isActive =
    (state.activeView.kind === 'channel' && state.activeView.channel.toLowerCase() === key) ||
    (state.activeView.kind === 'dm' && state.activeView.nick.toLowerCase() === key);

  const ch = state.channels.get(key);
  const dm = state.dms.get(key);
  const msgs = ch?.messages ?? dm?.messages ?? [];
  const unreadMsgs = unreadAfter(msgs);
  const unread = isActive ? 0 : unreadMsgs.length;

  if (ch) {
    const channels = new Map(state.channels);
    channels.set(key, { ...ch, unread, highlights: unread === 0 ? 0 : Math.min(ch.highlights, unread) });
    out.channels = channels;
    // Keep the channelUnread/channelMentions sidebar records in sync.
    const channelUnread = { ...state.channelUnread, [key]: unread };
    out.channelUnread = channelUnread;
    if (unread === 0) {
      const channelMentions = { ...state.channelMentions, [key]: 0 };
      out.channelMentions = channelMentions;
      out.totalUnreadMentions = Object.values(channelMentions).reduce((a, b) => a + b, 0);
    }
  } else if (dm) {
    const dms = new Map(state.dms);
    dms.set(key, { ...dm, unread, highlights: unread === 0 ? 0 : Math.min(dm.highlights, unread) });
    out.dms = dms;
  }

  // firstUnreadId follows the marker: first message strictly after it.
  const firstUnreadId = new Map(state.firstUnreadId);
  if (unread > 0 && !isActive) {
    firstUnreadId.set(key, unreadMsgs[0].id);
  } else {
    firstUnreadId.delete(key);
  }
  out.firstUnreadId = firstUnreadId;

  return out;
}

function _addDMMessage(
  state: OnyxState,
  sender: string,
  msg: ChatMessage,
  skipUnread = false,
): Partial<OnyxState> {
  const key = sender.toLowerCase();
  const dms = new Map(state.dms);
  const existing = dms.get(key) ?? {
    nick: sender,
    account: null,
    unread: 0,
    highlights: 0,
    messages: [],
  };
  const isActive =
    state.activeView.kind === 'dm' &&
    state.activeView.nick.toLowerCase() === key;

  // For DMs from ignored users: keep conversation visible but show placeholder
  const isOwnMessage = msg.from.toLowerCase() === state.ourNick.toLowerCase();
  const isIgnoredSender = !isOwnMessage && state.ignoredUsers.has(key);
  const isMuted = state.mutedDMs.has(key);
  const effectiveMsg: ChatMessage = isIgnoredSender
    ? { ...msg, text: 'Message from ignored user', type: 'system' }
    : msg;

  dms.set(key, {
    ...existing,
    messages: [...existing.messages.slice(-499), effectiveMsg],
    unread: isActive ? 0 : skipUnread ? existing.unread : (isIgnoredSender || isMuted) ? existing.unread : existing.unread + 1,
    highlights: isActive ? 0 : skipUnread ? existing.highlights : (isIgnoredSender || isMuted) ? existing.highlights : existing.highlights + 1,
  });

  // Track first unread DM message id (only when not active)
  if (!isActive && !skipUnread && !state.firstUnreadId.has(key)) {
    const firstUnreadId = new Map(state.firstUnreadId);
    firstUnreadId.set(key, msg.id);
    return { dms, firstUnreadId };
  }

  return { dms };
}

// ── Highlight words persistence ───────────────────────────────────────────────

function _loadHighlightWords(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('ocean-highlight-words');
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch { return []; }
}
function _saveHighlightWords(words: string[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem('ocean-highlight-words', JSON.stringify(words)); } catch {
    // Storage quota exceeded or unavailable — silently degrade
  }
}

// ── Custom status persistence ─────────────────────────────────────────────────

function _loadCustomStatus(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem('ocean-custom-status') ?? '';
  } catch {
    return '';
  }
}

function _loadCustomStatusExpiry(): Date | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('ocean-custom-status-expiry');
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

// ── Bookmark persistence ──────────────────────────────────────────────────────

const BOOKMARK_KEY = 'ocean-bookmarks';

function _loadBookmarks(): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<ChatMessage & { time: string }>;
    return parsed.map(b => ({ ...b, time: new Date(b.time) }));
  } catch {
    return [];
  }
}

function _saveBookmarks(bookmarks: ChatMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks));
  } catch {
    // Storage quota exceeded or unavailable — silently degrade
  }
}

// ── Ignore list persistence ───────────────────────────────────────────────────

const IGNORED_USERS_KEY = 'ocean-ignored-users';

function _loadIgnoredUsers(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(IGNORED_USERS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function _saveIgnoredUsers(ignoredUsers: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(IGNORED_USERS_KEY, JSON.stringify([...ignoredUsers]));
  } catch {
    // Storage quota exceeded or unavailable — silently degrade
  }
}

// ── Friends persistence ───────────────────────────────────────────────────────

type FriendEntry = { nick: string; online: boolean; note?: string };

function _loadFriends(): Map<string, FriendEntry> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem('ocean-friends');
    if (!raw) return new Map();
    const arr = JSON.parse(raw) as Array<{ nick: string; note?: string }>;
    return new Map(arr.map(f => [f.nick.toLowerCase(), { nick: f.nick, online: false, note: f.note }]));
  } catch {
    return new Map();
  }
}

function _saveFriends(friends: Map<string, FriendEntry>): void {
  if (typeof window === 'undefined') return;
  try {
    const arr = Array.from(friends.values()).map(f => ({ nick: f.nick, note: f.note }));
    localStorage.setItem('ocean-friends', JSON.stringify(arr));
  } catch {
    // Storage quota exceeded or unavailable — silently degrade
  }
}

// ── User notes persistence ────────────────────────────────────────────────────

function _loadUserNotes(): Map<string, string> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem('ocean-user-notes');
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(obj));
  } catch { return new Map(); }
}

function _saveUserNotes(notes: Map<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('ocean-user-notes', JSON.stringify(Object.fromEntries(notes)));
  } catch {
    // Storage quota exceeded or unavailable — silently degrade
  }
}

// ── Nick color overrides persistence ─────────────────────────────────────────

function _loadNickColorOverrides(): Map<string, string> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem('ocean-nick-colors');
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch { return new Map(); }
}

function _saveNickColorOverrides(overrides: Map<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('ocean-nick-colors', JSON.stringify(Object.fromEntries(overrides)));
  } catch {
    // Storage quota exceeded or unavailable — silently degrade
  }
}

// ── DM pin helpers ────────────────────────────────────────────────────────────

function _loadDMPins(): Map<string, ChatMessage[]> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem('ocean-dm-pins');
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, Array<ChatMessage & { time: string }>>;
    const map = new Map<string, ChatMessage[]>();
    for (const [key, msgs] of Object.entries(obj)) {
      map.set(key, msgs.map(m => ({ ...m, time: new Date(m.time) })));
    }
    return map;
  } catch { return new Map(); }
}

function _saveDMPins(pins: Map<string, ChatMessage[]>): void {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, ChatMessage[]> = {};
    pins.forEach((msgs, key) => { obj[key] = msgs; });
    localStorage.setItem('ocean-dm-pins', JSON.stringify(obj));
  } catch {}
}

// ── CTCP config helpers ───────────────────────────────────────────────────────

const CTCP_CONFIG_KEY = 'ocean-ctcp-config';
interface CTCPConfig { versionReply: string; timeEnabled: boolean; }

function _loadCTCPConfig(): CTCPConfig {
  if (typeof window === 'undefined') return { versionReply: 'Ocean IRC Client', timeEnabled: true };
  try {
    const raw = localStorage.getItem(CTCP_CONFIG_KEY);
    if (!raw) return { versionReply: 'Ocean IRC Client', timeEnabled: true };
    return JSON.parse(raw) as CTCPConfig;
  } catch { return { versionReply: 'Ocean IRC Client', timeEnabled: true }; }
}
function _saveCTCPConfig(cfg: CTCPConfig): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(CTCP_CONFIG_KEY, JSON.stringify(cfg)); } catch {}
}

// ── Time format persistence ────────────────────────────────────────────────────

function _loadTimeFormat(): '12h' | '24h' | 'hidden' {
  if (typeof window === 'undefined') return '24h';
  try {
    const raw = localStorage.getItem('ocean-time-format');
    if (raw === '12h' || raw === '24h' || raw === 'hidden') return raw;
  } catch {}
  return '24h';
}

// ── Theme persistence ─────────────────────────────────────────────────────────

function _loadActiveTheme(): string {
  if (typeof window === 'undefined') return 'lacquer';
  try {
    const validThemes = [
      'ocean',
      'abyss',
      'midnight',
      'bathyal',
      'coral',
      'kelp',
      'brine',
      'onyx',
      'amoled',
      'arctic',
      'ash',
      'light',
      'lacquer',
      'pearl',
      'system',
    ];
    const stored = localStorage.getItem('ocean-active-theme');
    const legacy = localStorage.getItem('ocean-theme');
    // v3 migration: 'lacquer' is the new flagship default. Move users who are
    // still on the old auto-default ('ocean', the value that REMOVED data-theme
    // and fell back to the plain :root base) — or who have no stored preference
    // at all — onto 'lacquer'. Any explicit non-ocean choice is preserved.
    const v3done = localStorage.getItem('ocean-theme-v3') === '1';
    if (!v3done) {
      const effective = (stored && validThemes.includes(stored))
        ? stored
        : (legacy && validThemes.includes(legacy) ? legacy : null);
      localStorage.setItem('ocean-theme-v3', '1');
      if (effective === null || effective === 'ocean') {
        localStorage.setItem('ocean-active-theme', 'lacquer');
        return 'lacquer';
      }
      // Explicit choice — persist it forward and keep it.
      localStorage.setItem('ocean-active-theme', effective);
      return effective;
    }
    if (stored && validThemes.includes(stored)) return stored;
    return legacy && validThemes.includes(legacy) ? legacy : 'lacquer';
  } catch { return 'lacquer'; }
}

// ── Font size persistence ──────────────────────────────────────────────────────

function _loadMessageFontSize(): number {
  if (typeof window === 'undefined') return 14;
  try {
    const raw = localStorage.getItem('ocean-message-font-size') ?? localStorage.getItem('ocean-font-size') ?? '14';
    const v = parseInt(raw, 10);
    return isNaN(v) ? 14 : Math.max(12, Math.min(20, v));
  } catch { return 14; }
}

// ── Accent color persistence ───────────────────────────────────────────────────

function _loadAccentColor(): string {
  if (typeof window === 'undefined') return '#0ea5e9';
  try {
    const stored = localStorage.getItem('ocean-accent-color');
    // Migrate old violet default → sky blue
    if (!stored || stored === '#7c5af5') {
      localStorage.setItem('ocean-accent-color', '#0ea5e9');
      return '#0ea5e9';
    }
    return stored;
  }
  catch { return '#0ea5e9'; }
}

export function _applyAccentColor(hex: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-hover', hex);
  root.style.setProperty('--accent-active', hex);
  root.style.setProperty('--accent-border', hex + '66');
  root.style.setProperty('--accent-subtle', hex + '1a');
  root.style.setProperty('--accent-glow', hex + '2e');
}

// ── Reduced motion persistence ─────────────────────────────────────────────────

function _loadReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored = localStorage.getItem('ocean-reduced-motion');
    if (stored !== null) return stored === '1';
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { return false; }
}

function _loadChatBackground(): OnyxState['chatBackground'] {
  if (typeof window === 'undefined') return 'solid';
  try {
    const stored = localStorage.getItem('ocean-chat-background');
    if (stored === 'dots' || stored === 'grid' || stored === 'noise' || stored === 'diagonal') return stored;
  } catch {}
  return 'solid';
}

function _loadRecentEmojis(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('ocean-recent-emoji');
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

function _loadEmojiUsage(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('ocean-emoji-usage');
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch { return {}; }
}

function _loadMutedDMs(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem('ocean-muted-dms');
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function _saveMutedDMs(muted: Set<string>): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem('ocean-muted-dms', JSON.stringify([...muted])); } catch {}
}

function _loadFavoriteEmojis(): string[] {
  if (typeof window === 'undefined') return ['👍','❤️','😂','😮','😢','🙏'];
  try {
    const raw = localStorage.getItem('ocean-fav-emojis');
    return raw ? JSON.parse(raw) as string[] : ['👍','❤️','😂','😮','😢','🙏'];
  } catch { return ['👍','❤️','😂','😮','😢','🙏']; }
}

function _saveFavoriteEmojis(emojis: string[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem('ocean-fav-emojis', JSON.stringify(emojis)); } catch {}
}

// ── Topic history persistence ─────────────────────────────────────────────────

function _loadTopicHistory(): Record<string, string[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('ocean-topic-history');
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch { return {}; }
}

// ── Channel folders persistence ───────────────────────────────────────────────

const FOLDERS_KEY = 'ocean-channel-folders';

function _loadChannelFolders(): ChannelFolder[] {
  const DEFAULT: ChannelFolder[] = [{ id: 'default', name: 'TEXT CHANNELS', channels: [], collapsed: false }];
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    return raw ? (JSON.parse(raw) as ChannelFolder[]) : DEFAULT;
  } catch { return DEFAULT; }
}

function _saveChannelFolders(folders: ChannelFolder[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); } catch {}
}

// ── UI font persistence ────────────────────────────────────────────────────────
function _loadUiFont(): string { return typeof window !== 'undefined' ? (localStorage.getItem('ocean-ui-font') ?? 'system-ui') : 'system-ui'; }

// ── Bubble mode persistence ───────────────────────────────────────────────────
function _loadBubbleMode(): boolean { return typeof window !== 'undefined' && localStorage.getItem('ocean-bubble-mode') === '1'; }

// ── Custom CSS persistence ────────────────────────────────────────────────────
function _loadCustomCss(): string { return typeof window !== 'undefined' ? (localStorage.getItem('ocean-custom-css') ?? '') : ''; }

// ── Sidebar width persistence ─────────────────────────────────────────────────
function _loadSidebarWidth(): number { const v = typeof window !== 'undefined' ? parseInt(localStorage.getItem('ocean-sidebar-width') ?? '240') : 240; return isNaN(v) ? 240 : Math.max(180, Math.min(320, v)); }

// ── Message max width persistence ─────────────────────────────────────────────
function _loadMessageMaxWidth(): 680 | 860 | 0 { const v = typeof window !== 'undefined' ? localStorage.getItem('ocean-msg-maxw') : null; if (v === '680') return 680; if (v === '860') return 860; return 0; }

// ── Glass sidebar persistence ──────────────────────────────────────────────────
function _loadGlassSidebar(): boolean { return typeof window !== 'undefined' && localStorage.getItem('ocean-glass-sidebar') === '1'; }

// ── Nick aliases persistence ──────────────────────────────────────────────────
function _loadNickAliases(): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem('ocean-nick-aliases') ?? '[]') as string[]; } catch { return []; }
}
function _saveNickAliases(aliases: string[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem('ocean-nick-aliases', JSON.stringify(aliases)); } catch {}
}

// ── Watch list persistence ────────────────────────────────────────────────────
function _loadWatchList(): Array<{ nick: string; online: boolean; lastSeen?: Date }> {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem('ocean-watch-list') ?? '[]') as Array<{ nick: string; online: boolean; lastSeen?: string }>;
    return raw.map(w => ({ ...w, online: false, lastSeen: w.lastSeen ? new Date(w.lastSeen) : undefined }));
  } catch { return []; }
}
function _saveWatchList(list: Array<{ nick: string; online: boolean }>): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem('ocean-watch-list', JSON.stringify(list.map(w => ({ nick: w.nick, online: false })))); } catch {}
}

// ── High contrast mode persistence ───────────────────────────────────────────
function _loadHighContrast(): boolean { return typeof window !== 'undefined' && localStorage.getItem('ocean-high-contrast') === '1'; }

function _loadForumChannels(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const saved = localStorage.getItem('ocean-forum-channels');
    return new Set(JSON.parse(saved ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

// ── Soft ignore persistence ───────────────────────────────────────────────────
function _loadSoftIgnoreList(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem('ocean-soft-ignore');
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}
function _saveSoftIgnoreList(list: Set<string>): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem('ocean-soft-ignore', JSON.stringify([...list])); } catch {}
}

// ── Display name override persistence ────────────────────────────────────────
function _loadDisplayNameOverrides(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem('ocean-display-names') ?? '{}'); } catch { return {}; }
}
function _saveDisplayNameOverrides(overrides: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem('ocean-display-names', JSON.stringify(overrides)); } catch {}
}
function _loadSelfDisplayName(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('ocean-self-display-name') ?? '';
}

// ── Generic boolean pref loader ───────────────────────────────────────────────
function _loadBoolPref(key: string): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(key) === '1';
}

// ── Display theme persistence ─────────────────────────────────────────────────
function _loadDisplayTheme(): OnyxState['theme'] {
  if (typeof window === 'undefined') return 'lacquer';
  const stored = localStorage.getItem('ocean-display-theme') ?? localStorage.getItem('ocean-theme');
  const valid = (t: string | null): t is OnyxState['theme'] =>
    t === 'lacquer' || t === 'midnight' || t === 'onyx' || t === 'ash' ||
    t === 'amoled' || t === 'light' || t === 'system';
  // v2 migration: 'onyx' was the old default — migrate to 'midnight' unless
  // the user explicitly re-selected it after the migration flag was written.
  if (stored === 'onyx' && !localStorage.getItem('ocean-theme-v2')) {
    localStorage.setItem('ocean-display-theme', 'midnight');
    localStorage.setItem('ocean-theme-v2', '1');
  }
  // v3 migration: 'lacquer' is the new flagship default. Mirror the active-theme
  // migration so the two loaders agree even though either may run first and set
  // the shared 'ocean-theme-v3' flag. Users still on the old auto-default display
  // theme ('midnight', the value v2 wrote) — or with no stored preference — move
  // to 'lacquer'. An explicit choice is identified by ocean-active-theme being a
  // non-ocean named theme; we never overwrite that. This is idempotent: once the
  // display value is 'lacquer' or any explicit theme, it stays put.
  const active = localStorage.getItem('ocean-active-theme');
  const cur = localStorage.getItem('ocean-display-theme') ?? stored;
  const explicit = active != null && active !== 'ocean' && active !== 'system' && active !== 'lacquer';
  const isAutoDefault = cur == null || cur === 'midnight';
  if (!explicit && isAutoDefault) {
    localStorage.setItem('ocean-display-theme', 'lacquer');
    localStorage.setItem('ocean-theme-v3', '1');
    return 'lacquer';
  }
  localStorage.setItem('ocean-theme-v3', '1');
  const final = localStorage.getItem('ocean-display-theme') ?? stored;
  if (valid(final)) return final;
  return 'lacquer';
}

// ── Display font size persistence ─────────────────────────────────────────────
function _loadDisplayFontSize(): number {
  if (typeof window === 'undefined') return 16;
  const raw = localStorage.getItem('ocean-ui-font-size') ?? localStorage.getItem('ocean-font-size');
  if (!raw) return 16;
  const v = parseInt(raw, 10);
  if (v === 12 || v === 14 || v === 16 || v === 18 || v === 20) return v;
  return 16;
}

// ── Channel order persistence ─────────────────────────────────────────────────
function _loadChannelOrder(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('ocean-channel-order');
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

// ── NSFW channels persistence ─────────────────────────────────────────────────
function _loadNsfwChannels(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem('ocean-nsfw-channels');
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function _saveNsfwChannels(channels: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('ocean-nsfw-channels', JSON.stringify([...channels]));
  } catch {
    // ignore quota errors
  }
}
