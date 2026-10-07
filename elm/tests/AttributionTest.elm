module AttributionTest exposing (suite)

{-| Account attribution: fail-closed node/account gating, enroll and
residence round trips with generation guards, ADDED/PUBLISHED
confirms, the single STALE_EPOCH retry, and refresh beats. Oracle
`src/lib/irc/attribution.ts`.
-}

import Attribution exposing (..)
import Expect
import Test exposing (Test, describe, test)


named : AttributionSession
named =
    { blankSession | serverUrl = "wss://irc.example", account = Just "alice", nodeHex = Just "0123456789abcdef" }


enrolled : AttributionSession
enrolled =
    { named | publishedNode = Just "0123456789abcdef", lastEpoch = 1000, refreshDueMs = Just 9999999999999 }


goodEnroll : EnrollReply
goodEnroll =
    { account = "alice"
    , nodeHex = "0123456789abcdef"
    , gen = 0
    , label = "onyx-0123456789abcdef"
    , publicHex = String.repeat 64 "a"
    , sig = String.repeat 128 "b"
    , alreadyEnrolled = False
    }


goodResidence : ResidenceReply
goodResidence =
    { account = "alice"
    , nodeHex = "0123456789abcdef"
    , epoch = 2000
    , expiryMs = 3000
    , gen = 0
    , sig = String.repeat 128 "c"
    }


suite : Test
suite =
    describe "Attribution"
        [ describe "gating"
            [ test "nothing owed without account and node" <|
                \_ ->
                    Expect.equal ( blankSession, NoEffect ) (kickAttribution blankSession)
            , test "malformed node ignored" <|
                \_ ->
                    Expect.equal ( named, NoEffect ) (foldNode named "xyz")
            , test "same node is a no-op" <|
                \_ ->
                    Expect.equal ( named, NoEffect ) (foldNode named "0123456789ABCDEF")
            , test "node plus account requests enrollment" <|
                \_ ->
                    Expect.equal
                        ( named
                        , RequestEnroll { serverUrl = "wss://irc.example", account = "alice", nodeHex = "0123456789abcdef", gen = 0 }
                        )
                        (foldNode { named | nodeHex = Nothing } "0123456789abcdef")
            , test "published node owes nothing" <|
                \_ ->
                    Expect.equal ( enrolled, NoEffect ) (kickAttribution enrolled)
            , test "same 900 account is a no-op" <|
                \_ ->
                    Expect.equal ( named, NoEffect ) (foldAccount named (Just "alice"))
            , test "900 account change bumps the generation" <|
                \_ ->
                    let
                        ( next, effect ) =
                            foldAccount enrolled (Just "bob")
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "bob") next.account
                        , \_ -> Expect.equal 1 next.gen
                        , \_ -> Expect.equal Nothing next.publishedNode
                        , \_ ->
                            Expect.equal
                                (RequestEnroll { serverUrl = "wss://irc.example", account = "bob", nodeHex = "0123456789abcdef", gen = 1 })
                                effect
                        ]
                        ()
            , test "reset keeps the epoch floor" <|
                \_ ->
                    let
                        reset =
                            resetSession { enrolled | lastEpoch = 5000 }
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing reset.account
                        , \_ -> Expect.equal 5000 reset.lastEpoch
                        , \_ -> Expect.equal 1 reset.gen
                        ]
                        ()
            ]
        , describe "enroll round trip"
            [ test "fresh key sends ADD and pends enrollment" <|
                \_ ->
                    let
                        ( next, effect ) =
                            foldEnrollReply named 1000 goodEnroll
                    in
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (Just { account = "alice", label = "onyx-0123456789abcdef", publicHex = String.repeat 64 "a" })
                                next.pendingEnroll
                        , \_ ->
                            Expect.equal
                                (SendIdentityAdd { label = "onyx-0123456789abcdef", publicHex = String.repeat 64 "a", sig = String.repeat 128 "b" })
                                effect
                        ]
                        ()
            , test "already-enrolled key skips ADD for the residence signature" <|
                \_ ->
                    Expect.equal
                        ( named
                        , RequestResidenceSign
                            { serverUrl = "wss://irc.example"
                            , account = "alice"
                            , nodeHex = "0123456789abcdef"
                            , epoch = 1000
                            , expiryMs = 1000 + residenceTtlMs
                            , gen = 0
                            }
                        )
                        (foldEnrollReply named 1000 { goodEnroll | alreadyEnrolled = True })
            , test "stale generation drops the reply" <|
                \_ ->
                    Expect.equal ( named, NoEffect ) (foldEnrollReply named 1000 { goodEnroll | gen = 3 })
            , test "already-enrolled reply carries no signature to validate" <|
                \_ ->
                    Expect.equal
                        ( named
                        , RequestResidenceSign
                            { serverUrl = "wss://irc.example"
                            , account = "alice"
                            , nodeHex = "0123456789abcdef"
                            , epoch = 1000
                            , expiryMs = 1000 + residenceTtlMs
                            , gen = 0
                            }
                        )
                        (foldEnrollReply named 1000 { goodEnroll | alreadyEnrolled = True, sig = "" })
            , test "malformed material drops the reply" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal ( named, NoEffect ) (foldEnrollReply named 1000 { goodEnroll | sig = "short" })
                        , \_ -> Expect.equal ( named, NoEffect ) (foldEnrollReply named 1000 { goodEnroll | publicHex = "zz" })
                        , \_ -> Expect.equal ( named, NoEffect ) (foldEnrollReply named 1000 { goodEnroll | label = "bad label!" })
                        , \_ -> Expect.equal ( named, NoEffect ) (foldEnrollReply named 1000 { goodEnroll | account = "mallory" })
                        ]
                        ()
            , test "ADDED confirms only the pending label" <|
                \_ ->
                    let
                        ( pending, _ ) =
                            foldEnrollReply named 1000 goodEnroll

                        ( confirmed, effect ) =
                            foldAddedNotice pending "onyx-0123456789abcdef"

                        ( stranger, strangerEffect ) =
                            foldAddedNotice pending "onyx-other"
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing confirmed.pendingEnroll
                        , \_ ->
                            Expect.equal
                                (ConfirmEnrolled { serverUrl = "wss://irc.example", account = "alice", publicHex = String.repeat 64 "a" })
                                effect
                        , \_ -> Expect.equal pending stranger
                        , \_ -> Expect.equal NoEffect strangerEffect
                        , \_ -> Expect.equal ( named, NoEffect ) (foldAddedNotice named "onyx-0123456789abcdef")
                        ]
                        ()
            ]
        , describe "residence round trip"
            [ test "signed proof goes out and arms refresh" <|
                \_ ->
                    let
                        ( next, effect ) =
                            foldResidenceReply named 1000 goodResidence
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just "0123456789abcdef") next.publishedNode
                        , \_ -> Expect.equal 2000 next.lastEpoch
                        , \_ -> Expect.equal (Just (1000 + residenceRefreshMs)) next.refreshDueMs
                        , \_ ->
                            Expect.equal
                                (SendIdentityResidence { nodeHex = "0123456789abcdef", epoch = 2000, expiryMs = 3000, sig = String.repeat 128 "c" })
                                effect
                        ]
                        ()
            , test "old epoch and drift drop the reply" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal ( { named | lastEpoch = 5000 }, NoEffect ) (foldResidenceReply { named | lastEpoch = 5000 } 1000 goodResidence)
                        , \_ -> Expect.equal ( named, NoEffect ) (foldResidenceReply named 1000 { goodResidence | nodeHex = "ffffffffffffffff" })
                        , \_ -> Expect.equal ( named, NoEffect ) (foldResidenceReply named 1000 { goodResidence | gen = 9 })
                        ]
                        ()
            , test "PUBLISHED re-arms the stale retry" <|
                \_ ->
                    Expect.equal ( { named | staleRetried = False }, NoEffect ) (foldPublishedNotice { named | staleRetried = True })
            , test "STALE_EPOCH retries once with a bumped floor" <|
                \_ ->
                    let
                        ( retried, effect ) =
                            foldStaleEpoch named

                        ( twice, twiceEffect ) =
                            foldStaleEpoch retried
                    in
                    Expect.all
                        [ \_ -> Expect.equal True retried.staleRetried
                        , \_ -> Expect.equal staleEpochBumpMs retried.lastEpoch
                        , \_ ->
                            Expect.equal
                                (RequestEnroll { serverUrl = "wss://irc.example", account = "alice", nodeHex = "0123456789abcdef", gen = 0 })
                                effect
                        , \_ -> Expect.equal ( retried, NoEffect ) ( twice, twiceEffect )
                        , \_ -> Expect.equal ( blankSession, NoEffect ) (foldStaleEpoch blankSession)
                        ]
                        ()
            , test "refresh beat re-signs after lapse" <|
                \_ ->
                    let
                        due =
                            { enrolled | refreshDueMs = Just 1000 }

                        ( fired, effect ) =
                            tickRefresh due 2000

                        ( early, earlyEffect ) =
                            tickRefresh due 500
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing fired.publishedNode
                        , \_ ->
                            Expect.equal
                                (RequestEnroll { serverUrl = "wss://irc.example", account = "alice", nodeHex = "0123456789abcdef", gen = 0 })
                                effect
                        , \_ -> Expect.equal ( due, NoEffect ) ( early, earlyEffect )
                        , \_ -> Expect.equal ( named, NoEffect ) (tickRefresh named 999999)
                        ]
                        ()
            ]
        ]
