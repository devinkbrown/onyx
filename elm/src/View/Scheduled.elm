module View.Scheduled exposing (scheduledSheet)

{-| Scheduled "send later" queue sheet: every owned message waiting to
dispatch (room or DM, text, send time, live state) with a per-entry
cancel. Gated on `showScheduledMessages`; focus-trap/Escape handling
stays with the ports layer's DOM concerns like the other overlays,
while the global Escape key closes the sheet through
`SetShowScheduledMessages`.

Row state and copy mirror `ScheduledMessagesSheet.tsx`; timestamps
use the UTC send label (`App.scheduleSendLabel`) with the exact
instant on the `time` element.
-}

import App exposing (Model, Msg(..))
import Html exposing (Html, a, button, div, li, p, span, strong, text, time, ul)
import Html.Attributes exposing (attribute, class, href, type_)
import Html.Events exposing (onClick)
import Schedule
import RuntimeDomain
import String


scheduledSheet : Model -> Html Msg
scheduledSheet model =
    if not model.showScheduledMessages then
        text ""

    else
        let
            rows =
                App.ownedScheduledMessages model

            runtimeSnapshot =
                case model.scheduledObservationView of
                    Just view ->
                        Just
                            { mode = Just view.mode
                            , legacyHeldCount = view.legacyHeldCount
                            , legacyReviewUnavailable = view.legacyReviewUnavailable
                            , ready = True
                            , items = view.items
                            }

                    Nothing ->
                        model.runtimeDomainResult
                            |> Maybe.andThen
                                (\result ->
                                    if result.domain == "scheduled" && result.action == "list" then
                                        Just
                                            { mode = result.scheduledMode
                                            , legacyHeldCount = result.scheduledLegacyHeldCount
                                            , legacyReviewUnavailable = result.scheduledLegacyReviewUnavailable
                                            , ready = result.scheduledViewReady
                                            , items = result.scheduledItems
                                            }

                                    else
                                        Nothing
                                )

            runtimeRows =
                Maybe.map .items runtimeSnapshot

            now =
                floor model.nowMs

            connected =
                model.connection == App.Live
        in
        div [ class "onyx-scheduled-wrap" ]
            [ div [ class "onyx-scheduled", attribute "role" "dialog", attribute "aria-modal" "true", attribute "aria-label" "Scheduled messages" ]
                [ div [ class "onyx-scheduled-head" ]
                    [ span [ class "onyx-scheduled-title" ] [ text "Scheduled messages" ]
                    , button
                        [ type_ "button"
                        , class "onyx-scheduled-close"
                        , attribute "aria-label" "Close scheduled messages"
                        , onClick (SetShowScheduledMessages False)
                        ]
                        [ text "×" ]
                    ]
                , p [ class "onyx-scheduled-desc" ]
                    [ text "Messages waiting for their scheduled time. Durable messages use private local custody; volatile guest messages remain only for this connection." ]
                , case runtimeSnapshot of
                    Just snapshot ->
                        if snapshot.mode == Just "volatile" then
                            p [ class "onyx-scheduled-uncertain", attribute "role" "status" ]
                                [ text "These scheduled messages exist only in this connection's memory. They are lost when this connection ends, and are dispatched only after an explicit current-connection check." ]

                        else
                            text ""

                    Nothing ->
                        text ""
                , case runtimeSnapshot of
                    Just snapshot ->
                        if snapshot.legacyHeldCount > 0 then
                            p [ class "onyx-scheduled-uncertain", attribute "role" "status" ]
                                [ text (String.fromInt snapshot.legacyHeldCount ++ " older scheduled item(s) are held for review. Their content and ownership were not imported.") ]

                        else if snapshot.legacyReviewUnavailable then
                            p [ class "onyx-scheduled-uncertain", attribute "role" "status" ]
                                [ text "Some older scheduled data could not be safely associated with an owner. It remains unavailable for review and was not imported." ]

                        else
                            text ""

                    Nothing ->
                        text ""
                , case runtimeRows of
                    Just items ->
                        if not (Maybe.withDefault False (Maybe.map .ready runtimeSnapshot)) then
                            p [ class "onyx-scheduled-uncertain", attribute "role" "status" ]
                                [ text "Scheduled-message storage status is unavailable, so no entries or ownership details can be shown safely." ]

                        else if List.isEmpty items then
                            p [ class "onyx-scheduled-empty" ]
                                [ strong [] [ text "No scheduled messages." ]
                                , span [] [ text "Scheduled content stays encrypted in local custody until it is handed to the delivery journal." ]
                                ]

                        else
                            ul [ class "onyx-scheduled-list", attribute "aria-label" "Scheduled message metadata" ]
                                (List.map runtimeScheduledRow items)

                    Nothing ->
                        if List.isEmpty rows then
                            p [ class "onyx-scheduled-empty" ]
                                [ strong [] [ text "No scheduled messages." ]
                                , span [] [ text "Use Send later in the composer to save a message through private local custody." ]
                                ]

                        else
                            ul [ class "onyx-scheduled-list", attribute "aria-label" "Pending scheduled messages" ]
                                (List.map (scheduledRow model now connected) rows)
                ]
            ]


runtimeScheduledRow : RuntimeDomain.ScheduledItem -> Html Msg
runtimeScheduledRow item =
    let
        dueLabel =
            Maybe.withDefault "Unknown conversation" item.conversationId
                ++ (Maybe.map (\instant -> " · " ++ App.millisToIso (toFloat instant)) item.dueAtMs
                        |> Maybe.withDefault ""
                   )

        stateLabel =
            case item.state of
                "scheduled" ->
                    "Scheduled"

                "dispatching" ->
                    "Checking delivery status"

                "delivery-unknown" ->
                    "Delivery outcome unknown"

                "policy-review" ->
                    "Review required before dispatch"

                "legacy-review" ->
                    "Review required"

                _ ->
                    "Status unavailable"

        editButton =
            case item.revision of
                Just expectedRevision ->
                    case item.conversationId of
                        Just target ->
                            case item.dueAtMs of
                                Just dueAtMs ->
                                    case item.messageKind of
                                        Just messageKind ->
                                            if item.state == "scheduled" || item.state == "policy-review" then
                                                button
                                                    [ type_ "button"
                                                    , class "onyx-scheduled-edit"
                                                    , attribute "aria-label"
                                                        ((if item.state == "policy-review" then "Review" else "Edit") ++ " scheduled message for " ++ target)
                                                    , onClick
                                                        (EditRuntimeScheduledMessage
                                                            { scheduleRef = item.scheduleRef
                                                            , revision = expectedRevision
                                                            , target = target
                                                            , dueAtMs = dueAtMs
                                                            , messageKind = messageKind
                                                            , replyTo = item.replyTo
                                                            , audiencePrefix = item.audiencePrefix
                                                            }
                                                        )
                                                    ]
                                                    [ text (if item.state == "policy-review" then "Review" else "Edit") ]

                                            else
                                                text ""

                                        Nothing ->
                                            text ""

                                Nothing ->
                                    text ""

                        Nothing ->
                            text ""

                Nothing ->
                    text ""

        statusButton =
            case item.revision of
                Just expectedRevision ->
                    if item.state == "delivery-unknown" || item.state == "dispatching" then
                        button
                            [ type_ "button"
                            , class "onyx-scheduled-status"
                            , attribute "aria-label" ("Check delivery status for " ++ dueLabel)
                            , onClick (CheckRuntimeScheduledMessageStatus { scheduleRef = item.scheduleRef, revision = expectedRevision })
                            ]
                            [ text "Check status" ]

                    else
                        text ""

                Nothing ->
                    text ""

        cancelButton =
            case item.revision of
                Just expectedRevision ->
                    button
                        [ type_ "button"
                        , class "onyx-scheduled-cancel"
                        , attribute "aria-label" ("Cancel scheduled message for " ++ dueLabel)
                        , onClick (CancelRuntimeScheduledMessage { scheduleRef = item.scheduleRef, revision = expectedRevision })
                        ]
                        [ text "Cancel" ]

                Nothing ->
                    text ""
    in
    li [ class "onyx-scheduled-item" ]
        [ div [ class "onyx-scheduled-meta" ]
            [ span [ class "onyx-scheduled-channel" ] [ text dueLabel ]
            , span [ class "onyx-scheduled-state", attribute "role" "status" ] [ text stateLabel ]
            , if item.mode == "volatile" then
                span [ class "onyx-scheduled-mode" ] [ text "Current connection only" ]
              else
                text ""
            ]
        , p [ class "onyx-scheduled-text" ] [ text "Message content is encrypted and not shown in this list." ]
        , div [ class "onyx-scheduled-actions" ] [ editButton, statusButton, cancelButton ]
        , if item.state == "delivery-unknown" then
            p [ class "onyx-scheduled-uncertain", attribute "role" "status" ] [ text "This scheduled delivery has an unresolved journal outcome. Checking status will only reconcile its existing record; it will not send again." ]
          else if item.state == "policy-review" then
            p [ class "onyx-scheduled-uncertain", attribute "role" "status" ] [ text "Review the saved message before dispatch. Policy changed after it was scheduled." ]
          else
            text ""
        ]


scheduledRow : Model -> Int -> Bool -> Schedule.ScheduledMessage -> Html Msg
scheduledRow model now connected row =
    let
        isChannel =
            App.isChannelName model row.channel

        uncertain =
            row.claim /= Nothing

        state =
            Schedule.classifyScheduledMessage
                { sendAt = row.sendAt
                , now = now
                , connected = connected
                , protected = App.scheduledRowProtected model row
                , encryptionRequired = App.scheduledRowEncryptionRequired model row
                }

        instant =
            App.millisToIso (toFloat row.sendAt)

        cancelLabel =
            (if uncertain then
                "Remove uncertain scheduled message"

             else
                "Cancel scheduled message"
            )
                ++ " to "
                ++ row.channel
                ++ ": "
                ++ String.left 40 row.text
    in
    li [ class "onyx-scheduled-item" ]
        [ div [ class "onyx-scheduled-meta" ]
            [ span [ class "onyx-scheduled-channel" ]
                [ text
                    ((if isChannel then
                        "Room"

                      else
                        "Direct message"
                     )
                        ++ " · "
                        ++ row.channel
                    )
                ]
            , time [ class "onyx-scheduled-when", attribute "datetime" instant, attribute "title" instant ]
                [ text (App.scheduleSendLabel row.sendAt now) ]
            ]
        , p [ class "onyx-scheduled-text" ] [ text row.text ]
        , div [ class "onyx-scheduled-actions" ]
            [ span [ class "onyx-scheduled-state", attribute "role" "status" ]
                [ text (Schedule.scheduledRowStateLabel uncertain state) ]
            , if isChannel then
                a
                    [ class "onyx-scheduled-ledger"
                    , href (App.statsRoomHref row.channel)
                    , attribute "aria-label" ("Room ledger for " ++ row.channel)
                    ]
                    [ text "Room ledger" ]

              else
                text ""
            , button
                [ type_ "button"
                , class "onyx-scheduled-cancel"
                , attribute "aria-label" cancelLabel
                , onClick (CancelScheduledMessage { id = row.id })
                ]
                [ text
                    (if uncertain then
                        "Remove row"

                     else
                        "Cancel"
                    )
                ]
            ]
        , if uncertain then
            p [ class "onyx-scheduled-uncertain" ]
                [ text "Sending was attempted. Removing this row cannot confirm or undo delivery." ]

          else
            text ""
        ]
