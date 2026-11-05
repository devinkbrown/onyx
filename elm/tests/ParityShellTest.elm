module ParityShellTest exposing (suite)

{-| Criterion-2 behaviors on the shipped init/update/view path. -}

import App exposing (..)
import Dict
import Expect
import FirstHour
import Html.Attributes as Attr
import Json.Decode as Decode
import Json.Encode as Encode
import Prefs
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View.Appearance
import View.Search
import View.Thread


suite : Test
suite =
    describe "parity shell"
        [ quietHours
        , firstHour
        , navigation
        , composer
        , searchStatus
        , threadWindow
        , ctcpMode
        , monitorAway
        , deviceSlots
        ]


nightMs : Float
nightMs =
    1783551600000


noonMs : Float
noonMs =
    1783512000000


feed : Model -> String -> ( Model, List Outbound )
feed model line =
    update (WsLineReceived line) model


navigationValue : List ( String, Encode.Value ) -> Decode.Value
navigationValue fields =
    Encode.object fields
        |> Encode.encode 0
        |> Decode.decodeString Decode.value
        |> Result.withDefault Encode.null


keyedNavigation : String -> List ( String, Encode.Value ) -> Decode.Value
keyedNavigation key fields =
    Encode.object
        [ ( "key", Encode.string key )
        , ( "value", Encode.object fields )
        ]
        |> Encode.encode 0
        |> Decode.decodeString Decode.value
        |> Result.withDefault Encode.null


navigationLoadKey : List Outbound -> String
navigationLoadKey outs =
    List.filterMap
        (\outbound ->
            case outbound of
                NavigationLoad req ->
                    Just req.key

                _ ->
                    Nothing
        )
        outs
        |> String.join ""


navigationSaveJson : List Outbound -> String
navigationSaveJson outs =
    List.filterMap
        (\outbound ->
            case outbound of
                NavigationSave req ->
                    Just req.json

                _ ->
                    Nothing
        )
        outs
        |> String.join ""


navigationSaveKey : List Outbound -> String
navigationSaveKey outs =
    List.filterMap
        (\outbound ->
            case outbound of
                NavigationSave req ->
                    Just req.key

                _ ->
                    Nothing
        )
        outs
        |> String.join ""


starredSaveChannels : List Outbound -> List String
starredSaveChannels outs =
    List.concatMap
        (\outbound ->
            case outbound of
                StarredSave req ->
                    req.channels

                _ ->
                    []
        )
        outs


joinFirst : Model -> String -> String -> Model
joinFirst base nick channel =
    Tuple.first (feed base (":" ++ nick ++ "!u@h JOIN " ++ channel))


alerts : List Outbound -> List Outbound
alerts outs =
    List.filter
        (\outbound ->
            case outbound of
                NotifyAlert _ ->
                    True

                _ ->
                    False
        )
        outs


quietHours : Test
quietHours =
    describe "quiet hours"
        [ test "a 22:00–08:00 window suppresses a background mention at 23:00" <|
            \_ ->
                let
                    setup =
                        { blank
                            | pageVisible = False
                            , appFocused = False
                            , nowMs = nightMs
                            , dndEnabled = False
                            , dndQuietStart = 22
                            , dndQuietEnd = 8
                        }

                    ( granted, _ ) =
                        update (NotifyPermissionChanged "granted") setup

                    ( _, outs ) =
                        feed (joinFirst granted "me" "#c") ":bob!u@h PRIVMSG #c :hi me"
                in
                Expect.equal [] (alerts outs)
        , test "the same window still alerts at noon" <|
            \_ ->
                let
                    setup =
                        { blank
                            | pageVisible = False
                            , appFocused = False
                            , nowMs = noonMs
                            , dndEnabled = False
                            , dndQuietStart = 22
                            , dndQuietEnd = 8
                        }

                    ( granted, _ ) =
                        update (NotifyPermissionChanged "granted") setup

                    ( _, outs ) =
                        feed (joinFirst granted "me" "#c") ":bob!u@h PRIVMSG #c :hi me"
                in
                Expect.equal 1 (List.length (alerts outs))
        , test "equal hours are off, and a change persists" <|
            \_ ->
                let
                    ( changed, outs ) =
                        update (SetDndQuietHours 21 7) { blank | dndQuietStart = 22, dndQuietEnd = 8 }
                in
                Expect.all
                    [ \_ -> Expect.equal 21 changed.dndQuietStart
                    , \_ -> Expect.equal 7 changed.dndQuietEnd
                    , \_ -> Expect.equal [ DndQuietSave { start = 21, end = 7 } ] outs
                    ]
                    ()
        ]


guestHandoff : Model -> Model
guestHandoff model =
    { model
        | ourNick = "me"
        , accountName = Nothing
        , firstHourSeen = False
        , firstHourHandoff =
            Just
                (FirstHour.record
                    { landing = FirstHour.Home
                    , channel = Nothing
                    , guest = True
                    }
                )
    }


firstHour : Test
firstHour =
    describe "first hour"
        [ test "a guest handoff hides the claim chip until it is dismissed" <|
            \_ ->
                let
                    guest =
                        guestHandoff blank

                    ( dismissed, outs ) =
                        update FirstHourDismiss guest
                in
                Expect.all
                    [ \_ -> Expect.equal False (guestClaimVisible guest)
                    , \_ -> Expect.equal True (guestClaimVisible dismissed)
                    , \_ -> Expect.equal [ FirstHourSeenSave ] outs
                    ]
                    ()
        , test "the empty home renders the coach and invite control" <|
            \_ ->
                let
                    html =
                        View.Thread.thread (guestHandoff blank)
                            |> Query.fromHtml
                in
                Expect.all
                    [ \_ -> html |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "first-hour-home") ] |> Query.has [ Selector.text "Browse a room, start one, or invite a friend." ]
                    , \_ ->
                        html
                            |> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Invite a friend" ] ]
                            |> Event.simulate Event.click
                            |> Event.expect FirstHourInvite
                    ]
                    ()
        ]


{-| Guest device memory is keyed by the physical runtime owner (audit
2026-11-05), so guest navigation fixtures carry an owner stamp. -}
guestOwnerStamp : App.RuntimeOwnerStamp
guestOwnerStamp =
    { ownerRef = "guest_owner_test_00000000000000000", networkId = "test_network", accountId = Nothing, accountGeneration = 1, connectionGeneration = 1 }


navigation : Test
navigation =
    describe "owner navigation"
        [ test "starring queues a load of the owner document and a later load keeps the folder" <|
            \_ ->
                let
                    base =
                        { blank | endpoint = Just "wss://irc.example/ws", ourNick = "Kai", runtimeOwnerStamp = Just guestOwnerStamp }

                    ( starred, outs ) =
                        starChannel base "#Lounge"

                    loadKey =
                        List.filterMap
                            (\outbound ->
                                case outbound of
                                    NavigationLoad req ->
                                        Just req.key

                                    _ ->
                                        Nothing
                            )
                            outs
                            |> List.head
                            |> Maybe.withDefault ""

                    stored =
                        Encode.object
                            [ ( "channelFolders"
                              , Encode.list identity
                                    [ Encode.object
                                        [ ( "id", Encode.string "hang" )
                                        , ( "name", Encode.string "Hangouts" )
                                        , ( "channels", Encode.list Encode.string [] )
                                        , ( "collapsed", Encode.bool False )
                                        ]
                                    ]
                              )
                            , ( "starredChannels", Encode.list Encode.string [ "#already" ] )
                            ]

                    value =
                        Encode.encode 0 stored
                            |> Decode.decodeString Decode.value
                            |> Result.withDefault Encode.null

                    ( loaded, saveOuts ) =
                        update (NavigationLoaded value) starred

                    savedJson =
                        List.filterMap
                            (\outbound ->
                                case outbound of
                                    NavigationSave req ->
                                        Just req.json

                                    _ ->
                                        Nothing
                            )
                            saveOuts
                            |> String.join ""
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.any (\outbound -> case outbound of
                            StarredSave _ -> True
                            _ -> False
                        ) outs)
                    , \_ -> Expect.equal True (String.contains "onyx:channel-navigation:owner:" loadKey)
                    , \_ -> Expect.equal True (String.contains "\"id\":\"hang\"" savedJson)
                    , \_ -> Expect.equal True (String.contains "#lounge" savedJson)
                    , \_ -> Expect.equal True (List.member "#lounge" loaded.channelNavigation.starred)
                    ]
                    ()
        , test "pinning a forum room queues the owner document and a later load keeps the pin" <|
            \_ ->
                let
                    base =
                        { blank | endpoint = Just "wss://irc.example/ws", ourNick = "Kai", runtimeOwnerStamp = Just guestOwnerStamp }

                    ( pinned, outs ) =
                        update (ForumChannelToggle "#Hang") base

                    loadKey =
                        List.filterMap
                            (\outbound ->
                                case outbound of
                                    NavigationLoad req ->
                                        Just req.key

                                    _ ->
                                        Nothing
                            )
                            outs
                            |> List.head
                            |> Maybe.withDefault ""

                    stored =
                        Encode.object
                            [ ( "forumChannels", Encode.list Encode.string [ "#already" ] )
                            ]

                    value =
                        Encode.encode 0 stored
                            |> Decode.decodeString Decode.value
                            |> Result.withDefault Encode.null

                    ( loaded, saveOuts ) =
                        update (NavigationLoaded value) pinned

                    savedJson =
                        List.filterMap
                            (\outbound ->
                                case outbound of
                                    NavigationSave req ->
                                        Just req.json

                                    _ ->
                                        Nothing
                            )
                            saveOuts
                            |> String.join ""
                in
                Expect.all
                    [ \_ ->
                        Expect.equal True
                            (List.any
                                (\outbound ->
                                    case outbound of
                                        ForumChannelsSave _ ->
                                            True

                                        _ ->
                                            False
                                )
                                outs
                            )
                    , \_ -> Expect.equal True (String.contains "onyx:channel-navigation:owner:" loadKey)
                    , \_ -> Expect.equal True (String.contains "#hang" savedJson)
                    , \_ -> Expect.equal True (String.contains "#already" savedJson)
                    , \_ -> Expect.equal True (List.member "#hang" loaded.channelNavigation.forum)
                    , \_ -> Expect.equal True (Set.member "#hang" loaded.forumChannels)
                    ]
                    ()
        , test "an account switch does not save the previous owner's stars or folders" <|
            \_ ->
                let
                    alice =
                        { blank
                            | endpoint = Just "wss://irc.example/ws"
                            , ourNick = "me"
                            , accountName = Just "alice"
                            , connection = Live
                        }

                    ( starred, _ ) =
                        starChannel alice "#alpha"

                    aliceDoc =
                        navigationValue
                            [ ( "channelFolders"
                              , Encode.list identity
                                    [ Encode.object
                                        [ ( "id", Encode.string "alice-folder" )
                                        , ( "name", Encode.string "Alice" )
                                        , ( "channels", Encode.list Encode.string [] )
                                        , ( "collapsed", Encode.bool False )
                                        ]
                                    ]
                              )
                            , ( "starredChannels", Encode.list Encode.string [ "#alpha" ] )
                            ]

                    ( loaded, _ ) =
                        update (NavigationLoaded aliceDoc) starred

                    ( switched, switchOuts ) =
                        feed loaded ":irc.example 900 me me!u@h bob :You are now logged in as bob"

                    loadKey =
                        navigationLoadKey switchOuts

                    ( restarred, starOuts ) =
                        starChannel switched "#beta"

                    bobDoc =
                        navigationValue
                            [ ( "starredChannels", Encode.list Encode.string [] )
                            , ( "channelFolders", Encode.list identity [] )
                            ]

                    ( _, saveOuts ) =
                        update (NavigationLoaded bobDoc) restarred

                    saved =
                        navigationSaveJson saveOuts
                in
                Expect.all
                    [ \_ -> Expect.equal True loaded.navigationReady
                    , \_ -> Expect.equal True (List.member "alice-folder" (List.map .id loaded.channelNavigation.channelFolders))
                    , \_ -> Expect.equal True (List.member "#alpha" loaded.channelNavigation.starred)
                    , \_ -> Expect.equal False switched.navigationReady
                    , \_ -> Expect.equal False (List.member "alice-folder" (List.map .id switched.channelNavigation.channelFolders))
                    , \_ -> Expect.equal False (Set.member "#alpha" switched.starredChannels)
                    , \_ -> Expect.equal True (String.contains "bob" loadKey)
                    , \_ -> Expect.equal False (String.contains "alice" loadKey)
                    , \_ -> Expect.equal [ "#beta" ] (starredSaveChannels starOuts)
                    , \_ -> Expect.equal "" (navigationSaveJson starOuts)
                    , \_ -> Expect.equal True (String.contains "#beta" saved)
                    , \_ -> Expect.equal False (String.contains "#alpha" saved)
                    , \_ -> Expect.equal False (String.contains "alice-folder" saved)
                    , \_ -> Expect.equal True (String.contains "bob" (navigationSaveKey saveOuts))
                    , \_ -> Expect.equal False (String.contains "alice" (navigationSaveKey saveOuts))
                    ]
                    ()
        , test "a late navigation load from the previous owner is ignored" <|
            \_ ->
                let
                    alice =
                        { blank
                            | endpoint = Just "wss://irc.example/ws"
                            , ourNick = "me"
                            , accountName = Just "alice"
                            , connection = Live
                        }

                    ( starred, starOuts ) =
                        starChannel alice "#alpha"

                    aliceKey =
                        navigationLoadKey starOuts

                    ( switched, switchOuts ) =
                        feed starred ":irc.example 900 me me!u@h bob :You are now logged in as bob"

                    bobKey =
                        navigationLoadKey switchOuts

                    stale =
                        keyedNavigation aliceKey
                            [ ( "channelFolders"
                              , Encode.list identity
                                    [ Encode.object
                                        [ ( "id", Encode.string "alice-folder" )
                                        , ( "name", Encode.string "Alice" )
                                        , ( "channels", Encode.list Encode.string [] )
                                        , ( "collapsed", Encode.bool False )
                                        ]
                                    ]
                              )
                            , ( "starredChannels", Encode.list Encode.string [ "#alpha" ] )
                            ]

                    ( ignored, ignoredOuts ) =
                        update (NavigationLoaded stale) switched

                    ( restarred, _ ) =
                        starChannel ignored "#beta"

                    fresh =
                        keyedNavigation bobKey
                            [ ( "starredChannels", Encode.list Encode.string [] )
                            , ( "channelFolders", Encode.list identity [] )
                            ]

                    ( _, saveOuts ) =
                        update (NavigationLoaded fresh) restarred

                    saved =
                        navigationSaveJson saveOuts
                in
                Expect.all
                    [ \_ -> Expect.notEqual "" aliceKey
                    , \_ -> Expect.notEqual aliceKey bobKey
                    , \_ -> Expect.equal False ignored.navigationReady
                    , \_ -> Expect.equal False (List.member "alice-folder" (List.map .id ignored.channelNavigation.channelFolders))
                    , \_ -> Expect.equal False (Set.member "#alpha" ignored.starredChannels)
                    , \_ -> Expect.equal "" (navigationSaveJson ignoredOuts)
                    , \_ -> Expect.equal True (String.contains "#beta" saved)
                    , \_ -> Expect.equal False (String.contains "#alpha" saved)
                    , \_ -> Expect.equal False (String.contains "alice-folder" saved)
                    , \_ -> Expect.equal True (String.contains "bob" (navigationSaveKey saveOuts))
                    ]
                    ()
        ]


composer : Test
composer =
    describe "composer completion"
        [ test "picking a slash suggestion rewrites the composer" <|
            \_ ->
                let
                    ( typed, _ ) =
                        update (ComposerInput "/j") blank

                    ( picked, _ ) =
                        update (SlashSuggestPick "join") typed
                in
                Expect.equal "/join " picked.composer
        , test "moving the nick highlight and picking it rewrites the composer" <|
            \_ ->
                let
                    room =
                        joinFirst blank "me" "#c"
                            |> (\model -> Tuple.first (feed model ":irc.example 353 me = #c :alice alex"))

                    ( typed, _ ) =
                        update (ComposerInput "al") { room | activeChannel = Just "#c" }

                    ( moved, _ ) =
                        update (NickSuggestMove 1) typed

                    pick =
                        nickSuggestionMatches moved
                            |> List.drop moved.nickIndex
                            |> List.head
                            |> Maybe.withDefault ""

                    ( done, _ ) =
                        update (NickSuggestPick pick) moved
                in
                Expect.all
                    [ \_ -> Expect.notEqual 0 moved.nickIndex
                    , \_ -> Expect.equal (pick ++ " ") done.composer
                    , \_ -> Expect.notEqual "" pick
                    ]
                    ()
        ]


searchStatus : Test
searchStatus =
    describe "search history status"
        [ test "history off with no conversation reports the oracle copy" <|
            \_ ->
                let
                    model =
                        { blank
                            | searchOpen = True
                            , activeChannel = Nothing
                            , prefs = Prefs.updatePreference blank.prefs "localHistory" "false"
                        }

                    html =
                        View.Search.panel model |> Query.fromHtml
                in
                Expect.all
                    [ \_ -> html |> Query.has [ Selector.text "History off" ]
                    , \_ -> html |> Query.has [ Selector.text "Device history is off, so there are no remembered conversations to search." ]
                    , \_ ->
                        html
                            |> Query.find [ Selector.tag "button", Selector.containing [ Selector.text "Open history preferences" ] ]
                            |> Event.simulate Event.click
                            |> Event.expect SearchOpenHistory
                    ]
                    ()
        , test "history on with no conversation names remembered conversations" <|
            \_ ->
                let
                    html =
                        View.Search.panel
                            { blank
                                | searchOpen = True
                                , activeChannel = Nothing
                            }
                            |> Query.fromHtml
                in
                Expect.all
                    [ \_ ->
                        html
                            |> Query.find [ Selector.tag "input" ]
                            |> Query.has [ Selector.attribute (Attr.placeholder "Search messages saved on this device") ]
                    , \_ -> html |> Query.has [ Selector.text "0 remembered" ]
                    , \_ -> html |> Query.has [ Selector.text "all remembered conversations" ]
                    , \_ -> html |> Query.has [ Selector.text "Search all remembered conversations" ]
                    ]
                    ()
        , test "appearance shows the quiet-hours summary and caption row" <|
            \_ ->
                let
                    html =
                        View.Appearance.view { blank | dndQuietStart = 22, dndQuietEnd = 8 }
                            |> Query.fromHtml
                in
                Expect.all
                    [ \_ -> html |> Query.has [ Selector.text "quiet hours 10:00 PM to 8:00 AM" ]
                    , \_ -> html |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "caption-transcript") ] |> Query.has [ Selector.text "Caption transcript copy" ]
                    ]
                    ()
        ]


threadWindow : Test
threadWindow =
    describe "thread window"
        [ test "Show earlier grows a long tail" <|
            \_ ->
                let
                    seeded =
                        List.foldl
                            (\n model ->
                                Tuple.first (feed model (":bob!u@h PRIVMSG #c :row " ++ String.fromInt n))
                            )
                            (joinFirst { blank | connection = Live, caps = [ "chathistory" ] } "me" "#c")
                            (List.range 1 130)

                    ( opened, _ ) =
                        update (ChannelSelect "#c") seeded

                    ready =
                        { opened | historyLoading = Set.empty, historyExhausted = Set.empty }

                    ( grown, outs ) =
                        update ThreadShowEarlier ready

                    askedEarlier =
                        List.any
                            (\outbound ->
                                case outbound of
                                    SendLine line ->
                                        String.contains "CHATHISTORY" line && String.contains "BEFORE" line

                                    _ ->
                                        False
                            )
                            outs
                in
                Expect.equal True
                    (grown.threadWindowSize
                        > ready.threadWindowSize
                        || askedEarlier
                        || (grown.threadPageStart /= ready.threadPageStart && grown.threadPageStart /= Nothing)
                    )
        , test "the New control jumps to the unread divider" <|
            \_ ->
                let
                    room =
                        joinFirst blank "me" "#c"
                            |> (\model -> Tuple.first (feed model ":bob!u@h PRIVMSG #c :hi me"))

                    ( opened, _ ) =
                        update (ChannelSelect "#c") room

                    html =
                        View.Thread.thread opened |> Query.fromHtml

                    ( jumped, _ ) =
                        update ThreadJumpUnread opened
                in
                Expect.all
                    [ \_ ->
                        html
                            |> Query.find [ Selector.attribute (Attr.attribute "data-testid" "unread-jump") ]
                            |> Event.simulate Event.click
                            |> Event.expect ThreadJumpUnread
                    , \_ -> Expect.equal True jumped.forceUnreadNav
                    , \_ -> Expect.notEqual Nothing jumped.threadPageStart
                    ]
                    ()
        ]


ctcpMode : Test
ctcpMode =
    describe "CTCP and channel mode +C"
        [ test "a +C channel still answers VERSION, and the kill switch drops it" <|
            \_ ->
                let
                    room =
                        joinFirst { blank | ctcpEnabled = True } "me" "#c"

                    ( moded, _ ) =
                        feed room ":irc.example MODE #c +C"

                    modes =
                        Dict.get "#c" moded.channels
                            |> Maybe.map .modes
                            |> Maybe.withDefault ""

                    ( _, answered ) =
                        feed moded ":bob!u@h PRIVMSG #c :\u{0001}VERSION\u{0001}"

                    ( _, silenced ) =
                        feed { moded | ctcpEnabled = False } ":bob!u@h PRIVMSG #c :\u{0001}VERSION\u{0001}"

                    notices outbound =
                        List.any
                            (\item ->
                                case item of
                                    SendLine line ->
                                        String.contains "VERSION" line

                                    _ ->
                                        False
                            )
                            outbound
                in
                Expect.all
                    [ \_ -> Expect.equal True (String.contains "C" modes)
                    , \_ -> Expect.equal True (notices answered)
                    , \_ -> Expect.equal False (notices silenced)
                    ]
                    ()
        ]


monitorAway : Test
monitorAway =
    describe "monitor DM away"
        [ test "731 marks an existing DM away and 730 clears it" <|
            \_ ->
                let
                    room =
                        Tuple.first (feed blank ":bob!u@h PRIVMSG me :hello")

                    ( offline, _ ) =
                        feed room ":irc.example 731 me :bob"

                    ( online, _ ) =
                        feed offline ":irc.example 730 me :bob!u@h"
                in
                Expect.all
                    [ \_ -> Expect.equal (Just True) (Dict.get "bob" offline.dmAway)
                    , \_ -> Expect.equal Nothing (Dict.get "bob" online.dmAway)
                    ]
                    ()
        ]


deviceSlots : Test
deviceSlots =
    describe "owner device slots"
        [ test "a loaded owner document replaces session lists through the parsers" <|
            \_ ->
                let
                    payload =
                        Encode.object
                            [ ( "ignored", Encode.list Encode.string [ "Kai", "\u{0001}bad" ] )
                            , ( "muted", Encode.list Encode.string [ "spam" ] )
                            , ( "highlight", Encode.list Encode.string [ "Raid", "raid" ] )
                            , ( "autoJoin", Encode.list Encode.string [ "#Lounge", "nope" ] )
                            , ( "followed", Encode.list Encode.string [ "#c/Topic" ] )
                            , ( "notify"
                              , Encode.object
                                    [ ( "#Lounge", Encode.string "none" )
                                    , ( "#x", Encode.string "all" )
                                    ]
                              )
                            , ( "colors"
                              , Encode.object
                                    [ ( "#Lounge", Encode.string "#ABC" )
                                    , ( "#x", Encode.string "red" )
                                    ]
                              )
                            ]

                    seeded =
                        { blank
                            | ignoredUsers = Set.singleton "guest"
                            , mutedDMs = Set.singleton "old"
                            , highlightWords = [ "old" ]
                            , autoJoinChannels = [ "#old" ]
                            , followed = Set.singleton "old"
                            , channelNotify = Dict.singleton "#old" "mentions"
                            , channelColors = Dict.singleton "#old" "#fff"
                        }

                    ( loaded, outs ) =
                        update (DeviceSlotsLoaded payload) seeded
                in
                Expect.all
                    [ \_ -> Expect.equal (Set.fromList [ "kai" ]) loaded.ignoredUsers
                    , \_ -> Expect.equal (Set.singleton "spam") loaded.mutedDMs
                    , \_ -> Expect.equal [ "raid" ] loaded.highlightWords
                    , \_ -> Expect.equal [ "#lounge" ] loaded.autoJoinChannels
                    , \_ -> Expect.equal (Set.singleton "#c/topic") loaded.followed
                    , \_ -> Expect.equal (Dict.singleton "#lounge" "none") loaded.channelNotify
                    , \_ -> Expect.equal (Dict.singleton "#lounge" "#abc") loaded.channelColors
                    , \_ -> Expect.equal [] outs
                    ]
                    ()
        ]
