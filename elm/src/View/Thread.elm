module View.Thread exposing (thread)

{-| Message thread: welcome / empty / live states for the active
channel, newest last.
-}

import App exposing (Model, Msg)
import Dict
import Html exposing (Html, button, div, h2, li, section, span, strong, text, time, ul)
import Html.Attributes exposing (attribute, class, classList, datetime)
import Html.Events exposing (onClick)
import Prefs


thread : Model -> Html Msg
thread model =
    section [ class "onyx-thread-pane" ]
        [ case model.activeChannel of
            Nothing ->
                div [ class "onyx-empty" ]
                    [ h2 [] [ text "Welcome to Onyx" ]
                    , text "Join a channel from the rail to start reading."
                    ]

            Just name ->
                case Dict.get (String.toLower name) model.channels of
                    Nothing ->
                        div [ class "onyx-empty" ] [ text "Select a channel." ]

                    Just channel ->
                        if List.isEmpty channel.messages then
                            div [ class "onyx-empty" ]
                                [ h2 [] [ text channel.name ]
                                , text "No messages yet. Say hello."
                                ]

                        else
                            let
                                win =
                                    App.threadWindowFor model channel

                                chronological =
                                    List.reverse channel.messages

                                rows =
                                    chronological
                                        |> List.drop win.start
                                        |> List.take win.rendered

                                dividerId =
                                    Dict.get (String.toLower channel.name) model.viewUnreadDividerId
                            in
                            div []
                                [ if win.hiddenBefore > 0 then
                                    div [ class "onyx-earlier" ]
                                        [ button
                                            [ class "onyx-earlier-button"
                                            , onClick App.ThreadShowEarlier
                                            , attribute "aria-label" ("Show earlier messages (" ++ String.fromInt win.hiddenBefore ++ " not shown)")
                                            ]
                                            [ text "Show earlier messages "
                                            , span [ class "onyx-earlier-count" ] [ text (String.fromInt win.hiddenBefore) ]
                                            ]
                                        ]

                                  else if App.isHistoryExhausted model channel.name then
                                    div [ class "onyx-intro", attribute "data-testid" "channel-intro" ]
                                        [ span [ class "onyx-intro-glyph", attribute "aria-hidden" "true" ]
                                            [ text (String.left 1 channel.name) ]
                                        , h2 [ class "onyx-intro-title" ] [ text channel.name ]
                                        , text "This is the very beginning of the conversation."
                                        ]

                                  else
                                    text ""
                                , ul [ class "onyx-thread" ]
                                    (List.concatMap
                                        (\m -> [ dividerAbove dividerId m, messageRow model channel.name m ])
                                        rows
                                    )
                                , case App.typingLine model channel.name of
                                    Nothing ->
                                        text ""

                                    Just line ->
                                        div [ class "onyx-typing", attribute "aria-live" "polite" ] [ text line ]
                                , if win.hiddenAfter > 0 then
                                    div [ class "onyx-latest" ]
                                        [ button
                                            [ class "onyx-latest-button"
                                            , onClick App.ThreadShowLatest
                                            , attribute "aria-label" "Back to latest messages"
                                            ]
                                            [ text "Back to latest" ]
                                        ]

                                  else
                                    text ""
                                ]
        ]


dividerAbove : Maybe Int -> App.ChatMessage -> Html Msg
dividerAbove dividerId m =
    case dividerId of
        Just boundary ->
            if m.id == boundary then
                div
                    [ class "onyx-unread-divider"
                    , attribute "role" "separator"
                    , attribute "aria-label" "New messages"
                    , attribute "tabindex" "-1"
                    ]
                    [ span [ class "onyx-unread-divider-label" ] [ text "New messages" ] ]

            else
                text ""

        Nothing ->
            text ""


messageRow : Model -> String -> App.ChatMessage -> Html Msg
messageRow model target m =
    let
        uncertainDelivery =
            case m.outboxId of
                Just oid ->
                    List.member oid model.outboxUncertain

                Nothing ->
                    False

        withdrawn =
            m.deleted || m.redacted
    in
    li
        [ classList
            [ ( "onyx-message", True )
            , ( "onyx-whisper", m.whisper )
            , ( "onyx-locked", App.messageLocked m )
            , ( "onyx-pending", m.outboxId /= Nothing || m.pending )
            , ( "onyx-uncertain", uncertainDelivery )
            , ( "onyx-message-search-current", App.searchActiveId model == Just m.id )
            , ( "onyx-mention", m.highlight && not withdrawn )
            , ( "onyx-withdrawn", withdrawn )
            ]
        , attribute "role" "article"
        , attribute "aria-label" (App.messageAccessibleLabel m)
        ]
        [ strong [ class "onyx-sender" ] [ text m.from ]
        , case m.audience of
            Nothing ->
                text ""

            Just _ ->
                span
                    [ class "onyx-audience"
                    , attribute "title" (App.audienceTitle m.audience)
                    ]
                    [ text (App.audienceLabel m.audience) ]
        , if m.at <= 0 then
            text ""

          else
            time [ class "onyx-ts", datetime (App.millisToIso (toFloat m.at)), attribute "aria-hidden" "true" ]
                [ text (App.formatClockUtc m.at) ]
        , span [ class "onyx-body" ] [ text (App.displayBody m) ]
        , if m.outboxId == Nothing && not m.pending then
            text ""

          else if uncertainDelivery then
            span [ class "onyx-pending-note" ] [ text " · delivery uncertain" ]

          else
            span [ class "onyx-pending-note" ] [ text " · queued" ]
        , if m.edited && not withdrawn then
            span [ class "onyx-edited", attribute "title" (editTitle model m) ] [ text " · edited" ]

          else
            text ""
        , boostBar model target m
        ]


editTitle : Model -> App.ChatMessage -> String
editTitle model m =
    case m.msgid of
        Nothing ->
            "Edited"

        Just msgid ->
            case App.revisionsFor model.editHistory msgid of
                [] ->
                    "Edited"

                revs ->
                    "Edited (" ++ String.fromInt (List.length revs) ++ " revisions)"


boostBar : Model -> String -> App.ChatMessage -> Html Msg
boostBar model target m =
    let
        groups =
            App.aggregateBoostGroups m.reactions model.ourNick

        summary =
            App.summarizeBoosts groups model.prefs.reactionDensity
    in
    if summary.hidden || (List.isEmpty summary.chips && summary.overflow <= 0) then
        text ""

    else
        div [ class "boost-bar", attribute "aria-label" "Boosts" ]
            (List.map (boostChip model target m groups) summary.chips
                ++ (if summary.overflow > 0 then
                        [ span [ class "boost-pill boost-pill--more", attribute "aria-label" (String.fromInt summary.overflow ++ " more reaction types") ]
                            [ text ("+" ++ String.fromInt summary.overflow) ]
                        ]

                    else
                        []
                   )
            )


boostChip : Model -> String -> App.ChatMessage -> List App.BoostGroup -> { emoji : String, count : Int, mine : Bool, label : String } -> Html Msg
boostChip model target m groups chip =
    let
        group =
            List.filter (\g -> g.emoji == chip.emoji) groups |> List.head

        title =
            Maybe.withDefault chip.label (Maybe.map App.boostTitle group)

        kids =
            [ span [ class "boost-emoji", attribute "aria-hidden" "true" ] [ text chip.emoji ]
            , span [ class "boost-count" ] [ text (String.fromInt chip.count) ]
            ]
    in
    case ( model.prefs.reactionDensity, m.msgid, group ) of
        ( Prefs.ReactionCountsOnly, _, _ ) ->
            span [ class "boost-pill boost-pill--summary", attribute "aria-label" (String.fromInt chip.count ++ " total boosts") ] kids

        ( _, Just msgid, Just _ ) ->
            button
                [ class "boost-pill"
                , classList [ ( "you", chip.mine ) ]
                , attribute "aria-pressed" (if chip.mine then "true" else "false")
                , attribute "aria-label" ((if chip.mine then "Remove " else "Add ") ++ chip.emoji ++ " boost, " ++ String.fromInt chip.count ++ " total")
                , attribute "title" title
                , onClick (App.ReactionSend target msgid chip.emoji)
                ]
                kids

        _ ->
            span [ class "boost-pill", attribute "title" title ] kids
