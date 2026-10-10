module View.ModDesk exposing (deskToggles, moderationSheet, moderationToggle, operSheet, operToggle)

{-| v3/moddesk — the moderation cockpit and the operator desk as sheets.

  - `deskToggles`: the room-level Moderation button (room moderators
    only, via `App.isChannelOp`) and the Operator button (server
    operators only, via `model.isOper`).
  - `moderationSheet`: the room desk (mirroring
    `shell/ModerationCockpit.tsx`) — current-room header, then the
    `View.Bans` body (authority rail, safeguards, invite, member action,
    mask block, timed block, block list, server activity, open wire).
    The member/mask review renders inside the sheet so it is never
    hidden under the veil.
  - `operSheet`: `shell/OperDesk.tsx` (announce / Event Spine
    subscriptions / privileges / reload config / observe / disconnect,
    destructive plans behind an inline review) plus
    `shell/OperEventConsole.tsx` (bounded `EVENT REPLAY JSON`, local
    category / severity / text filters).

Roles read as words ("Room moderator", "IRC operator", "Network
administrator"), never as mode letters.

-}

import App exposing (ConnectionState(..), Model, Msg(..), OperDeskIntent(..), isChannelOp)
import EventReplay exposing (EventReplayEvent)
import Html exposing (Html, button, code, details, div, dl, dd, dt, h3, input, label, li, option, p, section, select, span, summary, text, ul)
import Html.Attributes exposing (attribute, class, disabled, for, id, maxlength, placeholder, selected, type_, value)
import Html.Events exposing (on, onClick, onInput, onSubmit)
import Json.Decode as Decode
import OperDesk
import View.Bans exposing (banPanel)
import View.Profile exposing (moderationReview)
import View.Sheet as Sheet


{-| Topbar entries. Each renders only for the authority it opens. -}
deskToggles : Model -> Html Msg
deskToggles model =
    case moderationToggle model ++ operToggle model of
        [] ->
            text ""

        buttons ->
            span [ class "onyx-moddesk-toggles" ] buttons


{-| v3/frame — the room-scoped Moderation entry (the room header's
More menu); empty unless we moderate the active room.
-}
moderationToggle : Model -> List (Html Msg)
moderationToggle model =
    case model.activeChannel of
        Just channel ->
            if isChannelOp model channel then
                [ button
                    [ type_ "button"
                    , class "onyx-moddesk-toggle"
                    , attribute "aria-pressed" (boolAttr model.moderationOpen)
                    , attribute "aria-label" ("Moderation for " ++ channel)
                    , attribute "data-testid" "moderation-open"
                    , onClick ModerationSheetOpen
                    ]
                    [ text "Moderation" ]
                ]

            else
                []

        Nothing ->
            []


{-| v3/frame — the network-scoped Operator entry (the global topbar);
empty unless we are a server operator.
-}
operToggle : Model -> List (Html Msg)
operToggle model =
    if model.isOper then
        [ button
            [ type_ "button"
            , class "onyx-moddesk-toggle"
            , attribute "aria-pressed" (boolAttr model.operDeskOpen)
            , attribute "data-testid" "oper-desk-open"
            , onClick OperDeskOpen
            ]
            [ text "Operator" ]
        ]

    else
        []


boolAttr : Bool -> String
boolAttr on =
    if on then
        "true"

    else
        "false"


-- MODERATION SHEET


moderationSheet : Model -> Html Msg
moderationSheet model =
    case ( model.moderationOpen, model.activeChannel ) of
        ( True, Just channel ) ->
            sheetFrame
                { close = ModerationSheetClose
                , titleId = "moderation-cockpit-title"
                , testId = "moderation-cockpit"
                , closeLabel = "Close room desk"
                , kicker = "Room safety"
                , title = "Room desk"
                , subtitle = Just channel
                }
                [ p [ class "onyx-moddesk-role" ]
                    [ text
                        (if isChannelOp model channel then
                            "You are a room moderator here."

                         else
                            "You are a member here."
                        )
                    ]
                , banPanel model channel
                , moderationReview model
                ]

        _ ->
            text ""


type alias Frame =
    { close : Msg
    , titleId : String
    , testId : String
    , closeLabel : String
    , kicker : String
    , title : String
    , subtitle : Maybe String
    }


sheetFrame : Frame -> List (Html Msg) -> Html Msg
sheetFrame frame body =
    Sheet.view
        { scope = frame.testId
        , label = Sheet.LabelledBy frame.titleId
        , onClose = frame.close
        , placement = Sheet.Side
        , layerClass = "onyx-moddesk"
        , panelClass = "onyx-moddesk-sheet"
        , backdropClass = "onyx-moddesk-backdrop"
        , layerAttrs = []
        , modal = True
        , attrs = [ attribute "data-testid" frame.testId ]
        }
            -- v3/rx-sheets: the shared pinned head (kicker, title, the
            -- room as subtitle, the one close) for both desks.
            (Sheet.headerWith
                (Sheet.head { scope = frame.testId, title = frame.title, closeLabel = frame.closeLabel, onClose = frame.close }
                    |> (\h ->
                            { h
                                | titleId = Just frame.titleId
                                , kicker = Just frame.kicker
                                , subtitle = frame.subtitle
                                , closeClass = "onyx-moddesk-close"
                                , headClass = "onyx-moddesk-head"
                            }
                       )
                )
                :: body
            )


-- OPERATOR SHEET


operSheet : Model -> Html Msg
operSheet model =
    if model.operDeskOpen && model.isOper then
        sheetFrame
            { close = OperDeskClose
            , titleId = "oper-desk-title"
            , testId = "oper-sheet"
            , closeLabel = "Close operator desk"
            , kicker = "Network"
            , title = "Operator desk"
            , subtitle = Nothing
            }
            [ operDesk model, eventConsole model ]

    else
        text ""


operDesk : Model -> Html Msg
operDesk model =
    let
        desk =
            model.operDesk

        live =
            model.connection == Live

        submitOn intent =
            onSubmit (OperDeskSubmit intent)

        remaining =
            App.maxBroadcastLength - String.length (String.trim desk.broadcast)
    in
    section [ class "oper-desk", attribute "data-testid" "oper-desk", attribute "aria-labelledby" "oper-desk-title" ]
        ([ dl [ class "onyx-moddesk-rail", attribute "aria-label" "Operator authority" ]
            [ div []
                [ dt [] [ text "Role" ]
                , dd [ attribute "data-testid" "oper-desk-role" ] [ text (OperDesk.roleLabel model.isNetworkAdmin) ]
                ]
            , div []
                [ dt [] [ text "Network" ]
                , dd [] [ text "Onyx" ]
                ]
            , div []
                [ dt [] [ text "Signed in as" ]
                , dd []
                    [ text
                        (if String.isEmpty model.ourNick then
                            "Unknown"

                         else
                            model.ourNick
                        )
                    ]
                ]
            ]
         ]
            ++ (if live then
                    []

                else
                    [ p [ class "onyx-moddesk-offline", attribute "role" "status", attribute "data-testid" "oper-desk-offline" ]
                        [ text "Reconnect to send operator commands. Drafts stay on this device." ]
                    ]
               )
            ++ (if List.isEmpty desk.errors then
                    []

                else
                    [ ul [ class "onyx-moddesk-errors", attribute "role" "alert", attribute "data-testid" "oper-desk-errors" ]
                        (List.map (\e -> li [] [ text e ]) desk.errors)
                    ]
               )
            ++ [ Html.form
                    [ class "onyx-moddesk-form"
                    , attribute "data-testid" "oper-desk-broadcast-form"
                    , submitOn (OperBroadcast desk.broadcast)
                    ]
                    [ label [ for "oper-desk-broadcast" ] [ text "Announce to operators" ]
                    , div [ class "onyx-moddesk-row" ]
                        [ input
                            [ id "oper-desk-broadcast"
                            , attribute "data-testid" "oper-desk-broadcast-input"
                            , value desk.broadcast
                            , maxlength App.maxBroadcastLength
                            , attribute "autocomplete" "off"
                            , placeholder "Maintenance at 03:00 UTC"
                            , onInput (OperDeskField OperDesk.Broadcast)
                            ]
                            []
                        , button [ type_ "submit", disabled (not live || String.trim desk.broadcast == "") ]
                            [ text "Review announcement" ]
                        ]
                    , p [ class "onyx-moddesk-hint" ]
                        [ text ("EVENT BROADCAST reaches operators subscribed to ANNOUNCE, not every member. " ++ String.fromInt remaining ++ " characters left.") ]
                    ]
               , Html.form
                    [ class "onyx-moddesk-form"
                    , attribute "data-testid" "oper-desk-events-form"
                    , submitOn (OperEventSubscribe desk.category)
                    ]
                    [ label [ for "oper-desk-category" ] [ text "Event Spine categories" ]
                    , div [ class "onyx-moddesk-row" ]
                        [ select
                            [ id "oper-desk-category"
                            , attribute "data-testid" "oper-desk-category"
                            , onInput (OperDeskField OperDesk.Category)
                            ]
                            (List.map
                                (\c -> option [ value c, selected (c == desk.category) ] [ text (OperDesk.categoryLabel c) ])
                                App.operEventCategories
                            )
                        , button [ type_ "submit", disabled (not live) ] [ text "Subscribe" ]
                        , button
                            [ type_ "button"
                            , attribute "data-testid" "oper-desk-category-unsubscribe"
                            , disabled (not live)
                            , onClick (OperDeskSubmit (OperEventUnsubscribe desk.category))
                            ]
                            [ text "Unsubscribe" ]
                        ]
                    , p [ class "onyx-moddesk-hint" ]
                        [ text "Subscriptions are per session. Use List to ask the node what this session receives." ]
                    , div [ class "onyx-moddesk-actions" ]
                        [ button
                            [ type_ "button"
                            , attribute "data-testid" "oper-desk-event-list"
                            , disabled (not live)
                            , onClick (OperDeskSubmit OperEventList)
                            ]
                            [ text "List subscriptions" ]
                        , button
                            [ type_ "button"
                            , attribute "data-testid" "oper-desk-privs"
                            , disabled (not live)
                            , onClick (OperDeskSubmit OperPrivs)
                            ]
                            [ text "Show my privileges" ]
                        , button
                            [ type_ "button"
                            , class "onyx-moddesk-danger"
                            , attribute "data-testid" "oper-desk-rehash"
                            , disabled (not live)
                            , onClick (OperDeskSubmit OperRehash)
                            ]
                            [ text "Reload node config" ]
                        ]
                    ]
               , Html.form
                    [ class "onyx-moddesk-form"
                    , attribute "data-testid" "oper-desk-observe-form"
                    , submitOn (OperObserve { mask = desk.mask, actions = [] })
                    ]
                    [ label [ for "oper-desk-mask" ] [ text "Watch a mask network-wide" ]
                    , div [ class "onyx-moddesk-row" ]
                        [ input
                            [ id "oper-desk-mask"
                            , attribute "data-testid" "oper-desk-mask"
                            , value desk.mask
                            , attribute "autocomplete" "off"
                            , placeholder "name!*@*.example"
                            , onInput (OperDeskField OperDesk.Mask)
                            ]
                            []
                        , button [ type_ "submit", disabled (not live || String.trim desk.mask == "") ] [ text "Observe" ]
                        ]
                    , p [ class "onyx-moddesk-hint" ]
                        [ text "OBSERVE reveals the subject’s real, uncloaked host to you. Use the narrowest mask that answers the question." ]
                    , div [ class "onyx-moddesk-actions" ]
                        [ button
                            [ type_ "button"
                            , attribute "data-testid" "oper-desk-observe-list"
                            , disabled (not live)
                            , onClick (OperDeskSubmit OperObserveList)
                            ]
                            [ text "List watches" ]
                        , button
                            [ type_ "button"
                            , attribute "data-testid" "oper-desk-observe-off"
                            , disabled (not live)
                            , onClick (OperDeskSubmit OperObserveOff)
                            ]
                            [ text "Clear watches" ]
                        ]
                    ]
               , Html.form
                    [ class "onyx-moddesk-form onyx-moddesk-form--danger"
                    , attribute "data-testid" "oper-desk-kill-form"
                    , submitOn (OperKill { target = desk.killNick, reason = desk.killReason })
                    ]
                    [ label [ for "oper-desk-kill-nick" ] [ text "Disconnect someone from the network" ]
                    , input
                        [ id "oper-desk-kill-nick"
                        , attribute "data-testid" "oper-desk-kill-nick"
                        , value desk.killNick
                        , attribute "autocomplete" "off"
                        , placeholder "Nickname"
                        , onInput (OperDeskField OperDesk.KillNick)
                        ]
                        []
                    , label [ for "oper-desk-kill-reason" ] [ text "Reason (recorded network-wide)" ]
                    , div [ class "onyx-moddesk-row" ]
                        [ input
                            [ id "oper-desk-kill-reason"
                            , attribute "data-testid" "oper-desk-kill-reason"
                            , value desk.killReason
                            , attribute "autocomplete" "off"
                            , placeholder "Repeat flooding after a warning"
                            , onInput (OperDeskField OperDesk.KillReason)
                            ]
                            []
                        , button
                            [ type_ "submit"
                            , class "onyx-moddesk-danger"
                            , attribute "data-testid" "oper-desk-kill-submit"
                            , disabled (not live || String.trim desk.killNick == "" || String.trim desk.killReason == "")
                            ]
                            [ text "Review disconnect" ]
                        ]
                    ]
               ]
            ++ reviewBlock live desk
            ++ (case desk.lastSent of
                    Just sent ->
                        [ p [ class "onyx-moddesk-hint", attribute "role" "status", attribute "data-testid" "oper-desk-last-sent" ]
                            [ text ("Sent " ++ sent) ]
                        ]

                    Nothing ->
                        []
               )
            ++ [ details [ class "moderation-cockpit__protocol" ]
                    [ summary [] [ text "Open-wire details" ]
                    , p [] [ text "This network grants operator status from the signed-in account — there is no OPER command, and a broadcast rides the Event Spine rather than a user-mode WALLOPS." ]
                    , code [] [ text "EVENT BROADCAST · EVENT ADD/DEL/LIST · EVENT OBSERVE · REHASH · PRIVS · KILL" ]
                    ]
               ]
        )


reviewBlock : Bool -> OperDesk.Desk -> List (Html Msg)
reviewBlock live desk =
    case desk.pending of
        Nothing ->
            []

        Just command ->
            [ div
                [ class "onyx-moddesk-review"
                , attribute "role" "alertdialog"
                , attribute "aria-label" "Review operator action"
                , attribute "data-testid" "oper-desk-review"
                ]
                [ p [ attribute "data-testid" "oper-desk-review-summary" ] [ text command.summary ]
                , code [ class "onyx-moddesk-wire", attribute "data-testid" "oper-desk-review-wire" ]
                    [ text (OperDesk.formatWirePreview command) ]
                , div [ class "onyx-moddesk-actions" ]
                    [ button
                        [ type_ "button"
                        , class "onyx-moddesk-danger"
                        , attribute "data-testid" "oper-desk-review-confirm"
                        , disabled (not live)
                        , onClick OperDeskConfirm
                        ]
                        [ text "Send it" ]
                    , button
                        [ type_ "button"
                        , attribute "data-testid" "oper-desk-review-cancel"
                        , onClick OperDeskCancel
                        ]
                        [ text "Cancel" ]
                    ]
                ]
            ]


-- EVENT CONSOLE


eventConsole : Model -> Html Msg
eventConsole model =
    let
        desk =
            model.operDesk

        feed =
            model.operEventReplay

        canReplay =
            model.connection == Live

        rows =
            OperDesk.filterEventRows
                { category = desk.filterCategory, severity = desk.filterSeverity, text = desk.filterText }
                feed.events

        hasFeed =
            not (List.isEmpty feed.events)
    in
    section [ class "oper-event-console", attribute "data-testid" "oper-event-console", attribute "aria-labelledby" "oper-event-console-title" ]
        ([ h3 [ id "oper-event-console-title" ] [ text "Event Spine" ]
         , p [ class "onyx-moddesk-hint" ]
            [ text "Operator-visible notices that match Event Spine traffic, plus a bounded refresh of the structured history feed." ]
         , div [ class "onyx-moddesk-row", attribute "data-testid" "oper-event-replay-toolbar" ]
            [ label [ class "onyx-moddesk-sr", for "oper-event-replay-limit" ] [ text "Number of events to refresh" ]
            , select
                [ id "oper-event-replay-limit"
                , attribute "data-testid" "oper-event-replay-limit"
                , on "change" (Decode.map OperEventReplayLimit (Decode.at [ "target", "value" ] Decode.string |> Decode.andThen intDecoder))
                ]
                (List.map
                    (\n -> option [ value (String.fromInt n), selected (n == desk.replayLimit) ] [ text (String.fromInt n ++ " events") ])
                    OperDesk.replayLimits
                )
            , button
                [ type_ "button"
                , attribute "data-testid" "oper-event-replay"
                , disabled (not canReplay)
                , onClick OperEventReplayRequested
                ]
                [ text "Refresh events" ]
            ]
         ]
            ++ (case desk.lastReplay of
                    Just request ->
                        [ p [ class "onyx-moddesk-hint", attribute "role" "status", attribute "data-testid" "oper-event-replay-status" ]
                            ([ text ("Requested " ++ request) ]
                                ++ (if feed.pending then
                                        [ span [ attribute "data-testid" "oper-event-replay-pending" ] [ text " · waiting…" ] ]

                                    else
                                        []
                                   )
                                ++ (if feed.complete then
                                        [ span [ attribute "data-testid" "oper-event-replay-complete" ]
                                            [ text
                                                (" · "
                                                    ++ String.fromInt (List.length rows)
                                                    ++ (case feed.expectedCount of
                                                            Just n ->
                                                                "/" ++ String.fromInt n

                                                            Nothing ->
                                                                ""
                                                       )
                                                    ++ " events"
                                                    ++ (case feed.severityFloor of
                                                            Just floor_ ->
                                                                if floor_ == "" then
                                                                    ""

                                                                else
                                                                    " · floor " ++ floor_

                                                            Nothing ->
                                                                ""
                                                       )
                                                )
                                            ]
                                        ]

                                    else
                                        []
                                   )
                            )
                        ]

                    Nothing ->
                        []
               )
            ++ (if hasFeed then
                    [ div [ class "onyx-moddesk-row", attribute "data-testid" "oper-event-filters" ]
                        [ label [ class "onyx-moddesk-sr", for "oper-event-filter-category" ] [ text "Filter by category" ]
                        , select
                            [ id "oper-event-filter-category"
                            , attribute "data-testid" "oper-event-filter-category"
                            , onInput (OperDeskField OperDesk.FilterCategory)
                            ]
                            (option [ value "", selected (desk.filterCategory == "") ] [ text "All categories" ]
                                :: List.map (\c -> option [ value c, selected (c == desk.filterCategory) ] [ text c ]) (OperDesk.eventCategoriesIn feed.events)
                            )
                        , label [ class "onyx-moddesk-sr", for "oper-event-filter-severity" ] [ text "Filter by severity" ]
                        , select
                            [ id "oper-event-filter-severity"
                            , attribute "data-testid" "oper-event-filter-severity"
                            , onInput (OperDeskField OperDesk.FilterSeverity)
                            ]
                            (option [ value "", selected (desk.filterSeverity == "") ] [ text "All severities" ]
                                :: List.map (\s -> option [ value s, selected (s == desk.filterSeverity) ] [ text s ]) (OperDesk.eventSeveritiesIn feed.events)
                            )
                        , label [ class "onyx-moddesk-sr", for "oper-event-filter-text" ] [ text "Filter events by text" ]
                        , input
                            [ id "oper-event-filter-text"
                            , attribute "data-testid" "oper-event-filter-text"
                            , type_ "search"
                            , value desk.filterText
                            , placeholder "Filter text"
                            , onInput (OperDeskField OperDesk.FilterText)
                            ]
                            []
                        ]
                    ]

                else
                    []
               )
            ++ (if List.isEmpty rows then
                    []

                else
                    [ ul [ class "onyx-moddesk-events", attribute "aria-label" "Structured event feed", attribute "data-testid" "oper-event-json-list" ]
                        (List.map (eventRow model.nowMs) rows)
                    ]
               )
            ++ (if hasFeed && List.isEmpty rows then
                    [ p [ class "onyx-moddesk-hint", attribute "role" "status", attribute "data-testid" "oper-event-filter-empty" ]
                        [ text "No events match these local filters." ]
                    ]

                else if not hasFeed then
                    [ p [ class "onyx-moddesk-hint", attribute "role" "status", attribute "data-testid" "oper-event-empty" ]
                        [ text "No recent spine-tagged notices yet." ]
                    ]

                else
                    []
               )
            ++ [ details [ class "moderation-cockpit__protocol" ]
                    [ summary [] [ text "Open-wire details" ]
                    , p [] [ text "Raw command used to refresh the structured feed. This does not send extra server commands when you filter locally." ]
                    , code [ attribute "data-testid" "oper-event-replay-wire" ] [ text (OperDesk.replayWire desk.replayLimit) ]
                    ]
               ]
        )


eventRow : Float -> EventReplayEvent -> Html Msg
eventRow nowMs event =
    li [ class "onyx-moddesk-event", attribute "data-testid" "oper-event-json-row" ]
        [ span [ class "onyx-moddesk-event-cat", attribute "data-testid" "oper-event-json-cat" ] [ text event.categoryCode ]
        , span [ class "onyx-moddesk-event-sev", attribute "data-testid" "oper-event-json-sev" ] [ text event.severity ]
        , span [ class "onyx-moddesk-event-text", attribute "data-testid" "oper-event-json-text" ]
            [ text (EventReplay.formatEventReplayEvent event nowMs) ]
        ]


intDecoder : String -> Decode.Decoder Int
intDecoder raw =
    case String.toInt raw of
        Just n ->
            Decode.succeed n

        Nothing ->
            Decode.fail "not an int"
