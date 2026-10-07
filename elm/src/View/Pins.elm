module View.Pins exposing (pinsDrawer)

{-| Pinned-messages drawer: the channel's IRCX `PINS` prop resolved
against the loaded buffer, with jump-to-message and op-gated unpin.
-}

import App exposing (Model, Msg(..))
import Html exposing (Html, a, button, div, li, p, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, href)
import Html.Events exposing (onClick)


pinsDrawer : Model -> Html Msg
pinsDrawer model =
    if not model.showPinnedMessages then
        text ""

    else
        div [ class "onyx-pins-veil" ]
            [ div
                [ class "pins-panel"
                , attribute "role" "dialog"
                , attribute "aria-modal" "true"
                , attribute "aria-label" "Pinned messages"
                , attribute "data-testid" "pinned-messages"
                ]
                ([ div [ class "pins-head" ]
                    [ span [ class "pins-title" ] [ text "Pinned messages" ]
                    , button
                        [ attribute "type" "button"
                        , class "pins-close"
                        , attribute "aria-label" "Close pinned messages"
                        , onClick PinnedMessagesClose
                        ]
                        [ text "✕" ]
                    ]
                 ]
                    ++ contextBlock model
                    ++ feedbackBlock model
                    ++ [ pinsList model ]
                )
            ]


contextBlock : Model -> List (Html Msg)
contextBlock model =
    case model.activeChannel of
        Nothing ->
            []

        Just channel ->
            [ div [ class "pins-context", attribute "data-testid" "pins-context" ]
                [ div [ class "pins-context-copy" ]
                    [ span [ class "pins-context-kicker" ] [ text "Shared in" ]
                    , text " "
                    , strong [] [ text channel ]
                    ]
                ]
            , if isLedgerChannel channel then
                a
                    [ class "pins-ledger shell-ribbon-stats"
                    , href (App.statsRoomHref channel)
                    , attribute "aria-label" ("Room ledger for " ++ channel)
                    , attribute "data-testid" "pins-channel-ledger"
                    ]
                    [ text "Room ledger" ]

              else
                text ""
            ]


isLedgerChannel : String -> Bool
isLedgerChannel channel =
    case String.uncons (String.trim channel) of
        Just ( first, _ ) ->
            first == '#' || first == '&'

        Nothing ->
            False


feedbackBlock : Model -> List (Html Msg)
feedbackBlock model =
    if String.isEmpty model.pinsLoadFeedback then
        []

    else
        [ p
            [ class "pins-load-feedback"
            , attribute "role" "alert"
            , attribute "aria-live" "assertive"
            , attribute "data-testid" "pins-load-feedback"
            ]
            [ text model.pinsLoadFeedback ]
        ]


pinsList : Model -> Html Msg
pinsList model =
    case model.activeChannel of
        Nothing ->
            pinsEmpty model Nothing

        Just channel ->
            let
                ids =
                    List.reverse (App.channelPins model channel)
            in
            if List.isEmpty ids then
                pinsEmpty model (Just channel)

            else
                ul
                    [ class "pins-list"
                    , attribute "role" "list"
                    , attribute "aria-label" ("Pinned messages in " ++ channel)
                    ]
                    (List.map (pinRow model channel) ids)


pinsEmpty : Model -> Maybe String -> Html Msg
pinsEmpty model _ =
    let
        canManage =
            case model.activeChannel of
                Just channel ->
                    App.isChannelOp model channel

                Nothing ->
                    False
    in
    p [ class "pins-empty" ]
        [ text
            (if canManage then
                "No pins yet. Pin a message from its ⋯ menu."

             else
                "Ops can pin important messages here."
            )
        ]


pinRow : Model -> String -> String -> Html Msg
pinRow model channel id =
    let
        row =
            App.reactionRow model channel id

        label =
            case row of
                Just message ->
                    "Jump to pinned message from " ++ message.from ++ ": " ++ clip (App.displayBody message)

                Nothing ->
                    "Load pinned message " ++ id
    in
    li [ class "pins-list-item" ]
        [ button
            [ attribute "type" "button"
            , class "pins-item"
            , attribute "aria-label" label
            , onClick (PinnedMessageJump { channel = channel, messageId = id })
            ]
            [ case row of
                Nothing ->
                    span [ class "pins-item-body pins-item-body--missing" ]
                        [ text "Pinned message — load it from history to jump there." ]

                Just message ->
                    let
                        state =
                            App.pinnedMessageState message
                    in
                    span [ class "pins-item-main" ]
                        [ span [ class "pins-item-meta" ]
                            [ strong [ class "pins-item-from" ] [ text message.from ]
                            , span [ class "pins-item-when" ] [ text (App.formatClockUtc message.at) ]
                            , span
                                [ class "pins-item-state"
                                , attribute "data-state" (pinStateName state)
                                ]
                                [ text (App.pinnedMessageStateLabel state) ]
                            ]
                        , span [ class (pinBodyClass state) ] [ text (App.displayBody message) ]
                        ]
            ]
        , if App.isChannelOp model channel then
            button
                [ attribute "type" "button"
                , class "pins-item-unpin"
                , attribute "aria-label" ("Unpin message " ++ id)
                , attribute "title" "Unpin"
                , onClick (PinnedMessageUnpin { channel = channel, messageId = id })
                ]
                [ text "×" ]

          else
            text ""
        ]


pinStateName : App.PinnedMessageState -> String
pinStateName state =
    case state of
        App.PinDeleted ->
            "deleted"

        App.PinLocked ->
            "locked"

        App.PinVisible ->
            "visible"


pinBodyClass : App.PinnedMessageState -> String
pinBodyClass state =
    case state of
        App.PinDeleted ->
            "pins-item-body pins-item-body--deleted"

        App.PinLocked ->
            "pins-item-body pins-item-body--locked"

        App.PinVisible ->
            "pins-item-body"


clip : String -> String
clip text_ =
    if String.length text_ > 80 then
        String.left 77 text_ ++ "..."

    else
        text_
