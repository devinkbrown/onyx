module NodesTest exposing (suite)

{-| Vectors mirroring `src/app/nodes.ts` selection rules: pin wins
(recognised or synthesised), fastest finite probe wins, all-failed
falls through to the random leg, timeout/concurrency clamp to the
bounded defaults.
-}

import Expect
import Nodes exposing (..)
import Test exposing (Test, describe, test)


nodeA : IrcNode
nodeA =
    { id = "a", host = "ircx.us", wss = "wss://ircx.us:8080" }


nodeB : IrcNode
nodeB =
    { id = "b", host = "eshmaki.me", wss = "wss://eshmaki.me:8080" }


suite : Test
suite =
    describe "Nodes"
        [ test "no pin yields no env node" <|
            \_ ->
                Expect.equal Nothing (envNode Nothing)
        , test "blank pin yields no env node" <|
            \_ ->
                Expect.equal Nothing (envNode (Just "  "))
        , test "recognised pin resolves to the registry node" <|
            \_ ->
                Expect.equal (Just nodeB) (envNode (Just "wss://eshmaki.me:8080"))
        , test "unknown pin synthesises the env entry" <|
            \_ ->
                Expect.equal
                    (Just { id = "env", host = "custom", wss = "wss://localhost:9999" })
                    (envNode (Just "wss://localhost:9999"))
        , test "fastest finite probe wins" <|
            \_ ->
                Expect.equal (Just nodeB)
                    (pickFastest
                        [ { node = nodeA, ms = 120 }
                        , { node = nodeB, ms = 40 }
                        ]
                    )
        , test "infinite probes never win" <|
            \_ ->
                Expect.equal (Just nodeB)
                    (pickFastest
                        [ { node = nodeA, ms = 1 / 0 }
                        , { node = nodeB, ms = 40 }
                        ]
                    )
        , test "all-failed probes fall through to the random leg" <|
            \_ ->
                Expect.equal Nothing
                    (pickFastest
                        [ { node = nodeA, ms = 1 / 0 }
                        , { node = nodeB, ms = 0 / 0 }
                        ]
                    )
        , test "ties keep the earlier node" <|
            \_ ->
                Expect.equal (Just nodeA)
                    (pickFastest
                        [ { node = nodeA, ms = 40 }
                        , { node = nodeB, ms = 40 }
                        ]
                    )
        , test "timeout clamps to the bounded default" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal 4000 (boundedTimeout Nothing)
                    , \_ -> Expect.equal 4000 (boundedTimeout (Just -1))
                    , \_ -> Expect.equal 250 (boundedTimeout (Just 250))
                    , \_ -> Expect.equal defaultProbeTimeoutMs (boundedTimeout (Just -5))
                    ]
                    ()
        , test "concurrency stays within 1 and the node count" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal 4 (probeConcurrency Nothing 9)
                    , \_ -> Expect.equal 2 (probeConcurrency Nothing 2)
                    , \_ -> Expect.equal 1 (probeConcurrency (Just 0) 9)
                    , \_ -> Expect.equal 9 (probeConcurrency (Just 40) 9)
                    , \_ -> Expect.equal defaultMaxConcurrency (probeConcurrency Nothing 40)
                    ]
                    ()
        ]
