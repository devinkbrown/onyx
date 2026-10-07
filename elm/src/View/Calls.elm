module View.Calls exposing (callsHub)

{-| Calls hub — Elm port of `src/shell/CallsHub.tsx` (presentation copy
and navigation-only behavior; the voice lifecycle arrives from the
engine bridge, which lands with the engine itself).

Hard rules, mirroring the oracle:

  - Opening this hub never joins, accepts, starts, or otherwise mutates
    a call. The only controls are "Choose a room" (reveals the rail)
    and "Return to call" (navigates, voice untouched).
  - Ringing and provisional states are never labeled established.
  - No join / accept / start control exists for any presentation.
  - The last-call outcome renders only while idle; a live call always
    wins over history, and the hub never invents it.

-}

import App exposing (Msg(..))
import Html exposing (Html, button, div, h1, header, main_, p, span, strong, text)
import Html.Attributes exposing (attribute, class)
import Html.Events exposing (onClick)
import Media exposing (CallHub, HubPresentation(..))


presentationOf : CallHub -> HubPresentation
presentationOf hub =
    Media.classifyHubPresentation hub.lifecycle hub.startedAt


presentationWord : HubPresentation -> String
presentationWord presentation =
    case presentation of
        HubRingingIn ->
            "ringing_in"

        HubRingingOut ->
            "ringing_out"

        HubProvisional ->
            "provisional"

        HubEstablished ->
            "established"

        HubIdle ->
            "idle"


statusLabel : HubPresentation -> String
statusLabel presentation =
    case presentation of
        HubRingingIn ->
            "Incoming"

        HubRingingOut ->
            "Outgoing"

        HubProvisional ->
            "Connecting"

        HubEstablished ->
            "In call"

        HubIdle ->
            "Idle · Pre-join"


hubTitle : HubPresentation -> String
hubTitle presentation =
    case presentation of
        HubRingingIn ->
            "Incoming call"

        HubRingingOut ->
            "Calling…"

        HubProvisional ->
            "Connecting to the call…"

        HubEstablished ->
            "Your call is still here."

        HubIdle ->
            "Talk where the conversation already lives."


hubIntro : HubPresentation -> Maybe String -> String
hubIntro presentation label =
    case presentation of
        HubRingingIn ->
            case label of
                Just where_ ->
                    if String.startsWith "#" where_ then
                        "Someone is calling you in " ++ where_ ++ ". Accept or decline from the call controls; this screen never answers for you."

                    else
                        "Someone is calling you — " ++ where_ ++ ". Accept or decline from the call controls; this screen never answers for you."

                Nothing ->
                    "Someone is calling you. Accept or decline from the call controls; this screen never answers for you."

        HubRingingOut ->
            case label of
                Just where_ ->
                    "Ringing " ++ where_ ++ ". Stay here or keep browsing — Onyx will not pretend the call is established until it connects."

                Nothing ->
                    "Your outgoing call is still ringing. Onyx will not pretend the call is established until it connects."

        HubProvisional ->
            case label of
                Just where_ ->
                    "Joining " ++ where_ ++ ". Media is not established yet — connection status stays honest while the session starts."

                Nothing ->
                    "Joining the call. Media is not established yet — connection status stays honest while the session starts."

        HubEstablished ->
            case label of
                Just where_ ->
                    "Return to " ++ where_ ++ " without losing your place in the conversation."

                Nothing ->
                    "Return to your live call without losing your place in the conversation."

        HubIdle ->
            "Voice and video begin inside a room, so people arrive with the same context before, during, and after the call."


nextStep : HubPresentation -> String
nextStep presentation =
    case presentation of
        HubEstablished ->
            " Your call is active; use the call controls for microphone, camera, and captions."

        HubProvisional ->
            " The session is connecting. Media controls appear when the call confirms a connection."

        _ ->
            " This page is a starting point. Choosing a room does not join or start a call."


actionNote : HubPresentation -> Bool -> String
actionNote presentation canReturn =
    if presentation == HubEstablished then
        "Microphone, camera, sharing, and captions stay available in the call bar."

    else if canReturn then
        "Return to the conversation while the call connects."

    else
        "Choose a room to see its call controls and live status."


{-| The hub surface. `canReturn` needs a provisional-or-established
call plus a target; otherwise the primary button reveals the rooms.
An idle hub with an open conversation offers voice/video join (the
join resolves through the engine feed, so a missing engine lands as
a failed outcome); a live call offers mute + leave.
-}
callsHub : CallHub -> Maybe String -> Bool -> Html Msg
callsHub hub activeChannel selfMuted =
    let
        presentation =
            presentationOf hub

        label =
            Media.hubRoomLabel hub

        canReturn =
            (presentation == HubProvisional || presentation == HubEstablished) && label /= Nothing

        idleOutcome =
            if presentation == HubIdle then
                hub.outcome

            else
                Nothing
    in
    main_
        [ class "onyx-calls"
        , attribute "data-call-presentation" (presentationWord presentation)
        ]
        [ header [ class "onyx-calls-header" ]
            [ div [ class "onyx-calls-kicker" ] [ text "Calls" ]
            , p [ class "onyx-calls-status", attribute "data-testid" "calls-hub-status" ]
                [ span [ class "onyx-calls-pip", attribute "data-state" (presentationWord presentation) ] []
                , span [] [ text (statusLabel presentation) ]
                , case label of
                    Just where_ ->
                        span [ class "onyx-calls-where" ] [ text where_ ]

                    Nothing ->
                        text ""
                ]
            , h1 [ class "onyx-calls-title" ] [ text (hubTitle presentation) ]
            , p [ class "onyx-calls-intro" ] [ text (hubIntro presentation label) ]
            ]
        , case idleOutcome of
            Just outcome ->
                let
                    copy =
                        Media.callOutcomeCopy outcome
                in
                p [ class "onyx-calls-outcome", attribute "data-testid" "calls-hub-outcome" ]
                    [ strong [] [ text copy.title ]
                    , span [] [ text copy.detail ]
                    ]

            Nothing ->
                text ""
        , p [ class "onyx-calls-next" ]
            [ strong [] [ text "What happens next" ]
            , span [] [ text (nextStep presentation) ]
            ]
        , case ( canReturn, label ) of
            ( True, Just where_ ) ->
                button
                    [ class "onyx-calls-primary"
                    , onClick (CallsReturnToCall where_)
                    ]
                    [ text "Return to call" ]

            _ ->
                button
                    [ class "onyx-calls-primary"
                    , onClick CallsChooseRoom
                    ]
                    [ text "Choose a room" ]
        , case ( presentation, activeChannel ) of
            ( HubIdle, Just where_ ) ->
                div [ class "onyx-calls-join" ]
                    [ button
                        [ class "onyx-calls-join-voice"
                        , onClick (CallJoin { channel = where_, video = False })
                        ]
                        [ text ("Join call in " ++ where_) ]
                    , button
                        [ class "onyx-calls-join-video"
                        , onClick (CallJoin { channel = where_, video = True })
                        ]
                        [ text ("Join with video in " ++ where_) ]
                    ]

            _ ->
                text ""
        , if presentation == HubProvisional || presentation == HubEstablished then
            div [ class "onyx-calls-controls" ]
                [ button
                    [ class "onyx-calls-mute"
                    , onClick CallToggleMute
                    ]
                    [ text
                        (if selfMuted then
                            "Unmute"

                         else
                            "Mute"
                        )
                    ]
                , button
                    [ class "onyx-calls-leave"
                    , onClick CallLeave
                    ]
                    [ text "Leave call" ]
                ]

          else
            text ""
        , p [ class "onyx-calls-note" ]
            [ span [ attribute "aria-hidden" "true" ] [ text "●" ]
            , text (actionNote presentation canReturn)
            ]
        ]
