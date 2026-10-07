module View.Thread exposing (thread)

{-| Message thread: welcome / empty / live states for the active
channel, newest last.
-}

import App exposing (Model, Msg(..))
import Avatar
import Dict
import Emoji
import Facepile
import Topic
import Html exposing (Html, a, article, audio, button, div, h2, h3, img, input, label, li, p, section, small, span, strong, text, time, ul, video)
import Html.Attributes exposing (attribute, class, classList, controls, datetime, disabled, for, href, id, placeholder, preload, rel, src, style, tabindex, target, type_, value)
import Html.Events exposing (on, onClick, onInput, onSubmit)
import Json.Decode as Decode
import Set exposing (Set)
import Prefs
import Time
import Translate
import Upload


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
                                [ facepileRow channel
                                , h2 [] [ text channel.name ]
                                , text "No messages yet. Say hello."
                                ]

                        else
                            let
                                win =
                                    App.threadWindowFor model channel

                                chronological =
                                    App.topicVisibleRows model channel.name (List.reverse channel.messages)
                                        |> List.filter (notCollapsed model)

                                rows =
                                    chronological
                                        |> List.drop win.start
                                        |> List.take win.rendered

                                dividerId =
                                    Dict.get (String.toLower channel.name) model.viewUnreadDividerId

                                parents =
                                    App.threadParentIds channel.messages

                                dayLabels =
                                    dayDividerLabels model chronological
                                        |> List.drop win.start
                                        |> List.take win.rendered
                            in
                            div []
                                [ facepileRow channel
                                , topicFilterBar model channel
                                , topicTools model channel
                                , forumCards model channel
                                , if win.hiddenBefore > 0 then
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
                                        (\( ( prev, m ), label ) -> [ dividerAbove dividerId label m, messageRow model channel.name prev parents m ])
                                        (List.map2 Tuple.pair
                                            (List.map2 Tuple.pair (Nothing :: List.map Just rows) rows)
                                            dayLabels
                                        )
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
        , mediaLightboxDialog model
        , threadPanelDialog model
        ]


{-| Replies affordance for messages with children (mirroring
`ThreadIndicator`: offered wherever the row keeps its actions —
full and continuation rows alike, never system rows).
-}
threadIndicator : String -> Set Int -> App.ChatMessage -> Html Msg
threadIndicator target parents m =
    if Set.member m.id parents then
        button
            [ type_ "button"
            , class "onyx-thread-indicator"
            , attribute "aria-label" ("Open thread for message " ++ String.fromInt m.id)
            , onClick (App.ThreadOpen { channel = target, parentId = m.id })
            ]
            [ span [ attribute "aria-hidden" "true" ] [ text "⌥" ]
            , text " thread"
            ]

    else
        text ""


{-| Replies side panel (mirroring the thread `Sheet` +
`ThreadPanel`: the parent article, the replies log, a Reply arm
for intact parents with a server msgid, and the missing-parent
state; Escape and the backdrop light-dismiss like the other
sheets).
-}
threadPanelDialog : Model -> Html Msg
threadPanelDialog model =
    case model.threadPanel of
        Nothing ->
            text ""

        Just panel ->
            case Dict.get (String.toLower panel.channel) model.channels of
                Nothing ->
                    text ""

                Just channel ->
                    let
                        parent =
                            List.filter (\m -> m.id == panel.parentId) channel.messages
                                |> List.head

                        parentMsgid =
                            case parent of
                                Just p ->
                                    p.msgid

                                Nothing ->
                                    Nothing

                        replies =
                            case parentMsgid of
                                Just mid ->
                                    List.filter
                                        (\m ->
                                            case m.replyTo of
                                                Just ref ->
                                                    ref.id == mid

                                                Nothing ->
                                                    False
                                        )
                                        channel.messages

                                Nothing ->
                                    []
                    in
                    div [ class "onyx-thread-pop" ]
                        [ div
                            [ class "onyx-thread-backdrop"
                            , onClick App.ThreadClose
                            ]
                            []
                        , div
                            [ class "onyx-thread-sheet"
                            , attribute "role" "dialog"
                            , attribute "aria-label" "Thread"
                            , on "keydown" threadEscapeDecoder
                            ]
                            [ div [ class "onyx-thread-head" ]
                                [ h2 [ class "onyx-thread-title" ] [ text "Thread" ]
                                , p [ class "onyx-thread-desc" ] [ text "Replies to this message" ]
                                , button
                                    [ attribute "type" "button"
                                    , class "onyx-thread-close"
                                    , attribute "aria-label" "Close thread"
                                    , onClick App.ThreadClose
                                    ]
                                    [ text "Close" ]
                                ]
                            , case parent of
                                Nothing ->
                                    p [ class "onyx-thread-state onyx-thread-state--missing", attribute "role" "status" ]
                                        [ text "Parent message is not loaded in this transcript." ]

                                Just par ->
                                    div
                                        [ class "onyx-thread-msg"
                                        , attribute "aria-label" ("Thread parent: " ++ App.messageAccessibleLabel par)
                                        ]
                                        [ div [ class "onyx-thread-msg-meta" ]
                                            [ span [ class "onyx-thread-msg-from" ] [ text par.from ]
                                            , time [ datetime (App.millisToIso (toFloat par.at)), attribute "aria-hidden" "true" ]
                                                [ text (App.formatRowClock model.zone model.prefs.clock par.at) ]
                                            ]
                                        , p [ class "onyx-thread-msg-text" ] [ text (App.displayBody par) ]
                                        , case par.msgid of
                                            Just _ ->
                                                if par.deleted || par.redacted then
                                                    text ""

                                                else
                                                    button
                                                        [ type_ "button"
                                                        , class "onyx-thread-reply"
                                                        , onClick (App.ThreadReplyParent { channel = panel.channel, parentId = panel.parentId })
                                                        ]
                                                        [ text "Reply" ]

                                            Nothing ->
                                                text ""
                                        ]
                            , div [ attribute "role" "log", attribute "aria-label" ("Thread replies to message " ++ String.fromInt panel.parentId) ]
                                [ if List.isEmpty replies then
                                    p [ class "onyx-thread-state", attribute "role" "status" ]
                                        [ text "No replies loaded yet." ]

                                  else
                                    div []
                                        (List.map
                                            (\msg ->
                                                div
                                                    [ class "onyx-thread-msg"
                                                    , attribute "aria-label" ("Thread reply: " ++ App.messageAccessibleLabel msg)
                                                    ]
                                                    [ div [ class "onyx-thread-msg-meta" ]
                                                        [ span [ class "onyx-thread-msg-from" ] [ text msg.from ]
                                                        , time [ datetime (App.millisToIso (toFloat msg.at)), attribute "aria-hidden" "true" ]
                                                            [ text (App.formatRowClock model.zone model.prefs.clock msg.at) ]
                                                        ]
                                                    , p [ class "onyx-thread-msg-text" ] [ text (App.displayBody msg) ]
                                                    ]
                                            )
                                            replies
                                        )
                                ]
                            ]
                        ]


{-| Escape dismisses the thread panel (same IME-yielding shape
as the card decoder). -}
threadEscapeDecoder : Decode.Decoder Msg
threadEscapeDecoder =
    Decode.field "isComposing" Decode.bool
        |> Decode.andThen
            (\composing ->
                if composing then
                    Decode.fail "ime"

                else
                    Decode.field "key" Decode.string
                        |> Decode.andThen
                            (\key ->
                                if key == "Escape" then
                                    Decode.succeed App.ThreadClose

                                else
                                    Decode.fail "not-escape"
                            )
            )


{-| Overlapping avatar stack for the conversation head
(mirroring the ribbon `Facepile`: prioritized faces open the
member card; the popover chrome stays a narrowing).
-}
facepileRow : App.Channel -> Html Msg
facepileRow channel =
    let
        pile =
            Facepile.buildFacepile
                (List.map
                    (\m -> { nick = m.nick, modes = m.modes, away = m.away, lastActiveAt = Nothing })
                    (Dict.values channel.members)
                )
                Nothing
    in
    if pile.total == 0 then
        text ""

    else
        div
            [ class "onyx-facepile"
            , attribute "role" "group"
            , attribute "aria-label" (Facepile.groupLabel pile.total)
            ]
            (List.map (facepileFace channel.name) pile.entries
                ++ (if pile.overflow > 0 then
                        [ span
                            [ class "onyx-facepile-overflow"
                            , attribute "title" (String.fromInt pile.overflow ++ " more")
                            , attribute "aria-label" (String.fromInt pile.overflow ++ " more people in this room")
                            ]
                            [ span [ attribute "aria-hidden" "true" ] [ text ("+" ++ String.fromInt pile.overflow) ] ]
                        ]

                    else
                        []
                   )
            )


{-| Named-conversation filter chips (mirroring
`TopicFilterBar`: an `All` reset plus one chip per available
topic with per-topic unread badges, active states off the
selected label, selection through the validated
`ChannelTopicSelect`; shown only with the topic tools
preference and at least one labelled row).
-}
topicFilterBar : Model -> App.Channel -> Html Msg
topicFilterBar model channel =
    let
        topics =
            Topic.listTopics (chronologicalTopicRows channel)

        active =
            App.activeChannelTopic model channel.name

        counts =
            topicUnreadFor model channel
    in
    if not model.prefs.topicTools || List.isEmpty topics then
        text ""

    else
        div [ class "topic-filter-bar", attribute "role" "group", attribute "aria-label" "Topic filters" ]
            (button
                [ type_ "button"
                , classList [ ( "topic-chip", True ), ( "topic-chip--all", True ), ( "is-active", active == Nothing ) ]
                , attribute "aria-pressed" (boolToString (active == Nothing))
                , onClick (App.ChannelTopicSelect { channel = channel.name, topic = Nothing })
                ]
                [ text "All" ]
                :: List.map (topicChip channel.name active counts) topics
            )


{-| Topic tools row (mirroring the `shell-topic-filter` block:
a validated new-topic submit, a pressed-state Forum switch, a
pin switch, and the follow toggle; only the filter bar and the
Forum/pin switches wait for at least one topic — like the
oracle, the create form and the follow toggle render as soon as
the preference is on).
-}
topicTools : Model -> App.Channel -> Html Msg
topicTools model channel =
    if not model.prefs.topicTools then
        text ""

    else
        let
            summaries =
                Topic.summarizeTopics (chronologicalTopicRows channel)

            forumOpen =
                Maybe.withDefault False (Dict.get (String.toLower channel.name) model.forumView)

            pinned =
                App.forumPinnedFor model channel.name

            active =
                App.activeChannelTopic model channel.name

            following =
                App.followActiveFor model channel.name

            canStart =
                App.isValidTopicLabel (String.trim model.topicDraft)

            followLabel =
                if following then
                    case active of
                        Just label ->
                            "Following " ++ label

                        Nothing ->
                            "Following room"

                else
                    case active of
                        Just label ->
                            "Follow " ++ label

                        Nothing ->
                            "Follow room"
        in
        div [ class "onyx-topic-tools" ]
            [ Html.form [ class "shell-topic-create", onSubmit (App.TopicCreateSubmit channel.name) ]
                [ label [ class "sr-only", for "shell-topic-create-input" ] [ text "New topic" ]
                , input
                    [ id "shell-topic-create-input"
                    , class "shell-topic-create-input"
                    , value model.topicDraft
                    , placeholder "new topic"
                    , attribute "maxlength" "50"
                    , attribute "autocomplete" "off"
                    , attribute "aria-label" "New topic"
                    , onInput App.TopicDraftInput
                    ]
                    []
                , button
                    [ type_ "submit"
                    , class "shell-topic-action"
                    , disabled (not canStart)
                    ]
                    [ text "Start topic" ]
                ]
            , div [ class "shell-topic-actions" ]
                ((if List.isEmpty summaries then
                    []

                  else
                    [ button
                        [ type_ "button"
                        , classList [ ( "shell-topic-action", True ), ( "is-active", forumOpen ) ]
                        , attribute "aria-pressed" (boolToString forumOpen)
                        , onClick (App.ForumToggle channel.name)
                        ]
                        [ text "Forum" ]
                    , button
                        [ type_ "button"
                        , classList [ ( "shell-topic-action", True ), ( "is-active", pinned ) ]
                        , attribute "aria-pressed" (boolToString pinned)
                        , onClick (App.ForumChannelToggle channel.name)
                        ]
                        [ text
                            (if pinned then
                                "Forum pinned"

                             else
                                "Pin forum"
                            )
                        ]
                    ]
                 )
                    ++ [ button
                            [ type_ "button"
                            , classList [ ( "shell-topic-follow", True ), ( "is-active", following ) ]
                            , attribute "aria-pressed" (boolToString following)
                            , onClick (App.FollowTopicToggle { channel = channel.name, topic = active })
                            ]
                            [ text followLabel ]
                       ]
                )
            ]


{-| Forum cards for every labelled conversation (mirroring the
`shell-topic-forum` section: one card per summary with count,
per-topic unread, latest stamp, and preview, opening through
the validated forum select plus a per-card follow switch).
-}
forumCards : Model -> App.Channel -> Html Msg
forumCards model channel =
    let
        forumOpen =
            Maybe.withDefault False (Dict.get (String.toLower channel.name) model.forumView)

        summaries =
            Topic.summarizeTopics (chronologicalTopicRows channel)

        counts =
            topicUnreadFor model channel
    in
    if not model.prefs.topicTools || not forumOpen || List.isEmpty summaries then
        text ""

    else
        section [ class "shell-topic-forum", attribute "aria-labelledby" "shell-topic-forum-title" ]
            (h3 [ id "shell-topic-forum-title", class "sr-only" ] [ text "Topic forum" ]
                :: List.map (forumCard model channel counts) summaries
            )


forumCard : Model -> App.Channel -> Dict.Dict String Int -> Topic.TopicSummary -> Html Msg
forumCard model channel counts summary =
    let
        latest =
            latestTopicMessage channel summary.topic

        unread =
            Maybe.withDefault 0 (Dict.get (String.toLower summary.topic) counts)

        countLabel =
            String.fromInt summary.count
                ++ (if summary.count == 1 then
                        " message"

                    else
                        " messages"
                   )

        openLabel =
            "Open topic "
                ++ summary.topic
                ++ ", "
                ++ countLabel
                ++ (if unread > 0 then
                        ", " ++ String.fromInt unread ++ " unread on this device"

                    else
                        ""
                   )

        cardFollowed =
            App.topicFollowedFor model channel.name summary.topic
    in
    article [ class "shell-topic-card" ]
        [ button
            [ type_ "button"
            , class "shell-topic-card-main"
            , onClick (App.ForumOpenTopic { channel = channel.name, topic = summary.topic })
            , attribute "aria-label" openLabel
            ]
            [ span [ class "shell-topic-card-title" ] [ text ("#" ++ summary.topic) ]
            , span [ class "shell-topic-card-meta" ]
                ([ span [] [ text countLabel ] ]
                    ++ (if unread > 0 then
                            [ span [ class "shell-topic-card-unread" ]
                                [ text (String.fromInt unread ++ " unread") ]
                            ]

                        else
                            []
                       )
                    ++ [ time
                            [ datetime (App.millisToIso (toFloat summary.lastAt))
                            , attribute "title" (App.millisToIso (toFloat summary.lastAt))
                            ]
                            [ text ("latest " ++ shortDayLabel model summary.lastAt) ]
                       ]
                )
            , case latest of
                Nothing ->
                    text ""

                Just message ->
                    span [ class "shell-topic-card-preview" ]
                        [ span [ class "shell-topic-card-author" ] [ text message.from ]
                        , span [] [ text (clippedTopicPreview (Maybe.withDefault message.body message.plaintext)) ]
                        ]
            ]
        , button
            [ type_ "button"
            , classList [ ( "shell-topic-card-follow", True ), ( "is-active", cardFollowed ) ]
            , attribute "aria-pressed" (boolToString cardFollowed)
            , attribute "aria-label"
                ((if cardFollowed then
                    "Unfollow"

                  else
                    "Follow"
                 )
                    ++ " topic "
                    ++ summary.topic
                )
            , onClick (App.FollowTopicToggle { channel = channel.name, topic = Just summary.topic })
            ]
            [ text
                (if cardFollowed then
                    "Following"

                 else
                    "Follow"
                )
            ]
        ]


{-| Latest non-system row carrying a topic label
(case-insensitive, mirroring `latestTopicMessage`).
-}
latestTopicMessage : App.Channel -> String -> Maybe App.ChatMessage
latestTopicMessage channel topic =
    let
        key =
            String.toLower topic
    in
    List.filter (\m -> not (isSystemRow m) && (topicLabelOf m |> Maybe.map String.toLower) == Just key) channel.messages
        |> List.sortBy .at
        |> List.reverse
        |> List.head


{-| Chronological topic rows for summaries (buffer order is
newest-first; the oracle reads oldest-first for first-casing
parity).
-}
chronologicalTopicRows : App.Channel -> List { topic : Maybe String, at : Int }
chronologicalTopicRows channel =
    List.map (\m -> { topic = topicLabelOf m, at = m.at }) (List.reverse channel.messages)


{-| 110-char card preview clip (mirroring `clipped`). -}
clippedTopicPreview : String -> String
clippedTopicPreview preview =
    if String.length preview > 110 then
        String.left 110 preview ++ "..."

    else
        preview


{-| Short latest stamp (`Jan 16`, mirroring the card
`toLocaleDateString` month-short/day-numeric shape in fixed
English).
-}
shortDayLabel : Model -> Int -> String
shortDayLabel model at =
    monthShort (Time.toMonth model.zone (Time.millisToPosix at))
        ++ " "
        ++ String.fromInt (Time.toDay model.zone (Time.millisToPosix at))


monthShort : Time.Month -> String
monthShort month =
    case month of
        Time.Jan ->
            "Jan"

        Time.Feb ->
            "Feb"

        Time.Mar ->
            "Mar"

        Time.Apr ->
            "Apr"

        Time.May ->
            "May"

        Time.Jun ->
            "Jun"

        Time.Jul ->
            "Jul"

        Time.Aug ->
            "Aug"

        Time.Sep ->
            "Sep"

        Time.Oct ->
            "Oct"

        Time.Nov ->
            "Nov"

        Time.Dec ->
            "Dec"


topicChip : String -> Maybe String -> Dict.Dict String Int -> String -> Html Msg
topicChip channel active counts label =
    let
        isActive =
            case active of
                Just selected ->
                    String.toLower selected == String.toLower label

                Nothing ->
                    False

        unread =
            Maybe.withDefault 0 (Dict.get (String.toLower label) counts)

        accessibleLabel =
            if unread > 0 then
                label ++ ", " ++ String.fromInt unread ++ " unread"

            else
                label
    in
    button
        [ type_ "button"
        , classList [ ( "topic-chip", True ), ( "is-active", isActive ) ]
        , attribute "aria-pressed" (boolToString isActive)
        , attribute "aria-label" accessibleLabel
        , attribute "title" label
        , onClick (App.ChannelTopicSelect { channel = channel, topic = Just label })
        ]
        ([ span [ class "topic-chip__hash", attribute "aria-hidden" "true" ] [ text "#" ]
         , span [ class "topic-chip__label" ] [ text label ]
         ]
            ++ (if unread > 0 then
                    [ span [ class "topic-chip__unread", attribute "aria-label" (String.fromInt unread ++ " unread") ]
                        [ text (String.fromInt unread) ]
                    ]

                else
                    []
               )
        )


{-| Per-topic unread counts for one room (mirroring
`topicUnreadCounts`: the divider else the first-unread cursor
bounds the newest-first buffer under the room notify level).
-}
topicUnreadFor : Model -> App.Channel -> Dict.Dict String Int
topicUnreadFor model channel =
    let
        key =
            String.toLower channel.name

        boundary =
            case Dict.get key model.viewUnreadDividerId of
                Just divider ->
                    Just divider

                Nothing ->
                    Dict.get key model.firstUnreadId

        rows =
            List.map
                (\m ->
                    { id = m.id
                    , topic = m.topic
                    , from = m.from
                    , highlight = m.highlight
                    , system = isSystemRow m
                    }
                )
                channel.messages
    in
    Topic.projectTopicUnread
        { ours = model.ourNick, notifyLevel = App.notifyLevel model channel.name }
        rows
        boundary


{-| Topic label of a row (`Nothing` for untagged rows, mirroring
the `TopicMessage` null shape).
-}
topicLabelOf : App.ChatMessage -> Maybe String
topicLabelOf m =
    if m.topic == "" then
        Nothing

    else
        Just m.topic


boolToString : Bool -> String
boolToString value =
    if value then
        "true"

    else
        "false"


facepileFace : String -> Facepile.Entry -> Html Msg
facepileFace channel entry =
    button
        [ type_ "button"
        , class "onyx-facepile-face"
        , attribute "aria-label" ("Open profile for " ++ entry.nick ++ ", " ++ (if entry.away then "away" else "here"))
        , attribute "title"
            (if entry.away then
                entry.nick ++ " — away"

             else
                entry.nick
            )
        , onClick (App.UserProfileOpened { nick = entry.nick, channel = channel })
        ]
        [ Avatar.view
            { name = entry.nick
            , owner = entry.owner
            , size = Avatar.Sm
            , extraClass =
                if entry.away then
                    "onyx-facepile-away"

                else
                    ""
            , hidden = True
            }
        ]


{-| Collapsed senders hide their lines in the feed (mirroring the
oracle collapse filter; nameless service rows never collapse). -}
notCollapsed : Model -> App.ChatMessage -> Bool
notCollapsed model m =
    if String.isEmpty (String.trim m.from) then
        True

    else
        not (Set.member (String.toLower (String.trim m.from)) model.collapsedNicks)


dividerAbove : Maybe Int -> Maybe String -> App.ChatMessage -> Html Msg
dividerAbove dividerId dayLabel m =
    div []
        [ case dayLabel of
            Nothing ->
                text ""

            Just label ->
                div
                    [ class "onyx-day-divider"
                    , attribute "role" "separator"
                    , attribute "aria-label" label
                    ]
                    [ span [ class "onyx-day-divider-label" ] [ text label ] ]
        , case dividerId of
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
        ]


{-| Calendar day in the message clock zone (mirroring the
`toDateString` day buckets the oracle boundaries compare).
-}
dayKeyFor : Time.Zone -> Int -> ( Int, Int, Int )
dayKeyFor zone at =
    let
        posix =
            Time.millisToPosix at
    in
    ( Time.toYear zone posix, monthNumber (Time.toMonth zone posix), Time.toDay zone posix )


monthNumber : Time.Month -> Int
monthNumber month =
    case month of
        Time.Jan ->
            1

        Time.Feb ->
            2

        Time.Mar ->
            3

        Time.Apr ->
            4

        Time.May ->
            5

        Time.Jun ->
            6

        Time.Jul ->
            7

        Time.Aug ->
            8

        Time.Sep ->
            9

        Time.Oct ->
            10

        Time.Nov ->
            11

        Time.Dec ->
            12


monthName : Time.Month -> String
monthName month =
    case month of
        Time.Jan ->
            "January"

        Time.Feb ->
            "February"

        Time.Mar ->
            "March"

        Time.Apr ->
            "April"

        Time.May ->
            "May"

        Time.Jun ->
            "June"

        Time.Jul ->
            "July"

        Time.Aug ->
            "August"

        Time.Sep ->
            "September"

        Time.Oct ->
            "October"

        Time.Nov ->
            "November"

        Time.Dec ->
            "December"


weekdayName : Time.Weekday -> String
weekdayName day =
    case day of
        Time.Mon ->
            "Monday"

        Time.Tue ->
            "Tuesday"

        Time.Wed ->
            "Wednesday"

        Time.Thu ->
            "Thursday"

        Time.Fri ->
            "Friday"

        Time.Sat ->
            "Saturday"

        Time.Sun ->
            "Sunday"


{-| Human day label (mirroring `dayLabel`: Today / Yesterday /
otherwise the long weekday + month + day; the oracle
locale-renders that last shape, Elm renders fixed English —
the same documented narrowing as the 12-hour clock).
-}
dayLabelFor : Model -> Int -> String
dayLabelFor model at =
    let
        zone =
            model.zone

        posix =
            Time.millisToPosix at
    in
    -- Calendar-day comparison against today and yesterday (the
    -- oracle compares local days; `model.zone` is that zone).
    if dayKeyFor zone at == dayKeyFor zone (round model.nowMs) then
        "Today"

    else if dayKeyFor zone at == dayKeyFor zone (round model.nowMs - 86400000) then
        "Yesterday"

    else
        weekdayName (Time.toWeekday zone posix)
            ++ ", "
            ++ monthName (Time.toMonth zone posix)
            ++ " "
            ++ String.fromInt (Time.toDay zone posix)


{-| Per-row day-divider labels over the full chronological feed
(mirroring the `dayBoundaryFlags` pass: positional, first row
always labelled, a label wherever the day changes; the caller
slices the window exactly like the rows).
-}
dayDividerLabels : Model -> List App.ChatMessage -> List (Maybe String)
dayDividerLabels model messages =
    let
        step m ( prevDay, labels ) =
            let
                day =
                    dayKeyFor model.zone m.at
            in
            if prevDay == Just day then
                ( Just day, Nothing :: labels )

            else
                ( Just day, Just (dayLabelFor model m.at) :: labels )
    in
    List.reverse (Tuple.second (List.foldl step ( Nothing, [] ) messages))


{-| System event rows render without an identity avatar
(mirroring `isSystemMsg`: join/part/quit/kick/mode/topic/nick/
system/error carry no author face; the dedicated system-row
branch itself stays pending).
-}
isSystemRow : App.ChatMessage -> Bool
isSystemRow m =
    List.member m.msgType [ "join", "part", "quit", "kick", "mode", "topic", "nick", "system", "error" ]


{-| Continuation grouping (mirroring `sameAuthorGroup`: the
previous visible row from the same author, neither row systemic,
within five minutes — continuation rows keep only the
timestamp, body, and row actions).
-}
isContinuation : App.ChatMessage -> App.ChatMessage -> Bool
isContinuation prev m =
    prev.from == m.from && not (isSystemRow prev) && not (isSystemRow m) && abs (m.at - prev.at) < 5 * 60 * 1000


messageRow : Model -> String -> Maybe App.ChatMessage -> Set Int -> App.ChatMessage -> Html Msg
messageRow model target prev parents m =
    let
        uncertainDelivery =
            case m.outboxId of
                Just oid ->
                    List.member oid model.outboxUncertain

                Nothing ->
                    False

        withdrawn =
            m.deleted || m.redacted

        cont =
            case prev of
                Just p ->
                    isContinuation p m

                Nothing ->
                    False
    in
    if isSystemRow m then
        div
            [ class "onyx-system"
            , attribute "data-event" m.msgType
            , attribute "role" "article"
            , attribute "tabindex" "-1"
            , attribute "aria-label" m.body
            ]
            [ text m.body ]

    else
        li
            [ classList
                [ ( "onyx-message", True )
                , ( "onyx-continuation", cont )
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
            [ (if cont || isSystemRow m then
                text ""

             else
                div
                    [ class "onyx-row-avatar"
                    , attribute "aria-hidden" "true"
                    , style "--nick-tint" (Avatar.nickTint m.from)
                    ]
                    [ Avatar.view
                        { name = m.from
                        , owner = m.from == model.ourNick
                        , size = Avatar.Sm
                        , extraClass = ""
                        , hidden = True
                        }
                    ]
            )
            , (if cont then
                text ""

               else
                strong [ class "onyx-sender", style "color" (Avatar.nickTint m.from) ] [ text m.from ]
              )
            , (if cont then
                text ""

               else
                case m.audience of
                    Nothing ->
                        text ""

                    Just _ ->
                        span
                            [ class "onyx-audience"
                            , attribute "title" (App.audienceTitle m.audience)
                            ]
                            [ text (App.audienceLabel m.audience) ]
              )
            , if m.at <= 0 then
                text ""

              else
                time [ class "onyx-ts", datetime (App.millisToIso (toFloat m.at)), attribute "aria-hidden" "true" ]
                    [ text (App.formatRowClock model.zone model.prefs.clock m.at) ]
            , span [ class "onyx-body" ] (messageBody model m)
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
            , threadIndicator target parents m
            , messageMenuButton model target m
            , messageMenuPanel model target m
            , reactionPickerPanel model target m
            ]
{-| Per-message actions entry (mirrors the message menu trigger:
offered only for rows with a server msgid, and only when at least
one menu action applies; the Elm shell uses text buttons where the
oracle uses icon buttons, with the same accessible names). -}
messageMenuButton : Model -> String -> App.ChatMessage -> Html Msg
messageMenuButton model target m =
    case m.msgid of
        Nothing ->
            text ""

        Just msgid ->
            let
                caps =
                    App.capabilities (menuInput model target m)
            in
            if not (menuHasActions model target caps || App.isChannelName model target) then
                text ""

            else
                let
                    isOpen =
                        case model.messageMenu of
                            Just open ->
                                String.toLower open.target == String.toLower target && open.msgid == msgid

                            Nothing ->
                                False
                in
                button
                    [ type_ "button"
                    , class "onyx-msg-menu-trigger"
                    , attribute "aria-label" ("Message actions for message from " ++ m.from)
                    , attribute "aria-expanded"
                        (if isOpen then
                            "true"

                         else
                            "false"
                        )
                    , onClick (App.MessageMenuOpen { target = target, msgid = msgid })
                    ]
                    [ text "⋯" ]


{-| Capability input for one thread row (server caps gate edit and
delete like the oracle `canEditMessages` / `canRedactMessages`). -}
menuInput : Model -> String -> App.ChatMessage -> App.CapabilityInput
menuInput model target m =
    { msg = m
    , selfNick = model.ourNick
    , editingEnabled = List.member "draft/message-editing" model.caps
    , deleteSupported = List.member "draft/message-redaction" model.caps
    , channelTarget = App.isChannelName model target
    }


{-| Whether any menu item applies (translate stays a later
slice). -}
menuHasActions : Model -> String -> App.Capabilities -> Bool
menuHasActions model target caps =
    caps.canReply
        || caps.canReact
        || caps.canCopy
        || caps.canQuote
        || caps.canCopyMoment
        || caps.canSearchText
        || caps.canStartTopic
        || caps.canEdit
        || menuCanPin model target
        || caps.canIgnore
        || caps.canCollapse
        || caps.canDelete


{-| Pin affordance (mirroring the oracle `canPin`: channel target
plus op). -}
menuCanPin : Model -> String -> Bool
menuCanPin model target =
    App.isChannelName model target && App.isChannelOp model target


{-| The open menu for one row (mirrors the oracle menu order and
copy: Reply, Copy, Quote, Moment, Ledger, Search, Topic, Edit,
Pin, Ignore, Collapse, then Delete behind its inline confirm
step; tiers are flattened into one menu with a light-dismiss
backdrop, and translate stays a later slice). -}
messageMenuPanel : Model -> String -> App.ChatMessage -> Html Msg
messageMenuPanel model target m =
    case m.msgid of
        Nothing ->
            text ""

        Just msgid ->
            case model.messageMenu of
                Nothing ->
                    text ""

                Just open ->
                    if not (String.toLower open.target == String.toLower target && open.msgid == msgid) then
                        text ""

                    else
                        let
                            caps =
                                App.capabilities (menuInput model target m)

                            actionTarget =
                                "message from " ++ m.from
                        in
                        div [ class "onyx-msg-menu-pop" ]
                            [ div
                                [ class "onyx-msg-menu-backdrop"
                                , onClick App.MessageMenuClose
                                ]
                                []
                            , div
                                [ class "onyx-msg-menu"
                                , attribute "role" "menu"
                                , attribute "aria-label" ("More actions for " ++ actionTarget)
                                , on "keydown" (menuEscapeDecoder model)
                                ]
                            (List.filterMap identity
                                [ if caps.canReply then
                                    Just
                                        (menuItem ("Reply to " ++ m.from)
                                            "Reply"
                                            (App.ReplyArm { target = target, msgid = msgid })
                                        )

                                  else
                                    Nothing
                                , if caps.canReact then
                                    Just
                                        (menuItem ("Choose reaction for " ++ actionTarget)
                                            "React"
                                            (App.ReactionPickerOpen { target = target, msgid = msgid })
                                        )

                                  else
                                    Nothing
                                , if caps.canCopy then
                                    Just
                                        (menuItem ("Copy text from " ++ actionTarget)
                                            "Copy"
                                            (App.MessageMenuCopy { target = target, msgid = msgid })
                                        )

                                  else
                                    Nothing
                                , if caps.canQuote then
                                    Just
                                        (menuItem ("Quote " ++ actionTarget ++ " in composer")
                                            "Quote in composer"
                                            (App.MessageQuote { target = target, from = m.from, body = m.body })
                                        )

                                  else
                                    Nothing
                                , if caps.canCopyMoment then
                                    Just
                                        (menuItem ("Copy moment link for " ++ actionTarget)
                                            "Copy moment link"
                                            (App.MessageCopyMoment { target = target, at = m.at })
                                        )

                                  else
                                    Nothing
                                , if App.isChannelName model target then
                                    Just
                                        (a
                                            [ class "onyx-msg-menu-item"
                                            , attribute "role" "menuitem"
                                            , href (App.statsRoomHref target)
                                            , attribute "aria-label" ("Room ledger for " ++ target)
                                            , onClick App.MessageMenuClose
                                            ]
                                            [ text "Room ledger" ]
                                        )

                                  else
                                    Nothing
                                , if caps.canSearchText then
                                    Just
                                        (case App.loadedActionText m of
                                            Nothing ->
                                                text ""

                                            Just query ->
                                                menuItem ("Search text from " ++ actionTarget)
                                                    "Search this text"
                                                    (App.MessageSearchText { text = query })
                                        )

                                  else
                                    Nothing
                                , if App.loadedActionText m /= Nothing && model.translationAvailable then
                                    Just
                                        (case Dict.get msgid model.translations of
                                            Just entry ->
                                                if entry.status == App.TranslationPending then
                                                    button
                                                        [ type_ "button"
                                                        , class "onyx-msg-menu-item"
                                                        , attribute "role" "menuitem"
                                                        , attribute "aria-label" ("Translate " ++ actionTarget ++ " on this device")
                                                        , disabled True
                                                        ]
                                                        [ text "Translate on this device" ]

                                                else
                                                    menuItem ("Translate " ++ actionTarget ++ " on this device")
                                                        "Translate on this device"
                                                        (App.MessageTranslate { target = target, msgid = msgid })

                                            Nothing ->
                                                menuItem ("Translate " ++ actionTarget ++ " on this device")
                                                    "Translate on this device"
                                                    (App.MessageTranslate { target = target, msgid = msgid })
                                        )

                                  else
                                    Nothing
                                , if caps.canStartTopic then
                                    Just
                                        (menuItem ("Start topic from " ++ actionTarget)
                                            "Start topic from here"
                                            (App.MessageStartTopic { target = target, msgid = msgid })
                                        )

                                  else
                                    Nothing
                                , if caps.canEdit then
                                    Just
                                        (menuItem ("Edit " ++ actionTarget)
                                            "Edit"
                                            (App.EditArm { target = target, msgid = msgid })
                                        )

                                  else
                                    Nothing
                                , if menuCanPin model target then
                                    let
                                        pinned =
                                            List.member msgid (App.channelPins model target)
                                    in
                                    Just
                                        (menuItem
                                            ((if pinned then
                                                "Unpin "

                                              else
                                                "Pin "
                                             )
                                                ++ actionTarget
                                            )
                                            (if pinned then
                                                "Unpin message"

                                             else
                                                "Pin message"
                                            )
                                            (App.MessagePinToggle { target = target, msgid = msgid })
                                        )

                                  else
                                    Nothing
                                , if caps.canIgnore then
                                    let
                                        nick =
                                            String.trim m.from

                                        ignored =
                                            Set.member (String.toLower nick) model.ignoredUsers
                                    in
                                    Just
                                        (menuItem
                                            ((if ignored then
                                                "Stop ignoring "

                                              else
                                                "Ignore "
                                             )
                                                ++ m.from
                                                ++ " on this device"
                                            )
                                            ((if ignored then
                                                "Unignore "

                                              else
                                                "Ignore "
                                             )
                                                ++ m.from
                                            )
                                            (if ignored then
                                                App.UnignoreUser nick

                                             else
                                                App.IgnoreUser nick
                                            )
                                        )

                                  else
                                    Nothing
                                , if caps.canCollapse then
                                    let
                                        nick =
                                            String.trim m.from

                                        collapsed =
                                            Set.member (String.toLower nick) model.collapsedNicks
                                    in
                                    Just
                                        (menuItem
                                            (if collapsed then
                                                "Show messages from " ++ m.from

                                             else
                                                "Hide messages from " ++ m.from ++ " in this feed"
                                            )
                                            ((if collapsed then
                                                "Show "

                                              else
                                                "Hide "
                                             )
                                                ++ m.from
                                            )
                                            (App.MessageCollapseToggle { nick = nick })
                                        )

                                  else
                                    Nothing
                                , if caps.canDelete then
                                    Just
                                        (if open.confirmDelete then
                                            deleteConfirm actionTarget target msgid

                                         else
                                            menuItem ("Delete " ++ actionTarget ++ " for everyone")
                                                "Delete for everyone"
                                                App.MessageMenuDeleteAsk
                                        )

                                  else
                                    Nothing
                                ]
                                ++ translationBlocks model open m msgid actionTarget
                            )
                        ]


{-| Translation section and unavailable note (mirroring the
oracle menu translation panel copy verbatim: pending/done/busy
and failed states, retry/copy/dismiss actions, and the copy
status line). -}
translationBlocks : Model -> { target : String, msgid : String, confirmDelete : Bool } -> App.ChatMessage -> String -> String -> List (Html Msg)
translationBlocks model open m msgid actionTarget =
    let
        note =
            if open.confirmDelete then
                []

            else if App.loadedActionText m == Nothing || model.translationAvailable then
                []

            else
                [ p [ class "onyx-msg-menu-translation-note", attribute "role" "note" ]
                    [ text "On-device translation is unavailable in this browser." ]
                ]
    in
    case Dict.get msgid model.translations of
        Nothing ->
            note

        Just entry ->
            if open.confirmDelete then
                []

            else
                section
                    [ class "onyx-msg-menu-translation"
                    , attribute "aria-label" ("On-device translation for " ++ actionTarget)
                    ]
                    [ div [ class "onyx-msg-menu-translation-head" ]
                        [ span [] [ text (Translate.languageLabel entry.lang) ] ]
                    , p
                        [ class "onyx-msg-menu-translation-text"
                        , attribute "role" "status"
                        , attribute "aria-live" "polite"
                        , attribute "aria-atomic" "true"
                        ]
                        [ text
                            (case entry.status of
                                App.TranslationPending ->
                                    "Translating on this device…"

                                App.TranslationDone ->
                                    entry.text

                                App.TranslationBusy ->
                                    "On-device translation is busy. Retry in a moment."

                                App.TranslationFailed ->
                                    "On-device translation failed. Retry when the local model is ready."
                            )
                        ]
                    , div [ class "onyx-msg-menu-translation-actions" ]
                        (List.filterMap identity
                            [ if entry.status == App.TranslationBusy || entry.status == App.TranslationFailed then
                                Just
                                    (button
                                        [ type_ "button"
                                        , class "onyx-msg-menu-translation-action"
                                        , attribute "aria-label" ("Retry translating " ++ actionTarget ++ " on this device")
                                        , onClick (App.MessageTranslate { target = open.target, msgid = msgid })
                                        ]
                                        [ text "Retry" ]
                                    )

                              else
                                Nothing
                            , if entry.status == App.TranslationDone then
                                Just
                                    (button
                                        [ type_ "button"
                                        , class "onyx-msg-menu-translation-action"
                                        , attribute "aria-label" ("Copy translated text for " ++ actionTarget)
                                        , attribute "disabled"
                                            (if entry.copy == App.TranslationCopyPending then
                                                "true"

                                             else
                                                "false"
                                            )
                                        , onClick (App.MessageTranslationCopy { msgid = msgid })
                                        ]
                                        [ text "Copy translation" ]
                                    )

                              else
                                Nothing
                            , if entry.status /= App.TranslationPending then
                                Just
                                    (button
                                        [ type_ "button"
                                        , class "onyx-msg-menu-translation-action"
                                        , attribute "aria-label" ("Dismiss translation for " ++ actionTarget)
                                        , onClick (App.MessageTranslationDismiss { msgid = msgid })
                                        ]
                                        [ text "Dismiss" ]
                                    )

                              else
                                Nothing
                            ]
                        )
                    , case entry.copy of
                        App.TranslationCopyIdle ->
                            text ""

                        App.TranslationCopyPending ->
                            p [ class "onyx-msg-menu-translation-copy-status", attribute "role" "status", attribute "aria-live" "polite", attribute "aria-atomic" "true" ]
                                [ text "Copying translation…" ]

                        App.TranslationCopied ->
                            p [ class "onyx-msg-menu-translation-copy-status", attribute "role" "status", attribute "aria-live" "polite", attribute "aria-atomic" "true" ]
                                [ text "Translation copied." ]

                        App.TranslationCopyFailed ->
                            p [ class "onyx-msg-menu-translation-copy-status", attribute "role" "status", attribute "aria-live" "polite", attribute "aria-atomic" "true" ]
                                [ text "Could not copy translation. Clipboard access is unavailable." ]
                    ]
                    :: note


{-| One menu item (text button with the oracle accessible name). -}
menuItem : String -> String -> Msg -> Html Msg
menuItem label visible msg =
    button
        [ type_ "button"
        , class "onyx-msg-menu-item"
        , attribute "role" "menuitem"
        , attribute "aria-label" label
        , onClick msg
        ]
        [ text visible ]


{-| The inline delete confirmation (mirrors the oracle confirm
step copy verbatim). -}
deleteConfirm : String -> String -> String -> Html Msg
deleteConfirm actionTarget target msgid =
    div
        [ class "onyx-msg-menu-delete-confirm"
        , attribute "role" "group"
        , attribute "aria-label" ("Confirm deleting " ++ actionTarget ++ " for everyone")
        ]
        [ p [ class "onyx-msg-menu-delete-confirm-title" ] [ text "Delete for everyone?" ]
        , p [ class "onyx-msg-menu-delete-confirm-copy" ]
            [ text "This removes the message from the conversation and cannot be undone." ]
        , div [ class "onyx-msg-menu-delete-confirm-actions" ]
            [ button
                [ type_ "button"
                , class "onyx-msg-menu-delete-confirm-cancel"
                , attribute "aria-label" ("Keep " ++ actionTarget)
                , onClick App.MessageMenuClose
                ]
                [ text "Keep message" ]
            , button
                [ type_ "button"
                , class "onyx-msg-menu-delete-confirm-delete"
                , attribute "aria-label" ("Confirm deleting " ++ actionTarget ++ " for everyone")
                , onClick (App.MessageDeleteRequested target msgid)
                ]
                [ text "Delete for everyone" ]
            ]
        ]


{-| The open reaction picker for one row (mirroring the
oracle react popover: a search field over the curated set plus a
listbox grid of option choices labelled "React to {target} with
{shortcode}" (with the oracle "no matches" note when the query
matches nothing);
choosing emits through the shared react send path and closes the
picker, Escape and the light-dismiss backdrop close it without
choosing). -}
reactionPickerPanel : Model -> String -> App.ChatMessage -> Html Msg
reactionPickerPanel model target m =
    case m.msgid of
        Nothing ->
            text ""

        Just msgid ->
            case model.reactionPicker of
                Nothing ->
                    text ""

                Just open ->
                    if not (String.toLower open.target == String.toLower target && open.msgid == msgid) then
                        text ""

                    else
                        let
                            actionTarget =
                                "message from " ++ m.from

                            results =
                                Emoji.searchEmojis open.query 48
                        in
                        div [ class "onyx-react-pop" ]
                            [ div
                                [ class "onyx-react-backdrop"
                                , onClick App.ReactionPickerClose
                                ]
                                []
                            , div
                                [ class "onyx-react-picker"
                                , attribute "role" "dialog"
                                , attribute "aria-label" ("Choose reaction for " ++ actionTarget)
                                , on "keydown" (pickerEscapeDecoder model)
                                ]
                                [ input
                                    [ type_ "text"
                                    , class "onyx-react-search"
                                    , placeholder "Search emoji"
                                    , attribute "aria-label" "Search emoji"
                                    , attribute "autocomplete" "off"
                                    , value open.query
                                    , onInput App.ReactionPickerSearch
                                    ]
                                    []
                                , div
                                    [ class "onyx-react-grid"
                                    , attribute "role" "listbox"
                                    , attribute "aria-label" "Emoji results"
                                    ]
                                    (List.map (reactionChoice actionTarget) results
                                        ++ (if List.isEmpty results then
                                                [ p [ class "onyx-react-empty" ] [ text "no matches" ] ]

                                            else
                                                []
                                           )
                                    )
                                ]
                            ]


{-| One reaction grid choice (the unicode glyph as its visible
label, like the oracle trigger buttons). -}
reactionChoice : String -> Emoji.EmojiEntry -> Html Msg
reactionChoice actionTarget entry =
    button
        [ type_ "button"
        , class "onyx-react-choice"
        , attribute "role" "option"
        , attribute "aria-label" ("React to " ++ actionTarget ++ " with " ++ entry.shortcode)
        , attribute "title" entry.shortcode
        , onClick (App.ReactionPickerChoose entry.emoji)
        ]
        [ text entry.emoji ]


{-| Escape dismisses the open menu (mirroring the oracle menu
keydown; IME-claimed events yield to the IME). -}
menuEscapeDecoder : Model -> Decode.Decoder Msg
menuEscapeDecoder _ =
    Decode.field "isComposing" Decode.bool
        |> Decode.andThen
            (\composing ->
                if composing then
                    Decode.fail "ime"

                else
                    Decode.field "key" Decode.string
                        |> Decode.andThen
                            (\key ->
                                if key == "Escape" then
                                    Decode.succeed App.MessageMenuClose

                                else
                                    Decode.fail "not-escape"
                            )
            )


{-| Escape dismisses the open reaction picker (same IME-yielding
shape as the menu decoder). -}
pickerEscapeDecoder : Model -> Decode.Decoder Msg
pickerEscapeDecoder _ =
    Decode.field "isComposing" Decode.bool
        |> Decode.andThen
            (\composing ->
                if composing then
                    Decode.fail "ime"

                else
                    Decode.field "key" Decode.string
                        |> Decode.andThen
                            (\key ->
                                if key == "Escape" then
                                    Decode.succeed App.ReactionPickerClose

                                else
                                    Decode.fail "not-escape"
                            )
            )


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


{-| Row body: the caption as text plus one block per `[file]`
receipt (attached images/videos unfurl inline when the sink gate
passes, everything else renders a `FileChip` link with
`target=_blank`, so no `javascript:` href can reach the DOM),
plus one inline-media unfurl per direct image/video/audio URL,
plus the first-link OG preview card when fetched. -}
messageBody : Model -> App.ChatMessage -> List (Html Msg)
messageBody model m =
    let
        presented =
            Upload.extractAttachmentPresentation (App.displayBody m)
    in
    (case m.replyTo of
        Just ref ->
            [ replyContext ref ]

        Nothing ->
            []
    )
        ++ [ text presented.caption ]
        ++ List.map (attachmentCard model) presented.attachments
        ++ mediaUnfurls model presented
        ++ [ previewCard model (App.displayBody m) ]


{-| Reply context line (mirrors the oracle `shell-msg-reply` block:
sender plus the sanitized preview clipped to 80 chars). -}
replyContext : App.ReplyRef -> Html Msg
replyContext ref =
    div [ class "shell-msg-reply", attribute "aria-label" ("Replying to " ++ ref.from) ]
        [ span [ class "shell-msg-reply-from" ] [ text ref.from ]
        , span [] [ text (clippedReplyPreview ref.text) ]
        ]


clippedReplyPreview : String -> String
clippedReplyPreview text =
    let
        safe =
            App.sanitizePersistedReplyPreviewText text
    in
    if String.length safe > 80 then
        String.left 80 safe ++ "…"

    else
        safe


{-| Inline-media unfurl (mirrors `MediaUnfurl`): every direct
image/video/audio URL in the body renders an inline player gated by
the same sink policy as OG cards — auto-load for same-origin or
`previewableHosts` URLs, one explicit consent click otherwise, and a
link fallback once the element reports an error. Kind detection
reuses `classifyAttachmentKind` (extension allowlist); `KindFile`
stays fail-closed with no unfurl. -}
mediaUnfurls : Model -> Upload.AttachmentPresentation -> List (Html Msg)
mediaUnfurls model presented =
    let
        privacy =
            App.liveUnfurlPrivacy model

        attached =
            Set.fromList (List.map .url presented.attachments)
    in
    if not privacy.linkPreviews then
        []

    else
        List.filterMap (mediaUnfurl model privacy attached) (Upload.extractHttpUrls presented.caption)


mediaUnfurl : Model -> Upload.UnfurlPrefs -> Set.Set String -> String -> Maybe (Html Msg)
mediaUnfurl model privacy attached href =
    if Set.member href attached then
        Nothing

    else
        case Upload.classifyAttachmentKind href Nothing of
            Upload.KindFile ->
                Nothing

            kind ->
                if Upload.isSameOriginHttpUrl model.origin href || Upload.isPreviewableUrl href privacy then
                    Just (mediaElement model kind href)

                else
                    Nothing


{-| Shared `MediaUnfurl` element (mirrors the oracle `MediaUnfurl`:
credential-free same-origin or public http(s) hosts may load;
cross-origin stays behind consent; errors swap to the fallback
link; images open the lightbox dialog, whose focus trap and
return-focus live ports-side). -}
mediaElement : Model -> Upload.AttachmentKind -> String -> Html Msg
mediaElement model kind href =
    div [ class "shell-msg-media" ]
        [ if Set.member href model.previewMediaFailed then
            mediaFallback kind href

          else if Upload.isSameOriginHttpUrl model.origin href || Set.member href model.previewImagesAllowed then
            mediaPlayer kind href

          else
            mediaConsent kind href
        ]


mediaKindWord : Upload.AttachmentKind -> String
mediaKindWord kind =
    case kind of
        Upload.KindImage ->
            "image"

        Upload.KindVideo ->
            "video"

        Upload.KindAudio ->
            "audio"

        Upload.KindFile ->
            "file"


mediaPlayer : Upload.AttachmentKind -> String -> Html Msg
mediaPlayer kind href =
    let
        failed =
            Decode.succeed (App.PreviewMediaFailed href)
    in
    case kind of
        Upload.KindImage ->
            button
                [ type_ "button"
                , class "shell-msg-media-open"
                , attribute "aria-label" "Open image"
                , onClick (App.MediaLightboxOpen href)
                ]
                [ img
                    [ src href
                    , attribute "alt" ""
                    , attribute "loading" "lazy"
                    , attribute "decoding" "async"
                    , attribute "referrerpolicy" "no-referrer"
                    , class "shell-msg-media-img"
                    , on "error" failed
                    ]
                    []
                ]

        Upload.KindVideo ->
            video
                [ src href
                , controls True
                , preload "none"
                , class "shell-msg-media-video"
                , attribute "aria-label" "Attached video"
                , attribute "loading" "lazy"
                , on "error" failed
                ]
                []

        Upload.KindAudio ->
            audio
                [ src href
                , controls True
                , preload "none"
                , class "shell-msg-media-audio"
                , attribute "aria-label" "Attached audio"
                , attribute "loading" "lazy"
                , on "error" failed
                ]
                []

        Upload.KindFile ->
            text ""


mediaConsent : Upload.AttachmentKind -> String -> Html Msg
mediaConsent kind href =
    let
        word =
            mediaKindWord kind

        host =
            Upload.parseAbsoluteUrl href
                |> Maybe.map .host
                |> Maybe.withDefault href
    in
    button
        [ type_ "button"
        , class "shell-msg-media-consent"
        , onClick (App.PreviewImageAllow href)
        , attribute "aria-label" ("Load external " ++ word ++ " from " ++ host)
        ]
        [ span [] [ text ("Load external " ++ word) ]
        , small [] [ text host ]
        ]


mediaFallback : Upload.AttachmentKind -> String -> Html Msg
mediaFallback kind url =
    let
        word =
            case kind of
                Upload.KindImage ->
                    "Image"

                Upload.KindVideo ->
                    "Video"

                Upload.KindAudio ->
                    "Audio"

                Upload.KindFile ->
                    "File"
    in
    a
        [ href url
        , target "_blank"
        , rel "noopener noreferrer"
        , class "shell-msg-link shell-msg-media-fallback"
        ]
        [ text (word ++ " preview unavailable — open attachment") ]


{-| Image lightbox dialog (mirrors `MessageImageLightbox`: modal
dialog with backdrop-click and Save/Close actions; Escape closes it
via the top-level subscription; the ports bridge mirrors
`createDialogFocus` (background isolation, scroll lock, Tab trap,
focus-in on open, return-focus on close). -}
mediaLightboxDialog : Model -> Html Msg
mediaLightboxDialog model =
    case model.mediaLightbox of
        Nothing ->
            text ""

        Just url ->
            div [ class "shell-msg-lightbox", attribute "role" "presentation" ]
                [ div
                    [ class "shell-msg-lightbox-backdrop"
                    , attribute "aria-hidden" "true"
                    , onClick App.MediaLightboxClose
                    ]
                    []
                , div
                    [ class "shell-msg-lightbox-dialog"
                    , attribute "role" "dialog"
                    , attribute "aria-modal" "true"
                    , attribute "aria-label" "Image"
                    , tabindex -1
                    ]
                    [ img
                        [ src url
                        , attribute "alt" ""
                        , class "shell-msg-lightbox-img"
                        , attribute "referrerpolicy" "no-referrer"
                        ]
                        []
                    , div [ class "shell-msg-lightbox-actions" ]
                        [ button
                            [ type_ "button"
                            , class "shell-msg-lightbox-save"
                            , onClick (App.MediaSave url)
                            ]
                            [ text "Save" ]
                        , button
                            [ type_ "button"
                            , class "shell-msg-lightbox-close"
                            , attribute "aria-label" "Close"
                            , onClick App.MediaLightboxClose
                            ]
                            [ text "×" ]
                        ]
                    ]
                ]


{-| First-link OG card (mirrors `LinkPreviewCard`: preference-gated,
canonical URL re-validated at the sink, cross-origin thumbnails
behind an explicit consent click; same-origin thumbnails load
directly). -}
previewCard : Model -> String -> Html Msg
previewCard model body =
    let
        privacy =
            App.liveUnfurlPrivacy model
    in
    if not privacy.linkPreviews then
        text ""

    else
        case previewUrlFor privacy body of
            Nothing ->
                text ""

            Just url ->
                case Dict.get url model.linkPreviews of
                    Just (Just card) ->
                        if previewSafe model card then
                            linkPreviewCard model card

                        else
                            text ""

                    _ ->
                        text ""


{-| First plain web link, media-kind hrefs left for media unfurls
(mirrors the oracle `previewUrl` memo). -}
previewUrlFor : Upload.UnfurlPrefs -> String -> Maybe String
previewUrlFor privacy body =
    Upload.pickPreviewUrl
        (List.filter
            (\href -> Upload.classifyAttachmentKind href Nothing == Upload.KindFile)
            (Upload.extractHttpUrls body)
        )
        privacy


{-| Sink gate (mirrors `isAutoLoadableHttpUrl`): the endpoint-derived
canonical URL must be credential-free same-origin or public http(s). -}
previewSafe : Model -> Upload.LinkPreview -> Bool
previewSafe model card =
    Upload.isSameOriginHttpUrl model.origin card.url
        || Upload.isPreviewableUrl card.url (App.liveUnfurlPrivacy model)


linkPreviewCard : Model -> Upload.LinkPreview -> Html Msg
linkPreviewCard model card =
    let
        thumbnail =
            if String.isEmpty card.image then
                Nothing

            else if
                Upload.isSameOriginHttpUrl model.origin card.image
                    || Set.member card.image model.previewImagesAllowed
            then
                if Upload.isSameOriginHttpUrl model.origin card.image || Upload.isPreviewableUrl card.image Upload.previewSsrfOnly then
                    Just card.image

                else
                    Nothing

            else
                Nothing

        consentNeeded =
            not (String.isEmpty card.image) && thumbnail == Nothing
    in
    span [ class "shell-msg-preview" ]
        [ a
            [ href card.url
            , class "shell-msg-preview-link"
            , target "_blank"
            , rel "noopener noreferrer"
            , attribute "aria-label" ("Link preview: " ++ (if String.isEmpty card.title then card.url else card.title))
            ]
            [ span [ class "shell-msg-preview-body" ]
                ([ if String.isEmpty card.site then
                    text ""

                   else
                    span [ class "shell-msg-preview-site" ] [ text card.site ]
                 , if String.isEmpty card.title then
                    text ""

                   else
                    span [ class "shell-msg-preview-title" ] [ text card.title ]
                 , if String.isEmpty card.description then
                    text ""

                   else
                    span [ class "shell-msg-preview-desc" ] [ text card.description ]
                 ]
                )
            ]
        , case thumbnail of
            Just image ->
                img
                    [ src image
                    , class "shell-msg-preview-thumb"
                    , attribute "alt" ""
                    , attribute "width" "72"
                    , attribute "height" "72"
                    , attribute "loading" "lazy"
                    , attribute "decoding" "async"
                    , attribute "referrerpolicy" "no-referrer"
                    ]
                    []

            Nothing ->
                if consentNeeded then
                    button
                        [ attribute "type" "button"
                        , class "shell-msg-preview-consent"
                        , attribute "aria-label" ("Load external preview image from " ++ previewHost card.image)
                        , onClick (PreviewImageAllow card.image)
                        ]
                        [ text "Load image" ]

                else
                    text ""
        ]


previewHost : String -> String
previewHost url =
    case Upload.parseAbsoluteUrl url of
        Just parsed ->
            parsed.host

        Nothing ->
            "external host"


{-| Attached `[file]` receipt block (mirrors `AttachmentBlock`):
attached images/videos unfurl through the shared media element when
the sink gate passes — first-party uploads are chat media, and
cross-origin ones additionally honor the link-preview preference
(whose consent click lives in the unfurl itself). Everything else
renders a `FileChip` link. -}
attachmentCard : Model -> Upload.ParsedAttachment -> Html Msg
attachmentCard model attachment =
    let
        mediaKind =
            case attachment.kind of
                Upload.KindImage ->
                    Just Upload.KindImage

                Upload.KindVideo ->
                    Just Upload.KindVideo

                _ ->
                    Nothing
    in
    case mediaKind of
        Just kind ->
            if attachmentCanUnfurl model attachment.url then
                mediaElement model kind attachment.url

            else
                fileChip attachment

        Nothing ->
            fileChip attachment


attachmentCanUnfurl : Model -> String -> Bool
attachmentCanUnfurl model url =
    let
        privacy =
            App.liveUnfurlPrivacy model
    in
    (Upload.isSameOriginHttpUrl model.origin url || Upload.isPreviewableUrl url privacy)
        && (Upload.isSameOriginHttpUrl model.origin url || privacy.linkPreviews)


{-| Download chip (mirrors `FileChip`): name plus an optional size,
linked with `target=_blank`. -}
fileChip : Upload.ParsedAttachment -> Html Msg
fileChip attachment =
    a
        [ href attachment.url
        , target "_blank"
        , rel "noopener noreferrer"
        , class "shell-msg-file"
        ]
        [ span [ class "shell-msg-file-name" ]
            [ text (Maybe.withDefault "File" attachment.name) ]
        , case attachment.sizeLabel of
            Just size ->
                span [ class "shell-msg-file-size" ] [ text size ]

            Nothing ->
                text ""
        ]
