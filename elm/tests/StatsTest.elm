module StatsTest exposing (suite)

{-| Stats surface parity vectors, mirroring
`src/lib/stats/{channelStats,networkIndex,channelDetail,backups}.test.ts`
and the pure sections of `src/routes/Stats.test.tsx`: byte-faithful
slugs, fail-closed normalization, query parsing, deep links, timeline,
and the directory folds.
-}

import Expect
import Stats exposing (..)
import Test exposing (Test, describe, test)


channel : String -> StatsChannel
channel name =
    { channel = name
    , messages = 0
    , activeUsers = 0
    , present = 0
    , lastActive = 0
    , topic = ""
    , spark = []
    }


room : String -> Int -> Int -> Float -> String -> StatsChannel
room name messages present lastActive topic =
    { channel = name
    , messages = messages
    , activeUsers = 0
    , present = present
    , lastActive = lastActive
    , topic = topic
    , spark = []
    }


suite : Test
suite =
    describe "Stats"
        [ test "channelToSlug is byte-faithful to the server" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "root" (channelToSlug "#root")
                    , \_ -> Expect.equal "foo_bar" (channelToSlug "#foo/bar")
                    , \_ -> Expect.equal "_._etc_passwd" (channelToSlug "#../etc/passwd")
                    , \_ -> Expect.equal "_hidden" (channelToSlug "&.hidden")
                    , \_ -> Expect.equal "" (channelToSlug "#")
                    , \_ -> Expect.equal "foo_bar" (channelToSlug "#Foo Bar")
                    , \_ -> Expect.equal "dev.ops_team-1" (channelToSlug "#dev.ops_team-1")
                    , \_ -> Expect.equal "__spaced__" (channelToSlug "#  spaced  ")
                    , \_ -> Expect.equal "___" (channelToSlug "#!!!")
                    , \_ -> Expect.equal "caf__" (channelToSlug "#café")
                    , \_ -> Expect.equal "_root" (channelToSlug "##root")
                    , \_ -> Expect.equal (String.repeat 128 "a") (channelToSlug ("#" ++ String.repeat 140 "A"))
                    , \_ -> Expect.equal "" (channelToSlug "")
                    , \_ -> Expect.equal (Just "/stats/data/root.json") (channelDetailUrl "#root")
                    , \_ -> Expect.equal Nothing (channelDetailUrl "#")
                    ]
                    ()
        , test "normalizeIndex keeps validated rows and flags omissions" <|
            \_ ->
                let
                    body =
                        "{\"generated_at\":1784203200,\"network\":\"Onyx\",\"node\":\"test\",\"users_online\":7,"
                            ++ "\"network_days\":[{\"date\":\"2026-07-08\",\"messages\":24},{\"date\":\"2026-07-08\",\"messages\":99},{\"date\":\"bad\",\"messages\":1}],"
                            ++ "\"channels\":[{\"channel\":\"#root\",\"messages\":10,\"present\":2,\"topic\":\"hi\",\"spark\":[1,2]},{\"channel\":\"nope\",\"messages\":5},42]}"
                in
                case decodeStatsIndex body of
                    Nothing ->
                        Expect.fail "expected an index"

                    Just index ->
                        Expect.all
                            [ \_ -> Expect.equal 1 (List.length index.channels)
                            , \_ -> Expect.equal "#root" (Maybe.map .channel (List.head index.channels) |> Maybe.withDefault "")
                            , \_ -> Expect.equal 1 (List.length index.networkDays)
                            , \_ -> Expect.equal False index.networkDaysComplete
                            , \_ -> Expect.equal False index.channelsComplete
                            , \_ -> Expect.equal 7 index.usersOnline
                            , \_ -> Expect.equal "Onyx" index.network
                            ]
                            ()
        , test "normalizeIndex rejects shapes without a channels array" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (decodeStatsIndex "null")
                    , \_ -> Expect.equal Nothing (decodeStatsIndex "[1]")
                    , \_ -> Expect.equal Nothing (decodeStatsIndex "{\"channels\":{}}")
                    , \_ -> Expect.equal Nothing (decodeStatsIndex "not json")
                    ]
                    ()
        , test "normalizeChannelDetail gates the room and reports completeness" <|
            \_ ->
                let
                    body =
                        "{\"channel\":\"#root\",\"generated_at\":100,\"first_seen\":50,\"last_active\":90,\"present\":3,"
                            ++ "\"last_speaker\":\"alice\",\"totals\":{\"messages\":10,\"words\":40,\"active_users\":4,\"joins\":9,\"parts\":2,\"quits\":1,\"kicks\":0,\"topic_changes\":1},"
                            ++ "\"hours\":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],"
                            ++ "\"days\":[{\"date\":\"2026-07-08\",\"messages\":10}],"
                            ++ "\"heatmap\":[[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],"
                            ++ "\"records\":{\"busiest_day\":{\"date\":\"2026-07-08\",\"messages\":10},\"peak_hour\":12}}"
                in
                Expect.all
                    [ \_ ->
                        case decodeChannelDetail body "#root" of
                            Nothing ->
                                Expect.fail "expected a detail"

                            Just detail ->
                                Expect.all
                                    [ \_ -> Expect.equal True detail.complete
                                    , \_ -> Expect.equal 24 (List.length detail.hours)
                                    , \_ -> Expect.equal 7 (List.length detail.heatmap)
                                    , \_ -> Expect.equal (Just 12) detail.peakHour
                                    , \_ -> Expect.equal 6 (netMembershipFlow detail.totals)
                                    , \_ -> Expect.equal "4.0" (averageWords detail)
                                    ]
                                    ()
                    , \_ -> Expect.equal Nothing (decodeChannelDetail body "#other")
                    , \_ -> Expect.equal Nothing (decodeChannelDetail "{\"channel\":\"nope\"}" "")
                    ]
                    ()
        , test "decodeChannelPulse needs exactly 24 hour counts" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        case decodeChannelPulse "{\"hours\":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],\"present\":2,\"last_active\":9}" of
                            Nothing ->
                                Expect.fail "expected a pulse"

                            Just pulse ->
                                Expect.all
                                    [ \_ -> Expect.equal 24 pulse.total
                                    , \_ -> Expect.equal 2 pulse.present
                                    ]
                                    ()
                    , \_ -> Expect.equal Nothing (decodeChannelPulse "{\"hours\":[1,2]}")
                    , \_ -> Expect.equal Nothing (decodeChannelPulse "[]")
                    ]
                    ()
        , test "decodeBackupManifest drops bad rows and dedupes" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (decodeBackupManifest "null")
                    , \_ -> Expect.equal Nothing (decodeBackupManifest "\"x\"")
                    , \_ ->
                        case decodeBackupManifest "{\"generated_at\":5,\"files\":[{\"kind\":\"chan\",\"name\":\"a.db\",\"source\":\"s\"},{\"kind\":\"CHAN\",\"name\":\"A.DB\"},{\"kind\":\"\",\"name\":\"b\"},42]}" of
                            Nothing ->
                                Expect.fail "expected a manifest"

                            Just manifest ->
                                Expect.all
                                    [ \_ -> Expect.equal 1 (List.length manifest.files)
                                    , \_ -> Expect.equal "s" (Maybe.map .source (List.head manifest.files) |> Maybe.withDefault "")
                                    ]
                                    ()
                    , \_ ->
                        case decodeBackupManifest "{\"generated_at\":3}" of
                            Nothing ->
                                Expect.fail "expected an empty manifest"

                            Just manifest ->
                                Expect.equal [] manifest.files
                    ]
                    ()
        , test "query parsers accept, prefix, and reject" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "#root" (parseStatsRoomQuery "?room=%23root")
                    , \_ -> Expect.equal "#root" (parseStatsRoomQuery "?room=root")
                    , \_ -> Expect.equal "&ops" (parseStatsRoomQuery "room=%26ops")
                    , \_ -> Expect.equal "" (parseStatsRoomQuery "?room=#a+b")
                    , \_ -> Expect.equal "" (parseStatsRoomQuery "")
                    , \_ -> Expect.equal [ "#a", "#b" ] (parseStatsCompareQuery "?compare=%23a,%23b")
                    , \_ -> Expect.equal [ "#a" ] (parseStatsCompareQuery "?compare=%23a,%23A,zzz")
                    , \_ -> Expect.equal [] (parseStatsCompareQuery "")
                    , \_ -> Expect.equal "#a,#b" (statsCompareQuery [ "#a", "#b", "#a" ])
                    , \_ -> Expect.equal 7 (parseStatsWindowQuery "?window=7")
                    , \_ -> Expect.equal 14 (parseStatsWindowQuery "?window=14")
                    , \_ -> Expect.equal 14 (parseStatsWindowQuery "?window=garbage")
                    , \_ -> Expect.equal "/stats/?room=%23root" (statsRoomHref "#root")
                    ]
                    ()
        , test "roomDeepLink degrades out-of-range moments to a plain join" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "/app/?join=%23root" (roomDeepLink "#root" 0)
                    , \_ ->
                        Expect.equal "/app/?join=%23root&at=2026-07-08T12%3A00%3A00.000Z"
                            (roomDeepLink "#root" 1783512000)
                    , \_ -> Expect.equal "/app/?join=%23root" (roomDeepLink "#root" 1.0e17)
                    ]
                    ()
        , test "relTime guards and formats compact labels" <|
            \_ ->
                let
                    now =
                        1784203200000
                in
                Expect.all
                    [ \_ -> Expect.equal "a while ago" (relTime 0 now)
                    , \_ -> Expect.equal "a while ago" (relTime -5 now)
                    , \_ -> Expect.equal "just now" (relTime (now / 1000) now)
                    , \_ -> Expect.equal "5m ago" (relTime ((now - 5 * 60 * 1000) / 1000) now)
                    , \_ -> Expect.equal "3h ago" (relTime ((now - 3 * 60 * 60 * 1000) / 1000) now)
                    , \_ -> Expect.equal "yesterday" (relTime ((now - 30 * 60 * 60 * 1000) / 1000) now)
                    , \_ -> Expect.equal "3d ago" (relTime ((now - 3 * 24 * 60 * 60 * 1000) / 1000) now)
                    , \_ -> Expect.equal "in 5m" (relTime ((now + 5 * 60 * 1000) / 1000) now)
                    ]
                    ()
        , test "counts group en-US and shares round like toFixed" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "1,234,567" (formatCount 1234567)
                    , \_ -> Expect.equal "0" (formatCount 0)
                    , \_ -> Expect.equal "12:00 UTC" (formatHour (Just 12))
                    , \_ -> Expect.equal "—" (formatHour Nothing)
                    , \_ -> Expect.equal "—" (networkShare 5 0)
                    , \_ -> Expect.equal "25%" (networkShare 1 4)
                    , \_ -> Expect.equal "33%" (networkShare 1 3)
                    , \_ -> Expect.equal "3.3%" (networkShare 1 30)
                    , \_ -> Expect.equal (Just 25) (Maybe.map round (roomShareOfNetwork 1 4))
                    , \_ -> Expect.equal Nothing (roomShareOfNetwork 1 0)
                    , \_ -> Expect.equal 0 (peakHourShare [])
                    , \_ -> Expect.equal "3" (barHeight 0 0)
                    , \_ -> Expect.equal "100" (barHeight 10 10)
                    ]
                    ()
        , test "timeline, labels, and notes stay legible per state" <|
            \_ ->
                let
                    steps state hasData =
                        List.map (\s -> ( s.id, s.status, s.state )) (statsFeedTimeline state hasData)
                in
                Expect.all
                    [ \_ ->
                        Expect.equal [ ( "report", "waiting", "pending" ), ( "freshness", "pending", "pending" ), ( "scope", "pending", "pending" ) ]
                            (steps FeedLoading True)
                    , \_ ->
                        Expect.equal [ ( "report", "not found", "unavailable" ), ( "freshness", "not checked", "unavailable" ), ( "scope", "not available", "unavailable" ) ]
                            (steps FeedUnavailable False)
                    , \_ ->
                        Expect.equal [ ( "report", "received", "observed" ), ( "freshness", "within window", "observed" ), ( "scope", "aggregate-only", "observed" ) ]
                            (steps FeedCurrent True)
                    , \_ -> Expect.equal "stats current" (feedStateLabel FeedCurrent)
                    , \_ -> Expect.equal "stats incomplete" (feedStateLabel FeedPartial)
                    , \_ -> Expect.equal "stats unavailable" (feedStateLabel FeedUnavailable)
                    , \_ -> Expect.equal "export current" (feedLedgerPhrase FeedCurrent)
                    , \_ -> Expect.equal "export unavailable" (feedLedgerPhrase FeedUnavailable)
                    , \_ -> Expect.equal "Checking the public export. No activity claim yet." (feedTimelineNote FeedLoading Nothing 0)
                    , \_ -> Expect.equal "snapshot" (stepState FeedStale)
                    , \_ -> Expect.equal "current" (stepState FeedCurrent)
                    , \_ -> Expect.equal "loading" (stepState FeedLoading)
                    ]
                    ()
        , test "visibleChannels scopes, sorts, and searches" <|
            \_ ->
                let
                    rooms =
                        [ room "#b" 5 0 100 "waves"
                        , room "#a" 5 3 50 "harbor"
                        , room "#c" 9 0 200 "quiet"
                        ]

                    names list =
                        List.map .channel list

                    days =
                        [ { date = "d1", messages = 1 }, { date = "d2", messages = 2 }, { date = "d3", messages = 3 } ]
                in
                Expect.all
                    [ \_ -> Expect.equal [ "#c", "#a", "#b" ] (names (visibleChannels rooms ScopeAll SortMessages "" 0))
                    , \_ -> Expect.equal [ "#a" ] (names (visibleChannels rooms ScopePresent SortMessages "" 0))
                    , \_ -> Expect.equal [ "#b" ] (names (visibleChannels rooms ScopeAll SortMessages "waves" 0))
                    , \_ -> Expect.equal [ "#a" ] (names (visibleChannels rooms ScopeAll SortMessages "HARBOR" 0))
                    , \_ -> Expect.equal [ "#c", "#b", "#a" ] (names (visibleChannels rooms ScopeAll SortRecent "" 0))
                    , \_ -> Expect.equal [ "#a" ] (names (visibleChannels rooms ScopeRecent SortMessages "" 90000000))
                    , \_ -> Expect.equal "#c" (Maybe.map .channel (busiestChannel rooms) |> Maybe.withDefault "")
                    , \_ -> Expect.equal [ "d2", "d3" ] (List.map .date (windowDaysFor days 2))
                    ]
                    ()
        , test "comparison copy reads aggregate-only" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "Room choices will appear when a public room index is available." (selectionCopy 0 0)
                    , \_ -> Expect.equal "One room selected. Add one more room to unlock the side-by-side read." (selectionCopy 1 3)
                    , \_ -> Expect.equal "Waiting for the public room index. No comparison claim yet." (feedNote FeedLoading 0 0)
                    , \_ -> Expect.equal "1 selected room is not in this export. Clear the selection or choose another room." (feedNote FeedCurrent 1 1)
                    , \_ -> Expect.equal "" (compareHeadline [ channel "#a" ])
                    , \_ ->
                        Expect.equal "#b leads by 4 tracked messages."
                            (compareHeadline [ room "#a" 1 0 0 "", room "#b" 5 0 0 "" ])
                    ]
                    ()
        ]
