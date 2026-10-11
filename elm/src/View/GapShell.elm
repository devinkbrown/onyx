module View.GapShell exposing
    ( activitySheet
    , leaveConfirm
    , motdCard
    , railExtras
    , roomMoreItems
    , youEntry
    )

{-| v3/gap-shell views (state and rules: `GapShell`, wiring in `App`).

  - `activitySheet` — "Network activity": the server log the client
    always kept but never showed (server notices, MOTD, WALLOPS,
    ERROR/kill/ban reasons, KNOCK and join denials, unhandled numerics,
    unknown FAIL/WARN/NOTE), newest first with time and kind. A side
    panel on desktop, a bottom sheet on phones (`View.Sheet` `Side`).
  - `railExtras` — the rail's join-by-name field (rooms collection) and
    the Activity row, below "Browse rooms / Start a room".
  - `youEntry` — the same Activity door in the You hub.
  - `roomMoreItems` — Mark as read (when unread), Export transcript,
    Room ledger and Leave room for the room header's More menu (the
    oracle `PresenceRibbon` test ids).
  - `leaveConfirm` — the Leave confirm step (oracle
    `HarborConfirmSheet` copy and ids).
  - `motdCard` — the server's message of the day and onboarding
    welcome pack on Home, dismissible for the day.

-}

import App exposing (Model, Msg(..))
import Dict
import GapShell exposing (ActivityFilter(..), ConnectFailure(..), EntryKind(..))
import Html exposing (Html, a, button, div, form, h2, h3, input, label, li, ol, p, section, small, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, classList, for, href, id, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import View.Sheet as Sheet


gap : GapShell.Msg -> Msg
gap =
    GapShellMsg


boolString : Bool -> String
boolString b =
    if b then
        "true"

    else
        "false"



-- ACTIVITY


activitySheet : Model -> Html Msg
activitySheet model =
    let
        gs =
            model.gapShell
    in
    if not gs.activityOpen then
        text ""

    else
        let
            rows =
                GapShell.activityRows gs.activityFilter gs.activity

            problems =
                List.length (GapShell.activityRows ActivityProblems gs.activity)

            heading =
                Sheet.head
                    { scope = "activity"
                    , title = "Activity"
                    , closeLabel = "Close activity"
                    , onClose = gap GapShell.ActivityClose
                    }
        in
        Sheet.view
            { scope = "activity"
            , label = Sheet.LabelledBy (Sheet.titleId "activity")
            , onClose = gap GapShell.ActivityClose
            , placement = Sheet.Side
            , layerClass = "gs-activity-layer"
            , panelClass = "gs-activity"
            , backdropClass = ""
            , layerAttrs = []
            , modal = True
            , attrs = [ attribute "data-testid" "activity-sheet" ]
            }
            [ Sheet.headerWith
                { heading
                    | kicker = Just "Network"
                    , subtitle = Just "What the server told this session, newest first."
                    , closeTestId = Just "activity-close"
                }
            , div [ class "gs-activity-tools" ]
                [ div [ class "gs-seg", attribute "role" "group", attribute "aria-label" "Show" ]
                    [ filterButton gs.activityFilter ActivityAll "All" (List.length gs.activity)
                    , filterButton gs.activityFilter ActivityProblems "Problems" problems
                    ]
                , connectionLine model
                ]
            , if List.isEmpty rows then
                p [ class "gs-activity-empty", attribute "data-testid" "activity-empty" ]
                    [ text
                        (if gs.activityFilter == ActivityProblems && not (List.isEmpty gs.activity) then
                            "No problems this session."

                         else
                            "Nothing from the network yet. Server messages, replies and connection events show up here."
                        )
                    ]

              else
                ol
                    [ class "gs-activity-list"
                    , attribute "role" "log"
                    , attribute "aria-label" "Network activity"
                    , attribute "data-testid" "activity-list"
                    , Sheet.autofocus "activity"
                    , attribute "tabindex" "0"
                    ]
                    (List.map (activityRow model) rows)
            , p [ class "gs-activity-foot" ] [ text "Kept on this device for this session only." ]
            ]


filterButton : ActivityFilter -> ActivityFilter -> String -> Int -> Html Msg
filterButton current filter label_ count =
    button
        [ type_ "button"
        , class "gs-seg-btn"
        , attribute "aria-pressed" (boolString (current == filter))
        , attribute "data-testid"
            (if filter == ActivityAll then
                "activity-filter-all"

             else
                "activity-filter-problems"
            )
        , onClick (gap (GapShell.ActivityFilterSet filter))
        ]
        [ text label_
        , span [ class "gs-seg-count" ] [ text (String.fromInt count) ]
        ]


connectionLine : Model -> Html Msg
connectionLine model =
    let
        ( key, words ) =
            if model.gapShell.browserOffline then
                ( "offline", "This device is offline" )

            else
                case model.connection of
                    App.Live ->
                        ( "live", "Connected" )

                    App.Registering ->
                        ( "connecting", "Connecting…" )

                    App.Offline ->
                        ( "offline", "Not connected" )
    in
    p [ class "gs-activity-conn", attribute "data-state" key ]
        [ span [ class "gs-activity-conn-dot", attribute "aria-hidden" "true" ] []
        , text words
        ]


activityRow : Model -> GapShell.Entry -> Html Msg
activityRow model entry =
    let
        kind =
            case entry.kind of
                Problem ->
                    "problem"

                Connection ->
                    "connection"

                Notice ->
                    "notice"
    in
    li [ class "gs-act-row", attribute "data-kind" kind ]
        [ span [ class "gs-act-when" ]
            [ text
                (if entry.atMs > 0 then
                    App.formatRowClock model.zone model.prefs.clock (round entry.atMs)

                 else
                    ""
                )
            ]
        , span [ class "gs-act-mark", attribute "aria-hidden" "true" ] []
        , span [ class "gs-act-text" ]
            [ case entry.kind of
                Notice ->
                    text entry.text

                Problem ->
                    span [] [ span [ class "sr-only" ] [ text "Problem: " ], text entry.text ]

                Connection ->
                    span [] [ span [ class "sr-only" ] [ text "Connection: " ], text entry.text ]
            ]
        ]


{-| The Activity door, shared by the rail and the You hub. -}
activityButton : Model -> String -> String -> Html Msg
activityButton model cls testId =
    let
        unseen =
            GapShell.unseenProblems model.gapShell
    in
    button
        [ type_ "button"
        , class cls
        , attribute "data-testid" testId
        , attribute "aria-haspopup" "dialog"
        , attribute "aria-label"
            ("Network activity"
                ++ (if unseen > 0 then
                        ", " ++ String.fromInt unseen ++ " new problem" ++ plural unseen

                    else
                        ""
                   )
            )
        , onClick (gap GapShell.ActivityOpen)
        ]
        [ span [ class "onyx-shi gs-icon-activity", attribute "aria-hidden" "true" ] []
        , span [ class "gs-door-copy" ]
            [ span [ class "gs-door-name" ] [ text "Activity" ]
            , span [ class "gs-door-sub" ] [ text "Network updates" ]
            ]
        , if unseen > 0 then
            span [ class "gs-door-dot", attribute "aria-hidden" "true" ] []

          else
            text ""
        ]


plural : Int -> String
plural n =
    if n == 1 then
        ""

    else
        "s"


{-| Below the rail's Browse / Start: the join-by-name field (rooms
collection only) and the Activity row. -}
railExtras : Model -> Html Msg
railExtras model =
    div [ class "gs-rail-extras" ]
        [ joinField model
        , activityButton model "gs-rail-activity" "sidebar-activity"
        ]


joinField : Model -> Html Msg
joinField model =
    let
        gs =
            model.gapShell

        target =
            case GapShell.normalizeJoinName gs.joinName of
                Ok room ->
                    Just room

                Err _ ->
                    Nothing
    in
    form
        [ class "gs-join"
        , attribute "aria-label" "Join a room"
        , attribute "data-testid" "sidebar-join"
        , onSubmit (gap GapShell.JoinNameSubmit)
        ]
        [ label [ class "sr-only", for "gs-join-input" ] [ text "Room name to join" ]
        , span [ class "gs-join-field" ]
            [ span [ class "gs-join-hash", attribute "aria-hidden" "true" ] [ text "#" ]
            , input
                ([ id "gs-join-input"
                 , class "gs-join-input"
                 , type_ "text"
                 , placeholder "Join by name"
                 , attribute "autocomplete" "off"
                 , attribute "autocapitalize" "off"
                 , attribute "autocorrect" "off"
                 , attribute "spellcheck" "false"
                 , attribute "enterkeyhint" "go"
                 , attribute "data-testid" "sidebar-join-input"
                 , value gs.joinName
                 , onInput (gap << GapShell.JoinNameInput)
                 ]
                    ++ (case gs.joinError of
                            Just _ ->
                                [ attribute "aria-invalid" "true", attribute "aria-describedby" "gs-join-error" ]

                            Nothing ->
                                []
                       )
                )
                []
            , button
                [ type_ "submit"
                , class "gs-join-go"
                , attribute "data-testid" "sidebar-join-submit"
                , attribute "aria-label"
                    (case target of
                        Just room ->
                            "Join " ++ room

                        Nothing ->
                            "Join room"
                    )
                , Html.Attributes.disabled (String.isEmpty (String.trim gs.joinName))
                ]
                [ text "Join" ]
            ]
        , case gs.joinError of
            Just why ->
                p [ id "gs-join-error", class "gs-join-error", attribute "role" "alert" ] [ text why ]

            Nothing ->
                text ""
        ]


youEntry : Model -> Html Msg
youEntry model =
    let
        unseen =
            GapShell.unseenProblems model.gapShell
    in
    button
        [ type_ "button"
        , class "onyx-you-link"
        , attribute "data-testid" "you-open-activity"
        , attribute "aria-haspopup" "dialog"
        , onClick (gap GapShell.ActivityOpen)
        ]
        [ span []
            [ strong [] [ text "Network activity" ]
            , small []
                [ text
                    (if unseen > 0 then
                        String.fromInt unseen ++ " new problem" ++ plural unseen ++ " — server messages and connection events"

                     else
                        "Server messages and connection events"
                    )
                ]
            ]
        ]



-- ROOM MORE MENU


roomMoreItems : Model -> String -> Bool -> List (Html Msg)
roomMoreItems model name isRoom =
    let
        key =
            String.toLower name

        unread =
            case Dict.get key model.channels of
                Just channel ->
                    channel.unread > 0 || channel.highlights > 0 || Dict.member key model.firstUnreadId

                Nothing ->
                    False
    in
    (if unread then
        [ button
            [ type_ "button"
            , class "gs-more-read"
            , attribute "data-testid" "ribbon-mark-read"
            , attribute "aria-label" ("Mark " ++ name ++ " as read")
            , onClick (gap (GapShell.MarkRead name))
            ]
            [ text "Mark as read" ]
        ]

     else
        []
    )
        ++ [ button
                [ type_ "button"
                , class "gs-more-export"
                , attribute "data-testid" "ribbon-export-transcript"
                , attribute "aria-label" ("Export local transcript for " ++ name)
                , onClick (gap (GapShell.ExportTranscript name))
                ]
                [ text "Export transcript" ]
           ]
        ++ (if isRoom then
                [ a
                    [ class "gs-more-ledger"
                    , href (App.statsRoomHref name)
                    , attribute "data-testid" "ribbon-channel-ledger"
                    , attribute "aria-label" ("Room ledger for " ++ name)
                    , onClick RoomMenuClose
                    ]
                    [ text "Room ledger" ]
                , button
                    [ type_ "button"
                    , class "gs-more-leave"
                    , attribute "data-testid" "ribbon-leave-room"
                    , attribute "aria-label" ("Leave " ++ name)
                    , attribute "aria-haspopup" "dialog"
                    , onClick (gap (GapShell.LeaveAsk name))
                    ]
                    [ text "Leave room" ]
                ]

            else
                []
           )


leaveConfirm : Model -> Html Msg
leaveConfirm model =
    case model.gapShell.leaveAsk of
        Nothing ->
            text ""

        Just room ->
            Sheet.view
                { scope = "leave-room"
                , label = Sheet.LabelledBy "gs-leave-title"
                , onClose = gap GapShell.LeaveCancel
                , placement = Sheet.Center
                , layerClass = "gs-leave-layer"
                , panelClass = "gs-leave"
                , backdropClass = ""
                , layerAttrs = []
                , modal = True
                , attrs =
                    [ attribute "data-testid" "harbor-confirm"
                    , attribute "data-kind" "leave"
                    , attribute "aria-describedby" "gs-leave-body"
                    ]
                }
                [ h2 [ class "gs-leave-title", id "gs-leave-title" ] [ text ("Leave " ++ room ++ "?") ]
                , p [ class "gs-leave-body", id "gs-leave-body" ]
                    [ text
                        ("You will leave "
                            ++ room
                            ++ ". History stays on this device."
                            ++ (if model.connection == App.Live then
                                    ""

                                else
                                    " You’re offline, so it leaves your list now and won’t rejoin when you reconnect."
                               )
                        )
                    ]
                , div [ class "gs-leave-actions" ]
                    [ button
                        [ type_ "button"
                        , class "gs-btn gs-btn--ghost"
                        , attribute "data-testid" "harbor-confirm-cancel"
                        , Sheet.autofocus "leave-room"
                        , onClick (gap GapShell.LeaveCancel)
                        ]
                        [ text "Stay" ]
                    , button
                        [ type_ "button"
                        , class "gs-btn gs-btn--danger"
                        , attribute "data-testid" "harbor-leave-confirm"
                        , onClick (gap GapShell.LeaveConfirm)
                        ]
                        [ text "Leave room" ]
                    ]
                ]



-- HOME: MOTD + WELCOME PACK


motdLines : String -> List String
motdLines motd =
    let
        raw =
            String.lines motd
                |> List.map String.trimRight
                |> dropBlankEdges

        dashed =
            not (List.isEmpty raw) && List.all (\l -> String.isEmpty (String.trim l) || String.startsWith "- " l || l == "-") raw
    in
    if dashed then
        List.map
            (\l ->
                if String.startsWith "- " l then
                    String.dropLeft 2 l

                else if l == "-" then
                    ""

                else
                    l
            )
            raw

    else
        raw


dropBlankEdges : List String -> List String
dropBlankEdges lines =
    let
        dropLead =
            List.foldl
                (\l ( started, acc ) ->
                    if not started && String.isEmpty (String.trim l) then
                        ( False, acc )

                    else
                        ( True, acc ++ [ l ] )
                )
                ( False, [] )
                >> Tuple.second
    in
    lines |> dropLead |> List.reverse |> dropLead |> List.reverse


motdCard : Model -> Html Msg
motdCard model =
    let
        gs =
            model.gapShell

        motd =
            if model.showMotd then
                Maybe.map motdLines model.motd |> Maybe.withDefault []

            else
                []

        pack =
            gs.welcomePack

        long =
            List.length motd > 4

        shown =
            if long && not gs.motdExpanded then
                List.take 4 motd

            else
                motd
    in
    if (List.isEmpty motd && List.isEmpty pack) || not (GapShell.motdVisible model.nowMs gs) then
        text ""

    else
        section
            [ class "gs-motd"
            , attribute "aria-labelledby" "gs-motd-title"
            , attribute "data-testid" "home-motd"
            ]
            [ div [ class "gs-motd-head" ]
                [ h2 [ class "gs-motd-title", id "gs-motd-title" ] [ text "From the network" ]
                , button
                    [ type_ "button"
                    , class "gs-motd-dismiss"
                    , attribute "aria-label" "Dismiss the network message for today"
                    , attribute "data-testid" "home-motd-dismiss"
                    , onClick (gap GapShell.MotdDismiss)
                    ]
                    [ span [ class "onyx-sheet-x", attribute "aria-hidden" "true" ] [] ]
                ]
            , if List.isEmpty shown then
                text ""

              else
                div [ class "gs-motd-body", id "gs-motd-body" ]
                    (List.map
                        (\line ->
                            if String.isEmpty (String.trim line) then
                                p [ class "gs-motd-gap", attribute "aria-hidden" "true" ] []

                            else
                                p [ class "gs-motd-line" ] [ text line ]
                        )
                        shown
                    )
            , if long then
                button
                    [ type_ "button"
                    , class "gs-motd-more"
                    , attribute "aria-expanded" (boolString gs.motdExpanded)
                    , attribute "aria-controls" "gs-motd-body"
                    , attribute "data-testid" "home-motd-toggle"
                    , onClick (gap GapShell.MotdToggle)
                    ]
                    [ text
                        (if gs.motdExpanded then
                            "Show less"

                         else
                            "Show all"
                        )
                    ]

              else
                text ""
            , if List.isEmpty pack then
                text ""

              else
                div [ class "gs-motd-pack" ]
                    [ h3 [ class "gs-motd-pack-title" ] [ text "Getting started" ]
                    , ul [ class "gs-motd-pack-list" ] (List.map (\line -> li [] [ text line ]) pack)
                    ]
            ]
