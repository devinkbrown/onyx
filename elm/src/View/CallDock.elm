module View.CallDock exposing
    ( dmCallItem
    , lostBanner
    , pip
    , reconnectingNow
    , recoveryAnnouncer
    , ringDialog
    )

{-| v3/calls-c6 — the docked call surfaces (`CALLS_DESIGN.md` §2.8,
§2.9, §2.14, §2.18):

  - C6 incoming / outgoing DM ring dialogs through `View.Sheet`
    (`viewPinned`: the backdrop is a no-op, Escape declines / cancels
    via `App.overlayStack`, initial focus on Decline / Cancel), plus
    the DM "Call" entry in the room header's More menu;
  - C7 the mini voice view (PiP) shown while viewing another target:
    corner cycle, arrow / drag nudges, Return / Mute / Leave;
  - C10 the "Connection lost." stage banner and the polite
    "Reconnected" announcer.

Narrowings: the PiP has no video strip (C5 owns video), and below
768px it docks top-right under the header regardless of corner (the
corner button hides there); focus-obscure yield and pointer capture
are a small delegated helper in `ports.js` (`installVoicePipAssist`).

-}

import App exposing (Model, Msg(..))
import CallDock
import CallUi
import Dict
import Html exposing (Html, button, div, h2, p, section, span, strong, text)
import Html.Attributes exposing (attribute, class, disabled, id, style, title, type_)
import Html.Events exposing (on, onClick, preventDefaultOn)
import Json.Decode as Decode
import View.CallPresence exposing (callIcon)
import View.Sheet as Sheet



-- C6 · RING DIALOGS


ringScope : String
ringScope =
    "call-ring"


ringDescId : String
ringDescId =
    "call-ring-desc"


initialOf : String -> String
initialOf name =
    String.left 1 (String.toUpper (String.filter Char.isAlphaNum name ++ name))


{-| The incoming or outgoing ring dialog, or nothing. -}
ringDialog : Model -> Html Msg
ringDialog model =
    case CallDock.ringFor model.calls of
        Just (CallDock.RingIncoming caller) ->
            incoming model caller

        Just (CallDock.RingOutgoing callee) ->
            outgoing callee

        Nothing ->
            text ""


ringConfig : Msg -> String -> Sheet.Config Msg
ringConfig close kind =
    let
        base =
            Sheet.config { scope = ringScope, onClose = close }
    in
    { base
        | layerClass = "onyx-call-ring-layer"
        , panelClass = "onyx-call-ring"
        , attrs =
            [ attribute "aria-describedby" ringDescId
            , attribute "data-ring" kind
            , attribute "data-testid" (kind ++ "-call-overlay")
            ]
    }


who : String -> Html Msg -> Html Msg
who name sub =
    div [ class "onyx-call-ring-who" ]
        [ span [ class "onyx-call-avatar onyx-call-avatar-md onyx-call-ring-avatar", attribute "aria-hidden" "true" ] [ text (initialOf name) ]
        , div [ class "onyx-call-ring-who-text" ]
            [ strong [ class "onyx-call-ring-name" ] [ text name ]
            , sub
            ]
        ]


incoming : Model -> String -> Html Msg
incoming model caller =
    Sheet.viewPinned (ringConfig CallDecline "incoming")
        [ p [ class "onyx-call-ring-kicker" ] [ text "Incoming voice call" ]
        , h2 [ class "onyx-call-ring-title", id (Sheet.titleId ringScope) ] [ text "Incoming call" ]
        , who caller (span [ class "onyx-call-ring-sub" ] [ text "Direct message" ])
        , p [ class "onyx-call-ring-body", id ringDescId ]
            [ text "A voice call is waiting. Accept to join with your current audio settings, or decline to dismiss it." ]
        , if model.callAccepting then
            p [ class "onyx-call-ring-status", attribute "role" "status", attribute "data-testid" "call-ring-accepting" ]
                [ text (CallDock.acceptingStatus caller) ]

          else
            text ""
        , if model.callAcceptError then
            p [ class "onyx-call-ring-error", attribute "role" "alert", attribute "data-testid" "call-ring-error" ]
                [ text (CallDock.acceptErrorText caller) ]

          else
            text ""
        , div [ class "onyx-call-ring-actions" ]
            [ button
                [ type_ "button"
                , class "onyx-call-btn onyx-call-btn-danger"
                , attribute "data-testid" "call-ring-decline"
                , attribute "aria-label" (CallDock.declineAria caller)
                , Sheet.autofocus ringScope
                , onClick CallDecline
                ]
                [ callIcon "leave", text "Decline" ]
            , button
                [ type_ "button"
                , class "onyx-call-btn onyx-call-btn-primary"
                , attribute "data-testid" "call-ring-accept"
                , attribute "aria-label" (CallDock.acceptAria caller)
                , disabled model.callAccepting
                , onClick CallAccept
                ]
                [ callIcon "phone"
                , text
                    (if model.callAccepting then
                        "Accepting…"

                     else
                        "Accept"
                    )
                ]
            ]
        , p [ class "onyx-call-ring-meta" ] [ text "Your microphone stays muted if Join muted is enabled." ]
        , div [ class "sr-only", attribute "role" "alert", attribute "data-testid" "call-ring-alert" ]
            [ text (CallDock.incomingAlert caller) ]
        ]


outgoing : String -> Html Msg
outgoing callee =
    Sheet.viewPinned (ringConfig CallCancel "outgoing")
        [ p [ class "onyx-call-ring-kicker" ] [ text "Outgoing voice call" ]
        , h2 [ class "onyx-call-ring-title", id (Sheet.titleId ringScope) ] [ text "Calling" ]
        , who callee (span [ class "onyx-call-ring-sub", attribute "aria-live" "polite" ] [ text "Waiting for them to answer." ])
        , p [ class "onyx-call-ring-body", id ringDescId ]
            [ text "The call request is being sent. You can cancel before they answer." ]
        , div [ class "onyx-call-ring-actions" ]
            [ button
                [ type_ "button"
                , class "onyx-call-btn onyx-call-btn-danger"
                , attribute "data-testid" "call-ring-cancel"
                , attribute "aria-label" (CallDock.cancelAria callee)
                , Sheet.autofocus ringScope
                , onClick CallCancel
                ]
                [ callIcon "leave", text "Cancel" ]
            ]
        , p [ class "onyx-call-ring-meta" ]
            [ span [ class "onyx-call-pip", attribute "data-state" "provisional" ] [], text "Ringing" ]
        ]


{-| Room-header More menu entry for a DM target: start a voice call
(single verb, idle only — "drop-in, never dragged in").
-}
dmCallItem : Model -> Html Msg
dmCallItem model =
    case model.activeChannel of
        Just target ->
            if
                not (App.isChannelName model target)
                    && CallDock.ringStartable
                        { live = model.connection == App.Live
                        , hub = model.calls
                        , ourNick = model.ourNick
                        , peer = target
                        }
            then
                button
                    [ type_ "button"
                    , class "onyx-call-dm-start"
                    , attribute "data-testid" "ribbon-dm-call"
                    , attribute "aria-label" ("Start voice call with " ++ target)
                    , onClick (CallStart target)
                    ]
                    [ callIcon "phone", text "Call" ]

            else
                text ""

        Nothing ->
            text ""



-- C7 · PICTURE-IN-PICTURE


displayName : Model -> String -> String
displayName model key =
    let
        fromMembers =
            model.calls.channel
                |> Maybe.andThen (\c -> Dict.get (String.toLower c) model.channels)
                |> Maybe.andThen (\ch -> Dict.get (String.toLower key) ch.members)
                |> Maybe.map .nick
    in
    case fromMembers of
        Just nick ->
            nick

        Nothing ->
            if String.toLower (String.trim model.calls.withPeer) == key then
                String.trim model.calls.withPeer

            else if String.toLower model.ourNick == key then
                model.ourNick

            else
                key


viewportDecoder : Decode.Decoder ( Int, Int )
viewportDecoder =
    Decode.oneOf
        [ Decode.map2 Tuple.pair
            (Decode.at [ "view", "innerWidth" ] Decode.int)
            (Decode.at [ "view", "innerHeight" ] Decode.int)
        , Decode.succeed ( 0, 0 )
        ]


{-| Enter on the region itself returns to the call; arrows move the
card 16px (Shift 48px) and persist. Escape blurs (ports.js helper).
-}
pipKeyDecoder : String -> Decode.Decoder ( Msg, Bool )
pipKeyDecoder target =
    Decode.map4
        (\key shift region ( w, h ) -> { key = key, shift = shift, region = region, w = w, h = h })
        (Decode.field "key" Decode.string)
        (Decode.oneOf [ Decode.field "shiftKey" Decode.bool, Decode.succeed False ])
        (Decode.oneOf [ Decode.at [ "target", "dataset", "voicePip" ] Decode.string, Decode.succeed "" ])
        viewportDecoder
        |> Decode.andThen
            (\k ->
                if k.key == "Enter" && k.region == "region" then
                    Decode.succeed ( CallsReturnToCall target, True )

                else
                    case CallDock.keyStep { key = k.key, shift = k.shift } of
                        Just step ->
                            Decode.succeed
                                ( CallPipNudge { dx = step.dx, dy = step.dy, width = k.w, height = k.h, persist = True }, True )

                        Nothing ->
                            Decode.fail "not a pip key"
            )


{-| A primary-button pointer move over the (captured) handle drags. -}
pipDragDecoder : Decode.Decoder Msg
pipDragDecoder =
    Decode.map4
        (\buttons mx my ( w, h ) -> { buttons = buttons, mx = mx, my = my, w = w, h = h })
        (Decode.field "buttons" Decode.int)
        (Decode.field "movementX" Decode.float)
        (Decode.field "movementY" Decode.float)
        viewportDecoder
        |> Decode.andThen
            (\d ->
                if d.buttons == 1 && (d.mx /= 0 || d.my /= 0) then
                    Decode.succeed (CallPipNudge { dx = round d.mx, dy = round d.my, width = d.w, height = d.h, persist = False })

                else
                    Decode.fail "not dragging"
            )


pipDragEndDecoder : Decode.Decoder Msg
pipDragEndDecoder =
    Decode.at [ "target", "dataset", "voicePipHandle" ] Decode.string
        |> Decode.map (\_ -> CallPipDragEnd)


{-| The mini voice view (§2.8). -}
pip : Model -> Html Msg
pip model =
    case ( CallDock.pipVisible { hub = model.calls, activeChannel = model.activeChannel, callsOpen = model.callsOpen }, CallUi.callTarget model.calls ) of
        ( True, Just target ) ->
            let
                summary =
                    CallDock.pipSummary
                        { ourNick = model.ourNick
                        , selfMuted = model.callSelfMuted
                        , roster = CallUi.callRoster model.media model.calls
                        , speaking = model.media.speaking
                        , muted = model.media.muted
                        }

                pos =
                    model.callPip

                hidden =
                    summary.total - List.length summary.visible

                muted =
                    model.callSelfMuted

                reconnecting =
                    reconnectingNow model
            in
            section
                [ class "onyx-call-pip-card"
                , attribute "role" "region"
                , attribute "tabindex" "0"
                , attribute "aria-label" ("Mini voice view for " ++ target)
                , attribute "data-testid" "voice-pip"
                , attribute "data-voice-pip" "region"
                , attribute "data-corner" (CallDock.cornerWord pos.corner)
                , attribute "data-reconnecting" (boolAttr reconnecting)
                , style "--pip-ix" (String.fromInt (12 + pos.x) ++ "px")
                , style "--pip-iy" (String.fromInt (12 + pos.y) ++ "px")
                , preventDefaultOn "keydown" (pipKeyDecoder target)
                ]
                [ div
                    [ class "onyx-call-pip-handle"
                    , attribute "data-voice-pip-handle" "true"
                    , on "pointermove" pipDragDecoder
                    , on "pointerup" pipDragEndDecoder
                    ]
                    [ span
                        [ class "onyx-call-pip"
                        , attribute "data-state"
                            (if reconnecting || model.calls.startedAt == Nothing then
                                "provisional"

                             else
                                "live"
                            )
                        ]
                        []
                    , span [ class "onyx-call-pip-where" ] [ text target ]
                    , span
                        [ class "onyx-call-pip-live"
                        , attribute "aria-label" (CallDock.pipLiveAria summary.speaking)
                        ]
                        [ text (CallDock.pipLiveLabel summary.speaking) ]
                    , button
                        [ type_ "button"
                        , class "onyx-call-pip-corner"
                        , attribute "data-testid" "voice-pip-corner"
                        , attribute "aria-label" "Move mini view to next corner"
                        , title "Move to next corner"
                        , onClick CallPipCycle
                        ]
                        [ callIcon "corner" ]
                    ]
                , div [ class "onyx-call-pip-body" ]
                    [ span
                        [ class "onyx-call-faces onyx-call-pip-faces"
                        , attribute "aria-label" (String.fromInt summary.total ++ " voice participants")
                        , attribute "role" "img"
                        ]
                        (List.map
                            (\face ->
                                span
                                    [ class "onyx-call-avatar onyx-call-avatar-sm"
                                    , attribute "data-speaking" (boolAttr face.speaking)
                                    , attribute "data-muted" (boolAttr face.muted)
                                    , title (displayName model face.key)
                                    ]
                                    [ text (initialOf (displayName model face.key)) ]
                            )
                            summary.visible
                            ++ (if hidden > 0 then
                                    [ span [ class "onyx-call-pip-more" ] [ text ("+" ++ String.fromInt hidden) ] ]

                                else
                                    []
                               )
                        )
                    , button
                        [ type_ "button"
                        , class "onyx-call-btn onyx-call-pip-btn"
                        , attribute "data-testid" "voice-pip-mute"
                        , attribute "aria-pressed" (boolAttr muted)
                        , attribute "aria-label"
                            (if muted then
                                "Unmute microphone"

                             else
                                "Mute microphone"
                            )
                        , disabled reconnecting
                        , onClick CallToggleMute
                        ]
                        [ callIcon
                            (if muted then
                                "mic-off"

                             else
                                "mic"
                            )
                        , span [ class "onyx-call-pip-cap" ]
                            [ text
                                (if muted then
                                    "Unmute"

                                 else
                                    "Mute"
                                )
                            ]
                        ]
                    , button
                        [ type_ "button"
                        , class "onyx-call-btn onyx-call-btn-ghost onyx-call-pip-btn"
                        , attribute "data-testid" "voice-pip-return"
                        , attribute "aria-label" ("Return to call in " ++ target)
                        , onClick (CallsReturnToCall target)
                        ]
                        [ text "Return" ]
                    , button
                        [ type_ "button"
                        , class "onyx-call-btn onyx-call-btn-danger onyx-call-pip-btn onyx-call-pip-leave"
                        , attribute "data-testid" "voice-pip-leave"
                        , attribute "aria-label" "Leave voice call"
                        , onClick CallLeave
                        ]
                        [ text "Leave" ]
                    ]
                ]

        _ ->
            text ""


boolAttr : Bool -> String
boolAttr b =
    if b then
        "true"

    else
        "false"



-- C10 · RECOVERY


{-| Derived reconnecting state (§2.14). -}
reconnectingNow : Model -> Bool
reconnectingNow model =
    CallDock.reconnecting model.calls (model.connection == App.Live)


{-| "Connection lost." stage banner (`role="alert"`, bad border, one
action: Leave). Nothing unless reconnecting.
-}
lostBanner : Model -> Html Msg
lostBanner model =
    if reconnectingNow model then
        div
            [ class "onyx-call-lost"
            , attribute "role" "alert"
            , attribute "data-testid" "call-connection-lost"
            ]
            [ span [ class "onyx-call-lost-icon" ] [ callIcon "warn" ]
            , div [ class "onyx-call-lost-copy" ]
                [ strong [] [ text "Connection lost." ]
                , text " "
                , span [] [ text (CallDock.lostDetail (CallUi.callTarget model.calls |> Maybe.withDefault "the call")) ]
                ]
            , button
                [ type_ "button"
                , class "onyx-call-btn"
                , attribute "data-testid" "call-connection-lost-leave"
                , attribute "aria-label" "Leave voice call"
                , onClick CallLeave
                ]
                [ text "Leave" ]
            ]

    else
        text ""


{-| Polite recovery announcer ("Reconnected"); always mounted. -}
recoveryAnnouncer : Model -> Html Msg
recoveryAnnouncer model =
    div
        [ class "sr-only"
        , attribute "role" "status"
        , attribute "aria-live" "polite"
        , attribute "aria-atomic" "true"
        , attribute "data-testid" "call-recovery-announcer"
        ]
        [ text model.callRecoveryNote ]

