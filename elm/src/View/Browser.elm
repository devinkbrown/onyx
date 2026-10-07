module View.Browser exposing (browser)

{-| Room directory sheet (browse mode), mirroring `ChannelBrowser.tsx`:
search, live/A–Z sort, refresh, the sorted/filtered room cards with
Join/Open/Retry actions, the admission status line, and the
offline/cached states. Create mode hosts the Start-a-room formation
loop (`View.Formation`); the rail carries the entry point.
The debounced screen-reader announcement collapses to the same status
text (no timer); focus trap/Escape stay with the ports layer.
-}

import App exposing (BrowseSort(..), ChannelListEntry, Model, Msg(..), browseMemberLabel, browseStatusMessage, isSoftLaunchRoom, sortBrowseRooms, statsRoomHref, visibleBrowseRooms)
import Dict
import Html exposing (Html, a, button, div, h2, input, li, p, span, text, ul)
import Html.Attributes exposing (attribute, class, disabled, placeholder, type_, value)
import Html.Events exposing (onClick, onInput)
import View.Formation exposing (formation)


browser : Model -> Html Msg
browser model =
    if not model.browserOpen then
        text ""

    else if model.browserMode == App.CreateMode then
        formation model

    else
        let
            offline =
                model.connection /= App.Live

            rows =
                visibleBrowseRooms
                    (sortBrowseRooms model.browserSort model.channelList)
                    model.browserQuery

            status =
                browseStatusMessage
                    { createMode = False
                    , offline = offline && List.isEmpty model.channelList
                    , loading = model.channelListLoading
                    , listEmpty = List.isEmpty model.channelList
                    , disconnected = offline
                    , shown = List.length rows
                    , query = model.browserQuery
                    }
        in
        div [ class "chb-veil" ]
            [ div
                [ class "chb"
                , attribute "role" "dialog"
                , attribute "aria-label" "Browse rooms"
                ]
                [ div [ class "chb-head" ]
                    [ h2 [ class "chb-title" ] [ text "Browse rooms" ]
                    , p [ class "chb-desc" ] [ text "Public rooms with people in them." ]
                    , button
                        [ type_ "button"
                        , class "chb-close"
                        , attribute "aria-label" "Close room browser"
                        , onClick BrowserClose
                        ]
                        [ text "×" ]
                    ]
                , div [ class "chb-toolbar", attribute "role" "search", attribute "aria-label" "Room directory search" ]
                    [ input
                        [ class "chb-filter"
                        , type_ "search"
                        , placeholder "Search rooms…"
                        , attribute "aria-label" "Search rooms"
                        , value model.browserQuery
                        , onInput BrowserQueryInput
                        ]
                        []
                    , div [ class "chb-sort", attribute "role" "group", attribute "aria-label" "Sort rooms" ]
                        [ button
                            [ type_ "button"
                            , class "chb-sort-btn"
                            , attribute "aria-pressed" (pressed (model.browserSort == SortLive))
                            , onClick (BrowserSortInput SortLive)
                            ]
                            [ text "Live" ]
                        , button
                            [ type_ "button"
                            , class "chb-sort-btn"
                            , attribute "aria-pressed" (pressed (model.browserSort == SortName))
                            , onClick (BrowserSortInput SortName)
                            ]
                            [ text "A–Z" ]
                        ]
                    , button
                        [ type_ "button"
                        , class "chb-refresh"
                        , disabled (model.channelListLoading || offline)
                        , onClick RefreshChannelList
                        ]
                        [ text
                            (if offline then
                                "Reconnect to refresh"

                             else if model.channelListLoading then
                                "Refreshing…"

                             else
                                "Refresh"
                            )
                        ]
                    ]
                , p [ class "chb-status", attribute "role" "status" ] [ text status ]
                , browserBody model offline rows
                , admission model
                ]
            ]


pressed : Bool -> String
pressed active =
    if active then
        "true"

    else
        "false"


browserBody : Model -> Bool -> List ChannelListEntry -> Html Msg
browserBody model offline rows =
    if model.channelListLoading && List.isEmpty model.channelList then
        div [ class "chb-state" ] [ text "Loading rooms…" ]

    else if offline && not (List.isEmpty model.channelList) then
        div []
            [ div [ class "chb-state chb-state--offline" ]
                [ p [ class "chb-empty-title" ] [ text "Browsing a saved directory" ]
                , p [] [ text "These rooms are from your last connection. Reconnect to join them." ]
                ]
            , roomList model offline rows
            ]

    else if offline then
        div [ class "chb-state chb-state--offline" ]
            [ p [ class "chb-empty-title" ] [ text "You’re offline" ]
            , p [] [ text "Room discovery is paused. Reconnect to browse or join rooms." ]
            ]

    else if List.isEmpty rows then
        div [ class "chb-state" ]
            [ if String.isEmpty (String.trim model.browserQuery) then
                p [ class "chb-empty-title" ] [ text "No rooms yet. Start one." ]

              else
                text ("Nothing matches “" ++ String.trim model.browserQuery ++ "”.")
            ]

    else
        roomList model offline rows


roomList : Model -> Bool -> List ChannelListEntry -> Html Msg
roomList model offline rows =
    ul [ class "chb-list", attribute "role" "list", attribute "aria-label" "Public room directory" ]
        (List.map (roomRow model offline) rows)


roomRow : Model -> Bool -> ChannelListEntry -> Html Msg
roomRow model offline row =
    let
        key =
            String.toLower row.name

        member =
            Dict.member key model.channels

        soft =
            isSoftLaunchRoom row

        state =
            if member then
                "joined"

            else if soft then
                "new"

            else if row.count > 0 then
                "active"

            else
                "quiet"

        pendingHere =
            model.browserPendingJoin == Just key && model.browserJoinPhase == App.BrowserJoinPending

        retryHere =
            model.browserAttemptedJoin == Just key && (model.browserJoinPhase == App.BrowserJoinRejected || model.browserJoinPhase == App.BrowserJoinUncertain)
    in
    li
        [ class
            ("chb-row"
                ++ (if member then " chb-row--joined" else "")
                ++ (if not soft && row.count > 0 then " chb-row--live" else "")
            )
        , attribute "data-room-state" state
        ]
        [ div [ class "chb-card", attribute "data-room-card" "" ]
            [ div [ class "chb-card-head" ]
                [ span [ class "chb-sigil", attribute "aria-hidden" "true" ] [ text "#" ]
                , span [ class "chb-room-copy" ]
                    [ span [ class "chb-name" ] [ text row.name ] ]
                , if member then
                    span [ class "chb-pill chb-pill--in" ] [ text "In room" ]

                  else
                    text ""
                , span
                    [ class
                        ("chb-count"
                            ++ (if not soft && row.count > 0 then " chb-count--live" else "")
                            ++ (if soft then " chb-count--started" else "")
                        )
                    ]
                    [ text (browseMemberLabel row) ]
                ]
            , p [ class ("chb-topic" ++ (if String.isEmpty row.topic then " is-empty" else "")) ]
                [ text
                    (if String.isEmpty row.topic then
                        "No topic set."

                     else
                        row.topic
                    )
                ]
            , div [ class "chb-actions" ]
                [ a
                    [ class "chb-ledger"
                    , attribute "href" (statsRoomHref row.name)
                    , attribute "aria-label" ("Room ledger for " ++ row.name)
                    ]
                    [ text "Room details" ]
                , button
                    [ type_ "button"
                    , class "chb-join"
                    , onClick (BrowserEnterRoom row.name)
                    , disabled (not member && (offline || pendingHere))
                    , attribute "aria-label"
                        (if member then
                            "Open " ++ row.name

                         else if pendingHere then
                            "Joining " ++ row.name

                         else if retryHere then
                            "Retry " ++ row.name

                         else
                            "Join " ++ row.name
                        )
                    ]
                    [ text
                        (if member then
                            "Open"

                         else if pendingHere then
                            "Joining…"

                         else if retryHere then
                            "Retry"

                         else
                            "Join"
                        )
                    ]
                ]
            ]
        ]


admission : Model -> Html Msg
admission model =
    case App.browserAdmissionMessage model of
        "" ->
            text ""

        message ->
            div [ class "chb-admission", attribute "role" "status", attribute "aria-live" "polite", attribute "aria-atomic" "true" ]
                [ text message ]
