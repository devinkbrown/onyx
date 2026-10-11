module View exposing (view)

{-| Revamped application views — pure rendering over the `App` core,
composed from the `View.*` surfaces.

Design language (Onyx identity, anti-slop rules apply): near-black
abyssal surface, warm off-white text, ONE sea-glass accent reserved for
live/active states, system font stack, 6px radii, hierarchy through
weight and size only. No gradients, no glow, no glass, no emoji icons.

Layout (v3/frame): one CSS grid — nav rail | collection sidebar |
conversation column (room header, transcript, composer) | context
rail — under a global top bar; one column + bottom nav under 768px.

-}

import App exposing (Model, Msg, inviteCard)
import Invite exposing (inviteTitle)
import Browser
import Html exposing (Html, div, main_, text)
import Html.Attributes exposing (attribute, class)
import Route
import Guides exposing (surfaceForRoute, surfaceTitle)
import View.About
import View.Appearance
import View.Calls exposing (callsHub)
-- v3/calls-c1
import View.CallStage
-- v3/calls-c8
import View.VoiceSettings
-- v3/calls-c11
import View.StageMode
import View.CallDock -- v3/calls-c6
import View.Download
import View.Guides
import View.Stats
import View.Invite
import View.Onyxos
import View.Status
import View.Composer exposing (composer)
import View.Connect exposing (connectGate)
import View.Landing exposing (landing)
import View.NotFound exposing (notFound)
import View.PublicFrame exposing (frame)
import View.PublicInfo exposing (pageForRoute, pageTitle, route)
import View.ModDesk exposing (moderationSheet, operSheet)
import View.Boost exposing (jumpToDateSheet)
import View.Stewardship exposing (stewardPanel)
import View.Trust exposing (trustPageForRoute)
import View.Rail exposing (rail)
import View.NewMessage exposing (newMessageSheet)
import View.Roadmap
import View.Roster exposing (roster)
import View.Scheduled exposing (scheduledSheet)
import View.Search exposing (panel)
import View.Browser exposing (browser)
import View.GuestClaim exposing (guestClaimSheet)
import View.Account exposing (accountPanel)
import View.Media exposing (mediaPanel)
import View.Notify exposing (notifySheet)
import View.DmSafety exposing (inviteShareSheet)
import View.Prefs exposing (prefsSheet)
import View.BlockKit -- v3/gap-import
import View.Pins exposing (pinsDrawer)
import View.Profile exposing ( moderationReview, personSafetySheet, profileCard, profileSheet )
import View.Thread exposing (thread)
import View.Account2
import View.UserModes -- v3/gap-usermodes
import View.Toast exposing (toaster)
import View.Nav
import View.Inbox
import View.Switcher
import View.GapCommands
import Nav
import View.Topbar exposing (reclaimDialog, reconnectBanner, topbar)
import View.RoomHeader exposing (roomHeader)
-- v3/roomsettings
import View.Chanserv -- v3/gap-chanserv
import View.RoomSettings
import View.Polish -- v3/polish
-- v3/gap-organize
import View.Attention
import View.Organize
import View.WatchTogether -- v3/gap-watch
import View.GapShell -- v3/gap-shell


view : Model -> Browser.Document Msg
view model =
    { title = documentTitle model
    , body =
        case pageForRoute model.route of
            Just page ->
                route model page

            Nothing ->
                case trustPageForRoute model.route of
                    Just trust ->
                        View.Trust.route model trust

                    Nothing ->
                        case model.route of
                            Route.Landing ->
                                [ frame model "/" "Onyx home" Nothing [ landing model.landingBoardTab ] ]

                            Route.About ->
                                View.About.route model

                            Route.Invite ->
                                View.Invite.route model

                            Route.Onyxos ->
                                View.Onyxos.route model

                            Route.Status ->
                                View.Status.route model

                            Route.Download ->
                                View.Download.route model

                            Route.Stats ->
                                View.Stats.route model

                            Route.Appearance ->
                                View.Appearance.route model

                            Route.Guides ->
                                View.Guides.route model Guides.GuidesPage

                            Route.Community ->
                                View.Guides.route model Guides.CommunityPage

                            Route.NotFound ->
                                [ frame model model.navPath "Onyx page not found" Nothing [ notFound (isAppMiss model) ] ]

                            Route.Roadmap ->
                                View.Roadmap.route model

                            _ ->
                                if App.connectGateVisible model then
                                    [ connectGate model ]

                                else
                                    [ appFrame model ]
    }


{-| A miss under `/app` offers the app; anywhere else offers home. -}
isAppMiss : Model -> Bool
isAppMiss model =
    String.startsWith "/app" model.navPath


documentTitle : Model -> String
documentTitle model =
    case pageForRoute model.route of
        Just page ->
            pageTitle page

        Nothing ->
            case trustPageForRoute model.route of
                Just trust ->
                    View.Trust.pageTitle trust

                Nothing ->
                    case model.route of
                        Route.Landing ->
                            "Onyx — good company. Great nights."

                        Route.About ->
                            "About Onyx — rooms for your people"

                        Route.Invite ->
                            inviteTitle (inviteCard model)

                        Route.Onyxos ->
                            "OnyxOS + Onyx — communication at home in the system"

                        Route.Status ->
                            "Onyx status — are the rooms up?"

                        Route.Download ->
                            "Get Onyx on this device — browser first"

                        Route.Stats ->
                            "Onyx stats — live room activity"

                        Route.Appearance ->
                            "Appearance — Onyx"

                        Route.Guides ->
                            surfaceTitle Guides.GuidesPage

                        Route.Community ->
                            surfaceTitle Guides.CommunityPage

                        Route.NotFound ->
                            "Route terminus — Onyx"

                        Route.Roadmap ->
                            "Onyx roadmap — rooms, calls, catch-up"

                        _ ->
                            case model.activeChannel of
                                Just name ->
                                    name ++ " — Onyx"

                                Nothing ->
                                    "Onyx"


{-| v3/frame — the ONE app frame grid (see `.onyx-frame` in app.css):

    nav rail | topbar (global)                                  |
             | notices (reconnect banner, search, guest chip)   |
             | collection sidebar | conversation | context rail |
    mobile bottom nav (under 768px only)

The conversation column stacks the room header, the transcript pane
and the composer. Under 768px the grid collapses to one column: the
sidebar replaces the conversation while the Rooms / Messages drawer is
open (`data-nav-drawer`), the context rail hides, and the bottom nav
takes the last row —
except inside a conversation (`data-convo`), which is a pushed page:
the global bar and the bottom nav step aside and the room header's
back control returns to the list. Every overlay (sheets, palette, toasts, the You
hub) mounts in `.onyx-overlays`, outside the grid flow.
-}
appFrame : Model -> Html Msg
appFrame model =
    div
        [ class "onyx-frame"
        , attribute "data-nav" (Nav.idKey model.navSection)
        , attribute "data-nav-drawer"
            (if model.navDrawerOpen then
                "true"

             else
                "false"
            )
        , attribute "data-calls"
            (if model.callsOpen then
                "true"

             else
                "false"
            )
        , View.Attention.readerAttr model -- v3/gap-organize: reader mode
        , -- v3/ui-mobile-shell: a conversation is showing (phones push it
          -- as its own page: no global bar, no bottom nav, a back control)
          attribute "data-convo"
            (case ( model.activeChannel, model.callsOpen ) of
                ( Just name, False ) ->
                    if App.isChannelName model name then
                        "room"

                    else
                        "dm"

                _ ->
                    "false"
            )
        ]
        ([ View.Nav.primaryNav model
         , topbar model
         , div [ class "onyx-notices" ]
            ([ reconnectBanner model
             , -- v3/account2
               View.Account2.reclaimBanner model
             , View.Chanserv.joinPromptCard model -- v3/gap-chanserv

             -- v3/ui-mobile-shell: the guest "Keep the name" chip moved to Home
             ]
            )
         ]
            ++ (if model.callsOpen then
                    [ main_ [ class "onyx-main onyx-main-calls" ]
                        [ callsHub model ]
                    ]

                else
                    [ rail model
                    , main_ [ class "onyx-main" ]
                        ([ roomHeader model ]
                            -- v3/rx-convo: message search belongs to the conversation it
                            -- searches: it opens under the room header, in the main column
                            -- (it used to sit in the full-width notices row and pushed the
                            -- room list and the roster down with it).
                            ++ (if model.searchOpen then
                                    [ panel model ]

                                else
                                    []
                               )
                            ++ [ View.Polish.timeScrubber model -- v3/polish
                               , thread model
                               , composer model
                               ]
                        )
                    , roster model
                    ]
               )
            ++ [ View.Nav.mobileNav model
               , overlays model
               ]
        )


{-| Everything that floats over the frame. Order is stacking order
(later paints above earlier); `App.overlayStack` mirrors it for Escape.
-}
overlays : Model -> Html Msg
overlays model =
    div [ class "onyx-overlays" ]
        [ View.CallDock.pip model -- v3/calls-c6: floats under every sheet
        , toaster model
        , stewardPanel model
        , guestClaimSheet model
        , browser model
        , scheduledSheet model
        , accountPanel model
        , -- v3/account2
          View.Account2.peopleSheet model
        , View.Account2.themeShareSheet model
        , notifySheet model
        , prefsSheet model
        , pinsDrawer model
        , mediaPanel model
        , jumpToDateSheet model
        , profileSheet model
        , profileCard model
        , -- v3/moddesk: the review renders inside the room desk while it is open
          if model.moderationOpen then
            text ""

          else
            moderationReview model
        , moderationSheet model
        -- v3/roomsettings
        , View.RoomSettings.roomSettingsSheet model
        , operSheet model
        , personSafetySheet model
        , newMessageSheet model
        , inviteShareSheet model -- v3/dmsafety
        -- v3/calls-c1
        , View.CallStage.privacySheet model
        , View.VoiceSettings.sheet model -- v3/calls-c8
        , View.CallStage.announcer model
        -- v3/calls-c11
        , View.StageMode.handsSheet model
        , View.StageMode.leaveConfirm model
        -- v3/gap-watch
        , View.WatchTogether.startSheet model
        , reclaimDialog model
        -- v3/gap-shell
        , View.GapShell.activitySheet model
        , View.GapShell.leaveConfirm model
        , View.Nav.youHub model
        , View.Inbox.inboxSheet model -- v3/ui-sheets
        -- v3/gap-organize: row menu, folder picker, saved messages; reader exit
        , View.Organize.sheets model
        , View.Attention.readerPill model
        , View.UserModes.memoSheet model -- v3/gap-usermodes
        -- v3/switcher
        , View.Switcher.palette model
        , View.Switcher.shortcutsOverlay model
        , View.BlockKit.overlay model -- v3/gap-import
        , View.GapCommands.commandsHelp model -- v3/gap-commands
        -- v3/calls-c6: the DM ring is modal over everything
        , View.CallDock.recoveryAnnouncer model
        -- v3/polish: the quiet asks + the update strip
        , View.Polish.updateBanner model
        , View.Polish.firstRunNotify model
        , View.Polish.addToHomeScreen model
        , View.CallDock.ringDialog model
        ]
