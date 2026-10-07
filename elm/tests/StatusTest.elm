module StatusTest exposing (suite)

{-| Mesh health feed parity vectors, mirroring
`src/lib/stats/status.test.ts`. Non-finite JSON numbers cannot exist
on the wire (`JSON.parse` rejects them), so the malformed-input
vectors use wrong-typed fields instead — same normalized outcome.
-}

import Expect
import Json.Encode as Encode
import Status exposing (..)
import Test exposing (Test, describe, test)


nowMs : Float
nowMs =
    1784203200000


nowSec : Float
nowSec =
    1784203200


healthy : NetworkStatus
healthy =
    { generatedAt = nowSec
    , network = "Onyx"
    , node = "eshmaki.me"
    , uptimeSeconds = 60
    , usersOnline = 2
    , quorum = True
    , partitioned = False
    , components = 1
    , peers = []
    , peersComplete = True
    }


peer : String -> String -> Bool -> Encode.Value -> Int -> Encode.Value
peer name state up rtt since =
    Encode.object
        [ ( "name", Encode.string name )
        , ( "state", Encode.string state )
        , ( "up", Encode.bool up )
        , ( "rtt_ms", rtt )
        , ( "since_seconds", Encode.int since )
        ]


suite : Test
suite =
    describe "Status"
        [ describe "normalizeStatus"
            [ test "rejects non-object feeds" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (normalizeStatus (Encode.string "offline"))
                        , \_ -> Expect.equal Nothing (normalizeStatus Encode.null)
                        , \_ -> Expect.equal Nothing (normalizeStatus (Encode.list Encode.string [ "x" ]))
                        ]
                        ()
            , test "accepts the Onyx Server public status shape" <|
                \_ ->
                    case
                        normalizeStatus
                            (Encode.object
                                [ ( "generated_at", Encode.int 1783500000 )
                                , ( "network", Encode.string "Onyx" )
                                , ( "node", Encode.string "eshmaki.me" )
                                , ( "uptime_seconds", Encode.int 93784 )
                                , ( "users_online", Encode.int 12 )
                                , ( "mesh", Encode.object [ ( "quorum", Encode.bool True ), ( "partitioned", Encode.bool False ), ( "components", Encode.int 1 ) ] )
                                , ( "peers"
                                  , Encode.list identity
                                        [ peer "ircx.us" "up" True (Encode.int 38) 3600
                                        , peer "stale.node" "down" False Encode.null 120
                                        ]
                                  )
                                ]
                            )
                    of
                        Nothing ->
                            Expect.fail "expected a status"

                        Just status ->
                            Expect.all
                                [ \_ -> Expect.equal True status.quorum
                                , \_ -> Expect.equal (Just (Just 38)) (List.head status.peers |> Maybe.map .rttMs)
                                , \_ -> Expect.equal (Just "down") (List.drop 1 status.peers |> List.head |> Maybe.map .state)
                                , \_ -> Expect.equal True status.peersComplete
                                ]
                                ()
            , test "defaults malformed fields defensively" <|
                \_ ->
                    case
                        normalizeStatus
                            (Encode.object
                                [ ( "generated_at", Encode.string "soon" )
                                , ( "network", Encode.int 42 )
                                , ( "node", Encode.null )
                                , ( "uptime_seconds", Encode.string "many" )
                                , ( "users_online", Encode.string "many" )
                                , ( "mesh", Encode.object [ ( "quorum", Encode.string "yes" ), ( "partitioned", Encode.bool True ), ( "components", Encode.string "split" ) ] )
                                , ( "peers"
                                  , Encode.list identity
                                        [ peer "edge" "" False (Encode.string "fast") -3
                                        , peer "" "up" True Encode.null 0
                                        ]
                                  )
                                ]
                            )
                    of
                        Nothing ->
                            Expect.fail "expected a status"

                        Just status ->
                            Expect.equal
                                { generatedAt = 0
                                , network = ""
                                , node = ""
                                , uptimeSeconds = 0
                                , usersOnline = 0
                                , quorum = False
                                , partitioned = True
                                , components = 1
                                , peers = [ { name = "edge", state = "unknown", up = False, rttMs = Nothing, sinceSeconds = 0 } ]
                                , peersComplete = False
                                }
                                status
            , test "bounds peer work, text, and counters" <|
                \_ ->
                    let
                        peers =
                            List.range 0 (maxStatusPeers + 3)
                                |> List.map
                                    (\index ->
                                        peer
                                            (if index == 1 then
                                                String.repeat (maxStatusPeerNameLength + 1) "n"

                                             else
                                                "peer-" ++ String.fromInt index
                                            )
                                            (String.repeat 100 "s")
                                            True
                                            (Encode.float (toFloat index))
                                            index
                                    )
                    in
                    case
                        normalizeStatus
                            (Encode.object
                                [ ( "generated_at", Encode.string "soon" )
                                , ( "network", Encode.string (String.repeat 300 "n") )
                                , ( "node", Encode.string (String.repeat 300 "o") )
                                , ( "uptime_seconds", Encode.float 1e30 )
                                , ( "users_online", Encode.int -5 )
                                , ( "mesh", Encode.object [ ( "components", Encode.int 10000 ) ] )
                                , ( "peers", Encode.list identity peers )
                                ]
                            )
                    of
                        Nothing ->
                            Expect.fail "expected a status"

                        Just status ->
                            Expect.all
                                [ \_ -> Expect.equal (maxStatusPeers - 1) (List.length status.peers)
                                , \_ -> Expect.equal False (List.any (\p -> String.length p.name > maxStatusPeerNameLength) status.peers)
                                , \_ -> Expect.equal (Just 32) (List.head status.peers |> Maybe.map (.state >> String.length))
                                , \_ -> Expect.equal False status.peersComplete
                                , \_ -> Expect.equal 0 status.generatedAt
                                , \_ -> Expect.equal 2147483647 status.uptimeSeconds
                                , \_ -> Expect.equal 0 status.usersOnline
                                , \_ -> Expect.equal 1024 status.components
                                , \_ -> Expect.equal 256 (String.length status.network)
                                , \_ -> Expect.equal 256 (String.length status.node)
                                ]
                                ()
            , test "deduplicates peer names case-insensitively" <|
                \_ ->
                    case
                        normalizeStatus
                            (Encode.object
                                [ ( "generated_at", Encode.float nowSec )
                                , ( "mesh", Encode.object [ ( "quorum", Encode.bool True ), ( "partitioned", Encode.bool False ), ( "components", Encode.int 1 ) ] )
                                , ( "peers"
                                  , Encode.list identity
                                        [ peer "ircx.us" "up" True (Encode.int 12) 60
                                        , peer "IRCX.US" "up" True (Encode.int 8) 90
                                        ]
                                  )
                                ]
                            )
                    of
                        Nothing ->
                            Expect.fail "expected a status"

                        Just status ->
                            Expect.all
                                [ \_ ->
                                    Expect.equal
                                        [ { name = "ircx.us", state = "up", up = True, rttMs = Just 12, sinceSeconds = 60 } ]
                                        status.peers
                                , \_ -> Expect.equal False status.peersComplete
                                , \_ -> Expect.equal Degraded (feedState (Just status) nowMs)
                                ]
                                ()
            , test "absent peer list is not complete" <|
                \_ ->
                    case
                        normalizeStatus
                            (Encode.object
                                [ ( "generated_at", Encode.float nowSec )
                                , ( "mesh", Encode.object [ ( "quorum", Encode.bool True ), ( "partitioned", Encode.bool False ), ( "components", Encode.int 1 ) ] )
                                ]
                            )
                    of
                        Nothing ->
                            Expect.fail "expected a status"

                        Just status ->
                            Expect.all
                                [ \_ -> Expect.equal [] status.peers
                                , \_ -> Expect.equal False status.peersComplete
                                , \_ -> Expect.equal Degraded (feedState (Just status) nowMs)
                                ]
                                ()
            , test "formats compact durations" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "45s" (formatDuration 45)
                        , \_ -> Expect.equal "0s" (formatDuration -10)
                        , \_ -> Expect.equal "1m" (formatDuration 60)
                        , \_ -> Expect.equal "1h 3m" (formatDuration 3780)
                        , \_ -> Expect.equal "2d 1h" (formatDuration 176400)
                        , \_ -> Expect.equal "0s" (formatDuration (0 / 0))
                        ]
                        ()
            ]
        , describe "feedState"
            [ test "online only for a fresh healthy quorum sample" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Current (feedState (Just healthy) nowMs)
                        , \_ -> Expect.equal "network online" (feedLabel Current)
                        ]
                        ()
            , test "topology failures stay distinct from freshness failures" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Degraded (feedState (Just { healthy | quorum = False, partitioned = True, components = 2 }) nowMs)
                        , \_ -> Expect.equal Stale (feedState (Just { healthy | generatedAt = (nowMs - 600000) / 1000 }) nowMs)
                        , \_ -> Expect.equal Future (feedState (Just { healthy | generatedAt = (nowMs + 600000) / 1000 }) nowMs)
                        , \_ -> Expect.equal Unknown (feedState (Just { healthy | generatedAt = 0 }) nowMs)
                        , \_ -> Expect.equal Unavailable (feedState Nothing nowMs)
                        ]
                        ()
            , test "every non-current state has truthful wording" <|
                \_ ->
                    Expect.equal
                        [ "checking network"
                        , "network degraded"
                        , "status stale"
                        , "status time mismatch"
                        , "status undated"
                        , "status unavailable"
                        ]
                        (List.map feedLabel [ Loading, Degraded, Stale, Future, Unknown, Unavailable ])
            , test "community voice never claims health without a report" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "Reachable" (communityVoice Current).label
                        , \_ -> Expect.equal "The rooms are reachable tonight." (communityVoice Current).sentence
                        , \_ -> Expect.equal "Having trouble" (communityVoice Degraded).label
                        , \_ -> Expect.equal "Checking" (communityVoice Loading).label
                        , \_ -> Expect.equal "We cannot say" (communityVoice Stale).label
                        , \_ -> Expect.equal "There is no public report, so we cannot claim health." (communityVoice Unavailable).sentence
                        ]
                        ()
            ]
        ]
