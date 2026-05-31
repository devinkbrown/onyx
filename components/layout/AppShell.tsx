'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useOnyxStore } from '@/lib/store';
import { useSwipe } from '@/hooks/useSwipe';
import ImageLightbox from '@/components/ui/ImageLightbox';
import MobileBottomNav from './MobileBottomNav';
import ServerBar from './ServerBar';
import ServerStatsWidget from '../ui/ServerStatsWidget';
import ChannelSidebar from './ChannelSidebar';
import ChatArea from '../chat/ChatArea';
import MemberList from './MemberList';
import VoiceBar from '../voice/VoiceBar';
import StageView from '../voice/StageView';
import ScreensharePreview from '../voice/ScreensharePreview';
import SettingsModal from '../modals/SettingsModal';
import ServerSettingsModal from '../modals/ServerSettingsModal';
import ChannelInfoModal from '../modals/ChannelInfoModal';
import AccessListModal from '../modals/AccessListModal';
import PinnedMessagesModal from '../modals/PinnedMessagesModal';
import ThreadPanel from '../modals/ThreadPanel';
import ForwardMessageModal from '../modals/ForwardMessageModal';
import BookmarksPanel from '../modals/BookmarksPanel';
import UserProfileModal from '../modals/UserProfileModal';
import UserSettingsBar from './UserSettingsBar';
import CustomStatusModal from '../ui/CustomStatusModal';
import ToastContainer from '../ui/Toast';
import SearchOverlay from '../ui/SearchOverlay';
import SpotlightSearch from '../ui/SpotlightSearch';
import KeyboardShortcutsModal from '../modals/KeyboardShortcutsModal';
import ChannelBrowserModal from '../modals/ChannelBrowserModal';
import OnboardingModal from '../modals/OnboardingModal';
import MotdModal from '../modals/MotdModal';
import ChannelJoinModal from '../modals/ChannelJoinModal';
import MediaGalleryPanel from '../modals/MediaGalleryPanel';
import ServicesPanel from '../modals/ServicesPanel';
import ConnectionBanner from '../ui/ConnectionBanner';
import RawLogPanel from '../ui/RawLogPanel';
import WhoisPanel from '../modals/WhoisPanel';
import NotificationCenter from '../ui/NotificationCenter';
import FriendsPanel from '../ui/FriendsPanel';
import UserProfileCard from '../ui/UserProfileCard';
import ThemeModal from '../modals/ThemeModal';
import IgnoreListModal from '../modals/IgnoreListModal';
import MessageSearchModal from '../chat/MessageSearchModal';
import AwayModal from '../modals/AwayModal';
import IRCOperatorPanel from '../modals/IRCOperatorPanel';
import ScheduledMessagesModal from '../modals/ScheduledMessagesModal';
import SoundSettingsModal from '../modals/SoundSettingsModal';
import GroupDMModal from '../modals/GroupDMModal';
import CustomEmojiModal from '../modals/CustomEmojiModal';
import ModerationPanel from '../modals/ModerationPanel';
import HighlightWordsModal from '../modals/HighlightWordsModal';
import InviteModal from '../modals/InviteModal';
import DNDModal from '../modals/DNDModal';
import ChatExportModal from '../modals/ChatExportModal';
import AnnouncementsPanel from '../ui/AnnouncementsPanel';
import DMPinsPanel from '../modals/DMPinsPanel';
import DMMediaPanel from '../modals/DMMediaPanel';
import ConnectionProfilesModal from '../modals/ConnectionProfilesModal';
import ServerInfoPanel from '../modals/ServerInfoPanel';
import ServerRulesModal from '../modals/ServerRulesModal';
import EventLogPanel from '../modals/EventLogPanel';
import PollCreateModal from '../modals/PollCreateModal';
import ReactionStatsPanel from '../ui/ReactionStatsPanel';
import ForumCreateModal from '../modals/ForumCreateModal';
import { SpatialPad } from '../voice/SpatialPad';
import { BreakoutSidebar } from './BreakoutSidebar';
import IncomingCallOverlay from '../voice/IncomingCallOverlay';
import OutgoingCallOverlay from '../voice/OutgoingCallOverlay';
import dynamic from 'next/dynamic';
import { useLadonMedia } from '@/hooks/useLadonMedia';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useNotifications } from '@/hooks/useNotifications';
import { useAppearance } from '@/hooks/useAppearance';
import { usePresence } from '@/hooks/usePresence';
import { useScheduledMessageTimer } from '@/hooks/useScheduledMessageTimer';
import { useAudioNotifications } from '@/hooks/useAudioNotifications';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useIdleDetector } from '@/hooks/useIdleDetector';
import { useCustomStatusExpiry } from '@/hooks/useCustomStatusExpiry';

// ── Whiteboard (dynamic — canvas only runs client-side) ───────────────────────
const Whiteboard = dynamic(
  () => import('../whiteboard/Whiteboard').then(m => m.Whiteboard).catch(() => () => null),
  { ssr: false, loading: () => null },
);

// ── Go Live modal (dynamic — client-side only) ─────────────────────────────────
const GoLiveModal = dynamic(
  () => import('@/components/stream/GoLiveModal').then(m => ({ default: m.GoLiveModal })).catch(() => ({ default: () => null })),
  { ssr: false, loading: () => null },
);

// ── Lightbox host ──────────────────────────────────────────────────────────────

function LightboxHost() {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const { src } = (e as CustomEvent<{ src: string; alt: string }>).detail;
      setLightboxSrc(src);
    };
    window.addEventListener('ocean:lightbox', handler);
    return () => window.removeEventListener('ocean:lightbox', handler);
  }, []);

  if (!lightboxSrc) return null;
  return <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />;
}

// ── Shell ──────────────────────────────────────────────────────────────────────

interface Props {
  children: React.ReactNode;
}

export default function AppShell({ children }: Props) {
  const activeView          = useOnyxStore(s => s.activeView);
  const showMemberList      = useOnyxStore(s => s.showMemberList);
  const showSettings        = useOnyxStore(s => s.showSettings);
  const showChannelInfo     = useOnyxStore(s => s.showChannelInfo);
  const showAccessList      = useOnyxStore(s => s.showAccessList);
  const showPinnedMessages  = useOnyxStore(s => s.showPinnedMessages);
  const showUserProfile     = useOnyxStore(s => s.showUserProfile);
  const showServerSettings  = useOnyxStore(s => s.showServerSettings);
  const showThreadPanel     = useOnyxStore(s => s.showThreadPanel);
  const forwardingMessage   = useOnyxStore(s => s.forwardingMessage);
  const showBookmarks       = useOnyxStore(s => s.showBookmarks);
  const showSearchOverlay   = useOnyxStore(s => s.showSearchOverlay);
  const showCustomStatus        = useOnyxStore(s => s.showCustomStatus);
  const showKeyboardShortcuts   = useOnyxStore(s => s.showKeyboardShortcuts);
  const showOnboarding          = useOnyxStore(s => s.showOnboarding);
  const showChannelBrowser      = useOnyxStore(s => s.showChannelBrowser);
  const showRawLog              = useOnyxStore(s => s.showRawLog);
  const showMediaGallery        = useOnyxStore(s => s.showMediaGallery);
  const showServices            = useOnyxStore(s => s.showServices);
  const showMotd                = useOnyxStore(s => s.showMotd);
  const showWhois               = useOnyxStore(s => s.showWhois);
  const showNotificationCenter  = useOnyxStore(s => s.showNotificationCenter);
  const closeNotificationCenter = useOnyxStore(s => s.closeNotificationCenter);
  const showFriendsPanel        = useOnyxStore(s => s.showFriendsPanel);
  const channelJoinPrompt       = useOnyxStore(s => s.channelJoinPrompt);
  const showSpotlight           = useOnyxStore(s => s.showSpotlight);
  const toggleSpotlight         = useOnyxStore(s => s.toggleSpotlight);
  const closeSpotlight          = useOnyxStore(s => s.closeSpotlight);
  const showThemeModal          = useOnyxStore(s => s.showThemeModal);
  const showAwayModal           = useOnyxStore(s => s.showAwayModal);
  const showOperPanel           = useOnyxStore(s => s.showOperPanel);
  const showScheduledMessages   = useOnyxStore(s => s.showScheduledMessages);
  const showIgnoreList          = useOnyxStore(s => s.showIgnoreList);
  const showMessageSearch       = useOnyxStore(s => s.showMessageSearch);
  const showSoundSettings       = useOnyxStore(s => s.showSoundSettings);
  const showGroupDM             = useOnyxStore(s => s.showGroupDM);
  const showCustomEmojiModal    = useOnyxStore(s => s.showCustomEmojiModal);
  const showModerationPanel     = useOnyxStore(s => s.showModerationPanel);
  const showHighlightModal      = useOnyxStore(s => s.showHighlightModal);
  const showInviteModal         = useOnyxStore(s => s.showInviteModal);
  const showDndModal            = useOnyxStore(s => s.showDndModal);
  const showAnnouncementsPanel  = useOnyxStore(s => s.showAnnouncementsPanel);
  const showExportModal              = useOnyxStore(s => s.showExportModal);
  const showConnectionProfiles      = useOnyxStore(s => s.showConnectionProfiles);
  const showDMPins                  = useOnyxStore(s => s.showDMPins);
  const showDMMedia                 = useOnyxStore(s => s.showDMMedia);
  const closeDMMedia                = useOnyxStore(s => s.closeDMMedia);
  const showServerInfo              = useOnyxStore(s => s.showServerInfo);
  const showServerRulesModal        = useOnyxStore(s => s.showServerRulesModal);
  const showPollCreate              = useOnyxStore(s => s.showPollCreate);
  const showReactionStats           = useOnyxStore(s => s.showReactionStats);
  const showEventLog                = useOnyxStore(s => s.showEventLog);
  const showForumCreate             = useOnyxStore(s => s.showForumCreate);
  const showSpatialPad              = useOnyxStore(s => s.showSpatialPad);
  const closeSpatialPad             = useOnyxStore(s => s.closeSpatialPad);
  const showBreakoutSidebar         = useOnyxStore(s => s.showBreakoutSidebar);
  const closeBreakoutSidebar        = useOnyxStore(s => s.closeBreakoutSidebar);
  const stageChannel         = useOnyxStore(s => s.stageChannel);
  const profileNick          = useOnyxStore(s => s.profileNick);
  const profileAnchor        = useOnyxStore(s => s.profileAnchor);
  const voice                = useOnyxStore(s => s.voice);
  const voiceCallState       = useOnyxStore(s => s.voice.callState);
  const mobileSidebarOpen    = useOnyxStore(s => s.mobileSidebarOpen);
  const openMobileSidebar    = useOnyxStore(s => s.openMobileSidebar);
  const closeMobileSidebar   = useOnyxStore(s => s.closeMobileSidebar);
  const messageDensity       = useOnyxStore(s => s.messageDensity);
  const focusMode            = useOnyxStore(s => s.focusMode);
  const mobilePanel          = useOnyxStore(s => s.mobilePanel);
  const setMobilePanel       = useOnyxStore(s => s.setMobilePanel);
  const openSettings         = useOnyxStore(s => s.openSettings);
  const sidebarWidth         = useOnyxStore(s => s.sidebarWidth);
  const setSidebarWidth      = useOnyxStore(s => s.setSidebarWidth);
  const compactSidebar       = useOnyxStore(s => s.compactSidebar);
  const showWhiteboard       = useOnyxStore(s => s.showWhiteboard);
  const closeWhiteboard      = useOnyxStore(s => s.closeWhiteboard);
  const showGoLiveModal      = useOnyxStore(s => s.showGoLiveModal);
  const goLiveChannel        = useOnyxStore(s => s.goLiveChannel);
  const closeGoLiveModal     = useOnyxStore(s => s.closeGoLiveModal);
  const showServerStats      = useOnyxStore(s => s.showServerStats);
  const closeServerStats     = useOnyxStore(s => s.closeServerStats);

  const mainRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);

  // ── Swipe-right-to-open-sidebar (mobile) ──────────────────────────────────
  const swipeTouchStartX = useRef(0);
  const swipeTouchStartY = useRef(0);
  const swipeIsTracking = useRef(false);

  const onSwipeTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    swipeTouchStartX.current = touch.clientX;
    swipeTouchStartY.current = touch.clientY;
    // Only initiate swipe tracking if the touch starts within 30px of the left edge
    swipeIsTracking.current = touch.clientX <= 30;
  }, []);

  const onSwipeTouchMove = useCallback(() => {
    // tracking state only — no action mid-move needed
  }, []);

  const onSwipeTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!swipeIsTracking.current) return;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - swipeTouchStartX.current;
    const deltaY = Math.abs(touch.clientY - swipeTouchStartY.current);
    swipeIsTracking.current = false;
    // Must be predominantly horizontal and at least 50px rightward
    if (deltaX >= 50 && deltaY < 80) {
      openMobileSidebar();
    }
  }, [openMobileSidebar]);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  const onResizeKeyDown = useCallback((e: React.KeyboardEvent) => {
    const STEP = 8;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSidebarWidth(sidebarWidth + STEP);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSidebarWidth(sidebarWidth - STEP);
    }
  }, [sidebarWidth, setSidebarWidth]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = e.clientX - dragStartXRef.current;
      setSidebarWidth(dragStartWidthRef.current + delta);
    };
    const onMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [setSidebarWidth]);
  // Swipe gestures for mobile panel navigation
  useSwipe(mainRef, {
    onSwipeRight: () => setMobilePanel('channels'),
    onSwipeLeft:  () => setMobilePanel('members'),
  });

  // Open settings modal when settings tab selected on mobile, then reset
  useEffect(() => {
    if (mobilePanel === 'settings') {
      openSettings();
      setMobilePanel('chat');
    }
  }, [mobilePanel, openSettings, setMobilePanel]);

  // Wire LADON media engine
  useLadonMedia();
  // Global keyboard shortcuts
  useKeyboardShortcuts();
  // Document title + browser notifications
  useNotifications();
  // Apply persisted appearance settings (font size, density, motion)
  useAppearance();
  // Media session presence detection
  usePresence();
  // Scheduled message delivery timer
  useScheduledMessageTimer();
  // Audio notifications
  useAudioNotifications();
  // OS push notifications for mentions and DMs
  usePushNotifications();
  // Idle auto-away
  useIdleDetector();
  // Custom status expiry auto-clear
  useCustomStatusExpiry();

  // ── Service worker registration ──────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  // ── PWA install prompt ───────────────────────────────────────────────────
  const [installPrompt, setInstallPrompt] = useState<{ prompt(): Promise<void> } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as unknown as { prompt(): Promise<void> });
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallApp = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  }, [installPrompt]);

  // Spotlight global keyboard shortcut + mobile sidebar Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleSpotlight();
      } else if (e.key === 'Escape') {
        if (showSpotlight) {
          closeSpotlight();
        } else if (mobileSidebarOpen || mobilePanel === 'channels') {
          closeMobileSidebar();
          setMobilePanel('chat');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showSpotlight, toggleSpotlight, closeSpotlight, mobileSidebarOpen, mobilePanel, closeMobileSidebar, setMobilePanel]);

  const isInChannel = activeView.kind === 'channel';
  const showRight   = isInChannel && showMemberList && !focusMode;

  return (
    <div className={`app-shell density-${messageDensity}${focusMode ? ' focus-mode' : ''}`}>

      {/* Skip to main content — visually hidden, revealed on focus */}
      <a href="#main-content" className="skip-link">Skip to messages</a>

      {/* Focus mode badge — fades out after 3s */}
      {focusMode && (
        <div className="focus-mode-badge" key={String(focusMode)} aria-live="polite">
          Focus Mode — Ctrl+Shift+F to exit
        </div>
      )}

      {/* Mobile sidebar overlay */}
      {(mobileSidebarOpen || mobilePanel === 'channels') && (
        <div
          className="mobile-overlay"
          onClick={() => { closeMobileSidebar(); setMobilePanel('chat'); }}
          aria-hidden
        />
      )}

      {/* Leftmost server icons */}
      <ServerBar />

      {/* Channel / DM sidebar */}
      <div
        className={`app-sidebar${compactSidebar ? ' app-sidebar--compact' : ''} ${(mobileSidebarOpen || mobilePanel === 'channels') ? 'app-sidebar--open' : ''}`}
        style={{ width: compactSidebar ? 52 : sidebarWidth }}
      >
        <ChannelSidebar
          onNavigate={() => { closeMobileSidebar(); setMobilePanel('chat'); }}
          onMobileClose={() => { closeMobileSidebar(); setMobilePanel('chat'); }}
        />
        {installPrompt && (
          <button
            className="pwa-install-btn"
            onClick={handleInstallApp}
            title="Install Ocean as an app"
            aria-label="Install Ocean as an app"
          >
            <span className="pwa-install-icon" aria-hidden>⬇</span>
            Install App
          </button>
        )}
        <UserSettingsBar />
        {/* Drag handle — right edge of sidebar */}
        <div
          className="sidebar-resize-handle"
          onMouseDown={onResizeMouseDown}
          onKeyDown={onResizeKeyDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={sidebarWidth}
          aria-valuemin={180}
          aria-valuemax={320}
          tabIndex={0}
        />
      </div>

      {/* Main content area */}
      <div
        className="app-main"
        id="main-content"
        ref={mainRef}
        onTouchStart={onSwipeTouchStart}
        onTouchMove={onSwipeTouchMove}
        onTouchEnd={onSwipeTouchEnd}
      >
        {/* Mobile top bar */}
        <div className="mobile-topbar">
          <button
            className="mobile-menu-btn"
            onClick={openMobileSidebar}
            aria-label="Open menu"
          >
            <HamburgerIcon />
          </button>
          <span className="mobile-title">
            {activeView.kind === 'channel' ? activeView.channel :
             activeView.kind === 'dm' ? activeView.nick : 'Ocean'}
          </span>
        </div>

        {/* Connection status banner */}
        <ConnectionBanner />

        {/* Voice bar (shows when in a call) */}
        {voice.callState !== 'idle' && <VoiceBar />}

        {/* Spatial audio pad (floating panel, channel-only) */}
        {showSpatialPad && isInChannel && (
          <div className="app-spatial-pad-host">
            <SpatialPad channel={activeView.kind === 'channel' ? activeView.channel : ''} onClose={closeSpatialPad} />
          </div>
        )}

        {/* Chat or home */}
        {activeView.kind === 'home'
          ? children
          : <ChatArea />
        }
      </div>

      {/* Right member list — desktop: shown normally; mobile: shown when mobilePanel === 'members' */}
      {(showRight || mobilePanel === 'members') && (
        <div className={`app-member-list animate-slide-right${mobilePanel === 'members' ? ' app-member-list--mobile-open' : ''}`}>
          <MemberList />
        </div>
      )}

      {/* Breakout rooms sidebar (right edge, channel-only) */}
      {showBreakoutSidebar && isInChannel && (
        <BreakoutSidebar
          channel={activeView.kind === 'channel' ? activeView.channel : ''}
          onClose={closeBreakoutSidebar}
        />
      )}

      {/* Event log panel */}
      {showEventLog && <EventLogPanel />}

      {/* Settings modal */}
      {showSettings && <SettingsModal />}

      {/* Server settings modal */}
      {showServerSettings && <ServerSettingsModal />}

      {/* Channel info panel */}
      {showChannelInfo && <ChannelInfoModal />}

      {/* Access list panel */}
      {showAccessList && <AccessListModal />}

      {/* Pinned messages panel */}
      {showPinnedMessages && <PinnedMessagesModal />}

      {/* Thread panel */}
      {showThreadPanel && <ThreadPanel />}

      {/* Bookmarks panel */}
      {showBookmarks && <BookmarksPanel />}

      {/* Forward message modal */}
      {forwardingMessage && <ForwardMessageModal />}

      {/* User profile modal */}
      {showUserProfile && <UserProfileModal />}

      {/* Custom status modal */}
      {showCustomStatus && <CustomStatusModal />}

      {/* Global search overlay */}
      {showSearchOverlay && <SearchOverlay />}

      {/* Spotlight search (Cmd/Ctrl+K) */}
      {showSpotlight && <SpotlightSearch />}

      {/* Keyboard shortcuts cheatsheet */}
      {showKeyboardShortcuts && <KeyboardShortcutsModal />}

      {/* Onboarding welcome flow */}
      {showOnboarding && <OnboardingModal />}

      {/* MOTD modal */}
      {showMotd && <MotdModal />}

      {/* Channel join / password prompt */}
      {channelJoinPrompt && <ChannelJoinModal />}

      {/* Channel browser */}
      {showChannelBrowser && <ChannelBrowserModal />}

      {/* Screenshare floating preview */}
      {voice.screenshareActive && <ScreensharePreview />}

      {/* Media gallery panel */}
      {showMediaGallery && <MediaGalleryPanel />}

      {/* Services panel (NickServ / ChanServ) */}
      {showServices && <ServicesPanel />}

      {/* Raw IRC log panel */}
      {showRawLog && <RawLogPanel />}

      {/* WHOIS panel */}
      {showWhois && <WhoisPanel />}

      {/* Friends / Contacts panel */}
      {showFriendsPanel && <FriendsPanel />}

      {/* Notification center */}
      {showNotificationCenter && <NotificationCenter onClose={closeNotificationCenter} />}

      {/* Theme / appearance modal */}
      {showThemeModal && <ThemeModal />}

      {/* Toast notifications */}
      <ToastContainer />

      {/* Floating user profile card (anchored to click position) */}
      {profileNick && profileAnchor && (
        <UserProfileCard nick={profileNick} anchor={profileAnchor} />
      )}

      {/* Away status modal */}
      {showAwayModal && <AwayModal />}

      {/* IRC Operator panel */}
      {showOperPanel && <IRCOperatorPanel />}

      {/* Scheduled messages modal */}
      {showScheduledMessages && <ScheduledMessagesModal />}

      {/* Ignore list modal */}
      {showIgnoreList && <IgnoreListModal />}

      {/* In-channel message search panel */}
      {showMessageSearch && <MessageSearchModal />}

      {/* Sound settings modal */}
      {showSoundSettings && <SoundSettingsModal />}

      {/* Group DM modal */}
      {showGroupDM && <GroupDMModal />}

      {/* Custom emoji modal */}
      {showCustomEmojiModal && <CustomEmojiModal />}

      {/* Channel moderation panel */}
      {showModerationPanel && <ModerationPanel />}

      {/* Highlight words modal */}
      {showHighlightModal && <HighlightWordsModal />}

      {/* Invite modal */}
      {showInviteModal && <InviteModal />}

      {/* Do Not Disturb settings modal */}
      {showDndModal && <DNDModal />}

      {/* Server announcements panel — slides from top */}
      {showAnnouncementsPanel && <AnnouncementsPanel />}

      {/* Chat export modal */}
      {showExportModal && <ChatExportModal />}

      {/* Connection profiles modal */}
      {showConnectionProfiles && <ConnectionProfilesModal />}

      {/* DM pinned messages panel */}
      {showDMPins && <DMPinsPanel />}

      {/* DM media gallery panel */}
      {showDMMedia && activeView.kind === 'dm' && (
        <DMMediaPanel nick={activeView.nick} onClose={closeDMMedia} />
      )}

      {/* Server info panel */}
      {showServerInfo && <ServerInfoPanel />}

      {/* Server rules modal */}
      {showServerRulesModal && <ServerRulesModal />}

      {/* Poll create modal */}
      {showPollCreate && <PollCreateModal />}

      {/* Forum post creation modal */}
      {showForumCreate && <ForumCreateModal />}

      {/* Reaction summary panel */}
      {showReactionStats && <ReactionStatsPanel />}

      {/* Collaborative whiteboard panel */}
      {showWhiteboard && activeView.kind === 'channel' && (
        <Whiteboard channel={activeView.channel} onClose={closeWhiteboard} />
      )}

      {/* Go Live modal */}
      {showGoLiveModal && goLiveChannel && (
        <GoLiveModal channel={goLiveChannel} onClose={closeGoLiveModal} />
      )}

      {/* Server stats widget */}
      {showServerStats && (
        <ServerStatsOverlay onClose={closeServerStats} />
      )}

      {/* Stage view — full-screen overlay when in a stage */}
      {stageChannel && <StageView />}

      {/* Incoming / outgoing DM call overlays */}
      {voiceCallState === 'ringing_in' && <IncomingCallOverlay />}
      {voiceCallState === 'ringing_out' && <OutgoingCallOverlay />}

      {/* Image lightbox — rendered above everything else */}
      <LightboxHost />

      {/* Mobile bottom navigation bar */}
      <MobileBottomNav />

      <style>{`
        /* ── Skip link ── */
        .skip-link {
          position: absolute;
          top: -40px;
          left: 0;
          background: var(--accent);
          color: #fff;
          padding: 8px 16px;
          text-decoration: none;
          z-index: 9999;
          border-radius: 0 0 var(--r-sm, 6px) 0;
          transition: top 150ms;
          font-size: 14px;
          font-weight: 600;
        }
        .skip-link:focus {
          top: 0;
        }

        .app-shell {
          display: flex;
          height: 100dvh;
          overflow: hidden;
          background: var(--bg-void);
          position: relative;
          isolation: isolate;
        }

        /* ── Sidebar ── */
        .app-sidebar {
          display: flex;
          flex-direction: column;
          width: var(--sidebar-w);
          flex-shrink: 0;
          height: 100%;
          min-width: 208px;
          max-width: 360px;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0) 120px),
            var(--bg-deep);
          border-right: 1px solid var(--border-subtle);
          transition: transform 200ms var(--ease-out);
          position: relative;
          min-height: 0;
        }

        .app-sidebar--compact {
          min-width: 52px;
          max-width: 52px;
        }

        /* ── PWA install button ── */
        .pwa-install-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          margin: 4px 8px;
          padding: 6px 10px;
          background: var(--accent-subtle, rgba(14,165,233,0.12));
          border: 1px solid var(--accent-border, rgba(14,165,233,0.3));
          border-radius: 6px;
          color: var(--accent, #0ea5e9);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background var(--t-fast), border-color var(--t-fast);
          width: calc(100% - 16px);
        }
        .pwa-install-btn:hover {
          background: var(--accent-subtle-hover, rgba(124,90,245,0.2));
          border-color: var(--accent, #0ea5e9);
        }
        .pwa-install-icon {
          font-size: 14px;
        }

        /* ── Sidebar resize handle ── */
        .sidebar-resize-handle {
          position: absolute;
          top: 0;
          right: -3px;
          width: 6px;
          height: 100%;
          cursor: col-resize;
          z-index: 10;
          background: transparent;
          transition: background var(--t-fast);
        }
        .app-sidebar--compact .sidebar-resize-handle { display: none; }
        .sidebar-resize-handle:hover {
          background: var(--accent-border);
        }

        /* ── Main ── */
        .app-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background:
            radial-gradient(circle at 50% -140px, var(--accent-glow), transparent 280px),
            linear-gradient(180deg, color-mix(in srgb, var(--bg-base) 92%, var(--accent) 8%), var(--bg-base) 220px);
          min-width: 0;
          position: relative;
        }

        /* ── Member list ── */
        .app-member-list {
          width: var(--member-list-w);
          flex-shrink: 0;
          height: 100%;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0) 120px),
            var(--bg-deep);
          border-left: 1px solid var(--border-subtle);
          overflow-y: auto;
          position: relative;
          z-index: 1;
          min-height: 0;
        }

        /* ── Spatial pad floating host ── */
        .app-spatial-pad-host {
          position: absolute;
          top: calc(var(--header-h) + 12px);
          right: 16px;
          z-index: 120;
          animation: slide-right 180ms var(--ease-out) both;
        }
        @media (max-width: 640px) {
          .app-spatial-pad-host {
            top: auto;
            bottom: calc(var(--input-h) + 12px);
            right: 8px;
            left: 8px;
          }
          .app-spatial-pad-host > * { width: 100% !important; }
        }

        @keyframes slide-right {
          from { opacity: 0; transform: translateX(8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .animate-slide-right { animation: slide-right 180ms var(--ease-out) both; }

        /* ── Mobile topbar (hidden on desktop) ── */
        .mobile-topbar {
          display: none;
          align-items: center;
          gap: 12px;
          height: var(--header-h);
          padding: 0 12px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .mobile-menu-btn {
          width: 36px; height: 36px;
          background: none; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-secondary); border-radius: var(--r-sm);
          transition: background var(--t-fast), color var(--t-fast);
        }
        .mobile-menu-btn:hover { background: var(--ch-hover-bg); color: var(--text-primary); }
        .mobile-title {
          font-size: 16px; font-weight: 700; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }

        .mobile-overlay {
          display: none;
          position: fixed; inset: 0; z-index: 100;
          background: rgba(0,0,0,0.65);
          backdrop-filter: blur(6px) saturate(0.7);
          -webkit-backdrop-filter: blur(6px) saturate(0.7);
        }

        /* ── Mobile breakpoint ── */
        @media (max-width: 768px) {
          .mobile-topbar { display: flex; }
          .mobile-overlay { display: block; }

          /* Main shell bottom pad accounts for bottom nav + safe area */
          .app-shell {
            padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px));
          }

          /* Mobile topbar gets larger menu button touch target */
          .mobile-menu-btn {
            width: 44px;
            height: 44px;
          }

          .app-sidebar {
            position: fixed;
            left: 0; top: 0; bottom: 0;
            z-index: 200;
            transform: translateX(calc(-100% - var(--server-bar-w)));
            width: min(var(--sidebar-w), 88vw) !important;
            max-width: 360px;
            min-width: 0;
            /* Smooth spring slide */
            transition: transform 300ms cubic-bezier(0.16,1,0.3,1),
                        box-shadow 300ms cubic-bezier(0.16,1,0.3,1);
          }
          .app-sidebar--open {
            transform: translateX(0);
            box-shadow: 4px 0 32px rgba(0,0,0,0.6);
          }

          .app-member-list { display: none; }
          .app-member-list--mobile-open {
            display: flex;
            flex-direction: column;
            position: fixed;
            right: 0; top: 0;
            bottom: calc(56px + env(safe-area-inset-bottom, 0px));
            z-index: 150;
            width: min(280px, 80vw);
            background: var(--bg-deep);
            border-left: 1px solid var(--border-subtle);
            overflow-y: auto;
            animation: slide-in-right 180ms var(--ease-out) both;
          }
          @keyframes slide-in-right {
            from { transform: translateX(100%); }
            to   { transform: translateX(0); }
          }
        }

        /* ── Very narrow screens ── */
        @media (max-width: 480px) {
          :root {
            --sidebar-w: 85vw;
          }
        }

        /* ── Focus mode — hide sidebars ── */
        .focus-mode .app-sidebar,
        .focus-mode .server-bar {
          display: none !important;
        }
        .focus-mode .app-main {
          flex: 1;
        }

        /* ── Focus mode entry badge ── */
        .focus-mode-badge {
          position: fixed;
          top: 10px;
          right: 12px;
          z-index: 1000;
          background: rgba(14, 165, 233, 0.15);
          border: 1px solid var(--accent-border);
          border-radius: var(--r-full);
          padding: 4px 12px;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          backdrop-filter: blur(8px);
          pointer-events: none;
          animation: focus-badge-in 300ms var(--ease-out) both, focus-badge-out 400ms var(--ease-in) 2.6s both;
        }
        @keyframes focus-badge-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes focus-badge-out {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function ServerStatsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="ssw-overlay">
      <div className="ssw-panel">
        <button className="ssw-close-btn" onClick={onClose} aria-label="Close server stats">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <ServerStatsWidget />
      </div>
      <style>{`
        .ssw-overlay {
          position: fixed;
          bottom: 72px;
          left: calc(var(--server-bar-w, 56px) + var(--sidebar-w, 240px) + 12px);
          z-index: 300;
          animation: ssw-in 160ms var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both;
        }
        @keyframes ssw-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ssw-panel {
          background: var(--bg-elevated, #0e1e38);
          border: 1px solid var(--border-normal, rgba(255,255,255,0.08));
          border-radius: 12px;
          padding: 14px 16px 16px;
          min-width: 220px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          position: relative;
        }
        .ssw-close-btn {
          position: absolute;
          top: 10px;
          right: 10px;
          width: 22px;
          height: 22px;
          background: none;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted, #4a5a7a);
          border-radius: 4px;
          transition: color 0.12s, background 0.12s;
        }
        .ssw-close-btn:hover {
          color: var(--text-primary, #e8eaf2);
          background: rgba(255,255,255,0.06);
        }
        @media (max-width: 768px) {
          .ssw-overlay {
            left: 12px;
            bottom: 64px;
          }
        }
      `}</style>
    </div>
  );
}

function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 4.5h14M2 9h14M2 13.5h14" />
    </svg>
  );
}
