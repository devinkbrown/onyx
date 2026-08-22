// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HomeView — thin composition root for the connected Current Ledger.
 *
 * Accessors, resources, and handlers live in createHomeController.
 * Ordering/caps live in composeHomeBriefing. Markup lives in HomeBriefingView.
 */
import './home-view.css';
import { HomeBriefingView } from './home/HomeBriefingView';
import { createHomeController } from './home/homeController';
import { relTime } from '@/lib/stats/networkIndex';

export { relTime };

export function HomeView() {
  const home = createHomeController();
  return (
    <HomeBriefingView
      nowMs={home.nowMs}
      welcomeName={home.welcomeName}
      connectionStatus={home.connectionStatus}
      localMemoryStatus={home.localMemoryStatus}
      briefing={home.briefing}
      outboxChrome={home.outboxChrome}
      queuedSends={home.queuedSends}
      confirmDiscardId={home.confirmDiscardId}
      recaps={home.recaps}
      more={home.more}
      showFirstRoomPrompt={home.showFirstRoomPrompt}
      showInviteFriends={home.showInviteFriends}
      showFirstHourWelcome={home.showFirstHourWelcome}
      firstHourTip={home.firstHourTip}
      formationStrip={home.formationStrip}
      isJoined={home.isJoined}
      caughtUpPlan={home.caughtUpPlan}
      actions={home.actions}
    />
  );
}
