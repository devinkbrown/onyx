module View exposing (view)

{-| Revamped application views — pure rendering over the `App` core,
composed from the `View.*` surfaces.

Design language (Onyx identity, anti-slop rules apply): near-black
abyssal surface, warm off-white text, ONE sea-glass accent reserved for
live/active states, system font stack, 6px radii, hierarchy through
weight and size only. No gradients, no glow, no glass, no emoji icons.

Layout: top bar (brand + connection pill + channel topic) over a
three-column working area (channel rail, message thread, grouped
roster), with the composer pinned under the thread.

-}

import App exposing (Model, Msg, inviteCard)
import Invite exposing (inviteTitle)
import Browser
import Html exposing (Html, div, main_)
import Html.Attributes exposing (class)
import Route
import Guides exposing (surfaceForRoute, surfaceTitle)
import View.About
import View.Appearance
import View.Calls exposing (callsHub)
import View.Download
import View.Guides
import View.Stats
import View.Invite
import View.Onyxos
import View.Status
import View.Composer exposing (composer)
import View.Landing exposing (landing)
import View.NotFound exposing (notFound)
import View.PublicFrame exposing (frame)
import View.PublicInfo exposing (pageForRoute, pageTitle, route)
import View.Bans exposing (banPanel)
import View.Stewardship exposing (stewardPanel)
import View.Inbox exposing (inbox)
import View.Trust exposing (trustPageForRoute)
import View.Rail exposing (rail)
import View.Roadmap
import View.Roster exposing (roster)
import View.Scheduled exposing (scheduledSheet)
import View.Search exposing (panel)
import View.Browser exposing (browser)
import View.GuestClaim exposing (guestClaim)
import View.Account exposing (accountPanel)
import View.Pins exposing (pinsDrawer)
import View.Profile exposing ( profileCard, profileSheet )
import View.Thread exposing (thread)
import View.Toast exposing (toaster)
import View.Topbar exposing (reclaimDialog, reconnectBanner, topbar)


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
                                [ landing model.landingBoardTab ]

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
                                [ shell model ]
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


shell : Model -> Html Msg
shell model =
    div [ class "onyx-shell" ]
        ([ topbar model, reconnectBanner model, reclaimDialog model ]
            ++ (if model.searchOpen then
                    [ panel model ]

                else
                    []
               )
            ++ [ if model.callsOpen then
                    main_ [ class "onyx-main onyx-main-calls" ]
                        [ callsHub model.calls model.activeChannel model.callSelfMuted ]

                 else
                    main_ [ class "onyx-main" ]
                        [ rail model
                        , thread model
                        , roster model
                        , case model.activeChannel of
                            Just name ->
                                banPanel model name

                            Nothing ->
                                div [] []
                        ]
               , if model.callsOpen then
                    div [] []

                 else
                    composer model
               , inbox model
               , toaster model
               , stewardPanel model
               , guestClaim model
               , browser model
               , scheduledSheet model
               , accountPanel model
               , pinsDrawer model
               , profileSheet model
               , profileCard model
               ]
        )
