module ChannelListTest exposing (suite)

{-| Vectors for the channel directory `LIST` fold, mirroring the
oracle `channelList` slice (`refreshChannelList`, the `322` merge with
its name/count/topic normalization and 2048 cap, the `323` commit, the
15s timeout quarantine, and the transport reset).
-}

import App exposing (..)
import Expect
import Test exposing (Test, describe, test)


live : Model
live =
    { blank | ourNick = "kai", endpoint = Just "wss://irc.example" }


refreshing : Model
refreshing =
    Tuple.first (update RefreshChannelList live)


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


suite : Test
suite =
    describe "channel directory"
        [ describe "refreshChannelList"
            [ test "live refresh sends LIST and arms the request" <|
                \_ ->
                    let
                        ( started, out ) =
                            update RefreshChannelList live
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ SendLine "LIST\r\n" ] out
                        , \m -> Expect.equal True m.channelListLoading
                        , \m -> Expect.equal (Just []) m.channelListRequest
                        , \m -> Expect.equal 1 m.channelListGen
                        , \m -> Expect.equal (m.nowMs + channelListTimeoutMs) m.channelListDueMs
                        ]
                        started
            , test "offline refresh keeps the cache and never loads" <|
                \_ ->
                    let
                        cached =
                            { live | connection = Offline, channelList = [ { name = "#old", count = 3, topic = "t" } ] }

                        ( stayed, out ) =
                            update RefreshChannelList cached
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \m -> Expect.equal False m.channelListLoading
                        , \m -> Expect.equal [ { name = "#old", count = 3, topic = "t" } ] m.channelList
                        ]
                        stayed
            , test "a second refresh while loading is a no-op" <|
                \_ ->
                    let
                        ( again, out ) =
                            update RefreshChannelList refreshing
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \m -> Expect.equal 1 m.channelListGen
                        ]
                        again
            , test "refresh while quarantined is a no-op" <|
                \_ ->
                    let
                        held =
                            { refreshing | channelListLoading = False, channelListQuarantined = True }

                        ( again, out ) =
                            update RefreshChannelList held
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \m -> Expect.equal False m.channelListLoading
                        ]
                        again
            ]
        , describe "foldListRow"
            [ test "rows merge into the live request" <|
                \_ ->
                    let
                        filled =
                            feed refreshing ":s 322 kai #a 5 :alpha topic"
                                |> (\m -> feed m ":s 322 kai #b xx :beta")
                    in
                    Expect.equal
                        [ { name = "#a", count = 5, topic = "alpha topic" }
                        , { name = "#b", count = 0, topic = "beta" }
                        ]
                        filled.channelList
            , test "invalid names never land" <|
                \_ ->
                    let
                        filled =
                            feed refreshing ":s 322 kai bob 5 :not a channel"
                                |> (\m -> feed m ":s 322 kai #a,b 5 :comma")
                                |> (\m -> feed m ":s 322 kai &ok 2 :ampersand fine")
                    in
                    Expect.equal [ { name = "&ok", count = 2, topic = "ampersand fine" } ] filled.channelList
            , test "duplicates keep the name, max the count, fill blank topics" <|
                \_ ->
                    let
                        filled =
                            feed refreshing ":s 322 kai #A 5 :"
                                |> (\m -> feed m ":s 322 kai #a 9 :new topic")
                                |> (\m -> feed m ":s 322 kai #a 1 :overwrite attempt")
                    in
                    Expect.equal [ { name = "#A", count = 9, topic = "new topic" } ] filled.channelList
            , test "stray rows without a live request are silent" <|
                \_ ->
                    let
                        stray =
                            feed live ":s 322 kai #a 5 :alpha"
                    in
                    Expect.all
                        [ \m -> Expect.equal [] m.channelList
                        , \m -> Expect.equal False m.channelListLoading
                        ]
                        stray
            , test "rows arriving after the commit are silent" <|
                \_ ->
                    let
                        done =
                            feed refreshing ":s 323 kai :End of LIST"

                        late =
                            feed done ":s 322 kai #late 1 :too late"
                    in
                    Expect.equal [] late.channelList
            ]
        , describe "foldListEnd"
            [ test "323 commits the request" <|
                \_ ->
                    let
                        filled =
                            feed refreshing ":s 322 kai #a 5 :alpha"

                        done =
                            feed filled ":s 323 kai :End of LIST"
                    in
                    Expect.all
                        [ \m -> Expect.equal [ { name = "#a", count = 5, topic = "alpha" } ] m.channelList
                        , \m -> Expect.equal [ { name = "#a", count = 5, topic = "alpha" } ] m.channelListCommitted
                        , \m -> Expect.equal False m.channelListLoading
                        , \m -> Expect.equal Nothing m.channelListRequest
                        ]
                        done
            , test "323 with nothing loading is a no-op" <|
                \_ ->
                    Expect.equal live (feed live ":s 323 kai :End of LIST")
            , test "323 releases a timeout quarantine without committing" <|
                \_ ->
                    let
                        stale =
                            { refreshing
                                | channelListRequest = Just [ { name = "#stale", count = 1, topic = "x" } ]
                                , channelListQuarantined = True
                            }

                        released =
                            feed stale ":s 323 kai :End of LIST"
                    in
                    Expect.all
                        [ \m -> Expect.equal False m.channelListQuarantined
                        , \m -> Expect.equal [] m.channelList
                        ]
                        released
            ]
        , describe "fireChannelListTimeout"
            [ test "expiry quarantines and falls back to committed" <|
                \_ ->
                    let
                        stale =
                            { refreshing
                                | channelListCommitted = [ { name = "#kept", count = 2, topic = "k" } ]
                                , channelListRequest = Just [ { name = "#partial", count = 1, topic = "p" } ]
                                , channelList = [ { name = "#partial", count = 1, topic = "p" } ]
                                , channelListDueMs = 1000
                            }

                        fired =
                            fireChannelListTimeout 16000 stale
                    in
                    Expect.all
                        [ \m -> Expect.equal [ { name = "#kept", count = 2, topic = "k" } ] m.channelList
                        , \m -> Expect.equal False m.channelListLoading
                        , \m -> Expect.equal Nothing m.channelListRequest
                        , \m -> Expect.equal True m.channelListQuarantined
                        ]
                        fired
            , test "rows drop while quarantined" <|
                \_ ->
                    let
                        stale =
                            { refreshing | channelListQuarantined = True, channelListLoading = False }

                        dropped =
                            feed stale ":s 322 kai #a 5 :alpha"
                    in
                    Expect.equal [] dropped.channelList
            , test "early ticks leave the request alone" <|
                \_ ->
                    let
                        held =
                            { refreshing | channelListDueMs = 99999 }
                    in
                    Expect.equal True (fireChannelListTimeout 1000 held).channelListLoading
            ]
        , describe "resetChannelListTransport"
            [ test "a new transport turns the generation and releases quarantine" <|
                \_ ->
                    let
                        reset =
                            resetChannelListTransport
                                { refreshing | channelListQuarantined = True, channelListDueMs = 5000 }
                    in
                    Expect.all
                        [ \m -> Expect.equal 2 m.channelListGen
                        , \m -> Expect.equal 0 m.channelListDueMs
                        , \m -> Expect.equal False m.channelListQuarantined
                        ]
                        reset
            ]
        , describe "browse presentation"
            [ test "soft launch is count <= 1" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (isSoftLaunchRoom { name = "#a", count = 1, topic = "" })
                        , \_ -> Expect.equal True (isSoftLaunchRoom { name = "#a", count = 0, topic = "" })
                        , \_ -> Expect.equal False (isSoftLaunchRoom { name = "#a", count = 2, topic = "" })
                        ]
                        ()
            , test "name sort is case-insensitive" <|
                \_ ->
                    Expect.equal [ "#alpha", "#Beta", "#gamma" ]
                        (List.map .name
                            (sortBrowseRooms SortName
                                [ { name = "#gamma", count = 9, topic = "" }
                                , { name = "#Beta", count = 3, topic = "" }
                                , { name = "#alpha", count = 1, topic = "" }
                                ]
                            )
                        )
            , test "live sort demotes soft rooms, then counts down, then names" <|
                \_ ->
                    Expect.equal [ "#busy", "#quiet", "#new" ]
                        (List.map .name
                            (sortBrowseRooms SortLive
                                [ { name = "#new", count = 1, topic = "" }
                                , { name = "#quiet", count = 2, topic = "" }
                                , { name = "#busy", count = 9, topic = "" }
                                ]
                            )
                        )
            , test "default hall hides soft rooms; search finds them by name or topic" <|
                \_ ->
                    let
                        rows =
                            [ { name = "#hall", count = 9, topic = "general chat" }
                            , { name = "#tiny", count = 1, topic = "fresh" }
                            ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ "#hall" ] (List.map .name (visibleBrowseRooms rows ""))
                        , \_ -> Expect.equal [ "#tiny" ] (List.map .name (visibleBrowseRooms rows "tiny"))
                        , \_ -> Expect.equal [ "#hall" ] (List.map .name (visibleBrowseRooms rows "GENERAL"))
                        , \_ -> Expect.equal [] (visibleBrowseRooms rows "nope")
                        ]
                        ()
            , test "member labels mark soft rooms Just started" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "Just started" (browseMemberLabel { name = "#a", count = 1, topic = "" })
                        , \_ -> Expect.equal "2 users" (browseMemberLabel { name = "#a", count = 2, topic = "" })
                        ]
                        ()
            , test "status copy covers every branch verbatim" <|
                \_ ->
                    let
                        base =
                            { createMode = False
                            , offline = False
                            , loading = False
                            , listEmpty = False
                            , disconnected = False
                            , shown = 0
                            , query = ""
                            }
                    in
                    Expect.all
                        [ \_ -> Expect.equal "" (browseStatusMessage { base | createMode = True })
                        , \_ -> Expect.equal "Room discovery is unavailable offline. Reconnect to refresh and join." (browseStatusMessage { base | offline = True })
                        , \_ -> Expect.equal "Loading rooms…" (browseStatusMessage { base | loading = True, listEmpty = True })
                        , \_ -> Expect.equal "No rooms yet." (browseStatusMessage base)
                        , \_ -> Expect.equal "No rooms match “zzz”." (browseStatusMessage { base | query = " zzz " })
                        , \_ -> Expect.equal "3 saved rooms offline. Reconnect to join." (browseStatusMessage { base | disconnected = True, shown = 3 })
                        , \_ -> Expect.equal "1 saved room offline. Reconnect to join." (browseStatusMessage { base | disconnected = True, shown = 1 })
                        , \_ -> Expect.equal "2 rooms match “a”." (browseStatusMessage { base | shown = 2, query = "a" })
                        , \_ -> Expect.equal "1 room matches “a”." (browseStatusMessage { base | shown = 1, query = "a" })
                        , \_ -> Expect.equal "4 rooms you can join." (browseStatusMessage { base | shown = 4 })
                        , \_ -> Expect.equal "1 room you can join." (browseStatusMessage { base | shown = 1 })
                        ]
                        ()
            ]
        , describe "browser chrome"
            [ test "open shows the sheet and refreshes the directory" <|
                \_ ->
                    let
                        ( opened, out ) =
                            update BrowserOpen live
                    in
                    Expect.all
                        [ \m -> Expect.equal True m.browserOpen
                        , \_ -> Expect.equal [ SendLine "LIST\r\n" ] out
                        , \m -> Expect.equal True m.channelListLoading
                        ]
                        opened
            , test "close hides the sheet and keeps the cache" <|
                \_ ->
                    let
                        ( opened, _ ) =
                            update BrowserOpen live

                        ( closed, _ ) =
                            update BrowserClose opened
                    in
                    Expect.equal False closed.browserOpen
            , test "query and sort inputs stick" <|
                \_ ->
                    let
                        ( queried, _ ) =
                            update (BrowserQueryInput "tiny") live

                        ( sorted, _ ) =
                            update (BrowserSortInput SortName) queried
                    in
                    Expect.all
                        [ \m -> Expect.equal "tiny" m.browserQuery
                        , \m -> Expect.equal SortName m.browserSort
                        ]
                        sorted
            , test "stats href encodes the room" <|
                \_ ->
                    Expect.equal "/stats/?room=%23hall" (statsRoomHref "#hall")
            ]
        , describe "browser join machine"
            [ test "enter sends JOIN and arms pending" <|
                \_ ->
                    let
                        base =
                            { blank | ourNick = "kai" }

                        ( entered, out ) =
                            update (BrowserEnterRoom "#new") base
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ SendLine "JOIN #new\r\n" ] out
                        , \m -> Expect.equal (Just "#new") m.browserPendingJoin
                        , \m -> Expect.equal (Just "#new") m.browserAttemptedJoin
                        , \m -> Expect.equal BrowserJoinPending m.browserJoinPhase
                        , \m -> Expect.equal (m.nowMs + browserJoinTimeoutMs) m.browserJoinDueMs
                        ]
                        entered
            , test "enter while offline is silent" <|
                \_ ->
                    let
                        base =
                            { blank | ourNick = "kai", connection = Offline }

                        ( stayed, out ) =
                            update (BrowserEnterRoom "#new") base
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \m -> Expect.equal Nothing m.browserPendingJoin
                        ]
                        stayed
            , test "enter on a joined room opens it" <|
                \_ ->
                    let
                        base =
                            { blank | ourNick = "kai" }

                        ( entered, _ ) =
                            update (BrowserEnterRoom "#new") base

                        joined =
                            feed entered ":kai!u@h JOIN #new"

                        ( opened, _ ) =
                            update (BrowserEnterRoom "#NEW") joined
                    in
                    Expect.all
                        [ \m -> Expect.equal BrowserJoinIdle m.browserJoinPhase
                        , \m -> Expect.equal Nothing m.browserPendingJoin
                        , \m -> Expect.equal (Just "#NEW") m.activeChannel
                        ]
                        opened
            , test "a second enter while pending sends nothing" <|
                \_ ->
                    let
                        base =
                            { blank | ourNick = "kai" }

                        ( entered, _ ) =
                            update (BrowserEnterRoom "#new") base

                        ( again, out ) =
                            update (BrowserEnterRoom "#NEW") entered
                    in
                    Expect.equal [] out
            , test "silence flips pending to uncertain on the watchdog" <|
                \_ ->
                    let
                        base =
                            { blank | ourNick = "kai" }

                        ( entered, _ ) =
                            update (BrowserEnterRoom "#new") base

                        fired =
                            fireBrowserJoinTimeout (entered.browserJoinDueMs + 1) entered
                    in
                    Expect.all
                        [ \m -> Expect.equal Nothing m.browserPendingJoin
                        , \m -> Expect.equal BrowserJoinUncertain m.browserJoinPhase
                        , \m -> Expect.equal (Just "#new") m.browserAttemptedJoin
                        ]
                        fired
            , test "a late JOIN settles the uncertain attempt" <|
                \_ ->
                    let
                        base =
                            { blank | ourNick = "kai" }

                        ( entered, _ ) =
                            update (BrowserEnterRoom "#new") base

                        uncertain =
                            fireBrowserJoinTimeout (entered.browserJoinDueMs + 1) entered

                        settled =
                            feed uncertain ":kai!u@h JOIN #new"
                    in
                    Expect.all
                        [ \m -> Expect.equal BrowserJoinIdle m.browserJoinPhase
                        , \m -> Expect.equal Nothing m.browserAttemptedJoin
                        ]
                        settled
            , test "a join prompt rejects the attempted room" <|
                \_ ->
                    let
                        base =
                            { blank | ourNick = "kai" }

                        ( entered, _ ) =
                            update (BrowserEnterRoom "#new") base

                        refused =
                            feed entered ":srv 471 kai #new :Cannot join channel"
                    in
                    Expect.all
                        [ \m -> Expect.equal BrowserJoinRejected m.browserJoinPhase
                        , \m -> Expect.equal Nothing m.browserPendingJoin
                        , \m -> Expect.equal (Just "#new") m.browserAttemptedJoin
                        ]
                        refused
            , test "a prompt for another room leaves the attempt alone" <|
                \_ ->
                    let
                        base =
                            { blank | ourNick = "kai" }

                        ( entered, _ ) =
                            update (BrowserEnterRoom "#new") base

                        other =
                            feed entered ":srv 471 kai #other :Cannot join channel"
                    in
                    Expect.all
                        [ \m -> Expect.equal BrowserJoinPending m.browserJoinPhase
                        , \m -> Expect.equal (Just "#new") m.browserPendingJoin
                        ]
                        other
            , test "admission copy covers pending, uncertain, and rejected" <|
                \_ ->
                    let
                        base =
                            { blank | ourNick = "kai" }

                        ( entered, _ ) =
                            update (BrowserEnterRoom "#new") base

                        uncertain =
                            fireBrowserJoinTimeout (entered.browserJoinDueMs + 1) entered

                        refused =
                            feed entered ":srv 471 kai #new :Cannot join channel"
                    in
                    Expect.all
                        [ \_ -> Expect.equal "Joining #new… Waiting for server admission." (browserAdmissionMessage entered)
                        , \_ ->
                            Expect.equal
                                "The server did not confirm joining #new. You are still in this room browser; retry #new when ready."
                                (browserAdmissionMessage uncertain)
                        , \_ ->
                            Expect.equal
                                "Could not join #new: This room is full. Choose Retry to try again."
                                (browserAdmissionMessage refused)
                        , \_ -> Expect.equal "" (browserAdmissionMessage base)
                        ]
                        ()
            ]
        , describe "mergeChannelListRow"
            [ test "over-cap requests still merge duplicates" <|
                \_ ->
                    let
                        full =
                            List.map (\n -> { name = "#r" ++ String.fromInt n, count = 1, topic = "" }) (List.range 1 maxChannelListEntries)

                        merged =
                            mergeChannelListRow full { name = "#R1", count = 9, topic = "t" }
                    in
                    Expect.all
                        [ \_ -> Expect.equal maxChannelListEntries (List.length merged)
                        , \_ ->
                            Expect.equal (Just 9)
                                (merged |> List.filter (\row -> row.name == "#r1") |> List.head |> Maybe.map .count)
                        ]
                        ()
            , test "over-long names and commas drop" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal [] (mergeChannelListRow [] { name = String.repeat 513 "#", count = 1, topic = "" })
                        , \_ -> Expect.equal [] (mergeChannelListRow [] { name = "#a,b", count = 1, topic = "" })
                        , \_ -> Expect.equal [] (mergeChannelListRow [] { name = "", count = 1, topic = "" })
                        ]
                        ()
            ]
        ]
