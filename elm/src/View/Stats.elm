module View.Stats exposing (route, view)

{-| Public stats page, mirroring `src/routes/Stats.tsx` plus the
`PublicRoomComparison` plane: network pulse, room inspector, two-room
comparison, and the public room directory — aggregate counters only,
never message text or participant rankings.

Fold ownership: the index/detail fetches, 30s poll, sort/scope/query,
compare selection, window, share copy, and URL replace-state live in
`App`; this module renders the oracle's voice, chrome, and hooks.
`revealStatsInspector` (scroll + focus) fires ports-side only after an
Inspect click, never on initial load.
-}

import App exposing (Model, Msg(..), statsFeedState, statsInspectedChannel, statsInspectorAwaiting, statsMatchingDetail, statsShareHref)
import Html exposing (Html, a, article, aside, button, div, dl, figcaption, figure, h1, h2, h3, input, li, nav, ol, p, section, span, strong, table, tbody, td, text, th, thead, time, tr)
import Html.Attributes exposing (attribute, class, disabled, href, id, style, tabindex, type_, value)
import Html.Events exposing (onClick, onInput)
import Stats
import View.PublicFrame exposing (frame)


contextLine : Html Msg
contextLine =
    p [ class "public-frame__current-line" ]
        [ span [ class "public-frame__current-kicker" ] [ text "Rooms" ]
        , span [ attribute "aria-hidden" "true" ] [ text "·" ]
        , span [ class "public-frame__current-label" ] [ text "Stats" ]
        ]


{-| The stats body. -}
view : Model -> Html Msg
view model =
    let
        state =
            statsFeedState model

        stateKey =
            Stats.feedStateKey state
    in
    div [ class "ui-root r data-page stats-page" ]
        [ div [ class "r-ground", attribute "aria-hidden" "true" ] []
        , div [ class "r-flecks", attribute "aria-hidden" "true" ] []
        , div [ class "r-grain", attribute "aria-hidden" "true" ] []
        , section [ class "r-wrap data-hero stats-hero", attribute "aria-labelledby" "stats-heading" ]
            ([ p [ class "r-kicker" ] [ text "Rooms" ]
             , h1 [ id "stats-heading" ]
                [ text "The rooms "
                , span [ class "stats-title-accent" ] [ text "in motion" ]
                ]
             , p [ class "sub" ]
                [ text "See where people are talking, follow the network’s rhythm, and step directly into a public conversation. No member rankings. No message text." ]
             , div
                [ class "stats-observation"
                , attribute "data-feed-state" stateKey
                , attribute "role" "status"
                , attribute "aria-live" "polite"
                , attribute "aria-atomic" "true"
                ]
                [ span [ class "stats-observation__marker", attribute "aria-hidden" "true" ] []
                , text (Stats.feedStateLabel state)
                ]
             ]
                ++ heroData model state stateKey
                ++ [ feedTimeline model state stateKey ]
            )
        , nav [ class "r-wrap stats-view-nav", attribute "aria-label" "Stats sections" ]
            [ a [ href "#network-overview" ] [ text "Network pulse" ]
            , a [ href ("#" ++ Stats.inspectorId) ] [ text "Room inspector" ]
            , a [ href "#room-comparison" ] [ text "Compare rooms" ]
            , a [ href "#rooms" ] [ text "All rooms" ]
            ]
        , overviewSection model state stateKey
        , inspectorSection model
        , comparisonSection model state stateKey
        , roomsSection model
        ]


heroData : Model -> Stats.FeedState -> String -> List (Html Msg)
heroData model state stateKey =
    case model.statsIndex of
        Nothing ->
            [ div [ class "data-empty" ]
                [ text
                    (if state == Stats.FeedLoading then
                        "Stats are waiting for the next exported feed."

                     else
                        "No public stats export is available."
                    )
                ]
            ]

        Just index ->
            let
                channels =
                    List.sortBy (\c -> negate c.messages) index.channels

                totalMessages =
                    List.sum (List.map .messages channels)

                activeRooms =
                    List.filter (\c -> Stats.isActiveRecently c model.nowMs) channels |> List.length

                roomsWithPeople =
                    List.filter (\c -> c.present > 0) channels |> List.length

                windowDays =
                    Stats.windowDaysFor index.networkDays model.statsWindow

                latestDay =
                    List.head (List.reverse windowDays)

                previousDay =
                    List.head (List.drop 1 (List.reverse windowDays))

                dailyAverage =
                    if List.isEmpty windowDays then
                        0

                    else
                        round (toFloat (List.sum (List.map .messages windowDays)) / toFloat (List.length windowDays))

                tideNote =
                    case previousDay of
                        Nothing ->
                            "first exported day in this feed"

                        Just prev ->
                            let
                                delta =
                                    (Maybe.map .messages latestDay |> Maybe.withDefault 0) - prev.messages
                            in
                            if delta == 0 then
                                "level with previous export"

                            else
                                (if delta > 0 then
                                    "+"

                                 else
                                    ""
                                )
                                    ++ Stats.formatCount delta
                                    ++ " vs previous export"
            in
            [ div [ class "stats-ledger", attribute "aria-label" "Live feed ledger" ]
                [ span [ class "stats-ledger-mark", attribute "data-state" stateKey, attribute "aria-hidden" "true" ] []
                , p []
                    [ strong [] [ text ((if String.isEmpty index.network then "Onyx" else index.network) ++ " activity") ]
                    , text (" · " ++ Stats.feedLedgerPhrase state ++ " · " ++ (if String.isEmpty index.node then "network export" else index.node) ++ " · updated " ++ Stats.relTime index.generatedAt model.nowMs)
                    ]
                , button [ type_ "button", class "stats-refresh", onClick StatsRefetch ] [ text "Refresh data" ]
                ]
            , div [ class "data-summary stats-summary", attribute "aria-label" "Network summary" ]
                [ div [ class "data-metric stats-primary-metric", attribute "data-tone" "presence" ]
                    [ span [ class "label" ] [ text "people online" ]
                    , span [ class "value" ] [ text (Stats.formatCount index.usersOnline) ]
                    , span [ class "note" ]
                        [ Html.i [ attribute "aria-hidden" "true" ] []
                        , text (" " ++ Stats.presencePhrase state "live network presence" "presence from this export")
                        ]
                    ]
                , div [ class "data-metric", attribute "data-tone" "rooms" ]
                    [ span [ class "label" ] [ text "rooms moving" ]
                    , span [ class "value" ] [ text (Stats.formatCount activeRooms) ]
                    , span [ class "note" ] [ text (Stats.formatCount roomsWithPeople ++ " " ++ Stats.presencePhrase state "live right now" "present in this export") ]
                    ]
                , div [ class "data-metric", attribute "data-tone" "messages" ]
                    [ span [ class "label" ] [ text "messages observed" ]
                    , span [ class "value" ] [ text (Stats.formatCount totalMessages) ]
                    , span [ class "note" ]
                        [ text
                            (if index.channelsComplete then
                                "across the complete public room index"

                             else
                                "across a partial public room index"
                            )
                        ]
                    ]
                , div [ class "data-metric", attribute "data-tone" "momentum" ]
                    [ span [ class "label" ] [ text "latest day" ]
                    , span [ class "value" ] [ text (Stats.formatCount (Maybe.map .messages latestDay |> Maybe.withDefault dailyAverage)) ]
                    , span [ class "note" ] [ text tideNote ]
                    ]
                ]
            ]


feedTimeline : Model -> Stats.FeedState -> String -> Html Msg
feedTimeline model state stateKey =
    section
        [ class "stats-feed-timeline"
        , attribute "data-feed-state" stateKey
        , attribute "data-testid" "stats-feed-timeline"
        , attribute "aria-labelledby" "stats-feed-timeline-heading"
        ]
        [ div [ class "stats-feed-timeline-head" ]
            [ div []
                [ span [ class "label" ] [ text "Signal path" ]
                , h2 [ id "stats-feed-timeline-heading" ] [ text "Three checks before a claim" ]
                ]
            , p [ class "stats-feed-cadence" ] [ span [ attribute "aria-hidden" "true" ] [ text "↻" ], text " auto-check · 30 sec" ]
            ]
        , ol [ class "stats-feed-timeline-list", attribute "aria-label" "Public stats feed checks" ]
            (List.map
                (\step ->
                    li [ class "stats-feed-step", attribute "data-step" step.id, attribute "data-step-state" step.state ]
                        [ div [ class "stats-feed-step__body" ]
                            [ div [ class "stats-feed-step__heading" ]
                                [ span [] [ text step.label ]
                                , strong [] [ text step.status ]
                                ]
                            , p [] [ text step.detail ]
                            ]
                        ]
                )
                (Stats.statsFeedTimeline state (model.statsIndex /= Nothing))
            )
        , p [ class "stats-feed-timeline-note", attribute "aria-live" "polite", attribute "aria-atomic" "true" ]
            [ text (Stats.feedTimelineNote state model.statsIndex model.nowMs) ]
        ]


overviewSection : Model -> Stats.FeedState -> String -> Html Msg
overviewSection model state _ =
    let
        days =
            case model.statsIndex of
                Nothing ->
                    []

                Just index ->
                    index.networkDays

        windowDays =
            Stats.windowDaysFor days model.statsWindow

        peak =
            List.map .messages windowDays |> List.maximum |> Maybe.withDefault 0

        windowState =
            Stats.activityWindowStateFor state windowDays

        windowKey =
            case windowState of
                Stats.WindowCurrent ->
                    "current"

                Stats.WindowLoading ->
                    "loading"

                Stats.WindowStale ->
                    "stale"

                Stats.WindowUnavailable ->
                    "unavailable"

        windowed =
            List.length windowDays

        total =
            List.length days

        latestDay =
            List.head (List.reverse windowDays)

        firstDay =
            List.head windowDays

        busiest =
            case model.statsIndex of
                Nothing ->
                    Nothing

                Just index ->
                    Stats.busiestChannel index.channels

        complete =
            case model.statsIndex of
                Nothing ->
                    True

                Just index ->
                    index.networkDaysComplete
    in
    section [ id "network-overview", class "r-wrap r-section data-grid stats-overview", attribute "aria-label" "Activity detail" ]
        [ article [ class "data-card" ]
            [ div [ class "stats-card-heading" ]
                [ span [ class "label" ] [ text "network pulse" ]
                , span [ class "stats-card-quiet" ] [ text (String.fromInt windowed ++ "/" ++ String.fromInt total ++ " samples") ]
                ]
            , h2 [] [ text "Conversation current" ]
            , div
                [ class "stats-window-control"
                , attribute "data-window-state" windowKey
                , attribute "data-testid" "stats-window-control"
                , attribute "role" "group"
                , attribute "aria-labelledby" "stats-window-heading"
                ]
                [ div [ class "stats-window-copy" ]
                    [ span [ class "label", id "stats-window-heading" ] [ text "network window" ]
                    , p [ id "stats-window-help" ] [ text "Use a shorter or fuller public activity horizon." ]
                    ]
                , div [ class "stats-window-options", attribute "role" "group", attribute "aria-label" "Network activity window" ]
                    [ windowButton model windowState 7 "Latest 7 days" "7 days"
                    , windowButton model windowState 14 "Latest 14 days" "14 days"
                    ]
                , p [ class "stats-window-status", attribute "data-window-state" windowKey, attribute "role" "status", attribute "aria-live" "polite" ]
                    [ text (Stats.activityWindowStatus state windowState model.statsWindow windowed) ]
                ]
            , if List.isEmpty windowDays then
                p [] [ text "No daily series has been exported yet." ]

              else
                figure [ class "data-chart", attribute "aria-labelledby" "network-tide-caption" ]
                    [ div [ class "data-bars", attribute "aria-hidden" "true" ]
                        (List.map
                            (\day ->
                                span
                                    [ class "data-bar"
                                    , attribute "title" (day.date ++ ": " ++ Stats.formatCount day.messages ++ " messages")
                                    , style "--h" (Stats.barHeight day.messages peak)
                                    ]
                                    []
                            )
                            windowDays
                        )
                    , div [ class "stats-chart-caption", attribute "aria-hidden" "true" ]
                        [ span [] [ text (Maybe.map .date firstDay |> Maybe.withDefault "—") ]
                        , strong []
                            [ text
                                (case latestDay of
                                    Just last ->
                                        Stats.formatCount last.messages ++ " messages"

                                    Nothing ->
                                        "—"
                                )
                            ]
                        , span [] [ text (Maybe.map .date latestDay |> Maybe.withDefault "—") ]
                        ]
                    , figcaption [ id "network-tide-caption", class "sr-only" ]
                        [ text ("Daily message totals, oldest to newest. Showing the latest " ++ String.fromInt model.statsWindow ++ " days.") ]
                    , ol [ class "sr-only", attribute "aria-label" "Daily message totals" ]
                        (List.map
                            (\day ->
                                li []
                                    [ time [ attribute "datetime" day.date ] [ text day.date ]
                                    , text (": " ++ Stats.formatCount day.messages ++ " messages")
                                    ]
                            )
                            windowDays
                        )
                    ]
            , p [ class "stats-chart-note" ]
                [ text
                    ("Network-wide public messages for the latest "
                        ++ String.fromInt model.statsWindow
                        ++ " exported days, oldest to newest."
                        ++ (if complete then
                                " "

                            else
                                " Some malformed or duplicate day rows were omitted. "
                           )
                        ++ "This is observed activity, not a forecast."
                    )
                ]
            ]
        , aside [ class "data-card stats-busiest-card" ]
            [ div [ class "stats-card-heading" ]
                [ span [ class "label" ] [ text "room spotlight" ]
                , span [ class "stats-card-quiet" ] [ text "most messages" ]
                ]
            , case busiest of
                Nothing ->
                    h3 [] [ text "No rooms yet" ]

                Just room ->
                    div []
                        [ h3 [] [ text room.channel ]
                        , p [] [ text (if String.isEmpty room.topic then "No topic set yet." else room.topic) ]
                        , div [ class "data-summary stats-spotlight-metrics" ]
                            [ div [ class "data-metric", attribute "data-tone" "messages" ]
                                [ span [ class "label" ] [ text "messages" ]
                                , span [ class "value" ] [ text (Stats.formatCount room.messages) ]
                                , span [ class "note" ] [ text "tracked total" ]
                                ]
                            , div [ class "data-metric", attribute "data-tone" "momentum" ]
                                [ span [ class "label" ] [ text "activity pulse" ]
                                , span [ class "value" ] [ text (Stats.formatPulse (Stats.roomPulse room)) ]
                                , span [ class "note" ] [ text "recent exported intervals" ]
                                ]
                            , div [ class "data-metric", attribute "data-tone" "presence" ]
                                [ span [ class "label" ] [ text "present" ]
                                , span [ class "value" ] [ text (Stats.formatCount (if room.present == 0 then room.activeUsers else room.present)) ]
                                , span [ class "note" ] [ text (Stats.presencePhrase state "right now" "in this export") ]
                                ]
                            ]
                        , div [ class "r-cta" ]
                            [ a [ class "r-btn primary", href (Stats.roomDeepLink room.channel room.lastActive) ]
                                [ text "Join the conversation ", span [ attribute "aria-hidden" "true" ] [ text "→" ] ]
                            ]
                        ]
            ]
        ]


inspectorSection : Model -> Html Msg
inspectorSection model =
    let
        room =
            statsInspectedChannel model
    in
    section
        [ id Stats.inspectorId
        , class "r-wrap r-section stats-inspector"
        , attribute "aria-labelledby" "inspector-heading"
        , tabindex -1
        ]
        [ div [ class "stats-inspector-head" ]
            [ div []
                [ span [ class "r-eyebrow" ] [ text "room signal" ]
                , h2 [ class "r-title", id "inspector-heading" ]
                    (if String.isEmpty room then
                        [ text "Choose a room" ]

                     else
                        [ text "Inside ", span [ class "stats-title-accent" ] [ text room ] ]
                    )
                ]
            , if String.isEmpty room then
                text ""

              else
                a [ class "r-btn primary stats-inspector-open", href (Stats.roomDeepLink room 0) ]
                    [ text "Open room ", span [ attribute "aria-hidden" "true" ] [ text "→" ] ]
            ]
        , case statsMatchingDetail model of
            Nothing ->
                div [ class "data-empty", attribute "role" "status" ]
                    [ text
                        (if statsInspectorAwaiting model then
                            "Loading " ++ (if String.isEmpty room then "room" else room) ++ " insights…"

                         else
                            "Detailed room telemetry is unavailable. The public index above is still usable."
                        )
                    ]

            Just detail ->
                inspectorDetail model detail
        ]


inspectorDetail : Model -> Stats.ChannelDetail -> Html Msg
inspectorDetail model detail =
    let
        heatPeak =
            List.concat detail.heatmap |> List.maximum |> Maybe.withDefault 0

        heatOf messages =
            String.fromInt
                (round
                    ((if heatPeak <= 0 then
                        0

                      else
                        toFloat messages / toFloat heatPeak
                     )
                        * 82
                    )
                    + 4
                )
                ++ "%"

        hourPeak =
            List.maximum detail.hours |> Maybe.withDefault 0

        dayPeak =
            List.map .messages detail.days |> List.maximum |> Maybe.withDefault 1

        totalMessages =
            case model.statsIndex of
                Nothing ->
                    0

                Just index ->
                    List.sum (List.map .messages index.channels)

        share =
            Stats.roomShareOfNetwork detail.totals.messages totalMessages
    in
    div []
        [ div [ class "stats-inspector-ledger" ]
            [ p []
                [ strong [] [ text detail.channel ]
                , text
                    (" · observed since "
                        ++ (if detail.firstSeen > 0 then
                                Stats.utcDateLabel detail.firstSeen

                            else
                                "an unknown date"
                           )
                        ++ " · last activity "
                        ++ Stats.relTime detail.lastActive model.nowMs
                    )
                ]
            , span [ attribute "data-state" (if detail.complete then "complete" else "partial") ]
                [ text (if detail.complete then "complete room feed" else "partial room feed") ]
            ]
        , div [ class "stats-inspector-metrics", attribute "aria-label" (detail.channel ++ " summary") ]
            [ inspectorMetric "presence" "present now" (Stats.formatCount detail.present) "live network roster"
            , inspectorMetric "messages" "messages tracked" (Stats.formatCount detail.totals.messages) "durable public aggregate"
            , inspectorMetric "people" "contributors" (Stats.formatCount detail.totals.activeUsers) "distinct recorded authors"
            , inspectorMetric "words" "words / message" (Stats.averageWords detail) "aggregate average"
            , inspectorMetric "momentum" "busiest day" (Stats.formatCount (Maybe.map .messages detail.busiestDay |> Maybe.withDefault 0)) (Maybe.map .date detail.busiestDay |> Maybe.withDefault "not enough history")
            , inspectorMetric "time" "peak hour" (Stats.formatHour detail.peakHour) (String.fromFloat (toFloat (round (Stats.peakHourShare detail.hours))) ++ "% of the daily rhythm")
            , inspectorMetric "share" "network share" (Maybe.map (\s -> (if s >= 10 then String.fromInt (round s) else Stats.toFixed1 s) ++ "%") share |> Maybe.withDefault "—") "of observed public messages"
            , inspectorMetric "flow" "net joins" (Stats.formatCount (Stats.netMembershipFlow detail.totals)) "joins minus parts, quits, and kicks"
            ]
        , div [ class "stats-inspector-grid" ]
            [ article [ class "data-card stats-hour-card" ]
                [ div [ class "stats-card-heading" ]
                    [ span [ class "label" ] [ text "daily rhythm" ]
                    , span [ class "stats-card-quiet" ] [ text "UTC · all recorded days" ]
                    ]
                , h3 [] [ text "When the room talks" ]
                , div [ class "stats-hour-chart", attribute "aria-hidden" "true" ]
                    (List.indexedMap
                        (\hour messages ->
                            Html.i
                                [ attribute "title" (String.padLeft 2 '0' (String.fromInt hour) ++ ":00 UTC: " ++ Stats.formatCount messages ++ " messages")
                                , style "--h" (String.fromInt (max 3 (round (toFloat messages / toFloat (max 1 hourPeak) * 100))))
                                ]
                                []
                        )
                        detail.hours
                    )
                , div [ class "stats-hour-axis", attribute "aria-hidden" "true" ]
                    [ span [] [ text "00" ], span [] [ text "06" ], span [] [ text "12" ], span [] [ text "18" ], span [] [ text "23" ] ]
                , p [ class "stats-chart-explanation" ] [ text "Each bar is one UTC hour accumulated across the room’s retained statistics." ]
                , ol [ class "sr-only", attribute "aria-label" (detail.channel ++ " messages by UTC hour") ]
                    (List.indexedMap
                        (\hour messages ->
                            li [] [ text (String.padLeft 2 '0' (String.fromInt hour) ++ ":00 UTC: " ++ Stats.formatCount messages ++ " messages") ]
                        )
                        detail.hours
                    )
                ]
            , article [ class "data-card stats-days-card" ]
                [ div [ class "stats-card-heading" ]
                    [ span [ class "label" ] [ text "recent days" ]
                    , span [ class "stats-card-quiet" ] [ text (String.fromInt (List.length detail.days) ++ " exported days") ]
                    ]
                , h3 [] [ text "How the room moved" ]
                , if List.isEmpty detail.days then
                    p [] [ text "No per-room daily series has been exported yet." ]

                  else
                    figure [ class "data-chart stats-room-days", attribute "aria-labelledby" "room-days-caption" ]
                        [ div [ class "data-bars", attribute "aria-hidden" "true" ]
                            (List.map
                                (\day ->
                                    span
                                        [ class "data-bar"
                                        , attribute "title" (day.date ++ ": " ++ Stats.formatCount day.messages ++ " messages")
                                        , style "--h" (String.fromInt (max 3 (round (toFloat day.messages / toFloat dayPeak * 100))))
                                        ]
                                        []
                                )
                                detail.days
                            )
                        , figcaption [ id "room-days-caption", class "sr-only" ]
                            [ text ("Daily message totals for " ++ detail.channel ++ ", oldest to newest.") ]
                        , ol [ class "sr-only", attribute "aria-label" (detail.channel ++ " messages by day") ]
                            (List.map
                                (\day ->
                                    li []
                                        [ time [ attribute "datetime" day.date ] [ text day.date ]
                                        , text (": " ++ Stats.formatCount day.messages ++ " messages")
                                        ]
                                )
                                detail.days
                            )
                        ]
                ]
            , article [ class "data-card stats-flow-card" ]
                [ div [ class "stats-card-heading" ]
                    [ span [ class "label" ] [ text "room flow" ]
                    , span [ class "stats-card-quiet" ] [ text "aggregate events" ]
                    ]
                , h3 [] [ text "Room movement" ]
                , dl [ class "stats-flow-list" ]
                    [ flowRow "joins" (Stats.formatCount detail.totals.joins)
                    , flowRow "parts" (Stats.formatCount detail.totals.parts)
                    , flowRow "quits" (Stats.formatCount detail.totals.quits)
                    , flowRow "kicks" (Stats.formatCount detail.totals.kicks)
                    , flowRow "topic changes" (Stats.formatCount detail.totals.topicChanges)
                    , flowRow "last speaker" (if String.isEmpty detail.lastSpeaker then "—" else detail.lastSpeaker)
                    ]
                ]
            ]
        , article [ class "data-card stats-heatmap-card" ]
            [ div [ class "stats-card-heading" ]
                [ span [ class "label" ] [ text "week × hour" ]
                , span [ class "stats-card-quiet" ] [ text "darker means more messages" ]
                ]
            , h3 [] [ text "The room’s weekly current" ]
            , div [ class "stats-heatmap-scroll", tabindex 0, attribute "role" "region", attribute "aria-label" (detail.channel ++ " weekly activity table") ]
                [ table [ class "stats-heatmap" ]
                    [ Html.caption [ class "sr-only" ] [ text ("Messages by weekday and UTC hour for " ++ detail.channel) ]
                    , thead []
                        [ tr []
                            (th [ attribute "scope" "col" ] [ text "Day" ]
                                :: List.indexedMap (\hour _ -> th [ attribute "scope" "col" ] [ text (String.padLeft 2 '0' (String.fromInt hour)) ]) detail.hours
                            )
                        ]
                    , tbody []
                        (List.indexedMap
                            (\day row ->
                                tr []
                                    (th [ attribute "scope" "row" ]
                                        [ text (Stats.weekdayLabels |> List.drop day |> List.head |> Maybe.withDefault "") ]
                                        :: List.indexedMap
                                            (\hour messages ->
                                                td
                                                    [ style "--heat" (heatOf messages)
                                                    , attribute "title" ((Stats.weekdayLabels |> List.drop day |> List.head |> Maybe.withDefault "") ++ " " ++ String.padLeft 2 '0' (String.fromInt hour) ++ ":00 UTC: " ++ Stats.formatCount messages ++ " messages")
                                                    ]
                                                    [ span [ class "sr-only" ] [ text (Stats.formatCount messages) ] ]
                                            )
                                            row
                                    )
                            )
                            detail.heatmap
                        )
                    ]
                ]
            ]
        , p [ class "stats-method-note" ]
            [ text "This page reports aggregate activity from public, non-ephemeral rooms. It does not publish message text, private-room traffic, participant rankings, or word-frequency profiles. Presence is live; other totals are retained server counters." ]
        ]


inspectorMetric : String -> String -> String -> String -> Html Msg
inspectorMetric tone label value note =
    div [ attribute "data-tone" tone ]
        [ span [] [ text label ]
        , strong [] [ text value ]
        , Html.small [] [ text note ]
        ]


flowRow : String -> String -> Html Msg
flowRow term value =
    div []
        [ Html.dt [] [ text term ]
        , Html.dd [] [ text value ]
        ]


windowButton : Model -> Stats.WindowState -> Int -> String -> String -> Html Msg
windowButton model windowState window ariaLabel label =
    let
        unavailable =
            windowState == Stats.WindowLoading || windowState == Stats.WindowUnavailable
    in
    button
        ([ type_ "button"
         , attribute "aria-label" ariaLabel
         , attribute "aria-pressed" (if model.statsWindow == window then "true" else "false")
         , attribute "aria-describedby" "stats-window-help"
         , onClick (StatsWindowSelect { window = window })
         ]
            ++ (if unavailable then
                    [ disabled True ]

                else
                    []
               )
        )
        [ text label ]


comparisonSection : Model -> Stats.FeedState -> String -> Html Msg
comparisonSection model state stateKey =
    let
        channels =
            case model.statsIndex of
                Nothing ->
                    []

                Just index ->
                    index.channels

        totalMessages =
            List.sum (List.map .messages channels)

        selectedRooms =
            List.filterMap
                (\selected ->
                    List.filter (\c -> String.toLower c.channel == String.toLower selected) channels
                        |> List.head
                )
                model.statsCompare

        missingRooms =
            max 0 (List.length model.statsCompare - List.length selectedRooms)

        maxMessages =
            List.map (\c -> max 0 c.messages) selectedRooms
                |> List.maximum
                |> Maybe.withDefault 1
                |> max 1

        shareLabel =
            case model.statsShare of
                App.StatsShareCopying ->
                    "Copying…"

                App.StatsShareCopied ->
                    "Link copied"

                _ ->
                    "Copy link"
    in
    section
        [ id "room-comparison"
        , class "r-wrap r-section public-room-comparison"
        , attribute "data-feed-state" stateKey
        , attribute "data-testid" "public-room-comparison"
        , attribute "aria-labelledby" "room-comparison-heading"
        ]
        [ div [ class "public-room-comparison__head" ]
            [ div []
                [ span [ class "r-eyebrow" ] [ text "public observatory" ]
                , h2 [ class "r-title", id "room-comparison-heading" ] [ text "Put two rooms side by side." ]
                , p [ class "public-room-comparison__lede", id "room-comparison-help" ]
                    [ text "Compare the rooms’ public pulse without opening their messages or ranking their people." ]
                ]
            , if List.isEmpty model.statsCompare then
                text ""

              else
                div [ class "public-room-comparison__actions" ]
                    [ button
                        [ type_ "button"
                        , class "public-room-comparison__share"
                        , onClick StatsCopyCompare
                        , attribute "aria-label" "Copy comparison link"
                        , attribute "aria-busy" (if model.statsShare == App.StatsShareCopying then "true" else "false")
                        , disabled (model.statsShare == App.StatsShareCopying)
                        ]
                        [ text shareLabel ]
                    , button
                        [ type_ "button"
                        , class "public-room-comparison__clear"
                        , onClick StatsClearCompare
                        , attribute "aria-label" "Clear room comparison"
                        ]
                        [ text "Clear selection" ]
                    ]
            ]
        , if model.statsShare == App.StatsShareCopied || model.statsShare == App.StatsShareFailed then
            p
                [ class "public-room-comparison__share-status"
                , attribute "role" (if model.statsShare == App.StatsShareFailed then "alert" else "status")
                , attribute "aria-live" "polite"
                ]
                [ text
                    (if model.statsShare == App.StatsShareCopied then
                        "Comparison link copied to clipboard."

                     else
                        "Copy failed. Use your browser address bar to share this comparison."
                    )
                ]

          else
            text ""
        , div [ class "public-room-comparison__ledger", attribute "data-state" (Stats.stepState state) ]
            [ span [ class "public-room-comparison__marker", attribute "aria-hidden" "true" ] []
            , p [ attribute "aria-live" "polite", attribute "aria-atomic" "true" ]
                [ text (Stats.feedNote state (List.length model.statsCompare) missingRooms) ]
            ]
        , if List.isEmpty channels then
            div [ class "public-room-comparison__empty", attribute "data-state" (Stats.stepState state) ]
                [ strong []
                    [ text
                        (if state == Stats.FeedLoading then
                            "Room choices are loading."

                         else
                            "Room comparison is unavailable."
                        )
                    ]
                , p [] [ text (Stats.selectionCopy 0 0) ]
                ]

          else
            div []
                [ p [ class "public-room-comparison__selection", attribute "aria-live" "polite", attribute "aria-atomic" "true" ]
                    [ text (Stats.selectionCopy (List.length model.statsCompare) (List.length channels)) ]
                , if List.isEmpty selectedRooms then
                    text ""

                  else
                    div [ class "public-room-comparison__chips", attribute "role" "list", attribute "aria-label" "Selected rooms" ]
                        (List.map
                            (\room ->
                                div [ attribute "role" "listitem" ]
                                    [ button
                                        [ type_ "button"
                                        , class "public-room-comparison__chip"
                                        , onClick (StatsToggleCompare { channel = room.channel })
                                        , attribute "aria-label" ("Remove " ++ room.channel ++ " from comparison")
                                        ]
                                        [ span [] [ text room.channel ]
                                        , span [ attribute "aria-hidden" "true" ] [ text "×" ]
                                        ]
                                    ]
                            )
                            selectedRooms
                            ++ (if missingRooms > 0 then
                                    [ span [ class "public-room-comparison__missing", attribute "role" "listitem" ]
                                        [ text (String.fromInt missingRooms ++ " missing from export") ]
                                    ]

                                else
                                    []
                               )
                        )
                , if List.isEmpty selectedRooms then
                    div [ class "public-room-comparison__prompt" ]
                        [ span [ class "public-room-comparison__prompt-mark", attribute "aria-hidden" "true" ] [ text "+" ]
                        , p []
                            [ text "Use "
                            , strong [] [ text "Compare" ]
                            , text " on any room below. You can keep one or two rooms here while you browse the directory."
                            ]
                        ]

                  else
                    div []
                        [ div [ class "public-room-comparison__table-wrap", tabindex 0, attribute "role" "region", attribute "aria-label" "Selected room comparison" ]
                            [ table [ class "public-room-comparison__table" ]
                                [ Html.caption [ class "sr-only" ] [ text "Aggregate comparison of selected public rooms" ]
                                , thead []
                                    [ tr []
                                        (th [ attribute "scope" "col" ] [ text "Signal" ]
                                            :: List.map (\room -> th [ attribute "scope" "col" ] [ text room.channel ]) selectedRooms
                                        )
                                    ]
                                , tbody []
                                    [ comparisonRow "Messages tracked"
                                        (\room ->
                                            [ strong [] [ text (Stats.formatCount room.messages) ]
                                            , span [ class "public-room-comparison__bar", attribute "aria-hidden" "true" ]
                                                [ Html.i [ style "width" (String.fromInt (round (toFloat (max 0 room.messages) / toFloat maxMessages * 100)) ++ "%") ] [] ]
                                            ]
                                        )
                                        selectedRooms
                                    , comparisonRow "Activity pulse"
                                        (\room -> [ text (Stats.formatPulse (Stats.roomPulse room)) ])
                                        selectedRooms
                                    , comparisonRow "Present now"
                                        (\room -> [ text (Stats.formatCount room.present) ])
                                        selectedRooms
                                    , comparisonRow "Network share"
                                        (\room -> [ text (Stats.networkShare room.messages totalMessages) ])
                                        selectedRooms
                                    , comparisonRow "Last active"
                                        (\room -> [ text (Stats.relTime room.lastActive model.nowMs) ])
                                        selectedRooms
                                    ]
                                ]
                            ]
                        , p [ class "public-room-comparison__headline", attribute "aria-live" "polite" ]
                            [ text (Stats.compareHeadline selectedRooms) ]
                        ]
                ]
        , p [ class "public-room-comparison__privacy" ]
            [ text "Aggregate view only: room totals, pulse, presence, and recency. No message text, private-room traffic, or participant ranking is read here." ]
        ]


comparisonRow : String -> (Stats.StatsChannel -> List (Html Msg)) -> List Stats.StatsChannel -> Html Msg
comparisonRow label cells rooms =
    tr []
        (th [ attribute "scope" "row" ] [ text label ]
            :: List.map (\room -> td [] (cells room)) rooms
        )


roomsSection : Model -> Html Msg
roomsSection model =
    let
        channels =
            case model.statsIndex of
                Nothing ->
                    []

                Just index ->
                    index.channels

        visible =
            Stats.visibleChannels channels model.statsRoomScope model.statsRoomSort model.statsRoomQuery model.nowMs

        sortLabel =
            Stats.sortLabels
                |> List.filter (\( value, _ ) -> value == model.statsRoomSort)
                |> List.head
                |> Maybe.map Tuple.second
                |> Maybe.withDefault "Messages"
    in
    section [ id "rooms", class "r-wrap r-section stats-rooms-section", attribute "aria-labelledby" "rooms-heading" ]
        [ span [ class "r-eyebrow" ] [ text "Public room directory" ]
        , h2 [ class "r-title", id "rooms-heading" ] [ text "Find the conversation" ]
        , p [ class "stats-section-note" ]
            [ text "Search by room or topic, see who is present, and open the room at its latest recorded moment. The 14-day pulse shows activity without exposing what anyone said." ]
        , div [ class "stats-room-controls", attribute "aria-label" "Room list controls" ]
            [ Html.label [ class "stats-room-search" ]
                [ span [] [ text "Find a room or topic" ]
                , input
                    [ type_ "search"
                    , value model.statsRoomQuery
                    , onInput StatsQueryInput
                    , attribute "placeholder" "#room or topic"
                    , attribute "autocomplete" "off"
                    ]
                    []
                ]
            , div [ class "stats-control-group", attribute "role" "group", attribute "aria-label" "Room scope" ]
                [ scopeButton model Stats.ScopeAll "All rooms"
                , scopeButton model Stats.ScopePresent "People here now"
                , scopeButton model Stats.ScopeRecent "Active in 24h"
                ]
            , div [ class "stats-control-group", attribute "role" "group", attribute "aria-label" "Sort rooms" ]
                (List.map
                    (\( value, label ) ->
                        button
                            [ type_ "button"
                            , class (if model.statsRoomSort == value then "is-active" else "")
                            , attribute "aria-pressed" (if model.statsRoomSort == value then "true" else "false")
                            , onClick (StatsSortSelect value)
                            ]
                            [ text label ]
                    )
                    Stats.sortLabels
                )
            , p [ class "stats-result-count" ]
                [ text
                    ("Showing "
                        ++ Stats.formatCount (List.length visible)
                        ++ " of "
                        ++ Stats.formatCount (List.length channels)
                        ++ " rooms · sorted by "
                        ++ String.toLower sortLabel
                    )
                ]
            ]
        , div [ class "data-list" ]
            [ if List.isEmpty visible then
                div [ class "data-empty" ] [ text "No rooms match this view. Switch back to all rooms to see the full public index." ]

              else
                div [] (List.map (channelRow model) visible)
            ]
        ]


scopeButton : Model -> Stats.RoomScope -> String -> Html Msg
scopeButton model scope label =
    button
        [ type_ "button"
        , class (if model.statsRoomScope == scope then "is-active" else "")
        , attribute "aria-pressed" (if model.statsRoomScope == scope then "true" else "false")
        , onClick (StatsScopeSelect scope)
        ]
        [ text label ]


channelRow : Model -> Stats.StatsChannel -> Html Msg
channelRow model channel =
    let
        compared =
            List.any (\room -> String.toLower room == String.toLower channel.channel) model.statsCompare

        compareDisabled =
            List.length model.statsCompare >= Stats.maxCompareRooms && not compared

        maxSpark =
            List.maximum channel.spark |> Maybe.withDefault 0 |> max 0

        sparkHeight n =
            String.fromInt
                (if maxSpark <= 0 then
                    3

                 else
                    max 3 (round (n / maxSpark * 100))
                )
    in
    article
        ([ class "data-row data-room-row" ]
            ++ (if String.toLower (statsInspectedChannel model) == String.toLower channel.channel then
                    [ attribute "data-selected" "true" ]

                else
                    []
               )
        )
        [ div [ class "data-room-copy" ]
            [ div [ class "data-room-heading" ]
                [ strong [] [ text channel.channel ]
                , span [] [ text (Stats.activityLabel channel model.nowMs) ]
                ]
            , p [] [ text (if String.isEmpty channel.topic then "No topic set yet." else channel.topic) ]
            ]
        , div [ class "data-room-telemetry" ]
            [ div [ class "channel-spark", attribute "aria-label" (channel.channel ++ " recent activity") ]
                [ if List.isEmpty channel.spark then
                    span [ class "channel-spark-empty" ] [ text "no recent pulse" ]

                  else
                    span [ class "channel-spark-bars", attribute "aria-hidden" "true" ]
                        (List.map (\n -> Html.i [ style "--h" (sparkHeight n) ] []) (List.drop (List.length channel.spark - min 18 (List.length channel.spark)) channel.spark))
                ]
            , dl [ class "data-room-numbers" ]
                [ div [] [ Html.dt [] [ text "messages" ], Html.dd [] [ text (Stats.formatCount channel.messages) ] ]
                , div [] [ Html.dt [] [ text "14-day pulse" ], Html.dd [] [ text (Stats.formatPulse (Stats.roomPulse channel)) ] ]
                , div [] [ Html.dt [] [ text "present" ], Html.dd [] [ text (Stats.formatCount channel.present) ] ]
                ]
            , div [ class "data-room-actions" ]
                [ button
                    [ type_ "button"
                    , class "data-action data-action--compare"
                    , attribute "aria-pressed" (if compared then "true" else "false")
                    , attribute "aria-controls" "room-comparison"
                    , attribute "aria-describedby" "room-comparison-help"
                    , attribute "aria-label"
                        (if compared then
                            "Remove " ++ channel.channel ++ " from comparison"

                         else
                            "Compare " ++ channel.channel
                        )
                    , disabled compareDisabled
                    , onClick (StatsToggleCompare { channel = channel.channel })
                    ]
                    [ text (if compared then "Compared" else "Compare") ]
                , button
                    [ type_ "button"
                    , class "data-action data-action--inspect"
                    , attribute "aria-pressed"
                        (if String.toLower (statsInspectedChannel model) == String.toLower channel.channel then
                            "true"

                         else
                            "false"
                        )
                    , attribute "aria-controls" Stats.inspectorId
                    , onClick (StatsInspect { channel = channel.channel })
                    ]
                    [ text "Inspect" ]
                , a [ class "data-action", href (Stats.roomDeepLink channel.channel channel.lastActive) ] [ text "Open room" ]
                , a [ class "data-action data-action--ledger", href (Stats.statsRoomHref channel.channel) ] [ text "Room ledger" ]
                ]
            ]
        ]


{-| The stats route. -}
route : Model -> List (Html Msg)
route model =
    [ frame model "/stats/" "Onyx network stats" (Just contextLine) [ view model ] ]
