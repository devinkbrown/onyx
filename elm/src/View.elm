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
import Dict
import Invite exposing (inviteTitle)
import Media
import Browser
import Html exposing (Html, div, main_)
import Html.Attributes exposing (attribute, class, classList, id, style)
import Route
import Guides exposing (surfaceForRoute, surfaceTitle)
import View.Connection
import View.Connect
import View.Home exposing (home)
import View.Nav
import Nav
import View.About
import View.Appearance
import View.Calls exposing (callsHub, mediaControlPanel, recordingStatus)
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
import View.Stewardship exposing (stewardPanel)
import View.Trust exposing (trustPageForRoute)
import View.Rail exposing (rail)
import View.Roadmap
import View.Roster exposing (roster)
import View.Scheduled exposing (scheduledSheet)
import View.Search exposing (panel)
import View.Browser exposing (browser)
import View.GuestClaim exposing (guestClaim)
import View.Account exposing (accountPanel)
import View.Media exposing (mediaPanel)
import View.Pins exposing (pinsDrawer)
import View.Profile exposing ( moderationReview, personSafetySheet, profileCard, profileSheet )
import View.Thread exposing (thread)
import View.Toast exposing (toaster)
import View.Topbar exposing (reclaimDialog, reconnectBanner, sessionRecoveryBanner, topbar)
import View.RuntimeServices


view : Model -> Browser.Document Msg
view model =
    { title = documentTitle model
    , body =
        [ div [ id "app", style "display" "contents" ] (viewBody model) ]
    }


{-| The document body. `display: contents` keeps this node from
changing layout while giving the boot mount (`#app`) a live shell. -}
viewBody : Model -> List (Html Msg)
viewBody model =
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
                                [ landing ]

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
                                case model.connectGate of
                                    Just current ->
                                        if App.connectGateVisible model then
                                            [ View.Connect.gate model current ]

                                        else
                                            [ shell model ]

                                    Nothing ->
                                        [ shell model ]


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
    div
        [ class "onyx-shell"
        , attribute "data-nav" (Nav.idKey model.navSection)
        , attribute "data-collection-open" (boolString model.clientRoomsOpen)
        , attribute "data-calls" (boolString model.callsOpen)
        ]
        [ View.Nav.primaryNav model
        , div [ class "onyx-shell-column" ] (shellColumn model)
        , View.Nav.mobileNav model
        ]


boolString : Bool -> String
boolString on =
    if on then
        "true"

    else
        "false"


shellColumn : Model -> List (Html Msg)
shellColumn model =
        ([ topbar model
         , recordingStatus model.mediaControlView (Maybe.map2 (==) model.mediaControlViewOwner model.runtimeOwnerStamp |> Maybe.withDefault False)
         , reconnectBanner model
         , sessionRecoveryBanner model
         , reclaimDialog model
         ]
            ++ (if model.searchOpen then
                    [ panel model ]

                else
                    []
               )
            ++ [ if model.callsOpen then
                    main_ [ class "onyx-main onyx-main-calls" ]
                        [ callsHub model.calls model.activeChannel ((if model.mediaControlViewOwner == model.runtimeOwnerStamp then model.mediaControlView else Nothing) |> Maybe.andThen .call |> Maybe.map .callRef) model.callSelfMuted model.callSelfDeafened model.mediaQualityView (model.mediaQualityViewOwner == model.runtimeOwnerStamp) (model.runtimeDomainPending /= Nothing)
                        , mediaControlPanel model.mediaControlView (model.mediaControlViewOwner == model.runtimeOwnerStamp) model.activeChannel
                            (model.activeChannel |> Maybe.map (String.toLower >> (\room -> Dict.get room model.media.transcripts |> Maybe.withDefault [])) |> Maybe.withDefault [])
                            model.mediaCaptionLanguage
                            (model.mediaBrowserAudioConsent
                                && (model.runtimeOwnerStamp
                                        |> Maybe.andThen (\stamp -> model.mediaControlView |> Maybe.andThen (\viewState -> App.mediaConsentScope stamp viewState.call))
                                   )
                                == model.mediaBrowserAudioConsentCall
                            )
                            model.mediaOutputVolumePercent
                            model.mediaGestureResult
                            (model.runtimeDomainPending /= Nothing)
                        ]

                 else if model.navSection == Nav.Home then
                    main_
                        [ class "onyx-main onyx-main-home"
                        , classList [ ( "onyx-main-rooms-open", model.clientRoomsOpen ) ]
                        ]
                        [ rail model
                        , home model
                        ]

                 else
                    main_
                        [ class "onyx-main"
                        , classList
                            [ ( "onyx-main-rooms-open", model.clientRoomsOpen )
                            , ( "onyx-main-members-open", model.clientMembersOpen )
                            ]
                        ]
                        [ rail model
                        , div [ class "onyx-convo" ] [ thread model, composer model ]
                        , roster model
                        ]
               , toaster model
               , stewardPanel model
               , guestClaim model
               , browser model
               , scheduledSheet model
               , accountPanel model
               , pinsDrawer model
               , mediaPanel model
               , profileSheet model
               , profileCard model
               , moderationReview model
               , personSafetySheet model
               , View.Connection.dialog model
               , View.Nav.youDialog model
               , View.RuntimeServices.view model.runtimeDomainResult model.sessionRecoveryView model.webAuthnObservationView model.privateAccountStatus (model.runtimeDomainPending /= Nothing) model.activeChannel model.composer (model.eventClock + 1) model.accountName (Maybe.map .networkId model.runtimeOwnerStamp) model.groupBackupRoomInput (model.accountName /= Nothing) (model.calls.lifecycle /= Media.Idle) model.callSelfMuted model.callSelfDeafened
               ]
        )
