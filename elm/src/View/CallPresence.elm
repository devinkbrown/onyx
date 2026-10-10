module View.CallPresence exposing
    ( callIcon
    , headerVoice
    , joinBanner
    , railAriaSuffix
    , railCount
    , roomsWithVoice
    )

{-| v3/calls-c1 — C1 voice presence (`CALLS_DESIGN.md` §2.1–2.3,
§2.17): the sidebar row count, the room-header chip + lifecycle pill +
idle join button, the pre-join banner (invite / failed), and the
hub's "Rooms with voice" list.

Drop-in, never dragged in: the chip and banner are single-verb
(`CallJoin`), the count is read-only, and the hub list only
navigates.

Narrowings: icons are CSS-mask glyphs (`.onyx-ci`, no `elm/svg`);
the oracle's More-menu "Join call" fallback for `voiceEntry = off`
has no Elm More menu yet, so the idle join simply hides.

-}

import App exposing (Model, Msg(..))
import CallDock -- v3/calls-c6
import CallUi
import Dict
import Html exposing (Html, button, div, h2, li, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, title, type_)
import Html.Events exposing (onClick)
import Media exposing (HubPresentation(..))


{-| Decorative stroke glyph (CSS mask over `currentColor`). -}
callIcon : String -> Html msg
callIcon name =
    span [ class "onyx-ci", attribute "data-icon" name, attribute "aria-hidden" "true" ] []


pipWord : CallUi.PipState -> String
pipWord pip =
    case pip of
        CallUi.PipFaint ->
            "idle"

        CallUi.PipLive ->
            "live"

        CallUi.PipProvisional ->
            "provisional"


{-| Sidebar row count (§2.1): `pip N`, aria-hidden — the row button
carries the words through `railAriaSuffix`.
-}
railCount : Model -> String -> Html Msg
railCount model room =
    case CallUi.railPresence model.media model.calls room of
        Just presence ->
            span
                [ class "onyx-voice-count"
                , attribute "data-testid" "sidebar-voice-count"
                , attribute "data-state" (pipWord presence.pip)
                , attribute "aria-hidden" "true"
                , title presence.aria
                ]
                [ span [ class "onyx-call-pip", attribute "data-state" (pipWord presence.pip) ] []
                , text (String.fromInt presence.count)
                ]

        Nothing ->
            text ""


{-| ", N in voice[, current call]" for the row button's label. -}
railAriaSuffix : Model -> String -> String
railAriaSuffix model room =
    case CallUi.railPresence model.media model.calls room of
        Just presence ->
            ", " ++ presence.aria

        Nothing ->
            ""


faces : List String -> Html msg
faces names =
    span [ class "onyx-call-faces", attribute "aria-hidden" "true" ]
        (List.map (\name -> span [ class "onyx-call-avatar onyx-call-avatar-sm" ] [ text (initial name) ]) names)


initial : String -> String
initial name =
    String.left 1 (String.toUpper (String.filter Char.isAlphaNum name ++ name))


{-| Room-header voice cluster (§2.2): the presence chip when anyone
is in voice, the lifecycle pill for this room's call, and the idle
"Join call" / "Call" button (hidden when `voiceEntry` is off).
-}
headerVoice : Model -> Html Msg
headerVoice model =
    case model.activeChannel of
        Nothing ->
            text ""

        Just room ->
            if not (App.isChannelName model room) then
                text ""

            else
                let
                    members =
                        Dict.get (String.toLower room) model.channels
                            |> Maybe.map .members
                            |> Maybe.withDefault Dict.empty

                    names =
                        CallUi.voiceRoster members (CallUi.rosterFor model.media room)

                    count =
                        List.length names

                    presentation =
                        CallUi.roomPresentation model.calls room

                    current =
                        CallUi.currentCallIn model.calls room

                    status =
                        CallUi.roomStatus
                            { participants = names
                            , speaking = model.media.speaking
                            , raised = model.media.hands
                            , muted = model.media.muted
                            , currentCall = current
                            , localMuted = model.callSelfMuted
                            }

                    chip =
                        if count > 0 then
                            button
                                [ type_ "button"
                                , class "onyx-voice-chip"
                                , attribute "data-testid" "ribbon-voice-chip"
                                , attribute "data-active"
                                    (if presentation == HubEstablished then
                                        "true"

                                     else
                                        "false"
                                    )
                                , attribute "aria-label" (CallUi.chipAria room count current status)
                                , title (CallUi.chipTitle names status)
                                , onClick
                                    (if current then
                                        -- Already in this call: navigation only.
                                        CallsReturnToCall room

                                     else
                                        CallJoin { channel = room, video = False }
                                    )
                                ]
                                [ span
                                    [ class "onyx-call-pip"
                                    , attribute "data-state"
                                        (if presentation == HubEstablished then
                                            "live"

                                         else if presentation == HubIdle then
                                            "idle"

                                         else
                                            "provisional"
                                        )
                                    ]
                                    []
                                , faces (List.take 3 names)
                                , span [ class "onyx-voice-chip-count", attribute "aria-hidden" "true" ] [ text (String.fromInt count ++ " in voice") ]
                                , if String.isEmpty status.label then
                                    text ""

                                  else
                                    span [ class "onyx-voice-chip-status", attribute "aria-hidden" "true" ] [ text ("· " ++ status.label) ]
                                ]

                        else
                            text ""

                    pill word label =
                        span
                            [ class "onyx-call-lifecycle"
                            , attribute "data-testid" "ribbon-call-status"
                            , attribute "data-presentation" word
                            , attribute "aria-live" "polite"
                            ]
                            [ text label ]

                    lifecycle =
                        case presentation of
                            HubRingingIn ->
                                pill "ringing_in" "Incoming"

                            HubRingingOut ->
                                pill "ringing_out" "Calling"

                            HubProvisional ->
                                pill "provisional" "Connecting…"

                            HubEstablished ->
                                if count == 0 then
                                    pill "established" "In call"

                                else
                                    text ""

                            HubIdle ->
                                text ""

                    join =
                        if presentation == HubIdle && model.prefs.voiceEntry then
                            button
                                [ type_ "button"
                                , class "onyx-call-join"
                                , attribute "data-testid" "ribbon-join-call"
                                , attribute "aria-label" "Join call"
                                , title "Join call"
                                , onClick (CallJoin { channel = room, video = False })
                                ]
                                [ callIcon "phone"
                                , span [ class "onyx-call-join-label" ]
                                    [ text
                                        (if count > 0 then
                                            "Join call"

                                         else
                                            "Call"
                                        )
                                    ]
                                ]

                        else
                            text ""
                in
                div [ class "onyx-header-voice" ] [ chip, lifecycle, join ]


{-| Pre-join banner (§2.3), top of the message column. -}
joinBanner : Model -> String -> Html Msg
joinBanner model room =
    case CallUi.bannerFor model room of
        Just (CallUi.BannerInvite count) ->
            let
                members =
                    Dict.get (String.toLower room) model.channels
                        |> Maybe.map .members
                        |> Maybe.withDefault Dict.empty

                names =
                    CallUi.voiceRoster members (CallUi.rosterFor model.media room)
            in
            div
                [ class "onyx-join-banner"
                , attribute "data-testid" "call-join-banner"
                , attribute "data-variant" "invite"
                , attribute "role" "status"
                ]
                [ faces (List.take 1 names)
                , div [ class "onyx-join-banner-copy" ]
                    [ strong [] [ text (CallUi.inviteTitle count) ]
                    , span [] [ text "Join to listen; your microphone starts off until you unmute." ]
                    ]
                , div [ class "onyx-join-banner-actions" ]
                    [ button
                        [ type_ "button"
                        , class "onyx-call-btn onyx-call-btn-ghost"
                        , attribute "data-testid" "call-join-video"
                        , attribute "aria-label" ("Join with video in " ++ room)
                        , onClick (CallJoin { channel = room, video = True })
                        ]
                        [ callIcon "cam", text "Join with video" ]
                    , button
                        [ type_ "button"
                        , class "onyx-call-btn onyx-call-btn-primary"
                        , attribute "data-testid" "call-join-voice"
                        , attribute "aria-label" ("Join call in " ++ room)
                        , onClick (CallJoin { channel = room, video = False })
                        ]
                        [ callIcon "mic", text "Join call" ]
                    ]
                , button
                    [ type_ "button"
                    , class "onyx-join-banner-hide"
                    , attribute "data-testid" "call-join-banner-hide"
                    , attribute "aria-label" "Hide voice banner"
                    , onClick (CallBannerDismiss room)
                    ]
                    [ callIcon "x" ]
                ]

        Just CallUi.BannerFailed ->
            div
                [ class "onyx-join-banner onyx-join-banner-failed"
                , attribute "data-testid" "call-join-banner"
                , attribute "data-variant" "failed"
                , attribute "role" "status"
                ]
                [ span [ class "onyx-join-banner-warn" ] [ callIcon "warn" ]
                , div [ class "onyx-join-banner-copy" ]
                    [ strong [] [ text "Couldn't join. Try again." ]
                    , span [ attribute "data-testid" "call-join-failed-sub" ] [ text (CallDock.failedSub model.callJoinError room) ] -- v3/calls-c6
                    ]
                , div [ class "onyx-join-banner-actions" ]
                    [ button
                        [ type_ "button"
                        , class "onyx-call-btn"
                        , attribute "data-testid" "call-join-retry"
                        , onClick (CallJoin { channel = room, video = False })
                        ]
                        [ text "Try again" ]
                    ]
                ]

        Nothing ->
            text ""


{-| Hub "Rooms with voice" (§2.17): navigation-only rows reusing the
sidebar count. Nothing renders when no joined room has voice.
-}
roomsWithVoice : Model -> Html Msg
roomsWithVoice model =
    let
        rooms =
            model.channels
                |> Dict.values
                |> List.filter (\c -> App.isChannelName model c.name && not (List.isEmpty (CallUi.rosterFor model.media c.name)))
                |> List.sortBy (.name >> String.toLower)
    in
    if List.isEmpty rooms then
        text ""

    else
        div [ class "onyx-calls-rooms", attribute "data-testid" "calls-hub-rooms" ]
            [ h2 [ class "onyx-calls-rooms-title" ] [ text "Rooms with voice" ]
            , ul [ class "onyx-calls-rooms-list" ]
                (List.map
                    (\c ->
                        li []
                            [ button
                                [ type_ "button"
                                , class "onyx-calls-room"
                                , attribute "aria-label" (c.name ++ railAriaSuffix model c.name)
                                , onClick (CallsReturnToCall c.name)
                                ]
                                [ span [ class "onyx-calls-room-name" ] [ text c.name ]
                                , railCount model c.name
                                ]
                            ]
                    )
                    rooms
                )
            ]
