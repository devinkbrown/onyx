module View.OperFeedPanel exposing (feedPanel, followPanel, statsPanel)

{-| v3/gap-oper — the Live tab's centre: which Event Spine categories
this session follows, and the feed itself (pause, clear, filter).
-}

import App exposing (ConnectionState(..), Model, Msg(..))
import Html exposing (Html, button, div, li, p, span, text)
import Html.Attributes exposing (attribute, class, disabled, id, placeholder, type_, value)
import Html.Events exposing (onClick, onInput)
import Html.Keyed as Keyed
import OperConsole as C
import OperDesk
import OperFeed
import OperPlan
import Set
import View.OperKit as K


live : Model -> Bool
live model =
    model.connection == Live


{-| How many rows the list renders; the ring keeps more. -}
renderCap : Int
renderCap =
    150


followPanel : Model -> Html Msg
followPanel model =
    let
        console =
            model.operConsole

        ready =
            live model

        following =
            Maybe.withDefault [] console.subscribed

        known =
            console.subscribed /= Nothing
    in
    K.card { id = "follow", title = "Follow the network", hint = "Pick the kinds of event you want to see as they happen. This applies to this session only." }
        [ div [ class "oc-chips", attribute "role" "group", attribute "aria-label" "Event categories", attribute "data-testid" "oc-follow-chips" ]
            (List.map
                (\category ->
                    button
                        [ type_ "button"
                        , class "oc-chip"
                        , attribute "aria-pressed"
                            (if List.member category following then
                                "true"

                             else
                                "false"
                            )
                        , disabled (not ready)
                        , attribute "data-testid" ("oc-follow-" ++ String.toLower category)
                        , onClick (K.consoleMsg (C.FollowToggle category))
                        ]
                        [ text (OperDesk.categoryLabel category) ]
                )
                App.operEventCategories
            )
        , if known then
            text ""

          else
            p [ class "oc-hint", attribute "role" "status", attribute "data-testid" "oc-follow-unknown" ]
                [ text
                    (if ready then
                        "Checking what this session already follows…"

                     else
                        "Reconnect to follow events."
                    )
                ]
        , K.formRow
            [ K.field { id = "oc-floor", label = "Quietest event to send me", hint = "" }
                (K.selectInput
                    { id = "oc-floor"
                    , value = Maybe.withDefault "" console.floor
                    , options =
                        ( "", "Leave as is" )
                            :: List.map (\s -> ( s, severityName s )) OperFeed.severities
                    , onChange = \v -> K.consoleMsg (C.SetFloor v)
                    , testId = "oc-floor"
                    }
                )
            ]
        ]


severityName : String -> String
severityName severity =
    case severity of
        "debug" ->
            "Everything (debug)"

        "info" ->
            "Info and louder"

        "notice" ->
            "Notice and louder"

        "warn" ->
            "Warnings and louder"

        "error" ->
            "Errors and critical"

        "critical" ->
            "Critical only"

        other ->
            other


feedPanel : Model -> Html Msg
feedPanel model =
    let
        feed =
            model.operConsole.feed

        rows =
            OperFeed.visible feed

        shown =
            List.take renderCap rows

        paused =
            OperFeed.isPaused feed

        held =
            OperFeed.heldCount feed

        filter =
            feed.filter

        categoryValue =
            case Set.toList filter.categories of
                [ one ] ->
                    one

                _ ->
                    ""

        total =
            List.length feed.entries
    in
    K.card { id = "feed", title = "Live feed", hint = "" }
        [ div [ class "oc-toolbar", attribute "data-testid" "oc-feed-toolbar" ]
            [ button
                [ type_ "button"
                , class
                    (if paused then
                        "oc-btn oc-btn-primary"

                     else
                        "oc-btn oc-btn-quiet"
                    )
                , attribute "data-testid" "oc-feed-pause"
                , attribute "aria-pressed"
                    (if paused then
                        "true"

                     else
                        "false"
                    )
                , onClick
                    (K.consoleMsg
                        (if paused then
                            C.FeedResume

                         else
                            C.FeedPause
                        )
                    )
                ]
                [ text
                    (if paused then
                        if held > 0 then
                            "Resume · " ++ String.fromInt held ++ " new"

                        else
                            "Resume"

                     else
                        "Pause"
                    )
                ]
            , button
                [ type_ "button"
                , class "oc-btn oc-btn-quiet"
                , attribute "data-testid" "oc-feed-clear"
                , disabled (total == 0)
                , onClick (K.consoleMsg C.FeedClear)
                ]
                [ text "Clear" ]
            ]
        , div [ class "oc-filters", attribute "data-testid" "oc-feed-filters" ]
            [ K.field { id = "oc-feed-category", label = "Category", hint = "" }
                (K.selectInput
                    { id = "oc-feed-category"
                    , value = categoryValue
                    , options = ( "", "All categories" ) :: List.map (\c -> ( c, OperDesk.categoryLabel c )) OperFeed.categories
                    , onChange = \v -> K.consoleMsg (C.FeedCategory v)
                    , testId = "oc-feed-category"
                    }
                )
            , K.field { id = "oc-feed-severity", label = "Severity", hint = "" }
                (K.selectInput
                    { id = "oc-feed-severity"
                    , value = filter.minSeverity
                    , options = ( "", "All" ) :: List.map (\s -> ( s, severityName s )) (List.drop 1 OperFeed.severities)
                    , onChange = \v -> K.consoleMsg (C.FeedSeverity v)
                    , testId = "oc-feed-severity"
                    }
                )
            , K.field { id = "oc-feed-text", label = "Search", hint = "" }
                (Html.input
                    [ id "oc-feed-text"
                    , type_ "search"
                    , class "oc-input"
                    , value filter.text
                    , placeholder "Nick, host, room…"
                    , attribute "autocomplete" "off"
                    , attribute "data-testid" "oc-feed-text"
                    , onInput (\v -> K.consoleMsg (C.FeedText v))
                    ]
                    []
                )
            ]
        , p [ class "oc-meta", attribute "role" "status", attribute "data-testid" "oc-feed-status" ]
            [ text (statusLine rows shown total feed paused) ]
        , if OperFeed.filterIsActive filter then
            div [ class "oc-row" ]
                [ K.button_
                    { kind = "quiet"
                    , label = "Reset filters"
                    , testId = "oc-feed-reset"
                    , onClick = K.consoleMsg C.FeedReset
                    , disabled = False
                    , ariaLabel = Nothing
                    }
                ]

          else
            text ""
        , if List.isEmpty shown then
            K.emptyNote
                (if total == 0 then
                    "Nothing yet. Follow a category above, and what the network reports will appear here."

                 else
                    "No rows match these filters."
                )

          else
            Keyed.node "ol"
                [ class "oc-events"
                , attribute "role" "log"
                , attribute "aria-label" "Live Event Spine feed"
                , attribute "aria-live" "off"
                , attribute "data-testid" "oc-feed-rows"
                ]
                (List.map (\e -> ( String.fromInt e.id, eventRow model e )) shown)
        ]


statusLine : List OperFeed.Entry -> List OperFeed.Entry -> Int -> OperFeed.Feed -> Bool -> String
statusLine rows shown total feed paused =
    let
        base =
            if List.length rows == total then
                String.fromInt total ++ rowWord total

            else
                String.fromInt (List.length rows) ++ " of " ++ String.fromInt total ++ rowWord total ++ " match"

        capped =
            if List.length rows > List.length shown then
                " · newest " ++ String.fromInt (List.length shown) ++ " shown"

            else
                ""

        dropped =
            if OperFeed.droppedCount feed > 0 then
                " · " ++ String.fromInt (OperFeed.droppedCount feed) ++ " low-priority " ++ rowWord (OperFeed.droppedCount feed) ++ " skipped to keep up"

            else
                ""

        pausedNote =
            if paused then
                " · paused"

            else
                ""
    in
    base ++ capped ++ dropped ++ pausedNote


rowWord : Int -> String
rowWord n =
    if n == 1 then
        " row"

    else
        " rows"


eventRow : Model -> OperFeed.Entry -> Html Msg
eventRow model entry =
    li
        [ class "oc-event"
        , attribute "data-sev" entry.severity
        , attribute "data-kind" (String.toLower (OperFeed.kindLabel entry.kind))
        , attribute "data-testid" "oc-event"
        ]
        [ span [ class "oc-event-time" ] [ text (K.clockHms model.zone entry.atMs) ]
        , span [ class "oc-event-sev" ] [ text entry.severity ]
        , span [ class "oc-event-cat" ] [ text (OperDesk.categoryLabel entry.category) ]
        , span [ class "oc-event-text" ] [ text entry.text ]
        , if entry.origin == "" then
            text ""

          else
            span [ class "oc-event-origin" ] [ text entry.origin ]
        , if entry.repeat > 1 then
            span [ class "oc-event-repeat", attribute "aria-label" (String.fromInt entry.repeat ++ " times") ] [ text ("×" ++ String.fromInt entry.repeat) ]

          else
            text ""
        ]


{-| EVENT STATS JSON: how busy the network has been since the node started. -}
statsPanel : Model -> Html Msg
statsPanel model =
    let
        console =
            model.operConsole
    in
    div [ class "oc-stats", attribute "data-testid" "oc-stats" ]
        [ K.formRow
            [ K.button_
                { kind = "quiet"
                , label = "Load counts"
                , testId = "oc-stats-load"
                , onClick = K.consoleMsg (C.Run OperPlan.EventStats)
                , disabled = not (live model)
                , ariaLabel = Nothing
                }
            ]
        , case console.stats of
            Just stats ->
                div [ class "oc-result" ]
                    [ p [ class "oc-result-head" ]
                        [ text (String.fromInt stats.total ++ " events since the node started · " ++ String.fromInt stats.historyDepth ++ " kept for replay") ]
                    , div [ class "oc-bars" ]
                        (List.map
                            (\( name, n ) ->
                                div [ class "oc-bar" ]
                                    [ span [ class "oc-bar-name" ] [ text (OperDesk.categoryLabel (String.toUpper name)) ]
                                    , span [ class "oc-bar-track" ]
                                        [ span [ class "oc-bar-fill", attribute "style" ("width:" ++ barWidth stats.total n) ] [] ]
                                    , span [ class "oc-bar-n" ] [ text (String.fromInt n) ]
                                    ]
                            )
                            (List.filter (\( _, n ) -> n > 0) (List.sortBy (\( _, n ) -> negate n) stats.categories))
                        )
                    ]

            Nothing ->
                text ""
        ]


barWidth : Int -> Int -> String
barWidth total n =
    if total <= 0 then
        "0%"

    else
        String.fromInt (max 2 (n * 100 // total)) ++ "%"
