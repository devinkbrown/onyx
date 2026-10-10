module View.StageMode exposing
    ( audienceBarCenter
    , audienceLine
    , callStageRoom
    , endStageButton
    , handsSheet
    , keys
    , leaveConfirm
    , liveFor
    , onStage
    , panel
    , selfSpeaker
    , statusOverride
    )

{-| v3/calls-c11 — C11 stage mode (`CALLS_DESIGN.md` §2.16, oracle
`shell/StagePanel.tsx`) and the C12 `aria-keyshortcuts` table.

  - `panel`: the room's stage strip (oracle StagePanel copy, actions,
    speak-invite alert and the host's raised-hands queue). Under 768px
    the queue collapses to "M raised hands", which opens `handsSheet`.
  - Inside a call whose room is a live stage: speakers keep their
    cells / tiles (`onStage`), the audience becomes one facepile line
    (`audienceLine`), the status line reads "Stage is live · …", the
    security chip is forced to "Stage broadcast" and the audience's bar
    centre swaps to Raise hand / Leave stage (`audienceBarCenter`).
  - `leaveConfirm`: the Ctrl+Shift+L confirmation (more than two
    people in the call).

Honesty: the server has no stage verb, so "Dismiss" on a raised hand is
local to this host's queue, and the speaker role is the room's `+v`.

-}

import App exposing (Model, Msg(..))
import CallUi
import Dict
import Html exposing (Html, button, div, h2, li, p, section, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, disabled, id, type_)
import Html.Events exposing (onClick)
import Media
import Set exposing (Set)
import Stage
import View.CallPresence exposing (callIcon)
import View.Sheet as Sheet


{-| `aria-keyshortcuts` values for the call chords (spec §3.1). -}
keys : { mute : String, camera : String, hand : String, leave : String, layout : String, size : String }
keys =
    { mute = "Control+Shift+M Meta+Shift+M"
    , camera = "Control+Shift+E Meta+Shift+E"
    , hand = "Control+Shift+H Meta+Shift+H"
    , leave = "Control+Shift+L Meta+Shift+L"
    , layout = "Control+Shift+G Meta+Shift+G"
    , size = "Control+Shift+F Meta+Shift+F"
    }


boolAttr : Bool -> String
boolAttr b =
    if b then
        "true"

    else
        "false"


propOn : Model -> String -> Bool
propOn model room =
    case Dict.get (String.toLower room) model.props.channelProps of
        Just props ->
            Stage.propOn (Dict.get "STAGE" props) || Stage.propOn (Dict.get "stage" props)

        Nothing ->
            False


moderated : Model -> String -> Bool
moderated model room =
    Dict.get (String.toLower room) model.channels
        |> Maybe.map (\ch -> String.contains "m" ch.modes)
        |> Maybe.withDefault False


memberModes : Model -> String -> String -> Maybe (Set Char)
memberModes model room key =
    Dict.get (String.toLower room) model.channels
        |> Maybe.andThen (\ch -> Dict.get (String.toLower key) ch.members)
        |> Maybe.map .modes


{-| The room is a live stage (oracle `live`: held here, or `PROP STAGE`). -}
liveFor : Model -> String -> Bool
liveFor model room =
    Stage.activeFor model.stage room || propOn model room


{-| The call's room when it is a live stage. -}
callStageRoom : Model -> Maybe String
callStageRoom model =
    if model.calls.lifecycle == Media.Idle then
        Nothing

    else
        case model.calls.channel of
            Just room ->
                if liveFor model room then
                    Just room

                else
                    Nothing

            Nothing ->
                Nothing


selfSpeaker : Model -> String -> Bool
selfSpeaker model room =
    (Stage.activeFor model.stage room && model.stage.isSpeaker)
        || (memberModes model room model.ourNick |> Maybe.map Stage.isSpeakerModes |> Maybe.withDefault False)


{-| Whether a call participant gets a cell / tile: everyone outside a
stage; on a stage only speakers (voice or better, or our own accepted
speaker role).
-}
onStage : Model -> String -> Bool
onStage model key =
    case callStageRoom model of
        Nothing ->
            True

        Just room ->
            if String.toLower key == String.toLower model.ourNick then
                selfSpeaker model room

            else
                memberModes model room key |> Maybe.map Stage.isSpeakerModes |> Maybe.withDefault False


{-| Stage status line for an established stage call. -}
statusOverride : Model -> Maybe String
statusOverride model =
    callStageRoom model |> Maybe.map (\room -> Stage.statusLine (selfSpeaker model room))


initialOf : String -> String
initialOf name =
    String.left 1 (String.toUpper (String.filter Char.isAlphaNum name ++ name))


displayName : Model -> String -> String -> String
displayName model room key =
    Dict.get (String.toLower room) model.channels
        |> Maybe.andThen (\ch -> Dict.get (String.toLower key) ch.members)
        |> Maybe.map .nick
        |> Maybe.withDefault key


{-| "Audience · N listening · M raised hands" under the stage: a
facepile line, never tiles.
-}
audienceLine : Model -> Html Msg
audienceLine model =
    case callStageRoom model of
        Nothing ->
            text ""

        Just room ->
            let
                audience =
                    CallUi.callRoster model.media model.calls
                        |> List.filter (\k -> not (onStage model k))

                hands =
                    if Stage.activeFor model.stage room then
                        List.length model.stage.raisedHands

                    else
                        0
            in
            div [ class "onyx-stage-audience", attribute "data-testid" "stage-audience" ]
                [ span [ class "onyx-call-faces", attribute "aria-hidden" "true" ]
                    (List.map
                        (\k -> span [ class "onyx-call-avatar onyx-call-avatar-sm" ] [ text (initialOf (displayName model room k)) ])
                        (List.take 5 audience)
                    )
                , span [] [ text (Stage.audienceLine (List.length audience) hands) ]
                ]


handButton : Model -> String -> Html Msg
handButton model cls =
    let
        raised =
            model.stage.handRaised
    in
    button
        [ type_ "button"
        , class cls
        , attribute "data-tone" "warn"
        , attribute "data-testid" "stage-hand"
        , attribute "aria-pressed" (boolAttr raised)
        , attribute "aria-keyshortcuts" keys.hand
        , disabled (model.connection /= App.Live)
        , onClick StageHandToggle
        ]
        [ callIcon "hand"
        , span [ class "onyx-cbtn-cap" ]
            [ text
                (if raised then
                    "Lower hand"

                 else
                    "Raise hand"
                )
            ]
        ]


{-| The audience's bar centre (spec §2.16): Raise / Lower hand, Leave
stage, then the usual Leave. `Nothing` for speakers and outside a
stage this client holds.
-}
audienceBarCenter : Model -> Html Msg -> Maybe (List (Html Msg))
audienceBarCenter model leaveCall =
    case callStageRoom model of
        Just room ->
            if Stage.activeFor model.stage room && not (selfSpeaker model room) then
                Just
                    [ handButton model "onyx-cbtn onyx-cbtn-wide"
                    , button
                        [ type_ "button"
                        , class "onyx-cbtn onyx-cbtn-wide"
                        , attribute "data-testid" "stage-bar-leave"
                        , onClick StageLeave
                        ]
                        [ callIcon "x", span [ class "onyx-cbtn-cap" ] [ text "Leave stage" ] ]
                    , leaveCall
                    ]

            else
                Nothing

        Nothing ->
            Nothing


{-| Hosts additionally get "End stage" in the bar. -}
endStageButton : Model -> Html Msg
endStageButton model =
    case callStageRoom model of
        Just room ->
            if Stage.activeFor model.stage room && model.stage.isHost then
                button
                    [ type_ "button"
                    , class "onyx-cbtn onyx-cbtn-wide"
                    , attribute "data-testid" "stage-bar-end"
                    , onClick StageEnd
                    ]
                    [ callIcon "stage", span [ class "onyx-cbtn-cap" ] [ text "End stage" ] ]

            else
                text ""

        Nothing ->
            text ""


btn : String -> String -> List (Html.Attribute Msg) -> String -> Html Msg
btn variant testid attrs label =
    button ([ type_ "button", class ("onyx-call-btn " ++ variant), attribute "data-testid" testid ] ++ attrs) [ text label ]


handRows : Model -> List (Html Msg)
handRows model =
    List.map
        (\nick ->
            li [ class "onyx-stage-hand-row" ]
                [ span [ class "onyx-call-avatar onyx-call-avatar-sm", attribute "aria-hidden" "true" ] [ text (initialOf nick) ]
                , span [ class "onyx-stage-hand-nick" ] [ text nick ]
                , btn "onyx-call-btn-primary"
                    ("stage-invite-" ++ nick)
                    [ attribute "aria-label" ("Invite " ++ nick ++ " to speak")
                    , disabled (model.connection /= App.Live)
                    , onClick (StageInvite nick)
                    ]
                    "Invite to speak"
                , btn "onyx-call-btn-ghost"
                    ("stage-dismiss-" ++ nick)
                    [ attribute "aria-label" ("Dismiss " ++ nick ++ "'s raised hand")
                    , onClick (StageDismissHand nick)
                    ]
                    "Dismiss"
                ]
        )
        model.stage.raisedHands


{-| The room's stage strip (oracle `StagePanel`). Shown when the room
is a live stage, or to ops (dormant strip with "Start stage").
-}
panel : Model -> String -> Html Msg
panel model room =
    let
        here =
            Stage.activeFor model.stage room

        propLive =
            propOn model room

        live =
            here || propLive

        isOp =
            App.isChannelOp model room

        connected =
            model.connection == App.Live

        speaker =
            selfSpeaker model room

        hands =
            if here then
                model.stage.raisedHands

            else
                []

        handCount =
            List.length hands

        hint =
            if live then
                (if speaker then
                    "You are a speaker."

                 else
                    "You are in the audience."
                )
                    ++ (if moderated model room then
                            " Room is moderated (+m)."

                        else
                            ""
                       )
                    ++ (if handCount > 0 then
                            " "
                                ++ String.fromInt handCount
                                ++ (if handCount == 1 then
                                        " raised hand."

                                    else
                                        " raised hands."
                                   )

                        else
                            ""
                       )
                    ++ " Speaking role and microphone access are managed separately."

            else if connected then
                "Stage is available here. Start one to host speakers with a raised-hand queue."

            else
                "Stage is unavailable while Onyx reconnects. Your room is unchanged."
    in
    if not (App.isChannelName model room) || not (live || isOp) then
        text ""

    else
        section
            [ class "onyx-stage-panel"
            , attribute "data-testid" "stage-panel"
            , attribute "data-active" (boolAttr live)
            , attribute "data-availability"
                (if connected then
                    "available"

                 else
                    "unavailable"
                )
            , attribute "aria-labelledby" "stage-panel-title"
            , attribute "aria-describedby" "stage-panel-hint"
            ]
            [ div [ class "onyx-stage-head" ]
                [ h2 [ class "onyx-stage-title", id "stage-panel-title" ] [ callIcon "stage", text "Stage" ]
                , p [ class "onyx-stage-hint", id "stage-panel-hint" ] [ text hint ]
                , span
                    [ class "onyx-stage-availability"
                    , attribute "role" "status"
                    , attribute "aria-live" "polite"
                    , attribute "aria-label"
                        (if connected then
                            "Stage controls available"

                         else
                            "Stage controls unavailable while reconnecting"
                        )
                    ]
                    [ text
                        (if connected then
                            "Available"

                         else
                            "Unavailable · reconnecting"
                        )
                    ]
                ]
            , div [ class "onyx-stage-actions", attribute "role" "group", attribute "aria-label" "Stage actions" ]
                [ if not live && isOp then
                    btn "onyx-call-btn-primary" "stage-start" [ disabled (not connected), onClick (StageStart room) ] "Start stage"

                  else
                    text ""
                , if (propLive || moderated model room) && not here then
                    btn "onyx-call-btn-ghost" "stage-join" [ disabled (not connected), onClick (StageJoinAudience room) ] "Join as audience"

                  else
                    text ""
                , if here && model.stage.isHost then
                    btn "onyx-call-btn-danger" "stage-end" [ onClick StageEnd ] "End stage"

                  else
                    text ""
                , if here && not model.stage.isHost then
                    btn "onyx-call-btn-ghost" "stage-leave" [ onClick StageLeave ] "Leave stage"

                  else
                    text ""
                , if here && not speaker then
                    btn "onyx-call-btn-ghost"
                        "stage-panel-hand"
                        [ disabled (not connected)
                        , attribute "aria-pressed" (boolAttr model.stage.handRaised)
                        , attribute "aria-keyshortcuts" keys.hand
                        , onClick StageHandToggle
                        ]
                        (if model.stage.handRaised then
                            "Lower hand"

                         else
                            "Raise hand"
                        )

                  else
                    text ""
                ]
            , case ( here, model.stage.pendingInvite ) of
                ( True, Just from ) ->
                    div [ class "onyx-stage-invite", attribute "role" "alert", attribute "data-testid" "stage-invite" ]
                        [ p [] [ strong [] [ text from ], text " invited you to speak." ]
                        , div [ class "onyx-stage-actions" ]
                            [ btn "onyx-call-btn-primary" "stage-accept" [ onClick StageAccept ] "Accept"
                            , btn "onyx-call-btn-ghost" "stage-decline" [ onClick StageDecline ] "Decline"
                            ]
                        ]

                _ ->
                    text ""
            , if here && model.stage.isHost && handCount > 0 then
                div [ class "onyx-stage-queue" ]
                    [ ul [ class "onyx-stage-hands", attribute "aria-label" "Raised hands", attribute "data-testid" "stage-hands" ]
                        (handRows model)
                    , button
                        [ type_ "button"
                        , class "onyx-call-btn onyx-stage-hands-open"
                        , attribute "aria-haspopup" "dialog"
                        , attribute "aria-expanded" (boolAttr model.stageHandsOpen)
                        , attribute "data-testid" "stage-hands-open"
                        , onClick StageHandsOpen
                        ]
                        [ callIcon "hand"
                        , text
                            (String.fromInt handCount
                                ++ (if handCount == 1 then
                                        " raised hand"

                                    else
                                        " raised hands"
                                   )
                            )
                        ]
                    ]

              else
                text ""
            ]


{-| 375px: the host's raised-hands queue as a bottom sheet. -}
handsSheet : Model -> Html Msg
handsSheet model =
    if App.overlayStack model |> List.any (\( key, _ ) -> key == "stage-hands") then
        Sheet.view
            { scope = "stage-hands"
            , label = Sheet.LabelledBy (Sheet.titleId "stage-hands")
            , onClose = StageHandsClose
            , placement = Sheet.Center
            , layerClass = "onyx-call-sheet-layer"
            , panelClass = "onyx-call-sheet onyx-stage-hands-sheet"
            , backdropClass = "onyx-call-sheet-backdrop"
            , layerAttrs = []
            , modal = True
            , attrs = [ attribute "data-testid" "stage-hands-sheet" ]
            }
            [ Sheet.header { scope = "stage-hands", title = "Raised hands", closeLabel = "Close raised hands", onClose = StageHandsClose, closeTestId = Nothing }
            , ul [ class "onyx-stage-hands onyx-stage-hands-sheet-list", attribute "aria-label" "Raised hands" ] (handRows model)
            ]

    else
        text ""


{-| Ctrl+Shift+L with more than two people: confirm before leaving. -}
leaveConfirm : Model -> Html Msg
leaveConfirm model =
    if App.overlayStack model |> List.any (\( key, _ ) -> key == "call-leave-confirm") then
        let
            others =
                CallUi.callRoster model.media model.calls
                    |> List.filter (\k -> String.toLower k /= String.toLower model.ourNick)
                    |> List.length

            where_ =
                CallUi.callTarget model.calls |> Maybe.withDefault "the call"
        in
        Sheet.view
            { scope = "call-leave-confirm"
            , label = Sheet.LabelledBy (Sheet.titleId "call-leave-confirm")
            , onClose = CallLeaveConfirmClose
            , placement = Sheet.Center
            , layerClass = "onyx-call-sheet-layer"
            , panelClass = "onyx-call-sheet onyx-call-leave-confirm"
            , backdropClass = "onyx-call-sheet-backdrop"
            , layerAttrs = []
            , modal = True
            , attrs = [ attribute "aria-describedby" "call-leave-confirm-sub", attribute "data-testid" "call-leave-confirm" ]
            }
            [ div [ class "onyx-call-sheet-body" ]
                [ h2 [ id (Sheet.titleId "call-leave-confirm") ] [ text "Leave the call?" ]
                , p [ id "call-leave-confirm-sub", class "onyx-call-dim" ]
                    [ text
                        (String.fromInt others
                            ++ (if others == 1 then
                                    " other person is"

                                else
                                    " other people are"
                               )
                            ++ " still in "
                            ++ where_
                            ++ ". You can rejoin from the room."
                        )
                    ]
                , div [ class "onyx-stage-actions" ]
                    [ btn "onyx-call-btn-ghost" "call-leave-stay" [ Sheet.autofocus "call-leave-confirm", onClick CallLeaveConfirmClose ] "Stay"
                    , btn "onyx-call-btn-danger" "call-leave-confirmed" [ onClick CallLeaveConfirmed ] "Leave call"
                    ]
                ]
            ]

    else
        text ""
